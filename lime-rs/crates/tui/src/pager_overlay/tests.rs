use super::*;
use crate::status::StatusFacts;
use crate::terminal_hyperlinks::TerminalHyperlink;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers, MouseButton, MouseEvent, MouseEventKind};
use ratatui::backend::TestBackend;
use ratatui::Terminal;

fn key(code: KeyCode) -> Event {
    Event::Key(KeyEvent::new(code, KeyModifiers::NONE))
}

fn mouse(kind: MouseEventKind, column: u16, row: u16) -> Event {
    Event::Mouse(MouseEvent {
        kind,
        column,
        row,
        modifiers: KeyModifiers::NONE,
    })
}

fn buffer_text(terminal: &Terminal<TestBackend>) -> String {
    let buffer = terminal.backend().buffer();
    (0..buffer.area.height)
        .map(|y| {
            (0..buffer.area.width)
                .map(|x| buffer[(x, y)].symbol())
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn static_overlay_wraps_scrolls_jumps_and_closes() {
    let mut overlay = PagerOverlay::new(
        "STATUS".to_string(),
        (0..8)
            .map(|index| {
                Line::raw(format!(
                    "line {index}: a very long status value that wraps in a narrow terminal"
                ))
            })
            .collect(),
    );
    let mut terminal = Terminal::new(TestBackend::new(24, 5)).expect("terminal");
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &[]))
        .expect("draw");
    assert!(overlay.max_scroll.get() > 0);
    assert!(buffer_text(&terminal).contains("line 0: a very long"));

    assert_eq!(
        overlay.handle_event(&key(KeyCode::Down)),
        PagerAction::Consumed
    );
    assert_eq!(overlay.scroll.get(), 1);
    assert_eq!(
        overlay.handle_event(&key(KeyCode::PageDown)),
        PagerAction::Consumed
    );
    assert_eq!(overlay.scroll.get(), 3);
    assert_eq!(
        overlay.handle_event(&key(KeyCode::Up)),
        PagerAction::Consumed
    );
    assert_eq!(overlay.scroll.get(), 2);

    assert_eq!(
        overlay.handle_event(&key(KeyCode::End)),
        PagerAction::Consumed
    );
    assert_eq!(overlay.scroll.get(), overlay.max_scroll.get());
    assert_eq!(
        overlay.handle_event(&key(KeyCode::PageUp)),
        PagerAction::Consumed
    );
    assert!(overlay.scroll.get() < overlay.max_scroll.get());
    assert_eq!(
        overlay.handle_event(&key(KeyCode::Home)),
        PagerAction::Consumed
    );
    assert_eq!(overlay.scroll.get(), 0);
    assert_eq!(overlay.handle_event(&key(KeyCode::Esc)), PagerAction::Close);
}

#[test]
fn resize_recomputes_scroll_bounds_and_tiny_areas_do_not_panic() {
    let overlay = PagerOverlay::new(
        "STATUS".to_string(),
        vec![Line::raw(
            "a long value that needs several rows in a narrow viewport",
        )],
    );
    let mut narrow = Terminal::new(TestBackend::new(10, 5)).expect("terminal");
    narrow
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &[]))
        .expect("narrow draw");
    assert!(overlay.max_scroll.get() > 0);
    overlay.scroll.set(overlay.max_scroll.get());

    let mut wide = Terminal::new(TestBackend::new(80, 12)).expect("terminal");
    wide.draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &[]))
        .expect("wide draw");
    assert_eq!(overlay.max_scroll.get(), 0);
    assert_eq!(overlay.scroll.get(), 0);
    assert_eq!(overlay.page_height.get(), 9);

    let mut tiny = Terminal::new(TestBackend::new(1, 1)).expect("terminal");
    tiny.draw(|frame| {
        overlay.render(frame, Rect::new(0, 0, 0, 0), Locale::EnUs, &[]);
        overlay.render(frame, frame.area(), Locale::EnUs, &[]);
    })
    .expect("tiny draw");
}

