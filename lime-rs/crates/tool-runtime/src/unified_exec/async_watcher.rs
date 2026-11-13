use super::lifecycle::{observe_output, publish_snapshot};
use super::session::{find_session, remove_session, session_facts, UnifiedExecSession};
use super::PROCESS_POLL_INTERVAL;
use crate::execution_process::live::RuntimeLiveExecutionGateway;
use std::sync::Arc;

pub(super) fn spawn_exit_watcher(
    gateway: Arc<dyn RuntimeLiveExecutionGateway>,
    session_id: i32,
    session: Arc<tokio::sync::Mutex<UnifiedExecSession>>,
) {
    tokio::spawn(async move {
        loop {
            let facts = session_facts(&session).await;
            let _interaction = facts.interaction_lock.lock().await;
            if session.lock().await.completed || find_session(session_id).is_err() {
                break;
            }
            let observed = async {
                let snapshot = gateway.status(&facts.process_id)?;
                observe_output(gateway.as_ref(), &session, &snapshot).await?;
                if snapshot.status.is_terminal() {
                    let snapshot = gateway.wait_for_exit(&facts.process_id).await?;
                    observe_output(gateway.as_ref(), &session, &snapshot).await?;
                    publish_snapshot(session_id, &session, snapshot).await?;
                    // Keep the uncollected exit for the next model poll. The
                    // collector or explicit shutdown owns session removal.
                    return Ok::<_, crate::tool_executor::RuntimeToolExecutionError>(true);
                }
                Ok(false)
            }
            .await;
            match observed {
                Ok(true) => break,
                Ok(false) => {}
                Err(error) => {
                    tracing::warn!(
                        process_id = facts.process_id,
                        "background command observation failed: {}",
                        error.message()
                    );
                    let _ = gateway.terminate(&facts.process_id);
                    remove_session(session_id);
                    break;
                }
            }
            drop(_interaction);
            tokio::time::sleep(PROCESS_POLL_INTERVAL).await;
        }
    });
}
