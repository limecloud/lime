//! Config current surface tool
//!
//! 对齐当前工具面：
//! - Config

use super::base::{PermissionCheckResult, Tool};
use super::context::{ToolContext, ToolResult};
use super::error::ToolError;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;

use crate::config::{AsterMode, Config, ConfigError};
use crate::model::ModelConfig;

const CONFIG_TOOL_NAME: &str = "Config";
const CONFIG_TOOL_DESCRIPTION: &str = "Get or set supported runtime configuration settings.";
const MODEL_SETTING_KEY: &str = "model";
const PERMISSION_MODE_SETTING_KEY: &str = "permissions.defaultMode";
const MODEL_DEFAULT_VALUE: &str = "default";
const PERMISSION_MODE_DEFAULT_VALUE: &str = "default";
const PERMISSION_MODE_ACCEPT_EDITS_VALUE: &str = "acceptEdits";
const PERMISSION_MODE_AUTO_VALUE: &str = "auto";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigToolInput {
    setting: String,
    #[serde(default)]
    value: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct ConfigToolOutput {
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    operation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    setting: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    previous_value: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    new_value: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl ConfigToolOutput {
    fn get_success(setting: impl Into<String>, value: Value) -> Self {
        Self {
            success: true,
            operation: Some("get".to_string()),
            setting: Some(setting.into()),
            value: Some(value),
            previous_value: None,
            new_value: None,
            error: None,
        }
    }

    fn set_success(setting: impl Into<String>, previous_value: Value, new_value: Value) -> Self {
        Self {
            success: true,
            operation: Some("set".to_string()),
            setting: Some(setting.into()),
            value: Some(new_value.clone()),
            previous_value: Some(previous_value),
            new_value: Some(new_value),
            error: None,
        }
    }

    fn failure(
        operation: &'static str,
        setting: impl Into<String>,
        error: impl Into<String>,
    ) -> Self {
        Self {
            success: false,
            operation: Some(operation.to_string()),
            setting: Some(setting.into()),
            value: None,
            previous_value: None,
            new_value: None,
            error: Some(error.into()),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SupportedSetting {
    Model,
    PermissionsDefaultMode,
}

impl SupportedSetting {
    fn parse(raw: &str) -> Option<Self> {
        match raw.trim() {
            MODEL_SETTING_KEY => Some(Self::Model),
            PERMISSION_MODE_SETTING_KEY => Some(Self::PermissionsDefaultMode),
            _ => None,
        }
    }

    fn key(self) -> &'static str {
        match self {
            Self::Model => MODEL_SETTING_KEY,
            Self::PermissionsDefaultMode => PERMISSION_MODE_SETTING_KEY,
        }
    }

    fn description(self) -> &'static str {
        match self {
            Self::Model => "Override the default runtime model. Use \"default\" to clear the override.",
            Self::PermissionsDefaultMode => {
                "Default permission mode for tool execution. Supported values in the current runtime: \"default\", \"acceptEdits\", \"auto\"."
            }
        }
    }

    fn read_value(self, config: &Config) -> Result<Value, ToolError> {
        match self {
            Self::Model => match config.get_aster_model() {
                Ok(model) => Ok(Value::String(model)),
                Err(ConfigError::NotFound(_)) => Ok(Value::String(MODEL_DEFAULT_VALUE.to_string())),
                Err(error) => Err(map_config_error("读取", self.key(), error)),
            },
            Self::PermissionsDefaultMode => match config.get_aster_mode() {
                Ok(AsterMode::Auto) => Ok(Value::String(PERMISSION_MODE_AUTO_VALUE.to_string())),
                Ok(AsterMode::SmartApprove) => Ok(Value::String(
                    PERMISSION_MODE_ACCEPT_EDITS_VALUE.to_string(),
                )),
                Ok(AsterMode::Approve) => Ok(Value::String("approve".to_string())),
                Ok(AsterMode::Chat) => Ok(Value::String("chat".to_string())),
                Err(ConfigError::NotFound(_)) => {
                    Ok(Value::String(PERMISSION_MODE_DEFAULT_VALUE.to_string()))
                }
                Err(error) => Err(map_config_error("读取", self.key(), error)),
            },
        }
    }

    fn write_value(self, config: &Config, value: Value) -> Result<Value, SettingWriteError> {
        match self {
            Self::Model => self.write_model_value(config, value),
            Self::PermissionsDefaultMode => self.write_permission_mode_value(config, value),
        }
    }

    fn write_model_value(self, config: &Config, value: Value) -> Result<Value, SettingWriteError> {
        let model = expect_string_value(self.key(), value)?;
        if is_default_token(&model) {
            config.delete("ASTER_MODEL").map_err(|error| {
                SettingWriteError::system(map_config_error("更新", self.key(), error))
            })?;
            return Ok(Value::String(MODEL_DEFAULT_VALUE.to_string()));
        }

        ModelConfig::new(model.as_str()).map_err(|error| {
            SettingWriteError::validation(format!("Invalid model value \"{model}\": {error}"))
        })?;

        config.set_aster_model(model.clone()).map_err(|error| {
            SettingWriteError::system(map_config_error("更新", self.key(), error))
        })?;
        Ok(Value::String(model))
    }

    fn write_permission_mode_value(
        self,
        config: &Config,
        value: Value,
    ) -> Result<Value, SettingWriteError> {
        let raw_mode = expect_string_value(self.key(), value)?;
        let normalized = normalize_permission_mode_input(&raw_mode);

        let resolved_value = match normalized.as_str() {
            PERMISSION_MODE_DEFAULT_VALUE => {
                config.delete("ASTER_MODE").map_err(|error| {
                    SettingWriteError::system(map_config_error("更新", self.key(), error))
                })?;
                Value::String(PERMISSION_MODE_DEFAULT_VALUE.to_string())
            }
            "acceptedits" => {
                config
                    .set_aster_mode(AsterMode::SmartApprove)
                    .map_err(|error| {
                        SettingWriteError::system(map_config_error("更新", self.key(), error))
                    })?;
                Value::String(PERMISSION_MODE_ACCEPT_EDITS_VALUE.to_string())
            }
            PERMISSION_MODE_AUTO_VALUE => {
                config.set_aster_mode(AsterMode::Auto).map_err(|error| {
                    SettingWriteError::system(map_config_error("更新", self.key(), error))
                })?;
                Value::String(PERMISSION_MODE_AUTO_VALUE.to_string())
            }
            _ => {
                return Err(SettingWriteError::validation(format!(
                "Unsupported value for {}: \"{}\". Supported values: default, acceptEdits, auto.",
                self.key(),
                raw_mode
            )))
            }
        };

        Ok(resolved_value)
    }
}

#[derive(Debug)]
enum SettingWriteError {
    Validation(String),
    System(ToolError),
}

impl SettingWriteError {
    fn validation(message: impl Into<String>) -> Self {
        Self::Validation(message.into())
    }

    fn system(error: ToolError) -> Self {
        Self::System(error)
    }
}

pub struct ConfigTool {
    config: Option<Arc<Config>>,
}

impl ConfigTool {
    pub fn new() -> Self {
        Self { config: None }
    }

    #[cfg(test)]
    fn with_config(config: Arc<Config>) -> Self {
        Self {
            config: Some(config),
        }
    }

    fn config(&self) -> &Config {
        match self.config.as_ref() {
            Some(config) => config.as_ref(),
            None => Config::global(),
        }
    }
}

impl Default for ConfigTool {
    fn default() -> Self {
        Self::new()
    }
}

fn map_config_error(action: &str, setting: &str, error: ConfigError) -> ToolError {
    ToolError::execution_failed(format!("{action}配置 {setting} 失败: {error}"))
}

fn normalize_permission_mode_input(input: &str) -> String {
    input.trim().to_ascii_lowercase().replace(['_', '-'], "")
}

fn is_default_token(input: &str) -> bool {
    input.trim().eq_ignore_ascii_case("default")
}

fn expect_string_value(setting: &str, value: Value) -> Result<String, SettingWriteError> {
    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                Err(SettingWriteError::validation(format!(
                    "{} requires a non-empty string value.",
                    setting
                )))
            } else {
                Ok(trimmed.to_string())
            }
        }
        _ => Err(SettingWriteError::validation(format!(
            "{} requires a string value.",
            setting
        ))),
    }
}

