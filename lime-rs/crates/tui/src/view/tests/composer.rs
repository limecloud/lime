use super::*;

#[test]
fn test_backend_renders_streaming_unicode_and_composer() {
    let mut app = App::default();
    app.set_settings(
        Some("fixture-model".to_string()),
        Some("fixture-provider".to_string()),
        Some("high".to_string()),
        Some(":workspace".to_string()),
    );
    app.projection.apply(ServerNotification::AgentMessageDelta(
        AgentMessageDeltaNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "item-1".to_string(),
            delta: "你好，terminal".to_string(),
        },
    ));
    app.composer.insert("继续");
    let mut terminal = Terminal::new(TestBackend::new(80, 16)).expect("terminal");

    terminal.draw(|frame| render(frame, &app)).expect("draw");

    let text = buffer_text(&terminal);
    assert!(text.contains("Lime"));
    assert!(text.contains('你'));
    assert!(text.contains('好'));
    assert!(text.contains("terminal"));
    assert!(text.contains('继'));
    assert!(text.contains('续'));
    let compact = text
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect::<String>();
    assert!(!compact.contains("model:fixture-model"));
    assert!(!compact.contains("high"));
}

#[test]
fn test_backend_renders_pending_images_above_composer_text() {
    let mut app = App::default();
    app.attach_image(std::path::PathBuf::from("/tmp/one.png"));
    app.attach_image(std::path::PathBuf::from("/tmp/two.png"));
    app.composer.insert("describe these");
    let mut terminal = Terminal::new(TestBackend::new(40, 10)).expect("terminal");

    terminal.draw(|frame| render(frame, &app)).expect("draw");

    let text = buffer_text(&terminal);
    assert!(text.contains("[Image #1]"));
    assert!(text.contains("[Image #2]"));
    assert!(text.contains("describe these"));
}

#[test]
fn idle_composer_uses_codex_prompt_and_localized_placeholder() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    let mut terminal = Terminal::new(TestBackend::new(80, 10)).expect("terminal");

    terminal.draw(|frame| render(frame, &app)).expect("draw");

    let text = buffer_text(&terminal);
    assert!(text.contains("› "), "missing composer prompt: {text}");
    assert!(
        text.contains("Ask Lime to do anything"),
        "missing composer placeholder: {text}"
    );
}

#[test]
fn transient_status_keeps_action_feedback_visible_without_idle_status_bar() {
    let mut app = App::default();
    app.projection.set_status("interrupting");
    let mut terminal = Terminal::new(TestBackend::new(80, 10)).expect("terminal");

    terminal.draw(|frame| render(frame, &app)).expect("draw");

    let text = buffer_text(&terminal);
    assert!(
        text.contains("• interrupting"),
        "missing transient status: {text}"
    );
    assert!(
        text.contains("› Ask Lime to do anything"),
        "missing composer: {text}"
    );
    assert!(
        !text.contains("Lime ready"),
        "idle header leaked into status: {text}"
    );
}

#[test]
fn test_backend_renders_remote_images_with_selection_highlight() {
    let mut app = App::default();
    app.set_remote_image_urls(vec![
        "https://example.test/one.png".to_string(),
        "https://example.test/two.png".to_string(),
    ]);
    let mut terminal = Terminal::new(TestBackend::new(40, 10)).expect("terminal");

    terminal.draw(|frame| render(frame, &app)).expect("draw");
    let text = buffer_text(&terminal);
    assert!(text.contains("[Image #1]"));
    assert!(text.contains("[Image #2]"));

    let _ = app
        .composer
        .handle_key_event(KeyEvent::new(KeyCode::Up, KeyModifiers::NONE));
    terminal.draw(|frame| render(frame, &app)).expect("redraw");
    let buffer = terminal.backend().buffer();
    let highlighted = (0..buffer.area.height).any(|y| {
        (0..buffer.area.width).any(|x| {
            let cell = &buffer[(x, y)];
            cell.symbol() == "[" && cell.style().add_modifier(Modifier::REVERSED) == cell.style()
        })
    });
    assert!(highlighted);
}

#[test]
fn test_backend_renders_canonical_queue_between_transcript_and_composer() {
    let mut app = App::default();
    app.set_queued_submissions(vec![QueuedSubmission {
        id: "queue-1".to_string(),
        input: vec![UserInput::Text {
            text: "follow up after this turn".to_string(),
            text_elements: Vec::new(),
        }],
        client_user_message_id: "client-queue-1".to_string(),
    }]);
    app.composer.insert("current draft");
    let mut terminal = Terminal::new(TestBackend::new(40, 10)).expect("terminal");

    terminal.draw(|frame| render(frame, &app)).expect("draw");

    let text = buffer_text(&terminal);
    let queued_row = text.find("queued (1)").expect("queued header");
    let message_row = text
        .find("follow up after this turn")
        .expect("queued message");
    let composer_row = text.find("current draft").expect("composer");
    assert!(
        queued_row < message_row && message_row < composer_row,
        "{text}"
    );
}

