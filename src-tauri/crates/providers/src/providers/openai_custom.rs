//! OpenAI Custom Provider (自定义 OpenAI 兼容 API)
use crate::converter::ReasoningHandler;
use lime_core::api_host_utils::{
    normalize_openai_compatible_api_host, normalize_openai_model_discovery_host,
};
use lime_core::models::openai::{ChatCompletionRequest, ChatMessage};
use reqwest::StatusCode;
use reqwest::{Client, RequestBuilder};
use serde::{Deserialize, Serialize};
use std::error::Error;
use std::time::Duration;
use url::{form_urlencoded, Url};

const LIME_TENANT_HEADER: &str = "X-Lime-Tenant-ID";
const LIME_TENANT_PARAM: &str = "lime_tenant_id";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OpenAICustomConfig {
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub enabled: bool,
}

pub struct OpenAICustomProvider {
    pub config: OpenAICustomConfig,
    pub client: Client,
}

/// 创建配置好的 HTTP 客户端
fn create_http_client() -> Client {
    Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(600)) // 10 分钟总超时
        .tcp_keepalive(Duration::from_secs(60))
        .gzip(true) // 自动解压 gzip 响应
        .brotli(true) // 自动解压 brotli 响应
        .deflate(true) // 自动解压 deflate 响应
        .build()
        .unwrap_or_else(|_| Client::new())
}

impl Default for OpenAICustomProvider {
    fn default() -> Self {
        Self {
            config: OpenAICustomConfig::default(),
            client: create_http_client(),
        }
    }
}

impl OpenAICustomProvider {
    fn tool_calling_v2_enabled() -> bool {
        lime_core::tool_calling::tool_calling_v2_enabled()
    }

    fn native_input_examples_enabled() -> bool {
        lime_core::tool_calling::tool_calling_native_input_examples_enabled()
    }

    fn normalize_openai_request_payload(&self, payload: &mut serde_json::Value) {
        self.normalize_provider_specific_request_payload(payload);

        let model_name = payload
            .get("model")
            .and_then(|value| value.as_str())
            .map(str::to_owned);

        if let (Some(model_name), Some(messages_value)) = (model_name, payload.get_mut("messages"))
        {
            if let Ok(messages) = serde_json::from_value::<Vec<ChatMessage>>(messages_value.clone())
            {
                if let Ok(normalized_messages) = serde_json::to_value(
                    ReasoningHandler::preprocess_messages(messages, &model_name),
                ) {
                    *messages_value = normalized_messages;
                }
            }
        }

        if !Self::tool_calling_v2_enabled() {
            return;
        }

        let Some(tools) = payload.get_mut("tools").and_then(|v| v.as_array_mut()) else {
            return;
        };

        for tool in tools.iter_mut() {
            let tool_type = tool
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            if tool_type != "function" {
                continue;
            }

            let Some(function) = tool.get_mut("function").and_then(|v| v.as_object_mut()) else {
                continue;
            };

            let parameters = function
                .get("parameters")
                .cloned()
                .unwrap_or_else(|| serde_json::json!({}));
            let tool_name = function
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let metadata =
                lime_core::tool_calling::extract_tool_surface_metadata(tool_name, &parameters);
            let input_examples = metadata.input_examples;
            let allowed_callers = metadata.allowed_callers.unwrap_or_default();
            let deferred_loading = metadata.deferred_loading.unwrap_or(false);

            let description = function
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let mut enhanced_description = description.clone();

            if !input_examples.is_empty() && !enhanced_description.contains("[InputExamples]") {
                let rendered = input_examples
                    .iter()
                    .take(3)
                    .map(|v| serde_json::to_string(v).unwrap_or_else(|_| "{}".to_string()))
                    .collect::<Vec<_>>()
                    .join(" | ");
                enhanced_description.push_str("\n\n[InputExamples] ");
                enhanced_description.push_str(&rendered);
            }

            if !allowed_callers.is_empty() && !enhanced_description.contains("[AllowedCallers]") {
                enhanced_description.push_str("\n\n[AllowedCallers] ");
                enhanced_description.push_str(&allowed_callers.join(", "));
            }

            if deferred_loading && !enhanced_description.contains("[DeferredLoading]") {
                enhanced_description.push_str("\n\n[DeferredLoading] true");
            }

            function.insert(
                "description".to_string(),
                serde_json::Value::String(enhanced_description),
            );

            if !input_examples.is_empty() && Self::native_input_examples_enabled() {
                function.insert(
                    "input_examples".to_string(),
                    serde_json::Value::Array(input_examples.clone()),
                );
            }
        }
    }