#[test]
fn status_overlay_uses_current_values_without_a_second_session_model() {
    let overlay = PagerOverlay::status(
        Locale::EnUs,
        StatusFacts {
            thread_id: Some("thread-1"),
            model: Some("gpt-5"),
            provider: Some("openai"),
            effort: Some("high"),
            permissions: Some(":workspace"),
            cwd: "/workspace",
            status: "running",
            token_usage: None,
        },
    );
    let text = overlay
        .static_lines
        .as_ref()
        .expect("status lines")
        .iter()
        .flat_map(|line| &line.line.spans)
        .map(|span| span.content.as_ref())
        .collect::<String>();

    for value in [
        "thread-1",
        "gpt-5",
        "openai",
        "high",
        ":workspace",
        "/workspace",
        "running",
    ] {
        assert!(text.contains(value), "missing {value}: {text}");
    }
}

#[test]
fn status_overlay_localizes_an_empty_projection_status_as_ready() {
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        let overlay = PagerOverlay::status(
            locale,
            StatusFacts {
                thread_id: None,
                model: None,
                provider: None,
                effort: None,
                permissions: None,
                cwd: "/workspace",
                status: "",
                token_usage: None,
            },
        );
        let text = overlay
            .static_lines
            .as_ref()
            .expect("status lines")
            .iter()
            .flat_map(|line| &line.line.spans)
            .map(|span| span.content.as_ref())
            .collect::<String>();

        assert!(text.contains(locale.ready_label()), "{locale:?}: {text}");
    }
}

#[test]
fn transcript_overlay_starts_at_tail_follows_updates_and_closes_with_ctrl_t() {
    let mut overlay = PagerOverlay::transcript(Locale::EnUs);
    let initial = (0..8)
        .map(|index| HyperlinkLine::from(format!("line {index}")))
        .collect::<Vec<_>>();
    let mut terminal = Terminal::new(TestBackend::new(24, 6)).expect("terminal");
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &initial))
        .expect("initial draw");
    assert_eq!(overlay.scroll.get(), overlay.max_scroll.get());
    assert!(buffer_text(&terminal).contains("line 7"));

    let updated = (0..10)
        .map(|index| HyperlinkLine::from(format!("line {index}")))
        .collect::<Vec<_>>();
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &updated))
        .expect("updated draw");
    assert_eq!(overlay.scroll.get(), overlay.max_scroll.get());
    assert!(buffer_text(&terminal).contains("line 9"));

    assert_eq!(
        overlay.handle_event(&Event::Key(KeyEvent::new(
            KeyCode::Char('t'),
            KeyModifiers::CONTROL,
        ))),
        PagerAction::Close
    );
}

#[test]
fn transcript_selection_owns_copy_without_destroying_active_search() {
    let mut overlay = PagerOverlay::transcript(Locale::EnUs);
    let lines = vec![HyperlinkLine::from("alpha beta")];
    let mut terminal = Terminal::new(TestBackend::new(40, 8)).expect("terminal");
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
        .expect("draw");
    overlay.handle_event(&key(KeyCode::Char('/')));
    overlay.handle_event(&key(KeyCode::Char('a')));

    for event in [
        mouse(MouseEventKind::Down(MouseButton::Left), 0, 1),
        mouse(MouseEventKind::Drag(MouseButton::Left), 5, 1),
        mouse(MouseEventKind::Up(MouseButton::Left), 5, 1),
    ] {
        assert_eq!(overlay.handle_event(&event), PagerAction::Consumed);
    }

    assert!(overlay.search.is_active());
    assert_eq!(overlay.search.query(), "a");
    assert_eq!(
        overlay.handle_event(&Event::Key(KeyEvent::new(
            KeyCode::Char('c'),
            KeyModifiers::CONTROL | KeyModifiers::SHIFT,
        ))),
        PagerAction::CopyTranscriptSelection {
            text: "alpha".to_string(),
            follow: false,
        }
    );
    assert!(overlay.search.is_active());
    assert_eq!(overlay.search.query(), "a");

    assert_eq!(
        overlay.handle_event(&key(KeyCode::Esc)),
        PagerAction::Consumed
    );
    assert!(
        overlay.search.is_active(),
        "first Escape clears only selection"
    );
    assert_eq!(
        overlay.handle_event(&key(KeyCode::Esc)),
        PagerAction::Consumed
    );
    assert!(!overlay.search.is_active(), "second Escape closes search");
}

