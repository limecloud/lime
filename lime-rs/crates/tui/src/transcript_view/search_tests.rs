use super::*;

use crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers};
use ratatui::backend::TestBackend;
use ratatui::style::Modifier;
use ratatui::Terminal;

use crate::app::{App, AppAction};
use crate::locale::Locale;
use crate::terminal_hyperlinks::{HyperlinkLine, TerminalHyperlink};
use crate::tui::TuiEvent;
use app_server_protocol::protocol::v2::{AgentMessageDeltaNotification, ServerNotification};

fn key(code: KeyCode) -> Event {
    Event::Key(KeyEvent::new(code, KeyModifiers::NONE))
}

fn query(search: &mut TranscriptSearch, value: &str) {
    for character in value.chars() {
        assert_eq!(
            search.handle_event(&key(KeyCode::Char(character)), false),
            SearchAction::ScheduleFrame
        );
    }
}

fn finish(search: &TranscriptSearch, lines: &[HyperlinkLine], width: u16) {
    for _ in 0..512 {
        search.prepare(lines, width, &HashSet::new(), false);
        if !search.needs_frame() {
            return;
        }
    }
    panic!("bounded transcript search did not finish");
}

#[test]
fn literal_search_preserves_unicode_source_offsets() {
    assert_eq!(find_literal_ranges("界 CAFÉ [x].* İ", "café"), vec![4..9]);
    assert_eq!(
        find_literal_ranges("界 CAFÉ [x].* İ", "[x].*"),
        vec![10..15]
    );
    assert_eq!(
        find_literal_ranges("界 CAFÉ [x].* İ", "i\u{307}"),
        vec![16..18]
    );
}

#[test]
fn bounded_scan_yields_between_large_windows_and_eight_short_lines() {
    let mut search = TranscriptSearch::default();
    search.begin(0, true);
    query(&mut search, "needle");
    let lines = (0..20)
        .map(|index| {
            let suffix = if index == 0 { "needle" } else { "missing" };
            HyperlinkLine::from(format!("{} {suffix}", "x".repeat(20_000)))
        })
        .collect::<Vec<_>>();

    search.prepare(&lines, 80, &HashSet::new(), false);
    assert!(search.needs_frame());
    assert!(!search.matches_valid());
    finish(&search, &lines, 80);

    assert!(search.matches_valid());
    assert_eq!(search.match_count(), 1);
    assert_eq!(search.selected_match().map(|found| found.line), Some(0));
}

#[test]
fn selection_pauses_scan_and_keeps_find_highlight_secondary() {
    let mut search = TranscriptSearch::default();
    search.begin(0, true);
    query(&mut search, "needle");
    let lines = vec![HyperlinkLine::from("prefix needle suffix")];

    search.prepare(&lines, 80, &HashSet::new(), true);
    assert!(search.needs_frame());
    assert_eq!(search.match_count(), 0);

    finish(&search, &lines, 80);
    let highlighted = search.highlighted_lines(&lines);
    let spans = &highlighted[0].line.spans;
    assert!(spans.iter().any(|span| {
        span.content == "n" && span.style.add_modifier.contains(Modifier::REVERSED)
    }));
    assert!(spans.iter().any(|span| {
        span.content == "p" && !span.style.add_modifier.contains(Modifier::REVERSED)
    }));
}

#[test]
fn navigation_requests_existing_history_pager_and_close_restores_position() {
    let mut search = TranscriptSearch::default();
    search.begin(7, true);
    query(&mut search, "needle");
    let lines = vec![
        HyperlinkLine::from("old needle"),
        HyperlinkLine::from("new needle"),
    ];
    finish(&search, &lines, 80);
    assert_eq!(search.cursor(), 1);

    assert_eq!(
        search.handle_event(
            &Event::Key(KeyEvent::new(KeyCode::Char('p'), KeyModifiers::CONTROL)),
            true,
        ),
        SearchAction::Consumed
    );
    assert_eq!(search.cursor(), 0);
    assert_eq!(
        search.handle_event(
            &Event::Key(KeyEvent::new(KeyCode::Char('p'), KeyModifiers::CONTROL)),
            true,
        ),
        SearchAction::LoadOlderHistory
    );
    assert_eq!(search.boundary(), SearchBoundary::Older);
    assert_eq!(
        search.handle_event(&key(KeyCode::Esc), true),
        SearchAction::Closed {
            restore_scroll: Some(7)
        }
    );
}

