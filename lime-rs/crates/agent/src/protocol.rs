use agent_protocol::hook::HookRunSummary;
use agent_protocol::provider_trace::{ProviderTraceEvent, ProviderTraceStage};
use agent_protocol::response_item::MessagePhase;
use agent_protocol::turn_context::TurnOutputSchemaRuntime;
use agent_protocol::ThreadItem;
use lime_core::database::dao::agent_timeline::AgentThreadTurn;
use model_provider::current_client::{ModelRerouteReason, ModelVerification};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;

use crate::session_execution_runtime::{
    SessionExecutionRuntimeCostState, SessionExecutionRuntimeLimitEvent,
    SessionExecutionRuntimeLimitState, SessionExecutionRuntimeRoutingDecision,
    SessionExecutionRuntimeTaskProfile,
};

mod protocol_agent_control;
mod tool_lifecycle;
pub(crate) use protocol_agent_control::CanonicalSubAgentActivity;
pub(crate) use tool_lifecycle::{
    apply_command_start, canonical_command_start_item, canonical_tool_item_event,
    ToolItemLifecycleContext,
};

pub type AgentActionRequiredScope = agent_protocol::action_required::ActionRequiredScope;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentToolImage {
    pub src: String,
    #[serde(rename = "mimeType", skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentToolResult {
    pub success: bool,
    pub output: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(
        default,
        rename = "structuredContent",
        skip_serializing_if = "Option::is_none"
    )]
    pub structured_content: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<AgentToolImage>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<HashMap<String, Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentToolProgressPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<HashMap<String, Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentArtifactSignal {
    pub artifact_id: String,
    pub file_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<HashMap<String, Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentTokenUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cached_input_tokens: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_creation_input_tokens: Option<u32>,
    #[serde(
        default,
        rename = "lime_rollout_budget_units",
        skip_serializing_if = "Option::is_none"
    )]
    pub lime_rollout_budget_units: Option<serde_json::Number>,
}

