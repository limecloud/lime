use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContextFragmentEnvelope {
    pub fragment_id: String,
    pub source: ContextFragmentSource,
    pub model_visible_preview: String,
    pub sidecar_reference: Option<ContextSidecarReference>,
    pub budget_decision: ContextFragmentBudgetDecision,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContextFragmentSource {
    pub kind: String,
    pub label: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContextSidecarReference {
    pub kind: String,
    pub uri: String,
    pub sha256: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContextFragmentBudgetDecision {
    pub estimated_tokens: u32,
    pub max_model_visible_tokens: u32,
    pub status: ContextFragmentBudgetStatus,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextFragmentBudgetStatus {
    Inline,
    PreviewWithReference,
    PreviewRequiresReference,
    ReferenceOnly,
    HiddenRequiresReference,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContextFragmentInput {
    pub fragment_id: String,
    pub source: ContextFragmentSource,
    pub content: String,
    pub estimated_tokens: Option<u32>,
    pub sidecar_reference: Option<ContextSidecarReference>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ContextFragmentBudgetPolicy {
    pub max_preview_chars: usize,
    pub max_model_visible_tokens: u32,
}

impl ContextFragmentEnvelope {
    pub fn from_input(input: ContextFragmentInput, policy: ContextFragmentBudgetPolicy) -> Self {
        let estimated_tokens = input
            .estimated_tokens
            .unwrap_or_else(|| estimate_context_fragment_tokens(&input.content));
        let effective_preview_chars = effective_model_visible_preview_chars(policy);
        let preview = bounded_preview(&input.content, effective_preview_chars);
        let status = context_fragment_budget_status(
            estimated_tokens,
            policy.max_model_visible_tokens,
            effective_preview_chars,
            input.content.chars().count(),
            input.sidecar_reference.is_some(),
        );

        Self {
            fragment_id: input.fragment_id,
            source: input.source,
            model_visible_preview: preview,
            sidecar_reference: input.sidecar_reference,
            budget_decision: ContextFragmentBudgetDecision {
                estimated_tokens,
                max_model_visible_tokens: policy.max_model_visible_tokens,
                status,
            },
        }
    }
}

pub fn estimate_context_fragment_tokens(content: &str) -> u32 {
    let chars = content.chars().count() as u32;
    chars.saturating_add(3) / 4
}

fn effective_model_visible_preview_chars(policy: ContextFragmentBudgetPolicy) -> usize {
    let token_preview_chars = (policy.max_model_visible_tokens as usize).saturating_mul(4);
    policy.max_preview_chars.min(token_preview_chars)
}

fn context_fragment_budget_status(
    estimated_tokens: u32,
    max_model_visible_tokens: u32,
    max_preview_chars: usize,
    content_chars: usize,
    has_sidecar_reference: bool,
) -> ContextFragmentBudgetStatus {
    if max_preview_chars == 0 {
        return if has_sidecar_reference {
            ContextFragmentBudgetStatus::ReferenceOnly
        } else {
            ContextFragmentBudgetStatus::HiddenRequiresReference
        };
    }

    let over_budget = estimated_tokens > max_model_visible_tokens;
    let preview_truncated = content_chars > max_preview_chars;

    match (over_budget || preview_truncated, has_sidecar_reference) {
        (false, _) => ContextFragmentBudgetStatus::Inline,
        (true, true) => ContextFragmentBudgetStatus::PreviewWithReference,
        (true, false) => ContextFragmentBudgetStatus::PreviewRequiresReference,
    }
}

fn bounded_preview(content: &str, max_chars: usize) -> String {
    if max_chars == 0 {
        return String::new();
    }

    let char_count = content.chars().count();
    if char_count <= max_chars {
        return content.to_string();
    }

    if max_chars <= 3 {
        return content.chars().take(max_chars).collect();
    }

    let mut preview: String = content.chars().take(max_chars - 3).collect();
    preview.push_str("...");
    preview
}

#[cfg(test)]
mod tests {
    use super::{
        ContextFragmentBudgetPolicy, ContextFragmentBudgetStatus, ContextFragmentEnvelope,
        ContextFragmentInput, ContextFragmentSource, ContextSidecarReference,
    };

    #[test]
    fn inline_fragment_keeps_full_preview_inside_budget() {
        let envelope = ContextFragmentEnvelope::from_input(
            ContextFragmentInput {
                fragment_id: "frag-1".to_string(),
                source: ContextFragmentSource {
                    kind: "memory".to_string(),
                    label: Some("profile".to_string()),
                },
                content: "short memory".to_string(),
                estimated_tokens: Some(3),
                sidecar_reference: None,
            },
            ContextFragmentBudgetPolicy {
                max_preview_chars: 64,
                max_model_visible_tokens: 16,
            },
        );

        assert_eq!(envelope.model_visible_preview, "short memory");
        assert_eq!(
            envelope.budget_decision.status,
            ContextFragmentBudgetStatus::Inline
        );
        assert!(envelope.sidecar_reference.is_none());
    }

    #[test]
    fn oversized_fragment_requires_reference_without_exposing_full_content() {
        let envelope = ContextFragmentEnvelope::from_input(
            ContextFragmentInput {
                fragment_id: "frag-2".to_string(),
                source: ContextFragmentSource {
                    kind: "workspace".to_string(),
                    label: None,
                },
                content: "abcdefghijklmnopqrstuvwxyz".to_string(),
                estimated_tokens: Some(100),
                sidecar_reference: None,
            },
            ContextFragmentBudgetPolicy {
                max_preview_chars: 10,
                max_model_visible_tokens: 16,
            },
        );

        assert_eq!(envelope.model_visible_preview, "abcdefg...");
        assert_eq!(
            envelope.budget_decision.status,
            ContextFragmentBudgetStatus::PreviewRequiresReference
        );
        assert_ne!(envelope.model_visible_preview, "abcdefghijklmnopqrstuvwxyz");
    }

    #[test]
    fn oversized_fragment_keeps_sidecar_reference_as_truth() {
        let envelope = ContextFragmentEnvelope::from_input(
            ContextFragmentInput {
                fragment_id: "frag-3".to_string(),
                source: ContextFragmentSource {
                    kind: "media".to_string(),
                    label: Some("transcript".to_string()),
                },
                content: "long transcript content that should stay outside the prompt".to_string(),
                estimated_tokens: Some(80),
                sidecar_reference: Some(ContextSidecarReference {
                    kind: "artifact".to_string(),
                    uri: "sidecar://fragment/frag-3".to_string(),
                    sha256: Some("abc123".to_string()),
                }),
            },
            ContextFragmentBudgetPolicy {
                max_preview_chars: 12,
                max_model_visible_tokens: 32,
            },
        );

        assert_eq!(envelope.model_visible_preview, "long tran...");
        assert_eq!(
            envelope.budget_decision.status,
            ContextFragmentBudgetStatus::PreviewWithReference
        );
        assert_eq!(
            envelope
                .sidecar_reference
                .as_ref()
                .map(|reference| reference.uri.as_str()),
            Some("sidecar://fragment/frag-3")
        );
    }

    #[test]
    fn zero_preview_budget_hides_content_and_requires_reference() {
        let envelope = ContextFragmentEnvelope::from_input(
            ContextFragmentInput {
                fragment_id: "frag-4".to_string(),
                source: ContextFragmentSource {
                    kind: "skill".to_string(),
                    label: None,
                },
                content: "hidden instructions".to_string(),
                estimated_tokens: Some(4),
                sidecar_reference: None,
            },
            ContextFragmentBudgetPolicy {
                max_preview_chars: 0,
                max_model_visible_tokens: 16,
            },
        );

        assert!(envelope.model_visible_preview.is_empty());
        assert_eq!(
            envelope.budget_decision.status,
            ContextFragmentBudgetStatus::HiddenRequiresReference
        );
    }

    #[test]
    fn token_budget_also_bounds_model_visible_preview() {
        let envelope = ContextFragmentEnvelope::from_input(
            ContextFragmentInput {
                fragment_id: "frag-5".to_string(),
                source: ContextFragmentSource {
                    kind: "agents".to_string(),
                    label: None,
                },
                content: "abcdefghijklmnopqrstuvwxyz".to_string(),
                estimated_tokens: None,
                sidecar_reference: None,
            },
            ContextFragmentBudgetPolicy {
                max_preview_chars: 100,
                max_model_visible_tokens: 2,
            },
        );

        assert_eq!(envelope.model_visible_preview, "abcde...");
        assert_eq!(
            envelope.budget_decision.status,
            ContextFragmentBudgetStatus::PreviewRequiresReference
        );
    }

    #[test]
    fn zero_preview_budget_with_sidecar_is_reference_only() {
        let envelope = ContextFragmentEnvelope::from_input(
            ContextFragmentInput {
                fragment_id: "frag-6".to_string(),
                source: ContextFragmentSource {
                    kind: "media".to_string(),
                    label: Some("image-analysis".to_string()),
                },
                content: "hidden media analysis".to_string(),
                estimated_tokens: Some(10),
                sidecar_reference: Some(ContextSidecarReference {
                    kind: "artifact".to_string(),
                    uri: "sidecar://fragment/frag-6".to_string(),
                    sha256: None,
                }),
            },
            ContextFragmentBudgetPolicy {
                max_preview_chars: 0,
                max_model_visible_tokens: 16,
            },
        );

        assert!(envelope.model_visible_preview.is_empty());
        assert_eq!(
            envelope.budget_decision.status,
            ContextFragmentBudgetStatus::ReferenceOnly
        );
        assert!(envelope.sidecar_reference.is_some());
    }
}
