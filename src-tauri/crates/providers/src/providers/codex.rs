//! OpenAI Codex OAuth Provider
//!
//! Implements OAuth authentication flow for OpenAI Codex API.
//! Supports PKCE (Proof Key for Code Exchange) for secure authentication.

#![allow(dead_code)]

use super::error::{
    create_auth_error, create_config_error, create_token_refresh_error, ProviderError,
};
use lime_core::api_host_utils::is_openai_responses_endpoint;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::error::Error;
use std::path::PathBuf;

// OAuth Constants
const OPENAI_AUTH_URL: &str = "https://auth.openai.com/oauth/authorize";
const OPENAI_TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
const OPENAI_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEFAULT_CALLBACK_PORT: u16 = 1455;
const CODEX_API_BASE_URL: &str = "https://chatgpt.com/backend-api/codex";
const DEFAULT_API_BASE_URL: &str = "https://api.openai.com";

/// Codex OAuth credentials storage
///
/// Stores OAuth tokens and user information for Codex authentication.
/// Compatible with CLIProxyAPI's CodexTokenStorage format and Codex CLI official format.
///
/// Supports multiple field name formats:
/// - snake_case: `refresh_token`, `access_token`, `id_token`, `account_id`, `last_refresh`
/// - camelCase: `refreshToken`, `accessToken`, `idToken`, `accountId`, `lastRefresh`
///
/// 同时兼容 Codex CLI 的 API Key 登录格式：
/// - `api_key` / `apiKey`
/// - `api_base_url` / `apiBaseUrl`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexCredentials {
    /// JWT ID token containing user claims
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "idToken")]
    pub id_token: Option<String>,
    /// OAuth2 access token for API access
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        alias = "accessToken"
    )]
    pub access_token: Option<String>,
    /// Refresh token for obtaining new access tokens
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        alias = "refreshToken"
    )]
    pub refresh_token: Option<String>,
    /// API Key（Codex CLI 支持通过 API Key 登录）
    /// 支持字段名: api_key, apiKey, OPENAI_API_KEY
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        alias = "apiKey",
        alias = "OPENAI_API_KEY"
    )]
    pub api_key: Option<String>,
    /// API Base URL（可选）
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "apiBaseUrl")]
    pub api_base_url: Option<String>,
    /// OpenAI account identifier
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "accountId")]
    pub account_id: Option<String>,
    /// Timestamp of last token refresh
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        alias = "lastRefresh"
    )]
    pub last_refresh: Option<String>,
    /// User email address
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// Authentication provider type (always "codex")
    #[serde(default = "default_type")]
    pub r#type: String,
    /// Token expiration timestamp (RFC3339 format)
    /// Supports: `expired`, `expires_at`, `expiresAt`
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        alias = "expired",
        alias = "expiresAt"
    )]
    pub expires_at: Option<String>,
}

fn default_type() -> String {
    "codex".to_string()
}

impl Default for CodexCredentials {
    fn default() -> Self {
        Self {
            id_token: None,
            access_token: None,
            refresh_token: None,
            api_key: None,
            api_base_url: None,
            account_id: None,
            last_refresh: None,
            email: None,
            r#type: default_type(),
            expires_at: None,
        }
    }
}

/// PKCE codes for OAuth2 authorization
#[derive(Debug, Clone)]
pub struct PKCECodes {
    /// Cryptographically random string for code verification
    pub code_verifier: String,
    /// SHA256 hash of code_verifier, base64url-encoded
    pub code_challenge: String,
}

impl PKCECodes {
    /// Generate new PKCE codes
    pub fn generate() -> Result<Self, Box<dyn Error + Send + Sync>> {
        use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
        use rand::RngCore;
        use sha2::{Digest, Sha256};

        // Generate 96 random bytes for code verifier
        let mut bytes = [0u8; 96];
        rand::thread_rng().fill_bytes(&mut bytes);
        let code_verifier = URL_SAFE_NO_PAD.encode(bytes);

        // Generate code challenge using S256 method
        let mut hasher = Sha256::new();
        hasher.update(code_verifier.as_bytes());
        let hash = hasher.finalize();
        let code_challenge = URL_SAFE_NO_PAD.encode(hash);

        Ok(Self {
            code_verifier,
            code_challenge,
        })
    }
}

/// OAuth callback result
#[derive(Debug, Clone)]
pub struct OAuthCallbackResult {
    /// Authorization code from OAuth callback
    pub code: String,
    /// State parameter for CSRF protection
    pub state: String,
    /// Error message if authentication failed
    pub error: Option<String>,
}

/// OAuth server for handling OAuth callbacks
pub struct OAuthServer {
    port: u16,
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

impl OAuthServer {
    /// Create a new OAuth server on the specified port
    pub fn new(port: u16) -> Self {
        Self {
            port,
            shutdown_tx: None,
        }
    }

    /// Start the OAuth server and wait for a callback
    ///
    /// Returns the authorization code and state from the OAuth callback.
    /// The server will automatically shut down after receiving a callback or timeout.
    pub async fn wait_for_callback(
        &mut self,
        timeout: std::time::Duration,
    ) -> Result<OAuthCallbackResult, Box<dyn Error + Send + Sync>> {
        use axum::{extract::Query, response::Html, routing::get, Router};
        use std::collections::HashMap;
        use tokio::sync::oneshot;

        let (result_tx, result_rx) = oneshot::channel::<OAuthCallbackResult>();
        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
        self.shutdown_tx = Some(shutdown_tx);

        // Wrap result_tx in Arc<Mutex> for sharing across requests
        let result_tx = std::sync::Arc::new(tokio::sync::Mutex::new(Some(result_tx)));

        let result_tx_clone = result_tx.clone();
        let callback_handler = move |Query(params): Query<HashMap<String, String>>| {
            let result_tx = result_tx_clone.clone();
            async move {
                let code = params.get("code").cloned().unwrap_or_default();
                let state = params.get("state").cloned().unwrap_or_default();
                let error = params.get("error").cloned();

                let result = OAuthCallbackResult {
                    code,
                    state,
                    error: error.clone(),
                };

                // Send result (ignore if already sent)
                if let Some(tx) = result_tx.lock().await.take() {
                    let _ = tx.send(result);
                }

                // Return success HTML
                if error.is_some() {
                    Html(OAUTH_ERROR_HTML.to_string())
                } else {
                    Html(OAUTH_SUCCESS_HTML.to_string())
                }
            }
        };

        let app = Router::new().route("/auth/callback", get(callback_handler));

        let addr = std::net::SocketAddr::from(([127, 0, 0, 1], self.port));
        let listener = tokio::net::TcpListener::bind(addr).await.map_err(|e| {
            if e.kind() == std::io::ErrorKind::AddrInUse {
                format!(
                    "Port {} is already in use. Please close any application using this port.",
                    self.port
                )
            } else {
                format!("Failed to bind to port {}: {}", self.port, e)
            }
        })?;

        tracing::info!(
            "[CODEX] OAuth server listening on http://127.0.0.1:{}",
            self.port
        );

        // Spawn server with graceful shutdown
        let server = axum::serve(listener, app).with_graceful_shutdown(async move {
            let _ = shutdown_rx.await;
        });

        tokio::spawn(async move {
            if let Err(e) = server.await {
                tracing::error!("[CODEX] OAuth server error: {}", e);
            }
        });

        // Wait for callback with timeout
        let result = tokio::time::timeout(timeout, result_rx).await;

        // Trigger shutdown
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }

        match result {
            Ok(Ok(callback_result)) => {
                if let Some(ref error) = callback_result.error {
                    Err(format!("OAuth error: {error}").into())
                } else {
                    Ok(callback_result)
                }
            }
            Ok(Err(_)) => Err("OAuth callback channel closed unexpectedly".into()),
            Err(_) => {
                Err("OAuth callback timeout - no response received within the time limit".into())
            }
        }
    }
}

