use super::*;
use crate::locale::Locale;
use app_server_protocol::protocol::v2::ServerRequest;
use app_server_protocol::protocol::v2::{ServerNotification, ThreadNameUpdatedNotification};
use serde_json::json;
use std::time::Duration;

fn app() -> App {
    let mut app = App::default();
    app.set_cwd(std::path::Path::new("workspace").join("项目"));
    app.set_thread_id("thread-title".into());
    app
}

fn rename(app: &mut App, id: &str, name: Option<&str>) {
    app.apply_notification(ServerNotification::ThreadNameUpdated(
        ThreadNameUpdatedNotification {
            thread_id: id.into(),
            thread_name: name.map(str::to_string),
        },
    ));
}

#[test]
fn title_tracks_canonical_name_and_current_thread_without_foreign_name_leaks() {
    let now = Instant::now();
    let mut app = app();
    assert_eq!(app.terminal_title_text(now).as_deref(), Some("项目"));
    rename(&mut app, "thread-title", Some("当前\n线程\u{202e}\x07"));
    rename(&mut app, "thread-other", Some("其它线程"));
    assert_eq!(
        app.terminal_title_text(now).as_deref(),
        Some("当前 线程 | 项目")
    );
    app.set_thread_id("thread-other".into());
    assert_eq!(
        app.terminal_title_text(now).as_deref(),
        Some("项目"),
        "foreign metadata stays buffered until the canonical thread handoff"
    );
    let snapshot = app.take_thread_event_snapshot("thread-other", false);
    app.replay_thread_snapshot(snapshot);
    assert_eq!(
        app.terminal_title_text(now).as_deref(),
        Some("其它线程 | 项目")
    );
    rename(&mut app, "thread-other", None);
    assert_eq!(app.terminal_title_text(now).as_deref(), Some("项目"));
    app.set_cwd(std::path::PathBuf::new());
    assert_eq!(
        app.terminal_title_text(now),
        None,
        "missing facts must not produce a fake context"
    );
    rename(&mut app, "thread-other", Some("\u{200b}\x07"));
    assert_eq!(
        app.terminal_title_text(now),
        None,
        "an invisible name must not create a separator"
    );
}

#[test]
fn activity_uses_the_existing_turn_clock_and_stops_on_canonical_completion() {
    let mut app = app();
    app.start_turn("turn-title".into());
    let start = app
        .chat_widget
        .turn_lifecycle
        .active_turn_started_at
        .unwrap();
    assert_eq!(app.terminal_title_text(start).as_deref(), Some("⠋ 项目"));
    assert_eq!(
        app.terminal_title_text(start + Duration::from_millis(100))
            .as_deref(),
        Some("⠙ 项目")
    );
    app.apply_notification(serde_json::from_value(json!({
        "method": "turn/completed",
        "params": {"threadId": "thread-title", "turn": {"id": "turn-title", "items": [], "status": "completed", "error": null}}
    })).unwrap());
    assert_eq!(
        app.terminal_title_text(start + Duration::from_secs(2))
            .as_deref(),
        Some("项目")
    );
    assert!(app.projection.active_turn_id().is_none());
}

#[test]
fn protected_request_changes_activity_to_localized_action_required_until_resolved() {
    let mut app = app();
    app.start_turn("turn-title".into());
    let start = app
        .chat_widget
        .turn_lifecycle
        .active_turn_started_at
        .unwrap();
    let request: ServerRequest = serde_json::from_value(json!({
        "method": "item/tool/requestUserInput", "id": 31,
        "params": {"threadId": "thread-title", "turnId": "turn-title", "itemId": "question-title",
            "questions": [{"id": "mode", "header": "Mode", "question": "Choose", "isOther": false, "isSecret": false,
                "options": [{"label": "Yes", "description": "Continue"}]}],
            "isBlocking": true}
    })).unwrap();
    app.chat_widget.bottom_pane.enqueue(request).unwrap();
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        app.set_locale(locale);
        let expected = format!("[ ! ] {} 项目", locale.action_required_label());
        assert_eq!(
            app.terminal_title_text(start).as_deref(),
            Some(expected.as_str()),
            "{locale:?}"
        );
        assert!(app
            .terminal_title_text(start + Duration::from_secs(1))
            .unwrap()
            .starts_with("[ . ]"));
    }
    let response = app.handle_tui_event(
        crate::tui::TuiEvent::Key(crossterm::event::KeyEvent::new(
            crossterm::event::KeyCode::Enter,
            crossterm::event::KeyModifiers::NONE,
        )),
        true,
    );
    assert!(matches!(response, super::super::AppAction::Respond(_)));
    assert!(!app.chat_widget.bottom_pane.is_active());
    assert_eq!(app.terminal_title_text(start).as_deref(), Some("⠋ 项目"));
}