fn pretty_json<T: Serialize>(value: &T) -> Result<String, ToolError> {
    serde_json::to_string_pretty(value)
        .map_err(|error| ToolError::execution_failed(format!("序列化 Config 结果失败: {error}")))
}

fn tool_result_from_output(output: ConfigToolOutput) -> Result<ToolResult, ToolError> {
    let mut result =
        ToolResult::success(pretty_json(&output)?).with_metadata("success", json!(output.success));

    if let Some(operation) = output.operation.as_ref() {
        result = result.with_metadata("operation", json!(operation));
    }
    if let Some(setting) = output.setting.as_ref() {
        result = result.with_metadata("setting", json!(setting));
    }
    if let Some(value) = output.value.as_ref() {
        result = result.with_metadata("value", value.clone());
    }
    if let Some(previous_value) = output.previous_value.as_ref() {
        result = result.with_metadata("previousValue", previous_value.clone());
    }
    if let Some(new_value) = output.new_value.as_ref() {
        result = result.with_metadata("newValue", new_value.clone());
    }
    if let Some(error) = output.error.as_ref() {
        result = result.with_metadata("error", json!(error));
    }

    Ok(result)
}

fn dynamic_description() -> String {
    [
        CONFIG_TOOL_DESCRIPTION.to_string(),
        String::new(),
        "Usage:".to_string(),
        "- Omit `value` to read the current setting.".to_string(),
        "- Provide `value` to update the setting.".to_string(),
        String::new(),
        "Supported settings:".to_string(),
        format!(
            "- {} - {}",
            MODEL_SETTING_KEY,
            SupportedSetting::Model.description()
        ),
        format!(
            "- {}: \"{}\", \"{}\", \"{}\" - {}",
            PERMISSION_MODE_SETTING_KEY,
            PERMISSION_MODE_DEFAULT_VALUE,
            PERMISSION_MODE_ACCEPT_EDITS_VALUE,
            PERMISSION_MODE_AUTO_VALUE,
            SupportedSetting::PermissionsDefaultMode.description()
        ),
        String::new(),
        "Examples:".to_string(),
        format!("- {{ \"setting\": \"{}\" }}", MODEL_SETTING_KEY),
        format!(
            "- {{ \"setting\": \"{}\", \"value\": \"gpt-5.4\" }}",
            MODEL_SETTING_KEY
        ),
        format!(
            "- {{ \"setting\": \"{}\", \"value\": \"acceptEdits\" }}",
            PERMISSION_MODE_SETTING_KEY
        ),
    ]
    .join("\n")
}

