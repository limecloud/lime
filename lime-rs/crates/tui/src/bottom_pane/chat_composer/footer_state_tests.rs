use crate::app::{App, AppAction};
use crate::bottom_pane::{ChatComposer, InputResult};
use crate::tui::TuiEvent;
use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use std::time::Instant;

fn key(code: KeyCode) -> KeyEvent {
    KeyEvent::new(code, KeyModifiers::NONE)
}

#[test]
fn shift_question_mark_toggles_shortcut_overlay_when_empty() {
    for modifiers in [KeyModifiers::NONE, KeyModifiers::SHIFT] {
        let mut composer = ChatComposer::default();
        assert_eq!(
            composer.handle_key_event(KeyEvent::new(KeyCode::Char('?'), modifiers)),
            InputResult::Changed
        );
        assert!(composer.shortcut_overlay_visible());
        assert!(composer.is_empty());
        composer.handle_key_event(KeyEvent::new(KeyCode::Char('?'), modifiers));
        assert!(!composer.shortcut_overlay_visible());
        assert!(composer.is_empty());
    }
}

#[test]
fn question_mark_in_draft_and_bracketed_paste_remains_literal() {
    let mut composer = ChatComposer::default();
    composer.insert("draft");
    composer.handle_key_event(key(KeyCode::Char('?')));
    assert_eq!(composer.text(), "draft?");
    composer.replace(String::new());
    composer.handle_key_event(key(KeyCode::Char('?')));
    assert!(composer.shortcut_overlay_visible());
    composer.handle_paste("? pasted");
    assert_eq!(composer.text(), "? pasted");
    assert!(!composer.shortcut_overlay_visible());
}

#[test]
fn question_mark_does_not_toggle_during_paste_burst() {
    let mut composer = ChatComposer::default();
    let now = Instant::now();
    composer.draft.paste_burst.on_plain_char('a', now);
    composer.handle_key_event_at(
        key(KeyCode::Char('?')),
        now + std::time::Duration::from_millis(1),
    );
    assert!(!composer.shortcut_overlay_visible());
    composer.handle_paste_burst_flush(now + std::time::Duration::from_secs(1));
    assert_eq!(composer.text(), "a?");
}

#[test]
fn overlay_does_not_capture_attachments_vim_search_or_release() {
    let mut composer = ChatComposer::default();
    let mut release = key(KeyCode::Char('?'));
    release.kind = KeyEventKind::Release;
    composer.handle_key_event(release);
    assert!(!composer.shortcut_overlay_visible());
    composer.attach_image(std::path::PathBuf::from("/tmp/image.png"));
    composer.handle_key_event(key(KeyCode::Char('?')));
    assert_eq!(composer.text(), "[Image #1]?");
    assert!(!composer.shortcut_overlay_visible());

    let mut composer = ChatComposer::default();
    composer.set_vim_enabled(true);
    composer.handle_key_event(key(KeyCode::Char('?')));
    assert!(composer.vim_search_active());
    assert!(!composer.shortcut_overlay_visible());
}

#[test]
fn typing_from_overlay_resumes_editor_and_popup_owner() {
    let mut composer = ChatComposer::default();
    composer.handle_key_event(key(KeyCode::Char('?')));
    composer.handle_key_event(key(KeyCode::Char('/')));
    composer.sync_completion_popup();
    assert_eq!(composer.text(), "/");
    assert!(composer.completion_popup_active());
    assert!(!composer.shortcut_overlay_visible());
}

#[test]
fn overlay_escape_closes_help_before_active_turn_interrupt_or_scroll() {
    let mut app = App::default();
    app.start_turn("canonical-turn".into());
    app.scroll_up(5);
    let scroll = app.chat_widget.transcript_scroll;
    app.handle_tui_event(TuiEvent::Key(key(KeyCode::Char('?'))), true);
    assert!(app
        .chat_widget
        .bottom_pane
        .composer
        .shortcut_overlay_visible());
    assert_eq!(
        app.handle_tui_event(TuiEvent::Key(key(KeyCode::Esc)), true),
        AppAction::None
    );
    assert_eq!(app.chat_widget.transcript_scroll, scroll);
    assert!(!app
        .chat_widget
        .bottom_pane
        .composer
        .shortcut_overlay_visible());
    app.scroll_bottom();
    assert_eq!(
        app.handle_tui_event(TuiEvent::Key(key(KeyCode::Esc)), true),
        AppAction::Interrupt
    );
    assert_eq!(app.projection.active_turn_id(), Some("canonical-turn"));
}

#[test]
fn history_search_keeps_question_mark_in_query() {
    let mut composer = ChatComposer::default();
    composer.handle_key_event(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL));
    composer.handle_key_event(key(KeyCode::Char('?')));
    assert!(composer.history_search_active());
    assert_eq!(composer.history_search_query(), Some("?"));
    assert!(!composer.shortcut_overlay_visible());
}
