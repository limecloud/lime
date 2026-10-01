use crate::app::{App, AppAction};
use crate::tui::TuiEvent;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

#[test]
fn asynchronous_submission_recovery_updates_stored_draft_without_cancelling_search() {
    let mut app = App::default();
    app.composer.set_cached_history(["history match".into()]);
    app.composer.insert("draft");
    app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL)),
        true,
    );
    app.handle_tui_event(TuiEvent::Paste("match".into()), true);
    app.restore_submission_draft(
        "recovered".into(),
        Vec::new(),
        Vec::new(),
        Vec::new(),
        Vec::new(),
    );
    assert!(app.composer.history_search_active());
    assert_eq!(app.composer.history_search_query(), Some("match"));
    assert_eq!(app.composer.text(), "history match");
    app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE)),
        true,
    );
    assert_eq!(app.composer.text(), "recovered");
}

#[test]
fn connected_history_search_routes_paste_to_query_not_draft_or_turn() {
    let mut app = App::default();
    app.composer.set_cached_history(["old\n界 prompt".into()]);
    app.composer.insert("unsent draft");
    let draft = app.composer.snapshot_draft();
    app.start_turn("turn-current".into());
    let result = app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL)),
        true,
    );
    assert_eq!(result, AppAction::None);
    assert!(app.composer.history_search_active());
    assert_eq!(
        app.handle_tui_event(TuiEvent::Paste("old\r\n界".into()), true),
        AppAction::None
    );
    assert_eq!(app.composer.history_search_query(), Some("old\n界"));
    assert_eq!(app.composer.text(), "old\n界 prompt");
    assert_eq!(app.projection.active_turn_id(), Some("turn-current"));
    assert_eq!(
        app.handle_tui_event(
            TuiEvent::Key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE)),
            true
        ),
        AppAction::None
    );
    assert_eq!(app.composer.snapshot_draft(), draft);
    assert_eq!(app.projection.active_turn_id(), Some("turn-current"));
}
