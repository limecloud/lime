use crate::agent_tools::catalog::{
    tool_catalog_entries_for_surface, tool_catalog_entry, workspace_default_allowed_tool_names,
    ToolPermissionPlane, WorkspaceToolSurface,
};
use aster::permission::{ParameterRestriction, PermissionScope, RestrictionType, ToolPermission};
use lime_core::config::{
    ToolExecutionOverrideConfig as ConfigToolExecutionOverrideConfig,
    ToolExecutionPolicyConfig as ConfigToolExecutionPolicyConfig,
    ToolExecutionRestrictionProfileConfig as ConfigToolExecutionRestrictionProfileConfig,
    ToolExecutionSandboxProfileConfig as ConfigToolExecutionSandboxProfileConfig,
    ToolExecutionWarningPolicyConfig as ConfigToolExecutionWarningPolicyConfig,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map as JsonMap, Value as JsonValue};
use std::collections::HashMap;

const DURABLE_MEMORY_PATH_PATTERN: &str = r"^/memories(?:/.*)?$";
const SAFE_HTTPS_URL_PATTERN: &str = r"^https://[^\s]+$";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolExecutionWarningPolicy {
    None,
    ShellCommandRisk,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolExecutionRestrictionProfile {
    None,
    WorkspacePathRequired,
    WorkspacePathOptional,
    WorkspaceAbsolutePathRequired,
    WorkspaceShellCommand,
    AnalyzeImageInput,
    SafeHttpsUrlRequired,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolExecutionSandboxProfile {
    None,
    WorkspaceCommand,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolExecutionPolicySource {
    Default,
    Persisted,
    Runtime,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolExecutionPolicy {
    pub warning_policy: ToolExecutionWarningPolicy,
    pub restriction_profile: ToolExecutionRestrictionProfile,
    pub sandbox_profile: ToolExecutionSandboxProfile,
}

impl Default for ToolExecutionPolicy {
    fn default() -> Self {
        Self {
            warning_policy: ToolExecutionWarningPolicy::None,
            restriction_profile: ToolExecutionRestrictionProfile::None,
            sandbox_profile: ToolExecutionSandboxProfile::None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolExecutionPolicyResolution {
    pub policy: ToolExecutionPolicy,
    pub warning_policy_source: ToolExecutionPolicySource,
    pub restriction_profile_source: ToolExecutionPolicySource,
    pub sandbox_profile_source: ToolExecutionPolicySource,
}

#[derive(Debug, Clone, Copy)]
pub struct WorkspaceExecutionPermissionInput<'a> {
    pub surface: WorkspaceToolSurface,
    pub workspace_root: &'a str,
    pub auto_mode: bool,
    pub execution_policy_input: ToolExecutionResolverInput<'a>,
}

#[derive(Debug, Clone)]
struct WorkspacePermissionPatterns {
    workspace_path_pattern: String,
    workspace_abs_path_pattern: String,
    analyze_image_path_pattern: String,
    safe_https_url_pattern: String,
    shell_allow_pattern: String,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct ToolExecutionResolverInput<'a> {
    pub persisted_policy: Option<&'a ConfigToolExecutionPolicyConfig>,
    pub request_metadata: Option<&'a JsonValue>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct ToolExecutionPolicyOverride {
    warning_policy: Option<ToolExecutionWarningPolicy>,
    restriction_profile: Option<ToolExecutionRestrictionProfile>,
    sandbox_profile: Option<ToolExecutionSandboxProfile>,
}

pub fn tool_execution_policy(tool_name: &str) -> ToolExecutionPolicy {
    let normalized_name = tool_name.trim();
    let Some(catalog_entry) = tool_catalog_entry(normalized_name) else {
        return ToolExecutionPolicy::default();
    };

    match catalog_entry.name {
        "read" | "write" | "edit" | "lsp" => ToolExecutionPolicy {
            restriction_profile: ToolExecutionRestrictionProfile::WorkspacePathRequired,
            ..ToolExecutionPolicy::default()
        },
        "glob" | "grep" => ToolExecutionPolicy {
            restriction_profile: ToolExecutionRestrictionProfile::WorkspacePathOptional,
            ..ToolExecutionPolicy::default()
        },
        "bash" => ToolExecutionPolicy {
            warning_policy: ToolExecutionWarningPolicy::ShellCommandRisk,
            restriction_profile: ToolExecutionRestrictionProfile::WorkspaceShellCommand,
            sandbox_profile: ToolExecutionSandboxProfile::WorkspaceCommand,
        },
        "NotebookEdit" => ToolExecutionPolicy {
            restriction_profile: ToolExecutionRestrictionProfile::WorkspaceAbsolutePathRequired,
            ..ToolExecutionPolicy::default()
        },
        "analyze_image" => ToolExecutionPolicy {
            restriction_profile: ToolExecutionRestrictionProfile::AnalyzeImageInput,
            ..ToolExecutionPolicy::default()
        },
        "WebFetch" => ToolExecutionPolicy {
            restriction_profile: ToolExecutionRestrictionProfile::SafeHttpsUrlRequired,
            ..ToolExecutionPolicy::default()
        },
        _ => ToolExecutionPolicy::default(),
    }
}

pub fn resolve_tool_execution_policy(
    tool_name: &str,
    input: ToolExecutionResolverInput<'_>,
) -> ToolExecutionPolicy {
    resolve_tool_execution_policy_resolution(tool_name, input).policy
}

pub fn resolve_tool_execution_policy_resolution(
    tool_name: &str,
    input: ToolExecutionResolverInput<'_>,
) -> ToolExecutionPolicyResolution {
    let default_policy = tool_execution_policy(tool_name);
    let persisted_override =
        extract_persisted_tool_execution_override(tool_name, input.persisted_policy);
    let runtime_override =
        extract_runtime_execution_policy_override(tool_name, input.request_metadata);

    apply_tool_execution_override(
        apply_tool_execution_override(
            ToolExecutionPolicyResolution {
                policy: default_policy,
                warning_policy_source: ToolExecutionPolicySource::Default,
                restriction_profile_source: ToolExecutionPolicySource::Default,
                sandbox_profile_source: ToolExecutionPolicySource::Default,
            },
            persisted_override,
            ToolExecutionPolicySource::Persisted,
        ),
        runtime_override,
        ToolExecutionPolicySource::Runtime,
    )
}

pub fn build_workspace_shell_allow_pattern(
    escaped_root: &str,
    allow_extended_shell_commands: bool,
) -> String {
    if allow_extended_shell_commands {
        return String::from(r"(?s)^\s*\S.*$");
    }

    format!(
        r"^\s*(?:cd\s+({escaped_root}|\.|\./|\.\./)|pwd|ls(?:\s+[^;&|]+)?|find\s+({escaped_root}|\.|\./|\.\./)[^;&|]*|rg\b[^;&|]*|grep\b[^;&|]*|cat\s+({escaped_root}|\.|\./|\.\./)[^;&|]*)\s*$"
    )
}

pub fn should_auto_approve_tool_warnings(
    tool_name: &str,
    auto_mode: bool,
    input: ToolExecutionResolverInput<'_>,
) -> bool {
    auto_mode
        && matches!(
            resolve_tool_execution_policy(tool_name, input).warning_policy,
            ToolExecutionWarningPolicy::ShellCommandRisk
        )
}

pub fn build_workspace_execution_permissions(
    input: WorkspaceExecutionPermissionInput<'_>,
) -> Vec<ToolPermission> {
    let patterns = build_workspace_permission_patterns(input.workspace_root, input.auto_mode);
    let mut permissions = tool_catalog_entries_for_surface(input.surface)
        .into_iter()
        .filter_map(|entry| {
            build_parameter_restricted_permission(
                entry.name,
                input.auto_mode,
                &patterns,
                input.execution_policy_input,
            )
        })
        .collect::<Vec<_>>();

    if input.auto_mode {
        permissions.push(ToolPermission {
            tool: "*".to_string(),
            allowed: true,
            priority: 1000,
            conditions: Vec::new(),
            parameter_restrictions: Vec::new(),
            scope: PermissionScope::Session,
            reason: Some("Auto 模式：允许所有工具与参数".to_string()),
            expires_at: None,
            metadata: HashMap::new(),
        });
    }

    for tool_name in workspace_default_allowed_tool_names(input.surface) {
        permissions.push(ToolPermission {
            tool: tool_name.to_string(),
            allowed: true,
            priority: 88,
            conditions: Vec::new(),
            parameter_restrictions: Vec::new(),
            scope: PermissionScope::Session,
            reason: Some(format!("允许默认工具: {tool_name}")),
            expires_at: None,
            metadata: HashMap::new(),
        });
    }

    permissions.push(ToolPermission {
        tool: "*".to_string(),
        allowed: false,
        priority: 10,
        conditions: Vec::new(),
        parameter_restrictions: Vec::new(),
        scope: PermissionScope::Session,
        reason: Some("workspace 安全策略：未显式授权的工具默认拒绝".to_string()),
        expires_at: None,
        metadata: HashMap::new(),
    });

    permissions
}

fn extract_persisted_tool_execution_override(
    tool_name: &str,
    persisted_policy: Option<&ConfigToolExecutionPolicyConfig>,
) -> ToolExecutionPolicyOverride {
    let Some(tool_override) = persisted_policy
        .and_then(|policy| find_tool_override_config(&policy.tool_overrides, tool_name))
    else {
        return ToolExecutionPolicyOverride::default();
    };

    ToolExecutionPolicyOverride {
        warning_policy: tool_override
            .warning_policy
            .map(convert_warning_policy_config),
        restriction_profile: tool_override
            .restriction_profile
            .map(convert_restriction_profile_config),
        sandbox_profile: tool_override
            .sandbox_profile
            .map(convert_sandbox_profile_config),
    }
}

fn extract_runtime_execution_policy_override(
    tool_name: &str,
    request_metadata: Option<&JsonValue>,
) -> ToolExecutionPolicyOverride {
    let Some(execution_policy) = extract_runtime_execution_policy_object(request_metadata) else {
        return ToolExecutionPolicyOverride::default();
    };

    let tool_overrides = find_named_object(execution_policy, &["tool_overrides", "toolOverrides"])
        .unwrap_or(execution_policy);
    let Some(tool_override) = find_case_insensitive_object(tool_overrides, tool_name) else {
        return ToolExecutionPolicyOverride::default();
    };

    ToolExecutionPolicyOverride {
        warning_policy: extract_named_string(tool_override, &["warning_policy", "warningPolicy"])
            .and_then(parse_warning_policy),
        restriction_profile: extract_named_string(
            tool_override,
            &["restriction_profile", "restrictionProfile"],
        )
        .and_then(parse_restriction_profile),
        sandbox_profile: extract_named_string(
            tool_override,
            &["sandbox_profile", "sandboxProfile"],
        )
        .and_then(parse_sandbox_profile),
    }
}

fn extract_runtime_execution_policy_object(
    request_metadata: Option<&JsonValue>,
) -> Option<&JsonMap<String, JsonValue>> {
    let harness = extract_runtime_harness_object(request_metadata)?;
    find_named_object(harness, &["execution_policy", "executionPolicy"])
}

fn extract_runtime_harness_object(
    request_metadata: Option<&JsonValue>,
) -> Option<&JsonMap<String, JsonValue>> {
    let metadata = request_metadata?.as_object()?;
    metadata
        .get("harness")
        .and_then(JsonValue::as_object)
        .or(Some(metadata))
}

fn find_named_object<'a>(
    object: &'a JsonMap<String, JsonValue>,
    keys: &[&str],
) -> Option<&'a JsonMap<String, JsonValue>> {
    keys.iter()
        .filter_map(|key| object.get(*key))
        .find_map(JsonValue::as_object)
}

fn find_case_insensitive_object<'a>(
    object: &'a JsonMap<String, JsonValue>,
    key: &str,
) -> Option<&'a JsonMap<String, JsonValue>> {
    let normalized_key = key.trim();
    object
        .get(normalized_key)
        .and_then(JsonValue::as_object)
        .or_else(|| {
            object.iter().find_map(|(candidate, value)| {
                candidate
                    .trim()
                    .eq_ignore_ascii_case(normalized_key)
                    .then_some(value)
                    .and_then(JsonValue::as_object)
            })
        })
}

fn find_tool_override_config<'a>(
    tool_overrides: &'a HashMap<String, ConfigToolExecutionOverrideConfig>,
    tool_name: &str,
) -> Option<&'a ConfigToolExecutionOverrideConfig> {
    let normalized_name = tool_name.trim();
    tool_overrides.get(normalized_name).or_else(|| {
        tool_overrides
            .iter()
            .find_map(|(candidate, override_config)| {
                candidate
                    .trim()
                    .eq_ignore_ascii_case(normalized_name)
                    .then_some(override_config)
            })
    })
}

