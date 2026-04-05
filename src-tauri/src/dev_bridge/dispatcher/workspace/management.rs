use super::{
    args_or_default, ensure_update_root_path, ensure_valid_workspace_root, get_optional_bool_arg,
    get_string_arg, parse_nested_arg, remove_workspace_directory_if_requested,
    to_workspace_list_item_json, workspace_manager, CreateWorkspaceRequest, DynError, PathBuf,
    UpdateWorkspaceRequest, WorkspaceType, WorkspaceUpdate,
};
use crate::dev_bridge::DevBridgeState;
use crate::workspace_support::get_or_create_default_project;
use serde_json::Value as JsonValue;

pub(super) fn try_handle(
    state: &DevBridgeState,
    cmd: &str,
    args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, DynError> {
    let result = match cmd {
        "workspace_create" => {
            let args = args_or_default(args);
            let request: CreateWorkspaceRequest = parse_nested_arg(&args, "request")?;

            if request.root_path.contains("[object Promise]") {
                return Err(format!(
                    "无效的 root_path: {}。请确保前端正确 await 了 Promise。",
                    request.root_path
                )
                .into());
            }

            let manager = workspace_manager(state)?;
            let workspace_type = request
                .workspace_type
                .map(|workspace_type| WorkspaceType::parse_user_input(&workspace_type))
                .transpose()?
                .unwrap_or_default();
            let root_path = PathBuf::from(&request.root_path);
            ensure_valid_workspace_root(&root_path)?;
            to_workspace_list_item_json(manager.create_with_type(
                request.name,
                root_path,
                workspace_type,
            )?)?
        }
        "workspace_update" => {
            let args = args_or_default(args);
            let id = get_string_arg(&args, "id", "id")?;
            let request: UpdateWorkspaceRequest = parse_nested_arg(&args, "request")?;
            let manager = workspace_manager(state)?;
            let updates = WorkspaceUpdate {
                name: request.name,
                settings: request.settings,
                icon: request.icon,
                color: request.color,
                is_favorite: request.is_favorite,
                is_archived: request.is_archived,
                tags: request.tags,
                root_path: ensure_update_root_path(request.root_path)?,
            };
            to_workspace_list_item_json(manager.update(&id, updates)?)?
        }
        "workspace_delete" => {
            let args = args_or_default(args);
            let id = get_string_arg(&args, "id", "id")?;
            let delete_directory =
                get_optional_bool_arg(&args, "deleteDirectory", "delete_directory")
                    .unwrap_or(false);
            let manager = workspace_manager(state)?;
            remove_workspace_directory_if_requested(&manager, &id, delete_directory)?;
            serde_json::to_value(manager.delete(&id)?)?
        }
        "workspace_set_default" => {
            let args = args_or_default(args);
            let id = get_string_arg(&args, "id", "id")?;
            let manager = workspace_manager(state)?;
            manager.set_default(&id)?;
            serde_json::json!(null)
        }
        "get_or_create_default_project" => {
            let manager = workspace_manager(state)?;
            to_workspace_list_item_json(get_or_create_default_project(&manager)?)?
        }
        _ => return Ok(None),
    };

    Ok(Some(result))
}
