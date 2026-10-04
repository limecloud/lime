//! History traversal and reverse search restore the same draft snapshot.

use super::*;

impl ChatComposer {
    pub(crate) fn set_app_event_tx(&mut self, app_event_tx: AppEventSender) {
        self.app_event_tx = app_event_tx;
    }

    pub(crate) fn set_history_metadata(
        &mut self,
        thread_id: String,
        log_id: String,
        entry_count: usize,
    ) {
        self.cancel_history_search();
        self.history.set_metadata(thread_id, log_id, entry_count);
        self.draft.saved_draft = None;
    }

    pub(crate) fn set_history_thread_id(&mut self, thread_id: &str) {
        self.cancel_history_search();
        self.history.set_thread_id(thread_id);
    }

    /// Replace composer replay facts from a hydrated canonical thread.
    pub(crate) fn replace_replayed_history(
        &mut self,
        thread_id: String,
        turns: &[app_server_protocol::protocol::v2::Turn],
    ) {
        self.cancel_history_search();
        self.history
            .replace_replayed_history(thread_id, replay_entries_from_turns(turns));
    }

    /// Feed one canonical transcript page into the same composer history owner.
    pub(crate) fn record_replayed_history_page(
        &mut self,
        items: &[app_server_protocol::protocol::v2::ThreadItem],
        turns: Option<&[app_server_protocol::protocol::v2::Turn]>,
        prepend: bool,
    ) {
        let entries = replay_entries_from_items(items, turns);
        if prepend {
            self.history.prepend_replayed_submissions(entries);
        } else {
            for entry in entries {
                self.history.record_replayed_submission(entry);
            }
        }
    }

    /// The host checks the requesting thread before dispatching a lookup response.
    pub(crate) fn on_history_lookup_response(
        &mut self,
        thread_id: &str,
        response: crate::app_event::HistoryLookupResponse,
    ) -> bool {
        use crate::app_event::HistoryLookupResponse;
        if !self.history.owns_response(thread_id) {
            return false;
        }
        match response {
            HistoryLookupResponse::Entry {
                log_id,
                offset,
                entry,
            } => self.on_history_entry_response(&log_id, offset, entry),
            HistoryLookupResponse::EntryError { log_id, offset } => {
                let result = self.history.on_entry_error(&log_id, offset);
                self.apply_history_entry_response(result)
            }
            HistoryLookupResponse::Batch {
                log_id,
                cursor,
                entries,
                next_older_cursor,
            } => self.on_history_batch_response(&log_id, cursor, entries, next_older_cursor),
            HistoryLookupResponse::BatchError { log_id, cursor } => {
                self.on_history_batch_error(&log_id, cursor)
            }
        }
    }

    pub(crate) fn on_history_entry_response(
        &mut self,
        log_id: &str,
        offset: usize,
        entry: Option<String>,
    ) -> bool {
        let result = self
            .history
            .on_entry_response(log_id, offset, entry, &self.app_event_tx);
        self.apply_history_entry_response(result)
    }

    fn apply_history_entry_response(&mut self, result: HistoryEntryResponse) -> bool {
        match result {
            HistoryEntryResponse::Found(entry) => {
                self.apply_history_entry(entry);
                true
            }
            HistoryEntryResponse::Search(result) => self.apply_history_batch_result(Some(result)),
            HistoryEntryResponse::Ignored => false,
        }
    }

    pub(crate) fn on_history_batch_response(
        &mut self,
        log_id: &str,
        cursor: crate::app_event::HistoryBatchCursor,
        entries: Vec<crate::app_event::HistoryBatchEntryResponse>,
        next_older_cursor: Option<crate::app_event::HistoryBatchCursor>,
    ) -> bool {
        let result = self.history.on_batch_response(
            log_id,
            cursor,
            entries,
            next_older_cursor,
            &self.app_event_tx,
        );
        self.apply_history_batch_result(result)
    }

