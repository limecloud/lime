//! API Key Provider 桥接模块
//!
//! 将 Lime API Key Provider 主路径与 Aster Provider 系统连接。
//!
//! ## 功能
//! - 从 API Key Provider 选择可用凭证
//! - 将凭证转换为 Aster Provider 配置
//! - 智能拆分 base_url 为 host + path，避免路径重复（如智谱 /v4/v1 问题）

use aster::model::ModelConfig;
use aster::providers::base::Provider;
use lime_core::database::dao::api_key_provider::{infer_managed_runtime_spec, ApiProviderType};
use lime_core::database::DbConnection;
use lime_core::models::provider_type::is_custom_provider_id;
use lime_core::models::{
    runtime_api_key_id_from_credential_uuid, RuntimeCredentialData, RuntimeProviderCredential,
};
use lime_services::api_key_provider_service::ApiKeyProviderService;
use std::sync::Arc;

use crate::provider_safety::wrap_provider_with_safety;

/// 凭证桥接错误
#[derive(Debug, Clone)]
pub enum CredentialBridgeError {
    /// 没有可用凭证
    NoCredentials(String),
    /// 凭证类型不支持
    UnsupportedCredentialType(String),
    /// Provider 创建失败
    ProviderCreationFailed(String),
    /// 数据库错误
    DatabaseError(String),
}

impl std::fmt::Display for CredentialBridgeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoCredentials(msg) => write!(f, "没有可用凭证: {msg}"),
            Self::UnsupportedCredentialType(msg) => write!(f, "不支持的凭证类型: {msg}"),
            Self::ProviderCreationFailed(msg) => write!(f, "Provider 创建失败: {msg}"),
            Self::DatabaseError(msg) => write!(f, "数据库错误: {msg}"),
        }
    }
}

impl std::error::Error for CredentialBridgeError {}

/// Aster Provider 配置
#[derive(Debug, Clone)]
pub struct AsterProviderConfig {
    /// Provider 名称 (openai, anthropic, google 等)
    pub provider_name: String,
    /// Provider 选择器（优先保留前端 provider_id / runtime_provider_type）
    pub provider_selector: Option<String>,
    /// 模型名称
    pub model_name: String,
    /// API Key
    pub api_key: Option<String>,
    /// Base URL
    pub base_url: Option<String>,
    /// 凭证 UUID（用于记录使用和健康状态）
    pub credential_uuid: String,
    /// 是否强制 OpenAI provider 使用 Responses API（用于 Codex 等兼容链路）
    pub force_responses_api: bool,
    /// 当前回合是否启用 toolshim
    pub toolshim: bool,
    /// toolshim 解释器模型
    pub toolshim_model: Option<String>,
}

/// Provider 凭证桥接器
///
/// 负责从 Lime API Key Provider 选择凭证并转换为 Aster Provider 配置
pub struct CredentialBridge {
    api_key_service: ApiKeyProviderService,
}

impl Default for CredentialBridge {
    fn default() -> Self {
        Self::new()
    }
}

impl CredentialBridge {
    pub fn new() -> Self {
        Self {
            api_key_service: ApiKeyProviderService::new(),
        }
    }

