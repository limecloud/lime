use super::App;
use crate::chatwidget::ExternalEditorState;
use crate::external_editor;
use crate::tui::{TerminalHandoff, Tui};

impl App {
    pub(crate) async fn launch_external_editor(&mut self, tui: &mut Tui) {
        // Resolve before handing off the terminal: invalid commands never disturb input modes.
        let editor_cmd = match external_editor::resolve_editor_command() {
            Ok(command) => command,
            Err(error) => {
                self.finish_external_editor(Err(error.into()));
                tui.frame_requester().schedule_frame();
                return;
            }
        };
        self.chat_widget
            .set_external_editor_state(ExternalEditorState::Active);
        let seed = self.chat_widget.bottom_pane.composer_text_with_pending();
        if let Err(error) = tui.draw_for_handoff(
            crate::view::cursor_style(self),
            self.terminal_title_text(std::time::Instant::now())
                .as_deref(),
            |frame| crate::view::render(frame, self),
        ) {
            self.finish_external_editor(Err(error.into()));
            tui.frame_requester().schedule_frame();
            return;
        }
        let result = tui
            .with_restored(TerminalHandoff::KeepScreen, || {
                external_editor::run_editor(&seed, &editor_cmd, &self.cwd)
            })
            .await;
        self.finish_external_editor(result);
        tui.frame_requester().schedule_frame();
    }

    fn finish_external_editor(&mut self, result: anyhow::Result<String>) {
        self.chat_widget.reset_external_editor_state();
        match result {
            Ok(text) => self
                .chat_widget
                .bottom_pane
                .apply_external_edit(text.trim_end().to_string()),
            Err(error) => self
                .projection
                .add_error_message(self.chat_widget.locale.external_editor_failed(&error)),
        }
    }
}

#[cfg(test)]
#[path = "input_tests.rs"]
mod tests;
