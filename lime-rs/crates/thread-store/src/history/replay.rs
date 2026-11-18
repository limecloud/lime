use super::{ThreadHistoryBuilder, ThreadHistoryBuilderError};
use agent_protocol::ThreadHistoryChangeSet;

impl ThreadHistoryBuilder {
    /// Reduces one durable increment while consuming the previous snapshot.
    ///
    /// Cold replay discards the entire builder on failure, so it does not need
    /// the full checkpoint required by the mutable, transactional API. Taking
    /// ownership prevents callers from observing any partially applied state.
    pub fn replay_change_set(
        mut self,
        changes: ThreadHistoryChangeSet,
    ) -> Result<Self, ThreadHistoryBuilderError> {
        self.apply_change_set_inner(changes)?;
        Ok(self)
    }
}
