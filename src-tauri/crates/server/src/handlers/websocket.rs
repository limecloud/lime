//! WebSocket 连接处理器
//!
//! 处理 WebSocket 连接的建立、消息收发和 API 请求转发

use axum::{
    body::Body,
    extract::{
        ws::{Message as WsMessage, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::HeaderMap,
    response::IntoResponse,
};
use futures::{SinkExt, StreamExt as FuturesStreamExt};
use lime_core::database::dao::api_key_provider::ApiProviderType;
use serde::Deserialize;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::AppState;
use lime_core::errors::GatewayErrorCode;
use lime_core::models::anthropic::AnthropicMessagesRequest;
use lime_core::models::openai::ChatCompletionRequest;
use lime_core::models::{RuntimeCredentialData, RuntimeProviderCredential};
use lime_core::websocket::WsErrorCode;
use lime_processor::RequestContext;
use lime_providers::converter::anthropic_to_openai::convert_anthropic_to_openai;
use lime_providers::providers::{ClaudeCustomProvider, OpenAICustomProvider, PromptCacheMode};
use lime_websocket::{
    WsApiRequest, WsApiResponse, WsEndpoint, WsError, WsMessage as WsProtoMessage,
};

fn extract_openai_usage_pair(response: &serde_json::Value) -> (u64, u64) {
    let usage = response.get("usage").and_then(serde_json::Value::as_object);
    let prompt_tokens = usage
        .and_then(|usage| usage.get("prompt_tokens"))
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    let completion_tokens = usage
        .and_then(|usage| usage.get("completion_tokens"))
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);

    (prompt_tokens, completion_tokens)
}

/// WebSocket 查询参数
#[derive(Debug, Deserialize, Default)]
pub struct WsQueryParams {
    /// API 密钥（通过 URL 参数传递）
    pub api_key: Option<String>,
    /// Token（通过 URL 参数传递，与 api_key 等效）
    pub token: Option<String>,
}

/// WebSocket 升级处理器
pub async fn ws_upgrade_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Query(params): Query<WsQueryParams>,
    headers: HeaderMap,
) -> impl IntoResponse {
    // 验证 API 密钥：优先从 header 获取，其次从 URL 参数获取
    let auth = headers
        .get("authorization")
        .or_else(|| headers.get("x-api-key"))
        .and_then(|v| v.to_str().ok());

    let key = match auth {
        Some(s) if s.starts_with("Bearer ") => Some(&s[7..]),
        Some(s) => Some(s),
        None => {
            // 尝试从 URL 参数获取
            params.api_key.as_deref().or(params.token.as_deref())
        }
    };

    // 如果没有提供任何认证信息，允许连接（用于内部 Flow Monitor）
    // 但会在日志中记录
    let authenticated = match key {
        Some(k) if k == state.api_key => true,
        Some(_) => {
            return axum::http::Response::builder()
                .status(401)
                .body(Body::from("Invalid API key"))
                .unwrap()
                .into_response();
        }
        None => {
            // 允许无认证连接（仅用于本地 Flow Monitor UI）
            tracing::debug!("[WS] Allowing unauthenticated connection for Flow Monitor");
            false
        }
    };

    // 获取客户端信息
    let client_info = headers
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    ws.on_upgrade(move |socket| handle_websocket(socket, state, client_info, authenticated))
}

