//! 配置导出服务
//!
//! 提供配置导出功能，支持：
//! - 仅配置导出（YAML 格式）
//! - 敏感信息脱敏

use super::types::Config;
use super::yaml::{ConfigError, ConfigManager};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 导出选项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportOptions {
    /// 是否包含配置
    pub include_config: bool,
    /// 是否包含凭证
    pub include_credentials: bool,
    /// 是否脱敏敏感信息
    pub redact_secrets: bool,
}

impl Default for ExportOptions {
    fn default() -> Self {
        Self {
            include_config: true,
            include_credentials: true,
            redact_secrets: false,
        }
    }
}

#[allow(dead_code)]
impl ExportOptions {
    /// 创建仅配置导出选项
    pub fn config_only() -> Self {
        Self {
            include_config: true,
            include_credentials: false,
            redact_secrets: false,
        }
    }

    /// 创建旧凭证导出选项；旧 OAuth token 已退役，导出包不会再写入 token 文件。
    pub fn credentials_only() -> Self {
        Self {
            include_config: false,
            include_credentials: true,
            redact_secrets: false,
        }
    }

    /// 创建完整导出选项
    pub fn full() -> Self {
        Self {
            include_config: true,
            include_credentials: true,
            redact_secrets: false,
        }
    }

    /// 创建脱敏导出选项
    pub fn redacted() -> Self {
        Self {
            include_config: true,
            include_credentials: true,
            redact_secrets: true,
        }
    }
}

/// 导出包
///
/// 包含配置和凭证的统一导出格式
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportBundle {
    /// 导出格式版本号
    pub version: String,
    /// 导出时间
    pub exported_at: DateTime<Utc>,
    /// 应用版本
    pub app_version: String,
    /// YAML 配置内容（如果包含配置）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config_yaml: Option<String>,
    /// 旧 OAuth Token 文件（base64 编码），仅用于读取历史导出包结构。
    /// key: 相对于 auth_dir 的路径
    /// value: base64 编码的文件内容
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub token_files: HashMap<String, String>,
    /// 是否已脱敏
    pub redacted: bool,
}

#[allow(dead_code)]
impl ExportBundle {
    /// 当前导出格式版本
    pub const CURRENT_VERSION: &'static str = "1.0";

    /// 创建新的导出包
    pub fn new(app_version: &str) -> Self {
        Self {
            version: Self::CURRENT_VERSION.to_string(),
            exported_at: Utc::now(),
            app_version: app_version.to_string(),
            config_yaml: None,
            token_files: HashMap::new(),
            redacted: false,
        }
    }

    /// 检查是否包含配置
    pub fn has_config(&self) -> bool {
        self.config_yaml.is_some()
    }

    /// 检查是否包含凭证
    pub fn has_credentials(&self) -> bool {
        !self.token_files.is_empty()
    }

    /// 检查是否已脱敏
    pub fn is_redacted(&self) -> bool {
        self.redacted
    }

    /// 序列化为 JSON 字符串
    pub fn to_json(&self) -> Result<String, ExportError> {
        serde_json::to_string_pretty(self).map_err(|e| ExportError::SerializeError(e.to_string()))
    }

    /// 从 JSON 字符串反序列化
    pub fn from_json(json: &str) -> Result<Self, ExportError> {
        serde_json::from_str(json).map_err(|e| ExportError::ParseError(e.to_string()))
    }
}

/// 导出错误类型
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum ExportError {
    /// 配置错误
    ConfigError(String),
    /// 文件读取错误
    ReadError(String),
    /// 序列化错误
    SerializeError(String),
    /// 解析错误
    ParseError(String),
    /// Token 文件不存在
    TokenFileNotFound(String),
}

impl std::fmt::Display for ExportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ExportError::ConfigError(msg) => write!(f, "配置错误: {msg}"),
            ExportError::ReadError(msg) => write!(f, "文件读取错误: {msg}"),
            ExportError::SerializeError(msg) => write!(f, "序列化错误: {msg}"),
            ExportError::ParseError(msg) => write!(f, "解析错误: {msg}"),
            ExportError::TokenFileNotFound(path) => write!(f, "Token 文件不存在: {path}"),
        }
    }
}

impl std::error::Error for ExportError {}

impl From<ConfigError> for ExportError {
    fn from(err: ConfigError) -> Self {
        ExportError::ConfigError(err.to_string())
    }
}

/// 脱敏占位符
pub const REDACTED_PLACEHOLDER: &str = "***REDACTED***";

/// 导出服务
///
/// 提供配置和凭证的统一导出功能
pub struct ExportService;

#[allow(dead_code)]
impl ExportService {
    /// 导出配置为 YAML 字符串
    ///
    /// # Arguments
    /// * `config` - 要导出的配置
    /// * `redact` - 是否脱敏敏感信息
    ///
    /// # Returns
    /// * `Ok(String)` - YAML 格式的配置字符串
    /// * `Err(ExportError)` - 导出失败
    pub fn export_yaml(config: &Config, redact: bool) -> Result<String, ExportError> {
        let mut config_to_export = if redact {
            Self::redact_config(config)
        } else {
            config.clone()
        };
        config_to_export.credential_pool = Default::default();

        ConfigManager::to_yaml(&config_to_export).map_err(ExportError::from)
    }

