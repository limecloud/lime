use super::*;
use agent_protocol::{
    HookPromptFragment, ImageDetail, ItemId, ItemKind, ItemStatus, SessionId, ThreadId, ThreadItem,
    ThreadItemPayload, ToolArgument, ToolOutput, TurnId,
};
use serde_json::json;

fn event(sequence: u64, event_type: &str, payload: Value) -> AgentEvent {
    AgentEvent {
        event_id: format!("evt-{sequence}"),
        sequence,
        session_id: "session-1".to_string(),
        thread_id: Some("thread-1".to_string()),
        turn_id: Some("turn-1".to_string()),
        event_type: event_type.to_string(),
        timestamp: "2026-07-12T00:00:00.000Z".to_string(),
        payload,
    }
}

fn stored_with_events(events: Vec<AgentEvent>) -> StoredSession {
    StoredSession {
        session: app_server_protocol::AgentSession {
            session_id: "session-1".to_string(),
            thread_id: "thread-1".to_string(),
            app_id: "agent-chat".to_string(),
            workspace_id: None,
            business_object_ref: None,
            status: app_server_protocol::AgentSessionStatus::Idle,
            created_at: "now".to_string(),
            updated_at: "now".to_string(),
        },
        turns: Vec::new(),
        turn_inputs: HashMap::new(),
        turn_runtime_options: HashMap::new(),
        events,
        output_blobs: HashMap::new(),
    }
}

fn turn_event(sequence: u64, turn_id: &str, event_type: &str, payload: Value) -> AgentEvent {
    let mut event = event(sequence, event_type, payload);
    event.turn_id = Some(turn_id.to_string());
    event
}

fn route_options(provider: &str, model: &str) -> app_server_protocol::RuntimeOptions {
    app_server_protocol::RuntimeOptions {
        runtime_request: Some(app_server_protocol::RuntimeRequest {
            metadata: Some(json!({
                "agentControlRoute": {
                    "schemaVersion": 2,
                    "providerPreference": provider,
                    "modelPreference": model
                }
            })),
            ..app_server_protocol::RuntimeRequest::default()
        }),
        ..app_server_protocol::RuntimeOptions::default()
    }
}

fn routing_decision(sequence: u64, turn_id: &str, provider: &str, model: &str) -> AgentEvent {
    turn_event(
        sequence,
        turn_id,
        "routing.decision.made",
        json!({
            "selectedProvider": provider,
            "selectedModel": model
        }),
    )
}

fn message_text(message: &CurrentProviderMessage) -> &str {
    let [CurrentProviderContent::Text(text)] = &message.content[..] else {
        panic!("expected one text content part");
    };
    text
}

#[test]
fn hook_prompt_item_is_restored_as_a_user_message() {
    let mut item = ThreadItem::new(
        SessionId::new("session-1"),
        ThreadId::new("thread-1"),
        TurnId::new("turn-1"),
        1,
        1,
        ThreadItemPayload::HookPrompt {
            fragments: vec![HookPromptFragment {
                text: "continue after checks".to_string(),
                hook_run_id: "stop:0:/tmp/hooks.json:turn-1:stop".to_string(),
            }],
        },
    );
    item.status = ItemStatus::Completed;
    let messages =
        super::messages_from_events(&[event(1, "item.completed", json!({"item": item}))]);
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].role, CurrentProviderRole::User);
    assert_eq!(
        message_text(&messages[0]),
        "<hook_prompt hook_run_id=\"stop:0:/tmp/hooks.json:turn-1:stop\">continue after checks</hook_prompt>"
    );
}

