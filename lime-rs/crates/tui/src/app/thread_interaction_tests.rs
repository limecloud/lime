//! Thread handoff moves live question/form state and follows canonical request lifecycle.

use super::*;
use crate::app::AppAction;
use crate::bottom_pane::AppServerResponse;
use crate::locale::Locale;
use crate::tui::TuiEvent;
use app_server_protocol::protocol::v2::ServerRequest;
use app_server_protocol::RequestId;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use serde_json::json;

fn question(thread: &str, turn: &str, id: i64) -> ServerRequest {
    serde_json::from_value(json!({
        "method":"item/tool/requestUserInput", "id":id,
        "params": {"threadId":thread, "turnId":turn, "itemId":format!("question-{id}"),
            "isBlocking":true, "questions":[
                {"id":"mode", "header":"Mode", "question":"Choose a mode",
                    "isOther":false, "isSecret":false, "options":[
                        {"label":"Fast", "description":"Continue quickly"},
                        {"label":"Safe", "description":"Review every step"}]},
                {"id":"details", "header":"Details", "question":"Explain the choice",
                    "isOther":false, "isSecret":false, "options":null}]}
    }))
    .unwrap()
}

fn handoff(app: &mut App, thread: &str) {
    app.capture_current_thread_input();
    app.set_thread_id(thread.into());
    app.restore_thread_input(thread);
    let snapshot = app.take_thread_event_snapshot(thread, true);
    app.replay_thread_snapshot(snapshot);
}

fn key(app: &mut App, code: KeyCode) -> AppAction {
    app.handle_tui_event(TuiEvent::Key(KeyEvent::new(code, KeyModifiers::NONE)), true)
}

fn paste(app: &mut App, text: &str) {
    assert_eq!(
        app.handle_tui_event(TuiEvent::Paste(text.into()), true),
        AppAction::None
    );
}

