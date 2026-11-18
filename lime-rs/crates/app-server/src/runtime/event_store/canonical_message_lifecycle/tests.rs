use super::*;
use serde_json::json;

fn runtime_event(event_type: &str, payload: Value) -> RuntimeEvent {
    RuntimeEvent::new(event_type, payload)
}

fn stored_event(event_type: &str, sequence: u64, payload: Value) -> AgentEvent {
    AgentEvent {
        event_id: format!("event-{sequence}"),
        sequence,
        session_id: "session-1".to_string(),
        thread_id: Some("thread-1".to_string()),
        turn_id: Some("turn-1".to_string()),
        event_type: event_type.to_string(),
        timestamp: "2026-07-15T00:00:00Z".to_string(),
        payload,
    }
}

#[test]
fn async_user_input_coexists_with_streaming_body_and_retains_per_id_validation() {
    let mut question = agent_protocol::ThreadItem::new(
        agent_protocol::SessionId::new("session-1"),
        agent_protocol::ThreadId::new("thread-1"),
        agent_protocol::TurnId::new("turn-1"),
        1,
        1,
        agent_protocol::ThreadItemPayload::AgentMessage {
            text: "Choose".to_string(),
            phase: None,
            content_parts: Vec::new(),
            delivery: Some(agent_protocol::AgentMessageDelivery::Async),
            questions: Some(vec![agent_protocol::AsyncUserInputQuestion {
                title: "Choose".to_string(),
                options: None,
            }]),
        },
    );
    question.item_id = agent_protocol::ItemId::new("question-call");
    let payload = json!({"item": question});
    let events = vec![
        runtime_event(
            "message.delta",
            json!({"itemId": "body", "text": "Working"}),
        ),
        runtime_event("item.started", payload.clone()),
        runtime_event("item.completed", payload.clone()),
        runtime_event("message.delta", json!({"itemId": "body", "text": " done"})),
        runtime_event(
            "message.completed",
            json!({"itemId": "body", "text": "Working done"}),
        ),
    ];
    assert!(with_canonical_message_reasoning_lifecycle(&[], Some("turn-1"), events, None).is_ok());
    assert!(with_canonical_message_reasoning_lifecycle(
        &[],
        Some("turn-1"),
        vec![runtime_event("item.completed", payload.clone())],
        None
    )
    .is_err());
    assert!(with_canonical_message_reasoning_lifecycle(
        &[],
        Some("turn-1"),
        vec![
            runtime_event("item.started", payload.clone()),
            runtime_event("item.started", payload)
        ],
        None
    )
    .is_err());
}

#[test]
fn wraps_message_and_reasoning_with_host_item_lifecycle() {
    let events = with_canonical_message_reasoning_lifecycle(
        &[],
        Some("turn-1"),
        vec![
            runtime_event(
                "message.created",
                json!({"role": "user", "content": {"text": "question"}}),
            ),
            runtime_event("turn.accepted", json!({})),
            runtime_event("reasoning.started", json!({"reasoningId": "reasoning-1"})),
            runtime_event(
                "reasoning.delta",
                json!({"reasoningId": "reasoning-1", "delta": "thinking"}),
            ),
            runtime_event("message.delta", json!({"text": "answer"})),
            runtime_event("message.completed", json!({"status": "completed"})),
            runtime_event(
                "reasoning.final",
                json!({"reasoningId": "reasoning-1", "text": "thinking"}),
            ),
            runtime_event(
                "reasoning.ended",
                json!({"reasoningId": "reasoning-1", "status": "completed"}),
            ),
            runtime_event("turn.completed", json!({})),
        ],
        None,
    )
    .expect("managed lifecycle");

    assert_eq!(
        events
            .iter()
            .map(|event| event.event_type.as_str())
            .collect::<Vec<_>>(),
        vec![
            "item.started",
            "message.created",
            "item.completed",
            "turn.accepted",
            "item.started",
            "reasoning.delta",
            "item.started",
            "message.delta",
            "item.completed",
            "reasoning.final",
            "item.completed",
            "turn.completed",
        ]
    );
    assert_eq!(events[0].payload["itemType"], "user_message");
    assert_eq!(events[4].payload["itemType"], "reasoning");
    assert_eq!(events[6].payload["itemType"], "agent_message");
    assert_eq!(events[8].payload["itemType"], "agent_message");
    assert_eq!(events[10].payload["itemType"], "reasoning");
}