    pub(crate) fn on_history_batch_error(
        &mut self,
        log_id: &str,
        cursor: crate::app_event::HistoryBatchCursor,
    ) -> bool {
        let result = self
            .history
            .on_batch_error(log_id, cursor, &self.app_event_tx);
        self.apply_history_batch_result(result)
    }

    fn apply_history_batch_result(&mut self, result: Option<HistorySearchResult>) -> bool {
        let Some(result) = result.filter(|_| self.history_search.is_some()) else {
            return false;
        };
        self.apply_history_search_result(result);
        true
    }

    pub(super) fn history_previous(&mut self) -> InputResult {
        if self.history.is_empty() {
            return InputResult::None;
        }
        if !self.history.is_navigating() {
            self.draft.saved_draft = Some(self.snapshot_draft());
        }
        if let Some(entry) = self.history.navigate_up(&self.app_event_tx) {
            self.apply_history_entry(entry);
        }
        InputResult::Changed
    }

    pub(super) fn history_next(&mut self) -> InputResult {
        if !self.history.is_navigating() {
            return InputResult::None;
        }
        if let Some(entry) = self.history.navigate_down(&self.app_event_tx) {
            if !self.history.is_navigating() {
                let draft = self.draft.saved_draft.take().unwrap_or_default();
                self.restore_draft(draft);
            } else {
                self.apply_history_entry(entry);
            }
        }
        InputResult::Changed
    }

    pub(super) fn replace_text(&mut self, text: String) {
        self.draft.textarea.replace(text);
        self.attachments = AttachmentState::default();
        self.draft.pending_pastes.clear();
        self.draft.mention_bindings.clear();
        self.draft.recent_submission_mention_bindings.clear();
        if self.history_search.is_none() {
            self.footer.mode = if self.is_empty() {
                FooterMode::ComposerEmpty
            } else {
                FooterMode::ComposerHasDraft
            };
        }
    }

    pub(super) fn reset_history_navigation(&mut self) {
        self.history.reset_navigation();
        self.draft.saved_draft = None;
        self.history_search = None;
        self.footer.mode = if self.is_empty() {
            FooterMode::ComposerEmpty
        } else {
            FooterMode::ComposerHasDraft
        };
    }

    /// Return whether a vertical key may enter shell-style history navigation.
    ///
    /// Empty drafts can always start history traversal. Non-empty drafts must be the exact last
    /// recalled entry at a logical cursor boundary. Wrapped single-line drafts add a visual-row
    /// boundary so interior Up/Down keys remain textarea navigation.
    pub(super) fn should_handle_history_navigation(&self, direction: i8) -> bool {
        let cursor = if self.is_vim_normal_mode()
            && self.cursor() == self.draft.textarea.vim_normal_end_cursor()
        {
            self.text().len()
        } else {
            self.cursor()
        };
        self.history.should_handle_navigation(self.text(), cursor)
            && (self.is_empty() || self.draft.textarea.is_vertical_boundary(direction))
    }

    pub(super) fn snapshot_history_entry(&self) -> HistoryEntry {
        HistoryEntry {
            text: self.text().to_string(),
            text_elements: self.draft.textarea.text_elements(),
            local_images: self.local_images(),
            remote_images: self.remote_images().to_vec(),
            pending_pastes: self.draft.pending_pastes.clone(),
            mention_bindings: self.snapshot_mention_bindings(),
        }
    }

    pub(super) fn apply_history_entry(&mut self, entry: HistoryEntry) {
        self.rebuild_text_content(
            entry.text,
            entry.text_elements,
            entry.local_images,
            entry.remote_images,
            entry.mention_bindings,
        );
        self.draft.pending_pastes = entry.pending_pastes;
        self.history.record_recalled_text(self.text().to_string());
        self.sync_completion_popup();
    }
}

#[cfg(test)]
#[path = "history_tests.rs"]
mod tests;
