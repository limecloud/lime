use super::*;

#[test]
fn approval_fullscreen_details_close_without_deciding_or_losing_draft_and_selection() {
    let mut app = App::default();
    app.chat_widget
        .bottom_pane
        .insert_str("unsent protected draft");
    app.chat_widget
        .bottom_pane
        .enqueue(ServerRequest::ItemCommandExecutionRequestApproval {
            id: RequestId::Integer(99),
            params: CommandExecutionRequestApprovalParams {
                thread_id: "thread-approval".into(),
                turn_id: "turn-approval".into(),
                item_id: "item-approval".into(),
                started_at_ms: 1,
                approval_id: None,
                network_approval_context: None,
                command: Some(format!(
                    "{}END_OF_FULL_COMMAND",
                    "printf long-command; ".repeat(80)
                )),
                cwd: Some("/workspace".into()),
                reason: None,
                available_decisions: None,
            },
        })
        .unwrap();
    dispatch_connected_input(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Up, KeyModifiers::NONE)),
    );
    let action = dispatch_connected_input(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Char('a'), KeyModifiers::CONTROL)),
    );
    assert!(matches!(action, crate::app::AppAction::None));
    assert!(app.chat_widget.pager_overlay.is_some());
    assert!(app.chat_widget.bottom_pane.is_active());
    let mut terminal = Terminal::new(TestBackend::new(60, 16)).unwrap();
    terminal.draw(|frame| render(frame, &app)).unwrap();
    assert!(buffer_text(&terminal).contains("long-command"));
    let action = dispatch_connected_input(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Char('y'), KeyModifiers::NONE)),
    );
    assert!(matches!(action, crate::app::AppAction::None));
    assert!(app.chat_widget.bottom_pane.is_active());
    dispatch_connected_input(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE)),
    );
    assert!(app.chat_widget.pager_overlay.is_none());
    assert!(app.chat_widget.bottom_pane.is_active());
    assert_eq!(
        app.chat_widget.bottom_pane.composer_text(),
        "unsent protected draft"
    );
    terminal.draw(|frame| render(frame, &app)).unwrap();
    assert!(buffer_text(&terminal).contains("› 4."));
    match dispatch_connected_input(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
    ) {
        crate::app::AppAction::Respond(bottom_pane::AppServerResponse::Command {
            id,
            response,
        }) => {
            assert_eq!(id, RequestId::Integer(99));
            assert_eq!(
                response.decision,
                app_server_protocol::protocol::v2::CommandExecutionApprovalDecision::Cancel
            );
        }
        action => panic!("unexpected protected response: {action:?}"),
    }
}

#[test]
fn approval_replaces_the_composer_with_actionable_options() {
    let mut app = App::default();
    app.chat_widget.bottom_pane.insert_str("unsent draft");
    app.chat_widget
        .bottom_pane
        .enqueue(ServerRequest::ItemCommandExecutionRequestApproval {
            id: RequestId::Integer(7),
            params: CommandExecutionRequestApprovalParams {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                item_id: "command-1".to_string(),
                started_at_ms: 1,
                approval_id: None,
                reason: Some("run the focused regression".to_string()),
                network_approval_context: None,
                command: Some("cargo test -p tui".to_string()),
                cwd: Some("/workspace".to_string()),
                available_decisions: None,
            },
        })
        .expect("queue approval");
    let mut terminal = Terminal::new(TestBackend::new(60, 16)).expect("terminal");

    terminal.draw(|frame| render(frame, &app)).expect("draw");

    let text = buffer_text(&terminal);
    assert!(text.contains("Approve command?"));
    assert!(text.contains("cargo test -p tui"));
    assert!(text.contains("Allow once"));
    assert!(!text.contains("unsent draft"));
}

#[test]
fn approval_hides_an_open_slash_command_popup() {
    let mut app = App::default();
    dispatch_connected_input(
        &mut app,
        Event::Key(crossterm::event::KeyEvent::new(
            crossterm::event::KeyCode::Char('/'),
            crossterm::event::KeyModifiers::NONE,
        )),
    );
    app.chat_widget
        .bottom_pane
        .enqueue(ServerRequest::ItemCommandExecutionRequestApproval {
            id: RequestId::Integer(9),
            params: CommandExecutionRequestApprovalParams {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                item_id: "command-1".to_string(),
                started_at_ms: 1,
                approval_id: None,
                reason: None,
                network_approval_context: None,
                command: Some("cargo test".to_string()),
                cwd: Some("/workspace".to_string()),
                available_decisions: None,
            },
        })
        .expect("queue approval");
    let mut terminal = Terminal::new(TestBackend::new(72, 12)).expect("terminal");

    terminal.draw(|frame| render(frame, &app)).expect("draw");

    let text = buffer_text(&terminal);
    assert!(text.contains("Approve command?"));
    assert!(!text.contains("/model"));
    assert!(!text.contains("copy the last response"));
}

