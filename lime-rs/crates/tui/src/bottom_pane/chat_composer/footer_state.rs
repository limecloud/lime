//! Footer presentation state owned by the chat composer.
//!
//! This mirrors Codex's owner boundary: transient footer state lives beside composer input, while
//! the app view only renders the selected mode and text.

use super::super::footer::FooterMode;

#[derive(Debug, Default)]
pub(super) struct FooterState {
    pub(super) mode: FooterMode,
}

impl super::ChatComposer {
    /// Resolve the effective footer surface from composer-owned transient state.
    ///
    /// The stored mode is only an override. History/Vim search always wins, while the base mode
    /// follows the rich draft (including attachments), matching Codex's `footer_mode()` contract.
    pub(crate) fn footer_mode(&self) -> FooterMode {
        if self.history_search.is_some() || self.vim_search_active() {
            return FooterMode::HistorySearch;
        }

        let base_mode = if self.is_empty() {
            FooterMode::ComposerEmpty
        } else {
            FooterMode::ComposerHasDraft
        };

        match self.footer.mode {
            FooterMode::ShortcutOverlay
                if !self.popups.active()
                    && !self.history_search_active()
                    && !self.vim_search_active()
                    && !self.is_vim_normal_mode()
                    && !self.draft.paste_burst.is_active() =>
            {
                FooterMode::ShortcutOverlay
            }
            FooterMode::HistorySearch => FooterMode::HistorySearch,
            _ => base_mode,
        }
    }

    pub(crate) fn shortcut_overlay_visible(&self) -> bool {
        self.footer_mode() == FooterMode::ShortcutOverlay
    }

    pub(crate) fn dismiss_shortcut_overlay(&mut self) -> bool {
        if !self.shortcut_overlay_visible() {
            return false;
        }
        self.footer.mode = FooterMode::ComposerEmpty;
        true
    }

    pub(super) fn handle_empty_prompt_shortcut(&mut self, key: crossterm::event::KeyEvent) -> bool {
        use crossterm::event::{KeyCode, KeyEventKind};
        if key.kind != KeyEventKind::Press {
            return false;
        }
        if self.key_chord_pending() {
            return false;
        }
        if self.shortcut_overlay_visible() && key.code == KeyCode::Esc && key.modifiers.is_empty() {
            return self.dismiss_shortcut_overlay();
        }
        if key.code == KeyCode::Char('?')
            && crate::key_hint::is_plain_text_key_event(key)
            && self.is_empty()
            && !self.popups.active()
            && !self.history_search_active()
            && !self.vim_search_active()
            && !self.is_vim_normal_mode()
            && !self.draft.paste_burst.is_active()
        {
            self.footer.mode = if self.shortcut_overlay_visible() {
                FooterMode::ComposerEmpty
            } else {
                FooterMode::ShortcutOverlay
            };
            return true;
        }
        // Any editor activity resumes the base footer; paste insertion uses the same reset path.
        self.dismiss_shortcut_overlay();
        false
    }
}

#[cfg(test)]
#[path = "footer_state_tests.rs"]
mod interaction_tests;
