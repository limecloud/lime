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

#![allow(deprecated, unexpected_cfgs)]

use base64::{engine::general_purpose, Engine as _};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, Metadata};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::Semaphore;
use tracing::{debug, error};

static FILE_ICON_DATA_URL_CACHE: Lazy<Mutex<HashMap<String, Option<String>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static FILE_ICON_RESOLVE_SEMAPHORE: Lazy<Arc<Semaphore>> =
    Lazy::new(|| Arc::new(Semaphore::new(2)));

const FILE_ICON_RESOLVE_ACQUIRE_TIMEOUT: Duration = Duration::from_millis(80);
const FILE_ICON_RESOLVE_TIMEOUT: Duration = Duration::from_millis(900);

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
    /// 原生文件/应用图标，PNG data URL
    #[serde(rename = "iconDataUrl", skip_serializing_if = "Option::is_none")]
    pub icon_data_url: Option<String>,
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

/// 文件管理器快捷入口
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileManagerLocation {
    /// 稳定 ID
    pub id: String,
    /// 展示名称
    pub label: String,
    /// 入口目录绝对路径
    pub path: String,
    /// 入口类型
    pub kind: String,
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

fn encode_png_data_url(bytes: &[u8]) -> Option<String> {
    if bytes.is_empty() {
        return None;
    }
    Some(format!(
        "data:image/png;base64,{}",
        general_purpose::STANDARD.encode(bytes)
    ))
}

fn temporary_icon_png_path() -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!(
        "lime-file-icon-{}-{unique}.png",
        std::process::id()
    ))
}

fn normalize_bundle_icon_file_name(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_matches('"').trim();
    if trimmed.is_empty() {
        return None;
    }
    Path::new(trimmed)
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
}

fn resolve_cached_file_icon_data_url(
    path: &Path,
    metadata: &Metadata,
    name: &str,
) -> Option<String> {
    if !should_resolve_file_icon(path, metadata, name) {
        return None;
    }

    let cache_key = path.to_string_lossy().to_string();
    if let Some(cached) = FILE_ICON_DATA_URL_CACHE.lock().get(&cache_key).cloned() {
        return cached;
    }

    let icon_data_url = resolve_platform_file_icon_data_url(path, metadata, name);
    FILE_ICON_DATA_URL_CACHE
        .lock()
        .insert(cache_key, icon_data_url.clone());
    icon_data_url
}

fn get_cached_file_icon_data_url(path: &Path) -> Option<String> {
    FILE_ICON_DATA_URL_CACHE
        .lock()
        .get(&path.to_string_lossy().to_string())
        .and_then(|cached| cached.clone())
}

fn get_file_icon_cache_entry(path: &Path) -> Option<Option<String>> {
    FILE_ICON_DATA_URL_CACHE
        .lock()
        .get(&path.to_string_lossy().to_string())
        .cloned()
}

fn should_resolve_file_icon(path: &Path, metadata: &Metadata, name: &str) -> bool {
    #[cfg(target_os = "macos")]
    {
        let _ = (path, metadata, name);
        true
    }

    #[cfg(target_os = "windows")]
    {
        let _ = metadata;
        let extension = path
            .extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or("");
        matches!(
            extension.to_ascii_lowercase().as_str(),
            "exe" | "lnk" | "appref-ms"
        ) || name.ends_with(".lnk")
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (path, metadata, name);
        false
    }
}

#[cfg(target_os = "macos")]
fn resolve_platform_file_icon_data_url(
    path: &Path,
    metadata: &Metadata,
    _name: &str,
) -> Option<String> {
    resolve_macos_system_icon_data_url(path).or_else(|| {
        if is_macos_app_bundle(path, metadata) {
            resolve_macos_app_icon_data_url(path)
        } else {
            None
        }
    })
}

