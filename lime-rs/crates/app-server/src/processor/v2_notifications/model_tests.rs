use super::*;

#[test]
fn maps_runtime_model_reconciliation_to_thread_settings_updated() {
    let mut projector = V2NotificationProjector::default();
    let notifications = projector
        .project(event(
            "thread.settings.updated",
            json!({
                "threadSettings": {
                    "cwd": "",
                    "approvalPolicy": null,
                    "approvalsReviewer": null,
                    "sandboxPolicy": null,
                    "model": "model-b",
                    "modelProvider": "provider-b",
                    "collaborationMode": {
                        "mode": "default",
                        "settings": { "model": "model-b" }
                    }
                }
            }),
        ))
        .expect("thread settings update");

    assert_eq!(notifications.len(), 1);
    assert_eq!(notifications[0].method, "thread/settings/updated");
    assert_eq!(
        notifications[0].params.as_ref().expect("settings params")["threadSettings"]["model"],
        "model-b"
    );
}

#[test]
fn maps_terminal_usage_to_direct_v2_notification_without_context_window() {
    let mut projector = V2NotificationProjector::default();
    let notifications = projector
        .project(event(
            "turn.completed",
            json!({
                "turn": canonical_turn("completed"),
                "usage": {
                    "total_token_usage": {
                        "total_tokens": 31_000,
                        "input_tokens": 31_000,
                        "cached_input_tokens": 0,
                        "output_tokens": 0,
                        "reasoning_output_tokens": 0
                    },
                    "last_token_usage": {
                        "total_tokens": 31_000,
                        "input_tokens": 31_000,
                        "cached_input_tokens": 0,
                        "output_tokens": 0,
                        "reasoning_output_tokens": 0
                    }
                }
            }),
        ))
        .expect("terminal usage");

    assert_eq!(notifications.len(), 2);
    assert_eq!(notifications[0].method, "thread/tokenUsage/updated");
    assert_eq!(notifications[1].method, "turn/completed");
    let params = notifications[0].params.as_ref().expect("usage params");
    assert_eq!(params["tokenUsage"]["last"]["inputTokens"], 31_000);
    assert_eq!(params["tokenUsage"]["modelContextWindow"], Value::Null);
}

#[test]
fn maps_provider_safety_buffering_to_direct_codex_notification() {
    let mut projector = V2NotificationProjector::default();
    let notifications = projector
        .project(event(
            "provider_safety_buffering",
            json!({
                "provider": "openai",
                "model": "gpt-5-codex",
                "useCases": ["policy"],
                "reasons": ["buffering"],
                "showBufferingUi": true,
                "retryModel": "gpt-5-mini"
            }),
        ))
        .expect("direct safety buffering notification");

    assert_eq!(notifications.len(), 1);
    assert_eq!(notifications[0].method, "model/safetyBuffering/updated");
    assert_eq!(
        notifications[0]
            .params
            .as_ref()
            .expect("notification params"),
        &json!({
            "threadId": "thread-1",
            "turnId": "turn-1",
            "model": "gpt-5-codex",
            "useCases": ["policy"],
            "reasons": ["buffering"],
            "showBufferingUi": true,
            "fasterModel": "gpt-5-mini"
        })
    );
}

#[test]
fn maps_model_reroute_once_per_turn_to_direct_codex_notification() {
    let mut projector = V2NotificationProjector::default();
    let model_event = event(
        "model.rerouted",
        json!({
            "from_model": "gpt-5-codex",
            "to_model": "gpt-5.1-codex",
            "reason": "high_risk_cyber_activity"
        }),
    );
    let notifications = projector
        .project(model_event.clone())
        .expect("direct model reroute notification");

    assert_eq!(notifications.len(), 1);
    assert_eq!(notifications[0].method, "model/rerouted");
    assert_eq!(
        notifications[0].params.as_ref().expect("reroute params"),
        &json!({
            "threadId": "thread-1",
            "turnId": "turn-1",
            "fromModel": "gpt-5-codex",
            "toModel": "gpt-5.1-codex",
            "reason": "highRiskCyberActivity"
        })
    );
    assert!(projector
        .project(model_event)
        .expect("duplicate reroute is ignored")
        .is_empty());
}

#[test]
fn maps_model_verification_once_per_turn_to_direct_codex_notification() {
    let mut projector = V2NotificationProjector::default();
    let model_event = event(
        "model.verification",
        json!({"verifications": ["trusted_access_for_cyber"]}),
    );
    let notifications = projector
        .project(model_event.clone())
        .expect("direct model verification notification");

    assert_eq!(notifications.len(), 1);
    assert_eq!(notifications[0].method, "model/verification");
    assert_eq!(
        notifications[0]
            .params
            .as_ref()
            .expect("verification params"),
        &json!({
            "threadId": "thread-1",
            "turnId": "turn-1",
            "verifications": ["trustedAccessForCyber"]
        })
    );
    assert!(projector
        .project(model_event)
        .expect("duplicate verification is ignored")
        .is_empty());
}