pub type AgentContextTraceStep = agent_protocol::context_trace::ContextTraceStep;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct AgentContextBudget {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub used_tokens: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remaining_tokens: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentMissingContextFact {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub kind: String,
    pub label: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentRetrievalRef {
    pub source_id: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub score: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentTeamMemoryRef {
    pub key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo_scope: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct AgentTurnContextSummary {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memory_budget: Option<AgentContextBudget>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub missing_context: Vec<AgentMissingContextFact>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub retrieval_refs: Vec<AgentRetrievalRef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub team_memory_refs: Vec<AgentTeamMemoryRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRuntimeStatus {
    pub phase: String,
    pub title: String,
    pub detail: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub checkpoints: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<HashMap<String, Value>>,
}

pub fn build_diagnostics_runtime_status_metadata() -> HashMap<String, Value> {
    agent_runtime::runtime_timeline::build_diagnostics_runtime_status_metadata()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMessage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub role: String,
    pub content: Vec<AgentMessageContent>,
    pub timestamp: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<AgentTokenUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AgentMessageContent {
    #[serde(rename = "text")]
    Text { text: String },

    #[serde(rename = "thinking")]
    Thinking { text: String },

    #[serde(rename = "tool_request")]
    ToolRequest {
        id: String,
        tool_name: String,
        arguments: Value,
    },

    #[serde(rename = "tool_response")]
    ToolResponse {
        id: String,
        success: bool,
        output: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
        #[serde(
            default,
            rename = "structuredContent",
            skip_serializing_if = "Option::is_none"
        )]
        structured_content: Option<Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        images: Option<Vec<AgentToolImage>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        metadata: Option<HashMap<String, Value>>,
    },

    #[serde(rename = "action_required")]
    ActionRequired {
        id: String,
        action_type: String,
        data: Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        scope: Option<AgentActionRequiredScope>,
    },

    #[serde(rename = "image")]
    Image { mime_type: String, data: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TextDeltaBatchBoundary {
    Newline,
    Backlog,
    Final,
    Provider,
}

pub type AgentProviderTraceStage = ProviderTraceStage;
pub type AgentProviderTraceEvent = ProviderTraceEvent;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GuardianReviewStatus {
    InProgress,
    Approved,
    Denied,
    TimedOut,
    Aborted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GuardianRiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GuardianUserAuthorization {
    Unknown,
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AgentEvent {
    /// Internal trace evidence. App Server consumes this before RuntimeEvent
    /// projection, so it never becomes a public ThreadItem or GUI event.
    #[serde(rename = "code_cell_trace")]
    CodeCellTrace {
        event: tool_runtime::tool_lifecycle::CodeCellTraceEvent,
    },

    #[serde(rename = "thread_started")]
    ThreadStarted { thread_id: String },

    #[serde(rename = "turn_started")]
    TurnStarted { turn: AgentThreadTurn },

    #[serde(rename = "item_started")]
    ItemStarted { item: ThreadItem },

    #[serde(rename = "item_updated")]
    ItemUpdated { item: ThreadItem },

    #[serde(rename = "item_completed")]
    ItemCompleted { item: ThreadItem },

    #[serde(rename = "turn_completed")]
    TurnCompleted { turn: AgentThreadTurn },

    #[serde(rename = "turn_failed")]
    TurnFailed { turn: AgentThreadTurn },

    #[serde(rename = "text_start")]
    TextStart {
        #[serde(rename = "itemId")]
        item_id: String,
    },

    #[serde(rename = "text_delta")]
    TextDelta {
        #[serde(rename = "itemId")]
        item_id: String,
        text: String,
    },

    #[serde(rename = "text_end")]
    TextEnd {
        #[serde(rename = "itemId")]
        item_id: String,
        phase: Option<MessagePhase>,
    },

    #[serde(rename = "text_completed")]
    TextCompleted {
        #[serde(rename = "itemId")]
        item_id: String,
        text: String,
        phase: Option<MessagePhase>,
    },

    #[serde(rename = "text_delta_batch")]
    TextDeltaBatch {
        text: String,
        chunks: Vec<String>,
        boundary: TextDeltaBatchBoundary,
    },

    #[serde(rename = "reasoning_start")]
    ReasoningStart {
        #[serde(rename = "itemId")]
        item_id: String,
    },

    #[serde(rename = "reasoning_summary_delta")]
    ReasoningSummaryDelta {
        #[serde(rename = "itemId")]
        item_id: String,
        text: String,
        #[serde(rename = "summaryIndex")]
        summary_index: i64,
    },

    #[serde(rename = "reasoning_summary_part_added")]
    ReasoningSummaryPartAdded {
        #[serde(rename = "itemId")]
        item_id: String,
        #[serde(rename = "summaryIndex")]
        summary_index: i64,
    },

    #[serde(rename = "reasoning_content_delta")]
    ReasoningContentDelta {
        #[serde(rename = "itemId")]
        item_id: String,
        text: String,
        #[serde(rename = "contentIndex")]
        content_index: i64,
    },

    #[serde(rename = "reasoning_end")]
    ReasoningEnd {
        #[serde(rename = "itemId")]
        item_id: String,
    },

    #[serde(rename = "reasoning_completed")]
    ReasoningCompleted {
        #[serde(rename = "itemId")]
        item_id: String,
        summary: Vec<String>,
        content: Vec<String>,
    },

    #[serde(rename = "tool_progress")]
    ToolProgress {
        tool_id: String,
        progress: AgentToolProgressPayload,
    },

    #[serde(rename = "tool_output_delta")]
    ToolOutputDelta {
        tool_id: String,
        delta: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        output_kind: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        metadata: Option<HashMap<String, Value>>,
    },

    #[serde(rename = "tool_input_delta")]
    ToolInputDelta {
        tool_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_name: Option<String>,
        delta: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        accumulated_arguments: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        provider: Option<String>,
    },

    #[serde(rename = "hook_started")]
    HookStarted {
        turn_id: Option<String>,
        run: HookRunSummary,
    },

    #[serde(rename = "hook_completed")]
    HookCompleted {
        turn_id: Option<String>,
        run: HookRunSummary,
    },

    #[serde(rename = "artifact_snapshot")]
    ArtifactSnapshot { artifact: AgentArtifactSignal },

    #[serde(rename = "action_required")]
    ActionRequired {
        request_id: String,
        action_type: String,
        data: Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        scope: Option<AgentActionRequiredScope>,
    },

    #[serde(rename = "action_resolved")]
    ActionResolved {
        request_id: String,
        action_type: String,
        data: Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        scope: Option<AgentActionRequiredScope>,
    },

    #[serde(rename = "dynamic_tool_call_requested")]
    DynamicToolCallRequested {
        call_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        namespace: Option<String>,
        tool: String,
        arguments: Value,
        phase: app_server_protocol::protocol::v2::DynamicToolCallPhase,
        #[serde(skip_serializing_if = "Option::is_none")]
        approval_token: Option<String>,
    },

    #[serde(rename = "turn_context")]
    TurnContext {
        session_id: String,
        thread_id: String,
        turn_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        execution_strategy: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        output_schema_runtime: Option<TurnOutputSchemaRuntime>,
        #[serde(skip_serializing_if = "Option::is_none")]
        context_summary: Option<AgentTurnContextSummary>,
        #[serde(skip_serializing_if = "Option::is_none")]
        approval_policy: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        sandbox_policy: Option<String>,
    },

    #[serde(rename = "model_change")]
    ModelChange { model: String, mode: String },

    #[serde(rename = "server_model")]
    ServerModel { model: String },

    #[serde(rename = "model_reroute")]
    ModelReroute {
        from_model: String,
        to_model: String,
        reason: ModelRerouteReason,
    },

    #[serde(rename = "model_verification")]
    ModelVerification {
        verifications: Vec<ModelVerification>,
    },

    #[serde(rename = "turn_moderation_metadata")]
    TurnModerationMetadata { metadata: Value },

    #[serde(rename = "guardian_review_started")]
    GuardianReviewStarted {
        review_id: String,
        #[serde(rename = "targetItemId", skip_serializing_if = "Option::is_none")]
        target_item_id: Option<String>,
        #[serde(rename = "turnId")]
        turn_id: String,
        action: Value,
        #[serde(rename = "startedAtMs")]
        started_at_ms: i64,
    },

    #[serde(rename = "guardian_review_completed")]
    GuardianReviewCompleted {
        review_id: String,
        #[serde(rename = "targetItemId", skip_serializing_if = "Option::is_none")]
        target_item_id: Option<String>,
        #[serde(rename = "turnId")]
        turn_id: String,
        status: GuardianReviewStatus,
        #[serde(rename = "riskLevel", skip_serializing_if = "Option::is_none")]
        risk_level: Option<GuardianRiskLevel>,
        #[serde(rename = "userAuthorization", skip_serializing_if = "Option::is_none")]
        user_authorization: Option<GuardianUserAuthorization>,
        #[serde(skip_serializing_if = "Option::is_none")]
        rationale: Option<String>,
        #[serde(rename = "decisionSource")]
        decision_source: String,
        action: Value,
        #[serde(rename = "startedAtMs")]
        started_at_ms: i64,
        #[serde(rename = "completedAtMs")]
        completed_at_ms: i64,
    },

    #[serde(rename = "guardian_warning")]
    GuardianWarning { message: String },

    #[serde(rename = "provider_trace")]
    ProviderTrace {
        #[serde(flatten)]
        event: AgentProviderTraceEvent,
    },

    #[serde(rename = "provider_stream_event")]
    ProviderStreamEvent {
        runtime_event_kind: String,
        payload: Value,
    },

    #[serde(rename = "context_trace")]
    ContextTrace { steps: Vec<AgentContextTraceStep> },

    #[serde(rename = "context_compaction_started")]
    ContextCompactionStarted {
        item_id: String,
        trigger: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        detail: Option<String>,
    },

    #[serde(rename = "context_compaction_completed")]
    ContextCompactionCompleted {
        item_id: String,
        trigger: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        detail: Option<String>,
        /// Set when the host already committed the canonical event to EventLog.
        /// The App Server forwards the receipt through its existing preappended path.
        #[serde(skip)]
        durable_event_id: Option<String>,
    },

    #[serde(rename = "runtime_status")]
    RuntimeStatus { status: AgentRuntimeStatus },

    #[serde(rename = "task_profile_resolved")]
    TaskProfileResolved {
        task_profile: SessionExecutionRuntimeTaskProfile,
    },

    #[serde(rename = "candidate_set_resolved")]
    CandidateSetResolved {
        routing_decision: SessionExecutionRuntimeRoutingDecision,
    },

    #[serde(rename = "routing_decision_made")]
    RoutingDecisionMade {
        routing_decision: SessionExecutionRuntimeRoutingDecision,
    },

    #[serde(rename = "routing_fallback_applied")]
    RoutingFallbackApplied {
        routing_decision: SessionExecutionRuntimeRoutingDecision,
    },

    #[serde(rename = "routing_not_possible")]
    RoutingNotPossible {
        routing_decision: SessionExecutionRuntimeRoutingDecision,
    },

    #[serde(rename = "limit_state_updated")]
    LimitStateUpdated {
        limit_state: SessionExecutionRuntimeLimitState,
    },

    #[serde(rename = "single_candidate_only")]
    SingleCandidateOnly {
        limit_state: SessionExecutionRuntimeLimitState,
    },

    #[serde(rename = "single_candidate_capability_gap")]
    SingleCandidateCapabilityGap {
        limit_state: SessionExecutionRuntimeLimitState,
    },

    #[serde(rename = "cost_estimated")]
    CostEstimated {
        cost_state: SessionExecutionRuntimeCostState,
    },

    #[serde(rename = "cost_recorded")]
    CostRecorded {
        cost_state: SessionExecutionRuntimeCostState,
    },

    #[serde(rename = "rate_limit_hit")]
    RateLimitHit {
        limit_event: SessionExecutionRuntimeLimitEvent,
    },

    #[serde(rename = "quota_low")]
    QuotaLow {
        limit_event: SessionExecutionRuntimeLimitEvent,
    },

    #[serde(rename = "quota_blocked")]
    QuotaBlocked {
        limit_event: SessionExecutionRuntimeLimitEvent,
    },

    #[serde(rename = "provider_usage")]
    ProviderUsage {
        attempt: u32,
        usage: AgentTokenUsage,
    },

    #[serde(rename = "rollout_budget_reminder")]
    RolloutBudgetReminder {
        #[serde(rename = "remainingTokens")]
        remaining_tokens: i64,
        #[serde(rename = "reminderIndex")]
        reminder_index: usize,
        #[serde(rename = "windowId")]
        window_id: String,
        #[serde(rename = "durableEventId")]
        durable_event_id: String,
        text: String,
    },

    #[serde(rename = "provider_step")]
    ProviderStep {
        attempt: u32,
        completed: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        finish_reason: Option<String>,
        text_output_chars: u64,
        reasoning_output_chars: u64,
        tool_call_count: u32,
        #[serde(skip_serializing_if = "Option::is_none")]
        usage: Option<AgentTokenUsage>,
    },

    #[serde(rename = "done")]
    Done {
        #[serde(skip_serializing_if = "Option::is_none")]
        usage: Option<AgentTokenUsage>,
    },

    #[serde(rename = "error")]
    Error { message: String },

    #[serde(rename = "warning")]
    Warning {
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        message: String,
    },

    #[serde(rename = "message")]
    Message { message: AgentMessage },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentImageAttachment {
    pub data: String,
    #[serde(alias = "mediaType")]
    pub media_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AgentUserPreferences {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_preference: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_preference: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub web_search: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub search_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution_strategy: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subagent: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_continue: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AgentUserInputOp {
    pub text: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<AgentImageAttachment>,
    pub preferences: AgentUserPreferences,
    pub session_id: String,
    pub workspace_id: String,
    pub event_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Map<String, Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub queue_if_busy: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub queued_turn_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
#[allow(clippy::large_enum_variant)]
pub enum AgentOp {
    UserInput(AgentUserInputOp),
    Interrupt {
        session_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        turn_id: Option<String>,
    },
    Retry {
        session_id: String,
        turn_id: String,
    },
    ConfigUpdate {
        session_id: String,
        key: String,
        value: Value,
    },
    Shutdown {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
    },
}

#[cfg(test)]
#[path = "protocol_agent_control_tests.rs"]
mod agent_control_tests;

#[cfg(test)]
#[path = "protocol/tests.rs"]
mod tests;
