//! Provider 调用处理器
//!
//! 根据凭证类型调用不同的 Provider API
//!
//! # 流式传输支持

#![allow(dead_code)]
//!
//! 本模块支持真正的端到端流式传输，通过以下组件实现：
//! - `StreamManager`: 管理流式请求的生命周期
//! - `StreamingProvider`: Provider 的流式 API 接口
//! - `FlowMonitor`: 实时捕获流式响应
//!
//! # 错误处理
//!
//! 流式传输期间的错误处理：
//! - 网络错误：记录日志，发送 SSE 错误事件，调用 FlowMonitor.fail_flow()
//! - 解析错误：记录警告，跳过无效数据，继续处理后续 chunks
//! - 上游错误：将 Provider 返回的错误转发给客户端
//!
//! # 需求覆盖
//!
//! - 需求 1.1: 使用 reqwest 的流式响应模式
//! - 需求 1.2: 实时解析每个 JSON payload 并转换为 Anthropic SSE 事件
//! - 需求 1.3: 立即发送 content_block_delta 事件给客户端
//! - 需求 3.1: Flow Monitor 记录 chunk_count 大于 0
//! - 需求 3.2: 调用 process_chunk 更新流重建器
//! - 需求 4.2: 调用 process_chunk 更新流重建器
//! - 需求 5.1: 流式传输期间发生网络错误时，发出错误事件并以失败状态完成 flow
//! - 需求 5.2: AWS Event Stream 解析失败时记录错误并继续处理后续 chunks
//! - 需求 5.3: 将上游 Provider 返回的错误转发给客户端
//! - 需求 6.1: 流式请求直接走 current API Key Provider 主链
//! - 需求 6.2: 非流式请求返回完整 JSON 响应

