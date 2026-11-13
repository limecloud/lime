use crate::execution_orchestrator::RuntimeToolExecutionAttempt;
use crate::execution_process::live::{LiveExecutionRequest, RuntimeLiveExecutionGateway};
use crate::tool_executor::{
    RuntimeToolExecutionError, RuntimeToolExecutionResult, RuntimeToolPolicyErrorKind,
    RuntimeToolTurnContext,
};
use crate::tool_lifecycle::ToolLifecycleEmitter;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

mod async_watcher;
mod cancellation;
mod collect;
mod definitions;
mod invocation;
mod lifecycle;
mod output;
mod session;
mod shell;

pub use cancellation::{cancel_turn, terminate_all_processes};
use collect::collect_process_output;
pub use definitions::{
    exec_command_tool_definition, unified_exec_tool_definitions, write_stdin_tool_definition,
};
use invocation::Invocation;
use output::{project_output, terminal_interaction_summary};
use session::{
    find_session, next_session_id, register_session, remove_session, session_facts,
    UnifiedExecSession,
};
use shell::{build_shell_command, resolve_working_directory};

pub const EXEC_COMMAND_TOOL_NAME: &str = "exec_command";
pub const WRITE_STDIN_TOOL_NAME: &str = "write_stdin";

const DEFAULT_EXEC_YIELD_TIME_MS: u64 = 10_000;
const MIN_EXEC_YIELD_TIME_MS: u64 = 250;
const MAX_EXEC_YIELD_TIME_MS: u64 = 30_000;
const DEFAULT_WRITE_YIELD_TIME_MS: u64 = 250;
const DEFAULT_POLL_YIELD_TIME_MS: u64 = 5_000;
const MAX_POLL_YIELD_TIME_MS: u64 = 300_000;
const DEFAULT_MAX_OUTPUT_TOKENS: usize = 10_000;
const MAX_OUTPUT_TOKENS: usize = 100_000;
const OUTPUT_DRAIN_LIMIT: u16 = 256;
const OUTPUT_DRAIN_MAX_BYTES: u64 = 1024 * 1024;
const PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(25);

