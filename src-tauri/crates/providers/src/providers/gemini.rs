//! Gemini API Key Provider
//!
//! Gemini OAuth 已随凭证池退役；本模块只保留 API Key Provider 主路径。

use reqwest::Client;
use std::error::Error;

/// Default Gemini API base URL
pub const GEMINI_API_BASE_URL: &str = "https://generativelanguage.googleapis.com";

/// Gemini API Key Provider for multi-account load balancing.
#[derive(Debug, Clone)]
pub struct GeminiApiKeyCredential {
    /// Credential ID
    pub id: String,
    /// API Key
    pub api_key: String,
    /// Custom base URL (optional)
    pub base_url: Option<String>,
    /// Excluded models (supports wildcards)
    pub excluded_models: Vec<String>,
    /// Per-key proxy URL (optional)
    pub proxy_url: Option<String>,
    /// Whether this credential is disabled
    pub disabled: bool,
}

impl GeminiApiKeyCredential {
    /// Create a new Gemini API Key credential.
    pub fn new(id: String, api_key: String) -> Self {
        Self {
            id,
            api_key,
            base_url: None,
            excluded_models: Vec::new(),
            proxy_url: None,
            disabled: false,
        }
    }

    /// Set custom base URL.
    pub fn with_base_url(mut self, base_url: Option<String>) -> Self {
        self.base_url = base_url;
        self
    }

    /// Set excluded models.
    pub fn with_excluded_models(mut self, excluded_models: Vec<String>) -> Self {
        self.excluded_models = excluded_models;
        self
    }

    /// Set proxy URL.
    pub fn with_proxy_url(mut self, proxy_url: Option<String>) -> Self {
        self.proxy_url = proxy_url;
        self
    }

    /// Set disabled state.
    pub fn with_disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    /// Get the effective base URL (custom or default).
    pub fn get_base_url(&self) -> &str {
        self.base_url.as_deref().unwrap_or(GEMINI_API_BASE_URL)
    }

    /// Check if this credential is available (not disabled).
    pub fn is_available(&self) -> bool {
        !self.disabled
    }

    /// Check if this credential supports the given model.
    pub fn supports_model(&self, model: &str) -> bool {
        !self.excluded_models.iter().any(|pattern| {
            if pattern.contains('*') {
                let pattern = pattern.replace('*', ".*");
                regex::Regex::new(&format!("^{pattern}$"))
                    .map(|re| re.is_match(model))
                    .unwrap_or(false)
            } else {
                pattern == model
            }
        })
    }

    /// Build the API URL for a given model and action.
    pub fn build_api_url(&self, model: &str, action: &str) -> String {
        format!("{}/v1beta/models/{}:{}", self.get_base_url(), model, action)
    }
}

/// Gemini API Key Provider.
pub struct GeminiApiKeyProvider {
    /// HTTP client
    pub client: Client,
}

impl Default for GeminiApiKeyProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl GeminiApiKeyProvider {
    /// Create a new Gemini API Key provider.
    pub fn new() -> Self {
        Self {
            client: Client::new(),
        }
    }

    /// Create a provider with a custom HTTP client.
    pub fn with_client(client: Client) -> Self {
        Self { client }
    }

    /// Make a generateContent request using the given credential.
    pub async fn generate_content(
        &self,
        credential: &GeminiApiKeyCredential,
        model: &str,
        body: &serde_json::Value,
    ) -> Result<serde_json::Value, Box<dyn Error + Send + Sync>> {
        let url = credential.build_api_url(model, "generateContent");

        let resp = self
            .client
            .post(&url)
            .header("x-goog-api-key", &credential.api_key)
            .header("Content-Type", "application/json")
            .json(body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Gemini API call failed: {status} - {body}").into());
        }

        let data: serde_json::Value = resp.json().await?;
        Ok(data)
    }