#[test]
fn transcript_wheel_and_keyboard_selection_keep_scroll_in_pager_owner() {
    let mut overlay = PagerOverlay::transcript(Locale::EnUs);
    let lines = (0..20)
        .map(|index| HyperlinkLine::from(format!("line {index}")))
        .collect::<Vec<_>>();
    let mut terminal = Terminal::new(TestBackend::new(20, 8)).expect("terminal");
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
        .expect("draw");
    let tail = overlay.max_scroll.get();

    assert_eq!(
        overlay.handle_event(&mouse(MouseEventKind::ScrollUp, 0, 1)),
        PagerAction::Consumed
    );
    assert_eq!(overlay.scroll.get(), tail.saturating_sub(3));
    assert!(!overlay.pinned_to_bottom.get());
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
        .expect("wheel redraw");

    assert_eq!(
        overlay.handle_event(&Event::Key(KeyEvent::new(
            KeyCode::Char(' '),
            KeyModifiers::CONTROL,
        ))),
        PagerAction::Consumed
    );
    let before = overlay.scroll.get();
    for _ in 0..overlay.page_height.get() {
        assert_eq!(
            overlay.handle_event(&key(KeyCode::Down)),
            PagerAction::Consumed
        );
    }
    assert_eq!(overlay.scroll.get(), before.saturating_add(1));
}

#[test]
fn transcript_edge_drag_scrolls_one_row_per_tick_and_extends_after_render() {
    let mut overlay = PagerOverlay::transcript(Locale::EnUs);
    let lines = (0..20)
        .map(|index| HyperlinkLine::from(format!("line {index}")))
        .collect::<Vec<_>>();
    let mut terminal = Terminal::new(TestBackend::new(20, 8)).expect("terminal");
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
        .expect("tail draw");
    assert_eq!(
        overlay.handle_event(&key(KeyCode::Home)),
        PagerAction::Consumed
    );
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
        .expect("top draw");

    assert_eq!(
        overlay.handle_event(&mouse(MouseEventKind::Down(MouseButton::Left), 0, 2)),
        PagerAction::Consumed
    );
    assert_eq!(
        overlay.handle_event(&mouse(MouseEventKind::Drag(MouseButton::Left), 6, 5)),
        PagerAction::ContinueTranscriptSelection
    );
    assert_eq!(
        overlay
            .transcript_selection
            .selected_text_for_test()
            .as_deref(),
        Some("line 1\nline 2\nline 3\nline 4")
    );

    assert!(overlay.tick_transcript_selection());
    assert_eq!(overlay.scroll.get(), 1);
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
        .expect("edge tick draw");
    assert_eq!(
        overlay
            .transcript_selection
            .selected_text_for_test()
            .as_deref(),
        Some("line 1\nline 2\nline 3\nline 4\nline 5")
    );

    while overlay.tick_transcript_selection() {
        terminal
            .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
            .expect("continued edge tick draw");
    }
    assert_eq!(overlay.scroll.get(), overlay.max_scroll.get());
    assert!(!overlay.tick_transcript_selection());
}

