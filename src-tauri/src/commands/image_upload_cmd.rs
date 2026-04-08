//! 图片上传 Tauri 命令
//!
//! 提供图片上传到会话文件系统的功能。

use crate::commands::session_files_cmd::SessionFilesState;
use base64::{engine::general_purpose, Engine as _};
use std::path::Path;
use tauri::State;

/// 支持的图片格式
const SUPPORTED_IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp"];

/// 图片文件最大大小（10MB）
const MAX_IMAGE_SIZE: u64 = 10 * 1024 * 1024;

/// 验证文件是否为支持的图片格式
fn is_supported_image(file_path: &str) -> bool {
    let path = Path::new(file_path);
    if let Some(ext) = path.extension() {
        let ext_str = ext.to_string_lossy().to_lowercase();
        return SUPPORTED_IMAGE_EXTENSIONS.contains(&ext_str.as_str());
    }
    false
}

/// 上传图片到会话
///
/// # 参数
/// - `session_id`: 会话ID
/// - `file_path`: 本地图片文件路径
///
/// # 返回
/// 返回图片在会话中的访问路径
#[tauri::command]
pub async fn upload_image_to_session(
    state: State<'_, SessionFilesState>,
    session_id: String,
    file_path: String,
) -> Result<String, String> {
    // 验证文件格式
    if !is_supported_image(&file_path) {
        return Err(format!(
            "不支持的图片格式。支持的格式：{}",
            SUPPORTED_IMAGE_EXTENSIONS.join(", ")
        ));
    }

    // 检查文件是否存在
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err("文件不存在".to_string());
    }

    // 检查文件大小
    let metadata = std::fs::metadata(path).map_err(|e| format!("读取文件元数据失败: {}", e))?;
    if metadata.len() > MAX_IMAGE_SIZE {
        return Err(format!(
            "图片文件过大（最大 {}MB）",
            MAX_IMAGE_SIZE / 1024 / 1024
        ));
    }

    // 读取文件内容
    let content = std::fs::read(path).map_err(|e| format!("读取文件失败: {}", e))?;

    // 生成文件名
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("无效的文件名")?;

    // 保存文件（使用 base64 编码存储二进制数据）
    let base64_content = general_purpose::STANDARD.encode(&content);

    // 调用 session_files_cmd 的函数来保存文件
    super::session_files_cmd::session_files_save_file(
        state.clone(),
        session_id.clone(),
        file_name.to_string(),
        base64_content,
        None,
    )?;

    // 返回文件访问路径
    super::session_files_cmd::session_files_resolve_file_path(
        state,
        session_id,
        file_name.to_string(),
    )
}

/// 从会话中读取图片（返回 base64 编码）
#[tauri::command]
pub fn read_image_from_session(
    state: State<SessionFilesState>,
    session_id: String,
    file_name: String,
) -> Result<String, String> {
    super::session_files_cmd::session_files_read_file(state, session_id, file_name)
}
