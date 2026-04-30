//! Claude Custom Provider (自定义 Claude API)
use lime_core::database::dao::api_key_provider::{
    infer_managed_runtime_spec, ApiProviderType, ProviderRuntimeSpec,
};
use lime_core::models::anthropic::AnthropicMessagesRequest;
use lime_core::models::openai::{ChatCompletionRequest, ContentPart, MessageContent};
use reqwest::{Client, RequestBuilder};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::error::Error;
use std::time::Duration;
use url::{form_urlencoded, Url};

const LIME_TENANT_HEADER: &str = "X-Lime-Tenant-ID";
const LIME_TENANT_PARAM: &str = "lime_tenant_id";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum PromptCacheMode {
    #[default]
    Automatic,
    ExplicitOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeCustomConfig {
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub enabled: bool,
    #[serde(default)]
    pub prompt_cache_mode: PromptCacheMode,
    #[serde(default = "default_provider_type")]
    pub provider_type: ApiProviderType,
}

const fn default_provider_type() -> ApiProviderType {
    ApiProviderType::Anthropic
}

impl Default for ClaudeCustomConfig {
    fn default() -> Self {
        Self {
            api_key: None,
            base_url: None,
            enabled: false,
            prompt_cache_mode: PromptCacheMode::default(),
            provider_type: default_provider_type(),
        }
    }
}

pub struct ClaudeCustomProvider {
    pub config: ClaudeCustomConfig,
    pub client: Client,
}

/// 创建配置好的 HTTP 客户端
///
/// 配置说明：
/// - connect_timeout: 连接超时 30 秒
/// - timeout: 总超时 10 分钟（流式响应可能很长）
/// - 不设置 pool_idle_timeout 以保持连接活跃
fn create_http_client() -> Client {
    Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(600)) // 10 分钟总超时，支持长时间流式响应
        .tcp_keepalive(Duration::from_secs(60)) // TCP keepalive 保持连接活跃
        .gzip(true) // 自动解压 gzip 响应
        .brotli(true) // 自动解压 brotli 响应
        .deflate(true) // 自动解压 deflate 响应
        .build()
        .unwrap_or_else(|_| Client::new())
}

impl Default for ClaudeCustomProvider {
    fn default() -> Self {
        Self {
            config: ClaudeCustomConfig::default(),
            client: create_http_client(),
        }
    }
}

impl ClaudeCustomProvider {
    const CACHE_CONTROL_FIELD: &'static str = "cache_control";
    const CONTENT_FIELD: &'static str = "content";
    const ROLE_FIELD: &'static str = "role";
    const SYSTEM_FIELD: &'static str = "system";
    const TOOLS_FIELD: &'static str = "tools";
    const TYPE_FIELD: &'static str = "type";
    const USER_ROLE: &'static str = "user";

    pub fn new() -> Self {
        Self::default()
    }

    /// 使用 API key 和 base_url 创建 Provider
    pub fn with_config(api_key: String, base_url: Option<String>) -> Self {
        Self::with_prompt_cache_mode(api_key, base_url, PromptCacheMode::Automatic)
    }

    pub fn with_prompt_cache_mode(
        api_key: String,
        base_url: Option<String>,
        prompt_cache_mode: PromptCacheMode,
    ) -> Self {
        Self::with_provider_type_and_prompt_cache_mode(
            api_key,
            base_url,
            ApiProviderType::Anthropic,
            prompt_cache_mode,
        )
    }

    pub fn with_provider_type_and_prompt_cache_mode(
        api_key: String,
        base_url: Option<String>,
        provider_type: ApiProviderType,
        prompt_cache_mode: PromptCacheMode,
    ) -> Self {
        Self {
            config: ClaudeCustomConfig {
                api_key: Some(api_key),
                base_url,
                enabled: true,
                prompt_cache_mode,
                provider_type,
            },
            client: create_http_client(),
        }
    }

    pub fn get_base_url(&self) -> String {
        self.config
            .base_url
            .clone()
            .unwrap_or_else(|| "https://api.anthropic.com".to_string())
    }

    pub fn is_configured(&self) -> bool {
        self.config.api_key.is_some() && self.config.enabled
    }

