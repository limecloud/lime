//! 文件浏览器服务
//!
//! 提供文件系统浏览功能
//! 支持目录列表、文件预览等操作
//!
//! # 功能
//! - 列出目录内容
//! - 读取文件预览
//! - 获取文件元信息
//! - 获取文件权限和 MIME 类型

use serde::{Deserialize, Serialize};
use std::fs::{self, Metadata};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tracing::{debug, error};

/// 文件条目
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    /// 文件名
    pub name: String,
    /// 完整路径
    pub path: String,
    /// 是否为目录
    #[serde(rename = "isDir")]
    pub is_dir: bool,
    /// 文件大小（字节）
    pub size: u64,
    /// 修改时间（Unix 时间戳毫秒）
    #[serde(rename = "modifiedAt")]
    pub modified_at: u64,
    /// 文件类型/扩展名
    #[serde(rename = "fileType")]
    pub file_type: Option<String>,
    /// 是否隐藏文件
    #[serde(rename = "isHidden")]
    pub is_hidden: bool,
    /// 文件权限字符串（如 -rw-r--r--）
    #[serde(rename = "modeStr")]
    pub mode_str: Option<String>,
    /// 文件权限数字（8进制）
    pub mode: Option<u32>,
    /// MIME 类型
    #[serde(rename = "mimeType")]
    pub mime_type: Option<String>,
    /// 是否为符号链接
    #[serde(rename = "isSymlink")]
    pub is_symlink: bool,
}

/// 目录列表结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectoryListing {
    /// 当前路径
    pub path: String,
    /// 父目录路径
    #[serde(rename = "parentPath")]
    pub parent_path: Option<String>,
    /// 文件列表
    pub entries: Vec<FileEntry>,
    /// 错误信息
    pub error: Option<String>,
}

/// 文件预览结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilePreview {
    /// 文件路径
    pub path: String,
    /// 文件内容（文本）
    pub content: Option<String>,
    /// 是否为二进制文件
    #[serde(rename = "isBinary")]
    pub is_binary: bool,
    /// 文件大小
    pub size: u64,
    /// 错误信息
    pub error: Option<String>,
}

/// 获取文件扩展名
fn get_file_extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|s| s.to_lowercase())
}

/// 判断是否为隐藏文件
fn is_hidden_file(name: &str) -> bool {
    name.starts_with('.')
}

/// 将 Unix 文件模式转换为权限字符串（如 -rw-r--r--）
#[cfg(unix)]
fn mode_to_string(mode: u32, is_dir: bool, is_symlink: bool) -> String {
    let mut result = String::with_capacity(10);

    // 文件类型
    if is_symlink {
        result.push('l');
    } else if is_dir {
        result.push('d');
    } else {
        result.push('-');
    }

    // 用户权限
    result.push(if mode & 0o400 != 0 { 'r' } else { '-' });
    result.push(if mode & 0o200 != 0 { 'w' } else { '-' });
    result.push(if mode & 0o100 != 0 { 'x' } else { '-' });

    // 组权限
    result.push(if mode & 0o040 != 0 { 'r' } else { '-' });
    result.push(if mode & 0o020 != 0 { 'w' } else { '-' });
    result.push(if mode & 0o010 != 0 { 'x' } else { '-' });

    // 其他用户权限
    result.push(if mode & 0o004 != 0 { 'r' } else { '-' });
    result.push(if mode & 0o002 != 0 { 'w' } else { '-' });
    result.push(if mode & 0o001 != 0 { 'x' } else { '-' });

    result
}

