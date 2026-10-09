//! Footer presentation state owned by the chat composer.
//!
//! This mirrors Codex's owner boundary: transient footer state lives beside composer input, while
//! the app view only renders the selected mode and text.

use super::super::footer::FooterMode;

#[derive(Debug, Default)]
pub(super) struct FooterState {
    pub(super) mode: FooterMode,
    // Presentation-only snapshot used to animate the outgoing passive status row.
    pub(super) passive_status_line: std::cell::RefCell<Option<ratatui::text::Line<'static>>>,
}

impl super::ChatComposer {
    pub(crate) fn can_backtrack(&self) -> bool {
        self.is_empty()
            && self.input_enabled()
            && !self.popups.active()
            && !self.history_search_active()
            && !self.vim_search_active()
            && !self.is_vim_normal_mode()
            && !self.key_chord_pending()
            && !self.draft.paste_burst.is_active()
            && !self.shortcut_overlay_visible()
    }
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
            FooterMode::EscHint
                if self.is_empty()
                    && !self.popups.active()
                    && !self.is_vim_normal_mode()
                    && !self.draft.paste_burst.is_active() =>
            {
                FooterMode::EscHint
            }
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

    pub(crate) fn show_esc_backtrack_hint(&mut self, show: bool) {
        if show {
            self.footer.mode = FooterMode::EscHint;
        } else if self.footer.mode == FooterMode::EscHint {
            self.footer.mode = FooterMode::ComposerEmpty;
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

    pub(super) fn handle_empty_prompt_shortcut(
        &mut self,
        key: crossterm::event::KeyEvent,
    ) -> Option<super::InputResult> {
        use crossterm::event::{KeyCode, KeyEventKind};
        if key.kind != KeyEventKind::Press {
            return None;
        }
        if self.key_chord_pending() {
            return None;
        }
        if self.shortcut_overlay_visible() && key.code == KeyCode::Esc && key.modifiers.is_empty() {
            return self
                .dismiss_shortcut_overlay()
                .then_some(super::InputResult::Changed);
        }
        if key.code == KeyCode::Left
            && key.modifiers.is_empty()
            && self.agents_navigation_available()
        {
            return Some(super::InputResult::OpenAgentsOverview);
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
            return Some(super::InputResult::Changed);
        }
        // Any editor activity resumes the base footer; paste insertion uses the same reset path.
        self.show_esc_backtrack_hint(false);
        self.dismiss_shortcut_overlay();
        None
    }
}

#[cfg(test)]
#[path = "footer_state_tests.rs"]
mod interaction_tests;
