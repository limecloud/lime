use super::*;

#[test]
fn test_backend_renders_filtered_slash_command_popup_above_composer() {
    let mut app = App::default();
    app.set_locale(Locale::ZhCn);
    for character in ['/', 'p', 'e'] {
        dispatch_connected_input(
            &mut app,
            Event::Key(crossterm::event::KeyEvent::new(
                crossterm::event::KeyCode::Char(character),
                crossterm::event::KeyModifiers::NONE,
            )),
        );
    }
    let mut terminal = Terminal::new(TestBackend::new(48, 10)).expect("terminal");

    terminal.draw(|frame| render(frame, &app)).expect("draw");

    let text = buffer_text(&terminal);
    let compact = text
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect::<String>();
    assert!(text.contains("› /permissions"));
    assert!(compact.contains("设置权限配置"), "{text}");
    assert_eq!(
        text.matches("/model").count(),
        0,
        "session header is borderless: {text}"
    );
    assert!(text.contains("/pe"));
}

#[test]
fn composer_popup_remains_visible_with_status_and_queue_rows() {
    let mut app = App::default();
    app.start_turn("turn-popup-clip".to_string());
    app.set_queued_submissions(vec![QueuedSubmission {
        id: "queue-popup-clip".to_string(),
        input: vec![UserInput::Text {
            text: "queued follow-up".to_string(),
            text_elements: Vec::new(),
        }],
        client_user_message_id: "client-popup-clip".to_string(),
    }]);
    for character in ['/', 'p', 'e'] {
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Char(character), KeyModifiers::NONE)),
        );
    }

    let width = 48;
    let height = 14;
    let mut terminal = Terminal::new(TestBackend::new(width, height)).expect("terminal");
    terminal.draw(|frame| render(frame, &app)).expect("draw");

    let chunks = screen_chunks(
        Rect::new(0, 0, width, height),
        &app,
        app.active_turn_elapsed(Instant::now()),
    );
    assert!(chunks.status.height > 0, "status row was not allocated");
    assert!(
        chunks.preview.height > 0,
        "queue preview row was not allocated"
    );

    assert!(buffer_text(&terminal).contains("/permissions"));
}

#[test]
fn composer_popup_unicode_rows_stay_within_display_width_for_all_locales() {
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        for width in [24, 40] {
            let mut app = App::default();
            app.set_locale(locale);
            app.chat_widget.bottom_pane.insert_str("你好🙂 /p");
            let height = 12;
            let mut terminal = Terminal::new(TestBackend::new(width, height)).expect("terminal");
            terminal.draw(|frame| render(frame, &app)).expect("draw");

            let buffer = terminal.backend().buffer();
            for y in 0..buffer.area.height {
                let mut row_width = 0;
                let mut continuation = false;
                for x in 0..buffer.area.width {
                    if continuation {
                        continuation = false;
                        continue;
                    }
                    let symbol = crate::terminal_hyperlinks::strip_osc8(buffer[(x, y)].symbol());
                    let width = crate::width::display_width(&symbol);
                    row_width += width;
                    continuation = width > 1;
                }
                assert!(
                    row_width <= usize::from(width),
                    "{locale:?} row {y} exceeded {width}: {row_width}"
                );
            }
            let text = buffer_text(&terminal);
            assert!(text.contains('你'), "{locale:?}: {text}");
            assert!(text.contains('好'), "{locale:?}: {text}");
            assert!(text.contains('🙂'), "{locale:?}: {text}");
        }
    }
}

#[test]
fn export_picker_matches_codex_destination_and_filename_flow() {
    let mut app = App::default();
    app.set_thread_id("00000000-0000-0000-0000-000000000123".to_string());
    app.chat_widget.bottom_pane.insert_str("/export");
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE,))
        ),
        crate::app::AppAction::None
    );

    let mut terminal = Terminal::new(TestBackend::new(80, 12)).expect("terminal");
    terminal.draw(|frame| render(frame, &app)).expect("draw");
    let text = buffer_text(&terminal);
    assert!(text.contains("Export conversation"), "{text}");
    assert!(text.contains("Copy to clipboard"), "{text}");
    assert!(text.contains("Save to file"), "{text}");

    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE,))
        ),
        crate::app::AppAction::None
    );
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE,))
        ),
        crate::app::AppAction::None
    );
    assert!(app
        .chat_widget
        .export_picker
        .as_ref()
        .is_some_and(crate::chatwidget::transcript_export::ExportPicker::is_filename_prompt));

    terminal
        .draw(|frame| render(frame, &app))
        .expect("draw filename");
    let text = buffer_text(&terminal);
    assert!(text.contains("Save conversation"), "{text}");
    assert!(text.contains("codex-session-00000000-0000-0000-0000-000000000123.md"));

    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE,))
        ),
        crate::app::AppAction::ExportTranscript {
            path: Some(std::path::PathBuf::from(
                "codex-session-00000000-0000-0000-0000-000000000123.md",
            )),
        }
    );
    assert!(app.chat_widget.export_picker.is_none());
}