use axum::{
    body::Body,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use futures::StreamExt;

use crate::AppState;
use lime_core::database::dao::api_key_provider::ApiProviderType;
use lime_core::models::anthropic::AnthropicMessagesRequest;
use lime_core::models::openai::ChatCompletionRequest;
use lime_core::models::{RuntimeCredentialData, RuntimeProviderCredential};
use lime_providers::converter::anthropic_to_openai::convert_anthropic_to_openai;
use lime_providers::providers::{
    ClaudeCustomProvider, OpenAICustomProvider, PromptCacheMode, VertexProvider,
};
use lime_providers::session::store_thought_signature;
use lime_providers::streaming::traits::StreamingProvider;
use lime_providers::streaming::{
    StreamConfig, StreamContext, StreamError, StreamFormat as StreamingFormat, StreamManager,
    StreamResponse,
};
use lime_server_utils::{
    build_anthropic_response, build_anthropic_stream_response, CWParsedResponse,
};

/// 根据凭证调用 Provider (Anthropic 格式)
///
/// # 参数
/// - `state`: 应用状态
/// - `credential`: 凭证信息
/// - `request`: Anthropic 格式请求
/// - `flow_id`: Flow ID（可选，用于流式响应处理）
pub async fn call_provider_anthropic(
    state: &AppState,
    credential: &RuntimeProviderCredential,
    request: &AnthropicMessagesRequest,
    _flow_id: Option<&str>,
) -> Response {
    match &credential.credential {
        RuntimeCredentialData::OpenAIKey { api_key, base_url } => {
            let openai = OpenAICustomProvider::with_config(api_key.clone(), base_url.clone());
            let openai_request = convert_anthropic_to_openai(request);
            match openai.call_api(&openai_request).await {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        match resp.text().await {
                            Ok(body) => {
                                // 记录原始响应以便调试
                                eprintln!("[PROVIDER_CALL] OpenAI 响应: {}", &body[..body.len().min(500)]);

                                if let Ok(openai_resp) =
                                    serde_json::from_str::<serde_json::Value>(&body)
                                {
                                    let content = openai_resp["choices"][0]["message"]["content"]
                                        .as_str()
                                        .unwrap_or("");
                                    let parsed = CWParsedResponse {
                                        content: content.to_string(),
                                        tool_calls: Vec::new(),
                                        usage_credits: 0.0,
                                        context_usage_percentage: 0.0,
                                    };
                                    // 记录成功
                                    if let Some(db) = &state.db {
                                        let _ = state.mark_credential_healthy(
                                            db,
                                            &credential.uuid,
                                            Some(&request.model),
                                        );
                                        let _ =
                                            state.record_credential_usage(db, &credential.uuid);
                                    }
                                    if request.stream {
                                        build_anthropic_stream_response(&request.model, &parsed)
                                    } else {
                                        build_anthropic_response(&request.model, &parsed)
                                    }
                                } else {
                                    // 记录解析失败和原始响应
                                    eprintln!("[PROVIDER_CALL] 解析 OpenAI 响应失败，原始响应: {}", &body);
                                    if let Some(db) = &state.db {
                                        let _ = state.mark_credential_unhealthy(
                                            db,
                                            &credential.uuid,
                                            Some("Failed to parse OpenAI response"),
                                        );
                                    }
                                    (
                                        StatusCode::INTERNAL_SERVER_ERROR,
                                        Json(serde_json::json!({"error": {"message": format!("Failed to parse OpenAI response. Body: {}", &body[..body.len().min(200)])}})),
                                    )
                                        .into_response()
                                }
                            }
                            Err(e) => {
                                if let Some(db) = &state.db {
                                    let _ = state.mark_credential_unhealthy(
                                        db,
                                        &credential.uuid,
                                        Some(&e.to_string()),
                                    );
                                }
                                (
                                    StatusCode::INTERNAL_SERVER_ERROR,
                                    Json(serde_json::json!({"error": {"message": e.to_string()}})),
                                )
                                    .into_response()
                            }
                        }
                    } else {
                        let status_code = status.as_u16();
                        let body = resp.text().await.unwrap_or_default();
                        eprintln!("[PROVIDER_CALL] OpenAI 请求失败: status={} body={}", status_code, &body[..body.len().min(500)]);
                        // 只有 5xx 错误才标记为不健康，4xx 错误（如模型不支持）不应该标记凭证为不健康
                        if status_code >= 500 {
                            if let Some(db) = &state.db {
                                let _ = state.mark_credential_unhealthy(
                                    db,
                                    &credential.uuid,
                                    Some(&body),
                                );
                            }
                        }
                        // 转发上游的实际状态码
                        (
                            StatusCode::from_u16(status_code).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
                            Json(serde_json::json!({"error": {"message": body}})),
                        )
                            .into_response()
                    }
                }
                Err(e) => {
                    if let Some(db) = &state.db {
                        let _ = state.mark_credential_unhealthy(
                            db,
                            &credential.uuid,
                            Some(&e.to_string()),
                        );
                    }
                    (
                        StatusCode::BAD_GATEWAY,
                        Json(serde_json::json!({"error": {"message": e.to_string()}})),
                    )
                        .into_response()
                }
            }
        }
        RuntimeCredentialData::ClaudeKey { api_key, base_url } => {
            // 打印 Claude 代理 URL 用于调试
            let actual_base_url = base_url.as_deref().unwrap_or("https://api.anthropic.com");
            let prompt_cache_mode = if matches!(
                credential.effective_prompt_cache_mode(),
                Some(lime_core::models::ProviderPromptCacheMode::Automatic)
            ) {
                PromptCacheMode::Automatic
            } else {
                PromptCacheMode::ExplicitOnly
            };
            let claude = ClaudeCustomProvider::with_provider_type_and_prompt_cache_mode(
                api_key.clone(),
                base_url.clone(),
                ApiProviderType::AnthropicCompatible,
                prompt_cache_mode,
            );
            let request_url = claude.get_base_url();
            state.logs.write().await.add(
                "info",
                &format!(
                    "[CLAUDE] 使用 Claude API 代理: base_url={} -> {}/v1/messages credential_uuid={} stream={}",
                    actual_base_url,
                    request_url,
                    &credential.uuid[..8],
                    request.stream
                ),
            );
            // 打印请求参数
            let request_json = serde_json::to_string(request).unwrap_or_default();
            state.logs.write().await.add(
                "debug",
                &format!(
                    "[CLAUDE] 请求参数: {}",
                    &request_json.chars().take(500).collect::<String>()
                ),
            );
            match claude.call_api(request).await {
                Ok(resp) => {
                    let status = resp.status();
                    // 打印响应状态
                    state.logs.write().await.add(
                        "info",
                        &format!(
                            "[CLAUDE] 响应状态: status={} model={} stream={}",
                            status,
                            request.model,
                            request.stream
                        ),
                    );

                    // 如果是流式请求，直接透传流式响应
                    if request.stream && status.is_success() {
                        state.logs.write().await.add(
                            "info",
                            "[CLAUDE] 流式请求，透传 SSE 响应",
                        );
                        // 记录成功
                        if let Some(db) = &state.db {
                            let _ = state.mark_credential_healthy(
                                db,
                                &credential.uuid,
                                Some(&request.model),
                            );
                            let _ = state.record_credential_usage(db, &credential.uuid);
                        }
                        // 透传流式响应，保持 SSE 格式
                        let stream = resp.bytes_stream();
                        return Response::builder()
                            .status(StatusCode::OK)
                            .header(header::CONTENT_TYPE, "text/event-stream")
                            .header(header::CACHE_CONTROL, "no-cache, no-store, must-revalidate")
                            .header("Connection", "keep-alive")
                            .header("X-Accel-Buffering", "no") // 禁用 nginx 等代理的缓冲
                            .header("Transfer-Encoding", "chunked")
                            .body(Body::from_stream(stream))
                            .unwrap_or_else(|_| {
                                (
                                    StatusCode::INTERNAL_SERVER_ERROR,
                                    Json(serde_json::json!({"error": {"message": "Failed to build stream response"}})),
                                )
                                    .into_response()
                            });
                    }

                    // 非流式请求，读取完整响应
                    match resp.text().await {
                        Ok(body) => {
                            if status.is_success() {
                                // 打印响应内容预览
                                state.logs.write().await.add(
                                    "debug",
                                    &format!(
                                        "[CLAUDE] 响应内容: {}",
                                        &body.chars().take(500).collect::<String>()
                                    ),
                                );
                                // 记录成功
                                if let Some(db) = &state.db {
                                    let _ = state.mark_credential_healthy(
                                        db,
                                        &credential.uuid,
                                        Some(&request.model),
                                    );
                                    let _ = state.record_credential_usage(db, &credential.uuid);
                                }
                                Response::builder()
                                    .status(StatusCode::OK)
                                    .header(header::CONTENT_TYPE, "application/json")
                                    .body(Body::from(body))
                                    .unwrap_or_else(|_| {
                                        (
                                            StatusCode::INTERNAL_SERVER_ERROR,
                                            Json(serde_json::json!({"error": {"message": "Failed to build response"}})),
                                        )
                                            .into_response()
                                    })
                            } else {
                                state.logs.write().await.add(
                                    "error",
                                    &format!(
                                        "[CLAUDE] 请求失败: status={} body={}",
                                        status,
                                        &body.chars().take(200).collect::<String>()
                                    ),
                                );
                                if let Some(db) = &state.db {
                                    let _ = state.mark_credential_unhealthy(
                                        db,
                                        &credential.uuid,
                                        Some(&body),
                                    );
                                }
                                (
                                    StatusCode::from_u16(status.as_u16())
                                        .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
                                    Json(serde_json::json!({"error": {"message": body}})),
                                )
                                    .into_response()
                            }
                        }
                        Err(e) => {
                            state.logs.write().await.add(
                                "error",
                                &format!("[CLAUDE] 读取响应失败: {e}"),
                            );
                            if let Some(db) = &state.db {
                                let _ = state.mark_credential_unhealthy(
                                    db,
                                    &credential.uuid,
                                    Some(&e.to_string()),
                                );
                            }
                            (
                                StatusCode::INTERNAL_SERVER_ERROR,
                                Json(serde_json::json!({"error": {"message": e.to_string()}})),
                            )
                                .into_response()
                        }
                    }
                }
                Err(e) => {
                    if let Some(db) = &state.db {
                        let _ = state.mark_credential_unhealthy(
                            db,
                            &credential.uuid,
                            Some(&e.to_string()),
                        );
                    }
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(serde_json::json!({"error": {"message": e.to_string()}})),
                    )
                        .into_response()
                }
            }
        }
        RuntimeCredentialData::VertexKey { api_key, base_url, .. } => {
            // Vertex AI uses Gemini-compatible API, convert Anthropic to OpenAI format first
            let openai_request = convert_anthropic_to_openai(request);
            let vertex = VertexProvider::with_config(api_key.clone(), base_url.clone());
            match vertex.chat_completions(&serde_json::to_value(&openai_request).unwrap_or_default()).await {
                Ok(resp) => {
                    let status = resp.status();
                    match resp.text().await {
                        Ok(body) => {
                            if status.is_success() {
                                if let Some(db) = &state.db {
                                    let _ = state.mark_credential_healthy(db, &credential.uuid, Some(&request.model));
                                    let _ = state.record_credential_usage(db, &credential.uuid);
                                }
                                Response::builder()
                                    .status(StatusCode::OK)
                                    .header(header::CONTENT_TYPE, "application/json")
                                    .body(Body::from(body))
                                    .unwrap_or_else(|_| {
                                        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": {"message": "Failed to build response"}}))).into_response()
                                    })
                            } else {
                                if let Some(db) = &state.db {
                                    let _ = state.mark_credential_unhealthy(db, &credential.uuid, Some(&body));
                                }
                                (StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR), Json(serde_json::json!({"error": {"message": body}}))).into_response()
                            }
                        }
                        Err(e) => {
                            if let Some(db) = &state.db {
                                let _ = state.mark_credential_unhealthy(db, &credential.uuid, Some(&e.to_string()));
                            }
                            (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": {"message": e.to_string()}}))).into_response()
                        }
                    }
                }
                Err(e) => {
                    if let Some(db) = &state.db {
                        let _ = state.mark_credential_unhealthy(db, &credential.uuid, Some(&e.to_string()));
                    }
                    (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": {"message": e.to_string()}}))).into_response()
                }
            }
        }
        // Gemini API Key credentials - not supported for Anthropic format
        RuntimeCredentialData::GeminiApiKey { .. } => {
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": {"message": "Gemini API Key credentials do not support Anthropic format"}})),
            )
                .into_response()
        }
        // Anthropic API Key - 根据 base_url 决定调用方式
        RuntimeCredentialData::AnthropicKey { api_key, base_url } => {
            // 使用 Anthropic 原生格式调用（无论是否有自定义 base_url）
            let claude = ClaudeCustomProvider::with_provider_type_and_prompt_cache_mode(
                api_key.clone(),
                base_url.clone(),
                ApiProviderType::Anthropic,
                PromptCacheMode::Automatic,
            );
            let request_url = claude.get_base_url();
            state.logs.write().await.add(
                "info",
                &format!(
                    "[ANTHROPIC] 使用 Anthropic API: base_url={} credential_uuid={} stream={}",
                    request_url,
                    &credential.uuid[..8],
                    request.stream
                ),
            );
            match claude.call_api(request).await {
                Ok(resp) => {
                    let status = resp.status();
                    state.logs.write().await.add(
                        "info",
                        &format!(
                            "[ANTHROPIC] 响应状态: status={} model={} stream={}",
                            status,
                            request.model,
                            request.stream
                        ),
                    );

                    // 如果是流式请求，直接透传流式响应
                    if request.stream && status.is_success() {
                        state.logs.write().await.add(
                            "info",
                            "[ANTHROPIC] 流式请求，透传 SSE 响应",
                        );
                        if let Some(db) = &state.db {
                            let _ = state.mark_credential_healthy(
                                db,
                                &credential.uuid,
                                Some(&request.model),
                            );
                            let _ = state.record_credential_usage(db, &credential.uuid);
                        }
                        let stream = resp.bytes_stream();
                        return Response::builder()
                            .status(StatusCode::OK)
                            .header(header::CONTENT_TYPE, "text/event-stream")
                            .header(header::CACHE_CONTROL, "no-cache, no-store, must-revalidate")
                            .header("Connection", "keep-alive")
                            .header("X-Accel-Buffering", "no") // 禁用 nginx 等代理的缓冲
                            .header("Transfer-Encoding", "chunked")
                            .body(Body::from_stream(stream))
                            .unwrap_or_else(|_| {
                                (
                                    StatusCode::INTERNAL_SERVER_ERROR,
                                    Json(serde_json::json!({"error": {"message": "Failed to build stream response"}})),
                                )
                                    .into_response()
                            });
                    }

                    // 非流式请求，读取完整响应
                    match resp.text().await {
                        Ok(body) => {
                            if status.is_success() {
                                if let Some(db) = &state.db {
                                    let _ = state.mark_credential_healthy(
                                        db,
                                        &credential.uuid,
                                        Some(&request.model),
                                    );
                                    let _ = state.record_credential_usage(db, &credential.uuid);
                                }
                                Response::builder()
                                    .status(StatusCode::OK)
                                    .header(header::CONTENT_TYPE, "application/json")
                                    .body(Body::from(body))
                                    .unwrap_or_else(|_| {
                                        (
                                            StatusCode::INTERNAL_SERVER_ERROR,
                                            Json(serde_json::json!({"error": {"message": "Failed to build response"}})),
                                        )
                                            .into_response()
                                    })
                            } else {
                                state.logs.write().await.add(
                                    "error",
                                    &format!(
                                        "[ANTHROPIC] 请求失败: status={} body={}",
                                        status,
                                        &body[..body.len().min(500)]
                                    ),
                                );
                                if let Some(db) = &state.db {
                                    let _ = state.mark_credential_unhealthy(
                                        db,
                                        &credential.uuid,
                                        Some(&format!("API error: {status}")),
                                    );
                                }
                                (
                                    StatusCode::from_u16(status.as_u16())
                                        .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
                                    Json(serde_json::json!({"error": {"message": body}})),
                                )
                                    .into_response()
                            }
                        }
                        Err(e) => (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(serde_json::json!({"error": {"message": format!("Failed to read response: {}", e)}})),
                        )
                            .into_response(),
                    }
                }
                Err(e) => {
                    if let Some(db) = &state.db {
                        let _ = state.mark_credential_unhealthy(
                            db,
                            &credential.uuid,
                            Some(&format!("API call failed: {e}")),
                        );
                    }
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(serde_json::json!({"error": {"message": format!("Anthropic API call failed: {}", e)}})),
                    )
                        .into_response()
                }
            }
        }
    }
}

