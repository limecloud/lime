use super::*;
use crate::app::AppAction;
use crate::locale::Locale;
use crate::tui::TuiEvent;
use app_server_protocol::protocol::v2::{AgentMessageDeltaNotification, ServerNotification};
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::backend::TestBackend;
use ratatui::Terminal;

fn key(app: &mut App, code: KeyCode) -> AppAction {
    app.handle_tui_event(TuiEvent::Key(KeyEvent::new(code, KeyModifiers::NONE)), true)
}

fn app(locale: Locale) -> App {
    let mut app = App {
        thread_id: Some("thread-status-1".into()),
        ..App::default()
    };
    app.chat_widget.set_locale(locale);
    app.chat_widget.model = Some("model-before".into());
    app.chat_widget
        .set_status_thread_name("thread-status-1".into(), Some("named thread 😀".into()));
    app.cwd = std::path::PathBuf::from("/workspace/original 目录");
    app.chat_widget
        .bottom_pane
        .set_composer_text("/status".into());
    assert_eq!(key(&mut app, KeyCode::Enter), AppAction::None);
    assert!(app.chat_widget.pager_overlay.is_some());
    app
}

fn screen(app: &App, width: u16, height: u16) -> String {
    let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
    terminal
        .draw(|frame| crate::view::render(frame, app))
        .unwrap();
    let buffer = terminal.backend().buffer();
    (0..height)
        .map(|row| {
            (0..width)
                .filter_map(|column| {
                    let cell = &buffer[(column, row)];
                    let continuation = column > 0
                        && crate::width::display_width(buffer[(column - 1, row)].symbol()) > 1;
                    (!continuation).then(|| cell.symbol().to_owned())
                })
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn open_copy(app: &mut App) {
    key(app, KeyCode::Esc);
    app.chat_widget
        .bottom_pane
        .set_composer_text("/copy".into());
    assert_eq!(key(app, KeyCode::Enter), AppAction::SelectTranscriptCopy);
    app.select_transcript_copy();
    assert!(app.chat_widget.copy_picker.is_some());
}

#[test]
fn status_copy_picker_uses_real_app_input_and_the_displayed_snapshot() {
    let mut app = app(Locale::EnUs);
    let status = screen(&app, 100, 24);
    assert!(status.contains("model-before") && status.contains("named thread 😀"));
    app.chat_widget.model = Some("model-after".into());
    app.cwd = std::path::PathBuf::from("/workspace/after");
    open_copy(&mut app);
    let picker = screen(&app, 100, 24);
    for label in [
        "Copy to clipboard",
        "Whole status",
        "Model",
        "Directory",
        "Thread name",
        "Session ID",
    ] {
        assert!(picker.contains(label), "{label}: {picker}");
    }
    let AppAction::CopySelection {
        text,
        label,
        format,
    } = key(&mut app, KeyCode::Enter)
    else {
        panic!("whole status must dispatch through the shared clipboard action")
    };
    assert_eq!(format, CopyFormat::PlainText);
    assert_eq!(label, "Whole status");
    assert!(text.contains("model-before") && text.contains("named thread 😀"));
    assert!(text.contains("/workspace/original 目录") && text.contains("thread-status-1"));
    assert!(!text.contains("model-after") && !text.contains("/workspace/after"));
    assert!(app.chat_widget.copy_picker.is_none());
    assert_eq!(app.projection.active_turn_id(), None);
}

#[test]
fn cancellation_and_resize_preserve_the_rich_draft_and_picker_navigation() {
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        let mut app = app(locale);
        key(&mut app, KeyCode::Esc);
        app.chat_widget.bottom_pane.insert_str("draft 界😀");
        app.select_transcript_copy();
        let wide = screen(&app, 100, 24);
        assert!(wide.contains(locale.copy_picker_title()));
        for (width, height) in [(24, 12), (12, 4), (2, 2), (1, 1), (100, 24)] {
            screen(&app, width, height);
        }
        assert!(!app.composer_owns_clipboard());
        assert_eq!(
            crate::view::cursor_style(&app),
            crossterm::cursor::SetCursorStyle::DefaultUserShape
        );
        assert_eq!(key(&mut app, KeyCode::Esc), AppAction::None);
        assert_eq!(app.chat_widget.bottom_pane.composer_text(), "draft 界😀");
        assert!(app.composer_owns_clipboard());
    }
}

#[test]
fn a_new_approval_owns_input_and_rendering_before_the_status_copy_picker() {
    use app_server_protocol::protocol::v2::{CommandExecutionRequestApprovalParams, ServerRequest};
    use app_server_protocol::RequestId;

    let mut app = app(Locale::EnUs);
    open_copy(&mut app);
    app.chat_widget
        .bottom_pane
        .enqueue(ServerRequest::ItemCommandExecutionRequestApproval {
            id: RequestId::Integer(107),
            params: CommandExecutionRequestApprovalParams {
                thread_id: "thread-status-1".into(),
                turn_id: "turn-approval".into(),
                item_id: "item-approval".into(),
                started_at_ms: 1,
                approval_id: None,
                network_approval_context: None,
                command: Some("VISIBLE_APPROVAL_OWNER".into()),
                cwd: Some("/workspace".into()),
                reason: None,
                available_decisions: None,
            },
        })
        .unwrap();
    let visible = screen(&app, 100, 24);
    assert!(visible.contains("VISIBLE_APPROVAL_OWNER"));
    assert!(!visible.contains("Copy to clipboard"));
    assert!(!matches!(
        key(&mut app, KeyCode::Enter),
        AppAction::CopySelection { .. }
    ));
    assert!(app.chat_widget.copy_picker.is_some());
}

#[test]
fn the_copy_picker_contains_global_raw_keys_and_paste_at_the_app_surface_boundary() {
    let mut app = app(Locale::EnUs);
    open_copy(&mut app);
    app.chat_widget.bottom_pane.insert_str("keep draft");
    let raw_before = app.chat_widget.is_raw_output_mode();
    assert_eq!(
        app.handle_tui_event(
            TuiEvent::Key(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::ALT)),
            true
        ),
        AppAction::None
    );
    assert_eq!(app.chat_widget.is_raw_output_mode(), raw_before);
    assert_eq!(
        app.handle_tui_event(TuiEvent::Paste("SHOULD_NOT_SUBMIT".into()), true),
        AppAction::None
    );
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), "keep draft");
    assert!(app.chat_widget.copy_picker.is_some());
}

