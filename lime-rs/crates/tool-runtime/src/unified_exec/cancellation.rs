use super::lifecycle::{observe_output, publish_snapshot};
use super::session::{
    remove_session, session_facts, sessions_for_thread, sessions_for_turn, UnifiedExecSession,
};
use crate::execution_process::live::RuntimeLiveExecutionGateway;
use crate::tool_executor::RuntimeToolExecutionError;
use std::sync::Arc;

/// Close the original Command even when a forced task abort dropped its polling future.
pub async fn cancel_turn(
    gateway: &dyn RuntimeLiveExecutionGateway,
    thread_id: &str,
    turn_id: &str,
) -> Result<(), RuntimeToolExecutionError> {
    terminate_processes(gateway, sessions_for_turn(thread_id, turn_id).await).await
}

/// Session shutdown owns every Command in the Thread, including completed Turns.
pub async fn terminate_all_processes(
    gateway: &dyn RuntimeLiveExecutionGateway,
    thread_id: &str,
) -> Result<(), RuntimeToolExecutionError> {
    terminate_processes(gateway, sessions_for_thread(thread_id).await).await
}

async fn terminate_processes(
    gateway: &dyn RuntimeLiveExecutionGateway,
    sessions: Vec<(i32, Arc<tokio::sync::Mutex<UnifiedExecSession>>)>,
) -> Result<(), RuntimeToolExecutionError> {
    let mut first_error = None;
    for (id, session) in sessions {
        let facts = session_facts(&session).await;
        let _interaction = facts.interaction_lock.lock().await;
        if session.lock().await.completed {
            remove_session(id);
            continue;
        }
        let result = async {
            if !gateway.status(&facts.process_id)?.status.is_terminal() {
                gateway.terminate(&facts.process_id)?;
            }
            let snapshot = gateway.wait_for_exit(&facts.process_id).await?;
            observe_output(gateway, &session, &snapshot).await?;
            publish_snapshot(id, &session, snapshot).await?;
            remove_session(id);
            Ok::<_, RuntimeToolExecutionError>(())
        }
        .await;
        if let Err(error) = result {
            first_error.get_or_insert(error);
        }
    }
    first_error.map_or(Ok(()), Err)
}
