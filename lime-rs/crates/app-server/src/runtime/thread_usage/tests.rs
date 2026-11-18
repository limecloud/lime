use super::*;

fn event(sequence: u64, event_type: &str, turn_id: Option<&str>, payload: Value) -> AgentEvent {
    AgentEvent {
        event_id: format!("event-{sequence}"),
        sequence,
        session_id: "session-1".to_string(),
        thread_id: Some("thread-1".to_string()),
        turn_id: turn_id.map(ToString::to_string),
        event_type: event_type.to_string(),
        timestamp: format!("2026-07-20T00:00:{sequence:02}Z"),
        payload,
    }
}

fn usage(input: i64, output: i64, total: i64) -> Value {
    json!({
        "input_tokens": input,
        "cached_input_tokens": 2,
        "output_tokens": output,
        "reasoning_output_tokens": 1,
        "total_tokens": total,
    })
}

#[test]
fn latest_complete_snapshot_is_typed_and_sequence_ordered() {
    let events = vec![
        event(
            1,
            "turn.completed",
            Some("turn-1"),
            json!({
                "usage": {
                    "total_token_usage": usage(10, 3, 13),
                    "last_token_usage": usage(10, 3, 13),
                    "model_context_window": 128000,
                }
            }),
        ),
        event(
            2,
            "turn.completed",
            Some("turn-2"),
            json!({
                "usage": {
                    "total_token_usage": usage(20, 4, 24),
                    "last_token_usage": usage(10, 1, 11),
                    "model_context_window": 256000,
                }
            }),
        ),
    ];

    let snapshot = thread_token_usage_snapshot_from_events(&events).expect("snapshot");
    assert_eq!(snapshot.turn_id, "turn-2");
    assert_eq!(snapshot.source_sequence, 2);
    assert_eq!(snapshot.total_token_usage.total_tokens, 24);
    assert_eq!(snapshot.last_token_usage.output_tokens, 1);
    assert_eq!(snapshot.model_context_window, Some(256000));
}

#[test]
fn partial_provider_usage_fails_closed() {
    let events = vec![event(
        1,
        "turn.completed",
        Some("turn-1"),
        json!({
            "usage": {
                "input_tokens": 10,
                "output_tokens": 3,
            }
        }),
    )];

    assert_eq!(thread_token_usage_snapshot_from_events(&events), None);
}

#[test]
fn missing_or_invalid_counters_fail_closed_even_without_context_window() {
    for key in [
        "input_tokens",
        "cached_input_tokens",
        "output_tokens",
        "reasoning_output_tokens",
        "total_tokens",
    ] {
        for invalid in [None, Some(json!(-1)), Some(json!("unknown"))] {
            let mut counters = usage(10, 3, 13);
            if let Some(value) = invalid {
                counters[key] = value;
            } else {
                counters.as_object_mut().expect("usage object").remove(key);
            }
            let candidate = event(
                1,
                "turn.completed",
                Some("turn-1"),
                json!({"usage": {
                    "total_token_usage": counters,
                    "last_token_usage": usage(10, 3, 13),
                }}),
            );
            assert_eq!(
                thread_token_usage_snapshot_from_events(&[candidate]),
                None,
                "invalid canonical counter: {key}"
            );
        }
    }
}

#[test]
fn complete_counters_are_restored_when_model_context_window_is_unknown() {
    let events = vec![event(
        1,
        "turn.completed",
        Some("turn-1"),
        json!({
            "usage": {
                "total_token_usage": usage(10, 3, 13),
                "last_token_usage": usage(10, 3, 13),
            }
        }),
    )];

    let snapshot = thread_token_usage_snapshot_from_events(&events).expect("complete counters");
    assert_eq!(snapshot.model_context_window, None);
    assert_eq!(snapshot.total_token_usage.total_tokens, 13);
    assert_eq!(snapshot.last_token_usage.input_tokens, 10);
}

