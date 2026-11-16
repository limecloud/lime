use super::*;
use serde_json::json;

#[test]
fn analyze_tool_io_value_payload_should_include_bytes_chars_and_tokens() {
    let payload = json!({
        "path": "docs/out.md",
        "content": "hello world"
    });

    let stats = analyze_tool_io_value_payload(&payload);
    assert!(stats.bytes > 0);
    assert!(stats.chars > 0);
    assert!(stats.tokens > 0);
}

#[test]
fn resolve_tool_io_eviction_policy_should_use_model_context_window_when_available() {
    let policy = resolve_tool_io_eviction_policy(
        Some("gpt-4.1"),
        ToolIoEvictionConfig {
            fallback_context_max_input_tokens: 170_000,
            ..ToolIoEvictionConfig::default()
        },
    );

    assert_eq!(policy.context_max_input_tokens, 1_000_000);
    assert_eq!(policy.context_trigger_tokens(), 850_000);
}

#[test]
fn resolve_tool_io_eviction_policy_should_fallback_when_model_hint_missing() {
    let policy = resolve_tool_io_eviction_policy(
        None,
        ToolIoEvictionConfig {
            fallback_context_max_input_tokens: 222_000,
            ..ToolIoEvictionConfig::default()
        },
    );

    assert_eq!(policy.context_max_input_tokens, 222_000);
}

#[test]
fn resolve_tool_io_offload_decision_should_prioritize_token_limit() {
    let decision = resolve_tool_io_offload_decision(
        ToolIoPayloadStats {
            chars: 10_000,
            bytes: 10_000,
            tokens: 2_001,
        },
        ToolIoEvictionPolicy {
            token_limit_before_evict: 2_000,
            context_max_input_tokens: 100_000,
            context_window_trigger_ratio: 0.85,
            keep_recent_messages: 6,
        },
        ToolIoOffloadThresholds {
            max_bytes: 100_000,
            max_chars: 100_000,
        },
    )
    .expect("should offload");

    assert_eq!(
        decision.trigger,
        ToolIoOffloadTrigger::TokenLimitBeforeEvict
    );
    assert_eq!(decision.trigger.as_str(), "token_limit_before_evict");
}

#[test]
fn build_tool_io_preview_should_limit_lines_and_chars() {
    let preview = build_tool_io_preview(
        "line1\nline2\nline3",
        ToolIoPreviewConfig {
            max_lines: 2,
            max_chars: 8,
        },
    );

    assert_eq!(preview, "line1\nli\n...");
}

#[test]
fn build_tool_io_payload_envelope_should_include_kind_timestamp_and_payload() {
    let envelope = build_tool_io_payload_envelope("tool_result", json!({"ok": true}));

    assert_eq!(envelope["kind"], json!("tool_result"));
    assert!(
        envelope["generated_at"]
            .as_str()
            .unwrap_or_default()
            .contains('T')
    );
    assert_eq!(envelope["payload"], json!({"ok": true}));
}

#[test]
fn build_tool_io_notice_text_should_prefix_preview_when_present() {
    let with_preview = build_tool_io_notice_text("preview", "notice");
    assert_eq!(with_preview, "preview\n\nnotice");

    let without_preview = build_tool_io_notice_text("  ", "notice");
    assert_eq!(without_preview, "notice");
}

#[test]
fn resolve_tool_io_offload_decision_should_use_payload_thresholds() {
    let by_bytes = resolve_tool_io_offload_decision(
        ToolIoPayloadStats {
            chars: 100,
            bytes: 9_000,
            tokens: 100,
        },
        ToolIoEvictionPolicy {
            token_limit_before_evict: 2_000,
            context_max_input_tokens: 100_000,
            context_window_trigger_ratio: 0.85,
            keep_recent_messages: 6,
        },
        ToolIoOffloadThresholds {
            max_bytes: 8_192,
            max_chars: 10_000,
        },
    )
    .expect("should offload by bytes");
    assert_eq!(by_bytes.trigger, ToolIoOffloadTrigger::PayloadBytes);

    let by_chars = resolve_tool_io_offload_decision(
        ToolIoPayloadStats {
            chars: 9_000,
            bytes: 4_000,
            tokens: 100,
        },
        ToolIoEvictionPolicy {
            token_limit_before_evict: 2_000,
            context_max_input_tokens: 100_000,
            context_window_trigger_ratio: 0.85,
            keep_recent_messages: 6,
        },
        ToolIoOffloadThresholds {
            max_bytes: 8_192,
            max_chars: 8_192,
        },
    )
    .expect("should offload by chars");
    assert_eq!(by_chars.trigger, ToolIoOffloadTrigger::PayloadChars);
}

