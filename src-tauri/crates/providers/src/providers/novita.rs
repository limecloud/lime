//! Novita AI Provider（OpenAI 兼容 API）
//!
//! Novita AI 提供 OpenAI 兼容的 HTTP 端点，通过 Bearer Token 认证。
//! 环境变量 `NOVITA_API_KEY` 可用作 API Key 的回退来源。

use lime_core::models::openai::ChatCompletionRequest;
use reqwest::Client;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use std::error::Error;
use std::time::Duration;

/// Novita AI 默认 API 端点
pub const NOVITA_API_BASE_URL: &str = "https://api.novita.ai/openai";

/// 默认对话模型
pub const NOVITA_DEFAULT_MODEL: &str = "moonshotai/kimi-k2.5";

/// Novita AI 已知支持的对话模型列表
pub const NOVITA_SUPPORTED_MODELS: &[&str] = &[
    "moonshotai/kimi-k2.5",
    "deepseek/deepseek-v3.2",
    "zai-org/glm-5",
];

/// Novita AI 嵌入模型
pub const NOVITA_EMBEDDING_MODEL: &str = "qwen/qwen3-embedding-0.6b";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NovitaConfig {
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub enabled: bool,
}

pub struct NovitaProvider {
    pub config: NovitaConfig,
    pub client: Client,
}

fn create_http_client() -> Client {
    Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(600))
        .tcp_keepalive(Duration::from_secs(60))
        .gzip(true)
        .brotli(true)
        .deflate(true)
        .build()
        .unwrap_or_else(|_| Client::new())
}

impl Default for NovitaProvider {
    fn default() -> Self {
        // 回退到环境变量 NOVITA_API_KEY
        let api_key = std::env::var("NOVITA_API_KEY").ok();
        let enabled = api_key.is_some();
        Self {
            config: NovitaConfig {
                api_key,
                base_url: None,
                enabled,
            },
            client: create_http_client(),
        }
    }
}

impl NovitaProvider {
    pub fn new() -> Self {
        Self::default()
    }

