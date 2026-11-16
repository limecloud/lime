use super::output::{
    UnifiedExecCallOutput, UnifiedExecObservationKind, emit_output_deltas, project_output,
};
use super::session::{UnifiedExecSession, session_facts};
use super::{
    EXEC_COMMAND_TOOL_NAME, OUTPUT_DRAIN_LIMIT, OUTPUT_DRAIN_MAX_BYTES, unified_exec_error,
};
use crate::execution_process::{
    ExecutionProcessSnapshot, ExecutionProcessStatus,
    live::{LiveExecutionOutputQuery, RuntimeLiveExecutionGateway},
};
use crate::tool_executor::{RuntimeToolExecutionError, RuntimeToolExecutionOutcome};
use crate::tool_lifecycle::{ToolLifecycleEvent, ToolLifecyclePhase};
use crate::tool_result_projection::NormalizedToolOutput;
use serde_json::json;

pub(super) async fn observe_output(
    gateway: &dyn RuntimeLiveExecutionGateway,
    session: &tokio::sync::Mutex<UnifiedExecSession>,
    snapshot: &ExecutionProcessSnapshot,
) -> Result<(), RuntimeToolExecutionError> {
    loop {
        let facts = session_facts(session).await;
        let batch = gateway.drain_output(LiveExecutionOutputQuery {
            process_id: Some(facts.process_id.clone()),
            after_sequence: facts.streaming_sequence,
            limit: Some(OUTPUT_DRAIN_LIMIT),
            max_bytes: Some(OUTPUT_DRAIN_MAX_BYTES),
        })?;
        let advanced = batch.next_sequence != facts.streaming_sequence;
        session.lock().await.streaming_sequence = batch.next_sequence;
        emit_output_deltas(
            facts.output_sink.as_ref(),
            &facts.turn_id,
            &facts.call_id,
            &facts.invocation,
            &batch.deltas,
            snapshot.status,
        )
        .await;
        if let Some(error) = facts
            .output_sink
            .as_ref()
            .and_then(|sink| sink.command_error())
        {
            return Err(unified_exec_error(error));
        }
        if !advanced || batch.deltas.is_empty() {
            break;
        }
    }
    Ok(())
}

pub(super) async fn publish_snapshot(
    session_id: i32,
    session: &tokio::sync::Mutex<UnifiedExecSession>,
    snapshot: ExecutionProcessSnapshot,
) -> Result<(), RuntimeToolExecutionError> {
    let facts = session_facts(session).await;
    if facts.completed {
        return Ok(());
    }
    let terminal = snapshot.status.is_terminal();
    let Some(sink) = facts.output_sink.as_ref() else {
        session.lock().await.completed = terminal;
        return Ok(());
    };
    let duration = facts.started_at.elapsed();
    let mut result = project_output(UnifiedExecCallOutput {
        session_id: (!terminal).then_some(session_id),
        call_id: facts.call_id.clone(),
        invocation: facts.invocation,
        output: snapshot.retained_output.clone(),
        exit_code: snapshot.exit_code,
        process: snapshot.clone(),
        observation: if terminal {
            UnifiedExecObservationKind::Terminal
        } else {
            UnifiedExecObservationKind::Output
        },
        empty_poll_count: 0,
        wall_time: duration,
        max_output_tokens: super::MAX_OUTPUT_TOKENS,
    });
    // Canonical output retains the supervisor's bounded transcript, independently of model output limits.
    result.metadata.insert(
        "command_output".to_string(),
        json!(snapshot.retained_output),
    );
    if terminal {
        result.success =
            snapshot.status == ExecutionProcessStatus::Exited && snapshot.exit_code == Some(0);
        if matches!(
            snapshot.status,
            ExecutionProcessStatus::Interrupted | ExecutionProcessStatus::Terminated
        ) {
            result.metadata.insert(
                crate::tool_result_projection::TOOL_OUTCOME_METADATA_KEY.to_string(),
                json!(crate::tool_result_projection::TOOL_OUTCOME_ABORTED),
            );
        }
    }
    sink.emit_command_result(ToolLifecycleEvent {
        turn_id: facts.turn_id,
        call_id: facts.call_id,
        tool_name: EXEC_COMMAND_TOOL_NAME.to_string(),
        arguments: json!({"cmd": result.metadata["command"], "workdir": result.metadata["cwd"]}),
        provider_metadata: serde_json::Value::Null,
        environments: Vec::new(),
        phase: ToolLifecyclePhase::Completed,
        output: Some(NormalizedToolOutput::from_execution_outcome(
            RuntimeToolExecutionOutcome::Result(Box::new(result)),
            duration.as_millis().try_into().unwrap_or(u64::MAX),
        )),
    })
    .await;
    if let Some(error) = sink.command_error() {
        return Err(unified_exec_error(error));
    }
    session.lock().await.completed = terminal;
    Ok(())
}
