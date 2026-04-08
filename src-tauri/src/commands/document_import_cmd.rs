//! 文档导入 Tauri 命令
//!
//! 提供文档导入和解析功能。

use crate::commands::session_files_cmd::SessionFilesState;
use std::path::Path;
use tauri::State;

/// 支持的文档格式
const SUPPORTED_DOC_EXTENSIONS: &[&str] = &["md", "txt"];

/// 文档文件最大大小（5MB）
const MAX_DOC_SIZE: u64 = 5 * 1024 * 1024;

/// 验证文件是否为支持的文档格式
fn is_supported_document(file_path: &str) -> bool {
    let path = Path::new(file_path);
    if let Some(ext) = path.extension() {
        let ext_str = ext.to_string_lossy().to_lowercase();
        return SUPPORTED_DOC_EXTENSIONS.contains(&ext_str.as_str());
    }
    false
}

/// 导入文档内容
///
/// # 参数
/// - `file_path`: 本地文档文件路径
///
/// # 返回
/// 返回文档的文本内容
#[tauri::command]
pub async fn import_document(file_path: String) -> Result<String, String> {
    // 验证文件格式
    if !is_supported_document(&file_path) {
        return Err(format!(
            "不支持的文档格式。支持的格式：{}",
            SUPPORTED_DOC_EXTENSIONS.join(", ")
        ));
    }

    // 检查文件是否存在
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err("文件不存在".to_string());
    }

    // 检查文件大小
    let metadata = std::fs::metadata(path).map_err(|e| format!("读取文件元数据失败: {}", e))?;
    if metadata.len() > MAX_DOC_SIZE {
        return Err(format!(
            "文档文件过大（最大 {}MB）",
            MAX_DOC_SIZE / 1024 / 1024
        ));
    }

    // 读取文件内容
    let content = std::fs::read_to_string(path).map_err(|e| format!("读取文件失败: {}", e))?;

    Ok(content)
}

/// 导入文档并保存到会话
///
/// # 参数
/// - `session_id`: 会话ID
/// - `file_path`: 本地文档文件路径
///
/// # 返回
/// 返回文档内容和保存的文件名
#[tauri::command]
pub async fn import_document_to_session(
    state: State<'_, SessionFilesState>,
    session_id: String,
    file_path: String,
) -> Result<(String, String), String> {
    // 导入文档内容
    let content = import_document(file_path.clone()).await?;

    // 生成文件名
    let path = Path::new(&file_path);
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("无效的文件名")?;

    // 保存到会话文件系统
    super::session_files_cmd::session_files_save_file(
        state,
        session_id,
        file_name.to_string(),
        content.clone(),
        None,
    )?;

    Ok((content, file_name.to_string()))
}

/// 保存导出的文档到指定路径
///
/// # 参数
/// - `file_path`: 用户选择的目标文件路径
/// - `content`: 要写入的文本内容
#[tauri::command]
pub async fn save_exported_document(file_path: String, content: String) -> Result<(), String> {
    let path = Path::new(&file_path);

    if file_path.trim().is_empty() {
        return Err("导出路径不能为空".to_string());
    }

    if let Some(parent) = path.parent() {
        if parent.as_os_str().is_empty() {
            return std::fs::write(path, content).map_err(|e| format!("保存导出文件失败: {}", e));
        }
        std::fs::create_dir_all(parent).map_err(|e| format!("创建导出目录失败: {}", e))?;
    }

    std::fs::write(path, content).map_err(|e| format!("保存导出文件失败: {}", e))?;
    Ok(())
}
