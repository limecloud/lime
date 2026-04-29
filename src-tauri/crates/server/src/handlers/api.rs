//! API 端点处理器
//!
//! 处理 OpenAI 和 Anthropic 格式的 API 请求
//!
//! # 流式传输支持

#![allow(dead_code)]
//!
//! 本模块支持真正的端到端流式传输：
//! - 对于流式请求，使用 StreamManager 处理响应
//! - 集成 Flow Monitor 实时捕获流式内容
//!
//! # 需求覆盖
//!
//! - 需求 5.1: 在收到 chunk 后立即转发给客户端
//! - 需求 5.3: 流中发生错误时发送错误事件并优雅关闭流

use axum::{
    body::{to_bytes, Body},
    extract::State,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use std::{
    collections::{HashMap, HashSet},
    future::Future,
    sync::Arc,
};

use crate::client_detector::ClientType;
use crate::middleware::request_dedup::{
    build_request_fingerprint, RequestDedupCheck, RequestDedupStore,
};
use crate::middleware::response_cache::{CachedHttpResponse, ResponseCacheStore};
use crate::{record_request_telemetry, record_token_usage, AppState};
use aster::context::MODEL_CONTEXT_WINDOWS;
use aster::session_context::{
    PENDING_REQUEST_ID_HEADER, QUEUED_TURN_ID_HEADER, SESSION_ID_HEADER,
    SUBAGENT_SESSION_ID_HEADER, THREAD_ID_HEADER, TURN_ID_HEADER,
};
use lime_core::errors::GatewayErrorCode;
use lime_core::models::anthropic::AnthropicMessagesRequest;
use lime_core::models::openai::{ChatCompletionRequest, ContentPart, MessageContent};
use lime_core::models::{RuntimeCredentialData, RuntimeProviderCredential};
use lime_core::ProviderType;
use lime_processor::RequestContext;
use lime_providers::streaming::StreamFormat as StreamingFormat;
use lime_server_utils::{
    build_error_response_with_meta, build_gateway_error_json, message_content_len,
};

use super::{call_provider_anthropic, call_provider_openai};

async fn select_credential_for_request(
    state: &AppState,
    request_id: Option<&str>,
    selected_provider: &str,
    _model: &str,
    client_type: &ClientType,
    explicit_provider_id: Option<&str>,
    log_prefix: &str,
    _include_error_code: bool,
) -> Result<Option<RuntimeProviderCredential>, Response> {
    let db = match &state.db {
        Some(db) => db,
        None => {
            eprintln!("[{log_prefix}] 数据库未初始化!");
            return Ok(None);
        }
    };

    if let Some(explicit_provider_id) = explicit_provider_id {
        eprintln!("[{log_prefix}] 使用 X-Provider-Id 指定的 provider: {explicit_provider_id}");
        let cred = state
            .api_key_service
            .select_credential_for_provider(
                db,
                explicit_provider_id,
                Some(explicit_provider_id),
                Some(client_type),
            )
            .await
            .ok()
            .flatten();

        if cred.is_none() {
            eprintln!(
                "[{log_prefix}] X-Provider-Id '{explicit_provider_id}' 没有可用凭证，不切换 Provider"
            );
            state.logs.write().await.add(
                "error",
                &format!(
                    "[ROUTE] No available credentials for explicitly specified provider '{explicit_provider_id}', refusing provider switch"
                ),
            );

            return Err(build_error_response_with_meta(
                StatusCode::SERVICE_UNAVAILABLE.as_u16(),
                &format!(
                    "No available credentials for provider '{}'",
                    explicit_provider_id
                ),
                request_id,
                Some(explicit_provider_id),
                Some(GatewayErrorCode::NoCredentials),
            ));
        }

        return Ok(cred);
    }

    if !state.allow_provider_fallback {
        eprintln!(
            "[{log_prefix}] 已禁用 Provider 自动切换（retry.auto_switch_provider=false），仅从 API Key Provider 选择"
        );
        return match state
            .api_key_service
            .select_credential_for_provider(
                db,
                selected_provider,
                Some(selected_provider),
                Some(client_type),
            )
            .await
        {
            Ok(cred) => {
                if cred.is_some() {
                    eprintln!("[{log_prefix}] 找到凭证: provider={selected_provider}");
                } else {
                    eprintln!(
                        "[{log_prefix}] 未找到凭证: provider={selected_provider}（Provider 自动切换已禁用）"
                    );
                }
                Ok(cred)
            }
            Err(e) => {
                eprintln!("[{log_prefix}] 选择凭证失败: {e}");
                Ok(None)
            }
        };
    }

    let provider_id_hint = selected_provider.to_lowercase();
    match state
        .api_key_service
        .select_credential_for_provider(
            db,
            selected_provider,
            Some(provider_id_hint.as_str()),
            Some(client_type),
        )
        .await
    {
        Ok(cred) => {
            if cred.is_some() {
                eprintln!("[{log_prefix}] 找到凭证: provider={selected_provider}");
            } else {
                eprintln!("[{log_prefix}] 未找到凭证: provider={selected_provider}");
            }
            Ok(cred)
        }
        Err(e) => {
            eprintln!("[{log_prefix}] 选择凭证失败: {e}");
            Ok(None)
        }
    }
}

async fn call_with_single_provider_resilience<F, Fut>(
    state: &AppState,
    request_id: &str,
    provider_label: &str,
    is_stream: bool,
    mut operation: F,
) -> Response
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Response>,
{
    let retrier = state.processor.retrier.clone();
    let timeout_controller = state.processor.timeout.clone();
    let max_retries = if is_stream {
        0
    } else {
        retrier.config().max_retries
    };
    let total_attempts = max_retries + 1;
    let mut attempt = 0u32;

    loop {
        attempt += 1;

        let response = match timeout_controller.execute_with_timeout(operation()).await {
            Ok(resp) => resp,
            Err(timeout_err) => {
                if attempt <= max_retries {
                    let delay = retrier.backoff_delay(attempt - 1);
                    state.logs.write().await.add(
                        "warn",
                        &format!(
                            "[RETRY] request_id={} provider={} attempt={}/{} timeout={} delay_ms={}",
                            request_id,
                            provider_label,
                            attempt,
                            total_attempts,
                            timeout_err,
                            delay.as_millis()
                        ),
                    );
                    tokio::time::sleep(delay).await;
                    continue;
                }

                state.logs.write().await.add(
                    "error",
                    &format!(
                        "[TIMEOUT] request_id={} provider={} attempts={} error={}",
                        request_id, provider_label, attempt, timeout_err
                    ),
                );

                return build_error_response_with_meta(
                    StatusCode::GATEWAY_TIMEOUT.as_u16(),
                    &format!("Provider request timeout: {}", timeout_err),
                    Some(request_id),
                    Some(provider_label),
                    Some(GatewayErrorCode::UpstreamTimeout),
                );
            }
        };

        let status_code = response.status().as_u16();
        let should_retry = attempt <= max_retries && retrier.config().is_retryable(status_code);

        if should_retry {
            let delay = retrier.backoff_delay(attempt - 1);

            if status_code == StatusCode::TOO_MANY_REQUESTS.as_u16() {
                state.logs.write().await.add(
                    "warn",
                    &format!(
                        "[QUOTA] request_id={} provider={} attempt={}/{} status=429",
                        request_id, provider_label, attempt, total_attempts
                    ),
                );
            }

            state.logs.write().await.add(
                "warn",
                &format!(
                    "[RETRY] request_id={} provider={} attempt={}/{} status={} delay_ms={}",
                    request_id,
                    provider_label,
                    attempt,
                    total_attempts,
                    status_code,
                    delay.as_millis()
                ),
            );
            tokio::time::sleep(delay).await;
            continue;
        }

        if attempt > 1 {
            state.logs.write().await.add(
                "info",
                &format!(
                    "[RETRY] request_id={} provider={} completed attempts={} final_status={}",
                    request_id, provider_label, attempt, status_code
                ),
            );
        }

        return response;
    }
}

const REPLAY_CAPTURE_MAX_BYTES: usize = 2 * 1024 * 1024;

struct IdempotencyGuard {
    key: Option<String>,
    store: Arc<crate::middleware::idempotency::IdempotencyStore>,
    is_stream: bool,
    finalized: bool,
}

impl IdempotencyGuard {
    fn new(
        key: Option<String>,
        is_stream: bool,
        store: Arc<crate::middleware::idempotency::IdempotencyStore>,
    ) -> Self {
        Self {
            key,
            store,
            is_stream,
            finalized: false,
        }
    }

    fn is_enabled(&self) -> bool {
        !self.is_stream && self.key.is_some()
    }

    fn complete(&mut self, status: u16, body: String) {
        if !self.is_enabled() || self.finalized {
            return;
        }
        if let Some(ref key) = self.key {
            self.store.complete(key, status, body);
            self.finalized = true;
        }
    }

    fn remove(&mut self) {
        if !self.is_enabled() || self.finalized {
            return;
        }
        if let Some(ref key) = self.key {
            self.store.remove(key);
        }
        self.finalized = true;
    }
}

impl Drop for IdempotencyGuard {
    fn drop(&mut self) {
        if !self.finalized {
            self.remove();
        }
    }
}

struct RequestDedupGuard {
    key: Option<String>,
    store: Arc<RequestDedupStore>,
    is_stream: bool,
    finalized: bool,
}

impl RequestDedupGuard {
    fn disabled(store: Arc<RequestDedupStore>) -> Self {
        Self {
            key: None,
            store,
            is_stream: true,
            finalized: true,
        }
    }

    fn new(key: Option<String>, is_stream: bool, store: Arc<RequestDedupStore>) -> Self {
        Self {
            key,
            store,
            is_stream,
            finalized: false,
        }
    }

    fn is_enabled(&self) -> bool {
        !self.is_stream && self.key.is_some()
    }

    fn complete(&mut self, status: u16, body: String) {
        if !self.is_enabled() || self.finalized {
            return;
        }
        if let Some(ref key) = self.key {
            self.store.complete(key, status, body);
        }
        self.finalized = true;
    }

    fn remove(&mut self) {
        if !self.is_enabled() || self.finalized {
            return;
        }
        if let Some(ref key) = self.key {
            self.store.remove(key);
        }
        self.finalized = true;
    }
}

impl Drop for RequestDedupGuard {
    fn drop(&mut self) {
        if !self.finalized {
            self.remove();
        }
    }
}

struct ResponseCacheGuard {
    key: Option<String>,
    store: Arc<ResponseCacheStore>,
    is_stream: bool,
    finalized: bool,
}

impl ResponseCacheGuard {
    fn disabled(store: Arc<ResponseCacheStore>) -> Self {
        Self {
            key: None,
            store,
            is_stream: true,
            finalized: true,
        }
    }

    fn new(key: Option<String>, is_stream: bool, store: Arc<ResponseCacheStore>) -> Self {
        Self {
            key,
            store,
            is_stream,
            finalized: false,
        }
    }

    fn is_enabled(&self) -> bool {
        !self.is_stream && self.key.is_some()
    }

    fn should_cache_status(&self, status: u16) -> bool {
        self.store.should_cache_status(status)
    }

    fn complete(&mut self, status: u16, headers: HashMap<String, String>, body: String) {
        if !self.is_enabled() || self.finalized {
            return;
        }

        if let Some(ref key) = self.key {
            let _ = self.store.set(
                key,
                CachedHttpResponse {
                    status,
                    headers,
                    body,
                },
            );
        }
        self.finalized = true;
    }

    fn skip(&mut self) {
        self.finalized = true;
    }
}

impl Drop for ResponseCacheGuard {
    fn drop(&mut self) {
        if !self.finalized {
            self.skip();
        }
    }
}

fn headers_to_string_map(headers: &axum::http::HeaderMap) -> HashMap<String, String> {
    headers
        .iter()
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|v| (name.as_str().to_string(), v.to_string()))
        })
        .collect()
}

