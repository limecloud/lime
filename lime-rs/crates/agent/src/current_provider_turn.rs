//! 配置 provider 的 current 回合适配器。
//!
//! provider 网络协议由 `model-provider` lower，采样和 tool-result transcript 由
//! `agent-runtime::provider_turn` 维护；本模块只连接 Lime 的动态工具注册表、MCP
//! registry 和 App Server 已消费的事件协议。这里不依赖 Agent。

use crate::credential_bridge::ConfiguredReplyProvider;
use crate::model_request_policy::{
    input_modality_policy_allows_image_input, input_modality_policy_from_turn_context,
    runtime_reply_model_request_policy_from_turn_context,
};
use crate::protocol::{AgentEvent, AgentTokenUsage};
use crate::request_tool_policy::{
    is_same_tool, merge_system_prompt_with_request_tool_policy, ReplyAttemptError,
    RequestToolPolicy, StreamReplyExecution, WebSearchExecutionTracker,
};
use crate::runtime_state::AgentRuntimeState;
use crate::write_artifact_events::WriteArtifactEventEmitter;
use agent_protocol::{ItemStatus, ThreadId, ThreadItemPayload};
use agent_runtime::context_compaction::summarize_context;
use agent_runtime::provider_turn::{
    run_current_provider_turn, CurrentProviderTurnEvent, CurrentProviderTurnInput,
    RuntimeMidTurnCompactionCapability, RuntimeMidTurnCompactionCapabilityHandle,
    RuntimeMidTurnCompactionCommitHandle, RuntimeMidTurnCompactionRequest,
};
use agent_runtime::reply_input::RuntimeReplyInput;
use agent_runtime::session_config::AgentSessionConfig;
use agent_runtime::session_loop::RuntimeSessionInputHandle;
#[cfg(test)]
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
#[cfg(test)]
use tool_runtime::tool_lifecycle::{ToolLifecycleEmitter, ToolLifecycleEvent, ToolLifecyclePhase};

#[cfg(test)]
mod agent_control_tests;
mod command_publisher;
pub use command_publisher::CommandEventPublisher;
mod dynamic_tool_bridge;
mod environment;
mod hook_step_snapshot;
pub use hook_step_snapshot::run_interrupt_hooks;
#[cfg(test)]
mod input_tests;
mod mcp_step_snapshot;
mod model_history;
mod structured_input;
mod tool_executor;
mod tool_lifecycle_emitter;

use structured_input::{
    prepare_image_inputs_for_model, skill_snapshot_from_turn_context, structured_input_context,
    user_message,
};
use tool_lifecycle_emitter::CurrentTurnToolLifecycleEmitter;

#[cfg(test)]
use tool_executor::{action_scope, mcp_call_scope, project_call_result};

