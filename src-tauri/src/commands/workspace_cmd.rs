//! Workspace Tauri 命令模块
//!
//! 提供 Workspace 管理功能的前端调用接口。
//!
//! ## 主要命令
//! - `workspace_create` - 创建新 workspace
//! - `workspace_list` - 获取 workspace 列表
//! - `workspace_get` - 获取 workspace 详情
//! - `workspace_update` - 更新 workspace
//! - `workspace_delete` - 删除 workspace
//! - `workspace_set_default` - 设置默认 workspace
//! - `workspace_get_default` - 获取默认 workspace

use crate::database::DbConnection;
use crate::models::project_model::ProjectContext;
use crate::services::workspace_health_service::{
    ensure_workspace_ready_with_auto_relocate, ensure_workspace_root_ready,
};
use crate::workspace::{
    Workspace, WorkspaceManager, WorkspaceSettings, WorkspaceType, WorkspaceUpdate,
};
use crate::workspace_support::{
    get_or_create_default_project as load_or_create_default_project,
    get_workspace_projects_root_dir, sanitize_project_dir_name,
};
use lime_core::database::lock_db;
use lime_services::project_context_builder::ProjectContextBuilder;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;
use tokio::sync::RwLock;

/// Workspace 管理器状态
#[allow(dead_code)]
pub struct WorkspaceManagerState(pub Arc<RwLock<Option<WorkspaceManager>>>);

/// Workspace 列表项（前端展示用）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceListItem {
    pub id: String,
    pub name: String,
    pub workspace_type: String,
    pub root_path: String,
    pub is_default: bool,
    pub settings: WorkspaceSettings,
    pub created_at: i64,
    pub updated_at: i64,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub is_favorite: bool,
    pub is_archived: bool,
    pub tags: Vec<String>,
}

/// Workspace 目录健康检查结果
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEnsureResult {
    pub workspace_id: String,
    pub root_path: String,
    pub existed: bool,
    pub created: bool,
    pub repaired: bool,
    pub relocated: bool,
    pub previous_root_path: Option<String>,
    pub warning: Option<String>,
}

impl From<Workspace> for WorkspaceListItem {
    fn from(ws: Workspace) -> Self {
        Self {
            id: ws.id,
            name: ws.name,
            workspace_type: ws.workspace_type.as_str().to_string(),
            root_path: ws.root_path.to_string_lossy().to_string(),
            is_default: ws.is_default,
            settings: ws.settings,
            created_at: ws.created_at.timestamp_millis(),
            updated_at: ws.updated_at.timestamp_millis(),
            icon: ws.icon,
            color: ws.color,
            is_favorite: ws.is_favorite,
            is_archived: ws.is_archived,
            tags: ws.tags,
        }
    }
}

/// 创建 workspace 请求
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorkspaceRequest {
    pub name: String,
    pub root_path: String,
    #[serde(default)]
    pub workspace_type: Option<String>,
}

/// 更新 workspace 请求
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateWorkspaceRequest {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub settings: Option<WorkspaceSettings>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub is_favorite: Option<bool>,
    #[serde(default)]
    pub is_archived: Option<bool>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub root_path: Option<String>,
}

// ==================== Tauri 命令 ====================

/// 创建新 workspace
#[tauri::command]
pub async fn workspace_create(
    db: State<'_, DbConnection>,
    request: CreateWorkspaceRequest,
) -> Result<WorkspaceListItem, String> {
    // 验证 root_path 不是 Promise 对象
    if request.root_path.contains("[object Promise]") {
        return Err(format!(
            "无效的 root_path: {}。请确保前端正确 await 了 Promise。",
            request.root_path
        ));
    }

    let manager = WorkspaceManager::new(db.inner().clone());

    let workspace_type = request
        .workspace_type
        .map(|t| WorkspaceType::parse(&t))
        .unwrap_or_default();

    let root_path = PathBuf::from(&request.root_path);

    ensure_workspace_root_ready(&root_path)?;

    let workspace = manager.create_with_type(request.name, root_path, workspace_type)?;

    Ok(workspace.into())
}