    fn normalize_provider_specific_request_payload(&self, payload: &mut serde_json::Value) {
        if !self.uses_sensenova_compatible_api() {
            return;
        }

        let Some(object) = payload.as_object_mut() else {
            return;
        };

        if object.contains_key("max_completion_tokens") {
            object.remove("max_tokens");
            return;
        }

        if let Some(max_tokens) = object.remove("max_tokens") {
            object.insert("max_completion_tokens".to_string(), max_tokens);
        }
    }

    fn uses_sensenova_compatible_api(&self) -> bool {
        self.config
            .base_url
            .as_deref()
            .and_then(Self::parse_config_url)
            .is_some_and(|url| {
                url.host_str()
                    .map(|host| host.eq_ignore_ascii_case("api.sensenova.cn"))
                    .unwrap_or(false)
                    && url
                        .path()
                        .trim_end_matches('/')
                        .eq_ignore_ascii_case("/compatible-mode/v2")
            })
    }

    fn maybe_log_protocol_mismatch_hint(url: &str, status: StatusCode) {
        if (status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN)
            && url.contains("/api/anthropic")
        {
            eprintln!(
                "[OPENAI_CUSTOM] 提示: URL '{url}' 返回 {status}，疑似协议不匹配。若上游是 Anthropic 兼容网关，请改用 /v1/messages + x-api-key。"
            );
        }
    }

    pub fn new() -> Self {
        Self::default()
    }

    /// 使用 API key 和 base_url 创建 Provider
    pub fn with_config(api_key: String, base_url: Option<String>) -> Self {
        Self {
            config: OpenAICustomConfig {
                api_key: Some(api_key),
                base_url,
                enabled: true,
            },
            client: create_http_client(),
        }
    }

    pub fn get_base_url(&self) -> String {
        self.config
            .base_url
            .clone()
            .unwrap_or_else(|| "https://api.openai.com".to_string())
    }

    fn normalize_base_for_endpoint(base_url: &str, endpoint: &str) -> String {
        match endpoint {
            "models" => normalize_openai_model_discovery_host(base_url),
            _ => normalize_openai_compatible_api_host(base_url),
        }
    }

    pub fn is_configured(&self) -> bool {
        self.config.api_key.is_some() && self.config.enabled
    }

    /// 构建完整的 API URL
    /// 智能处理用户输入的 base_url，支持多种 API 版本格式
    ///
    /// 支持的格式：
    /// - `https://api.openai.com` -> `https://api.openai.com/v1/chat/completions`
    /// - `https://api.openai.com/v1` -> `https://api.openai.com/v1/chat/completions`
    /// - `https://open.bigmodel.cn/api/paas/v4` -> `https://open.bigmodel.cn/api/paas/v4/chat/completions`
    /// - `https://api.deepseek.com/v1` -> `https://api.deepseek.com/v1/chat/completions`
    fn build_url(&self, endpoint: &str) -> String {
        let base = Self::normalize_base_for_endpoint(&self.get_base_url(), endpoint);
        let base = base.trim_end_matches('/');

        // 检查是否已经包含版本号路径（/v1, /v2, /v3, /v4 等）
        // 使用正则匹配 /v 后跟数字的模式
        let has_version = base
            .rsplit('/')
            .next()
            .map(|last_segment| {
                last_segment.starts_with('v')
                    && last_segment.len() >= 2
                    && last_segment[1..].chars().all(|c| c.is_ascii_digit())
            })
            .unwrap_or(false);

        if has_version {
            // 已有版本号，直接拼接 endpoint
            format!("{base}/{endpoint}")
        } else {
            // 没有版本号，添加 /v1
            format!("{base}/v1/{endpoint}")
        }
    }

    fn build_url_fallback_without_v1(&self, endpoint: &str) -> Option<String> {
        let url = self.build_url(endpoint);
        if url.contains("/v1/") {
            Some(url.replacen("/v1/", "/", 1))
        } else {
            None
        }
    }