#[cfg(target_os = "windows")]
fn resolve_platform_file_icon_data_url(
    path: &Path,
    _metadata: &Metadata,
    _name: &str,
) -> Option<String> {
    resolve_windows_associated_icon_data_url(path)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn resolve_platform_file_icon_data_url(
    _path: &Path,
    _metadata: &Metadata,
    _name: &str,
) -> Option<String> {
    None
}

#[cfg(target_os = "macos")]
fn resolve_macos_app_icon_data_url(app_path: &Path) -> Option<String> {
    let resources_dir = app_path.join("Contents").join("Resources");
    let icon_path = resolve_macos_bundle_icon_path(app_path, &resources_dir)
        .or_else(|| find_first_icns_file(&resources_dir))?;
    convert_macos_icns_to_png_data_url(&icon_path)
}

#[cfg(target_os = "macos")]
fn is_macos_app_bundle(path: &Path, metadata: &Metadata) -> bool {
    metadata.is_dir()
        && path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.eq_ignore_ascii_case("app"))
            .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn resolve_macos_system_icon_data_url(path: &Path) -> Option<String> {
    use cocoa::base::{id, nil};
    use cocoa::foundation::{NSAutoreleasePool, NSDictionary, NSSize, NSString, NSUInteger};
    use objc::{class, msg_send, sel, sel_impl};

    unsafe {
        let pool = NSAutoreleasePool::new(nil);
        let path_string = path.to_string_lossy();
        let ns_path = NSString::alloc(nil).init_str(path_string.as_ref());
        let workspace: id = msg_send![class!(NSWorkspace), sharedWorkspace];
        let icon: id = msg_send![workspace, iconForFile: ns_path];
        if icon == nil {
            pool.drain();
            return None;
        }

        let _: () = msg_send![icon, setSize: NSSize::new(128.0, 128.0)];
        let tiff_data: id = msg_send![icon, TIFFRepresentation];
        if tiff_data == nil {
            pool.drain();
            return None;
        }

        let bitmap_rep: id = msg_send![class!(NSBitmapImageRep), imageRepWithData: tiff_data];
        if bitmap_rep == nil {
            pool.drain();
            return None;
        }

        let properties = NSDictionary::dictionary(nil);
        let png_type = 4 as NSUInteger;
        let png_data: id =
            msg_send![bitmap_rep, representationUsingType: png_type properties: properties];
        let bytes = nsdata_to_vec(png_data);
        pool.drain();
        bytes.and_then(|bytes| encode_png_data_url(&bytes))
    }
}

#[cfg(target_os = "macos")]
unsafe fn nsdata_to_vec(data: cocoa::base::id) -> Option<Vec<u8>> {
    use cocoa::base::nil;
    use cocoa::foundation::NSData;

    if data == nil {
        return None;
    }
    let len = data.length() as usize;
    if len == 0 {
        return None;
    }
    let ptr = data.bytes() as *const u8;
    if ptr.is_null() {
        return None;
    }
    Some(std::slice::from_raw_parts(ptr, len).to_vec())
}

#[cfg(target_os = "macos")]
fn resolve_macos_bundle_icon_path(app_path: &Path, resources_dir: &Path) -> Option<PathBuf> {
    let info_plist = app_path.join("Contents").join("Info.plist");
    if !info_plist.is_file() {
        return None;
    }

    let output = std::process::Command::new("/usr/bin/plutil")
        .args(["-extract", "CFBundleIconFile", "raw", "-o", "-"])
        .arg(info_plist)
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let icon_name = normalize_bundle_icon_file_name(&String::from_utf8_lossy(&output.stdout))?;
    let mut candidates = Vec::with_capacity(2);
    candidates.push(resources_dir.join(&icon_name));
    if Path::new(&icon_name).extension().is_none() {
        candidates.push(resources_dir.join(format!("{icon_name}.icns")));
    }

    candidates.into_iter().find(|candidate| candidate.is_file())
}

#[cfg(target_os = "macos")]
fn find_first_icns_file(resources_dir: &Path) -> Option<PathBuf> {
    let read_dir = fs::read_dir(resources_dir).ok()?;
    let mut candidates: Vec<PathBuf> = read_dir
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| {
            path.extension()
                .and_then(|extension| extension.to_str())
                .map(|extension| extension.eq_ignore_ascii_case("icns"))
                .unwrap_or(false)
        })
        .collect();

    candidates.sort_by_key(|path| {
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        (
            !file_name.contains("appicon"),
            !file_name.contains("icon"),
            file_name,
        )
    });
    candidates.into_iter().next()
}

