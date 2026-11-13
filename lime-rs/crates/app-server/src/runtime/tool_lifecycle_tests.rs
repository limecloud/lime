use super::*;
use serde_json::json;

fn event(event_id: &str, event_type: &str, payload: Value) -> AgentEvent {
    let payload = if matches!(
        event_type,
        "item.started" | "item.updated" | "item.completed"
    ) {
        canonical_tool_item_payload(event_type, payload)
    } else {
        payload
    };
    AgentEvent {
        event_id: event_id.to_string(),
        sequence: 1,
        session_id: "sess_test".to_string(),
        thread_id: Some("thread_test".to_string()),
        turn_id: Some("turn_test".to_string()),
        event_type: event_type.to_string(),
        timestamp: "2026-06-13T00:00:00.000Z".to_string(),
        payload,
    }
}

fn canonical_tool_item_payload(event_type: &str, payload: Value) -> Value {
    if payload.get("item").is_some() {
        return payload;
    }
    let call_id = payload
        .get("toolCallId")
        .and_then(Value::as_str)
        .unwrap_or("tool_1");
    let name = payload
        .get("toolName")
        .and_then(Value::as_str)
        .unwrap_or("Bash");
    let owner = payload
        .get("itemId")
        .or_else(|| payload.get("messageId"))
        .or_else(|| payload.get("assistantMessageId"))
        .and_then(Value::as_str)
        .unwrap_or(call_id);
    let item_id = if owner.starts_with("item_") {
        owner.to_string()
    } else {
        format!("item_{owner}")
    };
    let arguments = payload
        .get("arguments")
        .and_then(Value::as_object)
        .map(|arguments| {
            arguments
                .iter()
                .map(|(name, value)| {
                    json!({
                        "name": name,
                        "value": value.to_string(),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let failed = payload.get("failureCategory").is_some()
        || payload.get("error").is_some()
        || payload.get("status").and_then(Value::as_str) == Some("failed");
    let status = match event_type {
        "item.started" | "item.updated" => "inProgress",
        _ if failed => "failed",
        _ => "completed",
    };
    let output = (event_type != "item.started").then(|| {
        json!({
            "text": payload.get("output").and_then(Value::as_str),
            "error": payload.get("error").and_then(Value::as_str),
        })
    });
    json!({
        "item": {
            "sessionId": "sess_test",
            "threadId": "thread_test",
            "turnId": "turn_test",
            "itemId": item_id,
            "sequence": 1,
            "ordinal": 1,
            "createdAtMs": 1,
            "updatedAtMs": 1,
            "completedAtMs": (event_type == "item.completed").then_some(1),
            "kind": "tool",
            "status": status,
            "payload": {
                "type": "tool",
                "call_id": call_id,
                "name": name,
                "arguments": arguments,
                "output": output,
            },
            "metadata": {},
        }
    })
}

#[test]
fn rejects_policy_event_for_inactive_tool() {
    let existing = vec![
        event(
            "evt_start",
            "item.started",
            json!({ "toolCallId": "tool_1" }),
        ),
        event(
            "evt_result",
            "item.completed",
            json!({ "toolCallId": "tool_1" }),
        ),
    ];
    let candidate = event(
        "evt_sandbox",
        "sandbox.blocked",
        json!({ "toolCallId": "tool_1", "reasonCode": "sandbox_denied" }),
    );

    let error = validate_tool_lifecycle_event(&existing, &candidate)
        .expect_err("policy event for completed tool should fail");
    assert!(error.contains("tool_policy_event_without_active_tool"));
}

#[test]
fn rejects_tool_output_before_action_resolution() {
    let existing = vec![
        event(
            "evt_start",
            "item.started",
            json!({ "toolCallId": "tool_1" }),
        ),
        event(
            "evt_action",
            "action.required",
            json!({
                "actionId": "action_1",
                "toolCallId": "tool_1"
            }),
        ),
    ];
    let candidate = event(
        "evt_output",
        "tool.output.delta",
        json!({ "toolCallId": "tool_1", "delta": "running" }),
    );

    let error = validate_tool_lifecycle_event(&existing, &candidate)
        .expect_err("tool output before approval should fail");
    assert!(error.contains("tool_output_before_action_resolved"));
}

#[test]
fn accepts_unified_exec_output_for_canonical_command_item() {
    let existing = vec![event(
        "evt_start",
        "item.started",
        json!({
            "item": {
                "sessionId": "sess_test",
                "threadId": "thread_test",
                "turnId": "turn_test",
                "itemId": "exec-call-1",
                "sequence": 1,
                "ordinal": 1,
                "createdAtMs": 1,
                "updatedAtMs": 1,
                "kind": "command",
                "status": "inProgress",
                "payload": {
                    "type": "command",
                    "command": "printf hello"
                },
                "metadata": {
                    "exec_command_call_id": "exec-call-1",
                    "executionSurface": "unified_exec"
                }
            }
        }),
    )];
    let candidate = event(
        "evt_output",
        "tool.output.delta",
        json!({
            "toolCallId": "exec-call-1",
            "delta": "hello",
            "outputKind": "stdout"
        }),
    );

    validate_tool_lifecycle_event(&existing, &candidate)
        .expect("unified exec output should match canonical command start");

    let mut validator =
        ToolLifecycleValidator::from_events(&existing, "sess_test", Some("turn_test"));
    validator.validate_and_observe(&candidate).unwrap();
    let wrong_call = event(
        "evt_unrelated_output",
        "tool.output.delta",
        json!({"toolCallId": "other-call", "delta": "unrelated"}),
    );
    assert!(validator
        .validate_and_observe(&wrong_call)
        .unwrap_err()
        .contains("tool_output_without_start"));

    let mut terminal = existing[0].clone();
    terminal.event_id = "evt_terminal".to_string();
    terminal.event_type = "item.completed".to_string();
    terminal.payload["item"]["status"] = json!("completed");
    terminal.payload["item"]["payload"]["output"] = json!("hello");
    terminal.payload["item"]["payload"]["exit_code"] = json!(0);
    validator
        .validate_and_observe(&terminal)
        .expect("the same raw command identity must complete");
    assert!(validator
        .validate_and_observe(&candidate)
        .unwrap_err()
        .contains("tool_output_without_start"));
}

#[test]
fn allows_tool_result_after_action_resolution() {
    let existing = vec![
        event(
            "evt_start",
            "item.started",
            json!({ "toolCallId": "tool_1" }),
        ),
        event(
            "evt_action",
            "action.required",
            json!({
                "actionId": "action_1",
                "toolCallId": "tool_1"
            }),
        ),
        event(
            "evt_action_resolved",
            "action.resolved",
            json!({
                "actionId": "action_1",
                "toolCallId": "tool_1",
                "decision": "approve"
            }),
        ),
    ];
    let candidate = event(
        "evt_result",
        "item.completed",
        json!({ "toolCallId": "tool_1", "output": "ok" }),
    );

    validate_tool_lifecycle_event(&existing, &candidate).expect("approved tool result should pass");
}

#[test]
fn rejects_tool_result_after_action_denial() {
    let existing = vec![
        event(
            "evt_start",
            "item.started",
            json!({ "toolCallId": "tool_1" }),
        ),
        event(
            "evt_action",
            "action.required",
            json!({
                "actionId": "action_1",
                "toolCallId": "tool_1"
            }),
        ),
        event(
            "evt_action_denied",
            "action.canceled",
            json!({
                "actionId": "action_1",
                "toolCallId": "tool_1"
            }),
        ),
    ];
    let candidate = event(
        "evt_result",
        "item.completed",
        json!({ "toolCallId": "tool_1", "output": "should not run" }),
    );

    let error = validate_tool_lifecycle_event(&existing, &candidate)
        .expect_err("denied tool result should fail");
    assert!(error.contains("tool_result_after_action_denied"));
}

#[test]
fn decline_blocks_completed_tool_result_but_allows_failed_terminal() {
    let existing = vec![
        event(
            "evt_start",
            "item.started",
            json!({ "toolCallId": "tool_1" }),
        ),
        event(
            "evt_action",
            "action.required",
            json!({
                "actionId": "action_1",
                "toolCallId": "tool_1"
            }),
        ),
        event(
            "evt_action_declined",
            "action.resolved",
            json!({
                "actionId": "action_1",
                "toolCallId": "tool_1",
                "decision": "decline"
            }),
        ),
    ];
    let completed = event(
        "evt_completed",
        "item.completed",
        json!({ "toolCallId": "tool_1", "output": "must not run" }),
    );
    let failed = event(
        "evt_failed",
        "item.completed",
        json!({
            "toolCallId": "tool_1",
            "failureCategory": "tool_approval_declined"
        }),
    );

    let error = validate_tool_lifecycle_event(&existing, &completed)
        .expect_err("declined approval must reject a completed tool result");
    assert!(error.contains("tool_result_after_action_denied"));
    validate_tool_lifecycle_event(&existing, &failed)
        .expect("declined tool can still close as failed");
}

#[test]
fn rejects_tool_result_after_sandbox_blocked() {
    let existing = vec![
        event(
            "evt_start",
            "item.started",
            json!({ "toolCallId": "tool_1" }),
        ),
        event(
            "evt_sandbox",
            "sandbox.blocked",
            json!({
                "toolCallId": "tool_1",
                "reasonCode": "network_disabled"
            }),
        ),
    ];
    let candidate = event(
        "evt_result",
        "item.completed",
        json!({ "toolCallId": "tool_1", "output": "should not run" }),
    );

    let error = validate_tool_lifecycle_event(&existing, &candidate)
        .expect_err("sandbox blocked tool result should fail");
    assert!(error.contains("tool_result_after_sandbox_blocked"));
}

#[test]
fn rejects_tool_output_after_permission_denied() {
    let existing = vec![
        event(
            "evt_start",
            "item.started",
            json!({ "toolCallId": "tool_1" }),
        ),
        event(
            "evt_permission",
            "permission.denied",
            json!({
                "toolCallId": "tool_1",
                "reasonCode": "host_permission_denied"
            }),
        ),
    ];
    let candidate = event(
        "evt_output",
        "tool.output.delta",
        json!({ "toolCallId": "tool_1", "delta": "should not stream" }),
    );

    let error = validate_tool_lifecycle_event(&existing, &candidate)
        .expect_err("permission denied tool output should fail");
    assert!(error.contains("tool_output_after_permission_denied"));
}

#[test]
fn allows_tool_failed_after_sandbox_blocked() {
    let existing = vec![
        event(
            "evt_start",
            "item.started",
            json!({ "toolCallId": "tool_1" }),
        ),
        event(
            "evt_sandbox",
            "sandbox.blocked",
            json!({
                "toolCallId": "tool_1",
                "reasonCode": "network_disabled"
            }),
        ),
    ];
    let candidate = event(
        "evt_failed",
        "item.completed",
        json!({
            "toolCallId": "tool_1",
            "failureCategory": "sandbox_blocked"
        }),
    );

    validate_tool_lifecycle_event(&existing, &candidate)
        .expect("blocked tool can still close as failed");
}

#[test]
fn allows_tool_result_with_matching_owner() {
    let existing = vec![event(
        "evt_start",
        "item.started",
        json!({
            "toolCallId": "tool_1",
            "messageId": "assistant_1",
            "itemId": "item_1"
        }),
    )];
    let candidate = event(
        "evt_result",
        "item.completed",
        json!({
            "toolCallId": "tool_1",
            "assistantMessageId": "assistant_1",
            "itemId": "item_1",
            "output": "ok"
        }),
    );

    validate_tool_lifecycle_event(&existing, &candidate).expect("matching tool owner should pass");
}

#[test]
fn rejects_tool_result_owner_mismatch() {
    let existing = vec![event(
        "evt_start",
        "item.started",
        json!({
            "toolCallId": "tool_1",
            "messageId": "assistant_1"
        }),
    )];
    let candidate = event(
        "evt_result",
        "item.completed",
        json!({
            "toolCallId": "tool_1",
            "messageId": "assistant_2",
            "output": "wrong owner"
        }),
    );

    let error = validate_tool_lifecycle_event(&existing, &candidate)
        .expect_err("mismatched tool owner should fail");
    assert!(error.contains("tool_event_owner_mismatch"));
}

#[test]
fn allows_tool_terminal_with_canonical_item_owner() {
    let existing = vec![event(
        "evt_start",
        "item.started",
        json!({
            "toolCallId": "tool_1",
            "itemId": "item_1"
        }),
    )];
    let candidate = event(
        "evt_result",
        "item.completed",
        json!({
            "toolCallId": "tool_1",
            "itemId": "item_1",
            "output": "canonical owner"
        }),
    );

    validate_tool_lifecycle_event(&existing, &candidate)
        .expect("canonical item identity should own the terminal event");
}

#[test]
fn rejects_tool_output_owner_mismatch() {
    let existing = vec![event(
        "evt_start",
        "item.started",
        json!({
            "toolCallId": "tool_1",
            "itemId": "item_1"
        }),
    )];
    let candidate = event(
        "evt_output",
        "tool.output.delta",
        json!({
            "toolCallId": "tool_1",
            "itemId": "item_2",
            "delta": "wrong owner"
        }),
    );

    let error = validate_tool_lifecycle_event(&existing, &candidate)
        .expect_err("mismatched output owner should fail");
    assert!(error.contains("tool_event_owner_mismatch"));
}

#[test]
fn normalizes_action_required_with_matching_active_tool() {
    let existing = vec![event(
        "evt_start",
        "item.started",
        json!({
            "toolCallId": "tool_shell",
            "toolName": "Bash",
            "arguments": {
                "command": "npm test"
            }
        }),
    )];

    let normalized = normalize_policy_event_payload(
        &existing,
        Some("turn_test"),
        "action.required",
        json!({
            "requestId": "approval_1",
            "actionType": "tool_confirmation",
            "data": {
                "tool_name": "Bash",
                "arguments": {
                    "command": "npm test"
                }
            }
        }),
    );

    assert_eq!(normalized["actionId"].as_str(), Some("approval_1"));
    assert_eq!(normalized["requestId"].as_str(), Some("approval_1"));
    assert_eq!(normalized["toolCallId"].as_str(), Some("tool_shell"));
    assert_eq!(normalized["actionKind"].as_str(), Some("approve-tool"));
}

#[test]
fn normalizes_action_resolved_from_previous_action_required_tool() {
    let existing = vec![
        event(
            "evt_start",
            "item.started",
            json!({ "toolCallId": "tool_shell", "toolName": "Bash" }),
        ),
        event(
            "evt_action",
            "action.required",
            json!({
                "actionId": "approval_1",
                "requestId": "approval_1",
                "toolCallId": "tool_shell",
                "actionType": "tool_confirmation"
            }),
        ),
    ];

    let normalized = normalize_policy_event_payload(
        &existing,
        Some("turn_test"),
        "action.resolved",
        json!({
            "requestId": "approval_1",
            "actionType": "tool_confirmation",
            "decision": "approve"
        }),
    );
    let candidate = event("evt_resolved", "action.resolved", normalized);

    assert_eq!(candidate.payload["toolCallId"].as_str(), Some("tool_shell"));
    validate_tool_lifecycle_event(&existing, &candidate)
        .expect("resolved action with inferred tool id should pass");
}
