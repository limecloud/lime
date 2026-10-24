use agent_protocol::{turn_context::TurnOutputSchemaSource, CollaborationMode};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::path::PathBuf;

pub type AgentTurnContext = agent_protocol::turn_context::TurnContextOverride;
pub type AgentTurnContextOverride = AgentTurnContext;

#[derive(Debug, Default)]
pub struct AgentTurnContextConfigurationRequest {
    pub cwd: Option<PathBuf>,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub approval_policy: Option<String>,
    pub approvals_reviewer: Option<agent_protocol::ApprovalsReviewer>,
    pub sandbox_policy: Option<String>,
    pub sandbox_network_access: Option<bool>,
    pub web_search_mode: Option<agent_protocol::WebSearchMode>,
    pub collaboration_mode: Option<CollaborationMode>,
    pub user_visible_input_text: Option<String>,
    pub output_schema: Option<Value>,
    pub metadata: HashMap<String, Value>,
}

pub fn build_agent_turn_context(
    request: AgentTurnContextConfigurationRequest,
) -> Option<AgentTurnContext> {
    let mut context = AgentTurnContext {
        cwd: request.cwd,
        model: request.model,
        effort: request.effort,
        approval_policy: request.approval_policy,
        approvals_reviewer: request.approvals_reviewer,
        sandbox_policy: request.sandbox_policy,
        sandbox_network_access: request.sandbox_network_access,
        web_search_mode: request.web_search_mode,
        collaboration_mode: request.collaboration_mode,
        user_visible_input_text: request.user_visible_input_text,
        metadata: request.metadata,
        ..AgentTurnContext::default()
    };
    if let Some(output_schema) = request.output_schema {
        set_agent_turn_output_schema(&mut context, output_schema);
    }
    if context.approval_policy.is_none()
        && context.approvals_reviewer.is_none()
        && context.sandbox_policy.is_none()
        && context.sandbox_network_access.is_none()
        && context.web_search_mode.is_none()
        && context.user_visible_input_text.is_none()
        && context.output_schema.is_none()
        && context.collaboration_mode.is_none()
        && context.metadata.is_empty()
    {
        None
    } else {
        Some(context)
    }
}

pub fn set_agent_turn_output_schema(context: &mut AgentTurnContext, output_schema: Value) {
    context.output_schema = Some(output_schema);
    context.output_schema_source = Some(TurnOutputSchemaSource::Turn);
}

pub fn set_agent_turn_user_visible_input_text(
    context: &mut AgentTurnContext,
    input_text: Option<String>,
) {
    context.user_visible_input_text = input_text;
}

pub fn insert_agent_turn_metadata(
    context: &mut AgentTurnContext,
    key: impl Into<String>,
    value: Value,
) {
    context.metadata.insert(key.into(), value);
}

pub fn agent_turn_context_metadata(context: Option<&AgentTurnContext>) -> Option<Value> {
    let metadata = &context?.metadata;
    (!metadata.is_empty()).then(|| Value::Object(Map::from_iter(metadata.clone())))
}

pub fn agent_turn_approval_policy(context: Option<&AgentTurnContext>) -> Option<String> {
    context.and_then(|context| context.approval_policy.clone())
}

pub fn agent_turn_sandbox_policy(context: Option<&AgentTurnContext>) -> Option<String> {
    context.and_then(|context| context.sandbox_policy.clone())
}
