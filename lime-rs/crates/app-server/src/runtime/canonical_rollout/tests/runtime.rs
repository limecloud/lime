use super::*;
use agent_runtime::model_history::{ModelHistoryRecord, MODEL_HISTORY_EVENT_TYPE};
use app_server_protocol::AgentEvent;
use model_provider::current_client::{
    CurrentProviderContent, CurrentProviderMessage, CurrentProviderRole,
};

fn receipt(source: &Thread, sequence: u64) -> AgentEvent {
    let record = ModelHistoryRecord::completed(CurrentProviderMessage {
        producer: Some("source-route".to_string()),
        role: CurrentProviderRole::Assistant,
        content: vec![CurrentProviderContent::RawResponseItem(json!({
            "type":"reasoning", "id":"opaque-item", "summary":[], "encrypted_content":"opaque-receipt"
        }))],
    }, "opaque-item".to_string()).unwrap();
    AgentEvent {
        event_id: format!("receipt-{sequence}"),
        sequence,
        session_id: source.session_id.as_str().to_string(),
        thread_id: Some(source.thread_id.as_str().to_string()),
        turn_id: None,
        event_type: MODEL_HISTORY_EVENT_TYPE.to_string(),
        timestamp: "2026-10-21T00:00:00Z".to_string(),
        payload: serde_json::to_value(record).unwrap(),
    }
}

#[test]
fn runtime_event_read_preserves_events_and_rejects_corrupt_earlier_history() {
    let (_temp, store, source, relative, absolute) = setup("streaming-resume");
    let expected = vec![receipt(&source, 1), receipt(&source, 2)];
    for event in &expected {
        store
            .append_history(
                &relative,
                source.session_id.as_str(),
                source.thread_id.as_str(),
                &fingerprint('a'),
                &changes(event.sequence),
                std::slice::from_ref(event),
                None,
            )
            .unwrap();
    }
    assert_eq!(store.read_requested_thread(&relative).unwrap().3, expected);
    assert_eq!(store.read_requested_thread(&absolute).unwrap().3, expected);

    let contents = fs::read_to_string(&absolute).unwrap();
    let mut records: Vec<Value> = contents
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    records[1]["content_digest"] = json!("0".repeat(64));
    let corrupt = records
        .iter()
        .map(|record| serde_json::to_string(record).unwrap())
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    fs::write(&absolute, corrupt).unwrap();
    assert!(store
        .read_requested_thread(&relative)
        .unwrap_err()
        .contains("invalid rollout history record"));
}

#[test]
fn native_receipt_batch_is_idempotent_and_survives_crash_tail_repair() {
    let (_temp, store, source, relative, absolute) = setup("native-receipt");
    let first = receipt(&source, 1);
    assert!(store
        .append_history(
            &relative,
            source.session_id.as_str(),
            source.thread_id.as_str(),
            &fingerprint('a'),
            &changes(1),
            &[first.clone()],
            None
        )
        .unwrap());
    let before = fs::read(&absolute).unwrap();
    assert!(!store
        .append_history(
            &relative,
            source.session_id.as_str(),
            source.thread_id.as_str(),
            &fingerprint('a'),
            &changes(1),
            &[first.clone()],
            None
        )
        .unwrap());
    assert_eq!(fs::read(&absolute).unwrap(), before);
    let mut collision = first.clone();
    collision.payload["message"]["producer"] = json!("another-route");
    assert!(store
        .append_history(
            &relative,
            source.session_id.as_str(),
            source.thread_id.as_str(),
            &fingerprint('a'),
            &changes(1),
            &[collision],
            None
        )
        .unwrap_err()
        .contains("collision"));
    assert_eq!(fs::read(&absolute).unwrap(), before);
    fs::OpenOptions::new()
        .append(true)
        .open(&absolute)
        .unwrap()
        .write_all(b"{\"type\":\"thread_history\"")
        .unwrap();
    let second = receipt(&source, 2);
    store
        .append_history(
            &relative,
            source.session_id.as_str(),
            source.thread_id.as_str(),
            &fingerprint('b'),
            &changes(2),
            &[second.clone()],
            None,
        )
        .unwrap();
    let scan = scan_rollout(&absolute).unwrap();
    assert_eq!(scan.history[0].runtime_events, [first]);
    assert_eq!(scan.history[1].runtime_events, [second]);
    let mut bytes = fs::read(&absolute).unwrap();
    assert_eq!(bytes.pop(), Some(b'\n'));
    fs::write(&absolute, bytes).unwrap();
    let snapshot = store.snapshots().unwrap().remove(0);
    assert_eq!(snapshot.history.len(), 2);
    assert!(fs::read(&absolute).unwrap().ends_with(b"\n"));
}

#[test]
fn invalid_receipt_scope_and_incomplete_batches_never_append() {
    let (_temp, store, source, relative, absolute) = setup("invalid-receipt");
    let before = fs::read(&absolute).unwrap();
    let mut wrong_owner = receipt(&source, 1);
    wrong_owner.session_id = "other-session".to_string();
    for (sequence, events) in [
        (1, vec![wrong_owner]),
        (2, vec![receipt(&source, 1)]),
        (3, vec![receipt(&source, 1), receipt(&source, 3)]),
    ] {
        assert!(store
            .append_history(
                &relative,
                source.session_id.as_str(),
                source.thread_id.as_str(),
                &fingerprint('a'),
                &changes(sequence),
                &events,
                None
            )
            .is_err());
        assert_eq!(fs::read(&absolute).unwrap(), before);
    }
}
