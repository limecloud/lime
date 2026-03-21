use serde::{Deserialize, Serialize};

use crate::turn_input_envelope::TurnRequestToolPolicySnapshot;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TurnState {
    pub session_id: String,
    pub workspace_id: String,
    pub thread_id: String,
    pub turn_id: String,
    pub requested_execution_strategy: String,
    pub effective_execution_strategy: String,
    pub request_tool_policy: TurnRequestToolPolicySnapshot,
    pub include_context_trace: bool,
    pub runtime_chat_mode: String,
}

impl TurnState {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        session_id: impl Into<String>,
        workspace_id: impl Into<String>,
        thread_id: impl Into<String>,
        turn_id: impl Into<String>,
        requested_execution_strategy: impl Into<String>,
        effective_execution_strategy: impl Into<String>,
        request_tool_policy: TurnRequestToolPolicySnapshot,
        include_context_trace: bool,
        runtime_chat_mode: impl Into<String>,
    ) -> Self {
        Self {
            session_id: session_id.into(),
            workspace_id: workspace_id.into(),
            thread_id: thread_id.into(),
            turn_id: turn_id.into(),
            requested_execution_strategy: requested_execution_strategy.into(),
            effective_execution_strategy: effective_execution_strategy.into(),
            request_tool_policy,
            include_context_trace,
            runtime_chat_mode: runtime_chat_mode.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::TurnState;
    use crate::turn_input_envelope::TurnRequestToolPolicySnapshot;

    #[test]
    fn test_turn_state_is_serializable_and_complete() {
        let turn_state = TurnState::new(
            "session-1",
            "workspace-1",
            "thread-1",
            "turn-1",
            "auto",
            "react",
            TurnRequestToolPolicySnapshot {
                search_mode: "allowed".to_string(),
                effective_web_search: true,
                required_tools: vec!["WebSearch".to_string()],
                allowed_tools: vec!["WebSearch".to_string(), "WebFetch".to_string()],
                disallowed_tools: vec![],
            },
            true,
            "agent",
        );

        let value = serde_json::to_value(&turn_state).expect("serialize turn state");
        assert_eq!(value["thread_id"], serde_json::json!("thread-1"));
        assert_eq!(value["turn_id"], serde_json::json!("turn-1"));
        assert_eq!(
            value["effective_execution_strategy"],
            serde_json::json!("react")
        );
        assert_eq!(value["runtime_chat_mode"], serde_json::json!("agent"));
    }
}
