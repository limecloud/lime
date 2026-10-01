//! Saved draft updates stay behind the history query and visible preview.
//! Cancellation keeps background edits; accepting a match discards them.

use super::{ChatComposer, ComposerDraft, VimPersistentState};

impl ChatComposer {
    /// Host handoff captures the editable draft, never a temporary search match.
    pub(crate) fn draft_snapshot(&self) -> ComposerDraft {
        self.history_search.as_ref().map_or_else(
            || self.snapshot_draft(),
            |search| search.original_draft.clone(),
        )
    }

    pub(crate) fn edit_stored_draft(&mut self, edit: impl FnOnce(&mut Self)) {
        let Some(mut search) = self.history_search.take() else {
            edit(self);
            return;
        };
        search
            .preview_draft
            .get_or_insert_with(|| search.original_draft.clone());
        let preview = self.snapshot_draft();
        let preview_vim_history = std::mem::take(&mut self.vim_history);
        let mut preview_vim_state = VimPersistentState::default();
        self.draft
            .textarea
            .swap_vim_persistent_state(&mut preview_vim_state);
        // Lime draft mutations reset navigation. Suspend that owner as well so an
        // in-flight persistent lookup keeps its identity, cursor, cache and retry state.
        let history = std::mem::take(&mut self.history);
        self.restore_draft(search.original_draft);
        self.draft
            .textarea
            .swap_vim_persistent_state(&mut search.original_vim_state);
        self.vim_history = search.original_vim_history;
        edit(self);
        search.original_draft = self.snapshot_draft();
        search.original_vim_history = std::mem::take(&mut self.vim_history);
        self.draft
            .textarea
            .swap_vim_persistent_state(&mut search.original_vim_state);
        self.history = history;
        self.history_search = Some(search);
        self.restore_draft(preview);
        self.draft
            .textarea
            .swap_vim_persistent_state(&mut preview_vim_state);
        self.vim_history = preview_vim_history;
        self.footer.mode = super::FooterMode::HistorySearch;
    }
}

#[cfg(test)]
#[path = "history_search_draft_tests.rs"]
mod tests;
