use super::{is_queued_turn, store_error, RuntimeCore, RuntimeCoreError};
use agent_protocol::{Thread, ThreadId, ThreadTurnsView, Turn, TurnItemsView, TurnStatus};
use thread_store::ReadThreadParams;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(super) struct ThreadExecutionState {
    pub loaded: bool,
    pub active_turn_id: Option<String>,
    pub pending_turn_ids: Vec<String>,
}

pub(super) fn normalize_thread_runtime_snapshot(
    thread: &mut Thread,
    execution: &ThreadExecutionState,
) {
    normalize_turn_runtime_snapshots(&mut thread.turns, execution);

    let terminal_projection_pending = thread
        .turns
        .iter()
        .any(|turn| turn.status == TurnStatus::InProgress && !is_queued_turn(turn));
    thread.status = if execution.active_turn_id.is_some() || terminal_projection_pending {
        let active_flags = match &thread.status {
            agent_protocol::ThreadStatus::Active { active_flags } => active_flags.clone(),
            _ => Vec::new(),
        };
        agent_protocol::ThreadStatus::Active { active_flags }
    } else if matches!(thread.status, agent_protocol::ThreadStatus::SystemError) {
        agent_protocol::ThreadStatus::SystemError
    } else if execution.loaded {
        agent_protocol::ThreadStatus::Idle
    } else {
        agent_protocol::ThreadStatus::NotLoaded
    };
}

pub(super) fn normalize_turn_runtime_snapshots(
    turns: &mut [Turn],
    execution: &ThreadExecutionState,
) {
    for turn in turns {
        if turn_is_orphaned(turn, execution) {
            turn.status = TurnStatus::Interrupted;
        }
    }
}

fn turn_is_orphaned(turn: &Turn, execution: &ThreadExecutionState) -> bool {
    turn.status == TurnStatus::InProgress
        && !is_queued_turn(turn)
        && execution.active_turn_id.as_deref() != Some(turn.turn_id.as_str())
        && !execution
            .pending_turn_ids
            .iter()
            .any(|id| id == turn.turn_id.as_str())
}

impl RuntimeCore {
    pub(super) async fn thread_execution_state(
        &self,
        thread_id: &str,
    ) -> Result<ThreadExecutionState, RuntimeCoreError> {
        let session_id = self.loaded_session_id_for_thread(thread_id);
        let Some(session_id) = session_id else {
            return Ok(ThreadExecutionState::default());
        };
        let snapshot = self
            .session_loops
            .snapshot(session_id.as_str())
            .await
            .map_err(|error| {
                RuntimeCoreError::Backend(format!(
                    "read runtime session snapshot for thread state: {error}"
                ))
            })?;
        Ok(ThreadExecutionState {
            loaded: true,
            active_turn_id: snapshot.and_then(|snapshot| snapshot.active_turn_id),
            pending_turn_ids: self.turn_driver_completions.pending_turn_ids(&session_id),
        })
    }

    pub(super) async fn refresh_terminal_turns(
        &self,
        thread_id: &ThreadId,
        turns: &mut [Turn],
        execution: &ThreadExecutionState,
    ) -> Result<(), RuntimeCoreError> {
        let mut orphaned = turns
            .iter()
            .filter(|turn| turn_is_orphaned(turn, execution));
        let Some(first) = orphaned.next() else {
            return Ok(());
        };
        let needs_items = first.items_view == TurnItemsView::Full
            || orphaned.any(|turn| turn.items_view == TurnItemsView::Full);

        // History was read before the actor/driver snapshot. A turn may have
        // completed while that snapshot was pending; absence of a live owner
        // must not turn an older InProgress snapshot into a fabricated interrupt.
        let current = self
            .canonical_thread_store()?
            .read_thread(ReadThreadParams {
                thread_id: thread_id.clone(),
                include_archived: true,
                turns_view: if needs_items {
                    ThreadTurnsView::Full
                } else {
                    ThreadTurnsView::Summary
                },
            })
            .await
            .map_err(store_error)?
            .ok_or_else(|| RuntimeCoreError::Backend(format!("thread not found: {thread_id}")))?;
        for turn in turns
            .iter_mut()
            .filter(|turn| turn_is_orphaned(turn, execution))
        {
            let Some(latest) = current
                .turns
                .iter()
                .find(|latest| latest.turn_id == turn.turn_id && latest.is_terminal())
            else {
                continue;
            };
            let items_view = turn.items_view;
            *turn = latest.clone();
            turn.items_view = items_view;
            if items_view != TurnItemsView::Full {
                turn.items.clear();
            }
        }
        Ok(())
    }
}
