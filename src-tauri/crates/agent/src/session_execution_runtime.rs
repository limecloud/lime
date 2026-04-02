use crate::session_query::read_session;
use crate::session_update::persist_session_extension_data;
use aster::session::extension_data::{ExtensionData, ExtensionState};
use aster::session::{
    Session, SessionRuntimeSnapshot, TurnContextOverride, TurnOutputSchemaRuntime, TurnStatus,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    let trimmed = value?.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SessionExecutionRuntimeSource {
    Session,
    RuntimeSnapshot,
    TurnContext,
    ModelChange,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SessionExecutionRuntimeAccessMode {
    ReadOnly,
    Current,
    FullAccess,
}

impl ExtensionState for SessionExecutionRuntimeAccessMode {
    const EXTENSION_NAME: &'static str = "lime_recent_access_mode";
    const VERSION: &'static str = "v0";
}

impl SessionExecutionRuntimeAccessMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::ReadOnly => "read-only",
            Self::Current => "current",
            Self::FullAccess => "full-access",
        }
    }

    pub fn approval_policy(&self) -> &'static str {
        match self {
            Self::FullAccess => "never",
            Self::ReadOnly | Self::Current => "on-request",
        }
    }

    pub fn sandbox_policy(&self) -> &'static str {
        match self {
            Self::ReadOnly => "read-only",
            Self::Current => "workspace-write",
            Self::FullAccess => "danger-full-access",
        }
    }

    pub fn from_access_mode_text(value: Option<&str>) -> Option<Self> {
        match value.map(str::trim) {
            Some("read-only") => Some(Self::ReadOnly),
            Some("current") => Some(Self::Current),
            Some("full-access") => Some(Self::FullAccess),
            _ => None,
        }
    }

    pub fn from_runtime_policies(
        _approval_policy: Option<&str>,
        sandbox_policy: Option<&str>,
    ) -> Option<Self> {
        match sandbox_policy.map(str::trim) {
            Some("read-only") => Some(Self::ReadOnly),
            Some("workspace-write") => Some(Self::Current),
            Some("danger-full-access") => Some(Self::FullAccess),
            _ => None,
        }
    }

    fn from_extension_data(extension_data: &ExtensionData) -> Option<Self> {
        <Self as ExtensionState>::from_extension_data(extension_data)
    }

    fn from_session(session: &Session) -> Option<Self> {
        Self::from_extension_data(&session.extension_data)
    }

    fn write_extension_data(self, extension_data: &mut ExtensionData) -> Result<(), String> {
        <Self as ExtensionState>::to_extension_data(&self, extension_data)
            .map_err(|error| error.to_string())
    }

    fn into_updated_extension_data(self, session: &Session) -> Result<ExtensionData, String> {
        let mut extension_data = session.extension_data.clone();
        self.write_extension_data(&mut extension_data)?;
        Ok(extension_data)
    }

    fn from_turn_context_override(turn_context: &TurnContextOverride) -> Option<Self> {
        Self::from_runtime_policies(
            turn_context.approval_policy.as_deref(),
            turn_context.sandbox_policy.as_deref(),
        )
        .or_else(|| extract_recent_access_mode_from_metadata(&turn_context.metadata))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionExecutionRuntimePreferences {
    pub web_search: bool,
    pub thinking: bool,
    pub task: bool,
    pub subagent: bool,
}

impl ExtensionState for SessionExecutionRuntimePreferences {
    const EXTENSION_NAME: &'static str = "lime_recent_preferences";
    const VERSION: &'static str = "v0";
}

impl SessionExecutionRuntimePreferences {
    fn from_extension_data(extension_data: &ExtensionData) -> Option<Self> {
        <Self as ExtensionState>::from_extension_data(extension_data)
    }

    fn from_session(session: &Session) -> Option<Self> {
        Self::from_extension_data(&session.extension_data)
    }

    fn to_extension_data(&self, extension_data: &mut ExtensionData) -> Result<(), String> {
        <Self as ExtensionState>::to_extension_data(self, extension_data)
            .map_err(|error| error.to_string())
    }

    fn into_updated_extension_data(self, session: &Session) -> Result<ExtensionData, String> {
        let mut extension_data = session.extension_data.clone();
        self.to_extension_data(&mut extension_data)?;
        Ok(extension_data)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionExecutionRuntimeRecentTeamRole {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default, alias = "profile_id")]
    pub profile_id: Option<String>,
    #[serde(default, alias = "role_key")]
    pub role_key: Option<String>,
    #[serde(default, alias = "skill_ids")]
    pub skill_ids: Vec<String>,
}

impl SessionExecutionRuntimeRecentTeamRole {
    fn normalize(self) -> Option<Self> {
        let id = self.id.trim().to_string();
        let label = self.label.trim().to_string();
        let summary = self.summary.trim().to_string();
        if label.is_empty() && summary.is_empty() {
            return None;
        }

        let skill_ids = self
            .skill_ids
            .into_iter()
            .filter_map(|skill_id| normalize_optional_text(Some(skill_id)))
            .collect();

        Some(Self {
            id,
            label,
            summary,
            profile_id: normalize_optional_text(self.profile_id),
            role_key: normalize_optional_text(self.role_key),
            skill_ids,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionExecutionRuntimeRecentTeamSelection {
    #[serde(default)]
    pub disabled: bool,
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(default, alias = "preferred_team_preset_id")]
    pub preferred_team_preset_id: Option<String>,
    #[serde(default, alias = "selected_team_id")]
    pub selected_team_id: Option<String>,
    #[serde(default, alias = "selected_team_source")]
    pub selected_team_source: Option<String>,
    #[serde(default, alias = "selected_team_label")]
    pub selected_team_label: Option<String>,
    #[serde(default, alias = "selected_team_description")]
    pub selected_team_description: Option<String>,
    #[serde(default, alias = "selected_team_summary")]
    pub selected_team_summary: Option<String>,
    #[serde(default, alias = "selected_team_roles")]
    pub selected_team_roles: Option<Vec<SessionExecutionRuntimeRecentTeamRole>>,
}

impl ExtensionState for SessionExecutionRuntimeRecentTeamSelection {
    const EXTENSION_NAME: &'static str = "lime_recent_team_selection";
    const VERSION: &'static str = "v0";
}

impl SessionExecutionRuntimeRecentTeamSelection {
    fn normalize(self) -> Option<Self> {
        let selected_team_roles = self
            .selected_team_roles
            .map(|roles| {
                roles
                    .into_iter()
                    .filter_map(SessionExecutionRuntimeRecentTeamRole::normalize)
                    .collect::<Vec<_>>()
            })
            .filter(|roles| !roles.is_empty());

        let normalized = Self {
            disabled: self.disabled,
            theme: normalize_optional_text(self.theme),
            preferred_team_preset_id: normalize_optional_text(self.preferred_team_preset_id),
            selected_team_id: normalize_optional_text(self.selected_team_id),
            selected_team_source: normalize_optional_text(self.selected_team_source),
            selected_team_label: normalize_optional_text(self.selected_team_label),
            selected_team_description: normalize_optional_text(self.selected_team_description),
            selected_team_summary: normalize_optional_text(self.selected_team_summary),
            selected_team_roles,
        };

        if normalized.disabled {
            return Some(normalized);
        }

        if normalized.preferred_team_preset_id.is_none()
            && normalized.selected_team_id.is_none()
            && normalized.selected_team_source.is_none()
            && normalized.selected_team_label.is_none()
            && normalized.selected_team_description.is_none()
            && normalized.selected_team_summary.is_none()
            && normalized.selected_team_roles.is_none()
        {
            return None;
        }

        Some(normalized)
    }

    fn from_extension_data(extension_data: &ExtensionData) -> Option<Self> {
        <Self as ExtensionState>::from_extension_data(extension_data).and_then(Self::normalize)
    }

    fn from_session(session: &Session) -> Option<Self> {
        Self::from_extension_data(&session.extension_data)
    }

    fn to_extension_data(&self, extension_data: &mut ExtensionData) -> Result<(), String> {
        <Self as ExtensionState>::to_extension_data(self, extension_data)
            .map_err(|error| error.to_string())
    }

    fn into_updated_extension_data(self, session: &Session) -> Result<ExtensionData, String> {
        let mut extension_data = session.extension_data.clone();
        self.to_extension_data(&mut extension_data)?;
        Ok(extension_data)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionExecutionRuntime {
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_selector: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_strategy: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_schema_runtime: Option<TurnOutputSchemaRuntime>,
    pub source: SessionExecutionRuntimeSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_turn_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recent_access_mode: Option<SessionExecutionRuntimeAccessMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recent_preferences: Option<SessionExecutionRuntimePreferences>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recent_team_selection: Option<SessionExecutionRuntimeRecentTeamSelection>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recent_theme: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recent_session_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recent_gate_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recent_run_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recent_content_id: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct RecentHarnessContext {
    theme: Option<String>,
    session_mode: Option<String>,
    gate_key: Option<String>,
    run_title: Option<String>,
    content_id: Option<String>,
}

fn resolve_session_model_name(session: &Session) -> Option<String> {
    session
        .model_config
        .as_ref()
        .and_then(|config| normalize_optional_text(Some(config.model_name.clone())))
}

fn extract_bool_from_value(value: Option<&Value>) -> Option<bool> {
    value.and_then(Value::as_bool)
}

fn extract_bool_from_object(
    object: &serde_json::Map<String, Value>,
    keys: &[&str],
) -> Option<bool> {
    keys.iter()
        .find_map(|key| extract_bool_from_value(object.get(*key)))
}

fn extract_bool_from_metadata(
    metadata: &std::collections::HashMap<String, Value>,
    keys: &[&str],
) -> Option<bool> {
    keys.iter()
        .find_map(|key| extract_bool_from_value(metadata.get(*key)))
}

fn extract_text_from_value(value: Option<&Value>) -> Option<String> {
    normalize_optional_text(value.and_then(Value::as_str).map(ToString::to_string))
}

fn extract_text_from_object(
    object: &serde_json::Map<String, Value>,
    keys: &[&str],
) -> Option<String> {
    keys.iter()
        .find_map(|key| extract_text_from_value(object.get(*key)))
}

fn extract_text_from_metadata(
    metadata: &std::collections::HashMap<String, Value>,
    keys: &[&str],
) -> Option<String> {
    keys.iter()
        .find_map(|key| extract_text_from_value(metadata.get(*key)))
}

fn extract_array_from_object(
    object: &serde_json::Map<String, Value>,
    keys: &[&str],
) -> Option<Vec<Value>> {
    keys.iter()
        .filter_map(|key| object.get(*key))
        .find_map(Value::as_array)
        .cloned()
}

fn extract_array_from_metadata(
    metadata: &std::collections::HashMap<String, Value>,
    keys: &[&str],
) -> Option<Vec<Value>> {
    keys.iter()
        .filter_map(|key| metadata.get(*key))
        .find_map(Value::as_array)
        .cloned()
}

fn extract_recent_preferences_from_metadata(
    metadata: &std::collections::HashMap<String, Value>,
) -> Option<SessionExecutionRuntimePreferences> {
    let harness = metadata.get("harness").and_then(Value::as_object);
    let nested_preferences = harness
        .and_then(|value| value.get("preferences"))
        .and_then(Value::as_object)
        .or_else(|| metadata.get("preferences").and_then(Value::as_object));
    let resolve_nested = |keys: &[&str]| -> Option<bool> {
        nested_preferences.and_then(|value| extract_bool_from_object(value, keys))
    };
    let resolve_flat = |keys: &[&str]| -> Option<bool> {
        harness
            .and_then(|value| extract_bool_from_object(value, keys))
            .or_else(|| extract_bool_from_metadata(metadata, keys))
    };

    let web_search = resolve_nested(&["web_search", "webSearch"])
        .or_else(|| resolve_flat(&["web_search_enabled", "webSearchEnabled"]));
    let thinking = resolve_nested(&["thinking", "thinking_enabled", "thinkingEnabled"])
        .or_else(|| resolve_flat(&["thinking_enabled", "thinkingEnabled"]));
    let task = resolve_nested(&["task", "task_mode", "taskMode"])
        .or_else(|| resolve_flat(&["task_mode_enabled", "taskModeEnabled"]));
    let subagent = resolve_nested(&["subagent", "subagent_mode", "subagentMode"])
        .or_else(|| resolve_flat(&["subagent_mode_enabled", "subagentModeEnabled"]));

    if web_search.is_none() && thinking.is_none() && task.is_none() && subagent.is_none() {
        return None;
    }

    Some(SessionExecutionRuntimePreferences {
        web_search: web_search.unwrap_or(false),
        thinking: thinking.unwrap_or(false),
        task: task.unwrap_or(false),
        subagent: subagent.unwrap_or(false),
    })
}

fn extract_recent_access_mode_from_metadata(
    metadata: &std::collections::HashMap<String, Value>,
) -> Option<SessionExecutionRuntimeAccessMode> {
    let harness = metadata.get("harness").and_then(Value::as_object);
    let access_mode = harness
        .and_then(|value| extract_text_from_object(value, &["access_mode", "accessMode"]))
        .or_else(|| extract_text_from_metadata(metadata, &["access_mode", "accessMode"]));

    SessionExecutionRuntimeAccessMode::from_access_mode_text(access_mode.as_deref())
}

fn extract_recent_team_roles_from_values(
    values: Vec<Value>,
) -> Option<Vec<SessionExecutionRuntimeRecentTeamRole>> {
    let roles = values
        .into_iter()
        .filter_map(|value| {
            serde_json::from_value::<SessionExecutionRuntimeRecentTeamRole>(value).ok()
        })
        .filter_map(SessionExecutionRuntimeRecentTeamRole::normalize)
        .collect::<Vec<_>>();

    if roles.is_empty() {
        None
    } else {
        Some(roles)
    }
}

fn extract_recent_team_selection_from_metadata(
    metadata: &std::collections::HashMap<String, Value>,
) -> Option<SessionExecutionRuntimeRecentTeamSelection> {
    let harness = metadata.get("harness").and_then(Value::as_object);
    let resolve_text = |keys: &[&str]| -> Option<String> {
        harness
            .and_then(|value| extract_text_from_object(value, keys))
            .or_else(|| extract_text_from_metadata(metadata, keys))
    };
    let resolve_bool = |keys: &[&str]| -> Option<bool> {
        harness
            .and_then(|value| extract_bool_from_object(value, keys))
            .or_else(|| extract_bool_from_metadata(metadata, keys))
    };
    let resolve_array = |keys: &[&str]| -> Option<Vec<Value>> {
        harness
            .and_then(|value| extract_array_from_object(value, keys))
            .or_else(|| extract_array_from_metadata(metadata, keys))
    };

    SessionExecutionRuntimeRecentTeamSelection {
        disabled: resolve_bool(&["selected_team_disabled", "selectedTeamDisabled"])
            .unwrap_or(false),
        theme: resolve_text(&["theme", "harness_theme", "harnessTheme"]),
        preferred_team_preset_id: resolve_text(&[
            "preferred_team_preset_id",
            "preferredTeamPresetId",
        ]),
        selected_team_id: resolve_text(&["selected_team_id", "selectedTeamId"]),
        selected_team_source: resolve_text(&["selected_team_source", "selectedTeamSource"]),
        selected_team_label: resolve_text(&["selected_team_label", "selectedTeamLabel"]),
        selected_team_description: resolve_text(&[
            "selected_team_description",
            "selectedTeamDescription",
        ]),
        selected_team_summary: resolve_text(&["selected_team_summary", "selectedTeamSummary"]),
        selected_team_roles: resolve_array(&["selected_team_roles", "selectedTeamRoles"])
            .and_then(extract_recent_team_roles_from_values),
    }
    .normalize()
}

fn extract_recent_harness_context_from_metadata(
    metadata: &std::collections::HashMap<String, Value>,
) -> RecentHarnessContext {
    let harness = metadata.get("harness").and_then(Value::as_object);
    let resolve_text = |keys: &[&str]| -> Option<String> {
        harness
            .and_then(|value| extract_text_from_object(value, keys))
            .or_else(|| extract_text_from_metadata(metadata, keys))
    };

    RecentHarnessContext {
        theme: resolve_text(&["theme", "harness_theme", "harnessTheme"]),
        session_mode: resolve_text(&["session_mode", "sessionMode"]),
        gate_key: resolve_text(&["gate_key", "gateKey"]),
        run_title: resolve_text(&["run_title", "runTitle", "title"]),
        content_id: resolve_text(&["content_id", "contentId"]),
    }
}

fn extract_recent_harness_context_from_runtime_snapshot(
    snapshot: &SessionRuntimeSnapshot,
) -> RecentHarnessContext {
    let from_turn = snapshot
        .threads
        .iter()
        .flat_map(|thread| thread.turns.iter())
        .filter_map(|turn| {
            let context = turn
                .context_override
                .as_ref()
                .map(|value| extract_recent_harness_context_from_metadata(&value.metadata))?;
            Some((turn.updated_at, context))
        })
        .max_by_key(|(updated_at, _)| *updated_at)
        .map(|(_, context)| context)
        .unwrap_or_default();

    if from_turn.theme.is_some()
        && from_turn.session_mode.is_some()
        && from_turn.gate_key.is_some()
        && from_turn.run_title.is_some()
        && from_turn.content_id.is_some()
    {
        return from_turn;
    }

    let from_thread = snapshot
        .threads
        .iter()
        .filter_map(|thread| {
            let context = extract_recent_harness_context_from_metadata(&thread.thread.metadata);
            if context.theme.is_none()
                && context.session_mode.is_none()
                && context.content_id.is_none()
            {
                return None;
            }
            Some((thread.thread.updated_at, context))
        })
        .max_by_key(|(updated_at, _)| *updated_at)
        .map(|(_, context)| context)
        .unwrap_or_default();

    RecentHarnessContext {
        theme: from_turn.theme.or(from_thread.theme),
        session_mode: from_turn.session_mode.or(from_thread.session_mode),
        gate_key: from_turn.gate_key.or(from_thread.gate_key),
        run_title: from_turn.run_title.or(from_thread.run_title),
        content_id: from_turn.content_id.or(from_thread.content_id),
    }
}

pub fn extract_recent_content_id_from_runtime_snapshot(
    snapshot: &SessionRuntimeSnapshot,
) -> Option<String> {
    extract_recent_harness_context_from_runtime_snapshot(snapshot).content_id
}

fn extract_recent_access_mode_from_runtime_snapshot(
    snapshot: &SessionRuntimeSnapshot,
) -> Option<SessionExecutionRuntimeAccessMode> {
    snapshot
        .threads
        .iter()
        .flat_map(|thread| thread.turns.iter())
        .filter_map(|turn| {
            let access_mode = turn
                .context_override
                .as_ref()
                .and_then(SessionExecutionRuntimeAccessMode::from_turn_context_override)?;
            Some((turn.updated_at, access_mode))
        })
        .max_by_key(|(updated_at, _)| *updated_at)
        .map(|(_, access_mode)| access_mode)
}

pub async fn persist_session_recent_access_mode(
    session_id: &str,
    recent_access_mode: SessionExecutionRuntimeAccessMode,
) -> Result<(), String> {
    let session = read_session(session_id, false, "读取会话 recent_access_mode 失败").await?;
    let extension_data = recent_access_mode.into_updated_extension_data(&session)?;
    persist_session_extension_data(session_id, extension_data, "持久化会话 recent_access_mode")
        .await?;
    Ok(())
}

pub async fn persist_session_recent_preferences(
    session_id: &str,
    preferences: SessionExecutionRuntimePreferences,
) -> Result<(), String> {
    let session = read_session(session_id, false, "读取会话 recent_preferences 失败").await?;
    let extension_data = preferences.into_updated_extension_data(&session)?;
    persist_session_extension_data(session_id, extension_data, "持久化会话 recent_preferences")
        .await?;
    Ok(())
}

pub async fn persist_session_recent_team_selection(
    session_id: &str,
    recent_team_selection: SessionExecutionRuntimeRecentTeamSelection,
) -> Result<(), String> {
    let session = read_session(session_id, false, "读取会话 recent_team_selection 失败").await?;
    let extension_data = recent_team_selection.into_updated_extension_data(&session)?;
    persist_session_extension_data(
        session_id,
        extension_data,
        "持久化会话 recent_team_selection",
    )
    .await?;
    Ok(())
}

fn resolve_latest_turn(snapshot: &SessionRuntimeSnapshot) -> Option<&aster::session::TurnRuntime> {
    snapshot
        .threads
        .iter()
        .flat_map(|thread| thread.turns.iter())
        .max_by(|left, right| {
            left.updated_at
                .cmp(&right.updated_at)
                .then_with(|| left.created_at.cmp(&right.created_at))
                .then_with(|| left.id.cmp(&right.id))
        })
}

fn map_turn_status(status: TurnStatus) -> String {
    match status {
        TurnStatus::Queued => "queued".to_string(),
        TurnStatus::Running => "running".to_string(),
        TurnStatus::Completed => "completed".to_string(),
        TurnStatus::Failed => "failed".to_string(),
        TurnStatus::Aborted => "aborted".to_string(),
    }
}

pub fn build_session_execution_runtime(
    session_id: &str,
    session: Option<&Session>,
    execution_strategy: Option<String>,
    snapshot: Option<&SessionRuntimeSnapshot>,
    provider_selector: Option<String>,
) -> Option<SessionExecutionRuntime> {
    let mut runtime = SessionExecutionRuntime {
        session_id: session_id.to_string(),
        provider_selector: normalize_optional_text(provider_selector),
        provider_name: session
            .and_then(|value| normalize_optional_text(value.provider_name.clone())),
        model_name: session.and_then(resolve_session_model_name),
        execution_strategy: normalize_optional_text(execution_strategy),
        output_schema_runtime: None,
        source: SessionExecutionRuntimeSource::Session,
        mode: None,
        latest_turn_id: None,
        latest_turn_status: None,
        recent_access_mode: None,
        recent_preferences: None,
        recent_team_selection: None,
        recent_theme: None,
        recent_session_mode: None,
        recent_gate_key: None,
        recent_run_title: None,
        recent_content_id: None,
    };

    if let Some(snapshot) = snapshot {
        let recent_harness_context = extract_recent_harness_context_from_runtime_snapshot(snapshot);
        runtime.recent_theme = recent_harness_context.theme;
        runtime.recent_session_mode = recent_harness_context.session_mode;
        runtime.recent_gate_key = recent_harness_context.gate_key;
        runtime.recent_run_title = recent_harness_context.run_title;
        runtime.recent_content_id = recent_harness_context.content_id;
        runtime.recent_access_mode = extract_recent_access_mode_from_runtime_snapshot(snapshot);

        if let Some(latest_turn) = resolve_latest_turn(snapshot) {
            runtime.latest_turn_id = Some(latest_turn.id.clone());
            runtime.latest_turn_status = Some(map_turn_status(latest_turn.status));
            runtime.output_schema_runtime = latest_turn.output_schema_runtime.clone();
            runtime.model_name = latest_turn
                .output_schema_runtime
                .as_ref()
                .and_then(|value| normalize_optional_text(value.model_name.clone()))
                .or_else(|| {
                    latest_turn
                        .context_override
                        .as_ref()
                        .and_then(|value| normalize_optional_text(value.model.clone()))
                })
                .or(runtime.model_name);
            runtime.provider_name = latest_turn
                .output_schema_runtime
                .as_ref()
                .and_then(|value| normalize_optional_text(value.provider_name.clone()))
                .or(runtime.provider_name);
            runtime.recent_preferences = latest_turn
                .context_override
                .as_ref()
                .and_then(|value| extract_recent_preferences_from_metadata(&value.metadata));
            runtime.recent_team_selection = latest_turn
                .context_override
                .as_ref()
                .and_then(|value| extract_recent_team_selection_from_metadata(&value.metadata));
            runtime.source = SessionExecutionRuntimeSource::RuntimeSnapshot;
        }
    }

    if runtime.recent_access_mode.is_none() {
        runtime.recent_access_mode =
            session.and_then(SessionExecutionRuntimeAccessMode::from_session);
    }

    if runtime.recent_preferences.is_none() {
        runtime.recent_preferences =
            session.and_then(SessionExecutionRuntimePreferences::from_session);
    }

    if runtime.recent_team_selection.is_none() {
        runtime.recent_team_selection =
            session.and_then(SessionExecutionRuntimeRecentTeamSelection::from_session);
    }

    if runtime.provider_selector.is_none()
        && runtime.provider_name.is_none()
        && runtime.model_name.is_none()
        && runtime.output_schema_runtime.is_none()
        && runtime.recent_access_mode.is_none()
        && runtime.recent_preferences.is_none()
        && runtime.recent_team_selection.is_none()
        && runtime.recent_theme.is_none()
        && runtime.recent_session_mode.is_none()
        && runtime.recent_gate_key.is_none()
        && runtime.recent_run_title.is_none()
        && runtime.recent_content_id.is_none()
    {
        return None;
    }

    Some(runtime)
}

#[cfg(test)]
mod tests {
    use super::{
        build_session_execution_runtime, SessionExecutionRuntimeAccessMode,
        SessionExecutionRuntimePreferences, SessionExecutionRuntimeRecentTeamRole,
        SessionExecutionRuntimeRecentTeamSelection, SessionExecutionRuntimeSource,
    };
    use aster::model::ModelConfig;
    use aster::session::{
        Session, SessionRuntimeSnapshot, ThreadRuntime, ThreadRuntimeSnapshot, TurnContextOverride,
        TurnOutputSchemaRuntime, TurnOutputSchemaSource, TurnOutputSchemaStrategy, TurnRuntime,
        TurnStatus,
    };
    use chrono::{Duration, Utc};
    use serde_json::json;
    use std::path::PathBuf;

    #[test]
    fn falls_back_to_session_when_runtime_snapshot_missing() {
        let mut session = Session::default();
        session.id = "session-1".to_string();
        session.provider_name = Some("openai".to_string());
        session.model_config = Some(ModelConfig::new("gpt-5.1").expect("model config"));

        let runtime = build_session_execution_runtime(
            "session-1",
            Some(&session),
            Some("react".to_string()),
            None,
            Some("openai".to_string()),
        )
        .expect("runtime");

        assert_eq!(runtime.source, SessionExecutionRuntimeSource::Session);
        assert_eq!(runtime.provider_selector.as_deref(), Some("openai"));
        assert_eq!(runtime.provider_name.as_deref(), Some("openai"));
        assert_eq!(runtime.model_name.as_deref(), Some("gpt-5.1"));
        assert_eq!(runtime.execution_strategy.as_deref(), Some("react"));
        assert!(runtime.output_schema_runtime.is_none());
        assert!(runtime.recent_preferences.is_none());
    }

    #[test]
    fn prefers_latest_runtime_snapshot_with_output_schema_runtime() {
        let now = Utc::now();
        let mut session = Session::default();
        session.id = "session-2".to_string();
        session.provider_name = Some("openai".to_string());
        session.model_config = Some(ModelConfig::new("gpt-5.1").expect("model config"));

        let latest_turn = TurnRuntime {
            id: "turn-new".to_string(),
            session_id: "session-2".to_string(),
            thread_id: "thread-1".to_string(),
            status: TurnStatus::Running,
            input_text: Some("hello".to_string()),
            error_message: None,
            context_override: Some(TurnContextOverride {
                model: Some("gpt-5.2".to_string()),
                ..TurnContextOverride::default()
            }),
            output_schema_runtime: Some(TurnOutputSchemaRuntime {
                source: TurnOutputSchemaSource::Turn,
                strategy: TurnOutputSchemaStrategy::Native,
                provider_name: Some("openai".to_string()),
                model_name: Some("gpt-5.2".to_string()),
            }),
            created_at: now - Duration::seconds(30),
            started_at: Some(now - Duration::seconds(30)),
            completed_at: None,
            updated_at: now,
        };
        let snapshot = SessionRuntimeSnapshot {
            session_id: "session-2".to_string(),
            threads: vec![ThreadRuntimeSnapshot {
                thread: ThreadRuntime::new(
                    "thread-1",
                    "session-2",
                    PathBuf::from("/tmp/workspace"),
                ),
                turns: vec![
                    TurnRuntime {
                        id: "turn-old".to_string(),
                        session_id: "session-2".to_string(),
                        thread_id: "thread-1".to_string(),
                        status: TurnStatus::Completed,
                        input_text: Some("old".to_string()),
                        error_message: None,
                        context_override: None,
                        output_schema_runtime: None,
                        created_at: now - Duration::minutes(2),
                        started_at: Some(now - Duration::minutes(2)),
                        completed_at: Some(now - Duration::minutes(1)),
                        updated_at: now - Duration::minutes(1),
                    },
                    latest_turn.clone(),
                ],
                items: Vec::new(),
            }],
        };

        let runtime = build_session_execution_runtime(
            "session-2",
            Some(&session),
            Some("auto".to_string()),
            Some(&snapshot),
            Some("openai".to_string()),
        )
        .expect("runtime");

        assert_eq!(
            runtime.source,
            SessionExecutionRuntimeSource::RuntimeSnapshot
        );
        assert_eq!(runtime.latest_turn_id.as_deref(), Some("turn-new"));
        assert_eq!(runtime.latest_turn_status.as_deref(), Some("running"));
        assert_eq!(runtime.model_name.as_deref(), Some("gpt-5.2"));
        assert_eq!(
            runtime
                .output_schema_runtime
                .as_ref()
                .and_then(|value| value.model_name.as_deref()),
            Some("gpt-5.2")
        );
        assert!(runtime.recent_preferences.is_none());
    }

    #[test]
    fn keeps_recent_preferences_from_latest_turn_metadata() {
        let now = Utc::now();
        let latest_turn = TurnRuntime {
            id: "turn-pref".to_string(),
            session_id: "session-3".to_string(),
            thread_id: "thread-1".to_string(),
            status: TurnStatus::Completed,
            input_text: Some("hello".to_string()),
            error_message: None,
            context_override: Some(TurnContextOverride {
                metadata: std::collections::HashMap::from([(
                    "harness".to_string(),
                    json!({
                        "preferences": {
                            "webSearch": true,
                            "thinking": true,
                            "task": false,
                            "subagent": true,
                        }
                    }),
                )]),
                ..TurnContextOverride::default()
            }),
            output_schema_runtime: None,
            created_at: now - Duration::seconds(10),
            started_at: Some(now - Duration::seconds(10)),
            completed_at: Some(now - Duration::seconds(1)),
            updated_at: now,
        };
        let snapshot = SessionRuntimeSnapshot {
            session_id: "session-3".to_string(),
            threads: vec![ThreadRuntimeSnapshot {
                thread: ThreadRuntime::new(
                    "thread-1",
                    "session-3",
                    PathBuf::from("/tmp/workspace"),
                ),
                turns: vec![latest_turn],
                items: Vec::new(),
            }],
        };

        let runtime =
            build_session_execution_runtime("session-3", None, None, Some(&snapshot), None)
                .expect("runtime");

        assert_eq!(
            runtime.source,
            SessionExecutionRuntimeSource::RuntimeSnapshot
        );
        assert_eq!(
            runtime.recent_preferences,
            Some(SessionExecutionRuntimePreferences {
                web_search: true,
                thinking: true,
                task: false,
                subagent: true,
            })
        );
    }

    #[test]
    fn keeps_recent_access_mode_from_latest_turn_context_override() {
        let now = Utc::now();
        let latest_turn = TurnRuntime {
            id: "turn-access".to_string(),
            session_id: "session-access".to_string(),
            thread_id: "thread-1".to_string(),
            status: TurnStatus::Completed,
            input_text: Some("hello".to_string()),
            error_message: None,
            context_override: Some(TurnContextOverride {
                approval_policy: Some("never".to_string()),
                sandbox_policy: Some("danger-full-access".to_string()),
                ..TurnContextOverride::default()
            }),
            output_schema_runtime: None,
            created_at: now - Duration::seconds(10),
            started_at: Some(now - Duration::seconds(10)),
            completed_at: Some(now - Duration::seconds(1)),
            updated_at: now,
        };
        let snapshot = SessionRuntimeSnapshot {
            session_id: "session-access".to_string(),
            threads: vec![ThreadRuntimeSnapshot {
                thread: ThreadRuntime::new(
                    "thread-1",
                    "session-access",
                    PathBuf::from("/tmp/workspace"),
                ),
                turns: vec![latest_turn],
                items: Vec::new(),
            }],
        };

        let runtime =
            build_session_execution_runtime("session-access", None, None, Some(&snapshot), None)
                .expect("runtime");

        assert_eq!(
            runtime.recent_access_mode,
            Some(SessionExecutionRuntimeAccessMode::FullAccess)
        );
    }

    #[test]
    fn falls_back_to_session_recent_access_mode_when_runtime_snapshot_missing() {
        let mut session = Session::default();
        session.id = "session-access-fallback".to_string();
        SessionExecutionRuntimeAccessMode::ReadOnly
            .to_extension_data(&mut session.extension_data)
            .expect("persist access mode");

        let runtime = build_session_execution_runtime(
            "session-access-fallback",
            Some(&session),
            Some("react".to_string()),
            None,
            None,
        )
        .expect("runtime");

        assert_eq!(
            runtime.recent_access_mode,
            Some(SessionExecutionRuntimeAccessMode::ReadOnly)
        );
    }

    #[test]
    fn keeps_recent_team_selection_from_latest_turn_metadata() {
        let now = Utc::now();
        let latest_turn = TurnRuntime {
            id: "turn-team".to_string(),
            session_id: "session-5".to_string(),
            thread_id: "thread-1".to_string(),
            status: TurnStatus::Completed,
            input_text: Some("hello".to_string()),
            error_message: None,
            context_override: Some(TurnContextOverride {
                metadata: std::collections::HashMap::from([(
                    "harness".to_string(),
                    json!({
                        "theme": "general",
                        "preferred_team_preset_id": "code-triage-team",
                        "selected_team_id": "custom-team-1",
                        "selected_team_source": "custom",
                        "selected_team_label": "前端联调团队",
                        "selected_team_description": "分析、实现、验证三段式推进。",
                        "selected_team_summary": "分析、实现、验证三段式推进。 角色分工：分析：负责定位问题与影响范围。",
                        "selected_team_roles": [
                            {
                                "id": "explorer",
                                "label": "分析",
                                "summary": "负责定位问题与影响范围。",
                                "profile_id": "code-explorer",
                                "role_key": "explorer",
                                "skill_ids": ["repo-exploration"]
                            }
                        ]
                    }),
                )]),
                ..TurnContextOverride::default()
            }),
            output_schema_runtime: None,
            created_at: now - Duration::seconds(10),
            started_at: Some(now - Duration::seconds(10)),
            completed_at: Some(now - Duration::seconds(1)),
            updated_at: now,
        };
        let snapshot = SessionRuntimeSnapshot {
            session_id: "session-5".to_string(),
            threads: vec![ThreadRuntimeSnapshot {
                thread: ThreadRuntime::new(
                    "thread-1",
                    "session-5",
                    PathBuf::from("/tmp/workspace"),
                ),
                turns: vec![latest_turn],
                items: Vec::new(),
            }],
        };

        let runtime =
            build_session_execution_runtime("session-5", None, None, Some(&snapshot), None)
                .expect("runtime");

        assert_eq!(
            runtime.recent_team_selection,
            Some(SessionExecutionRuntimeRecentTeamSelection {
                disabled: false,
                theme: Some("general".to_string()),
                preferred_team_preset_id: Some("code-triage-team".to_string()),
                selected_team_id: Some("custom-team-1".to_string()),
                selected_team_source: Some("custom".to_string()),
                selected_team_label: Some("前端联调团队".to_string()),
                selected_team_description: Some("分析、实现、验证三段式推进。".to_string()),
                selected_team_summary: Some(
                    "分析、实现、验证三段式推进。 角色分工：分析：负责定位问题与影响范围。"
                        .to_string(),
                ),
                selected_team_roles: Some(vec![SessionExecutionRuntimeRecentTeamRole {
                    id: "explorer".to_string(),
                    label: "分析".to_string(),
                    summary: "负责定位问题与影响范围。".to_string(),
                    profile_id: Some("code-explorer".to_string()),
                    role_key: Some("explorer".to_string()),
                    skill_ids: vec!["repo-exploration".to_string()],
                }]),
            })
        );
    }

    #[test]
    fn keeps_recent_content_id_from_latest_turn_metadata() {
        let now = Utc::now();
        let latest_turn = TurnRuntime {
            id: "turn-content".to_string(),
            session_id: "session-content".to_string(),
            thread_id: "thread-1".to_string(),
            status: TurnStatus::Completed,
            input_text: Some("hello".to_string()),
            error_message: None,
            context_override: Some(TurnContextOverride {
                metadata: std::collections::HashMap::from([(
                    "harness".to_string(),
                    json!({
                        "content_id": "content-current"
                    }),
                )]),
                ..TurnContextOverride::default()
            }),
            output_schema_runtime: None,
            created_at: now - Duration::seconds(10),
            started_at: Some(now - Duration::seconds(10)),
            completed_at: Some(now - Duration::seconds(1)),
            updated_at: now,
        };
        let snapshot = SessionRuntimeSnapshot {
            session_id: "session-content".to_string(),
            threads: vec![ThreadRuntimeSnapshot {
                thread: ThreadRuntime::new(
                    "thread-1",
                    "session-content",
                    PathBuf::from("/tmp/workspace"),
                ),
                turns: vec![latest_turn],
                items: Vec::new(),
            }],
        };

        let runtime =
            build_session_execution_runtime("session-content", None, None, Some(&snapshot), None)
                .expect("runtime");

        assert_eq!(
            runtime.source,
            SessionExecutionRuntimeSource::RuntimeSnapshot
        );
        assert_eq!(
            runtime.recent_content_id.as_deref(),
            Some("content-current")
        );
    }

    #[test]
    fn keeps_recent_theme_and_session_mode_from_latest_turn_metadata() {
        let now = Utc::now();
        let latest_turn = TurnRuntime {
            id: "turn-harness".to_string(),
            session_id: "session-harness".to_string(),
            thread_id: "thread-1".to_string(),
            status: TurnStatus::Completed,
            input_text: Some("hello".to_string()),
            error_message: None,
            context_override: Some(TurnContextOverride {
                metadata: std::collections::HashMap::from([(
                    "harness".to_string(),
                    json!({
                        "theme": "social-media",
                        "session_mode": "theme_workbench",
                        "gate_key": "write_mode",
                        "run_title": "社媒初稿",
                        "content_id": "content-current"
                    }),
                )]),
                ..TurnContextOverride::default()
            }),
            output_schema_runtime: None,
            created_at: now - Duration::seconds(10),
            started_at: Some(now - Duration::seconds(10)),
            completed_at: Some(now - Duration::seconds(1)),
            updated_at: now,
        };
        let snapshot = SessionRuntimeSnapshot {
            session_id: "session-harness".to_string(),
            threads: vec![ThreadRuntimeSnapshot {
                thread: ThreadRuntime::new(
                    "thread-1",
                    "session-harness",
                    PathBuf::from("/tmp/workspace"),
                ),
                turns: vec![latest_turn],
                items: Vec::new(),
            }],
        };

        let runtime =
            build_session_execution_runtime("session-harness", None, None, Some(&snapshot), None)
                .expect("runtime");

        assert_eq!(runtime.recent_theme.as_deref(), Some("social-media"));
        assert_eq!(
            runtime.recent_session_mode.as_deref(),
            Some("theme_workbench")
        );
        assert_eq!(runtime.recent_gate_key.as_deref(), Some("write_mode"));
        assert_eq!(runtime.recent_run_title.as_deref(), Some("社媒初稿"));
        assert_eq!(
            runtime.recent_content_id.as_deref(),
            Some("content-current")
        );
    }

    #[test]
    fn falls_back_to_thread_metadata_recent_content_id() {
        let now = Utc::now();
        let latest_turn = TurnRuntime {
            id: "turn-without-content".to_string(),
            session_id: "session-thread-content".to_string(),
            thread_id: "thread-1".to_string(),
            status: TurnStatus::Completed,
            input_text: Some("hello".to_string()),
            error_message: None,
            context_override: Some(TurnContextOverride::default()),
            output_schema_runtime: None,
            created_at: now - Duration::seconds(10),
            started_at: Some(now - Duration::seconds(10)),
            completed_at: Some(now - Duration::seconds(1)),
            updated_at: now,
        };
        let mut thread = ThreadRuntime::new(
            "thread-1",
            "session-thread-content",
            PathBuf::from("/tmp/workspace"),
        );
        thread
            .metadata
            .insert("content_id".to_string(), json!("content-from-thread"));
        thread.updated_at = now;
        let snapshot = SessionRuntimeSnapshot {
            session_id: "session-thread-content".to_string(),
            threads: vec![ThreadRuntimeSnapshot {
                thread,
                turns: vec![latest_turn],
                items: Vec::new(),
            }],
        };

        let runtime = build_session_execution_runtime(
            "session-thread-content",
            None,
            None,
            Some(&snapshot),
            None,
        )
        .expect("runtime");

        assert_eq!(
            runtime.recent_content_id.as_deref(),
            Some("content-from-thread")
        );
    }

    #[test]
    fn falls_back_to_thread_metadata_recent_theme_and_session_mode() {
        let now = Utc::now();
        let latest_turn = TurnRuntime {
            id: "turn-without-harness".to_string(),
            session_id: "session-thread-harness".to_string(),
            thread_id: "thread-1".to_string(),
            status: TurnStatus::Completed,
            input_text: Some("hello".to_string()),
            error_message: None,
            context_override: Some(TurnContextOverride::default()),
            output_schema_runtime: None,
            created_at: now - Duration::seconds(10),
            started_at: Some(now - Duration::seconds(10)),
            completed_at: Some(now - Duration::seconds(1)),
            updated_at: now,
        };
        let mut thread = ThreadRuntime::new(
            "thread-1",
            "session-thread-harness",
            PathBuf::from("/tmp/workspace"),
        );
        thread
            .metadata
            .insert("theme".to_string(), json!("document"));
        thread
            .metadata
            .insert("session_mode".to_string(), json!("theme_workbench"));
        thread
            .metadata
            .insert("gate_key".to_string(), json!("publish_confirm"));
        thread
            .metadata
            .insert("run_title".to_string(), json!("发布确认"));
        thread
            .metadata
            .insert("content_id".to_string(), json!("content-from-thread"));
        thread.updated_at = now;
        let snapshot = SessionRuntimeSnapshot {
            session_id: "session-thread-harness".to_string(),
            threads: vec![ThreadRuntimeSnapshot {
                thread,
                turns: vec![latest_turn],
                items: Vec::new(),
            }],
        };

        let runtime = build_session_execution_runtime(
            "session-thread-harness",
            None,
            None,
            Some(&snapshot),
            None,
        )
        .expect("runtime");

        assert_eq!(runtime.recent_theme.as_deref(), Some("document"));
        assert_eq!(
            runtime.recent_session_mode.as_deref(),
            Some("theme_workbench")
        );
        assert_eq!(runtime.recent_gate_key.as_deref(), Some("publish_confirm"));
        assert_eq!(runtime.recent_run_title.as_deref(), Some("发布确认"));
        assert_eq!(
            runtime.recent_content_id.as_deref(),
            Some("content-from-thread")
        );
    }

    #[test]
    fn falls_back_to_session_extension_data_recent_preferences() {
        let mut session = Session::default();
        session.id = "session-4".to_string();
        session.extension_data = SessionExecutionRuntimePreferences {
            web_search: false,
            thinking: true,
            task: true,
            subagent: false,
        }
        .into_updated_extension_data(&Session::default())
        .expect("extension data");

        let runtime =
            build_session_execution_runtime("session-4", Some(&session), None, None, None)
                .expect("runtime");

        assert_eq!(runtime.source, SessionExecutionRuntimeSource::Session);
        assert_eq!(
            runtime.recent_preferences,
            Some(SessionExecutionRuntimePreferences {
                web_search: false,
                thinking: true,
                task: true,
                subagent: false,
            })
        );
    }

    #[test]
    fn falls_back_to_session_extension_data_recent_team_selection() {
        let mut session = Session::default();
        session.id = "session-6".to_string();
        session.extension_data = SessionExecutionRuntimeRecentTeamSelection {
            disabled: true,
            theme: Some("general".to_string()),
            preferred_team_preset_id: None,
            selected_team_id: None,
            selected_team_source: None,
            selected_team_label: None,
            selected_team_description: None,
            selected_team_summary: None,
            selected_team_roles: None,
        }
        .into_updated_extension_data(&Session::default())
        .expect("extension data");

        let runtime =
            build_session_execution_runtime("session-6", Some(&session), None, None, None)
                .expect("runtime");

        assert_eq!(
            runtime.recent_team_selection,
            Some(SessionExecutionRuntimeRecentTeamSelection {
                disabled: true,
                theme: Some("general".to_string()),
                preferred_team_preset_id: None,
                selected_team_id: None,
                selected_team_source: None,
                selected_team_label: None,
                selected_team_description: None,
                selected_team_summary: None,
                selected_team_roles: None,
            })
        );
    }
}
