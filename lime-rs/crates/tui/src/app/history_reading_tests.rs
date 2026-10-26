use super::*;
use crate::app::AppAction;
use crate::locale::Locale;
use crate::tui::TuiEvent;
use app_server_protocol::protocol::v2::{
    AgentMessageDeltaNotification, CommandAction, CommandExecutionSource, CommandExecutionStatus,
    ItemCompletedNotification, ServerNotification, ThreadItem, TurnItemsView, TurnStatus,
};
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::{backend::TestBackend, Terminal};

fn read_item(id: &str, name: &str) -> ThreadItem {
    ThreadItem::CommandExecution {
        id: id.into(),
        plugin_id: None,
        script_path: None,
        command: format!("cat {name}"),
        cwd: "/workspace".into(),
        process_id: None,
        source: CommandExecutionSource::Agent,
        status: CommandExecutionStatus::Completed,
        command_actions: vec![CommandAction::Read {
            command: format!("cat {name}"),
            name: name.into(),
            path: format!("/workspace/{name}"),
        }],
        aggregated_output: Some("canonical output".into()),
        exit_code: Some(0),
        duration_ms: Some(1),
        terminal_interactions: Vec::new(),
    }
}

fn reader(streaming_tail: bool) -> (App, Terminal<TestBackend>) {
    let mut app = App::default();
    app.chat_widget.set_locale(Locale::EnUs);
    app.projection.apply(ServerNotification::ItemCompleted(
        ItemCompletedNotification {
            thread_id: "thread-read".into(),
            turn_id: "turn-group".into(),
            item: read_item("current", "current.rs"),
            completed_at_ms: 1,
        },
    ));
    let tail = (0..15)
        .map(|row| format!("surviving row {row:02}"))
        .collect::<Vec<_>>()
        .join("\n");
    if streaming_tail {
        app.projection.apply(ServerNotification::AgentMessageDelta(
            AgentMessageDeltaNotification {
                thread_id: "thread-read".into(),
                turn_id: "turn-tail".into(),
                item_id: "tail".into(),
                delta: tail,
            },
        ));
    } else {
        app.projection.apply(ServerNotification::ItemCompleted(
            ItemCompletedNotification {
                thread_id: "thread-read".into(),
                turn_id: "turn-tail".into(),
                completed_at_ms: 2,
                item: ThreadItem::AgentMessage {
                    id: "tail".into(),
                    text: tail,
                    phase: None,
                    memory_citation: None,
                    content_parts: Vec::new(),
                    delivery: None,
                    questions: None,
                },
            },
        ));
    }
    let content = super::super::history_ui::render_main_transcript_content(&app, 60, false);
    let index = content
        .lines
        .iter()
        .position(|line| line.line.to_string().contains("Explored"))
        .expect("canonical exploration group");
    let row =
        crate::terminal_hyperlinks::HyperlinkParagraph::new(&content.lines[..index]).line_count(60);
    let rows = crate::terminal_hyperlinks::HyperlinkParagraph::new(&content.lines).line_count(60);
    app.scroll_up(rows.saturating_sub(2).saturating_sub(row));
    let mut terminal = Terminal::new(TestBackend::new(60, 2)).unwrap();
    paint(&app, &mut terminal);
    assert!(text(&terminal).contains("current.rs"));
    (app, terminal)
}

fn join_page(app: &mut App) {
    let older = read_item("older", "older.rs");
    let turn = Turn {
        id: "turn-group".into(),
        items: vec![older.clone(), read_item("current", "current.rs")],
        items_view: TurnItemsView::Full,
        status: TurnStatus::InProgress,
        error: None,
        started_at: None,
        completed_at: None,
        duration_ms: None,
    };
    app.prepend_history_page(vec![older], &[turn], true);
}

fn paint(app: &App, terminal: &mut Terminal<TestBackend>) {
    terminal
        .draw(|frame| app.render_owned_transcript(frame, frame.area()))
        .unwrap();
}

fn text(terminal: &Terminal<TestBackend>) -> String {
    terminal
        .backend()
        .buffer()
        .content
        .iter()
        .map(|cell| cell.symbol())
        .collect()
}

fn key(app: &mut App, code: KeyCode, modifiers: KeyModifiers) -> AppAction {
    app.handle_tui_event_runtime(
        TuiEvent::Key(KeyEvent::new(code, modifiers)),
        true,
        std::time::Instant::now(),
    )
}

#[test]
fn page_join_keeps_the_visible_reading_revision_until_navigation_reaches_a_surviving_cell() {
    let (mut app, mut terminal) = reader(false);
    let before = text(&terminal);
    join_page(&mut app);
    paint(&app, &mut terminal);
    assert_eq!(
        text(&terminal),
        before,
        "page join must retain the displayed group revision"
    );
    app.scroll_down(1);
    paint(&app, &mut terminal);
    assert!(text(&terminal).contains("current.rs"));
    assert!(!text(&terminal).contains("older.rs"));
    app.scroll_down(1);
    paint(&app, &mut terminal);
    assert!(text(&terminal).contains("surviving row 00"));
    app.scroll_up(2);
    paint(&app, &mut terminal);
    let joined = text(&terminal);
    assert!(
        joined.contains("older.rs") && joined.contains("current.rs"),
        "{joined}"
    );
    app.scroll_bottom();
    paint(&app, &mut terminal);
    assert!(text(&terminal).contains("surviving row 14"));
}

