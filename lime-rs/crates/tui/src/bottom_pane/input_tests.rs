use super::*;
use app_server_protocol::protocol::v2::ServerRequest;
use crossterm::event::KeyModifiers;
use serde_json::json;
use std::time::Duration;

fn question() -> ServerRequest {
    serde_json::from_value(json!({
        "method": "item/tool/requestUserInput", "id": 71,
        "params": {
            "threadId": "root", "turnId": "turn", "itemId": "question",
            "isBlocking": true,
            "questions": [{
                "id": "answer", "header": "Answer", "question": "What next?",
                "isOther": false, "isSecret": false, "options": null
            }]
        }
    }))
    .unwrap()
}

#[test]
fn mcp_text_field_uses_active_view_burst_clock_and_keeps_main_draft() {
    let mut pane = BottomPane::default();
    pane.insert_str("main");
    pane.enqueue(
        serde_json::from_value(json!({
            "method": "mcpServer/elicitation/request", "id": 89,
            "params": {
                "threadId": "root", "serverName": "fixture", "mode": "form",
                "message": "MCP form",
                "requestedSchema": {
                    "type": "object", "properties": {"answer": {"type": "string"}},
                    "required": ["answer"]
                }
            }
        }))
        .unwrap(),
    )
    .unwrap();
    let now = Instant::now();
    for code in [
        KeyCode::Char('a'),
        KeyCode::Enter,
        KeyCode::Tab,
        KeyCode::Char('界'),
    ] {
        pane.handle_event_at(Event::Key(KeyEvent::new(code, KeyModifiers::NONE)), now);
    }
    assert!(pane.is_in_paste_burst());
    assert_eq!(
        pane.next_frame_delay(now),
        Some(crate::tui::TARGET_FRAME_INTERVAL)
    );
    let idle = now + Duration::from_secs(1);
    assert!(pane.pre_draw_tick(idle).is_none());
    assert!(!pane.is_in_paste_burst());
    assert_eq!(pane.next_frame_delay(idle), None);
    let Some(ChatWidgetAction::Respond(AppServerResponse::McpElicitation { id, response })) = pane
        .handle_event_at(
            Event::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
            idle,
        )
    else {
        panic!("idle Enter must submit the active MCP field")
    };
    assert_eq!(id, app_server_protocol::RequestId::Integer(89));
    assert_eq!(response.content, Some(json!({"answer": "a\n\t界"})));
    assert!(!pane.is_active());
    assert_eq!(pane.composer_text(), "main");
}

#[test]
fn main_paste_timer_keeps_running_behind_an_interaction_without_editing_notes() {
    let now = Instant::now();
    let mut pane = BottomPane::default();
    pane.handle_key_event_at(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::NONE), now);
    assert!(
        pane.composer_is_empty(),
        "the held key is not materialized yet"
    );
    pane.enqueue(question()).unwrap();
    assert!(
        pane.next_frame_delay(now).is_some(),
        "hidden composer must still flush"
    );
    assert!(pane.pre_draw_tick(now + Duration::from_secs(1)).is_none());
    assert_eq!(pane.composer_text(), "r");
    assert_eq!(pane.next_frame_delay(now + Duration::from_secs(1)), None);

    pane.handle_event(Event::Paste("notes".into()));
    assert_eq!(
        pane.composer_text(),
        "r",
        "modal paste must not edit the main draft"
    );
    let response = pane.handle_event(Event::Key(KeyEvent::new(
        KeyCode::Enter,
        KeyModifiers::NONE,
    )));
    let Some(ChatWidgetAction::Respond(AppServerResponse::UserInput { response, .. })) = response
    else {
        panic!("expected the active question response");
    };
    assert_eq!(response.answers["answer"].answers, vec!["user_note: notes"]);
    assert_eq!(pane.composer_text(), "r");
}

