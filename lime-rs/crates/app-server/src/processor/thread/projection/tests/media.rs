use super::*;

fn media_item() -> canonical::ThreadItem {
    canonical::ThreadItem::new(
        canonical::SessionId::new("session-1"),
        canonical::ThreadId::new("thread-1"),
        canonical::TurnId::new("turn-1"),
        1,
        1,
        canonical::ThreadItemPayload::AgentMessage {
            text: String::new(),
            phase: Some(canonical::response_item::MessagePhase::FinalAnswer),
            content_parts: serde_json::from_value(json!([{
                "type": "media", "kind": "image", "reference": {
                    "uri": "sidecar://media/result/image.png", "mime_type": "image/png",
                    "sidecar_ref": {"ref": "sidecar://media/result/image.png"}
                }
            }])).unwrap(),
            delivery: None,
            questions: None,
        },
    )
}

#[test]
fn media_only_message_survives_public_read_and_notification_projection() {
    let item = media_item();
    let expected = serde_json::to_value(project_item(item.clone()).unwrap()).unwrap();
    assert_eq!(expected["text"], "");
    assert_eq!(expected["contentParts"][0]["reference"]["uri"], "sidecar://media/result/image.png");
    let mut thread = canonical_thread(false);
    thread.turns[0].items = vec![item.clone()];
    let read = serde_json::to_value(project_thread(thread).unwrap()).unwrap();
    assert_eq!(read["turns"][0]["items"][0], expected);
    for event_type in ["item.started", "item.completed"] {
        let event = AgentEvent {
            event_id: event_type.to_string(), sequence: 1,
            session_id: "session-1".to_string(), thread_id: Some("thread-1".to_string()),
            turn_id: Some("turn-1".to_string()), event_type: event_type.to_string(),
            timestamp: "2026-10-25T00:00:00Z".to_string(), payload: json!({"item": item}),
        };
        let Some(ProjectedEvent::Item(projected)) = project_event(&event) else { panic!("media notification"); };
        assert_eq!(serde_json::to_value(projected).unwrap(), expected);
    }
}

#[test]
fn media_message_rejects_inline_reference_at_public_boundary() {
    let mut item = media_item();
    let canonical::ThreadItemPayload::AgentMessage { content_parts, .. } = &mut item.payload else { panic!("message"); };
    let canonical::MessageContentPart::Media { reference, .. } = &mut content_parts[0] else { panic!("media"); };
    reference.uri = "data:image/png;base64,secret".to_string();
    assert!(project_item(item).is_err());
}