/// 根据文件扩展名和元数据获取 MIME 类型
fn get_mime_type(path: &Path, metadata: &Metadata) -> String {
    // 特殊类型检测
    if metadata.is_dir() {
        return "directory".to_string();
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::FileTypeExt;
        let ft = metadata.file_type();
        if ft.is_symlink() {
            return "symlink".to_string();
        }
        if ft.is_block_device() {
            return "block-device".to_string();
        }
        if ft.is_char_device() {
            return "char-device".to_string();
        }
        if ft.is_fifo() {
            return "pipe".to_string();
        }
        if ft.is_socket() {
            return "socket".to_string();
        }
    }

    // 基于扩展名的 MIME 类型映射
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase());

    match ext.as_deref() {
        // 文本文件
        Some("txt") => "text/plain",
        Some("md" | "markdown") => "text/markdown",
        Some("html" | "htm") => "text/html",
        Some("css") => "text/css",
        Some("xml") => "text/xml",
        Some("csv") => "text/csv",

        // 代码文件
        Some("js" | "mjs" | "cjs") => "text/javascript",
        Some("ts" | "mts" | "cts") => "text/typescript",
        Some("tsx") => "text/tsx",
        Some("jsx") => "text/jsx",
        Some("json") => "application/json",
        Some("yaml" | "yml") => "text/yaml",
        Some("toml") => "text/toml",
        Some("rs") => "text/x-rust",
        Some("py") => "text/x-python",
        Some("go") => "text/x-go",
        Some("java") => "text/x-java",
        Some("c") => "text/x-c",
        Some("cpp" | "cc" | "cxx") => "text/x-c++",
        Some("h" | "hpp") => "text/x-c-header",
        Some("sh" | "bash" | "zsh") => "text/x-shellscript",
        Some("sql") => "text/x-sql",
        Some("vue") => "text/x-vue",
        Some("svelte") => "text/x-svelte",
        Some("swift") => "text/x-swift",
        Some("kt" | "kts") => "text/x-kotlin",
        Some("rb") => "text/x-ruby",
        Some("php") => "text/x-php",
        Some("lua") => "text/x-lua",

        // 图片
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("ico") => "image/x-icon",
        Some("bmp") => "image/bmp",
        Some("tiff" | "tif") => "image/tiff",

        // 音频
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("ogg") => "audio/ogg",
        Some("flac") => "audio/flac",
        Some("aac") => "audio/aac",
        Some("m4a") => "audio/mp4",

        // 视频
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("avi") => "video/x-msvideo",
        Some("mov") => "video/quicktime",
        Some("mkv") => "video/x-matroska",
        Some("wmv") => "video/x-ms-wmv",

        // 压缩文件
        Some("zip") => "application/zip",
        Some("tar") => "application/x-tar",
        Some("gz" | "gzip") => "application/gzip",
        Some("bz2") => "application/x-bzip2",
        Some("xz") => "application/x-xz",
        Some("7z") => "application/x-7z-compressed",
        Some("rar") => "application/vnd.rar",

        // 文档
        Some("pdf") => "application/pdf",
        Some("doc") => "application/msword",
        Some("docx") => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        Some("xls") => "application/vnd.ms-excel",
        Some("xlsx") => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        Some("ppt") => "application/vnd.ms-powerpoint",
        Some("pptx") => "application/vnd.openxmlformats-officedocument.presentationml.presentation",

        // 可执行文件
        Some("exe") => "application/x-msdownload",
        Some("dmg") => "application/x-apple-diskimage",
        Some("app") => "application/x-apple-application",
        Some("deb") => "application/x-debian-package",
        Some("rpm") => "application/x-rpm",

        // 字体
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",

        // 其他
        Some("wasm") => "application/wasm",

        _ => "application/octet-stream",
    }
    .to_string()
}

/// 判断是否为文本文件（基于扩展名）
fn is_text_file(extension: Option<&str>) -> bool {
    match extension {
        Some(ext) => matches!(
            ext,
            "txt"
                | "md"
                | "json"
                | "yaml"
                | "yml"
                | "toml"
                | "xml"
                | "html"
                | "htm"
                | "css"
                | "js"
                | "ts"
                | "tsx"
                | "jsx"
                | "rs"
                | "py"
                | "go"
                | "java"
                | "c"
                | "cpp"
                | "h"
                | "hpp"
                | "sh"
                | "bash"
                | "zsh"
                | "fish"
                | "sql"
                | "graphql"
                | "vue"
                | "svelte"
                | "astro"
                | "log"
                | "env"
                | "gitignore"
                | "dockerignore"
                | "editorconfig"
                | "prettierrc"
                | "eslintrc"
                | "babelrc"
                | "conf"
                | "cfg"
                | "ini"
                | "properties"
        ),
        None => false,
    }
}

