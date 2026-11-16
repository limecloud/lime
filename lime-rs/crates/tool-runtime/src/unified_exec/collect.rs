use super::lifecycle::{observe_output, publish_snapshot};
use super::output::{UnifiedExecCallOutput, UnifiedExecObservationKind, append_observed_output};
use super::session::{UnifiedExecSession, remove_session, session_facts};
use super::{OUTPUT_DRAIN_LIMIT, OUTPUT_DRAIN_MAX_BYTES, PROCESS_POLL_INTERVAL};
use crate::execution_process::live::{LiveExecutionOutputQuery, RuntimeLiveExecutionGateway};
use crate::execution_process::{BoundedProcessOutput, ExecutionProcessStatus};
use crate::tool_executor::{RuntimeToolExecutionError, RuntimeToolPolicyErrorKind};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio_util::sync::CancellationToken;

pub(super) async fn collect_process_output(
    gateway: Arc<dyn RuntimeLiveExecutionGateway>,
    session_id: i32,
    session: Arc<tokio::sync::Mutex<UnifiedExecSession>>,
    yield_time: Duration,
    max_output_tokens: usize,
    cancel_token: Option<CancellationToken>,
) -> Result<UnifiedExecCallOutput, RuntimeToolExecutionError> {
    let started_at = Instant::now();
    let deadline = started_at + yield_time;
    let mut output = BoundedProcessOutput::default();

    loop {
        let (process_id, after_sequence) = {
            let session = session.lock().await;
            (session.process_id.clone(), session.after_sequence)
        };
        let drained = gateway.drain_output(LiveExecutionOutputQuery {
            process_id: Some(process_id.clone()),
            after_sequence,
            limit: Some(OUTPUT_DRAIN_LIMIT),
            max_bytes: Some(OUTPUT_DRAIN_MAX_BYTES),
        })?;
        for delta in &drained.deltas {
            append_observed_output(&mut output, delta);
        }
        if let Some(next_sequence) = drained.next_sequence {
            session.lock().await.after_sequence = Some(next_sequence);
        }

        let cancelled = cancel_token
            .as_ref()
            .is_some_and(CancellationToken::is_cancelled);
        if cancelled {
            let _ = gateway.terminate(&process_id);
        }

        let snapshot = gateway.status(&process_id)?;
        observe_output(gateway.as_ref(), &session, &snapshot).await?;
        if process_status_is_terminal(snapshot.status) {
            let snapshot = gateway.wait_for_exit(&process_id).await?;
            let final_drain = gateway.drain_output(LiveExecutionOutputQuery {
                process_id: Some(snapshot.process_id.clone()),
                after_sequence: session.lock().await.after_sequence,
                limit: Some(OUTPUT_DRAIN_LIMIT),
                max_bytes: Some(OUTPUT_DRAIN_MAX_BYTES),
            })?;
            for delta in &final_drain.deltas {
                append_observed_output(&mut output, delta);
            }
            observe_output(gateway.as_ref(), &session, &snapshot).await?;
            publish_snapshot(session_id, &session, snapshot.clone()).await?;
            let facts = session_facts(&session).await;
            remove_session(session_id);
            if cancelled {
                return Err(RuntimeToolExecutionError::new(
                    "Tool execution cancelled",
                    Some(RuntimeToolPolicyErrorKind::Canceled(
                        "unified_exec_cancelled".to_string(),
                    )),
                ));
            }
            if snapshot.status == ExecutionProcessStatus::Failed {
                let message = snapshot
                    .failure
                    .clone()
                    .unwrap_or_else(|| "execution process failed".to_string());
                return Err(RuntimeToolExecutionError::new(
                    message,
                    Some(RuntimeToolPolicyErrorKind::ExecutionFailed(
                        "execution_process_failed".to_string(),
                    )),
                ));
            }
            let exit_code = snapshot.exit_code;
            return Ok(UnifiedExecCallOutput {
                session_id: None,
                call_id: facts.call_id,
                invocation: facts.invocation,
                output: output.snapshot().text,
                process: snapshot,
                exit_code,
                observation: UnifiedExecObservationKind::Terminal,
                empty_poll_count: 0,
                wall_time: started_at.elapsed(),
                max_output_tokens,
            });
        }

        if Instant::now() >= deadline {
            publish_snapshot(session_id, &session, snapshot.clone()).await?;
            let mut facts = session.lock().await;
            let observation = if output.is_empty() {
                facts.empty_poll_count = facts.empty_poll_count.saturating_add(1);
                UnifiedExecObservationKind::Waiting
            } else {
                facts.empty_poll_count = 0;
                UnifiedExecObservationKind::Output
            };
            return Ok(UnifiedExecCallOutput {
                session_id: Some(session_id),
                call_id: facts.call_id.clone(),
                invocation: facts.invocation.clone(),
                output: output.snapshot().text,
                process: snapshot,
                exit_code: None,
                observation,
                empty_poll_count: facts.empty_poll_count,
                wall_time: started_at.elapsed(),
                max_output_tokens,
            });
        }
        tokio::time::sleep(PROCESS_POLL_INTERVAL).await;
    }
}

fn process_status_is_terminal(status: ExecutionProcessStatus) -> bool {
    matches!(
        status,
        ExecutionProcessStatus::Exited
            | ExecutionProcessStatus::Interrupted
            | ExecutionProcessStatus::Terminated
            | ExecutionProcessStatus::Failed
    )
}
