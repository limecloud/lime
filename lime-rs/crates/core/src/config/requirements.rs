//! 独立于用户、项目和会话配置的系统管理员约束。

use super::{ApprovalPolicy, BrowserUseRequirementsToml, Config, ConfigError, InAppBrowserRequirementsToml, SandboxMode};
use agent_protocol::WebSearchMode;
use serde::Deserialize;
use std::{io::Read, path::Path};

#[cfg(windows)]
mod windows;

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfigRequirements {
    pub allowed_approval_policies: Option<Vec<ApprovalPolicy>>,
    pub allowed_sandbox_modes: Option<Vec<SandboxMode>>,
    pub allowed_web_search_modes: Option<Vec<WebSearchMode>>,
    pub allow_browser_and_computer_use: Option<bool>,
    pub browser_use: Option<BrowserUseRequirementsToml>,
    pub in_app_browser: Option<InAppBrowserRequirementsToml>,
}

impl ConfigRequirements {
    pub fn is_empty(&self) -> bool {
        self.allowed_approval_policies.is_none()
            && self.allowed_sandbox_modes.is_none()
            && self.allowed_web_search_modes.is_none()
            && self.allow_browser_and_computer_use.is_none()
            && self.browser_use.as_ref().is_none_or(BrowserUseRequirementsToml::is_empty)
            && self
                .in_app_browser
                .as_ref()
                .is_none_or(|requirements| requirements == &InAppBrowserRequirementsToml::default())
    }

    pub fn read(path: &Path) -> Result<Option<Self>, ConfigError> {
        let file = match std::fs::File::open(path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(ConfigError::ReadError(error.to_string())),
        };
        let mut source = String::new();
        file.take(1024 * 1024 + 1)
            .read_to_string(&mut source)
            .map_err(|error| ConfigError::ReadError(error.to_string()))?;
        if source.len() > 1024 * 1024 {
            return Err(invalid("requirements.toml exceeds 1 MiB"));
        }
        Self::parse(&source).map(Some)
    }

    pub fn parse(source: &str) -> Result<Self, ConfigError> {
        let mut requirements: Self = toml_edit::de::from_str(source)
            .map_err(|error| ConfigError::ParseError(format!("requirements.toml: {error}")))?;
        if requirements
            .allowed_approval_policies
            .as_ref()
            .is_some_and(Vec::is_empty)
            || requirements
                .allowed_sandbox_modes
                .as_ref()
                .is_some_and(Vec::is_empty)
        {
            return Err(invalid(
                "Admin approval and sandbox requirements must allow at least one value",
            ));
        }
        // 关闭网页搜索始终可用，与参考 requirements/read 的归一化合同一致。
        if let Some(origins) = requirements.browser_use.as_ref().and_then(|browser| browser.origins.as_ref()) {
            for pattern in origins.keys() {
                #[derive(Deserialize)]
                struct Origin(#[serde(deserialize_with = "super::browser::deserialize_site_pattern")] String);
                let origin: Origin = serde_json::from_value(serde_json::Value::String(pattern.clone()))
                    .map_err(|_| invalid("Invalid managed browser_use origin"))?;
                let _ = origin.0;
            }
        }
        if let Some(modes) = requirements.allowed_web_search_modes.as_mut() {
            if !modes.contains(&WebSearchMode::Disabled) {
                modes.push(WebSearchMode::Disabled);
            }
        }
        Ok(requirements)
    }

    pub fn check_approval(&self, value: ApprovalPolicy) -> Result<(), ConfigError> {
        allowed(
            self.allowed_approval_policies.as_deref(),
            value,
            "approval_policy",
        )
    }

    pub fn check_sandbox(&self, value: SandboxMode) -> Result<(), ConfigError> {
        allowed(self.allowed_sandbox_modes.as_deref(), value, "sandbox_mode")
    }

    pub fn check_web_search(&self, value: WebSearchMode) -> Result<(), ConfigError> {
        allowed(
            self.allowed_web_search_modes.as_deref(),
            value,
            "web_search",
        )
    }

    /// 仅收敛继承默认值；显式请求必须由 check_* 拒绝，不能静默降级。
    pub fn constrain_defaults(&self, config: &mut Config) {
        if self.check_approval(config.approval_policy).is_err() {
            config.approval_policy = self.allowed_approval_policies.as_ref().unwrap()[0];
        }
        if self.check_sandbox(config.sandbox_mode).is_err() {
            config.sandbox_mode = self.allowed_sandbox_modes.as_ref().unwrap()[0];
        }
        let search = config
            .web_search
            .unwrap_or_else(|| WebSearchMode::for_sandbox(Some(config.sandbox_mode.as_str())));
        if self.check_web_search(search).is_err() {
            config.web_search = Some(WebSearchMode::Disabled);
        }
    }
}

fn allowed<T: PartialEq>(values: Option<&[T]>, value: T, key: &str) -> Result<(), ConfigError> {
    if values.is_some_and(|values| !values.contains(&value)) {
        return Err(invalid(format!("{key} is restricted by admin policy")));
    }
    Ok(())
}

fn invalid(message: impl Into<String>) -> ConfigError {
    ConfigError::ValidationError(message.into())
}

pub fn system_requirements_path() -> Result<std::path::PathBuf, ConfigError> {
    #[cfg(windows)]
    {
        windows::system_requirements_path()
    }
    #[cfg(not(windows))]
    {
        Ok("/etc/lime/requirements.toml".into())
    }
}

#[cfg(test)]
mod tests;
