//! Thread handoff retains rich composer input and the same unresolved interaction views.

use super::App;

impl App {
    pub(crate) fn capture_current_thread_input(&mut self) {
        let Some(thread_id) = self.thread_id.clone() else {
            return;
        };
        self.chat_widget.capture_thread_input(&thread_id);
    }

    pub(crate) fn restore_thread_input(&mut self, thread_id: &str) {
        self.chat_widget.restore_thread_input(thread_id);
    }

    pub(super) fn observe_thread_input_notification(
        &mut self,
        thread_id: &str,
        notification: &app_server_protocol::protocol::v2::ServerNotification,
    ) {
        self.chat_widget.observe_thread_input_notification(
            thread_id,
            notification,
            self.thread_id.as_deref() == Some(thread_id),
        );
    }

    pub(super) fn clear_connection_interactions(&mut self) {
        self.chat_widget.clear_thread_interactions();
        self.thread_event_channels.clear();
    }
}

#[cfg(test)]
#[path = "thread_input_tests.rs"]
mod edit_lifetime_tests;

#[cfg(test)]
#[path = "thread_interaction_tests.rs"]
mod interaction_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::locale::Locale;
    use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
    use std::path::PathBuf;

    #[test]
    fn thread_handoff_preserves_atomic_paste_cursor_and_both_attachment_kinds() {
        for locale in [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ] {
            let mut app = App::default();
            app.set_locale(locale);
            app.set_thread_id("root".into());
            app.chat_widget
                .bottom_pane
                .handle_paste(&"界🙂".repeat(501));
            app.chat_widget.bottom_pane.insert_str(" suffix");
            app.chat_widget
                .bottom_pane
                .attach_image(PathBuf::from("root.png"));
            app.chat_widget
                .bottom_pane
                .set_remote_image_urls(vec!["https://example.test/root.png".into()]);
            app.chat_widget
                .bottom_pane
                .handle_key_event(KeyEvent::new(KeyCode::Left, KeyModifiers::NONE));
            let root = app.chat_widget.bottom_pane.composer_snapshot();
            let root_text = app.chat_widget.bottom_pane.composer_text_with_pending();
            app.open_agents_overview();
            assert_eq!(
                app.chat_widget.bottom_pane.composer_snapshot(),
                root,
                "opening Agent Center must not alter the live draft"
            );
            app.chat_widget.clear_agents_overview();
            app.capture_current_thread_input();
            app.set_thread_id("child".into());
            app.restore_thread_input("child");
            assert!(app.chat_widget.bottom_pane.composer_is_empty());
            assert!(
                !app.chat_widget.bottom_pane.composer_has_pending_images(),
                "an unseen thread must not inherit root images"
            );
            app.chat_widget.bottom_pane.insert_str("child draft");
            app.chat_widget
                .bottom_pane
                .attach_image(PathBuf::from("child.png"));
            let child = app.chat_widget.bottom_pane.composer_snapshot();
            app.capture_current_thread_input();
            app.set_thread_id("root".into());
            app.restore_thread_input("root");
            assert_eq!(
                app.chat_widget.bottom_pane.composer_snapshot(),
                root,
                "{locale:?} root draft"
            );
            assert_eq!(
                app.chat_widget.bottom_pane.composer_text_with_pending(),
                root_text
            );
            assert!(
                !app.chat_widget.thread_input_states.contains_key("root"),
                "the active composer is the sole live owner"
            );
            app.capture_current_thread_input();
            app.set_thread_id("child".into());
            app.restore_thread_input("child");
            assert_eq!(
                app.chat_widget.bottom_pane.composer_snapshot(),
                child,
                "{locale:?} child draft"
            );
        }
    }

    #[test]
    fn thread_capture_uses_saved_draft_not_search_preview() {
        let mut app = App::default();
        app.set_thread_id("root".into());
        app.chat_widget
            .bottom_pane
            .set_cached_history(["history match".into()]);
        app.chat_widget.bottom_pane.insert_str("original");
        app.chat_widget
            .bottom_pane
            .handle_key_event(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL));
        app.chat_widget.bottom_pane.handle_paste("match");
        app.attach_image(PathBuf::from("background.png"));
        let stored = app.chat_widget.bottom_pane.composer_draft();
        assert_eq!(app.chat_widget.bottom_pane.composer_text(), "history match");
        app.capture_current_thread_input();
        assert_eq!(
            app.chat_widget.thread_input_states["root"].composer_draft(),
            &stored
        );
        app.set_thread_id("child".into());
        app.restore_thread_input("child");
        app.set_thread_id("root".into());
        app.restore_thread_input("root");
        assert_eq!(app.chat_widget.bottom_pane.composer_snapshot(), stored);
    }

    #[test]
    fn recapturing_empty_input_replaces_stale_draft_and_missing_thread_is_a_noop() {
        let mut app = App::default();
        app.chat_widget.bottom_pane.insert_str("unbound");
        app.capture_current_thread_input();
        assert!(app.chat_widget.thread_input_states.is_empty());
        app.set_thread_id("root".into());
        app.capture_current_thread_input();
        app.chat_widget.bottom_pane.set_composer_text(String::new());
        app.capture_current_thread_input();
        app.restore_thread_input("root");
        assert!(app.chat_widget.bottom_pane.composer_is_empty());
    }
}
