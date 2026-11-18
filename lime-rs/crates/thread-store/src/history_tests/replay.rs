use super::*;

#[test]
fn owned_replay_matches_transactional_merging_and_rollback() {
    let mut transactional = ThreadHistoryBuilder::new();
    let mut replay = ThreadHistoryBuilder::new();
    let mut delta = item(2, 99, "answer", "world");
    delta.metadata = serde_json::json!({"source_event_type": "message.delta"});
    for changes in [
        ThreadHistoryChangeSet {
            sequence: 1,
            changed_turns: vec![turn("turn-1", TurnStatus::InProgress)],
            changed_items: vec![item(1, 1, "answer", "hello ")],
            ..Default::default()
        },
        ThreadHistoryChangeSet {
            sequence: 2,
            changed_items: vec![delta],
            ..Default::default()
        },
        ThreadHistoryChangeSet {
            sequence: 3,
            changed_turns: vec![turn("turn-1", TurnStatus::Completed)],
            ..Default::default()
        },
        ThreadHistoryChangeSet {
            sequence: 4,
            rollback_to_sequence: Some(1),
            ..Default::default()
        },
    ] {
        transactional.apply_change_set(changes.clone()).unwrap();
        replay = replay.replay_change_set(changes).unwrap();
        assert_eq!(replay.snapshot(), transactional.snapshot());
    }
}

#[test]
fn owned_replay_preserves_identity_and_sequence_rejection() {
    let initial = ThreadHistoryChangeSet {
        sequence: 1,
        changed_turns: vec![turn("turn-1", TurnStatus::InProgress)],
        changed_items: vec![item(1, 1, "answer", "hello")],
        ..Default::default()
    };
    let replay = ThreadHistoryBuilder::new()
        .replay_change_set(initial.clone())
        .unwrap();
    assert_eq!(
        replay
            .clone()
            .replay_change_set(initial)
            .unwrap()
            .snapshot(),
        replay.snapshot()
    );

    let mut invalid = item(2, 2, "answer", "changed");
    invalid.thread_id = ThreadId::new("another-thread");
    assert!(replay
        .clone()
        .replay_change_set(ThreadHistoryChangeSet {
            sequence: 2,
            changed_items: vec![invalid],
            ..Default::default()
        })
        .is_err());
    assert!(replay
        .replay_change_set(ThreadHistoryChangeSet {
            sequence: 1,
            changed_items: vec![item(1, 1, "answer", "different")],
            ..Default::default()
        })
        .is_err());
}

#[test]
fn initial_batch_identity_conflict_leaves_transactional_builder_unchanged() {
    let mut builder = ThreadHistoryBuilder::new();
    let before = builder.snapshot();
    let mut invalid = item(1, 1, "answer", "hello");
    invalid.thread_id = ThreadId::new("another-thread");
    let changes = ThreadHistoryChangeSet {
        sequence: 1,
        changed_turns: vec![turn("turn-1", TurnStatus::InProgress)],
        changed_items: vec![invalid],
        ..Default::default()
    };
    assert!(builder.apply_change_set(changes.clone()).is_err());
    assert_eq!(builder.snapshot(), before);
    assert!(ThreadHistoryBuilder::new()
        .replay_change_set(changes)
        .is_err());
}