    fn build_url_from_base(base_url: &str, endpoint: &str) -> String {
        let base = Self::normalize_base_for_endpoint(base_url, endpoint);
        let base = base.trim_end_matches('/');

        let has_version = base
            .rsplit('/')
            .next()
            .map(|last_segment| {
                last_segment.starts_with('v')
                    && last_segment.len() >= 2
                    && last_segment[1..].chars().all(|c| c.is_ascii_digit())
            })
            .unwrap_or(false);

        if has_version {
            format!("{base}/{endpoint}")
        } else {
            format!("{base}/v1/{endpoint}")
        }
    }

    fn parse_config_url(base_url: &str) -> Option<Url> {
        let trimmed = base_url.trim();
        if trimmed.is_empty() {
            return None;
        }

        Url::parse(trimmed)
            .or_else(|_| Url::parse(&format!("https://{trimmed}")))
            .ok()
    }

    fn normalize_lime_tenant_id(value: &str) -> Option<String> {
        let tenant_id = value.trim();
        if tenant_id.is_empty() {
            return None;
        }

        tenant_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
            .then(|| tenant_id.to_string())
    }

    fn parse_lime_tenant_id_from_pairs(value: &str) -> Option<String> {
        form_urlencoded::parse(value.as_bytes()).find_map(|(key, value)| {
            (key == LIME_TENANT_PARAM)
                .then(|| Self::normalize_lime_tenant_id(&value))
                .flatten()
        })
    }

    fn lime_tenant_id_from_base_url(&self) -> Option<String> {
        let base_url = self.config.base_url.as_deref()?;
        let url = Self::parse_config_url(base_url)?;

        url.query()
            .and_then(Self::parse_lime_tenant_id_from_pairs)
            .or_else(|| {
                url.fragment()
                    .and_then(Self::parse_lime_tenant_id_from_pairs)
            })
    }

    fn apply_auth_headers(&self, request: RequestBuilder, api_key: &str) -> RequestBuilder {
        let request = request.header("Authorization", format!("Bearer {api_key}"));
        if let Some(tenant_id) = self.lime_tenant_id_from_base_url() {
            request.header(LIME_TENANT_HEADER, tenant_id)
        } else {
            request
        }
    }

    fn apply_json_headers(&self, request: RequestBuilder, api_key: &str) -> RequestBuilder {
        self.apply_auth_headers(request, api_key)
            .header("Content-Type", "application/json")
    }

    fn parent_base_url(base: &str) -> Option<String> {
        let base = base.trim();
        if base.is_empty() {
            return None;
        }

        let mut url = Url::parse(base)
            .or_else(|_| Url::parse(&format!("http://{base}")))
            .ok()?;

        let path = url.path().trim_end_matches('/');
        if path.is_empty() || path == "/" {
            return None;
        }

        let mut segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
        if segments.is_empty() {
            return None;
        }
        segments.pop();

        let new_path = if segments.is_empty() {
            "/".to_string()
        } else {
            format!("/{}", segments.join("/"))
        };

        url.set_path(&new_path);
        url.set_query(None);
        url.set_fragment(None);

        Some(url.to_string().trim_end_matches('/').to_string())
    }

    fn base_url_parent(&self) -> Option<String> {
        let base = self.get_base_url();
        Self::parent_base_url(&base)
    }

    fn build_urls_with_fallbacks(&self, endpoint: &str) -> Vec<String> {
        let mut urls: Vec<String> = Vec::new();

        let primary = self.build_url(endpoint);
        urls.push(primary.clone());

        if let Some(no_v1) = self.build_url_fallback_without_v1(endpoint) {
            if no_v1 != primary {
                urls.push(no_v1);
            }
        }

        let mut parent_base = self.base_url_parent();
        for _ in 0..6 {
            let Some(current_parent) = parent_base else {
                break;
            };

            let u = Self::build_url_from_base(&current_parent, endpoint);
            if !urls.iter().any(|x| x == &u) {
                urls.push(u.clone());
            }

            if u.contains("/v1/") {
                let u2 = u.replacen("/v1/", "/", 1);
                if !urls.iter().any(|x| x == &u2) {
                    urls.push(u2);
                }
            }

            parent_base = Self::parent_base_url(&current_parent);
        }

        urls
    }