    fn resolve_runtime_api_key_id<'a>(&self, uuid: &'a str) -> Option<&'a str> {
        runtime_api_key_id_from_credential_uuid(uuid)
    }

    /// 从 API Key Provider 选择凭证并创建 Aster Provider 配置
    ///
    /// # 参数
    /// - `db`: 数据库连接
    /// - `provider_type`: Provider 类型 (openai, anthropic, kiro, deepseek 等)
    /// - `model`: 模型名称
    ///
    /// # 返回
    /// 成功时返回 AsterProviderConfig，失败时返回错误
    pub async fn select_and_configure(
        &self,
        db: &DbConnection,
        provider_type: &str,
        model: &str,
    ) -> Result<AsterProviderConfig, CredentialBridgeError> {
        let credential = self
            .api_key_service
            .select_credential_for_provider(db, provider_type, Some(provider_type), None)
            .await
            .map_err(CredentialBridgeError::DatabaseError)?
            .ok_or_else(|| {
                CredentialBridgeError::NoCredentials(format!(
                    "没有找到 {provider_type} 类型的可用凭证"
                ))
            })?;

        // 2. 转换为 Aster Provider 配置，传递 provider_type 以便正确识别 Provider
        self.credential_to_config(&credential, model, provider_type, db)
            .await
    }

    fn resolve_api_provider_type_hint(
        &self,
        db: &DbConnection,
        provider_type_hint: &str,
    ) -> Option<ApiProviderType> {
        if let Ok(api_type) = provider_type_hint.parse::<ApiProviderType>() {
            return Some(api_type);
        }

        if !is_custom_provider_id(provider_type_hint) {
            return None;
        }

        match self.api_key_service.get_provider(db, provider_type_hint) {
            Ok(Some(provider_with_keys)) => Some(provider_with_keys.provider.provider_type),
            Ok(None) => {
                tracing::warn!(
                    "[CredentialBridge] custom provider 不存在: {}, 使用默认映射",
                    provider_type_hint
                );
                None
            }
            Err(error) => {
                tracing::warn!(
                    "[CredentialBridge] 读取 custom provider 失败: {} ({})，使用默认映射",
                    provider_type_hint,
                    error
                );
                None
            }
        }
    }

    /// 将 Lime 凭证转换为 Aster Provider 配置
    async fn credential_to_config(
        &self,
        credential: &RuntimeProviderCredential,
        model: &str,
        provider_type_hint: &str,
        db: &DbConnection,
    ) -> Result<AsterProviderConfig, CredentialBridgeError> {
        tracing::info!(
            "[CredentialBridge] credential_to_config: provider_type_hint={}, credential_type={:?}",
            provider_type_hint,
            credential.provider_type
        );

        let (provider_name, api_key, base_url, force_responses_api) = match &credential.credential {
            // OpenAI API Key - 根据 provider_type_hint 确定实际的 Provider
            RuntimeCredentialData::OpenAIKey { api_key, base_url } => {
                let resolved_api_type = self.resolve_api_provider_type_hint(db, provider_type_hint);
                let provider =
                    map_provider_type_to_aster_with_api_type(provider_type_hint, resolved_api_type);
                tracing::info!(
                    "[CredentialBridge] OpenAIKey: provider_type_hint={}, resolved_api_type={:?} -> aster_provider={}",
                    provider_type_hint,
                    resolved_api_type,
                    provider
                );
                (
                    provider.to_string(),
                    Some(api_key.clone()),
                    base_url.clone(),
                    resolved_api_type == Some(ApiProviderType::Codex),
                )
            }

            // Claude/Anthropic API Key
            RuntimeCredentialData::ClaudeKey { api_key, base_url }
            | RuntimeCredentialData::AnthropicKey { api_key, base_url } => (
                "anthropic".to_string(),
                Some(api_key.clone()),
                base_url.clone(),
                false,
            ),

            // Gemini API Key
            RuntimeCredentialData::GeminiApiKey {
                api_key, base_url, ..
            } => (
                "google".to_string(),
                Some(api_key.clone()),
                base_url.clone(),
                false,
            ),

            // Vertex AI
            RuntimeCredentialData::VertexKey {
                api_key, base_url, ..
            } => (
                "gcpvertexai".to_string(),
                Some(api_key.clone()),
                base_url.clone(),
                false,
            ),
        };

        Ok(AsterProviderConfig {
            provider_name,
            provider_selector: normalize_provider_selector(Some(provider_type_hint)),
            model_name: model.to_string(),
            api_key,
            base_url,
            credential_uuid: credential.uuid.clone(),
            force_responses_api,
            toolshim: false,
            toolshim_model: None,
        })
    }

    /// 记录凭证使用
    pub fn record_usage(&self, db: &DbConnection, uuid: &str) -> Result<(), CredentialBridgeError> {
        if let Some(api_key_id) = self.resolve_runtime_api_key_id(uuid) {
            return self
                .api_key_service
                .record_usage(db, api_key_id)
                .map_err(CredentialBridgeError::DatabaseError);
        }

        tracing::debug!(
            "[CredentialBridge] 忽略已退役的旧 credential 使用记录: {}",
            uuid
        );
        Ok(())
    }

    /// 标记凭证为健康
    pub fn mark_healthy(
        &self,
        db: &DbConnection,
        uuid: &str,
        model: Option<&str>,
    ) -> Result<(), CredentialBridgeError> {
        if self.resolve_runtime_api_key_id(uuid).is_some() {
            return Ok(());
        }

        let _ = (db, model);
        tracing::debug!(
            "[CredentialBridge] 忽略已退役的旧 credential 健康标记: {}",
            uuid
        );
        Ok(())
    }

    /// 标记凭证为不健康
    pub fn mark_unhealthy(
        &self,
        db: &DbConnection,
        uuid: &str,
        error: Option<&str>,
    ) -> Result<(), CredentialBridgeError> {
        if self.resolve_runtime_api_key_id(uuid).is_some() {
            return Ok(());
        }

        let _ = (db, error);
        tracing::debug!(
            "[CredentialBridge] 忽略已退役的旧 credential 失败标记: {}",
            uuid
        );
        Ok(())
    }
}

