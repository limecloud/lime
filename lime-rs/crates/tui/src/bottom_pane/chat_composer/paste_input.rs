//! Codex-shaped paste integration for the Lime composer.
//!
//! Explicit bracketed pastes and terminals that emit a rapid key stream share one insertion
//! path. The burst state is presentation-local: it never becomes part of the canonical turn
//! input until the composer submits the resulting draft.

use std::time::Instant;

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

use super::{pending_paste, ChatComposer, InputResult};
use crate::bottom_pane::paste_burst::{CharDecision, FlushResult};
use crate::key_hint;

impl ChatComposer {
    /// Materialize held typing before the host snapshots and replaces this editor.
    pub(crate) fn flush_paste_burst_before_handoff(&mut self) {
        if let Some(text) = self.draft.paste_burst.flush_before_modified_input() {
            self.handle_paste(&text);
        }
        self.draft.paste_burst.clear_after_explicit_paste();
    }

    pub(crate) fn handle_paste(&mut self, text: &str) {
        if !self.draft.input_enabled {
            return;
        }
        let pending = self
            .draft
            .paste_burst
            .flush_before_modified_input()
            .unwrap_or_default();
        self.draft.paste_burst.clear_after_explicit_paste();
        let mut combined = pending;
        combined.push_str(&text.replace("\r\n", "\n").replace('\r', "\n"));
        if self.history_search.is_some() {
            if !combined.is_empty() {
                self.update_history_search_query(|query| query.push_str(&combined));
            }
            return;
        }
        if self.draft.textarea.insert_vim_search_text(&combined) {
            self.clear_completion_popup();
            return;
        }
        let combined = self.continue_blockquote_paste(&combined);
        let started = self.begin_direct_vim_edit();
        let elements_before = self.draft.textarea.element_payloads();
        if combined.chars().count() > pending_paste::LARGE_PASTE_CHAR_THRESHOLD {
            self.insert_large_paste(combined);
        } else if combined.chars().count() > 1 && self.handle_paste_image_path(&combined) {
            self.insert(" ");
        } else {
            self.insert(&combined);
        }
        self.reconcile_deleted_elements(elements_before);
        self.reconcile_pending_pastes();
        if started {
            self.finish_vim_edit();
        }
    }

    pub(crate) fn handle_paste_image_path(&mut self, pasted: &str) -> bool {
        if !self.config.image_paste_enabled {
            return false;
        }
        let Some(path) = crate::clipboard_paste::normalize_pasted_path(pasted) else {
            return false;
        };
        if image::image_dimensions(&path).is_err() {
            return false;
        }
        self.attach_image(path);
        true
    }

    /// Continue a Markdown blockquote across every line of a multiline paste.
    ///
    /// The target is inspected before insertion so a mouse selection is evaluated at its start,
    /// matching the range that `TextArea::insert` will replace. The extra unquoted blank lines
    /// leave the cursor in the next Markdown block after the pasted content.
    fn continue_blockquote_paste(&self, text: &str) -> String {
        if !self.config.blockquote_paste_enabled || !text.contains('\n') {
            return text.to_string();
        }
        let target = self
            .draft
            .textarea
            .mouse_selection_range()
            .map_or(self.draft.textarea.cursor(), |range| range.start);
        let before_cursor = &self.draft.textarea.text()[..target];
        let current_line = before_cursor.rsplit('\n').next().unwrap_or_default();
        if !current_line.starts_with("> ") {
            return text.to_string();
        }

        let mut quoted = text.replace('\n', "\n> ");
        quoted.push_str("\n\n");
        quoted
    }

    pub(crate) fn paste_burst_needs_frame(&self) -> bool {
        !self.draft.disable_paste_burst && self.draft.paste_burst.is_active()
    }

    #[cfg(test)]
    pub(crate) fn paste_burst_is_disabled(&self) -> bool {
        self.draft.disable_paste_burst
    }

    #[cfg(test)]
    pub(crate) fn set_paste_burst_disabled(&mut self, disabled: bool) {
        let was_disabled = self.draft.disable_paste_burst;
        self.draft.disable_paste_burst = disabled;
        if disabled && !was_disabled {
            if let Some(text) = self.draft.paste_burst.flush_before_modified_input() {
                self.handle_paste(&text);
            }
            self.draft.paste_burst.clear_after_explicit_paste();
        }
    }