/// 处理 WebSocket 连接
pub async fn handle_websocket(
    socket: WebSocket,
    state: AppState,
    client_info: Option<String>,
    authenticated: bool,
) {
    let conn_id = uuid::Uuid::new_v4().to_string();

    // 注册连接
    if let Err(e) = state
        .ws_manager
        .register(conn_id.clone(), client_info.clone())
    {
        state.logs.write().await.add(
            "error",
            &format!("[WS] Failed to register connection: {}", e.message),
        );
        return;
    }

    state.logs.write().await.add(
        "info",
        &format!(
            "[WS] New connection: {} (client: {:?}, authenticated: {})",
            &conn_id[..8],
            client_info,
            authenticated
        ),
    );

    let (sender, mut receiver) = socket.split();
    let sender = Arc::new(Mutex::new(sender));

    // 消息处理循环
    while let Some(msg) = receiver.next().await {
        match msg {
            Ok(WsMessage::Text(text)) => {
                state.ws_manager.on_message();
                state.ws_manager.increment_request_count(&conn_id);

                match serde_json::from_str::<WsProtoMessage>(&text) {
                    Ok(ws_msg) => {
                        let response = handle_ws_message(&state, &conn_id, ws_msg).await;
                        if let Some(resp) = response {
                            let resp_text = serde_json::to_string(&resp).unwrap_or_default();
                            let mut sender_guard = sender.lock().await;
                            if sender_guard.send(WsMessage::Text(resp_text)).await.is_err() {
                                break;
                            }
                        }
                    }
                    Err(e) => {
                        state.ws_manager.on_error();
                        let error = WsProtoMessage::Error(WsError::invalid_message(format!(
                            "Failed to parse message: {e}"
                        )));
                        let error_text = serde_json::to_string(&error).unwrap_or_default();
                        let mut sender_guard = sender.lock().await;
                        if sender_guard
                            .send(WsMessage::Text(error_text))
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                }
            }
            Ok(WsMessage::Binary(_)) => {
                state.ws_manager.on_error();
                let error = WsProtoMessage::Error(WsError::invalid_message(
                    "Binary messages not supported",
                ));
                let error_text = serde_json::to_string(&error).unwrap_or_default();
                let mut sender_guard = sender.lock().await;
                if sender_guard
                    .send(WsMessage::Text(error_text))
                    .await
                    .is_err()
                {
                    break;
                }
            }
            Ok(WsMessage::Ping(data)) => {
                let mut sender_guard = sender.lock().await;
                if sender_guard.send(WsMessage::Pong(data)).await.is_err() {
                    break;
                }
            }
            Ok(WsMessage::Pong(_)) => {
                // 收到 pong，连接正常
            }
            Ok(WsMessage::Close(_)) => {
                break;
            }
            Err(e) => {
                state.logs.write().await.add(
                    "error",
                    &format!("[WS] Connection {} error: {}", &conn_id[..8], e),
                );
                break;
            }
        }
    }

    // 清理连接
    state.ws_manager.unregister(&conn_id);
    state.logs.write().await.add(
        "info",
        &format!("[WS] Connection closed: {}", &conn_id[..8]),
    );
}

/// 处理 WebSocket 消息
async fn handle_ws_message(
    state: &AppState,
    conn_id: &str,
    msg: WsProtoMessage,
) -> Option<WsProtoMessage> {
    match msg {
        WsProtoMessage::Ping { timestamp } => Some(WsProtoMessage::Pong { timestamp }),
        WsProtoMessage::Pong { .. } => None,
        WsProtoMessage::Request(request) => {
            state.logs.write().await.add(
                "info",
                &format!(
                    "[WS] Request from {}: id={} endpoint={:?}",
                    &conn_id[..8],
                    request.request_id,
                    request.endpoint
                ),
            );

            // 处理 API 请求
            let response = handle_ws_api_request(state, &request).await;
            Some(response)
        }
        WsProtoMessage::Response(_)
        | WsProtoMessage::StreamChunk(_)
        | WsProtoMessage::StreamEnd(_) => Some(WsProtoMessage::Error(WsError::invalid_request(
            None,
            "Invalid message type from client",
        ))),
        WsProtoMessage::Error(_) => None,
    }
}

/// 处理 WebSocket API 请求
async fn handle_ws_api_request(state: &AppState, request: &WsApiRequest) -> WsProtoMessage {
    match request.endpoint {
        WsEndpoint::Models => {
            // 返回模型列表
            let models = serde_json::json!({
                "object": "list",
                "data": [
                    {"id": "claude-sonnet-4-5", "object": "model", "owned_by": "anthropic"},
                    {"id": "claude-sonnet-4-5-20250929", "object": "model", "owned_by": "anthropic"},
                    {"id": "claude-3-7-sonnet-20250219", "object": "model", "owned_by": "anthropic"},
                    {"id": "gemini-2.5-flash", "object": "model", "owned_by": "google"},
                    {"id": "gemini-2.5-pro", "object": "model", "owned_by": "google"},
                    {"id": "qwen3-coder-plus", "object": "model", "owned_by": "alibaba"},
                ]
            });
            WsProtoMessage::Response(WsApiResponse {
                request_id: request.request_id.clone(),
                payload: models,
            })
        }
        WsEndpoint::ChatCompletions => {
            // 解析 ChatCompletionRequest
            match serde_json::from_value::<ChatCompletionRequest>(request.payload.clone()) {
                Ok(chat_request) => {
                    handle_ws_chat_completions(state, &request.request_id, chat_request).await
                }
                Err(e) => WsProtoMessage::Error(WsError::invalid_request(
                    Some(request.request_id.clone()),
                    format!("Invalid chat completion request: {e}"),
                )),
            }
        }
        WsEndpoint::Messages => {
            // 解析 AnthropicMessagesRequest
            match serde_json::from_value::<AnthropicMessagesRequest>(request.payload.clone()) {
                Ok(messages_request) => {
                    handle_ws_anthropic_messages(state, &request.request_id, messages_request).await
                }
                Err(e) => WsProtoMessage::Error(WsError::invalid_request(
                    Some(request.request_id.clone()),
                    format!("Invalid messages request: {e}"),
                )),
            }
        }
    }
}

fn gateway_code_name(code: GatewayErrorCode) -> &'static str {
    match code {
        GatewayErrorCode::InvalidRequest => "INVALID_REQUEST",
        GatewayErrorCode::AuthenticationFailed => "AUTHENTICATION_FAILED",
        GatewayErrorCode::RequestConflict => "REQUEST_CONFLICT",
        GatewayErrorCode::RateLimited => "RATE_LIMITED",
        GatewayErrorCode::NoCredentials => "NO_CREDENTIALS",
        GatewayErrorCode::UpstreamTimeout => "UPSTREAM_TIMEOUT",
        GatewayErrorCode::UpstreamUnavailable => "UPSTREAM_UNAVAILABLE",
        GatewayErrorCode::UpstreamError => "UPSTREAM_ERROR",
        GatewayErrorCode::InternalError => "INTERNAL_ERROR",
    }
}

