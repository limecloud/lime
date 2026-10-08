use super::*;

#[test]
fn reasoning_deltas_preserve_leading_trailing_and_whitespace_only_fragments() {
    for (event_type, field, index_key, method) in [
        (
            "reasoning.summary",
            "summary",
            "summaryIndex",
            "item/reasoning/summaryTextDelta",
        ),
        (
            "reasoning.delta",
            "delta",
            "contentIndex",
            "item/reasoning/textDelta",
        ),
    ] {
        for delta in [" continued", "\n\n", "\t", "结束 \n", ""] {
            let notifications = V2NotificationProjector::default()
                .project(event(
                    event_type,
                    json!({"itemId": "reasoning-1", field: delta, index_key: 2}),
                ))
                .unwrap();
            assert_eq!(notifications.len(), 1, "{event_type} {delta:?}");
            assert_eq!(notifications[0].method, method);
            assert_eq!(
                notifications[0].params,
                Some(json!({
                    "threadId": "thread-1", "turnId": "turn-1", "itemId": "reasoning-1",
                    "delta": delta, index_key: 2,
                })),
                "{event_type} {delta:?}"
            );
        }
    }
}

#[test]
fn body_parsing_preserves_text_for_final_reasoning_and_assistant_batches() {
    let notifications = V2NotificationProjector::default()
        .project(event(
            "reasoning.final",
            json!({"reasoningId": "reasoning-1", "text": "\n final \n", "summaryIndex": 1}),
        ))
        .unwrap();
    assert_eq!(
        notifications[0].params.as_ref().unwrap()["delta"],
        "\n final \n"
    );
    let notifications = V2NotificationProjector::default().project(event("message.delta_batch",
        json!({"itemId": "message-1", "deltas": [{"text": " first"}, {"delta": "\n\n"}, {"content": "last "}]}),
    )).unwrap();
    assert_eq!(
        notifications[0].params.as_ref().unwrap()["delta"],
        " first\n\nlast "
    );
}

#[test]
fn maps_indexed_reasoning_notifications_in_codex_order() {
    let mut projector = V2NotificationProjector::default();
    let events = [
        event(
            "item.started",
            json!({"item": canonical_reasoning_item("inProgress", vec![], vec![])}),
        ),
        event(
            "reasoning.summary",
            json!({
                "itemId": "reasoning-1",
                "summary": "first summary",
                "summaryIndex": 0
            }),
        ),
        event(
            "reasoning.summary_part_added",
            json!({"itemId": "reasoning-1", "summaryIndex": 1}),
        ),
        event(
            "reasoning.delta",
            json!({
                "itemId": "reasoning-1",
                "delta": "raw reasoning",
                "contentIndex": 0
            }),
        ),
        event(
            "item.completed",
            json!({
                "item": canonical_reasoning_item(
                    "completed",
                    vec!["first summary", "second summary"],
                    vec!["raw reasoning"]
                )
            }),
        ),
    ];

    let notifications = events
        .into_iter()
        .flat_map(|event| projector.project(event).expect("reasoning projection"))
        .collect::<Vec<_>>();

    assert_eq!(
        notifications
            .iter()
            .map(|notification| notification.method.as_str())
            .collect::<Vec<_>>(),
        [
            "item/started",
            "item/reasoning/summaryTextDelta",
            "item/reasoning/summaryPartAdded",
            "item/reasoning/textDelta",
            "item/completed",
        ]
    );
    assert_eq!(
        notifications[1].params.as_ref().expect("summary params"),
        &json!({
            "threadId": "thread-1",
            "turnId": "turn-1",
            "itemId": "reasoning-1",
            "delta": "first summary",
            "summaryIndex": 0
        })
    );
    assert_eq!(
        notifications[2].params.as_ref().expect("part params")["summaryIndex"],
        1
    );
    assert_eq!(
        notifications[3].params.as_ref().expect("raw params")["contentIndex"],
        0
    );
    assert_eq!(
        notifications[4].params.as_ref().expect("completed params")["item"]["type"],
        "reasoning"
    );
}

#[test]
fn maps_reasoning_final_to_visible_summary_delta() {
    let notifications = V2NotificationProjector::default()
        .project(event(
            "reasoning.final",
            json!({
                "reasoningId": "reasoning-final-1",
                "text": "先核对事实",
                "summaryIndex": 2
            }),
        ))
        .expect("reasoning final projection");

    assert_eq!(notifications.len(), 1);
    assert_eq!(notifications[0].method, "item/reasoning/summaryTextDelta");
    assert_eq!(
        notifications[0].params.as_ref().expect("summary params"),
        &json!({
            "threadId": "thread-1",
            "turnId": "turn-1",
            "itemId": "reasoning-final-1",
            "delta": "先核对事实",
            "summaryIndex": 2
        })
    );
}

#[test]
fn reasoning_final_fails_closed_without_identity_or_text() {
    for payload in [
        json!({"text": "缺少 reasoning id"}),
        json!({"reasoningId": "reasoning-final-1"}),
    ] {
        let error = V2NotificationProjector::default()
            .project(event("reasoning.final", payload))
            .expect_err("malformed reasoning final must fail closed");
        assert_eq!(error.code, error_codes::RUNTIME_ERROR);
        assert!(error.message.contains("reasoning.final"));
    }
}

#[test]
fn malformed_reasoning_notification_is_rejected_without_wrapper_fallback() {
    let mut projector = V2NotificationProjector::default();
    let error = projector
        .project(event(
            "reasoning.summary",
            json!({"itemId": "reasoning-1", "summary": "missing index"}),
        ))
        .expect_err("missing summary index must reject");

    assert_eq!(error.code, error_codes::RUNTIME_ERROR);
    assert!(error.message.contains("reasoning.summary"));
}
