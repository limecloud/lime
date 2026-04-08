//! 媒体处理模块
//!
//! 提供图片、PDF、SVG 等媒体文件的处理功能

mod image;
mod mime;
mod pdf;
mod svg;

pub use image::*;
pub use mime::*;
pub use pdf::*;
pub use svg::*;

// 重新导出增强函数
pub use image::estimate_image_dimensions;
pub use image::read_image_file_enhanced;

use std::path::Path;

/// 媒体文件类型
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaType {
    Image,
    Pdf,
    Svg,
    Unknown,
}

/// 媒体读取结果
#[derive(Debug, Clone)]
pub enum MediaResult {
    Image(ImageResult),
    Pdf(PdfReadResult),
}

/// 检测文件的媒体类型
pub fn detect_media_type(file_path: &Path) -> MediaType {
    let ext = file_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if is_supported_image_format(&ext) {
        return MediaType::Image;
    }

    if is_pdf_extension(&ext) {
        return MediaType::Pdf;
    }

    if ext == "svg" {
        return MediaType::Svg;
    }

    MediaType::Unknown
}

/// 检查文件是否为支持的媒体文件
pub fn is_supported_media_file(file_path: &Path) -> bool {
    detect_media_type(file_path) != MediaType::Unknown
}

/// 二进制文件黑名单
/// 这些文件类型不应该被读取
pub static BINARY_FILE_BLACKLIST: &[&str] = &[
    // 音频格式
    "mp3", "wav", "flac", "ogg", "aac", "m4a", "wma", "aiff", "opus", // 视频格式
    "mp4", "avi", "mov", "wmv", "flv", "mkv", "webm", "m4v", "mpeg", "mpg",
    // 压缩文件
    "zip", "rar", "tar", "gz", "bz2", "7z", "xz", "z", "tgz", "iso", // 可执行文件
    "exe", "dll", "so", "dylib", "app", "msi", "deb", "rpm", "bin", // 数据库文件
    "dat", "db", "sqlite", "sqlite3", "mdb", "idx", // Office 文档（旧格式）
    "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", // 字体文件
    "ttf", "otf", "woff", "woff2", "eot", // 设计文件
    "psd", "ai", "eps", "sketch", "fig", "xd", "blend", "obj", "3ds", "max",
    // 编译文件
    "class", "jar", "war", "pyc", "pyo", "rlib", "swf", "fla",
];

/// 检查文件是否在黑名单中
pub fn is_blacklisted_file(file_path: &Path) -> bool {
    let ext = file_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    BINARY_FILE_BLACKLIST.contains(&ext.as_str())
}

#[cfg(test)]
mod tests;