#[cfg(target_os = "macos")]
fn convert_macos_icns_to_png_data_url(icon_path: &Path) -> Option<String> {
    let output_path = temporary_icon_png_path();
    let result = std::process::Command::new("/usr/bin/sips")
        .args(["-s", "format", "png"])
        .arg(icon_path)
        .arg("--out")
        .arg(&output_path)
        .output();

    let converted = match result {
        Ok(output) if output.status.success() => fs::read(&output_path).ok(),
        _ => None,
    };
    let _ = fs::remove_file(&output_path);
    converted.and_then(|bytes| encode_png_data_url(&bytes))
}

#[cfg(target_os = "windows")]
fn resolve_windows_associated_icon_data_url(path: &Path) -> Option<String> {
    let output_path = temporary_icon_png_path();
    let script = r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($env:LIME_ICON_SOURCE)
if ($null -eq $icon) { exit 2 }
$bitmap = $icon.ToBitmap()
$bitmap.Save($env:LIME_ICON_OUTPUT, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()
$icon.Dispose()
"#;

    let encoded_script = encode_powershell_script(script);
    let result = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-EncodedCommand",
            &encoded_script,
        ])
        .env("LIME_ICON_SOURCE", path)
        .env("LIME_ICON_OUTPUT", &output_path)
        .output();

    let rendered = match result {
        Ok(output) if output.status.success() => fs::read(&output_path).ok(),
        _ => None,
    };
    let _ = fs::remove_file(&output_path);
    rendered.and_then(|bytes| encode_png_data_url(&bytes))
}

#[cfg(target_os = "windows")]
fn encode_powershell_script(script: &str) -> String {
    let mut bytes = Vec::with_capacity(script.len() * 2);
    for unit in script.encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    general_purpose::STANDARD.encode(bytes)
}

fn append_file_manager_location(
    locations: &mut Vec<FileManagerLocation>,
    seen_paths: &mut std::collections::HashSet<String>,
    id: &str,
    label: &str,
    kind: &str,
    path: Option<PathBuf>,
) {
    let Some(path) = path else {
        return;
    };

    if !path.is_dir() {
        return;
    }

    let normalized_path = path.to_string_lossy().to_string();
    if normalized_path.trim().is_empty() || !seen_paths.insert(normalized_path.clone()) {
        return;
    }

    locations.push(FileManagerLocation {
        id: id.to_string(),
        label: label.to_string(),
        path: normalized_path,
        kind: kind.to_string(),
    });
}

/// 获取文件管理器快捷入口
pub fn file_manager_locations() -> Vec<FileManagerLocation> {
    let mut locations = Vec::new();
    let mut seen_paths = std::collections::HashSet::new();
    let home_dir = dirs::home_dir();

    append_file_manager_location(
        &mut locations,
        &mut seen_paths,
        "home",
        "个人",
        "home",
        home_dir.clone(),
    );
    append_file_manager_location(
        &mut locations,
        &mut seen_paths,
        "desktop",
        "桌面",
        "desktop",
        dirs::desktop_dir(),
    );
    append_file_manager_location(
        &mut locations,
        &mut seen_paths,
        "documents",
        "文档",
        "documents",
        dirs::document_dir(),
    );
    append_file_manager_location(
        &mut locations,
        &mut seen_paths,
        "downloads",
        "下载",
        "downloads",
        dirs::download_dir(),
    );

    #[cfg(target_os = "macos")]
    {
        append_file_manager_location(
            &mut locations,
            &mut seen_paths,
            "applications",
            "应用程序",
            "applications",
            Some(PathBuf::from("/Applications")),
        );
        append_file_manager_location(
            &mut locations,
            &mut seen_paths,
            "user-applications",
            "用户应用程序",
            "applications",
            home_dir.map(|home| home.join("Applications")),
        );
    }

    #[cfg(target_os = "windows")]
    {
        append_file_manager_location(
            &mut locations,
            &mut seen_paths,
            "start-menu-programs",
            "应用程序",
            "applications",
            std::env::var_os("APPDATA").map(|dir| {
                PathBuf::from(dir)
                    .join("Microsoft")
                    .join("Windows")
                    .join("Start Menu")
                    .join("Programs")
            }),
        );
        append_file_manager_location(
            &mut locations,
            &mut seen_paths,
            "common-start-menu-programs",
            "公共应用程序",
            "applications",
            std::env::var_os("PROGRAMDATA").map(|dir| {
                PathBuf::from(dir)
                    .join("Microsoft")
                    .join("Windows")
                    .join("Start Menu")
                    .join("Programs")
            }),
        );
        append_file_manager_location(
            &mut locations,
            &mut seen_paths,
            "program-files",
            "Program Files",
            "applications",
            std::env::var_os("ProgramFiles").map(PathBuf::from),
        );
        append_file_manager_location(
            &mut locations,
            &mut seen_paths,
            "program-files-x86",
            "Program Files (x86)",
            "applications",
            std::env::var_os("ProgramFiles(x86)").map(PathBuf::from),
        );
    }

    locations
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
                    let icon_data_url = get_cached_file_icon_data_url(&path);

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
                        icon_data_url,
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
    tokio::task::spawn_blocking(move || list_directory(&path))
        .await
        .map_err(|e| format!("目录读取任务失败: {e}"))
}