fn attach_request_correlation_metadata(ctx: &mut RequestContext, headers: &HeaderMap) {
    const REQUEST_TELEMETRY_HEADERS: [(&str, &str); 6] = [
        (SESSION_ID_HEADER, "session_id"),
        (THREAD_ID_HEADER, "thread_id"),
        (TURN_ID_HEADER, "turn_id"),
        (PENDING_REQUEST_ID_HEADER, "pending_request_id"),
        (QUEUED_TURN_ID_HEADER, "queued_turn_id"),
        (SUBAGENT_SESSION_ID_HEADER, "subagent_session_id"),
    ];

    for (header_name, metadata_key) in REQUEST_TELEMETRY_HEADERS {
        if let Some(value) = headers
            .get(header_name)
            .and_then(|value| value.to_str().ok())
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            ctx.set_metadata(metadata_key, serde_json::Value::String(value.to_string()));
        }
    }
}

fn set_request_id_header(response: &mut Response, request_id: &str) {
    if let Ok(value) = header::HeaderValue::from_str(request_id) {
        response
            .headers_mut()
            .insert(header::HeaderName::from_static("x-lime-request-id"), value);
    }
}

fn set_static_diag_header(response: &mut Response, name: &'static str, value: &'static str) {
    response.headers_mut().insert(
        header::HeaderName::from_static(name),
        header::HeaderValue::from_static(value),
    );
}

fn attach_route_debug_headers(
    mut response: Response,
    requested_provider: &str,
    effective_provider: &str,
    model: &str,
) -> Response {
    if let Ok(value) = header::HeaderValue::from_str(requested_provider) {
        response.headers_mut().insert(
            header::HeaderName::from_static("x-lime-requested-provider"),
            value,
        );
    }
    if let Ok(value) = header::HeaderValue::from_str(effective_provider) {
        response.headers_mut().insert(
            header::HeaderName::from_static("x-lime-effective-provider"),
            value,
        );
    }
    if let Ok(value) = header::HeaderValue::from_str(model) {
        response
            .headers_mut()
            .insert(header::HeaderName::from_static("x-lime-model"), value);
    }
    response
}

fn build_cached_response(response: CachedHttpResponse) -> Response {
    let status = StatusCode::from_u16(response.status).unwrap_or(StatusCode::OK);
    let mut resp = Response::new(Body::from(response.body));
    *resp.status_mut() = status;
    for (key, value) in response.headers {
        if let (Ok(name), Ok(val)) = (
            axum::http::HeaderName::from_bytes(key.as_bytes()),
            axum::http::HeaderValue::from_str(&value),
        ) {
            resp.headers_mut().insert(name, val);
        }
    }
    set_static_diag_header(&mut resp, "x-lime-cache", "hit");
    set_static_diag_header(&mut resp, "x-lime-source", "response-cache");
    resp
}

fn has_no_cache_header(headers: &HeaderMap) -> bool {
    let cache_control = headers
        .get(header::CACHE_CONTROL)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_lowercase();
    let pragma = headers
        .get(header::PRAGMA)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_lowercase();
    cache_control.contains("no-cache") || pragma.contains("no-cache")
}

fn request_explicitly_disables_cache(value: &serde_json::Value) -> bool {
    let Some(obj) = value.as_object() else {
        return false;
    };
    obj.get("cache").and_then(|v| v.as_bool()) == Some(false)
        || obj.get("no_cache").and_then(|v| v.as_bool()) == Some(true)
}

fn replay_response(status: u16, body: String) -> Response {
    let status_code = StatusCode::from_u16(status).unwrap_or(StatusCode::OK);
    (status_code, body).into_response()
}

async fn begin_request_dedup(
    request_id: &str,
    endpoint: &str,
    request_payload: &serde_json::Value,
    is_stream: bool,
    has_idempotency_key: bool,
    store: Arc<RequestDedupStore>,
) -> Result<RequestDedupGuard, Response> {
    if is_stream || has_idempotency_key || !store.is_enabled() {
        return Ok(RequestDedupGuard::disabled(store));
    }

    let fingerprint = build_request_fingerprint(&serde_json::json!({
        "endpoint": endpoint,
        "payload": request_payload
    }));
    let key = format!("{endpoint}:{fingerprint}");

    match store.check_or_register(&key) {
        RequestDedupCheck::New => Ok(RequestDedupGuard::new(Some(key), is_stream, store)),
        RequestDedupCheck::Completed { status, body } => {
            let mut response = replay_response(status, body);
            set_request_id_header(&mut response, request_id);
            set_static_diag_header(&mut response, "x-lime-dedup", "replay");
            set_static_diag_header(&mut response, "x-lime-source", "request-dedup");
            Err(response)
        }
        RequestDedupCheck::InProgress { notify } => {
            match store.wait_for_completion(&key, notify).await {
                Some(replay) => {
                    let mut response = replay_response(replay.status, replay.body);
                    set_request_id_header(&mut response, request_id);
                    set_static_diag_header(&mut response, "x-lime-dedup", "wait-replay");
                    set_static_diag_header(&mut response, "x-lime-source", "request-dedup");
                    Err(response)
                }
                None => {
                    tracing::warn!(
                        "[REQUEST_DEDUP] request_id={} endpoint={} wait timeout for key={}",
                        request_id,
                        endpoint,
                        key
                    );
                    let mut response = build_error_response_with_meta(
                        StatusCode::CONFLICT.as_u16(),
                        "Equivalent request is still in progress, please retry later",
                        Some(request_id),
                        None,
                        Some(GatewayErrorCode::RequestConflict),
                    );
                    set_request_id_header(&mut response, request_id);
                    set_static_diag_header(&mut response, "x-lime-dedup", "wait-timeout");
                    Err(response)
                }
            }
        }
    }
}

async fn begin_response_cache(
    request_id: &str,
    endpoint: &str,
    request_payload: &serde_json::Value,
    headers: &HeaderMap,
    is_stream: bool,
    has_idempotency_key: bool,
    store: Arc<ResponseCacheStore>,
) -> Result<ResponseCacheGuard, Response> {
    if is_stream || has_idempotency_key || !store.is_enabled() || has_no_cache_header(headers) {
        return Ok(ResponseCacheGuard::disabled(store));
    }

    if request_explicitly_disables_cache(request_payload) {
        return Ok(ResponseCacheGuard::disabled(store));
    }

    let fingerprint = build_request_fingerprint(&serde_json::json!({
        "endpoint": endpoint,
        "payload": request_payload
    }));
    let key = format!("{endpoint}:{fingerprint}");

    if let Some(cached) = store.get(&key) {
        let mut response = build_cached_response(cached);
        set_request_id_header(&mut response, request_id);
        return Err(response);
    }

    Ok(ResponseCacheGuard::new(Some(key), is_stream, store))
}

type UsageParser = fn(&serde_json::Value) -> Option<(u32, u32)>;

struct UsageCapture<'a> {
    state: &'a AppState,
    ctx: &'a RequestContext,
    parser: UsageParser,
    fallback_input_tokens: Option<u32>,
    fallback_output_tokens: Option<u32>,
}

fn clamp_usage_tokens(value: u64) -> u32 {
    value.min(u32::MAX as u64) as u32
}

fn extract_openai_usage_tokens(payload: &serde_json::Value) -> Option<(u32, u32)> {
    let usage = payload.get("usage")?;
    let prompt_tokens = usage.get("prompt_tokens")?.as_u64()?;
    let completion_tokens = usage.get("completion_tokens")?.as_u64()?;

    Some((
        clamp_usage_tokens(prompt_tokens),
        clamp_usage_tokens(completion_tokens),
    ))
}

fn anthropic_prompt_tokens(usage: &serde_json::Value) -> u64 {
    usage
        .get("input_tokens")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0)
        + usage
            .get("cache_creation_input_tokens")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0)
        + usage
            .get("cache_read_input_tokens")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0)
}

fn extract_anthropic_usage_tokens(payload: &serde_json::Value) -> Option<(u32, u32)> {
    let usage = payload.get("usage")?;
    let prompt_tokens = anthropic_prompt_tokens(usage);
    let completion_tokens = usage.get("output_tokens")?.as_u64()?;

    Some((
        clamp_usage_tokens(prompt_tokens),
        clamp_usage_tokens(completion_tokens),
    ))
}

fn record_captured_token_usage(
    capture: &UsageCapture<'_>,
    response_status: StatusCode,
    response_body: &[u8],
) {
    if !response_status.is_success() {
        return;
    }

    let parsed_usage = serde_json::from_slice::<serde_json::Value>(response_body)
        .ok()
        .and_then(|payload| (capture.parser)(&payload));

    let usage = parsed_usage.or_else(|| {
        match (
            capture.fallback_input_tokens,
            capture.fallback_output_tokens,
        ) {
            (Some(input_tokens), Some(output_tokens)) => Some((input_tokens, output_tokens)),
            _ => None,
        }
    });

    if let Some((input_tokens, output_tokens)) = usage {
        record_token_usage(
            capture.state,
            capture.ctx,
            Some(input_tokens),
            Some(output_tokens),
        );
    }
}

async fn finalize_replayable_response(
    response: Response,
    guard: &mut IdempotencyGuard,
    dedup_guard: &mut RequestDedupGuard,
    cache_guard: &mut ResponseCacheGuard,
    request_id: &str,
) -> Response {
    finalize_replayable_response_with_usage_capture(
        response,
        guard,
        dedup_guard,
        cache_guard,
        request_id,
        None,
    )
    .await
}