/// 根据凭证调用 Provider (OpenAI 格式)
///
/// # 参数
/// - `state`: 应用状态
/// - `credential`: 凭证信息
/// - `request`: OpenAI 格式请求
/// - `flow_id`: Flow ID（可选，用于流式响应处理）
pub async fn call_provider_openai(
    state: &AppState,
    credential: &RuntimeProviderCredential,
    request: &ChatCompletionRequest,
    _flow_id: Option<&str>,
) -> Response {
    let _start_time = std::time::Instant::now();

    // 调试：打印凭证类型
    let cred_type = match &credential.credential {
        RuntimeCredentialData::ClaudeKey { .. } => "ClaudeKey",
        RuntimeCredentialData::OpenAIKey { .. } => "OpenAIKey",
        RuntimeCredentialData::GeminiApiKey { .. } => "GeminiApiKey",
        RuntimeCredentialData::VertexKey { .. } => "VertexKey",
        RuntimeCredentialData::AnthropicKey { .. } => "AnthropicKey",
    };
    tracing::info!(
        "[CALL_PROVIDER_OPENAI] 凭证类型={}, 凭证名称={:?}, provider_type={}, uuid={}",
        cred_type,
        credential.name,
        credential.provider_type,
        &credential.uuid[..8]
    );

    match &credential.credential {
        RuntimeCredentialData::OpenAIKey { api_key, base_url } => {
            let openai = OpenAICustomProvider::with_config(api_key.clone(), base_url.clone());

            tracing::info!("[OPENAI_KEY] request.stream = {}, model = {}", request.stream, request.model);

            // 检查是否为流式请求
            if request.stream {
                tracing::info!("[OPENAI_KEY_STREAM] 处理流式请求, model={}", request.model);
                match openai.call_api_stream(request).await {
                    Ok(stream_response) => {
                        tracing::info!("[OPENAI_KEY_STREAM] 开始直接转发 OpenAI SSE 流");

                        // OpenAI 提供商已经返回 OpenAI SSE 格式，直接转发
                        let body_stream = stream_response.map(|result| -> Result<axum::body::Bytes, std::io::Error> {
                            match result {
                                Ok(bytes) => Ok(bytes),
                                Err(e) => Ok(axum::body::Bytes::from(e.to_sse_error())),
                            }
                        });

                        return Response::builder()
                            .status(StatusCode::OK)
                            .header(header::CONTENT_TYPE, "text/event-stream")
                            .header(header::CACHE_CONTROL, "no-cache")
                            .header(header::CONNECTION, "keep-alive")
                            .header(header::TRANSFER_ENCODING, "chunked")
                            .header("X-Accel-Buffering", "no")
                            .body(Body::from_stream(body_stream))
                            .unwrap_or_else(|_| {
                                (
                                    StatusCode::INTERNAL_SERVER_ERROR,
                                    Json(
                                        serde_json::json!({"error": {"message": "Failed to build streaming response"}}),
                                    ),
                                )
                                    .into_response()
                            });
                    }
                    Err(e) => {
                        return (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(serde_json::json!({"error": {"message": e.to_string()}})),
                        )
                            .into_response();
                    }
                }
            }

            // 非流式请求处理
            match openai.call_api(request).await {
                Ok(resp) => {
                    if resp.status().is_success() {
                        match resp.text().await {
                            Ok(body) => {
                                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
                                    Json(json).into_response()
                                } else {
                                    (
                                        StatusCode::INTERNAL_SERVER_ERROR,
                                        Json(serde_json::json!({"error": {"message": "Invalid JSON response"}})),
                                    )
                                        .into_response()
                                }
                            }
                            Err(e) => (
                                StatusCode::INTERNAL_SERVER_ERROR,
                                Json(serde_json::json!({"error": {"message": e.to_string()}})),
                            )
                                .into_response(),
                        }
                    } else {
                        let body = resp.text().await.unwrap_or_default();
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(serde_json::json!({"error": {"message": body}})),
                        )
                            .into_response()
                    }
                }
                Err(e) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": {"message": e.to_string()}})),
                )
                    .into_response(),
            }
        }
        RuntimeCredentialData::ClaudeKey { api_key, base_url } => {
            // 打印 Claude 代理 URL 用于调试
            let actual_base_url = base_url.as_deref().unwrap_or("https://api.anthropic.com");
            tracing::info!(
                "[CLAUDE] 使用 Claude API 代理: base_url={} credential_uuid={} stream={}",
                actual_base_url,
                &credential.uuid[..8],
                request.stream
            );
            let prompt_cache_mode = if matches!(
                credential.effective_prompt_cache_mode(),
                Some(lime_core::models::ProviderPromptCacheMode::Automatic)
            ) {
                PromptCacheMode::Automatic
            } else {
                PromptCacheMode::ExplicitOnly
            };
            let claude = ClaudeCustomProvider::with_provider_type_and_prompt_cache_mode(
                api_key.clone(),
                base_url.clone(),
                ApiProviderType::AnthropicCompatible,
                prompt_cache_mode,
            );

            // 检查是否为流式请求
            if request.stream {
                tracing::info!("[CLAUDE_KEY_STREAM] 处理流式请求, model={}", request.model);

                match claude.call_api_stream(request).await {
                    Ok(stream_response) => {
                        tracing::info!("[CLAUDE_KEY_STREAM] 开始转换 Anthropic SSE 到 OpenAI SSE");

                        // 创建 StreamConverter 将 Anthropic SSE 转换为 OpenAI SSE
                        let converter = std::sync::Arc::new(tokio::sync::Mutex::new(
                            lime_providers::streaming::converter::StreamConverter::with_model(
                                lime_providers::streaming::converter::StreamFormat::AnthropicSse,
                                lime_providers::streaming::converter::StreamFormat::OpenAiSse,
                                &request.model,
                            ),
                        ));

                        let converter_for_stream = converter.clone();
                        let final_stream = async_stream::stream! {
                            use futures::StreamExt;

                            let mut stream_response = stream_response;

                            while let Some(chunk_result) = stream_response.next().await {
                                match chunk_result {
                                    Ok(bytes) => {
                                        // 转换 Anthropic SSE 到 OpenAI SSE
                                        let sse_events = {
                                            let mut converter_guard = converter_for_stream.lock().await;
                                            converter_guard.convert(&bytes)
                                        };

                                        for sse_str in sse_events {
                                            yield Ok::<String, lime_providers::streaming::StreamError>(sse_str);
                                        }
                                    }
                                    Err(e) => {
                                        tracing::error!("[CLAUDE_KEY_STREAM] 流式传输错误: {}", e);
                                        yield Err(e);
                                        return;
                                    }
                                }
                            }

                            // 流结束，生成结束事件
                            let final_events = {
                                let mut converter_guard = converter_for_stream.lock().await;
                                converter_guard.finish()
                            };

                            for sse_str in final_events {
                                yield Ok::<String, lime_providers::streaming::StreamError>(sse_str);
                            }
                        };

                        let body_stream = final_stream.map(|result| -> Result<axum::body::Bytes, std::io::Error> {
                            match result {
                                Ok(event) => Ok(axum::body::Bytes::from(event)),
                                Err(e) => Ok(axum::body::Bytes::from(e.to_sse_error())),
                            }
                        });

                        return Response::builder()
                            .status(StatusCode::OK)
                            .header(header::CONTENT_TYPE, "text/event-stream")
                            .header(header::CACHE_CONTROL, "no-cache")
                            .header(header::CONNECTION, "keep-alive")
                            .header(header::TRANSFER_ENCODING, "chunked")
                            .header("X-Accel-Buffering", "no")
                            .body(Body::from_stream(body_stream))
                            .unwrap_or_else(|_| {
                                (
                                    StatusCode::INTERNAL_SERVER_ERROR,
                                    Json(
                                        serde_json::json!({"error": {"message": "Failed to build streaming response"}}),
                                    ),
                                )
                                    .into_response()
                            });
                    }
                    Err(e) => {
                        return (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(serde_json::json!({"error": {"message": e.to_string()}})),
                        )
                            .into_response();
                    }
                }
            }

            // 非流式请求处理
            match claude.call_openai_api(request).await {
                Ok(resp) => Json(resp).into_response(),
                Err(e) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": {"message": e.to_string()}})),
                )
                    .into_response(),
            }
        }
        RuntimeCredentialData::VertexKey { api_key, base_url, model_aliases } => {
            // Resolve model alias if present
            let resolved_model = model_aliases.get(&request.model).cloned().unwrap_or_else(|| request.model.clone());
            let mut modified_request = request.clone();
            modified_request.model = resolved_model;
            let vertex = VertexProvider::with_config(api_key.clone(), base_url.clone());
            match vertex.chat_completions(&serde_json::to_value(&modified_request).unwrap_or_default()).await {
                Ok(resp) => {
                    if resp.status().is_success() {
                        match resp.text().await {
                            Ok(body) => {
                                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
                                    Json(json).into_response()
                                } else {
                                    (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": {"message": "Invalid JSON response"}}))).into_response()
                                }
                            }
                            Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": {"message": e.to_string()}}))).into_response(),
                        }
                    } else {
                        let body = resp.text().await.unwrap_or_default();
                        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": {"message": body}}))).into_response()
                    }
                }
                Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": {"message": e.to_string()}}))).into_response(),
            }
        }
        // Gemini API Key credentials - not supported for OpenAI format yet
        RuntimeCredentialData::GeminiApiKey { .. } => {
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": {"message": "Gemini API Key credentials do not support OpenAI format yet"}})),
            )
                .into_response()
        }
        // AnthropicKey - 如果有自定义 base_url，使用 OpenAI 兼容格式调用
        RuntimeCredentialData::AnthropicKey { api_key, base_url } => {
            // 如果有自定义 base_url，假设是 OpenAI 兼容的代理服务器
            if let Some(custom_url) = base_url {
                let openai = OpenAICustomProvider::with_config(api_key.clone(), Some(custom_url.clone()));
                state.logs.write().await.add(
                    "info",
                    &format!(
                        "[OPENAI_COMPAT] 使用 OpenAI 兼容 API: base_url={} credential_uuid={} stream={}",
                        custom_url,
                        &credential.uuid[..8],
                        request.stream
                        ),
                );

                if request.stream {
                    state.logs.write().await.add(
                        "info",
                        "[OPENAI_COMPAT] 流式请求，走 OpenAICustomProvider.call_api_stream",
                    );

                    match openai.call_api_stream(request).await {
                        Ok(stream_response) => {
                            if let Some(db) = &state.db {
                                let _ = state.mark_credential_healthy(
                                    db,
                                    &credential.uuid,
                                    Some(&request.model),
                                );
                                let _ = state.record_credential_usage(db, &credential.uuid);
                            }

                            let body_stream =
                                stream_response.map(|result| -> Result<axum::body::Bytes, std::io::Error> {
                                    match result {
                                        Ok(bytes) => Ok(bytes),
                                        Err(e) => Ok(axum::body::Bytes::from(e.to_sse_error())),
                                    }
                                });

                            return Response::builder()
                                .status(StatusCode::OK)
                                .header(header::CONTENT_TYPE, "text/event-stream")
                                .header(header::CACHE_CONTROL, "no-cache, no-store, must-revalidate")
                                .header("Connection", "keep-alive")
                                .header("X-Accel-Buffering", "no")
                                .header("Transfer-Encoding", "chunked")
                                .body(Body::from_stream(body_stream))
                                .unwrap_or_else(|_| {
                                    (
                                        StatusCode::INTERNAL_SERVER_ERROR,
                                        Json(serde_json::json!({"error": {"message": "Failed to build stream response"}})),
                                    )
                                        .into_response()
                                });
                        }
                        Err(e) => {
                            if let Some(db) = &state.db {
                                let _ = state.mark_credential_unhealthy(
                                    db,
                                    &credential.uuid,
                                    Some(&format!("Streaming API call failed: {e}")),
                                );
                            }
                            return (
                                StatusCode::INTERNAL_SERVER_ERROR,
                                Json(serde_json::json!({"error": {"message": format!("OpenAI compatible streaming API call failed: {}", e)}})),
                            )
                                .into_response();
                        }
                    }
                }

                match openai.call_api(request).await {
                    Ok(resp) => {
                        let status = resp.status();
                        state.logs.write().await.add(
                            "info",
                            &format!(
                                "[OPENAI_COMPAT] 响应状态: status={} model={} stream={}",
                                status,
                                request.model,
                                request.stream
                            ),
                        );

                        // 非流式响应
                        if status.is_success() {
                            if let Some(db) = &state.db {
                                let _ = state.mark_credential_healthy(
                                    db,
                                    &credential.uuid,
                                    Some(&request.model),
                                );
                                let _ = state.record_credential_usage(db, &credential.uuid);
                            }
                        } else if let Some(db) = &state.db {
                            let _ = state.mark_credential_unhealthy(
                                db,
                                &credential.uuid,
                                Some(&format!("API error: {status}")),
                            );
                        }

                        match resp.bytes().await {
                            Ok(body) => Response::builder()
                                .status(status)
                                .header(header::CONTENT_TYPE, "application/json")
                                .body(Body::from(body))
                                .unwrap_or_else(|_| {
                                    (
                                        StatusCode::INTERNAL_SERVER_ERROR,
                                        Json(serde_json::json!({"error": {"message": "Failed to build response"}})),
                                    )
                                        .into_response()
                                }),
                            Err(e) => (
                                StatusCode::INTERNAL_SERVER_ERROR,
                                Json(serde_json::json!({"error": {"message": format!("Failed to read response: {}", e)}})),
                            )
                                .into_response(),
                        }
                    }
                    Err(e) => {
                        if let Some(db) = &state.db {
                            let _ = state.mark_credential_unhealthy(
                                db,
                                &credential.uuid,
                                Some(&format!("API call failed: {e}")),
                            );
                        }
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(serde_json::json!({"error": {"message": format!("OpenAI compatible API call failed: {}", e)}})),
                        )
                            .into_response()
                    }
                }
            } else {
                // 没有自定义 base_url，不支持 OpenAI 格式
                (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({"error": {"message": "AnthropicKey without custom base_url does not support OpenAI format. Use Anthropic format endpoint instead."}})),
                )
                    .into_response()
            }
        }
    }
}

