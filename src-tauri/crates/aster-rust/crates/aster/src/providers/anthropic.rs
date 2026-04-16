use anyhow::Result;
use async_stream::try_stream;
use async_trait::async_trait;
use futures::TryStreamExt;
use reqwest::StatusCode;
use serde_json::Value;
use std::io;
use tokio::pin;
use tokio_util::io::StreamReader;

use super::api_client::{ApiClient, ApiResponse, AuthMethod};
use super::base::{ConfigKey, MessageStream, ModelInfo, Provider, ProviderMetadata, ProviderUsage};
use super::errors::ProviderError;
use super::formats::anthropic::{
    create_request, get_usage, response_to_message, response_to_streaming_message,
};
use super::utils::{get_model, handle_status_openai_compat, map_http_error_to_provider_error};
use crate::config::declarative_providers::DeclarativeProviderConfig;
use crate::conversation::message::Message;
use crate::model::ModelConfig;
use crate::providers::retry::ProviderRetry;
use crate::providers::utils::RequestLog;
use rmcp::model::Tool;

pub const ANTHROPIC_DEFAULT_MODEL: &str = "claude-sonnet-4-5";
const ANTHROPIC_DEFAULT_FAST_MODEL: &str = "claude-haiku-4-5";
const ANTHROPIC_KNOWN_MODELS: &[&str] = &[
    // Claude 4.5 models with aliases
    "claude-sonnet-4-5",
    "claude-sonnet-4-5-20250929",
    "claude-haiku-4-5",
    "claude-haiku-4-5-20251001",
    "claude-opus-4-5",
    "claude-opus-4-5-20251101",
];

const ANTHROPIC_DOC_URL: &str = "https://docs.anthropic.com/en/docs/about-claude/models";
const ANTHROPIC_API_VERSION: &str = "2023-06-01";

fn normalize_anthropic_host(host: &str) -> String {
    host.trim().trim_end_matches('/').to_ascii_lowercase()
}

fn should_use_bearer_auth_for_anthropic_host(host: &str) -> bool {
    let normalized_host = normalize_anthropic_host(host);
    if normalized_host.is_empty() {
        return false;
    }

    [
        "bigmodel.cn/api/anthropic",
        "moonshot.cn/anthropic",
        "moonshot.ai/anthropic",
        "minimaxi.com/anthropic",
        "minimax.io/anthropic",
        "token-plan-cn.xiaomimimo.com/anthropic",
    ]
    .iter()
    .any(|needle| normalized_host.contains(needle))
}

fn resolve_anthropic_auth(host: &str, secret: String) -> AuthMethod {
    if should_use_bearer_auth_for_anthropic_host(host) {
        AuthMethod::BearerToken(secret)
    } else {
        AuthMethod::ApiKey {
            header_name: "x-api-key".to_string(),
            key: secret,
        }
    }
}

#[derive(serde::Serialize)]
pub struct AnthropicProvider {
    #[serde(skip)]
    api_client: ApiClient,
    model: ModelConfig,
    supports_streaming: bool,
    name: String,
}

impl AnthropicProvider {
    pub async fn from_env(model: ModelConfig) -> Result<Self> {
        let model = model.with_fast(ANTHROPIC_DEFAULT_FAST_MODEL.to_string());

        let config = crate::config::Config::global();
        let host: String = config
            .get_param("ANTHROPIC_HOST")
            .or_else(|_| config.get_param("ANTHROPIC_BASE_URL"))
            .unwrap_or_else(|_| "https://api.anthropic.com".to_string());
        let api_key: String = if should_use_bearer_auth_for_anthropic_host(&host) {
            config
                .get_secret("ANTHROPIC_AUTH_TOKEN")
                .or_else(|_| config.get_secret("ANTHROPIC_API_KEY"))?
        } else {
            config
                .get_secret("ANTHROPIC_API_KEY")
                .or_else(|_| config.get_secret("ANTHROPIC_AUTH_TOKEN"))?
        };

        let auth = resolve_anthropic_auth(&host, api_key);

        let api_client =
            ApiClient::new(host, auth)?.with_header("anthropic-version", ANTHROPIC_API_VERSION)?;

        Ok(Self {
            api_client,
            model,
            supports_streaming: true,
            name: Self::metadata().name,
        })
    }