fn screen(app: &App) -> String {
    let mut terminal = ratatui::Terminal::new(ratatui::backend::TestBackend::new(120, 32)).unwrap();
    terminal
        .draw(|frame| crate::view::render(frame, app))
        .unwrap();
    let buffer = terminal.backend().buffer();
    (0..buffer.area.height)
        .map(|row| {
            let mut column = 0;
            let mut line = String::new();
            while column < buffer.area.width {
                let symbol = buffer[(column, row)].symbol();
                line.push_str(symbol);
                column += crate::width::display_width(symbol).max(1) as u16;
            }
            line
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn notify(app: &mut App, value: serde_json::Value) {
    app.apply_notification(serde_json::from_value(value).unwrap());
}

fn complete(app: &mut App, thread: &str, turn: &str) {
    notify(
        app,
        json!({"method":"turn/completed", "params":{
            "threadId":thread, "turn":{"id":turn, "status":"completed", "items":[], "error":null}
        }}),
    );
}

#[test]
fn questions_keep_each_notes_draft_selection_focus_and_the_main_rich_draft() {
    for locale in [
        Locale::ZhCn,
        Locale::ZhTw,
        Locale::EnUs,
        Locale::JaJp,
        Locale::KoKr,
    ] {
        let mut app = App::default();
        app.set_locale(locale);
        app.set_thread_id("root".into());
        app.chat_widget
            .bottom_pane
            .handle_paste(&"界🙂".repeat(501));
        app.chat_widget.bottom_pane.insert_str(" MAIN_ROOT");
        app.chat_widget.bottom_pane.attach_image("root.png".into());
        let draft = app.chat_widget.bottom_pane.composer_draft();
        app.chat_widget
            .bottom_pane
            .enqueue(question("root", "root-turn", 1))
            .unwrap();
        key(&mut app, KeyCode::Down);
        key(&mut app, KeyCode::Tab);
        paste(&mut app, "ROOT_MODE_界🙂");
        key(&mut app, KeyCode::PageDown);
        paste(&mut app, "ROOT_DETAILS");
        let before = screen(&app);
        assert!(before.contains("ROOT_DETAILS"), "{locale:?}: {before}");

        handoff(&mut app, "child");
        assert!(!app.chat_widget.bottom_pane.is_active());
        assert!(app.chat_widget.bottom_pane.composer_is_empty());
        app.chat_widget.bottom_pane.insert_str("CHILD_DRAFT");
        app.chat_widget
            .bottom_pane
            .enqueue(question("child", "child-turn", 2))
            .unwrap();
        key(&mut app, KeyCode::Tab);
        paste(&mut app, "CHILD_MODE");
        handoff(&mut app, "root");
        assert_eq!(app.chat_widget.bottom_pane.composer_draft(), draft);
        assert!(
            !app.chat_widget.thread_input_states.contains_key("root"),
            "active input is consumed, not mirrored"
        );
        let restored = screen(&app);
        assert!(restored.contains("ROOT_DETAILS"), "{locale:?}: {restored}");
        assert!(!restored.contains("CHILD_MODE"));
        key(&mut app, KeyCode::PageUp);
        let mode = screen(&app);
        assert!(mode.contains("ROOT_MODE_界🙂"), "{locale:?}: {mode}");
        assert_eq!(key(&mut app, KeyCode::Enter), AppAction::None);
        let AppAction::Respond(AppServerResponse::UserInput { id, response }) =
            key(&mut app, KeyCode::Enter)
        else {
            panic!("all question answers must restore together")
        };
        assert_eq!(id, RequestId::Integer(1));
        assert_eq!(
            serde_json::to_value(response).unwrap(),
            json!({"answers":{
                "mode":{"answers":["Safe", "user_note: ROOT_MODE_界🙂"]},
                "details":{"answers":["ROOT_DETAILS"]}
            }})
        );
        assert!(!app.chat_widget.bottom_pane.is_active());
        handoff(&mut app, "child");
        assert_eq!(app.chat_widget.bottom_pane.composer_text(), "CHILD_DRAFT");
        assert!(screen(&app).contains("CHILD_MODE"));
    }
}

#[test]
fn opening_agent_center_does_not_move_or_duplicate_live_interactions() {
    let mut app = App::default();
    app.set_thread_id("root".into());
    app.chat_widget
        .bottom_pane
        .enqueue(question("root", "turn", 1))
        .unwrap();
    key(&mut app, KeyCode::Tab);
    paste(&mut app, "STILL_LIVE");
    app.open_agents_overview();
    assert!(app.chat_widget.bottom_pane.is_active());
    assert!(app.chat_widget.thread_input_states.is_empty());
    app.chat_widget.agents_overview = None;
    assert!(screen(&app).contains("STILL_LIVE"));
}

#[test]
fn approval_selection_and_new_buffered_requests_keep_arrival_order_without_duplicate_views() {
    let mut app = App::default();
    app.set_thread_id("root".into());
    app.chat_widget.bottom_pane.enqueue(serde_json::from_value(json!({
        "method":"item/commandExecution/requestApproval", "id":10,
        "params":{"threadId":"root", "turnId":"turn", "itemId":"command",
            "startedAtMs":0, "command":"cargo test", "availableDecisions":["accept","decline","cancel"]}
    })).unwrap()).unwrap();
    key(&mut app, KeyCode::Down);
    handoff(&mut app, "child");
    app.enqueue_thread_request("root", question("root", "turn", 11))
        .unwrap();
    handoff(&mut app, "root");
    let AppAction::Respond(AppServerResponse::Command { id, response }) =
        key(&mut app, KeyCode::Enter)
    else {
        panic!("the edited approval precedes the newly buffered question")
    };
    assert_eq!(id, RequestId::Integer(10));
    assert_eq!(
        serde_json::to_value(response).unwrap(),
        json!({"decision":"decline"})
    );
    let AppAction::Respond(AppServerResponse::UserInput { id, .. }) = key(&mut app, KeyCode::Esc)
    else {
        panic!("the next view is the newly arrived canonical question")
    };
    assert_eq!(id, RequestId::Integer(11));
    assert!(!app.chat_widget.bottom_pane.is_active());
}

#[test]
fn item_start_invalidates_only_the_matching_approval_item_and_turn() {
    let mut app = App::default();
    app.set_thread_id("root".into());
    app.chat_widget
        .bottom_pane
        .enqueue(
            serde_json::from_value(json!({
                "method":"item/commandExecution/requestApproval", "id":10,
                "params":{"threadId":"root", "turnId":"turn", "itemId":"command", "startedAtMs":0}
            }))
            .unwrap(),
        )
        .unwrap();
    app.chat_widget
        .bottom_pane
        .enqueue(
            serde_json::from_value(json!({
                "method":"item/fileChange/requestApproval", "id":11,
                "params":{"threadId":"root", "turnId":"turn", "itemId":"patch", "startedAtMs":0}
            }))
            .unwrap(),
        )
        .unwrap();
    for (thread, turn) in [("foreign", "turn"), ("root", "another-turn")] {
        notify(
            &mut app,
            json!({"method":"item/started", "params":{
                "threadId":thread, "turnId":turn, "startedAtMs":0, "item":{
                    "type":"commandExecution", "id":"command", "command":"cargo test", "cwd":"/tmp", "status":"inProgress"}
            }}),
        );
        assert!(app.chat_widget.bottom_pane.is_active());
    }
    handoff(&mut app, "child");
    notify(
        &mut app,
        json!({"method":"item/started", "params":{
            "threadId":"root", "turnId":"turn", "startedAtMs":0, "item":{
                "type":"commandExecution", "id":"command", "command":"cargo test", "cwd":"/tmp", "status":"inProgress"}
        }}),
    );
    handoff(&mut app, "root");
    let AppAction::Respond(AppServerResponse::FileChange { id, .. }) = key(&mut app, KeyCode::Esc)
    else {
        panic!("only the file approval should remain after command execution starts")
    };
    assert_eq!(id, RequestId::Integer(11));
    app.chat_widget
        .bottom_pane
        .enqueue(
            serde_json::from_value(json!({
                "method":"item/fileChange/requestApproval", "id":12,
                "params":{"threadId":"root", "turnId":"turn", "itemId":"patch", "startedAtMs":0}
            }))
            .unwrap(),
        )
        .unwrap();
    notify(
        &mut app,
        json!({"method":"item/started", "params":{
            "threadId":"root", "turnId":"turn", "startedAtMs":0, "item":{
                "type":"fileChange", "id":"patch", "changes":[], "status":"inProgress"}
        }}),
    );
    assert!(!app.chat_widget.bottom_pane.is_active());
}

#[test]
fn resumed_mcp_form_keeps_field_values_and_cursor() {
    let mut app = App::default();
    app.set_thread_id("root".into());
    app.chat_widget.bottom_pane.enqueue(serde_json::from_value(json!({
        "method":"mcpServer/elicitation/request", "id":"form",
        "params":{"threadId":"root", "turnId":"turn", "serverName":"forms",
            "mode":"form", "message":"Fill the form", "requestedSchema":{
                "type":"object", "properties":{"name":{"type":"string"}}, "required":["name"]}}
    })).unwrap()).unwrap();
    paste(&mut app, "界🙂form");
    key(&mut app, KeyCode::Left);
    handoff(&mut app, "child");
    handoff(&mut app, "root");
    paste(&mut app, "X");
    let AppAction::Respond(AppServerResponse::McpElicitation { id, response }) =
        key(&mut app, KeyCode::Enter)
    else {
        panic!("restored form must submit through the same typed response")
    };
    assert_eq!(id, RequestId::String("form".into()));
    assert_eq!(
        serde_json::to_value(response).unwrap(),
        json!({
            "action":"accept", "content":{"name":"界🙂forXm"}
        })
    );
}

#[test]
fn resolved_and_terminal_notifications_clear_only_matching_live_or_dormant_requests() {
    let mut app = App::default();
    app.set_thread_id("root".into());
    app.begin_startup_input_boundary();
    for (turn, id) in [("turn-a", 1), ("turn-b", 2)] {
        app.chat_widget
            .bottom_pane
            .enqueue(question("root", turn, id))
            .unwrap();
    }
    app.note_startup_protected_request();
    notify(
        &mut app,
        json!({"method":"serverRequest/resolved", "params":{
            "threadId":"foreign", "requestId":1
        }}),
    );
    assert!(app.chat_widget.bottom_pane.is_active());
    handoff(&mut app, "child");
    app.chat_widget
        .bottom_pane
        .enqueue(question("child", "turn-a", 1))
        .unwrap();
    notify(
        &mut app,
        json!({"method":"serverRequest/resolved", "params":{
            "threadId":"root", "requestId":1
        }}),
    );
    assert!(
        app.chat_widget.bottom_pane.is_active(),
        "same id in another thread is not cleared"
    );
    complete(&mut app, "root", "turn-a");
    handoff(&mut app, "root");
    let AppAction::Respond(AppServerResponse::UserInput { id, .. }) = key(&mut app, KeyCode::Esc)
    else {
        panic!("only the unrelated root request should remain")
    };
    assert_eq!(id, RequestId::Integer(2));
    assert!(!app.has_queued_startup_protected_request());
    handoff(&mut app, "child");
    complete(&mut app, "child", "unrelated");
    assert!(app.chat_widget.bottom_pane.is_active());
    complete(&mut app, "child", "turn-a");
    assert!(!app.chat_widget.bottom_pane.is_active());
}

#[test]
fn close_and_disconnect_invalidate_views_and_replay_without_losing_thread_drafts() {
    let mut app = App::default();
    app.set_thread_id("root".into());
    app.chat_widget.bottom_pane.insert_str("ROOT_DRAFT");
    app.chat_widget
        .bottom_pane
        .enqueue(question("root", "turn", 1))
        .unwrap();
    handoff(&mut app, "child");
    app.chat_widget.bottom_pane.insert_str("CHILD_DRAFT");
    app.chat_widget
        .bottom_pane
        .enqueue(question("child", "turn", 2))
        .unwrap();
    app.enqueue_thread_request("root", question("root", "turn", 3))
        .unwrap();
    app.clear_connection_interactions();
    assert!(
        app.thread_event_channels.is_empty(),
        "old transport request ids cannot replay"
    );
    assert!(!app.chat_widget.bottom_pane.is_active());
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), "CHILD_DRAFT");
    handoff(&mut app, "root");
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), "ROOT_DRAFT");
    assert!(!app.chat_widget.bottom_pane.is_active());
    app.chat_widget
        .bottom_pane
        .enqueue(question("root", "turn-new", 4))
        .unwrap();
    handoff(&mut app, "child");
    notify(
        &mut app,
        json!({"method":"thread/closed", "params":{"threadId":"root"}}),
    );
    handoff(&mut app, "root");
    assert!(!app.chat_widget.bottom_pane.is_active());
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), "ROOT_DRAFT");
}

