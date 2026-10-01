use super::*;
use crate::keymap::RuntimeKeymap;
use crossterm::event::{KeyCode, KeyModifiers};
use serde_json::json;

fn key(code: KeyCode) -> KeyEvent {
    KeyEvent::new(code, KeyModifiers::NONE)
}
fn bindings() -> RuntimeKeymap {
    RuntimeKeymap::from_config(&serde_json::from_value(json!({
        "editor": {"insert_newline": "f12", "delete_backward": [], "kill_whole_line": "ctrl-q k"}
    })).unwrap()).unwrap()
}
fn user_input(id: i64) -> ServerRequest {
    serde_json::from_value(json!({
        "id": id, "method": "item/tool/requestUserInput",
        "params": {
            "threadId":"thread-keymap", "turnId":"turn-keymap", "itemId":"item-keymap",
            "questions":[{"id":"answer", "header":"Answer", "question":"Type an answer",
                "isOther":false, "isSecret":false, "options":null}]
        }
    }))
    .unwrap()
}

#[test]
fn startup_snapshot_reaches_existing_queued_and_new_notes_editors() {
    let mut pane = BottomPane::default();
    pane.enqueue(user_input(1)).unwrap();
    pane.enqueue(user_input(2)).unwrap();
    pane.set_keymap_bindings(&bindings());
    pane.enqueue(user_input(3)).unwrap();
    for id in 1..=3 {
        pane.handle_event(Event::Paste("ab".into()));
        pane.handle_key_event(key(KeyCode::F(12)));
        pane.handle_event(Event::Paste("c".into()));
        pane.handle_key_event(key(KeyCode::Backspace));
        // A pending chord owns Enter instead of submitting an answer.
        pane.handle_key_event(KeyEvent::new(KeyCode::Char('q'), KeyModifiers::CONTROL));
        assert!(pane.handle_key_event(key(KeyCode::Enter)).is_none());
        let response = pane.handle_key_event(key(KeyCode::Enter)).unwrap();
        let AppServerResponse::UserInput {
            id: response_id,
            response,
        } = response
        else {
            panic!("expected notes response");
        };
        assert_eq!(response_id, RequestId::Integer(id));
        assert_eq!(response.answers["answer"].answers, ["ab\nc"]);
    }
    assert!(!pane.is_active());
}

#[test]
fn restoring_thread_views_reapplies_current_bindings_to_all_queued_editors() {
    let mut pane = BottomPane::default();
    for id in 1..=2 {
        pane.enqueue(user_input(id)).unwrap();
    }
    pane.handle_event(Event::Paste("restored".into()));
    let state = pane.take_input_state();
    assert!(
        !pane.is_active(),
        "the dormant snapshot owns the views exclusively"
    );
    pane.set_keymap_bindings(&bindings());
    pane.restore_input_state(state);
    for id in 1..=2 {
        pane.handle_key_event(key(KeyCode::F(12)));
        pane.handle_event(Event::Paste("tail".into()));
        pane.handle_key_event(key(KeyCode::Backspace));
        let Some(AppServerResponse::UserInput {
            id: actual,
            response,
        }) = pane.handle_key_event(key(KeyCode::Enter))
        else {
            panic!("restored notes must use current bindings")
        };
        assert_eq!(actual, RequestId::Integer(id));
        let expected = if id == 1 { "restored\ntail" } else { "tail" };
        assert_eq!(response.answers["answer"].answers, [expected]);
    }
    assert!(!pane.is_active());
}

#[test]
fn mcp_text_field_consumes_snapshot_without_ctrl_j_newline_fallback_or_chord_submission() {
    let request = serde_json::from_value(json!({
        "id":4, "method":"mcpServer/elicitation/request",
        "params":{
            "threadId":"thread-keymap", "turnId":"turn-keymap", "serverName":"form-server",
            "mode":"form", "message":"Type an answer",
            "requestedSchema":{"type":"object", "properties":{"answer":{"type":"string"}}}
        }
    }))
    .unwrap();
    let mut pane = BottomPane::default();
    pane.set_keymap_bindings(&bindings());
    pane.enqueue(request).unwrap();
    pane.handle_event(Event::Paste("ab".into()));
    pane.handle_key_event(KeyEvent::new(KeyCode::Char('j'), KeyModifiers::CONTROL));
    pane.handle_key_event(key(KeyCode::F(12)));
    pane.handle_event(Event::Paste("c".into()));
    pane.handle_key_event(key(KeyCode::Backspace));
    pane.handle_key_event(KeyEvent::new(KeyCode::Char('q'), KeyModifiers::CONTROL));
    assert!(pane.handle_key_event(key(KeyCode::Enter)).is_none());
    let response = pane.handle_key_event(key(KeyCode::Enter)).unwrap();
    let AppServerResponse::McpElicitation { response, .. } = response else {
        panic!("expected MCP response");
    };
    assert_eq!(response.content, Some(json!({"answer":"ab\nc"})));
}
