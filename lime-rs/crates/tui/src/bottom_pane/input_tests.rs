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
    assert_eq!(response.answers["answer"].answers, vec!["notes"]);
    assert_eq!(pane.composer_text(), "r");
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
    assert_eq!(response.answers["answer"].answers, vec!["retained notes"]);
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
    assert_eq!(response.answers["answer"].answers, vec!["note"]);
    assert_eq!(pane.composer_text(), "main");
}