#[test]
fn active_notes_idle_tick_draws_held_typing_without_touching_the_main_draft() {
    let mut pane = BottomPane::default();
    pane.insert_str("main");
    pane.enqueue(question()).unwrap();
    assert!(matches!(
        pane.handle_event(Event::Key(KeyEvent::new(
            KeyCode::Char('x'),
            KeyModifiers::NONE
        ))),
        Some(ChatWidgetAction::Input(InputResult::None))
    ));
    let now = Instant::now();
    assert_eq!(
        pane.next_frame_delay(now),
        Some(crate::tui::TARGET_FRAME_INTERVAL)
    );
    assert!(pane.pre_draw_tick(now + Duration::from_secs(1)).is_none());
    assert_eq!(pane.next_frame_delay(now + Duration::from_secs(1)), None);
    let Some(ChatWidgetAction::Respond(AppServerResponse::UserInput { response, .. })) = pane
        .handle_event(Event::Key(KeyEvent::new(
            KeyCode::Enter,
            KeyModifiers::NONE,
        )))
    else {
        panic!("idle Enter must submit the active note")
    };
    assert_eq!(response.answers["answer"].answers, ["user_note: x"]);
    assert_eq!(pane.composer_text(), "main");
}

#[test]
fn chat_widget_defers_burst_frames_then_submits_the_complete_idle_note() {
    let now = Instant::now();
    let mut app = crate::app::App::default();
    let requester = crate::tui::FrameRequester::test_dummy();
    app.chat_widget.bottom_pane.insert_str("main");
    app.chat_widget.bottom_pane.enqueue(question()).unwrap();
    for code in [
        KeyCode::Char('a'),
        KeyCode::Enter,
        KeyCode::Tab,
        KeyCode::Char('界'),
    ] {
        app.chat_widget
            .bottom_pane
            .handle_event_at(Event::Key(KeyEvent::new(code, KeyModifiers::NONE)), now);
    }
    assert!(app.chat_widget.handle_paste_burst_tick(&requester, now));
    assert!(app.chat_widget.bottom_pane.is_active());
    let idle = now + Duration::from_secs(1);
    assert!(app.chat_widget.handle_paste_burst_tick(&requester, idle));
    assert!(!app.chat_widget.handle_paste_burst_tick(&requester, idle));
    assert!(app.chat_widget.bottom_pane.is_active());
    let Some(ChatWidgetAction::Respond(AppServerResponse::UserInput { response, .. })) =
        app.chat_widget.bottom_pane.handle_event_at(
            Event::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
            idle,
        )
    else {
        panic!("only the explicit idle Enter may resolve the note")
    };
    assert_eq!(response.answers["answer"].answers, ["user_note: a\n\t界"]);
    assert_eq!(app.chat_widget.bottom_pane.composer_text(), "main");
    assert!(!app.chat_widget.bottom_pane.is_active());
}

#[test]
fn disconnect_clears_interactions_but_preserves_main_pending_typing_and_images() {
    let now = Instant::now();
    let mut pane = BottomPane::default();
    pane.handle_key_event_at(KeyEvent::new(KeyCode::Char('x'), KeyModifiers::NONE), now);
    pane.attach_image("draft.png".into());
    pane.enqueue(question()).unwrap();
    pane.clear_interactions();
    assert!(!pane.is_active());
    pane.pre_draw_tick(now + Duration::from_secs(1));
    assert!(pane.composer_text().contains('x'));
    assert_eq!(
        pane.composer_local_images()[0].path,
        std::path::PathBuf::from("draft.png")
    );
}

#[test]
fn pane_capture_restores_the_main_draft_and_same_question_view_atomically() {
    let mut pane = BottomPane::default();
    pane.insert_str("main");
    pane.enqueue(question()).unwrap();
    pane.handle_event(Event::Paste("retained notes".into()));
    let state = pane.take_input_state();
    pane.restore_input_state(Default::default());
    assert!(!pane.is_active());
    assert!(pane.composer_is_empty());
    pane.restore_input_state(state);
    assert!(pane.is_active());
    assert_eq!(pane.composer_text(), "main");
    let Some(ChatWidgetAction::Respond(AppServerResponse::UserInput { response, .. })) = pane
        .handle_event(Event::Key(KeyEvent::new(
            KeyCode::Enter,
            KeyModifiers::NONE,
        )))
    else {
        panic!("expected restored question response");
    };
    assert_eq!(
        response.answers["answer"].answers,
        vec!["user_note: retained notes"]
    );
}