async fn finalize_replayable_response_with_usage_capture(
    mut response: Response,
    guard: &mut IdempotencyGuard,
    dedup_guard: &mut RequestDedupGuard,
    cache_guard: &mut ResponseCacheGuard,
    request_id: &str,
    usage_capture: Option<UsageCapture<'_>>,
) -> Response {
    set_request_id_header(&mut response, request_id);

    if !guard.is_enabled()
        && !dedup_guard.is_enabled()
        && !cache_guard.is_enabled()
        && usage_capture.is_none()
    {
        return response;
    }

    let status = response.status().as_u16();
    if status >= 500 {
        guard.remove();
        dedup_guard.remove();
        cache_guard.skip();
        if guard.is_enabled() {
            set_static_diag_header(&mut response, "x-lime-idempotency", "removed-on-error");
        }
        if dedup_guard.is_enabled() {
            set_static_diag_header(&mut response, "x-lime-dedup", "removed-on-error");
        }
        if cache_guard.is_enabled() {
            set_static_diag_header(&mut response, "x-lime-cache", "skip-on-error");
        }
        return response;
    }

    let (parts, body) = response.into_parts();
    match to_bytes(body, REPLAY_CAPTURE_MAX_BYTES).await {
        Ok(bytes) => {
            if let Some(capture) = usage_capture.as_ref() {
                record_captured_token_usage(capture, parts.status, &bytes);
            }
            let body_string = String::from_utf8_lossy(&bytes).to_string();
            let headers_map = headers_to_string_map(&parts.headers);
            guard.complete(status, body_string.clone());
            dedup_guard.complete(status, body_string.clone());
            if cache_guard.should_cache_status(status) {
                cache_guard.complete(status, headers_map, body_string);
            } else {
                cache_guard.skip();
            }
            let mut response = Response::from_parts(parts, Body::from(bytes));
            set_request_id_header(&mut response, request_id);
            if guard.is_enabled() {
                set_static_diag_header(&mut response, "x-lime-idempotency", "new");
            }
            if dedup_guard.is_enabled() {
                set_static_diag_header(&mut response, "x-lime-dedup", "new");
            }
            if cache_guard.is_enabled() {
                if cache_guard.should_cache_status(status) {
                    set_static_diag_header(&mut response, "x-lime-cache", "store");
                } else {
                    set_static_diag_header(&mut response, "x-lime-cache", "skip-status");
                }
            }
            response
        }
        Err(err) => {
            tracing::warn!(
                "[REPLAY] request_id={} failed to capture response body: {}",
                request_id,
                err
            );
            guard.remove();
            dedup_guard.remove();
            cache_guard.skip();
            let mut response = build_error_response_with_meta(
                StatusCode::INTERNAL_SERVER_ERROR.as_u16(),
                "Failed to capture response for replay",
                Some(request_id),
                None,
                Some(GatewayErrorCode::InternalError),
            );
            set_request_id_header(&mut response, request_id);
            set_static_diag_header(&mut response, "x-lime-source", "replay-capture-error");
            response
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::middleware::idempotency::{IdempotencyCheck, IdempotencyConfig, IdempotencyStore};
    use crate::middleware::request_dedup::RequestDedupConfig;
    use crate::middleware::response_cache::ResponseCacheConfig;

    fn create_store() -> Arc<IdempotencyStore> {
        Arc::new(IdempotencyStore::new(IdempotencyConfig {
            enabled: true,
            ttl_secs: 60,
            header_name: "Idempotency-Key".to_string(),
        }))
    }

    #[test]
    fn attach_request_correlation_metadata_should_copy_headers_into_context() {
        let mut headers = HeaderMap::new();
        headers.insert(
            SESSION_ID_HEADER,
            header::HeaderValue::from_static("session-1"),
        );
        headers.insert(
            THREAD_ID_HEADER,
            header::HeaderValue::from_static("thread-1"),
        );
        headers.insert(TURN_ID_HEADER, header::HeaderValue::from_static("turn-1"));
        headers.insert(
            PENDING_REQUEST_ID_HEADER,
            header::HeaderValue::from_static("pending-1"),
        );
        headers.insert(
            QUEUED_TURN_ID_HEADER,
            header::HeaderValue::from_static("queued-1"),
        );
        headers.insert(
            SUBAGENT_SESSION_ID_HEADER,
            header::HeaderValue::from_static("subagent-1"),
        );

        let mut ctx = RequestContext::new("gpt-5.4".to_string());
        attach_request_correlation_metadata(&mut ctx, &headers);

        assert_eq!(
            ctx.get_metadata("session_id")
                .and_then(serde_json::Value::as_str),
            Some("session-1")
        );
        assert_eq!(
            ctx.get_metadata("thread_id")
                .and_then(serde_json::Value::as_str),
            Some("thread-1")
        );
        assert_eq!(
            ctx.get_metadata("turn_id")
                .and_then(serde_json::Value::as_str),
            Some("turn-1")
        );
        assert_eq!(
            ctx.get_metadata("pending_request_id")
                .and_then(serde_json::Value::as_str),
            Some("pending-1")
        );
        assert_eq!(
            ctx.get_metadata("queued_turn_id")
                .and_then(serde_json::Value::as_str),
            Some("queued-1")
        );
        assert_eq!(
            ctx.get_metadata("subagent_session_id")
                .and_then(serde_json::Value::as_str),
            Some("subagent-1")
        );
    }

    #[tokio::test]
    async fn finalize_idempotency_response_should_complete_for_non_5xx() {
        let store = create_store();
        let key = "idem-complete-1".to_string();

        assert!(matches!(store.check(&key), IdempotencyCheck::New));

        let mut guard = IdempotencyGuard::new(Some(key.clone()), false, store.clone());
        let response = (StatusCode::OK, r#"{"ok":true}"#).into_response();
        let dedup_store = Arc::new(RequestDedupStore::new(Default::default()));
        let mut dedup_guard = RequestDedupGuard::disabled(dedup_store);
        let cache_store = Arc::new(ResponseCacheStore::new(ResponseCacheConfig::default()));
        let mut cache_guard = ResponseCacheGuard::disabled(cache_store);
        let finalized = finalize_replayable_response(
            response,
            &mut guard,
            &mut dedup_guard,
            &mut cache_guard,
            "req-1",
        )
        .await;

        assert_eq!(finalized.status(), StatusCode::OK);
        match store.check(&key) {
            IdempotencyCheck::Completed { status, body } => {
                assert_eq!(status, 200);
                assert_eq!(body, r#"{"ok":true}"#);
            }
            other => panic!("expected completed response, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn finalize_idempotency_response_should_remove_for_5xx() {
        let store = create_store();
        let key = "idem-remove-1".to_string();

        assert!(matches!(store.check(&key), IdempotencyCheck::New));

        let mut guard = IdempotencyGuard::new(Some(key.clone()), false, store.clone());
        let response = (
            StatusCode::INTERNAL_SERVER_ERROR,
            r#"{"error":"upstream failed"}"#,
        )
            .into_response();
        let dedup_store = Arc::new(RequestDedupStore::new(Default::default()));
        let mut dedup_guard = RequestDedupGuard::disabled(dedup_store);
        let cache_store = Arc::new(ResponseCacheStore::new(ResponseCacheConfig::default()));
        let mut cache_guard = ResponseCacheGuard::disabled(cache_store);
        let finalized = finalize_replayable_response(
            response,
            &mut guard,
            &mut dedup_guard,
            &mut cache_guard,
            "req-2",
        )
        .await;

        assert_eq!(finalized.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert!(matches!(store.check(&key), IdempotencyCheck::New));
    }

    #[test]
    fn idempotency_guard_drop_should_remove_inflight() {
        let store = create_store();
        let key = "idem-drop-1".to_string();

        assert!(matches!(store.check(&key), IdempotencyCheck::New));

        {
            let _guard = IdempotencyGuard::new(Some(key.clone()), false, store.clone());
        }

        assert!(matches!(store.check(&key), IdempotencyCheck::New));
    }

    #[tokio::test]
    async fn finalize_replayable_response_should_complete_dedup_for_non_5xx() {
        let idem_store = create_store();
        let dedup_store = Arc::new(RequestDedupStore::new(RequestDedupConfig {
            enabled: true,
            ttl_secs: 30,
            wait_timeout_ms: 1000,
        }));
        let key = "dedup-complete-1".to_string();

        assert!(matches!(
            dedup_store.check_or_register(&key),
            RequestDedupCheck::New
        ));

        let mut idem_guard = IdempotencyGuard::new(None, false, idem_store);
        let mut dedup_guard = RequestDedupGuard::new(Some(key.clone()), false, dedup_store.clone());
        let cache_store = Arc::new(ResponseCacheStore::new(ResponseCacheConfig::default()));
        let mut cache_guard = ResponseCacheGuard::disabled(cache_store);

        let response = (StatusCode::OK, r#"{"ok":true}"#).into_response();
        let finalized = finalize_replayable_response(
            response,
            &mut idem_guard,
            &mut dedup_guard,
            &mut cache_guard,
            "req-3",
        )
        .await;

        assert_eq!(finalized.status(), StatusCode::OK);
        match dedup_store.check_or_register(&key) {
            RequestDedupCheck::Completed { status, body } => {
                assert_eq!(status, 200);
                assert_eq!(body, r#"{"ok":true}"#);
            }
            other => panic!("expected completed replay, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn finalize_replayable_response_should_remove_dedup_for_5xx() {
        let idem_store = create_store();
        let dedup_store = Arc::new(RequestDedupStore::new(RequestDedupConfig {
            enabled: true,
            ttl_secs: 30,
            wait_timeout_ms: 1000,
        }));
        let key = "dedup-remove-1".to_string();

        assert!(matches!(
            dedup_store.check_or_register(&key),
            RequestDedupCheck::New
        ));

        let mut idem_guard = IdempotencyGuard::new(None, false, idem_store);
        let mut dedup_guard = RequestDedupGuard::new(Some(key.clone()), false, dedup_store.clone());
        let cache_store = Arc::new(ResponseCacheStore::new(ResponseCacheConfig::default()));
        let mut cache_guard = ResponseCacheGuard::disabled(cache_store);

        let response = (StatusCode::INTERNAL_SERVER_ERROR, "boom").into_response();
        let finalized = finalize_replayable_response(
            response,
            &mut idem_guard,
            &mut dedup_guard,
            &mut cache_guard,
            "req-4",
        )
        .await;

        assert_eq!(finalized.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert!(matches!(
            dedup_store.check_or_register(&key),
            RequestDedupCheck::New
        ));
    }

    #[tokio::test]
    async fn finalize_replayable_response_should_cache_success_response() {
        let idem_store = create_store();
        let dedup_store = Arc::new(RequestDedupStore::new(Default::default()));
        let cache_store = Arc::new(ResponseCacheStore::new(ResponseCacheConfig::default()));
        let cache_key = "cache-hit-1".to_string();

        let mut idem_guard = IdempotencyGuard::new(None, false, idem_store);
        let mut dedup_guard = RequestDedupGuard::disabled(dedup_store);
        let mut cache_guard =
            ResponseCacheGuard::new(Some(cache_key.clone()), false, cache_store.clone());

        let mut response = Response::new(Body::from(r#"{"ok":true}"#));
        *response.status_mut() = StatusCode::OK;
        response.headers_mut().insert(
            header::CONTENT_TYPE,
            header::HeaderValue::from_static("application/json"),
        );

        let finalized = finalize_replayable_response(
            response,
            &mut idem_guard,
            &mut dedup_guard,
            &mut cache_guard,
            "req-5",
        )
        .await;
        assert_eq!(finalized.status(), StatusCode::OK);

        let cached = cache_store
            .get(&cache_key)
            .expect("cache response should exist");
        assert_eq!(cached.status, 200);
        assert_eq!(cached.body, r#"{"ok":true}"#);
        assert_eq!(
            cached
                .headers
                .get("content-type")
                .map(std::string::String::as_str),
            Some("application/json")
        );
    }

    #[tokio::test]
    async fn finalize_replayable_response_should_not_cache_201_with_default_policy() {
        let idem_store = create_store();
        let dedup_store = Arc::new(RequestDedupStore::new(Default::default()));
        let cache_store = Arc::new(ResponseCacheStore::new(ResponseCacheConfig::default()));
        let cache_key = "cache-miss-201-default".to_string();

        let mut idem_guard = IdempotencyGuard::new(None, false, idem_store);
        let mut dedup_guard = RequestDedupGuard::disabled(dedup_store);
        let mut cache_guard =
            ResponseCacheGuard::new(Some(cache_key.clone()), false, cache_store.clone());

        let mut response = Response::new(Body::from(r#"{"created":true}"#));
        *response.status_mut() = StatusCode::CREATED;
        response.headers_mut().insert(
            header::CONTENT_TYPE,
            header::HeaderValue::from_static("application/json"),
        );

        let finalized = finalize_replayable_response(
            response,
            &mut idem_guard,
            &mut dedup_guard,
            &mut cache_guard,
            "req-6",
        )
        .await;
        assert_eq!(finalized.status(), StatusCode::CREATED);
        assert!(cache_store.get(&cache_key).is_none());
    }

    #[tokio::test]
    async fn finalize_replayable_response_should_cache_201_when_policy_allows() {
        let idem_store = create_store();
        let dedup_store = Arc::new(RequestDedupStore::new(Default::default()));
        let cache_store = Arc::new(ResponseCacheStore::new(ResponseCacheConfig {
            enabled: true,
            ttl_secs: 600,
            max_entries: 200,
            max_body_bytes: 1_048_576,
            cacheable_status_codes: vec![200, 201],
        }));
        let cache_key = "cache-hit-201-custom".to_string();

        let mut idem_guard = IdempotencyGuard::new(None, false, idem_store);
        let mut dedup_guard = RequestDedupGuard::disabled(dedup_store);
        let mut cache_guard =
            ResponseCacheGuard::new(Some(cache_key.clone()), false, cache_store.clone());

        let mut response = Response::new(Body::from(r#"{"created":true}"#));
        *response.status_mut() = StatusCode::CREATED;
        response.headers_mut().insert(
            header::CONTENT_TYPE,
            header::HeaderValue::from_static("application/json"),
        );

        let finalized = finalize_replayable_response(
            response,
            &mut idem_guard,
            &mut dedup_guard,
            &mut cache_guard,
            "req-7",
        )
        .await;
        assert_eq!(finalized.status(), StatusCode::CREATED);

        let cached = cache_store
            .get(&cache_key)
            .expect("cache response should exist");
        assert_eq!(cached.status, 201);
        assert_eq!(cached.body, r#"{"created":true}"#);
    }

    #[test]
    fn openai_requires_vision_should_detect_image_part() {
        let request = ChatCompletionRequest {
            model: "gpt-4o".to_string(),
            messages: vec![lime_core::models::openai::ChatMessage {
                role: "user".to_string(),
                content: Some(MessageContent::Parts(vec![
                    ContentPart::Text {
                        text: "请看图".to_string(),
                    },
                    ContentPart::ImageUrl {
                        image_url: lime_core::models::openai::ImageUrl {
                            url: "https://example.com/img.png".to_string(),
                            detail: None,
                        },
                    },
                ])),
                tool_calls: None,
                tool_call_id: None,
                reasoning_content: None,
            }],
            temperature: None,
            max_tokens: Some(256),
            top_p: None,
            stream: false,
            tools: None,
            tool_choice: None,
            reasoning_effort: None,
        };

        assert!(openai_requires_vision(&request));
    }

    #[test]
    fn anthropic_requires_vision_should_detect_image_block() {
        let request = AnthropicMessagesRequest {
            model: "claude-sonnet-4-5-20250929".to_string(),
            messages: vec![lime_core::models::anthropic::AnthropicMessage {
                role: "user".to_string(),
                content: serde_json::json!([
                    { "type": "text", "text": "看看这张图" },
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": "AAAA"
                        }
                    }
                ]),
            }],
            max_tokens: Some(256),
            system: None,
            temperature: None,
            stream: false,
            tools: None,
            tool_choice: None,
        };

        assert!(anthropic_requires_vision(&request));
    }

    #[test]
    fn model_meets_capability_requirements_should_reject_mismatch() {
        let requirements = CapabilityRequirements {
            requires_tools: true,
            requires_vision: false,
            estimated_total_tokens: Some(100_000),
        };
        let snapshot = ModelCapabilitySnapshot {
            supports_tools: Some(false),
            supports_vision: Some(true),
            context_length: Some(32_000),
        };

        let result = model_meets_capability_requirements(&snapshot, &requirements);
        assert!(result.is_err());
        let reasons = result.err().unwrap_or_default();
        assert!(reasons.contains(&CapabilityMismatchReason::ToolsUnsupported));
        assert!(reasons
            .iter()
            .any(|reason| matches!(reason, CapabilityMismatchReason::ContextTooSmall { .. })));
    }

    #[test]
    fn extract_openai_usage_tokens_should_read_prompt_and_completion_tokens() {
        let payload = serde_json::json!({
            "usage": {
                "prompt_tokens": 321,
                "completion_tokens": 123,
                "total_tokens": 444
            }
        });

        assert_eq!(extract_openai_usage_tokens(&payload), Some((321, 123)));
    }

    #[test]
    fn extract_anthropic_usage_tokens_should_include_cache_tokens_in_prompt_total() {
        let payload = serde_json::json!({
            "usage": {
                "input_tokens": 300,
                "cache_creation_input_tokens": 120,
                "cache_read_input_tokens": 80,
                "output_tokens": 45
            }
        });

        assert_eq!(extract_anthropic_usage_tokens(&payload), Some((500, 45)));
    }

    #[test]
    fn convert_anthropic_response_to_openai_should_preserve_cache_aware_usage() {
        let payload = serde_json::json!({
            "id": "msg_123",
            "content": [{ "type": "text", "text": "hello" }],
            "stop_reason": "end_turn",
            "usage": {
                "input_tokens": 200,
                "cache_creation_input_tokens": 50,
                "cache_read_input_tokens": 75,
                "output_tokens": 25
            }
        });

        let response = convert_anthropic_response_to_openai(&payload, "claude-sonnet-4");
        let parsed: serde_json::Value =
            serde_json::from_str(&response).expect("response should be valid json");

        assert_eq!(parsed["usage"]["prompt_tokens"], 325);
        assert_eq!(parsed["usage"]["completion_tokens"], 25);
        assert_eq!(parsed["usage"]["total_tokens"], 350);
        assert_eq!(
            parsed["usage"]["prompt_tokens_details"]["cached_tokens"],
            75
        );
    }
}

// ============================================================================
// Provider 选择辅助函数
// ============================================================================

/// 根据客户端类型和端点配置选择 Provider
async fn select_provider_for_client(headers: &HeaderMap, state: &AppState) -> (String, ClientType) {
    let user_agent = headers
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let client_type = ClientType::from_user_agent(user_agent);

    let endpoint_providers = state.endpoint_providers.read().await;
    let endpoint_provider = endpoint_providers.get_provider(client_type.config_key());

    let default_provider = state.default_provider.read().await.clone();

    let selected_provider = match endpoint_provider {
        Some(provider) => provider.clone(),
        None => default_provider,
    };

    (selected_provider, client_type)
}

#[derive(Debug, Clone, Copy, Default)]
struct CapabilityRequirements {
    requires_tools: bool,
    requires_vision: bool,
    estimated_total_tokens: Option<u32>,
}

#[derive(Debug, Clone, Copy, Default)]
struct ModelCapabilitySnapshot {
    supports_tools: Option<bool>,
    supports_vision: Option<bool>,
    context_length: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CapabilityMismatchReason {
    ToolsUnsupported,
    VisionUnsupported,
    ContextTooSmall { context_length: u32, required: u32 },
}

impl CapabilityMismatchReason {
    fn to_log_message(self) -> String {
        match self {
            Self::ToolsUnsupported => "不支持 tools/function-calling".to_string(),
            Self::VisionUnsupported => "不支持 vision".to_string(),
            Self::ContextTooSmall {
                context_length,
                required,
            } => format!("上下文窗口不足（{} < 需求 {}）", context_length, required),
        }
    }

    fn to_metrics_reason(
        self,
    ) -> crate::middleware::capability_routing_metrics::CapabilityFilterExcludedReason {
        match self {
            Self::ToolsUnsupported => {
                crate::middleware::capability_routing_metrics::CapabilityFilterExcludedReason::Tools
            }
            Self::VisionUnsupported => {
                crate::middleware::capability_routing_metrics::CapabilityFilterExcludedReason::Vision
            }
            Self::ContextTooSmall { .. } => {
                crate::middleware::capability_routing_metrics::CapabilityFilterExcludedReason::Context
            }
        }
    }
}

fn estimate_token_count_from_json<T: serde::Serialize>(value: &T) -> u32 {
    serde_json::to_vec(value)
        .map(|bytes| (bytes.len() / 4) as u32)
        .unwrap_or(0)
}

fn openai_requires_vision(request: &ChatCompletionRequest) -> bool {
    request.messages.iter().any(|msg| {
        matches!(
            &msg.content,
            Some(MessageContent::Parts(parts))
                if parts
                    .iter()
                    .any(|part| matches!(part, ContentPart::ImageUrl { .. }))
        )
    })
}

fn anthropic_requires_vision(request: &AnthropicMessagesRequest) -> bool {
    request.messages.iter().any(|msg| {
        msg.content
            .as_array()
            .map(|blocks| {
                blocks.iter().any(|block| {
                    matches!(
                        block.get("type").and_then(|v| v.as_str()),
                        Some("image") | Some("image_url")
                    )
                })
            })
            .unwrap_or(false)
    })
}

fn build_openai_capability_requirements(request: &ChatCompletionRequest) -> CapabilityRequirements {
    let estimated_input_tokens = estimate_token_count_from_json(&request.messages);
    let estimated_output_tokens = request.max_tokens.unwrap_or(4096);
    CapabilityRequirements {
        requires_tools: request
            .tools
            .as_ref()
            .map(|tools| !tools.is_empty())
            .unwrap_or(false),
        requires_vision: openai_requires_vision(request),
        estimated_total_tokens: Some(
            estimated_input_tokens.saturating_add(estimated_output_tokens),
        ),
    }
}

fn build_anthropic_capability_requirements(
    request: &AnthropicMessagesRequest,
) -> CapabilityRequirements {
    let estimated_input_tokens = estimate_token_count_from_json(&request.messages);
    let estimated_output_tokens = request.max_tokens.unwrap_or(4096);
    CapabilityRequirements {
        requires_tools: request
            .tools
            .as_ref()
            .map(|tools| !tools.is_empty())
            .unwrap_or(false),
        requires_vision: anthropic_requires_vision(request),
        estimated_total_tokens: Some(
            estimated_input_tokens.saturating_add(estimated_output_tokens),
        ),
    }
}

fn load_model_capability_from_registry(
    state: &AppState,
    model: &str,
) -> Option<ModelCapabilitySnapshot> {
    use rusqlite::OptionalExtension;

    let db = state.db.as_ref()?;
    let conn = db.lock().ok()?;
    let row = conn
        .query_row(
            "SELECT capabilities, limits
             FROM model_registry
             WHERE id = ?1
             ORDER BY is_latest DESC, updated_at DESC
             LIMIT 1",
            [model],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .ok()??;

    let capabilities: serde_json::Value = serde_json::from_str(&row.0).unwrap_or_default();
    let limits: serde_json::Value = serde_json::from_str(&row.1).unwrap_or_default();

    let supports_tools = capabilities
        .get("tools")
        .and_then(|v| v.as_bool())
        .or_else(|| {
            capabilities
                .get("function_calling")
                .and_then(|v| v.as_bool())
        });
    let supports_vision = capabilities.get("vision").and_then(|v| v.as_bool());
    let context_length = limits
        .get("context_length")
        .or_else(|| limits.get("context"))
        .and_then(|v| v.as_u64())
        .map(|v| v as u32);

    Some(ModelCapabilitySnapshot {
        supports_tools,
        supports_vision,
        context_length,
    })
}

fn load_context_window_from_aster(model: &str) -> Option<u32> {
    let model_lower = model.to_lowercase();
    if let Some(v) = MODEL_CONTEXT_WINDOWS.get(model_lower.as_str()) {
        return Some(*v as u32);
    }

    MODEL_CONTEXT_WINDOWS.iter().find_map(|(pattern, value)| {
        if model_lower.contains(*pattern) {
            Some(*value as u32)
        } else {
            None
        }
    })
}

fn resolve_model_capability_snapshot(state: &AppState, model: &str) -> ModelCapabilitySnapshot {
    let mut snapshot = load_model_capability_from_registry(state, model).unwrap_or_default();
    if snapshot.context_length.is_none() {
        snapshot.context_length = load_context_window_from_aster(model);
    }
    snapshot
}

fn model_meets_capability_requirements(
    snapshot: &ModelCapabilitySnapshot,
    requirements: &CapabilityRequirements,
) -> Result<(), Vec<CapabilityMismatchReason>> {
    let mut reasons = Vec::new();

    if requirements.requires_tools && matches!(snapshot.supports_tools, Some(false)) {
        reasons.push(CapabilityMismatchReason::ToolsUnsupported);
    }

    if requirements.requires_vision && matches!(snapshot.supports_vision, Some(false)) {
        reasons.push(CapabilityMismatchReason::VisionUnsupported);
    }

    if let (Some(estimated_total_tokens), Some(context_length)) =
        (requirements.estimated_total_tokens, snapshot.context_length)
    {
        let required = ((estimated_total_tokens as f64) * 1.1).ceil() as u32;
        if context_length < required {
            reasons.push(CapabilityMismatchReason::ContextTooSmall {
                context_length,
                required,
            });
        }
    }

    if reasons.is_empty() {
        Ok(())
    } else {
        Err(reasons)
    }
}

fn collect_provider_model_candidates(
    state: &AppState,
    selected_provider: &str,
    current_model: &str,
) -> Vec<String> {
    let mut candidates = vec![current_model.to_string()];
    let provider_key = selected_provider.to_lowercase();
    if let Some(provider_models) = state.provider_models.get(&provider_key) {
        let mut seen: HashSet<String> = candidates.iter().cloned().collect();
        for model in &provider_models.models {
            if !model.enabled || model.id.trim().is_empty() {
                continue;
            }
            if seen.insert(model.id.clone()) {
                candidates.push(model.id.clone());
            }
        }
    }
    candidates
}

async fn collect_provider_fallback_chain(state: &AppState, selected_provider: &str) -> Vec<String> {
    let mut chain = Vec::new();
    let mut seen = HashSet::new();

    let push_unique =
        |chain: &mut Vec<String>, seen: &mut HashSet<String>, provider: Option<String>| {
            if let Some(provider) = provider {
                let normalized = provider.trim().to_lowercase();
                if !normalized.is_empty() && seen.insert(normalized.clone()) {
                    chain.push(normalized);
                }
            }
        };

    push_unique(&mut chain, &mut seen, Some(selected_provider.to_string()));
    push_unique(
        &mut chain,
        &mut seen,
        Some(state.default_provider.read().await.clone()),
    );

    let endpoint_providers = state.endpoint_providers.read().await.clone();
    push_unique(&mut chain, &mut seen, endpoint_providers.cursor);
    push_unique(&mut chain, &mut seen, endpoint_providers.claude_code);
    push_unique(&mut chain, &mut seen, endpoint_providers.codex);
    push_unique(&mut chain, &mut seen, endpoint_providers.windsurf);
    push_unique(&mut chain, &mut seen, endpoint_providers.kiro);
    push_unique(&mut chain, &mut seen, endpoint_providers.other);

    for provider in state.provider_models.keys() {
        push_unique(&mut chain, &mut seen, Some(provider.clone()));
    }

    chain
}

fn apply_capability_filtering_for_openai(
    state: &AppState,
    request_id: &str,
    selected_provider: &str,
    request: &mut ChatCompletionRequest,
) {
    let requirements = build_openai_capability_requirements(request);
    let candidates = collect_provider_model_candidates(state, selected_provider, &request.model);
    if candidates.len() <= 1 {
        return;
    }

    let mut filtered = Vec::new();
    for model in &candidates {
        state
            .capability_routing_metrics_store
            .record_filter_evaluation();
        let snapshot = resolve_model_capability_snapshot(state, model);
        match model_meets_capability_requirements(&snapshot, &requirements) {
            Ok(()) => filtered.push(model.clone()),
            Err(reasons) => {
                state
                    .capability_routing_metrics_store
                    .record_filter_excluded_with_reasons(
                        reasons.iter().map(|reason| reason.to_metrics_reason()),
                    );
                tracing::info!(
                    "[CAP_FILTER] request_id={} endpoint=chat_completions provider={} excluded_model={} reasons={}",
                    request_id,
                    selected_provider,
                    model,
                    reasons
                        .iter()
                        .map(|reason| reason.to_log_message())
                        .collect::<Vec<_>>()
                        .join("; ")
                );
            }
        }
    }

    if filtered.is_empty() {
        state
            .capability_routing_metrics_store
            .record_all_candidates_excluded();
        tracing::warn!(
            "[CAP_FILTER] request_id={} endpoint=chat_completions provider={} all candidates excluded, keep original model={}",
            request_id,
            selected_provider,
            request.model
        );
        return;
    }

    let original_model = request.model.clone();
    let chosen_model = filtered
        .first()
        .cloned()
        .unwrap_or_else(|| original_model.clone());
    if chosen_model != original_model {
        tracing::info!(
            "[CAP_FILTER] request_id={} endpoint=chat_completions provider={} fallback_model {} -> {}",
            request_id,
            selected_provider,
            original_model,
            chosen_model
        );
        request.model = chosen_model;
    }
}

async fn resolve_openai_credential_with_capability_fallback(
    state: &AppState,
    request_id: &str,
    selected_provider: &str,
    client_type: &ClientType,
    explicit_provider_id: Option<&str>,
    request: &mut ChatCompletionRequest,
) -> Result<(String, Option<RuntimeProviderCredential>), Response> {
    if explicit_provider_id.is_some() {
        let cred = select_credential_for_request(
            state,
            Some(request_id),
            selected_provider,
            &request.model,
            client_type,
            explicit_provider_id,
            "CHAT_COMPLETIONS",
            true,
        )
        .await?;
        return Ok((selected_provider.to_string(), cred));
    }

    let provider_chain = collect_provider_fallback_chain(state, selected_provider).await;
    let selected_provider_normalized = selected_provider.to_lowercase();
    for provider in provider_chain {
        let mut candidate_request = request.clone();
        apply_capability_filtering_for_openai(state, request_id, &provider, &mut candidate_request);

        let candidate_model = candidate_request.model.clone();
        let cred = select_credential_for_request(
            state,
            Some(request_id),
            &provider,
            &candidate_model,
            client_type,
            None,
            "CHAT_COMPLETIONS",
            true,
        )
        .await?;

        if let Some(credential) = cred {
            if provider != selected_provider_normalized {
                state
                    .capability_routing_metrics_store
                    .record_provider_fallback();
                tracing::info!(
                    "[CAP_FILTER] request_id={} endpoint=chat_completions provider_fallback {} -> {}",
                    request_id,
                    selected_provider,
                    provider
                );
            }
            if candidate_model != request.model {
                state
                    .capability_routing_metrics_store
                    .record_model_fallback();
                request.model = candidate_model;
            }
            return Ok((provider, Some(credential)));
        }
    }

    Ok((selected_provider.to_string(), None))
}

fn apply_capability_filtering_for_anthropic(
    state: &AppState,
    request_id: &str,
    selected_provider: &str,
    request: &mut AnthropicMessagesRequest,
) {
    let requirements = build_anthropic_capability_requirements(request);
    let candidates = collect_provider_model_candidates(state, selected_provider, &request.model);
    if candidates.len() <= 1 {
        return;
    }

    let mut filtered = Vec::new();
    for model in &candidates {
        state
            .capability_routing_metrics_store
            .record_filter_evaluation();
        let snapshot = resolve_model_capability_snapshot(state, model);
        match model_meets_capability_requirements(&snapshot, &requirements) {
            Ok(()) => filtered.push(model.clone()),
            Err(reasons) => {
                state
                    .capability_routing_metrics_store
                    .record_filter_excluded_with_reasons(
                        reasons.iter().map(|reason| reason.to_metrics_reason()),
                    );
                tracing::info!(
                    "[CAP_FILTER] request_id={} endpoint=anthropic_messages provider={} excluded_model={} reasons={}",
                    request_id,
                    selected_provider,
                    model,
                    reasons
                        .iter()
                        .map(|reason| reason.to_log_message())
                        .collect::<Vec<_>>()
                        .join("; ")
                );
            }
        }
    }

    if filtered.is_empty() {
        state
            .capability_routing_metrics_store
            .record_all_candidates_excluded();
        tracing::warn!(
            "[CAP_FILTER] request_id={} endpoint=anthropic_messages provider={} all candidates excluded, keep original model={}",
            request_id,
            selected_provider,
            request.model
        );
        return;
    }

    let original_model = request.model.clone();
    let chosen_model = filtered
        .first()
        .cloned()
        .unwrap_or_else(|| original_model.clone());
    if chosen_model != original_model {
        tracing::info!(
            "[CAP_FILTER] request_id={} endpoint=anthropic_messages provider={} fallback_model {} -> {}",
            request_id,
            selected_provider,
            original_model,
            chosen_model
        );
        request.model = chosen_model;
    }
}

async fn resolve_anthropic_credential_with_capability_fallback(
    state: &AppState,
    request_id: &str,
    selected_provider: &str,
    client_type: &ClientType,
    explicit_provider_id: Option<&str>,
    request: &mut AnthropicMessagesRequest,
) -> Result<(String, Option<RuntimeProviderCredential>), Response> {
    if explicit_provider_id.is_some() {
        let cred = select_credential_for_request(
            state,
            Some(request_id),
            selected_provider,
            &request.model,
            client_type,
            explicit_provider_id,
            "ANTHROPIC_MESSAGES",
            false,
        )
        .await?;
        return Ok((selected_provider.to_string(), cred));
    }

    let provider_chain = collect_provider_fallback_chain(state, selected_provider).await;
    let selected_provider_normalized = selected_provider.to_lowercase();
    for provider in provider_chain {
        let mut candidate_request = request.clone();
        apply_capability_filtering_for_anthropic(
            state,
            request_id,
            &provider,
            &mut candidate_request,
        );

        let candidate_model = candidate_request.model.clone();
        let cred = select_credential_for_request(
            state,
            Some(request_id),
            &provider,
            &candidate_model,
            client_type,
            None,
            "ANTHROPIC_MESSAGES",
            false,
        )
        .await?;

        if let Some(credential) = cred {
            if provider != selected_provider_normalized {
                state
                    .capability_routing_metrics_store
                    .record_provider_fallback();
                tracing::info!(
                    "[CAP_FILTER] request_id={} endpoint=anthropic_messages provider_fallback {} -> {}",
                    request_id,
                    selected_provider,
                    provider
                );
            }
            if candidate_model != request.model {
                state
                    .capability_routing_metrics_store
                    .record_model_fallback();
                request.model = candidate_model;
            }
            return Ok((provider, Some(credential)));
        }
    }

    Ok((selected_provider.to_string(), None))
}

// ============================================================================
// API Key 验证
// ============================================================================

/// OpenAI 格式的 API key 验证
pub async fn verify_api_key(
    headers: &HeaderMap,
    expected_key: &str,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    let auth = headers
        .get("authorization")
        .or_else(|| headers.get("x-api-key"))
        .and_then(|v| v.to_str().ok());

    let key = match auth {
        Some(s) if s.starts_with("Bearer ") => &s[7..],
        Some(s) => s,
        None => {
            let body = build_gateway_error_json(
                StatusCode::UNAUTHORIZED.as_u16(),
                "No API key provided",
                None,
                None,
                Some(GatewayErrorCode::AuthenticationFailed),
            );
            return Err((StatusCode::UNAUTHORIZED, Json(body)));
        }
    };

    if key != expected_key {
        let body = build_gateway_error_json(
            StatusCode::UNAUTHORIZED.as_u16(),
            "Invalid API key",
            None,
            None,
            Some(GatewayErrorCode::AuthenticationFailed),
        );
        return Err((StatusCode::UNAUTHORIZED, Json(body)));
    }

    Ok(())
}

/// Anthropic 格式的 API key 验证
pub async fn verify_api_key_anthropic(
    headers: &HeaderMap,
    expected_key: &str,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    let auth = headers
        .get("x-api-key")
        .or_else(|| headers.get("authorization"))
        .and_then(|v| v.to_str().ok());

    let key = match auth {
        Some(s) if s.starts_with("Bearer ") => &s[7..],
        Some(s) => s,
        None => {
            let body = build_gateway_error_json(
                StatusCode::UNAUTHORIZED.as_u16(),
                "No API key provided. Please set the x-api-key header.",
                None,
                None,
                Some(GatewayErrorCode::AuthenticationFailed),
            );
            return Err((
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "type": "error", "error": body["error"].clone() })),
            ));
        }
    };

    if key != expected_key {
        let body = build_gateway_error_json(
            StatusCode::UNAUTHORIZED.as_u16(),
            "Invalid API key",
            None,
            None,
            Some(GatewayErrorCode::AuthenticationFailed),
        );
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "type": "error", "error": body["error"].clone() })),
        ));
    }

    Ok(())
}

pub async fn chat_completions(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(mut request): Json<ChatCompletionRequest>,
) -> Response {
    // ========== 详细日志：请求入口 ==========
    eprintln!("\n========== [CHAT_COMPLETIONS] 收到请求 ==========");
    eprintln!("[CHAT_COMPLETIONS] URL: /v1/chat/completions");
    eprintln!("[CHAT_COMPLETIONS] 模型: {}", request.model);
    eprintln!("[CHAT_COMPLETIONS] 流式: {}", request.stream);
    eprintln!("[CHAT_COMPLETIONS] 消息数量: {}", request.messages.len());

    if let Err(e) = verify_api_key(&headers, &state.api_key).await {
        eprintln!("[CHAT_COMPLETIONS] 认证失败!");
        state
            .logs
            .write()
            .await
            .add("warn", "Unauthorized request to /v1/chat/completions");
        return e.into_response();
    }
    eprintln!("[CHAT_COMPLETIONS] 认证成功");

    // 速率限制检查
    if let Some(ref limiter) = state.rate_limiter {
        let client_key = headers
            .get("x-api-key")
            .or_else(|| headers.get("authorization"))
            .and_then(|v| v.to_str().ok())
            .unwrap_or("anonymous");
        if let crate::middleware::rate_limit::RateLimitResult::Limited { retry_after } =
            limiter.check_rate_limit(client_key)
        {
            let response = build_error_response_with_meta(
                StatusCode::TOO_MANY_REQUESTS.as_u16(),
                &format!(
                    "Rate limited. Retry after {} seconds",
                    retry_after.as_secs()
                ),
                None,
                None,
                Some(GatewayErrorCode::RateLimited),
            );
            let (mut parts, body) = response.into_parts();
            parts.headers.insert(
                header::RETRY_AFTER,
                header::HeaderValue::from_str(&retry_after.as_secs().to_string())
                    .unwrap_or_else(|_| header::HeaderValue::from_static("60")),
            );
            return Response::from_parts(parts, body);
        }
    }

    // 创建请求上下文
    let mut ctx = RequestContext::new(request.model.clone()).with_stream(request.stream);
    attach_request_correlation_metadata(&mut ctx, &headers);
    eprintln!("[CHAT_COMPLETIONS] 请求ID: {}", ctx.request_id);

    // 幂等性检查（仅非流式）
    let idempotency_key = headers
        .get("idempotency-key")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    if !request.stream {
        if let Some(ref key) = idempotency_key {
            match state.idempotency_store.check(key) {
                crate::middleware::idempotency::IdempotencyCheck::InProgress => {
                    let mut response = build_error_response_with_meta(
                        StatusCode::CONFLICT.as_u16(),
                        "Request already in progress",
                        Some(&ctx.request_id),
                        None,
                        Some(GatewayErrorCode::RequestConflict),
                    );
                    set_request_id_header(&mut response, &ctx.request_id);
                    set_static_diag_header(&mut response, "x-lime-idempotency", "in-progress");
                    return response;
                }
                crate::middleware::idempotency::IdempotencyCheck::Completed { status, body } => {
                    let status_code = StatusCode::from_u16(status).unwrap_or(StatusCode::OK);
                    let mut response = (status_code, body).into_response();
                    set_request_id_header(&mut response, &ctx.request_id);
                    set_static_diag_header(&mut response, "x-lime-idempotency", "replay");
                    set_static_diag_header(&mut response, "x-lime-source", "idempotency");
                    return response;
                }
                crate::middleware::idempotency::IdempotencyCheck::New => {}
            }
        }
    }
    let mut idempotency_guard = IdempotencyGuard::new(
        idempotency_key.clone(),
        request.stream,
        state.idempotency_store.clone(),
    );
    let mut dedup_guard = RequestDedupGuard::disabled(state.request_dedup_store.clone());
    let mut cache_guard = ResponseCacheGuard::disabled(state.response_cache_store.clone());

    state.logs.write().await.add(
        "info",
        &format!(
            "POST /v1/chat/completions request_id={} model={} stream={}",
            ctx.request_id, request.model, request.stream
        ),
    );

    // 使用 RequestProcessor 解析模型别名
    eprintln!("[CHAT_COMPLETIONS] 开始模型别名解析...");
    let resolved_model = state.processor.resolve_model(&request.model).await;
    ctx.set_resolved_model(resolved_model.clone());
    eprintln!(
        "[CHAT_COMPLETIONS] 模型别名解析结果: {} -> {}",
        request.model, resolved_model
    );

    // 更新请求中的模型名为解析后的模型
    if resolved_model != request.model {
        request.model = resolved_model.clone();
        state.logs.write().await.add(
            "info",
            &format!(
                "[MAPPER] request_id={} alias={} -> model={}",
                ctx.request_id, ctx.original_model, resolved_model
            ),
        );
    }

    // 提示路由：从最后一条 user 消息提取 [hint]
    {
        let hint_router = state.processor.hint_router.read().await;
        if hint_router.is_enabled() {
            if let Some(last_user_msg) = request.messages.iter().rev().find(|m| m.role == "user") {
                let content = last_user_msg.get_content_text();
                if let Some(hint_match) = hint_router.match_message(&content) {
                    request.model = hint_match.route.model.clone();
                    ctx.set_resolved_model(hint_match.route.model.clone());
                    state.logs.write().await.add(
                        "info",
                        &format!(
                            "[HINT_ROUTE] request_id={} hint={} -> model={}",
                            ctx.request_id, hint_match.route.hint, hint_match.route.model
                        ),
                    );
                }
            }
        }
    }

    // 应用参数注入
    let injection_enabled = *state.injection_enabled.read().await;
    if injection_enabled {
        let injector = state.processor.injector.read().await;
        let mut payload = serde_json::to_value(&request).unwrap_or_default();
        let result = injector.inject(&request.model, &mut payload);
        if result.has_injections() {
            state.logs.write().await.add(
                "info",
                &format!(
                    "[INJECT] request_id={} applied_rules={:?} injected_params={:?}",
                    ctx.request_id, result.applied_rules, result.injected_params
                ),
            );
            // 更新请求
            if let Ok(updated) = serde_json::from_value(payload) {
                request = updated;
            }
        }
    }

    // 对话修剪
    {
        let trimmer = &state.processor.conversation_trimmer;
        let messages_json: Vec<serde_json::Value> = serde_json::to_value(&request.messages)
            .ok()
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();
        let trim_result = trimmer.trim_messages(messages_json);
        if trim_result.trimmed {
            if let Ok(trimmed_msgs) = serde_json::from_value(
                serde_json::to_value(&trim_result.messages).unwrap_or_default(),
            ) {
                request.messages = trimmed_msgs;
                state.logs.write().await.add(
                    "info",
                    &format!(
                        "[TRIM] request_id={} removed={} remaining={}",
                        ctx.request_id,
                        trim_result.removed_count,
                        request.messages.len()
                    ),
                );
            }
        }
    }

    // 根据客户端类型选择 Provider
    // **Validates: Requirements 3.1, 3.3, 3.4**
    let (selected_provider, client_type) = select_provider_for_client(&headers, &state).await;
    eprintln!("[CHAT_COMPLETIONS] 客户端类型: {client_type}, 选择的Provider: {selected_provider}");

    // 记录客户端检测和 Provider 选择结果
    state.logs.write().await.add(
        "info",
        &format!(
            "[CLIENT] request_id={} client_type={} selected_provider={}",
            ctx.request_id, client_type, selected_provider
        ),
    );

    // 从请求头提取 X-Provider-Id（用于精确路由）
    let provider_id_header = headers
        .get("x-provider-id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_lowercase());

    // 尝试选择凭证（含能力感知 + 跨 Provider 回退）：
    // 1) X-Provider-Id 指定时仅走精确匹配（不切换 Provider）
    // 2) 否则先按 provider 链路做能力过滤，再选择可用凭证
    eprintln!("[CHAT_COMPLETIONS] 开始选择凭证...");
    let (effective_provider, credential) = match resolve_openai_credential_with_capability_fallback(
        &state,
        &ctx.request_id,
        &selected_provider,
        &client_type,
        provider_id_header.as_deref(),
        &mut request,
    )
    .await
    {
        Ok(result) => result,
        Err(resp) => return resp,
    };
    if ctx.resolved_model != request.model {
        ctx.set_resolved_model(request.model.clone());
    }

    // 记录路由结果（使用最终 provider/model）
    state.logs.write().await.add(
        "info",
        &format!(
            "[ROUTE] request_id={} model={} provider={} requested_provider={}",
            ctx.request_id, ctx.resolved_model, effective_provider, selected_provider
        ),
    );

    if !request.stream {
        let request_payload = serde_json::to_value(&request).unwrap_or_default();
        match begin_response_cache(
            &ctx.request_id,
            "chat_completions",
            &request_payload,
            &headers,
            request.stream,
            idempotency_key.is_some(),
            state.response_cache_store.clone(),
        )
        .await
        {
            Ok(guard) => cache_guard = guard,
            Err(resp) => {
                return attach_route_debug_headers(
                    resp,
                    &selected_provider,
                    &effective_provider,
                    &ctx.resolved_model,
                );
            }
        }
        match begin_request_dedup(
            &ctx.request_id,
            "chat_completions",
            &request_payload,
            request.stream,
            idempotency_key.is_some(),
            state.request_dedup_store.clone(),
        )
        .await
        {
            Ok(guard) => dedup_guard = guard,
            Err(resp) => {
                return attach_route_debug_headers(
                    resp,
                    &selected_provider,
                    &effective_provider,
                    &ctx.resolved_model,
                );
            }
        }
    }

    // 如果找到 API Key Provider 凭证，使用它
    if let Some(cred) = credential {
        eprintln!(
            "[CHAT_COMPLETIONS] 使用凭证: type={}, name={:?}, uuid={}",
            cred.provider_type,
            cred.name,
            &cred.uuid[..8.min(cred.uuid.len())]
        );
        state.logs.write().await.add(
            "info",
            &format!(
                "[ROUTE] Using API Key Provider credential: type={} name={:?} uuid={}",
                cred.provider_type,
                cred.name,
                &cred.uuid[..8]
            ),
        );

        // 启动 Flow 捕获

        // 尝试将 selected_provider 解析为 ProviderType
        // 构建 Flow Metadata，同时保存 provider_type 和实际的 provider_id
        let _provider_type = effective_provider
            .parse::<ProviderType>()
            .unwrap_or(ProviderType::OpenAI);

        // 从运行时凭证名称中提取 Provider 显示名称。
        let _provider_display_name = cred.name.as_deref();

        // 检查是否需要拦截请求
        // **Validates: Requirements 2.1, 2.3, 2.5**

        eprintln!("[CHAT_COMPLETIONS] 调用 Provider: {}", cred.provider_type);
        let provider_label = cred.provider_type.to_string();
        let response = call_with_single_provider_resilience(
            &state,
            &ctx.request_id,
            &provider_label,
            request.stream,
            || async { call_provider_openai(&state, &cred, &request, None).await },
        )
        .await;
        eprintln!(
            "[CHAT_COMPLETIONS] Provider 响应状态: {}",
            response.status()
        );

        // 记录请求统计
        let is_success = response.status().is_success();
        let _status_code = response.status().as_u16();
        let status = if is_success {
            lime_infra::telemetry::RequestStatus::Success
        } else {
            lime_infra::telemetry::RequestStatus::Failed
        };
        record_request_telemetry(&state, &ctx, status, None);

        let estimated_input_tokens = request
            .messages
            .iter()
            .map(|message| match &message.content {
                Some(content) => message_content_len(content),
                None => 0,
            } / 4)
            .sum::<usize>() as u32;
        let estimated_output_tokens = if is_success { 100 } else { 0 };

        // 如果成功且需要 Flow 捕获，提取响应体内容和响应头
        // 注意：非流式响应需要读取 body，所以必须在这里处理
        return attach_route_debug_headers(
            finalize_replayable_response_with_usage_capture(
                response,
                &mut idempotency_guard,
                &mut dedup_guard,
                &mut cache_guard,
                &ctx.request_id,
                Some(UsageCapture {
                    state: &state,
                    ctx: &ctx,
                    parser: extract_openai_usage_tokens,
                    fallback_input_tokens: Some(estimated_input_tokens),
                    fallback_output_tokens: Some(estimated_output_tokens),
                }),
            )
            .await,
            &selected_provider,
            &effective_provider,
            &ctx.resolved_model,
        );
    }

    // 旧 OAuth/local credential 和旧 Kiro 单凭证模式已退役，未找到 API Key Provider 时直接返回错误。
    // **Validates: Requirements 3.2**
    let reason = if !state.allow_provider_fallback {
        "provider auto switch disabled by retry.auto_switch_provider=false"
    } else {
        "legacy credential runtime retired"
    };
    state.logs.write().await.add(
        "error",
        &format!(
            "[ROUTE] No API Key Provider credential found for '{effective_provider}' (client_type={client_type}), {reason}"
        ),
    );
    let message = if !state.allow_provider_fallback {
        format!(
            "没有找到可用的 '{}' API Key Provider 凭证（Provider 自动切换已禁用）。",
            effective_provider
        )
    } else {
        format!(
            "没有找到可用的 '{}' API Key Provider 凭证。",
            effective_provider
        )
    };
    build_error_response_with_meta(
        StatusCode::SERVICE_UNAVAILABLE.as_u16(),
        &message,
        Some(&ctx.request_id),
        Some(&effective_provider),
        Some(GatewayErrorCode::NoCredentials),
    )
}

pub async fn anthropic_messages(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(mut request): Json<AnthropicMessagesRequest>,
) -> Response {
    // 使用 Anthropic 格式的认证验证（优先检查 x-api-key）
    if let Err(e) = verify_api_key_anthropic(&headers, &state.api_key).await {
        state
            .logs
            .write()
            .await
            .add("warn", "Unauthorized request to /v1/messages");
        return e.into_response();
    }

    // 速率限制检查
    if let Some(ref limiter) = state.rate_limiter {
        let client_key = headers
            .get("x-api-key")
            .or_else(|| headers.get("authorization"))
            .and_then(|v| v.to_str().ok())
            .unwrap_or("anonymous");
        if let crate::middleware::rate_limit::RateLimitResult::Limited { retry_after } =
            limiter.check_rate_limit(client_key)
        {
            let response = build_error_response_with_meta(
                StatusCode::TOO_MANY_REQUESTS.as_u16(),
                &format!(
                    "Rate limited. Retry after {} seconds",
                    retry_after.as_secs()
                ),
                None,
                None,
                Some(GatewayErrorCode::RateLimited),
            );
            let (mut parts, body) = response.into_parts();
            parts.headers.insert(
                header::RETRY_AFTER,
                header::HeaderValue::from_str(&retry_after.as_secs().to_string())
                    .unwrap_or_else(|_| header::HeaderValue::from_static("60")),
            );
            return Response::from_parts(parts, body);
        }
    }

    // 创建请求上下文
    let mut ctx = RequestContext::new(request.model.clone()).with_stream(request.stream);
    attach_request_correlation_metadata(&mut ctx, &headers);

    // 幂等性检查（仅非流式）
    let idempotency_key = headers
        .get("idempotency-key")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    if !request.stream {
        if let Some(ref key) = idempotency_key {
            match state.idempotency_store.check(key) {
                crate::middleware::idempotency::IdempotencyCheck::InProgress => {
                    let mut response = build_error_response_with_meta(
                        StatusCode::CONFLICT.as_u16(),
                        "Request already in progress",
                        Some(&ctx.request_id),
                        None,
                        Some(GatewayErrorCode::RequestConflict),
                    );
                    set_request_id_header(&mut response, &ctx.request_id);
                    set_static_diag_header(&mut response, "x-lime-idempotency", "in-progress");
                    return response;
                }
                crate::middleware::idempotency::IdempotencyCheck::Completed { status, body } => {
                    let status_code = StatusCode::from_u16(status).unwrap_or(StatusCode::OK);
                    let mut response = (status_code, body).into_response();
                    set_request_id_header(&mut response, &ctx.request_id);
                    set_static_diag_header(&mut response, "x-lime-idempotency", "replay");
                    set_static_diag_header(&mut response, "x-lime-source", "idempotency");
                    return response;
                }
                crate::middleware::idempotency::IdempotencyCheck::New => {}
            }
        }
    }
    let mut idempotency_guard = IdempotencyGuard::new(
        idempotency_key.clone(),
        request.stream,
        state.idempotency_store.clone(),
    );
    let mut dedup_guard = RequestDedupGuard::disabled(state.request_dedup_store.clone());
    let mut cache_guard = ResponseCacheGuard::disabled(state.response_cache_store.clone());

    // 详细记录请求信息
    let msg_count = request.messages.len();
    let has_tools = request.tools.as_ref().map(|t| t.len()).unwrap_or(0);
    let has_system = request.system.is_some();
    state.logs.write().await.add(
        "info",
        &format!(
            "[REQ] POST /v1/messages request_id={} model={} stream={} messages={} tools={} has_system={}",
            ctx.request_id, request.model, request.stream, msg_count, has_tools, has_system
        ),
    );

    // 使用 RequestProcessor 解析模型别名
    let resolved_model = state.processor.resolve_model(&request.model).await;
    ctx.set_resolved_model(resolved_model.clone());

    // 更新请求中的模型名为解析后的模型
    if resolved_model != request.model {
        request.model = resolved_model.clone();
        state.logs.write().await.add(
            "info",
            &format!(
                "[MAPPER] request_id={} alias={} -> model={}",
                ctx.request_id, ctx.original_model, resolved_model
            ),
        );
    }

    // 记录最后一条消息的角色和内容预览
    if let Some(last_msg) = request.messages.last() {
        let content_preview = match &last_msg.content {
            serde_json::Value::String(s) => s.chars().take(100).collect::<String>(),
            serde_json::Value::Array(arr) => {
                if let Some(first) = arr.first() {
                    if let Some(text) = first.get("text").and_then(|t| t.as_str()) {
                        text.chars().take(100).collect::<String>()
                    } else {
                        format!("[{} blocks]", arr.len())
                    }
                } else {
                    "[empty]".to_string()
                }
            }
            _ => "[unknown]".to_string(),
        };
        state.logs.write().await.add(
            "debug",
            &format!(
                "[REQ] request_id={} last_message: role={} content={}",
                ctx.request_id, last_msg.role, content_preview
            ),
        );
    }

    // 提示路由：从最后一条 user 消息提取 [hint]
    {
        let hint_router = state.processor.hint_router.read().await;
        if hint_router.is_enabled() {
            if let Some(last_user_msg) = request.messages.iter().rev().find(|m| m.role == "user") {
                let content_str = match &last_user_msg.content {
                    serde_json::Value::String(s) => Some(s.clone()),
                    serde_json::Value::Array(arr) => arr
                        .first()
                        .and_then(|b| b.get("text"))
                        .and_then(|t| t.as_str())
                        .map(|s| s.to_string()),
                    _ => None,
                };
                if let Some(content) = content_str {
                    if let Some(hint_match) = hint_router.match_message(&content) {
                        request.model = hint_match.route.model.clone();
                        ctx.set_resolved_model(hint_match.route.model.clone());
                        state.logs.write().await.add(
                            "info",
                            &format!(
                                "[HINT_ROUTE] request_id={} hint={} -> model={}",
                                ctx.request_id, hint_match.route.hint, hint_match.route.model
                            ),
                        );
                    }
                }
            }
        }
    }

    // 应用参数注入
    let injection_enabled = *state.injection_enabled.read().await;
    if injection_enabled {
        let injector = state.processor.injector.read().await;
        let mut payload = serde_json::to_value(&request).unwrap_or_default();
        let result = injector.inject(&request.model, &mut payload);
        if result.has_injections() {
            state.logs.write().await.add(
                "info",
                &format!(
                    "[INJECT] request_id={} applied_rules={:?} injected_params={:?}",
                    ctx.request_id, result.applied_rules, result.injected_params
                ),
            );
            // 更新请求
            if let Ok(updated) = serde_json::from_value(payload) {
                request = updated;
            }
        }
    }

    // 对话修剪
    {
        let trimmer = &state.processor.conversation_trimmer;
        let messages_json: Vec<serde_json::Value> = serde_json::to_value(&request.messages)
            .ok()
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();
        let trim_result = trimmer.trim_messages(messages_json);
        if trim_result.trimmed {
            if let Ok(trimmed_msgs) = serde_json::from_value(
                serde_json::to_value(&trim_result.messages).unwrap_or_default(),
            ) {
                request.messages = trimmed_msgs;
                state.logs.write().await.add(
                    "info",
                    &format!(
                        "[TRIM] request_id={} removed={} remaining={}",
                        ctx.request_id,
                        trim_result.removed_count,
                        request.messages.len()
                    ),
                );
            }
        }
    }

    // 根据客户端类型选择 Provider
    // **Validates: Requirements 3.1, 3.3, 3.4**
    let (selected_provider, client_type) = select_provider_for_client(&headers, &state).await;

    // 记录客户端检测和 Provider 选择结果
    state.logs.write().await.add(
        "info",
        &format!(
            "[CLIENT] request_id={} client_type={} selected_provider={}",
            ctx.request_id, client_type, selected_provider
        ),
    );

    // 从请求头提取 X-Provider-Id（用于精确路由）
    let provider_id_header = headers
        .get("x-provider-id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_lowercase());

    // 尝试选择凭证（含能力感知 + 跨 Provider 回退）
    let (effective_provider, credential) =
        match resolve_anthropic_credential_with_capability_fallback(
            &state,
            &ctx.request_id,
            &selected_provider,
            &client_type,
            provider_id_header.as_deref(),
            &mut request,
        )
        .await
        {
            Ok(result) => result,
            Err(resp) => return resp,
        };
    if ctx.resolved_model != request.model {
        ctx.set_resolved_model(request.model.clone());
    }

    // 记录路由结果（使用最终 provider/model）
    state.logs.write().await.add(
        "info",
        &format!(
            "[ROUTE] request_id={} model={} provider={} requested_provider={}",
            ctx.request_id, ctx.resolved_model, effective_provider, selected_provider
        ),
    );

    if !request.stream {
        let request_payload = serde_json::to_value(&request).unwrap_or_default();
        match begin_response_cache(
            &ctx.request_id,
            "anthropic_messages",
            &request_payload,
            &headers,
            request.stream,
            idempotency_key.is_some(),
            state.response_cache_store.clone(),
        )
        .await
        {
            Ok(guard) => cache_guard = guard,
            Err(resp) => {
                return attach_route_debug_headers(
                    resp,
                    &selected_provider,
                    &effective_provider,
                    &ctx.resolved_model,
                );
            }
        }
        match begin_request_dedup(
            &ctx.request_id,
            "anthropic_messages",
            &request_payload,
            request.stream,
            idempotency_key.is_some(),
            state.request_dedup_store.clone(),
        )
        .await
        {
            Ok(guard) => dedup_guard = guard,
            Err(resp) => {
                return attach_route_debug_headers(
                    resp,
                    &selected_provider,
                    &effective_provider,
                    &ctx.resolved_model,
                );
            }
        }
    }

    // 如果找到 API Key Provider 凭证，使用它
    if let Some(cred) = credential {
        state.logs.write().await.add(
            "info",
            &format!(
                "[ROUTE] Using API Key Provider credential: type={} name={:?} uuid={}",
                cred.provider_type,
                cred.name,
                &cred.uuid[..8]
            ),
        );

        // 启动 Flow 捕获

        // 使用凭证的实际 provider_type（支持自定义 Provider）
        // 对于自定义 Provider ID，凭证的 provider_type 已通过数据库查询正确设置
        let _provider_type = cred.provider_type;

        // 从运行时凭证名称中提取 Provider 显示名称。
        let _provider_display_name = cred.name.as_deref();

        // 检查是否需要拦截请求
        // **Validates: Requirements 2.1, 2.3, 2.5**

        let provider_label = cred.provider_type.to_string();
        let response = call_with_single_provider_resilience(
            &state,
            &ctx.request_id,
            &provider_label,
            request.stream,
            || async { call_provider_anthropic(&state, &cred, &request, None).await },
        )
        .await;

        // 记录请求统计
        let is_success = response.status().is_success();
        let status = if is_success {
            lime_infra::telemetry::RequestStatus::Success
        } else {
            lime_infra::telemetry::RequestStatus::Failed
        };
        record_request_telemetry(&state, &ctx, status, None);

        let estimated_input_tokens = request
            .messages
            .iter()
            .map(|m| {
                let content_len = match &m.content {
                    serde_json::Value::String(s) => s.len(),
                    serde_json::Value::Array(arr) => arr
                        .iter()
                        .filter_map(|v| v.get("text").and_then(|t| t.as_str()))
                        .map(|s| s.len())
                        .sum(),
                    _ => 0,
                };
                content_len / 4
            })
            .sum::<usize>() as u32;
        let estimated_output_tokens = if is_success { 100u32 } else { 0u32 };

        // 完成 Flow 捕获并检查响应拦截
        // **Validates: Requirements 2.1, 2.5**

        return attach_route_debug_headers(
            finalize_replayable_response_with_usage_capture(
                response,
                &mut idempotency_guard,
                &mut dedup_guard,
                &mut cache_guard,
                &ctx.request_id,
                Some(UsageCapture {
                    state: &state,
                    ctx: &ctx,
                    parser: extract_anthropic_usage_tokens,
                    fallback_input_tokens: Some(estimated_input_tokens),
                    fallback_output_tokens: Some(estimated_output_tokens),
                }),
            )
            .await,
            &selected_provider,
            &effective_provider,
            &ctx.resolved_model,
        );
    }

    // 旧 OAuth/local credential 和旧 Kiro 单凭证模式已退役，未找到 API Key Provider 时直接返回错误。
    // **Validates: Requirements 3.2**
    let reason = if !state.allow_provider_fallback {
        "provider auto switch disabled by retry.auto_switch_provider=false"
    } else {
        "legacy credential runtime retired"
    };
    state.logs.write().await.add(
        "error",
        &format!(
            "[ROUTE] No API Key Provider credential found for '{effective_provider}' (client_type={client_type}), {reason}"
        ),
    );
    let message = if !state.allow_provider_fallback {
        format!(
            "没有找到可用的 '{}' API Key Provider 凭证（Provider 自动切换已禁用）。",
            effective_provider
        )
    } else {
        format!(
            "没有找到可用的 '{}' API Key Provider 凭证。",
            effective_provider
        )
    };
    let body = build_gateway_error_json(
        StatusCode::SERVICE_UNAVAILABLE.as_u16(),
        &message,
        Some(&ctx.request_id),
        Some(&effective_provider),
        Some(GatewayErrorCode::NoCredentials),
    );
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(serde_json::json!({ "type": "error", "error": body["error"].clone() })),
    )
        .into_response()
}

// ============================================================================
// 流式传输辅助函数
// ============================================================================

/// 获取目标流式格式
///
/// 根据请求路径确定目标流式格式。
///
/// # 参数
/// - `path`: 请求路径
///
/// # 返回
/// 目标流式格式
fn get_target_stream_format(path: &str) -> StreamingFormat {
    if path.contains("/v1/messages") {
        // Anthropic 格式端点
        StreamingFormat::AnthropicSse
    } else {
        // OpenAI 格式端点
        StreamingFormat::OpenAiSse
    }
}

/// 检查是否应该使用真正的流式传输
///
/// 根据凭证类型和配置决定是否使用真正的流式传输。
/// 目前，只有当 Provider 实现了 StreamingProvider trait 时才返回 true。
///
/// # 参数
/// - `credential`: 凭证信息
///
/// # 返回
/// 是否应该使用真正的流式传输
///
/// # 注意
/// 当前所有 Provider 都返回 false，因为 StreamingProvider trait 尚未实现。
/// 一旦任务 6 完成，此函数将根据凭证类型返回适当的值。
fn should_use_true_streaming(credential: &RuntimeProviderCredential) -> bool {
    match &credential.credential {
        // Claude - 需要实现 StreamingProvider
        RuntimeCredentialData::ClaudeKey { .. } => false,
        // OpenAI - 需要实现 StreamingProvider
        RuntimeCredentialData::OpenAIKey { .. } => false,
        // 其他类型暂不支持流式
        _ => false,
    }
}

/// 构建流式错误响应
///
/// 将错误转换为 SSE 格式的错误事件。
///
/// # 参数
/// - `error_type`: 错误类型
/// - `message`: 错误消息
/// - `target_format`: 目标流式格式
///
/// # 返回
/// SSE 格式的错误响应
///
/// # 需求覆盖
/// - 需求 5.3: 流中发生错误时发送错误事件并优雅关闭流
fn build_stream_error_response(
    error_type: &str,
    message: &str,
    target_format: StreamingFormat,
) -> Response {
    let status = match error_type {
        "authentication_error" => StatusCode::UNAUTHORIZED.as_u16(),
        "rate_limit_error" => StatusCode::TOO_MANY_REQUESTS.as_u16(),
        "timeout_error" => StatusCode::GATEWAY_TIMEOUT.as_u16(),
        _ => StatusCode::BAD_GATEWAY.as_u16(),
    };
    let error_body = build_gateway_error_json(status, message, None, None, None);

    let error_event = match target_format {
        StreamingFormat::AnthropicSse => {
            format!(
                "event: error\ndata: {}\n\n",
                serde_json::json!({
                    "type": "error",
                    "error": error_body["error"].clone()
                })
            )
        }
        // TODO: 任务 6 完成后，添加 GeminiStream 分支
        StreamingFormat::OpenAiSse => {
            format!(
                "data: {}\n\ndata: [DONE]\n\n",
                serde_json::json!({
                    "error": error_body["error"].clone()
                })
            )
        }
        StreamingFormat::AwsEventStream => {
            // AWS Event Stream 格式的错误（不太可能作为目标格式）
            format!(
                "data: {}\n\ndata: [DONE]\n\n",
                serde_json::json!({
                    "error": error_body["error"].clone()
                })
            )
        }
    };

    Response::builder()
        .status(StatusCode::OK) // SSE 错误仍然返回 200
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-cache")
        .header(header::CONNECTION, "keep-alive")
        .body(Body::from(error_event))
        .unwrap_or_else(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": {"message": "Failed to build error response"}})),
            )
                .into_response()
        })
}

/// 将 OpenAI 格式请求转换为 Anthropic 格式
fn convert_openai_to_anthropic(request: &ChatCompletionRequest) -> serde_json::Value {
    let mut messages = Vec::new();
    let mut system_prompt = None;

    for msg in &request.messages {
        if msg.role == "system" {
            // 提取 system prompt
            if let Some(content) = &msg.content {
                system_prompt = Some(match content {
                    lime_core::models::openai::MessageContent::Text(s) => s.clone(),
                    lime_core::models::openai::MessageContent::Parts(parts) => parts
                        .iter()
                        .filter_map(|p| {
                            if let lime_core::models::openai::ContentPart::Text { text } = p {
                                Some(text.clone())
                            } else {
                                None
                            }
                        })
                        .collect::<Vec<_>>()
                        .join("\n"),
                });
            }
        } else {
            // 转换其他消息
            let content = match &msg.content {
                Some(c) => match c {
                    lime_core::models::openai::MessageContent::Text(s) => s.clone(),
                    lime_core::models::openai::MessageContent::Parts(parts) => parts
                        .iter()
                        .filter_map(|p| {
                            if let lime_core::models::openai::ContentPart::Text { text } = p {
                                Some(text.clone())
                            } else {
                                None
                            }
                        })
                        .collect::<Vec<_>>()
                        .join("\n"),
                },
                None => String::new(),
            };

            messages.push(serde_json::json!({
                "role": msg.role,
                "content": content
            }));
        }
    }

    let mut result = serde_json::json!({
        "model": request.model,
        "messages": messages,
        "max_tokens": request.max_tokens.unwrap_or(4096),
        "stream": request.stream
    });

    if let Some(system) = system_prompt {
        result["system"] = serde_json::Value::String(system);
    }

    if let Some(temp) = request.temperature {
        result["temperature"] = serde_json::Value::Number(
            serde_json::Number::from_f64(temp as f64).unwrap_or(serde_json::Number::from(1)),
        );
    }

    result
}

/// 将 Anthropic 响应转换为 OpenAI 格式
fn convert_anthropic_response_to_openai(anthropic_resp: &serde_json::Value, model: &str) -> String {
    let content = anthropic_resp["content"]
        .as_array()
        .and_then(|arr| arr.first())
        .and_then(|c| c["text"].as_str())
        .unwrap_or("");

    let usage_obj = anthropic_resp
        .get("usage")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    let prompt_tokens = anthropic_prompt_tokens(&usage_obj);
    let completion_tokens = usage_obj
        .get("output_tokens")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    let cache_read_tokens = usage_obj
        .get("cache_read_input_tokens")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);

    let mut usage = serde_json::json!({
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": prompt_tokens + completion_tokens
    });
    if cache_read_tokens > 0 {
        usage["prompt_tokens_details"] = serde_json::json!({
            "cached_tokens": cache_read_tokens
        });
    }

    let openai_resp = serde_json::json!({
        "id": anthropic_resp["id"].as_str().unwrap_or("chatcmpl-unknown"),
        "object": "chat.completion",
        "created": chrono::Utc::now().timestamp(),
        "model": model,
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": content
            },
            "finish_reason": match anthropic_resp["stop_reason"].as_str() {
                Some("end_turn") => "stop",
                Some("max_tokens") => "length",
                Some("tool_use") => "tool_calls",
                _ => "stop"
            }
        }],
        "usage": usage
    });

    serde_json::to_string(&openai_resp).unwrap_or_default()
}
