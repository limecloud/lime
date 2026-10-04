//! Offline composer editing used while the App Server connection is recovering.
//!
//! Enter and Tab deliberately leave the draft untouched. The runtime owns reconnect attempts;
//! this module only provides the Codex-shaped editing boundary for a composer that is offline.

use crossterm::event::{KeyCode, KeyEvent, KeyEventKind};

use super::ChatComposer;

impl ChatComposer {
    /// Apply a basic editor key while disconnected without submitting or queueing the draft.
    pub(crate) fn handle_disconnected_key(&mut self, key: KeyEvent) {
        if !self.draft.input_enabled {
            return;
        }
        self.cancel_history_search();
        // A disconnected composer keeps the draft editable, but it must not retain a stale
        // history-recall marker across the reconnect boundary.
        self.reset_history_navigation();

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
