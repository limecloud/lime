//! Hook 加载器
//!
//! 从配置文件加载 hooks

use super::registry::{register_hook, register_legacy_hook, SharedHookRegistry};
use super::types::{HookConfig, HookEvent, LegacyHookConfig};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use tracing::{error, warn};

/// Hooks 配置文件结构（新格式）
#[allow(dead_code)]
#[derive(Debug, serde::Deserialize)]
struct HooksConfigNew {
    hooks: HashMap<String, serde_json::Value>,
}

/// Hooks 配置文件结构（旧格式）
#[allow(dead_code)]
#[derive(Debug, serde::Deserialize)]
struct HooksConfigLegacy {
    hooks: Vec<LegacyHookConfig>,
}

/// 验证 Hook 事件名称
fn is_valid_hook_event(event: &str) -> bool {
    matches!(
        event,
        "PreToolUse"
            | "PostToolUse"
            | "PostToolUseFailure"
            | "Notification"
            | "UserPromptSubmit"
            | "SessionStart"
            | "SessionEnd"
            | "Stop"
            | "SubagentStart"
            | "SubagentStop"
            | "PreCompact"
            | "PermissionRequest"
            | "BeforeSetup"
            | "AfterSetup"
            | "CommandsLoaded"
            | "ToolsLoaded"
            | "McpConfigsLoaded"
            | "PluginsInitialized"
            | "AfterHooks"
    )
}

/// 解析事件名称
fn parse_event(event: &str) -> Option<HookEvent> {
    match event {
        "PreToolUse" => Some(HookEvent::PreToolUse),
        "PostToolUse" => Some(HookEvent::PostToolUse),
        "PostToolUseFailure" => Some(HookEvent::PostToolUseFailure),
        "Notification" => Some(HookEvent::Notification),
        "UserPromptSubmit" => Some(HookEvent::UserPromptSubmit),
        "SessionStart" => Some(HookEvent::SessionStart),
        "SessionEnd" => Some(HookEvent::SessionEnd),
        "Stop" => Some(HookEvent::Stop),
        "SubagentStart" => Some(HookEvent::SubagentStart),
        "SubagentStop" => Some(HookEvent::SubagentStop),
        "PreCompact" => Some(HookEvent::PreCompact),
        "PermissionRequest" => Some(HookEvent::PermissionRequest),
        "BeforeSetup" => Some(HookEvent::BeforeSetup),
        "AfterSetup" => Some(HookEvent::AfterSetup),
        "CommandsLoaded" => Some(HookEvent::CommandsLoaded),
        "ToolsLoaded" => Some(HookEvent::ToolsLoaded),
        "McpConfigsLoaded" => Some(HookEvent::McpConfigsLoaded),
        "PluginsInitialized" => Some(HookEvent::PluginsInitialized),
        "AfterHooks" => Some(HookEvent::AfterHooks),
        _ => None,
    }
}

/// 从配置文件加载 hooks
pub fn load_hooks_from_file(config_path: &Path) -> Result<(), String> {
    if !config_path.exists() {
        return Ok(());
    }

    let content = fs::read_to_string(config_path)
        .map_err(|e| format!("Failed to read {}: {}", config_path.display(), e))?;

    let json: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse {}: {}", config_path.display(), e))?;

    // 检查 hooks 字段
    let hooks = match json.get("hooks") {
        Some(h) => h,
        None => return Ok(()),
    };

    // 新格式：{ "hooks": { "PreToolUse": [...] } }
    if let Some(obj) = hooks.as_object() {
        for (event_name, hook_value) in obj {
            if !is_valid_hook_event(event_name) {
                warn!("Unknown hook event: {}", event_name);
                continue;
            }

            let event = match parse_event(event_name) {
                Some(e) => e,
                None => continue,
            };

            let hook_array = if hook_value.is_array() {
                hook_value.as_array().unwrap().clone()
            } else {
                vec![hook_value.clone()]
            };

            for hook_json in hook_array {
                match serde_json::from_value::<HookConfig>(hook_json.clone()) {
                    Ok(config) => {
                        register_hook(event, config);
                    }
                    Err(e) => {
                        warn!("Invalid hook config for event {}: {}", event_name, e);
                    }
                }
            }
        }
    }
    // 旧格式：{ "hooks": [...] }
    else if let Some(arr) = hooks.as_array() {
        for hook_json in arr {
            match serde_json::from_value::<LegacyHookConfig>(hook_json.clone()) {
                Ok(config) => {
                    register_legacy_hook(config);
                }
                Err(e) => {
                    warn!("Invalid legacy hook config: {}", e);
                }
            }
        }
    }

    Ok(())
}

/// 从项目目录加载 hooks
pub fn load_project_hooks(project_dir: &Path) -> Result<(), String> {
    // 检查 .claude/settings.json
    let settings_path = project_dir.join(".claude").join("settings.json");
    if let Err(e) = load_hooks_from_file(&settings_path) {
        error!("Failed to load hooks from settings: {}", e);
    }

    // 检查 .claude/hooks/ 目录
    let hooks_dir = project_dir.join(".claude").join("hooks");
    if hooks_dir.exists() && hooks_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&hooks_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().map(|e| e == "json").unwrap_or(false) {
                    if let Err(e) = load_hooks_from_file(&path) {
                        error!("Failed to load hooks from {}: {}", path.display(), e);
                    }
                }
            }
        }
    }

    Ok(())
}

/// 从注册表加载 hooks
pub fn load_hooks_to_registry(
    config_path: &Path,
    registry: &SharedHookRegistry,
) -> Result<(), String> {
    if !config_path.exists() {
        return Ok(());
    }

    let content = fs::read_to_string(config_path)
        .map_err(|e| format!("Failed to read {}: {}", config_path.display(), e))?;

    let json: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse {}: {}", config_path.display(), e))?;

    let hooks = match json.get("hooks") {
        Some(h) => h,
        None => return Ok(()),
    };

    if let Some(obj) = hooks.as_object() {
        for (event_name, hook_value) in obj {
            let event = match parse_event(event_name) {
                Some(e) => e,
                None => {
                    warn!("Unknown hook event: {}", event_name);
                    continue;
                }
            };

            let hook_array = if hook_value.is_array() {
                hook_value.as_array().unwrap().clone()
            } else {
                vec![hook_value.clone()]
            };

            for hook_json in hook_array {
                match serde_json::from_value::<HookConfig>(hook_json) {
                    Ok(config) => {
                        registry.register(event, config);
                    }
                    Err(e) => {
                        warn!("Invalid hook config: {}", e);
                    }
                }
            }
        }
    } else if let Some(arr) = hooks.as_array() {
        for hook_json in arr {
            match serde_json::from_value::<LegacyHookConfig>(hook_json.clone()) {
                Ok(config) => {
                    registry.register_legacy(config);
                }
                Err(e) => {
                    warn!("Invalid legacy hook config: {}", e);
                }
            }
        }
    }

    Ok(())
}
