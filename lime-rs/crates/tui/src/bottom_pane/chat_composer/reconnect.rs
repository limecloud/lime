//! Offline composer editing used while the App Server connection is recovering.
//!
//! Enter and Tab retain the materialized draft without submitting. The runtime owns reconnect attempts;
//! this module only provides the Lime-native editing boundary for a composer that is offline.

use crossterm::event::{KeyCode, KeyEvent, KeyEventKind};

use super::ChatComposer;

impl ChatComposer {
    /// Apply a basic editor key while disconnected without submitting or queueing the draft.
    pub(crate) fn handle_restricted_key(&mut self, key: KeyEvent) {
        if !self.draft.input_enabled {
            return;
        }
        self.cancel_history_search();
        // A disconnected composer keeps the draft editable, but it must not retain a stale
        // history-recall marker across the reconnect boundary.
        self.reset_history_navigation();

        // Accepted keys must precede the offline edit, even when the idle flush has not run.
        self.flush_paste_burst_before_handoff();
        // Expand registered paste ranges from the end so ordinary edits cannot erase a whole paste.
        let pending_pastes = std::mem::take(&mut self.draft.pending_pastes);
        if !pending_pastes.is_empty() {
            for element in self.draft.textarea.text_elements().into_iter().rev() {
                if let Some((_, text)) = pending_pastes.iter().find(|(placeholder, _)| {
                    element.placeholder(self.draft.textarea.text()) == Some(placeholder.as_str())
                }) {
                    self.draft
                        .textarea
                        .replace_range(element.byte_range.start..element.byte_range.end, text);
                }
            }
        }

        if matches!(key.code, KeyCode::Enter | KeyCode::Tab)
            || !matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat)
        {
            return;
        }

        if self.handle_vim_history_key(key) {
            return;
        }
        self.begin_vim_key(key);
        let elements_before = self.draft.textarea.element_payloads();
        self.draft.textarea.input(key);
        self.reconcile_deleted_elements(elements_before);
        self.reconcile_pending_pastes();
        self.finish_vim_key();
        self.reset_history_navigation();
    }
}

#[cfg(test)]
#[path = "reconnect_tests.rs"]
mod tests;