#[test]
fn horizontal_edge_drag_and_focus_loss_do_not_continue_scrolling() {
    let mut overlay = PagerOverlay::transcript(Locale::EnUs);
    let lines = (0..20)
        .map(|index| HyperlinkLine::from(format!("line {index}")))
        .collect::<Vec<_>>();
    let mut terminal = Terminal::new(TestBackend::new(20, 8)).expect("terminal");
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
        .expect("tail draw");
    overlay.handle_event(&key(KeyCode::Home));
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
        .expect("top draw");
    overlay.handle_event(&key(KeyCode::Down));
    overlay.handle_event(&key(KeyCode::Down));
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
        .expect("reading-position draw");

    overlay.handle_event(&mouse(MouseEventKind::Down(MouseButton::Left), 0, 1));
    assert_eq!(
        overlay.handle_event(&mouse(MouseEventKind::Drag(MouseButton::Left), 4, 1)),
        PagerAction::Consumed
    );
    assert!(!overlay.tick_transcript_selection());

    overlay.handle_event(&mouse(MouseEventKind::Drag(MouseButton::Left), 4, 3));
    overlay.handle_event(&mouse(MouseEventKind::Drag(MouseButton::Left), 4, 1));
    assert!(overlay.tick_transcript_selection());
    let selected = overlay.transcript_selection.selected_text_for_test();
    assert_eq!(
        overlay.handle_event(&Event::FocusLost),
        PagerAction::Consumed
    );
    assert!(!overlay.tick_transcript_selection());
    assert_eq!(
        overlay.transcript_selection.selected_text_for_test(),
        selected
    );
}

#[test]
fn transcript_link_action_requires_stationary_release() {
    let mut overlay = PagerOverlay::transcript(Locale::EnUs);
    let mut link = HyperlinkLine::from("docs");
    link.hyperlinks.push(TerminalHyperlink::web(
        0..4,
        "https://example.com/docs".to_string(),
    ));
    let mut terminal = Terminal::new(TestBackend::new(20, 6)).expect("terminal");
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &[link]))
        .expect("draw");

    assert_eq!(
        overlay.handle_event(&mouse(MouseEventKind::Down(MouseButton::Left), 1, 1)),
        PagerAction::Consumed
    );
    assert_eq!(
        overlay.handle_event(&mouse(MouseEventKind::Up(MouseButton::Left), 1, 1)),
        PagerAction::OpenLink("https://example.com/docs".to_string())
    );
}

#[test]
fn transcript_enter_copy_confirmation_resumes_tail_following() {
    let mut overlay = PagerOverlay::transcript(Locale::EnUs);
    let lines = (0..20)
        .map(|index| HyperlinkLine::from(format!("line {index}")))
        .collect::<Vec<_>>();
    let mut terminal = Terminal::new(TestBackend::new(20, 6)).expect("terminal");
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
        .expect("tail draw");
    overlay.handle_event(&key(KeyCode::Home));
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
        .expect("top draw");
    assert!(!overlay.pinned_to_bottom.get());
    overlay.handle_event(&key(KeyCode::Char('/')));
    overlay.handle_event(&key(KeyCode::Char('l')));
    assert!(overlay.search.is_active());

    for event in [
        mouse(MouseEventKind::Down(MouseButton::Left), 0, 1),
        mouse(MouseEventKind::Drag(MouseButton::Left), 4, 1),
        mouse(MouseEventKind::Up(MouseButton::Left), 4, 1),
    ] {
        overlay.handle_event(&event);
    }
    assert_eq!(
        overlay.handle_event(&key(KeyCode::Enter)),
        PagerAction::CopyTranscriptSelection {
            text: "line".to_string(),
            follow: true,
        }
    );

    overlay.apply_transcript_copy_result(
        true,
        4,
        &Ok(crate::clipboard_copy::CopyStatus::Unconfirmed),
    );
    assert!(!overlay.pinned_to_bottom.get());
    assert!(overlay.has_transcript_selection());
    assert!(overlay.search.is_active());
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
        .expect("unconfirmed draw");
    assert!(buffer_text(&terminal).contains("Copy sent to term"));

    overlay.apply_transcript_copy_result(
        true,
        4,
        &Ok(crate::clipboard_copy::CopyStatus::Confirmed),
    );
    assert!(overlay.pinned_to_bottom.get());
    assert_eq!(overlay.scroll.get(), overlay.max_scroll.get());
    assert!(!overlay.has_transcript_selection());
    assert!(!overlay.search.is_active());
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
        .expect("confirmed draw");
    assert!(buffer_text(&terminal).contains("Copied 4 chars"));
}