fn gateway_to_ws_error_code(code: GatewayErrorCode) -> WsErrorCode {
    match code {
        GatewayErrorCode::InvalidRequest | GatewayErrorCode::RequestConflict => {
            WsErrorCode::InvalidRequest
        }
        GatewayErrorCode::AuthenticationFailed => WsErrorCode::Unauthorized,
        GatewayErrorCode::UpstreamTimeout => WsErrorCode::Timeout,
        GatewayErrorCode::InternalError => WsErrorCode::InternalError,
        GatewayErrorCode::RateLimited
        | GatewayErrorCode::NoCredentials
        | GatewayErrorCode::UpstreamUnavailable
        | GatewayErrorCode::UpstreamError => WsErrorCode::UpstreamError,
    }
}

fn build_ws_gateway_error(
    request_id: Option<String>,
    gateway_code: GatewayErrorCode,
    message: impl Into<String>,
) -> WsProtoMessage {
    let message = message.into();
    let final_message = if message.trim().is_empty() {
        gateway_code.default_message().to_string()
    } else {
        message
    };

    WsProtoMessage::Error(WsError {
        request_id,
        code: gateway_to_ws_error_code(gateway_code),
        message: format!("[{}] {}", gateway_code_name(gateway_code), final_message),
    })
}

fn build_ws_error_from_text(
    request_id: Option<String>,
    message: impl Into<String>,
) -> WsProtoMessage {
    let message = message.into();
    let gateway_code = GatewayErrorCode::infer(500, &message);
    build_ws_gateway_error(request_id, gateway_code, message)
}

/// 处理 WebSocket chat completions 请求
async fn handle_ws_chat_completions(
    state: &AppState,
    request_id: &str,
    mut request: ChatCompletionRequest,
) -> WsProtoMessage {
    // 创建请求上下文
    let mut ctx = RequestContext::new(request.model.clone()).with_stream(request.stream);

    // 使用 RequestProcessor 解析模型别名和路由
    let _provider = state.processor.resolve_and_route(&mut ctx).await;

    // 更新请求中的模型名为解析后的模型
    if ctx.resolved_model != ctx.original_model {
        request.model = ctx.resolved_model.clone();
    }

    // 应用参数注入
    let injection_enabled = *state.injection_enabled.read().await;
    if injection_enabled {
        let injector = state.processor.injector.read().await;
        let mut payload = serde_json::to_value(&request).unwrap_or_default();
        let result = injector.inject(&request.model, &mut payload);
        if result.has_injections() {
            if let Ok(updated) = serde_json::from_value(payload) {
                request = updated;
            }
        }
    }

    // 获取默认 provider
    let default_provider = state.default_provider.read().await.clone();

    // 从 API Key Provider 主路径选择凭证。
    let credential = match &state.db {
        Some(db) => state
            .api_key_service
            .select_credential_for_provider(db, &default_provider, Some(&default_provider), None)
            .await
            .ok()
            .flatten(),
        None => None,
    };

    // 如果找到凭证，使用它调用 API
    if let Some(cred) = credential {
        // 简化实现：直接调用 provider 并返回结果
        // 实际实现应该复用 call_provider_openai 的逻辑
        match call_provider_openai_for_ws(state, &cred, &request).await {
            Ok(response) => WsProtoMessage::Response(WsApiResponse {
                request_id: request_id.to_string(),
                payload: response,
            }),
            Err(e) => build_ws_error_from_text(Some(request_id.to_string()), e),
        }
    } else {
        // 不再回退到 Kiro provider，直接返回错误
        build_ws_gateway_error(
            Some(request_id.to_string()),
            GatewayErrorCode::NoCredentials,
            format!("No available API Key Provider credentials for provider '{default_provider}'."),
        )
    }
}

