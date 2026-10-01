//! Resolved editor actions share the same semantic boundary as Vim insert/repeat.

use super::{vim_commands::VimAction, TextArea};
use crate::keymap::{EditorAction, EditorKeymap, KeymapMatch, RuntimeKeymap};
use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use std::sync::Arc;

impl TextArea {
    /// Replace bindings without changing text, cursor, elements, kill buffer, or Vim history.
    pub(crate) fn set_keymap_bindings(&mut self, keymap: &RuntimeKeymap) {
        self.editor_keymap = Arc::clone(&keymap.editor);
        self.editor_key_chord_matcher.reset();
        self.vim_normal_keymap = Arc::clone(&keymap.vim_normal);
        self.vim_operator_keymap = Arc::clone(&keymap.vim_operator);
        self.vim_text_object_keymap = Arc::clone(&keymap.vim_text_object);
        self.vim_search_keymap = Arc::clone(&keymap.vim_search);
        self.vim_key_chord_matcher.reset();
        self.vim_pending = super::vim::VimPending::None;
        self.set_vim_search_editor_keymap(keymap);
    }

    pub(crate) fn editor_key_event_is_owned(&self, key: KeyEvent) -> bool {
        (!self.vim_enabled || self.allows_paste_burst())
            && self
                .editor_keymap
                .owns_key(&self.editor_key_chord_matcher, key)
    }

    pub(crate) fn editor_action_for_key(&self, key: KeyEvent) -> Option<EditorAction> {
        if self.editor_key_chord_matcher.is_pending() {
            return None;
        }
        self.editor_keymap.action_for_key(key)
    }

    pub(crate) fn editor_key_chord_pending(&self) -> bool {
        self.editor_key_chord_matcher.is_pending()
    }

    pub(crate) fn input(&mut self, event: KeyEvent) {
        if !matches!(event.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
            return;
        }
        self.last_click = None;
        if self.editor_key_chord_matcher.is_pending() {
            self.input_insert_mode(event);
            self.cursor = self.nearest_atomic_boundary(self.cursor);
            return;
        }
        if self.vim_enabled {
            self.handle_vim_input(event);
        } else {
            self.input_insert_mode(event);
        }
        self.cursor = self.nearest_atomic_boundary(self.cursor);
    }

    pub(super) fn input_insert_mode(&mut self, event: KeyEvent) {
        let keymap = Arc::clone(&self.editor_keymap);
        self.input_with_keymap(event, &keymap);
    }

    pub(crate) fn input_with_keymap(&mut self, event: KeyEvent, keymap: &EditorKeymap) {
        if !matches!(event.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
            return;
        }
        // AltGr is text input unless one of Codex's explicit newline/word-delete aliases
        // matched. A pending chord still owns its completion, including cancellation.
        if !self.editor_key_chord_matcher.is_pending()
            && crate::key_hint::is_altgr(event.modifiers)
            && matches!(event.code, KeyCode::Char(_))
            && !matches!(
                keymap.action_for_key(event),
                Some(EditorAction::InsertNewline | EditorAction::DeleteBackwardWord)
            )
        {
            if let KeyCode::Char(ch) = event.code {
                self.insert_str(&ch.to_string());
            }
            return;
        }
        match keymap.dispatch(&mut self.editor_key_chord_matcher, event) {
            KeymapMatch::Completed(action) => self.apply_editor_action(action, event),
            KeymapMatch::Pending | KeymapMatch::Cancelled => {}
            KeymapMatch::PassThrough => {
                if let KeyCode::Char(ch) = event.code {
                    if !ch.is_ascii_control()
                        && (event.modifiers.is_empty() || event.modifiers == KeyModifiers::SHIFT)
                    {
                        self.insert_str(&ch.to_string());
                    }
                }
            }
        }
    }

    fn apply_editor_action(&mut self, action: EditorAction, event: KeyEvent) {
        let edit = match action {
            EditorAction::InsertNewline => {
                self.insert_str("\n");
                return;
            }
            EditorAction::Yank => {
                self.yank();
                return;
            }
            EditorAction::DeleteBackward
                if self.is_vim_replace_mode()
                    && self.mouse_selection_range().is_none()
                    && self.apply_vim_insert_action(VimAction::RestoreReplacedCharacter) =>
            {
                return
            }
            EditorAction::DeleteBackward => VimAction::DeleteBackward,
            EditorAction::DeleteForward => VimAction::DeleteForward,
            EditorAction::DeleteBackwardWord => VimAction::DeleteBackwardWord,
            EditorAction::DeleteForwardWord => VimAction::DeleteForwardWord,
            EditorAction::KillLineStart => VimAction::KillLineStart,
            EditorAction::KillWholeLine => VimAction::KillLine,
            EditorAction::KillLineEnd => VimAction::KillLineEnd,
            EditorAction::MoveLeft => VimAction::MoveLeft,
            EditorAction::MoveRight => VimAction::MoveRight,
            EditorAction::MoveUp => VimAction::MoveUp,
            EditorAction::MoveDown => VimAction::MoveDown,
            EditorAction::MoveWordLeft => VimAction::MoveWordLeft,
            EditorAction::MoveWordRight => VimAction::MoveWordRight,
            EditorAction::MoveLineStart => VimAction::MoveLineStart {
                move_up_at_bol: event.code == KeyCode::Char('a')
                    && event.modifiers == KeyModifiers::CONTROL,
            },
            EditorAction::MoveLineEnd => VimAction::MoveLineEnd {
                move_down_at_eol: event.code == KeyCode::Char('e')
                    && event.modifiers == KeyModifiers::CONTROL,
            },
        };
        self.apply_vim_insert_action(edit);
    }
}

#[cfg(test)]
#[path = "input_tests.rs"]
mod tests;
