use super::*;
use serde_json::json;

fn event(event_type: &str, payload: Value) -> AgentEvent {
    AgentEvent {
        event_id: format!("evt-{event_type}"),
        sequence: 1,
        session_id: "session-1".to_string(),
        thread_id: Some("thread-1".to_string()),
        turn_id: Some("turn-1".to_string()),
        event_type: event_type.to_string(),
        timestamp: "2026-07-19T00:00:01.000Z".to_string(),
        payload,
    }
}

fn canonical_turn(status: &str) -> Value {
    json!({
        "sessionId": "session-1",
        "threadId": "thread-1",
        "turnId": "turn-1",
        "status": status,
        "createdAtMs": 1,
        "updatedAtMs": 2,
        "startedAtMs": 1,
        "completedAtMs": (status != "inProgress").then_some(2),
        "items": [],
        "itemsView": "full"
    })
}

fn canonical_item(status: &str) -> Value {
    json!({
        "sessionId": "session-1",
        "threadId": "thread-1",
        "turnId": "turn-1",
        "itemId": "item-1",
        "sequence": 1,
        "ordinal": 1,
        "createdAtMs": 1,
        "updatedAtMs": 2,
        "completedAtMs": (status == "completed").then_some(2),
        "kind": "agentMessage",
        "status": status,
        "payload": {"type": "agentMessage", "text": "hello"},
        "metadata": {}
    })
}

fn canonical_plan_item(status: &str) -> Value {
    json!({
        "sessionId": "session-1",
        "threadId": "thread-1",
        "turnId": "turn-1",
        "itemId": "plan_turn-1_proposed_plan:1",
        "sequence": 1,
        "ordinal": 1,
        "createdAtMs": 1,
        "updatedAtMs": 2,
        "completedAtMs": (status == "completed").then_some(2),
        "kind": "plan",
        "status": status,
        "payload": {
            "type": "plan",
            "text": "- [ ] 验证计划通知",
            "revision_id": "proposed_plan:1",
            "source": "proposed_plan",
            "plan": [{"step": "验证计划通知", "status": "pending"}]
        },
        "metadata": {}
    })
}

fn canonical_reasoning_item(status: &str, summary: Vec<&str>, content: Vec<&str>) -> Value {
    json!({
        "sessionId": "session-1",
        "threadId": "thread-1",
        "turnId": "turn-1",
        "itemId": "reasoning-1",
        "sequence": 1,
        "ordinal": 1,
        "createdAtMs": 1,
        "updatedAtMs": 2,
        "completedAtMs": (status == "completed").then_some(2),
        "kind": "reasoning",
        "status": status,
        "payload": {
            "type": "reasoning",
            "summary": summary,
            "content": content
        },
        "metadata": {}
    })
}

fn canonical_command_item(status: &str) -> Value {
    json!({
        "sessionId": "session-1",
        "threadId": "thread-1",
        "turnId": "turn-1",
        "itemId": "shell-1",
        "sequence": 1,
        "ordinal": 1,
        "createdAtMs": 1,
        "updatedAtMs": 2,
        "completedAtMs": (status == "completed").then_some(2),
        "kind": "command",
        "status": status,
        "payload": {
            "type": "command",
            "command": "printf ready",
            "cwd": "/workspace",
            "output": (status == "completed").then_some("ready"),
            "exitCode": (status == "completed").then_some(0)
        },
        "metadata": {
            "commandExecutionSource": "userShell",
            "processId": "process-1",
            "durationMs": 42
        }
    })
}

fn canonical_file_change_item(status: &str) -> Value {
    let file_status = match status {
        "inProgress" => "proposed",
        "completed" => "applied",
        "declined" => "rejected",
        "failed" => "failed",
        _ => status,
    };
    json!({
        "sessionId": "session-1",
        "threadId": "thread-1",
        "turnId": "turn-1",
        "itemId": "item_patch-1",
        "sequence": 1,
        "ordinal": 1,
        "createdAtMs": 1,
        "updatedAtMs": 2,
        "completedAtMs": (status != "inProgress").then_some(2),
        "kind": "file",
        "status": if status == "inProgress" { "inProgress" } else { "completed" },
        "payload": {
            "type": "file",
            "changes": [
                {
                    "path": "src/lib.rs",
                    "kind": { "type": "update", "move_path": "src/main.rs" },
                    "diff": "-old\n+new"
                }
            ],
            "status": file_status
        },
        "metadata": {}
    })
}