pub(crate) async fn stream_current_provider_turn<F>(
    state: &AgentRuntimeState,
    provider: ConfiguredReplyProvider,
    input: RuntimeReplyInput,
    mut initial_messages: Vec<model_provider::current_client::CurrentProviderMessage>,
    working_directory: Option<&Path>,
    mut session_config: AgentSessionConfig,
    cancel_token: Option<CancellationToken>,
    pending_input: Option<RuntimeSessionInputHandle>,
    mid_turn_compaction_commit: Option<RuntimeMidTurnCompactionCommitHandle>,
    policy: &RequestToolPolicy,
    agent_control_gateway: Option<tool_runtime::agent_control::AgentControlGatewayHandle>,
    command_publisher: Option<CommandEventPublisher>,
    mut on_event: F,
) -> Result<StreamReplyExecution, ReplyAttemptError>
where
    F: FnMut(&AgentEvent) + Send,
{
    let supports_image_input = input_modality_policy_allows_image_input(
        input_modality_policy_from_turn_context(session_config.turn_context.as_ref()).as_ref(),
    );
    prepare_image_inputs_for_model(&input, &mut initial_messages, supports_image_input)?;
    session_config.system_prompt =
        merge_system_prompt_with_request_tool_policy(session_config.system_prompt.take(), policy);
    let session_id = session_config.id.clone();
    let thread_id = session_config
        .thread_id
        .clone()
        .filter(|thread_id| !thread_id.trim().is_empty())
        .ok_or_else(|| {
            ReplyAttemptError::new(
                "Current provider turn requires a canonical thread_id",
                false,
            )
        })?;
    let mut model_request_policy =
        runtime_reply_model_request_policy_from_turn_context(session_config.turn_context.as_ref())
            .unwrap_or_default();
    model_request_policy.web_search_mode = Some(policy.web_search_mode);
    let model_request_policy = Some(model_request_policy);
    let mid_turn_compaction_limit =
        crate::model_request_policy::model_request_policy_from_turn_context(
            session_config.turn_context.as_ref(),
        )
        .and_then(|policy| policy.context_policy)
        .and_then(|policy| policy.auto_compact_token_limit)
        .and_then(|limit| u64::try_from(limit).ok());
    let skill_snapshot = skill_snapshot_from_turn_context(session_config.turn_context.as_ref());
    if let Some(message) = user_message(&input) {
        initial_messages.push(message);
    }
    let structured_context = structured_input_context(&input, skill_snapshot.as_ref());
    let emitted_pre_provider_warning = !structured_context.warnings.is_empty();
    initial_messages.extend(structured_context.messages);
    for warning in structured_context.warnings {
        on_event(&AgentEvent::Warning {
            code: Some(warning.code.to_string()),
            message: warning.message,
        });
    }
    let provider_name = provider.runtime_handle().provider_name().to_string();
    let provider_trace_metadata = provider.runtime_handle().provider_trace_metadata();
    let mut artifact_events = WriteArtifactEventEmitter::new(session_config.id.clone());
    let mut usage = None;
    let mut web_search_tracker = WebSearchExecutionTracker::default();
    let (host_event_sender, mut host_event_receiver) = mpsc::unbounded_channel();
    let (agent_event_sender, mut agent_event_receiver) = mpsc::unbounded_channel();
    let mcp_tool_routes = mcp_step_snapshot::McpToolRoutes::default();
    let dynamic_tool_routes = mcp_step_snapshot::DynamicToolRoutes::default();
    let working_directory = working_directory
        .map(Path::to_path_buf)
        .unwrap_or_else(default_working_directory);
    let tool_step_snapshot_source = mcp_step_snapshot::current_tool_step_snapshot_source(
        state.clone(),
        policy.clone(),
        session_config.turn_context.clone(),
        agent_event_sender.clone(),
        session_id.clone(),
        ThreadId::new(thread_id.clone()),
        agent_control_gateway,
        pending_input.clone(),
        mcp_tool_routes.clone(),
        dynamic_tool_routes.clone(),
        session_config.tool_mode,
        session_config.supports_custom_tools,
        mcp_step_snapshot::AsyncUserInputPolicy {
            is_root_agent: session_config.is_root_agent,
            experimental_request_user_input_enabled: session_config
                .experimental_request_user_input_enabled,
        },
        session_config.internal_agent_policy.clone(),
    );
    let mut lifecycle_emitter = CurrentTurnToolLifecycleEmitter::with_tool_routes(
        host_event_sender.clone(),
        session_id.clone(),
        thread_id.clone(),
        mcp_tool_routes,
        dynamic_tool_routes,
    );
    lifecycle_emitter.command_publisher = command_publisher.clone();
    let lifecycle_emitter = Arc::new(lifecycle_emitter);
    let hook_snapshot_source = hook_step_snapshot::current_hook_step_snapshot_source(
        state.clone(),
        session_id.clone(),
        thread_id.clone(),
        session_config.plugin_hook_source.clone(),
        working_directory.clone(),
        agent_event_sender.clone(),
        pending_input.clone(),
        cancel_token.clone(),
    );
    let mid_turn_compaction = mid_turn_compaction_commit.map(|commit| {
        RuntimeMidTurnCompactionCapabilityHandle::new(Arc::new(
            CurrentProviderMidTurnCompactionCapability {
                provider: Arc::new(provider.session()),
                token_limit: mid_turn_compaction_limit,
                commit,
            },
        ))
    });

    session_config.model_history_recorder = session_config
        .model_history_recorder
        .take()
        .map(|recorder| model_history::ordered_recorder(recorder, host_event_sender.clone()));
    let turn_future = run_current_provider_turn(
        CurrentProviderTurnInput {
            provider: Arc::new(provider.session()),
            provider_trace_metadata: Some(provider_trace_metadata),
            session_config,
            initial_messages,
            tool_step_snapshot_source,
            hook_snapshot_source,
            model_request_policy,
            tool_lifecycle_emitter: lifecycle_emitter,
            working_directory,
            cancel_token,
            pending_input,
            mid_turn_compaction,
        },
        move |event| {
            let _ = host_event_sender.send(CurrentTurnHostEvent::Provider(event));
        },
    );
    tokio::pin!(turn_future);
    let execution = loop {
        tokio::select! {
            biased;
            Some(event) = host_event_receiver.recv() => {
                match event {
                    CurrentTurnHostEvent::ModelHistory(append) => {
                        drain_ready_agent_events(&mut agent_event_receiver, &mut on_event);
                        append.persist().await;
                    }
                    event => handle_ordered_host_event(event, &mut agent_event_receiver, &provider_name, policy, &mut artifact_events, &mut web_search_tracker, &mut usage, &mut on_event),
                }
            }
            result = &mut turn_future => {
                drain_ready_turn_events(&mut host_event_receiver, &mut agent_event_receiver, &provider_name, policy, &mut artifact_events, &mut web_search_tracker, &mut usage, &mut on_event);
                break result;
            }
            Some(event) = agent_event_receiver.recv() => on_event(&event),
        }
    };
    let execution = execution.map_err(|error| {
        if emitted_pre_provider_warning {
            error.suppress_reroute()
        } else {
            error
        }
    })?;
    if let Some(error) = command_publisher
        .as_ref()
        .and_then(CommandEventPublisher::error)
    {
        return Err(ReplyAttemptError::new(error, true));
    }

    if !execution.cancelled {
        web_search_tracker
            .validate_web_search_requirement(policy)
            .map_err(|message| ReplyAttemptError::new(message, execution.emitted_any))?;
        on_event(&AgentEvent::Done {
            usage: usage.map(project_usage),
        });
    }
    Ok(execution)
}

