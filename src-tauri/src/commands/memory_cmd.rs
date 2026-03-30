//! Memory 相关的 Tauri 命令
//!
//! 提供项目记忆系统（角色、世界观、大纲）的前端 API。

use crate::database::DbConnection;
use crate::logger;
use crate::memory::{
    Character, CharacterCreateRequest, CharacterUpdateRequest, MemoryManager, OutlineNode,
    OutlineNodeCreateRequest, OutlineNodeUpdateRequest, ProjectMemory, WorldBuilding,
    WorldBuildingUpdateRequest,
};
use crate::LogState;
use serde::{Deserialize, Serialize};
use std::time::Instant;
use tauri::State;

// ==================== 角色相关命令 ====================

/// 创建角色请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateCharacterRequest {
    pub project_id: String,
    pub name: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub personality: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub appearance: Option<String>,
    #[serde(default)]
    pub is_main: bool,
}

/// 创建角色
#[tauri::command]
pub async fn character_create(
    db: State<'_, DbConnection>,
    request: CreateCharacterRequest,
) -> Result<Character, String> {
    let manager = MemoryManager::new(db.inner().clone());

    let create_request = CharacterCreateRequest {
        project_id: request.project_id,
        name: request.name,
        aliases: request.aliases,
        description: request.description,
        personality: request.personality,
        background: request.background,
        appearance: request.appearance,
        is_main: request.is_main,
    };

    manager.create_character(create_request)
}

/// 获取角色
#[tauri::command]
pub async fn character_get(
    db: State<'_, DbConnection>,
    id: String,
) -> Result<Option<Character>, String> {
    let manager = MemoryManager::new(db.inner().clone());
    manager.get_character(&id)
}

/// 列出项目的所有角色
#[tauri::command]
pub async fn character_list(
    db: State<'_, DbConnection>,
    project_id: String,
) -> Result<Vec<Character>, String> {
    let manager = MemoryManager::new(db.inner().clone());
    manager.list_characters(&project_id)
}

/// 更新角色
#[tauri::command]
pub async fn character_update(
    db: State<'_, DbConnection>,
    id: String,
    request: CharacterUpdateRequest,
) -> Result<Character, String> {
    let manager = MemoryManager::new(db.inner().clone());
    manager.update_character(&id, request)
}

/// 删除角色
#[tauri::command]
pub async fn character_delete(db: State<'_, DbConnection>, id: String) -> Result<bool, String> {
    let manager = MemoryManager::new(db.inner().clone());
    manager.delete_character(&id)
}

// ==================== 世界观相关命令 ====================

/// 获取世界观
#[tauri::command]
pub async fn world_building_get(
    db: State<'_, DbConnection>,
    project_id: String,
) -> Result<Option<WorldBuilding>, String> {
    let manager = MemoryManager::new(db.inner().clone());
    manager.get_world_building(&project_id)
}

/// 更新世界观
#[tauri::command]
pub async fn world_building_update(
    db: State<'_, DbConnection>,
    project_id: String,
    request: WorldBuildingUpdateRequest,
) -> Result<WorldBuilding, String> {
    let manager = MemoryManager::new(db.inner().clone());
    manager.upsert_world_building(&project_id, request)
}

// ==================== 大纲相关命令 ====================

/// 创建大纲节点请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateOutlineNodeRequest {
    pub project_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<i32>,
}

/// 创建大纲节点
#[tauri::command]
pub async fn outline_node_create(
    db: State<'_, DbConnection>,
    request: CreateOutlineNodeRequest,
) -> Result<OutlineNode, String> {
    let manager = MemoryManager::new(db.inner().clone());

    let create_request = OutlineNodeCreateRequest {
        project_id: request.project_id,
        parent_id: request.parent_id,
        title: request.title,
        content: request.content,
        content_id: request.content_id,
        order: request.order,
    };

    manager.create_outline_node(create_request)
}

/// 获取大纲节点
#[tauri::command]
pub async fn outline_node_get(
    db: State<'_, DbConnection>,
    id: String,
) -> Result<Option<OutlineNode>, String> {
    let manager = MemoryManager::new(db.inner().clone());
    manager.get_outline_node(&id)
}

/// 列出项目的所有大纲节点
#[tauri::command]
pub async fn outline_node_list(
    db: State<'_, DbConnection>,
    project_id: String,
) -> Result<Vec<OutlineNode>, String> {
    let manager = MemoryManager::new(db.inner().clone());
    manager.list_outline_nodes(&project_id)
}

/// 更新大纲节点
#[tauri::command]
pub async fn outline_node_update(
    db: State<'_, DbConnection>,
    id: String,
    request: OutlineNodeUpdateRequest,
) -> Result<OutlineNode, String> {
    let manager = MemoryManager::new(db.inner().clone());
    manager.update_outline_node(&id, request)
}

/// 删除大纲节点
#[tauri::command]
pub async fn outline_node_delete(db: State<'_, DbConnection>, id: String) -> Result<bool, String> {
    let manager = MemoryManager::new(db.inner().clone());
    manager.delete_outline_node(&id)
}

// ==================== 聚合查询命令 ====================

/// 获取项目的完整记忆
#[tauri::command]
pub async fn project_memory_get(
    db: State<'_, DbConnection>,
    logs: State<'_, LogState>,
    project_id: String,
) -> Result<ProjectMemory, String> {
    let started_at = Instant::now();
    let sanitized_project_id = logger::sanitize_log_message(&project_id);
    logs.write().await.add(
        "info",
        &format!("[AgentDiag] project_memory_get.start project_id={sanitized_project_id}"),
    );
    let manager = MemoryManager::new(db.inner().clone());
    match manager.get_project_memory(&project_id) {
        Ok(memory) => {
            logs.write().await.add(
                "info",
                &format!(
                    "[AgentDiag] project_memory_get.success project_id={sanitized_project_id} duration_ms={} characters={} outline={} has_world_building={}",
                    started_at.elapsed().as_millis(),
                    memory.characters.len(),
                    memory.outline.len(),
                    memory.world_building.is_some(),
                ),
            );
            Ok(memory)
        }
        Err(error) => {
            logs.write().await.add(
                "error",
                &format!(
                    "[AgentDiag] project_memory_get.error project_id={sanitized_project_id} duration_ms={} error={}",
                    started_at.elapsed().as_millis(),
                    logger::sanitize_log_message(&error),
                ),
            );
            Err(error)
        }
    }
}