#[test]
fn context_event_can_complete_usage_without_fabricating_counters() {
    let events = vec![
        event(
            1,
            "turn.context",
            Some("turn-1"),
            json!({"runtime": {"model_context_window": 128000}}),
        ),
        event(
            2,
            "turn.completed",
            Some("turn-1"),
            json!({
                "usage": {
                    "total_token_usage": usage(10, 3, 13),
                    "last_token_usage": usage(10, 3, 13),
                }
            }),
        ),
    ];

    let snapshot = thread_token_usage_snapshot_from_events(&events).expect("snapshot");
    assert_eq!(snapshot.model_context_window, Some(128000));
}

#[test]
fn trusted_flat_runtime_usage_is_lowered_to_cumulative_usage() {
    let previous = vec![event(
        1,
        "turn.completed",
        Some("turn-1"),
        json!({
            "backend": "runtime",
            "usage": {
                "input_tokens": 20,
                "cached_input_tokens": 5,
                "output_tokens": 4,
                "total_token_usage": usage(20, 4, 24),
                "last_token_usage": usage(20, 4, 24),
                "model_context_window": 128000
            }
        }),
    )];
    let mut current = event(
        2,
        "turn.completed",
        Some("turn-2"),
        json!({
            "backend": "runtime",
            "modelContextWindow": 128000,
            "usage": {
                "input_tokens": 10,
                "cached_input_tokens": 3,
                "output_tokens": 2
            }
        }),
    );

    canonicalize_runtime_usage_event(&mut current, &previous, &[]);
    let snapshot = thread_token_usage_snapshot_from_events(&[previous[0].clone(), current])
        .expect("canonical cumulative snapshot");
    assert_eq!(snapshot.total_token_usage.input_tokens, 30);
    assert_eq!(snapshot.total_token_usage.cached_input_tokens, 5);
    assert_eq!(snapshot.total_token_usage.output_tokens, 6);
    assert_eq!(snapshot.total_token_usage.total_tokens, 36);
    assert_eq!(snapshot.last_token_usage.cached_input_tokens, 3);
}

#[test]
fn trusted_flat_usage_without_context_remains_restorable() {
    let mut current = event(
        1,
        "turn.completed",
        Some("turn-1"),
        json!({
            "backend": "runtime",
            "usage": {
                "input_tokens": 31_000,
                "output_tokens": 0
            }
        }),
    );

    canonicalize_runtime_usage_event(&mut current, &[], &[]);

    assert_eq!(
        current
            .payload
            .pointer("/usage/total_token_usage/input_tokens"),
        Some(&json!(31_000))
    );
    assert_eq!(
        current
            .payload
            .pointer("/usage/last_token_usage/input_tokens"),
        Some(&json!(31_000))
    );
    assert!(current
        .payload
        .pointer("/usage/model_context_window")
        .is_none());
    let snapshot = thread_token_usage_snapshot_from_events(&[current]).expect("canonical usage");
    assert_eq!(snapshot.model_context_window, None);
    assert_eq!(snapshot.total_token_usage.input_tokens, 31_000);
    assert_eq!(snapshot.last_token_usage.total_tokens, 31_000);
}

#[test]
fn untrusted_or_incomplete_flat_usage_stays_non_canonical() {
    for payload in [
        json!({
            "backend": "external",
            "modelContextWindow": 128000,
            "usage": {"input_tokens": 10, "output_tokens": 2}
        }),
        json!({
            "backend": "runtime",
            "modelContextWindow": 128000,
            "usage": {"input_tokens": 10}
        }),
    ] {
        let mut candidate = event(1, "turn.completed", Some("turn-1"), payload);
        canonicalize_runtime_usage_event(&mut candidate, &[], &[]);
        assert_eq!(thread_token_usage_snapshot_from_events(&[candidate]), None);
    }
}

