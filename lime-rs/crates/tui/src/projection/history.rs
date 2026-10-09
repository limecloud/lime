//! Canonical history replay and provisional recovery for the trailing reasoning snapshot.

use super::items::{project_item_with_scope, WebSearchLifecycle};
use super::{ActivityDetail, ConversationProjection, EntryKind};
use crate::history_filter::{hidden_user_message_ids, user_message_id};
use app_server_protocol::protocol::v2::{
    ServerNotification, Thread, ThreadItem, Turn, TurnItemsView, TurnStatus,
};

#[derive(Debug, Clone)]
pub(super) struct ResumedReasoning {
    turn_id: String,
    item_id: Option<String>,
}

impl ConversationProjection {
    /// A transport recovery note must not discard the restored canonical activity summary.
    pub(crate) fn on_reconnected(&mut self) {
        self.status = "reconnected".to_string();
    }

    pub(crate) fn hydrate_thread(&mut self, thread: Thread) {
        self.token_usage.reset_for_thread(&thread);
        self.last_plan_progress = None;
        self.entries.clear();
        self.completion_boundaries.clear();
        self.active_turn_id = None;
        self.closed_turn_ids.clear();
        self.status = "ready".to_string();
        self.reasoning_status = None;
        self.resumed_reasoning = None;
        self.review_mode = false;
        self.active_hooks.clear();
        self.assistant_phases.clear();

        let hidden_user_messages = hidden_user_message_ids(&thread.turns);
        for turn in &thread.turns {
            let final_entry_id = (turn.status == TurnStatus::Completed)
                .then(|| turn.items.last())
                .flatten()
                .and_then(|item| {
                    project_item_with_scope(
                        item,
                        false,
                        WebSearchLifecycle::Historical,
                        Some(&turn.id),
                        self.show_raw_agent_reasoning,
                    )
                    .map(|entry| entry.id)
                });
            for item in &turn.items {
                self.update_review_mode(item);
                self.record_assistant_phase(item);
                if user_message_id(item).is_some_and(|id| hidden_user_messages.contains(id)) {
                    continue;
                }
                if let Some(entry) = project_item_with_scope(
                    item,
                    false,
                    WebSearchLifecycle::Historical,
                    Some(&turn.id),
                    self.show_raw_agent_reasoning,
                ) {
                    self.replace_entry(entry);
                }
            }
            if let Some(entry_id) =
                final_entry_id.filter(|id| self.entries.iter().any(|current| current.id == *id))
            {
                self.add_completion_boundary(
                    entry_id,
                    turn.duration_ms
                        .and_then(|duration| u64::try_from(duration).ok())
                        .map(|duration| duration / 1_000),
                );
            }
        }
        self.restore_history_turns(&thread.turns);
    }

    pub(crate) fn restore_history_turns(&mut self, turns: &[Turn]) {
        for turn in turns {
            if turn.status != TurnStatus::InProgress {
                self.closed_turn_ids.insert(turn.id.clone());
                if self.active_turn_id.as_deref() == Some(&turn.id) {
                    self.finish_resumed_reasoning();
                    self.active_turn_id = None;
                    self.reasoning_status = None;
                    self.status = super::turn_status(turn.status).to_string();
                }
            }
        }
        if let Some(latest) = turns.last() {
            self.token_usage.restore_history_turn_id(&latest.id);
            if latest.status == TurnStatus::InProgress {
                if self.active_turn_id.is_none() && !self.closed_turn_ids.contains(&latest.id) {
                    self.active_turn_id = Some(latest.id.clone());
                    self.status = "running".to_string();
                    self.resumed_reasoning = Some(ResumedReasoning {
                        turn_id: latest.id.clone(),
                        item_id: None,
                    });
                    // Only the full snapshot tail may still be active. Earlier reasoning has
                    // already been followed by another item and must stay settled.
                    if let (TurnItemsView::Full, Some(item @ ThreadItem::Reasoning { .. })) =
                        (latest.items_view, latest.items.last())
                    {
                        self.restore_active_reasoning_item(&latest.id, item);
                    }
                }
            } else if matches!(self.status.as_str(), "" | "ready") {
                self.status = super::turn_status(latest.status).to_string();
            }
        }
    }

    fn restore_active_reasoning_item(&mut self, turn_id: &str, item: &ThreadItem) {
        let Some(entry) = project_item_with_scope(
            item,
            true,
            WebSearchLifecycle::Historical,
            Some(turn_id),
            self.show_raw_agent_reasoning,
        ) else {
            return;
        };
        if let Some(resumed) = &mut self.resumed_reasoning {
            resumed.item_id = Some(entry.id.clone());
        }
        self.remember_reasoning_status(turn_id, &entry);
        self.replace_entry(entry);
    }

    /// A resume may omit item/started. Consume the recovery intent on the first live update,
    /// retaining the restored indexed parts when that update belongs to the snapshot tail.
    pub(super) fn recover_resumed_reasoning(&mut self, notification: &ServerNotification) -> bool {
        let Some(resumed) = &self.resumed_reasoning else {
            return true;
        };
        let (turn_id, item_id) = match notification {
            ServerNotification::ReasoningSummaryTextDelta(delta) => {
                (&delta.turn_id, &delta.item_id)
            }
            ServerNotification::ReasoningTextDelta(delta) => (&delta.turn_id, &delta.item_id),
            ServerNotification::ReasoningSummaryPartAdded(part) => (&part.turn_id, &part.item_id),
            ServerNotification::ItemCompleted(completed) => {
                let ThreadItem::Reasoning { id, .. } = &completed.item else {
                    return true;
                };
                (&completed.turn_id, id)
            }
            ServerNotification::ItemStarted(started)
                if started.turn_id == resumed.turn_id
                    && !matches!(started.item, ThreadItem::UserMessage { .. }) =>
            {
                if let ThreadItem::Reasoning { id, .. } = &started.item {
                    if resumed.item_id.as_ref() == Some(id) {
                        // Codex preserves the recovered buffer on a repeated start for this id.
                        self.resumed_reasoning = None;
                        return false;
                    }
                }
                self.finish_resumed_reasoning();
                return true;
            }
            _ => return true,
        };
        if turn_id != &resumed.turn_id {
            return false;
        }
        if resumed.item_id.as_ref() != Some(item_id) {
            // Do not reopen an earlier completed snapshot when a buffered delta arrives late.
            if self.entries.iter().any(|entry| entry.id == *item_id) {
                return false;
            }
            self.finish_resumed_reasoning();
        } else {
            self.resumed_reasoning = None;
        }
        true
    }

    pub(super) fn finish_resumed_reasoning(&mut self) {
        let Some(resumed) = self.resumed_reasoning.take() else {
            return;
        };
        if let Some(entry) = self.entries.iter_mut().find(|entry| {
            resumed.item_id.as_ref() == Some(&entry.id)
                && entry.kind == EntryKind::Reasoning
                && matches!(&entry.activity_detail, Some(ActivityDetail::Reasoning { scope, .. })
                    if scope == &resumed.turn_id)
        }) {
            entry.streaming = false;
        }
        self.reasoning_status = None;
    }
}

#[cfg(test)]
#[path = "history_tests.rs"]
mod tests;
