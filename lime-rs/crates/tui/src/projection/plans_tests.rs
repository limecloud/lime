use super::*;
use crate::projection::tests::{test_thread, test_turn};
use app_server_protocol::protocol::v2::{ServerNotification, ThreadItem, TurnPlanStep, TurnStatus};
use serde_json::json;

fn update(projection: &mut ConversationProjection, completed: usize, total: usize) {
    projection.apply(ServerNotification::TurnPlanUpdated(
        TurnPlanUpdatedNotification {
            thread_id: "thread-plan".into(),
            turn_id: "turn-plan".into(),
            explanation: None,
            plan: (0..total)
                .map(|index| TurnPlanStep {
                    step: format!("step {index}: [x] text is not a completed status"),
                    status: if index < completed {
                        TurnPlanStepStatus::Completed
                    } else if index == completed {
                        TurnPlanStepStatus::InProgress
                    } else {
                        TurnPlanStepStatus::Pending
                    },
                })
                .collect(),
        },
    ));
}

#[test]
fn plan_text_and_progress_share_typed_status_without_parsing_the_text() {
    let mut projection = ConversationProjection::default();
    assert!(projection.plan_progress("thread-plan").is_none());
    update(&mut projection, 1, 3);
    assert_eq!(projection.plan_progress("thread-plan"), Some((1, 3)));
    assert!(projection.plan_progress("foreign-thread").is_none());
    let plan = projection
        .entries()
        .iter()
        .find(|entry| entry.kind == EntryKind::Plan)
        .unwrap();
    assert!(plan.text.starts_with("[x] step 0:"));
    assert!(plan.text.contains("[~] step 1:"));
    assert!(plan.text.contains("[ ] step 2:"));
    update(&mut projection, 3, 3);
    assert_eq!(projection.plan_progress("thread-plan"), Some((3, 3)));
    assert_eq!(
        projection
            .entries()
            .iter()
            .filter(|entry| entry.kind == EntryKind::Plan)
            .count(),
        1
    );
    update(&mut projection, 0, 0);
    assert!(projection.plan_progress("thread-plan").is_none());
}

#[test]
fn closed_turn_late_plan_is_ignored_and_hydrate_does_not_invent_durable_counts() {
    let mut projection = ConversationProjection::default();
    update(&mut projection, 1, 3);
    projection.apply(serde_json::from_value(json!({
        "method": "turn/completed", "params": {"threadId": "thread-plan", "turn": {"id": "turn-plan", "items": [], "status": "completed", "error": null}}
    })).unwrap());
    update(&mut projection, 3, 4);
    assert_eq!(projection.plan_progress("thread-plan"), Some((1, 3)));
    let entries = projection.entries().len();
    assert_eq!(entries, 1);
    projection.hydrate_thread(test_thread(vec![test_turn(
        "historical-plan",
        TurnStatus::Completed,
        vec![ThreadItem::Plan {
            id: "text-only-plan".into(),
            metadata: None,
            text: "[x] visible checklist-like text".into(),
        }],
    )]));
    assert!(projection.plan_progress("thread-plan").is_none());
    assert!(projection
        .entries()
        .iter()
        .any(|entry| entry.text.contains("visible checklist-like text")));
    update(&mut projection, 2, 4);
    assert_eq!(projection.plan_progress("thread-plan"), Some((2, 4)));
}