    pub fn from_custom_config(
        model: ModelConfig,
        config: DeclarativeProviderConfig,
    ) -> Result<Self> {
        let global_config = crate::config::Config::global();
        let api_key: String = global_config
            .get_secret(&config.api_key_env)
            .map_err(|_| anyhow::anyhow!("Missing API key: {}", config.api_key_env))?;

        let auth = resolve_anthropic_auth(&config.base_url, api_key);

        let api_client = ApiClient::new(config.base_url, auth)?
            .with_header("anthropic-version", ANTHROPIC_API_VERSION)?;

        Ok(Self {
            api_client,
            model,
            supports_streaming: config.supports_streaming.unwrap_or(true),
            name: config.name.clone(),
        })
    }

    fn get_conditional_headers(&self) -> Vec<(&str, &str)> {
        let mut headers = Vec::new();

        let is_thinking_enabled = std::env::var("CLAUDE_THINKING_ENABLED").is_ok();
        if self.model.model_name.starts_with("claude-3-7-sonnet-") {
            if is_thinking_enabled {
                headers.push(("anthropic-beta", "output-128k-2025-02-19"));
            }
            headers.push(("anthropic-beta", "token-efficient-tools-2025-02-19"));
        }

        headers
    }

    async fn post(&self, payload: &Value) -> Result<ApiResponse, ProviderError> {
        let mut request = self.api_client.request("v1/messages");

        for (key, value) in self.get_conditional_headers() {
            request = request.header(key, value)?;
        }

        Ok(request.api_post(payload).await?)
    }

    async fn post_stream(&self, payload: &Value) -> Result<reqwest::Response, ProviderError> {
        let mut request = self.api_client.request("v1/messages");

        for (key, value) in self.get_conditional_headers() {
            request = request.header(key, value)?;
        }

        let response = Box::pin(async move { request.response_post(payload).await }).await?;
        Box::pin(async move { handle_status_openai_compat(response).await }).await
    }

    fn anthropic_api_call_result(response: ApiResponse) -> Result<Value, ProviderError> {
        match response.status {
            StatusCode::OK => response.payload.ok_or_else(|| {
                ProviderError::RequestFailed("Response body is not valid JSON".to_string())
            }),
            _ => {
                if response.status == StatusCode::BAD_REQUEST {
                    if let Some(error_msg) = response
                        .payload
                        .as_ref()
                        .and_then(|p| p.get("error"))
                        .and_then(|e| e.get("message"))
                        .and_then(|m| m.as_str())
                    {
                        let msg = error_msg.to_string();
                        if msg.to_lowercase().contains("too long")
                            || msg.to_lowercase().contains("too many")
                        {
                            return Err(ProviderError::ContextLengthExceeded(msg));
                        }
                    }
                }
                Err(map_http_error_to_provider_error(
                    response.status,
                    response.payload,
                ))
            }
        }
    }
}

#[async_trait]
impl Provider for AnthropicProvider {
    fn metadata() -> ProviderMetadata {
        let models: Vec<ModelInfo> = ANTHROPIC_KNOWN_MODELS
            .iter()
            .map(|&model_name| ModelInfo::new(model_name, 200_000))
            .collect();

        ProviderMetadata::with_models(
            "anthropic",
            "Anthropic",
            "Claude and other models from Anthropic",
            ANTHROPIC_DEFAULT_MODEL,
            models,
            ANTHROPIC_DOC_URL,
            vec![
                ConfigKey::new("ANTHROPIC_API_KEY", true, true, None),
                ConfigKey::new("ANTHROPIC_AUTH_TOKEN", true, true, None),
                ConfigKey::new(
                    "ANTHROPIC_HOST",
                    true,
                    false,
                    Some("https://api.anthropic.com"),
                ),
            ],
        )
    }

    fn get_name(&self) -> &str {
        &self.name
    }

    fn get_model_config(&self) -> ModelConfig {
        self.model.clone()
    }

