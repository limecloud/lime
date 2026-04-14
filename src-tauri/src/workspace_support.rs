use crate::workspace::{Workspace, WorkspaceManager, WorkspaceType};
use lime_core::app_paths;
use std::path::PathBuf;

const LEGACY_DEFAULT_WORKSPACE_ID: &str = "workspace-default";

pub(crate) fn get_workspace_projects_root_dir() -> Result<PathBuf, String> {
    app_paths::resolve_projects_dir()
}

pub(crate) fn resolve_default_project_path() -> Result<PathBuf, String> {
    app_paths::resolve_default_project_dir()
}

pub(crate) fn sanitize_project_dir_name(name: &str) -> String {
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

fn is_legacy_default_workspace(workspace: &Workspace) -> bool {
    workspace
        .id
        .trim()
        .eq_ignore_ascii_case(LEGACY_DEFAULT_WORKSPACE_ID)
}

fn create_current_default_project(manager: &WorkspaceManager) -> Result<Workspace, String> {
    let default_project_path = resolve_default_project_path()?;

    if let Some(existing_workspace) = manager.get_by_path(&default_project_path)? {
        if !is_legacy_default_workspace(&existing_workspace) {
            manager.set_default(&existing_workspace.id)?;
            return manager
                .get(&existing_workspace.id)?
                .ok_or_else(|| "加载默认项目失败".to_string());
        }

        tracing::warn!(
            "[Workspace] 当前默认项目路径仍被 legacy workspace 占用: id={}, path={}",
            existing_workspace.id,
            default_project_path.to_string_lossy()
        );
    }

    let creation_path = if manager.get_by_path(&default_project_path)?.is_some() {
        let file_name = default_project_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("default");
        default_project_path.with_file_name(format!("{file_name}-current"))
    } else {
        default_project_path
    };

    std::fs::create_dir_all(&creation_path).map_err(|e| format!("创建默认项目目录失败: {e}"))?;

    if let Some(existing_workspace) = manager.get_by_path(&creation_path)? {
        manager.set_default(&existing_workspace.id)?;
        return manager
            .get(&existing_workspace.id)?
            .ok_or_else(|| "加载默认项目失败".to_string());
    }

    let workspace = manager.create_with_type(
        "默认项目".to_string(),
        creation_path,
        WorkspaceType::Persistent,
    )?;
    manager.set_default(&workspace.id)?;

    manager
        .get(&workspace.id)?
        .ok_or_else(|| "创建默认项目失败".to_string())
}

pub(crate) fn get_current_default_project(
    manager: &WorkspaceManager,
) -> Result<Option<Workspace>, String> {
    match manager.get_default()? {
        Some(workspace) if !is_legacy_default_workspace(&workspace) => Ok(Some(workspace)),
        Some(workspace) => {
            tracing::warn!(
                "[Workspace] 检测到 legacy 默认项目，自动迁移到 current 路径: id={}, path={}",
                workspace.id,
                workspace.root_path.to_string_lossy()
            );
            Ok(Some(create_current_default_project(manager)?))
        }
        None => Ok(None),
    }
}

pub(crate) fn get_or_create_default_project(
    manager: &WorkspaceManager,
) -> Result<Workspace, String> {
    if let Some(workspace) = get_current_default_project(manager)? {
        return Ok(workspace);
    }

    create_current_default_project(manager)
}

#[cfg(test)]
mod tests {
    use super::sanitize_project_dir_name;

    #[test]
    fn sanitize_project_dir_name_should_replace_invalid_chars() {
        assert_eq!(sanitize_project_dir_name("  a/b:c*?d  "), "a_b_c__d");
    }

    #[test]
    fn sanitize_project_dir_name_should_fallback_when_empty() {
        assert_eq!(sanitize_project_dir_name(" .. "), "未命名项目");
    }
}