#[test]
fn page_join_selection_cancel_keeps_the_retired_group_reading_revision() {
    let (mut app, mut terminal) = reader(false);
    key(&mut app, KeyCode::Char(' '), KeyModifiers::CONTROL);
    for _ in 0..8 {
        key(&mut app, KeyCode::Right, KeyModifiers::NONE);
    }
    paint(&app, &mut terminal);
    let before = text(&terminal);
    join_page(&mut app);
    paint(&app, &mut terminal);
    assert_eq!(text(&terminal), before);
    assert_eq!(
        key(&mut app, KeyCode::Esc, KeyModifiers::NONE),
        AppAction::None
    );
    paint(&app, &mut terminal);
    assert_eq!(
        text(&terminal),
        before,
        "clearing a selection must retain its retired reading group"
    );
}

#[test]
fn mutable_reading_keeps_the_displayed_revision_and_return_latest_releases_it() {
    let (mut app, mut terminal) = reader(true);
    app.scroll_bottom();
    paint(&app, &mut terminal);
    app.scroll_up(1);
    paint(&app, &mut terminal);
    let before = text(&terminal);
    app.projection.apply(ServerNotification::AgentMessageDelta(
        AgentMessageDeltaNotification {
            thread_id: "thread-read".into(),
            turn_id: "turn-tail".into(),
            item_id: "tail".into(),
            delta: "\nLATEST_MUTABLE_ROW".into(),
        },
    ));
    paint(&app, &mut terminal);
    assert_eq!(text(&terminal), before);
    let mut narrow = Terminal::new(TestBackend::new(28, 2)).unwrap();
    paint(&app, &mut narrow);
    assert!(text(&narrow).contains("surviving row 12"));
    paint(&app, &mut terminal);
    assert_eq!(text(&terminal), before);
    app.scroll_bottom();
    paint(&app, &mut terminal);
    assert!(text(&terminal).contains("LATEST_MUTABLE_ROW"));
}

#[test]
fn page_join_updates_unseen_groups_while_an_unrelated_mutable_reader_is_held() {
    let (mut app, mut terminal) = reader(true);
    app.scroll_bottom();
    paint(&app, &mut terminal);
    app.scroll_up(2);
    paint(&app, &mut terminal);
    let before = text(&terminal);
    join_page(&mut app);
    paint(&app, &mut terminal);
    assert_eq!(text(&terminal), before);
    let snapshot = app.transcript_view.snapshot_lines().unwrap();
    let content = snapshot
        .iter()
        .map(|line| line.line.to_string())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(content.contains("Read older.rs, current.rs"), "{content}");
    assert_eq!(
        content.matches("Explored").count(),
        1,
        "unseen fragments must join: {content}"
    );
    app.scroll_top();
    paint(&app, &mut terminal);
    assert!(app.transcript_view.held_reading_width().is_none());
}

#[test]
fn page_join_before_resize_retains_the_group_in_the_full_composer_layout() {
    let mut app = App::default();
    app.set_locale(Locale::EnUs);
    app.cwd = "/workspace/a/long/terminal/history/pagination/fixture".into();
    let mut items = vec![serde_json::from_value::<ThreadItem>(serde_json::json!({
        "type": "userMessage", "id": "user", "content": [{"type": "text", "text": "GROUP_SEED"}]
    }))
    .unwrap()];
    for index in 0..120 {
        items.push(
            serde_json::from_value::<ThreadItem>(serde_json::json!({
                "type": "mcpToolCall", "id": format!("computer-{index}"), "server": "cua_repl",
                "tool": "js", "status": "completed", "arguments": []
            }))
            .unwrap(),
        );
    }
    items.push(ThreadItem::AgentMessage {
        id: "tail".into(),
        text: (0..45)
            .map(|row| format!("READING_SURVIVING_ROW_{row:02}"))
            .collect::<Vec<_>>()
            .join("\n"),
        phase: None,
        memory_citation: None,
        content_parts: Vec::new(),
        delivery: None,
        questions: None,
    });
    let turn = Turn {
        id: "turn-group".into(),
        items: items.clone(),
        items_view: TurnItemsView::Full,
        status: TurnStatus::Completed,
        error: None,
        started_at: Some(1),
        completed_at: Some(2),
        duration_ms: Some(1),
    };
    app.prepend_initial_history_page(InitialHistoryPage {
        items: items[22..].to_vec(),
        turns: vec![turn.clone()],
    });
    let mut terminal = Terminal::new(TestBackend::new(120, 32)).unwrap();
    terminal
        .draw(|frame| crate::view::render(frame, &app))
        .unwrap();
    let content = super::super::history_ui::render_main_transcript_content(&app, 120, false);
    let index = content
        .lines
        .iter()
        .position(|line| line.line.to_string().contains("99 actions"))
        .unwrap();
    let row = crate::terminal_hyperlinks::HyperlinkParagraph::new(&content.lines[..index])
        .line_count(120);
    let rows = crate::terminal_hyperlinks::HyperlinkParagraph::new(&content.lines).line_count(120);
    let height = crate::view::transcript_page_size(120, 32, &app) + 1;
    app.scroll_up(rows.saturating_sub(height).saturating_sub(row));
    terminal
        .draw(|frame| crate::view::render(frame, &app))
        .unwrap();
    assert!(
        text(&terminal).starts_with("• Used computer · 99 actions"),
        "{}",
        text(&terminal)
    );
    app.prepend_history_page(items[..22].to_vec(), &[turn], true);
    let mut narrow = Terminal::new(TestBackend::new(28, 12)).unwrap();
    narrow
        .draw(|frame| crate::view::render(frame, &app))
        .unwrap();
    assert!(text(&narrow).contains("99 actions"), "{}", text(&narrow));
    assert!(!text(&narrow).contains("120 actions"));
    terminal
        .draw(|frame| crate::view::render(frame, &app))
        .unwrap();
    assert!(text(&terminal).contains("99 actions"));
}