#[test]
fn turn_terminal_clears_permissions_but_mcp_waits_for_its_own_resolved_identity() {
    let mut app = App::default();
    app.set_thread_id("root".into());
    app.chat_widget
        .bottom_pane
        .enqueue(
            serde_json::from_value(json!({
                "method":"item/permissions/requestApproval", "id":1,
                "params":{"threadId":"root", "turnId":"turn", "itemId":"permissions",
                    "startedAtMs":0, "cwd":"/tmp", "permissions":{}}
            }))
            .unwrap(),
        )
        .unwrap();
    app.chat_widget
        .bottom_pane
        .enqueue(
            serde_json::from_value(json!({
                "method":"mcpServer/elicitation/request", "id":"mcp-1",
                "params":{"threadId":"root", "turnId":"turn", "serverName":"forms",
                    "mode":"form", "message":"MCP_STILL_PENDING", "requestedSchema":{
                        "type":"object", "properties":{"name":{"type":"string"}}}}
            }))
            .unwrap(),
        )
        .unwrap();
    handoff(&mut app, "child");
    complete(&mut app, "root", "turn");
    handoff(&mut app, "root");
    assert!(
        screen(&app).contains("MCP_STILL_PENDING"),
        "MCP has a separate canonical resolved lifecycle"
    );
    handoff(&mut app, "child");
    notify(
        &mut app,
        json!({"method":"serverRequest/resolved", "params":{
            "threadId":"root", "requestId":"mcp-1"
        }}),
    );
    handoff(&mut app, "root");
    assert!(!app.chat_widget.bottom_pane.is_active());
}