/// 服务接口：读取文件预览
pub async fn read_file_preview_cmd(
    path: String,
    max_size: Option<usize>,
) -> Result<FilePreview, String> {
    tokio::task::spawn_blocking(move || read_file_preview(&path, max_size))
        .await
        .map_err(|e| format!("文件预览任务失败: {e}"))
}

/// 服务接口：异步获取文件图标
pub async fn get_file_icon_data_url(path: String) -> Result<Option<String>, String> {
    let path_buf = PathBuf::from(&path);
    if let Some(cached) = get_file_icon_cache_entry(&path_buf) {
        return Ok(cached);
    }

    let semaphore = Arc::clone(&FILE_ICON_RESOLVE_SEMAPHORE);
    let permit =
        match tokio::time::timeout(FILE_ICON_RESOLVE_ACQUIRE_TIMEOUT, semaphore.acquire_owned())
            .await
        {
            Ok(Ok(permit)) => permit,
            Ok(Err(_)) => return Ok(None),
            Err(_) => return Ok(None),
        };

    let resolve_task = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let metadata = fs::metadata(&path_buf).ok()?;
        let name = path_buf
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("");
        resolve_cached_file_icon_data_url(&path_buf, &metadata, name)
    });

    match tokio::time::timeout(FILE_ICON_RESOLVE_TIMEOUT, resolve_task).await {
        Ok(Ok(icon_data_url)) => Ok(icon_data_url),
        Ok(Err(join_error)) => Err(format!("文件图标读取任务失败: {join_error}")),
        Err(_) => Ok(None),
    }
}

/// 服务接口：获取用户主目录
pub async fn get_home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "无法获取主目录".to_string())
}

/// 服务接口：获取文件管理器快捷入口
pub async fn get_file_manager_locations() -> Result<Vec<FileManagerLocation>, String> {
    Ok(file_manager_locations())
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
    fn test_normalize_bundle_icon_file_name() {
        assert_eq!(
            normalize_bundle_icon_file_name(" AppIcon.icns\n"),
            Some("AppIcon.icns".to_string())
        );
        assert_eq!(
            normalize_bundle_icon_file_name("../Resources/AppIcon"),
            Some("AppIcon".to_string())
        );
        assert_eq!(normalize_bundle_icon_file_name("   "), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_resolve_macos_bundle_icon_path_from_plist() {
        let temp_dir = tempfile::tempdir().expect("应创建临时目录");
        let app_dir = temp_dir.path().join("Demo.app");
        let contents_dir = app_dir.join("Contents");
        let resources_dir = contents_dir.join("Resources");
        fs::create_dir_all(&resources_dir).expect("应创建应用资源目录");
        fs::write(resources_dir.join("AppIcon.icns"), []).expect("应创建图标文件");
        fs::write(
            contents_dir.join("Info.plist"),
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
</dict>
</plist>
"#,
        )
        .expect("应写入 Info.plist");

        assert_eq!(
            resolve_macos_bundle_icon_path(&app_dir, &resources_dir),
            Some(resources_dir.join("AppIcon.icns"))
        );
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