#[test]
fn status_pager_owns_the_frame_and_renders_current_session_facts() {
    let mut app = App::default();
    app.set_thread_id("thread-1".to_string());
    app.set_cwd(std::path::PathBuf::from("/workspace"));
    app.chat_widget.set_settings(
        Some("gpt-5".to_string()),
        Some("openai".to_string()),
        Some("high".to_string()),
        Some(":workspace".to_string()),
    );
    app.chat_widget.bottom_pane.insert_str("/status");
    dispatch_connected_input(
        &mut app,
        Event::Key(crossterm::event::KeyEvent::new(
            crossterm::event::KeyCode::Enter,
            crossterm::event::KeyModifiers::NONE,
        )),
    );
    let mut terminal = Terminal::new(TestBackend::new(72, 12)).expect("terminal");

    terminal.draw(|frame| render(frame, &app)).expect("draw");

    let text = buffer_text(&terminal);
    for value in [
        "/ STATUS",
        "thread-1",
        "gpt-5",
        "openai",
        ":workspace",
        "/workspace",
        "0%",
    ] {
        assert!(text.contains(value), "missing {value}: {text}");
    }
    assert!(text.contains("Lime"));
}

#[test]
fn transcript_overlay_renders_live_canonical_projection_with_markdown_and_links() {
    let destination = "https://example.com/transcript";
    let mut app = App::default();
    app.chat_widget
        .bottom_pane
        .insert_str("draft remains private");
    app.projection.apply(ServerNotification::AgentMessageDelta(
        AgentMessageDeltaNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "assistant-1".to_string(),
            delta: format!("**first** [link]({destination})"),
        },
    ));
    dispatch_connected_input(
        &mut app,
        Event::Key(crossterm::event::KeyEvent::new(
            crossterm::event::KeyCode::Char('t'),
            crossterm::event::KeyModifiers::CONTROL,
        )),
    );
    let mut terminal = Terminal::new(TestBackend::new(48, 9)).expect("terminal");
    terminal.draw(|frame| render(frame, &app)).expect("draw");

    let text = buffer_text(&terminal);
    assert!(text.contains("/ T R A N S C R I P T"), "{text}");
    assert!(text.contains("first"), "{text}");
    assert!(text.contains("link"), "{text}");
    assert!(!text.contains("draft remains private"), "{text}");
    assert!(terminal.backend().buffer().content.iter().any(|cell| {
        cell.symbol()
            .contains(&format!("\x1b]8;;{destination}\x07"))
    }));

    app.projection.apply(ServerNotification::AgentMessageDelta(
        AgentMessageDeltaNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "assistant-2".to_string(),
            delta: "latest canonical update".to_string(),
        },
    ));
    terminal.draw(|frame| render(frame, &app)).expect("redraw");
    assert!(
        buffer_text(&terminal).contains("latest canonical update"),
        "{}",
        buffer_text(&terminal)
    );
}

#[test]
fn user_visible_header_labels_cover_all_product_locales() {
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        let mut app = App::default();
        app.set_locale(locale);
        app.chat_widget.set_settings(
            Some("fixture-model".to_string()),
            Some("fixture-provider".to_string()),
            Some("high".to_string()),
            Some(":workspace".to_string()),
        );
        app.set_cwd(std::path::PathBuf::from("/workspace"));
        let mut terminal = Terminal::new(TestBackend::new(80, 16)).expect("terminal");
        terminal.draw(|frame| render(frame, &app)).expect("draw");
        let text = buffer_text(&terminal);
        let compact = text
            .chars()
            .filter(|character| !character.is_whitespace())
            .collect::<String>();
        assert!(compact.contains("Lime"), "{locale:?}: {text}");
        assert!(compact.contains("/workspace"), "{locale:?}: {text}");
    }
}