#[test]
fn prepend_revision_and_resize_restart_without_losing_literal_identity() {
    let mut search = TranscriptSearch::default();
    search.begin(0, true);
    query(&mut search, "needle");
    let initial = vec![HyperlinkLine::from("current needle")];
    finish(&search, &initial, 80);
    assert_eq!(search.selected_match().map(|found| found.line), Some(0));

    let prepended = vec![
        HyperlinkLine::from("older needle"),
        HyperlinkLine::from("current needle"),
    ];
    search.prepare(&prepended, 24, &HashSet::new(), false);
    finish(&search, &prepended, 24);
    assert_eq!(search.selected_match().map(|found| found.line), Some(1));

    let revised = vec![
        HyperlinkLine::from("older needle"),
        HyperlinkLine::from("current changed"),
    ];
    finish(&search, &revised, 24);
    assert_eq!(search.match_count(), 1);
    assert_eq!(search.selected_match().map(|found| found.line), Some(0));
}

#[test]
fn query_cap_and_backspace_preserve_grapheme_boundaries() {
    let mut search = TranscriptSearch::default();
    search.begin(0, true);
    let prefix = "x".repeat(MAX_SEARCH_QUERY_BYTES - 1);
    assert_eq!(
        search.handle_event(&Event::Paste(prefix), false),
        SearchAction::ScheduleFrame
    );
    assert_eq!(
        search.handle_event(&Event::Paste("e\u{301}".to_string()), false),
        SearchAction::ScheduleFrame
    );
    assert!(search.query_truncated());
    assert_eq!(search.query().len(), MAX_SEARCH_QUERY_BYTES - 1);

    search.clear();
    search.begin(0, true);
    assert_eq!(
        search.handle_event(&Event::Paste("e\u{301}👩‍💻".to_string()), false),
        SearchAction::ScheduleFrame
    );
    search.handle_event(&key(KeyCode::Backspace), false);
    assert_eq!(search.query(), "e\u{301}");
    search.handle_event(&key(KeyCode::Backspace), false);
    assert!(search.query().is_empty());
}

#[test]
fn highlight_keeps_hyperlink_geometry_unchanged() {
    let mut line = HyperlinkLine::from("prefix needle suffix".to_string());
    line.hyperlinks.push(TerminalHyperlink {
        columns: 0..20,
        destination: "https://example.com".to_string(),
    });
    let lines = vec![line.clone()];
    let mut search = TranscriptSearch::default();
    search.begin(0, true);
    query(&mut search, "needle");
    finish(&search, &lines, 80);

    let highlighted = search.highlighted_lines(&lines);
    assert_eq!(highlighted[0].hyperlinks, line.hyperlinks);
}

fn dispatch(app: &mut App, event: Event) -> AppAction {
    let event = match event {
        Event::Key(key) => TuiEvent::Key(key),
        Event::Paste(text) => TuiEvent::Paste(text),
        Event::Mouse(mouse) => TuiEvent::Mouse(mouse),
        Event::Resize(width, height) => TuiEvent::Resize(ratatui::layout::Size { width, height }),
        Event::FocusGained => TuiEvent::FocusGained,
        Event::FocusLost => TuiEvent::FocusLost,
    };
    app.handle_tui_event(event, /*connected*/ true)
}

fn terminal_text(terminal: &Terminal<TestBackend>) -> String {
    let buffer = terminal.backend().buffer();
    (0..buffer.area.height)
        .flat_map(|row| {
            (0..buffer.area.width)
                .map(move |column| buffer[(column, row)].symbol().to_string())
                .chain(std::iter::once("\n".to_string()))
        })
        .collect()
}

fn draw_until_search_idle(app: &App, terminal: &mut Terminal<TestBackend>) {
    for _ in 0..32 {
        terminal
            .draw(|frame| crate::view::render(frame, app))
            .expect("search draw");
        if !app.chat_widget.transcript_search.needs_frame() {
            return;
        }
    }
    panic!("main transcript search did not finish");
}