    /// 调用 OpenAI API（使用类型化请求）
    pub async fn call_api(
        &self,
        request: &ChatCompletionRequest,
    ) -> Result<reqwest::Response, Box<dyn Error + Send + Sync>> {
        let api_key = self
            .config
            .api_key
            .as_ref()
            .ok_or("OpenAI API key not configured")?;

        let urls = self.build_urls_with_fallbacks("chat/completions");
        let mut last_resp: Option<reqwest::Response> = None;

        eprintln!(
            "[OPENAI_CUSTOM] call_api testing with model: {}",
            request.model
        );

        let mut payload =
            serde_json::to_value(request).map_err(|e| format!("序列化 OpenAI 请求失败: {e}"))?;
        self.normalize_openai_request_payload(&mut payload);

        for url in &urls {
            eprintln!("[OPENAI_CUSTOM] call_api trying URL: {url}");
            let resp = self
                .apply_json_headers(self.client.post(url), api_key)
                .json(&payload)
                .send()
                .await?;

            Self::maybe_log_protocol_mismatch_hint(url, resp.status());

            if resp.status() != StatusCode::NOT_FOUND {
                return Ok(resp);
            }
            last_resp = Some(resp);
        }

        Ok(last_resp.ok_or("Request failed")?)
    }

    pub async fn chat_completions(
        &self,
        request: &serde_json::Value,
    ) -> Result<reqwest::Response, Box<dyn Error + Send + Sync>> {
        let api_key = self
            .config
            .api_key
            .as_ref()
            .ok_or("OpenAI API key not configured")?;

        let url = self.build_url("chat/completions");

        eprintln!("[OPENAI_CUSTOM] chat_completions URL: {url}");
        eprintln!(
            "[OPENAI_CUSTOM] chat_completions base_url: {}",
            self.get_base_url()
        );

        let mut payload = request.clone();
        self.normalize_openai_request_payload(&mut payload);

        let resp = self
            .apply_json_headers(self.client.post(&url), api_key)
            .json(&payload)
            .send()
            .await?;

        Self::maybe_log_protocol_mismatch_hint(&url, resp.status());

        if resp.status() == StatusCode::NOT_FOUND {
            if let Some(fallback_url) = self.build_url_fallback_without_v1("chat/completions") {
                if fallback_url != url {
                    let resp2 = self
                        .apply_json_headers(self.client.post(&fallback_url), api_key)
                        .json(&payload)
                        .send()
                        .await?;
                    Self::maybe_log_protocol_mismatch_hint(&fallback_url, resp2.status());
                    return Ok(resp2);
                }
            }
        }

        Ok(resp)
    }

    pub async fn list_models(&self) -> Result<serde_json::Value, Box<dyn Error + Send + Sync>> {
        let api_key = self
            .config
            .api_key
            .as_ref()
            .ok_or("OpenAI API key not configured")?;

        let urls = self.build_urls_with_fallbacks("models");
        let mut tried_urls: Vec<String> = Vec::new();
        let mut resp: Option<reqwest::Response> = None;

        for url in urls {
            eprintln!("[OPENAI_CUSTOM] list_models URL: {url}");
            tried_urls.push(url.clone());
            let r = self
                .apply_auth_headers(self.client.get(&url), api_key)
                .send()
                .await?;
            Self::maybe_log_protocol_mismatch_hint(&url, r.status());
            if r.status() != StatusCode::NOT_FOUND {
                resp = Some(r);
                break;
            }
            resp = Some(r);
        }

        let resp = resp.ok_or("Request failed")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            eprintln!("[OPENAI_CUSTOM] list_models 失败: {status} - {body}");
            return Err(format!(
                "Failed to list models: {status} - {body} (tried: {})",
                tried_urls.join(", ")
            )
            .into());
        }

        let data: serde_json::Value = resp.json().await?;
        Ok(data)
    }
}

// ============================================================================
// StreamingProvider Trait 实现
// ============================================================================

use crate::providers::ProviderError;
use crate::streaming::traits::{
    reqwest_stream_to_stream_response, StreamFormat, StreamResponse, StreamingProvider,
};
use async_trait::async_trait;