// ============================================================================
// 流式传输支持
// ============================================================================

/// 获取凭证对应的流式格式
///
/// 根据凭证类型返回对应的流式响应格式。
///
/// # 参数
/// - `credential`: 凭证信息
///
/// # 返回
/// 流式格式枚举
pub fn get_stream_format_for_credential(credential: &RuntimeProviderCredential) -> StreamingFormat {
    match &credential.credential {
        RuntimeCredentialData::ClaudeKey { .. } => StreamingFormat::AnthropicSse,
        RuntimeCredentialData::OpenAIKey { .. } => StreamingFormat::OpenAiSse,
        RuntimeCredentialData::GeminiApiKey { .. } => StreamingFormat::OpenAiSse,
        RuntimeCredentialData::VertexKey { .. } => StreamingFormat::OpenAiSse,
        RuntimeCredentialData::AnthropicKey { .. } => StreamingFormat::OpenAiSse,
    }
}

/// 处理流式响应
///
/// 使用 StreamManager 处理流式响应，集成 Flow Monitor。
///
/// # 参数
/// - `state`: 应用状态
/// - `flow_id`: Flow ID（用于 Flow Monitor 集成）
/// - `source_stream`: 源字节流
/// - `source_format`: 源流格式
/// - `target_format`: 目标流格式
/// - `model`: 模型名称
///
/// # 返回
/// SSE 格式的 HTTP 响应
///
/// # 需求覆盖
/// - 需求 4.2: 调用 process_chunk 更新流重建器
/// - 需求 5.1: 在收到 chunk 后立即转发给客户端
pub async fn handle_streaming_response(
    _state: &AppState,
    flow_id: Option<&str>,
    source_stream: StreamResponse,
    source_format: StreamingFormat,
    target_format: StreamingFormat,
    model: &str,
) -> Response {
    // 创建流式管理器
    let manager = StreamManager::with_default_config();

    // 创建流式上下文
    let context = StreamContext::new(
        flow_id.map(|s| s.to_string()),
        source_format,
        target_format,
        model,
    );

    // 获取 flow_id 的克隆用于回调

    // 创建流式处理
    let managed_stream = {
        let stream = manager.handle_stream(context, source_stream);

        let body_stream = stream.map(|result| -> Result<axum::body::Bytes, std::io::Error> {
            match result {
                Ok(event) => Ok(axum::body::Bytes::from(event)),
                Err(e) => Ok(axum::body::Bytes::from(e.to_sse_error())),
            }
        });

        Body::from_stream(body_stream)
    };

    // 构建 SSE 响应
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-cache")
        .header(header::CONNECTION, "keep-alive")
        .header("X-Accel-Buffering", "no")
        .body(managed_stream)
        .unwrap_or_else(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(
                    serde_json::json!({"error": {"message": "Failed to build streaming response"}}),
                ),
            )
                .into_response()
        })
}

