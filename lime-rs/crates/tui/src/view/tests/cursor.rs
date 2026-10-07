use super::*;
use crossterm::cursor::SetCursorStyle;

fn input(app: &mut App, code: KeyCode) {
    dispatch_connected_input(app, Event::Key(KeyEvent::new(code, KeyModifiers::NONE)));
}

fn vim_insert_app() -> App {
    let mut app = App::default();
    app.chat_widget.bottom_pane.set_vim_enabled(true);
    input(&mut app, KeyCode::Char('i'));
    app
}

#[test]
fn cursor_style_tracks_vim_insert_normal_and_replace_transitions() {
    let mut app = App::default();
    assert_eq!(cursor_style(&app), SetCursorStyle::DefaultUserShape);
    app.chat_widget.bottom_pane.set_vim_enabled(true);
    assert_eq!(cursor_style(&app), SetCursorStyle::DefaultUserShape);
    input(&mut app, KeyCode::Char('i'));
    assert_eq!(cursor_style(&app), SetCursorStyle::SteadyBar);
    input(&mut app, KeyCode::Esc);
    assert_eq!(cursor_style(&app), SetCursorStyle::DefaultUserShape);
    input(&mut app, KeyCode::Char('R'));
    assert_eq!(cursor_style(&app), SetCursorStyle::DefaultUserShape);
    input(&mut app, KeyCode::Esc);
    input(&mut app, KeyCode::Char('i'));
    assert_eq!(cursor_style(&app), SetCursorStyle::SteadyBar);
}

#[test]
fn cursor_style_belongs_to_export_focus_and_restores_the_retained_composer() {
    let mut app = vim_insert_app();
    app.chat_widget.show_transcript_export_popup(None);
    assert_eq!(cursor_style(&app), SetCursorStyle::DefaultUserShape);
    input(&mut app, KeyCode::Char('2'));
    assert_eq!(cursor_style(&app), SetCursorStyle::SteadyBar);
    input(&mut app, KeyCode::Esc);
    assert_eq!(cursor_style(&app), SetCursorStyle::DefaultUserShape);
    input(&mut app, KeyCode::Esc);
    assert_eq!(cursor_style(&app), SetCursorStyle::DefaultUserShape);
    input(&mut app, KeyCode::Esc);
    assert!(app.chat_widget.export_picker.is_none());
    assert_eq!(cursor_style(&app), SetCursorStyle::SteadyBar);
}

#[test]
fn cursor_style_of_a_hidden_insert_composer_does_not_leak_into_pagers() {
    let mut app = vim_insert_app();
    app.chat_widget.open_transcript_pager();
    assert_eq!(cursor_style(&app), SetCursorStyle::DefaultUserShape);
    app.chat_widget.dismiss_pager_overlay();
    assert_eq!(cursor_style(&app), SetCursorStyle::SteadyBar);
}

#[test]
fn cursor_style_of_a_hidden_insert_composer_does_not_leak_into_approval() {
    let mut app = vim_insert_app();
    app.chat_widget
        .bottom_pane
        .enqueue(ServerRequest::ItemCommandExecutionRequestApproval {
            id: RequestId::Integer(1),
            params: CommandExecutionRequestApprovalParams {
                thread_id: "thread-cursor".into(),
                turn_id: "turn-cursor".into(),
                item_id: "item-cursor".into(),
                started_at_ms: 1,
                approval_id: None,
                network_approval_context: None,
                command: Some("printf cursor".into()),
                cwd: None,
                reason: None,
                available_decisions: None,
            },
        })
        .unwrap();
    assert_eq!(cursor_style(&app), SetCursorStyle::DefaultUserShape);
    input(&mut app, KeyCode::Esc);
    assert!(!app.chat_widget.bottom_pane.is_active());
    assert_eq!(cursor_style(&app), SetCursorStyle::SteadyBar);
}
