use super::*;
use crate::app::AppAction;
use crate::locale::Locale;
use crate::transcript_view::CopyPosition;
use crate::tui::TuiEvent;
use app_server_protocol::protocol::v2::{
    AgentMessageDeltaNotification, ServerNotification, ThreadItem, UserInput,
};
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::{backend::TestBackend, Terminal};

fn draw(app: &App) {
    Terminal::new(TestBackend::new(60, 12))
        .unwrap()
        .draw(|frame| crate::view::render(frame, app))
        .unwrap();
}

fn key(app: &mut App, code: KeyCode) -> AppAction {
    app.handle_tui_event_runtime(
        TuiEvent::Key(KeyEvent::new(code, KeyModifiers::NONE)),
        true,
        std::time::Instant::now(),
    )
}

fn copied(app: &mut App) -> String {
    let AppAction::CopyTranscriptSelection { text, .. } = key(app, KeyCode::Enter) else {
        panic!("copy dispatch")
    };
    text
}

#[test]
fn canonical_history_page_extends_the_original_copy_revision_without_absorbing_live_tail() {
    let mut app = App::default();
    app.chat_widget.set_locale(Locale::EnUs);
    app.projection.apply(ServerNotification::AgentMessageDelta(
        AgentMessageDeltaNotification {
            thread_id: "thread-copy".into(),
            turn_id: "turn-original".into(),
            item_id: "original".into(),
            delta: "original **reply**".into(),
        },
    ));
    app.chat_widget.set_scrollback_has_older_history(true);
    app.select_transcript_copy();
    draw(&app);
    app.projection.apply(ServerNotification::AgentMessageDelta(
        AgentMessageDeltaNotification {
            thread_id: "thread-copy".into(),
            turn_id: "turn-new".into(),
            item_id: "new-live".into(),
            delta: "LIVE_MUST_NOT_ENTER_COPY".into(),
        },
    ));
    let older = ThreadItem::UserMessage {
        id: "older".into(),
        client_id: None,
        content: vec![UserInput::Text {
            text: "old 中文😀 prompt".into(),
            text_elements: Vec::new(),
        }],
    };
    app.prepend_history_page(vec![older.clone()], &[], true);
    draw(&app);
    assert_eq!(copied(&mut app), "original **reply**");
    assert_eq!(key(&mut app, KeyCode::Home), AppAction::LoadOlderHistory);
    assert_eq!(copied(&mut app), "old 中文😀 prompt");
    app.prepend_history_page(vec![older], &[], true);
    key(&mut app, KeyCode::End);
    assert_eq!(copied(&mut app), "original **reply**");
    assert!(app
        .projection
        .entries()
        .iter()
        .any(|entry| entry.text == "LIVE_MUST_NOT_ENTER_COPY"));
    key(&mut app, KeyCode::Esc);
    app.select_transcript_copy();
    draw(&app);
    assert_eq!(copied(&mut app), "LIVE_MUST_NOT_ENTER_COPY");
}

fn main_selection(mode: crate::history_cell::HistoryRenderMode) -> App {
    let mut app = App::default();
    app.chat_widget.set_locale(Locale::EnUs);
    app.chat_widget.history_render_mode = mode;
    app.projection.apply(ServerNotification::AgentMessageDelta(
        AgentMessageDeltaNotification {
            thread_id: "thread-main".into(),
            turn_id: "turn-main".into(),
            item_id: "original".into(),
            delta: format!("{}ORIGINAL frozen reply", "canonical row\n".repeat(12)),
        },
    ));
    let mut terminal = Terminal::new(TestBackend::new(60, 12)).unwrap();
    terminal
        .draw(|frame| crate::view::render(frame, &app))
        .unwrap();
    let buffer = terminal.backend().buffer();
    let (column, row) = (0..buffer.area.height)
        .find_map(|row| {
            let text = (0..buffer.area.width)
                .map(|column| buffer[(column, row)].symbol())
                .collect::<String>();
            text.find("ORIGINAL").map(|column| (column as u16, row))
        })
        .expect("visible canonical response");
    for _ in 0..2 {
        for kind in [
            crossterm::event::MouseEventKind::Down(crossterm::event::MouseButton::Left),
            crossterm::event::MouseEventKind::Up(crossterm::event::MouseButton::Left),
        ] {
            app.handle_tui_event_runtime(
                TuiEvent::Mouse(crossterm::event::MouseEvent {
                    kind,
                    column,
                    row,
                    modifiers: KeyModifiers::NONE,
                }),
                true,
                std::time::Instant::now(),
            );
        }
    }
    draw(&app);
    assert_eq!(copied(&mut app), "ORIGINAL");
    app
}

fn older_prompt() -> ThreadItem {
    ThreadItem::UserMessage {
        id: "older-main".into(),
        client_id: None,
        content: vec![UserInput::Text {
            text: "OLDER 中文😀 prompt".into(),
            text_elements: Vec::new(),
        }],
    }
}

