//! 会话文件管理 Tauri 命令
//!
//! 提供前端调用的会话文件 CRUD API。

use crate::session_files::{
    SessionDetail, SessionFile, SessionFileStorage, SessionMeta, SessionSummary,
};
use serde_json::Value;
use std::sync::Mutex;
use tauri::State;

/// 会话文件存储状态
pub struct SessionFilesState(pub Mutex<SessionFileStorage>);

// ============================================================================
// 会话管理命令
// ============================================================================

/// 创建新会话
#[tauri::command]
pub fn session_files_create(
    state: State<SessionFilesState>,
    session_id: String,
) -> Result<SessionMeta, String> {
    let storage = state.0.lock().map_err(|e| format!("锁定失败: {e}"))?;
    storage.create_session(&session_id)
}

/// 检查会话是否存在
#[tauri::command]
pub fn session_files_exists(
    state: State<SessionFilesState>,
    session_id: String,
) -> Result<bool, String> {
    let storage = state.0.lock().map_err(|e| format!("锁定失败: {e}"))?;
    Ok(storage.session_exists(&session_id))
}

/// 获取或创建会话
#[tauri::command]
pub fn session_files_get_or_create(
    state: State<SessionFilesState>,
    session_id: String,
) -> Result<SessionMeta, String> {
    let storage = state.0.lock().map_err(|e| format!("锁定失败: {e}"))?;
    storage.get_or_create_session(&session_id)
}

/// 删除会话
#[tauri::command]
pub fn session_files_delete(
    state: State<SessionFilesState>,
    session_id: String,
) -> Result<(), String> {
    let storage = state.0.lock().map_err(|e| format!("锁定失败: {e}"))?;
    storage.delete_session(&session_id)
}

/// 列出所有会话
#[tauri::command]
pub fn session_files_list(state: State<SessionFilesState>) -> Result<Vec<SessionSummary>, String> {
    let storage = state.0.lock().map_err(|e| format!("锁定失败: {e}"))?;
    storage.list_sessions()
}

/// 获取会话详情
#[tauri::command]
pub fn session_files_get_detail(
    state: State<SessionFilesState>,
    session_id: String,
) -> Result<SessionDetail, String> {
    let storage = state.0.lock().map_err(|e| format!("锁定失败: {e}"))?;
    storage.get_session_detail(&session_id)
}

/// 更新会话元数据
#[tauri::command]
pub fn session_files_update_meta(
    state: State<SessionFilesState>,
    session_id: String,
    title: Option<String>,
    theme: Option<String>,
    creation_mode: Option<String>,
) -> Result<SessionMeta, String> {
    let storage = state.0.lock().map_err(|e| format!("锁定失败: {e}"))?;
    storage.update_meta(&session_id, title, theme, creation_mode)
}

// ============================================================================
// 文件管理命令
// ============================================================================

/// 保存文件到会话
#[tauri::command]
pub fn session_files_save_file(
    state: State<SessionFilesState>,
    session_id: String,
    file_name: String,
    content: String,
    metadata: Option<Value>,
) -> Result<SessionFile, String> {
    let storage = state.0.lock().map_err(|e| format!("锁定失败: {e}"))?;
    storage.save_file_with_metadata(&session_id, &file_name, &content, metadata)
}

/// 读取会话文件
#[tauri::command]
pub fn session_files_read_file(
    state: State<SessionFilesState>,
    session_id: String,
    file_name: String,
) -> Result<String, String> {
    let storage = state.0.lock().map_err(|e| format!("锁定失败: {e}"))?;
    storage.read_file(&session_id, &file_name)
}

/// 解析会话文件绝对路径
#[tauri::command]
pub fn session_files_resolve_file_path(
    state: State<SessionFilesState>,
    session_id: String,
    file_name: String,
) -> Result<String, String> {
    let storage = state.0.lock().map_err(|e| format!("锁定失败: {e}"))?;
    storage.resolve_file_path(&session_id, &file_name)
}

/// 删除会话文件
#[tauri::command]
pub fn session_files_delete_file(
    state: State<SessionFilesState>,
    session_id: String,
    file_name: String,
) -> Result<(), String> {
    let storage = state.0.lock().map_err(|e| format!("锁定失败: {e}"))?;
    storage.delete_file(&session_id, &file_name)
}

/// 列出会话中的文件
#[tauri::command]
pub fn session_files_list_files(
    state: State<SessionFilesState>,
    session_id: String,
) -> Result<Vec<SessionFile>, String> {
    let storage = state.0.lock().map_err(|e| format!("锁定失败: {e}"))?;
    storage.list_files(&session_id)
}

// ============================================================================
// 清理命令
// ============================================================================

/// 清理过期会话
#[tauri::command]
pub fn session_files_cleanup_expired(
    state: State<SessionFilesState>,
    max_age_days: Option<u32>,
) -> Result<u32, String> {
    let storage = state.0.lock().map_err(|e| format!("锁定失败: {e}"))?;
    storage.cleanup_expired(max_age_days.unwrap_or(30))
}

/// 清理空会话
#[tauri::command]
pub fn session_files_cleanup_empty(state: State<SessionFilesState>) -> Result<u32, String> {
    let storage = state.0.lock().map_err(|e| format!("锁定失败: {e}"))?;
    storage.cleanup_empty()
}