    /// 使用 API Key 和可选 base_url 创建 Provider
    pub fn with_config(api_key: String, base_url: Option<String>) -> Self {
        Self {
            config: NovitaConfig {
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
            .unwrap_or_else(|| NOVITA_API_BASE_URL.to_string())
    }

    pub fn is_configured(&self) -> bool {
        self.config.api_key.is_some() && self.config.enabled
    }

    /// 构建完整的 API URL
    ///
    /// 支持的格式：
    /// - `https://api.novita.ai/openai`       -> `https://api.novita.ai/openai/v1/chat/completions`
    /// - `https://api.novita.ai/openai/v1`    -> `https://api.novita.ai/openai/v1/chat/completions`
    fn build_url(&self, endpoint: &str) -> String {
        let base = self.get_base_url();
        let base = base.trim_end_matches('/');

        let has_version = base
            .rsplit('/')
            .next()
            .map(|seg| {
                seg.starts_with('v')
                    && seg.len() >= 2
                    && seg[1..].chars().all(|c| c.is_ascii_digit())
            })
            .unwrap_or(false);

        if has_version {
            format!("{base}/{endpoint}")
        } else {
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

    /// 调用 Novita AI API（类型化请求）
    pub async fn call_api(
        &self,
        request: &ChatCompletionRequest,
    ) -> Result<reqwest::Response, Box<dyn Error + Send + Sync>> {
        let api_key = self
            .config
            .api_key
            .as_ref()
            .ok_or("Novita API key not configured")?;

        let url = self.build_url("chat/completions");

        eprintln!(
            "[NOVITA] call_api URL: {url} model: {}",
            request.model
        );

        let payload = serde_json::to_value(request)
            .map_err(|e| format!("序列化 Novita 请求失败: {e}"))?;

        let resp = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {api_key}"))
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await?;

        if resp.status() == StatusCode::NOT_FOUND {
            if let Some(fallback) = self.build_url_fallback_without_v1("chat/completions") {
                if fallback != url {
                    return Ok(self
                        .client
                        .post(&fallback)
                        .header("Authorization", format!("Bearer {api_key}"))
                        .header("Content-Type", "application/json")
                        .json(&payload)
                        .send()
                        .await?);
                }
            }
        }

        Ok(resp)
    }

    pub async fn chat_completions(
        &self,
        request: &serde_json::Value,
    ) -> Result<reqwest::Response, Box<dyn Error + Send + Sync>> {
        let api_key = self
            .config
            .api_key
            .as_ref()
            .ok_or("Novita API key not configured")?;

        let url = self.build_url("chat/completions");

        eprintln!("[NOVITA] chat_completions URL: {url}");

        let resp = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {api_key}"))
            .header("Content-Type", "application/json")
            .json(request)
            .send()
            .await?;

        if resp.status() == StatusCode::NOT_FOUND {
            if let Some(fallback) = self.build_url_fallback_without_v1("chat/completions") {
                if fallback != url {
                    return Ok(self
                        .client
                        .post(&fallback)
                        .header("Authorization", format!("Bearer {api_key}"))
                        .header("Content-Type", "application/json")
                        .json(request)
                        .send()
                        .await?);
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
            .ok_or("Novita API key not configured")?;

        let url = self.build_url("models");

        eprintln!("[NOVITA] list_models URL: {url}");

        let resp = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {api_key}"))
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            eprintln!("[NOVITA] list_models 失败: {status} - {body}");
            return Err(format!("Failed to list Novita models: {status} - {body}").into());
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
impl StreamingProvider for NovitaProvider {
    async fn call_api_stream(
        &self,
        request: &ChatCompletionRequest,
    ) -> Result<StreamResponse, ProviderError> {
        let api_key = self.config.api_key.as_ref().ok_or_else(|| {
            ProviderError::ConfigurationError("Novita API key not configured".to_string())
        })?;

        let mut stream_request = request.clone();
        stream_request.stream = true;
        let payload = serde_json::to_value(&stream_request)
            .map_err(|e| ProviderError::ConfigurationError(format!("序列化流式请求失败: {e}")))?;

        let url = self.build_url("chat/completions");

        tracing::info!(
            "[NOVITA_STREAM] 发起流式请求: url={} model={}",
            url,
            request.model
        );

        let resp = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {api_key}"))
            .header("Content-Type", "application/json")
            .header("Accept", "text/event-stream")
            .json(&payload)
            .send()
            .await
            .map_err(|e| ProviderError::from_reqwest_error(&e))?;

        let resp = if resp.status() == StatusCode::NOT_FOUND {
            if let Some(fallback) = self.build_url_fallback_without_v1("chat/completions") {
                if fallback != url {
                    self.client
                        .post(&fallback)
                        .header("Authorization", format!("Bearer {api_key}"))
                        .header("Content-Type", "application/json")
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

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            tracing::error!("[NOVITA_STREAM] 请求失败: {} - {}", status, body);
            return Err(ProviderError::from_http_status(status.as_u16(), &body));
        }

        tracing::info!("[NOVITA_STREAM] 流式响应开始: status={}", status);

        Ok(reqwest_stream_to_stream_response(resp))
    }

    fn supports_streaming(&self) -> bool {
        self.is_configured()
    }

    fn provider_name(&self) -> &'static str {
        "NovitaProvider"
    }

    fn stream_format(&self) -> StreamFormat {
        StreamFormat::OpenAiSse
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_url_no_version_adds_v1() {
        let provider = NovitaProvider::with_config("sk-test".to_string(), None);
        let url = provider.build_url("chat/completions");
        assert_eq!(url, "https://api.novita.ai/openai/v1/chat/completions");
    }

    #[test]
    fn test_build_url_with_v1_suffix_no_double_v1() {
        let provider = NovitaProvider::with_config(
            "sk-test".to_string(),
            Some("https://api.novita.ai/openai/v1".to_string()),
        );
        let url = provider.build_url("chat/completions");
        assert_eq!(url, "https://api.novita.ai/openai/v1/chat/completions");
    }

    #[test]
    fn test_build_url_custom_base() {
        let provider = NovitaProvider::with_config(
            "sk-test".to_string(),
            Some("https://proxy.example.com/novita/v1".to_string()),
        );
        let url = provider.build_url("chat/completions");
        assert_eq!(
            url,
            "https://proxy.example.com/novita/v1/chat/completions"
        );
    }

    #[test]
    fn test_is_configured_with_key() {
        let provider = NovitaProvider::with_config("sk-test".to_string(), None);
        assert!(provider.is_configured());
    }

    #[test]
    fn test_is_configured_without_key() {
        let provider = NovitaProvider {
            config: NovitaConfig {
                api_key: None,
                base_url: None,
                enabled: false,
            },
            client: Client::new(),
        };
        assert!(!provider.is_configured());
    }

    #[test]
    fn test_default_model_constant() {
        assert_eq!(NOVITA_DEFAULT_MODEL, "moonshotai/kimi-k2.5");
    }

    #[test]
    fn test_supported_models_contains_all_spec_models() {
        assert!(NOVITA_SUPPORTED_MODELS.contains(&"moonshotai/kimi-k2.5"));
        assert!(NOVITA_SUPPORTED_MODELS.contains(&"deepseek/deepseek-v3.2"));
        assert!(NOVITA_SUPPORTED_MODELS.contains(&"zai-org/glm-5"));
    }

    #[test]
    fn test_embedding_model_constant() {
        assert_eq!(NOVITA_EMBEDDING_MODEL, "qwen/qwen3-embedding-0.6b");
    }

    #[test]
    fn test_get_base_url_default() {
        let provider = NovitaProvider::with_config("sk-test".to_string(), None);
        assert_eq!(provider.get_base_url(), NOVITA_API_BASE_URL);
    }

    #[test]
    fn test_get_base_url_custom() {
        let custom = "https://my-proxy.example.com/novita".to_string();
        let provider = NovitaProvider::with_config("sk-test".to_string(), Some(custom.clone()));
        assert_eq!(provider.get_base_url(), custom);
    }

    #[test]
    fn test_stream_format_is_openai_sse() {
        let provider = NovitaProvider::with_config("sk-test".to_string(), None);
        assert!(matches!(provider.stream_format(), StreamFormat::OpenAiSse));
    }

    #[test]
    fn test_provider_name() {
        let provider = NovitaProvider::with_config("sk-test".to_string(), None);
        assert_eq!(provider.provider_name(), "NovitaProvider");
    }
}