fn app_with_searchable_transcript() -> App {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.projection.apply(ServerNotification::AgentMessageDelta(
        AgentMessageDeltaNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "assistant-1".to_string(),
            delta: (0..18)
                .map(|index| {
                    if index == 4 || index == 15 {
                        format!("canonical NEEDLE row {index:02}")
                    } else {
                        format!("canonical row {index:02}")
                    }
                })
                .collect::<Vec<_>>()
                .join("\n"),
        },
    ));
    app
}

#[test]
fn main_find_owns_query_footer_highlight_and_restores_compact_position() {
    let mut app = app_with_searchable_transcript();
    app.scroll_up(5);
    let saved_scroll = app.chat_widget.transcript_scroll;
    let mut terminal = Terminal::new(TestBackend::new(64, 12)).expect("terminal");
    terminal
        .draw(|frame| crate::view::render(frame, &app))
        .expect("initial draw");

    assert!(matches!(
        dispatch(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::F(3), KeyModifiers::NONE)),
        ),
        AppAction::ScheduleFrameIn(_)
    ));
    for character in "needle".chars() {
        dispatch(&mut app, key(KeyCode::Char(character)));
    }
    draw_until_search_idle(&app, &mut terminal);

    let text = terminal_text(&terminal);
    assert!(text.contains("Find: needle▏"), "{text}");
    assert!(text.contains("Match 2/2"), "{text}");
    assert!(terminal
        .backend()
        .buffer()
        .content()
        .iter()
        .any(|cell| cell.style().add_modifier.contains(Modifier::REVERSED)));
    assert!(app.chat_widget.bottom_pane.composer_is_empty());

    assert_eq!(dispatch(&mut app, key(KeyCode::Esc)), AppAction::None);
    assert!(!app.chat_widget.transcript_search.is_active());
    assert_eq!(app.chat_widget.transcript_scroll, saved_scroll);
}

#[test]
fn main_find_pauses_for_selection_and_reuses_older_history_action() {
    let mut app = app_with_searchable_transcript();
    app.scrollback_has_older_history = true;
    let mut terminal = Terminal::new(TestBackend::new(64, 12)).expect("terminal");
    terminal
        .draw(|frame| crate::view::render(frame, &app))
        .expect("initial draw");
    dispatch(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::F(3), KeyModifiers::NONE)),
    );
    dispatch(&mut app, Event::Paste("missing-value".to_string()));
    draw_until_search_idle(&app, &mut terminal);

    assert_eq!(
        app.pre_draw_tick(std::time::Instant::now()),
        AppAction::LoadOlderHistory
    );
    app.chat_widget.transcript_search.begin_history_load();
    assert_eq!(
        dispatch(
            &mut app,
            Event::Key(KeyEvent::new(KeyCode::Char('p'), KeyModifiers::CONTROL)),
        ),
        AppAction::None
    );

    app.chat_widget.transcript_search.complete_history_load();
    dispatch(&mut app, key(KeyCode::Esc));
    dispatch(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::F(3), KeyModifiers::NONE)),
    );
    dispatch(&mut app, Event::Paste("needle".to_string()));
    draw_until_search_idle(&app, &mut terminal);
    dispatch(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Char(' '), KeyModifiers::CONTROL)),
    );
    assert!(app.chat_widget.transcript_selection.is_active());
    terminal
        .draw(|frame| crate::view::render(frame, &app))
        .expect("selection draw");
    assert!(terminal_text(&terminal).contains("copy"));
}

#[test]
fn ctrl_f_remains_an_editor_key_instead_of_opening_main_find() {
    let mut app = app_with_searchable_transcript();
    app.chat_widget.bottom_pane.insert_str("ab");
    dispatch(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Char('a'), KeyModifiers::CONTROL)),
    );
    dispatch(
        &mut app,
        Event::Key(KeyEvent::new(KeyCode::Char('f'), KeyModifiers::CONTROL)),
    );
    dispatch(&mut app, key(KeyCode::Char('x')));

    assert!(!app.chat_widget.transcript_search.is_active());
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), "axb");
}