#[test]
fn preserves_explicit_canonical_producer_without_double_wrapping() {
    let explicit_item = json!({
        "item": {
            "kind": "agentMessage",
            "itemId": "agent-1"
        }
    });
    let events = with_canonical_message_reasoning_lifecycle(
        &[],
        Some("turn-1"),
        vec![
            runtime_event("item.started", explicit_item.clone()),
            runtime_event(
                "message.delta",
                json!({"itemId": "agent-1", "text": "answer"}),
            ),
            runtime_event("item.completed", explicit_item),
        ],
        None,
    )
    .expect("external lifecycle");

    assert_eq!(
        events
            .iter()
            .map(|event| event.event_type.as_str())
            .collect::<Vec<_>>(),
        vec!["item.started", "message.delta", "item.completed"]
    );
}

#[test]
fn explicit_message_identity_materializes_as_one_item() {
    let events = with_canonical_message_reasoning_lifecycle(
        &[],
        Some("turn-1"),
        vec![
            runtime_event(
                "message.delta",
                json!({"itemId": "agent-1", "text": "answer"}),
            ),
            runtime_event(
                "message.completed",
                json!({"itemId": "agent-1", "status": "completed"}),
            ),
        ],
        None,
    )
    .expect("managed lifecycle");
    let stored = events
        .into_iter()
        .enumerate()
        .map(|(index, event)| stored_event(&event.event_type, index as u64 + 1, event.payload))
        .collect::<Vec<_>>();

    let changes = thread_item_projection::materialize_events(&stored, "session-1", "thread-1")
        .expect("materialize canonical item");
    let canonical_item_id = agent_protocol::ItemId::new("agent-1");
    let items = changes
        .changed_items
        .iter()
        .filter(|item| item.item_id == canonical_item_id)
        .collect::<Vec<_>>();

    assert_eq!(items.len(), 1);
    assert_eq!(items[0].item_id.as_str(), "item_agent-1");
    assert_eq!(items[0].status, agent_protocol::ItemStatus::Completed);
}

#[test]
fn explicit_user_message_identity_preserves_content_at_terminal() {
    let events = with_canonical_message_reasoning_lifecycle(
        &[],
        Some("turn-1"),
        vec![runtime_event(
            "message.created",
            json!({
                "role": "user",
                "itemId": "user-1",
                "input": [{"type": "text", "text": "delegated task"}]
            }),
        )],
        None,
    )
    .expect("managed user lifecycle");
    let stored = events
        .into_iter()
        .enumerate()
        .map(|(index, event)| stored_event(&event.event_type, index as u64 + 1, event.payload))
        .collect::<Vec<_>>();

    let changes = thread_item_projection::materialize_events(&stored, "session-1", "thread-1")
        .expect("materialize canonical user item");
    let item = changes
        .changed_items
        .iter()
        .find(|item| item.item_id == agent_protocol::ItemId::new("user-1"))
        .expect("canonical user item");

    assert_eq!(item.status, agent_protocol::ItemStatus::Completed);
    assert!(matches!(
        &item.payload,
        agent_protocol::ThreadItemPayload::UserMessage { content, .. }
            if content == &vec![agent_protocol::AgentInput::text("delegated task")]
    ));
}

#[test]
fn rejects_external_presentation_without_matching_item_identity() {
    let explicit_item = json!({
        "item": {
            "kind": "agentMessage",
            "itemId": "agent-1"
        }
    });
    let error = with_canonical_message_reasoning_lifecycle(
        &[],
        Some("turn-1"),
        vec![
            runtime_event("item.started", explicit_item),
            runtime_event("message.delta", json!({"text": "answer"})),
        ],
        None,
    )
    .expect_err("external delta without itemId must fail closed");

    assert!(error.contains("targets Item agent-turn-1 while agent-1 is active"));
}