/// 获取 workspace 列表
#[tauri::command]
pub async fn workspace_list(db: State<'_, DbConnection>) -> Result<Vec<WorkspaceListItem>, String> {
    let manager = WorkspaceManager::new(db.inner().clone());
    let workspaces = manager.list()?;
    Ok(workspaces.into_iter().map(|ws| ws.into()).collect())
}

/// 获取 workspace 详情
#[tauri::command]
pub async fn workspace_get(
    db: State<'_, DbConnection>,
    id: String,
) -> Result<Option<WorkspaceListItem>, String> {
    let manager = WorkspaceManager::new(db.inner().clone());
    let workspace = manager.get(&id)?;
    Ok(workspace.map(|ws| ws.into()))
}

/// 更新 workspace
#[tauri::command]
pub async fn workspace_update(
    db: State<'_, DbConnection>,
    id: String,
    request: UpdateWorkspaceRequest,
) -> Result<WorkspaceListItem, String> {
    let manager = WorkspaceManager::new(db.inner().clone());

    let new_root_path = if let Some(ref path_str) = request.root_path {
        let path = PathBuf::from(path_str);
        let created = ensure_workspace_root_ready(&path)?;
        if created {
            tracing::warn!(
                "[Workspace] 更新路径时检测到目录缺失，已自动创建: {}",
                path.to_string_lossy()
            );
        }
        Some(path)
    } else {
        None
    };

    let updates = WorkspaceUpdate {
        name: request.name,
        settings: request.settings,
        icon: request.icon,
        color: request.color,
        is_favorite: request.is_favorite,
        is_archived: request.is_archived,
        tags: request.tags,
        root_path: new_root_path,
    };

    let workspace = manager.update(&id, updates)?;
    Ok(workspace.into())
}

/// 删除 workspace
#[tauri::command]
pub async fn workspace_delete(
    db: State<'_, DbConnection>,
    id: String,
    delete_directory: Option<bool>,
) -> Result<bool, String> {
    let manager = WorkspaceManager::new(db.inner().clone());

    // 如果需要删除目录，先获取 workspace 信息
    if delete_directory.unwrap_or(false) {
        if let Some(workspace) = manager.get(&id)? {
            let root_path = workspace.root_path;
            if root_path.exists() && root_path.is_dir() {
                std::fs::remove_dir_all(&root_path).map_err(|e| format!("删除目录失败: {e}"))?;
                tracing::info!("[Workspace] 删除目录: {:?}", root_path);
            }
        }
    }

    manager.delete(&id)
}

/// 设置默认 workspace
#[tauri::command]
pub async fn workspace_set_default(db: State<'_, DbConnection>, id: String) -> Result<(), String> {
    let manager = WorkspaceManager::new(db.inner().clone());
    manager.set_default(&id)
}

/// 获取默认 workspace
#[tauri::command]
pub async fn workspace_get_default(
    db: State<'_, DbConnection>,
) -> Result<Option<WorkspaceListItem>, String> {
    let manager = WorkspaceManager::new(db.inner().clone());
    let workspace = manager.get_default()?;
    Ok(workspace.map(|ws| ws.into()))
}

/// 修复指定 workspace 的目录可用性
#[tauri::command]
pub async fn workspace_ensure_ready(
    db: State<'_, DbConnection>,
    id: String,
) -> Result<WorkspaceEnsureResult, String> {
    let manager = WorkspaceManager::new(db.inner().clone());
    let workspace = manager
        .get(&id)?
        .ok_or_else(|| format!("Workspace 不存在: {id}"))?;
    let ensured = ensure_workspace_ready_with_auto_relocate(&manager, &workspace)?;
    let root_path = ensured.root_path.to_string_lossy().to_string();
    let previous_root_path = ensured
        .previous_root_path
        .as_ref()
        .map(|path| path.to_string_lossy().to_string());

    if ensured.repaired {
        tracing::warn!(
            "[Workspace] 检测到目录异常并已修复: id={}, root={}, relocated={}",
            workspace.id,
            root_path,
            ensured.relocated
        );
    }

    Ok(WorkspaceEnsureResult {
        workspace_id: workspace.id,
        root_path,
        existed: ensured.existed,
        created: ensured.created,
        repaired: ensured.repaired,
        relocated: ensured.relocated,
        previous_root_path,
        warning: ensured.warning,
    })
}