#[test]
fn approval_narrow_layout_keeps_primary_controls_visible() {
    let mut app = App::default();
    app.chat_widget
        .bottom_pane
        .enqueue(ServerRequest::ItemCommandExecutionRequestApproval {
            id: RequestId::Integer(10),
            params: CommandExecutionRequestApprovalParams {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                item_id: "command-1".to_string(),
                started_at_ms: 1,
                approval_id: None,
                reason: Some("a long reason that should wrap safely".to_string()),
                network_approval_context: None,
                command: Some("cargo test -p tui --lib".to_string()),
                cwd: Some("/workspace/project".to_string()),
                available_decisions: None,
            },
        })
        .expect("queue approval");
    let mut terminal = Terminal::new(TestBackend::new(40, 20)).expect("terminal");

    terminal.draw(|frame| render(frame, &app)).expect("draw");

    let text = buffer_text(&terminal);
    assert!(text.contains("Allow once"), "{text}");
    assert!(text.contains("Enter confirm"), "{text}");
    assert!(text.contains("Esc cancel"), "{text}");
    assert!(text.lines().all(|line| line.chars().count() <= 40));
}

#[test]
fn request_user_input_narrow_layout_keeps_submit_and_cancel_visible() {
    let mut app = App::default();
    app.chat_widget
        .bottom_pane
        .enqueue(ServerRequest::ItemToolRequestUserInput {
            id: RequestId::Integer(11),
            params: ToolRequestUserInputParams {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                item_id: "question-1".to_string(),
                questions: vec![ToolRequestUserInputQuestion {
                    id: "mode".to_string(),
                    header: "Mode".to_string(),
                    question: "Choose the next step for this task".to_string(),
                    is_other: false,
                    is_secret: false,
                    options: Some(vec![
                        app_server_protocol::protocol::v2::ToolRequestUserInputOption {
                            label: "Run tests".to_string(),
                            description: "Pick the most relevant crate and validate behavior"
                                .to_string(),
                        },
                        app_server_protocol::protocol::v2::ToolRequestUserInputOption {
                            label: "Review diff".to_string(),
                            description: "Summarize the current changes".to_string(),
                        },
                    ]),
                }],
                is_blocking: true,
                auto_resolution_ms: None,
            },
        })
        .expect("queue user input");
    let mut terminal = Terminal::new(TestBackend::new(40, 20)).expect("terminal");

    terminal.draw(|frame| render(frame, &app)).expect("draw");

    let text = buffer_text(&terminal);
    assert!(text.contains("1. Run tests"), "{text}");
    assert!(text.contains("Enter submit"), "{text}");
    assert!(text.contains("Esc cancel"), "{text}");
    assert!(text.lines().all(|line| line.chars().count() <= 40));
    let chunks = screen_chunks(
        Rect::new(0, 0, 40, 20),
        &app,
        app.active_turn_elapsed(Instant::now()),
    );
    assert!(chunks.footer.height > 1, "{chunks:?}");
    assert!(chunks.input.bottom() <= chunks.footer.top(), "{chunks:?}");
}

