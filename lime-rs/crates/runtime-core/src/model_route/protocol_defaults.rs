use app_server_protocol::{CapabilitySnapshot, ModelTaskKind, ProtocolKind};
use serde_json::{json, Value};

/// Shared by configured catalog entries and route resolution. A catalog has no
/// selected wire protocol yet; protocol-specific features are added at routing.
pub fn chat_protocol_defaults(protocol: Option<&ProtocolKind>) -> Option<CapabilitySnapshot> {
    if protocol.is_some_and(|protocol| {
        !matches!(
            protocol,
            ProtocolKind::OpenaiChat
                | ProtocolKind::OpenaiResponses
                | ProtocolKind::AnthropicMessages
                | ProtocolKind::GeminiGenerateContent
                | ProtocolKind::VertexGemini
                | ProtocolKind::BedrockConverse
        )
    }) {
        return None;
    }
    let mut snapshot = crate::model_task::capability_snapshot_from_model_capabilities(&json!({
        "taskFamilies": ["chat"],
        "inputModalities": ["text"],
        "outputModalities": ["text"],
        "runtimeFeatures": ["streaming", "tool_calling"],
        "capabilities": {
            "streaming": true,
            "tools": true,
            "functionCalling": true,
            "supportsReasoningSummaries": protocol == Some(&ProtocolKind::OpenaiResponses)
        }
    }));
    snapshot.source = Some("protocol_default".to_string());
    snapshot.reason_code = Some("configured_chat_protocol_defaults".to_string());
    Some(snapshot)
}

/// Configured chat models remain usable without a rich /models response, as in
/// upstream models-manager/model_info.rs. These are protocol defaults, not claims
/// of verified model support; media and hosted services are never inferred.
pub(super) fn apply_protocol_defaults(
    task_kind: &ModelTaskKind,
    protocol: &ProtocolKind,
    routing_payload: &Value,
    snapshot: &mut CapabilitySnapshot,
) -> bool {
    if *task_kind != ModelTaskKind::Chat
        || snapshot
            .source
            .as_deref()
            .is_some_and(|source| matches!(source, "canonical" | "provider_explicit"))
        || (!snapshot.task_families.is_empty()
            && !snapshot.task_families.iter().any(|family| family == "chat"))
    {
        return false;
    }
    let registry = super::model_registry(routing_payload);
    let configured = registry.is_some_and(|registry| {
        registry.get("source").and_then(Value::as_str) == Some("direct_provider_config")
            || registry.get("status").and_then(Value::as_str) == Some("matched")
    });
    if !configured {
        return false;
    }

    let Some(defaults) = chat_protocol_defaults(Some(protocol)) else {
        return false;
    };
    *snapshot = defaults;
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(value: Value) -> CapabilitySnapshot {
        crate::model_task::capability_snapshot_from_model_capabilities(&value)
    }

    #[test]
    fn defaults_only_cover_text_chat_and_standard_function_tools() {
        let defaults = chat_protocol_defaults(Some(&ProtocolKind::OpenaiResponses)).unwrap();
        assert_eq!(defaults.task_families, ["chat"]);
        assert_eq!(defaults.input_modalities, ["text"]);
        assert_eq!(defaults.output_modalities, ["text"]);
        assert_eq!(defaults.runtime_features, ["streaming", "tool_calling"]);
        assert!(defaults.capabilities.tools && defaults.capabilities.function_calling);
        assert!(defaults.capabilities.supports_reasoning_summaries);
        assert!(!defaults.capabilities.vision && !defaults.capabilities.reasoning);
        assert!(defaults.capabilities.reasoning_effort.is_none());
        assert!(
            !chat_protocol_defaults(None)
                .unwrap()
                .capabilities
                .supports_reasoning_summaries
        );
    }

    #[test]
    fn defaults_require_a_configured_chat_model_and_supported_protocol() {
        let matched = json!({"modelRegistry": {"status": "matched"}});
        for registry in [json!({}), json!({"modelRegistry": {"status": "not_found"}})] {
            let mut existing = snapshot(json!({}));
            assert!(!apply_protocol_defaults(
                &ModelTaskKind::Chat,
                &ProtocolKind::OpenaiChat,
                &registry,
                &mut existing
            ));
            assert!(existing.source.is_none());
        }
        let mut existing = snapshot(json!({}));
        assert!(!apply_protocol_defaults(
            &ModelTaskKind::Chat,
            &ProtocolKind::Unknown,
            &matched,
            &mut existing
        ));
        assert!(!apply_protocol_defaults(
            &ModelTaskKind::Chat,
            &ProtocolKind::OpenaiImages,
            &matched,
            &mut existing
        ));
        assert!(!apply_protocol_defaults(
            &ModelTaskKind::VideoGenerate,
            &ProtocolKind::OpenaiChat,
            &matched,
            &mut existing
        ));
        let mut media_model = snapshot(json!({"taskFamilies": ["image_generation"]}));
        assert!(!apply_protocol_defaults(
            &ModelTaskKind::Chat,
            &ProtocolKind::OpenaiChat,
            &matched,
            &mut media_model
        ));
    }

    #[test]
    fn defaults_preserve_explicit_denials_and_canonical_descriptors() {
        for source in ["canonical", "provider_explicit"] {
            let mut existing = snapshot(json!({
                "taskFamilies": ["chat"],
                "capabilities": {"streaming": false, "tools": false}
            }));
            existing.source = Some(source.to_string());
            let before = serde_json::to_value(&existing).unwrap();
            assert!(!apply_protocol_defaults(
                &ModelTaskKind::Chat,
                &ProtocolKind::OpenaiResponses,
                &json!({"modelRegistry": {"status": "matched"}}),
                &mut existing
            ));
            assert_eq!(serde_json::to_value(existing).unwrap(), before);
        }
    }
}