#[test]
fn hook_prompt_receipt_is_authoritative_and_only_deduplicates_its_own_turn() {
    use agent_runtime::model_history::{ModelHistoryRecord, MODEL_HISTORY_EVENT_TYPE};
    let mut item = ThreadItem::new(
        SessionId::new("session-1"),
        ThreadId::new("thread-1"),
        TurnId::new("turn-1"),
        1,
        1,
        ThreadItemPayload::HookPrompt {
            fragments: vec![HookPromptFragment {
                text: "canonical display".into(),
                hook_run_id: "stop:1".into(),
            }],
        },
    );
    item.status = ItemStatus::Completed;
    let message = CurrentProviderMessage::user(vec![CurrentProviderContent::Text(
        "authoritative persisted prompt".into(),
    )]);
    let record = ModelHistoryRecord::input(message.clone(), item.item_id.to_string()).unwrap();
    let receipt = event(1, MODEL_HISTORY_EVENT_TYPE, json!(record));
    let display = event(2, "item.completed", json!({"item":item}));
    assert_eq!(
        super::messages_from_events(&[receipt.clone(), display.clone()]),
        vec![message.clone()]
    );
    let other_turn = turn_event(3, "other-turn", "item.completed", display.payload);
    let messages = super::messages_from_events(&[receipt, other_turn]);
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0], message);
    assert!(message_text(&messages[1]).contains("canonical display"));
}

#[test]
fn replacement_history_is_used_before_bounded_tail() {
    let mut tail = event(
        3,
        "message.created",
        json!({"input": [{"type": "text", "text": "tail"}]}),
    );
    tail.turn_id = Some("turn-tail".to_string());
    let compaction = event(
        2,
        "context.compaction.completed",
        json!({
            "coveredThroughSequence": 1,
            "artifact": {
                "coveredThroughSequence": 1,
                "windowNumber": 1,
                "firstWindowId": "ctx_window_session_1",
                "windowId": "ctx_window_session_1",
                "replacementHistory": [{
                    "role": "assistant",
                    "content": [{"type": "text", "text": "remember this"}]
                }]
            }
        }),
    );
    let stored = stored_with_events(vec![
        event(
            1,
            "message.created",
            json!({"input": [{"type": "text", "text": "old"}]}),
        ),
        compaction,
        tail,
    ]);

    let (replacement, events) = provider_history_source(&stored.events);
    let replacement = replacement.expect("replacement history");
    assert_eq!(
        events
            .iter()
            .map(|event| event.sequence)
            .collect::<Vec<_>>(),
        [2, 3]
    );
    assert!(matches!(
        &replacement[0].content[..],
        [CurrentProviderContent::Text(text)] if text == "remember this"
    ));
}