#[test]
fn active_turn_status_precedes_canonical_queue_and_composer() {
    let mut app = App::default();
    app.start_turn("turn-1".to_string());
    app.set_queued_submissions(vec![QueuedSubmission {
        id: "queue-1".to_string(),
        input: vec![UserInput::Text {
            text: "follow up after this turn".to_string(),
            text_elements: Vec::new(),
        }],
        client_user_message_id: "client-queue-1".to_string(),
    }]);
    app.composer.insert("current draft");
    let mut terminal = Terminal::new(TestBackend::new(48, 12)).expect("terminal");

    terminal.draw(|frame| render(frame, &app)).expect("draw");

    let text = buffer_text(&terminal);
    let status_row = text.find("Working (").expect("active status");
    let interrupt_hint = text.find("esc to interrupt").expect("interrupt hint");
    let queued_row = text.find("queued (1)").expect("queued header");
    let composer_row = text.find("current draft").expect("composer");
    assert!(
        status_row < interrupt_hint && interrupt_hint < queued_row && queued_row < composer_row,
        "{text}"
    );
}

#[test]
fn footer_renders_the_active_agent_label() {
    let mut app = App::default();
    app.set_thread_id("main".to_string());
    app.agent_navigation.upsert(
        "agent-1",
        Some("Robie".to_string()),
        Some("explorer".to_string()),
        false,
    );
    app.set_thread_id("agent-1".to_string());

    let mut terminal = Terminal::new(TestBackend::new(64, 8)).expect("terminal");
    terminal.draw(|frame| render(frame, &app)).expect("draw");
    assert!(buffer_text(&terminal).contains("Robie [explorer]"));
}

#[test]
fn active_turn_status_does_not_overflow_a_tiny_terminal() {
    let mut app = App::default();
    app.start_turn("turn-1".to_string());
    app.set_queued_submissions(vec![QueuedSubmission {
        id: "queue-1".to_string(),
        input: vec![UserInput::Text {
            text: "queued text that cannot fit".to_string(),
            text_elements: Vec::new(),
        }],
        client_user_message_id: "client-queue-1".to_string(),
    }]);
    app.composer.insert("界界界界");
    let mut terminal = Terminal::new(TestBackend::new(12, 7)).expect("terminal");

    terminal.draw(|frame| render(frame, &app)).expect("draw");

    let text = buffer_text(&terminal);
    assert_eq!(text.lines().count(), 7, "{text}");
    assert!(text.contains("Working"), "{text}");
    assert!(text.contains('…'), "{text}");
}

#[test]
fn status_and_footer_geometry_remains_stable_across_supported_widths_and_locales() {
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        for width in [40, 80, 120] {
            let mut app = App::default();
            app.set_locale(locale);
            app.start_turn(format!("turn-{width}"));
            app.set_queued_submissions(vec![QueuedSubmission {
                id: format!("queue-{width}"),
                input: vec![UserInput::Text {
                    text: "queued follow-up".to_string(),
                    text_elements: Vec::new(),
                }],
                client_user_message_id: format!("client-{width}"),
            }]);
            app.composer.insert("draft");

            let height = 20;
            let mut terminal = Terminal::new(TestBackend::new(width, height)).expect("terminal");
            terminal.draw(|frame| render(frame, &app)).expect("draw");
            let text = buffer_text(&terminal);
            assert_eq!(text.lines().count(), usize::from(height));
            let compact = text
                .chars()
                .filter(|character| !character.is_whitespace())
                .collect::<String>();
            assert!(
                compact.contains('›'),
                "missing composer for {locale:?} at {width}: {text}"
            );
            assert!(
                compact.contains(
                    &locale
                        .working_label()
                        .chars()
                        .filter(|character| !character.is_whitespace())
                        .collect::<String>()
                ),
                "missing active status for {locale:?} at {width}: {text}"
            );
            assert!(
                compact.contains(
                    &locale
                        .status("queued")
                        .chars()
                        .filter(|character| !character.is_whitespace())
                        .collect::<String>()
                ),
                "missing queue preview for {locale:?} at {width}: {text}"
            );

            let chunks = screen_chunks(
                Rect::new(0, 0, width, height),
                &app,
                app.active_turn_elapsed(Instant::now()),
            );
            assert!(chunks.transcript.bottom() <= chunks.status.top());
            assert!(chunks.status.bottom() <= chunks.preview.top());
            assert!(chunks.preview.bottom() <= chunks.input.top());
            assert!(chunks.input.bottom() <= chunks.footer.top());
            assert_eq!(chunks.footer.height, 1);
        }
    }
}

