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
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use crate::config::{AsterMode, Config, ConfigError};
use crate::model::ModelConfig;
use crate::security::{
    read_classifier_permissions_enabled, LEGACY_CLASSIFIER_PERMISSIONS_ENABLED_CONFIG_KEY,
};

const CONFIG_TOOL_NAME: &str = "Config";
const CONFIG_TOOL_DESCRIPTION: &str = "Get or set supported runtime configuration settings.";

const THEME_SETTING_KEY: &str = "theme";
const EDITOR_MODE_SETTING_KEY: &str = "editorMode";
const VERBOSE_SETTING_KEY: &str = "verbose";
const PREFERRED_NOTIF_CHANNEL_SETTING_KEY: &str = "preferredNotifChannel";
const AUTO_COMPACT_ENABLED_SETTING_KEY: &str = "autoCompactEnabled";
const AUTO_MEMORY_ENABLED_SETTING_KEY: &str = "autoMemoryEnabled";
const AUTO_DREAM_ENABLED_SETTING_KEY: &str = "autoDreamEnabled";
const FILE_CHECKPOINTING_ENABLED_SETTING_KEY: &str = "fileCheckpointingEnabled";
const SHOW_TURN_DURATION_SETTING_KEY: &str = "showTurnDuration";
const TERMINAL_PROGRESS_BAR_ENABLED_SETTING_KEY: &str = "terminalProgressBarEnabled";
const TASK_TRACKING_ENABLED_SETTING_KEY: &str = "taskTrackingEnabled";
const MODEL_SETTING_KEY: &str = "model";
const ALWAYS_THINKING_ENABLED_SETTING_KEY: &str = "alwaysThinkingEnabled";
const PERMISSION_MODE_SETTING_KEY: &str = "permissions.defaultMode";
const LANGUAGE_SETTING_KEY: &str = "language";
const TEAMMATE_MODE_SETTING_KEY: &str = "teammateMode";
const CLASSIFIER_PERMISSIONS_ENABLED_SETTING_KEY: &str = "classifierPermissionsEnabled";
const VOICE_ENABLED_SETTING_KEY: &str = "voiceEnabled";
const REMOTE_CONTROL_AT_STARTUP_SETTING_KEY: &str = "remoteControlAtStartup";
const TASK_COMPLETE_NOTIF_ENABLED_SETTING_KEY: &str = "taskCompleteNotifEnabled";
const INPUT_NEEDED_NOTIF_ENABLED_SETTING_KEY: &str = "inputNeededNotifEnabled";
const AGENT_PUSH_NOTIF_ENABLED_SETTING_KEY: &str = "agentPushNotifEnabled";

const MODEL_DEFAULT_VALUE: &str = "default";
const THEME_DEFAULT_VALUE: &str = "auto";
const TEAMMATE_MODE_DEFAULT_VALUE: &str = "auto";
const PERMISSION_MODE_DEFAULT_VALUE: &str = "default";
const PERMISSION_MODE_ACCEPT_EDITS_VALUE: &str = "acceptEdits";
const PERMISSION_MODE_AUTO_VALUE: &str = "auto";
const PERMISSION_MODE_APPROVE_VALUE: &str = "approve";
const PERMISSION_MODE_CHAT_VALUE: &str = "chat";
const PERMISSION_MODE_PLAN_VALUE: &str = "plan";
const PERMISSION_MODE_DONT_ASK_VALUE: &str = "dontAsk";

const EDITOR_MODE_OPTIONS: &[&str] = &["normal", "vim"];
const NOTIFICATION_CHANNEL_OPTIONS: &[&str] = &[
    "auto",
    "iterm2",
    "iterm2_with_bell",
    "terminal_bell",
    "kitty",
    "ghostty",
    "notifications_disabled",
];
const TEAMMATE_MODE_OPTIONS: &[&str] = &["auto", "tmux", "in-process"];
const PERMISSION_MODE_SUPPORTED_VALUES: &[&str] = &[
    PERMISSION_MODE_DEFAULT_VALUE,
    PERMISSION_MODE_ACCEPT_EDITS_VALUE,
    PERMISSION_MODE_AUTO_VALUE,
    PERMISSION_MODE_APPROVE_VALUE,
    PERMISSION_MODE_CHAT_VALUE,
];

type BoolSettingFuture = Pin<Box<dyn Future<Output = Result<bool, String>> + Send>>;

