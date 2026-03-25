use aster::session::TurnContextOverride;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::{
    provider_continuation_state::{ProviderContinuationCapability, ProviderContinuationState},
    request_tool_policy::RequestToolPolicy,
};

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn prompt_len(prompt: &Option<String>) -> Option<usize> {
    prompt.as_ref().map(|value| value.chars().count())
}

fn build_provider_continuation_metadata(
    provider_continuation: &ProviderContinuationState,
) -> Option<Value> {
    match provider_continuation {
        ProviderContinuationState::HistoryReplayOnly => None,
        ProviderContinuationState::ProviderSessionToken { session_token } => {
            Some(serde_json::json!({
                "enabled": true,
                "kind": "provider_session_token",
                "session_token": session_token,
            }))
        }
        ProviderContinuationState::PreviousResponseId {
            previous_response_id,
        } => Some(serde_json::json!({
            "enabled": true,
            "kind": "previous_response_id",
            "previous_response_id": previous_response_id,
        })),
        ProviderContinuationState::StickyRoutingHint { routing_hint } => Some(serde_json::json!({
            "enabled": true,
            "kind": "sticky_routing_hint",
            "routing_hint": routing_hint,
        })),
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TurnSystemPromptSource {
    None,
    Frontend,
    Session,
    Project,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TurnPromptAugmentationStageKind {
    RuntimeAgents,
    Memory,
    WebSearch,
    RequestToolPolicy,
    Artifact,
    Elicitation,
    TeamPreference,
    AutoContinue,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TurnPromptAugmentationStage {
    pub stage: TurnPromptAugmentationStageKind,
    pub input_present: bool,
    pub input_len: Option<usize>,
    pub output_present: bool,
    pub output_len: Option<usize>,
    pub changed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TurnRequestToolPolicySnapshot {
    pub search_mode: String,
    pub effective_web_search: bool,
    pub required_tools: Vec<String>,
    pub allowed_tools: Vec<String>,
    pub disallowed_tools: Vec<String>,
}

impl From<&RequestToolPolicy> for TurnRequestToolPolicySnapshot {
    fn from(policy: &RequestToolPolicy) -> Self {
        Self {
            search_mode: policy.search_mode.as_str().to_string(),
            effective_web_search: policy.effective_web_search,
            required_tools: policy.required_tools.clone(),
            allowed_tools: policy.allowed_tools.clone(),
            disallowed_tools: policy.disallowed_tools.clone(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TurnMessageHistorySource {
    SessionStoreReplay,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TurnProviderRoutingSnapshot {
    pub provider_name: String,
    pub provider_selector: Option<String>,
    pub model_name: String,
    pub credential_uuid: Option<String>,
    pub configured_from_request: bool,
    pub used_inline_api_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TurnDiagnosticsSnapshot {
    pub session_id: String,
    pub workspace_id: String,
    pub project_id: Option<String>,
    pub thread_id: Option<String>,
    pub turn_id: Option<String>,
    pub has_persisted_session: bool,
    pub system_prompt_source: TurnSystemPromptSource,
    pub base_system_prompt_len: Option<usize>,
    pub final_system_prompt_len: Option<usize>,
    pub prompt_augmentation_stages: Vec<TurnPromptAugmentationStage>,
    pub requested_execution_strategy: Option<String>,
    pub effective_execution_strategy: Option<String>,
    pub request_tool_policy: Option<TurnRequestToolPolicySnapshot>,
    pub provider_routing: Option<TurnProviderRoutingSnapshot>,
    pub history_source: TurnMessageHistorySource,
    pub provider_continuation_capability: ProviderContinuationCapability,
    pub provider_continuation: ProviderContinuationState,
    pub working_dir_set: bool,
    pub effective_user_message_len: usize,
    pub include_context_trace: bool,
    pub has_turn_context_metadata: bool,
    pub turn_context_metadata_keys: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TurnInputEnvelope {
    session_id: String,
    workspace_id: String,
    project_id: Option<String>,
    thread_id: Option<String>,
    turn_id: Option<String>,
    has_persisted_session: bool,
    system_prompt_source: TurnSystemPromptSource,
    base_system_prompt: Option<String>,
    final_system_prompt: Option<String>,
    prompt_augmentation_stages: Vec<TurnPromptAugmentationStage>,
    requested_execution_strategy: Option<String>,
    effective_execution_strategy: Option<String>,
    request_tool_policy: Option<TurnRequestToolPolicySnapshot>,
    provider_routing: Option<TurnProviderRoutingSnapshot>,
    history_source: TurnMessageHistorySource,
    provider_continuation_capability: ProviderContinuationCapability,
    provider_continuation: ProviderContinuationState,
    working_dir: Option<String>,
    effective_user_message: String,
    include_context_trace: bool,
    turn_context_metadata: Option<Map<String, Value>>,
}

impl TurnInputEnvelope {
    fn merged_turn_context_metadata(&self) -> Option<Map<String, Value>> {
        let mut metadata = self.turn_context_metadata.clone().unwrap_or_default();
        if let Some(project_id) = self.project_id.as_ref() {
            metadata.insert("project_id".to_string(), Value::String(project_id.clone()));
        }
        if let Some(provider_continuation) =
            build_provider_continuation_metadata(&self.provider_continuation)
        {
            metadata.insert("provider_continuation".to_string(), provider_continuation);
        }
        if metadata.is_empty() {
            None
        } else {
            Some(metadata)
        }
    }

    pub fn system_prompt(&self) -> Option<&str> {
        self.final_system_prompt.as_deref()
    }

    pub fn include_context_trace(&self) -> bool {
        self.include_context_trace
    }

    pub fn turn_context_override(&self) -> Option<TurnContextOverride> {
        self.merged_turn_context_metadata()
            .map(|metadata| TurnContextOverride {
                metadata: metadata.into_iter().collect(),
                ..TurnContextOverride::default()
            })
    }

    pub fn diagnostics_snapshot(&self) -> TurnDiagnosticsSnapshot {
        let mut turn_context_metadata_keys = self
            .merged_turn_context_metadata()
            .as_ref()
            .map(|metadata| metadata.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        turn_context_metadata_keys.sort();

        TurnDiagnosticsSnapshot {
            session_id: self.session_id.clone(),
            workspace_id: self.workspace_id.clone(),
            project_id: self.project_id.clone(),
            thread_id: self.thread_id.clone(),
            turn_id: self.turn_id.clone(),
            has_persisted_session: self.has_persisted_session,
            system_prompt_source: self.system_prompt_source,
            base_system_prompt_len: prompt_len(&self.base_system_prompt),
            final_system_prompt_len: prompt_len(&self.final_system_prompt),
            prompt_augmentation_stages: self.prompt_augmentation_stages.clone(),
            requested_execution_strategy: self.requested_execution_strategy.clone(),
            effective_execution_strategy: self.effective_execution_strategy.clone(),
            request_tool_policy: self.request_tool_policy.clone(),
            provider_routing: self.provider_routing.clone(),
            history_source: self.history_source,
            provider_continuation_capability: self.provider_continuation_capability,
            provider_continuation: self.provider_continuation.clone(),
            working_dir_set: self.working_dir.is_some(),
            effective_user_message_len: self.effective_user_message.chars().count(),
            include_context_trace: self.include_context_trace,
            has_turn_context_metadata: self.merged_turn_context_metadata().is_some(),
            turn_context_metadata_keys,
        }
    }
}

pub struct TurnInputEnvelopeBuilder {
    envelope: TurnInputEnvelope,
}

impl TurnInputEnvelopeBuilder {
    pub fn new(session_id: impl Into<String>, workspace_id: impl Into<String>) -> Self {
        Self {
            envelope: TurnInputEnvelope {
                session_id: session_id.into(),
                workspace_id: workspace_id.into(),
                project_id: None,
                thread_id: None,
                turn_id: None,
                has_persisted_session: false,
                system_prompt_source: TurnSystemPromptSource::None,
                base_system_prompt: None,
                final_system_prompt: None,
                prompt_augmentation_stages: Vec::new(),
                requested_execution_strategy: None,
                effective_execution_strategy: None,
                request_tool_policy: None,
                provider_routing: None,
                history_source: TurnMessageHistorySource::SessionStoreReplay,
                provider_continuation_capability: ProviderContinuationCapability::default(),
                provider_continuation: ProviderContinuationState::default(),
                working_dir: None,
                effective_user_message: String::new(),
                include_context_trace: false,
                turn_context_metadata: None,
            },
        }
    }

    pub fn set_project_id(&mut self, project_id: Option<String>) -> &mut Self {
        self.envelope.project_id = normalize_optional_string(project_id);
        self
    }

    pub fn set_thread_id(&mut self, thread_id: impl Into<String>) -> &mut Self {
        self.envelope.thread_id = normalize_optional_string(Some(thread_id.into()));
        self
    }

    pub fn set_turn_id(&mut self, turn_id: impl Into<String>) -> &mut Self {
        self.envelope.turn_id = normalize_optional_string(Some(turn_id.into()));
        self
    }

    pub fn set_has_persisted_session(&mut self, has_persisted_session: bool) -> &mut Self {
        self.envelope.has_persisted_session = has_persisted_session;
        self
    }

    pub fn set_base_system_prompt(
        &mut self,
        source: TurnSystemPromptSource,
        prompt: Option<String>,
    ) -> &mut Self {
        self.envelope.system_prompt_source = source;
        self.envelope.base_system_prompt = prompt.clone();
        self.envelope.final_system_prompt = prompt;
        self
    }

    pub fn apply_prompt_stage(
        &mut self,
        stage: TurnPromptAugmentationStageKind,
        output_prompt: Option<String>,
    ) -> &mut Self {
        let input_prompt = self.envelope.final_system_prompt.clone();
        let stage_record = TurnPromptAugmentationStage {
            stage,
            input_present: input_prompt.is_some(),
            input_len: prompt_len(&input_prompt),
            output_present: output_prompt.is_some(),
            output_len: prompt_len(&output_prompt),
            changed: input_prompt != output_prompt,
        };

        self.envelope.prompt_augmentation_stages.push(stage_record);
        self.envelope.final_system_prompt = output_prompt;
        self
    }

    pub fn set_requested_execution_strategy(&mut self, strategy: Option<String>) -> &mut Self {
        self.envelope.requested_execution_strategy = normalize_optional_string(strategy);
        self
    }

    pub fn set_effective_execution_strategy(&mut self, strategy: Option<String>) -> &mut Self {
        self.envelope.effective_execution_strategy = normalize_optional_string(strategy);
        self
    }

    pub fn set_request_tool_policy(
        &mut self,
        request_tool_policy: Option<TurnRequestToolPolicySnapshot>,
    ) -> &mut Self {
        self.envelope.request_tool_policy = request_tool_policy;
        self
    }

    pub fn set_include_context_trace(&mut self, include_context_trace: bool) -> &mut Self {
        self.envelope.include_context_trace = include_context_trace;
        self
    }

    pub fn set_turn_context_metadata_from_value(&mut self, metadata: Option<&Value>) -> &mut Self {
        self.envelope.turn_context_metadata = match metadata {
            Some(Value::Object(map)) => Some(map.clone()),
            _ => None,
        };
        self
    }

    pub fn set_provider_routing(
        &mut self,
        provider_routing: Option<TurnProviderRoutingSnapshot>,
    ) -> &mut Self {
        self.envelope.provider_routing = provider_routing;
        self
    }

    pub fn set_provider_continuation_capability(
        &mut self,
        provider_continuation_capability: ProviderContinuationCapability,
    ) -> &mut Self {
        self.envelope.provider_continuation_capability = provider_continuation_capability;
        self
    }

    pub fn set_provider_continuation(
        &mut self,
        provider_continuation: ProviderContinuationState,
    ) -> &mut Self {
        self.envelope.provider_continuation = provider_continuation;
        self
    }

    pub fn set_working_dir(&mut self, working_dir: Option<String>) -> &mut Self {
        self.envelope.working_dir = normalize_optional_string(working_dir);
        self
    }

    pub fn set_effective_user_message(
        &mut self,
        effective_user_message: impl Into<String>,
    ) -> &mut Self {
        self.envelope.effective_user_message = effective_user_message.into();
        self
    }

    pub fn build(self) -> TurnInputEnvelope {
        self.envelope
    }
}

#[cfg(test)]
mod tests {
    use super::{
        TurnInputEnvelopeBuilder, TurnPromptAugmentationStageKind, TurnProviderRoutingSnapshot,
        TurnRequestToolPolicySnapshot, TurnSystemPromptSource,
    };
    use crate::provider_continuation_state::{
        ProviderContinuationCapability, ProviderContinuationState,
    };
    use serde_json::json;

    #[test]
    fn test_turn_input_envelope_records_prompt_diagnostics() {
        let mut builder = TurnInputEnvelopeBuilder::new("session-1", "workspace-1");
        builder
            .set_project_id(Some("project-1".to_string()))
            .set_has_persisted_session(true)
            .set_base_system_prompt(TurnSystemPromptSource::Session, Some("base".to_string()))
            .apply_prompt_stage(
                TurnPromptAugmentationStageKind::RuntimeAgents,
                Some("base\nruntime".to_string()),
            )
            .apply_prompt_stage(
                TurnPromptAugmentationStageKind::Memory,
                Some("base\nruntime".to_string()),
            )
            .set_requested_execution_strategy(Some("auto".to_string()))
            .set_effective_execution_strategy(Some("react".to_string()))
            .set_request_tool_policy(Some(TurnRequestToolPolicySnapshot {
                search_mode: "allowed".to_string(),
                effective_web_search: true,
                required_tools: vec!["WebSearch".to_string()],
                allowed_tools: vec!["WebSearch".to_string(), "WebFetch".to_string()],
                disallowed_tools: vec![],
            }))
            .set_provider_routing(Some(TurnProviderRoutingSnapshot {
                provider_name: "openai".to_string(),
                provider_selector: Some("openai".to_string()),
                model_name: "gpt-5".to_string(),
                credential_uuid: Some("cred-1".to_string()),
                configured_from_request: true,
                used_inline_api_key: false,
            }))
            .set_provider_continuation_capability(
                ProviderContinuationCapability::PreviousResponseId,
            )
            .set_provider_continuation(ProviderContinuationState::previous_response_id("resp-1"))
            .set_working_dir(Some("/tmp/workspace".to_string()))
            .set_effective_user_message("请继续分析")
            .set_include_context_trace(true)
            .set_turn_context_metadata_from_value(Some(&json!({
                "theme": "planning",
                "task_mode_enabled": true
            })))
            .set_thread_id("thread-1")
            .set_turn_id("turn-1");

        let envelope = builder.build();
        let diagnostics = envelope.diagnostics_snapshot();

        assert_eq!(
            diagnostics.system_prompt_source,
            TurnSystemPromptSource::Session
        );
        assert_eq!(diagnostics.base_system_prompt_len, Some(4));
        assert_eq!(diagnostics.final_system_prompt_len, Some(12));
        assert!(diagnostics.working_dir_set);
        assert_eq!(diagnostics.effective_user_message_len, 5);
        assert_eq!(
            diagnostics
                .provider_routing
                .as_ref()
                .map(|routing| routing.model_name.as_str()),
            Some("gpt-5")
        );
        assert_eq!(
            diagnostics.provider_continuation,
            ProviderContinuationState::previous_response_id("resp-1")
        );
        assert_eq!(
            diagnostics.provider_continuation_capability,
            ProviderContinuationCapability::PreviousResponseId
        );
        assert_eq!(diagnostics.prompt_augmentation_stages.len(), 2);
        assert!(diagnostics.prompt_augmentation_stages[0].changed);
        assert!(!diagnostics.prompt_augmentation_stages[1].changed);
        assert_eq!(
            diagnostics.turn_context_metadata_keys,
            vec![
                "project_id".to_string(),
                "provider_continuation".to_string(),
                "task_mode_enabled".to_string(),
                "theme".to_string()
            ]
        );
        let turn_context = envelope.turn_context_override().expect("turn context");
        assert_eq!(
            turn_context.metadata.get("project_id"),
            Some(&json!("project-1"))
        );
        assert_eq!(
            turn_context.metadata.get("provider_continuation"),
            Some(&json!({
                "enabled": true,
                "kind": "previous_response_id",
                "previous_response_id": "resp-1"
            }))
        );
    }

    #[test]
    fn test_turn_input_envelope_allows_stage_generated_prompt() {
        let mut builder = TurnInputEnvelopeBuilder::new("session-2", "workspace-2");
        builder
            .set_base_system_prompt(TurnSystemPromptSource::None, None)
            .set_effective_user_message("runtime-only")
            .apply_prompt_stage(
                TurnPromptAugmentationStageKind::RuntimeAgents,
                Some("runtime-only".to_string()),
            );

        let envelope = builder.build();
        let diagnostics = envelope.diagnostics_snapshot();

        assert_eq!(
            diagnostics.system_prompt_source,
            TurnSystemPromptSource::None
        );
        assert_eq!(diagnostics.base_system_prompt_len, None);
        assert_eq!(diagnostics.final_system_prompt_len, Some(12));
        assert_eq!(envelope.system_prompt(), Some("runtime-only"));
    }

    #[test]
    fn test_turn_input_envelope_exposes_provider_continuation_without_user_metadata() {
        let mut builder = TurnInputEnvelopeBuilder::new("session-3", "workspace-3");
        builder
            .set_provider_continuation_capability(
                ProviderContinuationCapability::PreviousResponseId,
            )
            .set_provider_continuation(ProviderContinuationState::previous_response_id("resp-2"))
            .set_effective_user_message("继续");

        let envelope = builder.build();
        let diagnostics = envelope.diagnostics_snapshot();
        let turn_context = envelope.turn_context_override().expect("turn context");

        assert!(diagnostics.has_turn_context_metadata);
        assert_eq!(
            diagnostics.turn_context_metadata_keys,
            vec!["provider_continuation".to_string()]
        );
        assert_eq!(
            turn_context.metadata.get("provider_continuation"),
            Some(&json!({
                "enabled": true,
                "kind": "previous_response_id",
                "previous_response_id": "resp-2"
            }))
        );
    }
}
