use super::*;
use crate::projection::tests::{test_thread, test_turn};
use crate::projection::ConversationProjection;
use app_server_protocol::protocol::v2::ServerNotification;
use serde_json::json;

fn reasoning(id: &str, parts: &[&str]) -> ThreadItem {
    ThreadItem::Reasoning {
        id: id.into(),
        metadata: None,
        summary: parts.iter().map(|part| (*part).to_string()).collect(),
        content: vec!["RAW_MUST_STAY_HIDDEN".into()],
    }
}

fn notification(method: &str, params: serde_json::Value) -> ServerNotification {
    serde_json::from_value(json!({"method": method, "params": params})).unwrap()
}

fn delta(turn_id: &str, item_id: &str, index: i64, text: &str) -> ServerNotification {
    notification(
        "item/reasoning/summaryTextDelta",
        json!({
            "threadId": "thread-review-filter", "turnId": turn_id,
            "itemId": item_id, "summaryIndex": index, "delta": text,
        }),
    )
}

#[test]
fn resumed_tail_keeps_indexed_parts_and_accepts_the_first_delta_without_started() {
    let parts = ["**Checking**\n\n<!-- -->", "**Result**\n\nFirst"];
    let mut projection = ConversationProjection::default();
    projection.hydrate_thread(test_thread(vec![test_turn(
        "active",
        TurnStatus::InProgress,
        vec![
            reasoning("earlier", &["old summary"]),
            reasoning("tail", &parts),
        ],
    )]));
    assert!(!projection.entries()[0].streaming);
    assert!(projection.entries()[1].streaming);
    assert_eq!(projection.status(), "First");
    projection.on_reconnected();
    assert_eq!(projection.status(), "First");
    let earlier = projection.entries()[0].clone();
    projection.apply(delta("active", "earlier", 0, " stale"));
    projection.apply(delta("unrelated", "tail", 1, " wrong turn"));
    assert_eq!(projection.entries()[0], earlier);
    projection.apply(delta("active", "tail", 1, " continued"));
    projection.apply(delta("active", "tail", 2, "Second paragraph"));
    assert_eq!(
        projection.entries()[1].text,
        "\n\nFirst continued\n\nSecond paragraph"
    );
    assert_eq!(projection.status(), "Second paragraph");
    assert!(!projection.entries()[1]
        .text
        .contains("RAW_MUST_STAY_HIDDEN"));
}

#[test]
fn resumed_part_added_and_same_item_start_preserve_the_snapshot() {
    for method in ["item/reasoning/summaryPartAdded", "item/started"] {
        let mut projection = ConversationProjection::default();
        let item = reasoning("tail", &["snapshot body"]);
        projection.hydrate_thread(test_thread(vec![test_turn(
            "active",
            TurnStatus::InProgress,
            vec![item],
        )]));
        let params = if method == "item/started" {
            json!({"threadId": "thread-review-filter", "turnId": "active",
                "item": reasoning("tail", &[]), "startedAtMs": 0})
        } else {
            json!({"threadId": "thread-review-filter", "turnId": "active",
                "itemId": "tail", "summaryIndex": 0})
        };
        projection.apply(notification(method, params));
        projection.apply(delta("active", "tail", 0, " continued"));
        assert_eq!(
            projection.entries()[0].text,
            "snapshot body continued",
            "{method}"
        );
    }
}

#[test]
fn resumed_completion_without_started_replaces_and_settles_the_snapshot() {
    let mut projection = ConversationProjection::default();
    projection.hydrate_thread(test_thread(vec![test_turn(
        "active",
        TurnStatus::InProgress,
        vec![reasoning("tail", &["partial"])],
    )]));
    projection.apply(notification(
        "item/completed",
        json!({
            "threadId": "thread-review-filter", "turnId": "active",
            "item": reasoning("tail", &["full canonical body"]), "completedAtMs": 1,
        }),
    ));
    let completed = projection.entries()[0].clone();
    assert!(!completed.streaming);
    assert_eq!(completed.text, "full canonical body");
    projection.apply(delta("active", "tail", 0, " obsolete"));
    assert_eq!(projection.entries()[0], completed);
}

#[test]
fn missing_resumed_reasoning_is_recovered_only_for_the_active_turn() {
    for method in ["delta", "part", "completion"] {
        let mut projection = ConversationProjection::default();
        projection.hydrate_thread(test_thread(vec![test_turn(
            "active",
            TurnStatus::InProgress,
            vec![],
        )]));
        projection.apply(delta("other", "wrong", 0, "hidden"));
        assert!(projection.entries().is_empty());
        match method {
            "delta" => projection.apply(delta("active", "new", 0, "recovered")),
            "part" => {
                projection.apply(notification(
                    "item/reasoning/summaryPartAdded",
                    json!({
                        "threadId": "thread-review-filter", "turnId": "active",
                        "itemId": "new", "summaryIndex": 1,
                    }),
                ));
                projection.apply(delta("active", "new", 1, "recovered"));
            }
            _ => projection.apply(notification(
                "item/completed",
                json!({
                    "threadId": "thread-review-filter", "turnId": "active",
                    "item": reasoning("new", &["recovered"]), "completedAtMs": 1,
                }),
            )),
        }
        assert_eq!(projection.entries()[0].text, "recovered", "{method}");
        assert_eq!(projection.entries()[0].streaming, method != "completion");
    }
}