    pub(crate) fn handle_paste_burst_flush(&mut self, now: Instant) -> bool {
        if !self.draft.input_enabled {
            self.draft.paste_burst.clear_after_explicit_paste();
            return false;
        }
        match self.draft.paste_burst.flush_if_due(now) {
            FlushResult::Paste(text) => {
                self.handle_paste(&text);
                true
            }
            FlushResult::Typed(ch) => {
                self.draft.paste_burst.clear_window_after_non_char();
                self.insert(&ch.to_string());
                true
            }
            FlushResult::None => false,
        }
    }

    /// Settle draft input before a surface consumes a navigation or completion key.
    /// A control character inside an active paste still belongs to the draft.
    pub(crate) fn prepare_key_event(&mut self, key: KeyEvent, now: Instant) -> bool {
        self.flush_paste_burst_before_modified_input(key, now);
        if !key.modifiers.is_empty() {
            return false;
        }
        match key.code {
            KeyCode::Enter => self.handle_paste_burst_enter(now),
            KeyCode::Tab => self.handle_paste_burst_tab(key, now),
            _ => false,
        }
    }

    pub(super) fn flush_paste_burst_before_modified_input(
        &mut self,
        key: KeyEvent,
        now: Instant,
    ) -> bool {
        if self.draft.disable_paste_burst
            || Self::is_text_key(key)
            || (key.modifiers.is_empty() && matches!(key.code, KeyCode::Enter | KeyCode::Tab))
        {
            return false;
        }
        let mut flushed = self.handle_paste_burst_flush(now);
        if let Some(text) = self.draft.paste_burst.flush_before_modified_input() {
            self.handle_paste(&text);
            flushed = true;
        }
        self.draft.paste_burst.clear_window_after_non_char();
        flushed
    }

    pub(super) fn handle_paste_burst_text_key(
        &mut self,
        key: KeyEvent,
        now: Instant,
    ) -> Option<InputResult> {
        if self.draft.disable_paste_burst
            || !self.draft.textarea.allows_paste_burst()
            || !Self::is_text_key(key)
        {
            return None;
        }
        let KeyCode::Char(ch) = key.code else {
            return None;
        };

        let flushed = self.handle_paste_burst_flush(now);
        let decision = if ch.is_ascii() {
            Some(self.draft.paste_burst.on_plain_char(ch, now))
        } else {
            if self.draft.paste_burst.try_append_char_if_active(ch, now) {
                return Some(InputResult::Changed);
            }
            // IME input is inserted immediately; settle a held ASCII prefix first.
            if let Some(text) = self.draft.paste_burst.flush_before_modified_input() {
                self.handle_paste(&text);
            }
            self.draft.paste_burst.on_plain_char_no_hold(now)
        };
        let Some(decision) = decision else {
            self.insert(&ch.to_string());
            return Some(InputResult::Changed);
        };
        let changed = match decision {
            CharDecision::RetainFirstChar => false,
            CharDecision::BeginBufferFromPending | CharDecision::BufferAppend => {
                self.draft.paste_burst.append_char_to_buffer(ch, now);
                true
            }
            CharDecision::BeginBuffer { retro_chars } => {
                let before_cursor = self.text()[..self.cursor()].to_owned();
                if let Some(grab) = self.draft.paste_burst.decide_begin_buffer(
                    now,
                    &before_cursor,
                    usize::from(retro_chars),
                ) {
                    if grab.start_byte == self.cursor()
                        || self.draft.textarea.retract_paste_burst(grab.start_byte)
                    {
                        self.draft.paste_burst.append_char_to_buffer(ch, now);
                    } else {
                        self.draft.paste_burst.clear_after_explicit_paste();
                        self.insert(&ch.to_string());
                    }
                    true
                } else {
                    self.insert(&ch.to_string());
                    true
                }
            }
        };
        if changed || flushed {
            Some(InputResult::Changed)
        } else {
            Some(InputResult::None)
        }
    }