#[async_trait]
impl Tool for ConfigTool {
    fn name(&self) -> &str {
        CONFIG_TOOL_NAME
    }

    fn description(&self) -> &str {
        CONFIG_TOOL_DESCRIPTION
    }

    fn dynamic_description(&self) -> Option<String> {
        Some(dynamic_description())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "setting": {
                    "type": "string",
                    "description": "The setting key (for example: \"model\" or \"permissions.defaultMode\")"
                },
                "value": {
                    "description": "The new value. Omit this field to read the current value.",
                    "oneOf": [
                        { "type": "string" },
                        { "type": "boolean" },
                        { "type": "number" }
                    ]
                }
            },
            "required": ["setting"]
        })
    }

    async fn check_permissions(
        &self,
        params: &Value,
        _context: &ToolContext,
    ) -> PermissionCheckResult {
        let Ok(input) = serde_json::from_value::<ConfigToolInput>(params.clone()) else {
            return PermissionCheckResult::deny("Invalid Config input");
        };

        if input.value.is_none() {
            return PermissionCheckResult::allow();
        }

        let setting = input.setting.trim();
        let value = input
            .value
            .as_ref()
            .and_then(|candidate| serde_json::to_string(candidate).ok())
            .unwrap_or_else(|| "null".to_string());

        PermissionCheckResult::ask(format!("Set {setting} to {value}"))
    }

    async fn execute(
        &self,
        params: Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input: ConfigToolInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(error.to_string()))?;
        let setting_name = input.setting.trim().to_string();

        let Some(setting) = SupportedSetting::parse(&setting_name) else {
            return tool_result_from_output(ConfigToolOutput::failure(
                if input.value.is_some() { "set" } else { "get" },
                setting_name,
                format!(
                    "Unknown setting: \"{}\". Supported settings: {}, {}.",
                    input.setting.trim(),
                    MODEL_SETTING_KEY,
                    PERMISSION_MODE_SETTING_KEY
                ),
            ));
        };

        let config = self.config();

        if let Some(next_value) = input.value {
            let previous_value = setting.read_value(config)?;
            let output = match setting.write_value(config, next_value) {
                Ok(resolved_value) => {
                    ConfigToolOutput::set_success(setting.key(), previous_value, resolved_value)
                }
                Err(SettingWriteError::Validation(message)) => {
                    ConfigToolOutput::failure("set", setting.key(), message)
                }
                Err(SettingWriteError::System(error)) => return Err(error),
            };

            return tool_result_from_output(output);
        }

        tool_result_from_output(ConfigToolOutput::get_success(
            setting.key(),
            setting.read_value(config)?,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use env_lock::lock_env;
    use tempfile::tempdir;

    fn parse_output(result: ToolResult) -> ConfigToolOutput {
        serde_json::from_str(result.output.as_deref().expect("expected tool output"))
            .expect("expected valid Config output json")
    }

    fn create_test_tool() -> ConfigTool {
        let root = tempdir().expect("temp dir").keep();
        let config_path = root.join("config.yaml");
        let secrets_path = root.join("secrets.yaml");
        let config = Arc::new(
            Config::new_with_file_secrets(&config_path, &secrets_path)
                .expect("test config should be created"),
        );

        ConfigTool::with_config(config)
    }

    #[test]
    fn test_config_tool_definition() {
        let tool = ConfigTool::new();
        let definition = tool.get_definition();

        assert_eq!(definition.name, CONFIG_TOOL_NAME);
        assert!(definition.description.contains("Supported settings"));
        assert_eq!(
            definition
                .input_schema
                .get("required")
                .and_then(Value::as_array)
                .expect("required array"),
            &vec![Value::String("setting".to_string())]
        );
    }

    #[tokio::test]
    async fn test_config_tool_get_model_defaults_to_default() {
        let _guard = lock_env([("ASTER_MODEL", None::<&str>), ("ASTER_MODE", None::<&str>)]);
        let tool = create_test_tool();

        let result = tool
            .execute(
                json!({ "setting": MODEL_SETTING_KEY }),
                &ToolContext::default(),
            )
            .await
            .expect("tool should succeed");
        let output = parse_output(result);

        assert_eq!(
            output,
            ConfigToolOutput::get_success(
                MODEL_SETTING_KEY,
                Value::String(MODEL_DEFAULT_VALUE.to_string())
            )
        );
    }

    #[tokio::test]
    async fn test_config_tool_set_model_round_trip() {
        let _guard = lock_env([("ASTER_MODEL", None::<&str>), ("ASTER_MODE", None::<&str>)]);
        let tool = create_test_tool();
        let context = ToolContext::default();

        let set_result = tool
            .execute(
                json!({ "setting": MODEL_SETTING_KEY, "value": "gpt-5.4" }),
                &context,
            )
            .await
            .expect("set model should succeed");
        let set_output = parse_output(set_result);
        assert_eq!(
            set_output,
            ConfigToolOutput::set_success(
                MODEL_SETTING_KEY,
                Value::String(MODEL_DEFAULT_VALUE.to_string()),
                Value::String("gpt-5.4".to_string())
            )
        );

        let get_result = tool
            .execute(json!({ "setting": MODEL_SETTING_KEY }), &context)
            .await
            .expect("get model should succeed");
        let get_output = parse_output(get_result);
        assert_eq!(
            get_output,
            ConfigToolOutput::get_success(MODEL_SETTING_KEY, Value::String("gpt-5.4".to_string()))
        );
    }

    #[tokio::test]
    async fn test_config_tool_set_permission_mode_round_trip() {
        let _guard = lock_env([("ASTER_MODEL", None::<&str>), ("ASTER_MODE", None::<&str>)]);
        let tool = create_test_tool();
        let context = ToolContext::default();

        let set_result = tool
            .execute(
                json!({
                    "setting": PERMISSION_MODE_SETTING_KEY,
                    "value": PERMISSION_MODE_ACCEPT_EDITS_VALUE
                }),
                &context,
            )
            .await
            .expect("set permission mode should succeed");
        let set_output = parse_output(set_result);
        assert_eq!(
            set_output,
            ConfigToolOutput::set_success(
                PERMISSION_MODE_SETTING_KEY,
                Value::String(PERMISSION_MODE_DEFAULT_VALUE.to_string()),
                Value::String(PERMISSION_MODE_ACCEPT_EDITS_VALUE.to_string())
            )
        );

        let get_result = tool
            .execute(json!({ "setting": PERMISSION_MODE_SETTING_KEY }), &context)
            .await
            .expect("get permission mode should succeed");
        let get_output = parse_output(get_result);
        assert_eq!(
            get_output,
            ConfigToolOutput::get_success(
                PERMISSION_MODE_SETTING_KEY,
                Value::String(PERMISSION_MODE_ACCEPT_EDITS_VALUE.to_string())
            )
        );
    }

    #[tokio::test]
    async fn test_config_tool_rejects_unsupported_permission_value() {
        let _guard = lock_env([("ASTER_MODEL", None::<&str>), ("ASTER_MODE", None::<&str>)]);
        let tool = create_test_tool();

        let result = tool
            .execute(
                json!({
                    "setting": PERMISSION_MODE_SETTING_KEY,
                    "value": "plan"
                }),
                &ToolContext::default(),
            )
            .await
            .expect("tool should return structured failure");
        let output = parse_output(result);

        assert!(!output.success);
        assert_eq!(output.operation, Some("set".to_string()));
        assert_eq!(output.setting.as_deref(), Some(PERMISSION_MODE_SETTING_KEY));
        assert!(output
            .error
            .as_deref()
            .expect("error message")
            .contains("Unsupported value"));
    }

    #[tokio::test]
    async fn test_config_tool_check_permissions_read_vs_write() {
        let tool = ConfigTool::new();
        let context = ToolContext::default();

        let read_permission = tool
            .check_permissions(&json!({ "setting": MODEL_SETTING_KEY }), &context)
            .await;
        assert!(read_permission.is_allowed());

        let write_permission = tool
            .check_permissions(
                &json!({ "setting": MODEL_SETTING_KEY, "value": "gpt-5.4" }),
                &context,
            )
            .await;
        assert!(write_permission.requires_confirmation());
        assert_eq!(
            write_permission.message.as_deref(),
            Some("Set model to \"gpt-5.4\"")
        );
    }
}