struct CurrentProviderMidTurnCompactionCapability {
    provider: Arc<dyn model_provider::current_client::CurrentProvider>,
    token_limit: Option<u64>,
    commit: RuntimeMidTurnCompactionCommitHandle,
}

impl RuntimeMidTurnCompactionCapability for CurrentProviderMidTurnCompactionCapability {
    fn should_compact(&self, usage: &model_provider::current_client::CurrentProviderUsage) -> bool {
        self.token_limit
            .is_some_and(|limit| u64::from(usage.input_tokens) >= limit)
    }

    fn compact(
        &self,
        request: RuntimeMidTurnCompactionRequest,
        cancellation: Option<CancellationToken>,
    ) -> agent_runtime::provider_turn::RuntimeMidTurnCompactionFuture<'_> {
        let Some(token_limit) = self.token_limit else {
            return Box::pin(async { Ok(None) });
        };
        if u64::from(request.usage.input_tokens) < token_limit {
            return Box::pin(async { Ok(None) });
        }
        let provider = Arc::clone(&self.provider);
        let commit = self.commit.clone();
        Box::pin(async move {
            let summary_request = model_provider::current_client::CurrentProviderRequest::new(
                request.messages.clone(),
            )
            .with_system_prompt(request.system_prompt.clone())
            .with_generation(request.generation.clone())
            .with_provider_options(request.provider_options.clone())
            .with_model_request_policy(request.model_request_policy.clone());
            let cancellation = cancellation.unwrap_or_else(CancellationToken::new);
            let summary = summarize_context(provider.as_ref(), summary_request, cancellation)
                .await
                .map_err(|error| error.to_string())?;
            commit.commit(request, summary).await.map(Some)
        })
    }
}