pub type VoiceEnabledReadCallback = Arc<dyn Fn() -> BoolSettingFuture + Send + Sync>;
pub type VoiceEnabledWriteCallback = Arc<dyn Fn(bool) -> BoolSettingFuture + Send + Sync>;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
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
enum SettingValueType {
    Boolean,
    String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SupportedSetting {
    Theme,
    EditorMode,
    Verbose,
    PreferredNotifChannel,
    AutoCompactEnabled,
    AutoMemoryEnabled,
    AutoDreamEnabled,
    FileCheckpointingEnabled,
    ShowTurnDuration,
    TerminalProgressBarEnabled,
    TaskTrackingEnabled,
    Model,
    AlwaysThinkingEnabled,
    PermissionsDefaultMode,
    Language,
    TeammateMode,
    ClassifierPermissionsEnabled,
    VoiceEnabled,
    RemoteControlAtStartup,
    TaskCompleteNotifEnabled,
    InputNeededNotifEnabled,
    AgentPushNotifEnabled,
}

const SUPPORTED_SETTINGS: &[SupportedSetting] = &[
    SupportedSetting::Theme,
    SupportedSetting::EditorMode,
    SupportedSetting::Verbose,
    SupportedSetting::PreferredNotifChannel,
    SupportedSetting::AutoCompactEnabled,
    SupportedSetting::AutoMemoryEnabled,
    SupportedSetting::AutoDreamEnabled,
    SupportedSetting::FileCheckpointingEnabled,
    SupportedSetting::ShowTurnDuration,
    SupportedSetting::TerminalProgressBarEnabled,
    SupportedSetting::TaskTrackingEnabled,
    SupportedSetting::Model,
    SupportedSetting::AlwaysThinkingEnabled,
    SupportedSetting::PermissionsDefaultMode,
    SupportedSetting::Language,
    SupportedSetting::TeammateMode,
    SupportedSetting::ClassifierPermissionsEnabled,
    SupportedSetting::VoiceEnabled,
    SupportedSetting::RemoteControlAtStartup,
    SupportedSetting::TaskCompleteNotifEnabled,
    SupportedSetting::InputNeededNotifEnabled,
    SupportedSetting::AgentPushNotifEnabled,
];

impl SupportedSetting {
    fn parse(raw: &str) -> Option<Self> {
        SUPPORTED_SETTINGS
            .iter()
            .copied()
            .find(|setting| setting.key() == raw.trim())
    }

    fn key(self) -> &'static str {
        match self {
            Self::Theme => THEME_SETTING_KEY,
            Self::EditorMode => EDITOR_MODE_SETTING_KEY,
            Self::Verbose => VERBOSE_SETTING_KEY,
            Self::PreferredNotifChannel => PREFERRED_NOTIF_CHANNEL_SETTING_KEY,
            Self::AutoCompactEnabled => AUTO_COMPACT_ENABLED_SETTING_KEY,
            Self::AutoMemoryEnabled => AUTO_MEMORY_ENABLED_SETTING_KEY,
            Self::AutoDreamEnabled => AUTO_DREAM_ENABLED_SETTING_KEY,
            Self::FileCheckpointingEnabled => FILE_CHECKPOINTING_ENABLED_SETTING_KEY,
            Self::ShowTurnDuration => SHOW_TURN_DURATION_SETTING_KEY,
            Self::TerminalProgressBarEnabled => TERMINAL_PROGRESS_BAR_ENABLED_SETTING_KEY,
            Self::TaskTrackingEnabled => TASK_TRACKING_ENABLED_SETTING_KEY,
            Self::Model => MODEL_SETTING_KEY,
            Self::AlwaysThinkingEnabled => ALWAYS_THINKING_ENABLED_SETTING_KEY,
            Self::PermissionsDefaultMode => PERMISSION_MODE_SETTING_KEY,
            Self::Language => LANGUAGE_SETTING_KEY,
            Self::TeammateMode => TEAMMATE_MODE_SETTING_KEY,
            Self::ClassifierPermissionsEnabled => CLASSIFIER_PERMISSIONS_ENABLED_SETTING_KEY,
            Self::VoiceEnabled => VOICE_ENABLED_SETTING_KEY,
            Self::RemoteControlAtStartup => REMOTE_CONTROL_AT_STARTUP_SETTING_KEY,
            Self::TaskCompleteNotifEnabled => TASK_COMPLETE_NOTIF_ENABLED_SETTING_KEY,
            Self::InputNeededNotifEnabled => INPUT_NEEDED_NOTIF_ENABLED_SETTING_KEY,
            Self::AgentPushNotifEnabled => AGENT_PUSH_NOTIF_ENABLED_SETTING_KEY,
        }
    }

