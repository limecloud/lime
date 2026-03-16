use super::{
    args_or_default, build_ensure_result, ensure_workspace_ready_with_auto_relocate,
    get_string_arg, workspace_manager, DynError,
};
use crate::dev_bridge::DevBridgeState;
use serde_json::Value as JsonValue;

pub(super) fn try_handle(
    state: &DevBridgeState,
    cmd: &str,
    args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, DynError> {
    let result = match cmd {
        "workspace_ensure_ready" => {
            let args = args_or_default(args);
            let id = get_string_arg(&args, "id", "id")?;
            let manager = workspace_manager(state)?;
            let workspace = manager
                .get(&id)?
                .ok_or_else(|| format!("Workspace 不存在: {id}"))?;
            let result = build_ensure_result(
                workspace.id.clone(),
                ensure_workspace_ready_with_auto_relocate(&manager, &workspace)?,
            );
            serde_json::to_value(result)?
        }
        "workspace_ensure_default_ready" => {
            let manager = workspace_manager(state)?;
            let Some(workspace) = manager.get_default()? else {
                return Ok(Some(serde_json::json!(null)));
            };
            let result = build_ensure_result(
                workspace.id.clone(),
                ensure_workspace_ready_with_auto_relocate(&manager, &workspace)?,
            );
            serde_json::to_value(Some(result))?
        }
        _ => return Ok(None),
    };

    Ok(Some(result))
}
