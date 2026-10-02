use super::*;

#[test]
fn wrapped_transcript_scroll_uses_visual_rows() {
    let paragraph = Paragraph::new("abcdefghij").wrap(Wrap { trim: false });
    let narrow = Rect::new(0, 0, 5, 1);

    let narrow_count = paragraph.line_count(narrow.width);
    assert_eq!(transcript_scroll_offset(narrow_count, narrow, 0), 1);
    assert_eq!(transcript_scroll_offset(narrow_count, narrow, 1), 0);
    assert_eq!(
        transcript_scroll_offset(narrow_count, narrow, usize::MAX),
        0
    );
    assert_eq!(
        transcript_scroll_offset(paragraph.line_count(10), Rect::new(0, 0, 10, 1), 0,),
        0
    );
}

#[test]
fn transcript_page_size_tracks_resize() {
    let mut app = App::default();

    assert_eq!(transcript_page_size(80, 10, &app), 5);
    assert_eq!(transcript_page_size(80, 6, &app), 1);
    app.attach_image(std::path::PathBuf::from("/tmp/one.png"));
    app.attach_image(std::path::PathBuf::from("/tmp/two.png"));
    // Inline image elements use the editor's existing row, not separate attachment rows.
    assert_eq!(transcript_page_size(80, 10, &app), 5);
}

#[test]
fn transcript_follow_control_reports_activity_and_returns_to_latest() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.projection.apply(ServerNotification::AgentMessageDelta(
        AgentMessageDeltaNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "assistant-1".to_string(),
            delta: (0..14)
                .map(|index| format!("canonical row {index:02}"))
                .collect::<Vec<_>>()
                .join("\n"),
        },
    ));
    let mut terminal = Terminal::new(TestBackend::new(60, 10)).expect("terminal");

    terminal.draw(|frame| render(frame, &app)).expect("draw");
    assert!(app.chat_widget.transcript_viewport.tail_visible());
    assert!(!buffer_text(&terminal).contains("Back to bottom"));

    app.scroll_up(4);
    terminal.draw(|frame| render(frame, &app)).expect("pause");
    assert!(!app.chat_widget.transcript_viewport.tail_visible());
    assert!(buffer_text(&terminal).contains("Back to bottom"));
    assert!(!buffer_text(&terminal).contains("New activity"));

    dispatch_connected_input(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::ALT)),
    );
    terminal
        .draw(|frame| render(frame, &app))
        .expect("raw repaint");
    assert!(buffer_text(&terminal).contains("Back to bottom"));
    assert!(!buffer_text(&terminal).contains("New activity"));

    app.projection.apply(ServerNotification::AgentMessageDelta(
        AgentMessageDeltaNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "assistant-1".to_string(),
            delta: "\nLATEST_CANONICAL_ROW".to_string(),
        },
    ));
    terminal
        .draw(|frame| render(frame, &app))
        .expect("activity repaint");
    let paused = buffer_text(&terminal);
    assert!(paused.contains("New activity"), "{paused}");
    assert!(app.chat_widget.transcript_viewport.unseen_activity());

    let area = app
        .chat_widget
        .transcript_follow_control
        .area()
        .expect("follow control area");
    for kind in [
        crossterm::event::MouseEventKind::Down(crossterm::event::MouseButton::Left),
        crossterm::event::MouseEventKind::Up(crossterm::event::MouseButton::Left),
    ] {
        dispatch_connected_input(
            &mut app,
            Event::Mouse(crossterm::event::MouseEvent {
                kind,
                column: area.x,
                row: area.y,
                modifiers: KeyModifiers::NONE,
            }),
        );
    }
    assert_eq!(app.chat_widget.transcript_scroll, 0);
    terminal
        .draw(|frame| render(frame, &app))
        .expect("latest repaint");
    let latest = buffer_text(&terminal);
    assert!(latest.contains("LATEST_CANONICAL_ROW"), "{latest}");
    assert!(!latest.contains("Back to bottom"), "{latest}");
    assert!(!app.chat_widget.transcript_viewport.unseen_activity());

    app.scroll_up(4);
    terminal
        .draw(|frame| render(frame, &app))
        .expect("pause again");
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE)),
        ),
        crate::app::AppAction::None
    );
    assert_eq!(app.chat_widget.transcript_scroll, 0);
    terminal
        .draw(|frame| render(frame, &app))
        .expect("escape repaint");
    assert!(!buffer_text(&terminal).contains("Back to bottom"));
}

