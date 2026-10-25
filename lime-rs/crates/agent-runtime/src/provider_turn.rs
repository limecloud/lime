//! 固定 provider 的 current Turn executor。
//!
//! 参考上游 response item 生命周期：每次 provider response 先 materialize 成
//! text/reasoning/tool-call event，所有工具调用完成后把 tool result 追加到同一个
//! transcript，再开始下一次 sampling。provider wire lowering 留在 model-provider，
//! 工具执行留在 tool-runtime；本模块不接触 Agent。

use crate::provider_trace::RuntimeProviderTraceAttempt;
use crate::reply_execution::{RuntimeReplyAttemptError, RuntimeReplyExecution};
use crate::reply_loop::{RuntimeReplyLoop, RuntimeReplyLoopStep, MAX_REPLY_TURNS_REACHED_MESSAGE};
use crate::session_config::AgentSessionConfig;
use crate::session_loop::{RuntimeSessionInputHandle, RuntimeSessionStepContext};
use ::code_mode::{
    RuntimeCodeModeSessionHandle, RuntimeCodeModeTool, CODE_MODE_EXEC_TOOL_NAME,
    CODE_MODE_WAIT_TOOL_NAME,
};
use agent_protocol::provider_trace::{ProviderTraceEvent, ProviderTraceFailure};
use agent_protocol::response_item::MessagePhase;
use agent_protocol::world_state::{RuntimeWorldState, WORLD_STATE_TURN_METADATA_KEY};
use agent_protocol::{
    HookPromptFragment, ItemId, ItemStatus, SessionId, ThreadId, ThreadItem, ThreadItemPayload,
};
use code_mode_protocol::{RuntimeToolDefinition, RuntimeToolExposure};
use futures::future::join_all;
use futures::FutureExt;
use futures::StreamExt;
use model_provider::current_client::{
    CanonicalLlmEvent, CurrentProvider, CurrentProviderContent, CurrentProviderCustomToolCall,
    CurrentProviderError, CurrentProviderMessage, CurrentProviderRequest, CurrentProviderRole,
    CurrentProviderStream, CurrentProviderTool, CurrentProviderToolCall, CurrentProviderToolResult,
    CurrentProviderUsage, FailureClassification, FinishReason, GenerationOptions,
    ModelVerification, ProviderMetadata, ToolResultValue, Usage,
};
use model_provider::provider_stream::RuntimeReplyModelRequestPolicy;
use model_provider::provider_stream::RuntimeReplyProviderTraceMetadata;
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;
use tool_runtime::hook_lifecycle::{
    evaluate_hook_event_async, RuntimeCompactHookContext, RuntimeHookEventContext,
    RuntimeHookEventName, RuntimeHookReporter, RuntimeStopHookContext, RuntimeStopHookTarget,
};
use tool_runtime::tool_call::{ToolCall, ToolEnvironment};
use tool_runtime::tool_executor::{
    RuntimeToolExecutionContext, RuntimeToolExecutionContextInput, RuntimeToolExecutionError,
    RuntimeToolExecutionFuture, RuntimeToolExecutionRequest, RuntimeToolExecutor,
    RuntimeToolExecutorHandle, RuntimeToolPolicyErrorKind,
};
use tool_runtime::tool_lifecycle::ToolLifecycleEmitter;
use tool_runtime::turn_snapshot::{RuntimeHookSnapshot, RuntimeTurnSnapshot};

mod code_mode;
mod history_budget;
mod hook_snapshot;
mod input;
mod model_history;
mod output_lifecycle;
mod stop_hooks;
mod stream_producer;
mod tool_call;
use code_mode::PendingProviderToolCall;
#[cfg(test)]
use input::runtime_inter_agent_text;
use input::runtime_session_input_message;
use output_lifecycle::{
    complete_text_output_item, defer_text_output_item_end, end_reasoning_output_item,
    finish_active_output_items, provider_output_item_id, start_output_item, ProviderOutputFamily,
};
#[cfg(test)]
use stop_hooks::{evaluate_stop_hooks, hook_prompt_provider_message};
use stream_producer::{start_provider_stream, ProviderStreamStart};
use tool_call::prepare_provider_tool_call;
use tool_runtime::tool_result_projection::NormalizedToolOutput;

const LOCAL_TOOL_ENVIRONMENT_ID: &str = "local";
const PROVIDER_TOOL_ENVIRONMENT_ID: &str = "provider";
const INVALID_TOOL_CALL_NAME: &str = "invalid";
const TOOL_CALL_REPAIR_METADATA_KEY: &str = "tool_call_repair";
const DEFAULT_FIRST_VISIBLE_OUTPUT_TIMEOUT: Duration = Duration::from_secs(60);
const DEFAULT_PROVIDER_STEP_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Clone)]
pub struct RuntimeToolStepSnapshot {
    pub definitions: Vec<RuntimeToolDefinition>,
    pub executor: RuntimeToolExecutorHandle,
    serial_tool_names: Arc<HashSet<String>>,
    tool_environment_ids: Arc<HashMap<String, String>>,
    code_mode_session: Option<RuntimeCodeModeSessionHandle>,
    code_mode_tools: Arc<Vec<RuntimeCodeModeTool>>,
    filesystem_gateway: Option<Arc<dyn tool_runtime::filesystem_gateway::RuntimeFileSystemGateway>>,
    history_token_limit: Option<usize>,
    mid_turn_compaction: Option<RuntimeMidTurnCompactionCapabilityHandle>,
    step_context: Option<RuntimeSessionStepContext>,
}

impl RuntimeToolStepSnapshot {
    pub fn new(
        definitions: Vec<RuntimeToolDefinition>,
        executor: RuntimeToolExecutorHandle,
    ) -> Self {
        Self {
            definitions,
            executor,
            serial_tool_names: Arc::new(HashSet::new()),
            tool_environment_ids: Arc::new(HashMap::new()),
            code_mode_session: None,
            code_mode_tools: Arc::new(Vec::new()),
            filesystem_gateway: None,
            history_token_limit: None,
            mid_turn_compaction: None,
            step_context: None,
        }
    }

    pub fn with_tool_metadata(
        definitions: Vec<RuntimeToolDefinition>,
        executor: RuntimeToolExecutorHandle,
        serial_tool_names: impl IntoIterator<Item = String>,
        tool_environment_ids: impl IntoIterator<Item = (String, String)>,
    ) -> Self {
        Self {
            definitions,
            executor,
            serial_tool_names: Arc::new(serial_tool_names.into_iter().collect()),
            tool_environment_ids: Arc::new(tool_environment_ids.into_iter().collect()),
            code_mode_session: None,
            code_mode_tools: Arc::new(Vec::new()),
            filesystem_gateway: None,
            history_token_limit: None,
            mid_turn_compaction: None,
            step_context: None,
        }
    }

    pub fn with_code_mode_session(
        mut self,
        session: RuntimeCodeModeSessionHandle,
        tools: Vec<RuntimeCodeModeTool>,
    ) -> Self {
        self.code_mode_session = Some(session);
        self.code_mode_tools = Arc::new(tools);
        self
    }

    fn supports_parallel_tool_calls(&self, tool_name: &str) -> bool {
        !self.serial_tool_names.contains(tool_name)
    }

    fn environment_id(&self, tool_name: &str) -> &str {
        self.tool_environment_ids
            .get(tool_name)
            .map(String::as_str)
            .unwrap_or(LOCAL_TOOL_ENVIRONMENT_ID)
    }

    fn code_mode_session(&self) -> Option<&RuntimeCodeModeSessionHandle> {
        self.code_mode_session.as_ref()
    }

    pub fn filesystem_gateway(
        &self,
    ) -> Option<&Arc<dyn tool_runtime::filesystem_gateway::RuntimeFileSystemGateway>> {
        self.filesystem_gateway.as_ref()
    }

    pub fn with_filesystem_gateway(
        mut self,
        gateway: Arc<dyn tool_runtime::filesystem_gateway::RuntimeFileSystemGateway>,
    ) -> Self {
        self.filesystem_gateway = Some(gateway);
        self
    }

    pub fn with_step_context(mut self, context: RuntimeSessionStepContext) -> Self {
        self.step_context = Some(context);
        self
    }

    pub fn step_context(&self) -> Option<&RuntimeSessionStepContext> {
        self.step_context.as_ref()
    }

    /// 注入由 App Server 持有的同 Turn 压缩能力。
    ///
    /// agent-runtime 只负责在 provider continuation 边界调用该能力，不依赖 App Server
    /// 的 durable store 或具体协议；能力实现必须在返回前完成 replacement receipt。
    pub fn with_mid_turn_compaction(
        mut self,
        capability: RuntimeMidTurnCompactionCapabilityHandle,
    ) -> Self {
        self.mid_turn_compaction = Some(capability);
        self
    }

    fn mid_turn_compaction(&self) -> Option<RuntimeMidTurnCompactionCapabilityHandle> {
        self.mid_turn_compaction.clone()
    }
}

#[derive(Clone)]
pub struct RuntimeMidTurnCompactionRequest {
    pub messages: Vec<CurrentProviderMessage>,
    pub history_prefix_len: usize,
    pub usage: CurrentProviderUsage,
    pub attempt: u32,
    pub system_prompt: Option<String>,
    pub generation: GenerationOptions,
    pub provider_options: ProviderMetadata,
    pub model_request_policy: Option<RuntimeReplyModelRequestPolicy>,
}

#[derive(Clone)]
pub struct RuntimeMidTurnCompactionResult {
    pub messages: Vec<CurrentProviderMessage>,
    pub history_prefix_len: usize,
    pub compaction_id: String,
    pub context_epoch: u64,
    pub covered_through_sequence: u64,
    /// EventLog id for a replacement that was already durably committed by the host.
    ///
    /// The provider loop forwards this receipt through the current event sink instead of
    /// serializing the compaction a second time.
    pub durable_event_id: Option<String>,
}

pub type RuntimeMidTurnCompactionFuture<'a> = Pin<
    Box<dyn Future<Output = Result<Option<RuntimeMidTurnCompactionResult>, String>> + Send + 'a>,
>;

pub trait RuntimeMidTurnCompactionCapability: Send + Sync {
    fn should_compact(&self, _usage: &CurrentProviderUsage) -> bool {
        true
    }

    fn compact(
        &self,
        request: RuntimeMidTurnCompactionRequest,
        cancellation: Option<CancellationToken>,
    ) -> RuntimeMidTurnCompactionFuture<'_>;
}

pub type RuntimeMidTurnCompactionCommitFuture<'a> =
    Pin<Box<dyn Future<Output = Result<RuntimeMidTurnCompactionResult, String>> + Send + 'a>>;

pub trait RuntimeMidTurnCompactionCommit: Send + Sync {
    fn commit(
        &self,
        request: RuntimeMidTurnCompactionRequest,
        summary: String,
    ) -> RuntimeMidTurnCompactionCommitFuture<'_>;
}