/// 处理 WebSocket anthropic messages 请求
async fn handle_ws_anthropic_messages(
    state: &AppState,
    request_id: &str,
    mut request: AnthropicMessagesRequest,
) -> WsProtoMessage {
    // 创建请求上下文
    let mut ctx = RequestContext::new(request.model.clone()).with_stream(request.stream);

    // 使用 RequestProcessor 解析模型别名和路由
    let _provider = state.processor.resolve_and_route(&mut ctx).await;

    // 更新请求中的模型名为解析后的模型
    if ctx.resolved_model != ctx.original_model {
        request.model = ctx.resolved_model.clone();
    }

    // 应用参数注入
    let injection_enabled = *state.injection_enabled.read().await;
    if injection_enabled {
        let injector = state.processor.injector.read().await;
        let mut payload = serde_json::to_value(&request).unwrap_or_default();
        let result = injector.inject(&request.model, &mut payload);
        if result.has_injections() {
            if let Ok(updated) = serde_json::from_value(payload) {
                request = updated;
            }
        }
    }

    // 获取默认 provider
    let default_provider = state.default_provider.read().await.clone();

    // 从 API Key Provider 主路径选择凭证。
    let credential = match &state.db {
        Some(db) => state
            .api_key_service
            .select_credential_for_provider(db, &default_provider, Some(&default_provider), None)
            .await
            .ok()
            .flatten(),
        None => None,
    };

    // 如果找到凭证，使用它调用 API
    if let Some(cred) = credential {
        match call_provider_anthropic_for_ws(state, &cred, &request).await {
            Ok(response) => WsProtoMessage::Response(WsApiResponse {
                request_id: request_id.to_string(),
                payload: response,
            }),
            Err(e) => build_ws_error_from_text(Some(request_id.to_string()), e),
        }
    } else {
        // 不再回退到 Kiro provider，直接返回错误
        build_ws_gateway_error(
            Some(request_id.to_string()),
            GatewayErrorCode::NoCredentials,
            format!("No available API Key Provider credentials for provider '{default_provider}'."),
        )
    }
}

/// WebSocket 专用的 OpenAI 格式 Provider 调用
pub async fn call_provider_openai_for_ws(
    state: &AppState,
    credential: &RuntimeProviderCredential,
    request: &ChatCompletionRequest,
) -> Result<serde_json::Value, String> {
    match &credential.credential {
        RuntimeCredentialData::OpenAIKey { api_key, base_url } => {
            let provider = OpenAICustomProvider::with_config(api_key.clone(), base_url.clone());
            let resp = match provider.call_api(request).await {
                Ok(r) => r,
                Err(e) => {
                    if let Some(db) = &state.db {
                        let _ = state.mark_credential_unhealthy(
                            db,
                            &credential.uuid,
                            Some(&e.to_string()),
                        );
                    }
                    return Err(e.to_string());
                }
            };
            if resp.status().is_success() {
                // 记录成功
                if let Some(db) = &state.db {
                    let _ =
                        state.mark_credential_healthy(db, &credential.uuid, Some(&request.model));
                    let _ = state.record_credential_usage(db, &credential.uuid);
                }
                resp.json::<serde_json::Value>()
                    .await
                    .map_err(|e| e.to_string())
            } else {
                let body = resp.text().await.unwrap_or_default();
                if let Some(db) = &state.db {
                    let _ = state.mark_credential_unhealthy(db, &credential.uuid, Some(&body));
                }
                Err(format!("Upstream error: {body}"))
            }
        }
        RuntimeCredentialData::ClaudeKey { api_key, base_url } => {
            // 打印 Claude 代理 URL 用于调试
            let actual_base_url = base_url.as_deref().unwrap_or("https://api.anthropic.com");
            tracing::info!(
                "[CLAUDE] 使用 Claude API 代理: base_url={} credential_uuid={}",
                actual_base_url,
                &credential.uuid[..8]
            );
            let prompt_cache_mode = if matches!(
                credential.effective_prompt_cache_mode(),
                Some(lime_core::models::ProviderPromptCacheMode::Automatic)
            ) {
                PromptCacheMode::Automatic
            } else {
                PromptCacheMode::ExplicitOnly
            };
            let provider = ClaudeCustomProvider::with_provider_type_and_prompt_cache_mode(
                api_key.clone(),
                base_url.clone(),
                ApiProviderType::AnthropicCompatible,
                prompt_cache_mode,
            );
            match provider.call_openai_api(request).await {
                Ok(result) => {
                    // 记录成功
                    if let Some(db) = &state.db {
                        let _ = state.mark_credential_healthy(
                            db,
                            &credential.uuid,
                            Some(&request.model),
                        );
                        let _ = state.record_credential_usage(db, &credential.uuid);
                    }
                    Ok(result)
                }
                Err(e) => {
                    if let Some(db) = &state.db {
                        let _ = state.mark_credential_unhealthy(
                            db,
                            &credential.uuid,
                            Some(&e.to_string()),
                        );
                    }
                    Err(e.to_string())
                }
            }
        }
        _ => Err(
            "This credential type is not supported via WebSocket. Please use API Key Provider credentials."
                .to_string(),
        ),
    }
}