/// 处理流式响应（带超时）
///
/// 与 `handle_streaming_response` 类似，但添加了超时保护。
///
/// # 参数
/// - `state`: 应用状态
/// - `flow_id`: Flow ID
/// - `source_stream`: 源字节流
/// - `source_format`: 源流格式
/// - `target_format`: 目标流格式
/// - `model`: 模型名称
/// - `timeout_ms`: 超时时间（毫秒）
///
/// # 返回
/// SSE 格式的 HTTP 响应
///
/// # 需求覆盖
/// - 需求 6.2: 超时错误处理
/// - 需求 6.5: 可配置的流式响应超时
pub async fn handle_streaming_response_with_timeout(
    _state: &AppState,
    flow_id: Option<&str>,
    source_stream: StreamResponse,
    source_format: StreamingFormat,
    target_format: StreamingFormat,
    model: &str,
    timeout_ms: u64,
) -> Response {
    use futures::stream::BoxStream;

    // 创建带超时配置的流式管理器
    let config = StreamConfig::new()
        .with_timeout_ms(timeout_ms)
        .with_chunk_timeout_ms(30_000); // 30 秒 chunk 超时

    let manager = StreamManager::new(config.clone());

    // 创建流式上下文
    let context = StreamContext::new(
        flow_id.map(|s| s.to_string()),
        source_format,
        target_format,
        model,
    );

    // 获取 flow_id 的克隆用于回调

    // 创建带超时的流式处理，使用 BoxStream 统一类型
    let timeout_stream: BoxStream<'static, Result<String, lime_providers::streaming::StreamError>> = {
        let stream = manager.handle_stream(context, source_stream);
        Box::pin(lime_providers::streaming::with_timeout(stream, &config))
    };

    // 转换为 Body 流
    let body_stream = timeout_stream.map(|result| -> Result<axum::body::Bytes, std::io::Error> {
        match result {
            Ok(event) => Ok(axum::body::Bytes::from(event)),
            Err(e) => Ok(axum::body::Bytes::from(e.to_sse_error())),
        }
    });

    // 构建 SSE 响应
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-cache")
        .header(header::CONNECTION, "keep-alive")
        .header("X-Accel-Buffering", "no")
        .body(Body::from_stream(body_stream))
        .unwrap_or_else(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(
                    serde_json::json!({"error": {"message": "Failed to build streaming response"}}),
                ),
            )
                .into_response()
        })
}

/// 将 reqwest 响应转换为 StreamResponse
///
/// 用于将 Provider 的 HTTP 响应转换为统一的流式响应类型。
///
/// # 参数
/// - `response`: reqwest HTTP 响应
///
/// # 返回
/// 统一的流式响应类型
pub fn response_to_stream(response: reqwest::Response) -> StreamResponse {
    lime_providers::streaming::reqwest_stream_to_stream_response(response)
}

// ============================================================================
// 客户端断开检测
// ============================================================================

/// 带客户端断开检测的流式响应处理
///
/// 在流式传输过程中检测客户端是否断开连接，并在断开时：
/// 1. 停止处理上游数据
/// 2. 标记 Flow 为取消状态
/// 3. 清理资源
///
/// # 参数
/// - `state`: 应用状态
/// - `flow_id`: Flow ID
/// - `source_stream`: 源字节流
/// - `source_format`: 源流格式
/// - `target_format`: 目标流格式
/// - `model`: 模型名称
/// - `cancel_token`: 取消令牌（用于取消上游请求）
///
/// # 返回
/// SSE 格式的 HTTP 响应
///
/// # 需求覆盖
/// - 需求 5.4: 客户端断开时取消上游请求
pub async fn handle_streaming_with_disconnect_detection(
    _state: &AppState,
    flow_id: Option<&str>,
    source_stream: StreamResponse,
    source_format: StreamingFormat,
    target_format: StreamingFormat,
    model: &str,
    cancel_token: Option<tokio_util::sync::CancellationToken>,
) -> Response {
    use futures::StreamExt;

    // 创建流式管理器
    let manager = StreamManager::with_default_config();

    // 创建流式上下文
    let context = StreamContext::new(
        flow_id.map(|s| s.to_string()),
        source_format,
        target_format,
        model,
    );

    // 获取 flow_id 的克隆
    let flow_id_for_cancel = flow_id.map(|s| s.to_string());

    // 创建流式处理
    let managed_stream: futures::stream::BoxStream<
        'static,
        Result<String, lime_providers::streaming::StreamError>,
    > = Box::pin(manager.handle_stream(context, source_stream));

    // 如果有取消令牌，创建一个可取消的流
    let body_stream = if let Some(token) = cancel_token {
        // 创建一个可取消的流
        let cancellable_stream = CancellableStream::new(managed_stream, token.clone());

        // 当流被取消时，标记 Flow 为取消状态
        let cancel_handler = {
            let token = token.clone();
            let flow_id = flow_id_for_cancel.clone();
            async move {
                token.cancelled().await;
                if let Some(fid) = flow_id {
                    tracing::info!("[STREAM] 客户端断开，已取消 Flow: {}", fid);
                }
            }
        };

        // 在后台运行取消处理器
        tokio::spawn(cancel_handler);

        // 转换为 Body 流
        let stream =
            cancellable_stream.map(|result| -> Result<axum::body::Bytes, std::io::Error> {
                match result {
                    Ok(event) => Ok(axum::body::Bytes::from(event)),
                    Err(e) => Ok(axum::body::Bytes::from(e.to_sse_error())),
                }
            });

        Body::from_stream(stream)
    } else {
        // 没有取消令牌，使用普通流
        let stream = managed_stream.map(|result| -> Result<axum::body::Bytes, std::io::Error> {
            match result {
                Ok(event) => Ok(axum::body::Bytes::from(event)),
                Err(e) => Ok(axum::body::Bytes::from(e.to_sse_error())),
            }
        });

        Body::from_stream(stream)
    };

    // 构建 SSE 响应
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-cache")
        .header(header::CONNECTION, "keep-alive")
        .header("X-Accel-Buffering", "no")
        .body(body_stream)
        .unwrap_or_else(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(
                    serde_json::json!({"error": {"message": "Failed to build streaming response"}}),
                ),
            )
                .into_response()
        })
}

/// 可取消的流包装器
///
/// 包装一个流，使其可以通过取消令牌取消。
/// 当取消令牌被触发时，流将返回 ClientDisconnected 错误。
pub struct CancellableStream<S> {
    inner: S,
    cancel_token: tokio_util::sync::CancellationToken,
    cancelled: bool,
}

