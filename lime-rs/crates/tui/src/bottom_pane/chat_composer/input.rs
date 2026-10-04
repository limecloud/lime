//! Composer keyboard routing and submission; runtime dispatch stays in App.

use super::*;

impl ChatComposer {
    pub(crate) fn set_keymap_bindings(&mut self, keymap: &crate::keymap::RuntimeKeymap) {
        self.draft.textarea.set_keymap_bindings(keymap);
    }

    pub(crate) fn editor_key_chord_pending(&self) -> bool {
        self.draft.textarea.editor_key_chord_pending()
    }

    pub(crate) fn key_chord_pending(&self) -> bool {
        self.editor_key_chord_pending() || self.draft.textarea.vim_key_chord_pending()
    }

    pub(crate) fn vim_key_event_is_owned(&self, key: KeyEvent) -> bool {
        self.draft.textarea.vim_key_event_is_owned(key)
    }

    pub(crate) fn handle_key_event(&mut self, key: KeyEvent) -> InputResult {
        let was_disabled = self.draft.disable_paste_burst;
        self.draft.disable_paste_burst = true;
        let result = self.handle_key_event_at(key, Instant::now());
        self.draft.disable_paste_burst = was_disabled;
        result
    }

    pub(crate) fn handle_key_event_at(&mut self, key: KeyEvent, now: Instant) -> InputResult {
        if !self.draft.input_enabled {
            return InputResult::None;
        }
        if matches!(key.kind, KeyEventKind::Release) {
            return InputResult::None;
        }
        if self.handle_empty_prompt_shortcut(key) {
            return InputResult::Changed;
        }
        let flushed = self.flush_paste_burst_before_modified_input(key, now);
        if self.handle_vim_history_key(key) {
            return InputResult::Changed;
        }
        self.begin_vim_key(key);
        let elements_before = self.draft.textarea.element_payloads();
        let result = self.handle_key_event_inner_at(key, now);
        if !matches!(
            result,
            InputResult::Submitted { .. } | InputResult::Queued { .. }
        ) {
            self.reconcile_deleted_elements(elements_before);
        }
        self.reconcile_pending_pastes();
        self.finish_vim_key();
        if flushed && matches!(result, InputResult::None) {
            InputResult::Changed
        } else {
            result
        }
    }

