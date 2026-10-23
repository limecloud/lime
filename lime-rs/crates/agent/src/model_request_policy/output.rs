use super::{ModelReasoningOutputPolicySnapshot, ModelRequestPolicySnapshot};
use serde_json::Value;

pub(super) fn apply(snapshot: &mut ModelRequestPolicySnapshot, metadata: &Value) {
    let declared = registry_policy(metadata);
    let can_set_summary = snapshot.reasoning_output_policy.is_some()
        || declared.as_ref().is_some_and(|(supported, _)| *supported);
    if snapshot.reasoning_output_policy.is_none() {
        snapshot.reasoning_output_policy = declared.map(|(_, policy)| policy);
    }
    let summary = override_value(metadata, &["summary", "reasoningSummary"])
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "auto" | "concise" | "detailed" | "none"));
    let verbosity = override_value(metadata, &["modelVerbosity"])
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "low" | "medium" | "high"));
    if summary.is_none() && verbosity.is_none() {
        return;
    }
    let Some(policy) = snapshot.reasoning_output_policy.as_mut() else {
        return;
    };
    if can_set_summary {
        if let Some(summary) = summary {
            policy.default_reasoning_summary = summary.to_string();
        }
    }
    // A user preference never grants a model capability.
    if policy.support_verbosity && policy.can_set_verbosity {
        if let Some(verbosity) = verbosity {
            policy.default_verbosity = Some(verbosity.to_string());
        }
    }
}

fn registry_policy(metadata: &Value) -> Option<(bool, ModelReasoningOutputPolicySnapshot)> {
    let registry = metadata.get("config").unwrap_or(metadata);
    let registry = registry
        .get("modelRegistry")
        .or_else(|| registry.get("model_registry"))?;
    let capabilities = registry
        .pointer("/model/capabilities")
        .or_else(|| registry.pointer("/modelCapabilities/capabilities"))
        .or_else(|| registry.pointer("/model_capabilities/capabilities"))?;
    let summary = capabilities
        .get("supports_reasoning_summaries")
        .or_else(|| capabilities.get("supportsReasoningSummaries"))
        .and_then(Value::as_bool)
        == Some(true);
    let verbosity = capabilities
        .get("support_verbosity")
        .or_else(|| capabilities.get("supportVerbosity"))
        .and_then(Value::as_bool)
        == Some(true);
    Some((
        summary,
        ModelReasoningOutputPolicySnapshot {
            default_reasoning_summary: if summary { "auto" } else { "none" }.into(),
            support_verbosity: verbosity,
            default_verbosity: None,
            can_set_verbosity: verbosity,
        },
    ))
}

fn override_value<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    [
        "runtime_options",
        "runtimeOptions",
        "runtime_request",
        "runtimeRequest",
    ]
    .into_iter()
    .filter_map(|key| value.get(key))
    .find_map(|value| override_value(value, keys))
    .or_else(|| {
        value
            .get("metadata")
            .and_then(|value| override_value(value, keys))
    })
    .or_else(|| keys.iter().find_map(|key| value.get(*key)))
}

#[cfg(test)]
mod tests {
    use super::super::{
        model_request_policy_from_metadata, runtime_reply_model_request_policy_from_metadata,
    };
    use model_provider::provider_stream::RuntimeReplyProviderRequestWireShape;
    use serde_json::json;

    #[test]
    fn thread_output_overrides_keep_the_model_capability_gate() {
        for supported in [false, true] {
            let metadata = json!({
                "runtime_request": {"modelVerbosity": "high", "reasoningSummary": "concise"},
                "config": {"model_request_policy": {"reasoning_output_policy": {
                    "support_verbosity": supported,
                    "default_verbosity": "low", "default_reasoning_summary": "auto"
                }}}
            });
            let policy = runtime_reply_model_request_policy_from_metadata(&metadata).unwrap();
            let wire =
                RuntimeReplyProviderRequestWireShape::from_model_request_policy(Some(&policy));
            assert_eq!(wire.reasoning_summary.as_deref(), Some("concise"));
            assert_eq!(wire.text_verbosity.as_deref(), supported.then_some("high"));
        }
    }

    #[test]
    fn turn_summary_overrides_the_thread_snapshot_and_none_omits_the_wire_field() {
        let metadata = json!({"runtime_request": {"metadata": {
            "reasoningSummary": "detailed", "summary": "none"
        }}, "config": {"modelRegistry": {"model": {"capabilities": {
            "supports_reasoning_summaries": true
        }}}}});
        let policy = runtime_reply_model_request_policy_from_metadata(&metadata).unwrap();
        let wire = RuntimeReplyProviderRequestWireShape::from_model_request_policy(Some(&policy));
        assert_eq!(wire.reasoning_summary, None);
        assert_eq!(wire.text_verbosity, None);
    }

    #[test]
    fn raw_global_config_is_not_a_thread_snapshot() {
        assert!(model_request_policy_from_metadata(&json!({"config": {
            "model_verbosity": "high", "model_reasoning_summary": "detailed"
        }}))
        .is_none());
        let policy = model_request_policy_from_metadata(&json!({
            "reasoningSummary": "concise",
            "runtime_request": {"reasoningSummary": "detailed"},
            "config": {"modelRegistry": {"model": {"capabilities": {
                "supports_reasoning_summaries": true
            }}}}
        }))
        .unwrap();
        assert_eq!(
            policy
                .reasoning_output_policy
                .unwrap()
                .default_reasoning_summary,
            "detailed"
        );
    }

    #[test]
    fn selected_endpoint_capabilities_control_output_fields() {
        for supported in [true, false] {
            let metadata = json!({
                "runtime_request": {"modelVerbosity": "high", "reasoningSummary": "detailed"},
                "config": {"modelRegistry": {"model": {"capabilities": {
                    "supports_reasoning_summaries": supported, "support_verbosity": supported
                }}}}
            });
            let policy = runtime_reply_model_request_policy_from_metadata(&metadata).unwrap();
            assert_eq!(policy.reasoning_summary(), supported.then_some("detailed"));
            assert_eq!(policy.text_verbosity(), supported.then_some("high"));
        }
    }
}