    /// 导出完整的配置和凭证包
    ///
    /// # Arguments
    /// * `config` - 要导出的配置
    /// * `options` - 导出选项
    /// * `app_version` - 应用版本
    ///
    /// # Returns
    /// * `Ok(ExportBundle)` - 导出包
    /// * `Err(ExportError)` - 导出失败
    pub fn export(
        config: &Config,
        options: &ExportOptions,
        app_version: &str,
    ) -> Result<ExportBundle, ExportError> {
        let mut bundle = ExportBundle::new(app_version);
        bundle.redacted = options.redact_secrets;

        // 导出配置
        if options.include_config {
            let yaml = Self::export_yaml(config, options.redact_secrets)?;
            bundle.config_yaml = Some(yaml);
        }

        // 旧 OAuth token 文件已随凭证池退役，不再导出。
        let _ = options.include_credentials;
        Ok(bundle)
    }

    /// 脱敏配置
    ///
    /// 将配置中的敏感信息替换为占位符
    pub fn redact_config(config: &Config) -> Config {
        let mut redacted = config.clone();

        // 脱敏服务器 API 密钥
        redacted.server.api_key = REDACTED_PLACEHOLDER.to_string();

        // 脱敏 Provider API 密钥
        if redacted.providers.openai.api_key.is_some() {
            redacted.providers.openai.api_key = Some(REDACTED_PLACEHOLDER.to_string());
        }
        if redacted.providers.claude.api_key.is_some() {
            redacted.providers.claude.api_key = Some(REDACTED_PLACEHOLDER.to_string());
        }

        // 旧凭证池不再导出。
        redacted.credential_pool = Default::default();

        redacted
    }

    /// 检查配置是否包含敏感信息
    ///
    /// 用于验证脱敏是否完整
    pub fn contains_secrets(config: &Config) -> bool {
        // 检查服务器 API 密钥
        if !config.server.api_key.is_empty() && config.server.api_key != REDACTED_PLACEHOLDER {
            return true;
        }

        // 检查 Provider API 密钥
        if let Some(ref key) = config.providers.openai.api_key {
            if !key.is_empty() && key != REDACTED_PLACEHOLDER {
                return true;
            }
        }
        if let Some(ref key) = config.providers.claude.api_key {
            if !key.is_empty() && key != REDACTED_PLACEHOLDER {
                return true;
            }
        }

        false
    }

    /// 检查 YAML 字符串是否包含敏感信息
    pub fn yaml_contains_secrets(yaml: &str) -> bool {
        // 检查是否包含看起来像 API 密钥的模式
        let secret_patterns = [
            "sk-",      // OpenAI API key prefix
            "sk-ant-",  // Anthropic API key prefix
            "api_key:", // API key field (if not redacted)
        ];

        for pattern in &secret_patterns {
            if yaml.contains(pattern) && !yaml.contains(REDACTED_PLACEHOLDER) {
                // 进一步检查是否是实际的密钥值
                for line in yaml.lines() {
                    if line.contains(pattern) && !line.contains(REDACTED_PLACEHOLDER) {
                        // 排除注释行
                        let trimmed = line.trim();
                        if !trimmed.starts_with('#') {
                            return true;
                        }
                    }
                }
            }
        }

        false
    }
}

#[cfg(test)]
mod unit_tests {
    use super::*;
    use crate::config::ApiKeyEntry;

    #[test]
    fn test_export_options_default() {
        let options = ExportOptions::default();
        assert!(options.include_config);
        assert!(options.include_credentials);
        assert!(!options.redact_secrets);
    }

    #[test]
    fn test_export_options_config_only() {
        let options = ExportOptions::config_only();
        assert!(options.include_config);
        assert!(!options.include_credentials);
        assert!(!options.redact_secrets);
    }

    #[test]
    fn test_export_options_credentials_only() {
        let options = ExportOptions::credentials_only();
        assert!(!options.include_config);
        assert!(options.include_credentials);
        assert!(!options.redact_secrets);
    }

    #[test]
    fn test_export_options_full() {
        let options = ExportOptions::full();
        assert!(options.include_config);
        assert!(options.include_credentials);
        assert!(!options.redact_secrets);
    }

    #[test]
    fn test_export_options_redacted() {
        let options = ExportOptions::redacted();
        assert!(options.include_config);
        assert!(options.include_credentials);
        assert!(options.redact_secrets);
    }

    #[test]
    fn test_export_bundle_new() {
        let bundle = ExportBundle::new("1.0.0");
        assert_eq!(bundle.version, ExportBundle::CURRENT_VERSION);
        assert_eq!(bundle.app_version, "1.0.0");
        assert!(!bundle.redacted);
        assert!(bundle.config_yaml.is_none());
        assert!(bundle.token_files.is_empty());
    }

