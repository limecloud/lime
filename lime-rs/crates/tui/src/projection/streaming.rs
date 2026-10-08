//! Provisional transcript deltas are settled by canonical item and Turn facts.

use super::{
    ActivityDetail, ConversationProjection, EntryKind, EntryStatus, ReasoningSummary,
    TranscriptEntry,
};

impl ConversationProjection {
    pub(super) fn append_delta(
        &mut self,
        turn_id: String,
        id: String,
        kind: EntryKind,
        delta: String,
    ) {
        if self.closed_turn_ids.contains(&turn_id) {
            return;
        }
        if let Some(entry) = self.entries.iter_mut().find(|entry| entry.id == id) {
            // Once an item has been replaced by its canonical completion (or a terminal turn
            // settled the provisional stream), late transport deltas must not reopen it. Codex
            // flushes the active stream before accepting terminal history for the same reason.
            if !entry.streaming || entry.kind != kind {
                return;
            }
            entry.text.push_str(&delta);
            entry.streaming = true;
            return;
        }
        let entry = TranscriptEntry {
            id,
            kind,
            text: delta,
            streaming: true,
            status: (kind == EntryKind::Command || kind == EntryKind::Plan)
                .then_some(EntryStatus::Running),
            summary: Vec::new(),
            activity_group: None,
            activity_detail: None,
        };
        self.entries.push(entry);
    }

    /// Update a structured summary part without flattening away placeholder boundaries.
    ///
    /// The following item completion remains authoritative and replaces this provisional entry
    /// with the canonical summary. A completed historical reasoning item is therefore left
    /// untouched when a late notification arrives after reconnect.
    pub(super) fn append_reasoning_summary(
        &mut self,
        turn_id: String,
        id: String,
        index: i64,
        delta: String,
    ) {
        if index < 0 || self.closed_turn_ids.contains(&turn_id) {
            return;
        }
        let position = if let Some(position) = self.entries.iter().position(|entry| entry.id == id)
        {
            position
        } else {
            self.entries.push(TranscriptEntry {
                id,
                kind: EntryKind::Reasoning,
                text: String::new(),
                streaming: true,
                status: None,
                summary: Vec::new(),
                activity_group: None,
                activity_detail: Some(ActivityDetail::Reasoning {
                    scope: turn_id.clone(),
                    summary: ReasoningSummary::default(),
                }),
            });
            self.entries.len() - 1
        };
        let entry = &mut self.entries[position];
        if entry.kind != EntryKind::Reasoning || !entry.streaming {
            return;
        }
        let Some(ActivityDetail::Reasoning { scope, summary }) = entry.activity_detail.as_mut()
        else {
            return;
        };
        if scope != &turn_id {
            return;
        }
        summary.append(index, &delta);
        entry.text = summary.content();
        if self.active_turn_id.as_deref() == Some(turn_id.as_str()) {
            if let Some(status) = summary.latest_status() {
                self.reasoning_status = Some(status);
            }
        }
    }

    pub(super) fn remember_reasoning_status(&mut self, turn_id: &str, entry: &TranscriptEntry) {
        if self.active_turn_id.as_deref() != Some(turn_id) || entry.kind != EntryKind::Reasoning {
            return;
        }
        if let Some(ActivityDetail::Reasoning { summary, .. }) = &entry.activity_detail {
            if let Some(status) = summary.latest_status() {
                self.reasoning_status = Some(status);
            }
        }
    }
}

#[cfg(test)]
#[path = "streaming_tests.rs"]
mod tests;