    /// Make a streamGenerateContent request using the given credential.
    pub async fn stream_generate_content(
        &self,
        credential: &GeminiApiKeyCredential,
        model: &str,
        body: &serde_json::Value,
    ) -> Result<reqwest::Response, Box<dyn Error + Send + Sync>> {
        let url = format!(
            "{}?alt=sse",
            credential.build_api_url(model, "streamGenerateContent")
        );

        let resp = self
            .client
            .post(&url)
            .header("x-goog-api-key", &credential.api_key)
            .header("Content-Type", "application/json")
            .json(body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Gemini API stream call failed: {status} - {body}").into());
        }

        Ok(resp)
    }

    /// List available models using the given credential.
    pub async fn list_models(
        &self,
        credential: &GeminiApiKeyCredential,
    ) -> Result<serde_json::Value, Box<dyn Error + Send + Sync>> {
        let url = format!("{}/v1beta/models", credential.get_base_url());

        let resp = self
            .client
            .get(&url)
            .header("x-goog-api-key", &credential.api_key)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Gemini API list models failed: {status} - {body}").into());
        }

        let data: serde_json::Value = resp.json().await?;
        Ok(data)
    }
}

#[cfg(test)]
mod gemini_api_key_tests {
    use super::*;

    #[test]
    fn test_gemini_api_key_credential_new() {
        let cred = GeminiApiKeyCredential::new("test-id".to_string(), "test-key".to_string());
        assert_eq!(cred.id, "test-id");
        assert_eq!(cred.api_key, "test-key");
        assert!(cred.base_url.is_none());
        assert!(cred.excluded_models.is_empty());
        assert!(cred.proxy_url.is_none());
        assert!(!cred.disabled);
    }

    #[test]
    fn test_gemini_api_key_credential_with_base_url() {
        let cred = GeminiApiKeyCredential::new("test-id".to_string(), "test-key".to_string())
            .with_base_url(Some("https://custom.api.com".to_string()));
        assert_eq!(cred.get_base_url(), "https://custom.api.com");
    }

    #[test]
    fn test_gemini_api_key_credential_default_base_url() {
        let cred = GeminiApiKeyCredential::new("test-id".to_string(), "test-key".to_string());
        assert_eq!(cred.get_base_url(), GEMINI_API_BASE_URL);
    }

    #[test]
    fn test_gemini_api_key_credential_is_available() {
        let cred = GeminiApiKeyCredential::new("test-id".to_string(), "test-key".to_string());
        assert!(cred.is_available());

        let disabled_cred = cred.with_disabled(true);
        assert!(!disabled_cred.is_available());
    }

    #[test]
    fn test_gemini_api_key_credential_supports_model() {
        let cred = GeminiApiKeyCredential::new("test-id".to_string(), "test-key".to_string())
            .with_excluded_models(vec![
                "gemini-2.5-pro".to_string(),
                "gemini-*-preview".to_string(),
            ]);

        assert!(!cred.supports_model("gemini-2.5-pro"));
        assert!(!cred.supports_model("gemini-3-preview"));
        assert!(!cred.supports_model("gemini-2.5-preview"));
        assert!(cred.supports_model("gemini-2.5-flash"));
        assert!(cred.supports_model("gemini-2.0-flash"));
    }

    #[test]
    fn test_gemini_api_key_credential_build_api_url() {
        let cred = GeminiApiKeyCredential::new("test-id".to_string(), "test-key".to_string());
        let url = cred.build_api_url("gemini-2.5-flash", "generateContent");
        assert_eq!(
            url,
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
        );

        let custom_cred = cred.with_base_url(Some("https://custom.api.com".to_string()));
        let custom_url = custom_cred.build_api_url("gemini-2.5-flash", "generateContent");
        assert_eq!(
            custom_url,
            "https://custom.api.com/v1beta/models/gemini-2.5-flash:generateContent"
        );
    }

    #[test]
    fn test_gemini_api_key_provider_new() {
        let _provider = GeminiApiKeyProvider::new();
    }
}