fn canonical_thread() -> Value {
    json!({
        "sessionId": "session-1",
        "threadId": "thread-1",
        "status": {"type": "idle"},
        "createdAtMs": 1,
        "updatedAtMs": 2,
        "archived": false,
        "preview": "hello",
        "modelProvider": "openai",
        "metadata": {},
        "turns": [],
        "turnsView": "full"
    })
}

#[path = "model_tests.rs"]
mod model;
#[path = "reasoning_tests.rs"]
mod reasoning;

#[test]
fn maps_thread_started_to_the_direct_v2_shape() {
    let mut projector = V2NotificationProjector::default();
    let notifications = projector
        .project(event(
            "thread.started",
            json!({"thread": canonical_thread()}),
        ))
        .expect("thread started");

    assert_eq!(notifications[0].method, "thread/started");
    assert_eq!(
        notifications[0].params.as_ref().expect("params")["thread"]["id"],
        "thread-1"
    );
}

#[test]
fn accepted_is_internal_and_started_emits_status_before_turn_started() {
    let mut projector = V2NotificationProjector::default();
    let accepted = projector
        .project(event(
            "turn.accepted",
            json!({"turn": canonical_turn("inProgress")}),
        ))
        .expect("accepted turn");
    let duplicate = projector
        .project(event(
            "turn.started",
            json!({"turn": canonical_turn("inProgress")}),
        ))
        .expect("started turn");

    assert!(accepted.is_empty());
    assert_eq!(duplicate.len(), 2);
    assert_eq!(duplicate[0].method, "thread/status/changed");
    assert_eq!(
        duplicate[0].params.as_ref().expect("status params")["status"],
        json!({"type": "active", "activeFlags": []})
    );
    assert_eq!(duplicate[1].method, "turn/started");
}

#[test]
fn maps_item_and_terminal_lifecycle_to_direct_v2() {
    let cases = [
        (
            "turn.completed",
            json!({"turn": canonical_turn("completed")}),
            vec!["turn/completed"],
        ),
        (
            "turn.failed",
            json!({
                "message": "provider failed",
                "turn": canonical_turn("failed")
            }),
            vec!["error", "turn/completed"],
        ),
        (
            "turn.canceled",
            json!({"turn": canonical_turn("interrupted")}),
            vec!["turn/completed"],
        ),
        (
            "item.started",
            json!({"item": canonical_item("inProgress")}),
            vec!["item/started"],
        ),
        (
            "item.completed",
            json!({"item": canonical_item("completed")}),
            vec!["item/completed"],
        ),
    ];
    for (event_type, payload, methods) in cases {
        let mut projector = V2NotificationProjector::default();
        let notifications = projector
            .project(event(event_type, payload))
            .expect("direct lifecycle");
        assert_eq!(
            notifications
                .iter()
                .map(|notification| notification.method.as_str())
                .collect::<Vec<_>>(),
            methods
        );
    }
}

#[test]
fn maps_plan_to_one_started_typed_deltas_and_one_completed_notification() {
    let mut projector = V2NotificationProjector::default();
    let first = projector
        .project(event(
            "plan.delta",
            json!({
                "delta": "- [ ] 读协议",
                "item": canonical_plan_item("inProgress")
            }),
        ))
        .expect("first plan delta");
    let second = projector
        .project(event(
            "plan.delta",
            json!({
                "delta": "\n- [ ] 接 GUI",
                "item": canonical_plan_item("inProgress")
            }),
        ))
        .expect("second plan delta");
    let completed = projector
        .project(event(
            "plan.final",
            json!({"item": canonical_plan_item("completed")}),
        ))
        .expect("plan completed");

    assert_eq!(
        first
            .iter()
            .map(|notification| notification.method.as_str())
            .collect::<Vec<_>>(),
        vec!["item/started", "item/plan/delta"]
    );
    assert_eq!(second[0].method, "item/plan/delta");
    assert_eq!(
        second[0].params.as_ref().expect("delta params")["delta"],
        "\n- [ ] 接 GUI"
    );
    assert_eq!(completed.len(), 1);
    assert_eq!(completed[0].method, "item/completed");
}

