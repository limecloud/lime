//! 图片处理模块
//!

use base64::{engine::general_purpose::STANDARD, Engine};
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::sync::LazyLock;

use super::mime::get_mime_type_sync;

/// 支持的图片格式
pub static SUPPORTED_IMAGE_FORMATS: LazyLock<HashSet<&'static str>> =
    LazyLock::new(|| HashSet::from(["png", "jpg", "jpeg", "gif", "webp"]));

/// 最大图片 token 数
pub const MAX_IMAGE_TOKENS: u64 = 25000;

/// 图片压缩配置
pub struct ImageCompressionConfig {
    pub max_width: u32,
    pub max_height: u32,
    pub quality: u8,
}

pub const IMAGE_COMPRESSION_CONFIG: ImageCompressionConfig = ImageCompressionConfig {
    max_width: 400,
    max_height: 400,
    quality: 20,
};

/// 图片尺寸信息
#[derive(Debug, Clone, Default)]
pub struct ImageDimensions {
    pub original_width: Option<u32>,
    pub original_height: Option<u32>,
    pub display_width: Option<u32>,
    pub display_height: Option<u32>,
}

/// 图片处理结果
#[derive(Debug, Clone)]
pub struct ImageResult {
    pub base64: String,
    pub mime_type: String,
    pub original_size: u64,
    pub dimensions: Option<ImageDimensions>,
}

/// 检查是否为支持的图片格式
pub fn is_supported_image_format(ext: &str) -> bool {
    let normalized = ext.to_lowercase().replace('.', "");
    SUPPORTED_IMAGE_FORMATS.contains(normalized.as_str())
}

/// 估算图片的 token 消耗
pub fn estimate_image_tokens(base64: &str) -> u64 {
    (base64.len() as f64 * 0.125).ceil() as u64
}

/// 读取图片文件（同步版本，不压缩）
pub fn read_image_file_sync(file_path: &Path) -> Result<ImageResult, String> {
    let metadata =
        fs::metadata(file_path).map_err(|e| format!("Failed to read file metadata: {}", e))?;

    if metadata.len() == 0 {
        return Err(format!("Image file is empty: {}", file_path.display()));
    }

    let buffer = fs::read(file_path).map_err(|e| format!("Failed to read file: {}", e))?;

    let ext = file_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();

    let mime_type = get_mime_type_sync(&buffer)
        .unwrap_or_else(|| Box::leak(format!("image/{}", ext).into_boxed_str()));

    let base64 = STANDARD.encode(&buffer);

    Ok(ImageResult {
        base64,
        mime_type: mime_type.to_string(),
        original_size: metadata.len(),
        dimensions: None,
    })
}

/// 验证图片文件
pub fn validate_image_file(file_path: &Path) -> Result<(), String> {
    if !file_path.exists() {
        return Err("File does not exist".to_string());
    }

    let metadata =
        fs::metadata(file_path).map_err(|e| format!("Failed to read metadata: {}", e))?;

    if metadata.len() == 0 {
        return Err("Image file is empty".to_string());
    }

    let ext = file_path.extension().and_then(|e| e.to_str()).unwrap_or("");

    if !is_supported_image_format(ext) {
        return Err(format!(
            "Unsupported image format: {}. Supported: {:?}",
            ext,
            SUPPORTED_IMAGE_FORMATS.iter().collect::<Vec<_>>()
        ));
    }

    Ok(())
}

/// 读取图片文件（增强版本，包含尺寸提取）
///
/// 参考 claude-code-open 实现，提供更详细的图片信息
pub fn read_image_file_enhanced(file_path: &Path) -> Result<ImageResult, String> {
    let metadata =
        fs::metadata(file_path).map_err(|e| format!("Failed to read file metadata: {}", e))?;

    if metadata.len() == 0 {
        return Err(format!("Image file is empty: {}", file_path.display()));
    }

    let buffer = fs::read(file_path).map_err(|e| format!("Failed to read file: {}", e))?;

    let ext = file_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();

    let mime_type = get_mime_type_sync(&buffer)
        .unwrap_or_else(|| Box::leak(format!("image/{}", ext).into_boxed_str()));

    let base64 = STANDARD.encode(&buffer);

    // 计算 token 估算
    let _token_estimate = estimate_image_tokens(&base64);

    // 尝试提取图片尺寸（基于文件大小和格式）
    let dimensions = estimate_image_dimensions(&buffer, metadata.len());

    Ok(ImageResult {
        base64,
        mime_type: mime_type.to_string(),
        original_size: metadata.len(),
        dimensions: Some(dimensions),
    })
}

/// 估算图片尺寸（基于文件大小和格式）
///
/// 这是一个简化版本，不依赖外部图像处理库
/// 实际项目中可以添加 image-rs 或 sharp 等库进行精确提取
pub fn estimate_image_dimensions(_buffer: &[u8], file_size: u64) -> ImageDimensions {
    // TODO: 集成 image-rs 或 sharp 库来提取实际尺寸
    //
    // 需要在 Cargo.toml 中添加：
    // image-rs = { version = "0.25", features = ["jpeg", "png", "gif", "webp"] }
    //
    // 然后使用：
    // let reader = image::ImageReader::new(Cursor::new(buffer))
    //     .with_guessed_format();
    // let dimensions = reader.dimensions().unwrap();
    //
    // 暂时基于文件大小估算（非常粗略）
    let estimated_pixels = file_size / 3; // 假设每个像素平均 3 字节（RGB）
    let estimated_size = (estimated_pixels as f64).sqrt() as u32;
    let size = estimated_size.max(100); // 最小 100x100

    ImageDimensions {
        original_width: Some(size),
        original_height: Some(size),
        display_width: Some(size),
        display_height: Some(size),
    }
}