#[test]
fn transcript_overlay_requests_older_history_when_scrolled_to_the_top() {
    let mut overlay = PagerOverlay::transcript(Locale::EnUs);
    overlay.set_older_history_available(true);
    let lines = (0..12)
        .map(|index| HyperlinkLine::from(format!("line {index}")))
        .collect::<Vec<_>>();
    let mut terminal = Terminal::new(TestBackend::new(24, 6)).expect("terminal");
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
        .expect("initial draw");

    assert_eq!(
        overlay.handle_event(&key(KeyCode::Home)),
        PagerAction::LoadOlderHistory
    );
    assert_eq!(overlay.scroll.get(), 0);
    assert!(!overlay.pinned_to_bottom.get());
    assert_eq!(
        overlay.handle_event(&key(KeyCode::PageUp)),
        PagerAction::LoadOlderHistory
    );
}

#[test]
fn static_overlay_never_requests_older_history() {
    let mut overlay = PagerOverlay::new("STATUS".to_string(), vec![Line::raw("line")]);
    assert_eq!(
        overlay.handle_event(&key(KeyCode::Home)),
        PagerAction::Consumed
    );
}

#[test]
fn transcript_overlay_without_older_history_consumes_top_navigation() {
    let mut overlay = PagerOverlay::transcript(Locale::EnUs);
    assert_eq!(
        overlay.handle_event(&key(KeyCode::Home)),
        PagerAction::Consumed
    );
}

#[test]
fn transcript_history_failure_keeps_anchor_and_exposes_home_retry() {
    let mut overlay = PagerOverlay::transcript(Locale::EnUs);
    overlay.set_older_history_available(true);
    let lines = (0..16)
        .map(|index| HyperlinkLine::from(format!("line {index}")))
        .collect::<Vec<_>>();
    let mut terminal = Terminal::new(TestBackend::new(48, 8)).expect("terminal");
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
        .expect("initial draw");
    overlay.handle_event(&key(KeyCode::PageUp));
    let anchor = overlay.scroll.get();
    assert!(anchor > 0);

    overlay.begin_older_history_load();
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
        .expect("loading draw");
    assert!(buffer_text(&terminal).contains("Loading older history"));

    overlay.fail_older_history_load();
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
        .expect("failed draw");
    assert_eq!(overlay.scroll.get(), anchor);
    assert!(buffer_text(&terminal).contains("History load failed"));
    assert!(buffer_text(&terminal).contains("Home retry"));
    assert_eq!(
        overlay.handle_event(&key(KeyCode::Home)),
        PagerAction::LoadOlderHistory
    );

    overlay.begin_older_history_load();
    overlay.complete_older_history_load();
    assert_eq!(overlay.history_load_state.get(), HistoryLoadState::Idle);
}

#[test]
fn transcript_overlay_reset_anchor_keeps_newly_loaded_beginning_visible() {
    let overlay = PagerOverlay::transcript(Locale::EnUs);
    let old_lines = vec![HyperlinkLine::from("oldest loaded")];
    let mut terminal = Terminal::new(TestBackend::new(24, 6)).expect("terminal");
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &old_lines))
        .expect("initial draw");

    overlay.reset_transcript_anchor_at_top();
    let lines = vec![
        HyperlinkLine::from("actual oldest"),
        HyperlinkLine::from("oldest loaded"),
    ];
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
        .expect("expanded draw");

    assert_eq!(overlay.scroll.get(), 0);
}