#[test]
fn build_tool_io_history_eviction_plan_should_select_old_candidates_until_under_trigger() {
    let policy = ToolIoEvictionPolicy {
        token_limit_before_evict: DEFAULT_TOOL_TOKEN_LIMIT_BEFORE_EVICT,
        context_max_input_tokens: 1_000,
        context_window_trigger_ratio: 0.5,
        keep_recent_messages: 1,
    };
    let messages = vec![
        ToolIoHistoryMessageAnalysis {
            total_tokens: 260,
            candidates: vec![ToolIoHistoryEvictionCandidate {
                reduction_tokens: 100,
            }],
        },
        ToolIoHistoryMessageAnalysis {
            total_tokens: 220,
            candidates: vec![ToolIoHistoryEvictionCandidate {
                reduction_tokens: 120,
            }],
        },
        ToolIoHistoryMessageAnalysis {
            total_tokens: 180,
            candidates: vec![ToolIoHistoryEvictionCandidate {
                reduction_tokens: 150,
            }],
        },
    ];

    let plan = build_tool_io_history_eviction_plan(&messages, policy);

    assert_eq!(plan.total_tokens, 660);
    assert_eq!(plan.trigger_tokens, 500);
    assert_eq!(plan.projected_tokens, 440);
    assert_eq!(plan.keep_recent_messages, 1);
    assert_eq!(
        plan.selections,
        vec![
            ToolIoHistoryEvictionSelection {
                message_index: 0,
                candidate_index: 0,
            },
            ToolIoHistoryEvictionSelection {
                message_index: 1,
                candidate_index: 0,
            },
        ]
    );
}

#[test]
fn build_tool_io_history_eviction_plan_should_skip_when_under_trigger() {
    let policy = ToolIoEvictionPolicy {
        token_limit_before_evict: DEFAULT_TOOL_TOKEN_LIMIT_BEFORE_EVICT,
        context_max_input_tokens: 1_000,
        context_window_trigger_ratio: 0.5,
        keep_recent_messages: 1,
    };
    let messages = vec![
        ToolIoHistoryMessageAnalysis {
            total_tokens: 120,
            candidates: vec![ToolIoHistoryEvictionCandidate {
                reduction_tokens: 80,
            }],
        },
        ToolIoHistoryMessageAnalysis {
            total_tokens: 140,
            candidates: vec![ToolIoHistoryEvictionCandidate {
                reduction_tokens: 90,
            }],
        },
    ];

    let plan = build_tool_io_history_eviction_plan(&messages, policy);

    assert_eq!(plan.total_tokens, 260);
    assert_eq!(plan.projected_tokens, 260);
    assert!(plan.selections.is_empty());
}

#[test]
fn token_policy_formats_large_output_with_codex_style_warning() {
    let output = "alpha beta gamma delta epsilon zeta eta theta iota kappa";
    let formatted = format_tool_output_for_model(output, TruncationPolicy::Tokens(4));

    assert!(formatted.starts_with("Warning: truncated output (original token count:"));
    assert!(formatted.contains("Total output lines: 1"));
    assert!(formatted.contains("tokens truncated"));
    assert!(formatted.contains("alpha"));
    assert!(formatted.contains("kappa"));
}

#[test]
fn token_policy_keeps_small_output_unchanged() {
    let output = "small output";

    assert_eq!(
        format_tool_output_for_model(output, TruncationPolicy::Tokens(64)),
        output
    );
}

#[test]
fn byte_policy_preserves_utf8_boundaries() {
    let formatted =
        format_tool_output_for_model("你好，世界。hello world", TruncationPolicy::Bytes(18));

    assert!(formatted.contains("chars truncated"));
    assert!(formatted.contains("你好"));
    assert!(formatted.contains("world"));
}

#[test]
fn history_budget_has_no_warning_header_and_uses_provider_neutral_tokens() {
    assert_eq!(
        truncate_tool_output("abcdefghijklmnopqrst", TruncationPolicy::Tokens(2)),
        "abcd…3 tokens truncated…qrst"
    );
    assert_eq!(
        truncate_tool_output("你好世界", TruncationPolicy::Bytes(0)),
        "…4 chars truncated…"
    );
    assert_eq!(
        TruncationPolicy::Bytes(101).with_serialization_allowance(),
        TruncationPolicy::Bytes(122)
    );
    assert_eq!(
        TruncationPolicy::Tokens(usize::MAX)
            .with_serialization_allowance()
            .byte_budget(),
        usize::MAX
    );
}