// HTML templates for OAuth callback responses
const OAUTH_SUCCESS_HTML: &str = r#"<!DOCTYPE html>
<html>
<head>
    <title>Authentication Successful</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .container {
            text-align: center;
            background: white;
            padding: 40px 60px;
            border-radius: 16px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
        }
        .checkmark {
            width: 80px;
            height: 80px;
            margin: 0 auto 20px;
            background: #10b981;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .checkmark svg {
            width: 40px;
            height: 40px;
            fill: white;
        }
        h1 { color: #1f2937; margin-bottom: 10px; }
        p { color: #6b7280; }
    </style>
</head>
<body>
    <div class="container">
        <div class="checkmark">
            <svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
        </div>
        <h1>Authentication Successful!</h1>
        <p>You can close this window and return to Lime.</p>
    </div>
</body>
</html>"#;

const OAUTH_ERROR_HTML: &str = r#"<!DOCTYPE html>
<html>
<head>
    <title>Authentication Failed</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
        }
        .container {
            text-align: center;
            background: white;
            padding: 40px 60px;
            border-radius: 16px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
        }
        .error-icon {
            width: 80px;
            height: 80px;
            margin: 0 auto 20px;
            background: #ef4444;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .error-icon svg {
            width: 40px;
            height: 40px;
            fill: white;
        }
        h1 { color: #1f2937; margin-bottom: 10px; }
        p { color: #6b7280; }
    </style>
</head>
<body>
    <div class="container">
        <div class="error-icon">
            <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </div>
        <h1>Authentication Failed</h1>
        <p>Please close this window and try again.</p>
    </div>
</body>
</html>"#;

/// Codex OAuth Provider
///
/// Handles OAuth authentication and API calls for OpenAI Codex.
pub struct CodexProvider {
    /// OAuth credentials
    pub credentials: CodexCredentials,
    /// HTTP client for API requests
    pub client: Client,
    /// Path to credentials file
    pub creds_path: Option<PathBuf>,
    /// OAuth callback port
    pub callback_port: u16,
}

impl Default for CodexProvider {
    fn default() -> Self {
        Self {
            credentials: CodexCredentials::default(),
            client: Client::new(),
            creds_path: None,
            callback_port: DEFAULT_CALLBACK_PORT,
        }
    }
}

impl CodexProvider {
    /// Create a new CodexProvider instance
    pub fn new() -> Self {
        Self::default()
    }

    /// Create a new CodexProvider with a custom HTTP client
    pub fn with_client(client: Client) -> Self {
        Self {
            client,
            ..Self::default()
        }
    }

    /// Get the default credentials file path
    pub fn default_creds_path() -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".codex")
            .join("auth.json")
    }

    /// Get the OAuth authorization URL
    pub fn get_auth_url(&self) -> &'static str {
        OPENAI_AUTH_URL
    }

    /// Get the OAuth token URL
    pub fn get_token_url(&self) -> &'static str {
        OPENAI_TOKEN_URL
    }

    /// Get the OAuth client ID
    pub fn get_client_id(&self) -> &'static str {
        OPENAI_CLIENT_ID
    }

    /// Get the redirect URI for OAuth callback
    pub fn get_redirect_uri(&self) -> String {
        format!("http://localhost:{}/auth/callback", self.callback_port)
    }

    /// Get the API base URL
    pub fn get_api_base_url(&self) -> &'static str {
        CODEX_API_BASE_URL
    }

    /// 获取已配置的 API Key（trim 后的非空值）
    fn get_api_key(&self) -> Option<&str> {
        self.credentials
            .api_key
            .as_deref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
    }

    pub fn build_responses_url(base_url: &str) -> String {
        let base = base_url.trim_end_matches('/');

        if is_openai_responses_endpoint(base) {
            return base.to_string();
        }

        // 规则说明：
        // - 如果 base_url 以 /v1 结尾：直接拼 /responses
        // - 如果 base_url 只有域名（path 为空或 /）：拼 /v1/responses（OpenAI 标准）
        // - 如果 base_url 已包含路径前缀（如 https://yunyi.cfd/codex）：认为前缀已包含路由信息，拼 /responses
        if base.ends_with("/v1") {
            return format!("{base}/responses");
        }

        if let Ok(parsed) = url::Url::parse(base) {
            let path = parsed.path().trim_end_matches('/');
            if path.is_empty() || path == "/" {
                return format!("{base}/v1/responses");
            }
            return format!("{base}/responses");
        }

        // 兜底：保持旧行为
        format!("{base}/v1/responses")
    }

    /// Load credentials from the default path
    pub async fn load_credentials(&mut self) -> Result<(), Box<dyn Error + Send + Sync>> {
        let path = Self::default_creds_path();
        self.load_credentials_from_path_internal(&path).await
    }

    /// Load credentials from a specific path
    pub async fn load_credentials_from_path(
        &mut self,
        path: &str,
    ) -> Result<(), Box<dyn Error + Send + Sync>> {
        let path = PathBuf::from(path);
        self.load_credentials_from_path_internal(&path).await
    }

    async fn load_credentials_from_path_internal(
        &mut self,
        path: &PathBuf,
    ) -> Result<(), Box<dyn Error + Send + Sync>> {
        if tokio::fs::try_exists(&path).await.unwrap_or(false) {
            let content = tokio::fs::read_to_string(&path).await?;

            // 尝试解析凭证文件
            let creds: CodexCredentials = serde_json::from_str(&content).map_err(|e| {
                tracing::error!("[CODEX] 凭证文件解析失败: {}. 文件路径: {:?}", e, path);
                format!("凭证文件格式错误: {e}")
            })?;

            // 检查关键字段
            let has_api_key = creds
                .api_key
                .as_deref()
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false);
            if creds.refresh_token.is_none() && !has_api_key {
                tracing::warn!(
                    "[CODEX] 凭证文件缺少 refresh_token/api_key 字段。支持的字段名: refresh_token, refreshToken, api_key, apiKey"
                );
                // 打印文件中的顶级字段名，帮助调试
                if let Ok(json_value) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(obj) = json_value.as_object() {
                        let keys: Vec<&String> = obj.keys().collect();
                        tracing::info!("[CODEX] 凭证文件包含的字段: {:?}", keys);
                    }
                }
            }

            tracing::info!(
                "[CODEX] 凭证加载成功: has_access={}, has_refresh={}, has_api_key={}, email={:?}, path={:?}",
                creds.access_token.is_some(),
                creds.refresh_token.is_some(),
                has_api_key,
                creds.email,
                path
            );
            self.credentials = creds;
            self.creds_path = Some(path.clone());
        } else {
            tracing::warn!("[CODEX] 凭证文件不存在: {:?}", path);
            return Err(format!("凭证文件不存在: {path:?}").into());
        }
        Ok(())
    }

    /// Save credentials to file
    pub async fn save_credentials(&self) -> Result<(), Box<dyn Error + Send + Sync>> {
        let path = self
            .creds_path
            .clone()
            .unwrap_or_else(Self::default_creds_path);

        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        let content = serde_json::to_string_pretty(&self.credentials)?;
        tokio::fs::write(&path, content).await?;
        tracing::info!("[CODEX] Credentials saved to {:?}", path);
        Ok(())
    }

    /// Check if the access token is expired
    pub fn is_token_expired(&self) -> bool {
        // API Key 模式：不涉及过期概念
        if self.get_api_key().is_some() {
            return false;
        }

        if let Some(expires_str) = &self.credentials.expires_at {
            if let Ok(expires) = chrono::DateTime::parse_from_rfc3339(expires_str) {
                let now = chrono::Utc::now();
                // Consider expired if less than 5 minutes remaining
                return expires < now + chrono::Duration::minutes(5);
            }
        }
        // If no expiry info, assume expired to be safe
        true
    }

    /// Check if credentials are valid (has access token and not expired)
    pub fn is_valid(&self) -> bool {
        if self.get_api_key().is_some() {
            return true;
        }
        self.credentials.access_token.is_some() && !self.is_token_expired()
    }

    /// Generate the OAuth authorization URL with PKCE
    pub fn generate_auth_url(
        &self,
        state: &str,
        pkce_codes: &PKCECodes,
    ) -> Result<String, Box<dyn Error + Send + Sync>> {
        let params = [
            ("client_id", OPENAI_CLIENT_ID),
            ("response_type", "code"),
            ("redirect_uri", &self.get_redirect_uri()),
            // 使用基础 scope，与 CLIProxyAPI 保持一致
            // chatgpt.com/backend-api/codex 端点不需要 api.responses.write 等额外权限
            ("scope", "openid email profile offline_access"),
            ("state", state),
            ("code_challenge", &pkce_codes.code_challenge),
            ("code_challenge_method", "S256"),
            ("prompt", "login"),
            ("id_token_add_organizations", "true"),
            ("codex_cli_simplified_flow", "true"),
        ];

        let query = serde_urlencoded::to_string(params)?;
        Ok(format!("{OPENAI_AUTH_URL}?{query}"))
    }

    /// Generate a random state string for CSRF protection
    pub fn generate_state() -> Result<String, Box<dyn Error + Send + Sync>> {
        use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
        use rand::RngCore;

        let mut bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut bytes);
        Ok(URL_SAFE_NO_PAD.encode(bytes))
    }

    /// Exchange authorization code for tokens
    pub async fn exchange_code_for_tokens(
        &mut self,
        code: &str,
        pkce_codes: &PKCECodes,
    ) -> Result<(), Box<dyn Error + Send + Sync>> {
        let params = [
            ("grant_type", "authorization_code"),
            ("client_id", OPENAI_CLIENT_ID),
            ("code", code),
            ("redirect_uri", &self.get_redirect_uri()),
            ("code_verifier", &pkce_codes.code_verifier),
        ];

        let resp = self
            .client
            .post(OPENAI_TOKEN_URL)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .header("Accept", "application/json")
            .form(&params)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Token exchange failed: {status} - {body}").into());
        }

        let data: serde_json::Value = resp.json().await?;

        // Parse token response
        let access_token = data["access_token"]
            .as_str()
            .ok_or("No access_token in response")?
            .to_string();
        let refresh_token = data["refresh_token"].as_str().map(|s| s.to_string());
        let id_token = data["id_token"].as_str().map(|s| s.to_string());
        let expires_in = data["expires_in"].as_i64().unwrap_or(3600);

        // Parse ID token to extract user info
        let (account_id, email) = if let Some(ref id_token) = id_token {
            parse_jwt_claims(id_token)
        } else {
            (None, None)
        };

        // Calculate expiration time
        let expires_at = chrono::Utc::now() + chrono::Duration::seconds(expires_in);

        self.credentials = CodexCredentials {
            id_token,
            access_token: Some(access_token),
            refresh_token,
            api_key: None,
            api_base_url: None,
            account_id,
            last_refresh: Some(chrono::Utc::now().to_rfc3339()),
            email,
            r#type: "codex".to_string(),
            expires_at: Some(expires_at.to_rfc3339()),
        };

        // Save credentials
        self.save_credentials().await?;

        tracing::info!(
            "[CODEX] Token exchange successful, email={:?}",
            self.credentials.email
        );
        Ok(())
    }

    /// Refresh the access token using the refresh token
    ///
    /// Supports three authentication modes (in priority order):
    /// 1. **API Key Mode**: Returns the API key directly (no refresh needed)
    /// 2. **OAuth Mode**: Refreshes the access token using the refresh token
    /// 3. **Access Token Mode**: Returns the existing access token (may be expired)
    ///
    /// # Returns
    /// * `Ok(String)` - The access token or API key
    /// * `Err` - If no credentials are available
    ///
    /// # Examples
    /// ```ignore
    /// // API Key mode
    /// provider.credentials.api_key = Some("sk-test".to_string());
    /// let token = provider.refresh_token().await?; // Returns "sk-test"
    ///
    /// // OAuth mode
    /// provider.credentials.refresh_token = Some("refresh_token".to_string());
    /// let token = provider.refresh_token().await?; // Refreshes and returns new access_token
    ///
    /// // Access Token mode (fallback)
    /// provider.credentials.access_token = Some("access_token".to_string());
    /// let token = provider.refresh_token().await?; // Returns "access_token" (with warning)
    /// ```
    pub async fn refresh_token(&mut self) -> Result<String, Box<dyn Error + Send + Sync>> {
        // 1. API Key 模式无需刷新（优先级最高）
        if let Some(api_key) = self.get_api_key() {
            return Ok(api_key.to_string());
        }

        // 2. 无 refresh_token 时的降级处理
        if self.credentials.refresh_token.is_none() {
            // 2a. 有 access_token：返回（可能过期，由上层处理）
            if let Some(ref access_token) = self.credentials.access_token {
                tracing::warn!("[CODEX] 没有 refresh_token，返回现有 access_token（可能已过期）");
                return Ok(access_token.clone());
            }

            // 2b. 无任何凭证：清晰的错误指导
            return Err(create_config_error(
                "没有可用的认证凭证。请配置以下任一方式：\n\
                 1. API Key 模式：在凭证文件中添加 api_key/apiKey 字段\n\
                 2. OAuth 模式：使用 OAuth 登录获取 refresh_token\n\
                 3. Access Token 模式：在凭证文件中添加 access_token/accessToken 字段",
            ));
        }

        // 3. OAuth 刷新流程（标准流程）
        let refresh_token =
            self.credentials.refresh_token.as_ref().ok_or_else(|| {
                create_config_error("OAuth 刷新令牌不可用 (refresh_token is None)")
            })?;

        tracing::info!("[CODEX] 正在刷新 access token");

        let params = [
            ("client_id", OPENAI_CLIENT_ID),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token.as_str()),
            // 使用基础 scope，与 CLIProxyAPI 保持一致
            ("scope", "openid profile email"),
        ];

        let resp = self
            .client
            .post(OPENAI_TOKEN_URL)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .header("Accept", "application/json")
            .form(&params)
            .send()
            .await
            .map_err(|e| Box::new(ProviderError::from(e)) as Box<dyn Error + Send + Sync>)?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            tracing::error!("[CODEX] Token refresh failed: {} - {}", status, body);

            // Mark credentials as invalid on refresh failure
            self.mark_invalid();

            return Err(create_token_refresh_error(status, &body, "CODEX"));
        }

        let data: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| Box::new(ProviderError::from(e)) as Box<dyn Error + Send + Sync>)?;

        // Update credentials
        let new_access_token = data["access_token"]
            .as_str()
            .ok_or_else(|| create_auth_error("响应中没有 access_token"))?
            .to_string();

        self.credentials.access_token = Some(new_access_token.clone());

        if let Some(rt) = data["refresh_token"].as_str() {
            self.credentials.refresh_token = Some(rt.to_string());
        }

        if let Some(id_token) = data["id_token"].as_str() {
            self.credentials.id_token = Some(id_token.to_string());
            let (account_id, email) = parse_jwt_claims(id_token);
            if account_id.is_some() {
                self.credentials.account_id = account_id;
            }
            if email.is_some() {
                self.credentials.email = email;
            }
        }

        let expires_in = data["expires_in"].as_i64().unwrap_or(3600);
        let expires_at = chrono::Utc::now() + chrono::Duration::seconds(expires_in);
        self.credentials.expires_at = Some(expires_at.to_rfc3339());
        self.credentials.last_refresh = Some(chrono::Utc::now().to_rfc3339());

        // Save updated credentials
        self.save_credentials().await?;

        tracing::info!("[CODEX] Token refresh successful");
        Ok(new_access_token)
    }

    /// Refresh token with retry mechanism
    ///
    /// Attempts to refresh the token up to `max_retries` times with linear backoff (1s, 2s, 3s).
    /// Marks credentials as invalid if all retries fail.
    ///
    /// # Arguments
    /// * `max_retries` - Maximum number of retry attempts (typically 3)
    ///
    /// # Returns
    /// * `Ok(String)` - The new access token on success
    /// * `Err` - Error if all retries fail
    pub async fn refresh_token_with_retry(
        &mut self,
        max_retries: u32,
    ) -> Result<String, Box<dyn Error + Send + Sync>> {
        let mut last_error = None;

        for attempt in 0..max_retries {
            if attempt > 0 {
                // Linear backoff: 1s, 2s, 3s, ... (as per Requirements 8.2)
                let delay = std::time::Duration::from_secs((attempt) as u64);
                tracing::info!(
                    "[CODEX] Retry attempt {}/{} after {:?}",
                    attempt + 1,
                    max_retries,
                    delay
                );
                tokio::time::sleep(delay).await;
            }

            match self.refresh_token().await {
                Ok(token) => {
                    if attempt > 0 {
                        tracing::info!(
                            "[CODEX] Token refresh succeeded on attempt {}",
                            attempt + 1
                        );
                    }
                    return Ok(token);
                }
                Err(e) => {
                    tracing::warn!(
                        "[CODEX] Token refresh attempt {}/{} failed: {}",
                        attempt + 1,
                        max_retries,
                        e
                    );
                    last_error = Some(e);
                }
            }
        }

        // All retries failed - mark as invalid
        self.mark_invalid();
        tracing::error!(
            "[CODEX] Token refresh failed after {} attempts",
            max_retries
        );

        Err(last_error.unwrap_or_else(|| create_auth_error("Token 刷新失败，请重新登录")))
    }

    /// Check if token needs refresh (expiring within the specified duration)
    pub fn needs_refresh(&self, lead_time: chrono::Duration) -> bool {
        // API Key 模式无需刷新
        if self.get_api_key().is_some() {
            return false;
        }

        if self.credentials.access_token.is_none() {
            return true;
        }

        if let Some(expires_str) = &self.credentials.expires_at {
            if let Ok(expires) = chrono::DateTime::parse_from_rfc3339(expires_str) {
                let now = chrono::Utc::now();
                return expires < now + lead_time;
            }
        }

        // If no expiry info, assume needs refresh
        true
    }

    /// Ensure token is valid, refreshing if necessary
    ///
    /// This is the recommended method to call before making API requests.
    /// It will automatically refresh the token if it's expired or about to expire.
    pub async fn ensure_valid_token(&mut self) -> Result<String, Box<dyn Error + Send + Sync>> {
        // 兼容 Codex CLI 的 API Key 登录：auth.json 只有 api_key，没有 refresh_token
        if let Some(api_key) = self.get_api_key() {
            return Ok(api_key.to_string());
        }

        // Refresh if token expires within 5 minutes
        let lead_time = chrono::Duration::minutes(5);

        if self.needs_refresh(lead_time) {
            tracing::info!("[CODEX] Token needs refresh, attempting refresh with retry");
            self.refresh_token_with_retry(3).await
        } else {
            self.credentials
                .access_token
                .clone()
                .ok_or_else(|| create_config_error("没有可用的 access_token"))
        }
    }

    /// Mark credentials as invalid (e.g., after refresh failure)
    pub fn mark_invalid(&mut self) {
        tracing::warn!("[CODEX] Marking credentials as invalid");
        self.credentials.access_token = None;
        self.credentials.expires_at = None;
    }

    /// Get the access token, refreshing if necessary
    pub async fn get_access_token(&mut self) -> Result<String, Box<dyn Error + Send + Sync>> {
        // API Key 模式直接返回
        if let Some(api_key) = self.get_api_key() {
            return Ok(api_key.to_string());
        }

        if self.is_token_expired() {
            self.refresh_token().await?;
        }
        self.credentials
            .access_token
            .clone()
            .ok_or_else(|| create_config_error("没有可用的 access_token"))
    }

    /// Perform OAuth login flow
    ///
    /// Opens a browser for OAuth authentication and waits for the callback.
    /// Returns the email of the authenticated user on success.
    pub async fn oauth_login(&mut self) -> Result<String, Box<dyn Error + Send + Sync>> {
        tracing::info!("[CODEX] Starting OAuth login flow");

        // Generate PKCE codes and state
        let pkce_codes = PKCECodes::generate()?;
        let state = Self::generate_state()?;

        // Generate authorization URL
        let auth_url = self.generate_auth_url(&state, &pkce_codes)?;

        // Start OAuth server
        let mut oauth_server = OAuthServer::new(self.callback_port);

        // Open browser
        tracing::info!("[CODEX] Opening browser for authentication");
        if let Err(e) = open::that(&auth_url) {
            tracing::warn!(
                "[CODEX] Failed to open browser: {}. Please open the URL manually.",
                e
            );
            println!("Please open the following URL in your browser:\n{auth_url}");
        }

        // Wait for callback (5 minute timeout)
        let timeout = std::time::Duration::from_secs(300);
        let callback_result = oauth_server.wait_for_callback(timeout).await?;

        // Verify state
        if callback_result.state != state {
            return Err("OAuth state mismatch - possible CSRF attack".into());
        }

        // Exchange code for tokens
        self.exchange_code_for_tokens(&callback_result.code, &pkce_codes)
            .await?;

        let email = self
            .credentials
            .email
            .clone()
            .unwrap_or_else(|| "unknown".to_string());
        tracing::info!("[CODEX] OAuth login successful for {}", email);

        Ok(email)
    }

    /// Perform OAuth login without opening browser (for headless/SSH environments)
    ///
    /// Returns the authorization URL that the user should open manually.
    pub fn start_oauth_login(
        &self,
    ) -> Result<(String, PKCECodes, String), Box<dyn Error + Send + Sync>> {
        let pkce_codes = PKCECodes::generate()?;
        let state = Self::generate_state()?;
        let auth_url = self.generate_auth_url(&state, &pkce_codes)?;
        Ok((auth_url, pkce_codes, state))
    }

    /// Complete OAuth login after receiving callback
    pub async fn complete_oauth_login(
        &mut self,
        code: &str,
        pkce_codes: &PKCECodes,
        expected_state: &str,
        received_state: &str,
    ) -> Result<String, Box<dyn Error + Send + Sync>> {
        // Verify state
        if received_state != expected_state {
            return Err("OAuth state mismatch - possible CSRF attack".into());
        }

        // Exchange code for tokens
        self.exchange_code_for_tokens(code, pkce_codes).await?;

        let email = self
            .credentials
            .email
            .clone()
            .unwrap_or_else(|| "unknown".to_string());
        tracing::info!("[CODEX] OAuth login completed for {}", email);

        Ok(email)
    }

    /// Call the Codex API for chat completions
    ///
    /// Routes GPT model requests through the Codex OAuth endpoint.
    /// The request should be in OpenAI chat completion format.
    pub async fn call_api(
        &self,
        request: &serde_json::Value,
    ) -> Result<reqwest::Response, Box<dyn Error + Send + Sync>> {
        enum AuthMode {
            ApiKey,
            OAuth,
        }

        let (token, mode) = match self.get_api_key() {
            Some(api_key) => (api_key, AuthMode::ApiKey),
            None => (
                self.credentials
                    .access_token
                    .as_deref()
                    .ok_or("No access token or api_key available")?,
                AuthMode::OAuth,
            ),
        };

        // Build the Codex API URL
        let url = match mode {
            AuthMode::ApiKey => {
                let has_custom_base_url = self
                    .credentials
                    .api_base_url
                    .as_deref()
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .is_some();

                let base_url = self
                    .credentials
                    .api_base_url
                    .as_deref()
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .unwrap_or(DEFAULT_API_BASE_URL);

                // Warn if API key doesn't look like OpenAI format but no custom base URL is set
                if !has_custom_base_url && !token.starts_with("sk-") {
                    tracing::warn!(
                        "[CODEX] API key does not appear to be an OpenAI key (doesn't start with 'sk-'), \
                        but no api_base_url is configured. Requests will be sent to {}. \
                        If you're using a third-party API provider, please add 'api_base_url' to ~/.codex/auth.json",
                        DEFAULT_API_BASE_URL
                    );
                }

                Self::build_responses_url(base_url)
            }
            AuthMode::OAuth => format!("{CODEX_API_BASE_URL}/responses"),
        };

        // Transform OpenAI chat completion request to Codex format
        let codex_request = transform_to_codex_format(request)?;

        let mut req = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {token}"))
            .header("Content-Type", "application/json")
            .header("Accept", "text/event-stream")
            .header("Connection", "Keep-Alive")
            .header("Openai-Beta", "responses=experimental")
            .json(&codex_request);

        // 部分三方 Codex 代理（如 Yunyi）会依赖 Codex CLI 的特征 headers；
        // 仅在 OAuth 模式或显式配置了自定义 base_url 时附加，避免影响 OpenAI 官方 Key 模式。
        let should_add_codex_cli_headers = matches!(mode, AuthMode::OAuth)
            || (matches!(mode, AuthMode::ApiKey)
                && self
                    .credentials
                    .api_base_url
                    .as_deref()
                    .map(|s| !s.trim().is_empty())
                    .unwrap_or(false));

        if should_add_codex_cli_headers {
            req = req
                .header("Version", "0.21.0")
                .header(
                    "User-Agent",
                    "codex_cli_rs/0.50.0 (Mac OS 26.0.1; arm64) Apple_Terminal/464",
                )
                .header("Originator", "codex_cli_rs")
                .header("Session_id", uuid::Uuid::new_v4().to_string())
                .header("Conversation_id", uuid::Uuid::new_v4().to_string());

            // 仅在 account_id 非空时添加 Chatgpt-Account-Id header
            // 参考 CLIProxyAPI: 空值时不发送此 header
            if let Some(account_id) = self.credentials.account_id.as_deref() {
                if !account_id.trim().is_empty() {
                    req = req.header("Chatgpt-Account-Id", account_id);
                }
            }
        }

        let resp = req.send().await?;

        Ok(resp)
    }

    /// Call the Codex API with streaming response
    pub async fn call_api_stream(
        &self,
        request: &serde_json::Value,
    ) -> Result<reqwest::Response, Box<dyn Error + Send + Sync>> {
        // Same as call_api - Codex always returns SSE stream
        self.call_api(request).await
    }

    /// Check if this provider supports the given model
    pub fn supports_model(model: &str) -> bool {
        let model_lower = model.to_lowercase();
        model_lower.starts_with("gpt-")
            || model_lower.starts_with("o1")
            || model_lower.starts_with("o3")
            || model_lower.starts_with("o4")
            || model_lower.contains("codex")
    }
}