#[test]
fn maps_each_turn_moderation_metadata_update_to_exact_codex_notification() {
    let mut projector = V2NotificationProjector::default();
    let first = projector
        .project(event(
            "turn.moderation_metadata",
            json!({ "metadata": { "presentation": "inline" } }),
        ))
        .expect("first moderation metadata notification");
    let second = projector
        .project(event(
            "turn.moderation_metadata",
            json!({ "metadata": null }),
        ))
        .expect("second moderation metadata notification");

    assert_eq!(first.len(), 1);
    assert_eq!(first[0].method, "turn/moderationMetadata");
    assert_eq!(
        first[0].params.as_ref().expect("moderation params"),
        &json!({
            "threadId": "thread-1",
            "turnId": "turn-1",
            "metadata": { "presentation": "inline" }
        })
    );
    assert_eq!(second.len(), 1);
    assert_eq!(
        second[0]
            .params
            .as_ref()
            .expect("updated moderation params"),
        &json!({
            "threadId": "thread-1",
            "turnId": "turn-1",
            "metadata": null
        })
    );
}

#[test]
fn turn_moderation_metadata_fails_closed_without_identity_or_metadata() {
    for payload in [json!({}), json!({ "legacyMetadata": {} })] {
        let error = V2NotificationProjector::default()
            .project(event("turn.moderation_metadata", payload))
            .expect_err("missing moderation metadata must fail closed");
        assert_eq!(error.code, error_codes::RUNTIME_ERROR);
        assert!(error.message.contains("turn.moderation_metadata"));
    }

    let mut missing_identity = event(
        "turn.moderation_metadata",
        json!({ "metadata": { "presentation": "inline" } }),
    );
    missing_identity.thread_id = None;
    assert!(V2NotificationProjector::default()
        .project(missing_identity)
        .is_err());
}

#[test]
fn model_verification_and_server_model_fail_closed_at_v2_boundary() {
    for payload in [
        json!({}),
        json!({
            "from_model": "",
            "to_model": "gpt-5.1-codex",
            "reason": "high_risk_cyber_activity"
        }),
        json!({
            "from_model": "gpt-5-codex",
            "to_model": "gpt-5.1-codex",
            "reason": "unknown"
        }),
    ] {
        let error = V2NotificationProjector::default()
            .project(event("model.rerouted", payload))
            .expect_err("malformed reroute must fail closed");
        assert_eq!(error.code, error_codes::RUNTIME_ERROR);
        assert!(error.message.contains("model.rerouted"));
    }

    for payload in [
        json!({}),
        json!({"verifications": []}),
        json!({"verifications": ["unknown"]}),
        json!({"verifications": "trusted_access_for_cyber"}),
    ] {
        let error = V2NotificationProjector::default()
            .project(event("model.verification", payload))
            .expect_err("malformed verification must fail closed");
        assert_eq!(error.code, error_codes::RUNTIME_ERROR);
        assert!(error.message.contains("model.verification"));
    }

    let mut missing_identity = event(
        "model.verification",
        json!({"verifications": ["trusted_access_for_cyber"]}),
    );
    missing_identity.turn_id = None;
    assert!(V2NotificationProjector::default()
        .project(missing_identity)
        .is_err());

    assert!(V2NotificationProjector::default()
        .project(event(
            "model.server_reported",
            json!({"model": "gpt-5-codex"}),
        ))
        .expect("server model is diagnostic-only")
        .is_empty());
}

#[test]
fn malformed_provider_safety_buffering_is_rejected_without_side_channel_fallback() {
    let invalid_payloads = [
        json!({
            "useCases": ["policy"],
            "reasons": ["buffering"],
            "showBufferingUi": true
        }),
        json!({
            "model": "gpt-5-codex",
            "useCases": ["policy", 1],
            "reasons": ["buffering"],
            "showBufferingUi": true
        }),
        json!({
            "model": "gpt-5-codex",
            "useCases": ["policy"],
            "reasons": "buffering",
            "showBufferingUi": true
        }),
    ];

    for payload in invalid_payloads {
        let mut projector = V2NotificationProjector::default();
        let error = projector
            .project(event("provider_safety_buffering", payload))
            .expect_err("malformed safety buffering must fail closed");
        assert_eq!(error.code, error_codes::RUNTIME_ERROR);
        assert!(error.message.contains("provider_safety_buffering"));
    }

    let mut missing_identity = event(
        "provider_safety_buffering",
        json!({
            "model": "gpt-5-codex",
            "useCases": [],
            "reasons": [],
            "showBufferingUi": false
        }),
    );
    missing_identity.turn_id = None;
    assert!(V2NotificationProjector::default()
        .project(missing_identity)
        .is_err());
}

#[test]
fn maps_canonical_provider_usage_to_direct_v2_notification() {
    let mut projector = V2NotificationProjector::default();
    let notifications = projector
        .project(event(
            "provider.usage",
            json!({
                "usage": {
                    "total_token_usage": {
                        "total_tokens": 31_000,
                        "input_tokens": 31_000,
                        "cached_input_tokens": 0,
                        "cache_write_input_tokens": 12,
                        "output_tokens": 0,
                        "reasoning_output_tokens": 0
                    },
                    "last_token_usage": {
                        "total_tokens": 31_000,
                        "input_tokens": 31_000,
                        "cached_input_tokens": 0,
                        "cache_write_input_tokens": 12,
                        "output_tokens": 0,
                        "reasoning_output_tokens": 0
                    },
                    "model_context_window": 128_000
                }
            }),
        ))
        .expect("provider usage");

    assert_eq!(notifications[0].method, "thread/tokenUsage/updated");
    let params = notifications[0].params.as_ref().expect("usage params");
    assert_eq!(params["threadId"], "thread-1");
    assert_eq!(params["turnId"], "turn-1");
    assert_eq!(params["tokenUsage"]["last"]["inputTokens"], 31_000);
    assert_eq!(params["tokenUsage"]["last"]["cacheWriteInputTokens"], 12);
}