#[test]
fn an_active_copy_picker_consumes_repeat_accept_without_copying_or_submitting_the_draft() {
    use crossterm::event::KeyEventKind;
    let mut app = app(Locale::EnUs);
    open_copy(&mut app);
    app.chat_widget.bottom_pane.insert_str("preserved draft");
    assert_eq!(
        app.handle_tui_event(
            TuiEvent::Key(KeyEvent::new_with_kind(
                KeyCode::Enter,
                KeyModifiers::NONE,
                KeyEventKind::Repeat,
            )),
            true
        ),
        AppAction::None
    );
    assert_eq!(
        app.chat_widget.bottom_pane.composer_text(),
        "preserved draft"
    );
    assert!(app.chat_widget.copy_picker.is_some());
    assert!(matches!(
        key(&mut app, KeyCode::Enter),
        AppAction::CopySelection { .. }
    ));
    assert_eq!(app.projection.active_turn_id(), None);
}

#[test]
fn state_and_selected_payload_are_cleared_on_thread_handoff_and_hydration() {
    for hydrate in [false, true] {
        let mut app = app(Locale::EnUs);
        open_copy(&mut app);
        app.chat_widget.bottom_pane.insert_str("keep draft");
        if hydrate {
            app.reset_for_hydrated_thread();
        } else {
            app.chat_widget
                .reset_thread_surface(None, std::time::Instant::now());
        }
        assert!(app.chat_widget.copy_picker.is_none());
        assert!(app.chat_widget.last_status_copy_targets.is_none());
        assert_eq!(app.chat_widget.bottom_pane.composer_text(), "keep draft");
    }
}

