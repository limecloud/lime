use super::*;
use crate::{keymap::RuntimeKeymap, locale::Locale, tui::TuiEvent};
use app_server_protocol::protocol::v2::ThreadNameUpdatedNotification;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::{backend::TestBackend, Terminal};

fn app() -> App {
    let mut app = App::default();
    app.set_cwd("/workspace/界".into());
    app.set_thread_id("thread-status".into());
    app.chat_widget.model = Some("fixture-model".into());
    app.chat_widget.reasoning_effort = Some("high".into());
    app
}
fn key(app: &mut App, code: KeyCode, modifiers: KeyModifiers) -> AppAction {
    app.handle_tui_event(TuiEvent::Key(KeyEvent::new(code, modifiers)), true)
}
fn screen(app: &App) -> String {
    let mut terminal = Terminal::new(TestBackend::new(100, 24)).unwrap();
    terminal
        .draw(|frame| crate::view::render(frame, app))
        .unwrap();
    let buffer = terminal.backend().buffer();
    (0..24)
        .map(|y| {
            (0..100)
                .map(|x| buffer[(x, y)].symbol())
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn status_line_slash_cancel_is_side_effect_free_and_confirm_returns_only_a_host_action() {
    let mut app = app();
    let keymap =
        serde_json::from_value(json!({"list": {"accept": "f9", "cancel": "ctrl-x q"}})).unwrap();
    app.set_runtime_keymap(RuntimeKeymap::from_config(&keymap).unwrap());
    let original = app.chat_widget.tui_config.clone();
    app.chat_widget.bottom_pane.insert_str("/statusline");
    assert_eq!(
        key(&mut app, KeyCode::Enter, KeyModifiers::NONE),
        AppAction::None
    );
    assert!(screen(&app).contains("Configure status line"));
    key(&mut app, KeyCode::Char(' '), KeyModifiers::NONE);
    key(&mut app, KeyCode::Char('x'), KeyModifiers::CONTROL);
    key(&mut app, KeyCode::Char('q'), KeyModifiers::NONE);
    assert!(app.chat_widget.status_line_setup.is_none());
    assert_eq!(app.chat_widget.tui_config, original);
    app.chat_widget.show_status_line_setup();
    assert!(matches!(
        key(&mut app, KeyCode::F(9), KeyModifiers::NONE),
        AppAction::StatusLineSetup { .. }
    ));
    assert_eq!(
        app.chat_widget.tui_config, original,
        "unacknowledged action must not mutate preferences"
    );
    assert!(app.chat_widget.bottom_pane.composer_text().is_empty());
    assert!(app.projection.active_turn_id().is_none());
}

#[test]
fn status_line_modal_blocks_underlying_raw_toggle_and_protected_ctrl_c_only_closes_it() {
    let mut app = app();
    app.chat_widget.show_status_line_setup();
    assert_eq!(
        key(&mut app, KeyCode::Char('r'), KeyModifiers::ALT),
        AppAction::None
    );
    assert!(!app.raw_output_mode());
    assert_eq!(
        key(&mut app, KeyCode::Char('c'), KeyModifiers::CONTROL),
        AppAction::None
    );
    assert!(app.chat_widget.status_line_setup.is_none());
}

#[test]
fn status_line_footer_defaults_and_explicit_empty_preserve_queue_hint_priority() {
    let mut app = app();
    assert!(screen(&app)
        .lines()
        .last()
        .unwrap()
        .contains("fixture-model high · /workspace/界"));
    app.chat_widget.bottom_pane.insert_str("draft");
    assert!(screen(&app)
        .lines()
        .last()
        .unwrap()
        .contains("fixture-model high"));
    app.start_turn("turn-status".into());
    assert!(screen(&app)
        .lines()
        .last()
        .unwrap()
        .contains(Locale::EnUs.queue_message_hint()));
    app.chat_widget.bottom_pane.set_composer_text(String::new());
    app.chat_widget.tui_config.status_line = Some(vec![]);
    assert!(screen(&app)
        .lines()
        .last()
        .unwrap()
        .contains(Locale::EnUs.shortcuts_hint()));
    app.chat_widget.tui_config.status_line = Some(vec!["unknown".into()]);
    assert!(
        screen(&app).lines().last().unwrap().trim().is_empty(),
        "enabled but unavailable status facts must not become the disabled layout"
    );
}

#[test]
fn status_line_thread_names_follow_canonical_identity_and_clear_on_unset() {
    let mut app = app();
    app.apply_notification(ServerNotification::ThreadNameUpdated(
        ThreadNameUpdatedNotification {
            thread_id: "thread-status".into(),
            thread_name: Some("真实线程".into()),
        },
    ));
    assert_eq!(
        app.status_surface_data().thread_name.as_deref(),
        Some("真实线程")
    );
    app.apply_notification(ServerNotification::ThreadNameUpdated(
        ThreadNameUpdatedNotification {
            thread_id: "background".into(),
            thread_name: Some("后台名称".into()),
        },
    ));
    assert_eq!(
        app.status_surface_data().thread_name.as_deref(),
        Some("真实线程")
    );
    app.set_thread_id("new-thread".into());
    assert!(app.status_surface_data().thread_name.is_none());
    app.set_thread_id("thread-status".into());
    app.apply_notification(ServerNotification::ThreadNameUpdated(
        ThreadNameUpdatedNotification {
            thread_id: "thread-status".into(),
            thread_name: None,
        },
    ));
    assert!(app.status_surface_data().thread_name.is_none());
}

#[test]
fn task_progress_follows_current_typed_events_and_foreign_thread_replay() {
    let mut app = app();
    let update = |thread_id, completed: bool| {
        serde_json::from_value(json!({
        "method": "turn/plan/updated", "params": {"threadId": thread_id, "turnId": "turn-plan", "explanation": null,
            "plan": [{"step": "typed completed step", "status": "completed"}, {"step": "pending text [x]", "status": if completed { "completed" } else { "pending" }}]}
    })).unwrap()
    };
    app.apply_notification(update("thread-status", false));
    assert_eq!(app.status_surface_data().task_progress, Some((1, 2)));
    app.apply_notification(update("background", true));
    assert_eq!(
        app.status_surface_data().task_progress,
        Some((1, 2)),
        "foreign plan must stay buffered"
    );
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        app.set_locale(locale);
        app.chat_widget.tui_config.status_line = Some(vec!["task-progress".into()]);
        app.chat_widget.tui_config.terminal_title = Some(vec!["task-progress".into()]);
        let expected = locale.task_progress_value(1, 2);
        assert_eq!(
            app.terminal_title_text(std::time::Instant::now()).unwrap(),
            expected
        );
        assert_eq!(
            app.status_surface_data()
                .line(&["task-progress".into()], false, locale)
                .unwrap()
                .to_string(),
            expected
        );
        assert!(screen(&app)
            .replace(' ', "")
            .contains(&expected.replace(' ', "")));
    }
    app.set_thread_id("background".into());
    assert!(app.status_surface_data().task_progress.is_none());
    let snapshot = app.take_thread_event_snapshot("background", false);
    app.replay_thread_snapshot(snapshot);
    assert_eq!(app.status_surface_data().task_progress, Some((2, 2)));
    app.set_thread_id("fresh-thread".into());
    assert!(app.terminal_title_text(std::time::Instant::now()).is_none());
    app.apply_notification(serde_json::from_value(json!({
        "method": "turn/plan/updated", "params": {"threadId": "fresh-thread", "turnId": "empty-plan", "plan": []}
    })).unwrap());
    assert!(app.status_surface_data().task_progress.is_none());
}
