//! Text fields use the same composer, paste clock and draft boundary as the main input.

use super::*;

impl McpServerElicitationOverlay {
    #[cfg(test)]
    pub(in crate::bottom_pane) fn handle_key_event(
        &mut self,
        key: KeyEvent,
    ) -> Option<AppServerResponse> {
        self.handle_key_event_at(key, Instant::now())
    }

    pub(in crate::bottom_pane) fn handle_key_event_at(
        &mut self,
        key: KeyEvent,
        now: Instant,
    ) -> Option<AppServerResponse> {
        if self.done || !matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
            return None;
        }
        self.submission_error = None;
        if self.is_text_field()
            && (self.composer.key_chord_pending()
                || self.composer.vim_search_active()
                || self.composer.vim_search_wants_key(key)
                || self.composer.should_handle_vim_insert_escape(key)
                || self.composer.history_search_active()
                || self.composer.vim_key_event_is_owned(key))
        {
            return self.handle_text_key_at(key, now);
        }
        if self.is_text_field() && self.composer.prepare_key_event(key, now) {
            self.save_text_draft();
            return None;
        }
        if key.modifiers == KeyModifiers::CONTROL && key.code == KeyCode::Char('c') {
            // Clear an in-progress draft before cancelling the request, including held typing.
            if self.is_text_field() && !self.composer.is_empty() {
                self.composer.replace_draft(ComposerDraft::default());
                self.save_text_draft();
                return None;
            }
            return Some(self.cancel_response());
        }
        if self.is_select_field() {
            return self.handle_select_key(key);
        }
        if key.code == KeyCode::Esc && key.modifiers.is_empty() {
            return Some(self.cancel_response());
        }
        if self.handle_field_navigation(key) {
            return None;
        }
        if key.code == KeyCode::Enter && key.modifiers.is_empty() && self.composer.is_empty() {
            self.commit_current_field();
            return self.advance_or_submit();
        }
        self.handle_text_key_at(key, now)
    }

    fn handle_text_key_at(&mut self, key: KeyEvent, now: Instant) -> Option<AppServerResponse> {
        let draft = self.composer.snapshot_draft();
        match self.composer.handle_key_event_at(key, now) {
            InputResult::Submitted { .. } => {
                // Submission consumes the editor; keep its rich draft for a later field revisit.
                self.composer.replace_draft(draft);
                self.commit_current_field();
                return self.advance_or_submit();
            }
            InputResult::SubmissionRejected { actual_chars } => {
                self.submission_error = Some(actual_chars);
            }
            InputResult::Queued { .. } => self.composer.replace_draft(draft),
            _ => {}
        }
        self.save_text_draft();
        None
    }

    pub(in crate::bottom_pane) fn handle_paste(&mut self, text: &str) {
        if self.done || self.is_select_field() || text.is_empty() {
            return;
        }
        self.submission_error = None;
        self.composer.handle_paste(text);
        self.save_text_draft();
    }

    pub(in crate::bottom_pane) fn flush_paste_burst_if_due(&mut self, now: Instant) -> bool {
        if self.composer.handle_paste_burst_flush(now) {
            self.save_text_draft();
            true
        } else {
            false
        }
    }

    pub(in crate::bottom_pane) fn is_in_paste_burst(&self) -> bool {
        self.composer.paste_burst_needs_frame()
    }

    pub(in crate::bottom_pane) fn next_frame_delay(&self) -> Option<Duration> {
        self.is_in_paste_burst()
            .then_some(crate::tui::TARGET_FRAME_INTERVAL)
    }
}