#[derive(Clone)]
pub struct RuntimeMidTurnCompactionCommitHandle(Arc<dyn RuntimeMidTurnCompactionCommit>);

impl std::fmt::Debug for RuntimeMidTurnCompactionCommitHandle {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("RuntimeMidTurnCompactionCommitHandle")
            .finish_non_exhaustive()
    }
}

impl RuntimeMidTurnCompactionCommitHandle {
    pub fn new(commit: Arc<dyn RuntimeMidTurnCompactionCommit>) -> Self {
        Self(commit)
    }

    pub async fn commit(
        &self,
        request: RuntimeMidTurnCompactionRequest,
        summary: String,
    ) -> Result<RuntimeMidTurnCompactionResult, String> {
        self.0.commit(request, summary).await
    }
}

#[derive(Clone)]
pub struct RuntimeMidTurnCompactionCapabilityHandle(Arc<dyn RuntimeMidTurnCompactionCapability>);

impl RuntimeMidTurnCompactionCapabilityHandle {
    pub fn new(capability: Arc<dyn RuntimeMidTurnCompactionCapability>) -> Self {
        Self(capability)
    }

    async fn compact(
        &self,
        request: RuntimeMidTurnCompactionRequest,
        cancellation: Option<CancellationToken>,
    ) -> Result<Option<RuntimeMidTurnCompactionResult>, String> {
        self.0.compact(request, cancellation).await
    }

    fn should_compact(&self, usage: &CurrentProviderUsage) -> bool {
        self.0.should_compact(usage)
    }
}

pub type RuntimeToolStepSnapshotFuture<'a> =
    Pin<Box<dyn Future<Output = Result<RuntimeToolStepSnapshot, String>> + Send + 'a>>;

pub trait RuntimeToolStepSnapshotSource: Send + Sync {
    fn capture(
        &self,
        step_context: Option<&RuntimeSessionStepContext>,
    ) -> RuntimeToolStepSnapshotFuture<'_>;
}

#[derive(Clone)]
pub struct RuntimeToolStepSnapshotSourceHandle(Arc<dyn RuntimeToolStepSnapshotSource>);

impl RuntimeToolStepSnapshotSourceHandle {
    pub fn new(source: Arc<dyn RuntimeToolStepSnapshotSource>) -> Self {
        Self(source)
    }

    pub fn fixed(snapshot: RuntimeToolStepSnapshot) -> Self {
        Self::new(Arc::new(FixedRuntimeToolStepSnapshotSource { snapshot }))
    }

    pub async fn capture(
        &self,
        step_context: Option<&RuntimeSessionStepContext>,
    ) -> Result<RuntimeToolStepSnapshot, String> {
        self.0.capture(step_context).await
    }
}

struct FixedRuntimeToolStepSnapshotSource {
    snapshot: RuntimeToolStepSnapshot,
}

impl RuntimeToolStepSnapshotSource for FixedRuntimeToolStepSnapshotSource {
    fn capture(
        &self,
        _step_context: Option<&RuntimeSessionStepContext>,
    ) -> RuntimeToolStepSnapshotFuture<'_> {
        Box::pin(async move { Ok(self.snapshot.clone()) })
    }
}

#[derive(Clone)]
pub struct RuntimeHookStepSnapshot {
    pub hooks: Vec<RuntimeHookSnapshot>,
    pub reporter: Arc<dyn RuntimeHookReporter>,
    pub step_context: Option<RuntimeSessionStepContext>,
}

pub type RuntimeHookSnapshotFuture<'a> =
    Pin<Box<dyn Future<Output = Result<RuntimeHookStepSnapshot, String>> + Send + 'a>>;

pub trait RuntimeHookSnapshotSource: Send + Sync {
    fn capture(
        &self,
        step_context: Option<&RuntimeSessionStepContext>,
    ) -> RuntimeHookSnapshotFuture<'_>;
}

#[derive(Clone)]
pub struct RuntimeHookSnapshotSourceHandle(Arc<dyn RuntimeHookSnapshotSource>);

impl RuntimeHookSnapshotSourceHandle {
    pub fn new(source: Arc<dyn RuntimeHookSnapshotSource>) -> Self {
        Self(source)
    }

    pub fn fixed(snapshot: RuntimeHookStepSnapshot) -> Self {
        Self::new(Arc::new(FixedRuntimeHookSnapshotSource { snapshot }))
    }

    pub async fn capture(
        &self,
        step_context: Option<&RuntimeSessionStepContext>,
    ) -> Result<RuntimeHookStepSnapshot, String> {
        self.0.capture(step_context).await
    }
}

struct FixedRuntimeHookSnapshotSource {
    snapshot: RuntimeHookStepSnapshot,
}

impl RuntimeHookSnapshotSource for FixedRuntimeHookSnapshotSource {
    fn capture(
        &self,
        _step_context: Option<&RuntimeSessionStepContext>,
    ) -> RuntimeHookSnapshotFuture<'_> {
        Box::pin(async move { Ok(self.snapshot.clone()) })
    }
}

