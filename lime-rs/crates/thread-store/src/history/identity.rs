use super::ThreadHistoryBuilder;
use agent_protocol::{SessionId, ThreadHistoryChangeSet, ThreadId};

impl ThreadHistoryBuilder {
    pub(super) fn adopt_change_identity(&mut self, changes: &ThreadHistoryChangeSet) {
        if let Some(turn) = changes.changed_turns.first() {
            self.adopt_identity(&turn.session_id, &turn.thread_id);
        } else if let Some(item) = changes.changed_items.first() {
            self.adopt_identity(&item.session_id, &item.thread_id);
        }
    }

    pub(super) fn adopt_identity(&mut self, session_id: &SessionId, thread_id: &ThreadId) {
        if self.session_id.is_none() {
            self.session_id = Some(session_id.clone());
        }
        if self.thread_id.is_none() {
            self.thread_id = Some(thread_id.clone());
        }
    }
}