/// 从 AsterProviderConfig 创建 Aster Provider
///
/// 设置环境变量并调用 aster::providers::create
pub async fn create_aster_provider(
    config: &AsterProviderConfig,
) -> Result<Arc<dyn Provider>, CredentialBridgeError> {
    let disable_default_fast_model = should_disable_provider_default_fast_model(config);

    if disable_default_fast_model {
        tracing::info!(
            provider_name = %config.provider_name,
            provider_selector = ?config.provider_selector,
            model_name = %config.model_name,
            "[CredentialBridge] 检测到 OpenAI 兼容非 OpenAI provider，已禁用默认 fast_model"
        );
    }

    // 设置环境变量
    set_provider_env_vars(config);

    // 创建 ModelConfig
    let model_config = build_provider_model_config(config)?;

    // 创建 Provider
    aster::providers::create(&config.provider_name, model_config)
        .await
        .map(|provider| wrap_provider_with_safety(provider, disable_default_fast_model))
        .map_err(|e| {
            CredentialBridgeError::ProviderCreationFailed(format!("创建 Provider 失败: {e}"))
        })
}

fn build_provider_model_config(
    config: &AsterProviderConfig,
) -> Result<ModelConfig, CredentialBridgeError> {
    ModelConfig::new(&config.model_name)
        .map(|model_config| {
            model_config
                .with_toolshim(config.toolshim)
                .with_toolshim_model(config.toolshim_model.clone())
        })
        .map_err(|e| {
            CredentialBridgeError::ProviderCreationFailed(format!("创建 ModelConfig 失败: {e}"))
        })
}

