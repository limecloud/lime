use crate::session_query::read_session;
use crate::session_update::persist_session_extension_data;
use aster::session::extension_data::{ExtensionData, ExtensionState};
use aster::session::{
    Session, SessionRuntimeSnapshot, TurnContextOverride, TurnOutputSchemaRuntime, TurnStatus,
};
use lime_core::database::dao::agent_timeline::{AgentThreadItem, AgentThreadItemPayload};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;

const LIME_RUNTIME_METADATA_KEY: &str = "lime_runtime";
const LIME_RUNTIME_TASK_PROFILE_KEY: &str = "task_profile";
const LIME_RUNTIME_ROUTING_DECISION_KEY: &str = "routing_decision";
const LIME_RUNTIME_LIMIT_STATE_KEY: &str = "limit_state";
const LIME_RUNTIME_COST_STATE_KEY: &str = "cost_state";
const LIME_RUNTIME_PERMISSION_STATE_KEY: &str = "permission_state";
const LIME_RUNTIME_LIMIT_EVENT_KEY: &str = "limit_event";
const LIME_RUNTIME_OEM_POLICY_KEY: &str = "oem_policy";
const LIME_RUNTIME_SUMMARY_KEY: &str = "runtime_summary";
const RUNTIME_MODEL_PERMISSION_FALLBACK_WARNING_CODE: &str = "runtime_model_permission_fallback";

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    let trimmed = value?.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn text_contains_any_keyword(haystack: &str, keywords: &[&str]) -> bool {
    keywords.iter().any(|keyword| haystack.contains(keyword))
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
#[serde(rename_all = "kebab-case")]
pub enum SessionExecutionRuntimeAccessMode {
    #[serde(alias = "read_only")]
    ReadOnly,
    Current,
    #[serde(alias = "full_access")]
    FullAccess,
}

impl ExtensionState for SessionExecutionRuntimeAccessMode {
    const EXTENSION_NAME: &'static str = "lime_recent_access_mode";
    const VERSION: &'static str = "v0";
}

impl SessionExecutionRuntimeAccessMode {
    pub fn default_for_session() -> Self {
        Self::FullAccess
    }

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
#[serde(rename_all = "camelCase")]
pub struct SessionExecutionRuntimeTaskProfile {
    pub kind: String,
    pub source: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub traits: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modality_contract_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub routing_slot: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_profile_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executor_adapter_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executor_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executor_binding_key: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub permission_profile_keys: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_lock_policy: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service_model_slot: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scene_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scene_skill_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry_source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionExecutionRuntimeRoutingDecision {
    pub routing_mode: String,
    pub decision_source: String,
    pub decision_reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requested_provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requested_model: Option<String>,
    #[serde(default)]
    pub candidate_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_cost_class: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capability_gap: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fallback_chain: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settings_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service_model_slot: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionExecutionRuntimeLimitState {
    pub status: String,
    #[serde(default)]
    pub single_candidate_only: bool,
    #[serde(default)]
    pub provider_locked: bool,
    #[serde(default)]
    pub settings_locked: bool,
    #[serde(default)]
    pub oem_locked: bool,
    #[serde(default)]
    pub candidate_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capability_gap: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionExecutionRuntimeCostState {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_cost_class: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_per_million: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_per_million: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_read_per_million: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_write_per_million: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_total_cost: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cached_input_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_creation_input_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionExecutionRuntimePermissionState {
    pub status: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub required_profile_keys: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ask_profile_keys: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blocking_profile_keys: Vec<String>,
    pub decision_source: String,
    pub decision_scope: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confirmation_status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confirmation_request_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confirmation_source: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionExecutionRuntimeLimitEvent {
    pub event_kind: String,
    pub message: String,
    #[serde(default)]
    pub retryable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionExecutionRuntimeOemPolicy {
    pub tenant_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offer_state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quota_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fallback_to_local_allowed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_invoke: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionExecutionRuntimeSummary {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub candidate_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub routing_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decision_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decision_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fallback_chain: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_cost_class: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_total_cost: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit_event_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit_event_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capability_gap: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub single_candidate_only: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oem_locked: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quota_low: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_ask_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_blocking_count: Option<u32>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_profile: Option<SessionExecutionRuntimeTaskProfile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub routing_decision: Option<SessionExecutionRuntimeRoutingDecision>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit_state: Option<SessionExecutionRuntimeLimitState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_state: Option<SessionExecutionRuntimeCostState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_state: Option<SessionExecutionRuntimePermissionState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit_event: Option<SessionExecutionRuntimeLimitEvent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oem_policy: Option<SessionExecutionRuntimeOemPolicy>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_summary: Option<SessionExecutionRuntimeSummary>,
}

fn resolve_session_token_usage(session: &Session) -> Option<crate::protocol::AgentTokenUsage> {
    match (session.input_tokens, session.output_tokens) {
        (Some(input_tokens), Some(output_tokens)) if input_tokens >= 0 && output_tokens >= 0 => {
            Some(crate::protocol::AgentTokenUsage {
                input_tokens: input_tokens as u32,
                output_tokens: output_tokens as u32,
                cached_input_tokens: session
                    .cached_input_tokens
                    .filter(|value| *value >= 0)
                    .map(|value| value as u32),
                cache_creation_input_tokens: session
                    .cache_creation_input_tokens
                    .filter(|value| *value >= 0)
                    .map(|value| value as u32),
            })
        }
        _ => None,
    }
}

fn calculate_estimated_total_cost(cost_state: &SessionExecutionRuntimeCostState) -> Option<f64> {
    let mut total_cost = 0.0;
    let mut has_priced_component = false;

    if let (Some(tokens), Some(rate)) = (cost_state.input_tokens, cost_state.input_per_million) {
        total_cost += (tokens as f64 / 1_000_000.0) * rate;
        has_priced_component = true;
    }
    if let (Some(tokens), Some(rate)) = (cost_state.output_tokens, cost_state.output_per_million) {
        total_cost += (tokens as f64 / 1_000_000.0) * rate;
        has_priced_component = true;
    }
    if let (Some(tokens), Some(rate)) = (
        cost_state.cached_input_tokens,
        cost_state.cache_read_per_million,
    ) {
        total_cost += (tokens as f64 / 1_000_000.0) * rate;
        has_priced_component = true;
    }
    if let (Some(tokens), Some(rate)) = (
        cost_state.cache_creation_input_tokens,
        cost_state.cache_write_per_million,
    ) {
        total_cost += (tokens as f64 / 1_000_000.0) * rate;
        has_priced_component = true;
    }

    has_priced_component.then_some(total_cost)
}

pub fn apply_usage_to_cost_state(
    mut cost_state: SessionExecutionRuntimeCostState,
    usage: &crate::protocol::AgentTokenUsage,
) -> SessionExecutionRuntimeCostState {
    cost_state.input_tokens = Some(usage.input_tokens);
    cost_state.output_tokens = Some(usage.output_tokens);
    cost_state.total_tokens = Some(usage.input_tokens.saturating_add(usage.output_tokens));
    cost_state.cached_input_tokens = usage.cached_input_tokens;
    cost_state.cache_creation_input_tokens = usage.cache_creation_input_tokens;
    cost_state.estimated_total_cost = calculate_estimated_total_cost(&cost_state);
    cost_state.status = if cost_state.estimated_total_cost.is_some() {
        "recorded".to_string()
    } else {
        "recorded_tokens_only".to_string()
    };
    cost_state
}

pub fn detect_runtime_limit_event(
    error_message: Option<&str>,
) -> Option<SessionExecutionRuntimeLimitEvent> {
    let message = error_message
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let lowered = message.to_lowercase();

    if text_contains_any_keyword(
        &lowered,
        &[
            "quota low",
            "available_quota_low",
            "credits running low",
            "credit running low",
            "low balance",
            "额度偏低",
            "余额偏低",
            "额度告急",
        ],
    ) {
        return Some(SessionExecutionRuntimeLimitEvent {
            event_kind: "quota_low".to_string(),
            message: message.to_string(),
            retryable: true,
        });
    }

    if text_contains_any_keyword(
        &lowered,
        &[
            "quota exceeded",
            "quota exhausted",
            "insufficient quota",
            "insufficient credit",
            "insufficient balance",
            "billing",
            "payment required",
            "额度不足",
            "超出额度",
            "余额不足",
        ],
    ) {
        return Some(SessionExecutionRuntimeLimitEvent {
            event_kind: "quota_blocked".to_string(),
            message: message.to_string(),
            retryable: false,
        });
    }

    if text_contains_any_keyword(
        &lowered,
        &[
            "rate limit",
            "rate_limit",
            "too many requests",
            "429",
            "throttl",
        ],
    ) {
        return Some(SessionExecutionRuntimeLimitEvent {
            event_kind: "rate_limit_hit".to_string(),
            message: message.to_string(),
            retryable: true,
        });
    }

    None
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

fn extract_lime_runtime_object(
    metadata: &std::collections::HashMap<String, Value>,
) -> Option<&serde_json::Map<String, Value>> {
    metadata
        .get(LIME_RUNTIME_METADATA_KEY)
        .and_then(Value::as_object)
}

fn extract_lime_runtime_payload<T: DeserializeOwned>(
    metadata: &std::collections::HashMap<String, Value>,
    key: &str,
) -> Option<T> {
    let runtime = extract_lime_runtime_object(metadata)?;
    serde_json::from_value(runtime.get(key)?.clone()).ok()
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
    let normalize_session_mode = |value: Option<String>| -> Option<String> {
        match value
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            Some("theme_workbench") | Some("general_workbench") => {
                Some("general_workbench".to_string())
            }
            Some("default") => Some("default".to_string()),
            _ => None,
        }
    };
    RecentHarnessContext {
        theme: resolve_text(&["theme", "harness_theme", "harnessTheme"]),
        session_mode: normalize_session_mode(resolve_text(&["session_mode", "sessionMode"])),
        gate_key: resolve_text(&["gate_key", "gateKey"]),
        run_title: resolve_text(&["run_title", "runTitle", "title"]),
        content_id: resolve_text(&["content_id", "contentId"]),
    }
}

fn extract_task_profile_from_metadata(
    metadata: &std::collections::HashMap<String, Value>,
) -> Option<SessionExecutionRuntimeTaskProfile> {
    let mut profile: SessionExecutionRuntimeTaskProfile =
        extract_lime_runtime_payload(metadata, LIME_RUNTIME_TASK_PROFILE_KEY)?;
    profile.kind = normalize_optional_text(Some(std::mem::take(&mut profile.kind)))?;
    profile.source = normalize_optional_text(Some(std::mem::take(&mut profile.source)))?;
    profile.traits = profile
        .traits
        .into_iter()
        .filter_map(|value| normalize_optional_text(Some(value)))
        .collect();
    profile.modality_contract_key = normalize_optional_text(profile.modality_contract_key);
    profile.routing_slot = normalize_optional_text(profile.routing_slot);
    profile.execution_profile_key = normalize_optional_text(profile.execution_profile_key);
    profile.executor_adapter_key = normalize_optional_text(profile.executor_adapter_key);
    profile.executor_kind = normalize_optional_text(profile.executor_kind);
    profile.executor_binding_key = normalize_optional_text(profile.executor_binding_key);
    profile.permission_profile_keys = profile
        .permission_profile_keys
        .into_iter()
        .filter_map(|value| normalize_optional_text(Some(value)))
        .collect();
    profile.user_lock_policy = normalize_optional_text(profile.user_lock_policy);
    profile.service_model_slot = normalize_optional_text(profile.service_model_slot);
    profile.scene_kind = normalize_optional_text(profile.scene_kind);
    profile.scene_skill_id = normalize_optional_text(profile.scene_skill_id);
    profile.entry_source = normalize_optional_text(profile.entry_source);
    Some(profile)
}

fn extract_routing_decision_from_metadata(
    metadata: &std::collections::HashMap<String, Value>,
) -> Option<SessionExecutionRuntimeRoutingDecision> {
    let mut decision: SessionExecutionRuntimeRoutingDecision =
        extract_lime_runtime_payload(metadata, LIME_RUNTIME_ROUTING_DECISION_KEY)?;
    decision.routing_mode =
        normalize_optional_text(Some(std::mem::take(&mut decision.routing_mode)))?;
    decision.decision_source =
        normalize_optional_text(Some(std::mem::take(&mut decision.decision_source)))?;
    decision.decision_reason =
        normalize_optional_text(Some(std::mem::take(&mut decision.decision_reason)))
            .unwrap_or_default();
    decision.selected_provider = normalize_optional_text(decision.selected_provider);
    decision.selected_model = normalize_optional_text(decision.selected_model);
    decision.requested_provider = normalize_optional_text(decision.requested_provider);
    decision.requested_model = normalize_optional_text(decision.requested_model);
    decision.estimated_cost_class = normalize_optional_text(decision.estimated_cost_class);
    decision.capability_gap = normalize_optional_text(decision.capability_gap);
    decision.fallback_chain = decision
        .fallback_chain
        .into_iter()
        .filter_map(|value| normalize_optional_text(Some(value)))
        .collect();
    decision.settings_source = normalize_optional_text(decision.settings_source);
    decision.service_model_slot = normalize_optional_text(decision.service_model_slot);
    Some(decision)
}

fn extract_limit_state_from_metadata(
    metadata: &std::collections::HashMap<String, Value>,
) -> Option<SessionExecutionRuntimeLimitState> {
    let mut limit_state: SessionExecutionRuntimeLimitState =
        extract_lime_runtime_payload(metadata, LIME_RUNTIME_LIMIT_STATE_KEY)?;
    limit_state.status = normalize_optional_text(Some(std::mem::take(&mut limit_state.status)))?;
    limit_state.capability_gap = normalize_optional_text(limit_state.capability_gap);
    limit_state.notes = limit_state
        .notes
        .into_iter()
        .filter_map(|value| normalize_optional_text(Some(value)))
        .collect();
    Some(limit_state)
}

fn extract_cost_state_from_metadata(
    metadata: &std::collections::HashMap<String, Value>,
) -> Option<SessionExecutionRuntimeCostState> {
    let mut cost_state: SessionExecutionRuntimeCostState =
        extract_lime_runtime_payload(metadata, LIME_RUNTIME_COST_STATE_KEY)?;
    cost_state.status = normalize_optional_text(Some(std::mem::take(&mut cost_state.status)))?;
    cost_state.estimated_cost_class =
        normalize_optional_text(cost_state.estimated_cost_class.take());
    cost_state.currency = normalize_optional_text(cost_state.currency.take());
    Some(cost_state)
}

fn extract_permission_state_from_metadata(
    metadata: &std::collections::HashMap<String, Value>,
) -> Option<SessionExecutionRuntimePermissionState> {
    let mut permission_state: SessionExecutionRuntimePermissionState =
        extract_lime_runtime_payload(metadata, LIME_RUNTIME_PERMISSION_STATE_KEY)?;
    permission_state.status =
        normalize_optional_text(Some(std::mem::take(&mut permission_state.status)))?;
    permission_state.required_profile_keys = permission_state
        .required_profile_keys
        .into_iter()
        .filter_map(|value| normalize_optional_text(Some(value)))
        .collect();
    permission_state.ask_profile_keys = permission_state
        .ask_profile_keys
        .into_iter()
        .filter_map(|value| normalize_optional_text(Some(value)))
        .collect();
    permission_state.blocking_profile_keys = permission_state
        .blocking_profile_keys
        .into_iter()
        .filter_map(|value| normalize_optional_text(Some(value)))
        .collect();
    permission_state.decision_source =
        normalize_optional_text(Some(std::mem::take(&mut permission_state.decision_source)))?;
    permission_state.decision_scope =
        normalize_optional_text(Some(std::mem::take(&mut permission_state.decision_scope)))?;
    permission_state.confirmation_status =
        normalize_optional_text(permission_state.confirmation_status);
    permission_state.confirmation_request_id =
        normalize_optional_text(permission_state.confirmation_request_id);
    permission_state.confirmation_source =
        normalize_optional_text(permission_state.confirmation_source);
    permission_state.notes = permission_state
        .notes
        .into_iter()
        .filter_map(|value| normalize_optional_text(Some(value)))
        .collect();
    Some(permission_state)
}

fn extract_limit_event_from_metadata(
    metadata: &std::collections::HashMap<String, Value>,
) -> Option<SessionExecutionRuntimeLimitEvent> {
    let mut limit_event: SessionExecutionRuntimeLimitEvent =
        extract_lime_runtime_payload(metadata, LIME_RUNTIME_LIMIT_EVENT_KEY)?;
    limit_event.event_kind =
        normalize_optional_text(Some(std::mem::take(&mut limit_event.event_kind)))?;
    limit_event.message = normalize_optional_text(Some(std::mem::take(&mut limit_event.message)))?;
    Some(limit_event)
}

fn extract_oem_policy_from_metadata(
    metadata: &std::collections::HashMap<String, Value>,
) -> Option<SessionExecutionRuntimeOemPolicy> {
    let mut oem_policy: SessionExecutionRuntimeOemPolicy =
        extract_lime_runtime_payload(metadata, LIME_RUNTIME_OEM_POLICY_KEY)?;
    oem_policy.tenant_id =
        normalize_optional_text(Some(std::mem::take(&mut oem_policy.tenant_id)))?;
    oem_policy.provider_source = normalize_optional_text(oem_policy.provider_source);
    oem_policy.provider_key = normalize_optional_text(oem_policy.provider_key);
    oem_policy.default_model = normalize_optional_text(oem_policy.default_model);
    oem_policy.config_mode = normalize_optional_text(oem_policy.config_mode);
    oem_policy.offer_state = normalize_optional_text(oem_policy.offer_state);
    oem_policy.quota_status = normalize_optional_text(oem_policy.quota_status);
    Some(oem_policy)
}

fn extract_runtime_summary_from_metadata(
    metadata: &std::collections::HashMap<String, Value>,
) -> Option<SessionExecutionRuntimeSummary> {
    let mut summary: SessionExecutionRuntimeSummary =
        extract_lime_runtime_payload(metadata, LIME_RUNTIME_SUMMARY_KEY)?;
    summary.routing_mode = normalize_optional_text(summary.routing_mode);
    summary.decision_source = normalize_optional_text(summary.decision_source);
    summary.decision_reason = normalize_optional_text(summary.decision_reason);
    summary.estimated_cost_class = normalize_optional_text(summary.estimated_cost_class);
    summary.limit_status = normalize_optional_text(summary.limit_status);
    summary.limit_event_kind = normalize_optional_text(summary.limit_event_kind);
    summary.limit_event_message = normalize_optional_text(summary.limit_event_message);
    summary.capability_gap = normalize_optional_text(summary.capability_gap);
    summary.permission_status = normalize_optional_text(summary.permission_status);
    summary.fallback_chain = summary
        .fallback_chain
        .into_iter()
        .filter_map(|value| normalize_optional_text(Some(value)))
        .collect();
    Some(summary)
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
        task_profile: None,
        routing_decision: None,
        limit_state: None,
        cost_state: None,
        permission_state: None,
        limit_event: None,
        oem_policy: None,
        runtime_summary: None,
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
            runtime.task_profile = latest_turn
                .context_override
                .as_ref()
                .and_then(|value| extract_task_profile_from_metadata(&value.metadata));
            runtime.routing_decision = latest_turn
                .context_override
                .as_ref()
                .and_then(|value| extract_routing_decision_from_metadata(&value.metadata));
            runtime.limit_state = latest_turn
                .context_override
                .as_ref()
                .and_then(|value| extract_limit_state_from_metadata(&value.metadata));
            runtime.cost_state = latest_turn
                .context_override
                .as_ref()
                .and_then(|value| extract_cost_state_from_metadata(&value.metadata));
            runtime.permission_state = latest_turn
                .context_override
                .as_ref()
                .and_then(|value| extract_permission_state_from_metadata(&value.metadata));
            runtime.oem_policy = latest_turn
                .context_override
                .as_ref()
                .and_then(|value| extract_oem_policy_from_metadata(&value.metadata));
            runtime.runtime_summary = latest_turn
                .context_override
                .as_ref()
                .and_then(|value| extract_runtime_summary_from_metadata(&value.metadata));
            let metadata_limit_event = latest_turn
                .context_override
                .as_ref()
                .and_then(|value| extract_limit_event_from_metadata(&value.metadata));
            runtime.limit_event = detect_runtime_limit_event(latest_turn.error_message.as_deref())
                .or(metadata_limit_event);
            if let (Some(cost_state), Some(session)) = (runtime.cost_state.take(), session) {
                runtime.cost_state = Some(
                    resolve_session_token_usage(session)
                        .map(|usage| apply_usage_to_cost_state(cost_state.clone(), &usage))
                        .unwrap_or(cost_state),
                );
            }
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
        && runtime.task_profile.is_none()
        && runtime.routing_decision.is_none()
        && runtime.limit_state.is_none()
        && runtime.cost_state.is_none()
        && runtime.permission_state.is_none()
        && runtime.limit_event.is_none()
    {
        return None;
    }

    Some(runtime)
}

fn has_runtime_model_permission_fallback_warning(items: &[AgentThreadItem], turn_id: &str) -> bool {
    items.iter().any(|item| {
        item.turn_id == turn_id
            && matches!(
                &item.payload,
                AgentThreadItemPayload::Warning {
                    code: Some(code),
                    ..
                } if code == RUNTIME_MODEL_PERMISSION_FALLBACK_WARNING_CODE
            )
    })
}

pub fn reconcile_session_execution_runtime_permission_fallback(
    runtime: &mut SessionExecutionRuntime,
    items: &[AgentThreadItem],
    persisted_session_model_name: Option<&str>,
) {
    let Some(latest_turn_id) = runtime.latest_turn_id.as_deref() else {
        return;
    };
    if !has_runtime_model_permission_fallback_warning(items, latest_turn_id) {
        return;
    }

    let Some(session_model_name) = persisted_session_model_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
    else {
        return;
    };

    runtime.model_name = Some(session_model_name.clone());

    if let Some(output_schema_runtime) = runtime.output_schema_runtime.as_mut() {
        output_schema_runtime.model_name = Some(session_model_name.clone());
    }

    if let Some(routing_decision) = runtime.routing_decision.as_mut() {
        routing_decision.selected_model = Some(session_model_name);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        apply_usage_to_cost_state, build_session_execution_runtime, detect_runtime_limit_event,
        reconcile_session_execution_runtime_permission_fallback, SessionExecutionRuntime,
        SessionExecutionRuntimeAccessMode, SessionExecutionRuntimeCostState,
        SessionExecutionRuntimeLimitEvent, SessionExecutionRuntimePreferences,
        SessionExecutionRuntimeRecentTeamRole, SessionExecutionRuntimeRecentTeamSelection,
        SessionExecutionRuntimeRoutingDecision, SessionExecutionRuntimeSource,
    };
    use aster::model::ModelConfig;
    use aster::session::ExtensionState;
    use aster::session::{
        Session, SessionRuntimeSnapshot, ThreadRuntime, ThreadRuntimeSnapshot, TurnContextOverride,
        TurnOutputSchemaRuntime, TurnOutputSchemaSource, TurnOutputSchemaStrategy, TurnRuntime,
        TurnStatus,
    };
    use chrono::{Duration, Utc};
    use lime_core::database::dao::agent_timeline::{
        AgentThreadItem, AgentThreadItemPayload, AgentThreadItemStatus,
    };
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
    fn access_mode_serde_prefers_kebab_case_and_accepts_legacy_snake_case() {
        assert_eq!(
            serde_json::to_value(SessionExecutionRuntimeAccessMode::FullAccess)
                .expect("serialize access mode"),
            json!("full-access")
        );
        assert_eq!(
            serde_json::from_value::<SessionExecutionRuntimeAccessMode>(json!("full-access"))
                .expect("deserialize kebab-case access mode"),
            SessionExecutionRuntimeAccessMode::FullAccess
        );
        assert_eq!(
            serde_json::from_value::<SessionExecutionRuntimeAccessMode>(json!("full_access"))
                .expect("deserialize legacy snake_case access mode"),
            SessionExecutionRuntimeAccessMode::FullAccess
        );
    }

    #[test]
    fn default_session_access_mode_is_full_access() {
        assert_eq!(
            SessionExecutionRuntimeAccessMode::default_for_session(),
            SessionExecutionRuntimeAccessMode::FullAccess
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
                        "theme": "general",
                        "session_mode": "general_workbench",
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

        assert_eq!(runtime.recent_theme.as_deref(), Some("general"));
        assert_eq!(
            runtime.recent_session_mode.as_deref(),
            Some("general_workbench")
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
            .insert("session_mode".to_string(), json!("general_workbench"));
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
            Some("general_workbench")
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

    #[test]
    fn extracts_task_routing_and_limit_state_from_lime_runtime_metadata() {
        let now = Utc::now();
        let snapshot = SessionRuntimeSnapshot {
            session_id: "session-routing".to_string(),
            threads: vec![ThreadRuntimeSnapshot {
                thread: ThreadRuntime::new(
                    "thread-1",
                    "session-routing",
                    PathBuf::from("/tmp/workspace"),
                ),
                turns: vec![TurnRuntime {
                    id: "turn-1".to_string(),
                    session_id: "session-routing".to_string(),
                    thread_id: "thread-1".to_string(),
                    status: TurnStatus::Completed,
                    input_text: Some("继续处理翻译任务".to_string()),
                    error_message: None,
                    context_override: Some(TurnContextOverride {
                        metadata: [(
                            "lime_runtime".to_string(),
                            json!({
                                "task_profile": {
                                    "kind": "translation",
                                    "source": "translation_skill_launch",
                                    "traits": ["service_model_slot"],
                                    "serviceModelSlot": "translation"
                                },
                                "routing_decision": {
                                    "routingMode": "single_candidate",
                                    "decisionSource": "service_model_setting",
                                    "decisionReason": "命中 service_models.translation",
                                    "selectedProvider": "openai",
                                    "selectedModel": "gpt-4.1-mini",
                                    "candidateCount": 1,
                                    "estimatedCostClass": "low",
                                    "settingsSource": "service_models.translation",
                                    "serviceModelSlot": "translation"
                                },
                                "limit_state": {
                                    "status": "single_candidate_only",
                                    "singleCandidateOnly": true,
                                    "providerLocked": true,
                                    "settingsLocked": true,
                                    "oemLocked": false,
                                    "candidateCount": 1,
                                    "notes": ["命中设置中的翻译模型"]
                                },
                                "permission_state": {
                                    "status": "requires_confirmation",
                                    "requiredProfileKeys": ["read_files", "write_artifacts", "ask_user_question"],
                                    "askProfileKeys": ["read_files", "write_artifacts"],
                                    "blockingProfileKeys": [],
                                    "decisionSource": "execution_profile_registry",
                                    "decisionScope": "declared_permission_profiles_only",
                                    "notes": ["只记录声明，不执行真实授权。"]
                                }
                            }),
                        )]
                        .into_iter()
                        .collect(),
                        ..TurnContextOverride::default()
                    }),
                    output_schema_runtime: None,
                    created_at: now,
                    started_at: Some(now),
                    completed_at: Some(now),
                    updated_at: now,
                }],
                items: Vec::new(),
            }],
        };

        let runtime =
            build_session_execution_runtime("session-routing", None, None, Some(&snapshot), None)
                .expect("runtime");

        assert_eq!(
            runtime
                .task_profile
                .as_ref()
                .map(|value| value.kind.as_str()),
            Some("translation")
        );
        assert_eq!(
            runtime
                .routing_decision
                .as_ref()
                .map(|value| value.decision_source.as_str()),
            Some("service_model_setting")
        );
        assert_eq!(
            runtime
                .limit_state
                .as_ref()
                .map(|value| value.single_candidate_only),
            Some(true)
        );
        let permission_state = runtime
            .permission_state
            .as_ref()
            .expect("permission state should be extracted");
        assert_eq!(permission_state.status, "requires_confirmation");
        assert_eq!(
            permission_state.required_profile_keys,
            vec![
                "read_files".to_string(),
                "write_artifacts".to_string(),
                "ask_user_question".to_string()
            ]
        );
        assert_eq!(
            permission_state.ask_profile_keys,
            vec!["read_files".to_string(), "write_artifacts".to_string()]
        );
        assert!(permission_state.blocking_profile_keys.is_empty());
        assert_eq!(
            permission_state.confirmation_status.as_deref(),
            Some("not_requested")
        );
        assert!(permission_state.confirmation_request_id.is_none());
        assert_eq!(
            permission_state.confirmation_source.as_deref(),
            Some("declared_profile_only")
        );
        assert_eq!(
            runtime
                .cost_state
                .as_ref()
                .and_then(|value| value.estimated_cost_class.as_deref()),
            None
        );
        assert!(runtime.limit_event.is_none());
    }

    #[test]
    fn extracts_cost_state_and_limit_event_from_latest_turn() {
        let now = Utc::now();
        let mut session = Session::default();
        session.id = "session-cost".to_string();
        session.input_tokens = Some(1200);
        session.output_tokens = Some(300);
        session.cached_input_tokens = Some(100);
        session.cache_creation_input_tokens = Some(50);

        let snapshot = SessionRuntimeSnapshot {
            session_id: "session-cost".to_string(),
            threads: vec![ThreadRuntimeSnapshot {
                thread: ThreadRuntime::new(
                    "thread-1",
                    "session-cost",
                    PathBuf::from("/tmp/workspace"),
                ),
                turns: vec![TurnRuntime {
                    id: "turn-1".to_string(),
                    session_id: "session-cost".to_string(),
                    thread_id: "thread-1".to_string(),
                    status: TurnStatus::Failed,
                    input_text: Some("继续".to_string()),
                    error_message: Some("429 Too Many Requests".to_string()),
                    context_override: Some(TurnContextOverride {
                        metadata: [(
                            "lime_runtime".to_string(),
                            json!({
                                "cost_state": {
                                    "status": "estimated",
                                    "estimatedCostClass": "low",
                                    "inputPerMillion": 1.0,
                                    "outputPerMillion": 2.0,
                                    "cacheReadPerMillion": 0.5,
                                    "cacheWritePerMillion": 1.5,
                                    "currency": "USD"
                                }
                            }),
                        )]
                        .into_iter()
                        .collect(),
                        ..TurnContextOverride::default()
                    }),
                    output_schema_runtime: None,
                    created_at: now,
                    started_at: Some(now),
                    completed_at: Some(now),
                    updated_at: now,
                }],
                items: Vec::new(),
            }],
        };

        let runtime = build_session_execution_runtime(
            "session-cost",
            Some(&session),
            None,
            Some(&snapshot),
            None,
        )
        .expect("runtime");

        let cost_state = runtime.cost_state.expect("应提取 cost_state");
        assert_eq!(cost_state.status, "recorded");
        assert_eq!(cost_state.total_tokens, Some(1500));
        assert_eq!(cost_state.cached_input_tokens, Some(100));
        assert_eq!(cost_state.cache_creation_input_tokens, Some(50));
        assert!(cost_state
            .estimated_total_cost
            .is_some_and(|value| (value - 0.002825).abs() < 1e-12));
        assert_eq!(
            runtime.limit_event,
            Some(SessionExecutionRuntimeLimitEvent {
                event_kind: "rate_limit_hit".to_string(),
                message: "429 Too Many Requests".to_string(),
                retryable: true,
            })
        );
    }

    #[test]
    fn extracts_limit_event_from_turn_metadata_without_error_text() {
        let now = Utc::now();
        let snapshot = SessionRuntimeSnapshot {
            session_id: "session-oem-limit".to_string(),
            threads: vec![ThreadRuntimeSnapshot {
                thread: ThreadRuntime::new(
                    "thread-1",
                    "session-oem-limit",
                    PathBuf::from("/tmp/workspace"),
                ),
                turns: vec![TurnRuntime {
                    id: "turn-1".to_string(),
                    session_id: "session-oem-limit".to_string(),
                    thread_id: "thread-1".to_string(),
                    status: TurnStatus::Completed,
                    input_text: Some("继续".to_string()),
                    error_message: None,
                    context_override: Some(TurnContextOverride {
                        metadata: [(
                            "lime_runtime".to_string(),
                            json!({
                                "limit_event": {
                                    "eventKind": "quota_low",
                                    "message": "OEM 云端额度偏低",
                                    "retryable": true
                                }
                            }),
                        )]
                        .into_iter()
                        .collect(),
                        ..TurnContextOverride::default()
                    }),
                    output_schema_runtime: None,
                    created_at: now,
                    started_at: Some(now),
                    completed_at: Some(now),
                    updated_at: now,
                }],
                items: Vec::new(),
            }],
        };

        let runtime =
            build_session_execution_runtime("session-oem-limit", None, None, Some(&snapshot), None)
                .expect("runtime");

        assert_eq!(
            runtime.limit_event,
            Some(SessionExecutionRuntimeLimitEvent {
                event_kind: "quota_low".to_string(),
                message: "OEM 云端额度偏低".to_string(),
                retryable: true,
            })
        );
        assert_eq!(
            runtime
                .oem_policy
                .as_ref()
                .and_then(|value| value.tenant_id.clone().into()),
            Some("tenant-1".to_string())
        );
        assert_eq!(
            runtime
                .runtime_summary
                .as_ref()
                .and_then(|value| value.limit_event_kind.as_deref()),
            Some("quota_low")
        );
    }

    #[test]
    fn permission_fallback_warning_prefers_persisted_session_model_in_runtime_view() {
        let mut runtime = SessionExecutionRuntime {
            session_id: "session-fallback".to_string(),
            provider_selector: Some("custom-mimo".to_string()),
            provider_name: Some("anthropic".to_string()),
            model_name: Some("mimo-v2-flash".to_string()),
            execution_strategy: Some("react".to_string()),
            output_schema_runtime: None,
            source: SessionExecutionRuntimeSource::RuntimeSnapshot,
            mode: None,
            latest_turn_id: Some("turn-fallback".to_string()),
            latest_turn_status: Some("completed".to_string()),
            recent_access_mode: None,
            recent_preferences: None,
            recent_team_selection: None,
            recent_theme: None,
            recent_session_mode: None,
            recent_gate_key: None,
            recent_run_title: None,
            recent_content_id: None,
            task_profile: None,
            routing_decision: Some(SessionExecutionRuntimeRoutingDecision {
                routing_mode: "multi_candidate".to_string(),
                decision_source: "request_override".to_string(),
                decision_reason:
                    "当前回合的 provider/model 选择优先遵循显式偏好，其次回退到会话默认。"
                        .to_string(),
                selected_provider: Some("custom-mimo".to_string()),
                selected_model: Some("mimo-v2-flash".to_string()),
                requested_provider: Some("custom-mimo".to_string()),
                requested_model: Some("mimo-v2-flash".to_string()),
                candidate_count: 7,
                estimated_cost_class: Some("medium".to_string()),
                capability_gap: None,
                fallback_chain: Vec::new(),
                settings_source: None,
                service_model_slot: None,
            }),
            limit_state: None,
            cost_state: None,
            permission_state: None,
            limit_event: None,
            oem_policy: None,
            runtime_summary: None,
        };
        let items = vec![AgentThreadItem {
            id: "warning-1".to_string(),
            thread_id: "session-fallback".to_string(),
            turn_id: "turn-fallback".to_string(),
            sequence: 1,
            status: AgentThreadItemStatus::Completed,
            started_at: Utc::now().to_rfc3339(),
            completed_at: Some(Utc::now().to_rfc3339()),
            updated_at: Utc::now().to_rfc3339(),
            payload: AgentThreadItemPayload::Warning {
                message: "当前模型暂不可用，已自动切换到兼容候选。".to_string(),
                code: Some("runtime_model_permission_fallback".to_string()),
            },
        }];

        reconcile_session_execution_runtime_permission_fallback(
            &mut runtime,
            &items,
            Some("mimo-v2.5-pro"),
        );

        assert_eq!(runtime.model_name.as_deref(), Some("mimo-v2.5-pro"));
        assert_eq!(
            runtime
                .routing_decision
                .as_ref()
                .and_then(|value| value.selected_model.as_deref()),
            Some("mimo-v2.5-pro")
        );
        assert_eq!(
            runtime
                .routing_decision
                .as_ref()
                .and_then(|value| value.requested_model.as_deref()),
            Some("mimo-v2-flash")
        );
    }

    #[test]
    fn apply_usage_to_cost_state_should_calculate_estimated_total_cost() {
        let cost_state = SessionExecutionRuntimeCostState {
            status: "estimated".to_string(),
            estimated_cost_class: Some("medium".to_string()),
            input_per_million: Some(2.0),
            output_per_million: Some(8.0),
            cache_read_per_million: Some(0.5),
            cache_write_per_million: Some(1.0),
            currency: Some("USD".to_string()),
            estimated_total_cost: None,
            input_tokens: None,
            output_tokens: None,
            total_tokens: None,
            cached_input_tokens: None,
            cache_creation_input_tokens: None,
        };
        let usage = crate::protocol::AgentTokenUsage {
            input_tokens: 1000,
            output_tokens: 500,
            cached_input_tokens: Some(200),
            cache_creation_input_tokens: Some(50),
        };

        let applied = apply_usage_to_cost_state(cost_state, &usage);

        assert_eq!(applied.status, "recorded");
        assert_eq!(applied.total_tokens, Some(1500));
        assert!(applied
            .estimated_total_cost
            .is_some_and(|value| (value - 0.00615).abs() < 1e-12));
    }

    #[test]
    fn detect_runtime_limit_event_should_classify_rate_limit_and_quota() {
        assert_eq!(
            detect_runtime_limit_event(Some("429 Too Many Requests")),
            Some(SessionExecutionRuntimeLimitEvent {
                event_kind: "rate_limit_hit".to_string(),
                message: "429 Too Many Requests".to_string(),
                retryable: true,
            })
        );
        assert_eq!(
            detect_runtime_limit_event(Some("余额不足，请充值后继续")),
            Some(SessionExecutionRuntimeLimitEvent {
                event_kind: "quota_blocked".to_string(),
                message: "余额不足，请充值后继续".to_string(),
                retryable: false,
            })
        );
        assert_eq!(
            detect_runtime_limit_event(Some("available_quota_low: credits running low")),
            Some(SessionExecutionRuntimeLimitEvent {
                event_kind: "quota_low".to_string(),
                message: "available_quota_low: credits running low".to_string(),
                retryable: true,
            })
        );
        assert!(detect_runtime_limit_event(Some("unknown error")).is_none());
    }
}