#[test]
fn new_item_and_turn_terminal_settle_the_provisional_snapshot() {
    for method in ["item/started", "turn/completed"] {
        let mut projection = ConversationProjection::default();
        projection.hydrate_thread(test_thread(vec![test_turn(
            "active",
            TurnStatus::InProgress,
            vec![reasoning("tail", &["snapshot body"])],
        )]));
        let params = if method == "item/started" {
            json!({"threadId": "thread-review-filter", "turnId": "active",
                "item": {"type": "agentMessage", "id": "answer", "text": "next item"},
                "startedAtMs": 1})
        } else {
            json!({"threadId": "thread-review-filter", "turn": {
                "id": "active", "items": [], "status": "completed",
            }})
        };
        projection.apply(notification(method, params));
        let settled = projection.entries()[0].clone();
        assert!(!settled.streaming, "{method}");
        projection.apply(delta("active", "tail", 0, " late"));
        assert_eq!(projection.entries()[0], settled, "{method}");
        assert_ne!(projection.status(), "snapshot body");
    }
}

#[test]
fn older_pages_do_not_overwrite_live_summary_or_reopen_closed_items() {
    let active = test_turn(
        "active",
        TurnStatus::InProgress,
        vec![reasoning("tail", &["old"])],
    );
    let mut projection = ConversationProjection::default();
    projection.hydrate_thread(test_thread(vec![active.clone()]));
    projection.apply(delta("active", "tail", 0, " live"));
    projection.restore_history_turns(&[active]);
    assert_eq!(projection.entries()[0].text, "old live");
    assert_eq!(projection.status(), "old live");
    projection.hydrate_thread(test_thread(vec![test_turn(
        "closed",
        TurnStatus::Completed,
        vec![reasoning("tail", &["finished"])],
    )]));
    projection.apply(delta("closed", "tail", 0, " late"));
    assert_eq!(projection.entries()[0].text, "finished");
    assert!(!projection.entries()[0].streaming);
    assert_eq!(projection.status(), "ready");
}

#[test]
fn non_reasoning_tail_does_not_reopen_earlier_reasoning_or_restore_its_status() {
    let mut projection = ConversationProjection::default();
    projection.hydrate_thread(test_thread(vec![test_turn(
        "active",
        TurnStatus::InProgress,
        vec![
            reasoning("earlier", &["finished summary"]),
            serde_json::from_value(json!({
                "type": "agentMessage", "id": "answer", "text": "after reasoning",
            }))
            .unwrap(),
        ],
    )]));
    assert_eq!(projection.status(), "running");
    projection.apply(delta("active", "earlier", 0, " late"));
    assert_eq!(projection.entries()[0].text, "finished summary");
    assert!(!projection.entries()[0].streaming);
}

#[test]
fn summary_view_cannot_claim_its_last_preview_item_is_the_active_tail() {
    let mut turn = test_turn(
        "active",
        TurnStatus::InProgress,
        vec![reasoning("preview", &["preview body"])],
    );
    turn.items_view = app_server_protocol::protocol::v2::TurnItemsView::Summary;
    let mut projection = ConversationProjection::default();
    projection.hydrate_thread(test_thread(vec![turn]));
    assert_eq!(projection.status(), "running");
    assert!(!projection.entries()[0].streaming);
    projection.apply(delta("active", "preview", 0, " late"));
    assert_eq!(projection.entries()[0].text, "preview body");
}

#[test]
fn metadata_only_hydration_restores_running_identity_and_does_not_resurrect_a_settled_turn() {
    let mut projection = ConversationProjection::default();
    projection.hydrate_thread(test_thread(vec![]));
    let active = test_turn("active", TurnStatus::InProgress, vec![]);
    projection.restore_history_turns(&[
        test_turn("old", TurnStatus::Completed, vec![]),
        active.clone(),
    ]);
    assert_eq!(projection.active_turn_id(), Some("active"));
    assert_eq!(projection.status(), "running");
    projection.apply(serde_json::from_value(json!({"method": "turn/completed", "params": {
        "threadId": "thread-review-filter", "turn": {"id": "active", "items": [], "status": "completed"}
    }})).unwrap());
    projection.restore_history_turns(&[active]);
    assert!(projection.active_turn_id().is_none());
    assert_eq!(projection.status(), "ready");
    projection.apply(serde_json::from_value(json!({"method": "item/agentMessage/delta", "params": {
        "threadId": "thread-review-filter", "turnId": "active", "itemId": "late", "delta": "obsolete stream"
    }})).unwrap());
    assert!(projection.entries().is_empty());
}

#[test]
fn older_facts_preserve_a_new_live_turn_and_only_seed_usage_identity() {
    let mut projection = ConversationProjection::default();
    projection.hydrate_thread(test_thread(vec![]));
    projection.restore_history_turns(&[test_turn("old", TurnStatus::Completed, vec![])]);
    assert!(projection.token_usage("thread-review-filter").is_none());
    projection.start_turn("new".into());
    projection.restore_history_turns(&[test_turn("old", TurnStatus::Completed, vec![])]);
    assert_eq!(projection.active_turn_id(), Some("new"));
    let notify = |turn, input| -> ServerNotification {
        serde_json::from_value(json!({
        "method": "thread/tokenUsage/updated", "params": {
            "threadId": "thread-review-filter", "turnId": turn,
            "tokenUsage": {"total": {"totalTokens": input, "inputTokens": input, "cachedInputTokens": 0,
                "cacheWriteInputTokens": 0, "outputTokens": 0, "reasoningOutputTokens": 0},
                "last": {"totalTokens": input, "inputTokens": input, "cachedInputTokens": 0,
                "cacheWriteInputTokens": 0, "outputTokens": 0, "reasoningOutputTokens": 0}}
        }
    })).unwrap()
    };
    projection.apply(notify("old", 999));
    assert!(projection.token_usage("thread-review-filter").is_none());
    projection.apply(notify("new", 20));
    assert_eq!(
        projection
            .token_usage("thread-review-filter")
            .unwrap()
            .total
            .input_tokens,
        20
    );
}