/// 列出目录内容
pub fn list_directory(path: &str) -> DirectoryListing {
    let path_buf = if path.is_empty() || path == "~" {
        dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"))
    } else if path.starts_with('~') {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
        home.join(&path[2..])
    } else {
        PathBuf::from(path)
    };

    let canonical_path = match path_buf.canonicalize() {
        Ok(p) => p,
        Err(e) => {
            if e.kind() == std::io::ErrorKind::NotFound {
                debug!("目录尚未创建，返回空列表: {}", path);
            } else {
                error!("无法解析路径 {}: {}", path, e);
            }
            return DirectoryListing {
                path: path.to_string(),
                parent_path: None,
                entries: vec![],
                error: Some(format!("无法解析路径: {e}")),
            };
        }
    };

    let parent_path = canonical_path
        .parent()
        .map(|p| p.to_string_lossy().to_string());

    let entries = match fs::read_dir(&canonical_path) {
        Ok(read_dir) => {
            let mut entries: Vec<FileEntry> = read_dir
                .filter_map(|entry| {
                    let entry = entry.ok()?;
                    // 先获取符号链接信息
                    let symlink_metadata = entry.metadata().ok();
                    let is_symlink = entry
                        .file_type()
                        .ok()
                        .map(|ft| ft.is_symlink())
                        .unwrap_or(false);
                    // 获取真实文件的元数据（解析符号链接）
                    let metadata = if is_symlink {
                        fs::metadata(entry.path()).ok().or(symlink_metadata)?
                    } else {
                        symlink_metadata?
                    };
                    let name = entry.file_name().to_string_lossy().to_string();
                    let path = entry.path();

                    let modified_at = metadata
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0);

                    let file_type = if metadata.is_dir() {
                        Some("folder".to_string())
                    } else {
                        get_file_extension(&path)
                    };

                    // 获取文件权限（仅 Unix）
                    #[cfg(unix)]
                    let (mode, mode_str) = {
                        let m = metadata.permissions().mode();
                        (
                            Some(m & 0o777),
                            Some(mode_to_string(m & 0o777, metadata.is_dir(), is_symlink)),
                        )
                    };
                    #[cfg(not(unix))]
                    let (mode, mode_str): (Option<u32>, Option<String>) = (None, None);

                    // 获取 MIME 类型
                    let mime_type = get_mime_type(&path, &metadata);

                    Some(FileEntry {
                        name: name.clone(),
                        path: path.to_string_lossy().to_string(),
                        is_dir: metadata.is_dir(),
                        size: metadata.len(),
                        modified_at,
                        file_type,
                        is_hidden: is_hidden_file(&name),
                        mode_str,
                        mode,
                        mime_type: Some(mime_type),
                        is_symlink,
                    })
                })
                .collect();

            // 排序：目录在前，然后按名称排序
            entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
            });

            entries
        }
        Err(e) => {
            error!("无法读取目录 {}: {}", canonical_path.display(), e);
            return DirectoryListing {
                path: canonical_path.to_string_lossy().to_string(),
                parent_path,
                entries: vec![],
                error: Some(format!("无法读取目录: {e}")),
            };
        }
    };

    debug!(
        "列出目录 {}: {} 个条目",
        canonical_path.display(),
        entries.len()
    );

    DirectoryListing {
        path: canonical_path.to_string_lossy().to_string(),
        parent_path,
        entries,
        error: None,
    }
}

/// 读取文件预览
pub fn read_file_preview(path: &str, max_size: Option<usize>) -> FilePreview {
    let max_size = max_size.unwrap_or(100 * 1024); // 默认 100KB
    let path_buf = PathBuf::from(path);

    let metadata = match fs::metadata(&path_buf) {
        Ok(m) => m,
        Err(e) => {
            return FilePreview {
                path: path.to_string(),
                content: None,
                is_binary: false,
                size: 0,
                error: Some(format!("无法读取文件元信息: {e}")),
            };
        }
    };

    if metadata.is_dir() {
        return FilePreview {
            path: path.to_string(),
            content: None,
            is_binary: false,
            size: 0,
            error: Some("不能预览目录".to_string()),
        };
    }

    let size = metadata.len();
    let extension = get_file_extension(&path_buf);
    let is_text = is_text_file(extension.as_deref());

    if !is_text {
        return FilePreview {
            path: path.to_string(),
            content: None,
            is_binary: true,
            size,
            error: None,
        };
    }

    // 读取文件内容
    let content = match fs::read(&path_buf) {
        Ok(bytes) => {
            let bytes_to_read = bytes.len().min(max_size);
            match String::from_utf8(bytes[..bytes_to_read].to_vec()) {
                Ok(s) => Some(s),
                Err(_) => {
                    return FilePreview {
                        path: path.to_string(),
                        content: None,
                        is_binary: true,
                        size,
                        error: None,
                    };
                }
            }
        }
        Err(e) => {
            return FilePreview {
                path: path.to_string(),
                content: None,
                is_binary: false,
                size,
                error: Some(format!("无法读取文件: {e}")),
            };
        }
    };

    FilePreview {
        path: path.to_string(),
        content,
        is_binary: false,
        size,
        error: None,
    }
}