#[test]
fn transcript_follow_control_adapts_to_width_and_yields_to_composer_popup() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.projection.apply(ServerNotification::AgentMessageDelta(
        AgentMessageDeltaNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "assistant-1".to_string(),
            delta: (0..10)
                .map(|index| format!("row {index:02}"))
                .collect::<Vec<_>>()
                .join("\n"),
        },
    ));
    app.scroll_up(2);
    let mut terminal = Terminal::new(TestBackend::new(12, 8)).expect("terminal");

    terminal.draw(|frame| render(frame, &app)).expect("draw");
    let narrow = buffer_text(&terminal);
    assert!(narrow.contains("↓ Bottom"), "{narrow}");
    assert!(app.chat_widget.transcript_follow_control.area().is_some());

    dispatch_connected_input(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Char('/'), KeyModifiers::NONE)),
    );
    assert!(app.chat_widget.bottom_pane.popup_active());
    terminal
        .draw(|frame| render(frame, &app))
        .expect("popup draw");
    assert!(app.chat_widget.transcript_follow_control.area().is_none());
}

#[test]
fn transcript_copy_feedback_temporarily_owns_the_composer_gap() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.projection.apply(ServerNotification::AgentMessageDelta(
        AgentMessageDeltaNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "assistant-1".to_string(),
            delta: (0..12)
                .map(|index| format!("row {index:02}"))
                .collect::<Vec<_>>()
                .join("\n"),
        },
    ));
    app.scroll_up(3);
    app.chat_widget
        .transcript_composer_gap
        .show_copy_feedback(&Ok(crate::clipboard_copy::CopyStatus::Confirmed), 7);
    let mut terminal = Terminal::new(TestBackend::new(60, 10)).expect("terminal");

    terminal
        .draw(|frame| render(frame, &app))
        .expect("feedback draw");
    let feedback = buffer_text(&terminal);
    assert!(feedback.contains("Copied 7 chars"), "{feedback}");
    assert!(!feedback.contains("Back to bottom"), "{feedback}");
    assert!(app.chat_widget.transcript_follow_control.area().is_none());

    app.chat_widget.transcript_composer_gap.expire_for_test();
    assert_eq!(
        app.pre_draw_tick(Instant::now()),
        crate::app::AppAction::None
    );
    terminal
        .draw(|frame| render(frame, &app))
        .expect("follow draw");
    assert!(buffer_text(&terminal).contains("Back to bottom"));
    assert!(app.chat_widget.transcript_follow_control.area().is_some());
}

#[test]
fn main_transcript_selection_freezes_source_and_owns_copy_before_composer() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.projection.apply(ServerNotification::AgentMessageDelta(
        AgentMessageDeltaNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "assistant-1".to_string(),
            delta: (0..12)
                .map(|index| format!("canonical row {index:02}"))
                .chain(std::iter::once("SELECT_ME tail".to_string()))
                .collect::<Vec<_>>()
                .join("\n"),
        },
    ));
    let mut terminal = Terminal::new(TestBackend::new(60, 10)).expect("terminal");
    terminal.draw(|frame| render(frame, &app)).expect("draw");
    let buffer = terminal.backend().buffer();
    let (column, row) = (0..buffer.area.height)
        .find_map(|row| {
            let text = (0..buffer.area.width)
                .map(|column| buffer[(column, row)].symbol())
                .collect::<String>();
            text.find("SELECT_ME")
                .map(|column| (u16::try_from(column).expect("column"), row))
        })
        .expect("visible selection marker");
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Mouse(crossterm::event::MouseEvent {
                kind: crossterm::event::MouseEventKind::ScrollUp,
                column,
                row,
                modifiers: KeyModifiers::NONE,
            }),
        ),
        crate::app::AppAction::ScrollRows(-3)
    );
    let mouse = |kind| {
        Event::Mouse(crossterm::event::MouseEvent {
            kind,
            column,
            row,
            modifiers: KeyModifiers::NONE,
        })
    };
    for _ in 0..2 {
        dispatch_connected_input(
            &mut app,
            mouse(crossterm::event::MouseEventKind::Down(
                crossterm::event::MouseButton::Left,
            )),
        );
        dispatch_connected_input(
            &mut app,
            mouse(crossterm::event::MouseEventKind::Up(
                crossterm::event::MouseButton::Left,
            )),
        );
    }
    assert!(app.chat_widget.transcript_selection.is_active());

    terminal
        .draw(|frame| render(frame, &app))
        .expect("selected draw");
    let selected_cells = terminal
        .backend()
        .buffer()
        .content
        .iter()
        .filter(|cell| cell.modifier.contains(Modifier::REVERSED))
        .map(ratatui::buffer::Cell::symbol)
        .collect::<String>();
    assert_eq!(selected_cells, "SELECT_ME");
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL)),
        ),
        crate::app::AppAction::CopyTranscriptSelection {
            text: "SELECT_ME".to_string(),
            follow: false,
            target: crate::app::TranscriptSelectionTarget::MainTranscript,
        }
    );
    assert!(app.chat_widget.bottom_pane.composer_is_empty());

    app.projection.apply(ServerNotification::AgentMessageDelta(
        AgentMessageDeltaNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "assistant-1".to_string(),
            delta: "\nNEW_TAIL_ACTIVITY".to_string(),
        },
    ));
    terminal
        .draw(|frame| render(frame, &app))
        .expect("frozen draw");
    let frozen = buffer_text(&terminal);
    assert!(frozen.contains("SELECT_ME tail"), "{frozen}");
    assert!(!frozen.contains("NEW_TAIL_ACTIVITY"), "{frozen}");
    assert!(app.chat_widget.transcript_viewport.unseen_activity());

    app.finish_main_transcript_selection(false);
    assert!(app.chat_widget.transcript_scroll > 0);
    terminal
        .draw(|frame| render(frame, &app))
        .expect("resumed reading draw");
    assert!(!buffer_text(&terminal).contains("NEW_TAIL_ACTIVITY"));
}

