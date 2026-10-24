use app_server_protocol::JsonRpcError;
use lime_core::config::{Config, ModelVerbosity, ReasoningEffort, ReasoningSummary};
use serde_json::{json, Map, Value};
use std::collections::HashMap;

/// Resolve once at Thread creation; later turns consume the canonical snapshot.
pub(super) fn read_output_defaults(
    config: &Config,
    overrides: Option<&HashMap<String, Value>>,
) -> Result<Map<String, Value>, JsonRpcError> {
    let verbosity = overrides
        .and_then(|values| values.get("model_verbosity"))
        .map(|value| serde_json::from_value::<Option<ModelVerbosity>>(value.clone()))
        .transpose()
        .map_err(|error| super::invalid_params(format!("invalid model_verbosity: {error}")))?
        .unwrap_or(config.model_verbosity);
    let summary = overrides
        .and_then(|values| values.get("model_reasoning_summary"))
        .map(|value| serde_json::from_value::<Option<ReasoningSummary>>(value.clone()))
        .transpose()
        .map_err(|error| {
            super::invalid_params(format!("invalid model_reasoning_summary: {error}"))
        })?
        .map(Option::unwrap_or_default)
        .unwrap_or(config.model_reasoning_summary);
    let effort = overrides
        .and_then(|values| values.get("model_reasoning_effort"))
        .map(|value| serde_json::from_value::<Option<ReasoningEffort>>(value.clone()))
        .transpose()
        .map_err(|error| super::invalid_params(format!("invalid model_reasoning_effort: {error}")))?
        .unwrap_or(config.model_reasoning_effort);
    Ok(Map::from_iter([
        ("modelVerbosity".into(), json!(verbosity)),
        ("reasoningSummary".into(), json!(summary)),
        ("reasoningEffort".into(), json!(effort)),
    ]))
}