#[test]
fn rejects_late_delta_after_item_completion() {
    let error = with_canonical_message_reasoning_lifecycle(
        &[],
        Some("turn-1"),
        vec![
            runtime_event(
                "message.delta",
                json!({"itemId": "agent-1", "text": "answer"}),
            ),
            runtime_event(
                "message.completed",
                json!({"itemId": "agent-1", "status": "completed"}),
            ),
            runtime_event(
                "message.delta",
                json!({"itemId": "agent-1", "text": "late"}),
            ),
        ],
        None,
    )
    .expect_err("late delta must fail closed");

    assert!(error.contains("cannot update completed Item agent-1"));
}

#[test]
fn distinct_message_identity_starts_a_new_item_after_completion() {
    let events = with_canonical_message_reasoning_lifecycle(
        &[],
        Some("turn-1"),
        vec![
            runtime_event(
                "message.delta",
                json!({"itemId": "agent-1", "text": "first"}),
            ),
            runtime_event(
                "message.completed",
                json!({"itemId": "agent-1", "status": "completed"}),
            ),
            runtime_event(
                "message.delta",
                json!({"itemId": "agent-2", "text": "second"}),
            ),
            runtime_event(
                "message.completed",
                json!({"itemId": "agent-2", "status": "completed"}),
            ),
        ],
        None,
    )
    .expect("distinct items");

    assert_eq!(
        events
            .iter()
            .filter(|event| event.event_type == "item.started")
            .map(|event| event.payload["itemId"].as_str().expect("itemId"))
            .collect::<Vec<_>>(),
        vec!["agent-1", "agent-2"]
    );
    assert_eq!(
        events
            .iter()
            .filter(|event| event.event_type == "item.completed")
            .map(|event| event.payload["itemId"].as_str().expect("itemId"))
            .collect::<Vec<_>>(),
        vec!["agent-1", "agent-2"]
    );
}

#[test]
fn synthesized_reasoning_start_preserves_context_without_copying_content() {
    let events = with_canonical_message_reasoning_lifecycle(
        &[],
        Some("turn-1"),
        vec![
            runtime_event(
                "reasoning.completed",
                json!({
                    "reasoningId": "reasoning-1",
                    "ordinal": 3,
                    "phase": "commentary",
                    "metadata": {"provider_metadata": {"signature": "reasoning-signature"}},
                    "text": "thinking"
                }),
            ),
            runtime_event(
                "reasoning.ended",
                json!({"reasoningId": "reasoning-1", "status": "completed"}),
            ),
        ],
        None,
    )
    .expect("managed reasoning lifecycle");

    assert_eq!(events[0].event_type, "item.started");
    assert_eq!(events[0].payload["ordinal"], 3);
    assert_eq!(events[0].payload["phase"], "commentary");
    assert_eq!(
        events[0].payload["metadata"]["provider_metadata"]["signature"],
        "reasoning-signature"
    );
    assert!(events[0].payload.get("text").is_none());
    assert_eq!(events[1].payload["text"], "thinking");
    assert_eq!(events[2].event_type, "item.completed");
}

#[test]
fn completes_managed_item_across_incremental_append_calls() {
    let existing = vec![stored_event(
        "item.started",
        1,
        json!({
            "itemType": "agent_message",
            "itemId": "agent-turn-1",
            "canonicalLifecycle": LIFECYCLE_SOURCE,
        }),
    )];
    let events = with_canonical_message_reasoning_lifecycle(
        &existing,
        Some("turn-1"),
        vec![runtime_event(
            "message.completed",
            json!({"status": "completed"}),
        )],
        None,
    )
    .expect("incremental completion");

    assert_eq!(events.len(), 1);
    assert_eq!(events[0].event_type, "item.completed");
    assert_eq!(events[0].payload["itemType"], "agent_message");
}

#[test]
fn turn_terminal_does_not_synthesize_item_completion() {
    let events = with_canonical_message_reasoning_lifecycle(
        &[],
        Some("turn-1"),
        vec![
            runtime_event("message.delta", json!({"text": "partial"})),
            runtime_event("turn.completed", json!({})),
        ],
        None,
    )
    .expect("turn terminal");

    assert_eq!(
        events
            .iter()
            .map(|event| event.event_type.as_str())
            .collect::<Vec<_>>(),
        vec!["item.started", "message.delta", "turn.completed"]
    );
}