    #[test]
    fn test_export_bundle_has_config() {
        let mut bundle = ExportBundle::new("1.0.0");
        assert!(!bundle.has_config());

        bundle.config_yaml = Some("server:\n  port: 8999".to_string());
        assert!(bundle.has_config());
    }

    #[test]
    fn test_export_bundle_has_credentials() {
        let mut bundle = ExportBundle::new("1.0.0");
        assert!(!bundle.has_credentials());

        bundle
            .token_files
            .insert("kiro/token.json".to_string(), "base64data".to_string());
        assert!(bundle.has_credentials());
    }

    #[test]
    fn test_export_bundle_json_roundtrip() {
        let mut bundle = ExportBundle::new("1.0.0");
        bundle.config_yaml = Some("server:\n  port: 8999".to_string());
        bundle
            .token_files
            .insert("kiro/token.json".to_string(), "dGVzdA==".to_string());
        bundle.redacted = true;

        let json = bundle.to_json().expect("序列化应成功");
        let parsed = ExportBundle::from_json(&json).expect("反序列化应成功");

        assert_eq!(parsed.version, bundle.version);
        assert_eq!(parsed.app_version, bundle.app_version);
        assert_eq!(parsed.config_yaml, bundle.config_yaml);
        assert_eq!(parsed.token_files, bundle.token_files);
        assert_eq!(parsed.redacted, bundle.redacted);
    }

    #[test]
    fn test_export_yaml_without_redaction() {
        let config = Config::default();
        let yaml = ExportService::export_yaml(&config, false).expect("导出应成功");

        assert!(yaml.contains("server:"));
        assert!(yaml.contains("port: 8999"));
        assert!(yaml.contains("api_key: proxy_cast"));
    }

    #[test]
    fn test_export_yaml_with_redaction() {
        let mut config = Config::default();
        config.server.api_key = "secret-key".to_string();
        config.providers.openai.api_key = Some("sk-openai-secret".to_string());

        let yaml = ExportService::export_yaml(&config, true).expect("导出应成功");

        assert!(yaml.contains(REDACTED_PLACEHOLDER));
        assert!(!yaml.contains("secret-key"));
        assert!(!yaml.contains("sk-openai-secret"));
    }

    #[test]
    fn test_redact_config() {
        let mut config = Config::default();
        config.server.api_key = "secret-key".to_string();
        config.providers.openai.api_key = Some("sk-openai-secret".to_string());
        config.providers.claude.api_key = Some("sk-ant-claude-secret".to_string());
        config.credential_pool.openai.push(ApiKeyEntry {
            id: "openai-1".to_string(),
            api_key: "sk-pool-key".to_string(),
            base_url: None,
            disabled: false,
            proxy_url: None,
        });

        let redacted = ExportService::redact_config(&config);

        assert_eq!(redacted.server.api_key, REDACTED_PLACEHOLDER);
        assert_eq!(
            redacted.providers.openai.api_key,
            Some(REDACTED_PLACEHOLDER.to_string())
        );
        assert_eq!(
            redacted.providers.claude.api_key,
            Some(REDACTED_PLACEHOLDER.to_string())
        );
        assert!(redacted.credential_pool.is_empty());
    }

    #[test]
    fn test_contains_secrets() {
        let mut config = Config::default();
        config.server.api_key = "secret-key".to_string();

        assert!(ExportService::contains_secrets(&config));

        let redacted = ExportService::redact_config(&config);
        assert!(!ExportService::contains_secrets(&redacted));
    }

    #[test]
    fn test_contains_secrets_ignores_retired_credential_pool() {
        let mut config = Config::default();
        config.server.api_key = REDACTED_PLACEHOLDER.to_string();
        config.credential_pool.openai.push(ApiKeyEntry {
            id: "openai-1".to_string(),
            api_key: "sk-real-key".to_string(),
            base_url: None,
            disabled: false,
            proxy_url: None,
        });

        assert!(!ExportService::contains_secrets(&config));
    }

    #[test]
    fn test_export_config_only() {
        let config = Config::default();
        let options = ExportOptions::config_only();

        let bundle = ExportService::export(&config, &options, "1.0.0").expect("导出应成功");

        assert!(bundle.has_config());
        assert!(!bundle.has_credentials());
        assert!(!bundle.redacted);
    }

    #[test]
    fn test_export_credentials_only() {
        let config = Config::default();
        let options = ExportOptions::credentials_only();

        let bundle = ExportService::export(&config, &options, "1.0.0").expect("导出应成功");

        assert!(!bundle.has_config());
        // 默认配置没有凭证，所以 token_files 为空
        assert!(!bundle.has_credentials());
    }

    #[test]
    fn test_export_error_display() {
        let err = ExportError::ConfigError("test error".to_string());
        assert!(err.to_string().contains("配置错误"));
        assert!(err.to_string().contains("test error"));

        let err = ExportError::TokenFileNotFound("/path/to/token.json".to_string());
        assert!(err.to_string().contains("Token 文件不存在"));
    }
}
