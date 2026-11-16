//! Tool I/O policy utilities.
//!
//! This module owns reusable, model-aware helpers for applications that need to
//! manage large tool inputs and outputs under context window pressure.

use agent_protocol::model_context::resolve_model_context_window_or;
use agent_protocol::truncation::TruncationPolicy;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::sync::OnceLock;

const TOKEN_ENCODER_INIT_STACK_SIZE: usize = 16 * 1024 * 1024;
const CHARS_PER_TOKEN_DEFAULT: f64 = 3.5;
const CHARS_PER_TOKEN_ASIAN: f64 = 2.0;
const CHARS_PER_TOKEN_CODE: f64 = 3.0;

/// Default token threshold before a tool payload becomes an eviction candidate.
pub const DEFAULT_TOOL_TOKEN_LIMIT_BEFORE_EVICT: usize = 20_000;

/// Default fallback context window when no model profile is available.
pub const DEFAULT_CONTEXT_WINDOW_MAX_INPUT_TOKENS: usize = 170_000;

/// Default trigger ratio for context window pressure.
pub const DEFAULT_CONTEXT_WINDOW_TRIGGER_RATIO: f64 = 0.85;

/// Default number of recent messages to keep untouched during history eviction.
pub const DEFAULT_CONTEXT_WINDOW_KEEP_RECENT_MESSAGES: usize = 6;

/// Default number of preview lines kept for offloaded tool payloads.
pub const DEFAULT_TOOL_IO_PREVIEW_MAX_LINES: usize = 10;

