use super::*;

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers, MouseButton, MouseEvent, MouseEventKind};
use ratatui::backend::TestBackend;
use ratatui::Terminal;

use crate::terminal_hyperlinks::HyperlinkLine;
use crate::transcript_view::TranscriptContent;
use crate::tui::TuiEvent;

fn press(app: &mut App, code: KeyCode, modifiers: KeyModifiers) -> AppAction {
    app.handle_tui_event(TuiEvent::Key(KeyEvent::new(code, modifiers)), true)
}

fn toggle_transcript(app: &mut App) -> AppAction {
    press(app, KeyCode::Char('t'), KeyModifiers::CONTROL)
}

fn lines(count: usize) -> Vec<HyperlinkLine> {
    (0..count)
        .map(|index| HyperlinkLine::from(format!("line {index:02}")))
        .collect()
}

fn draw_lines(app: &App, lines: &[HyperlinkLine]) -> Terminal<TestBackend> {
    let mut terminal = Terminal::new(TestBackend::new(40, 8)).expect("terminal");
    terminal
        .draw(|frame| {
            app.chat_widget
                .pager_overlay
                .as_ref()
                .expect("transcript")
                .render(frame, frame.area(), Locale::EnUs, lines);
        })
        .expect("draw transcript");
    terminal
}

fn terminal_text(terminal: &Terminal<TestBackend>) -> String {
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
fn detailed_bookmark_survives_close_without_moving_compact_position() {
    let mut app = App::default();
    app.set_thread_id("thread-1".to_string());
    app.chat_widget.transcript_scroll = 12;
    let transcript = lines(30);

    assert_eq!(toggle_transcript(&mut app), AppAction::None);
    draw_lines(&app, &transcript);
    assert_eq!(
        press(&mut app, KeyCode::Home, KeyModifiers::NONE),
        AppAction::None
    );
    assert_eq!(
        app.chat_widget
            .pager_overlay
            .as_ref()
            .expect("transcript")
            .transcript_scroll_position(),
        0
    );
    assert_eq!(app.chat_widget.transcript_scroll, 12);

    assert_eq!(toggle_transcript(&mut app), AppAction::None);
    assert!(app.chat_widget.pager_overlay.is_none());
    assert!(app
        .chat_widget
        .transcript_presentation
        .has_detailed_bookmark());
    assert_eq!(app.chat_widget.transcript_scroll, 12);

    assert_eq!(toggle_transcript(&mut app), AppAction::None);
    let terminal = draw_lines(&app, &transcript);
    assert_eq!(
        app.chat_widget
            .pager_overlay
            .as_ref()
            .expect("transcript")
            .transcript_scroll_position(),
        0
    );
    assert!(terminal_text(&terminal).contains("line 00"));
    assert_eq!(app.chat_widget.transcript_scroll, 12);
}

#[test]
fn closing_detailed_transcript_clears_search_and_selection() {
    let mut app = App::default();
    toggle_transcript(&mut app);
    let transcript = lines(10);
    draw_lines(&app, &transcript);

    for (kind, column) in [
        (MouseEventKind::Down(MouseButton::Left), 0),
        (MouseEventKind::Drag(MouseButton::Left), 5),
        (MouseEventKind::Up(MouseButton::Left), 5),
    ] {
        assert_eq!(
            app.handle_tui_event(
                TuiEvent::Mouse(MouseEvent {
                    kind,
                    column,
                    row: 2,
                    modifiers: KeyModifiers::NONE,
                }),
                true,
            ),
            AppAction::None
        );
    }
    assert!(app
        .chat_widget
        .pager_overlay
        .as_ref()
        .is_some_and(PagerOverlay::has_transcript_selection));

    app.dismiss_pager_overlay();
    app.open_transcript_pager();
    assert!(!app
        .chat_widget
        .pager_overlay
        .as_ref()
        .is_some_and(PagerOverlay::has_transcript_selection));

    assert_eq!(
        press(&mut app, KeyCode::Char('/'), KeyModifiers::NONE),
        AppAction::ScheduleFrameIn(crate::tui::TARGET_FRAME_INTERVAL)
    );
    assert!(app
        .chat_widget
        .pager_overlay
        .as_ref()
        .is_some_and(PagerOverlay::transcript_search_is_active));
    app.dismiss_pager_overlay();
    app.open_transcript_pager();
    assert!(!app
        .chat_widget
        .pager_overlay
        .as_ref()
        .is_some_and(PagerOverlay::transcript_search_is_active));
}

#[test]
fn detailed_disclosure_survives_close_without_restoring_focus() {
    let mut app = App::default();
    toggle_transcript(&mut app);
    let mut content = TranscriptContent::default();
    content.push_activity(
        vec!["entry:tool-1".to_string()],
        vec![HyperlinkLine::from("tool")],
        vec![HyperlinkLine::from("tool"), HyperlinkLine::from("detail")],
    );
    let mut terminal = Terminal::new(TestBackend::new(40, 8)).expect("terminal");
    terminal
        .draw(|frame| {
            app.chat_widget
                .pager_overlay
                .as_ref()
                .expect("transcript")
                .render_transcript(frame, frame.area(), Locale::EnUs, &content)
        })
        .expect("collapsed draw");
    press(&mut app, KeyCode::F(4), KeyModifiers::NONE);
    press(&mut app, KeyCode::Enter, KeyModifiers::NONE);

    app.dismiss_pager_overlay();
    app.open_transcript_pager();
    terminal
        .draw(|frame| {
            app.chat_widget
                .pager_overlay
                .as_ref()
                .expect("transcript")
                .render_transcript(frame, frame.area(), Locale::EnUs, &content)
        })
        .expect("reopened draw");
    let screen = terminal_text(&terminal);
    assert!(screen.contains("detail"), "{screen}");
    assert!(screen.contains("Show less"), "{screen}");
    assert!(!screen.contains("previous/next"), "{screen}");
}

#[test]
fn switching_threads_discards_the_detailed_bookmark() {
    let mut app = App::default();
    app.set_thread_id("thread-1".to_string());
    let transcript = lines(30);
    toggle_transcript(&mut app);
    draw_lines(&app, &transcript);
    press(&mut app, KeyCode::Home, KeyModifiers::NONE);
    toggle_transcript(&mut app);
    assert!(app
        .chat_widget
        .transcript_presentation
        .has_detailed_bookmark());

    app.set_thread_id("thread-2".to_string());
    assert!(!app
        .chat_widget
        .transcript_presentation
        .has_detailed_bookmark());
    toggle_transcript(&mut app);
    draw_lines(&app, &transcript);
    assert!(
        app.chat_widget
            .pager_overlay
            .as_ref()
            .expect("transcript")
            .transcript_scroll_position()
            > 0
    );
}

#[test]
fn transcript_surface_drops_primary_lease_when_selection_surface_closes() {
    let mut app = App {
        primary_clipboard_lease: Some(crate::clipboard_copy::ClipboardLease::test()),
        ..App::default()
    };

    app.dismiss_pager_overlay();

    assert!(app.primary_clipboard_lease.is_none());
}