/// Parse JWT token to extract account_id and email
///
/// Extracts user information from the JWT ID token returned by OpenAI OAuth.
/// The account_id is extracted from the `chatgpt_account_id` field in the
/// `https://api.openai.com/auth` claim, which is required for Codex API calls.
fn parse_jwt_claims(token: &str) -> (Option<String>, Option<String>) {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};

    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        tracing::warn!(
            "[CODEX] Invalid JWT token format: expected 3 parts, got {}",
            parts.len()
        );
        return (None, None);
    }

    // Decode payload (second part) - JWT uses URL-safe base64 without padding
    let payload = match URL_SAFE_NO_PAD.decode(parts[1]) {
        Ok(bytes) => bytes,
        Err(_) => {
            // Try with padding added
            let padded = format!("{}{}", parts[1], "=".repeat((4 - parts[1].len() % 4) % 4));
            match base64::engine::general_purpose::URL_SAFE.decode(&padded) {
                Ok(bytes) => bytes,
                Err(e) => {
                    tracing::warn!("[CODEX] Failed to decode JWT payload: {}", e);
                    return (None, None);
                }
            }
        }
    };

    let claims: serde_json::Value = match serde_json::from_slice(&payload) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("[CODEX] Failed to parse JWT claims: {}", e);
            return (None, None);
        }
    };

    // Extract email from standard claim
    let email = claims["email"].as_str().map(|s| s.to_string());

    // Extract account_id from OpenAI-specific claims
    // Priority: chatgpt_account_id > user_id > sub
    // The chatgpt_account_id is the correct field for Codex API calls
    let auth_info = &claims["https://api.openai.com/auth"];
    let account_id = auth_info["chatgpt_account_id"]
        .as_str()
        .or_else(|| auth_info["user_id"].as_str())
        .or_else(|| claims["sub"].as_str())
        .map(|s| s.to_string());

    tracing::debug!(
        "[CODEX] JWT parsed: email={:?}, account_id={:?}",
        email,
        account_id
    );

    (account_id, email)
}