#[test]
fn history_search_footer_shows_localized_query_without_hiding_composer() {
    let mut app = App::default();
    app.set_locale(Locale::ZhCn);
    app.composer.set_cached_history(["git status".to_string()]);
    app.composer.insert("git");
    dispatch_connected_input(
        &mut app,
        Event::Key(crossterm::event::KeyEvent::new(
            crossterm::event::KeyCode::Char('r'),
            crossterm::event::KeyModifiers::CONTROL,
        )),
    );
    for character in "git".chars() {
        dispatch_connected_input(
            &mut app,
            Event::Key(crossterm::event::KeyEvent::new(
                crossterm::event::KeyCode::Char(character),
                crossterm::event::KeyModifiers::NONE,
            )),
        );
    }
    let mut terminal = Terminal::new(TestBackend::new(48, 8)).expect("terminal");

    terminal.draw(|frame| render(frame, &app)).expect("draw");

    let text = buffer_text(&terminal);
    let compact = text
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect::<String>();
    assert!(compact.contains("反向搜索：git"), "{text}");
    assert!(text.contains("git status"), "{text}");
}

#[test]
fn history_search_preview_highlights_matches_until_accepted() {
    let mut app = App::default();
    app.composer.set_cached_history(["Deploy Lime".to_string()]);
    dispatch_connected_input(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL)),
    );
    for character in "dep".chars() {
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Char(character), KeyModifiers::NONE)),
        );
    }

    let area = Rect::new(0, 0, 64, 10);
    let mut terminal = Terminal::new(TestBackend::new(area.width, area.height)).expect("terminal");
    terminal.draw(|frame| render(frame, &app)).expect("draw");
    let buffer = terminal.backend().buffer();
    let mut start = None;
    for y in 0..buffer.area.height {
        for x in 0..buffer.area.width.saturating_sub(2) {
            if buffer[(x, y)].symbol() == "D"
                && buffer[(x + 1, y)].symbol() == "e"
                && buffer[(x + 2, y)].symbol() == "p"
            {
                start = Some((x, y));
                break;
            }
        }
        if start.is_some() {
            break;
        }
    }
    let (x, y) = start.expect("history preview");
    for offset in 0..3 {
        let modifiers = buffer[(x + offset, y)].style().add_modifier;
        assert!(modifiers.contains(Modifier::REVERSED));
        assert!(modifiers.contains(Modifier::BOLD));
    }

    dispatch_connected_input(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
    );
    terminal.draw(|frame| render(frame, &app)).expect("redraw");
    let buffer = terminal.backend().buffer();
    for offset in 0..3 {
        let modifiers = buffer[(x + offset, y)].style().add_modifier;
        assert!(!modifiers.contains(Modifier::REVERSED));
        assert!(!modifiers.contains(Modifier::BOLD));
    }
}

#[test]
fn history_search_footer_cursor_tracks_query_and_clamps_to_narrow_width() {
    let mut app = App::default();
    app.composer.set_cached_history(["git status".to_string()]);
    dispatch_connected_input(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL)),
    );
    for character in "git".chars() {
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Char(character), KeyModifiers::NONE)),
        );
    }

    let wide = Rect::new(0, 0, 80, 10);
    let mut terminal = Terminal::new(TestBackend::new(wide.width, wide.height)).expect("terminal");
    terminal
        .draw(|frame| render(frame, &app))
        .expect("draw wide");
    let footer = screen_chunks(wide, &app, app.active_turn_elapsed(Instant::now())).footer;
    let prefix_width = Line::from(format!(" {}", app.locale.history_search_label())).width() as u16;
    assert_eq!(
        terminal.backend().cursor_position(),
        Position::new(footer.x + prefix_width + 3, footer.y)
    );

    let narrow = Rect::new(0, 0, 12, 10);
    let mut terminal =
        Terminal::new(TestBackend::new(narrow.width, narrow.height)).expect("terminal");
    terminal
        .draw(|frame| render(frame, &app))
        .expect("draw narrow");
    let footer = screen_chunks(narrow, &app, app.active_turn_elapsed(Instant::now())).footer;
    assert_eq!(
        terminal.backend().cursor_position(),
        Position::new(footer.right().saturating_sub(1), footer.y)
    );
}
