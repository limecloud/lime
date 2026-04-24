use aster::session::TurnOutputSchemaRuntime;
use lime_core::database::dao::agent_timeline::{AgentThreadItem, AgentThreadTurn};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;

use crate::queued_turn::QueuedTurnSnapshot;
use crate::session_execution_runtime::{
    SessionExecutionRuntimeCostState, SessionExecutionRuntimeLimitEvent,
    SessionExecutionRuntimeLimitState, SessionExecutionRuntimeRoutingDecision,
    SessionExecutionRuntimeTaskProfile,
};

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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<AgentToolImage>>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTokenUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cached_input_tokens: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_creation_input_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentContextTraceStep {
    pub stage: String,
    pub detail: String,
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
pub struct AgentActionRequiredScope {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AgentEvent {
    #[serde(rename = "thread_started")]
    ThreadStarted { thread_id: String },

    #[serde(rename = "turn_started")]
    TurnStarted { turn: AgentThreadTurn },

    #[serde(rename = "item_started")]
    ItemStarted { item: AgentThreadItem },

    #[serde(rename = "item_updated")]
    ItemUpdated { item: AgentThreadItem },

    #[serde(rename = "item_completed")]
    ItemCompleted { item: AgentThreadItem },

    #[serde(rename = "turn_completed")]
    TurnCompleted { turn: AgentThreadTurn },

    #[serde(rename = "turn_failed")]
    TurnFailed { turn: AgentThreadTurn },

    #[serde(rename = "text_delta")]
    TextDelta { text: String },

    #[serde(rename = "thinking_delta")]
    ThinkingDelta { text: String },

    #[serde(rename = "tool_start")]
    ToolStart {
        tool_name: String,
        tool_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        arguments: Option<String>,
    },

    #[serde(rename = "tool_end")]
    ToolEnd {
        tool_id: String,
        result: AgentToolResult,
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

    #[serde(rename = "turn_context")]
    TurnContext {
        session_id: String,
        thread_id: String,
        turn_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        output_schema_runtime: Option<TurnOutputSchemaRuntime>,
    },

    #[serde(rename = "model_change")]
    ModelChange { model: String, mode: String },

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

    #[serde(rename = "queue_added")]
    QueueAdded {
        session_id: String,
        queued_turn: QueuedTurnSnapshot,
    },

    #[serde(rename = "queue_removed")]
    QueueRemoved {
        session_id: String,
        queued_turn_id: String,
    },

    #[serde(rename = "queue_started")]
    QueueStarted {
        session_id: String,
        queued_turn_id: String,
    },

    #[serde(rename = "queue_cleared")]
    QueueCleared {
        session_id: String,
        queued_turn_ids: Vec<String>,
    },

    #[serde(rename = "done")]
    Done {
        #[serde(skip_serializing_if = "Option::is_none")]
        usage: Option<AgentTokenUsage>,
    },

    #[serde(rename = "final_done")]
    FinalDone {
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
    pub selected_team_id: Option<String>,
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
mod tests {
    use super::*;

    #[test]
    fn agent_op_user_input_serializes_with_protocol_tag() {
        let value = serde_json::to_value(AgentOp::UserInput(AgentUserInputOp {
            text: "继续处理当前任务".to_string(),
            images: vec![AgentImageAttachment {
                data: "aGVsbG8=".to_string(),
                media_type: "image/png".to_string(),
            }],
            preferences: AgentUserPreferences {
                provider_preference: Some("openai".to_string()),
                model_preference: Some("gpt-5.4".to_string()),
                thinking: Some(true),
                web_search: Some(false),
                search_mode: Some("disabled".to_string()),
                execution_strategy: Some("react".to_string()),
                task: Some(false),
                subagent: Some(false),
                theme: Some("general".to_string()),
                selected_team_id: None,
                auto_continue: Some(serde_json::json!({
                    "enabled": true,
                    "continuation_length": 3
                })),
            },
            session_id: "session-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            event_name: "aster_stream_session-1".to_string(),
            turn_id: Some("turn-1".to_string()),
            system_prompt: Some("保持简洁".to_string()),
            metadata: Some(Map::from_iter([(
                "theme".to_string(),
                Value::String("general".to_string()),
            )])),
            queue_if_busy: Some(true),
            queued_turn_id: Some("queued-1".to_string()),
        }))
        .expect("serialize agent op");

        assert_eq!(value["type"], "user_input");
        assert_eq!(value["preferences"]["provider_preference"], "openai");
        assert_eq!(value["session_id"], "session-1");
        assert_eq!(value["queue_if_busy"], true);
    }

    #[test]
    fn agent_op_interrupt_deserializes_from_snake_case_tag() {
        let op: AgentOp = serde_json::from_value(serde_json::json!({
            "type": "interrupt",
            "session_id": "session-2",
            "turn_id": "turn-2"
        }))
        .expect("deserialize interrupt op");

        assert_eq!(
            op,
            AgentOp::Interrupt {
                session_id: "session-2".to_string(),
                turn_id: Some("turn-2".to_string()),
            }
        );
    }

    #[test]
    fn agent_image_attachment_deserializes_media_type_alias() {
        let attachment: AgentImageAttachment = serde_json::from_value(serde_json::json!({
            "data": "aGVsbG8=",
            "mediaType": "image/png"
        }))
        .expect("deserialize image attachment");

        assert_eq!(attachment.media_type, "image/png");
    }

    #[test]
    fn agent_event_runtime_status_serializes_with_protocol_tag() {
        let value = serde_json::to_value(AgentEvent::RuntimeStatus {
            status: AgentRuntimeStatus {
                phase: "routing".to_string(),
                title: "等待执行窗口".to_string(),
                detail: "系统正在安排执行窗口".to_string(),
                checkpoints: vec!["并发预算 1/2".to_string()],
                metadata: None,
            },
        })
        .expect("serialize runtime status");

        assert_eq!(value["type"], "runtime_status");
        assert_eq!(value["status"]["phase"], "routing");
    }
}
