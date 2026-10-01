//! Thread handoff retains rich composer input and the same unresolved interaction views.

use super::App;
use crate::bottom_pane::{BottomPaneInputState, ComposerDraft};

#[derive(Debug, Default)]
pub(super) struct ThreadInputState {
    composer: ComposerDraft,
    bottom_pane: BottomPaneInputState,
}

impl App {
    pub(crate) fn capture_current_thread_input(&mut self) {
        let Some(thread_id) = self.thread_id.clone() else {
            return;
        };
        self.composer.flush_paste_burst_before_handoff();
        self.thread_input_states.insert(
            thread_id,
            ThreadInputState {
                composer: self.composer.draft_snapshot(),
                bottom_pane: self.bottom_pane.take_input_state(),
            },
        );
    }

    pub(crate) fn restore_thread_input(&mut self, thread_id: &str) {
        let state = self
            .thread_input_states
            .remove(thread_id)
            .unwrap_or_default();
        self.composer
            .restore_thread_input_state(state.composer, &self.runtime_keymap);
        self.bottom_pane.restore_input_state(state.bottom_pane);
        self.startup_pending_protected_request = self.bottom_pane.is_active();
        self.sync_completion_popup();
    }

    pub(super) fn observe_thread_input_notification(
        &mut self,
        thread_id: &str,
        notification: &app_server_protocol::protocol::v2::ServerNotification,
    ) {
        if self.thread_id.as_deref() == Some(thread_id) {
            self.bottom_pane.observe_notification(notification);
            if !self.bottom_pane.is_active() {
                self.startup_pending_protected_request = false;
            }
        } else if let Some(state) = self.thread_input_states.get_mut(thread_id) {
            state.bottom_pane.observe_notification(notification);
        }
    }

    pub(super) fn clear_connection_interactions(&mut self) {
        self.bottom_pane.clear();
        for state in self.thread_input_states.values_mut() {
            state.bottom_pane.clear();
        }
        self.thread_event_channels.clear();
        self.startup_pending_protected_request = false;
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
            app.composer.handle_paste(&"界🙂".repeat(501));
            app.composer.insert(" suffix");
            app.composer.attach_image(PathBuf::from("root.png"));
            app.composer
                .set_remote_image_urls(vec!["https://example.test/root.png".into()]);
            app.composer
                .handle_key_event(KeyEvent::new(KeyCode::Left, KeyModifiers::NONE));
            let root = app.composer.snapshot_draft();
            let root_text = app.composer.current_text_with_pending();
            app.open_agents_overview();
            assert_eq!(
                app.composer.snapshot_draft(),
                root,
                "opening Agent Center must not alter the live draft"
            );
            app.agents_overview = None;
            app.capture_current_thread_input();
            app.set_thread_id("child".into());
            app.restore_thread_input("child");
            assert!(app.composer.is_empty());
            assert!(
                !app.composer.has_pending_images(),
                "an unseen thread must not inherit root images"
            );
            app.composer.insert("child draft");
            app.composer.attach_image(PathBuf::from("child.png"));
            let child = app.composer.snapshot_draft();
            app.capture_current_thread_input();
            app.set_thread_id("root".into());
            app.restore_thread_input("root");
            assert_eq!(app.composer.snapshot_draft(), root, "{locale:?} root draft");
            assert_eq!(app.composer.current_text_with_pending(), root_text);
            assert!(
                !app.thread_input_states.contains_key("root"),
                "the active composer is the sole live owner"
            );
            app.capture_current_thread_input();
            app.set_thread_id("child".into());
            app.restore_thread_input("child");
            assert_eq!(
                app.composer.snapshot_draft(),
                child,
                "{locale:?} child draft"
            );
        }
    }

    #[test]
    fn thread_capture_uses_saved_draft_not_search_preview() {
        let mut app = App::default();
        app.set_thread_id("root".into());
        app.composer.set_cached_history(["history match".into()]);
        app.composer.insert("original");
        app.composer
            .handle_key_event(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL));
        app.composer.handle_paste("match");
        app.attach_image(PathBuf::from("background.png"));
        let stored = app.composer.draft_snapshot();
        assert_eq!(app.composer.text(), "history match");
        app.capture_current_thread_input();
        assert_eq!(app.thread_input_states["root"].composer, stored);
        app.set_thread_id("child".into());
        app.restore_thread_input("child");
        app.set_thread_id("root".into());
        app.restore_thread_input("root");
        assert_eq!(app.composer.snapshot_draft(), stored);
    }

    #[test]
    fn recapturing_empty_input_replaces_stale_draft_and_missing_thread_is_a_noop() {
        let mut app = App::default();
        app.composer.insert("unbound");
        app.capture_current_thread_input();
        assert!(app.thread_input_states.is_empty());
        app.set_thread_id("root".into());
        app.capture_current_thread_input();
        app.composer.replace(String::new());
        app.capture_current_thread_input();
        app.restore_thread_input("root");
        assert!(app.composer.is_empty());
    }
}