#[test]
fn transcript_overlay_preserves_manual_scroll_when_projection_grows() {
    let mut overlay = PagerOverlay::transcript(Locale::EnUs);
    let initial = (0..10)
        .map(|index| HyperlinkLine::from(format!("line {index}")))
        .collect::<Vec<_>>();
    let mut terminal = Terminal::new(TestBackend::new(24, 6)).expect("terminal");
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &initial))
        .expect("initial draw");
    overlay.handle_event(&key(KeyCode::Up));
    let manual_scroll = overlay.scroll.get();

    let updated = (0..12)
        .map(|index| HyperlinkLine::from(format!("line {index}")))
        .collect::<Vec<_>>();
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &updated))
        .expect("updated draw");

    assert_eq!(overlay.scroll.get(), manual_scroll);
    assert!(!overlay.pinned_to_bottom.get());
}

#[test]
fn transcript_overlay_preserves_manual_anchor_when_history_is_prepended() {
    let mut overlay = PagerOverlay::transcript(Locale::EnUs);
    let initial = (0..20)
        .map(|index| HyperlinkLine::from(format!("line {index}")))
        .collect::<Vec<_>>();
    let mut terminal = Terminal::new(TestBackend::new(24, 6)).expect("terminal");
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &initial))
        .expect("initial draw");
    overlay.handle_event(&key(KeyCode::PageUp));
    let previous_scroll = overlay.scroll.get();
    assert!(!overlay.pinned_to_bottom.get());

    let mut updated = (0..3)
        .map(|index| HyperlinkLine::from(format!("older {index}")))
        .collect::<Vec<_>>();
    updated.extend(initial);
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &updated))
        .expect("prepended draw");

    assert_eq!(overlay.scroll.get(), previous_scroll + 3);
    assert!(!overlay.pinned_to_bottom.get());
}

#[test]
fn transcript_overlay_remaps_manual_anchor_when_width_reflows() {
    let overlay = PagerOverlay::transcript(Locale::EnUs);
    let mut lines = vec![
        HyperlinkLine::from("a long first transcript line that wraps after resize"),
        HyperlinkLine::from("anchor line"),
    ];
    lines.extend((0..8).map(|index| HyperlinkLine::from(format!("tail {index}"))));
    let mut wide = Terminal::new(TestBackend::new(48, 6)).expect("wide terminal");
    wide.draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
        .expect("wide draw");
    overlay.scroll.set(wrapped_line_starts(&lines, 48)[1]);
    overlay.pinned_to_bottom.set(false);

    let mut narrow = Terminal::new(TestBackend::new(16, 6)).expect("narrow terminal");
    narrow
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &lines))
        .expect("narrow draw");

    let expected = wrapped_line_starts(&lines, 16)[1];
    assert!(expected > 1);
    assert_eq!(overlay.scroll.get(), expected);
    assert!(!overlay.pinned_to_bottom.get());
}

#[test]
fn transcript_overlay_remaps_manual_anchor_when_streaming_line_grows_in_place() {
    let overlay = PagerOverlay::transcript(Locale::EnUs);
    let initial = vec![
        HyperlinkLine::from("stable header"),
        HyperlinkLine::from("anchor line"),
        HyperlinkLine::from("tail line"),
    ];
    let mut terminal = Terminal::new(TestBackend::new(18, 4)).expect("terminal");
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &initial))
        .expect("initial draw");
    overlay.pinned_to_bottom.set(false);
    overlay.scroll.set(wrapped_line_starts(&initial, 18)[1]);

    let updated = vec![
        HyperlinkLine::from("stable header that grew while streaming"),
        HyperlinkLine::from("anchor line"),
        HyperlinkLine::from("tail line"),
    ];
    terminal
        .draw(|frame| overlay.render(frame, frame.area(), Locale::EnUs, &updated))
        .expect("streaming redraw");

    assert_eq!(
        overlay.scroll.get(),
        wrapped_line_starts(&updated, 18)[1],
        "the same logical anchor should remain visible after an in-place stream update"
    );
    assert!(!overlay.pinned_to_bottom.get());
}
