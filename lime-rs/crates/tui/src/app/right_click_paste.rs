//! Async mouse paste ownership for the editable composer.
//!
//! Native clipboard reads are owned by the session worker, but the UI ownership and draft
//! snapshot live on `App`. This keeps a late completion from being inserted after a thread,
//! popup, selection, or draft changed while the broker was busy.

use crossterm::event::{MouseButton, MouseEventKind};

use super::App;
use crate::clipboard_paste::{
    normalize_clipboard_text, right_click_paste_allowed, ClipboardTextSource,
};
use crate::tui::TuiEvent;

#[derive(Debug, Clone)]
pub(super) struct PendingPaste {
    id: u64,
    thread: Option<String>,
    draft: (String, usize),
    source: ClipboardTextSource,
}

fn keep_pending(event: &TuiEvent, source: ClipboardTextSource) -> bool {
    let button = match source {
        ClipboardTextSource::Clipboard => MouseButton::Right,
        ClipboardTextSource::Primary => MouseButton::Middle,
    };
    match event {
        TuiEvent::Draw | TuiEvent::Resize(_) | TuiEvent::FocusGained => true,
        TuiEvent::Mouse(mouse) => {
            mouse.kind == MouseEventKind::Moved
                || mouse.kind == MouseEventKind::Up(button)
                || (mouse.kind == MouseEventKind::Down(button) && mouse.modifiers.is_empty())
        }
        TuiEvent::Key(_) | TuiEvent::Paste(_) | TuiEvent::FocusLost | TuiEvent::Resume => false,
    }
}

impl App {
    fn clipboard_paste_target(
        &self,
        source: ClipboardTextSource,
    ) -> Option<(Option<String>, (String, usize))> {
        if !right_click_paste_allowed(self.right_click_paste, source)
            || self.pager_overlay.is_some()
            || self.export_picker.is_some()
            || self.bottom_pane.is_active()
            || self.resume_picker.is_some()
            || self.agents_overview.is_some()
            || self.model_picker.is_some()
            || self.agent_picker.is_some()
            || self.transcript_search.is_active()
            || self.transcript_selection.is_active()
            || self.composer.history_search_active()
            || self.composer.vim_search_active()
            || self.composer.completion_popup_active()
            || self.composer.file_search_popup_active()
            || self.composer.skill_popup_active()
        {
            return None;
        }
        let target = self.composer.clipboard_paste_target()?;
        Some((self.thread_id.clone(), target))
    }

    pub(crate) fn begin_clipboard_paste(&mut self, id: u64, source: ClipboardTextSource) -> bool {
        let Some((thread, draft)) = self.clipboard_paste_target(source) else {
            return false;
        };
        self.pending_clipboard_paste = Some(PendingPaste {
            id,
            thread,
            draft,
            source,
        });
        true
    }

    /// Invalidate before dispatching input or polling a completion.
    pub(crate) fn invalidate_clipboard_paste(&mut self, event: &TuiEvent) -> Option<u64> {
        let pending = self.pending_clipboard_paste.as_ref()?;
        if keep_pending(event, pending.source) {
            return None;
        }
        self.pending_clipboard_paste
            .take()
            .map(|pending| pending.id)
    }

    /// Apply only a completion that still belongs to the same thread and exact composer draft.
    pub(crate) fn finish_clipboard_paste(&mut self, id: u64, result: Result<String, String>) {
        let Some(pending) = self.pending_clipboard_paste.as_ref() else {
            return;
        };
        if pending.id != id {
            return;
        }
        let target = self.clipboard_paste_target(pending.source);
        if target.as_ref() != Some(&(pending.thread.clone(), pending.draft.clone())) {
            self.pending_clipboard_paste = None;
            return;
        }
        self.pending_clipboard_paste = None;
        match result {
            Ok(text) if !text.is_empty() => {
                self.composer.handle_paste(&normalize_clipboard_text(text));
                self.composer.sync_completion_popup();
            }
            Ok(_) => {}
            Err(error) => self.projection.set_status(
                self.locale
                    .status(&format!("clipboard paste failed: {error}")),
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::event::{KeyCode, KeyEvent, KeyModifiers, MouseEvent};

    #[test]
    fn matching_release_survives_but_new_input_invalidates() {
        let right_release = TuiEvent::Mouse(MouseEvent {
            kind: MouseEventKind::Up(MouseButton::Right),
            column: 1,
            row: 1,
            modifiers: KeyModifiers::NONE,
        });
        assert!(keep_pending(&right_release, ClipboardTextSource::Clipboard));
        assert!(!keep_pending(&right_release, ClipboardTextSource::Primary));
        assert!(!keep_pending(
            &TuiEvent::Key(KeyEvent::new(KeyCode::Char('x'), KeyModifiers::NONE)),
            ClipboardTextSource::Clipboard
        ));
    }

    #[test]
    fn modified_same_button_does_not_keep_pending() {
        let event = TuiEvent::Mouse(MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Right),
            column: 1,
            row: 1,
            modifiers: KeyModifiers::CONTROL,
        });
        assert!(!keep_pending(&event, ClipboardTextSource::Clipboard));
    }

    #[test]
    fn late_completion_is_rejected_after_draft_changes() {
        let mut app = App::default();
        app.composer.replace("before".to_string());
        app.pending_clipboard_paste = Some(PendingPaste {
            id: 7,
            thread: None,
            draft: ("before".to_string(), "before".len()),
            source: ClipboardTextSource::Clipboard,
        });
        app.composer.replace("newer".to_string());
        app.finish_clipboard_paste(7, Ok("stale".to_string()));
        assert_eq!(app.composer.text(), "newer");
        assert!(app.pending_clipboard_paste.is_none());
    }

    #[test]
    fn late_completion_is_rejected_after_thread_switch() {
        let mut app = App::default();
        app.composer.replace("draft".to_string());
        app.set_thread_id("thread-a".to_string());
        app.pending_clipboard_paste = Some(PendingPaste {
            id: 8,
            thread: Some("thread-a".to_string()),
            draft: ("draft".to_string(), "draft".len()),
            source: ClipboardTextSource::Clipboard,
        });
        app.set_thread_id("thread-b".to_string());
        app.finish_clipboard_paste(8, Ok("stale".to_string()));
        assert_eq!(app.composer.text(), "draft");
        assert!(app.pending_clipboard_paste.is_none());
    }
}