#[test]
fn test_backend_renders_specialized_plan_and_patch_layouts() {
    let mut app = App::default();
    app.projection.apply(ServerNotification::TurnPlanUpdated(
        TurnPlanUpdatedNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            explanation: None,
            plan: vec![TurnPlanStep {
                step: "run tests".to_string(),
                status: TurnPlanStepStatus::InProgress,
            }],
        },
    ));
    app.projection.apply(ServerNotification::TurnDiffUpdated(
        TurnDiffUpdatedNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            diff: "+new line".to_string(),
        },
    ));
    let mut terminal = Terminal::new(TestBackend::new(40, 10)).expect("terminal");

    terminal.draw(|frame| render(frame, &app)).expect("draw");

    let text = buffer_text(&terminal);
    assert!(text.contains("• [~] run tests"));
    assert!(text.contains("Δ +new line"));
}

#[test]
fn test_backend_renders_markdown_and_numbered_diff() {
    let mut app = App::default();
    app.projection.apply(ServerNotification::AgentMessageDelta(
        AgentMessageDeltaNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "assistant-1".to_string(),
            delta: "## Result\n\nRead [the guide](https://example.com/guide).".to_string(),
        },
    ));
    app.projection.apply(ServerNotification::TurnDiffUpdated(
        TurnDiffUpdatedNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            diff: "@@ -1 +1 @@\n-old\n+new".to_string(),
        },
    ));
    let mut terminal = Terminal::new(TestBackend::new(80, 16)).expect("terminal");

    terminal.draw(|frame| render(frame, &app)).expect("draw");

    let text = buffer_text(&terminal);
    assert!(text.contains("## Result"));
    assert!(text.contains("the guide (https://example.com/guide)"));
    assert!(text.contains("1 -old"));
    assert!(text.contains("1 +new"));
}

#[test]
fn test_backend_marks_markdown_links_with_osc8() {
    let destination = "https://example.com/guide";
    let mut app = App::default();
    app.projection.apply(ServerNotification::AgentMessageDelta(
        AgentMessageDeltaNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "assistant-1".to_string(),
            delta: format!("Read [the guide]({destination})."),
        },
    ));
    let mut terminal = Terminal::new(TestBackend::new(40, 10)).expect("terminal");

    terminal.draw(|frame| render(frame, &app)).expect("draw");

    let buffer = terminal.backend().buffer();
    assert!(buffer.content.iter().any(|cell| {
        cell.symbol()
            .contains(&format!("\x1b]8;;{destination}\x07"))
    }));
    let visible = buffer_text(&terminal);
    assert!(visible.contains("the guide"));
    assert!(visible.contains("https://example.com/guide"));
}

#[test]
fn test_backend_renders_completed_item_summaries() {
    let mut app = App::default();
    app.projection.apply(ServerNotification::ItemCompleted(
        ItemCompletedNotification {
            item: ThreadItem::CommandExecution {
                id: "command-1".to_string(),
                metadata: None,
                plugin_id: None,
                script_path: None,
                command: "cargo test -p tui".to_string(),
                cwd: "/workspace".to_string(),
                process_id: None,
                source: CommandExecutionSource::Agent,
                status: app_server_protocol::protocol::v2::CommandExecutionStatus::Completed,
                command_actions: Vec::new(),
                aggregated_output: Some("ok".to_string()),
                exit_code: Some(0),
                duration_ms: Some(42),
                terminal_interactions: Vec::new(),
            },
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            completed_at_ms: 1,
        },
    ));
    app.projection.apply(ServerNotification::ItemCompleted(
        ItemCompletedNotification {
            item: ThreadItem::FileChange {
                id: "patch-1".to_string(),
                metadata: None,
                changes: vec![FileUpdateChange {
                    path: "src/lib.rs".to_string(),
                    kind: PatchChangeKind::Add,
                    diff: "+new".to_string(),
                }],
                status: PatchApplyStatus::Completed,
            },
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            completed_at_ms: 2,
        },
    ));
    let mut terminal = Terminal::new(TestBackend::new(80, 16)).expect("terminal");

    terminal.draw(|frame| render(frame, &app)).expect("draw");

    let text = buffer_text(&terminal);
    assert!(text.contains("cargo test -p tui [completed]"));
    assert!(text.contains("- exit 0"));
    assert!(text.contains("- duration 42ms"));
    assert!(text.contains("src/lib.rs (+1 -0) [completed]"));
    assert!(text.contains("- files: 1"));
    assert!(text.contains("+new"));
}