#[test]
fn rejects_plan_delta_after_completed_item() {
    let mut projector = V2NotificationProjector::default();
    projector
        .project(event(
            "plan.final",
            json!({"item": canonical_plan_item("completed")}),
        ))
        .expect("plan completed");

    let error = projector
        .project(event(
            "plan.delta",
            json!({
                "delta": "late",
                "item": canonical_plan_item("inProgress")
            }),
        ))
        .expect_err("late plan delta must fail closed");
    assert_eq!(error.code, error_codes::RUNTIME_ERROR);
    assert!(error.message.contains("plan.delta"));
}

#[test]
fn maps_command_lifecycle_to_direct_v2_item_notifications() {
    let mut projector = V2NotificationProjector::default();
    let started = projector
        .project(event(
            "command.started",
            json!({"item": canonical_command_item("inProgress")}),
        ))
        .expect("command started");
    let completed = projector
        .project(event(
            "command.exited",
            json!({"item": canonical_command_item("completed")}),
        ))
        .expect("command exited");

    assert_eq!(started[0].method, "item/started");
    assert_eq!(completed[0].method, "item/completed");
    assert_eq!(
        completed[0].params.as_ref().expect("completed params")["item"]["source"],
        "userShell"
    );
}

#[test]
fn maps_command_output_to_typed_delta_between_item_lifecycle_events() {
    let mut projector = V2NotificationProjector::default();
    assert!(
        projector
            .project(event(
                "command.output",
                json!({
                    "commandId": "shell-1",
                    "delta": "stdout\n",
                    "item": canonical_command_item("inProgress")
                }),
            ))
            .is_err(),
        "output before start must fail closed"
    );

    projector
        .project(event(
            "command.started",
            json!({"item": canonical_command_item("inProgress")}),
        ))
        .expect("command started");
    let output = projector
        .project(event(
            "command.output",
            json!({
                "commandId": "shell-1",
                "delta": "stdout\n",
                "item": canonical_command_item("inProgress")
            }),
        ))
        .expect("command output");
    assert_eq!(output.len(), 1);
    assert_eq!(output[0].method, "item/commandExecution/outputDelta");
    assert_eq!(
        output[0].params.as_ref().expect("output params"),
        &json!({
            "threadId": "thread-1",
            "turnId": "turn-1",
            "itemId": "shell-1",
            "delta": "stdout\n"
        })
    );

    projector
        .project(event(
            "command.exited",
            json!({"item": canonical_command_item("completed")}),
        ))
        .expect("command exited");
    assert!(
        projector
            .project(event(
                "command.output",
                json!({
                    "commandId": "shell-1",
                    "delta": "late",
                    "item": canonical_command_item("inProgress")
                }),
            ))
            .is_err(),
        "late command output must fail closed"
    );
}

#[test]
fn maps_terminal_interaction_to_typed_notification_for_active_command() {
    let mut projector = V2NotificationProjector::default();
    projector
        .project(event(
            "command.started",
            json!({"item": canonical_command_item("inProgress")}),
        ))
        .expect("command started");

    let interaction = projector
        .project(event(
            "command.interaction",
            json!({
                "commandId": "shell-1",
                "processId": "process-1",
                "stdin": "sent 8 chars"
            }),
        ))
        .expect("terminal interaction");

    assert_eq!(interaction.len(), 1);
    assert_eq!(
        interaction[0].method,
        "item/commandExecution/terminalInteraction"
    );
    assert_eq!(
        interaction[0].params.as_ref().expect("interaction params"),
        &json!({
            "threadId": "thread-1",
            "turnId": "turn-1",
            "itemId": "shell-1",
            "processId": "process-1",
            "stdin": "sent 8 chars"
        })
    );
}

