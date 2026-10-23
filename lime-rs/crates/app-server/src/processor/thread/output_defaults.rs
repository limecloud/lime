use app_server_protocol::JsonRpcError;
use lime_core::config::{ConfigManager, ModelVerbosity, ReasoningSummary};
use serde_json::{json, Map, Value};
use std::{collections::HashMap, path::Path};

/// Resolve once at Thread creation; later turns consume the canonical snapshot.
pub(super) fn read_output_defaults(
    path: &Path,
    overrides: Option<&HashMap<String, Value>>,
) -> Result<Map<String, Value>, JsonRpcError> {
    let manager = ConfigManager::load(path).map_err(|error| {
        super::to_jsonrpc_error(crate::RuntimeCoreError::Backend(format!(
            "failed to load output defaults: {error}"
        )))
    })?;
    let config = manager.config();
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
    Ok(Map::from_iter([
        ("modelVerbosity".into(), json!(verbosity)),
        ("reasoningSummary".into(), json!(summary)),
    ]))
}
