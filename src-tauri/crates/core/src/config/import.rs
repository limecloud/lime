//! 配置导入服务
//!
//! 提供配置导入功能，支持：
//! - YAML 配置导入
//! - 旧完整导入包中的配置读取

#![allow(dead_code)]
//! - 导入验证（格式、版本、脱敏状态）
//! - 合并和替换模式

use super::export::{ExportBundle, REDACTED_PLACEHOLDER};
use super::types::Config;
use super::yaml::{ConfigError, ConfigManager, YamlService};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// 导入选项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportOptions {
    /// 是否合并（false 则替换）
    pub merge: bool,
}

impl Default for ImportOptions {
    fn default() -> Self {
        Self { merge: true }
    }
}

impl ImportOptions {
    /// 创建合并模式选项
    pub fn merge() -> Self {
        Self { merge: true }
    }

    /// 创建替换模式选项
    pub fn replace() -> Self {
        Self { merge: false }
    }
}

/// 验证结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationResult {
    /// 是否有效
    pub valid: bool,
    /// 格式版本
    pub version: Option<String>,
    /// 是否已脱敏
    pub redacted: bool,
    /// 是否包含配置
    pub has_config: bool,
    /// 是否包含凭证
    pub has_credentials: bool,
    /// 错误信息列表
    pub errors: Vec<String>,
    /// 警告信息列表
    pub warnings: Vec<String>,
}

impl ValidationResult {
    /// 创建有效的验证结果
    pub fn valid() -> Self {
        Self {
            valid: true,
            version: None,
            redacted: false,
            has_config: false,
            has_credentials: false,
            errors: Vec::new(),
            warnings: Vec::new(),
        }
    }

    /// 创建无效的验证结果
    pub fn invalid(error: impl Into<String>) -> Self {
        Self {
            valid: false,
            version: None,
            redacted: false,
            has_config: false,
            has_credentials: false,
            errors: vec![error.into()],
            warnings: Vec::new(),
        }
    }

    /// 添加错误
    pub fn add_error(&mut self, error: impl Into<String>) {
        self.errors.push(error.into());
        self.valid = false;
    }

    /// 添加警告
    pub fn add_warning(&mut self, warning: impl Into<String>) {
        self.warnings.push(warning.into());
    }
}

/// 导入结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportResult {
    /// 是否成功
    pub success: bool,
    /// 警告信息
    pub warnings: Vec<String>,
    /// 导入的配置
    pub config: Config,
}

impl ImportResult {
    /// 创建成功的导入结果
    pub fn success(config: Config) -> Self {
        Self {
            success: true,
            warnings: Vec::new(),
            config,
        }
    }

    /// 创建带警告的成功导入结果
    pub fn success_with_warnings(config: Config, warnings: Vec<String>) -> Self {
        Self {
            success: true,
            warnings,
            config,
        }
    }
}

/// 导入错误类型
#[derive(Debug, Clone)]
#[allow(clippy::enum_variant_names)]
pub enum ImportError {
    /// 格式错误
    FormatError(String),
    /// 版本不兼容
    VersionError(String),
    /// 配置错误
    ConfigError(String),
    /// IO 错误
    IoError(String),
    /// 验证错误
    ValidationError(String),
    /// 脱敏数据无法导入
    RedactedDataError(String),
}

impl std::fmt::Display for ImportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ImportError::FormatError(msg) => write!(f, "格式错误: {msg}"),
            ImportError::VersionError(msg) => write!(f, "版本不兼容: {msg}"),
            ImportError::ConfigError(msg) => write!(f, "配置错误: {msg}"),
            ImportError::IoError(msg) => write!(f, "IO 错误: {msg}"),
            ImportError::ValidationError(msg) => write!(f, "验证错误: {msg}"),
            ImportError::RedactedDataError(msg) => write!(f, "脱敏数据无法导入: {msg}"),
        }
    }
}

impl std::error::Error for ImportError {}

impl From<ConfigError> for ImportError {
    fn from(err: ConfigError) -> Self {
        ImportError::ConfigError(err.to_string())
    }
}

impl From<std::io::Error> for ImportError {
    fn from(err: std::io::Error) -> Self {
        ImportError::IoError(err.to_string())
    }
}

/// 导入服务
///
/// 提供配置和凭证的统一导入功能
pub struct ImportService;

