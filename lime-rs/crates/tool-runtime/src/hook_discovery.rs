//! Codex-compatible Hook discovery and trust evaluation.

use crate::hook_config::{HookEventsConfig, HookHandlerConfig};
use crate::hook_source::PluginHookSource;
use crate::turn_snapshot::{
    RuntimeHookEventName, RuntimeHookExecutionMode, RuntimeHookHandlerType, RuntimeHookSnapshot,
    RuntimeHookSource, RuntimeHookTrustStatus,
};
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

const DEFAULT_TIMEOUT_SEC: u64 = 600;
const SESSION_END_DEFAULT_TIMEOUT_SEC: u64 = 1;
const SESSION_END_MAX_TIMEOUT_SEC: u64 = 3;
const DEFAULT_ADDITIONAL_CONTEXT_LIMIT: usize = 2_500;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HookDiscoveryInput {
    pub lime_home: PathBuf,
    pub cwd: PathBuf,
    pub plugins: Vec<PluginHookSource>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HookDiscoveryErrorInfo {
    pub path: PathBuf,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveredHook {
    pub snapshot: RuntimeHookSnapshot,
    pub(crate) executable: bool,
    pub(crate) env: BTreeMap<String, String>,
}

impl DiscoveredHook {
    pub fn is_executable(&self) -> bool {
        self.executable
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HookDiscoveryReport {
    pub hooks: Vec<DiscoveredHook>,
    pub warnings: Vec<String>,
    pub errors: Vec<HookDiscoveryErrorInfo>,
}

impl HookDiscoveryReport {
    pub fn executable_hooks(&self) -> Vec<DiscoveredHook> {
        self.hooks
            .iter()
            .filter(|hook| hook.is_executable())
            .cloned()
            .collect()
    }

    pub fn snapshots(&self) -> Vec<RuntimeHookSnapshot> {
        self.hooks
            .iter()
            .map(|hook| hook.snapshot.clone())
            .collect()
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
struct ConfigFile {
    #[serde(default)]
    hooks: HooksConfig,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct HooksConfig {
    #[serde(flatten)]
    events: HookEventsConfig,
    #[serde(default)]
    state: BTreeMap<String, HookStateConfig>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct HookStateConfig {
    #[serde(default)]
    enabled: Option<bool>,
    #[serde(default)]
    trusted_hash: Option<String>,
}

struct LoadedSource {
    path: PathBuf,
    key_source: String,
    source: RuntimeHookSource,
    plugin_id: Option<String>,
    events: HookEventsConfig,
    env: BTreeMap<String, String>,
}

pub fn discover_hooks(input: &HookDiscoveryInput) -> HookDiscoveryReport {
    let mut report = HookDiscoveryReport::default();
    let user_path = input.lime_home.join("config.toml");
    let project_path = input.cwd.join(".lime/config.toml");

    let user_config = load_toml_config(&user_path, &mut report);
    let project_config = load_toml_config(&project_path, &mut report);
    let mut states = BTreeMap::new();
    if let Some(config) = user_config.as_ref() {
        states.extend(config.hooks.state.clone());
    }
    if let Some(config) = project_config.as_ref() {
        states.extend(config.hooks.state.clone());
    }

    let mut sources = Vec::new();
    if let Some(config) = user_config {
        push_toml_source(
            &mut sources,
            &user_path,
            RuntimeHookSource::User,
            config.hooks.events,
            &mut report,
        );
    }
    if let Some(config) = project_config {
        push_toml_source(
            &mut sources,
            &project_path,
            RuntimeHookSource::Project,
            config.hooks.events,
            &mut report,
        );
    }
    for plugin in &input.plugins {
        let root = plugin.plugin_root.to_string_lossy().into_owned();
        let data = plugin.plugin_data_root.to_string_lossy().into_owned();
        sources.push(LoadedSource {
            path: plugin.source_path.clone(),
            key_source: format!("{}:{}", plugin.plugin_id, plugin.source_relative_path),
            source: RuntimeHookSource::Plugin,
            plugin_id: Some(plugin.plugin_id.clone()),
            events: plugin.hooks.clone(),
            env: BTreeMap::from([
                ("PLUGIN_ROOT".to_string(), root.clone()),
                ("CLAUDE_PLUGIN_ROOT".to_string(), root),
                ("PLUGIN_DATA".to_string(), data.clone()),
                ("CLAUDE_PLUGIN_DATA".to_string(), data),
            ]),
        });
    }

    let mut display_order = 0_i64;
    for source in sources {
        append_source_hooks(
            source,
            &states,
            &mut display_order,
            &mut report.hooks,
            &mut report.warnings,
        );
    }
    report
}

fn load_toml_config(path: &Path, report: &mut HookDiscoveryReport) -> Option<ConfigFile> {
    let contents = match std::fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return None,
        Err(error) => {
            report.errors.push(HookDiscoveryErrorInfo {
                path: path.to_path_buf(),
                message: format!("failed to read hook config: {error}"),
            });
            return None;
        }
    };
    match toml_edit::de::from_str(&contents) {
        Ok(config) => Some(config),
        Err(error) => {
            report.errors.push(HookDiscoveryErrorInfo {
                path: path.to_path_buf(),
                message: format!("failed to parse hook config: {error}"),
            });
            None
        }
    }
}

fn push_toml_source(
    sources: &mut Vec<LoadedSource>,
    path: &Path,
    source: RuntimeHookSource,
    events: HookEventsConfig,
    report: &mut HookDiscoveryReport,
) {
    if !path.is_file() {
        return;
    }
    match absolute_existing_path(path) {
        Ok(path) => sources.push(LoadedSource {
            key_source: path.display().to_string(),
            path,
            source,
            plugin_id: None,
            events,
            env: BTreeMap::new(),
        }),
        Err(message) => report.errors.push(HookDiscoveryErrorInfo {
            path: path.to_path_buf(),
            message,
        }),
    }
}

fn absolute_existing_path(path: &Path) -> Result<PathBuf, String> {
    std::fs::canonicalize(path)
        .map_err(|error| format!("failed to normalize hook config path: {error}"))
        .and_then(|path| {
            path.is_absolute()
                .then_some(path)
                .ok_or_else(|| "hook config path is not absolute".to_string())
        })
}

fn append_source_hooks(
    source: LoadedSource,
    states: &BTreeMap<String, HookStateConfig>,
    display_order: &mut i64,
    hooks: &mut Vec<DiscoveredHook>,
    warnings: &mut Vec<String>,
) {
    for (event_name, groups) in source.events.into_groups() {
        for (group_index, group) in groups.into_iter().enumerate() {
            let matcher = matcher_for_event(event_name, group.matcher.as_deref());
            if let Some(matcher) = matcher.as_deref() {
                if !valid_matcher(matcher) {
                    warnings.push(format!(
                        "invalid matcher {matcher:?} in {}",
                        source.path.display()
                    ));
                    continue;
                }
            }
            for (handler_index, handler) in group.hooks.iter().cloned().enumerate() {
                let (
                    handler_type,
                    execution_mode,
                    command,
                    mcp_server,
                    mcp_tool,
                    mcp_input,
                    timeout_sec,
                    status_message,
                    additional_context_limit,
                    current_hash,
                ) = match handler {
                    HookHandlerConfig::Command {
                        command,
                        command_windows,
                        timeout_sec,
                        r#async,
                        status_message,
                        additional_context_limit,
                    } => {
                        let command = selected_command(command, command_windows);
                        if command.trim().is_empty() {
                            warnings.push(format!(
                                "skipping empty hook command in {}",
                                source.path.display()
                            ));
                            continue;
                        }
                        let timeout_sec =
                            normalize_timeout(event_name, timeout_sec, &source.path, warnings);
                        let additional_context_limit = normalize_additional_context_limit(
                            event_name,
                            additional_context_limit,
                            &source.path,
                            warnings,
                        );
                        let normalized_limit = additional_context_limit
                            .filter(|limit| *limit != DEFAULT_ADDITIONAL_CONTEXT_LIMIT);
                        let current_hash = command_hook_hash(
                            event_name,
                            matcher.as_deref(),
                            &command,
                            timeout_sec,
                            r#async,
                            status_message.as_deref(),
                            normalized_limit,
                        );
                        (
                            RuntimeHookHandlerType::Command,
                            if r#async {
                                RuntimeHookExecutionMode::Async
                            } else {
                                RuntimeHookExecutionMode::Sync
                            },
                            Some(command),
                            None,
                            None,
                            None,
                            timeout_sec,
                            status_message,
                            additional_context_limit,
                            current_hash,
                        )
                    }
                    HookHandlerConfig::McpTool {
                        server,
                        tool,
                        input,
                        timeout_sec,
                        status_message,
                    } => {
                        if server.trim().is_empty() || tool.trim().is_empty() {
                            warnings.push(format!(
                                "skipping MCP hook with empty server/tool in {}",
                                source.path.display()
                            ));
                            continue;
                        }
                        if event_name == RuntimeHookEventName::SessionEnd {
                            warnings.push(format!(
                                "skipping MCP hook for SessionEnd in {}",
                                source.path.display()
                            ));
                            continue;
                        }
                        let timeout_sec =
                            normalize_timeout(event_name, timeout_sec, &source.path, warnings);
                        let current_hash = mcp_hook_hash(
                            event_name,
                            matcher.as_deref(),
                            &server,
                            &tool,
                            &input,
                            timeout_sec,
                            status_message.as_deref(),
                        );
                        (
                            RuntimeHookHandlerType::McpTool,
                            RuntimeHookExecutionMode::Sync,
                            None,
                            Some(server),
                            Some(tool),
                            Some(serde_json::Value::Object(input)),
                            timeout_sec,
                            status_message,
                            None,
                            current_hash,
                        )
                    }
                    HookHandlerConfig::Prompt {} | HookHandlerConfig::Agent {} => {
                        warnings.push(format!(
                            "skipping unsupported prompt/agent hook in {}",
                            source.path.display()
                        ));
                        continue;
                    }
                };
                let key = format!(
                    "{}:{}:{group_index}:{handler_index}",
                    source.key_source,
                    event_name.key_label()
                );
                let state = states.get(&key);
                let is_managed = matches!(
                    source.source,
                    RuntimeHookSource::System
                        | RuntimeHookSource::Mdm
                        | RuntimeHookSource::CloudRequirements
                        | RuntimeHookSource::CloudManagedConfig
                        | RuntimeHookSource::LegacyManagedConfigFile
                        | RuntimeHookSource::LegacyManagedConfigMdm
                );
                let enabled = is_managed || state.and_then(|state| state.enabled) != Some(false);
                let trust_status = trust_status(
                    is_managed,
                    &current_hash,
                    state.and_then(|state| state.trusted_hash.as_deref()),
                );
                let executable = enabled
                    && matches!(
                        trust_status,
                        RuntimeHookTrustStatus::Managed | RuntimeHookTrustStatus::Trusted
                    );
                hooks.push(DiscoveredHook {
                    snapshot: RuntimeHookSnapshot {
                        key,
                        event_name,
                        handler_type,
                        execution_mode,
                        matcher: matcher.clone(),
                        command,
                        mcp_server,
                        mcp_tool,
                        mcp_input,
                        timeout_sec,
                        status_message,
                        additional_context_limit,
                        source_path: source.path.clone(),
                        source: source.source,
                        plugin_id: source.plugin_id.clone(),
                        display_order: *display_order,
                        enabled,
                        is_managed,
                        current_hash,
                        trust_status,
                    },
                    executable,
                    env: source.env.clone(),
                });
                *display_order += 1;
            }
        }
    }
}

fn selected_command(command: String, command_windows: Option<String>) -> String {
    if cfg!(windows) {
        command_windows.unwrap_or(command)
    } else {
        command
    }
}

fn matcher_for_event(event_name: RuntimeHookEventName, matcher: Option<&str>) -> Option<String> {
    match event_name {
        RuntimeHookEventName::UserPromptSubmit | RuntimeHookEventName::Stop => None,
        _ => matcher.map(ToOwned::to_owned),
    }
}

fn valid_matcher(matcher: &str) -> bool {
    matcher.is_empty()
        || matcher == "*"
        || matcher
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '|')
        || regex::Regex::new(matcher).is_ok()
}

fn normalize_timeout(
    event_name: RuntimeHookEventName,
    timeout_sec: Option<u64>,
    path: &Path,
    warnings: &mut Vec<String>,
) -> u64 {
    if event_name != RuntimeHookEventName::SessionEnd {
        return timeout_sec.unwrap_or(DEFAULT_TIMEOUT_SEC).max(1);
    }
    if timeout_sec.is_some_and(|timeout| timeout > SESSION_END_MAX_TIMEOUT_SEC) {
        warnings.push(format!(
            "clamping SessionEnd hook timeout to {SESSION_END_MAX_TIMEOUT_SEC}s in {}",
            path.display()
        ));
    }
    timeout_sec
        .unwrap_or(SESSION_END_DEFAULT_TIMEOUT_SEC)
        .clamp(1, SESSION_END_MAX_TIMEOUT_SEC)
}

fn normalize_additional_context_limit(
    event_name: RuntimeHookEventName,
    limit: Option<usize>,
    path: &Path,
    warnings: &mut Vec<String>,
) -> Option<usize> {
    if matches!(
        event_name,
        RuntimeHookEventName::PreToolUse
            | RuntimeHookEventName::PostToolUse
            | RuntimeHookEventName::SessionStart
            | RuntimeHookEventName::UserPromptSubmit
            | RuntimeHookEventName::SubagentStart
    ) {
        return limit;
    }
    if limit.is_some() {
        warnings.push(format!(
            "ignoring additionalContextLimit for {event_name:?} hook in {}",
            path.display()
        ));
    }
    None
}

fn trust_status(
    is_managed: bool,
    current_hash: &str,
    trusted_hash: Option<&str>,
) -> RuntimeHookTrustStatus {
    if is_managed {
        RuntimeHookTrustStatus::Managed
    } else {
        match trusted_hash {
            Some(trusted_hash) if trusted_hash == current_hash => RuntimeHookTrustStatus::Trusted,
            Some(_) => RuntimeHookTrustStatus::Modified,
            None => RuntimeHookTrustStatus::Untrusted,
        }
    }
}

fn command_hook_hash(
    event_name: RuntimeHookEventName,
    matcher: Option<&str>,
    command: &str,
    timeout_sec: u64,
    r#async: bool,
    status_message: Option<&str>,
    additional_context_limit: Option<usize>,
) -> String {
    let mut handler = serde_json::Map::new();
    handler.insert("type".to_string(), Value::String("command".to_string()));
    handler.insert("command".to_string(), Value::String(command.to_string()));
    handler.insert("timeout".to_string(), Value::from(timeout_sec));
    if r#async {
        handler.insert("async".to_string(), Value::Bool(true));
    }
    if let Some(status_message) = status_message {
        handler.insert(
            "statusMessage".to_string(),
            Value::String(status_message.to_string()),
        );
    }
    if let Some(limit) = additional_context_limit {
        handler.insert("additionalContextLimit".to_string(), Value::from(limit));
    }
    let mut identity = serde_json::Map::new();
    identity.insert(
        "event_name".to_string(),
        Value::String(event_name.key_label().to_string()),
    );
    if let Some(matcher) = matcher {
        identity.insert("matcher".to_string(), Value::String(matcher.to_string()));
    }
    identity.insert(
        "hooks".to_string(),
        Value::Array(vec![Value::Object(handler)]),
    );
    let canonical = canonical_json(&Value::Object(identity));
    let serialized = serde_json::to_vec(&canonical).unwrap_or_default();
    format!("sha256:{}", hex::encode(Sha256::digest(serialized)))
}

fn mcp_hook_hash(
    event_name: RuntimeHookEventName,
    matcher: Option<&str>,
    server: &str,
    tool: &str,
    input: &serde_json::Map<String, serde_json::Value>,
    timeout_sec: u64,
    status_message: Option<&str>,
) -> String {
    let mut handler = serde_json::Map::new();
    handler.insert("type".to_string(), Value::String("mcp_tool".to_string()));
    handler.insert("server".to_string(), Value::String(server.to_string()));
    handler.insert("tool".to_string(), Value::String(tool.to_string()));
    handler.insert("input".to_string(), Value::Object(input.clone()));
    handler.insert("timeout".to_string(), Value::from(timeout_sec));
    if let Some(status_message) = status_message {
        handler.insert(
            "statusMessage".to_string(),
            Value::String(status_message.to_string()),
        );
    }
    let mut identity = serde_json::Map::new();
    identity.insert(
        "event_name".to_string(),
        Value::String(event_name.key_label().to_string()),
    );
    if let Some(matcher) = matcher {
        identity.insert("matcher".to_string(), Value::String(matcher.to_string()));
    }
    identity.insert(
        "hooks".to_string(),
        Value::Array(vec![Value::Object(handler)]),
    );
    let canonical = canonical_json(&Value::Object(identity));
    let serialized = serde_json::to_vec(&canonical).unwrap_or_default();
    format!("sha256:{}", hex::encode(Sha256::digest(serialized)))
}

fn canonical_json(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut sorted = serde_json::Map::new();
            let mut keys = map.keys().collect::<Vec<_>>();
            keys.sort();
            for key in keys {
                if let Some(value) = map.get(key) {
                    sorted.insert(key.clone(), canonical_json(value));
                }
            }
            Value::Object(sorted)
        }
        Value::Array(values) => Value::Array(values.iter().map(canonical_json).collect()),
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests;