#[test]
fn command_popup_completion_is_owned_by_the_pane_but_execution_is_a_host_action() {
    let mut pane = BottomPane::default();
    pane.set_composer_text("/status".into());
    assert!(pane.popup_active());
    assert_eq!(
        pane.handle_event(Event::Key(KeyEvent::new(
            KeyCode::Enter,
            KeyModifiers::NONE
        ))),
        Some(ChatWidgetAction::ExecuteCommand),
    );
    assert_eq!(pane.composer_text(), "/status");
    assert!(!pane.popup_active());
    pane.set_composer_text("/effort".into());
    assert_eq!(
        pane.handle_event(Event::Key(KeyEvent::new(KeyCode::Tab, KeyModifiers::NONE))),
        Some(ChatWidgetAction::Input(InputResult::None)),
    );
    assert_eq!(pane.composer_text(), "/effort ");
}

fn pane_with_completion(kind: &str) -> (BottomPane, &'static str) {
    use app_server_protocol::protocol::v2::{FuzzyFileSearchMatchType, FuzzyFileSearchResult};
    let mut pane = BottomPane::default();
    pane.set_skills(vec![serde_json::from_value(json!({
        "name": "deploy", "description": "Deployment skill", "enabled": true,
        "path": "/skills/deploy/SKILL.md", "scope": "user"
    }))
    .unwrap()]);
    let token = match kind {
        "file" | "empty-file" => "@src",
        "skill" => "$dep",
        "empty-skill" => "$zzzz-unmatched",
        "command" => "/sta",
        _ => unreachable!(),
    };
    pane.set_composer_text(format!("{token} suffix"));
    pane.attach_image("draft.png".into());
    pane.handle_key_event(KeyEvent::new(KeyCode::Home, KeyModifiers::NONE));
    for _ in token.chars() {
        pane.handle_key_event(KeyEvent::new(KeyCode::Right, KeyModifiers::NONE));
    }
    if let Some(request) = pane.take_file_search_request() {
        let matches = if kind == "file" {
            vec![FuzzyFileSearchResult {
                root: "/workspace".into(),
                path: "src/main.rs".into(),
                match_type: FuzzyFileSearchMatchType::File,
                file_name: "main.rs".into(),
                score: 1,
                indices: None,
            }]
        } else {
            vec![]
        };
        pane.on_file_search_result(request.generation, &request.query, matches);
    }
    assert!(pane.popup_active(), "{kind}: completion must be visible");
    (pane, token)
}

#[test]
fn modified_enter_in_completion_edits_the_draft_without_selecting_or_executing() {
    for kind in ["command", "file", "empty-file", "skill"] {
        for modifiers in [KeyModifiers::SHIFT, KeyModifiers::ALT] {
            let (mut pane, token) = pane_with_completion(kind);
            let before = pane.composer_snapshot();
            assert_eq!(
                pane.handle_key_event(KeyEvent::new(KeyCode::Enter, modifiers)),
                ChatWidgetAction::Input(InputResult::Changed),
                "{kind}: {modifiers:?} must reach the editor"
            );
            let after = pane.composer_snapshot();
            assert_eq!(pane.composer_text(), format!("{token}\n suffix[Image #1]"));
            assert!(!pane.popup_active(), "newline ends the completion token");
            // Compare the complete opaque draft with the same editor chord outside a popup.
            pane.composer.restore_draft(before);
            pane.clear_completion_popup();
            pane.handle_key_event(KeyEvent::new(KeyCode::Enter, modifiers));
            assert_eq!(after, pane.composer_snapshot());
        }
    }
}

#[test]
fn ctrl_enter_in_completion_uses_the_current_editor_binding() {
    for kind in ["command", "file", "empty-file", "skill"] {
        let (mut pane, token) = pane_with_completion(kind);
        let before = pane.composer_snapshot();
        assert_eq!(
            pane.handle_key_event(KeyEvent::new(KeyCode::Enter, KeyModifiers::CONTROL)),
            ChatWidgetAction::Input(InputResult::None),
            "{kind}: an unbound Ctrl+Enter must not select a completion"
        );
        assert_eq!(pane.composer_snapshot(), before);
        assert!(pane.popup_active());

        let keymap = crate::keymap::RuntimeKeymap::from_config(
            &serde_json::from_value(json!({"editor": {"insert_newline": "ctrl-enter"}})).unwrap(),
        )
        .unwrap();
        pane.set_keymap_bindings(&keymap);
        assert_eq!(
            pane.handle_key_event(KeyEvent::new(KeyCode::Enter, KeyModifiers::CONTROL)),
            ChatWidgetAction::Input(InputResult::Changed)
        );
        assert_eq!(pane.composer_text(), format!("{token}\n suffix[Image #1]"));
        assert_eq!(
            pane.composer_local_image_paths(),
            vec![std::path::PathBuf::from("draft.png")]
        );
    }
}

