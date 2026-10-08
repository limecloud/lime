//! Codex token display semantics shared by the footer, title, setup preview and `/status`.

use app_server_protocol::protocol::v2::{ThreadTokenUsage, TokenUsageBreakdown};

use crate::bottom_pane::status_line_setup::StatusLineItem;
use crate::locale::Locale;

// Prompts, fixed tools and space to compact are not user-controllable context.
const BASELINE_TOKENS: i64 = 12_000;

pub(crate) fn blended_total(usage: &TokenUsageBreakdown) -> i64 {
    usage
        .input_tokens
        .max(0)
        .saturating_sub(usage.cached_input_tokens.max(0))
        .max(0)
        .saturating_add(usage.output_tokens.max(0))
}

pub(crate) fn percent_of_context_window_remaining(usage: &ThreadTokenUsage) -> Option<i64> {
    let window = usage.model_context_window.filter(|window| *window > 0)?;
    if window <= BASELINE_TOKENS {
        return Some(0);
    }
    let effective_window = window - BASELINE_TOKENS;
    let used = usage
        .last
        .total_tokens
        .saturating_sub(BASELINE_TOKENS)
        .max(0);
    let remaining = effective_window.saturating_sub(used).max(0);
    Some(
        ((remaining as f64 / effective_window as f64) * 100.0)
            .clamp(0.0, 100.0)
            .round() as i64,
    )
}

pub(crate) fn format_tokens_compact(value: i64) -> String {
    let value = value.max(0);
    if value < 1_000 {
        return value.to_string();
    }
    let (divisor, suffix) = if value >= 1_000_000_000_000 {
        (1_000_000_000_000.0, "T")
    } else if value >= 1_000_000_000 {
        (1_000_000_000.0, "B")
    } else if value >= 1_000_000 {
        (1_000_000.0, "M")
    } else {
        (1_000.0, "K")
    };
    let scaled = value as f64 / divisor;
    let decimals = if scaled < 10.0 {
        2
    } else if scaled < 100.0 {
        1
    } else {
        0
    };
    let mut formatted = format!("{scaled:.decimals$}");
    if formatted.contains('.') {
        while formatted.ends_with('0') {
            formatted.pop();
        }
        if formatted.ends_with('.') {
            formatted.pop();
        }
    }
    format!("{formatted}{suffix}")
}

pub(crate) fn token_usage_value(
    item: StatusLineItem,
    usage: &ThreadTokenUsage,
    locale: Locale,
) -> Option<String> {
    let value = match item {
        StatusLineItem::UsedTokens => {
            let total = blended_total(&usage.total);
            (total > 0).then(|| format_tokens_compact(total))?
        }
        StatusLineItem::TotalInputTokens => format_tokens_compact(usage.total.input_tokens),
        StatusLineItem::TotalOutputTokens => format_tokens_compact(usage.total.output_tokens),
        StatusLineItem::ContextWindowSize => {
            format_tokens_compact(usage.model_context_window.filter(|window| *window > 0)?)
        }
        StatusLineItem::ContextRemaining => percent_of_context_window_remaining(usage)?.to_string(),
        StatusLineItem::ContextUsed => {
            (100 - percent_of_context_window_remaining(usage)?).to_string()
        }
        _ => return None,
    };
    Some(locale.token_usage_value(item, &value))
}

#[cfg(test)]
#[path = "helpers_tests.rs"]
mod tests;
