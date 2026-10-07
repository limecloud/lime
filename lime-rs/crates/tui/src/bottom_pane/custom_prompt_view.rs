//! Multiline prompt editing with shared-picker presentation.
//!
//! TextArea owns editing; this view owns submit/back and PasteBurst protection. Characters
//! insert immediately, while a paste-like Enter inserts a newline instead of submitting.
//! The caller owns the submitted value and any business action; rendering never mutates it.

mod picker;

use std::cell::Cell;
use std::time::Instant;

use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};

use super::paste_burst::PasteBurst;
use super::{TextArea, TextAreaState};
use crate::keymap::RuntimeKeymap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PromptAction {
    None,
    Cancel,
    Submit,
}

/// Localized presentation inputs stay separate from the editable value and key facts.
pub(crate) struct PromptLabels<'a> {
    pub(crate) title: &'a str,
    pub(crate) placeholder: &'a str,
    pub(crate) submit: &'a str,
}

#[derive(Debug)]
pub(crate) struct CustomPromptView {
    textarea: TextArea,
    textarea_state: Cell<TextAreaState>,
    paste_burst: PasteBurst,
}

impl CustomPromptView {
    pub(crate) fn new(initial_text: String) -> Self {
        let mut textarea = TextArea::new();
        textarea.replace(initial_text);
        Self {
            textarea,
            textarea_state: Cell::default(),
            paste_burst: PasteBurst::default(),
        }
    }

    pub(crate) fn text(&self) -> &str {
        self.textarea.text()
    }

    #[cfg(test)]
    pub(crate) fn textarea(&self) -> &TextArea {
        &self.textarea
    }

    /// Apply the same editor and Vim bindings used by the main composer, clearing pending input.
    pub(crate) fn set_keymap_bindings(&mut self, keymap: &RuntimeKeymap) {
        self.textarea.set_keymap_bindings(keymap);
        self.paste_burst.clear_after_explicit_paste();
    }

    pub(crate) fn enable_vim_in_insert_mode(&mut self) {
        self.textarea.set_vim_enabled(true);
        self.textarea.enter_vim_insert_mode();
    }

    pub(crate) fn cursor_style(&self) -> crossterm::cursor::SetCursorStyle {
        if self.textarea.uses_vim_insert_cursor() {
            crossterm::cursor::SetCursorStyle::SteadyBar
        } else {
            crossterm::cursor::SetCursorStyle::DefaultUserShape
        }
    }

    pub(crate) fn handle_key_event(&mut self, key: KeyEvent) -> PromptAction {
        self.handle_key_event_at(key, Instant::now())
    }

    fn handle_key_event_at(&mut self, key: KeyEvent, now: Instant) -> PromptAction {
        if !matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
            return PromptAction::None;
        }
        if key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL) {
            return PromptAction::Cancel;
        }
        // Pending editor chords and Vim operators/search own their Enter/Esc completion.
        if self.textarea.editor_key_chord_pending() || self.textarea.is_vim_operator_pending() {
            self.textarea.input(key);
            self.paste_burst.clear_after_explicit_paste();
            return PromptAction::None;
        }
        match key.code {
            KeyCode::Esc if key.modifiers.is_empty() => {
                if self.textarea.should_handle_vim_insert_escape(key) {
                    self.textarea.input(key);
                    self.paste_burst.clear_after_explicit_paste();
                } else {
                    return PromptAction::Cancel;
                }
            }
            KeyCode::Enter => {
                if self.textarea.allows_paste_burst()
                    && self.paste_burst.direct_insert_newline_should_insert(now)
                {
                    self.paste_burst.extend_window(now);
                    self.textarea.insert_str("\n");
                } else if key.modifiers.is_empty() {
                    if !self.text().trim().is_empty() {
                        return PromptAction::Submit;
                    }
                } else {
                    self.textarea.input(key);
                }
            }
            KeyCode::Char(_) | KeyCode::Tab
                if self.textarea.allows_paste_burst()
                    && (crate::key_hint::is_plain_text_key_event(key)
                        || (key.code == KeyCode::Tab && key.modifiers.is_empty())) =>
            {
                let paste_like = if key.code == KeyCode::Tab {
                    self.paste_burst.direct_insert_newline_should_insert(now)
                } else {
                    self.paste_burst.on_plain_char_no_hold(now).is_some()
                };
                self.textarea.input(key);
                if paste_like {
                    self.paste_burst.extend_window(now);
                }
            }
            _ => {
                self.textarea.input(key);
                self.paste_burst.clear_after_explicit_paste();
            }
        }
        PromptAction::None
    }

    pub(crate) fn handle_paste(&mut self, pasted: &str) {
        self.textarea.insert_str(pasted);
        self.paste_burst.clear_after_explicit_paste();
    }
}

#[cfg(test)]
#[path = "custom_prompt_view_tests.rs"]
mod tests;
