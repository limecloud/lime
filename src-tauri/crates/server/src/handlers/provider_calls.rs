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
//! - `handle_kiro_stream()`: Kiro 凭证的真正流式处理（AWS Event Stream → Anthropic SSE）
//!
//! # Kiro 凭证流式处理
//!
//! 当使用 Kiro 凭证且 `stream=true` 时，系统会：
//! 1. 调用 `KiroProvider.call_api_stream()` 获取 AWS Event Stream 格式的流式响应
//! 2. 使用 `AwsEventStreamParser` 实时解析每个 JSON payload
//! 3. 使用 `AnthropicSseGenerator` 转换为 Anthropic SSE 格式
//! 4. 通过 `FlowMonitor.process_chunk()` 记录每个 chunk
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
//! - 需求 6.1: 流式请求使用 handle_kiro_stream()
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
use lime_core::models::provider_pool_model::{CredentialData, ProviderCredential};
use lime_providers::converter::anthropic_to_openai::convert_anthropic_to_openai;
use lime_providers::converter::openai_to_antigravity::{
    convert_antigravity_to_openai_response, convert_openai_to_antigravity_with_context,
};
use lime_providers::providers::{
    AntigravityProvider, ClaudeCustomProvider, CodexProvider, KiroProvider, OpenAICustomProvider,
    PromptCacheMode, VertexProvider,
};
use lime_providers::session::store_thought_signature;
use lime_providers::stream::{PipelineConfig, StreamPipeline};
use lime_providers::streaming::traits::StreamingProvider;
use lime_providers::streaming::{
    StreamConfig, StreamContext, StreamError, StreamFormat as StreamingFormat, StreamManager,
    StreamResponse,
};
use lime_server_utils::{
    build_anthropic_response, build_anthropic_stream_response, build_error_response,
    build_error_response_with_status, parse_cw_response, safe_truncate, CWParsedResponse,
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
    credential: &ProviderCredential,
    request: &AnthropicMessagesRequest,
    flow_id: Option<&str>,
) -> Response {
    match &credential.credential {
        CredentialData::KiroOAuth { creds_file_path } => {
            // 如果是流式请求，使用真正的流式处理（需求 1.1, 6.1）
            if request.stream {
                return handle_kiro_stream(state, credential, request, flow_id).await;
            }

            // 非流式请求，使用现有的 call_api() 方法（需求 6.1, 6.2, 6.3）
            // 使用 TokenCacheService 获取有效 token
            let db = match &state.db {
                Some(db) => db,
                None => {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(serde_json::json!({"error": {"message": "Database not available"}})),
                    )
                        .into_response();
                }
            };
            // 获取缓存的 token
            let token = match state
                .token_cache
                .get_valid_token(db, &credential.uuid)
                .await
            {
                Ok(t) => t,
                Err(e) => {
                    tracing::warn!("[POOL] Token cache miss, loading from source: {}", e);
                    // 回退到从源文件加载
                    let mut kiro = KiroProvider::new();
                    if let Err(e) = kiro.load_credentials_from_path(creds_file_path).await {
                        // 记录凭证加载失败
                        let _ = state.pool_service.mark_unhealthy(
                            db,
                            &credential.uuid,
                            Some(&format!("Failed to load credentials: {e}")),
                        );
                        return (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(serde_json::json!({"error": {"message": format!("Failed to load Kiro credentials: {}", e)}})),
                        )
                            .into_response();
                    }
                    if let Err(e) = kiro.refresh_token().await {
                        // 记录 Token 刷新失败
                        let _ = state.pool_service.mark_unhealthy(
                            db,
                            &credential.uuid,
                            Some(&format!("Token refresh failed: {e}")),
                        );
                        return (
                            StatusCode::UNAUTHORIZED,
                            Json(serde_json::json!({"error": {"message": format!("Token refresh failed: {}", e)}})),
                        )
                            .into_response();
                    }
                    kiro.credentials.access_token.unwrap_or_default()
                }
            };
            // 使用获取到的 token 创建 KiroProvider
            let mut kiro = KiroProvider::new();
            // 从源文件加载其他配置（region, profile_arn 等）
            // 注意：必须先加载凭证文件，再设置 token，因为 load_credentials_from_path 会覆盖整个 credentials
            let _ = kiro.load_credentials_from_path(creds_file_path).await;
            // 使用缓存的 token 覆盖文件中的 token（缓存的 token 更新）
            kiro.credentials.access_token = Some(token);
            let openai_request = convert_anthropic_to_openai(request);
            let resp = match kiro.call_api(&openai_request).await {
                Ok(r) => r,
                Err(e) => {
                    // 记录 API 调用失败
                    let _ = state.pool_service.mark_unhealthy(
                        db,
                        &credential.uuid,
                        Some(&e.to_string()),
                    );
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(serde_json::json!({"error": {"message": e.to_string()}})),
                    )
                        .into_response();
                }
            };
            let status = resp.status();
            if status.is_success() {
                match resp.bytes().await {
                    Ok(bytes) => {
                        let body = String::from_utf8_lossy(&bytes).to_string();
                        let parsed = parse_cw_response(&body);
                        // 记录成功
                        let _ = state.pool_service.mark_healthy(
                            db,
                            &credential.uuid,
                            Some(&request.model),
                        );
                        let _ = state.pool_service.record_usage(db, &credential.uuid);
                        // 非流式请求返回完整 JSON 响应（需求 6.2）
                        build_anthropic_response(&request.model, &parsed)
                    }
                    Err(e) => {
                        let _ = state.pool_service.mark_unhealthy(
                            db,
                            &credential.uuid,
                            Some(&e.to_string()),
                        );
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(serde_json::json!({"error": {"message": e.to_string()}})),
                        )
                            .into_response()
                    }
                }
            } else if status.as_u16() == 401 || status.as_u16() == 403 {
                // Token 过期，强制刷新并重试
                tracing::info!(
                    "[POOL] Got {}, forcing token refresh for {}",
                    status,
                    &credential.uuid[..8]
                );
                let new_token = match state
                    .token_cache
                    .refresh_and_cache(db, &credential.uuid, true)
                    .await
                {
                    Ok(t) => t,
                    Err(e) => {
                        // 记录 Token 刷新失败
                        let _ = state.pool_service.mark_unhealthy(
                            db,
                            &credential.uuid,
                            Some(&format!("Token refresh failed: {e}")),
                        );
                        return (
                            StatusCode::UNAUTHORIZED,
                            Json(serde_json::json!({"error": {"message": format!("Token refresh failed: {}", e)}})),
                        )
                            .into_response();
                    }
                };
                // 使用新 token 重试
                kiro.credentials.access_token = Some(new_token);
                match kiro.call_api(&openai_request).await {
                    Ok(retry_resp) => {
                        if retry_resp.status().is_success() {
                            match retry_resp.bytes().await {
                                Ok(bytes) => {
                                    let body = String::from_utf8_lossy(&bytes).to_string();
                                    let parsed = parse_cw_response(&body);
                                    // 记录重试成功
                                    let _ = state.pool_service.mark_healthy(
                                        db,
                                        &credential.uuid,
                                        Some(&request.model),
                                    );
                                    let _ = state.pool_service.record_usage(db, &credential.uuid);
                                    // 非流式请求返回完整 JSON 响应（需求 6.2）
                                    build_anthropic_response(&request.model, &parsed)
                                }
                                Err(e) => {
                                    let _ = state.pool_service.mark_unhealthy(
                                        db,
                                        &credential.uuid,
                                        Some(&e.to_string()),
                                    );
                                    (
                                        StatusCode::INTERNAL_SERVER_ERROR,
                                        Json(serde_json::json!({"error": {"message": e.to_string()}})),
                                    )
                                        .into_response()
                                }
                            }
                        } else {
                            let body = retry_resp.text().await.unwrap_or_default();
                            let _ = state.pool_service.mark_unhealthy(
                                db,
                                &credential.uuid,
                                Some(&format!("Retry failed: {body}")),
                            );
                            (
                                StatusCode::INTERNAL_SERVER_ERROR,
                                Json(serde_json::json!({"error": {"message": format!("Retry failed: {}", body)}})),
                            )
                                .into_response()
                        }
                    }
                    Err(e) => {
                        let _ = state.pool_service.mark_unhealthy(
                            db,
                            &credential.uuid,
                            Some(&e.to_string()),
                        );
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
                eprintln!("[PROVIDER_CALL] Kiro 请求失败: status={} body={}", status_code, &body[..body.len().min(500)]);
                // 只有 5xx 错误才标记为不健康
                if status_code >= 500 {
                    let _ = state
                        .pool_service
                        .mark_unhealthy(db, &credential.uuid, Some(&body));
                }
                // 转发上游的实际状态码
                (
                    StatusCode::from_u16(status_code).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
                    Json(serde_json::json!({"error": {"message": body}})),
                )
                    .into_response()
            }
        }
        CredentialData::GeminiOAuth { .. } => {
            // Gemini OAuth 路由暂不支持
            (
                StatusCode::NOT_IMPLEMENTED,
                Json(serde_json::json!({"error": {"message": "Gemini OAuth routing not yet implemented. Use /v1/messages with Gemini models instead."}})),
            )
                .into_response()
        }
        CredentialData::AntigravityOAuth {
            creds_file_path,
            project_id,
        } => {
            let mut antigravity = AntigravityProvider::new();
            if let Err(e) = antigravity
                .load_credentials_from_path(creds_file_path)
                .await
            {
                // 记录凭证加载失败
                if let Some(db) = &state.db {
                    let _ = state.pool_service.mark_unhealthy(
                        db,
                        &credential.uuid,
                        Some(&format!("Failed to load credentials: {e}")),
                    );
                }
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": {"message": format!("Failed to load Antigravity credentials: {}", e)}})),
                )
                    .into_response();
            }

            // 使用新的 validate_token() 方法检查 Token 状态
            let validation_result = antigravity.validate_token();
            tracing::info!("[Antigravity] Token 验证结果: {:?}", validation_result);

            // 根据验证结果决定是否刷新
            if validation_result.needs_refresh() {
                tracing::info!("[Antigravity] Token 需要刷新，开始刷新...");
                match antigravity.refresh_token_with_retry(3).await {
                    Ok(new_token) => {
                        tracing::info!("[Antigravity] Token 刷新成功，新 token 长度: {}", new_token.len());
                        // 刷新成功，标记为健康
                        if let Some(db) = &state.db {
                            let _ = state.pool_service.mark_healthy(
                                db,
                                &credential.uuid,
                                None,
                            );
                        }
                    }
                    Err(refresh_error) => {
                        tracing::error!("[Antigravity] Token 刷新失败: {:?}", refresh_error);
                        // 使用新的 mark_unhealthy_with_details 方法
                        if let Some(db) = &state.db {
                            let _ = state.pool_service.mark_unhealthy_with_details(
                                db,
                                &credential.uuid,
                                &refresh_error,
                            );
                        }

                        // 根据错误类型返回不同的状态码和消息
                        let (status, message) = if refresh_error.requires_reauth() {
                            (StatusCode::UNAUTHORIZED, refresh_error.user_message())
                        } else {
                            (StatusCode::INTERNAL_SERVER_ERROR, refresh_error.user_message())
                        };

                        return (
                            status,
                            Json(serde_json::json!({"error": {"message": message}})),
                        )
                            .into_response();
                    }
                }
            }

            // 设置项目 ID
            if let Some(pid) = project_id {
                antigravity.project_id = Some(pid.clone());
            } else if let Err(e) = antigravity.discover_project().await {
                tracing::warn!("[Antigravity] Failed to discover project: {}", e);
            }
            // 获取 project_id 用于请求
            let proj_id = antigravity.project_id.clone().unwrap_or_default();
            // 先转换为 OpenAI 格式，再转换为 Antigravity 格式
            let openai_request = convert_anthropic_to_openai(request);
            let antigravity_request = convert_openai_to_antigravity_with_context(&openai_request, &proj_id);
            match antigravity
                .generate_content(&request.model, &antigravity_request)
                .await
            {
                Ok(resp) => {
                    // 转换为 OpenAI 格式，再构建 Anthropic 响应
                    let content = resp["candidates"][0]["content"]["parts"][0]["text"]
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
                        let _ = state.pool_service.mark_healthy(
                            db,
                            &credential.uuid,
                            Some(&request.model),
                        );
                        let _ = state.pool_service.record_usage(db, &credential.uuid);
                    }
                    if request.stream {
                        build_anthropic_stream_response(&request.model, &parsed)
                    } else {
                        build_anthropic_response(&request.model, &parsed)
                    }
                }
                Err(api_err) => {
                    // 记录 API 调用失败
                    if let Some(db) = &state.db {
                        let _ = state.pool_service.mark_unhealthy(
                            db,
                            &credential.uuid,
                            Some(&api_err.message),
                        );
                    }

                    // 直接使用 AntigravityApiError 的状态码构建响应
                    build_error_response_with_status(api_err.status_code, &api_err.to_string())
                }
            }
        }
        CredentialData::OpenAIKey { api_key, base_url } => {
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
                                        let _ = state.pool_service.mark_healthy(
                                            db,
                                            &credential.uuid,
                                            Some(&request.model),
                                        );
                                        let _ =
                                            state.pool_service.record_usage(db, &credential.uuid);
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
                                        let _ = state.pool_service.mark_unhealthy(
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
                                    let _ = state.pool_service.mark_unhealthy(
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
                                let _ = state.pool_service.mark_unhealthy(
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
                        let _ = state.pool_service.mark_unhealthy(
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
        CredentialData::ClaudeKey { api_key, base_url } => {
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
                            let _ = state.pool_service.mark_healthy(
                                db,
                                &credential.uuid,
                                Some(&request.model),
                            );
                            let _ = state.pool_service.record_usage(db, &credential.uuid);
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
                                    let _ = state.pool_service.mark_healthy(
                                        db,
                                        &credential.uuid,
                                        Some(&request.model),
                                    );
                                    let _ = state.pool_service.record_usage(db, &credential.uuid);
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
                                    let _ = state.pool_service.mark_unhealthy(
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
                                let _ = state.pool_service.mark_unhealthy(
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
                        let _ = state.pool_service.mark_unhealthy(
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
        CredentialData::VertexKey { api_key, base_url, .. } => {
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
                                    let _ = state.pool_service.mark_healthy(db, &credential.uuid, Some(&request.model));
                                    let _ = state.pool_service.record_usage(db, &credential.uuid);
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
                                    let _ = state.pool_service.mark_unhealthy(db, &credential.uuid, Some(&body));
                                }
                                (StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR), Json(serde_json::json!({"error": {"message": body}}))).into_response()
                            }
                        }
                        Err(e) => {
                            if let Some(db) = &state.db {
                                let _ = state.pool_service.mark_unhealthy(db, &credential.uuid, Some(&e.to_string()));
                            }
                            (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": {"message": e.to_string()}}))).into_response()
                        }
                    }
                }
                Err(e) => {
                    if let Some(db) = &state.db {
                        let _ = state.pool_service.mark_unhealthy(db, &credential.uuid, Some(&e.to_string()));
                    }
                    (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": {"message": e.to_string()}}))).into_response()
                }
            }
        }
        // Gemini API Key credentials - not supported for Anthropic format
        CredentialData::GeminiApiKey { .. } => {
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": {"message": "Gemini API Key credentials do not support Anthropic format"}})),
            )
                .into_response()
        }
        // 新增的凭证类型暂不支持 Anthropic 格式
        CredentialData::CodexOAuth { .. }
        | CredentialData::ClaudeOAuth { .. } => {
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": {"message": "This credential type does not support Anthropic format yet"}})),
            )
                .into_response()
        }
        // Anthropic API Key - 根据 base_url 决定调用方式
        CredentialData::AnthropicKey { api_key, base_url } => {
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
                            let _ = state.pool_service.mark_healthy(
                                db,
                                &credential.uuid,
                                Some(&request.model),
                            );
                            let _ = state.pool_service.record_usage(db, &credential.uuid);
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
                                    let _ = state.pool_service.mark_healthy(
                                        db,
                                        &credential.uuid,
                                        Some(&request.model),
                                    );
                                    let _ = state.pool_service.record_usage(db, &credential.uuid);
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
                                    let _ = state.pool_service.mark_unhealthy(
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
                        let _ = state.pool_service.mark_unhealthy(
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
    credential: &ProviderCredential,
    request: &ChatCompletionRequest,
    _flow_id: Option<&str>,
) -> Response {
    let _start_time = std::time::Instant::now();

    // 调试：打印凭证类型
    let cred_type = match &credential.credential {
        CredentialData::KiroOAuth { .. } => "KiroOAuth",
        CredentialData::ClaudeKey { .. } => "ClaudeKey",
        CredentialData::OpenAIKey { .. } => "OpenAIKey",
        CredentialData::GeminiOAuth { .. } => "GeminiOAuth",
        CredentialData::GeminiApiKey { .. } => "GeminiApiKey",
        CredentialData::VertexKey { .. } => "VertexKey",
        CredentialData::AntigravityOAuth { .. } => "AntigravityOAuth",
        _ => "Other",
    };
    tracing::info!(
        "[CALL_PROVIDER_OPENAI] 凭证类型={}, 凭证名称={:?}, provider_type={}, uuid={}",
        cred_type,
        credential.name,
        credential.provider_type,
        &credential.uuid[..8]
    );

    match &credential.credential {
        CredentialData::KiroOAuth { creds_file_path } => {
            // 优先使用 token cache，避免每次都刷新 token
            let db = match &state.db {
                Some(db) => db,
                None => {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(serde_json::json!({"error": {"message": "Database not available"}})),
                    )
                        .into_response();
                }
            };

            // 获取缓存的 token（自动处理过期和刷新）
            let token = match state
                .token_cache
                .get_valid_token(db, &credential.uuid)
                .await
            {
                Ok(t) => t,
                Err(e) => {
                    tracing::warn!("[POOL] Token cache miss, loading from source: {}", e);
                    // 降级：从源文件加载并刷新
                    let mut kiro = KiroProvider::new();
                    if let Err(e) = kiro.load_credentials_from_path(creds_file_path).await {
                        let _ = state.pool_service.mark_unhealthy(
                            db,
                            &credential.uuid,
                            Some(&format!("Failed to load credentials: {e}")),
                        );
                        return (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(serde_json::json!({"error": {"message": format!("Failed to load Kiro credentials: {}", e)}})),
                        )
                            .into_response();
                    }
                    if let Err(e) = kiro.refresh_token().await {
                        let _ = state.pool_service.mark_unhealthy(
                            db,
                            &credential.uuid,
                            Some(&format!("Token refresh failed: {e}")),
                        );
                        return (
                            StatusCode::UNAUTHORIZED,
                            Json(serde_json::json!({"error": {"message": format!("Token refresh failed: {}", e)}})),
                        )
                            .into_response();
                    }
                    kiro.credentials.access_token.unwrap_or_default()
                }
            };

            // 使用获取到的 token 创建 KiroProvider
            let mut kiro = KiroProvider::new();
            // 从源文件加载其他配置（region, profile_arn 等）
            // 注意：必须先加载凭证文件，再设置 token，因为 load_credentials_from_path 会覆盖整个 credentials
            let _ = kiro.load_credentials_from_path(creds_file_path).await;
            // 使用缓存的 token 覆盖文件中的 token（缓存的 token 更新）
            kiro.credentials.access_token = Some(token);

            tracing::info!("[CALL_PROVIDER_OPENAI] request.stream = {}, model = {}", request.stream, request.model);

            // 检查是否为流式请求
            if request.stream {
                // 流式请求处理
                tracing::info!("[OPENAI_STREAM] 处理流式请求, model={}", request.model);
                match kiro.call_api_stream(request).await {
                    Ok(stream_response) => {
                        // 记录成功
                        if let Some(db) = &state.db {
                            let _ = state.pool_service.mark_healthy(db, &credential.uuid, Some(&request.model));
                            let _ = state.pool_service.record_usage(db, &credential.uuid);
                        }

                        tracing::info!("[OPENAI_STREAM] 开始转换流式响应");

                        // 使用新的统一流处理管道 (Kiro → OpenAI)
                        let config = PipelineConfig::kiro_to_openai(request.model.clone());
                        let pipeline = std::sync::Arc::new(tokio::sync::Mutex::new(
                            StreamPipeline::new(config),
                        ));

                        // 创建转换流
                        let pipeline_for_stream = pipeline.clone();
                        let pipeline_for_finalize = pipeline.clone();
                        let final_stream = async_stream::stream! {
                            use futures::StreamExt;

                            let mut stream_response = stream_response;

                            while let Some(chunk_result) = stream_response.next().await {
                                match chunk_result {
                                    Ok(bytes) => {
                                        tracing::debug!(
                                            "[OPENAI_STREAM] 收到 {} 字节数据",
                                            bytes.len()
                                        );

                                        // 使用 Pipeline 处理 chunk
                                        let sse_events = {
                                            let mut pipeline_guard = pipeline_for_stream.lock().await;
                                            pipeline_guard.process_chunk(&bytes)
                                        };

                                        tracing::debug!(
                                            "[OPENAI_STREAM] 生成 {} 个 SSE 事件",
                                            sse_events.len()
                                        );

                                        // yield 每个 SSE 事件
                                        for sse_str in sse_events {
                                            yield Ok::<String, StreamError>(sse_str);
                                        }
                                    }
                                    Err(e) => {
                                        tracing::error!("[OPENAI_STREAM] 流式传输错误: {}", e);
                                        yield Err(e);
                                        return;
                                    }
                                }
                            }

                            tracing::info!("[OPENAI_STREAM] 流结束，生成 finalize 事件");

                            // 流结束，使用 Pipeline 生成结束事件
                            let final_events = {
                                let mut pipeline_guard = pipeline_for_finalize.lock().await;
                                pipeline_guard.finish()
                            };

                            tracing::info!("[OPENAI_STREAM] finalize 生成 {} 个事件", final_events.len());

                            for sse_str in final_events {
                                yield Ok::<String, StreamError>(sse_str);
                            }
                        };

                        tracing::info!("[OPENAI_STREAM] 构建 SSE 响应");

                        // 转换为 Body 流
                        let body_stream = final_stream.map(|result| -> Result<axum::body::Bytes, std::io::Error> {
                            match result {
                                Ok(event) => Ok(axum::body::Bytes::from(event)),
                                Err(e) => Ok(axum::body::Bytes::from(e.to_sse_error())),
                            }
                        });

                        // 构建 SSE 响应
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
                        // 记录请求错误
                        if let Some(db) = &state.db {
                            let _ = state.pool_service.mark_unhealthy(db, &credential.uuid, Some(&e.to_string()));
                        }
                        return (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(serde_json::json!({"error": {"message": e.to_string()}})),
                        )
                            .into_response();
                    }
                }
            }

            // 非流式请求处理
            match kiro.call_api(request).await {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        // 记录成功
                        if let Some(db) = &state.db {
                            let _ = state.pool_service.mark_healthy(db, &credential.uuid, Some(&request.model));
                            let _ = state.pool_service.record_usage(db, &credential.uuid);
                        }
                        match resp.text().await {
                            Ok(body) => {
                                let parsed = parse_cw_response(&body);
                                let has_tool_calls = !parsed.tool_calls.is_empty();
                                let message = if has_tool_calls {
                                    serde_json::json!({
                                        "role": "assistant",
                                        "content": if parsed.content.is_empty() { serde_json::Value::Null } else { serde_json::json!(parsed.content) },
                                        "tool_calls": parsed.tool_calls.iter().map(|tc| {
                                            serde_json::json!({
                                                "id": tc.id,
                                                "type": "function",
                                                "function": {
                                                    "name": tc.function.name,
                                                    "arguments": tc.function.arguments
                                                }
                                            })
                                        }).collect::<Vec<_>>()
                                    })
                                } else {
                                    serde_json::json!({
                                        "role": "assistant",
                                        "content": parsed.content
                                    })
                                };
                                Json(serde_json::json!({
                                    "id": format!("chatcmpl-{}", uuid::Uuid::new_v4()),
                                    "object": "chat.completion",
                                    "created": std::time::SystemTime::now()
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .unwrap_or_default()
                                        .as_secs(),
                                    "model": request.model,
                                    "choices": [{
                                        "index": 0,
                                        "message": message,
                                        "finish_reason": if has_tool_calls { "tool_calls" } else { "stop" }
                                    }],
                                    "usage": {
                                        "prompt_tokens": 0,
                                        "completion_tokens": 0,
                                        "total_tokens": 0
                                    }
                                }))
                                .into_response()
                            }
                            Err(e) => (
                                StatusCode::INTERNAL_SERVER_ERROR,
                                Json(serde_json::json!({"error": {"message": e.to_string()}})),
                            )
                                .into_response(),
                        }
                    } else {
                        // 记录 API 调用失败
                        let body = resp.text().await.unwrap_or_default();
                        if let Some(db) = &state.db {
                            let _ = state.pool_service.mark_unhealthy(db, &credential.uuid, Some(&format!("HTTP {}: {}", status, safe_truncate(&body, 100))));
                        }
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(serde_json::json!({"error": {"message": body}})),
                        )
                            .into_response()
                    }
                }
                Err(e) => {
                    // 记录请求错误
                    if let Some(db) = &state.db {
                        let _ = state.pool_service.mark_unhealthy(db, &credential.uuid, Some(&e.to_string()));
                    }
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(serde_json::json!({"error": {"message": e.to_string()}})),
                    )
                        .into_response()
                }
            }
        }
        CredentialData::GeminiOAuth { .. } => {
            (
                StatusCode::NOT_IMPLEMENTED,
                Json(serde_json::json!({"error": {"message": "Gemini OAuth routing not yet implemented."}})),
            )
                .into_response()
        }
        CredentialData::AntigravityOAuth { creds_file_path, project_id } => {
            eprintln!("\n========== [ANTIGRAVITY] 开始处理 Antigravity 请求 ==========");
            eprintln!("[ANTIGRAVITY] 凭证文件: {creds_file_path}");
            eprintln!("[ANTIGRAVITY] 项目ID: {project_id:?}");
            eprintln!("[ANTIGRAVITY] 模型: {}", request.model);
            eprintln!("[ANTIGRAVITY] 流式: {}", request.stream);

            let mut antigravity = AntigravityProvider::new();
            if let Err(e) = antigravity.load_credentials_from_path(creds_file_path).await {
                eprintln!("[ANTIGRAVITY] 加载凭证失败: {e}");
                // 记录凭证加载失败
                if let Some(db) = &state.db {
                    let _ = state.pool_service.mark_unhealthy(
                        db,
                        &credential.uuid,
                        Some(&format!("Failed to load credentials: {e}")),
                    );
                }
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": {"message": format!("Failed to load Antigravity credentials: {}", e)}})),
                )
                    .into_response();
            }
            eprintln!("[ANTIGRAVITY] 凭证加载成功");

            // 使用新的 validate_token() 方法检查 Token 状态
            let validation_result = antigravity.validate_token();
            eprintln!("[ANTIGRAVITY] Token 验证结果: {validation_result:?}");
            eprintln!("[ANTIGRAVITY] needs_refresh() = {}", validation_result.needs_refresh());
            tracing::info!("[Antigravity] Token 验证结果: {:?}", validation_result);

            // 根据验证结果决定是否刷新
            if validation_result.needs_refresh() {
                eprintln!("[ANTIGRAVITY] Token 需要刷新，开始刷新...");
                tracing::info!("[Antigravity] Token 需要刷新，开始刷新...");
                match antigravity.refresh_token_with_retry(3).await {
                    Ok(new_token) => {
                        eprintln!("[ANTIGRAVITY] Token 刷新成功，新 token 长度: {}", new_token.len());
                        tracing::info!("[Antigravity] Token 刷新成功，新 token 长度: {}", new_token.len());
                        // 刷新成功，标记为健康
                        if let Some(db) = &state.db {
                            let _ = state.pool_service.mark_healthy(
                                db,
                                &credential.uuid,
                                None,
                            );
                        }
                    }
                    Err(refresh_error) => {
                        eprintln!("[ANTIGRAVITY] Token 刷新失败: {refresh_error:?}");
                        tracing::error!("[Antigravity] Token 刷新失败: {:?}", refresh_error);
                        // 使用新的 mark_unhealthy_with_details 方法
                        if let Some(db) = &state.db {
                            let _ = state.pool_service.mark_unhealthy_with_details(
                                db,
                                &credential.uuid,
                                &refresh_error,
                            );
                        }

                        // 根据错误类型返回不同的状态码和消息
                        let (status, message) = if refresh_error.requires_reauth() {
                            (StatusCode::UNAUTHORIZED, refresh_error.user_message())
                        } else {
                            (StatusCode::INTERNAL_SERVER_ERROR, refresh_error.user_message())
                        };

                        return (
                            status,
                            Json(serde_json::json!({"error": {"message": message}})),
                        )
                            .into_response();
                    }
                }
            } else {
                eprintln!("[ANTIGRAVITY] Token 不需要刷新，继续使用现有 Token");
            }

            // 设置项目 ID
            if let Some(pid) = project_id {
                antigravity.project_id = Some(pid.clone());
            } else if let Err(e) = antigravity.discover_project().await {
                tracing::warn!("[Antigravity] Failed to discover project: {}", e);
            }

            tracing::info!("[ANTIGRAVITY] request.stream = {}, model = {}, project_id = {:?}",
                request.stream, request.model, antigravity.project_id);

            // 检查是否为流式请求
            if request.stream {
                tracing::info!("[ANTIGRAVITY_STREAM] ========== 开始处理流式请求 ==========");
                tracing::info!("[ANTIGRAVITY_STREAM] model={}, has_token={}",
                    request.model, antigravity.credentials.access_token.is_some());

                // 检查是否是图片生成模型
                // 注意：gemini-3-pro-image-preview 是支持图片理解的模型，不是图片生成模型
                // 只有明确的图片生成模型才需要走非流式路径
                let is_image_generation_model = request.model == "imagen"
                    || request.model.starts_with("imagen-")
                    || request.model.contains("image-generation");
                tracing::info!("[ANTIGRAVITY_STREAM] is_image_generation_model={}", is_image_generation_model);

                // 对于图片生成模型，使用非流式请求然后模拟流式返回
                if is_image_generation_model {
                    tracing::info!("[ANTIGRAVITY_STREAM] 图片生成模型，使用非流式请求");

                    // 获取 project_id 用于请求
                    let proj_id = antigravity.project_id.clone().unwrap_or_default();
                    // 转换请求格式 - 这已经是完整的 Antigravity 请求格式
                    let antigravity_request = convert_openai_to_antigravity_with_context(request, &proj_id);

                    // 直接调用 call_api，因为 antigravity_request 已经是完整格式
                    match antigravity.call_api("generateContent", &antigravity_request).await {
                        Ok(resp) => {
                            let resp_str = serde_json::to_string_pretty(&resp).unwrap_or_default();
                            if is_lime_debug_enabled() {
                                let debug_dir = lime_core::app_paths::resolve_logs_dir()
                                    .unwrap_or_else(|_| std::env::temp_dir().join("lime").join("logs"));
                                let _ = std::fs::create_dir_all(&debug_dir);
                                let debug_file = debug_dir.join("antigravity_image_response.json");
                                let _ = std::fs::write(&debug_file, &resp_str);
                                tracing::info!(
                                    "[ANTIGRAVITY_STREAM] 原始响应已保存到: {:?}, 大小: {} bytes",
                                    debug_file,
                                    resp_str.len()
                                );
                                eprintln!(
                                    "[ANTIGRAVITY_STREAM] 原始响应已保存到: {:?}, 大小: {} bytes",
                                    debug_file,
                                    resp_str.len()
                                );
                            }

                            tracing::info!("[ANTIGRAVITY_STREAM] 图片生成完成，转换为流式响应");

                            // 将非流式响应转换为 OpenAI 格式
                            let openai_response = convert_antigravity_to_openai_response(&resp, &request.model);

                            let openai_str = serde_json::to_string_pretty(&openai_response).unwrap_or_default();
                            if is_lime_debug_enabled() {
                                let debug_dir = lime_core::app_paths::resolve_logs_dir()
                                    .unwrap_or_else(|_| std::env::temp_dir().join("lime").join("logs"));
                                let _ = std::fs::create_dir_all(&debug_dir);
                                let openai_debug_file =
                                    debug_dir.join("antigravity_image_openai_response.json");
                                let _ = std::fs::write(&openai_debug_file, &openai_str);
                                tracing::info!(
                                    "[ANTIGRAVITY_STREAM] OpenAI 响应已保存到: {:?}, 大小: {} bytes",
                                    openai_debug_file,
                                    openai_str.len()
                                );
                                eprintln!(
                                    "[ANTIGRAVITY_STREAM] OpenAI 响应已保存到: {:?}, 大小: {} bytes",
                                    openai_debug_file,
                                    openai_str.len()
                                );
                            }

                            // 将非流式响应转换为流式 SSE 格式
                            let model = request.model.clone();
                            let chunk_id = format!("chatcmpl-{}", uuid::Uuid::new_v4());
                            let created = chrono::Utc::now().timestamp();

                            // 提取内容
                            let content = openai_response
                                .get("choices")
                                .and_then(|c| c.as_array())
                                .and_then(|arr| arr.first())
                                .and_then(|choice| choice.get("message"))
                                .and_then(|msg| msg.get("content"))
                                .and_then(|c| c.as_str())
                                .unwrap_or("");

                            tracing::info!("[ANTIGRAVITY_STREAM] 图片内容长度: {} 字符", content.len());
                            eprintln!("[ANTIGRAVITY_STREAM] 图片内容长度: {} 字符", content.len());

                            // 构建 SSE 事件
                            let mut sse_events = String::new();

                            // 发送内容 chunk
                            if !content.is_empty() {
                                let chunk_response = serde_json::json!({
                                    "id": chunk_id,
                                    "object": "chat.completion.chunk",
                                    "created": created,
                                    "model": model,
                                    "choices": [{
                                        "index": 0,
                                        "delta": {
                                            "content": content
                                        },
                                        "finish_reason": null
                                    }]
                                });
                                sse_events.push_str(&format!("data: {chunk_response}\n\n"));
                            }

                            // 发送结束 chunk
                            let done_response = serde_json::json!({
                                "id": chunk_id,
                                "object": "chat.completion.chunk",
                                "created": created,
                                "model": model,
                                "choices": [{
                                    "index": 0,
                                    "delta": {},
                                    "finish_reason": "stop"
                                }]
                            });
                            sse_events.push_str(&format!("data: {done_response}\n\n"));
                            sse_events.push_str("data: [DONE]\n\n");

                            return Response::builder()
                                .status(StatusCode::OK)
                                .header(header::CONTENT_TYPE, "text/event-stream")
                                .header(header::CACHE_CONTROL, "no-cache")
                                .header(header::CONNECTION, "keep-alive")
                                .body(Body::from(sse_events))
                                .unwrap_or_else(|_| {
                                    (
                                        StatusCode::INTERNAL_SERVER_ERROR,
                                        Json(serde_json::json!({"error": {"message": "Failed to build streaming response"}})),
                                    )
                                        .into_response()
                                });
                        }
                        Err(api_err) => {
                            tracing::error!("[ANTIGRAVITY_STREAM] 图片生成失败 (HTTP {}): {}", api_err.status_code, api_err.message);
                            // 直接使用 AntigravityApiError 的状态码构建响应
                            return build_error_response_with_status(api_err.status_code, &api_err.to_string());
                        }
                    }
                }

                match antigravity.call_api_stream(request).await {
                    Ok(stream_response) => {
                        eprintln!("[ANTIGRAVITY_STREAM] ✓ 流式响应已建立");
                        tracing::info!("[ANTIGRAVITY_STREAM] ✓ 流式响应已建立");

                        let model = request.model.clone();

                        // Antigravity 返回的是分片的 JSON，需要累积所有数据后解析
                        // 使用 channel 来收集所有数据，然后一次性返回
                        let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();

                        // 在后台任务中收集所有数据
                        let model_clone = model.clone();
                        tokio::spawn(async move {
                            use futures::StreamExt;
                            let mut stream = stream_response;
                            let mut all_data = String::new();
                            let mut chunk_count = 0u32;

                            while let Some(result) = stream.next().await {
                                chunk_count += 1;
                                match result {
                                    Ok(bytes) => {
                                        let text = String::from_utf8_lossy(&bytes);
                                        all_data.push_str(&text);

                                        if chunk_count <= 3 {
                                            eprintln!("[ANTIGRAVITY_STREAM] 收集 chunk #{}: {} bytes", chunk_count, bytes.len());
                                        } else if chunk_count % 200 == 0 {
                                            eprintln!("[ANTIGRAVITY_STREAM] 已收集 {} 个 chunk, 总大小: {} bytes", chunk_count, all_data.len());
                                        }
                                    }
                                    Err(e) => {
                                        eprintln!("[ANTIGRAVITY_STREAM] chunk #{chunk_count} 错误: {e}");
                                        let _ = tx.send(Err(e.to_string()));
                                        return;
                                    }
                                }
                            }

                            eprintln!("[ANTIGRAVITY_STREAM] 流结束，共收集 {} 个 chunk, 总大小: {} bytes", chunk_count, all_data.len());

                            // 尝试解析累积的 JSON 数据
                            // Antigravity 返回格式: { "response": { "candidates": [...] } }
                            let result = parse_antigravity_accumulated_response(&all_data, &model_clone);
                            let _ = tx.send(result);
                        });

                        // 等待数据收集完成，然后构建 SSE 响应
                        let sse_stream = async_stream::stream! {
                            match rx.await {
                                Ok(Ok(sse_content)) => {
                                    // 返回累积的 SSE 事件
                                    yield Ok::<_, std::io::Error>(axum::body::Bytes::from(sse_content));
                                }
                                Ok(Err(e)) => {
                                    eprintln!("[ANTIGRAVITY_STREAM] 解析错误: {e}");
                                    let error_event = format!(
                                        "data: {{\"error\": {{\"message\": \"{}\"}}}}\n\ndata: [DONE]\n\n",
                                        e.replace("\"", "\\\"")
                                    );
                                    yield Ok(axum::body::Bytes::from(error_event));
                                }
                                Err(_) => {
                                    eprintln!("[ANTIGRAVITY_STREAM] channel 接收错误");
                                    let error_event = "data: {\"error\": {\"message\": \"Internal error\"}}\n\ndata: [DONE]\n\n";
                                    yield Ok(axum::body::Bytes::from(error_event.to_string()));
                                }
                            }
                        };

                        return Response::builder()
                            .status(StatusCode::OK)
                            .header(header::CONTENT_TYPE, "text/event-stream")
                            .header(header::CACHE_CONTROL, "no-cache")
                            .header(header::CONNECTION, "keep-alive")
                            .header("X-Accel-Buffering", "no")
                            .body(Body::from_stream(sse_stream))
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
                    Err(provider_err) => {
                        // call_api_stream 返回 ProviderError，使用字符串解析状态码
                        return build_error_response(&provider_err.to_string());
                    }
                }
            }

            // 非流式请求处理
            eprintln!("[ANTIGRAVITY_OPENAI] ========== 开始处理非流式请求 ==========");
            eprintln!("[ANTIGRAVITY_OPENAI] 模型: {}", request.model);

            // 获取 project_id 用于请求
            let proj_id = antigravity.project_id.clone().unwrap_or_default();
            eprintln!("[ANTIGRAVITY_OPENAI] 项目ID: {proj_id}");

            // 转换请求格式
            eprintln!("[ANTIGRAVITY_OPENAI] 开始转换请求格式...");
            let antigravity_request = convert_openai_to_antigravity_with_context(request, &proj_id);
            eprintln!("[ANTIGRAVITY_OPENAI] 请求格式转换完成");

            eprintln!("[ANTIGRAVITY_OPENAI] 调用 generate_content...");
            match antigravity.generate_content(&request.model, &antigravity_request).await {
                Ok(resp) => {
                    eprintln!("[ANTIGRAVITY_OPENAI] generate_content 返回成功");
                    let openai_response = convert_antigravity_to_openai_response(&resp, &request.model);
                    eprintln!("[ANTIGRAVITY_OPENAI] ========== 非流式请求处理完成 ==========");
                    Json(openai_response).into_response()
                }
                Err(api_err) => {
                    eprintln!("[ANTIGRAVITY_OPENAI] generate_content 失败 (HTTP {}): {}", api_err.status_code, api_err.message);
                    eprintln!("[ANTIGRAVITY_OPENAI] ========== 非流式请求处理失败 ==========");

                    // 直接使用 AntigravityApiError 的状态码构建响应
                    build_error_response_with_status(api_err.status_code, &api_err.to_string())
                }
            }
        }
        CredentialData::OpenAIKey { api_key, base_url } => {
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
        CredentialData::ClaudeKey { api_key, base_url } => {
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
        CredentialData::VertexKey { api_key, base_url, model_aliases } => {
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
        CredentialData::GeminiApiKey { .. } => {
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": {"message": "Gemini API Key credentials do not support OpenAI format yet"}})),
            )
                .into_response()
        }
        // AnthropicKey - 如果有自定义 base_url，使用 OpenAI 兼容格式调用
        CredentialData::AnthropicKey { api_key, base_url } => {
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
                                let _ = state.pool_service.mark_healthy(
                                    db,
                                    &credential.uuid,
                                    Some(&request.model),
                                );
                                let _ = state.pool_service.record_usage(db, &credential.uuid);
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
                                let _ = state.pool_service.mark_unhealthy(
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
                                let _ = state.pool_service.mark_healthy(
                                    db,
                                    &credential.uuid,
                                    Some(&request.model),
                                );
                                let _ = state.pool_service.record_usage(db, &credential.uuid);
                            }
                        } else if let Some(db) = &state.db {
                            let _ = state.pool_service.mark_unhealthy(
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
                            let _ = state.pool_service.mark_unhealthy(
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
        // Codex OAuth 凭证处理
        CredentialData::CodexOAuth {
            creds_file_path,
            api_base_url,
        } => {
            // 加载 Codex 凭证
            let mut codex = CodexProvider::new();
            if let Err(e) = codex.load_credentials_from_path(creds_file_path).await {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": {"message": format!("Failed to load Codex credentials: {}", e)}})),
                )
                    .into_response();
            }

            // 如果配置了自定义 API Base URL，覆盖凭证文件中的配置
            if let Some(base_url) = api_base_url {
                if !base_url.trim().is_empty() {
                    codex.credentials.api_base_url = Some(base_url.clone());
                }
            }

            // 确保 token 有效
            if let Err(e) = codex.ensure_valid_token().await {
                return (
                    StatusCode::UNAUTHORIZED,
                    Json(serde_json::json!({"error": {"message": format!("Codex token refresh failed: {}", e)}})),
                )
                    .into_response();
            }

            // 将 ChatCompletionRequest 转换为 serde_json::Value
            let request_json = match serde_json::to_value(request) {
                Ok(v) => v,
                Err(e) => {
                    return (
                        StatusCode::BAD_REQUEST,
                        Json(serde_json::json!({"error": {"message": format!("Failed to serialize request: {}", e)}})),
                    )
                        .into_response();
                }
            };

            // 调用 Codex API
            match codex.call_api(&request_json).await {
                Ok(response) => {
                    let status = response.status();
                    let headers = response.headers().clone();

                    // 检查是否为流式响应
                    if request.stream {
                        // 流式响应：读取 Codex SSE 流，转换为 OpenAI SSE 格式
                        // 参考 CLIProxyAPI: internal/translator/codex/openai/chat-completions/codex_openai_response.go
                        use std::sync::Arc;
                        use tokio::sync::Mutex;

                        let bytes_stream = response.bytes_stream();

                        // 创建转换状态（包含缓冲区）
                        struct StreamState {
                            convert_state: CodexConvertState,
                            buffer: String,
                        }

                        let state = Arc::new(Mutex::new(StreamState {
                            convert_state: CodexConvertState::default(),
                            buffer: String::new(),
                        }));

                        let converted_stream = bytes_stream.map(move |result| {
                            let state = Arc::clone(&state);
                            async move {
                                match result {
                                    Ok(bytes) => {
                                        let chunk = String::from_utf8_lossy(&bytes);
                                        let mut state = state.lock().await;
                                        state.buffer.push_str(&chunk);

                                        let mut output = String::new();

                                        // 处理缓冲区中的完整行
                                        while let Some(newline_pos) = state.buffer.find('\n') {
                                            let line = state.buffer[..newline_pos].to_string();
                                            state.buffer = state.buffer[newline_pos + 1..].to_string();

                                            if let Some(data) = line.strip_prefix("data: ") {
                                                if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                                                    if let Some(converted) = convert_codex_event_to_openai_sse_with_state(
                                                        &json,
                                                        &mut state.convert_state,
                                                    ) {
                                                        output.push_str(&format!("data: {converted}\n\n"));
                                                    }
                                                }
                                            }
                                        }

                                        Ok::<_, std::io::Error>(bytes::Bytes::from(output))
                                    }
                                    Err(e) => {
                                        tracing::error!("[Codex] Stream error: {}", e);
                                        Err(std::io::Error::other(e.to_string()))
                                    }
                                }
                            }
                        }).buffer_unordered(1).filter_map(|result| async move {
                            match result {
                                Ok(bytes) if !bytes.is_empty() => Some(Ok(bytes)),
                                Ok(_) => None,
                                Err(e) => Some(Err(e)),
                            }
                        });

                        let body = Body::from_stream(converted_stream);
                        let mut response_builder = Response::builder()
                            .status(status)
                            .header(header::CONTENT_TYPE, "text/event-stream")
                            .header(header::CACHE_CONTROL, "no-cache")
                            .header(header::CONNECTION, "keep-alive");

                        for (key, value) in headers.iter() {
                            if key != header::CONTENT_TYPE
                                && key != header::TRANSFER_ENCODING
                                && key != header::CONTENT_LENGTH
                            {
                                response_builder = response_builder.header(key, value);
                            }
                        }

                        response_builder.body(body).unwrap_or_else(|_| {
                            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to build response")
                                .into_response()
                        })
                    } else {
                        // 非流式响应：读取 SSE 流，解析 response.completed 事件，转换为 OpenAI 格式
                        // 参考 CLIProxyAPI: internal/translator/codex/openai/chat-completions/codex_openai_response.go
                        match response.bytes().await {
                            Ok(body) => {
                                // 解析 SSE 数据，查找 response.completed 事件
                                let body_str = String::from_utf8_lossy(&body);
                                let mut completed_data: Option<serde_json::Value> = None;

                                for line in body_str.lines() {
                                    if let Some(data) = line.strip_prefix("data: ") {
                                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                                            if json.get("type").and_then(|t| t.as_str()) == Some("response.completed") {
                                                completed_data = Some(json);
                                                break;
                                            }
                                        }
                                    }
                                }

                                match completed_data {
                                    Some(codex_response) => {
                                        // 转换为 OpenAI Chat Completions 格式
                                        let openai_response = convert_codex_to_openai_non_stream(&codex_response);
                                        Response::builder()
                                            .status(StatusCode::OK)
                                            .header(header::CONTENT_TYPE, "application/json")
                                            .body(Body::from(openai_response.to_string()))
                                            .unwrap_or_else(|_| {
                                                (StatusCode::INTERNAL_SERVER_ERROR, "Failed to build response")
                                                    .into_response()
                                            })
                                    }
                                    None => {
                                        tracing::error!("[Codex] No response.completed event found in SSE stream");
                                        (
                                            StatusCode::INTERNAL_SERVER_ERROR,
                                            Json(serde_json::json!({"error": {"message": "No response.completed event found in Codex response"}})),
                                        )
                                            .into_response()
                                    }
                                }
                            }
                            Err(e) => {
                                tracing::error!("[Codex] Failed to read response body: {}", e);
                                (
                                    StatusCode::INTERNAL_SERVER_ERROR,
                                    Json(serde_json::json!({"error": {"message": format!("Failed to read Codex response: {}", e)}})),
                                )
                                    .into_response()
                            }
                        }
                    }
                }
                Err(e) => {
                    tracing::error!("[Codex] API call failed: {}", e);
                    (
                        StatusCode::BAD_GATEWAY,
                        Json(serde_json::json!({"error": {"message": format!("Codex API call failed: {}", e)}})),
                    )
                        .into_response()
                }
            }
        }
        // 新增的凭证类型暂不支持 OpenAI 格式
        CredentialData::ClaudeOAuth { .. } => {
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": {"message": "This credential type does not support OpenAI format yet"}})),
            )
                .into_response()
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
pub fn get_stream_format_for_credential(credential: &ProviderCredential) -> StreamingFormat {
    match &credential.credential {
        CredentialData::KiroOAuth { .. } => StreamingFormat::AwsEventStream,
        CredentialData::ClaudeKey { .. } => StreamingFormat::AnthropicSse,
        CredentialData::OpenAIKey { .. } => StreamingFormat::OpenAiSse,
        // TODO: 任务 6 完成后，将这些改为 GeminiStream
        CredentialData::AntigravityOAuth { .. } => StreamingFormat::OpenAiSse,
        CredentialData::GeminiOAuth { .. } => StreamingFormat::OpenAiSse,
        CredentialData::GeminiApiKey { .. } => StreamingFormat::OpenAiSse,
        CredentialData::VertexKey { .. } => StreamingFormat::OpenAiSse,
        _ => StreamingFormat::OpenAiSse,
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

// ============================================================================
// Kiro 凭证真正流式响应处理
// ============================================================================

/// Kiro 凭证流式响应处理
///
/// 实现真正的端到端流式传输，将 AWS Event Stream 格式转换为 Anthropic SSE 格式。
///
/// # 参数
/// - `state`: 应用状态
/// - `credential`: Kiro 凭证信息
/// - `request`: Anthropic 格式请求
/// - `flow_id`: Flow ID（可选，用于流式响应处理）
///
/// # 需求覆盖
/// - 需求 1.1: 使用 reqwest 的流式响应模式
/// - 需求 1.2: 实时解析每个 JSON payload 并转换为 Anthropic SSE 事件
/// - 需求 1.3: 立即发送 content_block_delta 事件给客户端
/// - 需求 3.1: Flow Monitor 记录 chunk_count 大于 0
/// - 需求 3.2: 调用 process_chunk 更新流重建器
/// - 需求 3.3: 流完成时拥有完整的重建响应内容
/// - 需求 4.4: 在流式请求前检查 Token 是否即将过期（10分钟内）并提前刷新
pub async fn handle_kiro_stream(
    state: &AppState,
    credential: &ProviderCredential,
    request: &AnthropicMessagesRequest,
    flow_id: Option<&str>,
) -> Response {
    tracing::info!(
        "[KIRO_STREAM] handle_kiro_stream 被调用, model={}, flow_id={:?}",
        request.model,
        flow_id
    );

    // 提取凭证文件路径
    let creds_file_path = match &credential.credential {
        CredentialData::KiroOAuth { creds_file_path } => creds_file_path.clone(),
        _ => {
            tracing::error!("[KIRO_STREAM] 无效的凭证类型");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": {"message": "Invalid credential type for Kiro stream"}})),
            )
                .into_response();
        }
    };

    tracing::info!("[KIRO_STREAM] 凭证文件路径: {}", creds_file_path);

    // 获取数据库连接
    let db = match &state.db {
        Some(db) => db,
        None => {
            tracing::error!("[KIRO_STREAM] 数据库不可用");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": {"message": "Database not available"}})),
            )
                .into_response();
        }
    };

    // 获取有效 token（需求 4.4: 检查 Token 是否即将过期，10分钟内则提前刷新）
    let token = match state
        .token_cache
        .ensure_token_valid_for_streaming(db, &credential.uuid, 10)
        .await
    {
        Ok(t) => t,
        Err(e) => {
            tracing::warn!(
                "[KIRO_STREAM] Token validation failed, loading from source: {}",
                e
            );
            // 回退到从源文件加载
            let mut kiro = KiroProvider::new();
            if let Err(e) = kiro.load_credentials_from_path(&creds_file_path).await {
                let _ = state.pool_service.mark_unhealthy(
                    db,
                    &credential.uuid,
                    Some(&format!("Failed to load credentials: {e}")),
                );
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": {"message": format!("Failed to load Kiro credentials: {}", e)}})),
                )
                    .into_response();
            }
            if let Err(e) = kiro.refresh_token().await {
                let _ = state.pool_service.mark_unhealthy(
                    db,
                    &credential.uuid,
                    Some(&format!("Token refresh failed: {e}")),
                );
                return (
                    StatusCode::UNAUTHORIZED,
                    Json(serde_json::json!({"error": {"message": format!("Token refresh failed: {}", e)}})),
                )
                    .into_response();
            }
            kiro.credentials.access_token.unwrap_or_default()
        }
    };

    // 创建 KiroProvider 并设置 token
    let mut kiro = KiroProvider::new();
    // 从源文件加载其他配置（region, profile_arn 等）
    // 注意：必须先加载凭证文件，再设置 token，因为 load_credentials_from_path 会覆盖整个 credentials
    let _ = kiro.load_credentials_from_path(&creds_file_path).await;
    // 使用缓存的 token 覆盖文件中的 token（缓存的 token 更新）
    kiro.credentials.access_token = Some(token);

    tracing::info!("[KIRO_STREAM] 准备调用 call_api_stream_anthropic (直接转换)");

    // 调用流式 API - 直接使用 Anthropic 格式（需求 4.1, 4.2, 4.3: 401/403 错误重试逻辑）
    let stream_response = match kiro.call_api_stream_anthropic(request).await {
        Ok(stream) => {
            tracing::info!("[KIRO_STREAM] call_api_stream 成功返回流");
            stream
        }
        Err(e) => {
            tracing::error!("[KIRO_STREAM] call_api_stream 失败: {}", e);
            // 检查是否是 401/403 错误或 Token 过期，需要刷新 token 重试（需求 4.1）
            let needs_token_refresh = matches!(
                &e,
                lime_providers::providers::ProviderError::AuthenticationError(_)
                    | lime_providers::providers::ProviderError::TokenExpired(_)
            );

            if needs_token_refresh {
                tracing::info!(
                    "[KIRO_STREAM] Got auth/token error ({}), forcing token refresh for {}",
                    e.short_message(),
                    &credential.uuid[..8]
                );
                // 强制刷新 token（需求 4.1）
                let new_token = match state
                    .token_cache
                    .refresh_and_cache(db, &credential.uuid, true)
                    .await
                {
                    Ok(t) => t,
                    Err(refresh_err) => {
                        // 需求 4.3: Token 刷新失败时返回明确的错误信息
                        let _ = state.pool_service.mark_unhealthy(
                            db,
                            &credential.uuid,
                            Some(&format!("Token refresh failed: {refresh_err}")),
                        );
                        return (
                            StatusCode::UNAUTHORIZED,
                            Json(serde_json::json!({
                                "error": {
                                    "type": "authentication_error",
                                    "message": format!("Token refresh failed: {}", refresh_err)
                                }
                            })),
                        )
                            .into_response();
                    }
                };

                // 使用新 token 重试（需求 4.2）
                kiro.credentials.access_token = Some(new_token);
                match kiro.call_api_stream_anthropic(request).await {
                    Ok(stream) => stream,
                    Err(retry_err) => {
                        let _ = state.pool_service.mark_unhealthy(
                            db,
                            &credential.uuid,
                            Some(&retry_err.to_string()),
                        );
                        return (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(serde_json::json!({
                                "error": {
                                    "type": "api_error",
                                    "message": format!("Retry failed after token refresh: {}", retry_err)
                                }
                            })),
                        )
                            .into_response();
                    }
                }
            } else {
                let _ =
                    state
                        .pool_service
                        .mark_unhealthy(db, &credential.uuid, Some(&e.to_string()));
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({
                        "error": {
                            "type": "api_error",
                            "message": e.to_string()
                        }
                    })),
                )
                    .into_response();
            }
        }
    };

    // 记录成功
    let _ = state
        .pool_service
        .mark_healthy(db, &credential.uuid, Some(&request.model));
    let _ = state.pool_service.record_usage(db, &credential.uuid);

    tracing::info!(
        "[KIRO_STREAM] 开始处理流式响应, model={}, flow_id={:?}",
        request.model,
        flow_id
    );

    // 使用新的统一流处理管道 (Kiro → Anthropic)
    let config = PipelineConfig::kiro_to_anthropic(request.model.clone());
    let pipeline = std::sync::Arc::new(tokio::sync::Mutex::new(StreamPipeline::new(config)));

    let pipeline_clone = pipeline.clone();
    let pipeline_for_finalize = pipeline.clone();

    let final_stream = async_stream::stream! {
        use futures::StreamExt;

        let mut stream_response = stream_response;

        while let Some(chunk_result) = stream_response.next().await {
            match chunk_result {
                Ok(bytes) => {
                    tracing::info!(
                        "[KIRO_STREAM] 收到 {} 字节数据",
                        bytes.len()
                    );

                    let sse_strings = {
                        let mut pipeline_guard = pipeline_clone.lock().await;
                        pipeline_guard.process_chunk(&bytes)
                    };

                    tracing::info!(
                        "[KIRO_STREAM] 生成 {} 个 SSE 事件",
                        sse_strings.len()
                    );

                    for sse_str in sse_strings {
                        yield Ok::<String, StreamError>(sse_str);
                    }
                }
                Err(e) => {
                    tracing::error!("[KIRO_STREAM] 流式传输期间发生错误: {}", e);
                    yield Err(e);
                    return;
                }
            }
        }

        tracing::info!("[KIRO_STREAM] 流结束，生成 finalize 事件");

        let final_events = {
            let mut pipeline_guard = pipeline_for_finalize.lock().await;
            pipeline_guard.finish()
        };

        tracing::info!("[KIRO_STREAM] finalize 生成 {} 个事件", final_events.len());

        for sse_str in final_events {
            yield Ok::<String, StreamError>(sse_str);
        }
    };

    tracing::info!("[KIRO_STREAM] 构建 SSE 响应");

    // 转换为 Body 流
    let body_stream = final_stream.map(|result| -> Result<axum::body::Bytes, std::io::Error> {
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
        })
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
