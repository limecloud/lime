use super::*;
use serde_json::json;

fn usage() -> ThreadTokenUsage {
    serde_json::from_value(json!({
        "total": {"totalTokens": 161000, "inputTokens": 155000, "cachedInputTokens": 130000,
            "cacheWriteInputTokens": 500, "outputTokens": 6000, "reasoningOutputTokens": 2000},
        "last": {"totalTokens": 31000, "inputTokens": 30000, "cachedInputTokens": 10000,
            "outputTokens": 1000, "reasoningOutputTokens": 500},
        "modelContextWindow": 128000
    }))
    .unwrap()
}

#[test]
fn totals_and_context_use_distinct_canonical_counts_without_double_counting_caches() {
    let usage = usage();
    assert_eq!(blended_total(&usage.total), 31000);
    assert_eq!(percent_of_context_window_remaining(&usage), Some(84));
    let values = [
        (StatusLineItem::UsedTokens, "31K used"),
        (StatusLineItem::TotalInputTokens, "155K in"),
        (StatusLineItem::TotalOutputTokens, "6K out"),
        (StatusLineItem::ContextWindowSize, "128K window"),
        (StatusLineItem::ContextRemaining, "Context 84% left"),
        (StatusLineItem::ContextUsed, "Context 16% used"),
    ];
    for (item, expected) in values {
        assert_eq!(
            token_usage_value(item, &usage, Locale::EnUs).as_deref(),
            Some(expected)
        );
    }
}

#[test]
fn compact_tokens_match_codex_precision_and_remain_safe_at_integer_limits() {
    for (count, expected) in [
        (i64::MIN, "0"),
        (-1, "0"),
        (0, "0"),
        (999, "999"),
        (1000, "1K"),
        (1234, "1.23K"),
        (12345, "12.3K"),
        (123456, "123K"),
        (1234567, "1.23M"),
        (1234567890, "1.23B"),
        (1234567890123, "1.23T"),
        (i64::MAX, "9223372T"),
    ] {
        assert_eq!(format_tokens_compact(count), expected, "count={count}");
    }
    let mut usage = usage();
    usage.total.input_tokens = i64::MAX;
    usage.total.cached_input_tokens = i64::MIN;
    usage.total.output_tokens = i64::MAX;
    assert_eq!(blended_total(&usage.total), i64::MAX);
    usage.total.cached_input_tokens = i64::MAX;
    usage.total.input_tokens = i64::MIN;
    usage.total.output_tokens = -1;
    assert_eq!(blended_total(&usage.total), 0);
    assert!(token_usage_value(StatusLineItem::UsedTokens, &usage, Locale::EnUs).is_none());
    assert_eq!(
        token_usage_value(StatusLineItem::TotalOutputTokens, &usage, Locale::EnUs).as_deref(),
        Some("0 out")
    );
}

#[test]
fn context_is_bounded_and_unknown_windows_do_not_fabricate_percentages() {
    let mut usage = usage();
    for window in [None, Some(0), Some(-1), Some(i64::MIN)] {
        usage.model_context_window = window;
        for item in [
            StatusLineItem::ContextRemaining,
            StatusLineItem::ContextUsed,
            StatusLineItem::ContextWindowSize,
        ] {
            assert!(token_usage_value(item, &usage, Locale::EnUs).is_none());
        }
        assert_eq!(
            token_usage_value(StatusLineItem::UsedTokens, &usage, Locale::EnUs).as_deref(),
            Some("31K used")
        );
    }
    for (window, last, expected) in [
        (12000, 0, 0),
        (128000, 12000, 100),
        (128000, i64::MIN, 100),
        (128000, 128000, 0),
        (128000, i64::MAX, 0),
        (i64::MAX, i64::MAX, 0),
    ] {
        usage.model_context_window = Some(window);
        usage.last.total_tokens = last;
        assert_eq!(percent_of_context_window_remaining(&usage), Some(expected));
    }
}
