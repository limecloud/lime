//! 系统强制设置的唯一读取入口；普通 defaults、环境和用户配置不提供管理员权限。

use super::{layers::PROJECT_DEFAULT_KEYS, requirements::ConfigRequirements, Config, ConfigError};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::Value;
use std::path::Path;

#[cfg(target_os = "macos")]
mod macos;

pub const PREFERENCES_DOMAIN: &str = "com.limecloud.lime";
pub const CONFIG_KEY: &str = "config_toml_base64";
pub const REQUIREMENTS_KEY: &str = "requirements_toml_base64";
const MAX_SOURCE_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone)]
pub struct ManagedConfig {
    pub config: Value,
    pub source: String,
}

impl ManagedConfig {
    /// 包含父路径和子路径，避免通过替换整个表绕过字段只读。
    pub fn contains_path(&self, segments: &[String]) -> bool {
        let mut value = &self.config;
        for segment in segments {
            let Some(object) = value.as_object() else {
                return true;
            };
            let Some(child) = object.get(segment) else {
                return false;
            };
            value = child;
        }
        true
    }
}

pub fn read_config() -> Result<Option<ManagedConfig>, ConfigError> {
    read_preference(CONFIG_KEY)?
        .map(|encoded| parse_config(&encoded))
        .transpose()
}

/// 优先级与参考 loader 一致：系统文件、旧式强制配置、独立强制 requirements。
pub fn read_requirements(system_file: &Path) -> Result<Option<ConfigRequirements>, ConfigError> {
    let system = ConfigRequirements::read(system_file)?;
    let config = read_config()?;
    let explicit = read_preference(REQUIREMENTS_KEY)?
        .map(|encoded| decode(&encoded).and_then(|source| ConfigRequirements::parse(&source)))
        .transpose()?;
    compose_requirements(system, config.as_ref(), explicit)
}

pub(super) fn compose_requirements(
    system: Option<ConfigRequirements>,
    config: Option<&ManagedConfig>,
    explicit: Option<ConfigRequirements>,
) -> Result<Option<ConfigRequirements>, ConfigError> {
    if system.is_none() && config.is_none() && explicit.is_none() {
        return Ok(None);
    }
    let mut result = system.unwrap_or_default();
    if let Some(config) = config {
        if let Some(value) = config.config.get("approval_policy") {
            result.allowed_approval_policies =
                Some(vec![serde_json::from_value(value.clone()).map_err(invalid)?]);
        }
        if let Some(value) = config.config.get("sandbox_mode") {
            result.allowed_sandbox_modes =
                Some(vec![serde_json::from_value(value.clone()).map_err(invalid)?]);
        }
    }
    if let Some(explicit) = explicit {
        if explicit.allowed_approval_policies.is_some() {
            result.allowed_approval_policies = explicit.allowed_approval_policies;
        }
        if explicit.allowed_sandbox_modes.is_some() {
            result.allowed_sandbox_modes = explicit.allowed_sandbox_modes;
        }
        if explicit.allowed_web_search_modes.is_some() {
            result.allowed_web_search_modes = explicit.allowed_web_search_modes;
        }
        if explicit.allow_browser_and_computer_use.is_some() {
            result.allow_browser_and_computer_use = explicit.allow_browser_and_computer_use;
        }
        if let Some(browser) = explicit.browser_use {
            let current = result.browser_use.get_or_insert_default();
            macro_rules! inherit {
                ($($field:ident),* $(,)?) => { $(if browser.$field.is_some() { current.$field = browser.$field; })* };
            }
            inherit!(
                allow_webmcp,
                allow_history_access,
                disable_auto_review,
                allow_global_persistent_approval
            );
            if let Some(extension) = browser.extension {
                if extension.request_headers.is_some() {
                    current.extension.get_or_insert_default().request_headers =
                        extension.request_headers;
                }
            }
            if let Some(default) = browser.default_origin_policy {
                merge_browser_origin(
                    current.default_origin_policy.get_or_insert_default(),
                    default,
                );
            }
            if let Some(origins) = browser.origins {
                let target = current.origins.get_or_insert_default();
                for (pattern, policy) in origins {
                    merge_browser_origin(target.entry(pattern).or_default(), policy);
                }
            }
        }
        if let Some(browser) = explicit.in_app_browser {
            let current = result.in_app_browser.get_or_insert_default();
            if browser.allow_external_browser_settings_import.is_some() {
                current.allow_external_browser_settings_import =
                    browser.allow_external_browser_settings_import;
            }
        }
    }
    Ok(Some(result).filter(|requirements| !requirements.is_empty()))
}

fn merge_browser_origin(
    target: &mut super::BrowserUseOriginPolicyToml,
    source: super::BrowserUseOriginPolicyToml,
) {
    macro_rules! inherit {
        ($($field:ident),* $(,)?) => { $(if source.$field.is_some() { target.$field = source.$field; })* };
    }
    inherit!(
        access,
        downloads,
        uploads,
        full_cdp_access,
        auto_review,
        persistent_approval,
        access_approval_lifetime
    );
}

fn parse_config(encoded: &str) -> Result<ManagedConfig, ConfigError> {
    let source = decode(encoded)?;
    let config: Value = toml_edit::de::from_str(&source).map_err(invalid)?;
    let object = config
        .as_object()
        .ok_or_else(|| invalid("Expected TOML table"))?;
    // 当前默认值消费者仅覆盖这些字段；拒绝未接线的策略，不能静默声称已管理。
    for key in object.keys() {
        if !PROJECT_DEFAULT_KEYS.contains(&key.as_str()) && key != "desktop" {
            return Err(invalid(format!("Unsupported managed setting: {key}")));
        }
    }
    if let Some(desktop) = config.get("desktop") {
        let desktop = desktop
            .as_object()
            .ok_or_else(|| invalid("Invalid desktop table"))?;
        if desktop.keys().any(|key| key != "enabled-reasoning-efforts") {
            return Err(invalid("Unsupported managed desktop setting"));
        }
    }
    let _: Config = serde_json::from_value(config.clone()).map_err(invalid)?;
    Ok(ManagedConfig { config, source })
}

fn decode(encoded: &str) -> Result<String, ConfigError> {
    if encoded.len() > MAX_SOURCE_BYTES.div_ceil(3) * 4 {
        return Err(invalid("Managed preference exceeds 1 MiB"));
    }
    let bytes = STANDARD.decode(encoded.trim()).map_err(invalid)?;
    if bytes.len() > MAX_SOURCE_BYTES {
        return Err(invalid("Managed preference exceeds 1 MiB"));
    }
    String::from_utf8(bytes).map_err(invalid)
}

fn read_preference(key: &str) -> Result<Option<String>, ConfigError> {
    #[cfg(target_os = "macos")]
    {
        macos::read(key)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = key;
        Ok(None)
    }
}

/// 两次 forced 检查之间只读取一次；撤销管理时不得接纳用户 defaults 回退。
fn read_forced<T>(
    mut is_forced: impl FnMut() -> bool,
    copy: impl FnOnce() -> Option<T>,
    string: impl FnOnce(T) -> Option<String>,
) -> Result<Option<String>, ConfigError> {
    if !is_forced() {
        return Ok(None);
    }
    let Some(value) = copy() else { return Ok(None) };
    if !is_forced() {
        return Ok(None);
    }
    string(value)
        .map(Some)
        .ok_or_else(|| invalid("Forced preference must be a base64 string"))
}

fn invalid(error: impl std::fmt::Display) -> ConfigError {
    ConfigError::ValidationError(format!("Managed preferences: {error}"))
}

#[cfg(test)]
mod tests;
