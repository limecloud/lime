use crate::conversation::message::{ActionRequiredScope, Message};
use std::collections::VecDeque;
use std::sync::Arc;
use tokio::sync::Mutex;

struct QueuedUserMessage {
    scope: ActionRequiredScope,
    message: Message,
}

pub struct UserMessageManager {
    queued_messages: Arc<Mutex<VecDeque<QueuedUserMessage>>>,
}

impl UserMessageManager {
    fn new() -> Self {
        Self {
            queued_messages: Arc::new(Mutex::new(VecDeque::new())),
        }
    }

    pub fn global() -> &'static Self {
        static INSTANCE: once_cell::sync::Lazy<UserMessageManager> =
            once_cell::sync::Lazy::new(UserMessageManager::new);
        &INSTANCE
    }

    pub async fn enqueue_scoped(&self, scope: ActionRequiredScope, message: Message) {
        self.queued_messages
            .lock()
            .await
            .push_back(QueuedUserMessage { scope, message });
    }

    pub async fn drain_messages_for_scope(&self, scope: &ActionRequiredScope) -> Vec<Message> {
        let mut queue = self.queued_messages.lock().await;
        let mut drained = Vec::new();
        let mut remaining = VecDeque::new();

        while let Some(entry) = queue.pop_front() {
            if Self::scope_matches(&entry.scope, scope) {
                drained.push(entry.message);
            } else {
                remaining.push_back(entry);
            }
        }

        *queue = remaining;
        drained
    }

    fn scope_matches(
        message_scope: &ActionRequiredScope,
        runtime_scope: &ActionRequiredScope,
    ) -> bool {
        if Self::scope_is_empty(message_scope) {
            return true;
        }

        Self::field_matches(&message_scope.session_id, &runtime_scope.session_id)
            && Self::field_matches(&message_scope.thread_id, &runtime_scope.thread_id)
            && Self::field_matches(&message_scope.turn_id, &runtime_scope.turn_id)
    }

    fn field_matches(expected: &Option<String>, actual: &Option<String>) -> bool {
        match expected {
            Some(expected) => actual.as_ref() == Some(expected),
            None => true,
        }
    }

    fn scope_is_empty(scope: &ActionRequiredScope) -> bool {
        scope.session_id.is_none() && scope.thread_id.is_none() && scope.turn_id.is_none()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope(session_id: &str, thread_id: &str, turn_id: &str) -> ActionRequiredScope {
        ActionRequiredScope {
            session_id: Some(session_id.to_string()),
            thread_id: Some(thread_id.to_string()),
            turn_id: Some(turn_id.to_string()),
        }
    }

    #[tokio::test]
    async fn drain_messages_only_returns_matching_scope() {
        let manager = UserMessageManager::new();
        let matching_scope = scope("session-a", "thread-a", "turn-a");
        let other_scope = scope("session-b", "thread-b", "turn-b");

        manager
            .enqueue_scoped(
                matching_scope.clone(),
                Message::assistant().with_text("match").user_only(),
            )
            .await;
        manager
            .enqueue_scoped(
                other_scope.clone(),
                Message::assistant().with_text("other").user_only(),
            )
            .await;

        let drained = manager.drain_messages_for_scope(&matching_scope).await;
        assert_eq!(drained.len(), 1);
        assert_eq!(drained[0].as_concat_text(), "match");

        let remaining = manager.drain_messages_for_scope(&other_scope).await;
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].as_concat_text(), "other");
    }
}