#[test]
fn sticky_prompt_header_keeps_selection_rows_and_copy_position_stable() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    apply_completed_message(
        &mut app,
        "turn-1",
        ThreadItem::UserMessage {
            id: "user-1".to_string(),
            metadata: None,
            client_id: None,
            content: vec![UserInput::Text {
                text: "Explain the canonical transcript".to_string(),
                text_elements: Vec::new(),
            }],
        },
    );
    apply_completed_message(
        &mut app,
        "turn-1",
        ThreadItem::AgentMessage {
            id: "assistant-1".to_string(),
            metadata: None,
            text: (0..10)
                .map(|index| format!("answer row {index:02}"))
                .chain(std::iter::once("SELECT_HEADER_ROW tail".to_string()))
                .collect::<Vec<_>>()
                .join("\n"),
            phase: None,
            memory_citation: None,
            delivery: None,
        },
    );
    let mut terminal = Terminal::new(TestBackend::new(60, 10)).expect("terminal");

    terminal.draw(|frame| render(frame, &app)).expect("draw");
    let before = buffer_text(&terminal);
    assert!(
        before
            .lines()
            .next()
            .is_some_and(|line| line.contains("Explain the canonical transcript")),
        "{before}"
    );
    let buffer = terminal.backend().buffer();
    let (column, row) = (0..buffer.area.height)
        .find_map(|row| {
            let text = (0..buffer.area.width)
                .map(|column| buffer[(column, row)].symbol())
                .collect::<String>();
            text.find("SELECT_HEADER_ROW")
                .map(|column| (u16::try_from(column).expect("column"), row))
        })
        .expect("visible selection marker");
    assert!(row > 0, "header row must stay outside transcript selection");
    let mouse = |kind| {
        Event::Mouse(crossterm::event::MouseEvent {
            kind,
            column,
            row,
            modifiers: KeyModifiers::NONE,
        })
    };
    for _ in 0..2 {
        dispatch_connected_input(
            &mut app,
            mouse(crossterm::event::MouseEventKind::Down(
                crossterm::event::MouseButton::Left,
            )),
        );
        dispatch_connected_input(
            &mut app,
            mouse(crossterm::event::MouseEventKind::Up(
                crossterm::event::MouseButton::Left,
            )),
        );
    }
    assert!(app.chat_widget.transcript_selection.is_active());

    terminal
        .draw(|frame| render(frame, &app))
        .expect("selected draw");
    let selected = buffer_text(&terminal);
    assert!(
        selected
            .lines()
            .next()
            .is_some_and(|line| line.contains("Explain the canonical transcript")),
        "{selected}"
    );
    let selected_cells = terminal
        .backend()
        .buffer()
        .content
        .iter()
        .filter(|cell| cell.modifier.contains(Modifier::REVERSED))
        .map(ratatui::buffer::Cell::symbol)
        .collect::<String>();
    assert_eq!(selected_cells, "SELECT_HEADER_ROW");
    assert_eq!(
        dispatch_connected_input(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL)),
        ),
        crate::app::AppAction::CopyTranscriptSelection {
            text: "SELECT_HEADER_ROW".to_string(),
            follow: false,
            target: crate::app::TranscriptSelectionTarget::MainTranscript,
        }
    );
    app.finish_main_transcript_selection(false);
    terminal
        .draw(|frame| render(frame, &app))
        .expect("copy position draw");
    let after = buffer_text(&terminal);
    assert!(
        after
            .lines()
            .next()
            .is_some_and(|line| line.contains("Explain the canonical transcript")),
        "{after}"
    );
    assert!(after.contains("SELECT_HEADER_ROW tail"), "{after}");
}