fn extract_text_fragments(content: &serde_json::Value) -> Vec<String> {
    if let Some(text) = content
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
    {
        return vec![text.to_string()];
    }

    let mut fragments = Vec::new();
    if let Some(parts) = content.as_array() {
        for part in parts {
            let text = if let Some(kind) = part.get("type").and_then(|v| v.as_str()) {
                match kind {
                    "text" | "input_text" | "output_text" => {
                        part.get("text").and_then(|v| v.as_str())
                    }
                    _ => part.get("text").and_then(|v| v.as_str()),
                }
            } else {
                part.get("text").and_then(|v| v.as_str())
            };
            if let Some(text) = text.map(str::trim).filter(|text| !text.is_empty()) {
                fragments.push(text.to_string());
            }
        }
    }
    fragments
}

fn resolve_codex_instructions(
    request: &serde_json::Value,
    system_instructions: &[String],
) -> Option<String> {
    if let Some(request_instructions) = request
        .get("instructions")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some(request_instructions.to_string());
    }

    if !system_instructions.is_empty() {
        return Some(system_instructions.join("\n\n"));
    }

    lime_core::env_compat::var_nonempty(&[
        "LIME_CODEX_DEFAULT_INSTRUCTIONS",
        "PROXYCAST_CODEX_DEFAULT_INSTRUCTIONS",
    ])
}