fn normalize_provider_selector(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn normalize_provider_identifier(value: Option<&str>) -> Option<String> {
    normalize_provider_selector(value).map(|value| value.to_ascii_lowercase())
}

fn is_first_party_openai_selector(selector: &str) -> bool {
    matches!(selector, "openai" | "codex")
}

fn is_first_party_openai_base_url(base_url: &str) -> bool {
    let normalized = base_url.trim().to_ascii_lowercase();
    normalized.contains("openai.com")
}

fn is_first_party_anthropic_selector(selector: &str) -> bool {
    matches!(selector, "anthropic" | "claude")
}

fn is_first_party_anthropic_base_url(base_url: &str) -> bool {
    let normalized = base_url.trim().to_ascii_lowercase();
    normalized.contains("api.anthropic.com")
}

fn should_disable_provider_default_fast_model(config: &AsterProviderConfig) -> bool {
    if config.force_responses_api {
        return false;
    }

    match config.provider_name.as_str() {
        "openai" => {
            if let Some(base_url) = config.base_url.as_deref() {
                if !is_first_party_openai_base_url(base_url) {
                    return true;
                }
            }

            match normalize_provider_identifier(config.provider_selector.as_deref()) {
                Some(selector) => !is_first_party_openai_selector(&selector),
                None => false,
            }
        }
        "anthropic" => {
            if let Some(base_url) = config.base_url.as_deref() {
                if !is_first_party_anthropic_base_url(base_url) {
                    return true;
                }
            }

            match normalize_provider_identifier(config.provider_selector.as_deref()) {
                Some(selector) if config.base_url.is_none() => {
                    !is_first_party_anthropic_selector(&selector)
                }
                _ => false,
            }
        }
        _ => false,
    }
}

/// 设置 Provider 环境变量
/// 从 URL 中拆分 host（scheme+authority）和 path 部分
///
/// 例如：
/// - `https://api.openai.com` -> (`https://api.openai.com`, ``)
/// - `https://open.bigmodel.cn/api/paas/v4` -> (`https://open.bigmodel.cn`, `api/paas/v4`)
/// - `https://localhost:8080/v1` -> (`https://localhost:8080`, `v1`)
fn split_url_host_and_path(url: &str) -> (String, String) {
    // 找到 scheme 之后的 authority 部分
    let after_scheme = if let Some(pos) = url.find("://") {
        pos + 3
    } else {
        return (url.to_string(), String::new());
    };

    // 找到 authority 之后的第一个 /（即路径开始）
    let path_start = url[after_scheme..].find('/').map(|p| p + after_scheme);

    match path_start {
        Some(pos) => {
            let host = url[..pos].to_string();
            let path = url[pos..].trim_matches('/').to_string();
            (host, path)
        }
        None => (url.to_string(), String::new()),
    }
}

fn resolve_anthropic_env_key(config: &AsterProviderConfig) -> &'static str {
    let api_host = config
        .base_url
        .as_deref()
        .unwrap_or("https://api.anthropic.com");
    let hinted_provider_type = config
        .provider_selector
        .as_deref()
        .and_then(|value| value.parse::<ApiProviderType>().ok())
        .unwrap_or(ApiProviderType::Anthropic);
    let runtime_spec = infer_managed_runtime_spec(hinted_provider_type, api_host);

    if runtime_spec
        .auth_header
        .eq_ignore_ascii_case("authorization")
    {
        "ANTHROPIC_AUTH_TOKEN"
    } else {
        "ANTHROPIC_API_KEY"
    }
}