#[test]
fn maps_file_change_to_started_patch_updated_and_completed() {
    let mut projector = V2NotificationProjector::default();
    let started = projector
        .project(event(
            "patch.started",
            json!({
                "patchId": "patch-1",
                "item": canonical_file_change_item("inProgress")
            }),
        ))
        .expect("file change started");
    let completed = projector
        .project(event(
            "patch.applied",
            json!({
                "patchId": "patch-1",
                "item": canonical_file_change_item("completed")
            }),
        ))
        .expect("file change completed");

    assert_eq!(
        started
            .iter()
            .map(|notification| notification.method.as_str())
            .collect::<Vec<_>>(),
        vec!["item/started", "item/fileChange/patchUpdated"]
    );
    assert_eq!(
        started[1].params.as_ref().expect("patch params"),
        &json!({
            "threadId": "thread-1",
            "turnId": "turn-1",
            "itemId": "item_patch-1",
            "changes": [{
                "path": "src/lib.rs",
                "kind": { "type": "update", "move_path": "src/main.rs" },
                "diff": "-old\n+new"
            }]
        })
    );
    assert_eq!(completed.len(), 1);
    assert_eq!(completed[0].method, "item/completed");
    assert_eq!(
        completed[0].params.as_ref().expect("completed params")["item"]["id"],
        "item_patch-1"
    );
}

#[test]
fn file_change_lifecycle_fails_closed_outside_started_terminal_order() {
    let mut projector = V2NotificationProjector::default();
    let terminal_before_start = projector.project(event(
        "patch.failed",
        json!({"item": canonical_file_change_item("failed")}),
    ));
    assert!(terminal_before_start.is_err());

    projector
        .project(event(
            "patch.started",
            json!({"item": canonical_file_change_item("inProgress")}),
        ))
        .expect("file change started");
    assert!(projector
        .project(event(
            "patch.started",
            json!({"item": canonical_file_change_item("inProgress")}),
        ))
        .is_err());
    projector
        .project(event(
            "patch.declined",
            json!({"item": canonical_file_change_item("declined")}),
        ))
        .expect("file change declined");
    assert!(projector
        .project(event(
            "patch.applied",
            json!({"item": canonical_file_change_item("completed")}),
        ))
        .is_err());
}

#[test]
fn file_change_with_empty_snapshot_does_not_invent_patch_update() {
    let mut item = canonical_file_change_item("inProgress");
    item["payload"]["changes"] = json!([]);
    let mut projector = V2NotificationProjector::default();

    let notifications = projector
        .project(event("patch.started", json!({"item": item})))
        .expect("empty file change snapshot");

    assert_eq!(notifications.len(), 1);
    assert_eq!(notifications[0].method, "item/started");
}

#[test]
fn delta_accepts_the_real_outer_item_identity_shape() {
    let mut projector = V2NotificationProjector::default();
    let notifications = projector
        .project(event(
            "message.delta",
            json!({"itemId": "item-1", "text": "hello"}),
        ))
        .expect("direct delta");

    assert_eq!(notifications[0].method, "item/agentMessage/delta");
    let params = notifications[0].params.as_ref().expect("delta params");
    assert_eq!(params["itemId"], "item-1");
    assert_eq!(params["delta"], "hello");
}

#[test]
fn delta_compares_outer_identity_after_canonical_item_normalization() {
    let mut item = canonical_item("inProgress");
    item["itemId"] = json!("item_assistant-1");
    let mut projector = V2NotificationProjector::default();
    let notifications = projector
        .project(event(
            "message.delta",
            json!({
                "itemId": "assistant-1",
                "item": item,
                "text": "hello"
            }),
        ))
        .expect("canonicalized direct delta");

    let params = notifications[0].params.as_ref().expect("delta params");
    assert_eq!(params["itemId"], "item_assistant-1");
    assert_eq!(params["delta"], "hello");
}