/// Transform OpenAI chat completion request to Codex format
/// 参考 CLIProxyAPI: internal/translator/codex/openai/chat-completions/codex_openai_request.go
fn transform_to_codex_format(
    request: &serde_json::Value,
) -> Result<serde_json::Value, Box<dyn Error + Send + Sync>> {
    let model = request["model"].as_str().unwrap_or("gpt-4o");
    let messages = request["messages"].as_array();
    // 注意：stream 参数被忽略，Codex API 强制要求 stream = true

    // Build input array from messages
    let mut input = Vec::new();
    let mut system_instructions: Vec<String> = Vec::new();

    if let Some(msgs) = messages {
        for msg in msgs {
            let role = msg["role"].as_str().unwrap_or("user");
            let content = &msg["content"];

            match role {
                "system" => {
                    // system 消息统一转换到 instructions，避免污染用户输入。
                    system_instructions.extend(extract_text_fragments(content));
                }
                "user" => {
                    let content_parts = if let Some(text) = content.as_str() {
                        vec![serde_json::json!({"type": "input_text", "text": text})]
                    } else if let Some(arr) = content.as_array() {
                        arr.iter()
                            .filter_map(|part| {
                                let part_type = part["type"].as_str().unwrap_or("");
                                match part_type {
                                    "text" => part["text"].as_str().map(
                                        |text| serde_json::json!({"type": "input_text", "text": text}),
                                    ),
                                    "image_url" => part["image_url"]["url"].as_str().map(
                                        |url| serde_json::json!({"type": "input_image", "image_url": url}),
                                    ),
                                    _ => part["text"].as_str().map(
                                        |text| serde_json::json!({"type": "input_text", "text": text}),
                                    ),
                                }
                            })
                            .collect()
                    } else {
                        vec![]
                    };

                    if !content_parts.is_empty() {
                        input.push(serde_json::json!({
                            "type": "message",
                            "role": "user",
                            "content": content_parts
                        }));
                    }
                }
                "assistant" => {
                    // Assistant message content
                    let content_parts = if let Some(text) = content.as_str() {
                        vec![serde_json::json!({"type": "output_text", "text": text})]
                    } else if let Some(arr) = content.as_array() {
                        arr.iter()
                            .filter_map(|part| {
                                part["text"].as_str().map(
                                    |text| serde_json::json!({"type": "output_text", "text": text}),
                                )
                            })
                            .collect()
                    } else {
                        vec![]
                    };

                    if !content_parts.is_empty() {
                        input.push(serde_json::json!({
                            "type": "message",
                            "role": "assistant",
                            "content": content_parts
                        }));
                    }

                    // Handle tool calls for assistant messages
                    if let Some(tool_calls) = msg["tool_calls"].as_array() {
                        for tc in tool_calls {
                            if tc["type"].as_str() == Some("function") {
                                input.push(serde_json::json!({
                                    "type": "function_call",
                                    "call_id": tc["id"].as_str().unwrap_or(""),
                                    "name": tc["function"]["name"].as_str().unwrap_or(""),
                                    "arguments": tc["function"]["arguments"].as_str().unwrap_or("{}")
                                }));
                            }
                        }
                    }
                }
                "tool" => {
                    // Tool results
                    let tool_call_id = msg["tool_call_id"].as_str().unwrap_or("");
                    let output = content.as_str().unwrap_or("");
                    input.push(serde_json::json!({
                        "type": "function_call_output",
                        "call_id": tool_call_id,
                        "output": output
                    }));
                }
                _ => {}
            }
        }
    }

    // Build the Codex request - 参考 CLIProxyAPI 的必需字段
    // 注意：Codex API 要求 stream 必须为 true
    // 参考 CLIProxyAPI: internal/runtime/executor/codex_executor.go 第 107 行
    let mut codex_request = serde_json::json!({
        "model": model,
        "input": input,
        "stream": true,  // Codex API 强制要求 stream = true
        "store": false,
        "parallel_tool_calls": true,
        "reasoning": {
            "effort": "medium",
            "summary": "auto"
        },
        "include": ["reasoning.encrypted_content"]
    });

    if let Some(instructions) = resolve_codex_instructions(request, &system_instructions) {
        codex_request["instructions"] = serde_json::json!(instructions);
    }

    // 处理可选参数：temperature, max_tokens (-> max_output_tokens), top_p
    if let Some(temp) = request.get("temperature") {
        codex_request["temperature"] = temp.clone();
    }
    if let Some(max_tokens) = request.get("max_tokens") {
        codex_request["max_output_tokens"] = max_tokens.clone();
    }
    if let Some(top_p) = request.get("top_p") {
        codex_request["top_p"] = top_p.clone();
    }

    // Build tools array if present
    if let Some(tools) = request["tools"].as_array() {
        let codex_tools: Vec<serde_json::Value> = tools
            .iter()
            .filter_map(|tool| {
                let tool_type = tool["type"].as_str().unwrap_or("");
                if tool_type == "function" {
                    let func = &tool["function"];
                    Some(serde_json::json!({
                        "type": "function",
                        "name": func["name"],
                        "description": func["description"],
                        "parameters": func["parameters"]
                    }))
                } else if !tool_type.is_empty() {
                    // Pass through built-in tools directly
                    Some(tool.clone())
                } else {
                    None
                }
            })
            .collect();

        if !codex_tools.is_empty() {
            codex_request["tools"] = serde_json::json!(codex_tools);
        }
    }

    // Handle tool_choice
    if let Some(tool_choice) = request.get("tool_choice") {
        if let Some(tc_str) = tool_choice.as_str() {
            codex_request["tool_choice"] = serde_json::json!(tc_str);
        } else if tool_choice.is_object() {
            let tc_type = tool_choice["type"].as_str().unwrap_or("");
            if tc_type == "function" {
                codex_request["tool_choice"] = serde_json::json!({
                    "type": "function",
                    "name": tool_choice["function"]["name"]
                });
            } else if !tc_type.is_empty() {
                codex_request["tool_choice"] = tool_choice.clone();
            }
        }
    }

    // Handle reasoning effort
    if let Some(reasoning_effort) = request["reasoning_effort"].as_str() {
        codex_request["reasoning"]["effort"] = serde_json::json!(reasoning_effort);
    }

    // Handle response_format for Structured Outputs
    if let Some(rf) = request.get("response_format") {
        let rf_type = rf["type"].as_str().unwrap_or("");
        match rf_type {
            "text" => {
                codex_request["text"] = serde_json::json!({
                    "format": {"type": "text"}
                });
            }
            "json_schema" => {
                if let Some(js) = rf.get("json_schema") {
                    let mut format = serde_json::json!({
                        "type": "json_schema"
                    });
                    if let Some(name) = js["name"].as_str() {
                        format["name"] = serde_json::json!(name);
                    }
                    if let Some(strict) = js["strict"].as_bool() {
                        format["strict"] = serde_json::json!(strict);
                    }
                    if let Some(schema) = js.get("schema") {
                        format["schema"] = schema.clone();
                    }
                    codex_request["text"] = serde_json::json!({
                        "format": format
                    });
                }
            }
            _ => {}
        }
    }

    Ok(codex_request)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_codex_credentials_default() {
        let creds = CodexCredentials::default();
        assert!(creds.access_token.is_none());
        assert!(creds.refresh_token.is_none());
        assert!(creds.api_key.is_none());
        assert_eq!(creds.r#type, "codex");
    }

    #[test]
    fn test_codex_credentials_serialization() {
        let creds = CodexCredentials {
            access_token: Some("test_token".to_string()),
            refresh_token: Some("test_refresh".to_string()),
            email: Some("test@example.com".to_string()),
            ..Default::default()
        };

        let json = serde_json::to_string(&creds).unwrap();
        assert!(json.contains("test_token"));
        assert!(json.contains("test@example.com"));

        let parsed: CodexCredentials = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.access_token, creds.access_token);
        assert_eq!(parsed.email, creds.email);
    }

    #[test]
    fn test_codex_credentials_camel_case_alias() {
        // 测试 camelCase 字段名的支持（Codex CLI 官方格式）
        let json = r#"{
            "idToken": "test_id_token",
            "accessToken": "test_access_token",
            "refreshToken": "test_refresh_token",
            "accountId": "test_account_id",
            "lastRefresh": "2024-01-01T00:00:00Z",
            "email": "test@example.com",
            "type": "codex",
            "expiresAt": "2024-12-31T23:59:59Z"
        }"#;

        let creds: CodexCredentials = serde_json::from_str(json).unwrap();
        assert_eq!(creds.id_token, Some("test_id_token".to_string()));
        assert_eq!(creds.access_token, Some("test_access_token".to_string()));
        assert_eq!(creds.refresh_token, Some("test_refresh_token".to_string()));
        assert_eq!(creds.account_id, Some("test_account_id".to_string()));
        assert_eq!(creds.last_refresh, Some("2024-01-01T00:00:00Z".to_string()));
        assert_eq!(creds.email, Some("test@example.com".to_string()));
        assert_eq!(creds.expires_at, Some("2024-12-31T23:59:59Z".to_string()));
    }

    #[test]
    fn test_codex_credentials_snake_case() {
        // 测试 snake_case 字段名的支持（CLIProxyAPI 格式）
        let json = r#"{
            "id_token": "test_id_token",
            "access_token": "test_access_token",
            "refresh_token": "test_refresh_token",
            "account_id": "test_account_id",
            "last_refresh": "2024-01-01T00:00:00Z",
            "email": "test@example.com",
            "type": "codex",
            "expired": "2024-12-31T23:59:59Z"
        }"#;

        let creds: CodexCredentials = serde_json::from_str(json).unwrap();
        assert_eq!(creds.id_token, Some("test_id_token".to_string()));
        assert_eq!(creds.access_token, Some("test_access_token".to_string()));
        assert_eq!(creds.refresh_token, Some("test_refresh_token".to_string()));
        assert_eq!(creds.account_id, Some("test_account_id".to_string()));
        assert_eq!(creds.last_refresh, Some("2024-01-01T00:00:00Z".to_string()));
        assert_eq!(creds.email, Some("test@example.com".to_string()));
        assert_eq!(creds.expires_at, Some("2024-12-31T23:59:59Z".to_string()));
    }

    #[test]
    fn test_codex_credentials_api_key_fields() {
        let json = r#"{
            "api_key": "sk-test",
            "api_base_url": "https://api.openai.com/v1"
        }"#;

        let creds: CodexCredentials = serde_json::from_str(json).unwrap();
        assert_eq!(creds.api_key, Some("sk-test".to_string()));
        assert_eq!(
            creds.api_base_url,
            Some("https://api.openai.com/v1".to_string())
        );

        let json2 = r#"{
            "apiKey": "sk-test-2",
            "apiBaseUrl": "https://example.com/v1"
        }"#;
        let creds2: CodexCredentials = serde_json::from_str(json2).unwrap();
        assert_eq!(creds2.api_key, Some("sk-test-2".to_string()));
        assert_eq!(
            creds2.api_base_url,
            Some("https://example.com/v1".to_string())
        );
    }

    #[test]
    fn test_codex_credentials_expires_at_alias() {
        // 测试 expires_at 字段的多种别名
        let json1 = r#"{"expired": "2024-12-31T23:59:59Z"}"#;
        let json2 = r#"{"expires_at": "2024-12-31T23:59:59Z"}"#;
        let json3 = r#"{"expiresAt": "2024-12-31T23:59:59Z"}"#;

        let creds1: CodexCredentials = serde_json::from_str(json1).unwrap();
        let creds2: CodexCredentials = serde_json::from_str(json2).unwrap();
        let creds3: CodexCredentials = serde_json::from_str(json3).unwrap();

        assert_eq!(creds1.expires_at, Some("2024-12-31T23:59:59Z".to_string()));
        assert_eq!(creds2.expires_at, Some("2024-12-31T23:59:59Z".to_string()));
        assert_eq!(creds3.expires_at, Some("2024-12-31T23:59:59Z".to_string()));
    }

    #[test]
    fn test_pkce_generation() {
        let pkce = PKCECodes::generate().unwrap();
        assert!(!pkce.code_verifier.is_empty());
        assert!(!pkce.code_challenge.is_empty());
        // Verifier should be 128 chars (96 bytes base64 encoded)
        assert_eq!(pkce.code_verifier.len(), 128);
    }

    #[test]
    fn test_codex_provider_default() {
        let provider = CodexProvider::new();
        assert_eq!(provider.callback_port, DEFAULT_CALLBACK_PORT);
        assert!(provider.credentials.access_token.is_none());
    }

    #[test]
    fn test_build_responses_url() {
        assert_eq!(
            CodexProvider::build_responses_url("https://api.openai.com"),
            "https://api.openai.com/v1/responses"
        );
        assert_eq!(
            CodexProvider::build_responses_url("https://api.openai.com/v1"),
            "https://api.openai.com/v1/responses"
        );
        assert_eq!(
            CodexProvider::build_responses_url("https://example.com/v1/"),
            "https://example.com/v1/responses"
        );
        assert_eq!(
            CodexProvider::build_responses_url("https://yunyi.cfd/codex"),
            "https://yunyi.cfd/codex/responses"
        );
        assert_eq!(
            CodexProvider::build_responses_url("https://gateway.example.com/proxy/responses"),
            "https://gateway.example.com/proxy/responses"
        );
    }

    #[tokio::test]
    async fn test_ensure_valid_token_prefers_api_key() {
        let mut provider = CodexProvider::new();
        provider.credentials.api_key = Some("sk-test".to_string());

        let token = provider.ensure_valid_token().await.unwrap();
        assert_eq!(token, "sk-test");
    }

    #[test]
    fn test_generate_auth_url() {
        let provider = CodexProvider::new();
        let pkce = PKCECodes::generate().unwrap();
        let state = "test_state";

        let url = provider.generate_auth_url(state, &pkce).unwrap();
        assert!(url.starts_with(OPENAI_AUTH_URL));
        assert!(url.contains("client_id="));
        assert!(url.contains("code_challenge="));
        assert!(url.contains("state=test_state"));
    }

    #[test]
    fn test_parse_jwt_claims_with_sub() {
        // Mock JWT with only sub claim (fallback case)
        // Header: {"alg":"RS256","typ":"JWT"}
        // Payload: {"email":"test@example.com","sub":"user123"}
        let mock_jwt = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20iLCJzdWIiOiJ1c2VyMTIzIn0.signature";

        let (account_id, email) = parse_jwt_claims(mock_jwt);
        assert_eq!(email, Some("test@example.com".to_string()));
        assert_eq!(account_id, Some("user123".to_string()));
    }

    #[test]
    fn test_parse_jwt_claims_with_chatgpt_account_id() {
        // Mock JWT with chatgpt_account_id in https://api.openai.com/auth claim
        // This is the preferred field for Codex API calls
        // Payload: {"email":"test@example.com","sub":"user123","https://api.openai.com/auth":{"chatgpt_account_id":"chatgpt_acc_123","user_id":"uid_456"}}
        use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};

        let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"RS256","typ":"JWT"}"#);
        let payload = URL_SAFE_NO_PAD.encode(r#"{"email":"test@example.com","sub":"user123","https://api.openai.com/auth":{"chatgpt_account_id":"chatgpt_acc_123","user_id":"uid_456"}}"#);
        let mock_jwt = format!("{header}.{payload}.signature");

        let (account_id, email) = parse_jwt_claims(&mock_jwt);
        assert_eq!(email, Some("test@example.com".to_string()));
        // Should prefer chatgpt_account_id over user_id and sub
        assert_eq!(account_id, Some("chatgpt_acc_123".to_string()));
    }

    #[test]
    fn test_parse_jwt_claims_with_user_id() {
        // Mock JWT with user_id but no chatgpt_account_id
        // Payload: {"email":"test@example.com","sub":"user123","https://api.openai.com/auth":{"user_id":"uid_456"}}
        use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};

        let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"RS256","typ":"JWT"}"#);
        let payload = URL_SAFE_NO_PAD.encode(r#"{"email":"test@example.com","sub":"user123","https://api.openai.com/auth":{"user_id":"uid_456"}}"#);
        let mock_jwt = format!("{header}.{payload}.signature");

        let (account_id, email) = parse_jwt_claims(&mock_jwt);
        assert_eq!(email, Some("test@example.com".to_string()));
        // Should use user_id when chatgpt_account_id is not present
        assert_eq!(account_id, Some("uid_456".to_string()));
    }

    #[test]
    fn test_parse_jwt_claims_invalid_token() {
        // Invalid JWT format
        let (account_id, email) = parse_jwt_claims("invalid.token");
        assert_eq!(account_id, None);
        assert_eq!(email, None);

        // Empty token
        let (account_id, email) = parse_jwt_claims("");
        assert_eq!(account_id, None);
        assert_eq!(email, None);
    }

    #[test]
    fn test_is_token_expired() {
        let mut provider = CodexProvider::new();

        // No expiry - should be considered expired
        assert!(provider.is_token_expired());

        // API Key 模式 - 不应视为过期
        provider.credentials.api_key = Some("sk-test".to_string());
        assert!(!provider.is_token_expired());

        // Expired token
        provider.credentials.api_key = None;
        provider.credentials.expires_at = Some("2020-01-01T00:00:00Z".to_string());
        assert!(provider.is_token_expired());

        // Valid token (far future)
        provider.credentials.expires_at = Some("2099-01-01T00:00:00Z".to_string());
        assert!(!provider.is_token_expired());
    }

    #[test]
    fn test_supports_model() {
        // GPT models should be supported
        assert!(CodexProvider::supports_model("gpt-4"));
        assert!(CodexProvider::supports_model("gpt-4o"));
        assert!(CodexProvider::supports_model("gpt-4-turbo"));
        assert!(CodexProvider::supports_model("GPT-4")); // Case insensitive

        // O-series models should be supported
        assert!(CodexProvider::supports_model("o1"));
        assert!(CodexProvider::supports_model("o1-preview"));
        assert!(CodexProvider::supports_model("o3"));
        assert!(CodexProvider::supports_model("o4-mini"));

        // Codex models should be supported (contains "codex")
        assert!(CodexProvider::supports_model("codex-mini"));
        assert!(CodexProvider::supports_model("gpt-4-codex"));

        // Non-GPT models should not be supported
        assert!(!CodexProvider::supports_model("claude-3"));
        assert!(!CodexProvider::supports_model("gemini-pro"));
        assert!(!CodexProvider::supports_model("llama-2"));
    }

    #[test]
    fn test_transform_to_codex_format_basic() {
        let request = serde_json::json!({
            "model": "gpt-4o",
            "messages": [
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": "Hello!"}
            ],
            "stream": true
        });

        let result = transform_to_codex_format(&request).unwrap();

        assert_eq!(result["model"], "gpt-4o");
        assert_eq!(result["stream"], true);
        // system 消息应映射到 instructions
        assert!(result.get("instructions").is_some());
        let instructions = result["instructions"].as_str().unwrap();
        assert_eq!(instructions, "You are a helpful assistant.");

        let input = result["input"].as_array().unwrap();
        // system message 不应污染输入，保留 user 消息即可
        assert_eq!(input.len(), 1);
        assert_eq!(input[0]["role"], "user");
    }

    #[test]
    fn test_transform_to_codex_format_without_system_does_not_inject_instructions() {
        let request = serde_json::json!({
            "model": "gpt-4o",
            "messages": [
                {"role": "user", "content": "Hello!"}
            ]
        });

        let result = transform_to_codex_format(&request).unwrap();
        assert!(result.get("instructions").is_none());
    }

    #[test]
    fn test_transform_to_codex_format_uses_explicit_instructions() {
        let request = serde_json::json!({
            "model": "gpt-4o",
            "instructions": "You are a general assistant.",
            "messages": [
                {"role": "user", "content": "Hello!"}
            ]
        });

        let result = transform_to_codex_format(&request).unwrap();
        assert_eq!(
            result["instructions"].as_str(),
            Some("You are a general assistant.")
        );
    }

    #[test]
    fn test_transform_to_codex_format_with_tools() {
        let request = serde_json::json!({
            "model": "gpt-4o",
            "messages": [
                {"role": "user", "content": "What's the weather?"}
            ],
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": "get_weather",
                        "description": "Get weather info",
                        "parameters": {"type": "object"}
                    }
                }
            ]
        });

        let result = transform_to_codex_format(&request).unwrap();

        let tools = result["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["name"], "get_weather");
        assert_eq!(tools[0]["description"], "Get weather info");
    }

    #[test]
    fn test_transform_to_codex_format_with_parameters() {
        let request = serde_json::json!({
            "model": "gpt-4o",
            "messages": [{"role": "user", "content": "Hi"}],
            "temperature": 0.7,
            "max_tokens": 1000,
            "top_p": 0.9
        });

        let result = transform_to_codex_format(&request).unwrap();

        assert_eq!(result["temperature"], 0.7);
        assert_eq!(result["max_output_tokens"], 1000);
        assert_eq!(result["top_p"], 0.9);
    }

    #[tokio::test]
    async fn test_refresh_token_with_only_access_token() {
        // 场景：只有 access_token（无 refresh_token 和 api_key）
        let mut provider = CodexProvider::new();
        provider.credentials.access_token = Some("test_access_token".to_string());
        provider.credentials.refresh_token = None;
        provider.credentials.api_key = None;

        let result = provider.refresh_token().await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "test_access_token");
    }

    #[tokio::test]
    async fn test_refresh_token_with_no_credentials() {
        // 场景：无任何凭证（api_key、refresh_token、access_token 均为 None）
        let mut provider = CodexProvider::new();
        provider.credentials.api_key = None;
        provider.credentials.refresh_token = None;
        provider.credentials.access_token = None;

        let result = provider.refresh_token().await;
        assert!(result.is_err());
        let error_msg = result.unwrap_err().to_string();
        assert!(error_msg.contains("没有可用的认证凭证"));
        assert!(error_msg.contains("API Key 模式"));
        assert!(error_msg.contains("OAuth 模式"));
        assert!(error_msg.contains("Access Token 模式"));
    }

    #[tokio::test]
    async fn test_api_key_priority_over_refresh_token() {
        // 场景：同时有 api_key 和 refresh_token
        let mut provider = CodexProvider::new();
        provider.credentials.api_key = Some("sk-test-api-key".to_string());
        provider.credentials.refresh_token = Some("test_refresh_token".to_string());
        provider.credentials.access_token = Some("test_access_token".to_string());

        let result = provider.refresh_token().await;
        assert!(result.is_ok());
        // 应该返回 API Key（优先级最高）
        assert_eq!(result.unwrap(), "sk-test-api-key");
    }

    #[tokio::test]
    async fn test_refresh_token_with_expired_access_token() {
        // 场景：只有 access_token（已过期）
        let mut provider = CodexProvider::new();
        provider.credentials.access_token = Some("expired_access_token".to_string());
        provider.credentials.expires_at = Some("2020-01-01T00:00:00Z".to_string());
        provider.credentials.refresh_token = None;
        provider.credentials.api_key = None;

        let result = provider.refresh_token().await;
        assert!(result.is_ok());
        // 应该返回 access_token（即使已过期，由上层处理）
        assert_eq!(result.unwrap(), "expired_access_token");
    }
}

