//! Tool I/O policy utilities.
//!
//! This module provides reusable, model-aware helpers for applications that need
//! to manage large tool inputs/outputs under context window pressure.
//! Applications can keep their own offload protocol and storage backend while
//! reusing the core framework's token accounting, eviction policy logic,
//! preview generation, and history-eviction planning.

use crate::context::TokenEstimator;
use crate::model::ModelConfig;
use chrono::Utc;
use serde_json::{json, Value};
use std::sync::OnceLock;

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

/// Basic stats for a tool I/O payload.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ToolIoPayloadStats {
    pub chars: usize,
    pub bytes: usize,
    pub tokens: usize,
}

/// Input config used to resolve a concrete eviction policy.
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

/// Resolved policy used by the application runtime.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ToolIoEvictionPolicy {
    pub token_limit_before_evict: usize,
    pub context_max_input_tokens: usize,
    pub context_window_trigger_ratio: f64,
    pub keep_recent_messages: usize,
}

impl ToolIoEvictionPolicy {
    /// Tokens at which context pressure should trigger history eviction.
    pub fn context_trigger_tokens(&self) -> usize {
        ((self.context_max_input_tokens as f64) * self.context_window_trigger_ratio).floor()
            as usize
    }
}

/// A single history-eviction candidate within one message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ToolIoHistoryEvictionCandidate {
    pub reduction_tokens: usize,
}

/// Message-level token analysis used by the generic history planner.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ToolIoHistoryMessageAnalysis {
    pub total_tokens: usize,
    pub candidates: Vec<ToolIoHistoryEvictionCandidate>,
}

/// Selected candidate position returned by the generic history planner.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ToolIoHistoryEvictionSelection {
    pub message_index: usize,
    pub candidate_index: usize,
}

/// Resolved history-eviction plan.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ToolIoHistoryEvictionPlan {
    pub selections: Vec<ToolIoHistoryEvictionSelection>,
    pub total_tokens: usize,
    pub trigger_tokens: usize,
    pub projected_tokens: usize,
    pub keep_recent_messages: usize,
}

/// Runtime thresholds used by immediate offload decisions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ToolIoOffloadThresholds {
    pub max_bytes: usize,
    pub max_chars: usize,
}

/// Trigger that caused a payload to be offloaded.
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

/// Resolved immediate offload decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ToolIoOffloadDecision {
    pub trigger: ToolIoOffloadTrigger,
}

/// Config for generating a compact preview of an offloaded payload.
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
    TOKEN_ENCODER
        .get_or_init(|| tiktoken_rs::o200k_base().ok())
        .as_ref()
}

/// Estimate tokens for a tool I/O text payload.
///
/// This prefers the exact tokenizer used by the framework when available and
/// falls back to the heuristic `TokenEstimator` if initialization fails.
pub fn estimate_tool_io_tokens(text: &str) -> usize {
    token_encoder()
        .map(|encoder| encoder.encode_with_special_tokens(text).len())
        .unwrap_or_else(|| TokenEstimator::estimate_tokens(text))
}

/// Analyze a raw text payload.
pub fn analyze_tool_io_text_payload(text: &str) -> ToolIoPayloadStats {
    ToolIoPayloadStats {
        chars: text.chars().count(),
        bytes: text.len(),
        tokens: estimate_tool_io_tokens(text),
    }
}

/// Analyze a JSON payload.
pub fn analyze_tool_io_value_payload(value: &Value) -> ToolIoPayloadStats {
    let serialized = serde_json::to_string(value).unwrap_or_default();
    ToolIoPayloadStats {
        chars: serialized.chars().count(),
        bytes: serialized.len(),
        tokens: estimate_tool_io_tokens(&serialized),
    }
}

/// Resolve the effective max input tokens for a model, falling back when needed.
pub fn resolve_model_context_max_input_tokens(model_name: Option<&str>, fallback: usize) -> usize {
    let Some(model_name) = model_name.map(str::trim).filter(|value| !value.is_empty()) else {
        return fallback;
    };

    ModelConfig::new(model_name)
        .ok()
        .map(|config| config.context_limit())
        .filter(|limit| *limit > 0)
        .unwrap_or(fallback)
}

/// Resolve a concrete eviction policy for the given model and app-provided config.
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

/// Resolve whether a payload should be immediately offloaded.
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

/// Build a compact preview for an offloaded payload.
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
        preview.push_str("\n…");
    }
    preview
}

/// Build a generic stored payload envelope for offloaded tool I/O.
pub fn build_tool_io_payload_envelope(kind: &str, payload: Value) -> Value {
    json!({
        "kind": kind,
        "generated_at": Utc::now().to_rfc3339(),
        "payload": payload,
    })
}

/// Join an optional preview with an application-provided notice body.
pub fn build_tool_io_notice_text(preview: &str, notice: &str) -> String {
    if preview.trim().is_empty() {
        return notice.to_string();
    }

    format!("{preview}\n\n{notice}")
}

/// Build a generic history-eviction plan from app-provided message analysis.
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

#[cfg(test)]
mod tests {
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

        assert_eq!(preview, "line1\nli\n…");
    }

    #[test]
    fn build_tool_io_payload_envelope_should_include_kind_timestamp_and_payload() {
        let envelope = build_tool_io_payload_envelope("tool_result", json!({"ok": true}));

        assert_eq!(envelope["kind"], json!("tool_result"));
        assert!(envelope["generated_at"]
            .as_str()
            .unwrap_or_default()
            .contains('T'));
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
}
