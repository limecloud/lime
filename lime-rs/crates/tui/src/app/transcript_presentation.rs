//! App wiring for the ChatWidget-owned transcript presentation lifecycle.

use super::App;
use crate::pager_overlay::PagerOverlay;

impl App {
    pub(super) fn open_transcript_pager(&mut self) {
        self.finish_main_transcript_selection(false);
        if let Some(scroll) = self.chat_widget.transcript_search.close() {
            self.chat_widget.transcript_scroll = scroll;
        }
        self.chat_widget.bottom_pane.clear_completion_popup();
        self.dismiss_pager_overlay();
        let pager = self
            .chat_widget
            .transcript_presentation
            .open(self.locale, self.runtime_keymap.transcript().clone());
        pager.set_older_history_available(self.scrollback_has_older_history);
        self.chat_widget.pager_overlay = Some(pager);
    }

    pub(super) fn dismiss_pager_overlay(&mut self) {
        self.primary_clipboard_lease = None;
        let Some(pager) = self.chat_widget.pager_overlay.take() else {
            return;
        };
        self.chat_widget.transcript_presentation.retain(pager);
    }

    pub(super) fn reset_transcript_presentation(&mut self) {
        if self
            .chat_widget
            .pager_overlay
            .as_ref()
            .is_some_and(PagerOverlay::is_transcript)
        {
            self.chat_widget.pager_overlay = None;
        }
        self.primary_clipboard_lease = None;
        self.chat_widget.transcript_presentation.clear();
    }
}