// ============================================================================
// OAuth 登录功能（参考 Antigravity 实现）
// ============================================================================

use once_cell::sync::Lazy;
use std::sync::Arc;
use tokio::sync::{oneshot, RwLock};
use uuid::Uuid;

/// 全局 Codex OAuth 服务器状态
/// 用于在重新打开授权对话框时关闭之前的服务器
static CODEX_OAUTH_SERVER_SHUTDOWN: Lazy<RwLock<Option<oneshot::Sender<()>>>> =
    Lazy::new(|| RwLock::new(None));

/// 停止之前运行的 Codex OAuth 服务器（如果有）
pub async fn stop_codex_oauth_server() {
    let mut guard = CODEX_OAUTH_SERVER_SHUTDOWN.write().await;
    if let Some(shutdown_tx) = guard.take() {
        tracing::info!("[Codex OAuth] 关闭之前的 OAuth 服务器");
        let _ = shutdown_tx.send(());
        // 给服务器一些时间来关闭
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
}

/// OAuth 登录成功后的凭证信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexOAuthResult {
    pub credentials: CodexCredentials,
    pub creds_file_path: String,
}

/// OpenAI OAuth 固定回调端口（必须与 client_id 注册的回调地址一致）
const OPENAI_OAUTH_CALLBACK_PORT: u16 = 1455;