enum CurrentTurnHostEvent {
    Provider(CurrentProviderTurnEvent),
    ModelHistory(model_history::HistoryAppend),
    ToolLifecycle(AgentEvent),
}

fn handle_ordered_host_event<F>(
    event: CurrentTurnHostEvent,
    agent_event_receiver: &mut mpsc::UnboundedReceiver<AgentEvent>,
    provider_name: &str,
    policy: &RequestToolPolicy,
    artifact_events: &mut WriteArtifactEventEmitter,
    web_search_tracker: &mut WebSearchExecutionTracker,
    usage: &mut Option<model_provider::current_client::CurrentProviderUsage>,
    on_event: &mut F,
) where
    F: FnMut(&AgentEvent),
{
    if matches!(
        &event,
        CurrentTurnHostEvent::ToolLifecycle(AgentEvent::ItemCompleted { .. })
    ) {
        drain_ready_agent_events(agent_event_receiver, on_event);
    }
    handle_host_event(
        event,
        provider_name,
        policy,
        artifact_events,
        web_search_tracker,
        usage,
        on_event,
    );
}

fn drain_ready_turn_events<F>(
    host_event_receiver: &mut mpsc::UnboundedReceiver<CurrentTurnHostEvent>,
    agent_event_receiver: &mut mpsc::UnboundedReceiver<AgentEvent>,
    provider_name: &str,
    policy: &RequestToolPolicy,
    artifact_events: &mut WriteArtifactEventEmitter,
    web_search_tracker: &mut WebSearchExecutionTracker,
    usage: &mut Option<model_provider::current_client::CurrentProviderUsage>,
    on_event: &mut F,
) where
    F: FnMut(&AgentEvent),
{
    while let Ok(event) = host_event_receiver.try_recv() {
        handle_ordered_host_event(
            event,
            agent_event_receiver,
            provider_name,
            policy,
            artifact_events,
            web_search_tracker,
            usage,
            on_event,
        );
    }
    drain_ready_agent_events(agent_event_receiver, on_event);
}

fn drain_ready_agent_events<F>(
    agent_event_receiver: &mut mpsc::UnboundedReceiver<AgentEvent>,
    on_event: &mut F,
) where
    F: FnMut(&AgentEvent),
{
    while let Ok(event) = agent_event_receiver.try_recv() {
        on_event(&event);
    }
}

fn handle_host_event<F>(
    event: CurrentTurnHostEvent,
    provider_name: &str,
    policy: &RequestToolPolicy,
    artifact_events: &mut WriteArtifactEventEmitter,
    web_search_tracker: &mut WebSearchExecutionTracker,
    usage: &mut Option<model_provider::current_client::CurrentProviderUsage>,
    on_event: &mut F,
) where
    F: FnMut(&AgentEvent),
{
    match event {
        CurrentTurnHostEvent::ModelHistory(append) => append.reject(),
        CurrentTurnHostEvent::Provider(event) => {
            handle_provider_event(event, provider_name, artifact_events, usage, on_event)
        }
        CurrentTurnHostEvent::ToolLifecycle(event) => {
            match &event {
                AgentEvent::ItemStarted { item } => {
                    if let ThreadItemPayload::Tool { call_id, name, .. } = &item.payload {
                        web_search_tracker.record_tool_start(policy, call_id, name);
                    }
                }
                AgentEvent::ItemCompleted { item } => {
                    if let ThreadItemPayload::Tool {
                        call_id, output, ..
                    } = &item.payload
                    {
                        web_search_tracker.record_tool_end(
                            policy,
                            call_id,
                            item.status == ItemStatus::Completed,
                            output.as_ref().and_then(|output| output.error.as_deref()),
                        );
                    }
                }
                _ => {}
            }
            emit_with_artifacts(artifact_events, event, on_event);
        }
    }
}

