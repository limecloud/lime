//! Footer presentation state owned by the chat composer.
//!
//! This mirrors Codex's owner boundary: transient footer state lives beside composer input, while
//! the app view only renders the selected mode and text.

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) enum FooterMode {
    #[default]
    ComposerEmpty,
    ComposerHasDraft,
    HistorySearch,
    ShortcutOverlay,
}

#[derive(Debug, Default)]
pub(super) struct FooterState {
    pub(super) mode: FooterMode,
}

impl super::ChatComposer {
    pub(crate) fn shortcut_overlay_visible(&self) -> bool {
        self.footer.mode == FooterMode::ShortcutOverlay
            && !self.popups.active()
            && self.history_search.is_none()
            && !self.vim_search_active()
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