/// Default maximum characters kept in an offload preview.
pub const DEFAULT_TOOL_IO_PREVIEW_MAX_CHARS: usize = 2_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ToolIoPayloadStats {
    pub chars: usize,
    pub bytes: usize,
    pub tokens: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolOutputTruncationReason {
    ByteLimit,
    TokenLimit,
    PayloadOffloaded,
    ContextPressure,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolOutputTruncation {
    pub reason: ToolOutputTruncationReason,
    pub original_chars: usize,
    pub original_bytes: usize,
    pub original_tokens: usize,
}

impl ToolOutputTruncation {
    pub fn new(reason: ToolOutputTruncationReason, stats: ToolIoPayloadStats) -> Self {
        Self {
            reason,
            original_chars: stats.chars,
            original_bytes: stats.bytes,
            original_tokens: stats.tokens,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolOutputReference {
    pub reference: String,
    pub preview: Option<String>,
}

impl ToolOutputReference {
    pub fn new(reference: impl Into<String>, preview: Option<String>) -> Self {
        Self {
            reference: reference.into(),
            preview,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ToolIoEvictionConfig {
    pub token_limit_before_evict: usize,
    pub fallback_context_max_input_tokens: usize,
    pub context_window_trigger_ratio: f64,
    pub keep_recent_messages: usize,
}

impl Default for ToolIoEvictionConfig {
    fn default() -> Self {
        Self {
            token_limit_before_evict: DEFAULT_TOOL_TOKEN_LIMIT_BEFORE_EVICT,
            fallback_context_max_input_tokens: DEFAULT_CONTEXT_WINDOW_MAX_INPUT_TOKENS,
            context_window_trigger_ratio: DEFAULT_CONTEXT_WINDOW_TRIGGER_RATIO,
            keep_recent_messages: DEFAULT_CONTEXT_WINDOW_KEEP_RECENT_MESSAGES,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ToolIoEvictionPolicy {
    pub token_limit_before_evict: usize,
    pub context_max_input_tokens: usize,
    pub context_window_trigger_ratio: f64,
    pub keep_recent_messages: usize,
}

impl ToolIoEvictionPolicy {
    pub fn context_trigger_tokens(&self) -> usize {
        ((self.context_max_input_tokens as f64) * self.context_window_trigger_ratio).floor()
            as usize
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ToolIoHistoryEvictionCandidate {
    pub reduction_tokens: usize,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ToolIoHistoryMessageAnalysis {
    pub total_tokens: usize,
    pub candidates: Vec<ToolIoHistoryEvictionCandidate>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ToolIoHistoryEvictionSelection {
    pub message_index: usize,
    pub candidate_index: usize,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ToolIoHistoryEvictionPlan {
    pub selections: Vec<ToolIoHistoryEvictionSelection>,
    pub total_tokens: usize,
    pub trigger_tokens: usize,
    pub projected_tokens: usize,
    pub keep_recent_messages: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ToolIoOffloadThresholds {
    pub max_bytes: usize,
    pub max_chars: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolIoOffloadTrigger {
    TokenLimitBeforeEvict,
    PayloadBytes,
    PayloadChars,
    HistoryContextPressure,
}

impl ToolIoOffloadTrigger {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::TokenLimitBeforeEvict => "token_limit_before_evict",
            Self::PayloadBytes => "payload_bytes",
            Self::PayloadChars => "payload_chars",
            Self::HistoryContextPressure => "history_context_pressure",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ToolIoOffloadDecision {
    pub trigger: ToolIoOffloadTrigger,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ToolIoPreviewConfig {
    pub max_lines: usize,
    pub max_chars: usize,
}

impl Default for ToolIoPreviewConfig {
    fn default() -> Self {
        Self {
            max_lines: DEFAULT_TOOL_IO_PREVIEW_MAX_LINES,
            max_chars: DEFAULT_TOOL_IO_PREVIEW_MAX_CHARS,
        }
    }
}

fn token_encoder() -> Option<&'static tiktoken_rs::CoreBPE> {
    static TOKEN_ENCODER: OnceLock<Option<tiktoken_rs::CoreBPE>> = OnceLock::new();
    TOKEN_ENCODER.get_or_init(init_token_encoder).as_ref()
}

fn init_token_encoder() -> Option<tiktoken_rs::CoreBPE> {
    std::thread::Builder::new()
        .name("tool-io-token-encoder-init".to_string())
        .stack_size(TOKEN_ENCODER_INIT_STACK_SIZE)
        .spawn(|| tiktoken_rs::o200k_base().ok())
        .ok()?
        .join()
        .ok()
        .flatten()
}

pub fn estimate_tool_io_tokens(text: &str) -> usize {
    token_encoder()
        .map(|encoder| encoder.encode_with_special_tokens(text).len())
        .unwrap_or_else(|| estimate_tokens_heuristic(text))
}

pub fn analyze_tool_io_text_payload(text: &str) -> ToolIoPayloadStats {
    ToolIoPayloadStats {
        chars: text.chars().count(),
        bytes: text.len(),
        tokens: estimate_tool_io_tokens(text),
    }
}

pub fn analyze_tool_io_value_payload(value: &Value) -> ToolIoPayloadStats {
    let serialized = serde_json::to_string(value).unwrap_or_default();
    ToolIoPayloadStats {
        chars: serialized.chars().count(),
        bytes: serialized.len(),
        tokens: estimate_tool_io_tokens(&serialized),
    }
}

pub fn resolve_model_context_max_input_tokens(model_name: Option<&str>, fallback: usize) -> usize {
    resolve_model_context_window_or(model_name, fallback)
}

pub fn resolve_tool_io_eviction_policy(
    model_name: Option<&str>,
    config: ToolIoEvictionConfig,
) -> ToolIoEvictionPolicy {
    ToolIoEvictionPolicy {
        token_limit_before_evict: config.token_limit_before_evict,
        context_max_input_tokens: resolve_model_context_max_input_tokens(
            model_name,
            config.fallback_context_max_input_tokens,
        ),
        context_window_trigger_ratio: config.context_window_trigger_ratio,
        keep_recent_messages: config.keep_recent_messages,
    }
}

pub fn resolve_tool_io_offload_decision(
    stats: ToolIoPayloadStats,
    policy: ToolIoEvictionPolicy,
    thresholds: ToolIoOffloadThresholds,
) -> Option<ToolIoOffloadDecision> {
    if stats.tokens > policy.token_limit_before_evict {
        return Some(ToolIoOffloadDecision {
            trigger: ToolIoOffloadTrigger::TokenLimitBeforeEvict,
        });
    }
    if stats.bytes > thresholds.max_bytes {
        return Some(ToolIoOffloadDecision {
            trigger: ToolIoOffloadTrigger::PayloadBytes,
        });
    }
    if stats.chars > thresholds.max_chars {
        return Some(ToolIoOffloadDecision {
            trigger: ToolIoOffloadTrigger::PayloadChars,
        });
    }

    None
}

pub fn build_tool_io_preview(raw: &str, config: ToolIoPreviewConfig) -> String {
    let preview_lines = raw
        .lines()
        .take(config.max_lines)
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();

    if preview_lines.is_empty() {
        return String::new();
    }

    let mut preview = preview_lines
        .chars()
        .take(config.max_chars)
        .collect::<String>();
    if preview.chars().count() < preview_lines.chars().count() {
        preview.push_str("\n...");
    }
    preview
}

pub fn build_tool_io_payload_envelope(kind: &str, payload: Value) -> Value {
    json!({
        "kind": kind,
        "generated_at": Utc::now().to_rfc3339(),
        "payload": payload,
    })
}

pub fn build_tool_io_notice_text(preview: &str, notice: &str) -> String {
    if preview.trim().is_empty() {
        return notice.to_string();
    }

    format!("{preview}\n\n{notice}")
}

pub fn build_tool_io_history_eviction_plan(
    messages: &[ToolIoHistoryMessageAnalysis],
    policy: ToolIoEvictionPolicy,
) -> ToolIoHistoryEvictionPlan {
    let trigger_tokens = policy.context_trigger_tokens();
    let keep_recent_messages = policy.keep_recent_messages.min(messages.len());
    let total_tokens = messages.iter().map(|message| message.total_tokens).sum();

    let mut plan = ToolIoHistoryEvictionPlan {
        total_tokens,
        trigger_tokens,
        projected_tokens: total_tokens,
        keep_recent_messages,
        ..ToolIoHistoryEvictionPlan::default()
    };

    if total_tokens <= trigger_tokens {
        return plan;
    }

    let cutoff = messages.len().saturating_sub(keep_recent_messages);
    for (message_index, message) in messages.iter().enumerate().take(cutoff) {
        if plan.projected_tokens <= trigger_tokens {
            break;
        }

        for (candidate_index, candidate) in message.candidates.iter().enumerate() {
            if plan.projected_tokens <= trigger_tokens {
                break;
            }
            if candidate.reduction_tokens == 0 {
                continue;
            }

            plan.selections.push(ToolIoHistoryEvictionSelection {
                message_index,
                candidate_index,
            });
            plan.projected_tokens = plan
                .projected_tokens
                .saturating_sub(candidate.reduction_tokens);
        }
    }

    plan
}

/// Match Codex's prompt budget: retain UTF-8 head/tail bytes and put the marker outside it.
/// Token limits are a four-byte approximation, independent of any provider's tokenizer.
pub fn truncate_tool_output(output: &str, policy: TruncationPolicy) -> String {
    let limit = policy.byte_budget();
    if output.len() <= limit {
        return output.to_string();
    }
    let prefix_budget = limit / 2;
    let suffix_budget = limit.saturating_sub(prefix_budget);
    let prefix = take_prefix_by_byte_budget(output, prefix_budget);
    let suffix = take_suffix_by_byte_budget(output, suffix_budget);
    let marker = match policy {
        TruncationPolicy::Bytes(_) => {
            let omitted = output
                .chars()
                .count()
                .saturating_sub(prefix.chars().count())
                .saturating_sub(suffix.chars().count());
            format!("…{omitted} chars truncated…")
        }
        TruncationPolicy::Tokens(_) => {
            let omitted = output.len().saturating_sub(limit).div_ceil(4);
            format!("…{omitted} tokens truncated…")
        }
    };
    format!("{prefix}{marker}{suffix}")
}

pub fn format_tool_output_for_model(output: &str, policy: TruncationPolicy) -> String {
    if output.len() <= policy.byte_budget() {
        return output.to_string();
    }
    let original_tokens = output.len().div_ceil(4);
    let total_lines = output.lines().count();
    let truncated = truncate_tool_output(output, policy);
    format!(
        "Warning: truncated output (original token count: {original_tokens})\nTotal output lines: {total_lines}\n\n{truncated}"
    )
}

pub(crate) fn truncate_chars(text: &str, max_chars: usize) -> (String, bool) {
    match text.char_indices().nth(max_chars) {
        Some((end, _)) => (text[..end].to_string(), true),
        None => (text.to_string(), false),
    }
}

fn take_prefix_by_byte_budget(output: &str, budget: usize) -> String {
    output
        .char_indices()
        .map(|(idx, _)| idx)
        .chain(std::iter::once(output.len()))
        .take_while(|idx| *idx <= budget)
        .last()
        .map(|end| output[..end].to_string())
        .unwrap_or_default()
}

fn take_suffix_by_byte_budget(output: &str, budget: usize) -> String {
    let start_floor = output.len().saturating_sub(budget);
    output
        .char_indices()
        .map(|(idx, _)| idx)
        .chain(std::iter::once(output.len()))
        .find(|idx| *idx >= start_floor)
        .map(|start| output[start..].to_string())
        .unwrap_or_default()
}

fn estimate_tokens_heuristic(text: &str) -> usize {
    if text.is_empty() {
        return 0;
    }

    let chars_per_token = if has_asian_chars(text) {
        CHARS_PER_TOKEN_ASIAN
    } else if is_code(text) {
        CHARS_PER_TOKEN_CODE
    } else {
        CHARS_PER_TOKEN_DEFAULT
    };

    let char_count = text.chars().count();
    let base_tokens = (char_count as f64 / chars_per_token).ceil() as usize;
    base_tokens + calculate_special_weight(text)
}

fn has_asian_chars(text: &str) -> bool {
    let total_chars = text.chars().count();
    if total_chars == 0 {
        return false;
    }

    let asian_count = text.chars().filter(|c| is_asian_char(*c)).count();
    (asian_count as f64 / total_chars as f64) > 0.2
}

fn is_asian_char(c: char) -> bool {
    matches!(c,
        '\u{4E00}'..='\u{9FFF}' |
        '\u{3400}'..='\u{4DBF}' |
        '\u{20000}'..='\u{2A6DF}' |
        '\u{F900}'..='\u{FAFF}' |
        '\u{3040}'..='\u{309F}' |
        '\u{30A0}'..='\u{30FF}' |
        '\u{AC00}'..='\u{D7AF}' |
        '\u{1100}'..='\u{11FF}' |
        '\u{3100}'..='\u{312F}'
    )
}

fn is_code(text: &str) -> bool {
    if text.contains("```") || text.contains("~~~") {
        return true;
    }

    let code_indicators = [
        '{', '}', '[', ']', '(', ')', ';', '=', '+', '-', '*', '/', '<', '>', '&', '|', '!',
    ];

    let total_chars = text.chars().count();
    if total_chars == 0 {
        return false;
    }

    let code_char_count = text.chars().filter(|c| code_indicators.contains(c)).count();
    let has_code_patterns = text.contains("fn ")
        || text.contains("def ")
        || text.contains("function ")
        || text.contains("class ")
        || text.contains("const ")
        || text.contains("let ")
        || text.contains("var ")
        || text.contains("import ")
        || text.contains("pub ")
        || text.contains("async ")
        || text.contains("await ")
        || text.contains("return ")
        || text.contains("if ")
        || text.contains("for ")
        || text.contains("while ");

    let has_indentation_with_code = text.lines().any(|line| {
        let trimmed = line.trim_start();
        let indent_size = line.len() - trimmed.len();
        indent_size >= 2
            && (trimmed.contains('{')
                || trimmed.contains('}')
                || trimmed.contains(';')
                || trimmed.starts_with("let ")
                || trimmed.starts_with("const ")
                || trimmed.starts_with("return ")
                || trimmed.starts_with("if ")
                || trimmed.starts_with("for ")
                || trimmed.starts_with("while ")
                || trimmed.starts_with("//")
                || trimmed.starts_with('#'))
    });

    (code_char_count as f64 / total_chars as f64) > 0.05
        || has_code_patterns
        || has_indentation_with_code
}

fn calculate_special_weight(text: &str) -> usize {
    let newline_count = text.chars().filter(|c| *c == '\n').count();
    let special_count = text
        .chars()
        .filter(|c| {
            matches!(
                c,
                '\t' | '\r' | '\\' | '"' | '\'' | '`' | '~' | '@' | '#' | '$' | '%' | '^'
            )
        })
        .count();

    (newline_count as f64 * 0.5).ceil() as usize + (special_count as f64 * 0.25).ceil() as usize
}

#[cfg(test)]
mod tests;