#[test]
fn title_slash_live_preview_cancel_and_confirm_do_not_mutate_unacknowledged_config() {
    use crate::tui::TuiEvent;
    use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
    let now = Instant::now();
    let mut app = app();
    let original = app.chat_widget.tui_config.clone();
    app.set_runtime_keymap(
        crate::keymap::RuntimeKeymap::from_config(
            &serde_json::from_value(json!({
                "list": {"accept": "f9", "cancel": "ctrl-x q"}
            }))
            .unwrap(),
        )
        .unwrap(),
    );
    let key = |app: &mut App, code, modifiers| {
        app.handle_tui_event(TuiEvent::Key(KeyEvent::new(code, modifiers)), true)
    };
    app.chat_widget.bottom_pane.insert_str("/title");
    assert_eq!(
        key(&mut app, KeyCode::Enter, KeyModifiers::NONE),
        AppAction::None
    );
    assert!(app.chat_widget.terminal_title_setup.is_some());
    key(&mut app, KeyCode::Down, KeyModifiers::NONE);
    key(&mut app, KeyCode::Down, KeyModifiers::NONE);
    key(&mut app, KeyCode::Char(' '), KeyModifiers::NONE);
    assert!(
        app.terminal_title_text(now).is_none(),
        "temporary selection previews disabled output"
    );
    assert_eq!(app.chat_widget.tui_config, original);
    assert_eq!(
        key(&mut app, KeyCode::Char('r'), KeyModifiers::ALT),
        AppAction::None
    );
    assert!(!app.raw_output_mode());
    assert!(app
        .prepare_reasoning_shortcut(crate::model_catalog::ReasoningShortcutDirection::Raise)
        .is_none());
    key(&mut app, KeyCode::Char('x'), KeyModifiers::CONTROL);
    key(&mut app, KeyCode::Char('q'), KeyModifiers::NONE);
    assert!(app.chat_widget.terminal_title_setup.is_none());
    assert_eq!(app.terminal_title_text(now).as_deref(), Some("项目"));
    app.chat_widget.show_terminal_title_setup();
    key(&mut app, KeyCode::Char(' '), KeyModifiers::NONE);
    assert_eq!(
        key(&mut app, KeyCode::Enter, KeyModifiers::NONE),
        AppAction::None
    );
    assert_eq!(
        key(&mut app, KeyCode::F(9), KeyModifiers::NONE),
        AppAction::TerminalTitleSetup {
            items: vec!["thread-name".into(), "project-name".into()]
        }
    );
    assert_eq!(app.chat_widget.tui_config, original);
    assert!(app.chat_widget.bottom_pane.composer_text().is_empty());
    assert!(app.projection.active_turn_id().is_none());
}

#[test]
fn title_ctrl_c_disconnect_and_hydrate_restore_saved_selection_without_inventing_activity() {
    use crate::tui::TuiEvent;
    use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
    let mut app = app();
    let now = Instant::now();
    app.chat_widget.tui_config.terminal_title = Some(vec!["app-name".into()]);
    app.chat_widget.show_terminal_title_setup();
    app.handle_tui_event(
        TuiEvent::Key(KeyEvent::new(KeyCode::Char(' '), KeyModifiers::NONE)),
        true,
    );
    assert!(app.terminal_title_text(now).is_none());
    assert_eq!(
        app.handle_tui_event(
            TuiEvent::Key(KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL)),
            true
        ),
        AppAction::None
    );
    assert_eq!(app.terminal_title_text(now).as_deref(), Some("lime"));
    app.chat_widget.show_terminal_title_setup();
    app.clear_connection_interactions();
    assert!(app.chat_widget.terminal_title_setup.is_none());
    assert_eq!(app.terminal_title_text(now).as_deref(), Some("lime"));
    app.chat_widget.show_terminal_title_setup();
    app.chat_widget.reset_for_hydrated_thread();
    assert!(app.chat_widget.terminal_title_setup.is_none());
    assert_eq!(app.terminal_title_text(now).as_deref(), Some("lime"));
    app.chat_widget.tui_config.terminal_title = Some(vec![]);
    app.start_turn("turn-disabled-title".into());
    assert!(
        app.terminal_title_text(now).is_none(),
        "disabled titles must remain disabled during a turn"
    );
}

#[test]
fn title_view_owns_the_visible_input_and_preview_above_the_transcript() {
    use ratatui::{backend::TestBackend, Terminal};
    let mut app = app();
    app.chat_widget.bottom_pane.set_vim_enabled(true);
    app.chat_widget.bottom_pane.insert_str("retained draft");
    app.chat_widget.show_terminal_title_setup();
    assert_eq!(
        crate::view::cursor_style(&app),
        crossterm::cursor::SetCursorStyle::DefaultUserShape
    );
    let mut terminal = Terminal::new(TestBackend::new(80, 24)).unwrap();
    terminal
        .draw(|frame| crate::view::render(frame, &app))
        .unwrap();
    let screen = (0..24)
        .map(|y| {
            (0..80)
                .map(|x| terminal.backend().buffer()[(x, y)].symbol())
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("\n");
    assert!(screen.contains("Configure terminal title"));
    assert!(screen
        .lines()
        .last()
        .unwrap()
        .replace(' ', "")
        .contains("Preview:项目"));
    assert!(
        !screen.contains("retained draft"),
        "hidden composer must not paint over the setup"
    );
    assert!(!screen.contains("? for shortcuts"));
    app.handle_terminal_title_setup_event(&crossterm::event::Event::Key(
        crossterm::event::KeyEvent::new(
            crossterm::event::KeyCode::Esc,
            crossterm::event::KeyModifiers::NONE,
        ),
    ));
    assert_eq!(
        app.chat_widget.bottom_pane.composer_text(),
        "retained draft"
    );
}