#[async_trait]
impl StreamingProvider for OpenAICustomProvider {
    /// 发起流式 API 调用
    ///
    /// 使用 reqwest 的 bytes_stream 返回字节流，支持真正的端到端流式传输。
    /// OpenAI 使用 OpenAI SSE 格式。
    ///
    /// # 需求覆盖
    /// - 需求 1.3: OpenAICustomProvider 流式支持
    async fn call_api_stream(
        &self,
        request: &ChatCompletionRequest,
    ) -> Result<StreamResponse, ProviderError> {
        let api_key = self.config.api_key.as_ref().ok_or_else(|| {
            ProviderError::ConfigurationError("OpenAI API key not configured".to_string())
        })?;

        // 确保请求启用流式
        let mut stream_request = request.clone();
        stream_request.stream = true;
        let mut payload = serde_json::to_value(&stream_request)
            .map_err(|e| ProviderError::ConfigurationError(format!("序列化流式请求失败: {e}")))?;
        self.normalize_openai_request_payload(&mut payload);

        let url = self.build_url("chat/completions");

        tracing::info!(
            "[OPENAI_STREAM] 发起流式请求: url={} model={}",
            url,
            request.model
        );

        let resp = self
            .apply_json_headers(self.client.post(&url), api_key)
            .header("Accept", "text/event-stream")
            .json(&payload)
            .send()
            .await
            .map_err(|e| ProviderError::from_reqwest_error(&e))?;

        let resp = if resp.status() == StatusCode::NOT_FOUND {
            if let Some(fallback_url) = self.build_url_fallback_without_v1("chat/completions") {
                if fallback_url != url {
                    self.apply_json_headers(self.client.post(&fallback_url), api_key)
                        .header("Accept", "text/event-stream")
                        .json(&payload)
                        .send()
                        .await
                        .map_err(|e| ProviderError::from_reqwest_error(&e))?
                } else {
                    resp
                }
            } else {
                resp
            }
        } else {
            resp
        };

        // 检查响应状态
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            tracing::error!("[OPENAI_STREAM] 请求失败: {} - {}", status, body);
            return Err(ProviderError::from_http_status(status.as_u16(), &body));
        }

        tracing::info!("[OPENAI_STREAM] 流式响应开始: status={}", status);