fn set_provider_env_vars(config: &AsterProviderConfig) {
    tracing::info!(
        "[CredentialBridge] set_provider_env_vars: provider_name={}, has_api_key={}, base_url={:?}",
        config.provider_name,
        config.api_key.is_some(),
        config.base_url
    );

    let env_key = match config.provider_name.as_str() {
        "openai" => "OPENAI_API_KEY",
        "anthropic" => resolve_anthropic_env_key(config),
        "google" => "GOOGLE_API_KEY",
        "bedrock" => "AWS_ACCESS_KEY_ID", // Bedrock 使用 AWS 凭证
        "gcpvertexai" => "GOOGLE_API_KEY",
        "codex" => "OPENAI_API_KEY", // Codex 兼容 OpenAI
        "deepseek" | "custom_deepseek" => "OPENAI_API_KEY", // DeepSeek 使用 OpenAI 兼容 API
        "groq" => "OPENAI_API_KEY",  // Groq 使用 OpenAI 兼容 API
        "mistral" => "OPENAI_API_KEY", // Mistral 使用 OpenAI 兼容 API
        "openrouter" => "OPENROUTER_API_KEY",
        _ => "OPENAI_API_KEY", // 默认使用 OpenAI 格式
    };

    tracing::info!("[CredentialBridge] 设置环境变量: {}=***", env_key);

    if let Some(api_key) = &config.api_key {
        std::env::set_var(env_key, api_key);
        if config.provider_name == "anthropic" {
            match env_key {
                "ANTHROPIC_AUTH_TOKEN" => std::env::remove_var("ANTHROPIC_API_KEY"),
                "ANTHROPIC_API_KEY" => std::env::remove_var("ANTHROPIC_AUTH_TOKEN"),
                _ => {}
            }
        }
    }

    if config.provider_name == "openai" {
        if config.force_responses_api {
            std::env::set_var("OPENAI_FORCE_RESPONSES_API", "1");
        } else {
            std::env::remove_var("OPENAI_FORCE_RESPONSES_API");
        }
    }

    // 设置 base_url
    // Aster 的 OpenAI Provider 使用 OPENAI_HOST（仅 scheme+host+port）和
    // OPENAI_BASE_PATH（路径部分 + /chat/completions）环境变量
    if let Some(base_url) = &config.base_url {
        match config.provider_name.as_str() {
            "openai" => {
                // 解析 base_url，将路径部分拆分到 OPENAI_BASE_PATH。
                // Responses 模式也复用这条前缀推导，避免出现 /v1/v1/responses。
                // 例如 https://open.bigmodel.cn/api/paas/v4
                //   -> OPENAI_HOST = https://open.bigmodel.cn
                //   -> OPENAI_BASE_PATH = api/paas/v4/chat/completions
                let (host_part, path_part) = split_url_host_and_path(base_url);
                if path_part.is_empty() {
                    // 无路径部分（如 https://api.openai.com），直接设置
                    std::env::set_var("OPENAI_HOST", base_url);
                    // 清除可能残留的 OPENAI_BASE_PATH，使用 Aster 默认值
                    std::env::remove_var("OPENAI_BASE_PATH");
                    tracing::info!("[CredentialBridge] 设置 OPENAI_HOST={}", base_url);
                } else {
                    // base_url 包含路径，需要拆分
                    let base_path = format!("{}/chat/completions", path_part);
                    std::env::set_var("OPENAI_HOST", &host_part);
                    std::env::set_var("OPENAI_BASE_PATH", &base_path);
                    tracing::info!(
                        "[CredentialBridge] 设置 OPENAI_HOST={}, OPENAI_BASE_PATH={}",
                        host_part,
                        base_path
                    );
                }
            }
            "anthropic" => {
                // Aster Anthropic Provider 读取 ANTHROPIC_HOST
                std::env::set_var("ANTHROPIC_HOST", base_url);
                // 兼容历史逻辑，保留旧变量
                std::env::set_var("ANTHROPIC_BASE_URL", base_url);
                tracing::info!(
                    "[CredentialBridge] 设置 ANTHROPIC_HOST={}, ANTHROPIC_BASE_URL={}",
                    base_url,
                    base_url
                );
            }
            "ollama" => {
                std::env::set_var("OLLAMA_BASE_URL", base_url);
                std::env::set_var("OLLAMA_HOST", base_url);
                tracing::info!(
                    "[CredentialBridge] 设置 OLLAMA_BASE_URL={}, OLLAMA_HOST={}",
                    base_url,
                    base_url
                );
            }
            _ => {
                // 其他 Provider 使用通用格式
                let base_url_key = format!(
                    "{}_BASE_URL",
                    config.provider_name.to_uppercase().replace('-', "_")
                );
                std::env::set_var(&base_url_key, base_url);
            }
        }
    }
}