    #[tracing::instrument(
        skip(self, model_config, system, messages, tools),
        fields(model_config, input, output, input_tokens, output_tokens, total_tokens)
    )]
    async fn complete_with_model(
        &self,
        model_config: &ModelConfig,
        system: &str,
        messages: &[Message],
        tools: &[Tool],
    ) -> Result<(Message, ProviderUsage), ProviderError> {
        let payload = create_request(model_config, system, messages, tools)?;

        let response = self
            .with_retry(|| async { self.post(&payload).await })
            .await?;

        let json_response = Self::anthropic_api_call_result(response)?;

        let message = response_to_message(&json_response)?;
        let usage = get_usage(&json_response)?;
        tracing::debug!("🔍 Anthropic non-streaming parsed usage: input_tokens={:?}, output_tokens={:?}, total_tokens={:?}",
                usage.input_tokens, usage.output_tokens, usage.total_tokens);

        let response_model = get_model(&json_response);
        let mut log = RequestLog::start(&self.model, &payload)?;
        log.write(&json_response, Some(&usage))?;
        let provider_usage = ProviderUsage::new(response_model, usage);
        tracing::debug!(
            "🔍 Anthropic non-streaming returning ProviderUsage: {:?}",
            provider_usage
        );
        Ok((message, provider_usage))
    }

    async fn fetch_supported_models(&self) -> Result<Option<Vec<String>>, ProviderError> {
        let response = self.api_client.api_get("v1/models").await?;

        if response.status != StatusCode::OK {
            return Err(map_http_error_to_provider_error(
                response.status,
                response.payload,
            ));
        }

        let json = response.payload.unwrap_or_default();
        let arr = match json.get("data").and_then(|v| v.as_array()) {
            Some(arr) => arr,
            None => return Ok(None),
        };

        let mut models: Vec<String> = arr
            .iter()
            .filter_map(|m| m.get("id").and_then(|v| v.as_str()).map(str::to_string))
            .collect();
        models.sort();
        Ok(Some(models))
    }

    async fn stream(
        &self,
        system: &str,
        messages: &[Message],
        tools: &[Tool],
    ) -> Result<MessageStream, ProviderError> {
        let mut payload = create_request(&self.model, system, messages, tools)?;
        payload
            .as_object_mut()
            .unwrap()
            .insert("stream".to_string(), Value::Bool(true));

        let mut log = RequestLog::start(&self.model, &payload)?;

        let response = self
            .with_retry(|| {
                let payload = payload.clone();
                async move { self.post_stream(&payload).await }
            })
            .await
            .inspect_err(|e| {
                let _ = log.error(e);
            })?;

        let stream = response.bytes_stream().map_err(io::Error::other);

        Ok(Box::pin(try_stream! {
            let stream_reader = StreamReader::new(stream);
            let framed = tokio_util::codec::FramedRead::new(stream_reader, tokio_util::codec::LinesCodec::new()).map_err(anyhow::Error::from);

            let message_stream = response_to_streaming_message(framed);
            pin!(message_stream);
            while let Some(message) = futures::StreamExt::next(&mut message_stream).await {
                let (message, usage) = message.map_err(|e| ProviderError::RequestFailed(format!("Stream decode error: {}", e)))?;
                log.write(&message, usage.as_ref().map(|f| f.usage).as_ref())?;
                yield (message, usage);
            }
        }))
    }

    fn supports_streaming(&self) -> bool {
        self.supports_streaming
    }
}

#[cfg(test)]
mod tests {
    use super::{resolve_anthropic_auth, should_use_bearer_auth_for_anthropic_host};
    use crate::providers::api_client::AuthMethod;

    #[test]
    fn test_known_official_anthropic_compatible_hosts_use_bearer_auth() {
        assert!(should_use_bearer_auth_for_anthropic_host(
            "https://api.minimaxi.com/anthropic"
        ));
        assert!(should_use_bearer_auth_for_anthropic_host(
            "https://open.bigmodel.cn/api/anthropic"
        ));
    }

    #[test]
    fn test_official_anthropic_host_keeps_x_api_key_auth() {
        assert!(!should_use_bearer_auth_for_anthropic_host(
            "https://api.anthropic.com"
        ));
    }

    #[test]
    fn test_resolve_anthropic_auth_uses_expected_auth_method() {
        match resolve_anthropic_auth("https://api.minimaxi.com/anthropic", "k1".to_string()) {
            AuthMethod::BearerToken(token) => assert_eq!(token, "k1"),
            _ => panic!("expected bearer token auth"),
        }

        match resolve_anthropic_auth("https://api.anthropic.com", "k2".to_string()) {
            AuthMethod::ApiKey { header_name, key } => {
                assert_eq!(header_name, "x-api-key");
                assert_eq!(key, "k2");
            }
            _ => panic!("expected x-api-key auth"),
        }
    }
}
