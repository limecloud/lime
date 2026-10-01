//! Composer pointer routing built on the textarea's last rendered viewport.

use crossterm::event::{MouseButton, MouseEvent, MouseEventKind};

use super::ChatComposer;
use crate::clipboard_paste::ClipboardTextSource;
use crate::tui::TuiEvent;

impl ChatComposer {
    pub(crate) fn end_mouse_drag(&mut self) {
        self.draft.textarea.end_mouse_drag();
    }

    pub(crate) fn clear_mouse_selection(&mut self) {
        self.draft.textarea.clear_mouse_selection();
    }

    pub(crate) fn copy_selection_request(&mut self, event: &TuiEvent) -> Option<(String, bool)> {
        let mouse_copy = matches!(
            event,
            TuiEvent::Mouse(mouse)
                if mouse.kind == MouseEventKind::Down(MouseButton::Right)
                    && self.draft.textarea.contains_mouse(*mouse)
        );
        let keyboard_copy =
            matches!(event, TuiEvent::Key(key) if crate::text_selection::is_copy_key(*key));
        if (!mouse_copy && !keyboard_copy)
            || self.history_search.is_some()
            || self.vim_search_active()
        {
            return None;
        }
        let text = self.draft.textarea.selected_text()?.to_string();
        self.end_mouse_drag();
        Some((text, mouse_copy))
    }

    /// Return the clipboard surface requested by a right-/middle-click in the textarea.
    ///
    /// Right-click copy is checked by the app before this method, so an existing selection keeps
    /// its copy-first semantics.  Popup/search and Vim modes remain owner-exclusive, matching
    /// Codex's rule that a mouse paste cannot steal an active editor surface.
    pub(crate) fn clipboard_paste_request(&self, event: &TuiEvent) -> Option<ClipboardTextSource> {
        if self.history_search.is_some()
            || self.vim_search_active()
            || self.completion_popup_active()
        {
            return None;
        }
        let TuiEvent::Mouse(mouse) = event else {
            return None;
        };
        if !mouse.modifiers.is_empty() || !self.draft.textarea.contains_mouse(*mouse) {
            return None;
        }
        match mouse.kind {
            MouseEventKind::Down(MouseButton::Right)
                if self.draft.textarea.selected_text().is_none() =>
            {
                Some(ClipboardTextSource::Clipboard)
            }
            MouseEventKind::Down(MouseButton::Middle) => Some(ClipboardTextSource::Primary),
            _ => None,
        }
    }

    /// Return the exact draft target that an asynchronous mouse paste may still own.
    pub(crate) fn clipboard_paste_target(&self) -> Option<(String, usize)> {
        if self.history_search.is_some()
            || self.vim_search_active()
            || self.completion_popup_active()
            || self.draft.textarea.selected_text().is_some()
        {
            return None;
        }
        Some((self.text().to_string(), self.cursor()))
    }

    pub(crate) fn handle_mouse(&mut self, event: MouseEvent) -> bool {
        if self.history_search.is_some() || self.vim_search_active() {
            self.end_mouse_drag();
            return false;
        }
        let state = *self.draft.textarea_state.borrow();
        let handled = self.draft.textarea.handle_mouse(event, state);
        if handled {
            self.attachments.clear_remote_image_selection();
            self.popups.clear();
            self.reset_history_navigation();
        }
        handled
    }
}