    pub(super) fn handle_key_event_inner_at(&mut self, key: KeyEvent, now: Instant) -> InputResult {
        if matches!(key.kind, KeyEventKind::Release) {
            return InputResult::None;
        }
        if self.history_search.is_some() {
            return self.handle_history_search_key(key);
        }

        if self.handle_vim_search_key(key) {
            return InputResult::Changed;
        }

        if !self.key_chord_pending()
            && !self.draft.textarea.is_vim_operator_pending()
            && self
                .attachments
                .handle_remote_image_selection_key(key, &mut self.draft.textarea)
        {
            return InputResult::Changed;
        }

        if self.vim_key_event_is_owned(key) {
            use crate::keymap::{KeymapContext, VimKeymapAction, VimNormalAction};
            if self.draft.textarea.keymap_context() == KeymapContext::VimNormal {
                let direction = match self.draft.textarea.vim_action_for_key(key) {
                    Some(VimKeymapAction::Normal(VimNormalAction::MoveUp)) => Some(-1),
                    Some(VimKeymapAction::Normal(VimNormalAction::MoveDown)) => Some(1),
                    _ => None,
                };
                if let Some(direction) =
                    direction.filter(|direction| self.should_handle_history_navigation(*direction))
                {
                    // Complete the key sequence before history replaces the buffer.
                    self.draft.textarea.input(key);
                    return if direction < 0 {
                        self.history_previous()
                    } else {
                        self.history_next()
                    };
                }
            }
            self.draft.textarea.input(key);
            self.reset_history_navigation();
            return InputResult::Changed;
        }

        if let Some(result) = self.handle_editor_key(key) {
            return result;
        }

        if let Some(result) = self.handle_paste_burst_text_key(key, now) {
            return result;
        }
        if key.code == KeyCode::Tab
            && key.modifiers.is_empty()
            && self.handle_paste_burst_tab(key, now)
        {
            return InputResult::Changed;
        }
        if key.code == KeyCode::Enter
            && key.modifiers.is_empty()
            && self.handle_paste_burst_enter(now)
        {
            return InputResult::Changed;
        }

        if self.should_handle_vim_insert_escape(key) {
            self.draft.textarea.input(key);
            self.reset_history_navigation();
            return InputResult::Changed;
        }

        if key.code == KeyCode::Left
            && key.modifiers.is_empty()
            && self.agents_navigation_available()
        {
            return InputResult::OpenAgentsOverview;
        }

        if key.modifiers.contains(KeyModifiers::CONTROL) {
            return match key.code {
                KeyCode::Char('c') => InputResult::Interrupt,
                KeyCode::Char('d') if self.is_empty() => InputResult::Quit,
                KeyCode::Char('g') => InputResult::OpenExternalEditor,
                KeyCode::Char('r') => self.begin_history_search(),
                _ => InputResult::None,
            };
        }

        match key.code {
            KeyCode::Char(',') if key.modifiers.contains(KeyModifiers::ALT) => {
                InputResult::DecreaseEffort
            }
            KeyCode::Char('.') if key.modifiers.contains(KeyModifiers::ALT) => {
                InputResult::IncreaseEffort
            }
            KeyCode::F(7) => InputResult::PreviousPermissions,
            KeyCode::F(8) => InputResult::NextPermissions,
            KeyCode::Tab => self.queue(),
            KeyCode::Enter if key.modifiers.is_empty() => self.submit(),
            KeyCode::Char(_)
            | KeyCode::Backspace
            | KeyCode::Delete
            | KeyCode::Left
            | KeyCode::Right
            | KeyCode::Up
            | KeyCode::Down
            | KeyCode::Home
            | KeyCode::End => {
                let before = (self.draft.textarea.text().to_string(), self.cursor());
                self.draft.textarea.input(key);
                let changed = before.0 != self.draft.textarea.text() || before.1 != self.cursor();
                if changed {
                    self.reset_history_navigation();
                    InputResult::Changed
                } else {
                    InputResult::None
                }
            }
            _ => InputResult::None,
        }
    }

    fn handle_editor_key(&mut self, key: KeyEvent) -> Option<InputResult> {
        use crate::keymap::EditorAction;
        let pending = self.draft.textarea.editor_key_chord_pending();
        let action = self.draft.textarea.editor_action_for_key(key);
        // Plain Enter remains composer submission. Modified/newly configured newline keys
        // belong to the editor, and a pending chord owns even Enter or cancellation input.
        if !pending && key.code == KeyCode::Enter && key.modifiers.is_empty() {
            return None;
        }
        if !pending
            && key.code == KeyCode::Char('d')
            && key.modifiers == KeyModifiers::CONTROL
            && self.is_empty()
        {
            return Some(InputResult::Quit);
        }
        if !pending
            && key.code == KeyCode::Left
            && key.modifiers.is_empty()
            && self.agents_navigation_available()
        {
            return None;
        }
        let altgr_text = crate::key_hint::is_altgr(key.modifiers)
            && matches!(key.code, KeyCode::Char(_))
            && self.draft.textarea.allows_paste_burst();
        if !self.draft.textarea.editor_key_event_is_owned(key) && !altgr_text {
            return None;
        }
        if let Some(text) = self.draft.paste_burst.flush_before_modified_input() {
            self.handle_paste(&text);
        }
        self.draft.paste_burst.clear_window_after_non_char();
        if !pending && !self.is_vim_normal_mode() && key.modifiers.is_empty() {
            match (key.code, action) {
                (KeyCode::Up, Some(EditorAction::MoveUp))
                    if self.should_handle_history_navigation(-1) =>
                {
                    return Some(self.history_previous())
                }
                (KeyCode::Down, Some(EditorAction::MoveDown))
                    if self.should_handle_history_navigation(1) =>
                {
                    return Some(self.history_next())
                }
                _ => {}
            }
        }
        self.draft.textarea.input(key);
        self.reset_history_navigation();
        Some(InputResult::Changed)
    }
}

#[cfg(test)]
#[path = "input_keymap_tests.rs"]
mod keymap_tests;
