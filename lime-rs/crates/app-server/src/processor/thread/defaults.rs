use app_server_protocol::JsonRpcError;
use lime_core::config::{layers::ConfigLayers, Config, SandboxMode};
use serde::de::DeserializeOwned;
use serde_json::{json, Map, Value};
use std::{collections::HashMap, path::Path};

pub(super) fn read_thread_defaults(
    path: &Path,
    cwd: &Path,
    overrides: Option<&HashMap<String, Value>>,
    requirements: Option<&lime_core::config::requirements::ConfigRequirements>,
) -> Result<(Map<String, Value>, Config), JsonRpcError> {
    let _guard = super::super::config::config_lock()?;
    let mut layers = ConfigLayers::load(path, cwd.is_dir().then_some(cwd)).map_err(|error| {
        super::to_jsonrpc_error(crate::RuntimeCoreError::Backend(format!(
            "failed to load thread defaults: {error}"
        )))
    })?;
    if let Some(requirements) = requirements {
        requirements.constrain_defaults(&mut layers.effective);
    }
    let config = &layers.effective;
    let approval = setting(overrides, "approval_policy", config.approval_policy)?;
    let sandbox = setting(overrides, "sandbox_mode", config.sandbox_mode)?;
    let workspace = setting(
        overrides,
        "sandbox_workspace_write",
        config.sandbox_workspace_write.clone(),
    )?;
    let mut defaults = super::output_defaults::read_output_defaults(config, overrides)?;
    let web_search: Option<agent_protocol::WebSearchMode> =
        setting(overrides, "web_search", config.web_search)?;
    if let Some(mode) = web_search {
        defaults.insert("webSearchMode".into(), json!(mode));
    }
    defaults.insert("approvalPolicy".into(), json!(approval.as_str()));
    defaults.insert("sandboxPolicy".into(), json!(sandbox.as_str()));
    defaults.insert(
        "sandboxNetworkAccess".into(),
        json!(sandbox == SandboxMode::WorkspaceWrite && workspace.network_access),
    );
    Ok((defaults, config.clone()))
}

fn setting<T: DeserializeOwned>(
    values: Option<&HashMap<String, Value>>,
    key: &str,
    fallback: T,
) -> Result<T, JsonRpcError> {
    values
        .and_then(|values| values.get(key))
        .map(|value| {
            serde_json::from_value(value.clone())
                .map_err(|error| super::invalid_params(format!("invalid {key}: {error}")))
        })
        .unwrap_or(Ok(fallback))
}
