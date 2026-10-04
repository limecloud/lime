//! App wiring for the ChatWidget-owned transcript presentation lifecycle.

use super::App;

impl App {
    pub(super) fn open_transcript_pager(&mut self) {
        self.finish_main_transcript_selection(false);
        self.chat_widget.open_transcript_pager();
    }

    pub(super) fn dismiss_pager_overlay(&mut self) {
        self.chat_widget.dismiss_pager_overlay();
    }

    pub(super) fn reset_transcript_presentation(&mut self) {
        self.chat_widget.reset_transcript_presentation();
    }
}