impl<S> CancellableStream<S> {
    /// 创建新的可取消流
    pub fn new(inner: S, cancel_token: tokio_util::sync::CancellationToken) -> Self {
        Self {
            inner,
            cancel_token,
            cancelled: false,
        }
    }
}

impl<S> futures::Stream for CancellableStream<S>
where
    S: futures::Stream<Item = Result<String, StreamError>> + Unpin,
{
    type Item = Result<String, StreamError>;

    fn poll_next(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        use std::task::Poll;

        // 检查是否已取消
        if self.cancelled {
            return Poll::Ready(None);
        }

        // 检查取消令牌
        if self.cancel_token.is_cancelled() {
            self.cancelled = true;
            return Poll::Ready(Some(Err(StreamError::ClientDisconnected)));
        }

        // 轮询内部流
        std::pin::Pin::new(&mut self.inner).poll_next(cx)
    }
}

/// 创建取消令牌
///
/// 创建一个可用于取消流式请求的令牌。
///
/// # 返回
/// 取消令牌
pub fn create_cancel_token() -> tokio_util::sync::CancellationToken {
    tokio_util::sync::CancellationToken::new()
}

/// 检测客户端断开并触发取消
///
/// 监控客户端连接状态，当检测到断开时触发取消令牌。
///
/// # 参数
/// - `cancel_token`: 取消令牌
///
/// # 注意
/// 此函数应该在单独的任务中运行，与流式响应并行。
/// 实际的断开检测依赖于 axum 的连接管理。
pub async fn monitor_client_disconnect(cancel_token: tokio_util::sync::CancellationToken) {
    // 在实际应用中，这里会监控客户端连接状态
    // 当检测到断开时，调用 cancel_token.cancel()
    //
    // 由于 axum 的 SSE 响应会自动处理客户端断开，
    // 这个函数主要用于需要主动检测断开的场景

    // 等待取消令牌被触发（由其他地方触发）
    cancel_token.cancelled().await;
}

fn is_lime_debug_enabled() -> bool {
    lime_core::env_compat::bool_var(&["LIME_DEBUG", "PROXYCAST_DEBUG"]).unwrap_or(false)
}

/// 解析 Antigravity 累积的流式响应数据
///
/// Antigravity 返回的流式数据是分片的 JSON，格式如下：
/// ```json
/// {
///   "response": {
///     "candidates": [{
///       "content": {
///         "role": "model",
///         "parts": [
///           { "text": "..." },
///           { "inlineData": { "mimeType": "image/jpeg", "data": "base64..." } }
///         ]
///       }
///     }]
///   }
/// }
/// ```
fn parse_antigravity_accumulated_response(data: &str, model: &str) -> Result<String, String> {
    eprintln!(
        "[ANTIGRAVITY_PARSE] 开始解析累积数据，大小: {} bytes",
        data.len()
    );

    let debug_enabled = is_lime_debug_enabled();
    let debug_file = lime_core::app_paths::resolve_logs_dir()
        .map(|dir| dir.join("antigravity_stream_raw.txt"))
        .unwrap_or_else(|_| std::env::temp_dir().join("antigravity_stream_raw.txt"));

    if debug_enabled {
        if let Some(debug_dir) = debug_file.parent() {
            let _ = std::fs::create_dir_all(debug_dir);
        }
        let _ = std::fs::write(&debug_file, data);
        eprintln!("[ANTIGRAVITY_PARSE] 原始数据已保存到: {debug_file:?}");
    }

    if debug_enabled {
        eprintln!(
            "[ANTIGRAVITY_PARSE] 数据前1000字符:\n{}",
            &data[..data.len().min(1000)]
        );
    }

    // 尝试解析 JSON
    // Antigravity 流式响应可能是多个 JSON 对象，每个对象一行
    // 或者是一个大的 JSON 对象

    // 首先尝试直接解析为单个 JSON
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
        eprintln!("[ANTIGRAVITY_PARSE] 单个 JSON 解析成功");
        return parse_antigravity_json(&json, model);
    }

    // 如果失败，尝试按行解析，找到包含 candidates 的 JSON
    eprintln!("[ANTIGRAVITY_PARSE] 单个 JSON 解析失败，尝试按行解析");

    let mut all_text = String::new();
    let mut all_images: Vec<(String, String)> = Vec::new(); // (mime_type, data)
    let mut found_any = false;

    for line in data.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // 尝试解析每一行
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
            if let Some((text, images)) = extract_content_from_json(&json) {
                all_text.push_str(&text);
                all_images.extend(images);
                found_any = true;
            }
        }
    }

    if found_any {
        eprintln!(
            "[ANTIGRAVITY_PARSE] 按行解析成功，文本长度: {}, 图片数: {}",
            all_text.len(),
            all_images.len()
        );
        return build_sse_response(&all_text, &all_images, model);
    }

    // 如果还是失败，尝试找到 JSON 对象的边界
    eprintln!("[ANTIGRAVITY_PARSE] 按行解析失败，尝试查找 JSON 边界");

    // 查找所有 { 开头的位置，尝试解析
    let mut start = 0;
    while let Some(pos) = data[start..].find('{') {
        let json_start = start + pos;
        // 尝试从这个位置解析 JSON
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&data[json_start..]) {
            eprintln!("[ANTIGRAVITY_PARSE] 在位置 {json_start} 找到有效 JSON");
            return parse_antigravity_json(&json, model);
        }
        start = json_start + 1;
        if start >= data.len() {
            break;
        }
    }

    if debug_enabled {
        Err(format!("无法解析响应数据，请查看 {debug_file:?}"))
    } else {
        Err(
            "无法解析响应数据，可设置 LIME_DEBUG=1（兼容 PROXYCAST_DEBUG=1）以落盘原始响应"
                .to_string(),
        )
    }
}

/// 从 JSON 中提取内容
fn extract_content_from_json(json: &serde_json::Value) -> Option<(String, Vec<(String, String)>)> {
    // 尝试多种路径
    let candidates = json
        .get("response")
        .and_then(|r| r.get("candidates"))
        .or_else(|| json.get("candidates"))
        .and_then(|c| c.as_array())?;

    if candidates.is_empty() {
        return None;
    }

    let mut text = String::new();
    let mut thinking_text = String::new();
    let mut images = Vec::new();

    for candidate in candidates {
        if let Some(parts) = candidate
            .get("content")
            .and_then(|c| c.get("parts"))
            .and_then(|p| p.as_array())
        {
            for part in parts {
                // 检查是否是思维内容
                let is_thought = part
                    .get("thought")
                    .and_then(|t| t.as_bool())
                    .unwrap_or(false);

                // 捕获 thoughtSignature 到全局存储（用于后续请求）
                if let Some(sig) = part
                    .get("thoughtSignature")
                    .or_else(|| part.get("thought_signature"))
                    .and_then(|s| s.as_str())
                {
                    if !sig.is_empty() {
                        eprintln!(
                            "[ANTIGRAVITY_PARSE] 捕获 thoughtSignature (长度: {})",
                            sig.len()
                        );
                        store_thought_signature(sig);
                    }
                }

                // 跳过纯 thoughtSignature 部分
                let has_thought_signature = part
                    .get("thoughtSignature")
                    .or_else(|| part.get("thought_signature"))
                    .and_then(|s| s.as_str())
                    .map(|s| !s.is_empty())
                    .unwrap_or(false);

                let has_content = part.get("text").is_some()
                    || part.get("inlineData").is_some()
                    || part.get("inline_data").is_some();

                if has_thought_signature && !has_content {
                    continue;
                }

                if let Some(t) = part.get("text").and_then(|t| t.as_str()) {
                    if is_thought {
                        // 思维内容
                        thinking_text.push_str(t);
                    } else {
                        text.push_str(t);
                    }
                }
                if let Some(inline_data) =
                    part.get("inlineData").or_else(|| part.get("inline_data"))
                {
                    if let Some(data) = inline_data.get("data").and_then(|d| d.as_str()) {
                        let mime = inline_data
                            .get("mimeType")
                            .or_else(|| inline_data.get("mime_type"))
                            .and_then(|m| m.as_str())
                            .unwrap_or("image/png");
                        images.push((mime.to_string(), data.to_string()));
                    }
                }
            }
        }
    }

    // 如果有 thinking 内容，用 <thinking> 标签包裹并放在前面
    let mut final_text = String::new();
    if !thinking_text.is_empty() {
        final_text.push_str("<thinking>");
        final_text.push_str(&thinking_text);
        final_text.push_str("</thinking>\n\n");
    }
    final_text.push_str(&text);

    if final_text.is_empty() && images.is_empty() {
        None
    } else {
        Some((final_text, images))
    }
}

