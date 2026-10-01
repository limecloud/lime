//! Bounded Vim undo/redo history for the composer draft.
//!
//! The composer owns this history because text and attachments must restore as one draft
//! transaction. Search query input remains temporary TextArea state and never enters this history.

use std::collections::VecDeque;

use crate::keymap::{VimKeymapAction, VimNormalAction};
use crossterm::event::KeyEvent;

use super::{draft_state::ComposerDraft, ChatComposer, VimPersistentState};

const MAX_VIM_UNDO_STEPS: usize = 64;
const MAX_VIM_UNDO_BYTES: usize = 1024 * 1024;

#[derive(Debug, Default)]
pub(super) struct VimHistory {
    undo: VecDeque<ComposerDraft>,
    redo: VecDeque<ComposerDraft>,
    pending: Option<ComposerDraft>,
}

impl VimHistory {
    fn trim(&mut self) {
        while self.undo.len() > MAX_VIM_UNDO_STEPS || self.total_bytes() > MAX_VIM_UNDO_BYTES {
            if self.undo.pop_front().is_none() {
                self.redo.pop_front();
            }
        }
    }

    fn total_bytes(&self) -> usize {
        self.undo
            .iter()
            .chain(self.redo.iter())
            .map(ComposerDraft::bytes)
            .sum()
    }
}

impl ChatComposer {
    fn begin_vim_edit_transaction(&mut self) {
        let snapshot = self.snapshot_draft();
        if snapshot.bytes() > MAX_VIM_UNDO_BYTES {
            self.vim_history = VimHistory::default();
            return;
        }
        self.vim_history.pending = Some(snapshot);
    }

    pub(super) fn begin_direct_vim_edit(&mut self) -> bool {
        if !self.draft.textarea.is_vim_enabled()
            || self.vim_search_active()
            || self.draft.textarea.is_vim_operator_pending()
            || self.vim_history.pending.is_some()
        {
            return false;
        }
        self.begin_vim_edit_transaction();
        if self.vim_history.pending.is_none() {
            return false;
        }
        let mut vim_state = VimPersistentState::default();
        self.draft
            .textarea
            .swap_vim_persistent_state(&mut vim_state);
        vim_state.commands.last_change.clear();
        self.draft
            .textarea
            .swap_vim_persistent_state(&mut vim_state);
        true
    }

    pub(super) fn begin_vim_key(&mut self, key: KeyEvent) {
        if !self.draft.textarea.is_vim_enabled()
            || self.vim_search_active()
            || self.history_search_active()
        {
            return;
        }
        if self.vim_history.pending.is_some() {
            return;
        }

        if self.draft.textarea.is_vim_normal_mode()
            && !self.draft.textarea.vim_key_starts_edit(key)
            && !self.attachments.remote_image_edit_key(key)
        {
            return;
        }
        self.begin_vim_edit_transaction();
    }

    pub(super) fn finish_vim_key(&mut self) {
        if self.vim_history.pending.is_none()
            || self.draft.textarea.is_vim_operator_pending()
            || self.vim_search_active()
            || !self.draft.textarea.is_vim_normal_mode()
        {
            return;
        }
        self.finish_vim_edit();
    }

    pub(super) fn finish_vim_edit(&mut self) {
        let Some(snapshot) = self.vim_history.pending.take() else {
            return;
        };
        if self.draft_content_equals(&snapshot) {
            return;
        }
        self.vim_history.redo.clear();
        self.vim_history.undo.push_back(snapshot);
        self.vim_history.trim();
    }

    pub(super) fn handle_vim_history_key(&mut self, key: KeyEvent) -> bool {
        if !self.draft.textarea.is_vim_normal_mode()
            || self.vim_search_active()
            || self.history_search_active()
        {
            return false;
        }
        let action = self.draft.textarea.vim_action_for_key(key);
        let redo = match action {
            Some(VimKeymapAction::Normal(VimNormalAction::Undo)) => false,
            Some(VimKeymapAction::Normal(VimNormalAction::Redo)) => true,
            _ => return false,
        };
        // Consume the resolved action through the same matcher, including chord completion.
        self.draft.textarea.input(key);

        let snapshot = if redo {
            self.vim_history.redo.pop_back()
        } else {
            self.vim_history.undo.pop_back()
        };
        if let Some(snapshot) = snapshot {
            let current = self.snapshot_draft();
            if redo {
                self.vim_history.undo.push_back(current);
            } else {
                self.vim_history.redo.push_back(current);
            }
            let mut vim_state = VimPersistentState::default();
            self.draft
                .textarea
                .swap_vim_persistent_state(&mut vim_state);
            self.restore_draft(snapshot);
            self.draft
                .textarea
                .swap_vim_persistent_state(&mut vim_state);
            self.vim_history.trim();
        }
        true
    }
}

#[cfg(test)]
#[path = "vim_history_tests.rs"]
mod tests;
