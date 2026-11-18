use super::*;
use serde_json::json;

fn completed_turn() -> canonical::Turn {
    serde_json::from_value(json!({
        "sessionId": "session",
        "threadId": "thread",
        "turnId": "turn",
        "status": "completed",
        "createdAtMs": 1_700_000_100_000_i64,
        "updatedAtMs": 1_700_000_102_000_i64,
        "completedAtMs": 1_700_000_102_000_i64
    }))
    .unwrap()
}

#[test]
fn accepted_execution_without_started_event_uses_its_own_creation_time() {
    let turn = project_turn(completed_turn()).unwrap();
    assert_eq!(turn.started_at, Some(1_700_000_100));
    assert_eq!(turn.completed_at, Some(1_700_000_102));
    assert_eq!(turn.completed_at.unwrap() - turn.started_at.unwrap(), 2);
}

#[test]
fn execution_start_time_takes_precedence_over_admission_time() {
    let mut turn = completed_turn();
    turn.started_at_ms = Some(1_700_000_101_000);
    assert_eq!(project_turn(turn).unwrap().started_at, Some(1_700_000_101));
}

#[test]
fn queued_submissions_stay_out_of_execution_history() {
    let mut turn = completed_turn();
    turn.status = canonical::TurnStatus::InProgress;
    turn.queue = canonical::TurnQueueState::Queued { position: Some(1) };
    assert!(project_turn(turn).is_err());
}