#[test]
fn test_backend_renders_live_command_output_below_the_command() {
    let mut app = App::default();
    app.projection
        .apply(ServerNotification::ItemStarted(ItemStartedNotification {
            item: ThreadItem::CommandExecution {
                id: "command-1".to_string(),
                metadata: None,
                plugin_id: None,
                script_path: None,
                command: "printf data".to_string(),
                cwd: "/workspace".to_string(),
                process_id: None,
                source: CommandExecutionSource::Agent,
                status: app_server_protocol::protocol::v2::CommandExecutionStatus::InProgress,
                command_actions: Vec::new(),
                aggregated_output: None,
                exit_code: None,
                duration_ms: None,
                terminal_interactions: Vec::new(),
            },
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            started_at_ms: 1,
        }));
    for delta in ["std", "out\nstderr\n"] {
        app.projection
            .apply(ServerNotification::CommandExecutionOutputDelta(
                CommandExecutionOutputDeltaNotification {
                    thread_id: "thread-1".to_string(),
                    turn_id: "turn-1".to_string(),
                    item_id: "command-1".to_string(),
                    delta: delta.to_string(),
                },
            ));
    }
    let mut terminal = Terminal::new(TestBackend::new(60, 10)).expect("terminal");

    terminal.draw(|frame| render(frame, &app)).expect("draw");

    let text = buffer_text(&terminal);
    let command = text.find("$ printf data [running]").expect("command row");
    let stdout = text.find("stdout").expect("stdout row");
    let stderr = text.find("stderr").expect("stderr row");
    assert!(command < stdout && stdout < stderr, "{text}");
    assert!(!text.contains("datastdout"), "{text}");
}

#[test]
fn test_backend_renders_bounded_command_output_marker() {
    let mut app = App::default();
    app.projection
        .apply(ServerNotification::ItemStarted(ItemStartedNotification {
            item: ThreadItem::CommandExecution {
                id: "command-large".to_string(),
                metadata: None,
                plugin_id: None,
                script_path: None,
                command: "printf output".to_string(),
                cwd: "/workspace".to_string(),
                process_id: None,
                source: CommandExecutionSource::Agent,
                status: app_server_protocol::protocol::v2::CommandExecutionStatus::InProgress,
                command_actions: Vec::new(),
                aggregated_output: None,
                exit_code: None,
                duration_ms: None,
                terminal_interactions: Vec::new(),
            },
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            started_at_ms: 1,
        }));
    let output = (0..101)
        .map(|index| format!("line-{index}"))
        .collect::<Vec<_>>()
        .join("\n");
    app.projection
        .apply(ServerNotification::CommandExecutionOutputDelta(
            CommandExecutionOutputDeltaNotification {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                item_id: "command-large".to_string(),
                delta: output,
            },
        ));
    let mut terminal = Terminal::new(TestBackend::new(80, 110)).expect("terminal");

    terminal.draw(|frame| render(frame, &app)).expect("draw");

    let text = buffer_text(&terminal);
    assert!(text.contains("… 1 lines omitted …"), "{text}");
    assert!(text.contains("line-0"), "{text}");
    assert!(text.contains("line-100"), "{text}");
    assert!(!text.contains("line-50"), "{text}");
}

#[test]
fn narrow_terminal_does_not_overflow_or_panic() {
    let mut app = App::default();
    app.projection.set_status("a-status-that-does-not-fit");
    app.chat_widget.bottom_pane.insert_str("界界界界");
    let mut terminal = Terminal::new(TestBackend::new(8, 6)).expect("terminal");

    terminal.draw(|frame| render(frame, &app)).expect("draw");

    let text = buffer_text(&terminal);
    assert_eq!(text.lines().count(), 6);
    assert!(!text.contains("╰"), "session header is borderless: {text}");
}