#[test]
fn provider_usage_preserves_failed_usage_without_double_counting_completion() {
    let previous = event(
        1,
        "turn.completed",
        Some("turn-1"),
        json!({
            "usage": {
                "total_token_usage": {
                    "input_tokens": 100,
                    "cached_input_tokens": 20,
                    "cache_write_input_tokens": 10,
                    "output_tokens": 40,
                    "reasoning_output_tokens": 0,
                    "total_tokens": 140
                },
                "last_token_usage": {
                    "input_tokens": 100,
                    "cached_input_tokens": 20,
                    "cache_write_input_tokens": 10,
                    "output_tokens": 40,
                    "reasoning_output_tokens": 0,
                    "total_tokens": 140
                },
                "model_context_window": 128000
            }
        }),
    );
    let mut usage_one = event(
        2,
        "provider.usage",
        Some("turn-2"),
        json!({
            "backend": "runtime",
            "attempt": 1,
            "modelContextWindow": 128000,
            "usage": {"input_tokens": 10, "cached_input_tokens": 3, "cache_creation_input_tokens": 3, "output_tokens": 4}
        }),
    );
    canonicalize_runtime_usage_event(&mut usage_one, std::slice::from_ref(&previous), &[]);
    let mut usage_one_revised = event(
        3,
        "provider.usage",
        Some("turn-2"),
        json!({
            "backend": "runtime",
            "attempt": 1,
            "modelContextWindow": 128000,
            "usage": {"input_tokens": 20, "cached_input_tokens": 5, "cache_creation_input_tokens": 5, "output_tokens": 6}
        }),
    );
    canonicalize_runtime_usage_event(
        &mut usage_one_revised,
        std::slice::from_ref(&previous),
        std::slice::from_ref(&usage_one),
    );
    let mut usage_two = event(
        4,
        "provider.usage",
        Some("turn-2"),
        json!({
            "backend": "runtime",
            "attempt": 2,
            "modelContextWindow": 128000,
            "usage": {"input_tokens": 10, "cached_input_tokens": 3, "cache_creation_input_tokens": 3, "output_tokens": 4}
        }),
    );
    canonicalize_runtime_usage_event(
        &mut usage_two,
        std::slice::from_ref(&previous),
        &[usage_one.clone(), usage_one_revised.clone()],
    );

    let failed_snapshot = thread_token_usage_snapshot_from_events(&[
        previous.clone(),
        usage_one.clone(),
        usage_one_revised.clone(),
        usage_two.clone(),
    ])
    .expect("provider usage remains available to a failed terminal");
    assert_eq!(failed_snapshot.total_token_usage.input_tokens, 130);
    assert_eq!(failed_snapshot.total_token_usage.cached_input_tokens, 28);
    assert_eq!(
        failed_snapshot.total_token_usage.cache_write_input_tokens,
        18
    );
    assert_eq!(failed_snapshot.total_token_usage.output_tokens, 50);

    let mut completed = event(
        5,
        "turn.completed",
        Some("turn-2"),
        json!({
            "backend": "runtime",
            "modelContextWindow": 128000,
            "usage": {"input_tokens": 30, "cached_input_tokens": 8, "cache_creation_input_tokens": 8, "output_tokens": 10}
        }),
    );
    canonicalize_runtime_usage_event(
        &mut completed,
        std::slice::from_ref(&previous),
        &[
            usage_one.clone(),
            usage_one_revised.clone(),
            usage_two.clone(),
        ],
    );
    let completed_snapshot = thread_token_usage_snapshot_from_events(&[
        previous,
        usage_one,
        usage_one_revised,
        usage_two,
        completed,
    ])
    .expect("completed usage remains canonical");
    assert_eq!(completed_snapshot.total_token_usage.input_tokens, 130);
    assert_eq!(completed_snapshot.total_token_usage.cached_input_tokens, 28);
    assert_eq!(
        completed_snapshot
            .total_token_usage
            .cache_write_input_tokens,
        18
    );
    assert_eq!(completed_snapshot.total_token_usage.output_tokens, 50);
    assert_eq!(completed_snapshot.last_token_usage.input_tokens, 30);
    assert_eq!(
        completed_snapshot.last_token_usage.cache_write_input_tokens,
        8
    );
}

#[test]
fn goal_token_delta_matches_host_billable_formula() {
    let baseline = TokenUsageSnapshot {
        input_tokens: 100,
        cached_input_tokens: 30,
        cache_write_input_tokens: 0,
        output_tokens: 20,
        reasoning_output_tokens: 5,
        total_tokens: 120,
    };
    let current = TokenUsageSnapshot {
        input_tokens: 160,
        cached_input_tokens: 50,
        cache_write_input_tokens: 0,
        output_tokens: 35,
        reasoning_output_tokens: 10,
        total_tokens: 195,
    };

    assert_eq!(goal_token_delta_since(&baseline, &current), 55);
}
