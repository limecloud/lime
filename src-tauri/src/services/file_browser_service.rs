//! 文件浏览器服务（Tauri 命令桥接层）
//!
//! 纯逻辑已迁移到 `lime-services` crate，
//! 本模块仅保留 Tauri 命令封装。

pub use lime_services::file_browser_service::{list_directory, read_file_preview};
pub use lime_services::file_browser_service::{
    DirectoryListing, FileEntry, FileManagerLocation, FilePreview,
};

/// Tauri 命令：列出目录
#[tauri::command]
pub async fn list_dir(path: String) -> Result<DirectoryListing, String> {
    lime_services::file_browser_service::list_dir(path).await
}

/// Tauri 命令：读取文件预览
#[tauri::command]
pub async fn read_file_preview_cmd(
    path: String,
    max_size: Option<usize>,
) -> Result<FilePreview, String> {
    lime_services::file_browser_service::read_file_preview_cmd(path, max_size).await
}

/// Tauri 命令：获取用户主目录
#[tauri::command]
pub async fn get_home_dir() -> Result<String, String> {
    lime_services::file_browser_service::get_home_dir().await
}

/// Tauri 命令：获取文件管理器快捷入口
#[tauri::command]
pub async fn get_file_manager_locations() -> Result<Vec<FileManagerLocation>, String> {
    lime_services::file_browser_service::get_file_manager_locations().await
}

/// Tauri 命令：获取文件图标
#[tauri::command]
pub async fn get_file_icon_data_url(path: String) -> Result<Option<String>, String> {
    lime_services::file_browser_service::get_file_icon_data_url(path).await
}

/// Tauri 命令：创建新文件
#[tauri::command]
pub async fn create_file(path: String) -> Result<(), String> {
    lime_services::file_browser_service::create_file(path).await
}

/// Tauri 命令：创建新目录
#[tauri::command]
pub async fn create_directory(path: String) -> Result<(), String> {
    lime_services::file_browser_service::create_directory(path).await
}

/// Tauri 命令：删除文件或目录
#[tauri::command]
pub async fn delete_file(path: String, recursive: bool) -> Result<(), String> {
    lime_services::file_browser_service::delete_file(path, recursive).await
}

/// Tauri 命令：重命名文件或目录
#[tauri::command]
pub async fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    lime_services::file_browser_service::rename_file(old_path, new_path).await
}

/// Tauri 命令：复制文件名到剪贴板（返回文件名供前端处理）
#[tauri::command]
pub async fn get_file_name(path: String) -> Result<String, String> {
    lime_services::file_browser_service::get_file_name(path).await
}

/// Tauri 命令：在 Finder 中显示文件
#[tauri::command]
pub async fn reveal_in_finder(path: String) -> Result<(), String> {
    lime_services::file_browser_service::reveal_in_finder(path).await
}

/// Tauri 命令：使用默认应用打开文件
#[tauri::command]
pub async fn open_with_default_app(path: String) -> Result<(), String> {
    lime_services::file_browser_service::open_with_default_app(path).await
}