    fn description(self) -> &'static str {
        match self {
            Self::Theme => "Color theme for the UI.",
            Self::EditorMode => "Key binding mode.",
            Self::Verbose => "Show detailed debug output.",
            Self::PreferredNotifChannel => "Preferred notification channel.",
            Self::AutoCompactEnabled => "Auto-compact when context is full.",
            Self::AutoMemoryEnabled => "Enable auto-memory.",
            Self::AutoDreamEnabled => "Enable background memory consolidation.",
            Self::FileCheckpointingEnabled => "Enable file checkpointing for code rewind.",
            Self::ShowTurnDuration => {
                "Show turn duration message after responses (for example: \"Cooked for 1m 6s\")."
            }
            Self::TerminalProgressBarEnabled => {
                "Show OSC 9;4 progress indicator in supported terminals."
            }
            Self::TaskTrackingEnabled => "Enable task tracking.",
            Self::Model => {
                "Override the default runtime model. Use \"default\" to clear the override."
            }
            Self::AlwaysThinkingEnabled => "Enable extended thinking.",
            Self::PermissionsDefaultMode => {
                "Default permission mode for tool execution. Current Lime runtime supports \"default\", \"acceptEdits\", \"auto\", \"approve\", and \"chat\". Upstream alias \"plan\" currently exists only as the explicit EnterPlanMode/ExitPlanMode flow, and \"dontAsk\" does not yet have a global provider/permission-inspector runtime."
            }
            Self::Language => {
                "Preferred language for assistant responses and related features."
            }
            Self::TeammateMode => {
                "How to spawn teammates: \"auto\", \"tmux\", or \"in-process\"."
            }
            Self::ClassifierPermissionsEnabled => {
                "Enable AI-based classification for Bash permission rules."
            }
            Self::VoiceEnabled => "Enable voice dictation (hold-to-talk).",
            Self::RemoteControlAtStartup => {
                "Enable Remote Control for all sessions at startup."
            }
            Self::TaskCompleteNotifEnabled => {
                "Push to your mobile device when idle after the agent finishes."
            }
            Self::InputNeededNotifEnabled => {
                "Push to your mobile device when a permission prompt or question is waiting."
            }
            Self::AgentPushNotifEnabled => {
                "Allow the agent to proactively push to your mobile device."
            }
        }
    }

    fn value_type(self) -> SettingValueType {
        match self {
            Self::Verbose
            | Self::AutoCompactEnabled
            | Self::AutoMemoryEnabled
            | Self::AutoDreamEnabled
            | Self::FileCheckpointingEnabled
            | Self::ShowTurnDuration
            | Self::TerminalProgressBarEnabled
            | Self::TaskTrackingEnabled
            | Self::AlwaysThinkingEnabled
            | Self::ClassifierPermissionsEnabled
            | Self::VoiceEnabled
            | Self::RemoteControlAtStartup
            | Self::TaskCompleteNotifEnabled
            | Self::InputNeededNotifEnabled
            | Self::AgentPushNotifEnabled => SettingValueType::Boolean,
            _ => SettingValueType::String,
        }
    }

    fn unsupported_message(self) -> Option<&'static str> {
        match self {
            Self::VoiceEnabled => Some(
                "Known upstream setting, but the current Lime runtime needs a host-backed callback to keep persisted voice config and global shortcut registration in sync.",
            ),
            Self::RemoteControlAtStartup => Some(
                "Known upstream setting, but Lime's current host surface only exposes OS auto-launch; it does not have an upstream-style remote-control-at-startup session default.",
            ),
            Self::TaskCompleteNotifEnabled => Some(
                "Known upstream setting, but Lime does not have a remote-control-backed mobile push control plane for task-complete notifications.",
            ),
            Self::InputNeededNotifEnabled => Some(
                "Known upstream setting, but Lime does not have a remote-control-backed mobile push control plane for input-needed notifications.",
            ),
            Self::AgentPushNotifEnabled => Some(
                "Known upstream setting, but Lime does not have a remote-control-backed mobile push control plane for agent-authored notifications.",
            ),
            _ => None,
        }
    }

    fn options(self) -> &'static [&'static str] {
        match self {
            Self::EditorMode => EDITOR_MODE_OPTIONS,
            Self::PreferredNotifChannel => NOTIFICATION_CHANNEL_OPTIONS,
            Self::TeammateMode => TEAMMATE_MODE_OPTIONS,
            _ => &[],
        }
    }

    fn default_read_value(self) -> Option<Value> {
        match self {
            Self::Theme => Some(Value::String(THEME_DEFAULT_VALUE.to_string())),
            Self::TeammateMode => Some(Value::String(TEAMMATE_MODE_DEFAULT_VALUE.to_string())),
            Self::ClassifierPermissionsEnabled => Some(Value::Bool(false)),
            _ => None,
        }
    }

    fn read_value(self, config: &Config) -> Result<Value, ToolError> {
        match self {
            Self::ClassifierPermissionsEnabled => {
                let enabled = read_classifier_permissions_enabled(config)
                    .map_err(|error| map_config_error("读取", self.key(), error))?;
                Ok(Value::Bool(enabled))
            }
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
                Ok(AsterMode::Approve) => {
                    Ok(Value::String(PERMISSION_MODE_APPROVE_VALUE.to_string()))
                }
                Ok(AsterMode::Chat) => Ok(Value::String(PERMISSION_MODE_CHAT_VALUE.to_string())),
                Err(ConfigError::NotFound(_)) => {
                    Ok(Value::String(PERMISSION_MODE_DEFAULT_VALUE.to_string()))
                }
                Err(error) => Err(map_config_error("读取", self.key(), error)),
            },
            _ => self.read_generic_value(config),
        }
    }

    fn read_generic_value(self, config: &Config) -> Result<Value, ToolError> {
        match config.get_param::<Value>(self.key()) {
            Ok(value) => Ok(value),
            Err(ConfigError::NotFound(_)) => Ok(self.default_read_value().unwrap_or(Value::Null)),
            Err(error) => Err(map_config_error("读取", self.key(), error)),
        }
    }

    fn write_value(self, config: &Config, value: Value) -> Result<Value, SettingWriteError> {
        match self {
            Self::ClassifierPermissionsEnabled => {
                self.write_classifier_permissions_enabled(config, value)
            }
            Self::Model => self.write_model_value(config, value),
            Self::PermissionsDefaultMode => self.write_permission_mode_value(config, value),
            _ => self.write_generic_value(config, value),
        }
    }

    fn write_classifier_permissions_enabled(
        self,
        config: &Config,
        value: Value,
    ) -> Result<Value, SettingWriteError> {
        let enabled = expect_boolean_value(self.key(), value)?;
        config.set_param(self.key(), enabled).map_err(|error| {
            SettingWriteError::system(map_config_error("更新", self.key(), error))
        })?;
        config
            .delete(LEGACY_CLASSIFIER_PERMISSIONS_ENABLED_CONFIG_KEY)
            .map_err(|error| {
                SettingWriteError::system(map_config_error("更新", self.key(), error))
            })?;
        Ok(Value::Bool(enabled))
    }

    fn write_generic_value(
        self,
        config: &Config,
        value: Value,
    ) -> Result<Value, SettingWriteError> {
        match self.value_type() {
            SettingValueType::Boolean => {
                let enabled = expect_boolean_value(self.key(), value)?;
                config.set_param(self.key(), enabled).map_err(|error| {
                    SettingWriteError::system(map_config_error("更新", self.key(), error))
                })?;
                Ok(Value::Bool(enabled))
            }
            SettingValueType::String => {
                let raw = expect_string_value(self.key(), value)?;
                let resolved = match self.canonical_string_option(&raw) {
                    Some(option) => option.to_string(),
                    None if self.options().is_empty() => raw,
                    None => {
                        return Err(SettingWriteError::validation(format!(
                            "Invalid value \"{raw}\". Options: {}",
                            self.options().join(", ")
                        )))
                    }
                };

                config
                    .set_param(self.key(), resolved.as_str())
                    .map_err(|error| {
                        SettingWriteError::system(map_config_error("更新", self.key(), error))
                    })?;
                Ok(Value::String(resolved))
            }
        }
    }

    fn canonical_string_option(self, raw: &str) -> Option<&'static str> {
        self.options()
            .iter()
            .copied()
            .find(|candidate| candidate.eq_ignore_ascii_case(raw.trim()))
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
            PERMISSION_MODE_APPROVE_VALUE => {
                config.set_aster_mode(AsterMode::Approve).map_err(|error| {
                    SettingWriteError::system(map_config_error("更新", self.key(), error))
                })?;
                Value::String(PERMISSION_MODE_APPROVE_VALUE.to_string())
            }
            PERMISSION_MODE_CHAT_VALUE => {
                config.set_aster_mode(AsterMode::Chat).map_err(|error| {
                    SettingWriteError::system(map_config_error("更新", self.key(), error))
                })?;
                Value::String(PERMISSION_MODE_CHAT_VALUE.to_string())
            }
            "plan" => return Err(SettingWriteError::validation(format!(
                "Unsupported value for {}: \"{}\". Lime plan mode is currently an explicit tool-mediated flow via EnterPlanMode/ExitPlanMode, not a persisted global default permission mode. Supported values: {}.",
                self.key(),
                raw_mode,
                PERMISSION_MODE_SUPPORTED_VALUES.join(", ")
            ))),
            "dontask" => return Err(SettingWriteError::validation(format!(
                "Unsupported value for {}: \"{}\". Lime does not yet have a global dontAsk runtime across provider flags and PermissionInspector. Supported values: {}.",
                self.key(),
                raw_mode,
                PERMISSION_MODE_SUPPORTED_VALUES.join(", ")
            ))),
            _ => {
                return Err(SettingWriteError::validation(format!(
                    "Unsupported value for {}: \"{}\". Supported values: {}.",
                    self.key(),
                    raw_mode,
                    PERMISSION_MODE_SUPPORTED_VALUES.join(", ")
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

#[derive(Clone, Default)]
struct ConfigToolHostCallbacks {
    voice_enabled_read: Option<VoiceEnabledReadCallback>,
    voice_enabled_write: Option<VoiceEnabledWriteCallback>,
}

pub struct ConfigTool {
    config: Option<Arc<Config>>,
    host_callbacks: ConfigToolHostCallbacks,
}

impl ConfigTool {
    pub fn new() -> Self {
        Self {
            config: None,
            host_callbacks: ConfigToolHostCallbacks::default(),
        }
    }

    pub fn with_voice_enabled_callbacks(
        mut self,
        read_callback: VoiceEnabledReadCallback,
        write_callback: VoiceEnabledWriteCallback,
    ) -> Self {
        self.host_callbacks.voice_enabled_read = Some(read_callback);
        self.host_callbacks.voice_enabled_write = Some(write_callback);
        self
    }

    #[cfg(test)]
    fn with_config(config: Arc<Config>) -> Self {
        Self {
            config: Some(config),
            host_callbacks: ConfigToolHostCallbacks::default(),
        }
    }

    fn config(&self) -> &Config {
        match self.config.as_ref() {
            Some(config) => config.as_ref(),
            None => Config::global(),
        }
    }

    fn supports_host_backed_setting(&self, setting: SupportedSetting) -> bool {
        match setting {
            SupportedSetting::VoiceEnabled => {
                self.host_callbacks.voice_enabled_read.is_some()
                    && self.host_callbacks.voice_enabled_write.is_some()
            }
            _ => false,
        }
    }

    fn unsupported_message(&self, setting: SupportedSetting) -> Option<&'static str> {
        if self.supports_host_backed_setting(setting) {
            None
        } else {
            setting.unsupported_message()
        }
    }

    async fn execute_host_backed_setting(
        &self,
        setting: SupportedSetting,
        next_value: Option<Value>,
    ) -> Result<Option<ConfigToolOutput>, ToolError> {
        match setting {
            SupportedSetting::VoiceEnabled => self.execute_voice_enabled(next_value).await,
            _ => Ok(None),
        }
    }

    async fn execute_voice_enabled(
        &self,
        next_value: Option<Value>,
    ) -> Result<Option<ConfigToolOutput>, ToolError> {
        let Some(read_callback) = self.host_callbacks.voice_enabled_read.as_ref() else {
            return Ok(None);
        };
        let Some(write_callback) = self.host_callbacks.voice_enabled_write.as_ref() else {
            return Ok(None);
        };

        let setting_key = VOICE_ENABLED_SETTING_KEY;
        let current_value = match read_callback().await {
            Ok(enabled) => Value::Bool(enabled),
            Err(message) => {
                let operation = if next_value.is_some() { "set" } else { "get" };
                return Ok(Some(ConfigToolOutput::failure(
                    operation,
                    setting_key,
                    message,
                )));
            }
        };

        if let Some(value) = next_value {
            let enabled = match expect_boolean_value(setting_key, value) {
                Ok(enabled) => enabled,
                Err(SettingWriteError::Validation(message)) => {
                    return Ok(Some(ConfigToolOutput::failure("set", setting_key, message)));
                }
                Err(SettingWriteError::System(error)) => return Err(error),
            };

            return Ok(Some(match write_callback(enabled).await {
                Ok(resolved) => {
                    ConfigToolOutput::set_success(setting_key, current_value, Value::Bool(resolved))
                }
                Err(message) => ConfigToolOutput::failure("set", setting_key, message),
            }));
        }

        Ok(Some(ConfigToolOutput::get_success(
            setting_key,
            current_value,
        )))
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

fn expect_boolean_value(setting: &str, value: Value) -> Result<bool, SettingWriteError> {
    match value {
        Value::Bool(boolean) => Ok(boolean),
        Value::String(text) => match text.trim().to_ascii_lowercase().as_str() {
            "true" => Ok(true),
            "false" => Ok(false),
            _ => Err(SettingWriteError::validation(format!(
                "{} requires true or false.",
                setting
            ))),
        },
        _ => Err(SettingWriteError::validation(format!(
            "{} requires true or false.",
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

fn supported_settings_line(tool: &ConfigTool, setting: SupportedSetting) -> String {
    let kind = match setting.value_type() {
        SettingValueType::Boolean => "boolean",
        SettingValueType::String => "string",
    };
    let options = if setting.options().is_empty() {
        String::new()
    } else {
        format!(" Options: {}.", setting.options().join(", "))
    };
    let availability = tool
        .unsupported_message(setting)
        .map(|message| format!(" Current Lime runtime: {}.", message))
        .unwrap_or_default();

    format!(
        "- {} ({}) - {}{}{}",
        setting.key(),
        kind,
        setting.description(),
        options,
        availability
    )
}

fn supported_setting_keys() -> String {
    SUPPORTED_SETTINGS
        .iter()
        .map(|setting| setting.key())
        .collect::<Vec<_>>()
        .join(", ")
}

fn dynamic_description(tool: &ConfigTool) -> String {
    let mut lines = vec![
        CONFIG_TOOL_DESCRIPTION.to_string(),
        String::new(),
        "Usage:".to_string(),
        "- Omit `value` to read the current setting.".to_string(),
        "- Provide `value` to update the setting.".to_string(),
        String::new(),
        "Supported settings:".to_string(),
    ];

    lines.extend(
        SUPPORTED_SETTINGS
            .iter()
            .copied()
            .map(|setting| supported_settings_line(tool, setting)),
    );

    lines.extend([
        String::new(),
        "Examples:".to_string(),
        format!("- {{ \"setting\": \"{}\" }}", THEME_SETTING_KEY),
        format!(
            "- {{ \"setting\": \"{}\", \"value\": true }}",
            VERBOSE_SETTING_KEY
        ),
        format!(
            "- {{ \"setting\": \"{}\", \"value\": \"gpt-5.4\" }}",
            MODEL_SETTING_KEY
        ),
        format!(
            "- {{ \"setting\": \"{}\", \"value\": \"acceptEdits\" }}",
            PERMISSION_MODE_SETTING_KEY
        ),
    ]);

    lines.join("\n")
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
        Some(dynamic_description(self))
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "setting": {
                    "type": "string",
                    "description": "The setting key (for example: \"theme\", \"model\", or \"permissions.defaultMode\")"
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
                    "Unknown setting: \"{}\". Supported settings: {}.",
                    input.setting.trim(),
                    supported_setting_keys()
                ),
            ));
        };

        if let Some(output) = self
            .execute_host_backed_setting(setting, input.value.clone())
            .await?
        {
            return tool_result_from_output(output);
        }

        if let Some(message) = self.unsupported_message(setting) {
            return tool_result_from_output(ConfigToolOutput::failure(
                if input.value.is_some() { "set" } else { "get" },
                setting.key(),
                message,
            ));
        }

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
        ConfigTool::with_config(create_test_config())
    }

    fn create_test_config() -> Arc<Config> {
        let root = tempdir().expect("temp dir").keep();
        let config_path = root.join("config.yaml");
        let secrets_path = root.join("secrets.yaml");
        Arc::new(
            Config::new_with_file_secrets(&config_path, &secrets_path)
                .expect("test config should be created"),
        )
    }

    #[test]
    fn test_config_tool_definition() {
        let tool = ConfigTool::new();
        let definition = tool.get_definition();

        assert_eq!(definition.name, CONFIG_TOOL_NAME);
        assert!(definition.description.contains("Supported settings"));
        assert!(definition.description.contains(THEME_SETTING_KEY));
        assert!(definition.description.contains(TEAMMATE_MODE_SETTING_KEY));
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
    async fn test_config_tool_get_theme_defaults_to_auto() {
        let _guard = lock_env([("THEME", None::<&str>)]);
        let tool = create_test_tool();

        let result = tool
            .execute(
                json!({ "setting": THEME_SETTING_KEY }),
                &ToolContext::default(),
            )
            .await
            .expect("tool should succeed");
        let output = parse_output(result);

        assert_eq!(
            output,
            ConfigToolOutput::get_success(
                THEME_SETTING_KEY,
                Value::String(THEME_DEFAULT_VALUE.to_string())
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
    async fn test_config_tool_set_boolean_setting_round_trip() {
        let _guard = lock_env([("VERBOSE", None::<&str>)]);
        let tool = create_test_tool();
        let context = ToolContext::default();

        let set_result = tool
            .execute(
                json!({ "setting": VERBOSE_SETTING_KEY, "value": true }),
                &context,
            )
            .await
            .expect("set verbose should succeed");
        let set_output = parse_output(set_result);
        assert!(set_output.success);
        assert_eq!(set_output.operation.as_deref(), Some("set"));
        assert_eq!(set_output.setting.as_deref(), Some(VERBOSE_SETTING_KEY));
        assert_eq!(set_output.value, Some(Value::Bool(true)));
        assert_eq!(set_output.previous_value, None);
        assert_eq!(set_output.new_value, Some(Value::Bool(true)));

        let get_result = tool
            .execute(json!({ "setting": VERBOSE_SETTING_KEY }), &context)
            .await
            .expect("get verbose should succeed");
        let get_output = parse_output(get_result);
        assert_eq!(
            get_output,
            ConfigToolOutput::get_success(VERBOSE_SETTING_KEY, Value::Bool(true))
        );
    }

    #[tokio::test]
    async fn test_config_tool_boolean_setting_accepts_string_booleans() {
        let _guard = lock_env([("TASKTRACKINGENABLED", None::<&str>)]);
        let tool = create_test_tool();

        let result = tool
            .execute(
                json!({
                    "setting": TASK_TRACKING_ENABLED_SETTING_KEY,
                    "value": "false"
                }),
                &ToolContext::default(),
            )
            .await
            .expect("string boolean should be accepted");
        let output = parse_output(result);

        assert!(output.success);
        assert_eq!(output.operation.as_deref(), Some("set"));
        assert_eq!(
            output.setting.as_deref(),
            Some(TASK_TRACKING_ENABLED_SETTING_KEY)
        );
        assert_eq!(output.value, Some(Value::Bool(false)));
        assert_eq!(output.previous_value, None);
        assert_eq!(output.new_value, Some(Value::Bool(false)));
    }

    #[tokio::test]
    async fn test_config_tool_set_teammate_mode_round_trip() {
        let _guard = lock_env([("TEAMMATEMODE", None::<&str>)]);
        let tool = create_test_tool();
        let context = ToolContext::default();

        let set_result = tool
            .execute(
                json!({ "setting": TEAMMATE_MODE_SETTING_KEY, "value": "tmux" }),
                &context,
            )
            .await
            .expect("set teammate mode should succeed");
        let set_output = parse_output(set_result);
        assert_eq!(
            set_output,
            ConfigToolOutput::set_success(
                TEAMMATE_MODE_SETTING_KEY,
                Value::String(TEAMMATE_MODE_DEFAULT_VALUE.to_string()),
                Value::String("tmux".to_string())
            )
        );

        let get_result = tool
            .execute(json!({ "setting": TEAMMATE_MODE_SETTING_KEY }), &context)
            .await
            .expect("get teammate mode should succeed");
        let get_output = parse_output(get_result);
        assert_eq!(
            get_output,
            ConfigToolOutput::get_success(
                TEAMMATE_MODE_SETTING_KEY,
                Value::String("tmux".to_string())
            )
        );
    }

    #[tokio::test]
    async fn test_config_tool_rejects_invalid_option_value() {
        let _guard = lock_env([("TEAMMATEMODE", None::<&str>)]);
        let tool = create_test_tool();

        let result = tool
            .execute(
                json!({
                    "setting": TEAMMATE_MODE_SETTING_KEY,
                    "value": "fork"
                }),
                &ToolContext::default(),
            )
            .await
            .expect("tool should return structured failure");
        let output = parse_output(result);

        assert!(!output.success);
        assert_eq!(output.operation, Some("set".to_string()));
        assert_eq!(output.setting.as_deref(), Some(TEAMMATE_MODE_SETTING_KEY));
        assert_eq!(
            output.error.as_deref(),
            Some("Invalid value \"fork\". Options: auto, tmux, in-process")
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
    async fn test_config_tool_supports_runtime_permission_aliases() {
        let _guard = lock_env([("ASTER_MODE", None::<&str>)]);
        let tool = create_test_tool();
        let context = ToolContext::default();

        let set_result = tool
            .execute(
                json!({
                    "setting": PERMISSION_MODE_SETTING_KEY,
                    "value": PERMISSION_MODE_APPROVE_VALUE
                }),
                &context,
            )
            .await
            .expect("set approve mode should succeed");
        let set_output = parse_output(set_result);
        assert_eq!(
            set_output,
            ConfigToolOutput::set_success(
                PERMISSION_MODE_SETTING_KEY,
                Value::String(PERMISSION_MODE_DEFAULT_VALUE.to_string()),
                Value::String(PERMISSION_MODE_APPROVE_VALUE.to_string())
            )
        );

        let get_result = tool
            .execute(json!({ "setting": PERMISSION_MODE_SETTING_KEY }), &context)
            .await
            .expect("get approve mode should succeed");
        let get_output = parse_output(get_result);
        assert_eq!(
            get_output,
            ConfigToolOutput::get_success(
                PERMISSION_MODE_SETTING_KEY,
                Value::String(PERMISSION_MODE_APPROVE_VALUE.to_string())
            )
        );
    }

    #[tokio::test]
    async fn test_config_tool_rejects_plan_permission_mode_without_global_runtime() {
        let _guard = lock_env([("ASTER_MODE", None::<&str>)]);
        let tool = create_test_tool();

        let result = tool
            .execute(
                json!({
                    "setting": PERMISSION_MODE_SETTING_KEY,
                    "value": PERMISSION_MODE_PLAN_VALUE
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
            .contains("EnterPlanMode/ExitPlanMode"));
    }

    #[tokio::test]
    async fn test_config_tool_rejects_dont_ask_permission_mode_without_global_runtime() {
        let _guard = lock_env([("ASTER_MODE", None::<&str>)]);
        let tool = create_test_tool();

        let result = tool
            .execute(
                json!({
                    "setting": PERMISSION_MODE_SETTING_KEY,
                    "value": PERMISSION_MODE_DONT_ASK_VALUE
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
            .contains("PermissionInspector"));
    }

    #[tokio::test]
    async fn test_config_tool_classifier_permissions_enabled_round_trip() {
        let _guard = lock_env([
            ("CLASSIFIERPERMISSIONSENABLED", None::<&str>),
            (
                LEGACY_CLASSIFIER_PERMISSIONS_ENABLED_CONFIG_KEY,
                None::<&str>,
            ),
        ]);
        let tool = create_test_tool();
        let context = ToolContext::default();

        let get_default_result = tool
            .execute(
                json!({ "setting": CLASSIFIER_PERMISSIONS_ENABLED_SETTING_KEY }),
                &context,
            )
            .await
            .expect("get classifier setting should succeed");
        let get_default_output = parse_output(get_default_result);
        assert_eq!(
            get_default_output,
            ConfigToolOutput::get_success(
                CLASSIFIER_PERMISSIONS_ENABLED_SETTING_KEY,
                Value::Bool(false)
            )
        );

        let set_result = tool
            .execute(
                json!({
                    "setting": CLASSIFIER_PERMISSIONS_ENABLED_SETTING_KEY,
                    "value": true
                }),
                &context,
            )
            .await
            .expect("set classifier setting should succeed");
        let set_output = parse_output(set_result);
        assert_eq!(
            set_output,
            ConfigToolOutput::set_success(
                CLASSIFIER_PERMISSIONS_ENABLED_SETTING_KEY,
                Value::Bool(false),
                Value::Bool(true)
            )
        );

        let get_result = tool
            .execute(
                json!({ "setting": CLASSIFIER_PERMISSIONS_ENABLED_SETTING_KEY }),
                &context,
            )
            .await
            .expect("get classifier setting should succeed");
        let get_output = parse_output(get_result);
        assert_eq!(
            get_output,
            ConfigToolOutput::get_success(
                CLASSIFIER_PERMISSIONS_ENABLED_SETTING_KEY,
                Value::Bool(true)
            )
        );
    }

    #[tokio::test]
    async fn test_config_tool_classifier_permissions_enabled_reads_legacy_key_and_rewrites_current_key(
    ) {
        let _guard = lock_env([
            ("CLASSIFIERPERMISSIONSENABLED", None::<&str>),
            (
                LEGACY_CLASSIFIER_PERMISSIONS_ENABLED_CONFIG_KEY,
                None::<&str>,
            ),
        ]);
        let config = create_test_config();
        config
            .set_param(LEGACY_CLASSIFIER_PERMISSIONS_ENABLED_CONFIG_KEY, true)
            .expect("legacy key should be written");
        let tool = ConfigTool::with_config(config.clone());
        let context = ToolContext::default();

        let get_result = tool
            .execute(
                json!({ "setting": CLASSIFIER_PERMISSIONS_ENABLED_SETTING_KEY }),
                &context,
            )
            .await
            .expect("legacy classifier setting should be readable");
        let get_output = parse_output(get_result);
        assert_eq!(
            get_output,
            ConfigToolOutput::get_success(
                CLASSIFIER_PERMISSIONS_ENABLED_SETTING_KEY,
                Value::Bool(true)
            )
        );

        let set_result = tool
            .execute(
                json!({
                    "setting": CLASSIFIER_PERMISSIONS_ENABLED_SETTING_KEY,
                    "value": false
                }),
                &context,
            )
            .await
            .expect("current classifier setting should be writable");
        let set_output = parse_output(set_result);
        assert_eq!(
            set_output,
            ConfigToolOutput::set_success(
                CLASSIFIER_PERMISSIONS_ENABLED_SETTING_KEY,
                Value::Bool(true),
                Value::Bool(false)
            )
        );

        assert!(!config
            .get_param::<bool>(CLASSIFIER_PERMISSIONS_ENABLED_SETTING_KEY)
            .expect("current classifier key should exist"));
        assert!(matches!(
            config.get_param::<bool>(LEGACY_CLASSIFIER_PERMISSIONS_ENABLED_CONFIG_KEY),
            Err(ConfigError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn test_config_tool_reports_known_but_unimplemented_setting_on_get() {
        let tool = create_test_tool();

        let result = tool
            .execute(
                json!({ "setting": VOICE_ENABLED_SETTING_KEY }),
                &ToolContext::default(),
            )
            .await
            .expect("tool should return structured failure");
        let output = parse_output(result);

        assert!(!output.success);
        assert_eq!(output.operation.as_deref(), Some("get"));
        assert_eq!(output.setting.as_deref(), Some(VOICE_ENABLED_SETTING_KEY));
        assert!(output
            .error
            .as_deref()
            .expect("error message")
            .contains("Known upstream setting"));
    }

    #[tokio::test]
    async fn test_config_tool_supports_host_backed_voice_enabled_setting() {
        let voice_enabled = Arc::new(tokio::sync::Mutex::new(false));
        let read_state = voice_enabled.clone();
        let write_state = voice_enabled.clone();
        let tool = ConfigTool::new().with_voice_enabled_callbacks(
            Arc::new(move || {
                let read_state = read_state.clone();
                Box::pin(async move { Ok(*read_state.lock().await) })
            }),
            Arc::new(move |enabled| {
                let write_state = write_state.clone();
                Box::pin(async move {
                    *write_state.lock().await = enabled;
                    Ok(enabled)
                })
            }),
        );
        let context = ToolContext::default();

        let definition = tool.get_definition();
        assert!(definition.description.contains(VOICE_ENABLED_SETTING_KEY));
        assert!(!definition
            .description
            .contains("needs a host-backed callback"));

        let get_result = tool
            .execute(json!({ "setting": VOICE_ENABLED_SETTING_KEY }), &context)
            .await
            .expect("host-backed get should succeed");
        let get_output = parse_output(get_result);
        assert_eq!(
            get_output,
            ConfigToolOutput::get_success(VOICE_ENABLED_SETTING_KEY, Value::Bool(false))
        );

        let set_result = tool
            .execute(
                json!({ "setting": VOICE_ENABLED_SETTING_KEY, "value": "true" }),
                &context,
            )
            .await
            .expect("host-backed set should succeed");
        let set_output = parse_output(set_result);
        assert_eq!(
            set_output,
            ConfigToolOutput::set_success(
                VOICE_ENABLED_SETTING_KEY,
                Value::Bool(false),
                Value::Bool(true)
            )
        );
    }

    #[tokio::test]
    async fn test_config_tool_reports_known_but_unimplemented_setting_on_set() {
        let tool = create_test_tool();

        let result = tool
            .execute(
                json!({
                    "setting": TASK_COMPLETE_NOTIF_ENABLED_SETTING_KEY,
                    "value": true
                }),
                &ToolContext::default(),
            )
            .await
            .expect("tool should return structured failure");
        let output = parse_output(result);

        assert!(!output.success);
        assert_eq!(output.operation.as_deref(), Some("set"));
        assert_eq!(
            output.setting.as_deref(),
            Some(TASK_COMPLETE_NOTIF_ENABLED_SETTING_KEY)
        );
        assert!(output
            .error
            .as_deref()
            .expect("error message")
            .contains("mobile push control plane"));
    }

    #[tokio::test]
    async fn test_config_tool_remote_control_at_startup_does_not_alias_os_auto_launch() {
        let tool = create_test_tool();

        let result = tool
            .execute(
                json!({ "setting": REMOTE_CONTROL_AT_STARTUP_SETTING_KEY }),
                &ToolContext::default(),
            )
            .await
            .expect("tool should return structured failure");
        let output = parse_output(result);

        assert!(!output.success);
        assert_eq!(output.operation.as_deref(), Some("get"));
        assert_eq!(
            output.setting.as_deref(),
            Some(REMOTE_CONTROL_AT_STARTUP_SETTING_KEY)
        );
        let error = output.error.as_deref().expect("error message");
        assert!(error.contains("OS auto-launch"));
        assert!(error.contains("remote-control-at-startup"));
    }

    #[tokio::test]
    async fn test_config_tool_mobile_push_settings_remain_unsupported_without_control_plane() {
        let tool = create_test_tool();

        for setting in [
            TASK_COMPLETE_NOTIF_ENABLED_SETTING_KEY,
            INPUT_NEEDED_NOTIF_ENABLED_SETTING_KEY,
            AGENT_PUSH_NOTIF_ENABLED_SETTING_KEY,
        ] {
            let result = tool
                .execute(
                    json!({
                        "setting": setting,
                        "value": true
                    }),
                    &ToolContext::default(),
                )
                .await
                .expect("tool should return structured failure");
            let output = parse_output(result);

            assert!(!output.success, "{setting} should remain unsupported");
            assert_eq!(output.operation.as_deref(), Some("set"));
            assert_eq!(output.setting.as_deref(), Some(setting));
            assert!(output
                .error
                .as_deref()
                .expect("error message")
                .contains("mobile push control plane"));
        }
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