#[test]
fn interactive_overlays_remain_actionable_across_supported_widths_and_locales() {
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        for width in [40, 80, 120] {
            let mut approval = App::default();
            approval.set_locale(locale);
            approval
                .chat_widget
                .bottom_pane
                .enqueue(ServerRequest::ItemCommandExecutionRequestApproval {
                    id: RequestId::Integer(12),
                    params: CommandExecutionRequestApprovalParams {
                        thread_id: "thread-1".to_string(),
                        turn_id: "turn-1".to_string(),
                        item_id: "command-1".to_string(),
                        started_at_ms: 1,
                        approval_id: None,
                        reason: Some("focused regression".to_string()),
                        network_approval_context: None,
                        command: Some("cargo test -p tui".to_string()),
                        cwd: Some("/workspace".to_string()),
                        available_decisions: None,
                    },
                })
                .expect("queue approval");
            let mut terminal = Terminal::new(TestBackend::new(width, 20)).expect("terminal");
            terminal
                .draw(|frame| render(frame, &approval))
                .expect("draw approval");
            let approval_text = buffer_text(&terminal);
            let approval_compact = approval_text
                .chars()
                .filter(|character| !character.is_whitespace())
                .collect::<String>();
            assert!(
                approval_compact.contains(
                    &locale
                        .approval_title("command")
                        .chars()
                        .filter(|character| !character.is_whitespace())
                        .collect::<String>(),
                ),
                "approval title for {locale:?} at {width}: {approval_text}"
            );
            assert!(
                approval_compact.contains(
                    &locale
                        .action_required_label()
                        .chars()
                        .filter(|character| !character.is_whitespace())
                        .collect::<String>(),
                ),
                "action-required label for {locale:?} at {width}: {approval_text}"
            );
            assert!(
                approval_compact.contains(
                    &format!(
                        "{} · {}",
                        locale.approval_confirm_hint("enter"),
                        locale.approval_cancel_hint("esc")
                    )
                    .chars()
                    .filter(|character| !character.is_whitespace())
                    .collect::<String>(),
                ),
                "approval controls for {locale:?} at {width}: {approval_text}"
            );

            let mut question = App::default();
            question.set_locale(locale);
            question
                .chat_widget
                .bottom_pane
                .enqueue(ServerRequest::ItemToolRequestUserInput {
                    id: RequestId::Integer(13),
                    params: ToolRequestUserInputParams {
                        thread_id: "thread-1".to_string(),
                        turn_id: "turn-1".to_string(),
                        item_id: "question-1".to_string(),
                        questions: vec![ToolRequestUserInputQuestion {
                            id: "mode".to_string(),
                            header: "Mode".to_string(),
                            question: "Choose one option".to_string(),
                            is_other: false,
                            is_secret: false,
                            options: Some(vec![
                                app_server_protocol::protocol::v2::ToolRequestUserInputOption {
                                    label: "Fast".to_string(),
                                    description: "Continue immediately".to_string(),
                                },
                            ]),
                        }],
                        is_blocking: true,
                        auto_resolution_ms: None,
                    },
                })
                .expect("queue user input");
            // Use a fresh backend for the second overlay. TestBackend retains the cells under
            // a previous wide-glyph row when the footer grows, while a real terminal replaces
            // both display cells. Each matrix case should assert the target frame itself.
            let mut question_terminal =
                Terminal::new(TestBackend::new(width, 20)).expect("question terminal");
            question_terminal
                .draw(|frame| render(frame, &question))
                .expect("draw user input");
            let question_text = buffer_text(&question_terminal);
            let question_compact = question_text
                .chars()
                .filter(|character| !character.is_whitespace())
                .collect::<String>();
            assert!(
                question_compact.contains(
                    &locale
                        .request_submit_hint("enter")
                        .chars()
                        .filter(|character| !character.is_whitespace())
                        .collect::<String>(),
                ),
                "submit control for {locale:?} at {width}: {question_text}"
            );
            assert!(
                question_compact.contains(
                    &locale
                        .request_cancel_hint("esc")
                        .chars()
                        .filter(|character| !character.is_whitespace())
                        .collect::<String>(),
                ),
                "cancel control for {locale:?} at {width}: {question_text}"
            );
            assert!(
                question_compact.contains("1.Fast"),
                "option for {locale:?} at {width}: {question_text}"
            );
        }
    }
}

#[test]
fn secret_user_input_is_masked_in_the_test_backend() {
    let mut app = App::default();
    app.chat_widget
        .bottom_pane
        .enqueue(ServerRequest::ItemToolRequestUserInput {
            id: RequestId::Integer(8),
            params: ToolRequestUserInputParams {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                item_id: "question-1".to_string(),
                questions: vec![ToolRequestUserInputQuestion {
                    id: "token".to_string(),
                    header: "Token".to_string(),
                    question: "Enter token".to_string(),
                    is_other: false,
                    is_secret: true,
                    options: None,
                }],
                is_blocking: true,
                auto_resolution_ms: None,
            },
        })
        .expect("queue user input");
    dispatch_connected_input(&mut app, Event::Paste("sensitive".to_string()));
    let mut terminal = Terminal::new(TestBackend::new(40, 10)).expect("terminal");

    terminal.draw(|frame| render(frame, &app)).expect("draw");

    let text = buffer_text(&terminal);
    assert!(text.contains("*********"));
    assert!(!text.contains("sensitive"));
}