#[test]
fn plain_enter_still_selects_file_and_skill_completions_through_the_pane() {
    for (kind, replacement) in [("file", "src/main.rs"), ("skill", "$deploy")] {
        let (mut pane, _) = pane_with_completion(kind);
        assert_eq!(
            pane.handle_key_event(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
            ChatWidgetAction::Input(InputResult::None)
        );
        assert_eq!(
            pane.composer_text(),
            format!("{replacement}  suffix[Image #1]")
        );
        assert_eq!(
            pane.composer_local_image_paths(),
            vec![std::path::PathBuf::from("draft.png")]
        );
        assert!(!pane.popup_active());
    }
}

#[test]
fn repeat_confirmation_matches_press_and_release_preserves_the_complete_draft() {
    for kind in ["command", "file", "skill", "empty-file", "empty-skill"] {
        for code in [KeyCode::Enter, KeyCode::Tab] {
            let (mut pressed, _) = pane_with_completion(kind);
            let (mut repeated, _) = pane_with_completion(kind);
            let before = repeated.composer_snapshot();
            repeated.handle_key_event(KeyEvent::new_with_kind(
                code,
                KeyModifiers::NONE,
                KeyEventKind::Release,
            ));
            assert_eq!(
                repeated.composer_snapshot(),
                before,
                "{kind}: release must preserve rich draft"
            );
            assert!(repeated.popup_active());
            let expected = pressed.handle_key_event(KeyEvent::new(code, KeyModifiers::NONE));
            assert_eq!(
                repeated.handle_key_event(KeyEvent::new_with_kind(
                    code,
                    KeyModifiers::NONE,
                    KeyEventKind::Repeat
                )),
                expected,
                "{kind}: {code:?}"
            );
            assert_eq!(
                repeated.composer_snapshot(),
                pressed.composer_snapshot(),
                "{kind}: {code:?}"
            );
            assert_eq!(
                repeated.popup_active(),
                pressed.popup_active(),
                "{kind}: {code:?}"
            );
        }
    }
}

#[test]
fn completion_does_not_steal_altgr_text_or_editor_control_j_and_k() {
    for kind in ["command", "file", "skill"] {
        for ch in ['p', 'n'] {
            let (mut pane, _) = pane_with_completion(kind);
            let before = pane.composer_snapshot();
            pane.handle_key_event(KeyEvent::new(
                KeyCode::Char(ch),
                KeyModifiers::CONTROL | KeyModifiers::ALT,
            ));
            let after = pane.composer_snapshot();
            if cfg!(windows) {
                assert_ne!(after, before, "{kind}: Windows AltGr must edit the draft");
            } else {
                assert_eq!(
                    after, before,
                    "{kind}: Unix Ctrl+Alt remains a control chord"
                );
            }
            pane.composer.restore_draft(before);
            pane.clear_completion_popup();
            pane.handle_key_event(KeyEvent::new(
                KeyCode::Char(ch),
                KeyModifiers::CONTROL | KeyModifiers::ALT,
            ));
            assert_eq!(
                after,
                pane.composer_snapshot(),
                "{kind}: popup must use the same editor"
            );
        }
    }
    for ch in ['j', 'k'] {
        let (mut pane, _) = pane_with_completion("command");
        let before = pane.composer_snapshot();
        pane.handle_key_event(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::CONTROL));
        let after = pane.composer_snapshot();
        assert_ne!(after, before, "Ctrl+{ch} must reach the editor");
        pane.composer.restore_draft(before);
        pane.clear_completion_popup();
        pane.handle_key_event(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::CONTROL));
        assert_eq!(
            after,
            pane.composer_snapshot(),
            "Ctrl+{ch}: identical editor mutation"
        );
    }
}