    /// 构建完整的 API URL
    /// 智能处理用户输入的 base_url，无论是否带 /v1 都能正确工作
    fn build_url(&self, endpoint: &str) -> String {
        let base = Self::strip_config_url_metadata(&self.get_base_url());
        let base = base.trim_end_matches('/');

        // 如果用户输入了带 /v1 的 URL，直接拼接 endpoint
        // 否则拼接 /v1/endpoint
        if base.ends_with("/v1") {
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

    fn strip_config_url_metadata(base_url: &str) -> String {
        if let Some(mut url) = Self::parse_config_url(base_url) {
            url.set_query(None);
            url.set_fragment(None);
            return url.to_string().trim_end_matches('/').to_string();
        }

        let trimmed = base_url.trim();
        let end = [trimmed.find('?'), trimmed.find('#')]
            .into_iter()
            .flatten()
            .min()
            .unwrap_or(trimmed.len());
        trimmed[..end].trim_end_matches('/').to_string()
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

    /// 将 OpenAI 图片 URL 格式转换为 Claude 图片格式
    ///
    /// 支持两种格式：
    /// 1. data URL: `data:image/jpeg;base64,xxxxx` -> Claude base64 格式
    /// 2. HTTP URL: `https://...` -> 作为文本提示（Claude 不直接支持 URL）
    fn convert_image_url_to_claude(url: &str) -> Option<serde_json::Value> {
        if url.starts_with("data:") {
            // 解析 data URL: data:image/jpeg;base64,xxxxx
            let parts: Vec<&str> = url.splitn(2, ',').collect();
            if parts.len() == 2 {
                let header = parts[0]; // data:image/jpeg;base64
                let data = parts[1]; // base64 数据

                // 提取 media_type: image/jpeg, image/png, image/gif, image/webp
                let media_type = header
                    .strip_prefix("data:")
                    .and_then(|s| s.split(';').next())
                    .unwrap_or("image/jpeg");

                tracing::debug!("[CLAUDE_IMAGE] 转换 base64 图片: media_type={}", media_type);

                return Some(serde_json::json!({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": media_type,
                        "data": data
                    }
                }));
            }
        } else if url.starts_with("http://") || url.starts_with("https://") {
            // Claude 不直接支持 URL 图片，转为文本提示
            tracing::warn!("[CLAUDE_IMAGE] Claude 不支持 URL 图片，转为文本: {}", url);
            return Some(serde_json::json!({
                "type": "text",
                "text": format!("[Image: {}]", url)
            }));
        }

        tracing::warn!("[CLAUDE_IMAGE] 无法解析图片 URL: {}", url);
        None
    }

    fn convert_openai_tool_to_anthropic(
        tool: &lime_core::models::openai::Tool,
    ) -> Option<serde_json::Value> {
        match tool {
            lime_core::models::openai::Tool::Function { function } => {
                let input_schema = function
                    .parameters
                    .clone()
                    .unwrap_or_else(|| serde_json::json!({"type":"object","properties":{}}));
                let metadata = lime_core::tool_calling::extract_tool_surface_metadata(
                    &function.name,
                    &input_schema,
                );
                let input_examples = metadata.input_examples;
                let allowed_callers = metadata.allowed_callers.unwrap_or_default();

                let mut description = function.description.clone().unwrap_or_default();
                if !input_examples.is_empty() && !description.contains("[InputExamples]") {
                    let rendered = input_examples
                        .iter()
                        .take(3)
                        .map(|v| serde_json::to_string(v).unwrap_or_else(|_| "{}".to_string()))
                        .collect::<Vec<_>>()
                        .join(" | ");
                    description.push_str("\n\n[InputExamples] ");
                    description.push_str(&rendered);
                }
                if !allowed_callers.is_empty() && !description.contains("[AllowedCallers]") {
                    description.push_str("\n\n[AllowedCallers] ");
                    description.push_str(&allowed_callers.join(", "));
                }

                let mut anthropic_tool = serde_json::json!({
                    "name": function.name,
                    "description": description,
                    "input_schema": input_schema
                });
                if !input_examples.is_empty() {
                    anthropic_tool["input_examples"] = serde_json::Value::Array(input_examples);
                }
                if !allowed_callers.is_empty() {
                    anthropic_tool["allowed_callers"] = serde_json::json!(allowed_callers);
                }
                Some(anthropic_tool)
            }
            _ => None,
        }
    }

    fn convert_openai_tool_choice_to_anthropic(
        tool_choice: &Option<serde_json::Value>,
    ) -> Option<serde_json::Value> {
        let Some(tool_choice) = tool_choice else {
            return None;
        };
        match tool_choice {
            serde_json::Value::String(s) => match s.as_str() {
                "none" => Some(serde_json::json!({"type":"none"})),
                "auto" => Some(serde_json::json!({"type":"auto"})),
                "required" | "any" => Some(serde_json::json!({"type":"any"})),
                _ => None,
            },
            serde_json::Value::Object(obj) => {
                if let Some(func) = obj.get("function") {
                    func.get("name")
                        .and_then(|n| n.as_str())
                        .map(|name| serde_json::json!({"type":"tool","name":name}))
                } else if let Some(t) = obj.get("type").and_then(|t| t.as_str()) {
                    match t {
                        "any" | "tool" => Some(serde_json::json!({"type":"any"})),
                        "auto" => Some(serde_json::json!({"type":"auto"})),
                        "none" => Some(serde_json::json!({"type":"none"})),
                        _ => None,
                    }
                } else {
                    None
                }
            }
            _ => None,
        }
    }

    fn value_contains_cache_control(value: &Value) -> bool {
        match value {
            Value::Object(map) => {
                map.contains_key(Self::CACHE_CONTROL_FIELD)
                    || map.values().any(Self::value_contains_cache_control)
            }
            Value::Array(items) => items.iter().any(Self::value_contains_cache_control),
            _ => false,
        }
    }

    fn add_ephemeral_cache_control(block: &mut Value) {
        if let Some(obj) = block.as_object_mut() {
            obj.entry(Self::CACHE_CONTROL_FIELD.to_string())
                .or_insert_with(|| json!({ Self::TYPE_FIELD: "ephemeral" }));
        }
    }

    fn add_cache_control_to_content(content: &mut Value) {
        match content {
            Value::String(text) if !text.is_empty() => {
                *content = json!([{
                    Self::TYPE_FIELD: "text",
                    "text": text.clone(),
                    Self::CACHE_CONTROL_FIELD: { Self::TYPE_FIELD: "ephemeral" }
                }]);
            }
            Value::Array(items) => {
                if let Some(last) = items.last_mut() {
                    Self::add_ephemeral_cache_control(last);
                }
            }
            _ => {}
        }
    }

    fn apply_prompt_cache_control(payload: &mut Value) {
        if Self::value_contains_cache_control(payload) {
            return;
        }

        if let Some(messages) = payload
            .as_object_mut()
            .and_then(|obj| obj.get_mut("messages"))
            .and_then(Value::as_array_mut)
        {
            let mut user_count = 0;
            for message in messages.iter_mut().rev() {
                if message.get(Self::ROLE_FIELD) == Some(&json!(Self::USER_ROLE)) {
                    if let Some(content) = message.get_mut(Self::CONTENT_FIELD) {
                        Self::add_cache_control_to_content(content);
                    }
                    user_count += 1;
                    if user_count >= 2 {
                        break;
                    }
                }
            }
        }

        if let Some(system) = payload
            .as_object_mut()
            .and_then(|obj| obj.get_mut(Self::SYSTEM_FIELD))
        {
            Self::add_cache_control_to_content(system);
        }

        if let Some(tools) = payload
            .as_object_mut()
            .and_then(|obj| obj.get_mut(Self::TOOLS_FIELD))
            .and_then(Value::as_array_mut)
        {
            if let Some(last_tool) = tools.last_mut() {
                Self::add_ephemeral_cache_control(last_tool);
            }
        }
    }

    fn apply_prompt_cache_control_for_mode(
        prompt_cache_mode: PromptCacheMode,
        payload: &mut Value,
    ) {
        if prompt_cache_mode == PromptCacheMode::ExplicitOnly {
            if Self::value_contains_cache_control(payload) {
                tracing::debug!("[CLAUDE_API] 检测到显式 cache_control，保留上游标记");
            } else {
                tracing::debug!(
                    "[CLAUDE_API] 当前 provider 未声明支持自动 prompt cache，跳过自动注入"
                );
            }
            return;
        }

        Self::apply_prompt_cache_control(payload);
    }

    fn maybe_apply_prompt_cache_control(&self, payload: &mut Value) {
        Self::apply_prompt_cache_control_for_mode(self.config.prompt_cache_mode, payload);
    }

    fn effective_runtime_spec(&self) -> ProviderRuntimeSpec {
        infer_managed_runtime_spec(
            self.config.provider_type,
            &Self::strip_config_url_metadata(&self.get_base_url()),
        )
    }

    fn apply_runtime_headers(&self, request: RequestBuilder, api_key: &str) -> RequestBuilder {
        let api_key = api_key.trim();
        let runtime_spec = self.effective_runtime_spec();
        let auth_value = runtime_spec
            .auth_prefix
            .map(|prefix| format!("{prefix} {api_key}"))
            .unwrap_or_else(|| api_key.to_string());

        let mut request = request
            .header(runtime_spec.auth_header, auth_value)
            .header("Content-Type", "application/json");

        // 部分 Anthropic 协议上游在官方示例里会同时携带
        // `Authorization` 与 `x-api-key`；双写可尽量贴近 SDK 实际行为。
        if runtime_spec.protocol_family
            == lime_core::database::dao::api_key_provider::ProviderProtocolFamily::Anthropic
            && runtime_spec
                .auth_header
                .eq_ignore_ascii_case("Authorization")
        {
            request = request.header("x-api-key", api_key);
        }

        for (name, value) in runtime_spec.extra_headers {
            request = request.header(*name, *value);
        }

        if let Some(tenant_id) = self.lime_tenant_id_from_base_url() {
            request = request.header(LIME_TENANT_HEADER, tenant_id);
        }

        request
    }

    fn anthropic_prompt_tokens(response: &Value) -> u64 {
        let usage = response
            .get("usage")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();

        usage
            .get("input_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            + usage
                .get("cache_creation_input_tokens")
                .and_then(Value::as_u64)
                .unwrap_or(0)
            + usage
                .get("cache_read_input_tokens")
                .and_then(Value::as_u64)
                .unwrap_or(0)
    }

    fn anthropic_completion_tokens(response: &Value) -> u64 {
        response
            .get("usage")
            .and_then(Value::as_object)
            .and_then(|usage| usage.get("output_tokens"))
            .and_then(Value::as_u64)
            .unwrap_or(0)
    }

    /// 调用 Anthropic API（原生格式）
    pub async fn call_api(
        &self,
        request: &AnthropicMessagesRequest,
    ) -> Result<reqwest::Response, Box<dyn Error + Send + Sync>> {
        let api_key = self
            .config
            .api_key
            .as_ref()
            .ok_or("Claude API key not configured")?;

        let url = self.build_url("messages");

        // 打印请求 URL 和模型用于调试
        tracing::info!(
            "[CLAUDE_API] 发送请求: url={} model={} stream={}",
            url,
            request.model,
            request.stream
        );

        let mut payload = serde_json::to_value(request)?;
        self.maybe_apply_prompt_cache_control(&mut payload);

        let resp = self
            .apply_runtime_headers(self.client.post(&url), api_key)
            .json(&payload)
            .send()
            .await?;

        // 打印响应状态
        tracing::info!(
            "[CLAUDE_API] 响应状态: status={} model={}",
            resp.status(),
            request.model
        );

        Ok(resp)
    }

    /// 调用 OpenAI 格式的 API（内部转换为 Anthropic 格式）
    pub async fn call_openai_api(
        &self,
        request: &ChatCompletionRequest,
    ) -> Result<serde_json::Value, Box<dyn Error + Send + Sync>> {
        // 手动转换 OpenAI 请求为 Anthropic 格式
        let mut anthropic_messages = Vec::new();
        let mut system_content = None;

        for msg in &request.messages {
            let role = &msg.role;

            // 提取消息内容，转换为 Anthropic 格式的 content 数组
            let content_blocks: Vec<serde_json::Value> = match &msg.content {
                Some(MessageContent::Text(text)) => {
                    if text.is_empty() {
                        vec![]
                    } else {
                        vec![serde_json::json!({"type": "text", "text": text})]
                    }
                }
                Some(MessageContent::Parts(parts)) => {
                    parts
                        .iter()
                        .filter_map(|p| match p {
                            ContentPart::Text { text } => {
                                if text.is_empty() {
                                    None
                                } else {
                                    Some(serde_json::json!({"type": "text", "text": text}))
                                }
                            }
                            ContentPart::ImageUrl { image_url } => {
                                // 转换 OpenAI 图片格式为 Claude 图片格式
                                Self::convert_image_url_to_claude(&image_url.url)
                            }
                        })
                        .collect()
                }
                None => vec![],
            };

            if role == "system" {
                // system 消息只提取文本
                let text = content_blocks
                    .iter()
                    .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                    .collect::<Vec<_>>()
                    .join("");
                system_content = Some(text);
            } else if !content_blocks.is_empty() {
                let anthropic_role = if role == "assistant" {
                    "assistant"
                } else {
                    "user"
                };
                anthropic_messages.push(serde_json::json!({
                    "role": anthropic_role,
                    "content": content_blocks
                }));
            }
        }

        let mut anthropic_body = serde_json::json!({
            "model": request.model,
            "max_tokens": request.max_tokens.unwrap_or(4096),
            "messages": anthropic_messages
        });

        if let Some(sys) = system_content {
            anthropic_body["system"] = serde_json::json!(sys);
        }

        if let Some(ref tools) = request.tools {
            let anthropic_tools: Vec<serde_json::Value> = tools
                .iter()
                .filter_map(Self::convert_openai_tool_to_anthropic)
                .collect();
            if !anthropic_tools.is_empty() {
                anthropic_body["tools"] = serde_json::json!(anthropic_tools);
            }
        }
        if let Some(tc) = Self::convert_openai_tool_choice_to_anthropic(&request.tool_choice) {
            anthropic_body["tool_choice"] = tc;
        }
        self.maybe_apply_prompt_cache_control(&mut anthropic_body);

        let api_key = self
            .config
            .api_key
            .as_ref()
            .ok_or("Claude API key not configured")?;

        let url = self.build_url("messages");

        // 打印请求 URL 和模型用于调试
        tracing::info!(
            "[CLAUDE_API] 发送请求 (OpenAI 格式转换): url={} model={} stream={}",
            url,
            request.model,
            request.stream
        );

        let resp = self
            .apply_runtime_headers(self.client.post(&url), api_key)
            .json(&anthropic_body)
            .send()
            .await?;

        // 打印响应状态
        let status = resp.status();
        tracing::info!(
            "[CLAUDE_API] 响应状态: status={} model={}",
            status,
            request.model
        );

        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();

            // 检查是否是 Claude Code 专用凭证限制错误
            if body.contains("only authorized for use with Claude Code") {
                return Err(format!(
                    "凭证限制错误: 当前 Claude 凭证只能用于 Claude Code，不能用于通用 API 调用。\
                    请使用通用的 Claude API Key 或 Anthropic API Key。\
                    错误详情: {status} - {body}"
                )
                .into());
            }

            return Err(format!("Claude API error: {status} - {body}").into());
        }

        let anthropic_resp: serde_json::Value = resp.json().await?;

        // 转换回 OpenAI 格式
        let content = anthropic_resp["content"]
            .as_array()
            .and_then(|arr| arr.first())
            .and_then(|block| block["text"].as_str())
            .unwrap_or("");
        let prompt_tokens = Self::anthropic_prompt_tokens(&anthropic_resp);
        let completion_tokens = Self::anthropic_completion_tokens(&anthropic_resp);

        Ok(json!({
            "id": format!("chatcmpl-{}", uuid::Uuid::new_v4()),
            "object": "chat.completion",
            "created": std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            "model": request.model,
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": content
                },
                "finish_reason": "stop"
            }],
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens
            }
        }))
    }

    pub async fn messages(
        &self,
        request: &serde_json::Value,
    ) -> Result<reqwest::Response, Box<dyn Error + Send + Sync>> {
        let api_key = self
            .config
            .api_key
            .as_ref()
            .ok_or("Claude API key not configured")?;

        let url = self.build_url("messages");

        // 打印请求 URL 用于调试
        let model = request
            .get("model")
            .and_then(|m| m.as_str())
            .unwrap_or("unknown");
        let stream = request
            .get("stream")
            .and_then(|s| s.as_bool())
            .unwrap_or(false);
        tracing::info!(
            "[CLAUDE_API] 发送请求 (原始 JSON): url={} model={} stream={}",
            url,
            model,
            stream
        );

        let mut payload = request.clone();
        self.maybe_apply_prompt_cache_control(&mut payload);

        let resp = self
            .apply_runtime_headers(self.client.post(&url), api_key)
            .json(&payload)
            .send()
            .await?;

        // 打印响应状态
        tracing::info!(
            "[CLAUDE_API] 响应状态: status={} model={}",
            resp.status(),
            model
        );

        Ok(resp)
    }

    pub async fn count_tokens(
        &self,
        request: &serde_json::Value,
    ) -> Result<serde_json::Value, Box<dyn Error + Send + Sync>> {
        let api_key = self
            .config
            .api_key
            .as_ref()
            .ok_or("Claude API key not configured")?;

        let url = self.build_url("messages/count_tokens");

        let resp = self
            .apply_runtime_headers(self.client.post(&url), api_key)
            .json(request)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Failed to count tokens: {status} - {body}").into());
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
impl StreamingProvider for ClaudeCustomProvider {
    /// 发起流式 API 调用
    ///
    /// 使用 reqwest 的 bytes_stream 返回字节流，支持真正的端到端流式传输。
    /// Claude 使用 Anthropic SSE 格式。
    ///
    /// # 需求覆盖
    /// - 需求 1.2: ClaudeCustomProvider 流式支持
    async fn call_api_stream(
        &self,
        request: &ChatCompletionRequest,
    ) -> Result<StreamResponse, ProviderError> {
        let api_key = self.config.api_key.as_ref().ok_or_else(|| {
            ProviderError::ConfigurationError("Claude API key not configured".to_string())
        })?;

        // 转换 OpenAI 请求为 Anthropic 格式
        let mut anthropic_messages = Vec::new();
        let mut system_content = None;
        // 收集 tool 角色消息的 tool_result，稍后合并到 user 消息中
        let mut pending_tool_results: Vec<serde_json::Value> = Vec::new();

        for msg in &request.messages {
            let role = &msg.role;

            // 处理 tool 角色消息（工具调用结果）
            if role == "tool" {
                // 转换为 Anthropic tool_result content block
                let tool_call_id = msg.tool_call_id.clone().unwrap_or_default();
                let content = msg.get_content_text();
                pending_tool_results.push(serde_json::json!({
                    "type": "tool_result",
                    "tool_use_id": tool_call_id,
                    "content": content
                }));
                continue;
            }

            // 如果有待处理的 tool_results 且当前不是 assistant 消息，先添加一个 user 消息
            if !pending_tool_results.is_empty() && role != "assistant" {
                anthropic_messages.push(serde_json::json!({
                    "role": "user",
                    "content": pending_tool_results.clone()
                }));
                pending_tool_results.clear();
            }

            // 提取消息内容，转换为 Anthropic 格式的 content 数组
            let mut content_blocks: Vec<serde_json::Value> = match &msg.content {
                Some(MessageContent::Text(text)) => {
                    if text.is_empty() {
                        vec![]
                    } else {
                        vec![serde_json::json!({"type": "text", "text": text})]
                    }
                }
                Some(MessageContent::Parts(parts)) => {
                    parts
                        .iter()
                        .filter_map(|p| match p {
                            ContentPart::Text { text } => {
                                if text.is_empty() {
                                    None
                                } else {
                                    Some(serde_json::json!({"type": "text", "text": text}))
                                }
                            }
                            ContentPart::ImageUrl { image_url } => {
                                // 转换 OpenAI 图片格式为 Claude 图片格式
                                Self::convert_image_url_to_claude(&image_url.url)
                            }
                        })
                        .collect()
                }
                None => vec![],
            };

            // 处理 assistant 消息中的 tool_calls
            if role == "assistant" {
                if let Some(ref tool_calls) = msg.tool_calls {
                    for tc in tool_calls {
                        // 解析 arguments JSON
                        let input: serde_json::Value = serde_json::from_str(&tc.function.arguments)
                            .unwrap_or(serde_json::json!({}));
                        content_blocks.push(serde_json::json!({
                            "type": "tool_use",
                            "id": tc.id,
                            "name": tc.function.name,
                            "input": input
                        }));
                    }
                }
            }

            if role == "system" {
                // system 消息只提取文本
                let text = content_blocks
                    .iter()
                    .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                    .collect::<Vec<_>>()
                    .join("");
                system_content = Some(text);
            } else if !content_blocks.is_empty() {
                let anthropic_role = if role == "assistant" {
                    "assistant"
                } else {
                    "user"
                };
                anthropic_messages.push(serde_json::json!({
                    "role": anthropic_role,
                    "content": content_blocks
                }));
            }
        }

        // 处理末尾的 tool_results
        if !pending_tool_results.is_empty() {
            anthropic_messages.push(serde_json::json!({
                "role": "user",
                "content": pending_tool_results
            }));
        }

        let mut anthropic_body = serde_json::json!({
            "model": request.model,
            "max_tokens": request.max_tokens.unwrap_or(4096),
            "messages": anthropic_messages,
            "stream": true
        });

        if let Some(sys) = system_content {
            anthropic_body["system"] = serde_json::json!(sys);
        }

        // 转换 tools: OpenAI 格式 -> Anthropic 格式
        if let Some(ref tools) = request.tools {
            let anthropic_tools: Vec<serde_json::Value> = tools
                .iter()
                .filter_map(Self::convert_openai_tool_to_anthropic)
                .collect();

            if !anthropic_tools.is_empty() {
                anthropic_body["tools"] = serde_json::json!(anthropic_tools);
                tracing::info!(
                    "[CLAUDE_STREAM] 添加 {} 个工具到请求",
                    anthropic_tools.len()
                );
            }
        }

        // 转换 tool_choice: OpenAI 格式 -> Anthropic 格式
        if let Some(tc) = Self::convert_openai_tool_choice_to_anthropic(&request.tool_choice) {
            anthropic_body["tool_choice"] = tc;
            tracing::info!(
                "[CLAUDE_STREAM] 设置 tool_choice: {:?}",
                anthropic_body["tool_choice"]
            );
        }
        self.maybe_apply_prompt_cache_control(&mut anthropic_body);

        let url = self.build_url("messages");

        tracing::info!(
            "[CLAUDE_STREAM] 发起流式请求: url={} model={}",
            url,
            request.model
        );

        let resp = self
            .apply_runtime_headers(self.client.post(&url), api_key)
            .header("Accept", "text/event-stream")
            .json(&anthropic_body)
            .send()
            .await
            .map_err(|e| ProviderError::from_reqwest_error(&e))?;

        // 检查响应状态
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            tracing::error!("[CLAUDE_STREAM] 请求失败: {} - {}", status, body);
            return Err(ProviderError::from_http_status(status.as_u16(), &body));
        }

        tracing::info!("[CLAUDE_STREAM] 流式响应开始: status={}", status);

        // 将 reqwest 响应转换为 StreamResponse
        Ok(reqwest_stream_to_stream_response(resp))
    }

    fn supports_streaming(&self) -> bool {
        self.is_configured()
    }

    fn provider_name(&self) -> &'static str {
        "ClaudeCustomProvider"
    }

    fn stream_format(&self) -> StreamFormat {
        StreamFormat::AnthropicSse
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use lime_core::database::dao::api_key_provider::ProviderProtocolFamily;
    use lime_core::models::openai::{FunctionDef, Tool};

    #[test]
    fn test_convert_openai_tool_to_anthropic_keeps_metadata() {
        let tool = Tool::Function {
            function: FunctionDef {
                name: "create_ticket".to_string(),
                description: Some("Create support ticket".to_string()),
                parameters: Some(serde_json::json!({
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"}
                    },
                    "x-lime": {
                        "input_examples": [{"title":"Billing issue"}],
                        "allowed_callers": ["assistant", "code_execution"]
                    }
                })),
            },
        };

        let converted = ClaudeCustomProvider::convert_openai_tool_to_anthropic(&tool)
            .expect("tool should be converted");
        let description = converted
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

        assert_eq!(converted["name"], serde_json::json!("create_ticket"));
        assert!(description.contains("[InputExamples]"));
        assert!(description.contains("[AllowedCallers]"));
        assert_eq!(
            converted["input_examples"],
            serde_json::json!([{"title":"Billing issue"}])
        );
        assert_eq!(
            converted["allowed_callers"],
            serde_json::json!(["assistant", "code_execution"])
        );
    }

    #[test]
    fn test_convert_openai_tool_choice_to_anthropic_variants() {
        assert_eq!(
            ClaudeCustomProvider::convert_openai_tool_choice_to_anthropic(&Some(
                serde_json::json!("required")
            )),
            Some(serde_json::json!({"type":"any"}))
        );
        assert_eq!(
            ClaudeCustomProvider::convert_openai_tool_choice_to_anthropic(&Some(
                serde_json::json!({"type":"function","function":{"name":"create_ticket"}})
            )),
            Some(serde_json::json!({"type":"tool","name":"create_ticket"}))
        );
        assert_eq!(
            ClaudeCustomProvider::convert_openai_tool_choice_to_anthropic(&Some(
                serde_json::json!({"type":"none"})
            )),
            Some(serde_json::json!({"type":"none"}))
        );
    }

    #[test]
    fn test_convert_openai_tool_to_anthropic_uses_builtin_input_examples_fallback() {
        let tool = Tool::Function {
            function: FunctionDef {
                name: "WebSearch".to_string(),
                description: Some("允许 Claude 搜索网络并使用结果来提供响应。".to_string()),
                parameters: Some(serde_json::json!({
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "limit": {"type": "integer"}
                    },
                    "required": ["query"]
                })),
            },
        };

        let converted = ClaudeCustomProvider::convert_openai_tool_to_anthropic(&tool)
            .expect("tool should be converted");
        let description = converted
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

        assert!(description.contains("[InputExamples]"));
        assert!(converted
            .get("input_examples")
            .and_then(|v| v.as_array())
            .map(|arr| !arr.is_empty())
            .unwrap_or(false));
    }

    #[test]
    fn test_convert_openai_tool_to_anthropic_supports_x_lime_alias() {
        let tool = Tool::Function {
            function: FunctionDef {
                name: "create_ticket".to_string(),
                description: Some("Create support ticket".to_string()),
                parameters: Some(serde_json::json!({
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"}
                    },
                    "x_lime": {
                        "inputExamples": [{"title":"Billing issue"}],
                        "allowedCallers": ["tool_search"]
                    }
                })),
            },
        };

        let converted = ClaudeCustomProvider::convert_openai_tool_to_anthropic(&tool)
            .expect("tool should be converted");
        let description = converted
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or_default();

        assert!(description.contains("[InputExamples]"));
        assert!(description.contains("[AllowedCallers]"));
        assert_eq!(
            converted["input_examples"],
            serde_json::json!([{"title":"Billing issue"}])
        );
        assert_eq!(
            converted["allowed_callers"],
            serde_json::json!(["tool_search"])
        );
    }

    #[test]
    fn test_convert_openai_tool_to_anthropic_does_not_duplicate_markers() {
        let tool = Tool::Function {
            function: FunctionDef {
                name: "create_ticket".to_string(),
                description: Some(
                    "Create support ticket\n\n[InputExamples] {\"title\":\"Preset\"}\n\n[AllowedCallers] assistant"
                        .to_string(),
                ),
                parameters: Some(serde_json::json!({
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"}
                    },
                    "x-lime": {
                        "input_examples": [{"title":"Billing issue"}],
                        "allowed_callers": ["assistant"]
                    }
                })),
            },
        };

        let converted = ClaudeCustomProvider::convert_openai_tool_to_anthropic(&tool)
            .expect("tool should be converted");
        let description = converted
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or_default();

        assert_eq!(description.matches("[InputExamples]").count(), 1);
        assert_eq!(description.matches("[AllowedCallers]").count(), 1);
    }

    #[test]
    fn test_apply_prompt_cache_control_marks_system_last_two_users_and_last_tool() {
        let mut payload = json!({
            "model": "claude-sonnet-4",
            "system": "You are a helpful assistant.",
            "messages": [
                {
                    "role": "user",
                    "content": [{"type": "text", "text": "第一轮"}]
                },
                {
                    "role": "assistant",
                    "content": [{"type": "text", "text": "收到"}]
                },
                {
                    "role": "user",
                    "content": [{"type": "text", "text": "第二轮"}]
                },
                {
                    "role": "user",
                    "content": "第三轮"
                }
            ],
            "tools": [
                {"name": "tool_a", "input_schema": {"type": "object"}},
                {"name": "tool_b", "input_schema": {"type": "object"}}
            ]
        });

        ClaudeCustomProvider::apply_prompt_cache_control(&mut payload);

        let system = payload["system"]
            .as_array()
            .expect("system should be array");
        assert_eq!(system[0]["cache_control"]["type"], "ephemeral");

        let messages = payload["messages"]
            .as_array()
            .expect("messages should be array");
        assert!(messages[0]["content"][0].get("cache_control").is_none());
        assert_eq!(
            messages[2]["content"][0]["cache_control"]["type"],
            "ephemeral"
        );
        assert_eq!(
            messages[3]["content"][0]["cache_control"]["type"],
            "ephemeral"
        );

        let tools = payload["tools"].as_array().expect("tools should be array");
        assert!(tools[0].get("cache_control").is_none());
        assert_eq!(tools[1]["cache_control"]["type"], "ephemeral");
    }

    #[test]
    fn test_apply_prompt_cache_control_respects_existing_markers() {
        let mut payload = json!({
            "model": "claude-sonnet-4",
            "system": [{
                "type": "text",
                "text": "preset",
                "cache_control": {"type": "ephemeral"}
            }],
            "messages": [
                {
                    "role": "user",
                    "content": [{"type": "text", "text": "hello"}]
                }
            ],
            "tools": [
                {"name": "tool_a", "input_schema": {"type": "object"}}
            ]
        });

        ClaudeCustomProvider::apply_prompt_cache_control(&mut payload);

        assert!(payload["messages"][0]["content"][0]
            .get("cache_control")
            .is_none());
        assert!(payload["tools"][0].get("cache_control").is_none());
    }

    #[test]
    fn test_apply_prompt_cache_control_for_explicit_only_skips_auto_injection() {
        let mut payload = json!({
            "model": "glm-5.1",
            "system": "You are a helpful assistant.",
            "messages": [
                {
                    "role": "user",
                    "content": [{"type": "text", "text": "hello"}]
                }
            ],
            "tools": [
                {"name": "tool_a", "input_schema": {"type": "object"}}
            ]
        });

        ClaudeCustomProvider::apply_prompt_cache_control_for_mode(
            PromptCacheMode::ExplicitOnly,
            &mut payload,
        );

        assert!(payload["system"].is_string());
        assert!(payload["messages"][0]["content"][0]
            .get("cache_control")
            .is_none());
        assert!(payload["tools"][0].get("cache_control").is_none());
    }

    #[test]
    fn test_anthropic_prompt_tokens_include_cache_usage() {
        let response = json!({
            "usage": {
                "input_tokens": 15,
                "cache_creation_input_tokens": 120,
                "cache_read_input_tokens": 80,
                "output_tokens": 10
            }
        });

        assert_eq!(
            ClaudeCustomProvider::anthropic_prompt_tokens(&response),
            215
        );
        assert_eq!(
            ClaudeCustomProvider::anthropic_completion_tokens(&response),
            10
        );
    }

    #[test]
    fn test_effective_runtime_spec_uses_authorization_for_minimax_host() {
        let provider = ClaudeCustomProvider::with_config(
            "test-key".to_string(),
            Some("https://api.minimaxi.com/anthropic".to_string()),
        );

        let spec = provider.effective_runtime_spec();
        assert_eq!(spec.protocol_family, ProviderProtocolFamily::Anthropic);
        assert_eq!(spec.auth_header, "Authorization");
        assert_eq!(spec.auth_prefix, Some("Bearer"));
    }

    #[test]
    fn test_effective_runtime_spec_keeps_x_api_key_for_official_anthropic() {
        let provider = ClaudeCustomProvider::with_config(
            "test-key".to_string(),
            Some("https://api.anthropic.com".to_string()),
        );

        let spec = provider.effective_runtime_spec();
        assert_eq!(spec.protocol_family, ProviderProtocolFamily::Anthropic);
        assert_eq!(spec.auth_header, "x-api-key");
        assert_eq!(spec.auth_prefix, None);
    }

    #[test]
    fn test_lime_tenant_id_from_base_url_fragment() {
        let provider = ClaudeCustomProvider::with_config(
            "test-key".to_string(),
            Some("https://llm.limeai.run#lime_tenant_id=tenant-0001".to_string()),
        );

        assert_eq!(
            provider.lime_tenant_id_from_base_url().as_deref(),
            Some("tenant-0001")
        );
        assert_eq!(
            provider.build_url("messages"),
            "https://llm.limeai.run/v1/messages"
        );
    }

    #[test]
    fn test_apply_runtime_headers_adds_dual_auth_headers_for_minimax_host() {
        let provider = ClaudeCustomProvider::with_config(
            "test-key".to_string(),
            Some("https://api.minimaxi.com/anthropic".to_string()),
        );

        let request = provider
            .apply_runtime_headers(
                reqwest::Client::new().post("https://example.com"),
                "test-key",
            )
            .build()
            .expect("构建请求失败");

        assert_eq!(
            request
                .headers()
                .get("Authorization")
                .and_then(|value| value.to_str().ok()),
            Some("Bearer test-key")
        );
        assert_eq!(
            request
                .headers()
                .get("x-api-key")
                .and_then(|value| value.to_str().ok()),
            Some("test-key")
        );
        assert_eq!(
            request
                .headers()
                .get("anthropic-version")
                .and_then(|value| value.to_str().ok()),
            Some("2023-06-01")
        );
    }

    #[test]
    fn test_apply_runtime_headers_adds_lime_tenant_header_from_fragment() {
        let provider = ClaudeCustomProvider::with_config(
            "test-key".to_string(),
            Some("https://llm.limeai.run#lime_tenant_id=tenant-0001".to_string()),
        );

        let request = provider
            .apply_runtime_headers(
                reqwest::Client::new().post("https://example.com"),
                "test-key",
            )
            .build()
            .expect("构建请求失败");

        assert_eq!(
            request
                .headers()
                .get(LIME_TENANT_HEADER)
                .and_then(|value| value.to_str().ok()),
            Some("tenant-0001")
        );
    }

    #[test]
    fn test_apply_runtime_headers_keeps_official_anthropic_single_auth_header() {
        let provider = ClaudeCustomProvider::with_config(
            "test-key".to_string(),
            Some("https://api.anthropic.com".to_string()),
        );

        let request = provider
            .apply_runtime_headers(
                reqwest::Client::new().post("https://example.com"),
                "test-key",
            )
            .build()
            .expect("构建请求失败");

        assert_eq!(
            request
                .headers()
                .get("x-api-key")
                .and_then(|value| value.to_str().ok()),
            Some("test-key")
        );
        assert!(request.headers().get("Authorization").is_none());
    }
}
