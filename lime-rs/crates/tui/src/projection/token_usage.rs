//! Thread-scoped token facts; the App Server owns accumulation and provider accounting.

use app_server_protocol::protocol::v2::{
    Thread, ThreadTokenUsage, ThreadTokenUsageUpdatedNotification,
};

#[derive(Debug, Default)]
pub(super) struct TokenUsageState {
    thread_id: Option<String>,
    latest_turn_id: Option<String>,
    usage: Option<ThreadTokenUsage>,
}

impl TokenUsageState {
    pub(super) fn reset_for_thread(&mut self, thread: &Thread) {
        *self = Self {
            thread_id: Some(thread.id.clone()),
            latest_turn_id: thread.turns.last().map(|turn| turn.id.clone()),
            usage: None,
        };
    }

    pub(super) fn begin_turn(&mut self, thread_id: &str, turn_id: &str) {
        if self.thread_id.as_deref() != Some(thread_id) {
            self.usage = None;
        }
        self.thread_id = Some(thread_id.to_string());
        self.note_turn_id(turn_id);
    }

    // `turn/start` acknowledgement also establishes the newest Turn before stream delivery.
    pub(super) fn note_turn_id(&mut self, turn_id: &str) {
        self.latest_turn_id = Some(turn_id.to_string());
    }

    pub(super) fn restore_history_turn_id(&mut self, turn_id: &str) {
        if self.latest_turn_id.is_none() {
            self.note_turn_id(turn_id);
        }
    }

    pub(super) fn update(&mut self, notification: ThreadTokenUsageUpdatedNotification) {
        if self
            .thread_id
            .as_deref()
            .is_some_and(|id| id != notification.thread_id)
            || self
                .latest_turn_id
                .as_deref()
                .is_some_and(|id| id != notification.turn_id)
        {
            return;
        }
        self.thread_id = Some(notification.thread_id);
        self.latest_turn_id = Some(notification.turn_id);
        self.usage = Some(notification.token_usage);
    }
}

impl super::ConversationProjection {
    pub(crate) fn token_usage(&self, thread_id: &str) -> Option<&ThreadTokenUsage> {
        (self.token_usage.thread_id.as_deref() == Some(thread_id))
            .then_some(self.token_usage.usage.as_ref())
            .flatten()
    }
}

#[cfg(test)]
#[path = "token_usage_tests.rs"]
mod tests;