#[derive(Clone)]
pub struct CurrentProviderTurnInput {
    pub provider: Arc<dyn CurrentProvider>,
    pub provider_trace_metadata: Option<RuntimeReplyProviderTraceMetadata>,
    pub session_config: AgentSessionConfig,
    pub initial_messages: Vec<CurrentProviderMessage>,
    pub tool_step_snapshot_source: RuntimeToolStepSnapshotSourceHandle,
    pub hook_snapshot_source: Option<RuntimeHookSnapshotSourceHandle>,
    pub model_request_policy: Option<RuntimeReplyModelRequestPolicy>,
    pub tool_lifecycle_emitter: Arc<dyn ToolLifecycleEmitter>,
    pub working_directory: PathBuf,
    pub cancel_token: Option<CancellationToken>,
    pub pending_input: Option<RuntimeSessionInputHandle>,
    pub mid_turn_compaction: Option<RuntimeMidTurnCompactionCapabilityHandle>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum CurrentProviderTurnEvent {
    ProviderTrace {
        event: ProviderTraceEvent,
    },
    TextStart {
        item_id: String,
    },
    TextDelta {
        item_id: String,
        text: String,
    },
    TextEnd {
        item_id: String,
        phase: Option<MessagePhase>,
    },
    TextCompleted {
        item_id: String,
        text: String,
        phase: Option<MessagePhase>,
    },
    ReasoningStart {
        item_id: String,
    },
    ReasoningSummaryDelta {
        item_id: String,
        text: String,
        summary_index: i64,
    },
    ReasoningSummaryPartAdded {
        item_id: String,
        summary_index: i64,
    },
    ReasoningContentDelta {
        item_id: String,
        text: String,
        content_index: i64,
    },
    ReasoningEnd {
        item_id: String,
    },
    ReasoningCompleted {
        item_id: String,
        summary: Vec<String>,
        content: Vec<String>,
    },
    ToolInputDelta {
        tool_id: String,
        tool_name: Option<String>,
        delta: String,
        accumulated_arguments: String,
    },
    Usage {
        attempt: u32,
        usage: CurrentProviderUsage,
    },
    RolloutBudgetReminder {
        remaining_tokens: i64,
        reminder_index: usize,
        window_id: String,
        durable_event_id: String,
        text: String,
    },
    ServerModel {
        model: String,
    },
    ModelReroute {
        from_model: String,
        to_model: String,
        reason: model_provider::current_client::ModelRerouteReason,
    },
    ModelVerification {
        verifications: Vec<ModelVerification>,
    },
    TurnModerationMetadata {
        metadata: serde_json::Value,
    },
    ProviderStep {
        attempt: u32,
        completed: bool,
        finish_reason: Option<String>,
        text_output_chars: u64,
        reasoning_output_chars: u64,
        tool_call_count: u32,
        usage: Option<CurrentProviderUsage>,
    },
    MidTurnCompaction {
        compaction_id: String,
        context_epoch: u64,
        covered_through_sequence: u64,
        durable_event_id: Option<String>,
    },
    HookPrompt {
        item: ThreadItem,
    },
}

pub async fn run_current_provider_turn<F>(
    input: CurrentProviderTurnInput,
    mut on_event: F,
) -> Result<RuntimeReplyExecution, RuntimeReplyAttemptError>
where
    F: FnMut(CurrentProviderTurnEvent) + Send,
{
    let CurrentProviderTurnInput {
        provider,
        provider_trace_metadata,
        session_config,
        mut initial_messages,
        tool_step_snapshot_source,
        hook_snapshot_source,
        model_request_policy,
        tool_lifecycle_emitter,
        working_directory,
        cancel_token,
        pending_input,
        mid_turn_compaction,
    } = input;
    let turn_id = session_config
        .turn_id
        .clone()
        .filter(|turn_id| !turn_id.trim().is_empty())
        .ok_or_else(|| {
            RuntimeReplyAttemptError::new(
                "Current provider turn requires a canonical turn_id",
                false,
            )
        })?;
    let world_state = resolve_world_state(&session_config, &working_directory)?;
    insert_world_state_before_current_user(&mut initial_messages, &world_state);
    let mut history_prefix_len = initial_messages.len();
    let mut loop_state = RuntimeReplyLoop::new(session_config.max_turns);
    let mut text_output = String::new();
    let mut errors = Vec::new();
    let mut emitted_any = false;
    let mut consumed_pending_input = false;
    let mut provider_budget_tokens_used = 0_u64;
    let mut last_server_model = None;
    let mut model_reroute_emitted = false;
    let mut model_verification_emitted = false;
    // The provider keeps this state across steps. A blocked Stop hook therefore receives
    // `stop_hook_active=true` on the continuation sampling request and cannot recurse as if it
    // were the first terminal check.
    let mut stop_hook_active = false;
    let mut hook_prompt_index = 0_u64;
    let (generation, provider_options) = provider_request_controls(&session_config);
    let first_visible_output_timeout = first_visible_output_timeout(&session_config);
    let provider_step_timeout = provider_step_timeout(&session_config);

    loop {
        if is_cancelled(&cancel_token) {
            return Ok(RuntimeReplyExecution::new(
                text_output,
                errors,
                emitted_any,
                attempts_summary(&loop_state),
                true,
            ));
        }
        let attempt = match loop_state.next_attempt() {
            RuntimeReplyLoopStep::Continue { attempt } => attempt,
            RuntimeReplyLoopStep::MaxTurnsReached { .. } => {
                if let Some(input) = pending_input.as_ref() {
                    input.mark_mailbox_delivery_for_next_turn().await;
                    input.mark_finishing().await;
                }
                if !text_output.is_empty() {
                    text_output.push('\n');
                }
                text_output.push_str(MAX_REPLY_TURNS_REACHED_MESSAGE);
                let item_id = format!("text-{turn_id}-max-turns");
                on_event(CurrentProviderTurnEvent::TextStart {
                    item_id: item_id.clone(),
                });
                on_event(CurrentProviderTurnEvent::TextDelta {
                    item_id: item_id.clone(),
                    text: MAX_REPLY_TURNS_REACHED_MESSAGE.to_string(),
                });
                on_event(CurrentProviderTurnEvent::TextEnd {
                    item_id,
                    phase: Some(MessagePhase::FinalAnswer),
                });
                return Ok(RuntimeReplyExecution::new(
                    text_output,
                    errors,
                    true,
                    attempts_summary(&loop_state),
                    false,
                ));
            }
        };

        if let Some(source) = session_config.rollout_budget_reminder_source.as_ref() {
            let reminder = source
                .next_reminder()
                .map_err(|message| RuntimeReplyAttemptError::new(message, emitted_any))?;
            if let Some(reminder) = reminder {
                let text = format!(
                    "<rollout_budget>\nYou have {} weighted tokens left in the shared session token budget.\n</rollout_budget>",
                    reminder.remaining_tokens
                );
                on_event(CurrentProviderTurnEvent::RolloutBudgetReminder {
                    remaining_tokens: reminder.remaining_tokens,
                    reminder_index: reminder.reminder_index,
                    window_id: reminder.window_id,
                    durable_event_id: reminder.durable_event_id,
                    text: text.clone(),
                });
                if is_cancelled(&cancel_token) {
                    return Ok(RuntimeReplyExecution::new(
                        text_output,
                        errors,
                        emitted_any,
                        attempts_summary(&loop_state),
                        true,
                    ));
                }
                initial_messages.push(CurrentProviderMessage::developer(vec![
                    CurrentProviderContent::Text(text),
                ]));
            }
        }
        // Context, tool inventory and mailbox phase are captured once per sampling step.
        let step_context = match pending_input.as_ref() {
            Some(input) => Some(input.capture_step_context().await),
            None => None,
        };

        let mut tool_step_snapshot = tool_step_snapshot_source
            .capture(step_context.as_ref())
            .await
            .map_err(|message| RuntimeReplyAttemptError::new(message, emitted_any))?;

        if let Some(capability) = mid_turn_compaction.clone() {
            tool_step_snapshot = tool_step_snapshot.with_mid_turn_compaction(capability);
        }

        let hook_step_snapshot = match hook_snapshot_source.as_ref() {
            Some(source) => Some(
                source
                    .capture(step_context.as_ref())
                    .await
                    .map_err(|message| RuntimeReplyAttemptError::new(message, emitted_any))?,
            ),
            None => None,
        };
        if let Some(hook_step_snapshot) = hook_step_snapshot.as_ref() {
            if let (Some(tool_context), Some(hook_context)) = (
                tool_step_snapshot.step_context(),
                hook_step_snapshot.step_context.as_ref(),
            ) {
                if tool_context != hook_context {
                    return Err(RuntimeReplyAttemptError::new(
                        "provider step snapshots captured different session contexts",
                        emitted_any,
                    ));
                }
            }
            hook_snapshot::apply_snapshot(&mut tool_step_snapshot, hook_step_snapshot.clone())
                .map_err(|message| RuntimeReplyAttemptError::new(message, emitted_any))?;
        }
        let step_mid_turn_compaction = tool_step_snapshot.mid_turn_compaction();

        history_budget::capture(&mut tool_step_snapshot, model_request_policy.as_ref());
        let mut tools = tool_step_snapshot
            .definitions
            .iter()
            .map(|definition| {
                CurrentProviderTool::function(
                    definition.name.clone(),
                    definition.description.clone(),
                    definition.input_schema.clone(),
                )
            })
            .collect::<Vec<_>>();
        if tool_step_snapshot.code_mode_session().is_some() {
            tools.extend(code_mode::advertised_tools(
                &tool_step_snapshot.code_mode_tools,
            ));
        }

        let request_metadata = session_config
            .thread_id
            .as_ref()
            .zip(session_config.turn_id.as_ref())
            .map(|(thread_id, turn_id)| {
                model_provider::current_client::CurrentProviderRequestMetadata::new(
                    session_config.id.clone(),
                    thread_id.clone(),
                    turn_id.clone(),
                    session_config.forked_from_thread_id.clone(),
                )
                .with_history_ingest_requested(session_config.history_ingest_requested)
            });
        let mut request =
            CurrentProviderRequest::new(crate::context_history::normalize_tool_history(
                &initial_messages,
                model_request_policy
                    .as_ref()
                    .and_then(|policy| policy.truncation),
            ))
            .with_system_prompt(session_config.system_prompt.clone())
            .with_tools(tools.clone())
            .with_generation(generation.clone())
            .with_provider_options(provider_options.clone())
            .with_model_request_policy(model_request_policy.clone())
            .with_output_schema(
                session_config
                    .turn_context
                    .as_ref()
                    .and_then(|context| context.output_schema.clone()),
                session_config
                    .turn_context
                    .as_ref()
                    .and_then(|context| context.output_schema.as_ref())
                    .is_some(),
            );
        if let Some(metadata) = request_metadata {
            request = request.with_metadata(metadata);
        }
        let mut provider_trace_attempt = provider_trace_metadata.as_ref().map(|metadata| {
            RuntimeProviderTraceAttempt::new(
                metadata.provider_name.clone(),
                metadata.model_name.clone(),
                attempt,
            )
        });
        if let Some(trace) = provider_trace_attempt.as_ref() {
            let tool_names = tools.iter().map(|tool| tool.name().to_string());
            emit_provider_trace(
                &mut on_event,
                provider_trace_metadata.as_ref(),
                trace.request_started().with_tool_names(tool_names),
            );
        }
        let first_visible_output_deadline = Instant::now() + first_visible_output_timeout;
        let provider_step_deadline = Instant::now() + provider_step_timeout;
        let mut stream = match start_provider_stream(
            &provider,
            request,
            cancel_token.as_ref(),
            first_visible_output_deadline,
            provider_step_deadline,
        )
        .await
        {
            Ok(ProviderStreamStart::Started(stream)) => stream,
            Ok(ProviderStreamStart::Cancelled) => {
                if let Some(trace) = provider_trace_attempt.as_ref() {
                    emit_provider_trace(
                        &mut on_event,
                        provider_trace_metadata.as_ref(),
                        trace.canceled("turn_canceled"),
                    );
                }
                return Ok(RuntimeReplyExecution::new(
                    text_output,
                    errors,
                    emitted_any,
                    attempts_summary(&loop_state),
                    true,
                ));
            }
            Ok(ProviderStreamStart::FirstVisibleOutputDeadlineElapsed) => {
                if let Some(trace) = provider_trace_attempt.as_ref() {
                    emit_provider_trace(
                        &mut on_event,
                        provider_trace_metadata.as_ref(),
                        trace.failed(first_visible_output_timeout_trace_failure()),
                    );
                }
                return Err(first_visible_output_timeout_error(
                    first_visible_output_timeout,
                    emitted_any,
                ));
            }
            Ok(ProviderStreamStart::ProviderStepDeadlineElapsed) => {
                if let Some(trace) = provider_trace_attempt.as_ref() {
                    emit_provider_trace(
                        &mut on_event,
                        provider_trace_metadata.as_ref(),
                        trace.failed(provider_step_timeout_trace_failure()),
                    );
                }
                return Err(provider_step_timeout_error(
                    provider_step_timeout,
                    emitted_any,
                ));
            }
            Err(error) => {
                if let Some(trace) = provider_trace_attempt.as_ref() {
                    emit_provider_trace(
                        &mut on_event,
                        provider_trace_metadata.as_ref(),
                        trace.failed(provider_trace_failure_from_error(&error)),
                    );
                }
                return Err(provider_attempt_error(
                    error.message,
                    emitted_any,
                    error.classification,
                    error.retryable,
                    error.retry_after,
                    consumed_pending_input,
                ));
            }
        };
        let mut assistant_content = model_history::AssistantHistory::default();
        let mut pending_calls = Vec::new();
        let mut provider_executed_calls = HashMap::<String, ToolCall>::new();
        let mut completed = false;
        let mut needs_follow_up = false;
        let mut tool_arguments = HashMap::<String, String>::new();
        let mut active_text_item_id = None;
        let mut active_reasoning_item_id = None;
        let mut pending_text_item_ids = Vec::new();
        let mut finish_reason = None;
        let mut step_text_output_chars = 0_u64;
        let text_output_offset = text_output.len();
        let mut step_text_output = output_lifecycle::TextOutput::default();
        let mut step_reasoning_output = output_lifecycle::ReasoningOutput::default();
        let mut step_usage = None;
        let mut has_user_visible_output = false;
        let mut step_has_user_visible_text = false;
        let mut step_emitted_tool_call = false;

        loop {
            let event = match next_provider_event(
                &mut stream,
                cancel_token.as_ref(),
                (!has_user_visible_output).then_some(first_visible_output_deadline),
                Some(provider_step_deadline),
            )
            .await
            {
                Ok(event) => event,
                Err(DeadlineElapsed::FirstVisibleOutput) => {
                    finish_active_output_items(
                        &mut active_reasoning_item_id,
                        &mut active_text_item_id,
                        &mut pending_text_item_ids,
                        &mut on_event,
                    );
                    for item_id in pending_text_item_ids.drain(..) {
                        on_event(CurrentProviderTurnEvent::TextEnd {
                            phase: assistant_content.text_phase(&item_id),
                            item_id,
                        });
                    }
                    if let Some(trace) = provider_trace_attempt.as_ref() {
                        emit_provider_trace(
                            &mut on_event,
                            provider_trace_metadata.as_ref(),
                            trace.failed(first_visible_output_timeout_trace_failure()),
                        );
                    }
                    record_session_token_usage(pending_input.as_ref(), step_usage.as_ref()).await;
                    return Err(first_visible_output_timeout_error(
                        first_visible_output_timeout,
                        emitted_any,
                    ));
                }
                Err(DeadlineElapsed::ProviderStep) => {
                    finish_active_output_items(
                        &mut active_reasoning_item_id,
                        &mut active_text_item_id,
                        &mut pending_text_item_ids,
                        &mut on_event,
                    );
                    for item_id in pending_text_item_ids.drain(..) {
                        on_event(CurrentProviderTurnEvent::TextEnd {
                            phase: assistant_content.text_phase(&item_id),
                            item_id,
                        });
                    }
                    if let Some(trace) = provider_trace_attempt.as_ref() {
                        emit_provider_trace(
                            &mut on_event,
                            provider_trace_metadata.as_ref(),
                            trace.failed(provider_step_timeout_trace_failure()),
                        );
                    }
                    record_session_token_usage(pending_input.as_ref(), step_usage.as_ref()).await;
                    return Err(provider_step_timeout_error(
                        provider_step_timeout,
                        emitted_any,
                    ));
                }
            };
            if is_cancelled(&cancel_token) {
                if let Some(Ok(event)) = event.as_ref() {
                    if let Some(usage) = provider_usage_from_event(event) {
                        on_event(CurrentProviderTurnEvent::Usage {
                            attempt,
                            usage: usage.clone(),
                        });
                        step_usage = Some(usage);
                    }
                }
                record_session_token_usage(pending_input.as_ref(), step_usage.as_ref()).await;
                if let Some(trace) = provider_trace_attempt.as_ref() {
                    emit_provider_trace(
                        &mut on_event,
                        provider_trace_metadata.as_ref(),
                        trace.canceled("turn_canceled"),
                    );
                }
                return Ok(RuntimeReplyExecution::new(
                    text_output,
                    errors,
                    emitted_any,
                    attempts_summary(&loop_state),
                    true,
                ));
            }
            let Some(event) = event else {
                break;
            };
            let event = match event {
                Ok(event) => event,
                Err(error) => {
                    record_session_token_usage(pending_input.as_ref(), step_usage.as_ref()).await;
                    if let Some(trace) = provider_trace_attempt.as_ref() {
                        emit_provider_trace(
                            &mut on_event,
                            provider_trace_metadata.as_ref(),
                            trace.failed(provider_trace_failure_from_error(&error)),
                        );
                    }
                    return Err(provider_attempt_error(
                        error.message,
                        emitted_any,
                        error.classification,
                        error.retryable,
                        error.retry_after,
                        consumed_pending_input,
                    ));
                }
            };
            if let Some(event) = provider_trace_attempt
                .as_mut()
                .and_then(RuntimeProviderTraceAttempt::first_event_received)
            {
                emit_provider_trace(&mut on_event, provider_trace_metadata.as_ref(), event);
            }
            match event {
                CanonicalLlmEvent::TextStart { id } => {
                    let id =
                        provider_output_item_id(&turn_id, attempt, ProviderOutputFamily::Text, &id);
                    start_output_item(
                        &mut active_text_item_id,
                        id,
                        ProviderOutputFamily::Text,
                        &mut on_event,
                        emitted_any,
                    )?;
                }
                CanonicalLlmEvent::TextDelta { id, text } => {
                    let visible_text = !text.trim().is_empty();
                    has_user_visible_output |= visible_text;
                    step_has_user_visible_text |= visible_text;
                    let id =
                        provider_output_item_id(&turn_id, attempt, ProviderOutputFamily::Text, &id);
                    if let Some(event) = provider_trace_attempt
                        .as_mut()
                        .and_then(|trace| trace.first_text_delta_received(text.chars().count()))
                    {
                        emit_provider_trace(&mut on_event, provider_trace_metadata.as_ref(), event);
                    }
                    emitted_any = true;
                    step_text_output_chars =
                        step_text_output_chars.saturating_add(text.chars().count() as u64);
                    text_output.push_str(&text);
                    step_text_output.append(&id, &text);
                    assistant_content
                        .display(id.clone(), CurrentProviderContent::Text(text.clone()));
                    start_output_item(
                        &mut active_text_item_id,
                        id.clone(),
                        ProviderOutputFamily::Text,
                        &mut on_event,
                        emitted_any,
                    )?;
                    on_event(CurrentProviderTurnEvent::TextDelta { item_id: id, text });
                }
                CanonicalLlmEvent::TextEnd { id } => {
                    let id =
                        provider_output_item_id(&turn_id, attempt, ProviderOutputFamily::Text, &id);
                    if !assistant_content.has_completed_text(&id) {
                        defer_text_output_item_end(
                            &mut active_text_item_id,
                            &mut pending_text_item_ids,
                            id,
                            &mut on_event,
                            emitted_any,
                        )?;
                    }
                }
                CanonicalLlmEvent::ReasoningStart { id } => {
                    let id = provider_output_item_id(
                        &turn_id,
                        attempt,
                        ProviderOutputFamily::Reasoning,
                        &id,
                    );
                    start_output_item(
                        &mut active_reasoning_item_id,
                        id,
                        ProviderOutputFamily::Reasoning,
                        &mut on_event,
                        emitted_any,
                    )?;
                }
                CanonicalLlmEvent::ReasoningSummaryDelta {
                    id,
                    text,
                    summary_index,
                } => {
                    let id = provider_output_item_id(
                        &turn_id,
                        attempt,
                        ProviderOutputFamily::Reasoning,
                        &id,
                    );
                    step_reasoning_output.append(&id, &text);
                    emitted_any = true;
                    start_output_item(
                        &mut active_reasoning_item_id,
                        id.clone(),
                        ProviderOutputFamily::Reasoning,
                        &mut on_event,
                        emitted_any,
                    )?;
                    on_event(CurrentProviderTurnEvent::ReasoningSummaryDelta {
                        item_id: id,
                        text,
                        summary_index,
                    });
                }
                CanonicalLlmEvent::ReasoningSummaryPartAdded { id, summary_index } => {
                    let id = provider_output_item_id(
                        &turn_id,
                        attempt,
                        ProviderOutputFamily::Reasoning,
                        &id,
                    );
                    emitted_any = true;
                    start_output_item(
                        &mut active_reasoning_item_id,
                        id.clone(),
                        ProviderOutputFamily::Reasoning,
                        &mut on_event,
                        emitted_any,
                    )?;
                    on_event(CurrentProviderTurnEvent::ReasoningSummaryPartAdded {
                        item_id: id,
                        summary_index,
                    });
                }
                CanonicalLlmEvent::ReasoningContentDelta {
                    id,
                    text,
                    content_index,
                } => {
                    let id = provider_output_item_id(
                        &turn_id,
                        attempt,
                        ProviderOutputFamily::Reasoning,
                        &id,
                    );
                    step_reasoning_output.append(&id, &text);
                    emitted_any = true;
                    assistant_content
                        .display(id.clone(), CurrentProviderContent::Reasoning(text.clone()));
                    start_output_item(
                        &mut active_reasoning_item_id,
                        id.clone(),
                        ProviderOutputFamily::Reasoning,
                        &mut on_event,
                        emitted_any,
                    )?;
                    on_event(CurrentProviderTurnEvent::ReasoningContentDelta {
                        item_id: id,
                        text,
                        content_index,
                    });
                }
                CanonicalLlmEvent::ReasoningEnd { id } => {
                    let id = provider_output_item_id(
                        &turn_id,
                        attempt,
                        ProviderOutputFamily::Reasoning,
                        &id,
                    );
                    if !assistant_content.has_completed_reasoning(&id) {
                        end_reasoning_output_item(
                            &mut active_reasoning_item_id,
                            id,
                            &mut on_event,
                            emitted_any,
                        )?;
                    }
                }
                CanonicalLlmEvent::ResponseItemDone {
                    source_id,
                    item,
                    producer,
                } => {
                    let completed_message = assistant_content
                        .complete(
                            &turn_id,
                            attempt,
                            source_id,
                            item,
                            producer,
                            session_config.model_history_recorder.as_ref(),
                        )
                        .await?;
                    // 完成项已进入模型历史，即使没有展示 delta 也不能按空输出改路由。
                    emitted_any = true;
                    match completed_message {
                        output_lifecycle::CompletedOutput::Message(message) => {
                            step_text_output.complete(&message.item_id, &message.text);
                            text_output.truncate(text_output_offset);
                            text_output.push_str(&step_text_output.text());
                            step_text_output_chars = step_text_output.chars();
                            step_has_user_visible_text = step_text_output.visible();
                            has_user_visible_output |= step_has_user_visible_text;
                            complete_text_output_item(
                                &mut active_text_item_id,
                                &mut pending_text_item_ids,
                                message,
                                &mut on_event,
                                emitted_any,
                            )?;
                        }
                        output_lifecycle::CompletedOutput::Reasoning(reasoning) => {
                            step_reasoning_output.complete(&reasoning);
                            output_lifecycle::complete_reasoning_output_item(
                                &mut active_reasoning_item_id,
                                reasoning,
                                &mut on_event,
                                emitted_any,
                            )?;
                        }
                    }
                }
                CanonicalLlmEvent::ToolInputDelta { id, name, text } => {
                    emitted_any = true;
                    let accumulated_arguments = tool_arguments.entry(id.clone()).or_default();
                    accumulated_arguments.push_str(&text);
                    on_event(CurrentProviderTurnEvent::ToolInputDelta {
                        tool_id: id,
                        tool_name: Some(name),
                        delta: text,
                        accumulated_arguments: accumulated_arguments.clone(),
                    });
                }
                CanonicalLlmEvent::ToolCall {
                    id,
                    name,
                    input,
                    raw_arguments,
                    provider_executed,
                    provider_metadata,
                } => {
                    has_user_visible_output = true;
                    emitted_any = true;
                    step_emitted_tool_call = true;
                    if provider_executed == Some(true) {
                        if let Some(raw_item) = provider_metadata.get("raw_response_item") {
                            assistant_content
                                .push(CurrentProviderContent::RawResponseItem(raw_item.clone()));
                        }
                        let provider_metadata = serde_json::Value::Object(
                            provider_metadata.clone().into_iter().collect(),
                        );
                        let call = ToolCall::new(
                            turn_id.clone(),
                            id.clone(),
                            name,
                            input,
                            vec![ToolEnvironment::new(
                                PROVIDER_TOOL_ENVIRONMENT_ID,
                                working_directory.clone(),
                            )],
                            tool_lifecycle_emitter.clone(),
                        )
                        .with_provider_metadata(provider_metadata);
                        call.emit_started().await;
                        provider_executed_calls.insert(id, call);
                        continue;
                    }
                    let model_call =
                        tool_call::model_call(id, name, input, raw_arguments, provider_metadata);
                    let call = if model_call.name == CODE_MODE_WAIT_TOOL_NAME
                        && tool_step_snapshot.code_mode_session().is_some()
                    {
                        model_call.clone()
                    } else {
                        prepare_provider_tool_call(&tool_step_snapshot, &model_call)
                    };
                    crate::model_history::record_calls(
                        session_config.model_history_recorder.as_ref(),
                        &[CurrentProviderContent::ToolCall(model_call.clone())],
                    )
                    .await?;
                    assistant_content.push(CurrentProviderContent::ToolCall(model_call));
                    if call.name == CODE_MODE_WAIT_TOOL_NAME
                        && tool_step_snapshot.code_mode_session().is_some()
                    {
                        pending_calls.push(PendingProviderToolCall::CodeModeWait(
                            tool_call::annotate_step_context(call, step_context.as_ref()),
                        ));
                    } else {
                        pending_calls.push(PendingProviderToolCall::Function(
                            tool_call::annotate_step_context(call, step_context.as_ref()),
                        ));
                    }
                }
                CanonicalLlmEvent::CustomToolCall {
                    id,
                    name,
                    input,
                    namespace,
                    provider_metadata,
                } => {
                    if name != CODE_MODE_EXEC_TOOL_NAME {
                        return Err(provider_attempt_error(
                            format!("unsupported custom tool call: {name}"),
                            emitted_any,
                            Some(FailureClassification::InvalidRequest),
                            false,
                            None,
                            consumed_pending_input,
                        ));
                    }
                    if tool_step_snapshot.code_mode_session().is_none() {
                        return Err(provider_attempt_error(
                            "custom tool call requires an executable CodeMode session",
                            emitted_any,
                            Some(FailureClassification::InvalidRequest),
                            false,
                            None,
                            consumed_pending_input,
                        ));
                    };
                    emitted_any = true;
                    has_user_visible_output = true;
                    step_emitted_tool_call = true;
                    let mut custom_call =
                        CurrentProviderCustomToolCall::new(id.clone(), name.clone(), input.clone());
                    custom_call.namespace = namespace;
                    custom_call.provider_metadata = provider_metadata;
                    custom_call =
                        tool_call::annotate_custom_step_context(custom_call, step_context.as_ref());
                    crate::model_history::record_calls(
                        session_config.model_history_recorder.as_ref(),
                        &[CurrentProviderContent::CustomToolCall(custom_call.clone())],
                    )
                    .await?;
                    assistant_content
                        .push(CurrentProviderContent::CustomToolCall(custom_call.clone()));
                    pending_calls.push(PendingProviderToolCall::Custom(custom_call));
                }
                CanonicalLlmEvent::ToolResult {
                    id,
                    name,
                    result,
                    provider_executed: Some(true),
                } => {
                    emitted_any = true;
                    has_user_visible_output = true;
                    let terminal_raw_item = provider_executed_raw_response_item(&result).cloned();
                    if let Some(raw_item) = terminal_raw_item.as_ref() {
                        upsert_raw_response_item(&mut assistant_content.content, raw_item.clone());
                    }
                    let mut call = provider_executed_calls.remove(&id).unwrap_or_else(|| {
                        ToolCall::new(
                            turn_id.clone(),
                            id,
                            name,
                            serde_json::json!({}),
                            vec![ToolEnvironment::new(
                                PROVIDER_TOOL_ENVIRONMENT_ID,
                                working_directory.clone(),
                            )],
                            tool_lifecycle_emitter.clone(),
                        )
                    });
                    if let Some(raw_item) = terminal_raw_item {
                        let provider_metadata = provider_metadata_with_raw_response_item(
                            call.provider_metadata(),
                            raw_item,
                        );
                        call = call.with_provider_metadata(provider_metadata);
                    }
                    call.emit_completed(provider_executed_tool_output(result))
                        .await;
                }
                CanonicalLlmEvent::Usage { usage } => {
                    let usage = current_provider_usage(usage);
                    step_usage = Some(usage.clone());
                    on_event(CurrentProviderTurnEvent::Usage { attempt, usage });
                }
                CanonicalLlmEvent::ServerModel { model } => {
                    if last_server_model.as_deref() != Some(model.as_str()) {
                        last_server_model = Some(model.clone());
                        on_event(CurrentProviderTurnEvent::ServerModel { model });
                    }
                }
                CanonicalLlmEvent::ModelReroute {
                    from_model,
                    to_model,
                    reason,
                } => {
                    if !model_reroute_emitted {
                        model_reroute_emitted = true;
                        on_event(CurrentProviderTurnEvent::ModelReroute {
                            from_model,
                            to_model,
                            reason,
                        });
                    }
                }
                CanonicalLlmEvent::ModelVerification { verifications } => {
                    if !model_verification_emitted && !verifications.is_empty() {
                        model_verification_emitted = true;
                        on_event(CurrentProviderTurnEvent::ModelVerification { verifications });
                    }
                }
                CanonicalLlmEvent::TurnModerationMetadata { metadata } => {
                    on_event(CurrentProviderTurnEvent::TurnModerationMetadata { metadata });
                }
                CanonicalLlmEvent::Finish {
                    reason,
                    usage,
                    needs_follow_up: follow_up,
                    ..
                } => {
                    needs_follow_up |= follow_up;
                    if let Some(usage) = usage {
                        let usage = current_provider_usage(usage);
                        step_usage = Some(usage.clone());
                        on_event(CurrentProviderTurnEvent::Usage { attempt, usage });
                    }
                    finish_reason = Some(finish_reason_name(reason).to_string());
                    finish_active_output_items(
                        &mut active_reasoning_item_id,
                        &mut active_text_item_id,
                        &mut pending_text_item_ids,
                        &mut on_event,
                    );
                    completed = true;
                }
                CanonicalLlmEvent::ProviderError {
                    message,
                    classification,
                    retryable,
                } => {
                    record_session_token_usage(pending_input.as_ref(), step_usage.as_ref()).await;
                    if let Some(trace) = provider_trace_attempt.as_ref() {
                        emit_provider_trace(
                            &mut on_event,
                            provider_trace_metadata.as_ref(),
                            trace.failed(provider_trace_failure(
                                classification,
                                retryable.unwrap_or(false),
                            )),
                        );
                    }
                    return Err(provider_attempt_error(
                        message,
                        emitted_any,
                        classification,
                        retryable.unwrap_or(false),
                        None,
                        consumed_pending_input,
                    ));
                }
                CanonicalLlmEvent::StepStart { .. }
                | CanonicalLlmEvent::ToolInputStart { .. }
                | CanonicalLlmEvent::ToolInputEnd { .. }
                | CanonicalLlmEvent::ToolResult { .. }
                | CanonicalLlmEvent::ToolError { .. } => {}
                CanonicalLlmEvent::StepFinish { reason, usage, .. } => {
                    if let Some(usage) = usage {
                        let usage = current_provider_usage(usage);
                        step_usage = Some(usage.clone());
                        on_event(CurrentProviderTurnEvent::Usage { attempt, usage });
                    }
                    finish_reason = Some(finish_reason_name(reason).to_string());
                }
            }
        }
        finish_active_output_items(
            &mut active_reasoning_item_id,
            &mut active_text_item_id,
            &mut pending_text_item_ids,
            &mut on_event,
        );
        for item_id in pending_text_item_ids {
            on_event(CurrentProviderTurnEvent::TextEnd {
                phase: assistant_content.text_phase(&item_id),
                item_id,
            });
        }
        on_event(CurrentProviderTurnEvent::ProviderStep {
            attempt,
            completed,
            finish_reason: finish_reason.clone(),
            text_output_chars: step_text_output_chars,
            reasoning_output_chars: step_reasoning_output.chars(),
            tool_call_count: pending_calls.len().min(u32::MAX as usize) as u32,
            usage: step_usage.clone(),
        });
        record_session_token_usage(pending_input.as_ref(), step_usage.as_ref()).await;
        provider_budget_tokens_used = provider_budget_tokens_used.saturating_add(
            step_usage
                .as_ref()
                .map(provider_budget_tokens)
                .unwrap_or_default(),
        );
        if is_cancelled(&cancel_token) {
            if let Some(input) = pending_input.as_ref() {
                input.mark_finishing().await;
            }
            return Ok(RuntimeReplyExecution::new(
                text_output,
                errors,
                emitted_any,
                attempts_summary(&loop_state),
                true,
            ));
        }

        let model_call_names = tool_call::model_call_names(&assistant_content.content);
        initial_messages.extend(assistant_content.into_messages());
        if !pending_calls.is_empty() || needs_follow_up {
            if let Some(message) = provider_budget_exhaustion_message(
                session_config.provider_token_budget,
                provider_budget_tokens_used,
                attempt,
            ) {
                if let Some(input) = pending_input.as_ref() {
                    input.mark_finishing().await;
                }
                errors.push(message);
                return Ok(RuntimeReplyExecution::new(
                    text_output,
                    errors,
                    emitted_any,
                    attempts_summary(&loop_state),
                    true,
                ));
            }
        }
        if pending_calls.is_empty() {
            let pending_messages = match pending_input.as_ref() {
                Some(input) => {
                    if needs_follow_up {
                        input.accept_mailbox_delivery_for_current_turn().await;
                    } else {
                        input.mark_mailbox_delivery_for_next_turn().await;
                    }
                    input
                        .try_take_pending_input(needs_follow_up)
                        .await
                        .map_err(|message| RuntimeReplyAttemptError::new(message, emitted_any))?
                        .into_iter()
                        .filter_map(runtime_session_input_message)
                        .collect::<Vec<_>>()
                }
                None => Vec::new(),
            };
            if !pending_messages.is_empty() || needs_follow_up {
                consumed_pending_input |= !pending_messages.is_empty();
                initial_messages.extend(pending_messages);
                maybe_compact_after_step(
                    step_mid_turn_compaction.as_ref(),
                    hook_step_snapshot.as_ref(),
                    pending_input.as_ref(),
                    &mut initial_messages,
                    &mut history_prefix_len,
                    step_usage.as_ref(),
                    attempt,
                    session_config.system_prompt.clone(),
                    generation.clone(),
                    provider_options.clone(),
                    model_request_policy.clone(),
                    cancel_token.as_ref(),
                    &mut on_event,
                    emitted_any,
                    &session_config,
                    &turn_id,
                    &working_directory,
                )
                .await?;
                continue;
            }
            let current_step_is_empty = !step_has_user_visible_text && !step_emitted_tool_call;
            if completed && current_step_is_empty {
                match finish_reason.as_deref() {
                    Some("content_filter") => {}
                    Some("length") => {
                        if let Some(input) = pending_input.as_ref() {
                            input.mark_finishing().await;
                        }
                        return Err(RuntimeReplyAttemptError::new(
                            "Provider reached its output limit without user-visible output",
                            emitted_any,
                        ));
                    }
                    Some("error") => {
                        if let Some(input) = pending_input.as_ref() {
                            input.mark_finishing().await;
                        }
                        return Err(RuntimeReplyAttemptError::new(
                            "Provider completed with an error and no user-visible output",
                            emitted_any,
                        ));
                    }
                    _ => {}
                }
            }
            if let Some(input) = pending_input.as_ref() {
                if !input.mark_finishing().await {
                    let steer = input
                        .try_take_pending_input(false)
                        .await
                        .map_err(|message| RuntimeReplyAttemptError::new(message, emitted_any))?;
                    consumed_pending_input |= !steer.is_empty();
                    initial_messages
                        .extend(steer.into_iter().filter_map(runtime_session_input_message));
                    continue;
                }
            }
            if completed {
                if let Some(hook_step_snapshot) = hook_step_snapshot.as_ref() {
                    if let Some((message, item)) = stop_hooks::continuation(
                        hook_step_snapshot,
                        &session_config,
                        &turn_id,
                        &working_directory,
                        stop_hook_active,
                        step_text_output.text(),
                        hook_prompt_index,
                    )
                    .await?
                    {
                        on_event(CurrentProviderTurnEvent::HookPrompt { item });
                        initial_messages.push(message);
                        if let Some(input) = pending_input.as_ref() {
                            input.resume_sampling().await;
                        }
                        hook_prompt_index = hook_prompt_index.saturating_add(1);
                        stop_hook_active = true;
                        continue;
                    }
                }
            }
            if !completed {
                errors.push("Provider stream ended without completion event".to_string());
            }
            if !completed && current_step_is_empty {
                return Err(RuntimeReplyAttemptError::new(
                    "Provider stream ended without a completion event or user-visible output",
                    emitted_any,
                ));
            }
            return Ok(RuntimeReplyExecution::new(
                text_output,
                errors,
                emitted_any,
                attempts_summary(&loop_state),
                false,
            ));
        }

        let pending_messages = match pending_input.as_ref() {
            Some(input) => {
                input.accept_mailbox_delivery_for_current_turn().await;
                input
                    .try_take_pending_input(true)
                    .await
                    .map_err(|message| RuntimeReplyAttemptError::new(message, emitted_any))?
                    .into_iter()
                    .filter_map(runtime_session_input_message)
                    .collect::<Vec<_>>()
            }
            None => Vec::new(),
        };

        let function_calls = pending_calls
            .iter()
            .filter_map(|call| match call {
                PendingProviderToolCall::Function(call) => Some(call.clone()),
                PendingProviderToolCall::Custom(_) | PendingProviderToolCall::CodeModeWait(_) => {
                    None
                }
            })
            .collect::<Vec<_>>();
        let custom_calls = pending_calls
            .iter()
            .filter_map(|call| match call {
                PendingProviderToolCall::Function(_) | PendingProviderToolCall::CodeModeWait(_) => {
                    None
                }
                PendingProviderToolCall::Custom(call) => Some(call.clone()),
            })
            .collect::<Vec<_>>();
        let wait_calls = pending_calls
            .iter()
            .filter_map(|call| match call {
                PendingProviderToolCall::Function(_) | PendingProviderToolCall::Custom(_) => None,
                PendingProviderToolCall::CodeModeWait(call) => Some(call.clone()),
            })
            .collect::<Vec<_>>();
        let code_mode_notification_sink = code_mode::CodeModeNotificationSink::default();
        let step_lifecycle_emitter = history_budget::emitter(
            tool_lifecycle_emitter.clone(),
            tool_step_snapshot.history_token_limit,
        );
        let allow_parallel = model_request_policy
            .as_ref()
            .and_then(RuntimeReplyModelRequestPolicy::parallel_tool_calls)
            .unwrap_or(false);
        let (function_results, custom_results, wait_results) = tokio::join!(
            execute_calls(
                &tool_step_snapshot,
                &turn_id,
                &session_config.id,
                session_config.turn_context.as_ref(),
                &working_directory,
                cancel_token.clone(),
                step_lifecycle_emitter.clone(),
                function_calls,
                allow_parallel,
            ),
            code_mode::execute_calls(
                &tool_step_snapshot,
                &turn_id,
                &session_config.id,
                session_config.turn_context.as_ref(),
                &working_directory,
                step_lifecycle_emitter.clone(),
                code_mode_notification_sink.clone(),
                custom_calls,
                cancel_token.clone(),
                allow_parallel,
            ),
            code_mode::execute_wait_calls(
                &tool_step_snapshot,
                &turn_id,
                &working_directory,
                step_lifecycle_emitter.clone(),
                wait_calls,
                cancel_token.clone(),
                allow_parallel,
            ),
        );
        let mut function_results = function_results.into_iter();
        let custom_notifications = custom_results.notifications;
        let mut custom_results = custom_results.results.into_iter();
        let mut wait_results = wait_results.into_iter();
        let mut result_content = custom_notifications
            .into_iter()
            .map(CurrentProviderContent::CustomToolResult)
            .collect::<Vec<_>>();
        result_content.extend(pending_calls.into_iter().map(|call| {
            match call {
                PendingProviderToolCall::Function(_) => CurrentProviderContent::ToolResult(
                    function_results
                        .next()
                        .expect("function result count must match pending calls"),
                ),
                PendingProviderToolCall::Custom(_) => CurrentProviderContent::CustomToolResult(
                    custom_results
                        .next()
                        .expect("custom result count must match pending calls"),
                ),
                PendingProviderToolCall::CodeModeWait(_) => CurrentProviderContent::ToolResult(
                    wait_results
                        .next()
                        .expect("wait result count must match pending calls"),
                ),
            }
        }));
        tool_call::restore_result_names(&mut result_content, &model_call_names);
        history_budget::capture_outputs(
            &mut result_content,
            tool_step_snapshot.history_token_limit,
        );
        crate::model_history::record_outputs(
            session_config.model_history_recorder.as_ref(),
            &result_content,
        )
        .await?;
        initial_messages.push(CurrentProviderMessage::tool(result_content));
        initial_messages.extend(pending_messages);
        maybe_compact_after_step(
            step_mid_turn_compaction.as_ref(),
            hook_step_snapshot.as_ref(),
            pending_input.as_ref(),
            &mut initial_messages,
            &mut history_prefix_len,
            step_usage.as_ref(),
            attempt,
            session_config.system_prompt.clone(),
            generation.clone(),
            provider_options.clone(),
            model_request_policy.clone(),
            cancel_token.as_ref(),
            &mut on_event,
            emitted_any,
            &session_config,
            &turn_id,
            &working_directory,
        )
        .await?;
    }
}

async fn maybe_compact_after_step<F>(
    capability: Option<&RuntimeMidTurnCompactionCapabilityHandle>,
    hook_step: Option<&RuntimeHookStepSnapshot>,
    pending_input: Option<&RuntimeSessionInputHandle>,
    messages: &mut Vec<CurrentProviderMessage>,
    history_prefix_len: &mut usize,
    usage: Option<&CurrentProviderUsage>,
    attempt: u32,
    system_prompt: Option<String>,
    generation: GenerationOptions,
    provider_options: ProviderMetadata,
    model_request_policy: Option<RuntimeReplyModelRequestPolicy>,
    cancel_token: Option<&CancellationToken>,
    on_event: &mut F,
    emitted_any: bool,
    session_config: &AgentSessionConfig,
    turn_id: &str,
    working_directory: &Path,
) -> Result<(), RuntimeReplyAttemptError>
where
    F: FnMut(CurrentProviderTurnEvent) + Send,
{
    let Some(capability) = capability else {
        return Ok(());
    };
    let usage = usage.cloned().unwrap_or_default();
    if !capability.should_compact(&usage) {
        return Ok(());
    }
    run_compaction_hook(
        hook_step,
        RuntimeHookEventName::PreCompact,
        session_config,
        turn_id,
        working_directory,
        emitted_any,
    )
    .await?;
    let result = capability
        .compact(
            RuntimeMidTurnCompactionRequest {
                messages: messages.clone(),
                history_prefix_len: (*history_prefix_len).min(messages.len()),
                usage,
                attempt,
                system_prompt,
                generation,
                provider_options,
                model_request_policy,
            },
            cancel_token.cloned(),
        )
        .await
        .map_err(|message| RuntimeReplyAttemptError::new(message, emitted_any))?;
    if let Some(result) = result {
        // A successful same-turn replacement starts a new context epoch.  Keep the
        // session input handle as the single owner of that monotonic counter so the
        // next sampling step captures the new epoch together with its tool and hook
        // snapshots.  The compaction capability returns the epoch it committed;
        // reject a stale or speculative result before exposing the replacement.
        let context_epoch = if let Some(input) = pending_input {
            let expected = input.advance_context_epoch().await;
            if result.context_epoch != expected {
                return Err(RuntimeReplyAttemptError::new(
                    format!(
                        "mid-turn compaction context epoch mismatch: expected {expected}, got {}",
                        result.context_epoch
                    ),
                    emitted_any,
                ));
            }
            expected
        } else {
            result.context_epoch
        };
        *messages = result.messages;
        *history_prefix_len = result.history_prefix_len.min(messages.len());
        run_compaction_hook(
            hook_step,
            RuntimeHookEventName::PostCompact,
            session_config,
            turn_id,
            working_directory,
            emitted_any,
        )
        .await?;
        on_event(CurrentProviderTurnEvent::MidTurnCompaction {
            compaction_id: result.compaction_id,
            context_epoch,
            covered_through_sequence: result.covered_through_sequence,
            durable_event_id: result.durable_event_id,
        });
    }
    Ok(())
}

async fn run_compaction_hook(
    hook_step: Option<&RuntimeHookStepSnapshot>,
    event_name: RuntimeHookEventName,
    session_config: &AgentSessionConfig,
    turn_id: &str,
    working_directory: &Path,
    emitted_any: bool,
) -> Result<(), RuntimeReplyAttemptError> {
    let Some(hook_step) = hook_step else {
        return Ok(());
    };
    if !hook_step
        .hooks
        .iter()
        .any(|hook| hook.event_name == event_name)
    {
        return Ok(());
    }
    let model = session_config
        .turn_context
        .as_ref()
        .and_then(|context| context.model.clone())
        .unwrap_or_else(|| "unknown".to_string());
    let context = RuntimeHookEventContext {
        session_id: Some(session_config.id.clone()),
        turn_id: Some(turn_id.to_string()),
        working_directory: working_directory.to_path_buf(),
        compact: Some(RuntimeCompactHookContext {
            invocation_id: format!("{turn_id}:{}", event_name.key_label()),
            model,
            trigger: "auto_context_limit".to_string(),
            transcript_path: session_config.stop_hook_transcript_path.clone(),
        }),
        ..RuntimeHookEventContext::default()
    };
    let evaluation = evaluate_hook_event_async(
        &RuntimeTurnSnapshot::try_new(Vec::new(), hook_step.hooks.clone()).map_err(|error| {
            RuntimeReplyAttemptError::new(
                format!("compaction hook snapshot is invalid: {error:?}"),
                emitted_any,
            )
        })?,
        event_name,
        &context,
        hook_step.reporter.as_ref(),
    )
    .await;
    if evaluation.is_blocked() {
        return Err(RuntimeReplyAttemptError::new(
            evaluation
                .blocking_reason()
                .unwrap_or_else(|| format!("{event_name:?} hook blocked compaction")),
            emitted_any,
        ));
    }
    Ok(())
}

/// Resolve the shared generation controls for loop and single-sample requests.
pub fn provider_request_controls(
    session_config: &AgentSessionConfig,
) -> (GenerationOptions, ProviderMetadata) {
    let mut generation = GenerationOptions::default();
    let mut provider_options = ProviderMetadata::new();
    let harness_generation = session_config
        .turn_context
        .as_ref()
        .and_then(|context| context.metadata.get("runtime_request"))
        .and_then(|metadata| metadata.pointer("/harness/generation"));

    generation.max_tokens = harness_generation
        .and_then(|generation| {
            generation
                .get("max_output_tokens")
                .or_else(|| generation.get("maxOutputTokens"))
        })
        .and_then(serde_json::Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .filter(|value| *value > 0);
    let enable_thinking = harness_generation
        .and_then(|generation| {
            generation
                .get("enable_thinking")
                .or_else(|| generation.get("enableThinking"))
        })
        .and_then(serde_json::Value::as_bool)
        .or_else(|| {
            session_config
                .turn_context
                .as_ref()
                .and_then(|context| context.metadata.get("app_server_runtime_backend"))
                .and_then(|metadata| {
                    metadata
                        .get("thinkingEnabled")
                        .or_else(|| metadata.get("thinking_enabled"))
                })
                .and_then(serde_json::Value::as_bool)
        });
    if let Some(enable_thinking) = enable_thinking {
        provider_options.insert("enable_thinking".to_string(), enable_thinking.into());
    }

    (generation, provider_options)
}

fn first_visible_output_timeout(session_config: &AgentSessionConfig) -> Duration {
    session_config
        .turn_context
        .as_ref()
        .and_then(|context| context.metadata.get("runtime_request"))
        .and_then(|metadata| metadata.pointer("/harness/generation"))
        .and_then(|generation| {
            generation
                .get("first_visible_output_timeout_ms")
                .or_else(|| generation.get("firstVisibleOutputTimeoutMs"))
        })
        .and_then(serde_json::Value::as_u64)
        .filter(|timeout_ms| *timeout_ms > 0)
        .map(Duration::from_millis)
        .unwrap_or(DEFAULT_FIRST_VISIBLE_OUTPUT_TIMEOUT)
}

fn provider_step_timeout(session_config: &AgentSessionConfig) -> Duration {
    session_config
        .turn_context
        .as_ref()
        .and_then(|context| context.metadata.get("runtime_request"))
        .and_then(|metadata| metadata.pointer("/harness/generation"))
        .and_then(|generation| {
            generation
                .get("provider_step_timeout_ms")
                .or_else(|| generation.get("providerStepTimeoutMs"))
        })
        .and_then(serde_json::Value::as_u64)
        .filter(|timeout_ms| *timeout_ms > 0)
        .map(Duration::from_millis)
        .unwrap_or(DEFAULT_PROVIDER_STEP_TIMEOUT)
}

fn first_visible_output_timeout_error(
    timeout: Duration,
    emitted_any: bool,
) -> RuntimeReplyAttemptError {
    RuntimeReplyAttemptError::new(
        format!(
            "Provider produced no user-visible output within {}ms",
            timeout.as_millis()
        ),
        emitted_any,
    )
}

fn first_visible_output_timeout_trace_failure() -> ProviderTraceFailure {
    ProviderTraceFailure::new("execution", false, false)
}

fn provider_step_timeout_error(timeout: Duration, emitted_any: bool) -> RuntimeReplyAttemptError {
    RuntimeReplyAttemptError::new(
        format!(
            "Provider step exceeded the absolute deadline of {}ms",
            timeout.as_millis()
        ),
        emitted_any,
    )
}

fn provider_step_timeout_trace_failure() -> ProviderTraceFailure {
    ProviderTraceFailure::new("execution", false, false)
}

fn provider_trace_failure_from_error(error: &CurrentProviderError) -> ProviderTraceFailure {
    provider_trace_failure(error.classification, error.retryable)
}

fn provider_attempt_error(
    message: impl Into<String>,
    emitted_any: bool,
    classification: Option<FailureClassification>,
    retryable: bool,
    retry_after: Option<Duration>,
    consumed_pending_input: bool,
) -> RuntimeReplyAttemptError {
    let error =
        RuntimeReplyAttemptError::provider_failure(message, emitted_any, classification, retryable)
            .with_retry_after(retry_after);
    if consumed_pending_input {
        error.suppress_reroute()
    } else {
        error
    }
}

fn provider_trace_failure(
    classification: Option<FailureClassification>,
    retryable: bool,
) -> ProviderTraceFailure {
    let category = match classification {
        Some(FailureClassification::Authentication) => "auth",
        Some(FailureClassification::RateLimit | FailureClassification::Quota) => "rate_limit",
        Some(FailureClassification::ProviderInternal) => "server",
        Some(
            FailureClassification::Permission
            | FailureClassification::InvalidRequest
            | FailureClassification::ContextOverflow
            | FailureClassification::ContentPolicy,
        ) => "request",
        Some(FailureClassification::Transport) => "execution",
        Some(FailureClassification::Unknown) | None => "unknown",
    };
    let non_retryable_provider_rejection = !retryable
        && matches!(
            classification,
            Some(
                FailureClassification::Authentication
                    | FailureClassification::Permission
                    | FailureClassification::Quota
                    | FailureClassification::InvalidRequest
                    | FailureClassification::ContextOverflow
                    | FailureClassification::ContentPolicy
            )
        );
    ProviderTraceFailure::new(category, retryable, non_retryable_provider_rejection)
}

fn resolve_world_state(
    session_config: &AgentSessionConfig,
    working_directory: &Path,
) -> Result<RuntimeWorldState, RuntimeReplyAttemptError> {
    let Some(snapshot) = session_config
        .turn_context
        .as_ref()
        .and_then(|context| context.metadata.get(WORLD_STATE_TURN_METADATA_KEY))
    else {
        return Ok(RuntimeWorldState::from_cwd(working_directory));
    };

    serde_json::from_value(snapshot.clone()).map_err(|error| {
        RuntimeReplyAttemptError::new(
            format!("Invalid {WORLD_STATE_TURN_METADATA_KEY} turn metadata: {error}"),
            false,
        )
    })
}

fn insert_world_state_before_current_user(
    messages: &mut Vec<CurrentProviderMessage>,
    world_state: &RuntimeWorldState,
) {
    let Some(rendered) = world_state.render_environment_context() else {
        return;
    };
    let context = CurrentProviderMessage::user(vec![CurrentProviderContent::Text(rendered)]);
    let insertion_index = if matches!(
        messages.last(),
        Some(message) if message.role == CurrentProviderRole::User
    ) {
        messages.len() - 1
    } else {
        messages.len()
    };
    messages.insert(insertion_index, context);
}

async fn next_provider_event(
    stream: &mut CurrentProviderStream,
    cancel_token: Option<&CancellationToken>,
    first_visible_output_deadline: Option<Instant>,
    provider_step_deadline: Option<Instant>,
) -> Result<Option<Result<CanonicalLlmEvent, CurrentProviderError>>, DeadlineElapsed> {
    match (
        cancel_token,
        first_visible_output_deadline,
        provider_step_deadline,
    ) {
        (Some(cancel_token), Some(first_deadline), Some(step_deadline)) => {
            tokio::select! {
                biased;
                _ = cancel_token.cancelled() => Ok(buffered_provider_event(stream)),
                _ = tokio::time::sleep_until(first_deadline) => Err(DeadlineElapsed::FirstVisibleOutput),
                _ = tokio::time::sleep_until(step_deadline) => Err(DeadlineElapsed::ProviderStep),
                event = stream.next() => Ok(event),
            }
        }
        (Some(cancel_token), None, Some(step_deadline)) => {
            tokio::select! {
                biased;
                _ = cancel_token.cancelled() => Ok(buffered_provider_event(stream)),
                _ = tokio::time::sleep_until(step_deadline) => Err(DeadlineElapsed::ProviderStep),
                event = stream.next() => Ok(event),
            }
        }
        (Some(cancel_token), Some(first_deadline), None) => {
            tokio::select! {
                biased;
                _ = cancel_token.cancelled() => Ok(buffered_provider_event(stream)),
                _ = tokio::time::sleep_until(first_deadline) => Err(DeadlineElapsed::FirstVisibleOutput),
                event = stream.next() => Ok(event),
            }
        }
        (None, Some(first_deadline), Some(step_deadline)) => {
            tokio::select! {
                biased;
                _ = tokio::time::sleep_until(first_deadline) => Err(DeadlineElapsed::FirstVisibleOutput),
                _ = tokio::time::sleep_until(step_deadline) => Err(DeadlineElapsed::ProviderStep),
                event = stream.next() => Ok(event),
            }
        }
        (None, None, Some(step_deadline)) => {
            tokio::select! {
                biased;
                _ = tokio::time::sleep_until(step_deadline) => Err(DeadlineElapsed::ProviderStep),
                event = stream.next() => Ok(event),
            }
        }
        (None, Some(first_deadline), None) => {
            tokio::select! {
                biased;
                _ = tokio::time::sleep_until(first_deadline) => Err(DeadlineElapsed::FirstVisibleOutput),
                event = stream.next() => Ok(event),
            }
        }
        (Some(cancel_token), None, None) => {
            tokio::select! {
                biased;
                _ = cancel_token.cancelled() => Ok(buffered_provider_event(stream)),
                event = stream.next() => Ok(event),
            }
        }
        (None, None, None) => Ok(stream.next().await),
    }
}

fn buffered_provider_event(
    stream: &mut CurrentProviderStream,
) -> Option<Result<CanonicalLlmEvent, CurrentProviderError>> {
    // Preserve usage produced by the same raw stream poll that triggered cancellation.
    stream.next().now_or_never().flatten()
}

enum DeadlineElapsed {
    FirstVisibleOutput,
    ProviderStep,
}

fn emit_provider_trace<F>(
    on_event: &mut F,
    metadata: Option<&RuntimeReplyProviderTraceMetadata>,
    mut event: ProviderTraceEvent,
) where
    F: FnMut(CurrentProviderTurnEvent),
{
    if let Some(metadata) = metadata {
        metadata.apply_to_provider_trace_event(&mut event);
    }
    on_event(CurrentProviderTurnEvent::ProviderTrace { event });
}

fn current_provider_usage(usage: Usage) -> CurrentProviderUsage {
    CurrentProviderUsage {
        input_tokens: usage.input_tokens.unwrap_or_default().min(u32::MAX as u64) as u32,
        output_tokens: usage.output_tokens.unwrap_or_default().min(u32::MAX as u64) as u32,
        cached_input_tokens: usage
            .cache_read_input_tokens
            .map(|value| value.min(u32::MAX as u64) as u32),
        cache_creation_input_tokens: usage
            .cache_write_input_tokens
            .map(|value| value.min(u32::MAX as u64) as u32),
        lime_rollout_budget_units: usage.lime_rollout_budget_units,
    }
}

fn provider_usage_from_event(event: &CanonicalLlmEvent) -> Option<CurrentProviderUsage> {
    match event {
        CanonicalLlmEvent::Usage { usage }
        | CanonicalLlmEvent::Finish {
            usage: Some(usage), ..
        }
        | CanonicalLlmEvent::StepFinish {
            usage: Some(usage), ..
        } => Some(current_provider_usage(usage.clone())),
        _ => None,
    }
}

fn provider_budget_tokens(usage: &CurrentProviderUsage) -> u64 {
    u64::from(
        usage
            .input_tokens
            .saturating_sub(usage.cached_input_tokens.unwrap_or_default()),
    )
    .saturating_add(u64::from(usage.output_tokens))
}

fn provider_budget_exhaustion_message(
    limit: Option<u64>,
    used: u64,
    attempt: u32,
) -> Option<String> {
    let limit = limit?;
    (used >= limit).then(|| {
        format!(
            "Provider token budget exhausted after attempt {attempt}: used={used} limit={limit}"
        )
    })
}

async fn record_session_token_usage(
    pending_input: Option<&RuntimeSessionInputHandle>,
    usage: Option<&CurrentProviderUsage>,
) {
    let (Some(input), Some(usage)) = (pending_input, usage) else {
        return;
    };
    input
        .record_token_usage(
            u64::from(usage.input_tokens),
            u64::from(usage.output_tokens),
            0,
            u64::from(usage.cache_creation_input_tokens.unwrap_or_default()),
        )
        .await;
}

fn finish_reason_name(reason: FinishReason) -> &'static str {
    match reason {
        FinishReason::Stop => "stop",
        FinishReason::ToolCall => "tool_call",
        FinishReason::Length => "length",
        FinishReason::ContentFilter => "content_filter",
        FinishReason::Error => "error",
        FinishReason::Unknown => "unknown",
    }
}

fn provider_executed_tool_output(result: ToolResultValue) -> NormalizedToolOutput {
    let (success, text, structured_content, error) = match result {
        ToolResultValue::Json { value } => (
            true,
            "Provider executed the hosted tool".to_string(),
            Some(value),
            None,
        ),
        ToolResultValue::Text { value } => (true, value, None, None),
        ToolResultValue::Error { value } => {
            let message = value
                .as_str()
                .map(str::to_string)
                .unwrap_or_else(|| value.to_string());
            (false, message.clone(), Some(value), Some(message))
        }
        ToolResultValue::Content { value } => {
            let structured = serde_json::to_value(value).unwrap_or(serde_json::Value::Null);
            (
                true,
                "Provider executed the hosted tool".to_string(),
                Some(structured),
                None,
            )
        }
    };
    NormalizedToolOutput {
        history_token_limit: None,
        success,
        text,
        structured_content,
        error,
        duration_ms: 0,
        truncation: None,
        sidecar_reference: None,
        metadata: HashMap::from([(
            "provider_executed".to_string(),
            serde_json::Value::Bool(true),
        )]),
        agent_control_projection_facts: Vec::new(),
        agent_control_state_facts: Vec::new(),
    }
}

fn provider_executed_raw_response_item(result: &ToolResultValue) -> Option<&serde_json::Value> {
    match result {
        ToolResultValue::Json { value } if raw_response_item_identity(value).is_some() => {
            Some(value)
        }
        _ => None,
    }
}

fn provider_metadata_with_raw_response_item(
    metadata: &serde_json::Value,
    raw_item: serde_json::Value,
) -> serde_json::Value {
    let mut metadata = metadata.as_object().cloned().unwrap_or_default();
    metadata.insert("raw_response_item".to_string(), raw_item);
    serde_json::Value::Object(metadata)
}

fn upsert_raw_response_item(
    content: &mut Vec<CurrentProviderContent>,
    raw_item: serde_json::Value,
) {
    let Some((item_type, item_id)) = raw_response_item_identity(&raw_item) else {
        return;
    };
    let existing = content.iter().position(|content| match content {
        CurrentProviderContent::RawResponseItem(candidate) => raw_response_item_identity(candidate)
            .is_some_and(|identity| identity == (item_type, item_id)),
        _ => false,
    });
    if let Some(index) = existing {
        content[index] = CurrentProviderContent::RawResponseItem(raw_item);
    } else {
        content.push(CurrentProviderContent::RawResponseItem(raw_item));
    }
}

fn raw_response_item_identity(value: &serde_json::Value) -> Option<(&str, &str)> {
    let item_type = value.get("type")?.as_str()?.trim();
    let item_id = value.get("id")?.as_str()?.trim();
    (!item_type.is_empty() && !item_id.is_empty()).then_some((item_type, item_id))
}

async fn execute_calls(
    tool_step_snapshot: &RuntimeToolStepSnapshot,
    turn_id: &str,
    session_id: &str,
    turn_context: Option<&agent_protocol::turn_context::TurnContextOverride>,
    working_directory: &PathBuf,
    cancel_token: Option<CancellationToken>,
    lifecycle_emitter: Arc<dyn ToolLifecycleEmitter>,
    calls: Vec<CurrentProviderToolCall>,
    allow_parallel: bool,
) -> Vec<CurrentProviderToolResult> {
    let parallel_execution = Arc::new(tokio::sync::RwLock::new(()));
    let execute = |call: CurrentProviderToolCall| {
        let (definition, step_executor, advertised, environment_id) = if call.name
            == INVALID_TOOL_CALL_NAME
            && call
                .provider_metadata
                .contains_key(TOOL_CALL_REPAIR_METADATA_KEY)
        {
            (
                invalid_runtime_tool_definition(),
                RuntimeToolExecutorHandle::new(Arc::new(InvalidStepToolExecutor)),
                false,
                LOCAL_TOOL_ENVIRONMENT_ID.to_string(),
            )
        } else {
            match runtime_tool_definition_for_call(&tool_step_snapshot.definitions, &call) {
                Some(definition) => (
                    definition,
                    tool_step_snapshot.executor.clone(),
                    true,
                    tool_step_snapshot.environment_id(&call.name).to_string(),
                ),
                None => (
                    unavailable_runtime_tool_definition(&call),
                    RuntimeToolExecutorHandle::new(Arc::new(UnavailableStepToolExecutor)),
                    false,
                    LOCAL_TOOL_ENVIRONMENT_ID.to_string(),
                ),
            }
        };
        let supports_parallel = allow_parallel
            && tool_step_snapshot.supports_parallel_tool_calls(&call.name)
            && advertised;
        let execution = execute_call(
            step_executor,
            definition,
            turn_id.to_string(),
            session_id.to_string(),
            turn_context.cloned(),
            environment_id,
            working_directory.clone(),
            tool_step_snapshot.filesystem_gateway().cloned(),
            tool_step_snapshot.history_token_limit,
            cancel_token.clone(),
            lifecycle_emitter.clone(),
            call,
        );
        let parallel_execution = Arc::clone(&parallel_execution);
        async move {
            if supports_parallel {
                let _guard = parallel_execution.read().await;
                execution.await
            } else {
                let _guard = parallel_execution.write().await;
                execution.await
            }
        }
    };
    let completed = if allow_parallel && calls.len() > 1 {
        join_all(calls.into_iter().map(execute)).await
    } else {
        let mut completed = Vec::with_capacity(calls.len());
        for call in calls {
            completed.push(execute(call).await);
        }
        completed
    };

    let mut results = Vec::with_capacity(completed.len());
    for CompletedToolCall { call, output } in completed {
        results.push(CurrentProviderToolResult {
            history_token_limit: output.history_token_limit,
            call_id: call.id,
            name: call.name,
            success: output.success,
            output: output.text,
            error: output.error,
        });
    }
    results
}

fn runtime_tool_definition_for_call(
    definitions: &[RuntimeToolDefinition],
    call: &CurrentProviderToolCall,
) -> Option<RuntimeToolDefinition> {
    definitions
        .iter()
        .find(|definition| definition.name == call.name)
        .cloned()
}

fn unavailable_runtime_tool_definition(call: &CurrentProviderToolCall) -> RuntimeToolDefinition {
    RuntimeToolDefinition::new(
        call.name.clone(),
        "Provider requested a tool that was unavailable for this sampling step",
        serde_json::json!({ "type": "object" }),
    )
}

fn invalid_runtime_tool_definition() -> RuntimeToolDefinition {
    RuntimeToolDefinition::new(
        INVALID_TOOL_CALL_NAME,
        "Provider tool call rejected before handler execution",
        serde_json::json!({
            "type": "object",
            "required": ["tool", "error"],
            "properties": {
                "tool": { "type": "string" },
                "error": { "type": "string" }
            }
        }),
    )
}

struct UnavailableStepToolExecutor;

struct InvalidStepToolExecutor;

impl RuntimeToolExecutor for InvalidStepToolExecutor {
    fn execute<'a>(
        &'a self,
        request: RuntimeToolExecutionRequest<'a>,
    ) -> RuntimeToolExecutionFuture<'a> {
        Box::pin(async move {
            let message = request
                .params
                .get("error")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("Provider tool call was invalid")
                .to_string();
            Err(RuntimeToolExecutionError::new(message, None).before_handler())
        })
    }
}

