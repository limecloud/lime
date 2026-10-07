use super::*;
use crate::keymap::RuntimeKeymap;
use app_server_protocol::protocol::v2::McpServerElicitationAction;
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

fn mcp_list_bindings() -> RuntimeKeymap {
    RuntimeKeymap::from_config(
        &serde_json::from_value(json!({
            "list": {"move_down": "f10", "accept": "f12", "cancel": "f11"}
        }))
        .unwrap(),
    )
    .unwrap()
}

fn request_list_bindings() -> RuntimeKeymap {
    RuntimeKeymap::from_config(
        &serde_json::from_value(json!({
            "list": {
                "move_up": "f9",
                "move_down": "f10",
                "move_left": "f7",
                "move_right": "f8",
                "accept": "f12",
                "cancel": "f11"
            }
        }))
        .unwrap(),
    )
    .unwrap()
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

fn approval(id: i64) -> ServerRequest {
    serde_json::from_value(json!({
        "id": id,
        "method": "item/commandExecution/requestApproval",
        "params": {
            "threadId": "thread-keymap", "turnId": "turn-keymap", "itemId": "item-keymap",
            "startedAtMs": 0, "command": "echo keymap",
            "availableDecisions": ["accept", "acceptForSession", "decline", "cancel"]
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
        pane.handle_interaction_event(Event::Paste("ab".into()));
        pane.handle_interaction_key(key(KeyCode::F(12)));
        pane.handle_interaction_event(Event::Paste("c".into()));
        pane.handle_interaction_key(key(KeyCode::Backspace));
        // A pending chord owns Enter instead of submitting an answer.
        pane.handle_interaction_key(KeyEvent::new(KeyCode::Char('q'), KeyModifiers::CONTROL));
        assert!(pane.handle_interaction_key(key(KeyCode::Enter)).is_none());
        let response = pane.handle_interaction_key(key(KeyCode::Enter)).unwrap();
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
    pane.handle_interaction_event(Event::Paste("restored".into()));
    let state = pane.take_input_state();
    assert!(
        !pane.is_active(),
        "the dormant snapshot owns the views exclusively"
    );
    pane.set_keymap_bindings(&bindings());
    pane.restore_input_state(state);
    for id in 1..=2 {
        pane.handle_interaction_key(key(KeyCode::F(12)));
        pane.handle_interaction_event(Event::Paste("tail".into()));
        pane.handle_interaction_key(key(KeyCode::Backspace));
        let Some(AppServerResponse::UserInput {
            id: actual,
            response,
        }) = pane.handle_interaction_key(key(KeyCode::Enter))
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
    pane.handle_interaction_event(Event::Paste("ab".into()));
    pane.handle_interaction_key(KeyEvent::new(KeyCode::Char('j'), KeyModifiers::CONTROL));
    pane.handle_interaction_key(key(KeyCode::F(12)));
    pane.handle_interaction_event(Event::Paste("c".into()));
    pane.handle_interaction_key(key(KeyCode::Backspace));
    pane.handle_interaction_key(KeyEvent::new(KeyCode::Char('q'), KeyModifiers::CONTROL));
    assert!(pane.handle_interaction_key(key(KeyCode::Enter)).is_none());
    let response = pane.handle_interaction_key(key(KeyCode::Enter)).unwrap();
    let AppServerResponse::McpElicitation { response, .. } = response else {
        panic!("expected MCP response");
    };
    assert_eq!(response.content, Some(json!({"answer":"ab\nc"})));
}

#[test]
fn mcp_select_fields_use_the_current_list_keymap_for_navigation_and_actions() {
    let request = serde_json::from_value(json!({
        "id": 5, "method": "mcpServer/elicitation/request",
        "params": {
            "threadId": "thread-keymap", "turnId": "turn-keymap", "serverName": "form-server",
            "mode": "form", "message": "Choose an answer",
            "requestedSchema": {
                "type": "object",
                "properties": {"answer": {"type": "boolean"}}
            }
        }
    }))
    .unwrap();
    let mut pane = BottomPane::default();
    pane.set_keymap_bindings(&mcp_list_bindings());
    pane.enqueue(request).unwrap();

    assert!(pane.handle_interaction_key(key(KeyCode::F(10))).is_none());
    let Some(AppServerResponse::McpElicitation { response, .. }) =
        pane.handle_interaction_key(key(KeyCode::F(12)))
    else {
        panic!("configured list accept should submit MCP select");
    };
    assert_eq!(response.content, Some(json!({"answer": false})));

    let cancel_request = serde_json::from_value(json!({
        "id": 6, "method": "mcpServer/elicitation/request",
        "params": {
            "threadId": "thread-keymap", "turnId": "turn-keymap", "serverName": "form-server",
            "mode": "form", "message": "Choose an answer",
            "requestedSchema": {
                "type": "object",
                "properties": {"answer": {"type": "boolean"}}
            }
        }
    }))
    .unwrap();
    pane.enqueue(cancel_request).unwrap();
    let Some(AppServerResponse::McpElicitation { response, .. }) =
        pane.handle_interaction_key(key(KeyCode::F(11)))
    else {
        panic!("configured list cancel should resolve MCP select");
    };
    assert_eq!(response.action, McpServerElicitationAction::Cancel);
}

#[test]
fn request_user_input_footer_and_select_dispatch_share_the_current_list_keymap() {
    let request = serde_json::from_value(json!({
        "id": 7, "method": "item/tool/requestUserInput",
        "params": {
            "threadId": "thread-keymap", "turnId": "turn-keymap", "itemId": "item-keymap",
            "questions": [{
                "id": "answer", "header": "Answer", "question": "Choose an answer",
                "isOther": false, "isSecret": false,
                "options": [
                    {"label": "Fast", "description": ""},
                    {"label": "Safe", "description": ""}
                ]
            }],
            "isBlocking": true, "autoResolutionMs": null
        }
    }))
    .unwrap();
    let mut pane = BottomPane::default();
    pane.set_keymap_bindings(&request_list_bindings());
    pane.enqueue(request).unwrap();

    let footer = pane
        .footer_hint_lines(crate::locale::Locale::EnUs, 120)
        .expect("request footer")
        .join(" · ");
    assert!(footer.contains("f12 submit"), "{footer}");
    assert!(footer.contains("f11 cancel"), "{footer}");
    assert!(footer.contains("f9/f10 select"), "{footer}");

    assert!(pane.handle_interaction_key(key(KeyCode::F(10))).is_none());
    let Some(AppServerResponse::UserInput { response, .. }) =
        pane.handle_interaction_key(key(KeyCode::F(12)))
    else {
        panic!("configured request accept should submit the selected option");
    };
    assert_eq!(response.answers["answer"].answers, ["Safe"]);
}

#[test]
fn request_user_input_unbound_list_actions_do_not_restore_hidden_enter_or_escape() {
    let request = serde_json::from_value(json!({
        "id": 8, "method": "item/tool/requestUserInput",
        "params": {
            "threadId": "thread-keymap", "turnId": "turn-keymap", "itemId": "item-keymap",
            "questions": [{
                "id": "answer", "header": "Answer", "question": "Choose an answer",
                "isOther": false, "isSecret": false,
                "options": [{"label": "Fast", "description": ""}]
            }],
            "isBlocking": true, "autoResolutionMs": null
        }
    }))
    .unwrap();
    let keymap = RuntimeKeymap::from_config(
        &serde_json::from_value(json!({
            "list": {"accept": [], "cancel": []}
        }))
        .unwrap(),
    )
    .unwrap();
    let mut pane = BottomPane::default();
    pane.set_keymap_bindings(&keymap);
    pane.enqueue(request).unwrap();

    let footer = pane
        .footer_hint_lines(crate::locale::Locale::EnUs, 120)
        .expect("request footer")
        .join(" · ");
    assert!(!footer.contains("Enter"), "{footer}");
    assert!(!footer.contains("Esc"), "{footer}");
    assert!(footer.contains("↑/↓ select"), "{footer}");
    assert!(footer.contains("Tab notes"), "{footer}");
    assert!(pane.handle_interaction_key(key(KeyCode::Enter)).is_none());
    assert!(pane.handle_interaction_key(key(KeyCode::Esc)).is_none());
    assert!(pane
        .handle_interaction_key(KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL,))
        .is_some());
}

#[test]
fn approval_footer_and_dispatch_share_the_current_list_keymap() {
    let mut pane = BottomPane::default();
    pane.set_keymap_bindings(&request_list_bindings());
    pane.enqueue(approval(9)).unwrap();

    let footer = pane
        .footer_hint_lines(crate::locale::Locale::EnUs, 120)
        .expect("approval footer")
        .join(" · ");
    assert!(footer.contains("f12 confirm"), "{footer}");
    assert!(footer.contains("f11 cancel"), "{footer}");

    assert!(pane.handle_interaction_key(key(KeyCode::F(10))).is_none());
    let Some(AppServerResponse::Command { response, .. }) =
        pane.handle_interaction_key(key(KeyCode::F(12)))
    else {
        panic!("configured approval accept should resolve the selected decision");
    };
    assert_eq!(
        response.decision,
        app_server_protocol::protocol::v2::CommandExecutionApprovalDecision::AcceptForSession
    );
}

#[test]
fn narrow_interaction_footers_never_invent_default_keys_or_split_chords() {
    for (accept_spec, cancel_spec) in [("f12", "f11"), ("ctrl-x s", "ctrl-x q")] {
        let keymap = RuntimeKeymap::from_config(
            &serde_json::from_value(
                json!({"list": {"accept": accept_spec, "cancel": cancel_spec}}),
            )
            .unwrap(),
        )
        .unwrap();
        let accept = accept_spec.replace('-', "+");
        let cancel = cancel_spec.replace('-', "+");
        for request in [
            approval(10),
            serde_json::from_value(json!({
                "id": 11, "method": "item/tool/requestUserInput",
                "params": {
                    "threadId": "thread-keymap", "turnId": "turn-keymap", "itemId": "item-keymap",
                    "questions": [{
                        "id": "answer", "header": "Answer", "question": "Choose",
                        "isOther": false, "isSecret": false,
                        "options": [{"label": "Fast", "description": ""}]
                    }], "isBlocking": true
                }
            }))
            .unwrap(),
        ] {
            let mut pane = BottomPane::default();
            pane.set_keymap_bindings(&keymap);
            pane.enqueue(request).unwrap();
            for locale in [
                crate::locale::Locale::ZhCn,
                crate::locale::Locale::ZhTw,
                crate::locale::Locale::EnUs,
                crate::locale::Locale::JaJp,
                crate::locale::Locale::KoKr,
            ] {
                for width in 1..50 {
                    let lines = pane.footer_hint_lines(locale, width).unwrap();
                    for line in &lines {
                        assert!(crate::width::display_width(line) <= width, "{line:?}");
                        assert!(
                            !line.contains("Enter") && !line.contains("Esc"),
                            "{locale:?}/{width}: {lines:?}"
                        );
                        assert!(!line.contains('…'), "shortcuts must stay whole: {lines:?}");
                        if line.contains("ctrl+x") {
                            assert!(
                                line.contains(&accept) || line.contains(&cancel),
                                "partial chord: {lines:?}"
                            );
                        }
                    }
                    if width > accept.len() + cancel.len() + 3 {
                        let primary = lines.first().unwrap();
                        assert!(
                            primary.contains(&accept) && primary.contains(&cancel),
                            "{locale:?}/{width}: {lines:?}"
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn narrow_primary_footer_uses_accept_when_the_cancel_chord_cannot_fit() {
    let keymap = RuntimeKeymap::from_config(
        &serde_json::from_value(json!({"list":{"accept":"f9", "cancel":"ctrl-x q"}})).unwrap(),
    )
    .unwrap();
    let mut pane = BottomPane::default();
    pane.set_keymap_bindings(&keymap);
    pane.enqueue(approval(14)).unwrap();
    for locale in [
        crate::locale::Locale::ZhCn,
        crate::locale::Locale::ZhTw,
        crate::locale::Locale::EnUs,
        crate::locale::Locale::JaJp,
        crate::locale::Locale::KoKr,
    ] {
        assert_eq!(
            pane.footer_hint_lines(locale, 2),
            Some(vec!["f9".into()]),
            "{locale:?}"
        );
    }
}

#[test]
fn unbinding_either_primary_action_keeps_independent_request_navigation_visible() {
    for (accept, cancel) in [(true, false), (false, true), (false, false)] {
        let keymap = RuntimeKeymap::from_config(
            &serde_json::from_value(json!({"list": {
                "accept": if accept { json!("f12") } else { json!([]) },
                "cancel": if cancel { json!("f11") } else { json!([]) }
            }}))
            .unwrap(),
        )
        .unwrap();
        let request = serde_json::from_value(json!({
            "id": 12, "method": "item/tool/requestUserInput",
            "params": {
                "threadId": "thread-keymap", "turnId": "turn-keymap", "itemId": "item-keymap",
                "questions": [{
                    "id": "answer", "header": "Answer", "question": "Choose",
                    "isOther": false, "isSecret": false,
                    "options": [{"label": "Fast", "description": ""}]
                }], "isBlocking": true
            }
        }))
        .unwrap();
        let mut pane = BottomPane::default();
        pane.set_keymap_bindings(&keymap);
        pane.enqueue(request).unwrap();
        for locale in [
            crate::locale::Locale::ZhCn,
            crate::locale::Locale::ZhTw,
            crate::locale::Locale::EnUs,
            crate::locale::Locale::JaJp,
            crate::locale::Locale::KoKr,
        ] {
            let lines = pane.footer_hint_lines(locale, 120).unwrap();
            let footer = lines.join(" · ");
            assert_eq!(footer.contains("f12"), accept, "{footer}");
            assert_eq!(footer.contains("f11"), cancel, "{footer}");
            assert!(
                footer.contains(&locale.request_select_hint("↑", "↓")),
                "{footer}"
            );
            assert!(
                footer.contains(&locale.request_notes_hint("tab")),
                "{footer}"
            );
            let narrow = pane.footer_hint_lines(locale, 3).unwrap();
            assert!(
                narrow
                    .iter()
                    .all(|line| !line.is_empty() && !line.contains('…')),
                "{narrow:?}"
            );
            let footer = narrow.join(" · ");
            assert!(
                !footer.contains("Enter") && !footer.contains("Esc"),
                "{footer}"
            );
            if accept || cancel {
                assert!(
                    footer.contains(if cancel { "f11" } else { "f12" }),
                    "{footer}"
                );
            }
        }
    }
}