#[test]
fn history_replacement_keeps_provider_prefix_and_removes_reverted_turn() {
    let stored = stored_with_events(vec![
        turn_event(
            1,
            "turn-1",
            "message.created",
            json!({"input": [{"type": "text", "text": "prefix"}]}),
        ),
        turn_event(2, "turn-1", "turn.completed", json!({})),
        turn_event(
            3,
            "turn-2",
            "message.created",
            json!({"input": [{"type": "text", "text": "reverted"}]}),
        ),
        turn_event(4, "turn-2", "turn.completed", json!({})),
        event(
            5,
            super::super::history_replacement::HISTORY_ROLLBACK_EVENT_TYPE,
            json!({"rollbackToSequence": 2}),
        ),
    ]);

    let history = provider_history_excluding_current_turn_input(&stored, None, "turn-3")
        .expect("provider history after replacement");
    let texts = history
        .iter()
        .flat_map(|message| message.content.iter())
        .filter_map(|content| match content {
            CurrentProviderContent::Text(text) => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert!(texts.contains(&"prefix"));
    assert!(!texts.contains(&"reverted"));
}

#[test]
fn incomplete_compaction_without_replacement_history_rebuilds_full_history() {
    let compaction = event(
        2,
        "context.compaction.completed",
        json!({"coveredThroughSequence": 1, "artifact": {"contextEpoch": 1}}),
    );
    let stored = stored_with_events(vec![
        event(
            1,
            "message.created",
            json!({"input": [{"type": "text", "text": "old"}]}),
        ),
        compaction,
    ]);

    let (replacement, events) = provider_history_source(&stored.events);
    assert!(replacement.is_none());
    assert_eq!(events.len(), 2);
}

#[test]
fn thread_goal_continuation_is_restored_for_future_turns_but_not_duplicated_in_its_turn() {
    let stored = stored_with_events(vec![event(
        1,
        super::super::turn_input_events::THREAD_GOAL_CONTINUATION_EVENT_TYPE,
        json!({
            "visibility": "agent_only",
            "source": "thread_goal",
            "input": [{"type": "text", "text": "continue the active goal"}]
        }),
    )]);

    let current = provider_history_excluding_current_turn_input(&stored, None, "turn-1")
        .expect("current continuation history");
    assert!(current.is_empty());

    let future = provider_history_excluding_current_turn_input(&stored, None, "turn-2")
        .expect("future continuation history");
    assert_eq!(future.len(), 1);
    assert_eq!(future[0].role, CurrentProviderRole::User);
    assert!(matches!(
        &future[0].content[..],
        [CurrentProviderContent::Text(text)] if text == "continue the active goal"
    ));
}

#[test]
fn review_input_is_restored_for_future_turns_but_not_duplicated_in_its_turn() {
    let stored = stored_with_events(vec![event(
        1,
        super::super::turn_input_events::REVIEW_INPUT_EVENT_TYPE,
        json!({
            "visibility": "agent_only",
            "source": "review",
            "input": [{"type": "text", "text": "review current changes"}]
        }),
    )]);

    let current = provider_history_excluding_current_turn_input(&stored, None, "turn-1")
        .expect("current review history");
    assert!(current.is_empty());

    let future = provider_history_excluding_current_turn_input(&stored, None, "turn-2")
        .expect("future review history");
    assert_eq!(future.len(), 1);
    assert_eq!(future[0].role, CurrentProviderRole::User);
    assert!(matches!(
        &future[0].content[..],
        [CurrentProviderContent::Text(text)] if text == "review current changes"
    ));
}

#[test]
fn rollout_budget_reminder_is_restored_only_for_future_turns() {
    let text =
            "<rollout_budget>\nYou have 50 weighted tokens left in the shared session token budget.\n</rollout_budget>";
    let stored = stored_with_events(vec![event(
        1,
        super::super::rollout_budget::ROLLOUT_BUDGET_REMINDER_EVENT_TYPE,
        json!({
            "remainingTokens": 50,
            "reminderIndex": 2,
            "windowId": "window-1",
            "text": text,
        }),
    )]);

    let current = provider_history_excluding_current_turn_input(&stored, None, "turn-1")
        .expect("current reminder history");
    assert!(current.is_empty());

    let future = provider_history_excluding_current_turn_input(&stored, None, "turn-2")
        .expect("future reminder history");
    assert_eq!(future.len(), 1);
    assert_eq!(future[0].role, CurrentProviderRole::Developer);
    assert_eq!(message_text(&future[0]), text);
}

#[test]
fn completed_route_switch_appends_host_developer_context_after_durable_history() {
    let mut stored = stored_with_events(vec![
        turn_event(
            1,
            "turn-1",
            "message.created",
            json!({"input": [{"type": "text", "text": "old input"}]}),
        ),
        routing_decision(2, "turn-1", "provider<&", "model-a>"),
        turn_event(3, "turn-1", "turn.completed", json!({})),
    ]);
    stored.turn_runtime_options.insert(
        "turn-2".to_string(),
        route_options("provider-b>", "model<&b"),
    );

    let history = provider_history_excluding_current_turn_input(&stored, None, "turn-2")
        .expect("provider history");

    assert_eq!(history.len(), 2);
    assert_eq!(history[0].role, CurrentProviderRole::User);
    assert_eq!(history[1].role, CurrentProviderRole::Developer);
    let text = message_text(&history[1]);
    assert!(text.starts_with("<model_switch>\nThe user was previously using a different model."));
    assert!(text.contains("<provider>provider&lt;&amp;</provider>"));
    assert!(text.contains("<model>model-a&gt;</model>"));
    assert!(text.contains("<provider>provider-b&gt;</provider>"));
    assert!(text.contains("<model>model&lt;&amp;b</model>"));
    assert!(text.ends_with("</model_switch>"));
}

#[test]
fn same_route_does_not_inject_for_effort_or_service_tier_changes() {
    let mut stored = stored_with_events(vec![
        routing_decision(1, "turn-1", "provider-a", "model-a"),
        turn_event(2, "turn-1", "turn.completed", json!({})),
    ]);
    let mut options = route_options("provider-a", "model-a");
    let request = options.runtime_request_mut();
    request.reasoning_effort = Some("high".to_string());
    request.service_tier = Some("fast".to_string());
    stored
        .turn_runtime_options
        .insert("turn-2".to_string(), options);

    let history = provider_history_excluding_current_turn_input(&stored, None, "turn-2")
        .expect("provider history");

    assert!(history.is_empty());
}

#[test]
fn failed_turn_route_never_becomes_previous_model_truth() {
    let mut stored = stored_with_events(vec![
        routing_decision(1, "turn-1", "provider-a", "model-a"),
        turn_event(2, "turn-1", "turn.completed", json!({})),
        routing_decision(3, "turn-2", "provider-b", "model-b"),
        turn_event(4, "turn-2", "turn.failed", json!({})),
    ]);
    stored
        .turn_runtime_options
        .insert("turn-3".to_string(), route_options("provider-a", "model-a"));

    let history = provider_history_excluding_current_turn_input(&stored, None, "turn-3")
        .expect("provider history");

    assert!(history.is_empty());
}

#[test]
fn typed_history_retargets_model_switch_for_each_actual_route_attempt() {
    let stored = stored_with_events(vec![
        routing_decision(1, "turn-1", "provider-a", "model-a"),
        turn_event(2, "turn-1", "turn.completed", json!({})),
    ]);
    let history = provider_turn_history_excluding_current_turn_input(&stored, None, "turn-2")
        .expect("typed provider history");

    assert!(history
        .messages_for_route("provider-a", "model-a")
        .is_empty());
    let rerouted = history.messages_for_route("provider-b", "model-b");
    assert_eq!(rerouted.len(), 1);
    let text = message_text(&rerouted[0]);
    assert!(text.contains("<previous_route>"));
    assert!(text.contains("<provider>provider-a</provider>"));
    assert!(text.contains("<current_route>"));
    assert!(text.contains("<provider>provider-b</provider>"));
    assert!(text.contains("<model>model-b</model>"));
}

#[test]
fn model_switch_context_is_not_repeated_after_switched_turn_completes() {
    let mut stored = stored_with_events(vec![
        routing_decision(1, "turn-1", "provider-a", "model-a"),
        turn_event(2, "turn-1", "turn.completed", json!({})),
    ]);
    stored
        .turn_runtime_options
        .insert("turn-2".to_string(), route_options("provider-b", "model-b"));
    assert_eq!(
        provider_history_excluding_current_turn_input(&stored, None, "turn-2")
            .expect("switch history")
            .len(),
        1
    );

    stored
        .events
        .push(routing_decision(3, "turn-2", "provider-b", "model-b"));
    stored
        .events
        .push(turn_event(4, "turn-2", "turn.completed", json!({})));
    stored
        .turn_runtime_options
        .insert("turn-3".to_string(), route_options("provider-b", "model-b"));

    let history = provider_history_excluding_current_turn_input(&stored, None, "turn-3")
        .expect("post-switch history");
    assert!(history.is_empty());
}

#[test]
fn first_turn_without_completed_route_does_not_inject_model_switch_context() {
    let mut stored = stored_with_events(Vec::new());
    stored
        .turn_runtime_options
        .insert("turn-1".to_string(), route_options("provider-a", "model-a"));

    let history = provider_history_excluding_current_turn_input(&stored, None, "turn-1")
        .expect("first turn history");

    assert!(history.is_empty());
}

fn canonical_tool_event(
    sequence: u64,
    event_type: &str,
    status: ItemStatus,
    call_id: &str,
    name: &str,
    arguments: Value,
    output: Option<ToolOutput>,
) -> AgentEvent {
    let arguments = arguments
        .as_object()
        .expect("canonical tool arguments object")
        .iter()
        .map(|(name, value)| ToolArgument {
            name: name.clone(),
            value: value
                .as_str()
                .map(str::to_string)
                .unwrap_or_else(|| value.to_string()),
        })
        .collect();
    let item = ThreadItem {
        session_id: SessionId::new("session-1"),
        thread_id: ThreadId::new("thread-1"),
        turn_id: TurnId::new("turn-1"),
        item_id: ItemId::new(call_id),
        sequence,
        ordinal: 1,
        created_at_ms: 1,
        updated_at_ms: 2,
        completed_at_ms: status.is_terminal().then_some(2),
        kind: ItemKind::Tool,
        status,
        payload: ThreadItemPayload::Tool {
            call_id: call_id.to_string(),
            name: name.to_string(),
            arguments,
            output,
        },
        metadata: Value::Null,
    };
    event(sequence, event_type, json!({ "item": item }))
}

fn canonical_review_boundary_event(sequence: u64, name: &str) -> AgentEvent {
    let item = ThreadItem {
        session_id: SessionId::new("session-1"),
        thread_id: ThreadId::new("thread-1"),
        turn_id: TurnId::new("turn-1"),
        item_id: ItemId::new(format!("review-{name}")),
        sequence,
        ordinal: 1,
        created_at_ms: 1,
        updated_at_ms: 2,
        completed_at_ms: Some(2),
        kind: ItemKind::Extension,
        status: ItemStatus::Completed,
        payload: ThreadItemPayload::Extension {
            name: name.to_string(),
            data: json!({"review": "fixture review"}),
        },
        metadata: Value::Null,
    };
    event(
        sequence,
        crate::runtime::thread_fork::FORK_CANONICAL_ITEM_EVENT_TYPE,
        json!({ "item": item }),
    )
}

#[test]
fn canonical_history_preserves_tool_call_result_and_order() {
    let arguments = json!({ "path": "README.md" });
    let messages = messages_from_events(&[
        event(
            1,
            "message.created",
            json!({ "input": [{ "type": "text", "text": "read it" }] }),
        ),
        canonical_tool_event(
            2,
            "item.started",
            ItemStatus::InProgress,
            "call-read",
            "Read",
            arguments.clone(),
            None,
        ),
        canonical_tool_event(
            3,
            "item.completed",
            ItemStatus::Completed,
            "call-read",
            "Read",
            arguments,
            Some(ToolOutput {
                text: Some("contents".to_string()),
                ..ToolOutput::default()
            }),
        ),
        event(4, "message.delta", json!({ "text": "Done." })),
    ]);

    assert_eq!(messages.len(), 4);
    assert!(matches!(
        &messages[1].content[..],
        [CurrentProviderContent::ToolCall(call)]
            if call.id == "call-read"
                && call.name == "Read"
                && call.arguments == json!({ "path": "README.md" })
    ));
    assert!(matches!(
        &messages[2].content[..],
        [CurrentProviderContent::ToolResult(result)]
            if result.call_id == "call-read" && result.success && result.output == "contents"
    ));
    assert!(matches!(
        &messages[3].content[..],
        [CurrentProviderContent::Text(text)] if text == "Done."
    ));
}

#[test]
fn canonical_history_ignores_review_boundary_extensions() {
    let messages = messages_from_events(&[
        canonical_review_boundary_event(1, "enteredReviewMode"),
        event(2, "message.delta", json!({"text": "review output"})),
        canonical_review_boundary_event(3, "exitedReviewMode"),
    ]);

    assert_eq!(messages.len(), 1);
    assert!(matches!(
        &messages[0].content[..],
        [CurrentProviderContent::Text(text)] if text == "review output"
    ));
}

#[test]
fn canonical_history_preserves_failed_tool_result() {
    let messages = messages_from_events(&[canonical_tool_event(
        1,
        "item.completed",
        ItemStatus::Failed,
        "call-failed",
        "Read",
        json!({ "path": "missing.md" }),
        Some(ToolOutput {
            text: Some("read failed".to_string()),
            error: Some("not found".to_string()),
            ..ToolOutput::default()
        }),
    )]);

    assert!(matches!(
        &messages[0].content[..],
        [CurrentProviderContent::ToolResult(result)]
            if result.call_id == "call-failed"
                && !result.success
                && result.output == "read failed"
                && result.error.as_deref() == Some("not found")
    ));
}

#[test]
fn canonical_history_merges_completed_full_text_without_duplicate_delta() {
    let messages = messages_from_events(&[
        event(
            1,
            "message.delta",
            json!({"itemId": "agent-1", "text": "Hello "}),
        ),
        event(
            2,
            "message.completed",
            json!({"itemId": "agent-1", "text": "Hello world", "status": "completed"}),
        ),
    ]);

    assert_eq!(messages.len(), 1);
    let text = messages[0]
        .content
        .iter()
        .filter_map(|content| match content {
            CurrentProviderContent::Text(text) => Some(text.as_str()),
            _ => None,
        })
        .collect::<String>();
    assert_eq!(text, "Hello world");
}

#[test]
fn canonical_history_reads_message_delta_batch_parts() {
    let messages = messages_from_events(&[event(
        1,
        "message.delta_batch",
        json!({
            "itemId": "agent-1",
            "deltas": [
                {"text": "batched "},
                {"delta": "answer"}
            ]
        }),
    )]);

    assert!(matches!(
        &messages[0].content[..],
        [CurrentProviderContent::Text(text)] if text == "batched answer"
    ));
}

#[test]
fn canonical_history_deduplicates_turn_wide_completed_snapshot() {
    let messages = messages_from_events(&[
        event(
            1,
            "message.delta",
            json!({"itemId": "commentary-1", "text": "inspect "}),
        ),
        event(
            2,
            "message.delta",
            json!({"itemId": "final-1", "text": "done"}),
        ),
        event(
            3,
            "message.completed",
            json!({"itemId": "final-1", "text": "inspect done", "status": "completed"}),
        ),
    ]);

    let text = messages[0]
        .content
        .iter()
        .filter_map(|content| match content {
            CurrentProviderContent::Text(text) => Some(text.as_str()),
            _ => None,
        })
        .collect::<String>();
    assert_eq!(text, "inspect done");
}

#[test]
fn canonical_history_prefers_bounded_preview_over_persisted_output_ref() {
    let messages = messages_from_events(&[canonical_tool_event(
        1,
        "item.completed",
        ItemStatus::Completed,
        "call-large",
        "Read",
        json!({ "path": "large.txt" }),
        Some(ToolOutput {
            text: Some("preview".to_string()),
            truncated: true,
            output_ref: Some("output://large".to_string()),
            ..ToolOutput::default()
        }),
    )]);

    assert!(matches!(
        &messages[0].content[..],
        [CurrentProviderContent::ToolResult(result)]
            if result.call_id == "call-large" && result.output == "preview"
    ));
}

#[test]
fn canonical_history_keeps_inline_output_for_model_specific_sampling() {
    let original = "x".repeat(20_000);
    let messages = messages_from_events(&[canonical_tool_event(
        1,
        "item.completed",
        ItemStatus::Completed,
        "call-inline",
        "Read",
        json!({ "path": "large.txt" }),
        Some(ToolOutput {
            text: Some(original.clone()),
            ..ToolOutput::default()
        }),
    )]);

    let CurrentProviderContent::ToolResult(result) = &messages[0].content[0] else {
        panic!("expected tool result");
    };
    assert_eq!(result.output, original);
}

#[test]
fn canonical_history_ignores_outer_event_output_ref() {
    let mut event = canonical_tool_event(
        1,
        "item.completed",
        ItemStatus::Completed,
        "call-large",
        "Read",
        json!({ "path": "large.txt" }),
        Some(ToolOutput {
            text: Some("preview".to_string()),
            ..ToolOutput::default()
        }),
    );
    event.payload["outputRef"] = json!("output://outer");

    let messages = messages_from_events(&[event]);

    assert!(matches!(
        &messages[0].content[..],
        [CurrentProviderContent::ToolResult(result)] if result.output == "preview"
    ));
}

#[test]
fn raw_tool_events_do_not_enter_provider_history() {
    let messages = messages_from_events(&[
        event(
            1,
            "message.created",
            json!({ "input": [{ "type": "text", "text": "read it" }] }),
        ),
        event(
            2,
            "reasoning.delta",
            json!({ "runtimeEvent": { "text": "inspect" } }),
        ),
        event(
            3,
            "message.delta",
            json!({ "runtimeEvent": { "text": "I will read it." } }),
        ),
        event(
            4,
            "tool.started",
            json!({ "runtimeEvent": { "tool_id": "call-read", "tool_name": "Read", "arguments": "{\"path\":\"README.md\"}" } }),
        ),
        event(
            5,
            "tool.result",
            json!({ "runtimeEvent": { "tool_id": "call-read", "tool_name": "Read", "result": { "success": true, "output": "contents" } } }),
        ),
        event(
            6,
            "tool.failed",
            json!({ "toolId": "call-failed", "toolName": "Read", "error": "failed" }),
        ),
        event(
            7,
            "tool.completed",
            json!({ "toolId": "call-completed", "toolName": "Read", "output": "done" }),
        ),
        event(
            8,
            "message.delta",
            json!({ "runtimeEvent": { "text": "Done." } }),
        ),
    ]);

    assert_eq!(messages.len(), 2);
    assert!(matches!(
        &messages[0].content[..],
        [CurrentProviderContent::Text(text)] if text == "read it"
    ));
    assert!(matches!(
        &messages[1].content[..],
        [CurrentProviderContent::Reasoning(reasoning), CurrentProviderContent::Text(before), CurrentProviderContent::Text(after)]
            if reasoning == "inspect" && before == "I will read it." && after == "Done."
    ));
}

#[test]
fn inline_image_input_is_preserved_for_current_provider() {
    let root = tempfile::tempdir().expect("sidecar root");
    let store = super::super::sidecar_store::SidecarStore::new(root.path()).expect("sidecar store");
    let input = vec![
            AgentInput::text("describe it"),
            AgentInput::Image {
                uri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==".to_string(),
                detail: Some(ImageDetail::High),
            },
        ];
    let reply = RuntimeReplyInput::try_from_user_parts(input, |media| {
        super::super::input_media::resolve_runtime_input_media(media, Some(&store), "session-1")
    })
    .expect("provider input");
    let images = reply.images().collect::<Vec<_>>();
    assert_eq!(images.len(), 1);
    assert!(images[0].uri.starts_with("sidecar://media/"));
    assert_eq!(images[0].media_type, "image/png");
    assert_eq!(
            images[0].provider_data.as_deref(),
            Some("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==")
        );
    assert_eq!(images[0].detail, Some(ImageDetail::High));
}

#[test]
fn persisted_image_history_is_hydrated_without_rewriting_canonical_reference() {
    const PNG_DATA_URL: &str = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
    let root = tempfile::tempdir().expect("sidecar root");
    let store = super::super::sidecar_store::SidecarStore::new(root.path()).expect("sidecar store");
    let input = super::super::input_media::prepare_runtime_input(
        vec![
            AgentInput::text("describe it"),
            AgentInput::Image {
                uri: PNG_DATA_URL.to_string(),
                detail: None,
            },
        ],
        Some(&store),
        "session-1",
    )
    .expect("prepare durable image input")
    .durable;
    assert!(!serde_json::to_string(&input)
        .expect("serialize durable image input")
        .contains("base64,"));
    let messages = messages_from_events_with_provider_input(
        &[event(1, "message.created", json!({ "input": input }))],
        |input| {
            RuntimeReplyInput::try_from_user_parts(input, |media| {
                super::super::input_media::resolve_runtime_input_media(
                    media,
                    Some(&store),
                    "session-1",
                )
            })
            .map_err(|error| error.to_string())
        },
    )
    .expect("provider history");

    assert!(matches!(
        &messages[0].content[..],
        [CurrentProviderContent::Text(text), CurrentProviderContent::Image {
            uri,
            media_type,
            provider_data: Some(provider_data),
            detail: None,
        }] if text == "describe it"
            && uri.starts_with("sidecar://media/")
            && media_type == "image/png"
            && provider_data == PNG_DATA_URL
    ));
}