/// 服务接口：列出目录
pub async fn list_dir(path: String) -> Result<DirectoryListing, String> {
    Ok(list_directory(&path))
}

/// 服务接口：读取文件预览
pub async fn read_file_preview_cmd(
    path: String,
    max_size: Option<usize>,
) -> Result<FilePreview, String> {
    Ok(read_file_preview(&path, max_size))
}

/// 服务接口：获取用户主目录
pub async fn get_home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "无法获取主目录".to_string())
}

/// 服务接口：创建新文件
pub async fn create_file(path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);

    // 检查文件是否已存在
    if path_buf.exists() {
        return Err("文件已存在".to_string());
    }

    // 确保父目录存在
    if let Some(parent) = path_buf.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("无法创建父目录: {e}"))?;
        }
    }

    // 创建空文件
    fs::File::create(&path_buf).map_err(|e| format!("无法创建文件: {e}"))?;

    debug!("创建文件: {}", path);
    Ok(())
}

/// 服务接口：创建新目录
pub async fn create_directory(path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);

    // 检查目录是否已存在
    if path_buf.exists() {
        return Err("目录已存在".to_string());
    }

    fs::create_dir_all(&path_buf).map_err(|e| format!("无法创建目录: {e}"))?;

    debug!("创建目录: {}", path);
    Ok(())
}

/// 服务接口：删除文件或目录
pub async fn delete_file(path: String, recursive: bool) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);

    if !path_buf.exists() {
        return Err("文件或目录不存在".to_string());
    }

    if path_buf.is_dir() {
        if recursive {
            fs::remove_dir_all(&path_buf).map_err(|e| format!("无法删除目录: {e}"))?;
        } else {
            fs::remove_dir(&path_buf)
                .map_err(|e| format!("无法删除目录（目录非空，需要递归删除）: {e}"))?;
        }
        debug!("删除目录: {}", path);
    } else {
        fs::remove_file(&path_buf).map_err(|e| format!("无法删除文件: {e}"))?;
        debug!("删除文件: {}", path);
    }

    Ok(())
}

/// 服务接口：重命名文件或目录
pub async fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    let old_path_buf = PathBuf::from(&old_path);
    let new_path_buf = PathBuf::from(&new_path);

    if !old_path_buf.exists() {
        return Err("源文件或目录不存在".to_string());
    }

    if new_path_buf.exists() {
        return Err("目标文件或目录已存在".to_string());
    }

    fs::rename(&old_path_buf, &new_path_buf).map_err(|e| format!("无法重命名: {e}"))?;

    debug!("重命名: {} -> {}", old_path, new_path);
    Ok(())
}

/// 服务接口：复制文件名到剪贴板（返回文件名供前端处理）
pub async fn get_file_name(path: String) -> Result<String, String> {
    let path_buf = PathBuf::from(&path);
    path_buf
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "无法获取文件名".to_string())
}

/// 服务接口：在 Finder 中显示文件
pub async fn reveal_in_finder(path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);

    if !path_buf.exists() {
        return Err("文件或目录不存在".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| format!("无法打开 Finder: {e}"))?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| format!("无法打开资源管理器: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        // 尝试使用 xdg-open 打开父目录
        let parent = path_buf.parent().unwrap_or(&path_buf);
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| format!("无法打开文件管理器: {}", e))?;
    }

    Ok(())
}

/// 服务接口：使用默认应用打开文件
pub async fn open_with_default_app(path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);

    if !path_buf.exists() {
        return Err("文件不存在".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("无法打开文件: {e}"))?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|e| format!("无法打开文件: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("无法打开文件: {}", e))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_list_home_directory() {
        let result = list_directory("~");
        assert!(result.error.is_none());
        assert!(!result.entries.is_empty());
    }

    #[test]
    fn test_is_hidden_file() {
        assert!(is_hidden_file(".gitignore"));
        assert!(is_hidden_file(".config"));
        assert!(!is_hidden_file("readme.md"));
    }

    #[test]
    fn test_is_text_file() {
        assert!(is_text_file(Some("txt")));
        assert!(is_text_file(Some("rs")));
        assert!(is_text_file(Some("json")));
        assert!(!is_text_file(Some("png")));
        assert!(!is_text_file(Some("exe")));
        assert!(!is_text_file(None));
    }
}