/// WebSocket 专用的 Anthropic 格式 Provider 调用
pub async fn call_provider_anthropic_for_ws(
    state: &AppState,
    credential: &RuntimeProviderCredential,
    request: &AnthropicMessagesRequest,
) -> Result<serde_json::Value, String> {
    match &credential.credential {
        RuntimeCredentialData::ClaudeKey { api_key, base_url } => {
            // 打印 Claude 代理 URL 用于调试
            let actual_base_url = base_url.as_deref().unwrap_or("https://api.anthropic.com");
            tracing::info!(
                "[CLAUDE] 使用 Claude API 代理: base_url={} credential_uuid={}",
                actual_base_url,
                &credential.uuid[..8]
            );
            let prompt_cache_mode = if matches!(
                credential.effective_prompt_cache_mode(),
                Some(lime_core::models::ProviderPromptCacheMode::Automatic)
            ) {
                PromptCacheMode::Automatic
            } else {
                PromptCacheMode::ExplicitOnly
            };
            let provider = ClaudeCustomProvider::with_provider_type_and_prompt_cache_mode(
                api_key.clone(),
                base_url.clone(),
                ApiProviderType::AnthropicCompatible,
                prompt_cache_mode,
            );
            let resp = match provider.call_api(request).await {
                Ok(r) => r,
                Err(e) => {
                    if let Some(db) = &state.db {
                        let _ = state.mark_credential_unhealthy(
                            db,
                            &credential.uuid,
                            Some(&e.to_string()),
                        );
                    }
                    return Err(e.to_string());
                }
            };
            if resp.status().is_success() {
                // 记录成功
                if let Some(db) = &state.db {
                    let _ =
                        state.mark_credential_healthy(db, &credential.uuid, Some(&request.model));
                    let _ = state.record_credential_usage(db, &credential.uuid);
                }
                resp.json::<serde_json::Value>()
                    .await
                    .map_err(|e| e.to_string())
            } else {
                let body = resp.text().await.unwrap_or_default();
                if let Some(db) = &state.db {
                    let _ = state.mark_credential_unhealthy(db, &credential.uuid, Some(&body));
                }
                Err(format!("Upstream error: {body}"))
            }
        }
        _ => {
            // 转换为 OpenAI 格式并调用（健康状态更新在 call_provider_openai_for_ws 中处理）
            let openai_request = convert_anthropic_to_openai(request);
            let result = call_provider_openai_for_ws(state, credential, &openai_request).await?;
            let (input_tokens, output_tokens) = extract_openai_usage_pair(&result);

            // 转换响应为 Anthropic 格式
            Ok(serde_json::json!({
                "id": format!("msg_{}", uuid::Uuid::new_v4()),
                "type": "message",
                "role": "assistant",
                "content": [{
                    "type": "text",
                    "text": result.get("choices")
                        .and_then(|c| c.get(0))
                        .and_then(|c| c.get("message"))
                        .and_then(|m| m.get("content"))
                        .and_then(|c| c.as_str())
                        .unwrap_or("")
                }],
                "model": request.model,
                "stop_reason": "end_turn",
                "usage": {
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens
                }
            }))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_openai_usage_pair_should_read_prompt_and_completion_tokens() {
        let response = serde_json::json!({
            "usage": {
                "prompt_tokens": 420,
                "completion_tokens": 69,
                "total_tokens": 489
            }
        });

        assert_eq!(extract_openai_usage_pair(&response), (420, 69));
    }

    #[test]
    fn extract_openai_usage_pair_should_default_to_zero_without_usage() {
        let response = serde_json::json!({
            "id": "chatcmpl-test"
        });

        assert_eq!(extract_openai_usage_pair(&response), (0, 0));
    }
}