fn handle_provider_event<F>(
    event: CurrentProviderTurnEvent,
    _provider_name: &str,
    artifact_events: &mut WriteArtifactEventEmitter,
    usage: &mut Option<model_provider::current_client::CurrentProviderUsage>,
    on_event: &mut F,
) where
    F: FnMut(&AgentEvent),
{
    match event {
        CurrentProviderTurnEvent::ProviderTrace { event } => emit_with_artifacts(
            artifact_events,
            AgentEvent::ProviderTrace { event },
            on_event,
        ),
        CurrentProviderTurnEvent::TextStart { item_id } => {
            emit_with_artifacts(artifact_events, AgentEvent::TextStart { item_id }, on_event)
        }
        CurrentProviderTurnEvent::TextDelta { item_id, text } => emit_with_artifacts(
            artifact_events,
            AgentEvent::TextDelta { item_id, text },
            on_event,
        ),
        CurrentProviderTurnEvent::TextEnd { item_id, phase } => emit_with_artifacts(
            artifact_events,
            AgentEvent::TextEnd { item_id, phase },
            on_event,
        ),
        CurrentProviderTurnEvent::TextCompleted {
            item_id,
            text,
            phase,
        } => emit_with_artifacts(
            artifact_events,
            AgentEvent::TextCompleted {
                item_id,
                text,
                phase,
            },
            on_event,
        ),
        CurrentProviderTurnEvent::ReasoningStart { item_id } => emit_with_artifacts(
            artifact_events,
            AgentEvent::ReasoningStart { item_id },
            on_event,
        ),
        CurrentProviderTurnEvent::ReasoningSummaryDelta {
            item_id,
            text,
            summary_index,
        } => emit_with_artifacts(
            artifact_events,
            AgentEvent::ReasoningSummaryDelta {
                item_id,
                text,
                summary_index,
            },
            on_event,
        ),
        CurrentProviderTurnEvent::ReasoningSummaryPartAdded {
            item_id,
            summary_index,
        } => emit_with_artifacts(
            artifact_events,
            AgentEvent::ReasoningSummaryPartAdded {
                item_id,
                summary_index,
            },
            on_event,
        ),
        CurrentProviderTurnEvent::ReasoningContentDelta {
            item_id,
            text,
            content_index,
        } => emit_with_artifacts(
            artifact_events,
            AgentEvent::ReasoningContentDelta {
                item_id,
                text,
                content_index,
            },
            on_event,
        ),
        CurrentProviderTurnEvent::ReasoningEnd { item_id } => emit_with_artifacts(
            artifact_events,
            AgentEvent::ReasoningEnd { item_id },
            on_event,
        ),
        CurrentProviderTurnEvent::ReasoningCompleted {
            item_id,
            summary,
            content,
        } => emit_with_artifacts(
            artifact_events,
            AgentEvent::ReasoningCompleted {
                item_id,
                summary,
                content,
            },
            on_event,
        ),
        CurrentProviderTurnEvent::ToolInputDelta {
            tool_id: _,
            tool_name: _,
            delta: _,
            accumulated_arguments: _,
        } => {}
        CurrentProviderTurnEvent::Usage { attempt, usage } => emit_with_artifacts(
            artifact_events,
            AgentEvent::ProviderUsage {
                attempt,
                usage: project_usage(usage),
            },
            on_event,
        ),
        CurrentProviderTurnEvent::RolloutBudgetReminder {
            remaining_tokens,
            reminder_index,
            window_id,
            durable_event_id,
            text,
        } => emit_with_artifacts(
            artifact_events,
            AgentEvent::RolloutBudgetReminder {
                remaining_tokens,
                reminder_index,
                window_id,
                durable_event_id,
                text,
            },
            on_event,
        ),
        CurrentProviderTurnEvent::ServerModel { model } => {
            emit_with_artifacts(artifact_events, AgentEvent::ServerModel { model }, on_event)
        }
        CurrentProviderTurnEvent::ModelReroute {
            from_model,
            to_model,
            reason,
        } => emit_with_artifacts(
            artifact_events,
            AgentEvent::ModelReroute {
                from_model,
                to_model,
                reason,
            },
            on_event,
        ),
        CurrentProviderTurnEvent::ModelVerification { verifications } => emit_with_artifacts(
            artifact_events,
            AgentEvent::ModelVerification { verifications },
            on_event,
        ),
        CurrentProviderTurnEvent::TurnModerationMetadata { metadata } => emit_with_artifacts(
            artifact_events,
            AgentEvent::TurnModerationMetadata { metadata },
            on_event,
        ),
        CurrentProviderTurnEvent::ProviderStep {
            attempt,
            completed,
            finish_reason,
            text_output_chars,
            reasoning_output_chars,
            tool_call_count,
            usage: step_usage,
        } => {
            if let Some(step_usage) = step_usage.as_ref() {
                accumulate_usage(usage, step_usage);
            }
            emit_with_artifacts(
                artifact_events,
                AgentEvent::ProviderStep {
                    attempt,
                    completed,
                    finish_reason,
                    text_output_chars,
                    reasoning_output_chars,
                    tool_call_count,
                    usage: step_usage.map(project_usage),
                },
                on_event,
            );
        }
        CurrentProviderTurnEvent::MidTurnCompaction {
            compaction_id,
            context_epoch,
            covered_through_sequence,
            durable_event_id,
        } => emit_with_artifacts(
            artifact_events,
            AgentEvent::ContextCompactionCompleted {
                item_id: compaction_id,
                trigger: "context_limit".to_string(),
                detail: Some(
                    serde_json::json!({
                        "contextEpoch": context_epoch,
                        "coveredThroughSequence": covered_through_sequence,
                    })
                    .to_string(),
                ),
                durable_event_id,
            },
            on_event,
        ),
        CurrentProviderTurnEvent::HookPrompt { item } => {
            let mut started = item.clone();
            started.status = ItemStatus::InProgress;
            emit_with_artifacts(
                artifact_events,
                AgentEvent::ItemStarted { item: started },
                on_event,
            );
            emit_with_artifacts(
                artifact_events,
                AgentEvent::ItemCompleted { item },
                on_event,
            );
        }
    }
}