/// 修复默认 workspace 的目录可用性（若无默认 workspace 返回 null）
#[tauri::command]
pub async fn workspace_ensure_default_ready(
    db: State<'_, DbConnection>,
) -> Result<Option<WorkspaceEnsureResult>, String> {
    let manager = WorkspaceManager::new(db.inner().clone());
    let Some(workspace) = manager.get_default()? else {
        return Ok(None);
    };
    let ensured = ensure_workspace_ready_with_auto_relocate(&manager, &workspace)?;
    let root_path = ensured.root_path.to_string_lossy().to_string();
    let previous_root_path = ensured
        .previous_root_path
        .as_ref()
        .map(|path| path.to_string_lossy().to_string());
    if ensured.repaired {
        tracing::warn!(
            "[Workspace] 启动检查发现默认 workspace 目录异常并已修复: id={}, root={}, relocated={}",
            workspace.id,
            root_path,
            ensured.relocated
        );
    }
    Ok(Some(WorkspaceEnsureResult {
        workspace_id: workspace.id,
        root_path,
        existed: ensured.existed,
        created: ensured.created,
        repaired: ensured.repaired,
        relocated: ensured.relocated,
        previous_root_path,
        warning: ensured.warning,
    }))
}

/// 通过路径获取 workspace
#[tauri::command]
pub async fn workspace_get_by_path(
    db: State<'_, DbConnection>,
    root_path: String,
) -> Result<Option<WorkspaceListItem>, String> {
    let manager = WorkspaceManager::new(db.inner().clone());
    let workspace = manager.get_by_path(&PathBuf::from(&root_path))?;
    Ok(workspace.map(|ws| ws.into()))
}

/// 获取统一 workspace 项目根目录
#[tauri::command]
pub async fn workspace_get_projects_root() -> Result<String, String> {
    let root_dir = get_workspace_projects_root_dir()?;
    Ok(root_dir.to_string_lossy().to_string())
}

/// 根据项目名称解析最终项目目录（固定在 workspace 根目录下）
#[tauri::command]
pub async fn workspace_resolve_project_path(name: String) -> Result<String, String> {
    let root_dir = get_workspace_projects_root_dir()?;
    let dir_name = sanitize_project_dir_name(&name);
    let project_path = root_dir.join(dir_name);
    Ok(project_path.to_string_lossy().to_string())
}

// ==================== 项目上下文相关命令 ====================

/// 获取或创建默认项目
///
/// 如果默认项目不存在，则自动创建一个。
/// 用于确保系统始终有一个默认项目可用。
///
/// # 返回
/// - 成功返回默认项目
/// - 失败返回错误信息
#[tauri::command]
pub async fn get_or_create_default_project(
    db: State<'_, DbConnection>,
) -> Result<WorkspaceListItem, String> {
    let manager = WorkspaceManager::new(db.inner().clone());
    Ok(load_or_create_default_project(&manager)?.into())
}

/// 获取项目上下文
///
/// 加载项目的完整上下文，包括人设、素材等配置。
/// 用于在发送消息前构建 AI 的 System Prompt。
///
/// # 参数
/// - `project_id`: 项目 ID
///
/// # 返回
/// - 成功返回项目上下文
/// - 失败返回错误信息
#[tauri::command]
pub async fn get_project_context(
    db: State<'_, DbConnection>,
    project_id: String,
) -> Result<ProjectContext, String> {
    let conn = lock_db(&db).map_err(|e| format!("数据库锁定失败: {e}"))?;
    ProjectContextBuilder::build_context(&conn, &project_id).map_err(|e| e.to_string())
}

/// 构建项目 System Prompt
///
/// 根据项目配置构建 AI 的 System Prompt。
/// 包含人设信息、素材引用等。
///
/// # 参数
/// - `project_id`: 项目 ID
///
/// # 返回
/// - 成功返回构建好的 System Prompt 字符串
/// - 失败返回错误信息
#[tauri::command]
pub async fn build_project_system_prompt(
    db: State<'_, DbConnection>,
    project_id: String,
) -> Result<String, String> {
    let conn = lock_db(&db).map_err(|e| format!("数据库锁定失败: {e}"))?;
    ProjectContextBuilder::build_system_prompt_for_project(&conn, &project_id)
        .map_err(|e| e.to_string())
}