#[derive(Clone)]
pub struct RuntimeUnifiedExecToolRequest<'a> {
    pub tool_name: &'a str,
    pub params: &'a Value,
    pub thread_id: &'a str,
    pub environment_id: &'a str,
    pub working_directory: PathBuf,
    pub environment: HashMap<String, String>,
    pub tool_call_id: String,
    pub turn_id: String,
    pub cancel_token: Option<CancellationToken>,
    pub turn_context: Option<&'a RuntimeToolTurnContext>,
    pub attempt: Option<RuntimeToolExecutionAttempt>,
    pub output_sink: Option<Arc<dyn ToolLifecycleEmitter>>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ExecCommandInput {
    cmd: String,
    #[serde(default)]
    workdir: Option<String>,
    #[serde(default)]
    shell: Option<String>,
    #[serde(default = "default_login")]
    login: bool,
    #[serde(default)]
    tty: bool,
    #[serde(default)]
    yield_time_ms: Option<u64>,
    #[serde(default)]
    max_output_tokens: Option<usize>,
    #[serde(default)]
    sandbox_permissions: Option<String>,
    #[serde(default)]
    justification: Option<String>,
    #[serde(default)]
    prefix_rule: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WriteStdinInput {
    session_id: i32,
    #[serde(default)]
    chars: String,
    #[serde(default)]
    yield_time_ms: Option<u64>,
    #[serde(default)]
    max_output_tokens: Option<usize>,
}

pub fn is_unified_exec_tool_name(tool_name: &str) -> bool {
    matches!(
        tool_name.trim(),
        EXEC_COMMAND_TOOL_NAME | WRITE_STDIN_TOOL_NAME
    )
}

pub async fn execute_runtime_unified_exec_tool(
    gateway: Arc<dyn RuntimeLiveExecutionGateway>,
    request: RuntimeUnifiedExecToolRequest<'_>,
) -> Result<RuntimeToolExecutionResult, RuntimeToolExecutionError> {
    match request.tool_name.trim() {
        EXEC_COMMAND_TOOL_NAME => execute_command(gateway, request).await,
        WRITE_STDIN_TOOL_NAME => write_stdin(gateway, request).await,
        name => Err(unified_exec_error(format!(
            "unsupported unified exec tool: {name}"
        ))),
    }
}

async fn execute_command(
    gateway: Arc<dyn RuntimeLiveExecutionGateway>,
    request: RuntimeUnifiedExecToolRequest<'_>,
) -> Result<RuntimeToolExecutionResult, RuntimeToolExecutionError> {
    let input: ExecCommandInput =
        serde_json::from_value(request.params.clone()).map_err(|error| {
            unified_exec_error(format!("exec_command arguments are invalid: {error}"))
        })?;
    validate_exec_approval_fields(&input)?;
    let command = require_non_empty(input.cmd, "cmd")?;
    let cwd = resolve_working_directory(
        &request.working_directory,
        input.workdir.as_deref(),
        request.environment_id,
    )?;
    let call_id = require_non_empty(request.tool_call_id, "tool call id")?;
    let session_id = next_session_id();
    let process_id = format!("unified-exec-{session_id}");
    let shell_command = build_shell_command(&command, input.shell.as_deref(), input.login);
    let session = Arc::new(tokio::sync::Mutex::new(UnifiedExecSession {
        thread_id: request.thread_id.to_string(),
        turn_id: request.turn_id.clone(),
        process_id: process_id.clone(),
        call_id: call_id.clone(),
        invocation: Invocation {
            command: command.clone(),
            argv: shell_command.clone(),
            cwd: cwd.clone(),
            terminal_interactions: Vec::new(),
        },
        after_sequence: None,
        empty_poll_count: 0,
        streaming_sequence: None,
        completed: false,
        started_at: std::time::Instant::now(),
        interaction_lock: Arc::new(tokio::sync::Mutex::new(())),
        output_sink: request.output_sink.clone(),
    }));
    register_session(session_id, Arc::clone(&session))?;

    let start_result = gateway
        .start_process(
            request.thread_id,
            &command,
            LiveExecutionRequest {
                process_id,
                tool_id: call_id,
                tool_name: EXEC_COMMAND_TOOL_NAME.to_string(),
                environment_id: request.environment_id.to_string(),
                command: shell_command,
                working_directory: cwd,
                tty: input.tty,
                approval_policy: request
                    .turn_context
                    .and_then(|context| context.approval_policy.clone()),
                sandbox_policy: request
                    .attempt
                    .as_ref()
                    .and_then(|attempt| {
                        attempt
                            .effective_sandbox_policy()
                            .label()
                            .map(str::to_string)
                    })
                    .or_else(|| {
                        effective_sandbox_policy(
                            input.sandbox_permissions.as_deref(),
                            request.turn_context,
                        )
                    }),
                runtime_metadata: request
                    .turn_context
                    .map(|context| serde_json::to_value(context).unwrap_or(Value::Null)),
                env: request.environment,
                attempt: request.attempt,
            },
        )
        .await;
    if let Err(error) = start_result {
        remove_session(session_id);
        return Err(error);
    }

    if let Some(sink) = request.output_sink.as_ref() {
        let facts = session_facts(&session).await;
        sink.emit_command_start(facts.invocation.start_event(
            &facts.turn_id,
            &facts.call_id,
            &facts.process_id,
        ))
        .await;
    }

    let interaction_lock = Arc::clone(&session.lock().await.interaction_lock);
    let guard = interaction_lock.lock().await;
    let output = collect_process_output(
        gateway.clone(),
        session_id,
        session.clone(),
        clamped_exec_yield_time(input.yield_time_ms),
        clamped_output_tokens(input.max_output_tokens),
        request.cancel_token,
    )
    .await?;
    let running = output.session_id.is_some();
    drop(guard);
    if running {
        async_watcher::spawn_exit_watcher(gateway, session_id, session);
    }
    Ok(project_output(output))
}

async fn write_stdin(
    gateway: Arc<dyn RuntimeLiveExecutionGateway>,
    request: RuntimeUnifiedExecToolRequest<'_>,
) -> Result<RuntimeToolExecutionResult, RuntimeToolExecutionError> {
    let input: WriteStdinInput =
        serde_json::from_value(request.params.clone()).map_err(|error| {
            unified_exec_error(format!("write_stdin arguments are invalid: {error}"))
        })?;
    let session = find_session(input.session_id)?;
    let session_identity = session_facts(&session).await;
    let _interaction = session_identity.interaction_lock.lock().await;
    let process_id = session_identity.process_id.clone();
    {
        let mut session = session.lock().await;
        if session.thread_id != request.thread_id {
            return Err(unified_exec_error(format!(
                "unified exec session {} does not belong to thread {}",
                input.session_id, request.thread_id
            )));
        }
        if !input.chars.is_empty() {
            if session.completed {
                return Err(unified_exec_error("unified exec process already completed"));
            }
            gateway.write_stdin(&session.process_id, input.chars.as_bytes())?;
        }
        session
            .invocation
            .record_interaction(&process_id, terminal_interaction_summary(&input.chars));
    }
    let output = collect_process_output(
        gateway,
        input.session_id,
        session,
        clamped_write_yield_time(input.yield_time_ms, input.chars.is_empty()),
        clamped_output_tokens(input.max_output_tokens),
        request.cancel_token,
    )
    .await?;
    Ok(project_output(output))
}

fn effective_sandbox_policy(
    sandbox_permissions: Option<&str>,
    turn_context: Option<&RuntimeToolTurnContext>,
) -> Option<String> {
    if sandbox_permissions == Some("require_escalated") {
        return Some("danger-full-access".to_string());
    }
    turn_context
        .and_then(|context| context.sandbox_policy.clone())
        .or_else(|| Some("workspace-write".to_string()))
}

fn validate_exec_approval_fields(
    input: &ExecCommandInput,
) -> Result<(), RuntimeToolExecutionError> {
    match input.sandbox_permissions.as_deref() {
        None | Some("use_default") => {
            if input.justification.is_some() || input.prefix_rule.is_some() {
                return Err(unified_exec_error(
                    "justification and prefix_rule require sandbox_permissions=require_escalated",
                ));
            }
        }
        Some("require_escalated") => {
            if input
                .justification
                .as_deref()
                .map(str::trim)
                .unwrap_or_default()
                .is_empty()
            {
                return Err(unified_exec_error(
                    "sandbox_permissions=require_escalated requires justification",
                ));
            }
        }
        Some(value) => {
            return Err(unified_exec_error(format!(
                "unsupported sandbox_permissions value: {value}"
            )));
        }
    }
    Ok(())
}

fn default_login() -> bool {
    true
}

fn clamped_exec_yield_time(value: Option<u64>) -> Duration {
    Duration::from_millis(
        value
            .unwrap_or(DEFAULT_EXEC_YIELD_TIME_MS)
            .clamp(MIN_EXEC_YIELD_TIME_MS, MAX_EXEC_YIELD_TIME_MS),
    )
}

fn clamped_write_yield_time(value: Option<u64>, empty_poll: bool) -> Duration {
    let default = if empty_poll {
        DEFAULT_POLL_YIELD_TIME_MS
    } else {
        DEFAULT_WRITE_YIELD_TIME_MS
    };
    let max = if empty_poll {
        MAX_POLL_YIELD_TIME_MS
    } else {
        MAX_EXEC_YIELD_TIME_MS
    };
    Duration::from_millis(value.unwrap_or(default).clamp(MIN_EXEC_YIELD_TIME_MS, max))
}

fn clamped_output_tokens(value: Option<usize>) -> usize {
    value
        .unwrap_or(DEFAULT_MAX_OUTPUT_TOKENS)
        .clamp(1, MAX_OUTPUT_TOKENS)
}

fn require_non_empty(
    value: impl Into<String>,
    field: &str,
) -> Result<String, RuntimeToolExecutionError> {
    let value = value.into();
    let value = value.trim();
    if value.is_empty() {
        return Err(unified_exec_error(format!(
            "missing required parameter: {field}"
        )));
    }
    Ok(value.to_string())
}

fn unified_exec_error(message: impl Into<String>) -> RuntimeToolExecutionError {
    RuntimeToolExecutionError::new(
        message.into(),
        Some(RuntimeToolPolicyErrorKind::ExecutionFailed(
            "unified_exec".to_string(),
        )),
    )
}

#[cfg(test)]
#[path = "unified_exec/tests.rs"]
mod tests;
