use serde::{Deserialize, Serialize};

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    let text = value?;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn normalize_identifier(value: Option<&str>) -> Option<String> {
    normalize_optional_text(value.map(str::to_string)).map(|value| value.to_ascii_lowercase())
}

fn is_openai_responses_model(model_name: &str) -> bool {
    let normalized = model_name.trim().to_ascii_lowercase();
    normalized.starts_with("gpt-5") && normalized.contains("codex")
}

fn is_kiro_session_provider(candidate: &str) -> bool {
    let normalized = candidate.trim().to_ascii_lowercase();
    normalized.contains("kiro") || normalized.contains("codewhisperer")
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProviderContinuationCapability {
    HistoryReplayOnly,
    ProviderSessionToken,
    PreviousResponseId,
    StickyRoutingHint,
}

impl Default for ProviderContinuationCapability {
    fn default() -> Self {
        Self::HistoryReplayOnly
    }
}

impl ProviderContinuationCapability {
    pub fn supports_remote_continuation(self) -> bool {
        !matches!(self, Self::HistoryReplayOnly)
    }
}

pub fn resolve_provider_continuation_capability(
    provider_name: &str,
    provider_selector: Option<&str>,
    model_name: &str,
    force_responses_api: bool,
) -> ProviderContinuationCapability {
    let provider_name = normalize_identifier(Some(provider_name));
    let provider_selector = normalize_identifier(provider_selector);
    let provider_candidates = [provider_selector.as_deref(), provider_name.as_deref()];

    if provider_candidates
        .iter()
        .flatten()
        .any(|candidate| candidate.contains("openai"))
        && (force_responses_api || is_openai_responses_model(model_name))
    {
        return ProviderContinuationCapability::PreviousResponseId;
    }

    if provider_candidates
        .iter()
        .flatten()
        .any(|candidate| is_kiro_session_provider(candidate))
    {
        return ProviderContinuationCapability::ProviderSessionToken;
    }

    ProviderContinuationCapability::HistoryReplayOnly
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProviderContinuationState {
    HistoryReplayOnly,
    ProviderSessionToken { session_token: String },
    PreviousResponseId { previous_response_id: String },
    StickyRoutingHint { routing_hint: String },
}

impl Default for ProviderContinuationState {
    fn default() -> Self {
        Self::HistoryReplayOnly
    }
}

impl ProviderContinuationState {
    pub fn history_replay_only() -> Self {
        Self::HistoryReplayOnly
    }

    pub fn provider_session_token(session_token: impl Into<String>) -> Self {
        match normalize_optional_text(Some(session_token.into())) {
            Some(session_token) => Self::ProviderSessionToken { session_token },
            None => Self::HistoryReplayOnly,
        }
    }

    pub fn previous_response_id(previous_response_id: impl Into<String>) -> Self {
        match normalize_optional_text(Some(previous_response_id.into())) {
            Some(previous_response_id) => Self::PreviousResponseId {
                previous_response_id,
            },
            None => Self::HistoryReplayOnly,
        }
    }

    pub fn sticky_routing_hint(routing_hint: impl Into<String>) -> Self {
        match normalize_optional_text(Some(routing_hint.into())) {
            Some(routing_hint) => Self::StickyRoutingHint { routing_hint },
            None => Self::HistoryReplayOnly,
        }
    }

    pub fn kind(&self) -> &'static str {
        match self {
            Self::HistoryReplayOnly => "history_replay_only",
            Self::ProviderSessionToken { .. } => "provider_session_token",
            Self::PreviousResponseId { .. } => "previous_response_id",
            Self::StickyRoutingHint { .. } => "sticky_routing_hint",
        }
    }

    pub fn matches_capability(&self, capability: ProviderContinuationCapability) -> bool {
        match self {
            Self::HistoryReplayOnly => true,
            Self::ProviderSessionToken { .. } => {
                capability == ProviderContinuationCapability::ProviderSessionToken
            }
            Self::PreviousResponseId { .. } => {
                capability == ProviderContinuationCapability::PreviousResponseId
            }
            Self::StickyRoutingHint { .. } => {
                capability == ProviderContinuationCapability::StickyRoutingHint
            }
        }
    }
}

pub trait ProviderContinuationCapable {
    fn provider_continuation_capability(&self) -> ProviderContinuationCapability;

    fn provider_continuation_state(&self) -> ProviderContinuationState {
        ProviderContinuationState::history_replay_only()
    }
}

#[cfg(test)]
mod tests {
    use super::{
        resolve_provider_continuation_capability, ProviderContinuationCapability,
        ProviderContinuationState,
    };

    #[test]
    fn test_provider_continuation_state_defaults_to_history_replay_only() {
        assert_eq!(
            ProviderContinuationState::default(),
            ProviderContinuationState::HistoryReplayOnly
        );
        assert_eq!(
            ProviderContinuationState::provider_session_token("   "),
            ProviderContinuationState::HistoryReplayOnly
        );
    }

    #[test]
    fn test_provider_continuation_state_serializes_tagged_shape() {
        let state = ProviderContinuationState::previous_response_id("resp-1");

        assert_eq!(state.kind(), "previous_response_id");
        assert_eq!(
            serde_json::to_value(&state).expect("serialize continuation state"),
            serde_json::json!({
                "kind": "previous_response_id",
                "previous_response_id": "resp-1"
            })
        );
    }

    #[test]
    fn test_provider_continuation_capability_distinguishes_optional_remote_modes() {
        assert!(!ProviderContinuationCapability::HistoryReplayOnly.supports_remote_continuation());
        assert!(ProviderContinuationCapability::PreviousResponseId.supports_remote_continuation());
        assert!(ProviderContinuationCapability::ProviderSessionToken.supports_remote_continuation());
    }

    #[test]
    fn test_provider_continuation_state_matches_capability() {
        assert!(ProviderContinuationState::previous_response_id("resp-1")
            .matches_capability(ProviderContinuationCapability::PreviousResponseId));
        assert!(!ProviderContinuationState::previous_response_id("resp-1")
            .matches_capability(ProviderContinuationCapability::ProviderSessionToken));
        assert!(ProviderContinuationState::history_replay_only()
            .matches_capability(ProviderContinuationCapability::ProviderSessionToken));
    }

    #[test]
    fn test_resolve_provider_continuation_capability_detects_openai_responses_routes() {
        assert_eq!(
            resolve_provider_continuation_capability(
                "openai",
                Some("openai"),
                "gpt-5-codex",
                false
            ),
            ProviderContinuationCapability::PreviousResponseId
        );
        assert_eq!(
            resolve_provider_continuation_capability(
                "openai",
                Some("deepseek"),
                "deepseek-r1",
                false
            ),
            ProviderContinuationCapability::HistoryReplayOnly
        );
    }

    #[test]
    fn test_resolve_provider_continuation_capability_detects_kiro_provider_session_token() {
        assert_eq!(
            resolve_provider_continuation_capability("kiro", Some("kiro"), "claude-3.7", false),
            ProviderContinuationCapability::ProviderSessionToken
        );
        assert_eq!(
            resolve_provider_continuation_capability(
                "kiro",
                Some("codewhisperer"),
                "claude-3.7",
                false
            ),
            ProviderContinuationCapability::ProviderSessionToken
        );
    }

    #[test]
    fn test_resolve_provider_continuation_capability_respects_force_responses_api() {
        assert_eq!(
            resolve_provider_continuation_capability("openai", Some("openai"), "gpt-4o", true),
            ProviderContinuationCapability::PreviousResponseId
        );
    }
}