/// OpenAI OAuth 固定回调路径（必须与 client_id 注册的回调地址一致）
const OPENAI_OAUTH_CALLBACK_PATH: &str = "/auth/callback";

/// 生成 OAuth 授权 URL（用于外部浏览器登录）
///
/// 注意：OpenAI OAuth 要求 redirect_uri 必须是预先注册的固定地址
/// Codex CLI 的 client_id 只注册了 http://localhost:1455/auth/callback
pub fn generate_codex_auth_url(state: &str, code_challenge: &str) -> String {
    let redirect_uri =
        format!("http://localhost:{OPENAI_OAUTH_CALLBACK_PORT}{OPENAI_OAUTH_CALLBACK_PATH}");

    let params = [
        ("client_id", OPENAI_CLIENT_ID),
        ("response_type", "code"),
        ("redirect_uri", redirect_uri.as_str()),
        // 使用基础 scope，与 CLIProxyAPI 保持一致
        ("scope", "openid email profile offline_access"),
        ("state", state),
        ("code_challenge", code_challenge),
        ("code_challenge_method", "S256"),
        ("prompt", "login"),
        ("id_token_add_organizations", "true"),
        ("codex_cli_simplified_flow", "true"),
    ];

    let query = params
        .iter()
        .map(|(k, v)| format!("{}={}", k, urlencoding::encode(v)))
        .collect::<Vec<_>>()
        .join("&");

    format!("{OPENAI_AUTH_URL}?{query}")
}

/// 用授权码交换 Token
pub async fn exchange_codex_code_for_token(
    client: &Client,
    code: &str,
    code_verifier: &str,
    redirect_uri: &str,
) -> Result<serde_json::Value, Box<dyn Error + Send + Sync>> {
    let params = [
        ("grant_type", "authorization_code"),
        ("client_id", OPENAI_CLIENT_ID),
        ("code", code),
        ("redirect_uri", redirect_uri),
        ("code_verifier", code_verifier),
    ];

    let resp = client
        .post(OPENAI_TOKEN_URL)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Accept", "application/json")
        .form(&params)
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Token 交换失败: {status} - {body}").into());
    }

    let data: serde_json::Value = resp.json().await?;
    Ok(data)
}

