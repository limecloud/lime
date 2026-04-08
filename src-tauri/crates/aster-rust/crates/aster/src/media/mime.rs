//! MIME 类型检测模块
//!
//! 基于文件头 magic bytes 检测文件类型

/// 同步获取 MIME 类型（基于文件头 magic bytes）
pub fn get_mime_type_sync(buffer: &[u8]) -> Option<&'static str> {
    // PNG: 89 50 4E 47
    if buffer.len() >= 8
        && buffer[0] == 0x89
        && buffer[1] == 0x50
        && buffer[2] == 0x4E
        && buffer[3] == 0x47
    {
        return Some("image/png");
    }

    // JPEG: FF D8 FF
    if buffer.len() >= 3 && buffer[0] == 0xFF && buffer[1] == 0xD8 && buffer[2] == 0xFF {
        return Some("image/jpeg");
    }

    // GIF: 47 49 46
    if buffer.len() >= 6 && buffer[0] == 0x47 && buffer[1] == 0x49 && buffer[2] == 0x46 {
        return Some("image/gif");
    }

    // WebP: 52 49 46 46 ... 57 45 42 50
    if buffer.len() >= 12
        && buffer[0] == 0x52
        && buffer[1] == 0x49
        && buffer[2] == 0x46
        && buffer[3] == 0x46
        && buffer[8] == 0x57
        && buffer[9] == 0x45
        && buffer[10] == 0x42
        && buffer[11] == 0x50
    {
        return Some("image/webp");
    }

    // PDF: 25 50 44 46 2D (%PDF-)
    if buffer.len() >= 5
        && buffer[0] == 0x25
        && buffer[1] == 0x50
        && buffer[2] == 0x44
        && buffer[3] == 0x46
        && buffer[4] == 0x2D
    {
        return Some("application/pdf");
    }

    // SVG: 检查文本内容
    if buffer.len() >= 100 {
        if let Ok(text) = std::str::from_utf8(&buffer[..buffer.len().min(1000)]) {
            if text.contains("<svg") || text.contains("<?xml") {
                return Some("image/svg+xml");
            }
        }
    }

    None
}

/// 媒体类别
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaCategory {
    Image,
    Pdf,
    Video,
    Audio,
    Unknown,
}

/// 根据 MIME 类型获取媒体类别
pub fn get_media_category(mime_type: &str) -> MediaCategory {
    if mime_type.starts_with("image/") {
        MediaCategory::Image
    } else if mime_type == "application/pdf" {
        MediaCategory::Pdf
    } else if mime_type.starts_with("video/") {
        MediaCategory::Video
    } else if mime_type.starts_with("audio/") {
        MediaCategory::Audio
    } else {
        MediaCategory::Unknown
    }
}

/// 从文件扩展名推断 MIME 类型
pub fn get_mime_type_from_extension(ext: &str) -> &'static str {
    let normalized = ext.to_lowercase().replace('.', "");

    match normalized.as_str() {
        // 图片
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        // 文档
        "pdf" => "application/pdf",
        // 视频
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "avi" => "video/x-msvideo",
        // 音频
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        _ => "application/octet-stream",
    }
}