/// 将 provider_type 字符串映射到 Aster Provider 名称
///
/// 支持 60+ API Key Provider，包括 deepseek, moonshot, qwen 等
fn map_provider_type_to_aster(provider_type: &str) -> &'static str {
    if let Ok(api_type) = provider_type.parse::<ApiProviderType>() {
        return api_type.runtime_spec().aster_provider_name;
    }

    match provider_type {
        // 标准 Provider
        "openai" => "openai",
        "anthropic" | "claude" => "anthropic",
        "google" | "gemini" => "google",
        "bedrock" => "bedrock",
        "gcpvertexai" | "vertex" => "gcpvertexai",
        "codex" => "openai",
        "azure" | "azure-openai" => "azure",
        "ollama" => "ollama",

        // DeepSeek - 使用 openai 兼容 provider（Aster 会通过 alias 映射）
        "deepseek" | "custom_deepseek" => "openai",

        // 其他 OpenAI 兼容 Provider - 使用 openai provider
        // 这些 Provider 都使用 OpenAI 兼容 API，通过 base_url 区分
        "groq" => "openai",
        "mistral" => "openai",
        "openrouter" => "openrouter",

        // 默认使用 openai（OpenAI 兼容格式）
        _ => "openai",
    }
}

fn map_provider_type_to_aster_with_api_type(
    provider_type: &str,
    resolved_api_type: Option<ApiProviderType>,
) -> &'static str {
    if let Some(api_type) = resolved_api_type {
        // Codex API Key 在 Aster 中应走 OpenAI provider（支持标准 tools + responses 转换逻辑），
        // 避免误走 codex CLI provider 导致工具事件丢失。
        if api_type == ApiProviderType::Codex {
            return "openai";
        }
        return api_type.runtime_spec().aster_provider_name;
    }
    map_provider_type_to_aster(provider_type)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_map_provider_type_to_aster_with_api_type() {
        assert_eq!(
            map_provider_type_to_aster_with_api_type(
                "custom-a32774c6-6fd0-433b-8b81-e95340e08793",
                Some(ApiProviderType::Codex),
            ),
            "openai"
        );
        assert_eq!(
            map_provider_type_to_aster_with_api_type(
                "custom-a32774c6-6fd0-433b-8b81-e95340e08793",
                Some(ApiProviderType::AnthropicCompatible),
            ),
            "anthropic"
        );
        assert_eq!(
            map_provider_type_to_aster_with_api_type("deepseek", None),
            "openai"
        );
    }

    #[test]
    fn test_set_provider_env_vars_openai_codex_responses_splits_prefixed_base_url() {
        std::env::remove_var("OPENAI_HOST");
        std::env::remove_var("OPENAI_BASE_PATH");
        std::env::remove_var("OPENAI_FORCE_RESPONSES_API");

        let config = AsterProviderConfig {
            provider_name: "openai".to_string(),
            provider_selector: Some("codex".to_string()),
            model_name: "gpt-5.3-codex".to_string(),
            api_key: Some("test-key".to_string()),
            base_url: Some("https://example.com/openai".to_string()),
            credential_uuid: "test-uuid".to_string(),
            force_responses_api: true,
            toolshim: false,
            toolshim_model: None,
        };

        set_provider_env_vars(&config);

        assert_eq!(
            std::env::var("OPENAI_HOST").ok(),
            Some("https://example.com".to_string())
        );
        assert_eq!(
            std::env::var("OPENAI_BASE_PATH").ok(),
            Some("openai/chat/completions".to_string())
        );
        assert_eq!(
            std::env::var("OPENAI_FORCE_RESPONSES_API").ok().as_deref(),
            Some("1")
        );
    }

    #[test]
    fn test_set_provider_env_vars_openai_codex_responses_normalizes_v1_base_url() {
        std::env::remove_var("OPENAI_HOST");
        std::env::remove_var("OPENAI_BASE_PATH");
        std::env::remove_var("OPENAI_FORCE_RESPONSES_API");

        let config = AsterProviderConfig {
            provider_name: "openai".to_string(),
            provider_selector: Some("codex".to_string()),
            model_name: "gpt-5.4".to_string(),
            api_key: Some("test-key".to_string()),
            base_url: Some("https://api.openai.com/v1".to_string()),
            credential_uuid: "test-uuid".to_string(),
            force_responses_api: true,
            toolshim: false,
            toolshim_model: None,
        };

        set_provider_env_vars(&config);

        assert_eq!(
            std::env::var("OPENAI_HOST").ok(),
            Some("https://api.openai.com".to_string())
        );
        assert_eq!(
            std::env::var("OPENAI_BASE_PATH").ok(),
            Some("v1/chat/completions".to_string())
        );
        assert_eq!(
            std::env::var("OPENAI_FORCE_RESPONSES_API").ok().as_deref(),
            Some("1")
        );
    }

    #[test]
    fn test_credential_bridge_error_display() {
        let err = CredentialBridgeError::NoCredentials("test".to_string());
        assert!(err.to_string().contains("没有可用凭证"));
    }

    #[test]
    fn test_should_disable_provider_default_fast_model_for_openai_compatible_provider() {
        let config = AsterProviderConfig {
            provider_name: "openai".to_string(),
            provider_selector: Some("zhipuai".to_string()),
            model_name: "glm-5".to_string(),
            api_key: Some("test-key".to_string()),
            base_url: Some("https://open.bigmodel.cn/api/paas/v4".to_string()),
            credential_uuid: "test-uuid".to_string(),
            force_responses_api: false,
            toolshim: false,
            toolshim_model: None,
        };

        assert!(should_disable_provider_default_fast_model(&config));
    }

    #[test]
    fn test_should_keep_provider_default_fast_model_for_first_party_openai() {
        let config = AsterProviderConfig {
            provider_name: "openai".to_string(),
            provider_selector: Some("openai".to_string()),
            model_name: "gpt-4o".to_string(),
            api_key: Some("test-key".to_string()),
            base_url: Some("https://api.openai.com/v1".to_string()),
            credential_uuid: "test-uuid".to_string(),
            force_responses_api: false,
            toolshim: false,
            toolshim_model: None,
        };

        assert!(!should_disable_provider_default_fast_model(&config));
    }

    #[test]
    fn test_should_keep_provider_default_fast_model_for_codex_responses_route() {
        let config = AsterProviderConfig {
            provider_name: "openai".to_string(),
            provider_selector: Some("codex".to_string()),
            model_name: "gpt-5.3-codex".to_string(),
            api_key: Some("test-key".to_string()),
            base_url: Some("https://example.com/openai".to_string()),
            credential_uuid: "test-uuid".to_string(),
            force_responses_api: true,
            toolshim: false,
            toolshim_model: None,
        };

        assert!(!should_disable_provider_default_fast_model(&config));
    }

    #[test]
    fn test_should_disable_provider_default_fast_model_for_anthropic_compatible_proxy() {
        let config = AsterProviderConfig {
            provider_name: "anthropic".to_string(),
            provider_selector: Some("custom-cae6e762-fb45-4f71-878c-3106510ade78".to_string()),
            model_name: "mimo-v2-pro".to_string(),
            api_key: Some("test-key".to_string()),
            base_url: Some("https://token-plan-cn.xiaomimimo.com/anthropic".to_string()),
            credential_uuid: "test-uuid".to_string(),
            force_responses_api: false,
            toolshim: false,
            toolshim_model: None,
        };

        assert!(should_disable_provider_default_fast_model(&config));
    }

    #[test]
    fn test_should_keep_provider_default_fast_model_for_first_party_anthropic() {
        let config = AsterProviderConfig {
            provider_name: "anthropic".to_string(),
            provider_selector: Some("anthropic".to_string()),
            model_name: "claude-sonnet-4-5-20250929".to_string(),
            api_key: Some("test-key".to_string()),
            base_url: Some("https://api.anthropic.com".to_string()),
            credential_uuid: "test-uuid".to_string(),
            force_responses_api: false,
            toolshim: false,
            toolshim_model: None,
        };

        assert!(!should_disable_provider_default_fast_model(&config));
    }

    #[test]
    fn test_split_url_host_and_path() {
        // 无路径
        let (host, path) = split_url_host_and_path("https://api.openai.com");
        assert_eq!(host, "https://api.openai.com");
        assert_eq!(path, "");

        // 带路径（智谱）
        let (host, path) = split_url_host_and_path("https://open.bigmodel.cn/api/paas/v4");
        assert_eq!(host, "https://open.bigmodel.cn");
        assert_eq!(path, "api/paas/v4");

        // 带端口
        let (host, path) = split_url_host_and_path("https://localhost:8080/v1");
        assert_eq!(host, "https://localhost:8080");
        assert_eq!(path, "v1");

        // 尾部斜杠
        let (host, path) = split_url_host_and_path("https://api.deepseek.com/v1/");
        assert_eq!(host, "https://api.deepseek.com");
        assert_eq!(path, "v1");

        // 仅根路径
        let (host, path) = split_url_host_and_path("https://api.openai.com/");
        assert_eq!(host, "https://api.openai.com");
        assert_eq!(path, "");
    }

    #[test]
    fn test_set_provider_env_vars_anthropic_sets_host_and_base_url() {
        std::env::remove_var("ANTHROPIC_API_KEY");
        std::env::remove_var("ANTHROPIC_AUTH_TOKEN");

        let config = AsterProviderConfig {
            provider_name: "anthropic".to_string(),
            provider_selector: Some("anthropic".to_string()),
            model_name: "glm-4.7".to_string(),
            api_key: Some("test-key".to_string()),
            base_url: Some("https://open.bigmodel.cn/api/anthropic".to_string()),
            credential_uuid: "test-uuid".to_string(),
            force_responses_api: false,
            toolshim: false,
            toolshim_model: None,
        };

        set_provider_env_vars(&config);

        assert_eq!(
            std::env::var("ANTHROPIC_HOST").ok().as_deref(),
            Some("https://open.bigmodel.cn/api/anthropic")
        );
        assert_eq!(
            std::env::var("ANTHROPIC_BASE_URL").ok().as_deref(),
            Some("https://open.bigmodel.cn/api/anthropic")
        );
        assert_eq!(
            std::env::var("ANTHROPIC_AUTH_TOKEN").ok().as_deref(),
            Some("test-key")
        );
        assert!(std::env::var("ANTHROPIC_API_KEY").is_err());
    }

    #[test]
    fn test_set_provider_env_vars_official_anthropic_keeps_api_key_env() {
        std::env::remove_var("ANTHROPIC_API_KEY");
        std::env::remove_var("ANTHROPIC_AUTH_TOKEN");

        let config = AsterProviderConfig {
            provider_name: "anthropic".to_string(),
            provider_selector: Some("anthropic".to_string()),
            model_name: "claude-sonnet-4-5".to_string(),
            api_key: Some("official-key".to_string()),
            base_url: Some("https://api.anthropic.com".to_string()),
            credential_uuid: "test-uuid".to_string(),
            force_responses_api: false,
            toolshim: false,
            toolshim_model: None,
        };

        set_provider_env_vars(&config);

        assert_eq!(
            std::env::var("ANTHROPIC_API_KEY").ok().as_deref(),
            Some("official-key")
        );
        assert!(std::env::var("ANTHROPIC_AUTH_TOKEN").is_err());
    }

    #[test]
    fn test_build_provider_model_config_applies_toolshim_override() {
        let config = AsterProviderConfig {
            provider_name: "openai".to_string(),
            provider_selector: Some("ollama".to_string()),
            model_name: "deepseek-r1:latest".to_string(),
            api_key: None,
            base_url: Some("http://127.0.0.1:11434".to_string()),
            credential_uuid: "test-uuid".to_string(),
            force_responses_api: false,
            toolshim: true,
            toolshim_model: Some("glm-5.1:cloud".to_string()),
        };

        let model_config = build_provider_model_config(&config).expect("build model config");

        assert!(model_config.toolshim);
        assert_eq!(
            model_config.toolshim_model.as_deref(),
            Some("glm-5.1:cloud")
        );
    }
}
