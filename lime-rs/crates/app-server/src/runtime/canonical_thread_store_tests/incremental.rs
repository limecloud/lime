use super::*;

#[test]
fn incremental_rollout_omits_unchanged_items_and_recovers_the_full_turn() {
    let (_temp, agent_root, store) = store_with_rollout();
    let source = thread("incremental-rollout", 1_700_000_000_000);
    create(&store, &source);
    let first = user_item(&source, "turn-1", "large-input", "x".repeat(100_000), 1, 1);
    block_on(store.apply_history(ApplyThreadHistoryParams {
        session_id: source.session_id.clone(),
        thread_id: source.thread_id.clone(),
        changes: ThreadHistoryChangeSet {
            sequence: 1,
            changed_turns: vec![turn(&source, "turn-1", TurnStatus::InProgress)],
            changed_items: vec![first.clone()],
            ..Default::default()
        },
    }))
    .unwrap();
    let path = rollout_path(&store, &agent_root, &source.thread_id);
    let before = fs::metadata(&path).unwrap().len();
    let second = item(&source, "turn-1", "answer", 2, 2);
    let completion = ApplyThreadHistoryParams {
        session_id: source.session_id.clone(),
        thread_id: source.thread_id.clone(),
        changes: ThreadHistoryChangeSet {
            sequence: 2,
            changed_turns: vec![turn(&source, "turn-1", TurnStatus::Completed)],
            changed_items: vec![second.clone()],
            ..Default::default()
        },
    };
    block_on(store.apply_history(completion.clone())).unwrap();
    assert!(fs::metadata(&path).unwrap().len() - before < 10_000);
    let lines = rollout_lines(&path);
    assert_eq!(lines[2]["changes"]["changedTurns"][0]["items"], json!([]));
    assert!(!block_on(store.apply_history(completion)).unwrap().applied);
    drop(store);

    // A fresh index must reconstruct the same Items from the durable increments.
    let cold = ProjectionStore::initialize_with_agent_root(
        agent_root.join("runtime/cold.sqlite"),
        &agent_root,
    )
    .unwrap();
    let recovered = block_on(cold.read_thread(ReadThreadParams {
        thread_id: source.thread_id,
        include_archived: false,
        turns_view: ThreadTurnsView::Full,
    }))
    .unwrap()
    .unwrap();
    assert_eq!(recovered.turns.len(), 1);
    assert_eq!(recovered.turns[0].status, TurnStatus::Completed);
    assert_eq!(recovered.turns[0].items, vec![first, second]);
}

#[test]
fn incremental_merge_keeps_untouched_history_and_existing_item_identity() {
    let (_temp, store) = store();
    let source = thread("incremental-merge", 1);
    create(&store, &source);
    let untouched = user_item(&source, "turn-1", "large-input", "x".repeat(100_000), 1, 1);
    let mut first = item(&source, "turn-2", "answer", 1, 2);
    first.status = ItemStatus::InProgress;
    first.completed_at_ms = None;
    first.payload = ThreadItemPayload::AgentMessage {
        text: "hello ".to_string(),
        phase: None,
        content_parts: Vec::new(),
        delivery: None,
        questions: None,
    };
    let apply = |changes| {
        block_on(store.apply_history(ApplyThreadHistoryParams {
            session_id: source.session_id.clone(),
            thread_id: source.thread_id.clone(),
            changes,
        }))
        .unwrap()
    };
    apply(ThreadHistoryChangeSet {
        sequence: 1,
        changed_turns: vec![
            turn(&source, "turn-1", TurnStatus::Completed),
            turn(&source, "turn-2", TurnStatus::InProgress),
        ],
        changed_items: vec![untouched.clone(), first.clone()],
        ..Default::default()
    });
    let mut delta = item(&source, "turn-2", "answer", 2, 99);
    delta.metadata = json!({"source_event_type": "message.delta"});
    delta.payload = ThreadItemPayload::AgentMessage {
        text: "world".to_string(),
        phase: None,
        content_parts: Vec::new(),
        delivery: None,
        questions: None,
    };
    apply(ThreadHistoryChangeSet {
        sequence: 2,
        changed_turns: vec![turn(&source, "turn-2", TurnStatus::Completed)],
        changed_items: vec![delta],
        ..Default::default()
    });
    let recovered = block_on(store.read_thread(ReadThreadParams {
        thread_id: source.thread_id.clone(),
        include_archived: false,
        turns_view: ThreadTurnsView::Full,
    }))
    .unwrap()
    .unwrap();
    assert_eq!(recovered.turns[0].items, vec![untouched]);
    let merged = &recovered.turns[1].items[0];
    assert_eq!(merged.ordinal, first.ordinal);
    assert_eq!(merged.created_at_ms, first.created_at_ms);
    assert_eq!(merged.status, ItemStatus::Completed);
    assert!(matches!(
        &merged.payload,
        ThreadItemPayload::AgentMessage { text, .. } if text == "hello world"
    ));
}
