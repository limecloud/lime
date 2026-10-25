use crate::protocol::AgentEvent;
use crate::runtime_state::AgentRuntimeState;
use agent_runtime::provider_turn::{
    RuntimeHookSnapshotFuture, RuntimeHookSnapshotSource, RuntimeHookSnapshotSourceHandle,
    RuntimeHookStepSnapshot,
};
use agent_runtime::session_loop::RuntimeSessionInputHandle;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tool_runtime::hook_discovery::{discover_hooks, HookDiscoveryInput};
use tool_runtime::hook_lifecycle::{
    RuntimeHookEventContext, RuntimeHookEventName, RuntimeInterruptHookContext,
};
use tool_runtime::hook_runtime::{
    AsyncHookResultSink, CommandHookReporter, HookLifecycleEmitter, HookLifecycleEvent,
    HookLifecyclePhase, McpHookExecutor, McpHookOutput,
};
use tool_runtime::hook_source::PluginHookSourceProviderHandle;

pub(super) fn current_hook_step_snapshot_source(
    state: AgentRuntimeState,
    session_id: String,
    thread_id: String,
    plugin_source: Option<PluginHookSourceProviderHandle>,
    working_directory: PathBuf,
    event_sender: mpsc::UnboundedSender<AgentEvent>,
    pending_input: Option<RuntimeSessionInputHandle>,
    cancel_token: Option<CancellationToken>,
) -> Option<RuntimeHookSnapshotSourceHandle> {
    let lime_home = lime_core::app_paths::resolve_lime_home_dir()?;
    Some(RuntimeHookSnapshotSourceHandle::new(Arc::new(
        CurrentHookStepSnapshotSource {
            input: HookDiscoveryInput {
                lime_home,
                cwd: working_directory,
                plugins: Vec::new(),
            },
            plugin_source,
            state: state.clone(),
            session_id,
            thread_id,
            emitter: Arc::new(AgentHookLifecycleEmitter {
                event_sender: event_sender.clone(),
            }),
            event_sender,
            pending_input,
            cancel_token,
        },
    )))
}

/// Execute Codex-compatible Interrupt hooks after the session actor has
/// cancelled the active turn. Discovery and MCP execution deliberately reuse
/// the same current hook source as provider steps, so CLI/TUI/Desktop do not
/// grow a second hook backend.
pub async fn run_interrupt_hooks(
    state: AgentRuntimeState,
    session_config: &agent_runtime::session_config::AgentSessionConfig,
    working_directory: PathBuf,
) -> Vec<AgentEvent> {
    let (event_sender, mut event_receiver) = mpsc::unbounded_channel();
    if !matches!(
        &session_config.stop_hook_target,
        tool_runtime::hook_lifecycle::RuntimeStopHookTarget::Stop
    ) {
        // Codex excludes ThreadSpawn/Synthetic/MemoryConsolidation sessions
        // from root Interrupt hooks.
        return Vec::new();
    }
    let Some(source) = current_hook_step_snapshot_source(
        state,
        session_config.id.clone(),
        session_config
            .thread_id
            .clone()
            .unwrap_or_else(|| session_config.id.clone()),
        session_config.plugin_hook_source.clone(),
        working_directory.clone(),
        event_sender.clone(),
        None,
        None,
    ) else {
        return Vec::new();
    };
    let snapshot = match source.capture(None).await {
        Ok(snapshot) => snapshot,
        Err(error) => {
            let _ = event_sender.send(AgentEvent::Warning {
                code: Some("interrupt_hook_load_failed".to_string()),
                message: error,
            });
            return drain_events(&mut event_receiver);
        }
    };
    let Some(turn_id) = session_config.turn_id.clone() else {
        return drain_events(&mut event_receiver);
    };
    let turn_context = session_config.turn_context.as_ref();
    let context = RuntimeHookEventContext {
        session_id: Some(session_config.id.clone()),
        turn_id: Some(turn_id),
        working_directory,
        interrupt: Some(RuntimeInterruptHookContext {
            model: turn_context
                .and_then(|context| context.model.clone())
                .unwrap_or_else(|| "unknown".to_string()),
            permission_mode: turn_context
                .and_then(|context| context.approval_policy.as_deref())
                .map(interrupt_permission_mode)
                .unwrap_or_else(|| "default".to_string()),
            transcript_path: session_config.stop_hook_transcript_path.clone(),
        }),
        ..RuntimeHookEventContext::default()
    };
    for hook in snapshot
        .hooks
        .iter()
        .filter(|hook| hook.event_name == RuntimeHookEventName::Interrupt)
    {
        let _ = snapshot
            .reporter
            .report(hook, RuntimeHookEventName::Interrupt, &context)
            .await;
    }
    drain_events(&mut event_receiver)
}

fn interrupt_permission_mode(policy: &str) -> String {
    match policy.trim().to_ascii_lowercase().as_str() {
        "never" | "bypasspermissions" | "bypass_permissions" => "bypassPermissions",
        "acceptedits" | "accept_edits" | "accept-edits" => "acceptEdits",
        "plan" => "plan",
        "dontask" | "dont_ask" | "dont-ask" => "dontAsk",
        _ => "default",
    }
    .to_string()
}

fn drain_events(receiver: &mut mpsc::UnboundedReceiver<AgentEvent>) -> Vec<AgentEvent> {
    let mut events = Vec::new();
    while let Ok(event) = receiver.try_recv() {
        events.push(event);
    }
    events
}