fn extract_named_string<'a>(
    object: &'a JsonMap<String, JsonValue>,
    keys: &[&str],
) -> Option<&'a str> {
    keys.iter()
        .filter_map(|key| object.get(*key))
        .find_map(JsonValue::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn apply_tool_execution_override(
    mut base: ToolExecutionPolicyResolution,
    tool_override: ToolExecutionPolicyOverride,
    source: ToolExecutionPolicySource,
) -> ToolExecutionPolicyResolution {
    if let Some(value) = tool_override.warning_policy {
        base.policy.warning_policy = value;
        base.warning_policy_source = source;
    }
    if let Some(value) = tool_override.restriction_profile {
        base.policy.restriction_profile = value;
        base.restriction_profile_source = source;
    }
    if let Some(value) = tool_override.sandbox_profile {
        base.policy.sandbox_profile = value;
        base.sandbox_profile_source = source;
    }
    base
}

fn convert_warning_policy_config(
    value: ConfigToolExecutionWarningPolicyConfig,
) -> ToolExecutionWarningPolicy {
    match value {
        ConfigToolExecutionWarningPolicyConfig::None => ToolExecutionWarningPolicy::None,
        ConfigToolExecutionWarningPolicyConfig::ShellCommandRisk => {
            ToolExecutionWarningPolicy::ShellCommandRisk
        }
    }
}

fn convert_restriction_profile_config(
    value: ConfigToolExecutionRestrictionProfileConfig,
) -> ToolExecutionRestrictionProfile {
    match value {
        ConfigToolExecutionRestrictionProfileConfig::None => ToolExecutionRestrictionProfile::None,
        ConfigToolExecutionRestrictionProfileConfig::WorkspacePathRequired => {
            ToolExecutionRestrictionProfile::WorkspacePathRequired
        }
        ConfigToolExecutionRestrictionProfileConfig::WorkspacePathOptional => {
            ToolExecutionRestrictionProfile::WorkspacePathOptional
        }
        ConfigToolExecutionRestrictionProfileConfig::WorkspaceAbsolutePathRequired => {
            ToolExecutionRestrictionProfile::WorkspaceAbsolutePathRequired
        }
        ConfigToolExecutionRestrictionProfileConfig::WorkspaceShellCommand => {
            ToolExecutionRestrictionProfile::WorkspaceShellCommand
        }
        ConfigToolExecutionRestrictionProfileConfig::AnalyzeImageInput => {
            ToolExecutionRestrictionProfile::AnalyzeImageInput
        }
        ConfigToolExecutionRestrictionProfileConfig::SafeHttpsUrlRequired => {
            ToolExecutionRestrictionProfile::SafeHttpsUrlRequired
        }
    }
}

fn convert_sandbox_profile_config(
    value: ConfigToolExecutionSandboxProfileConfig,
) -> ToolExecutionSandboxProfile {
    match value {
        ConfigToolExecutionSandboxProfileConfig::None => ToolExecutionSandboxProfile::None,
        ConfigToolExecutionSandboxProfileConfig::WorkspaceCommand => {
            ToolExecutionSandboxProfile::WorkspaceCommand
        }
    }
}

fn parse_warning_policy(value: &str) -> Option<ToolExecutionWarningPolicy> {
    match value.trim() {
        "none" => Some(ToolExecutionWarningPolicy::None),
        "shell_command_risk" => Some(ToolExecutionWarningPolicy::ShellCommandRisk),
        _ => None,
    }
}

fn parse_restriction_profile(value: &str) -> Option<ToolExecutionRestrictionProfile> {
    match value.trim() {
        "none" => Some(ToolExecutionRestrictionProfile::None),
        "workspace_path_required" => Some(ToolExecutionRestrictionProfile::WorkspacePathRequired),
        "workspace_path_optional" => Some(ToolExecutionRestrictionProfile::WorkspacePathOptional),
        "workspace_absolute_path_required" => {
            Some(ToolExecutionRestrictionProfile::WorkspaceAbsolutePathRequired)
        }
        "workspace_shell_command" => Some(ToolExecutionRestrictionProfile::WorkspaceShellCommand),
        "analyze_image_input" => Some(ToolExecutionRestrictionProfile::AnalyzeImageInput),
        "safe_https_url_required" => Some(ToolExecutionRestrictionProfile::SafeHttpsUrlRequired),
        _ => None,
    }
}

fn parse_sandbox_profile(value: &str) -> Option<ToolExecutionSandboxProfile> {
    match value.trim() {
        "none" => Some(ToolExecutionSandboxProfile::None),
        "workspace_command" => Some(ToolExecutionSandboxProfile::WorkspaceCommand),
        _ => None,
    }
}

fn build_workspace_permission_patterns(
    workspace_root: &str,
    auto_mode: bool,
) -> WorkspacePermissionPatterns {
    let escaped_root = regex::escape(workspace_root.trim());
    WorkspacePermissionPatterns {
        workspace_path_pattern: format!(
            r"^(?:({escaped_root}|\.|\./|\.\./).*$|{DURABLE_MEMORY_PATH_PATTERN})"
        ),
        workspace_abs_path_pattern: format!(r"^({escaped_root}).*$"),
        analyze_image_path_pattern: format!(
            r"^(base64:[A-Za-z0-9+/=]+|file://({escaped_root}).*|({escaped_root}|\.|\./|\.\./).*)$"
        ),
        safe_https_url_pattern: SAFE_HTTPS_URL_PATTERN.to_string(),
        shell_allow_pattern: build_workspace_shell_allow_pattern(&escaped_root, auto_mode),
    }
}

fn build_parameter_restricted_permission(
    tool_name: &str,
    auto_mode: bool,
    patterns: &WorkspacePermissionPatterns,
    execution_policy_input: ToolExecutionResolverInput<'_>,
) -> Option<ToolPermission> {
    let catalog_entry = tool_catalog_entry(tool_name)?;
    if catalog_entry.permission_plane != ToolPermissionPlane::ParameterRestricted {
        return None;
    }

    let policy = resolve_tool_execution_policy(tool_name, execution_policy_input);
    let parameter_restrictions = if auto_mode {
        Vec::new()
    } else {
        build_parameter_restrictions(tool_name, policy.restriction_profile, patterns)
    };

    Some(ToolPermission {
        tool: tool_name.to_string(),
        allowed: true,
        priority: permission_priority(tool_name),
        conditions: Vec::new(),
        parameter_restrictions,
        scope: PermissionScope::Session,
        reason: Some(permission_reason(
            tool_name,
            policy.restriction_profile,
            auto_mode,
        )),
        expires_at: None,
        metadata: HashMap::new(),
    })
}

fn build_parameter_restrictions(
    tool_name: &str,
    profile: ToolExecutionRestrictionProfile,
    patterns: &WorkspacePermissionPatterns,
) -> Vec<ParameterRestriction> {
    match profile {
        ToolExecutionRestrictionProfile::None => Vec::new(),
        ToolExecutionRestrictionProfile::WorkspacePathRequired => {
            vec![pattern_restriction(
                "path",
                &patterns.workspace_path_pattern,
                true,
                Some(format!(
                    "{tool_name}.path 必须在 workspace、相对路径或 `/memories/` 内"
                )),
            )]
        }
        ToolExecutionRestrictionProfile::WorkspacePathOptional => {
            vec![pattern_restriction(
                "path",
                &patterns.workspace_path_pattern,
                false,
                Some(format!(
                    "{tool_name}.path 必须在 workspace、相对路径或 `/memories/` 内"
                )),
            )]
        }
        ToolExecutionRestrictionProfile::WorkspaceAbsolutePathRequired => {
            vec![pattern_restriction(
                "notebook_path",
                &patterns.workspace_abs_path_pattern,
                true,
                Some("NotebookEdit.notebook_path 必须是 workspace 内绝对路径".to_string()),
            )]
        }
        ToolExecutionRestrictionProfile::WorkspaceShellCommand => vec![
            pattern_restriction(
                "command",
                &patterns.shell_allow_pattern,
                false,
                Some(format!("{tool_name}.command 仅允许 workspace 内安全命令")),
            ),
            pattern_restriction(
                "cmd",
                &patterns.shell_allow_pattern,
                false,
                Some(format!("{tool_name}.cmd 兼容参数名，规则与 command 一致")),
            ),
        ],
        ToolExecutionRestrictionProfile::AnalyzeImageInput => {
            vec![pattern_restriction(
                "file_path",
                &patterns.analyze_image_path_pattern,
                true,
                Some(
                    "analyze_image.file_path 仅允许 base64、workspace 内绝对路径或相对路径"
                        .to_string(),
                ),
            )]
        }
        ToolExecutionRestrictionProfile::SafeHttpsUrlRequired => {
            vec![pattern_restriction(
                "url",
                &patterns.safe_https_url_pattern,
                true,
                Some("WebFetch.url 仅允许 https 且禁止内网/本机地址".to_string()),
            )]
        }
    }
}

fn pattern_restriction(
    parameter: &str,
    pattern: &str,
    required: bool,
    description: Option<String>,
) -> ParameterRestriction {
    ParameterRestriction {
        parameter: parameter.to_string(),
        restriction_type: RestrictionType::Pattern,
        values: None,
        pattern: Some(pattern.to_string()),
        validator: None,
        min: None,
        max: None,
        required,
        description,
    }
}

fn permission_priority(tool_name: &str) -> i32 {
    match tool_name {
        "read" | "write" | "edit" | "glob" | "grep" => 100,
        "bash" => 90,
        _ => 88,
    }
}

fn permission_reason(
    tool_name: &str,
    profile: ToolExecutionRestrictionProfile,
    auto_mode: bool,
) -> String {
    if auto_mode {
        return match profile {
            ToolExecutionRestrictionProfile::WorkspaceShellCommand => {
                format!("Auto 模式：允许 {tool_name} 执行任意命令")
            }
            ToolExecutionRestrictionProfile::SafeHttpsUrlRequired => {
                format!("Auto 模式：允许 {tool_name} 访问任意 URL")
            }
            ToolExecutionRestrictionProfile::AnalyzeImageInput => {
                format!("Auto 模式：允许 {tool_name} 分析任意图片路径或 base64")
            }
            ToolExecutionRestrictionProfile::WorkspaceAbsolutePathRequired => {
                format!("Auto 模式：允许 {tool_name} 访问任意绝对路径")
            }
            ToolExecutionRestrictionProfile::WorkspacePathRequired
            | ToolExecutionRestrictionProfile::WorkspacePathOptional => {
                format!("Auto 模式：允许 {tool_name} 访问任意路径")
            }
            ToolExecutionRestrictionProfile::None => format!("Auto 模式：允许工具 {tool_name}"),
        };
    }

    match profile {
        ToolExecutionRestrictionProfile::WorkspacePathRequired => {
            format!("仅允许 {tool_name} 访问当前 workspace 或 `/memories/` 内容")
        }
        ToolExecutionRestrictionProfile::WorkspacePathOptional => {
            format!("仅允许 {tool_name} 在当前 workspace 或 `/memories/` 搜索内容")
        }
        ToolExecutionRestrictionProfile::WorkspaceAbsolutePathRequired => {
            format!("仅允许 {tool_name} 访问 workspace 内绝对路径")
        }
        ToolExecutionRestrictionProfile::WorkspaceShellCommand => {
            format!("workspace 安全策略：{tool_name} 仅允许 workspace 内安全命令")
        }
        ToolExecutionRestrictionProfile::AnalyzeImageInput => {
            "允许分析 workspace 内图片或 base64 数据".to_string()
        }
        ToolExecutionRestrictionProfile::SafeHttpsUrlRequired => {
            "允许安全的 WebFetch 请求".to_string()
        }
        ToolExecutionRestrictionProfile::None => format!("允许工具 {tool_name}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use lime_core::config::{
        ToolExecutionOverrideConfig as ConfigToolExecutionOverrideConfig,
        ToolExecutionPolicyConfig as ConfigToolExecutionPolicyConfig,
        ToolExecutionRestrictionProfileConfig as ConfigToolExecutionRestrictionProfileConfig,
        ToolExecutionSandboxProfileConfig as ConfigToolExecutionSandboxProfileConfig,
        ToolExecutionWarningPolicyConfig as ConfigToolExecutionWarningPolicyConfig,
    };
    use serde_json::json;

    #[test]
    fn test_tool_execution_policy_marks_bash_as_sandboxed_shell_risk() {
        let policy = tool_execution_policy("bash");
        assert_eq!(
            policy.warning_policy,
            ToolExecutionWarningPolicy::ShellCommandRisk
        );
        assert_eq!(
            policy.restriction_profile,
            ToolExecutionRestrictionProfile::WorkspaceShellCommand
        );
        assert_eq!(
            policy.sandbox_profile,
            ToolExecutionSandboxProfile::WorkspaceCommand
        );
    }

    #[test]
    fn test_build_workspace_execution_permissions_strict_mode_restricts_parameter_tools() {
        let permissions =
            build_workspace_execution_permissions(WorkspaceExecutionPermissionInput {
                surface: WorkspaceToolSurface::core(),
                workspace_root: "/tmp/workspace",
                auto_mode: false,
                execution_policy_input: ToolExecutionResolverInput::default(),
            });

        let read = permissions
            .iter()
            .find(|permission| permission.tool == "read")
            .expect("read permission should exist");
        assert_eq!(read.parameter_restrictions.len(), 1);
        assert_eq!(read.parameter_restrictions[0].parameter, "path");
        assert!(read.parameter_restrictions[0]
            .pattern
            .as_deref()
            .unwrap_or_default()
            .contains("/tmp/workspace"));

        let bash = permissions
            .iter()
            .find(|permission| permission.tool == "bash")
            .expect("bash permission should exist");
        assert_eq!(bash.parameter_restrictions.len(), 2);
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "*" && !permission.allowed));
        assert!(!permissions
            .iter()
            .any(|permission| permission.tool == "*" && permission.allowed));
    }

    #[test]
    fn test_build_workspace_execution_permissions_auto_mode_adds_wildcard_allow() {
        let permissions =
            build_workspace_execution_permissions(WorkspaceExecutionPermissionInput {
                surface: WorkspaceToolSurface::core(),
                workspace_root: "/tmp/workspace",
                auto_mode: true,
                execution_policy_input: ToolExecutionResolverInput::default(),
            });

        let bash = permissions
            .iter()
            .find(|permission| permission.tool == "bash")
            .expect("bash permission should exist");
        assert!(bash.parameter_restrictions.is_empty());
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "*" && permission.allowed));
    }

    #[test]
    fn test_should_auto_approve_tool_warnings_only_for_shell_risk_tools() {
        let input = ToolExecutionResolverInput::default();

        assert!(should_auto_approve_tool_warnings("bash", true, input));
        assert!(!should_auto_approve_tool_warnings("read", true, input));
        assert!(!should_auto_approve_tool_warnings("bash", false, input));
    }

    #[test]
    fn test_build_workspace_shell_allow_pattern_auto_mode_allows_multiline() {
        let escaped_root = regex::escape("/tmp/workspace");
        let pattern = build_workspace_shell_allow_pattern(&escaped_root, true);
        let regex = regex::Regex::new(&pattern).expect("pattern should compile");

        assert!(regex.is_match("python3 <<'EOF'\nprint('hello')\nEOF"));
    }

    #[test]
    fn test_resolve_tool_execution_policy_allows_persisted_override_to_replace_default() {
        let persisted_policy = ConfigToolExecutionPolicyConfig {
            tool_overrides: HashMap::from([(
                "bash".to_string(),
                ConfigToolExecutionOverrideConfig {
                    warning_policy: Some(ConfigToolExecutionWarningPolicyConfig::None),
                    restriction_profile: Some(
                        ConfigToolExecutionRestrictionProfileConfig::WorkspacePathRequired,
                    ),
                    sandbox_profile: Some(ConfigToolExecutionSandboxProfileConfig::None),
                },
            )]),
        };

        let policy = resolve_tool_execution_policy(
            "bash",
            ToolExecutionResolverInput {
                persisted_policy: Some(&persisted_policy),
                request_metadata: None,
            },
        );

        assert_eq!(policy.warning_policy, ToolExecutionWarningPolicy::None);
        assert_eq!(
            policy.restriction_profile,
            ToolExecutionRestrictionProfile::WorkspacePathRequired
        );
        assert_eq!(policy.sandbox_profile, ToolExecutionSandboxProfile::None);
    }

    #[test]
    fn test_resolve_tool_execution_policy_runtime_override_beats_persisted_policy() {
        let persisted_policy = ConfigToolExecutionPolicyConfig {
            tool_overrides: HashMap::from([(
                "bash".to_string(),
                ConfigToolExecutionOverrideConfig {
                    warning_policy: Some(ConfigToolExecutionWarningPolicyConfig::None),
                    restriction_profile: Some(
                        ConfigToolExecutionRestrictionProfileConfig::WorkspacePathRequired,
                    ),
                    sandbox_profile: Some(ConfigToolExecutionSandboxProfileConfig::None),
                },
            )]),
        };
        let request_metadata = json!({
            "harness": {
                "executionPolicy": {
                    "toolOverrides": {
                        "BASH": {
                            "warningPolicy": "shell_command_risk",
                            "restrictionProfile": "workspace_shell_command",
                            "sandboxProfile": "workspace_command"
                        }
                    }
                }
            }
        });

        let policy = resolve_tool_execution_policy(
            "bash",
            ToolExecutionResolverInput {
                persisted_policy: Some(&persisted_policy),
                request_metadata: Some(&request_metadata),
            },
        );

        assert_eq!(
            policy.warning_policy,
            ToolExecutionWarningPolicy::ShellCommandRisk
        );
        assert_eq!(
            policy.restriction_profile,
            ToolExecutionRestrictionProfile::WorkspaceShellCommand
        );
        assert_eq!(
            policy.sandbox_profile,
            ToolExecutionSandboxProfile::WorkspaceCommand
        );
    }

    #[test]
    fn test_resolve_tool_execution_policy_resolution_tracks_mixed_sources_per_field() {
        let persisted_policy = ConfigToolExecutionPolicyConfig {
            tool_overrides: HashMap::from([(
                "bash".to_string(),
                ConfigToolExecutionOverrideConfig {
                    warning_policy: Some(ConfigToolExecutionWarningPolicyConfig::None),
                    restriction_profile: None,
                    sandbox_profile: None,
                },
            )]),
        };
        let request_metadata = json!({
            "harness": {
                "executionPolicy": {
                    "toolOverrides": {
                        "bash": {
                            "sandboxProfile": "none"
                        }
                    }
                }
            }
        });

        let resolution = resolve_tool_execution_policy_resolution(
            "bash",
            ToolExecutionResolverInput {
                persisted_policy: Some(&persisted_policy),
                request_metadata: Some(&request_metadata),
            },
        );

        assert_eq!(
            resolution.policy.warning_policy,
            ToolExecutionWarningPolicy::None
        );
        assert_eq!(
            resolution.policy.restriction_profile,
            ToolExecutionRestrictionProfile::WorkspaceShellCommand
        );
        assert_eq!(
            resolution.policy.sandbox_profile,
            ToolExecutionSandboxProfile::None
        );
        assert_eq!(
            resolution.warning_policy_source,
            ToolExecutionPolicySource::Persisted
        );
        assert_eq!(
            resolution.restriction_profile_source,
            ToolExecutionPolicySource::Default
        );
        assert_eq!(
            resolution.sandbox_profile_source,
            ToolExecutionPolicySource::Runtime
        );
    }

    #[test]
    fn test_build_workspace_execution_permissions_respects_runtime_override() {
        let request_metadata = json!({
            "harness": {
                "execution_policy": {
                    "tool_overrides": {
                        "bash": {
                            "restriction_profile": "none"
                        }
                    }
                }
            }
        });

        let permissions =
            build_workspace_execution_permissions(WorkspaceExecutionPermissionInput {
                surface: WorkspaceToolSurface::core(),
                workspace_root: "/tmp/workspace",
                auto_mode: false,
                execution_policy_input: ToolExecutionResolverInput {
                    persisted_policy: None,
                    request_metadata: Some(&request_metadata),
                },
            });

        let bash = permissions
            .iter()
            .find(|permission| permission.tool == "bash")
            .expect("bash permission should exist");
        assert!(bash.parameter_restrictions.is_empty());
    }
}