/// 解析 Antigravity JSON 响应
fn parse_antigravity_json(json: &serde_json::Value, model: &str) -> Result<String, String> {
    eprintln!(
        "[ANTIGRAVITY_PARSE] 解析 JSON，顶层类型: {}",
        if json.is_object() {
            "object"
        } else if json.is_array() {
            "array"
        } else {
            "other"
        }
    );

    if let Some(obj) = json.as_object() {
        eprintln!(
            "[ANTIGRAVITY_PARSE] 顶层 keys: {:?}",
            obj.keys().collect::<Vec<_>>()
        );
    }

    if let Some((text, images)) = extract_content_from_json(json) {
        return build_sse_response(&text, &images, model);
    }

    // 如果是数组，尝试处理每个元素
    if let Some(arr) = json.as_array() {
        eprintln!("[ANTIGRAVITY_PARSE] 顶层是数组，长度: {}", arr.len());
        let mut all_text = String::new();
        let mut all_images = Vec::new();

        for item in arr {
            if let Some((text, images)) = extract_content_from_json(item) {
                all_text.push_str(&text);
                all_images.extend(images);
            }
        }

        if !all_text.is_empty() || !all_images.is_empty() {
            return build_sse_response(&all_text, &all_images, model);
        }
    }

    Err("响应中没有 candidates".to_string())
}

/// 构建 SSE 响应
fn build_sse_response(
    text: &str,
    images: &[(String, String)],
    model: &str,
) -> Result<String, String> {
    let mut content = text.to_string();

    // 添加图片
    for (mime, data) in images {
        let image_url = format!("data:{mime};base64,{data}");
        content.push_str(&format!("\n\n![Generated Image]({image_url})"));
    }

    eprintln!("[ANTIGRAVITY_PARSE] 构建 SSE，内容长度: {}", content.len());

    let chunk_id = format!("chatcmpl-{}", uuid::Uuid::new_v4());
    let created = chrono::Utc::now().timestamp();

    let mut sse_output = String::new();

    if !content.is_empty() {
        let content_chunk = serde_json::json!({
            "id": &chunk_id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": model,
            "choices": [{
                "index": 0,
                "delta": { "content": content },
                "finish_reason": serde_json::Value::Null
            }]
        });
        sse_output.push_str(&format!("data: {content_chunk}\n\n"));
    }

    let done_chunk = serde_json::json!({
        "id": &chunk_id,
        "object": "chat.completion.chunk",
        "created": created,
        "model": model,
        "choices": [{
            "index": 0,
            "delta": {},
            "finish_reason": "stop"
        }]
    });
    sse_output.push_str(&format!("data: {done_chunk}\n\n"));
    sse_output.push_str("data: [DONE]\n\n");

    Ok(sse_output)
}

/// 将 Gemini 流式响应 chunk 转换为 OpenAI SSE 格式
///
/// Gemini 流式响应格式:
/// ```json
/// {"candidates":[{"content":{"parts":[{"text":"Hello"}],"role":"model"},"finishReason":"STOP"}]}
/// ```
///
/// OpenAI SSE 格式:
/// ```text
/// data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}
/// ```
fn convert_gemini_chunk_to_openai_sse(json: &serde_json::Value, model: &str) -> Option<String> {
    // 检查是否有 candidates
    let candidates = json.get("candidates")?.as_array()?;
    if candidates.is_empty() {
        return None;
    }

    let candidate = &candidates[0];

    // 提取文本内容
    let mut content_delta: Option<String> = None;
    let mut has_image = false;
    let mut image_data: Option<String> = None;

    if let Some(content) = candidate.get("content") {
        if let Some(parts) = content.get("parts").and_then(|p| p.as_array()) {
            for part in parts {
                // 处理文本
                if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                    content_delta = Some(text.to_string());
                }

                // 处理图片（inlineData）
                if let Some(inline_data) =
                    part.get("inlineData").or_else(|| part.get("inline_data"))
                {
                    if let Some(data) = inline_data.get("data").and_then(|d| d.as_str()) {
                        let mime_type = inline_data
                            .get("mimeType")
                            .or_else(|| inline_data.get("mime_type"))
                            .and_then(|m| m.as_str())
                            .unwrap_or("image/png");

                        // 将图片作为 markdown 格式的 data URL
                        let image_url = format!("data:{mime_type};base64,{data}");
                        image_data = Some(format!("\n\n![Generated Image]({image_url})"));
                        has_image = true;
                    }
                }
            }
        }
    }

    // 检查 finish_reason
    let finish_reason = candidate
        .get("finishReason")
        .and_then(|f| f.as_str())
        .map(|r| match r {
            "STOP" => "stop",
            "MAX_TOKENS" => "length",
            "SAFETY" => "content_filter",
            "RECITATION" => "content_filter",
            _ => "stop",
        });

    // 如果没有内容变化且没有 finish_reason，跳过
    if content_delta.is_none() && !has_image && finish_reason.is_none() {
        return None;
    }

    // 合并文本和图片内容
    let final_content = match (content_delta, image_data) {
        (Some(text), Some(img)) => Some(format!("{text}{img}")),
        (Some(text), None) => Some(text),
        (None, Some(img)) => Some(img),
        (None, None) => None,
    };

    // 构建 OpenAI 格式的 delta
    let mut delta = serde_json::json!({});
    if let Some(content) = final_content {
        delta["content"] = serde_json::Value::String(content);
    }

    // 构建完整的 SSE 事件
    let chunk_id = format!("chatcmpl-{}", uuid::Uuid::new_v4());
    let created = chrono::Utc::now().timestamp();

    let response = serde_json::json!({
        "id": chunk_id,
        "object": "chat.completion.chunk",
        "created": created,
        "model": model,
        "choices": [{
            "index": 0,
            "delta": delta,
            "finish_reason": finish_reason
        }]
    });

    Some(format!("data: {response}\n\n"))
}