/// OAuth 成功页面 HTML
const CODEX_OAUTH_SUCCESS_HTML: &str = r#"<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>授权成功</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: linear-gradient(135deg, #10a37f 0%, #1a7f64 100%); }
        .container { text-align: center; background: white; padding: 40px 60px; border-radius: 16px; box-shadow: 0 10px 40px rgba(0,0,0,0.2); }
        h1 { color: #10a37f; margin-bottom: 16px; }
        p { color: #666; margin-bottom: 8px; }
        .email { color: #333; font-weight: 500; }
    </style>
</head>
<body>
    <div class="container">
        <h1>✓ 授权成功</h1>
        <p>Codex 账号已添加到 Lime</p>
        <p class="email">EMAIL_PLACEHOLDER</p>
        <p style="margin-top: 20px; color: #999;">可以关闭此页面</p>
    </div>
</body>
</html>"#;

/// OAuth 失败页面 HTML
const CODEX_OAUTH_ERROR_HTML: &str = r#"<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>授权失败</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); }
        .container { text-align: center; background: white; padding: 40px 60px; border-radius: 16px; box-shadow: 0 10px 40px rgba(0,0,0,0.2); }
        h1 { color: #ef4444; margin-bottom: 16px; }
        p { color: #666; }
        .error { color: #ef4444; font-size: 14px; margin-top: 16px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>✗ 授权失败</h1>
        <p>ERROR_PLACEHOLDER</p>
        <p style="margin-top: 20px; color: #999;">请关闭此页面后重试</p>
    </div>
</body>
</html>"#;

/// 启动 OAuth 服务器并返回授权 URL（不打开浏览器）
/// 服务器会在后台等待回调，成功后返回凭证
///
/// 注意：OpenAI OAuth 要求使用固定的回调地址 http://localhost:1455/auth/callback
pub async fn start_codex_oauth_server_and_get_url() -> Result<
    (
        String,
        impl std::future::Future<Output = Result<CodexOAuthResult, Box<dyn Error + Send + Sync>>>,
    ),
    Box<dyn Error + Send + Sync>,
> {
    use axum::{extract::Query, response::Html, routing::get, Router};
    use std::collections::HashMap;
    use tokio::net::TcpListener;

    // 首先停止之前可能运行的 OAuth 服务器
    stop_codex_oauth_server().await;

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()?;

    // 生成 PKCE codes
    let pkce_codes = PKCECodes::generate()?;
    let code_verifier = pkce_codes.code_verifier.clone();
    let code_challenge = pkce_codes.code_challenge.clone();

    // 生成随机 state
    let state = Uuid::new_v4().to_string();
    let state_clone = state.clone();

    // 创建 channel 用于接收回调结果
    let (tx, rx) = oneshot::channel::<Result<CodexOAuthResult, String>>();
    let tx = Arc::new(tokio::sync::Mutex::new(Some(tx)));

    // 创建 shutdown channel
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    // 保存 shutdown sender 到全局状态
    {
        let mut guard = CODEX_OAUTH_SERVER_SHUTDOWN.write().await;
        *guard = Some(shutdown_tx);
    }

    // 使用固定端口 1455（OpenAI OAuth 要求）
    let port = OPENAI_OAUTH_CALLBACK_PORT;
    let listener = TcpListener::bind(format!("127.0.0.1:{port}")).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::AddrInUse {
            format!(
                "端口 {port} 已被占用。OpenAI OAuth 要求使用固定端口 1455，请关闭占用该端口的应用后重试。"
            )
        } else {
            format!("绑定端口 {port} 失败: {e}")
        }
    })?;

    let redirect_uri =
        format!("http://localhost:{OPENAI_OAUTH_CALLBACK_PORT}{OPENAI_OAUTH_CALLBACK_PATH}");
    let redirect_uri_clone = redirect_uri.clone();

    // 生成授权 URL（不再传入 port 参数）
    let auth_url = generate_codex_auth_url(&state, &code_challenge);

    tracing::info!(
        "[Codex OAuth] 服务器启动在端口 {}, 授权 URL: {}",
        port,
        auth_url
    );

    // 构建路由（使用固定的回调路径 /auth/callback）
    let app = Router::new().route(
        OPENAI_OAUTH_CALLBACK_PATH,
        get(move |Query(params): Query<HashMap<String, String>>| {
            let tx = tx.clone();
            let client = client.clone();
            let state_expected = state_clone.clone();
            let redirect_uri = redirect_uri_clone.clone();
            let code_verifier = code_verifier.clone();

            async move {
                let code = params.get("code");
                let returned_state = params.get("state");
                let error = params.get("error");

                // 检查错误
                if let Some(err) = error {
                    let html = CODEX_OAUTH_ERROR_HTML.replace("ERROR_PLACEHOLDER", err);
                    if let Some(sender) = tx.lock().await.take() {
                        let _ = sender.send(Err(format!("OAuth 错误: {err}")));
                    }
                    return Html(html);
                }

                // 检查 state
                if returned_state.map(|s| s.as_str()) != Some(&state_expected) {
                    let html =
                        CODEX_OAUTH_ERROR_HTML.replace("ERROR_PLACEHOLDER", "State 验证失败");
                    if let Some(sender) = tx.lock().await.take() {
                        let _ = sender.send(Err("State 验证失败".to_string()));
                    }
                    return Html(html);
                }

                // 检查 code
                let code = match code {
                    Some(c) => c,
                    None => {
                        let html =
                            CODEX_OAUTH_ERROR_HTML.replace("ERROR_PLACEHOLDER", "未收到授权码");
                        if let Some(sender) = tx.lock().await.take() {
                            let _ = sender.send(Err("未收到授权码".to_string()));
                        }
                        return Html(html);
                    }
                };

                // 交换 Token
                let token_result =
                    exchange_codex_code_for_token(&client, code, &code_verifier, &redirect_uri)
                        .await;
                let token_data = match token_result {
                    Ok(data) => data,
                    Err(e) => {
                        let html =
                            CODEX_OAUTH_ERROR_HTML.replace("ERROR_PLACEHOLDER", &e.to_string());
                        if let Some(sender) = tx.lock().await.take() {
                            let _ = sender.send(Err(e.to_string()));
                        }
                        return Html(html);
                    }
                };

                let access_token = token_data["access_token"].as_str().unwrap_or_default();
                let refresh_token = token_data["refresh_token"].as_str().map(|s| s.to_string());
                let id_token = token_data["id_token"].as_str().map(|s| s.to_string());
                let expires_in = token_data["expires_in"].as_i64();

                // 解析 ID Token 获取用户信息
                let (account_id, email) = if let Some(ref id_token) = id_token {
                    parse_jwt_claims(id_token)
                } else {
                    (None, None)
                };

                // 构建凭证
                let now = chrono::Utc::now();
                let credentials = CodexCredentials {
                    id_token,
                    access_token: Some(access_token.to_string()),
                    refresh_token,
                    api_key: None,
                    api_base_url: None,
                    account_id,
                    last_refresh: Some(now.to_rfc3339()),
                    email: email.clone(),
                    r#type: "codex".to_string(),
                    expires_at: expires_in
                        .map(|e| (now + chrono::Duration::seconds(e)).to_rfc3339()),
                };

                // 保存凭证到应用数据目录
                let creds_dir = dirs::data_dir()
                    .unwrap_or_else(|| PathBuf::from("."))
                    .join("lime")
                    .join("credentials")
                    .join("codex");

                if let Err(e) = std::fs::create_dir_all(&creds_dir) {
                    let html = CODEX_OAUTH_ERROR_HTML
                        .replace("ERROR_PLACEHOLDER", &format!("创建目录失败: {e}"));
                    if let Some(sender) = tx.lock().await.take() {
                        let _ = sender.send(Err(format!("创建目录失败: {e}")));
                    }
                    return Html(html);
                }

                // 生成唯一文件名
                let uuid = Uuid::new_v4().to_string();
                let timestamp = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();
                let filename = format!("codex_{}_{}.json", &uuid[..8], timestamp);
                let creds_file_path = creds_dir.join(&filename);

                // 保存凭证
                let creds_json = match serde_json::to_string_pretty(&credentials) {
                    Ok(json) => json,
                    Err(e) => {
                        let html = CODEX_OAUTH_ERROR_HTML
                            .replace("ERROR_PLACEHOLDER", &format!("序列化凭证失败: {e}"));
                        if let Some(sender) = tx.lock().await.take() {
                            let _ = sender.send(Err(format!("序列化凭证失败: {e}")));
                        }
                        return Html(html);
                    }
                };

                if let Err(e) = std::fs::write(&creds_file_path, &creds_json) {
                    let html = CODEX_OAUTH_ERROR_HTML
                        .replace("ERROR_PLACEHOLDER", &format!("保存凭证失败: {e}"));
                    if let Some(sender) = tx.lock().await.take() {
                        let _ = sender.send(Err(format!("保存凭证失败: {e}")));
                    }
                    return Html(html);
                }

                tracing::info!("[Codex OAuth] 凭证已保存到: {:?}", creds_file_path);

                // 发送成功结果
                let result = CodexOAuthResult {
                    credentials,
                    creds_file_path: creds_file_path.to_string_lossy().to_string(),
                };

                if let Some(sender) = tx.lock().await.take() {
                    let _ = sender.send(Ok(result));
                }

                // 返回成功页面
                let html = CODEX_OAUTH_SUCCESS_HTML.replace(
                    "EMAIL_PLACEHOLDER",
                    &email.unwrap_or_else(|| "未知邮箱".to_string()),
                );
                Html(html)
            }
        }),
    );

    // 启动服务器（支持优雅关闭）
    let server = axum::serve(listener, app).with_graceful_shutdown(async move {
        let _ = shutdown_rx.await;
        tracing::info!("[Codex OAuth] 服务器收到关闭信号");
    });

    // 创建等待 future
    let wait_future = async move {
        // 设置超时（5 分钟）
        let timeout = tokio::time::timeout(std::time::Duration::from_secs(300), async {
            // 启动服务器（在后台运行）
            tokio::spawn(async move {
                if let Err(e) = server.await {
                    tracing::error!("[Codex OAuth] 服务器错误: {}", e);
                }
            });

            // 等待回调结果
            match rx.await {
                Ok(result) => result.map_err(|e| {
                    Box::new(std::io::Error::other(e)) as Box<dyn Error + Send + Sync>
                }),
                Err(_) => Err("OAuth 回调通道关闭".into()),
            }
        });

        match timeout.await {
            Ok(result) => {
                // 成功或失败后都清理全局状态
                let mut guard = CODEX_OAUTH_SERVER_SHUTDOWN.write().await;
                *guard = None;
                result
            }
            Err(_) => {
                // 超时后也清理全局状态
                let mut guard = CODEX_OAUTH_SERVER_SHUTDOWN.write().await;
                *guard = None;
                Err("OAuth 登录超时（5分钟）".into())
            }
        }
    };

    Ok((auth_url, wait_future))
}

/// 启动 Codex OAuth 登录流程（自动打开浏览器）
pub async fn start_codex_oauth_login() -> Result<CodexOAuthResult, Box<dyn Error + Send + Sync>> {
    let (auth_url, wait_future) = start_codex_oauth_server_and_get_url().await?;

    tracing::info!("[Codex OAuth] 打开浏览器进行授权: {}", auth_url);

    // 打开浏览器
    if let Err(e) = open::that(&auth_url) {
        tracing::warn!("[Codex OAuth] 无法打开浏览器: {}. 请手动打开 URL.", e);
    }

    // 等待回调
    wait_future.await
}
