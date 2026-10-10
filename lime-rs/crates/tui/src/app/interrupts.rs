//! Active-turn interruption policy for the TUI app.
//!
//! Interactive request queues remain owned by `BottomPane` and `pending_interactive_replay`.
//! This module only owns the Codex-shaped decision that an Esc event may interrupt the active
//! canonical turn.

use super::App;

pub(super) fn should_interrupt_turn(app: &App) -> bool {
    app.projection.active_turn_id().is_some() && !app.chat_widget.bottom_pane.vim_search_active()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

    #[test]
    fn idle_app_does_not_interrupt() {
        assert!(!should_interrupt_turn(&App::default()));
    }

    #[test]
    fn active_turn_can_interrupt() {
        let mut app = App::default();
        app.start_turn("turn-1".to_string());

        assert!(should_interrupt_turn(&app));
    }

    #[test]
    fn vim_search_suppresses_interrupt() {
        let mut app = App::default();
        app.start_turn("turn-1".to_string());
        app.chat_widget.bottom_pane.set_vim_enabled(true);
        app.chat_widget.bottom_pane.insert_str("searchable draft");
        app.chat_widget
            .bottom_pane
            .handle_key_event(KeyEvent::new(KeyCode::Char('/'), KeyModifiers::NONE));

        assert!(!should_interrupt_turn(&app));
    }
}