    fn is_text_key(key: KeyEvent) -> bool {
        if !matches!(key.code, KeyCode::Char(_)) {
            return false;
        }
        if key.modifiers.intersects(
            KeyModifiers::CONTROL | KeyModifiers::SUPER | KeyModifiers::HYPER | KeyModifiers::META,
        ) {
            return false;
        }
        key.modifiers.is_empty()
            || key.modifiers == KeyModifiers::SHIFT
            || key_hint::is_altgr(key.modifiers)
    }

    pub(super) fn handle_paste_burst_enter(&mut self, now: Instant) -> bool {
        if self.draft.disable_paste_burst {
            return false;
        }
        self.handle_paste_burst_flush(now);
        if self
            .draft
            .paste_burst
            .append_control_char_if_active('\n', now)
        {
            return true;
        }
        if self
            .draft
            .paste_burst
            .direct_insert_newline_should_insert(now)
        {
            self.insert("\n");
            self.draft.paste_burst.extend_window(now);
            return true;
        }
        false
    }

    pub(super) fn handle_paste_burst_tab(&mut self, key: KeyEvent, now: Instant) -> bool {
        if self.draft.disable_paste_burst || key.code != KeyCode::Tab || !key.modifiers.is_empty() {
            return false;
        }
        self.handle_paste_burst_flush(now);
        self.draft
            .paste_burst
            .append_control_char_if_active('\t', now)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::{App, AppAction};
    use crate::tui::TuiEvent;
    use std::time::Duration;

    #[test]
    fn held_ascii_precedes_immediate_unicode_input() {
        for text in ["a界", "a界b", "a🙂"] {
            let mut composer = ChatComposer::default();
            let start = Instant::now();
            for (index, ch) in text.chars().enumerate() {
                let code = match ch {
                    '\t' => KeyCode::Tab,
                    '\n' => KeyCode::Enter,
                    ch => KeyCode::Char(ch),
                };
                composer.handle_key_event_at(
                    KeyEvent::new(code, KeyModifiers::NONE),
                    start + Duration::from_micros(index as u64 * 100),
                );
                if index == 1 {
                    assert_eq!(composer.text(), &text[..1 + ch.len_utf8()]);
                }
            }
            composer.handle_paste_burst_flush(start + Duration::from_secs(1));
            assert_eq!(composer.current_text_with_pending(), text);
        }
    }

    #[test]
    fn status_popup_execution_does_not_restore_a_pending_character() {
        let mut app = App::default();
        app.chat_widget.bottom_pane.composer.insert("/statu");
        assert_eq!(
            app.chat_widget.bottom_pane.composer.handle_key_event_at(
                KeyEvent::new(KeyCode::Char('s'), KeyModifiers::NONE),
                Instant::now() - Duration::from_secs(1),
            ),
            InputResult::None
        );

        assert_eq!(
            app.handle_tui_event_runtime(
                TuiEvent::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
                true,
            ),
            AppAction::None
        );
        app.pre_draw_tick(Instant::now());
        app.handle_tui_event_runtime(
            TuiEvent::Key(KeyEvent::new(KeyCode::Char('q'), KeyModifiers::NONE)),
            true,
        );
        assert!(app.chat_widget.bottom_pane.composer.is_empty());
        assert!(!app
            .chat_widget
            .bottom_pane
            .composer
            .paste_burst_needs_frame());
    }

    #[test]
    fn popup_enter_and_tab_remain_text_inside_a_paste_burst() {
        for (code, suffix) in [(KeyCode::Enter, '\n'), (KeyCode::Tab, '\t')] {
            let mut composer = ChatComposer::default();
            composer.insert("/");
            let start = Instant::now();
            composer
                .handle_key_event_at(KeyEvent::new(KeyCode::Char('s'), KeyModifiers::NONE), start);
            composer.handle_key_event_at(
                KeyEvent::new(KeyCode::Char('t'), KeyModifiers::NONE),
                start + Duration::from_millis(1),
            );
            assert!(composer.prepare_key_event(
                KeyEvent::new(code, KeyModifiers::NONE),
                start + Duration::from_millis(2),
            ));
            composer.handle_paste_burst_flush(start + Duration::from_secs(1));
            assert_eq!(composer.text(), format!("/st{suffix}"));
        }
    }
}