impl ImportService {
    /// 支持的导入格式版本
    pub const SUPPORTED_VERSIONS: &'static [&'static str] = &["1.0"];

    /// 验证导入内容
    ///
    /// # Arguments
    /// * `content` - 导入内容（JSON 格式的 ExportBundle 或 YAML 配置）
    ///
    /// # Returns
    /// * `ValidationResult` - 验证结果
    pub fn validate(content: &str) -> ValidationResult {
        // 首先尝试解析为 ExportBundle (JSON)
        if let Ok(bundle) = ExportBundle::from_json(content) {
            return Self::validate_bundle(&bundle);
        }

        // 尝试解析为 YAML 配置
        if let Ok(_config) = ConfigManager::parse_yaml(content) {
            let mut result = ValidationResult::valid();
            result.has_config = true;
            result.has_credentials = false;
            result.version = Some("yaml".to_string());
            return result;
        }

        ValidationResult::invalid(
            "无法解析导入内容：既不是有效的 JSON 导出包，也不是有效的 YAML 配置",
        )
    }

    /// 验证导出包
    fn validate_bundle(bundle: &ExportBundle) -> ValidationResult {
        let mut result = ValidationResult::valid();
        result.version = Some(bundle.version.clone());
        result.redacted = bundle.redacted;
        result.has_config = bundle.has_config();
        result.has_credentials = bundle.has_credentials();

        // 检查版本兼容性
        if !Self::SUPPORTED_VERSIONS.contains(&bundle.version.as_str()) {
            result.add_warning(format!(
                "导出包版本 {} 可能不完全兼容，支持的版本: {:?}",
                bundle.version,
                Self::SUPPORTED_VERSIONS
            ));
        }

        // 检查脱敏状态
        if bundle.redacted {
            result.add_warning("导出包已脱敏，凭证数据无法恢复");
        }

        // 验证配置内容（如果存在）
        if let Some(ref yaml) = bundle.config_yaml {
            if let Err(e) = ConfigManager::parse_yaml(yaml) {
                result.add_error(format!("配置 YAML 解析失败: {e}"));
            }
        }

        result
    }

    /// 导入 YAML 配置
    ///
    /// # Arguments
    /// * `yaml` - YAML 配置字符串
    /// * `current_config` - 当前配置（用于合并模式）
    /// * `options` - 导入选项
    ///
    /// # Returns
    /// * `Ok(ImportResult)` - 导入成功
    /// * `Err(ImportError)` - 导入失败
    pub fn import_yaml(
        yaml: &str,
        current_config: &Config,
        options: &ImportOptions,
    ) -> Result<ImportResult, ImportError> {
        // 解析 YAML
        let mut imported_config = ConfigManager::parse_yaml(yaml)?;
        Self::drop_legacy_credential_pool(&mut imported_config);

        // 根据选项合并或替换
        let final_config = if options.merge {
            Self::merge_configs(current_config, &imported_config)
        } else {
            imported_config
        };

        Ok(ImportResult::success(final_config))
    }

    /// 导入完整的导出包
    ///
    /// # Arguments
    /// * `bundle` - 导出包
    /// * `current_config` - 当前配置（用于合并模式）
    /// * `options` - 导入选项
    /// * `_auth_dir` - 旧导入包兼容参数；OAuth token 文件不再恢复
    ///
    /// # Returns
    /// * `Ok(ImportResult)` - 导入成功
    /// * `Err(ImportError)` - 导入失败
    pub fn import(
        bundle: &ExportBundle,
        current_config: &Config,
        options: &ImportOptions,
        _auth_dir: &str,
    ) -> Result<ImportResult, ImportError> {
        let mut warnings = Vec::new();

        // 检查脱敏状态
        if bundle.redacted {
            warnings.push("导出包已脱敏，凭证数据将使用占位符".to_string());
        }

        // 导入配置
        let mut config = if let Some(ref yaml) = bundle.config_yaml {
            let mut imported = ConfigManager::parse_yaml(yaml)?;
            Self::drop_legacy_credential_pool(&mut imported);
            if options.merge {
                Self::merge_configs(current_config, &imported)
            } else {
                imported
            }
        } else if options.merge {
            current_config.clone()
        } else {
            Config::default()
        };

        // 旧 OAuth token 文件已随凭证池退役，导入时不再恢复到本地。
        if !bundle.token_files.is_empty() {
            warnings.push(
                "导入包包含旧 OAuth token 文件，已忽略；请改用 API Key Provider。".to_string(),
            );
        }
        Self::drop_legacy_credential_pool(&mut config);

        // 如果是脱敏数据，清理当前配置中的占位符
        if bundle.redacted {
            let server_key_cleared = Self::clean_redacted_credentials(&mut config);
            if server_key_cleared {
                warnings.push("检测到脱敏的服务器 API Key，已清空，需要手动设置".to_string());
            }
        }

        Ok(ImportResult::success_with_warnings(config, warnings))
    }

    /// 合并配置
    ///
    /// 将导入的配置合并到当前配置中
    fn merge_configs(current: &Config, imported: &Config) -> Config {
        let mut merged = current.clone();

        // 合并服务器配置（导入的覆盖当前的）
        merged.server = imported.server.clone();

        // 合并 Provider 配置
        merged.providers = imported.providers.clone();

        // 合并路由配置
        merged.routing = imported.routing.clone();
        merged.default_provider = imported.default_provider.clone();

        // 合并重试配置
        merged.retry = imported.retry.clone();

        // 合并日志配置
        merged.logging = imported.logging.clone();

        // 合并注入配置
        merged.injection = imported.injection.clone();

        // 合并 auth_dir
        merged.auth_dir = imported.auth_dir.clone();

        // 旧凭证池不再导入或合并；ASR 凭证跟随 voice_input 配置。
        Self::drop_legacy_credential_pool(&mut merged);
        merged.experimental.voice_input.asr_credentials =
            imported.experimental.voice_input.asr_credentials.clone();

        merged
    }

    fn drop_legacy_credential_pool(config: &mut Config) {
        config.credential_pool = Default::default();
    }

    /// 清理脱敏的当前配置数据
    fn clean_redacted_credentials(config: &mut Config) -> bool {
        let mut server_key_cleared = false;

        // 清理 Provider 配置中的脱敏 API 密钥
        if config.providers.openai.api_key.as_deref() == Some(REDACTED_PLACEHOLDER) {
            config.providers.openai.api_key = None;
        }
        if config.providers.claude.api_key.as_deref() == Some(REDACTED_PLACEHOLDER) {
            config.providers.claude.api_key = None;
        }

        // 清理服务器 API 密钥（如果是脱敏的，清空并提示手动设置）
        if config.server.api_key == REDACTED_PLACEHOLDER {
            config.server.api_key = String::new();
            server_key_cleared = true;
        }

        server_key_cleared
    }

    /// 从文件导入配置
    ///
    /// # Arguments
    /// * `path` - 文件路径
    /// * `current_config` - 当前配置
    /// * `options` - 导入选项
    ///
    /// # Returns
    /// * `Ok(ImportResult)` - 导入成功
    /// * `Err(ImportError)` - 导入失败
    pub fn import_from_file(
        path: &Path,
        current_config: &Config,
        options: &ImportOptions,
    ) -> Result<ImportResult, ImportError> {
        let content = std::fs::read_to_string(path)?;

        // 首先尝试解析为 ExportBundle
        if let Ok(bundle) = ExportBundle::from_json(&content) {
            return Self::import(&bundle, current_config, options, &current_config.auth_dir);
        }

        // 尝试解析为 YAML
        Self::import_yaml(&content, current_config, options)
    }

    /// 保存导入的配置到文件
    ///
    /// # Arguments
    /// * `config` - 要保存的配置
    /// * `path` - 配置文件路径
    ///
    /// # Returns
    /// * `Ok(())` - 保存成功
    /// * `Err(ImportError)` - 保存失败
    pub fn save_config(config: &Config, path: &Path) -> Result<(), ImportError> {
        YamlService::save_preserve_comments(path, config)?;
        Ok(())
    }
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn test_import_options_default() {
        let options = ImportOptions::default();
        assert!(options.merge);
    }

    #[test]
    fn test_import_options_merge() {
        let options = ImportOptions::merge();
        assert!(options.merge);
    }

    #[test]
    fn test_import_options_replace() {
        let options = ImportOptions::replace();
        assert!(!options.merge);
    }

    #[test]
    fn test_validation_result_valid() {
        let result = ValidationResult::valid();
        assert!(result.valid);
        assert!(result.errors.is_empty());
        assert!(result.warnings.is_empty());
    }

    #[test]
    fn test_validation_result_invalid() {
        let result = ValidationResult::invalid("test error");
        assert!(!result.valid);
        assert_eq!(result.errors.len(), 1);
        assert!(result.errors[0].contains("test error"));
    }

    #[test]
    fn test_validation_result_add_error() {
        let mut result = ValidationResult::valid();
        result.add_error("error 1");
        assert!(!result.valid);
        assert_eq!(result.errors.len(), 1);
    }

    #[test]
    fn test_validation_result_add_warning() {
        let mut result = ValidationResult::valid();
        result.add_warning("warning 1");
        assert!(result.valid); // 警告不影响有效性
        assert_eq!(result.warnings.len(), 1);
    }

    #[test]
    fn test_validate_valid_yaml() {
        let yaml = r#"
server:
  host: 127.0.0.1
  port: 8999
  api_key: test_key
"#;
        let result = ImportService::validate(yaml);
        assert!(result.valid);
        assert!(result.has_config);
        assert!(!result.has_credentials);
    }

    #[test]
    fn test_validate_invalid_content() {
        let content = "this is not valid yaml or json {{{";
        let result = ImportService::validate(content);
        assert!(!result.valid);
        assert!(!result.errors.is_empty());
    }

    #[test]
    fn test_validate_export_bundle() {
        let bundle = ExportBundle::new("1.0.0");
        let json = bundle.to_json().expect("序列化应成功");
        let result = ImportService::validate(&json);
        assert!(result.valid);
        assert_eq!(result.version, Some("1.0".to_string()));
    }

    #[test]
    fn test_validate_redacted_bundle() {
        let mut bundle = ExportBundle::new("1.0.0");
        bundle.redacted = true;
        let json = bundle.to_json().expect("序列化应成功");
        let result = ImportService::validate(&json);
        assert!(result.valid);
        assert!(result.redacted);
        assert!(!result.warnings.is_empty()); // 应有脱敏警告
    }

    #[test]
    fn test_import_yaml_replace_mode() {
        let current = Config::default();
        let yaml = r#"
server:
  host: 127.0.0.1
  port: 9000
  api_key: new_key
"#;
        let options = ImportOptions::replace();
        let result = ImportService::import_yaml(yaml, &current, &options).expect("导入应成功");

        assert!(result.success);
        assert_eq!(result.config.server.host, "127.0.0.1");
        assert_eq!(result.config.server.port, 9000);
        assert_eq!(result.config.server.api_key, "new_key");
    }

    #[test]
    fn test_import_yaml_merge_mode() {
        let current = Config::default();

        let yaml = r#"
server:
  host: 127.0.0.1
  port: 9000
  api_key: new_key
credential_pool:
  openai:
    - id: new
      api_key: sk-new
"#;
        let options = ImportOptions::merge();
        let result = ImportService::import_yaml(yaml, &current, &options).expect("导入应成功");

        assert!(result.success);
        // 服务器配置应被更新
        assert_eq!(result.config.server.host, "127.0.0.1");
        // 旧凭证池不再导入或合并
        assert!(result.config.credential_pool.is_empty());
    }

    #[test]
    fn test_clean_redacted_credentials() {
        let mut config = Config::default();
        config.server.api_key = REDACTED_PLACEHOLDER.to_string();
        config.providers.openai.api_key = Some(REDACTED_PLACEHOLDER.to_string());

        let server_key_cleared = ImportService::clean_redacted_credentials(&mut config);

        // 服务器 API 密钥应被清空并提示手动设置
        assert!(server_key_cleared);
        assert_eq!(config.server.api_key, "");
        // Provider API 密钥应被清除
        assert!(config.providers.openai.api_key.is_none());
    }

    #[test]
    fn test_import_error_display() {
        let err = ImportError::FormatError("test".to_string());
        assert!(err.to_string().contains("格式错误"));

        let err = ImportError::VersionError("test".to_string());
        assert!(err.to_string().contains("版本不兼容"));

        let err = ImportError::RedactedDataError("test".to_string());
        assert!(err.to_string().contains("脱敏数据"));
    }
}
