use super::{args_or_default, get_db, get_string_arg, parse_nested_arg};
use crate::commands::workspace_cmd::{
    CreateWorkspaceRequest, UpdateWorkspaceRequest, WorkspaceEnsureResult, WorkspaceListItem,
};
use crate::dev_bridge::DevBridgeState;
use crate::services::workspace_health_service::{
    ensure_workspace_ready_with_auto_relocate, ensure_workspace_root_ready,
};
use crate::workspace::{WorkspaceManager, WorkspaceType, WorkspaceUpdate};
use serde_json::Value as JsonValue;
use std::path::{Path, PathBuf};

mod management;
mod queries;
mod readiness;

type DynError = Box<dyn std::error::Error>;

fn workspace_manager(state: &DevBridgeState) -> Result<WorkspaceManager, DynError> {
    Ok(WorkspaceManager::new(get_db(state)?.clone()))
}

fn get_optional_bool_arg(args: &JsonValue, primary: &str, secondary: &str) -> Option<bool> {
    args.get(primary)
        .or_else(|| args.get(secondary))
        .and_then(|value| value.as_bool())
}

fn get_workspace_projects_root_dir() -> Result<PathBuf, String> {
    proxycast_core::app_paths::resolve_projects_dir()
}

fn sanitize_project_dir_name(name: &str) -> String {
    let sanitized: String = name
        .trim()
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ if ch.is_control() => '_',
            _ => ch,
        })
        .collect();

    let trimmed = sanitized.trim().trim_matches('.').to_string();
    if trimmed.is_empty() {
        "未命名项目".to_string()
    } else {
        trimmed
    }
}

fn to_workspace_list_item_json<T>(workspace: T) -> Result<JsonValue, DynError>
where
    WorkspaceListItem: From<T>,
{
    Ok(serde_json::to_value(WorkspaceListItem::from(workspace))?)
}

fn build_ensure_result(
    workspace_id: String,
    ensured: crate::services::workspace_health_service::WorkspaceReadyResult,
) -> WorkspaceEnsureResult {
    WorkspaceEnsureResult {
        workspace_id,
        root_path: ensured.root_path.to_string_lossy().to_string(),
        existed: ensured.existed,
        created: ensured.created,
        repaired: ensured.repaired,
        relocated: ensured.relocated,
        previous_root_path: ensured
            .previous_root_path
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        warning: ensured.warning,
    }
}

fn create_default_project_if_missing(manager: &WorkspaceManager) -> Result<JsonValue, DynError> {
    if let Some(workspace) = manager.get_default()? {
        return to_workspace_list_item_json(workspace);
    }

    let default_project_path = get_workspace_projects_root_dir()?.join("default");
    std::fs::create_dir_all(&default_project_path)
        .map_err(|e| format!("创建默认项目目录失败: {e}"))?;

    let workspace = manager.create_with_type(
        "默认项目".to_string(),
        default_project_path,
        WorkspaceType::Persistent,
    )?;
    manager.set_default(&workspace.id)?;
    let workspace = manager.get(&workspace.id)?.ok_or("创建默认项目失败")?;
    to_workspace_list_item_json(workspace)
}

fn remove_workspace_directory_if_requested(
    manager: &WorkspaceManager,
    workspace_id: &str,
    delete_directory: bool,
) -> Result<(), DynError> {
    if !delete_directory {
        return Ok(());
    }

    let workspace_id = workspace_id.to_string();
    if let Some(workspace) = manager.get(&workspace_id)? {
        let root_path = workspace.root_path;
        if root_path.exists() && root_path.is_dir() {
            std::fs::remove_dir_all(&root_path).map_err(|e| format!("删除目录失败: {e}"))?;
        }
    }

    Ok(())
}

fn ensure_update_root_path(root_path: Option<String>) -> Result<Option<PathBuf>, DynError> {
    match root_path {
        Some(path_str) => {
            let path = PathBuf::from(path_str);
            let created = ensure_workspace_root_ready(&path)?;
            if created {
                tracing::warn!(
                    "[Workspace] 更新路径时检测到目录缺失，已自动创建: {}",
                    path.to_string_lossy()
                );
            }
            Ok(Some(path))
        }
        None => Ok(None),
    }
}

fn ensure_valid_workspace_root(path: &Path) -> Result<(), DynError> {
    ensure_workspace_root_ready(path)?;
    Ok(())
}

pub(super) fn try_handle(
    state: &DevBridgeState,
    cmd: &str,
    args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, DynError> {
    if let Some(result) = management::try_handle(state, cmd, args)? {
        return Ok(Some(result));
    }

    if let Some(result) = queries::try_handle(state, cmd, args)? {
        return Ok(Some(result));
    }

    readiness::try_handle(state, cmd, args)
}
