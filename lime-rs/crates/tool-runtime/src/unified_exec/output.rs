use super::EXEC_COMMAND_TOOL_NAME;
use super::invocation::Invocation;
use crate::execution_process::{
    BoundedProcessOutput, ExecutionOutputDelta, ExecutionProcessStatus,
};
use crate::tool_executor::RuntimeToolExecutionResult;
use crate::tool_io::{estimate_tool_io_tokens, format_tool_output_for_model};
use crate::tool_lifecycle::{ToolLifecycleEmitter, ToolOutputDeltaEvent};
use agent_protocol::truncation::TruncationPolicy;
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;
use uuid::Uuid;

#[derive(Debug)]
pub(super) struct UnifiedExecCallOutput {
    pub(super) session_id: Option<i32>,
    pub(super) call_id: String,
    pub(super) invocation: Invocation,
    pub(super) output: String,
    pub(super) process: crate::execution_process::ExecutionProcessSnapshot,
    pub(super) exit_code: Option<i32>,
    pub(super) observation: UnifiedExecObservationKind,
    pub(super) empty_poll_count: u64,
    pub(super) wall_time: Duration,
    pub(super) max_output_tokens: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum UnifiedExecObservationKind {
    Output,
    Waiting,
    Terminal,
}

impl UnifiedExecObservationKind {
    pub(super) fn label(self) -> &'static str {
        match self {
            Self::Output => "output",
            Self::Waiting => "waiting",
            Self::Terminal => "terminal",
        }
    }
}

pub(super) fn terminal_interaction_summary(chars: &str) -> String {
    if chars.is_empty() {
        return "(poll)".to_string();
    }
    if chars == "\u{3}" {
        return "(interrupt)".to_string();
    }
    format!("sent {} chars", chars.chars().count())
}

pub(super) fn append_observed_output(
    output: &mut BoundedProcessOutput,
    delta: &ExecutionOutputDelta,
) {
    if delta.raw_bytes.is_empty() {
        output.push(delta.delta.as_bytes());
    } else {
        output.push(&delta.raw_bytes);
    }
}

pub(super) async fn emit_output_deltas(
    output_sink: Option<&Arc<dyn ToolLifecycleEmitter>>,
    turn_id: &str,
    call_id: &str,
    invocation: &Invocation,
    deltas: &[ExecutionOutputDelta],
    process_status: ExecutionProcessStatus,
) {
    let Some(output_sink) = output_sink else {
        return;
    };
    for delta in deltas {
        if delta.delta.is_empty() {
            continue;
        }
        let mut metadata = delta.metadata();
        metadata.extend(invocation.metadata());
        metadata.insert(
            "executionProcessStatus".to_string(),
            json!(process_status.label()),
        );
        metadata.insert(
            "stdinWritable".to_string(),
            json!(!process_status.is_terminal()),
        );
        metadata.insert(
            "stdin_writable".to_string(),
            json!(!process_status.is_terminal()),
        );
        metadata.insert("executionSurface".to_string(), json!("unified_exec"));
        metadata.insert("execution_surface".to_string(), json!("unified_exec"));
        output_sink
            .emit_output_delta(ToolOutputDeltaEvent {
                turn_id: turn_id.to_string(),
                call_id: call_id.to_string(),
                tool_name: EXEC_COMMAND_TOOL_NAME.to_string(),
                delta: delta.delta.clone(),
                output_kind: Some(delta.kind.label().to_string()),
                metadata,
            })
            .await;
    }
}

pub(super) fn project_output(output: UnifiedExecCallOutput) -> RuntimeToolExecutionResult {
    let original_token_count = estimate_tool_io_tokens(&output.output);
    let visible_output = format_tool_output_for_model(
        &output.output,
        TruncationPolicy::Tokens(output.max_output_tokens),
    );
    let mut structured = json!({
        "chunk_id": Uuid::new_v4().to_string(),
        "wall_time_seconds": output.wall_time.as_secs_f64(),
        "original_token_count": original_token_count,
        "output": visible_output,
        "observation": {
            "kind": output.observation.label(),
            "empty_poll_count": output.empty_poll_count,
            "process_active": output.session_id.is_some(),
        },
    });
    if let Some(session_id) = output.session_id {
        structured["session_id"] = json!(session_id);
    }
    if let Some(exit_code) = output.exit_code {
        structured["exit_code"] = json!(exit_code);
    }
    structured["process_id"] = json!(output.process.process_id.clone());
    structured["process_status"] = json!(output.process.status.label());
    let success = output.exit_code.map(|code| code == 0).unwrap_or(true);
    let memory_usage = crate::memory_usage::usage_from_command(&output.invocation.command)
        .into_iter()
        .map(|mut usage| {
            if let Some(object) = usage.as_object_mut() {
                object.insert("success".to_string(), json!(success));
                object.insert("tool".to_string(), json!(EXEC_COMMAND_TOOL_NAME));
            }
            usage
        })
        .collect::<Vec<_>>();
    let serialized = serde_json::to_string(&structured).unwrap_or_else(|_| "{}".to_string());
    let mut metadata = output.process.metadata();
    metadata.extend(output.invocation.metadata());
    metadata.extend([
        ("exec_command_call_id".to_string(), json!(output.call_id)),
        ("command_lifecycle_owned".to_string(), json!(true)),
        ("session_id".to_string(), json!(output.session_id)),
        ("exit_code".to_string(), json!(output.exit_code)),
        (
            "wall_time_seconds".to_string(),
            json!(output.wall_time.as_secs_f64()),
        ),
        (
            "original_token_count".to_string(),
            json!(original_token_count),
        ),
        ("command_output".to_string(), json!(visible_output)),
        (
            "unified_exec_observation".to_string(),
            json!(output.observation.label()),
        ),
        (
            "unified_exec_empty_poll_count".to_string(),
            json!(output.empty_poll_count),
        ),
        ("execution_surface".to_string(), json!("unified_exec")),
        ("executionSurface".to_string(), json!("unified_exec")),
        ("memoryUsage".to_string(), json!(memory_usage)),
    ]);
    RuntimeToolExecutionResult::new(
        success,
        serialized,
        (!success).then_some(output.output),
        metadata,
    )
    .with_structured_content(structured)
}