/// 将 OpenAI ChatCompletionResponse 转换为 Anthropic MessagesResponse 格式
fn convert_openai_response_to_anthropic(
    openai_resp: &lime_core::models::openai::ChatCompletionResponse,
    model: &str,
) -> serde_json::Value {
    // 提取第一个 choice 的内容
    let content = openai_resp
        .choices
        .first()
        .and_then(|c| c.message.content.as_ref())
        .cloned()
        .unwrap_or_default();

    // 提取 tool_calls
    let tool_use: Vec<serde_json::Value> = openai_resp
        .choices
        .first()
        .and_then(|c| c.message.tool_calls.as_ref())
        .map(|calls| {
            calls
                .iter()
                .map(|tc| {
                    serde_json::json!({
                        "type": "tool_use",
                        "id": tc.id,
                        "name": tc.function.name,
                        "input": serde_json::from_str::<serde_json::Value>(&tc.function.arguments).unwrap_or_default()
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    // 构建 content 数组
    let mut content_array: Vec<serde_json::Value> = Vec::new();
    if !content.is_empty() {
        content_array.push(serde_json::json!({
            "type": "text",
            "text": content
        }));
    }
    content_array.extend(tool_use);

    // 转换 finish_reason
    let stop_reason = openai_resp
        .choices
        .first()
        .map(|c| match c.finish_reason.as_str() {
            "stop" => "end_turn",
            "length" => "max_tokens",
            "tool_calls" => "tool_use",
            _ => "end_turn",
        })
        .unwrap_or("end_turn");

    // 构建 Anthropic 响应
    serde_json::json!({
        "id": format!("msg_{}", uuid::Uuid::new_v4()),
        "type": "message",
        "role": "assistant",
        "content": content_array,
        "model": model,
        "stop_reason": stop_reason,
        "stop_sequence": null,
        "usage": {
            "input_tokens": openai_resp.usage.prompt_tokens,
            "output_tokens": openai_resp.usage.completion_tokens
        }
    })
}

/// 将 Codex response.completed 事件转换为 OpenAI Chat Completions 非流式响应格式
/// 参考 CLIProxyAPI: internal/translator/codex/openai/chat-completions/codex_openai_response.go
fn convert_codex_to_openai_non_stream(codex_response: &serde_json::Value) -> serde_json::Value {
    let response = &codex_response["response"];

    // 提取基本信息
    let id = response["id"].as_str().unwrap_or("").to_string();
    let model = response["model"].as_str().unwrap_or("gpt-5").to_string();
    let created = response["created_at"].as_i64().unwrap_or_else(|| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0)
    });

    // 提取 usage 信息
    let usage = &response["usage"];
    let prompt_tokens = usage["input_tokens"].as_i64().unwrap_or(0);
    let completion_tokens = usage["output_tokens"].as_i64().unwrap_or(0);
    let total_tokens = usage["total_tokens"]
        .as_i64()
        .unwrap_or(prompt_tokens + completion_tokens);
    let reasoning_tokens = usage["output_tokens_details"]["reasoning_tokens"].as_i64();

    // 处理 output 数组，提取 content、reasoning_content 和 tool_calls
    let mut content_text: Option<String> = None;
    let mut reasoning_text: Option<String> = None;
    let mut tool_calls: Vec<serde_json::Value> = Vec::new();

    if let Some(output_array) = response["output"].as_array() {
        for output_item in output_array {
            let output_type = output_item["type"].as_str().unwrap_or("");

            match output_type {
                "reasoning" => {
                    // 提取 reasoning content from summary
                    if let Some(summary_array) = output_item["summary"].as_array() {
                        for summary_item in summary_array {
                            if summary_item["type"].as_str() == Some("summary_text") {
                                reasoning_text =
                                    summary_item["text"].as_str().map(|s| s.to_string());
                                break;
                            }
                        }
                    }
                }
                "message" => {
                    // 提取 message content
                    if let Some(content_array) = output_item["content"].as_array() {
                        for content_item in content_array {
                            if content_item["type"].as_str() == Some("output_text") {
                                content_text = content_item["text"].as_str().map(|s| s.to_string());
                                break;
                            }
                        }
                    }
                }
                "function_call" => {
                    // 处理 function call
                    let call_id = output_item["call_id"].as_str().unwrap_or("").to_string();
                    let name = output_item["name"].as_str().unwrap_or("").to_string();
                    let arguments = output_item["arguments"]
                        .as_str()
                        .unwrap_or("{}")
                        .to_string();

                    tool_calls.push(serde_json::json!({
                        "id": call_id,
                        "type": "function",
                        "function": {
                            "name": name,
                            "arguments": arguments
                        }
                    }));
                }
                _ => {}
            }
        }
    }

    // 确定 finish_reason
    let finish_reason = if !tool_calls.is_empty() {
        "tool_calls"
    } else {
        "stop"
    };

    // 构建 message 对象
    let mut message = serde_json::json!({
        "role": "assistant"
    });

    if let Some(content) = content_text {
        message["content"] = serde_json::json!(content);
    } else {
        message["content"] = serde_json::Value::Null;
    }

    if let Some(reasoning) = reasoning_text {
        message["reasoning_content"] = serde_json::json!(reasoning);
    }

    if !tool_calls.is_empty() {
        message["tool_calls"] = serde_json::json!(tool_calls);
    }

    // 构建 usage 对象
    let mut usage_obj = serde_json::json!({
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens
    });

    if let Some(reasoning) = reasoning_tokens {
        usage_obj["completion_tokens_details"] = serde_json::json!({
            "reasoning_tokens": reasoning
        });
    }

    // 构建完整响应
    serde_json::json!({
        "id": id,
        "object": "chat.completion",
        "created": created,
        "model": model,
        "choices": [{
            "index": 0,
            "message": message,
            "finish_reason": finish_reason,
            "native_finish_reason": finish_reason
        }],
        "usage": usage_obj
    })
}

/// Codex SSE 转换状态
#[derive(Default)]
struct CodexConvertState {
    response_id: String,
    created_at: i64,
    model: String,
    function_call_index: i32,
}

/// 将单个 Codex SSE 事件转换为 OpenAI SSE 格式（使用状态结构体）
/// 参考 CLIProxyAPI: internal/translator/codex/openai/chat-completions/codex_openai_response.go
fn convert_codex_event_to_openai_sse_with_state(
    codex_event: &serde_json::Value,
    state: &mut CodexConvertState,
) -> Option<String> {
    convert_codex_event_to_openai_sse(
        codex_event,
        &mut state.response_id,
        &mut state.created_at,
        &mut state.model,
        &mut state.function_call_index,
    )
}

/// 将单个 Codex SSE 事件转换为 OpenAI SSE 格式
/// 参考 CLIProxyAPI: internal/translator/codex/openai/chat-completions/codex_openai_response.go
fn convert_codex_event_to_openai_sse(
    codex_event: &serde_json::Value,
    response_id: &mut String,
    created_at: &mut i64,
    model: &mut String,
    function_call_index: &mut i32,
) -> Option<String> {
    let event_type = codex_event.get("type")?.as_str()?;

    match event_type {
        "response.created" => {
            // 保存响应元数据
            *response_id = codex_event["response"]["id"]
                .as_str()
                .unwrap_or("")
                .to_string();
            *created_at = codex_event["response"]["created_at"].as_i64().unwrap_or(0);
            *model = codex_event["response"]["model"]
                .as_str()
                .unwrap_or("gpt-5")
                .to_string();
            None
        }
        "response.output_text.delta" => {
            // 文本增量
            let delta = codex_event.get("delta")?.as_str()?;
            let chunk = serde_json::json!({
                "id": response_id,
                "object": "chat.completion.chunk",
                "created": created_at,
                "model": model,
                "choices": [{
                    "index": 0,
                    "delta": {
                        "role": "assistant",
                        "content": delta
                    },
                    "finish_reason": null
                }]
            });
            Some(chunk.to_string())
        }
        "response.reasoning_summary_text.delta" => {
            // 推理内容增量
            let delta = codex_event.get("delta")?.as_str()?;
            let chunk = serde_json::json!({
                "id": response_id,
                "object": "chat.completion.chunk",
                "created": created_at,
                "model": model,
                "choices": [{
                    "index": 0,
                    "delta": {
                        "role": "assistant",
                        "reasoning_content": delta
                    },
                    "finish_reason": null
                }]
            });
            Some(chunk.to_string())
        }
        "response.reasoning_summary_text.done" => {
            // 推理内容结束，添加换行
            let chunk = serde_json::json!({
                "id": response_id,
                "object": "chat.completion.chunk",
                "created": created_at,
                "model": model,
                "choices": [{
                    "index": 0,
                    "delta": {
                        "role": "assistant",
                        "reasoning_content": "\n\n"
                    },
                    "finish_reason": null
                }]
            });
            Some(chunk.to_string())
        }
        "response.output_item.done" => {
            // 处理 function_call 完成事件
            let item = codex_event.get("item")?;
            if item.get("type")?.as_str()? != "function_call" {
                return None;
            }

            *function_call_index += 1;

            let call_id = item["call_id"].as_str().unwrap_or("").to_string();
            let name = item["name"].as_str().unwrap_or("").to_string();
            let arguments = item["arguments"].as_str().unwrap_or("{}").to_string();

            let chunk = serde_json::json!({
                "id": response_id,
                "object": "chat.completion.chunk",
                "created": created_at,
                "model": model,
                "choices": [{
                    "index": 0,
                    "delta": {
                        "role": "assistant",
                        "tool_calls": [{
                            "index": function_call_index,
                            "id": call_id,
                            "type": "function",
                            "function": {
                                "name": name,
                                "arguments": arguments
                            }
                        }]
                    },
                    "finish_reason": null
                }]
            });
            Some(chunk.to_string())
        }
        "response.completed" => {
            // 响应完成
            let finish_reason = if *function_call_index != -1 {
                "tool_calls"
            } else {
                "stop"
            };

            // 提取 usage 信息
            let usage = &codex_event["response"]["usage"];
            let prompt_tokens = usage["input_tokens"].as_i64().unwrap_or(0);
            let completion_tokens = usage["output_tokens"].as_i64().unwrap_or(0);
            let total_tokens = usage["total_tokens"]
                .as_i64()
                .unwrap_or(prompt_tokens + completion_tokens);

            let chunk = serde_json::json!({
                "id": response_id,
                "object": "chat.completion.chunk",
                "created": created_at,
                "model": model,
                "choices": [{
                    "index": 0,
                    "delta": {},
                    "finish_reason": finish_reason,
                    "native_finish_reason": finish_reason
                }],
                "usage": {
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "total_tokens": total_tokens
                }
            });
            Some(chunk.to_string())
        }
        _ => None,
    }
}