impl RuntimeToolExecutor for UnavailableStepToolExecutor {
    fn execute<'a>(
        &'a self,
        request: RuntimeToolExecutionRequest<'a>,
    ) -> RuntimeToolExecutionFuture<'a> {
        Box::pin(async move {
            let message = format!(
                "tool '{}' was not advertised for this sampling step",
                request.tool_name
            );
            Err(RuntimeToolExecutionError::new(
                message.clone(),
                Some(RuntimeToolPolicyErrorKind::PermissionDenied(message)),
            )
            .before_handler())
        })
    }
}

struct CompletedToolCall {
    call: CurrentProviderToolCall,
    output: NormalizedToolOutput,
}

async fn execute_call(
    executor: RuntimeToolExecutorHandle,
    definition: RuntimeToolDefinition,
    turn_id: String,
    session_id: String,
    turn_context: Option<agent_protocol::turn_context::TurnContextOverride>,
    environment_id: String,
    working_directory: PathBuf,
    filesystem_gateway: Option<Arc<dyn tool_runtime::filesystem_gateway::RuntimeFileSystemGateway>>,
    history_token_limit: Option<usize>,
    cancel_token: Option<CancellationToken>,
    lifecycle_emitter: Arc<dyn ToolLifecycleEmitter>,
    call: CurrentProviderToolCall,
) -> CompletedToolCall {
    let context = RuntimeToolExecutionContext::new(RuntimeToolExecutionContextInput {
        working_directory: working_directory.clone(),
        session_id,
        cancel_token,
        workspace_sandbox: None,
    })
    .with_optional_filesystem_gateway(filesystem_gateway)
    .with_history_token_limit(history_token_limit);
    let provider_metadata =
        serde_json::Value::Object(call.provider_metadata.clone().into_iter().collect());
    let tool_call = ToolCall::new(
        turn_id,
        call.id.clone(),
        call.name.clone(),
        call.arguments.clone(),
        vec![ToolEnvironment::new(environment_id, working_directory)],
        lifecycle_emitter,
    )
    .with_provider_metadata(provider_metadata);
    let runtime_tool = executor.bind(definition, RuntimeToolExposure::Direct);
    let output = runtime_tool
        .execute_call(&tool_call, &context, turn_context.as_ref())
        .await;
    CompletedToolCall { call, output }
}

fn is_cancelled(cancel_token: &Option<CancellationToken>) -> bool {
    cancel_token
        .as_ref()
        .is_some_and(CancellationToken::is_cancelled)
}

fn attempts_summary(loop_state: &RuntimeReplyLoop) -> String {
    format!("attempts={}", loop_state.attempts_taken())
}

#[cfg(test)]
#[path = "provider_turn/tests.rs"]
mod tests;