        // 将 reqwest 响应转换为 StreamResponse
        Ok(reqwest_stream_to_stream_response(resp))
    }

    fn supports_streaming(&self) -> bool {
        self.is_configured()
    }

    fn provider_name(&self) -> &'static str {
        "OpenAICustomProvider"
    }

    fn stream_format(&self) -> StreamFormat {
        StreamFormat::OpenAiSse
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        extract::State,
        http::{header, HeaderMap},
        response::IntoResponse,
        routing::post,
        Json, Router,
    };
    use futures::StreamExt;
    use lime_core::models::openai::{ChatMessage, FunctionDef, MessageContent, Tool};
    use std::sync::Arc;
    use tokio::sync::Mutex;

    async fn start_mock_openai_server(
        captured: Arc<Mutex<Vec<serde_json::Value>>>,
    ) -> (String, tokio::task::JoinHandle<()>) {
        async fn handle_chat(
            State(captured): State<Arc<Mutex<Vec<serde_json::Value>>>>,
            Json(payload): Json<serde_json::Value>,
        ) -> impl IntoResponse {
            captured.lock().await.push(payload.clone());

            if payload
                .get("stream")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                (
                    [(header::CONTENT_TYPE, "text/event-stream")],
                    "data: {\"id\":\"chatcmpl-test\",\"object\":\"chat.completion.chunk\",\"choices\":[]}\n\ndata: [DONE]\n\n",
                )
                    .into_response()
            } else {
                Json(serde_json::json!({
                    "id": "chatcmpl-test",
                    "object": "chat.completion",
                    "choices": [{
                        "index": 0,
                        "message": {"role":"assistant","content":"ok"},
                        "finish_reason": "stop"
                    }],
                    "usage": {"prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12}
                }))
                .into_response()
            }
        }

        let app = Router::new()
            .route("/v1/chat/completions", post(handle_chat))
            .with_state(captured);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind mock server");
        let addr = listener.local_addr().expect("read mock server local addr");
        let server = tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("mock server should run");
        });
        (format!("http://{}", addr), server)
    }

    async fn start_header_capture_server(
        captured: Arc<Mutex<Vec<Option<String>>>>,
    ) -> (String, tokio::task::JoinHandle<()>) {
        async fn handle_chat(
            State(captured): State<Arc<Mutex<Vec<Option<String>>>>>,
            headers: HeaderMap,
            Json(_payload): Json<serde_json::Value>,
        ) -> impl IntoResponse {
            captured.lock().await.push(
                headers
                    .get(LIME_TENANT_HEADER)
                    .and_then(|value| value.to_str().ok())
                    .map(ToString::to_string),
            );

            Json(serde_json::json!({
                "id": "chatcmpl-test",
                "object": "chat.completion",
                "choices": [{
                    "index": 0,
                    "message": {"role":"assistant","content":"ok"},
                    "finish_reason": "stop"
                }]
            }))
        }

        let app = Router::new()
            .route("/v1/chat/completions", post(handle_chat))
            .with_state(captured);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind mock server");
        let addr = listener.local_addr().expect("read mock server local addr");
        let server = tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("mock server should run");
        });
        (format!("http://{}", addr), server)
    }

    fn build_tool_calling_request() -> ChatCompletionRequest {
        ChatCompletionRequest {
            model: "deepseek-chat".to_string(),
            messages: vec![ChatMessage {
                role: "user".to_string(),
                content: Some(MessageContent::Text("hi".to_string())),
                tool_calls: None,
                tool_call_id: None,
                reasoning_content: None,
            }],
            temperature: None,
            max_tokens: Some(128),
            top_p: None,
            stream: false,
            tools: Some(vec![Tool::Function {
                function: FunctionDef {
                    name: "search_docs".to_string(),
                    description: Some("Search docs".to_string()),
                    parameters: Some(serde_json::json!({
                        "type":"object",
                        "properties":{"query":{"type":"string"}},
                        "x-lime": {
                            "input_examples":[{"query":"rust async"}],
                            "allowed_callers":["assistant","code_execution"],
                            "deferred_loading": true
                        }
                    })),
                },
            }]),
            tool_choice: None,
            reasoning_effort: None,
        }
    }

    #[test]
    fn test_normalize_openai_request_payload_injects_fallback_description() {
        let provider = OpenAICustomProvider::default();
        let mut payload = serde_json::json!({
            "model": "deepseek-chat",
            "messages": [{"role":"user","content":"hi"}],
            "tools": [{
                "type":"function",
                "function": {
                    "name":"search_docs",
                    "description":"Search docs",
                    "parameters": {
                        "type":"object",
                        "properties":{"query":{"type":"string"}},
                        "x-lime": {
                            "input_examples":[{"query":"rust async"}],
                            "allowed_callers":["assistant","code_execution"],
                            "deferred_loading":true
                        }
                    }
                }
            }]
        });

        provider.normalize_openai_request_payload(&mut payload);
        let description = payload["tools"][0]["function"]["description"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        assert!(description.contains("[InputExamples]"));
        assert!(description.contains("[AllowedCallers]"));
        assert!(description.contains("[DeferredLoading]"));
    }

    #[test]
    fn test_normalize_openai_request_payload_supports_x_lime_alias() {
        let provider = OpenAICustomProvider::default();
        let mut payload = serde_json::json!({
            "model": "deepseek-chat",
            "messages": [{"role":"user","content":"hi"}],
            "tools": [{
                "type":"function",
                "function": {
                    "name":"search_docs",
                    "description":"Search docs",
                    "parameters": {
                        "type":"object",
                        "properties":{"query":{"type":"string"}},
                        "x_lime": {
                            "inputExamples":[{"query":"tool search"}],
                            "allowedCallers":["tool_search"]
                        }
                    }
                }
            }]
        });

        provider.normalize_openai_request_payload(&mut payload);
        let description = payload["tools"][0]["function"]["description"]
            .as_str()
            .unwrap_or_default();

        assert!(description.contains("[InputExamples]"));
        assert!(description.contains("[AllowedCallers]"));
        assert!(description.contains("tool_search"));
    }

    #[test]
    fn test_normalize_openai_request_payload_ignores_non_function_tools() {
        let provider = OpenAICustomProvider::default();
        let mut payload = serde_json::json!({
            "model": "deepseek-chat",
            "messages": [{"role":"user","content":"hi"}],
            "tools": [{"type":"web_search_20250305"}]
        });

        provider.normalize_openai_request_payload(&mut payload);

        assert_eq!(
            payload["tools"][0],
            serde_json::json!({"type":"web_search_20250305"})
        );
    }

    #[test]
    fn test_normalize_openai_request_payload_uses_builtin_input_examples_fallback() {
        let provider = OpenAICustomProvider::default();
        let mut payload = serde_json::json!({
            "model": "deepseek-chat",
            "messages": [{"role":"user","content":"hi"}],
            "tools": [{
                "type":"function",
                "function": {
                    "name":"WebSearch",
                    "description":"允许 Claude 搜索网络并使用结果来提供响应。",
                    "parameters": {
                        "type":"object",
                        "properties":{"query":{"type":"string"},"limit":{"type":"integer"}},
                        "required":["query"]
                    }
                }
            }]
        });

        provider.normalize_openai_request_payload(&mut payload);
        let description = payload["tools"][0]["function"]["description"]
            .as_str()
            .unwrap_or_default();

        assert!(description.contains("[InputExamples]"));
    }

    #[test]
    fn test_normalize_openai_request_payload_does_not_duplicate_existing_metadata_markers() {
        let provider = OpenAICustomProvider::default();
        let mut payload = serde_json::json!({
            "model": "deepseek-chat",
            "messages": [{"role":"user","content":"hi"}],
            "tools": [{
                "type":"function",
                "function": {
                    "name":"search_docs",
                    "description":"Search docs\n\n[InputExamples] {\"query\":\"preset\"}\n\n[AllowedCallers] assistant\n\n[DeferredLoading] true",
                    "parameters": {
                        "type":"object",
                        "properties":{"query":{"type":"string"}},
                        "x_lime": {
                            "inputExamples":[{"query":"tool search"}],
                            "allowedCallers":["assistant"],
                            "deferredLoading": true
                        }
                    }
                }
            }]
        });

        provider.normalize_openai_request_payload(&mut payload);
        let description = payload["tools"][0]["function"]["description"]
            .as_str()
            .unwrap_or_default();

        assert_eq!(description.matches("[InputExamples]").count(), 1);
        assert_eq!(description.matches("[AllowedCallers]").count(), 1);
        assert_eq!(description.matches("[DeferredLoading]").count(), 1);
    }

    #[test]
    fn test_normalize_openai_request_payload_keeps_reasoning_within_same_user_turn() {
        let provider = OpenAICustomProvider::default();
        let mut payload = serde_json::json!({
            "model": "deepseek-reasoner",
            "messages": [
                {
                    "role":"user",
                    "content":"帮我查天气"
                },
                {
                    "role":"assistant",
                    "content":"",
                    "reasoning_content":"先确定城市"
                },
                {
                    "role":"tool",
                    "content":"上海",
                    "tool_call_id":"call_1"
                },
                {
                    "role":"assistant",
                    "content":"",
                    "reasoning_content":"继续查询具体天气"
                }
            ]
        });

        provider.normalize_openai_request_payload(&mut payload);

        assert_eq!(
            payload["messages"][1]["reasoning_content"],
            serde_json::json!("先确定城市")
        );
        assert_eq!(
            payload["messages"][3]["reasoning_content"],
            serde_json::json!("继续查询具体天气")
        );
    }

    #[test]
    fn test_normalize_openai_request_payload_uses_sensenova_token_field() {
        let provider = OpenAICustomProvider::with_config(
            "sk-test".to_string(),
            Some("https://api.sensenova.cn/compatible-mode/v2".to_string()),
        );
        let mut payload = serde_json::json!({
            "model": "SenseChat-5",
            "messages": [{"role":"user","content":"hi"}],
            "max_tokens": 64
        });

        provider.normalize_openai_request_payload(&mut payload);

        assert!(payload.get("max_tokens").is_none());
        assert_eq!(payload["max_completion_tokens"], serde_json::json!(64));
    }

    #[test]
    fn test_normalize_openai_request_payload_keeps_standard_token_field() {
        let provider = OpenAICustomProvider::with_config(
            "sk-test".to_string(),
            Some("https://api.deepseek.com".to_string()),
        );
        let mut payload = serde_json::json!({
            "model": "deepseek-chat",
            "messages": [{"role":"user","content":"hi"}],
            "max_tokens": 64
        });

        provider.normalize_openai_request_payload(&mut payload);

        assert_eq!(payload["max_tokens"], serde_json::json!(64));
        assert!(payload.get("max_completion_tokens").is_none());
    }

    #[test]
    fn test_normalize_openai_request_payload_clears_reasoning_before_latest_user() {
        let provider = OpenAICustomProvider::default();
        let mut payload = serde_json::json!({
            "model": "deepseek-reasoner",
            "messages": [
                {
                    "role":"user",
                    "content":"第一轮"
                },
                {
                    "role":"assistant",
                    "content":"需要工具",
                    "reasoning_content":"第一轮思考"
                },
                {
                    "role":"user",
                    "content":"第二轮"
                },
                {
                    "role":"assistant",
                    "content":"继续处理",
                    "reasoning_content":"第二轮思考"
                }
            ]
        });

        provider.normalize_openai_request_payload(&mut payload);

        assert!(payload["messages"][1].get("reasoning_content").is_none());
        assert_eq!(
            payload["messages"][3]["reasoning_content"],
            serde_json::json!("第二轮思考")
        );
    }

    #[test]
    fn test_build_urls_with_fallbacks_supports_nested_proxy_path() {
        let provider = OpenAICustomProvider::with_config(
            "sk-test".to_string(),
            Some("http://127.0.0.1:3030/openai/v1".to_string()),
        );
        let urls = provider.build_urls_with_fallbacks("chat/completions");

        assert!(urls.contains(&"http://127.0.0.1:3030/openai/v1/chat/completions".to_string()));
        assert!(urls.contains(&"http://127.0.0.1:3030/openai/chat/completions".to_string()));
        assert!(urls.contains(&"http://127.0.0.1:3030/v1/chat/completions".to_string()));
    }

    #[test]
    fn test_build_urls_with_fallbacks_normalizes_responses_endpoint_input() {
        let provider = OpenAICustomProvider::with_config(
            "sk-test".to_string(),
            Some("https://gateway.example.com/proxy/responses".to_string()),
        );

        let urls = provider.build_urls_with_fallbacks("models");

        assert!(urls.contains(&"https://gateway.example.com/proxy/v1/models".to_string()));
        assert!(urls.contains(&"https://gateway.example.com/proxy/models".to_string()));
    }

    #[test]
    fn test_lime_tenant_id_from_base_url_fragment() {
        let provider = OpenAICustomProvider::with_config(
            "sk-test".to_string(),
            Some("https://llm.limeai.run#lime_tenant_id=tenant-0001".to_string()),
        );

        assert_eq!(
            provider.lime_tenant_id_from_base_url().as_deref(),
            Some("tenant-0001")
        );
    }

    #[tokio::test]
    async fn test_call_api_adds_lime_tenant_header_from_base_url_fragment() {
        let captured = Arc::new(Mutex::new(Vec::<Option<String>>::new()));
        let (base_url, server_handle) = start_header_capture_server(captured.clone()).await;
        let mut provider = OpenAICustomProvider::with_config(
            "sk-test".to_string(),
            Some(format!("{base_url}#lime_tenant_id=tenant-0001")),
        );
        provider.client = reqwest::Client::builder()
            .no_proxy()
            .build()
            .expect("build test client without proxy");

        let resp = provider
            .call_api(&build_tool_calling_request())
            .await
            .expect("call should succeed");
        assert!(resp.status().is_success());

        let headers = captured.lock().await;
        assert_eq!(headers.as_slice(), &[Some("tenant-0001".to_string())]);

        server_handle.abort();
    }

    #[tokio::test]
    async fn test_openai_compatible_non_stream_and_stream_both_normalized() {
        if !OpenAICustomProvider::tool_calling_v2_enabled() {
            return;
        }

        let captured = Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
        let (base_url, server_handle) = start_mock_openai_server(captured.clone()).await;
        let mut provider = OpenAICustomProvider::with_config("sk-test".to_string(), Some(base_url));
        provider.client = reqwest::Client::builder()
            .no_proxy()
            .build()
            .expect("build test client without proxy");
        let request = build_tool_calling_request();

        let resp = provider
            .call_api(&request)
            .await
            .expect("non-stream call should succeed");
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            panic!("non-stream call failed: status={status}, body={body}");
        }

        let mut stream = provider
            .call_api_stream(&request)
            .await
            .expect("stream call should succeed");
        let first_chunk = stream
            .next()
            .await
            .expect("stream should return at least one chunk")
            .expect("first stream chunk should be ok");
        let chunk_text = String::from_utf8(first_chunk.to_vec()).expect("chunk should be utf8");
        assert!(chunk_text.contains("data:"));

        let bodies = captured.lock().await;
        assert_eq!(bodies.len(), 2);
        assert_eq!(bodies[1]["stream"], serde_json::json!(true));

        for body in bodies.iter() {
            let description = body["tools"][0]["function"]["description"]
                .as_str()
                .unwrap_or_default()
                .to_string();
            assert!(description.contains("[InputExamples]"));
            assert!(description.contains("[AllowedCallers]"));
            assert!(description.contains("[DeferredLoading]"));
        }

        server_handle.abort();
    }
}