struct CurrentHookStepSnapshotSource {
    input: HookDiscoveryInput,
    plugin_source: Option<PluginHookSourceProviderHandle>,
    state: AgentRuntimeState,
    session_id: String,
    thread_id: String,
    emitter: Arc<dyn HookLifecycleEmitter>,
    event_sender: mpsc::UnboundedSender<AgentEvent>,
    pending_input: Option<RuntimeSessionInputHandle>,
    cancel_token: Option<CancellationToken>,
}

impl RuntimeHookSnapshotSource for CurrentHookStepSnapshotSource {
    fn capture(
        &self,
        step_context: Option<&agent_runtime::session_loop::RuntimeSessionStepContext>,
    ) -> RuntimeHookSnapshotFuture<'_> {
        let step_context = step_context.cloned();
        Box::pin(async move {
            let plugins = match &self.plugin_source {
                Some(source) => source.load().await?,
                None => Default::default(),
            };
            let mut input = self.input.clone();
            input.plugins = plugins.sources;
            let mut report = discover_hooks(&input);
            report.warnings.extend(plugins.warnings);
            for warning in &report.warnings {
                let _ = self.event_sender.send(AgentEvent::Warning {
                    code: Some("hook_load_warning".to_string()),
                    message: warning.clone(),
                });
            }
            if !report.errors.is_empty() {
                return Err(report
                    .errors
                    .iter()
                    .map(|error| format!("{}: {}", error.path.display(), error.message))
                    .collect::<Vec<_>>()
                    .join("; "));
            }
            let hooks = report.executable_hooks();
            let snapshots = hooks.iter().map(|hook| hook.snapshot.clone()).collect();
            let reporter = CommandHookReporter::new(hooks, self.emitter.clone()).with_mcp_executor(
                Arc::new(AgentMcpHookExecutor {
                    state: self.state.clone(),
                    session_id: self.session_id.clone(),
                    thread_id: self.thread_id.clone(),
                }),
            );
            let reporter = match self.pending_input.clone() {
                Some(pending_input) => {
                    reporter.with_async_result_sink(Arc::new(AgentAsyncHookResultSink {
                        pending_input,
                        cancel_token: self.cancel_token.clone(),
                        event_sender: self.event_sender.clone(),
                    }))
                }
                None => reporter,
            };
            Ok(RuntimeHookStepSnapshot {
                hooks: snapshots,
                reporter: Arc::new(reporter),
                step_context,
            })
        })
    }
}

struct AgentMcpHookExecutor {
    state: AgentRuntimeState,
    session_id: String,
    thread_id: String,
}

impl McpHookExecutor for AgentMcpHookExecutor {
    fn execute<'a>(
        &'a self,
        server: &'a str,
        tool: &'a str,
        input: serde_json::Value,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<McpHookOutput, String>> + Send + 'a>,
    > {
        Box::pin(async move {
            let result = self
                .state
                .call_mcp_tool(&self.session_id, &self.thread_id, server, tool, input)
                .await?;
            let stdout = result
                .structured_content
                .map(|value| value.to_string())
                .or_else(|| {
                    let text = result
                        .content
                        .iter()
                        .filter_map(|content| match content {
                            lime_mcp::McpContent::Text { text } => Some(text.as_str()),
                            _ => None,
                        })
                        .collect::<Vec<_>>()
                        .join("\n");
                    (!text.is_empty()).then_some(text)
                })
                .unwrap_or_else(|| "{}".to_string());
            Ok(McpHookOutput {
                stdout,
                is_error: result.is_error,
            })
        })
    }
}

struct AgentAsyncHookResultSink {
    pending_input: RuntimeSessionInputHandle,
    cancel_token: Option<CancellationToken>,
    event_sender: mpsc::UnboundedSender<AgentEvent>,
}

impl AsyncHookResultSink for AgentAsyncHookResultSink {
    fn submit(&self, run: agent_protocol::hook::HookRunSummary) {
        if self
            .cancel_token
            .as_ref()
            .is_some_and(CancellationToken::is_cancelled)
        {
            return;
        }
        let contexts = run
            .entries
            .iter()
            .filter(|entry| entry.kind == agent_protocol::hook::HookOutputEntryKind::Context)
            .map(|entry| entry.text.trim())
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>();
        for entry in run
            .entries
            .iter()
            .filter(|entry| entry.kind != agent_protocol::hook::HookOutputEntryKind::Context)
        {
            let _ = self.event_sender.send(AgentEvent::Warning {
                code: Some("async_hook_result".to_string()),
                message: entry.text.clone(),
            });
        }
        if contexts.is_empty() {
            return;
        }
        let text = format!(
            "<hook_additional_context>\n{}\n</hook_additional_context>",
            contexts.join("\n")
        );
        let pending_input = self.pending_input.clone();
        let cancel_token = self.cancel_token.clone();
        tokio::spawn(async move {
            if cancel_token
                .as_ref()
                .is_some_and(CancellationToken::is_cancelled)
            {
                return;
            }
            let _ = pending_input.inject_developer_input(text).await;
        });
    }
}

struct AgentHookLifecycleEmitter {
    event_sender: mpsc::UnboundedSender<AgentEvent>,
}

impl HookLifecycleEmitter for AgentHookLifecycleEmitter {
    fn emit(&self, event: HookLifecycleEvent) {
        let event = match event.phase {
            HookLifecyclePhase::Started => AgentEvent::HookStarted {
                turn_id: event.turn_id,
                run: event.run,
            },
            HookLifecyclePhase::Completed => AgentEvent::HookCompleted {
                turn_id: event.turn_id,
                run: event.run,
            },
        };
        let _ = self.event_sender.send(event);
    }
}