#[test]
fn a_new_command_or_prompt_releases_status_but_an_open_picker_keeps_its_payload() {
    let mut app = app(Locale::EnUs);
    key(&mut app, KeyCode::Esc);
    app.chat_widget.bottom_pane.set_composer_text("/raw".into());
    key(&mut app, KeyCode::Enter);
    assert!(app.chat_widget.last_status_copy_targets.is_none());
    app.chat_widget
        .bottom_pane
        .set_composer_text("/status".into());
    key(&mut app, KeyCode::Enter);
    key(&mut app, KeyCode::Esc);
    app.chat_widget.bottom_pane.insert_str("new prompt");
    assert!(matches!(
        key(&mut app, KeyCode::Enter),
        AppAction::Submit { .. }
    ));
    assert!(app.chat_widget.last_status_copy_targets.is_none());

    app.chat_widget
        .bottom_pane
        .set_composer_text("/status".into());
    key(&mut app, KeyCode::Enter);
    open_copy(&mut app);
    app.apply_notification(ServerNotification::AgentMessageDelta(
        AgentMessageDeltaNotification {
            thread_id: "thread-status-1".into(),
            turn_id: "turn-live".into(),
            item_id: "item-live".into(),
            delta: "new answer".into(),
        },
    ));
    assert!(app.chat_widget.last_status_copy_targets.is_none());
    let AppAction::CopySelection { text, .. } = key(&mut app, KeyCode::Char('2')) else {
        panic!("open picker must retain its frozen model")
    };
    assert_eq!(text, "model-before");
}

#[test]
fn a_terminal_message_without_deltas_replaces_only_the_active_status_copy_source() {
    use app_server_protocol::protocol::v2::{ItemCompletedNotification, ThreadItem};
    for same_thread in [false, true] {
        let mut app = app(Locale::EnUs);
        key(&mut app, KeyCode::Esc);
        app.apply_notification(ServerNotification::ItemCompleted(
            ItemCompletedNotification {
                thread_id: if same_thread {
                    "thread-status-1"
                } else {
                    "another-thread"
                }
                .into(),
                turn_id: "turn-message".into(),
                completed_at_ms: 1,
                item: ThreadItem::AgentMessage {
                    id: "item-message".into(),
                    text: "new terminal answer".into(),
                    phase: None,
                    memory_citation: None,
                    content_parts: Vec::new(),
                    delivery: None,
                    questions: None,
                },
            },
        ));
        assert_eq!(
            app.chat_widget.last_status_copy_targets.is_none(),
            same_thread
        );
        app.select_transcript_copy();
        assert_eq!(app.chat_widget.copy_picker.is_none(), same_thread);
        if same_thread {
            screen(&app, 100, 24);
            assert!(app
                .chat_widget
                .pager_overlay
                .as_ref()
                .unwrap()
                .is_copy_mode());
        }
    }
}

#[test]
fn asynchronous_selection_copy_feedback_never_dismisses_a_new_picker_or_another_thread() {
    for changed_thread in [false, true] {
        let mut app = app(Locale::EnUs);
        open_copy(&mut app);
        let AppAction::CopySelection {
            text,
            label,
            format,
        } = key(&mut app, KeyCode::Char('3'))
        else {
            panic!("directory action")
        };
        assert_eq!(text, "/workspace/original 目录");
        assert_eq!(format, CopyFormat::PlainText);
        let context = PendingCopyContext::Selection { label, format };
        assert_eq!(context.format(), CopyFormat::PlainText);
        app.defer_copy(7, context);
        app.select_transcript_copy();
        if changed_thread {
            app.thread_id = Some("another-thread".into());
        }
        let before = app.projection.status().to_owned();
        app.finish_clipboard_copy(7, Ok(CopyStatus::Confirmed));
        assert!(app.chat_widget.copy_picker.is_some());
        if changed_thread {
            assert_eq!(app.projection.status(), before);
        } else {
            assert!(app.projection.status().contains("Directory"));
        }
    }
}