#[test]
fn main_selection_absorbs_only_accepted_older_history_and_keeps_original_text() {
    for mode in [
        crate::history_cell::HistoryRenderMode::Rich,
        crate::history_cell::HistoryRenderMode::Raw,
    ] {
        assert_main_selection_revision(mode);
    }
}

fn assert_main_selection_revision(mode: crate::history_cell::HistoryRenderMode) {
    let mut app = main_selection(mode);
    let before = app.transcript_view.selection.snapshot_lines().unwrap();
    app.projection.apply(ServerNotification::AgentMessageDelta(
        AgentMessageDeltaNotification {
            thread_id: "thread-main".into(),
            turn_id: "turn-main".into(),
            item_id: "original".into(),
            delta: "\nLIVE_REPLACEMENT_MUST_STAY_OUT".into(),
        },
    ));
    app.projection.apply(ServerNotification::AgentMessageDelta(
        AgentMessageDeltaNotification {
            thread_id: "thread-main".into(),
            turn_id: "turn-new".into(),
            item_id: "new-live".into(),
            delta: "LIVE_TAIL_MUST_STAY_OUT".into(),
        },
    ));
    app.prepend_history_page(vec![older_prompt()], &[], true);
    draw(&app);
    let after = app.transcript_view.selection.snapshot_lines().unwrap();
    let text = after
        .iter()
        .map(|line| line.line.to_string())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(text.contains("OLDER 中文😀 prompt"), "{text}");
    assert!(!text.contains("LIVE_REPLACEMENT_MUST_STAY_OUT"), "{text}");
    assert!(!text.contains("LIVE_TAIL_MUST_STAY_OUT"), "{text}");
    assert!(after.ends_with(&before[before.len() - 13..]));
    let first_original_line = after
        .iter()
        .position(|line| line.line.to_string().contains("canonical row"))
        .unwrap();
    let row = crate::terminal_hyperlinks::HyperlinkParagraph::new(&after[..first_original_line])
        .line_count(60);
    let source = app
        .transcript_view
        .prompt_header
        .source(&Default::default(), true);
    let header = source
        .candidate(&after, ratatui::layout::Rect::new(0, 0, 60, 12), row)
        .unwrap();
    assert!(header.line.to_string().contains("OLDER 中文😀 prompt"));
    assert_eq!(copied(&mut app), "ORIGINAL");
    app.prepend_history_page(vec![older_prompt()], &[], true);
    assert_eq!(
        app.transcript_view.selection.snapshot_lines().unwrap(),
        after
    );
    let mut terminal = Terminal::new(TestBackend::new(28, 16)).unwrap();
    terminal
        .draw(|frame| crate::view::render(frame, &app))
        .unwrap();
    assert_eq!(copied(&mut app), "ORIGINAL");
    assert_eq!(key(&mut app, KeyCode::Esc), AppAction::None);
    assert!(!app.transcript_view.selection.is_active());
    assert!(app.chat_widget.pager_overlay.is_none());
}

#[test]
fn main_selection_requests_history_at_the_top_and_keeps_the_composer_draft() {
    let mut app = main_selection(crate::history_cell::HistoryRenderMode::Rich);
    app.chat_widget.set_scrollback_has_older_history(true);
    app.chat_widget
        .bottom_pane
        .insert_str("unsent 中文😀 draft");
    let mut load_requested = false;
    for _ in 0..20 {
        let action = key(&mut app, KeyCode::PageUp);
        draw(&app);
        if action == AppAction::LoadOlderHistory {
            load_requested = true;
            break;
        }
    }
    assert!(
        load_requested,
        "frozen main selection must request a canonical page at its top"
    );
    assert_eq!(
        app.history_load_mode(),
        crate::app_event::OlderHistoryLoadMode::OnePage
    );
    assert!(app.transcript_view.selection.is_active());
    assert_eq!(
        app.chat_widget.bottom_pane.composer_text(),
        "unsent 中文😀 draft"
    );
    app.chat_widget.set_scrollback_has_older_history(false);
    assert_eq!(key(&mut app, KeyCode::PageUp), AppAction::None);
}

#[test]
fn main_selection_history_prepend_preserves_the_original_copy_ticket() {
    let mut app = main_selection(crate::history_cell::HistoryRenderMode::Rich);
    let position = CopyPosition::DistanceFromBottom(app.transcript_view.scroll);
    app.transcript_view.selection.defer_copy(7, position);
    app.prepend_history_page(vec![older_prompt()], &[], true);
    draw(&app);
    assert!(app.transcript_view.selection.finish_copy(7, true, position));
    app.transcript_view.selection.defer_copy(8, position);
    key(&mut app, KeyCode::PageUp);
    draw(&app);
    app.prepend_history_page(
        vec![ThreadItem::AgentMessage {
            id: "even-older".into(),
            text: "EARLIEST canonical answer".into(),
            phase: None,
            memory_citation: None,
            content_parts: Vec::new(),
            delivery: None,
            questions: None,
        }],
        &[],
        true,
    );
    assert!(!app.transcript_view.selection.finish_copy(8, true, position));
}
