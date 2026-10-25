use crate::model_request_policy::runtime_reply_model_request_policy_from_turn_context;
use crate::provider_configuration::{
    configure_model_route_provider_for_session_with_provider_and_credential_ref,
    ModelRouteProviderConfiguration, SessionProviderConfig,
};
use crate::turn_context_configuration::AgentTurnContext;
use crate::{AgentRuntimeState, AgentTokenUsage, SessionConfigBuilder};
use agent_runtime::provider_turn::provider_request_controls;
use futures::{Stream, StreamExt};
use lime_core::database::DbConnection;
use model_provider::current_client::{
    CanonicalLlmEvent, CurrentProviderContent, CurrentProviderMessage, CurrentProviderRequest,
    CurrentProviderRequestMetadata, FinishReason, Usage,
};

#[derive(Debug, Clone)]
pub struct DirectTextGenerationRequest {
    pub session_id: String,
    pub thread_id: String,
    pub turn_id: String,
    pub system_prompt: String,
    pub user_prompt: String,
    pub turn_context: Option<AgentTurnContext>,
    pub provider_configuration: Option<ModelRouteProviderConfiguration>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirectTextGenerationResult {
    pub text: String,
    pub usage: Option<AgentTokenUsage>,
    pub provider_config: Option<SessionProviderConfig>,
}

pub async fn run_direct_text_generation_with_db(
    agent_state: &AgentRuntimeState,
    request: DirectTextGenerationRequest,
    db: &DbConnection,
) -> Result<DirectTextGenerationResult, String> {
    let DirectTextGenerationRequest {
        session_id,
        thread_id,
        turn_id,
        system_prompt,
        user_prompt,
        turn_context,
        provider_configuration,
    } = request;
    let configured_provider = match provider_configuration {
        Some(provider_configuration) => {
            let credential_ref = provider_configuration.credential_ref.clone();
            Some(
                configure_model_route_provider_for_session_with_provider_and_credential_ref(
                    agent_state,
                    db,
                    &session_id,
                    provider_configuration,
                    credential_ref.as_deref(),
                )
                .await?,
            )
        }
        None => None,
    };
    let provider = match configured_provider.as_ref() {
        Some(configured) => configured.provider(),
        None => agent_state
            .provider_for_session(&session_id)
            .await
            .ok_or_else(|| "Provider is not configured".to_string())?,
    };
    let mut session_config = SessionConfigBuilder::new(session_id)
        .thread_id(thread_id)
        .turn_id(turn_id)
        .system_prompt(system_prompt)
        .include_context_trace(false);
    if let Some(turn_context) = turn_context {
        session_config = session_config.turn_context(turn_context);
    }
    let provider_request = build_request(&session_config.build(), user_prompt);
    let stream = provider
        .client()
        .stream(provider_request)
        .await
        .map_err(|error| error.to_string())?;
    let (text, usage) = collect_response(stream).await?;
    Ok(DirectTextGenerationResult {
        text,
        usage,
        provider_config: configured_provider.map(|configured| configured.into_config()),
    })
}

fn build_request(
    session: &agent_runtime::session_config::AgentSessionConfig,
    user_prompt: String,
) -> CurrentProviderRequest {
    let (generation, provider_options) = provider_request_controls(session);
    let schema = session
        .turn_context
        .as_ref()
        .and_then(|context| context.output_schema.clone());
    let strict = schema.is_some();
    let mut request = CurrentProviderRequest::new(vec![CurrentProviderMessage::user(vec![
        CurrentProviderContent::Text(user_prompt),
    ])])
    .with_system_prompt(session.system_prompt.clone())
    .with_generation(generation)
    .with_provider_options(provider_options)
    .with_model_request_policy(runtime_reply_model_request_policy_from_turn_context(
        session.turn_context.as_ref(),
    ))
    .with_output_schema(schema, strict);
    if let Some((thread_id, turn_id)) = session.thread_id.as_ref().zip(session.turn_id.as_ref()) {
        request = request.with_metadata(CurrentProviderRequestMetadata::new(
            session.id.clone(),
            thread_id.clone(),
            turn_id.clone(),
            session.forked_from_thread_id.clone(),
        ));
    }
    request
}

async fn collect_response<E: std::fmt::Display>(
    stream: impl Stream<Item = Result<CanonicalLlmEvent, E>>,
) -> Result<(String, Option<AgentTokenUsage>), String> {
    let mut stream = Box::pin(stream);
    let mut text = String::new();
    let mut usage = None;
    while let Some(event) = stream.next().await {
        match event.map_err(|error| error.to_string())? {
            CanonicalLlmEvent::TextDelta { text: delta, .. } => text.push_str(&delta),
            CanonicalLlmEvent::ResponseItemDone { item, .. } if text.is_empty() => {
                if let Ok(agent_protocol::response_item::ResponseItem::Message {
                    content, ..
                }) = serde_json::from_value(item)
                {
                    for part in content {
                        if let agent_protocol::response_item::ContentItem::OutputText {
                            text: value,
                        } = part
                        {
                            text.push_str(&value);
                        }
                    }
                }
            }
            CanonicalLlmEvent::Usage {
                usage: sample_usage,
            }
            | CanonicalLlmEvent::StepFinish {
                reason: FinishReason::Stop,
                usage: Some(sample_usage),
                ..
            } => usage = Some(project_usage(sample_usage)),
            CanonicalLlmEvent::Finish {
                reason: FinishReason::Stop,
                needs_follow_up: false,
                usage: final_usage,
                ..
            } => return Ok((text, final_usage.map(project_usage).or(usage))),
            CanonicalLlmEvent::Finish { reason, .. } => {
                return Err(format!(
                    "Single-sample response did not complete: {reason:?}"
                ));
            }
            CanonicalLlmEvent::StepFinish { reason, .. } if reason != FinishReason::Stop => {
                return Err(format!("Single-sample step did not complete: {reason:?}"));
            }
            CanonicalLlmEvent::ToolInputStart { .. }
            | CanonicalLlmEvent::ToolInputDelta { .. }
            | CanonicalLlmEvent::ToolInputEnd { .. }
            | CanonicalLlmEvent::ToolCall { .. }
            | CanonicalLlmEvent::CustomToolCall { .. }
            | CanonicalLlmEvent::ToolResult { .. }
            | CanonicalLlmEvent::ToolError { .. } => {
                return Err("Single-sample response requested an unexpected tool".to_string());
            }
            CanonicalLlmEvent::ProviderError { message, .. } => return Err(message),
            _ => {}
        }
    }
    Err("Single-sample stream ended before completion".to_string())
}

fn project_usage(usage: Usage) -> AgentTokenUsage {
    let count = |value: u64| value.min(u32::MAX as u64) as u32;
    AgentTokenUsage {
        input_tokens: count(usage.input_tokens.unwrap_or_default()),
        output_tokens: count(usage.output_tokens.unwrap_or_default()),
        cached_input_tokens: usage.cache_read_input_tokens.map(count),
        cache_creation_input_tokens: usage.cache_write_input_tokens.map(count),
        lime_rollout_budget_units: usage.lime_rollout_budget_units,
    }
}

#[cfg(test)]
mod tests;
