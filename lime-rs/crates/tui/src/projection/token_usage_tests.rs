use crate::projection::tests::{test_thread, test_turn};
use crate::projection::ConversationProjection;
use app_server_protocol::protocol::v2::{ServerNotification, TurnStatus};
use serde_json::json;

fn update(projection: &mut ConversationProjection, thread: &str, turn: &str, input: i64) {
    let count = json!({
        "totalTokens": input + 100, "inputTokens": input, "cachedInputTokens": 20,
        "cacheWriteInputTokens": 10, "outputTokens": 100, "reasoningOutputTokens": 40
    });
    projection.apply(
        serde_json::from_value(json!({
            "method": "thread/tokenUsage/updated", "params": {
                "threadId": thread, "turnId": turn,
                "tokenUsage": {"total": count, "last": count, "modelContextWindow": 128000}
            }
        }))
        .unwrap(),
    );
}

fn start(projection: &mut ConversationProjection, turn: &str) {
    projection.apply(serde_json::from_value(json!({
        "method": "turn/started", "params": {
            "threadId": "thread-usage", "turn": {"id": turn, "items": [], "status": "inProgress", "error": null}
        }
    })).unwrap());
}

#[test]
fn token_usage_is_a_scoped_server_snapshot_not_a_local_accumulator() {
    let mut projection = ConversationProjection::default();
    assert!(projection.token_usage("thread-usage").is_none());
    start(&mut projection, "turn-first");
    update(&mut projection, "thread-usage", "turn-first", 10);
    update(&mut projection, "thread-usage", "turn-first", 10);
    assert_eq!(
        projection
            .token_usage("thread-usage")
            .unwrap()
            .total
            .input_tokens,
        10
    );
    assert!(projection.token_usage("foreign").is_none());
    update(&mut projection, "foreign", "turn-first", 900);
    assert_eq!(
        projection
            .token_usage("thread-usage")
            .unwrap()
            .total
            .input_tokens,
        10
    );
    assert!(
        projection.entries().is_empty(),
        "usage is not a transcript Item"
    );

    projection.apply(ServerNotification::TurnCompleted(
        serde_json::from_value(json!({
            "threadId": "thread-usage", "turn": {"id": "turn-first", "items": [], "status": "completed", "error": null}
        })).unwrap()
    ));
    update(&mut projection, "thread-usage", "turn-first", 30);
    assert_eq!(
        projection
            .token_usage("thread-usage")
            .unwrap()
            .total
            .input_tokens,
        30,
        "a final usage snapshot may arrive after the current Turn terminal"
    );
    projection.start_turn("turn-second".into());
    update(&mut projection, "thread-usage", "turn-first", 900);
    assert_eq!(
        projection
            .token_usage("thread-usage")
            .unwrap()
            .total
            .input_tokens,
        30
    );
    update(&mut projection, "thread-usage", "turn-second", 40);
    assert_eq!(
        projection
            .token_usage("thread-usage")
            .unwrap()
            .total
            .input_tokens,
        40
    );
}

#[test]
fn hydrate_clears_unpersisted_usage_and_only_accepts_the_latest_canonical_turn() {
    let mut projection = ConversationProjection::default();
    update(&mut projection, "thread-usage", "turn-first", 10);
    let mut thread = test_thread(vec![
        test_turn("turn-first", TurnStatus::Completed, vec![]),
        test_turn("turn-second", TurnStatus::Completed, vec![]),
    ]);
    thread.id = "thread-usage".into();
    projection.hydrate_thread(thread);
    assert!(projection.token_usage("thread-usage").is_none());
    update(&mut projection, "thread-usage", "turn-first", 900);
    assert!(projection.token_usage("thread-usage").is_none());
    update(&mut projection, "thread-usage", "turn-second", 20);
    assert_eq!(
        projection
            .token_usage("thread-usage")
            .unwrap()
            .total
            .input_tokens,
        20
    );
    let mut foreign = test_thread(vec![]);
    foreign.id = "foreign".into();
    projection.hydrate_thread(foreign);
    update(&mut projection, "thread-usage", "turn-second", 900);
    assert!(projection.token_usage("foreign").is_none());
    assert!(projection.token_usage("thread-usage").is_none());
    update(&mut projection, "foreign", "new-turn", 0);
    assert_eq!(
        projection
            .token_usage("foreign")
            .unwrap()
            .total
            .input_tokens,
        0
    );
}