#[test]
fn sticky_prompt_header_yields_at_turn_boundary_until_the_viewport_moves() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    for (turn_id, item) in [
        (
            "turn-1",
            ThreadItem::UserMessage {
                id: "user-1".to_string(),
                metadata: None,
                client_id: None,
                content: vec![UserInput::Text {
                    text: "First question".to_string(),
                    text_elements: Vec::new(),
                }],
            },
        ),
        (
            "turn-1",
            ThreadItem::AgentMessage {
                id: "assistant-1".to_string(),
                metadata: None,
                text: "first answer".to_string(),
                phase: None,
                memory_citation: None,
                delivery: None,
            },
        ),
        (
            "turn-2",
            ThreadItem::UserMessage {
                id: "user-2".to_string(),
                metadata: None,
                client_id: None,
                content: vec![UserInput::Text {
                    text: "Second question".to_string(),
                    text_elements: Vec::new(),
                }],
            },
        ),
        (
            "turn-2",
            ThreadItem::AgentMessage {
                id: "assistant-2".to_string(),
                metadata: None,
                text: "answer two\nanswer three\nanswer four\nanswer five\nanswer six".to_string(),
                phase: None,
                memory_citation: None,
                delivery: None,
            },
        ),
    ] {
        apply_completed_message(&mut app, turn_id, item);
    }
    // Keep this boundary scenario's transcript viewport stable with the padded composer.
    let mut terminal = Terminal::new(TestBackend::new(40, 11)).expect("terminal");

    terminal.draw(|frame| render(frame, &app)).expect("draw");
    let first = buffer_text(&terminal);
    assert!(
        first
            .lines()
            .next()
            .is_some_and(|line| line.contains("first answer")),
        "{first}"
    );
    assert!(app.chat_widget.transcript_prompt_header.has_suppression());

    terminal
        .draw(|frame| render(frame, &app))
        .expect("stable draw");
    assert_eq!(buffer_text(&terminal), first);
    assert!(app.chat_widget.transcript_prompt_header.has_suppression());

    app.scroll_up(1);
    terminal
        .draw(|frame| render(frame, &app))
        .expect("moved draw");
    assert!(!app.chat_widget.transcript_prompt_header.has_suppression());
    app.scroll_bottom();
    terminal
        .draw(|frame| render(frame, &app))
        .expect("returned draw");
    assert_eq!(buffer_text(&terminal), first);
    assert!(app.chat_widget.transcript_prompt_header.has_suppression());
}

#[test]
fn sticky_prompt_header_and_reading_anchor_survive_prepend_and_reflow() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    apply_completed_message(
        &mut app,
        "turn-current",
        ThreadItem::UserMessage {
            id: "user-current".to_string(),
            metadata: None,
            client_id: None,
            content: vec![UserInput::Text {
                text: "Current question with enough context to truncate safely".to_string(),
                text_elements: Vec::new(),
            }],
        },
    );
    apply_completed_message(
        &mut app,
        "turn-current",
        ThreadItem::AgentMessage {
            id: "assistant-current".to_string(),
            metadata: None,
            text: (0..16)
                .map(|index| format!("current row {index:02} stable anchor text"))
                .collect::<Vec<_>>()
                .join("\n"),
            phase: None,
            memory_citation: None,
            delivery: None,
        },
    );
    app.scroll_up(4);
    let mut wide = Terminal::new(TestBackend::new(60, 10)).expect("wide terminal");

    wide.draw(|frame| render(frame, &app)).expect("wide draw");
    let before = buffer_text(&wide);
    let anchor = before
        .lines()
        .skip(1)
        .find_map(|line| {
            line.find("current row ").map(|start| {
                line[start..]
                    .split_whitespace()
                    .take(3)
                    .collect::<Vec<_>>()
                    .join(" ")
            })
        })
        .expect("visible canonical anchor");
    assert!(
        before
            .lines()
            .next()
            .is_some_and(|line| line.contains("Current question")),
        "{before}"
    );

    app.projection.prepend_items([
        ThreadItem::UserMessage {
            id: "user-older".to_string(),
            metadata: None,
            client_id: None,
            content: vec![UserInput::Text {
                text: "Older question".to_string(),
                text_elements: Vec::new(),
            }],
        },
        ThreadItem::AgentMessage {
            id: "assistant-older".to_string(),
            metadata: None,
            text: "older answer".to_string(),
            phase: None,
            memory_citation: None,
            delivery: None,
        },
    ]);
    wide.draw(|frame| render(frame, &app))
        .expect("prepend draw");
    assert_eq!(buffer_text(&wide), before);

    let mut narrow = Terminal::new(TestBackend::new(30, 10)).expect("narrow terminal");
    narrow
        .draw(|frame| render(frame, &app))
        .expect("reflow draw");
    let reflowed = buffer_text(&narrow);
    assert!(
        reflowed
            .lines()
            .next()
            .is_some_and(|line| line.starts_with("› Current question")),
        "{reflowed}"
    );
    assert!(reflowed.contains(&anchor), "missing {anchor}: {reflowed}");
}
