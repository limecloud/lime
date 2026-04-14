use super::{
    args_or_default, get_string_arg, workspace_manager, DynError, PathBuf, WorkspaceListItem,
};
use crate::dev_bridge::DevBridgeState;
use crate::workspace_support::{
    get_current_default_project, get_workspace_projects_root_dir, sanitize_project_dir_name,
};
use serde_json::Value as JsonValue;

pub(super) fn try_handle(
    state: &DevBridgeState,
    cmd: &str,
    args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, DynError> {
    let result = match cmd {
        "workspace_list" => {
            let manager = workspace_manager(state)?;
            let items: Vec<_> = manager
                .list()?
                .into_iter()
                .map(WorkspaceListItem::from)
                .collect();
            serde_json::to_value(items)?
        }
        "workspace_get" => {
            let args = args_or_default(args);
            let id = get_string_arg(&args, "id", "id")?;
            let manager = workspace_manager(state)?;
            serde_json::to_value(manager.get(&id)?.map(WorkspaceListItem::from))?
        }
        "workspace_get_default" => {
            let manager = workspace_manager(state)?;
            serde_json::to_value(
                get_current_default_project(&manager)?.map(WorkspaceListItem::from),
            )?
        }
        "workspace_get_by_path" => {
            let args = args_or_default(args);
            let root_path = get_string_arg(&args, "rootPath", "root_path")?;
            let manager = workspace_manager(state)?;
            serde_json::to_value(
                manager
                    .get_by_path(&PathBuf::from(root_path))?
                    .map(WorkspaceListItem::from),
            )?
        }
        "workspace_get_projects_root" => {
            let root_dir = get_workspace_projects_root_dir()?;
            serde_json::json!(root_dir.to_string_lossy().to_string())
        }
        "workspace_resolve_project_path" => {
            let args = args_or_default(args);
            let name = get_string_arg(&args, "name", "name")?;
            let project_path =
                get_workspace_projects_root_dir()?.join(sanitize_project_dir_name(&name));
            serde_json::json!(project_path.to_string_lossy().to_string())
        }
        _ => return Ok(None),
    };

    Ok(Some(result))
}