#[test]
fn delta_rejects_real_outer_and_canonical_item_identity_drift() {
    let mut item = canonical_item("inProgress");
    item["itemId"] = json!("item_assistant-1");
    let mut projector = V2NotificationProjector::default();
    let error = projector
        .project(event(
            "message.delta",
            json!({
                "itemId": "assistant-2",
                "item": item,
                "text": "hello"
            }),
        ))
        .expect_err("identity drift must fail closed");

    assert_eq!(error.code, error_codes::RUNTIME_ERROR);
    assert!(error.message.contains("message.delta"));
}

#[test]
fn explicit_side_channels_keep_the_deprecated_envelope() {
    for event_type in [
        "message.created",
        "provider.request.started",
        "provider.first_event.received",
        "provider.first_text_delta.received",
        "provider.failed",
        "provider.canceled",
        "image_task.created",
        "image_task.create_failed",
        "image_task.parameters.required",
        "image_task_parameters_required",
        "image_task.presentation.generated",
        "runtime.status",
    ] {
        let notifications = V2NotificationProjector::default()
            .project(event(event_type, json!({})))
            .expect("side channel");
        assert_eq!(notifications[0].method, "agentSession/event");
    }
}

#[test]
fn queue_promotion_projects_exact_thread_queue_changed_notification() {
    let notifications = V2NotificationProjector::default()
        .project(event(
            "queue.promoted",
            json!({
                "queuedTurnId": "turn-1",
                "queuedSubmissionId": "turn-1",
            }),
        ))
        .expect("queue promotion notification");

    assert_eq!(notifications.len(), 1);
    assert_eq!(notifications[0].method, "thread/queue/changed");
    assert_eq!(
        notifications[0].params.as_ref().expect("queue params"),
        &json!({"threadId": "thread-1"})
    );
}

#[test]
fn unknown_prefixed_side_channels_fail_closed() {
    for event_type in [
        "action.unknown",
        "approval.unknown",
        "provider.unknown",
        "image_task.unknown",
        "image_task_unknown",
        "runtime.unknown",
    ] {
        let error = V2NotificationProjector::default()
            .project(event(event_type, json!({})))
            .expect_err("unknown prefixed event must fail closed");
        assert_eq!(error.code, error_codes::RUNTIME_ERROR);
        assert!(error.message.contains(event_type));
    }
}

#[test]
fn audit_only_events_are_not_sent_to_clients() {
    let notifications = V2NotificationProjector::default()
        .project(event("provider.step", json!({})))
        .expect("audit-only event");
    assert!(notifications.is_empty());
}

#[test]
fn reverse_request_lifecycle_is_internal_to_typed_server_requests() {
    for event_type in [
        "action.required",
        "action.resolved",
        "action.canceled",
        "action.cancelled",
        "action.expired",
        "dynamic_tool.requested",
    ] {
        let mut projector = V2NotificationProjector::default();
        let notifications = projector
            .project(event(event_type, json!({})))
            .expect("internal reverse request lifecycle");
        assert!(notifications.is_empty(), "{event_type}");
    }
}

#[test]
fn thread_goal_continuation_context_is_not_sent_to_clients() {
    let mut projector = V2NotificationProjector::default();
    let notifications = projector
        .project(event(
            "thread.goal.continuation",
            json!({"input": [{"type": "text", "text": "internal objective"}]}),
        ))
        .expect("internal thread goal continuation");

    assert!(notifications.is_empty());
}

#[test]
fn malformed_recognized_lifecycle_is_rejected_without_wrapper_fallback() {
    let mut projector = V2NotificationProjector::default();
    let error = projector
        .project(event("item.completed", json!({})))
        .expect_err("malformed lifecycle must reject");
    assert_eq!(error.code, error_codes::RUNTIME_ERROR);
    assert!(error.message.contains("item.completed"));
}