fn emit_with_artifacts<F>(
    artifact_events: &mut WriteArtifactEventEmitter,
    mut event: AgentEvent,
    on_event: &mut F,
) where
    F: FnMut(&AgentEvent),
{
    for extra in artifact_events.process_event(&mut event) {
        on_event(&extra);
    }
    on_event(&event);
}

fn is_web_tool(name: &str) -> bool {
    is_same_tool(name, "WebSearch") || is_same_tool(name, "WebFetch")
}

fn project_usage(usage: model_provider::current_client::CurrentProviderUsage) -> AgentTokenUsage {
    AgentTokenUsage {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cached_input_tokens: usage.cached_input_tokens,
        cache_creation_input_tokens: usage.cache_creation_input_tokens,
        lime_rollout_budget_units: usage.lime_rollout_budget_units,
    }
}

fn accumulate_usage(
    total: &mut Option<model_provider::current_client::CurrentProviderUsage>,
    step: &model_provider::current_client::CurrentProviderUsage,
) {
    let total = total.get_or_insert_default();
    total.input_tokens = total.input_tokens.saturating_add(step.input_tokens);
    total.output_tokens = total.output_tokens.saturating_add(step.output_tokens);
    total.cached_input_tokens =
        sum_optional_tokens(total.cached_input_tokens, step.cached_input_tokens);
    total.cache_creation_input_tokens = sum_optional_tokens(
        total.cache_creation_input_tokens,
        step.cache_creation_input_tokens,
    );
}

fn sum_optional_tokens(left: Option<u32>, right: Option<u32>) -> Option<u32> {
    match (left, right) {
        (None, None) => None,
        (left, right) => Some(
            left.unwrap_or_default()
                .saturating_add(right.unwrap_or_default()),
        ),
    }
}

fn default_working_directory() -> PathBuf {
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

#[cfg(test)]
mod tests;