#[test]
fn slash_completion_keys_preserve_arguments_before_host_dispatch() {
    for code in [KeyCode::Tab, KeyCode::Char('/'), KeyCode::Enter] {
        for (draft, cursor, expected, executes) in [
            ("/effo high", 5, "/effort high", false),
            ("/exp result.md", 4, "/export result.md", true),
        ] {
            let mut pane = BottomPane::default();
            pane.set_composer_text(draft.into());
            pane.handle_key_event(KeyEvent::new(KeyCode::Home, KeyModifiers::NONE));
            for _ in 0..cursor {
                pane.handle_key_event(KeyEvent::new(KeyCode::Right, KeyModifiers::NONE));
            }
            assert!(pane.popup_active());
            assert_eq!(
                pane.handle_key_event(KeyEvent::new(code, KeyModifiers::NONE)),
                if code == KeyCode::Enter && executes {
                    ChatWidgetAction::ExecuteCommand
                } else {
                    ChatWidgetAction::Input(InputResult::None)
                }
            );
            assert_eq!(pane.composer_text(), expected);
            assert!(!pane.popup_active());
        }
    }
}

#[test]
fn empty_completion_acceptance_closes_the_list_with_distinct_enter_semantics() {
    for kind in ["empty-file", "empty-skill"] {
        for code in [KeyCode::Tab, KeyCode::Enter] {
            let (mut pane, token) = pane_with_completion(kind);
            let before = pane.composer_snapshot();
            let action = pane.handle_key_event(KeyEvent::new(code, KeyModifiers::NONE));
            if kind == "empty-file" && code == KeyCode::Enter {
                let ChatWidgetAction::Input(InputResult::Submitted {
                    text,
                    text_elements,
                }) = action
                else {
                    panic!("empty file Enter must continue ordinary submission");
                };
                assert_eq!(text, format!("{token} suffix[Image #1]"));
                assert_eq!(text_elements.len(), 1);
                assert!(pane.composer_text().is_empty());
            } else {
                assert_eq!(action, ChatWidgetAction::Input(InputResult::None));
                assert_eq!(pane.composer_snapshot(), before);
            }
            assert!(
                !pane.popup_active(),
                "{kind}: {code:?} must close the empty list"
            );
            assert_eq!(
                pane.composer_local_image_paths(),
                vec![std::path::PathBuf::from("draft.png")]
            );
        }
    }
}

#[test]
fn empty_file_tab_cancels_search_generation_so_a_late_reply_cannot_reopen_it() {
    let mut pane = BottomPane::default();
    pane.set_composer_text("@missing".into());
    let request = pane.take_file_search_request().unwrap();
    pane.on_file_search_result(request.generation, &request.query, vec![]);
    assert_eq!(
        pane.handle_key_event(KeyEvent::new(KeyCode::Tab, KeyModifiers::NONE)),
        ChatWidgetAction::Input(InputResult::None)
    );
    assert!(!pane.popup_active());
    pane.on_file_search_result(request.generation, &request.query, vec![]);
    assert!(!pane.popup_active());
    assert_eq!(pane.composer_text(), "@missing");
    assert!(pane.take_file_search_request().is_none());
}

#[test]
fn history_query_paste_cannot_open_a_popup_from_the_preview() {
    let mut pane = BottomPane::default();
    pane.set_cached_history(["/status".into()]);
    pane.insert_str("original");
    pane.handle_key_event(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL));
    pane.handle_event(Event::Paste("status".into()));
    assert!(pane.history_search_active());
    assert_eq!(pane.composer_text(), "/status");
    assert!(!pane.popup_active());
}

#[test]
fn ordinary_keys_pass_to_host_routing_but_paste_and_mouse_stay_in_the_pane() {
    let mut pane = BottomPane::default();
    assert_eq!(
        pane.handle_event(Event::Key(KeyEvent::new(
            KeyCode::PageUp,
            KeyModifiers::NONE
        ))),
        None
    );
    assert_eq!(
        pane.handle_event(Event::Paste("界🙂".into())),
        Some(ChatWidgetAction::Input(InputResult::None))
    );
    assert_eq!(pane.composer_text(), "界🙂");
}

#[test]
fn direct_key_api_edits_the_active_question_not_the_hidden_main_draft() {
    let mut pane = BottomPane::default();
    pane.insert_str("main");
    pane.enqueue(question()).unwrap();
    pane.handle_paste("notes");
    pane.handle_key_event(KeyEvent::new(KeyCode::Backspace, KeyModifiers::NONE));
    assert_eq!(pane.composer_text(), "main");
    let ChatWidgetAction::Respond(AppServerResponse::UserInput { response, .. }) =
        pane.handle_key_event(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE))
    else {
        panic!("expected active question response");
    };
    assert_eq!(response.answers["answer"].answers, vec!["user_note: note"]);
    assert_eq!(pane.composer_text(), "main");
}
