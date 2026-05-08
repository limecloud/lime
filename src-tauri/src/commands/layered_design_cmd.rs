//! 图层化设计工程导出与扁平图分析命令。
//!
//! 该模块只负责把 `LayeredDesignDocument` 的导出投影写入项目目录，
//! 或把扁平图分析结果投影回 `LayeredDesignDocument.extraction`，
//! 不定义新的设计事实源。

use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::io::Cursor;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;
use url::Url;

const LAYERED_DESIGN_EXPORT_ROOT: &str = ".lime/layered-designs";
const MAX_LAYERED_DESIGN_EXPORT_FILES: usize = 512;
const MAX_REMOTE_LAYERED_DESIGN_ASSET_BYTES: usize = 20 * 1024 * 1024;
const REMOTE_LAYERED_DESIGN_ASSET_TIMEOUT_SECS: u64 = 20;
const MAX_LAYERED_DESIGN_OCR_IMAGE_BYTES: usize = 20 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayeredDesignProjectExportFile {
    pub relative_path: String,
    pub mime_type: String,
    pub encoding: String,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveLayeredDesignProjectExportRequest {
    pub project_root_path: String,
    pub document_id: String,
    pub title: String,
    #[serde(default)]
    pub directory_name: Option<String>,
    #[serde(default)]
    pub files: Vec<LayeredDesignProjectExportFile>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadLayeredDesignProjectExportRequest {
    pub project_root_path: String,
    #[serde(default)]
    pub export_directory_relative_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecognizeLayeredDesignTextRequest {
    pub image_src: String,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub candidate_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeLayeredDesignFlatImageRequest {
    pub image: AnalyzeLayeredDesignFlatImageInput,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeLayeredDesignFlatImageInput {
    pub src: String,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub mime_type: Option<String>,
    #[serde(default)]
    pub has_alpha: Option<bool>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SaveLayeredDesignProjectExportOutput {
    pub project_root_path: String,
    pub export_directory_path: String,
    pub export_directory_relative_path: String,
    pub design_path: String,
    pub manifest_path: String,
    pub preview_png_path: Option<String>,
    pub asset_count: usize,
    pub file_count: usize,
    pub bytes_written: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadLayeredDesignProjectExportOutput {
    pub project_root_path: String,
    pub export_directory_path: String,
    pub export_directory_relative_path: String,
    pub design_path: String,
    pub design_json: String,
    pub manifest_path: Option<String>,
    pub manifest_json: Option<String>,
    pub psd_like_manifest_path: Option<String>,
    pub psd_like_manifest_json: Option<String>,
    pub preview_png_path: Option<String>,
    pub asset_count: usize,
    pub file_count: usize,
    pub updated_at_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LayeredDesignTextBoundingBox {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LayeredDesignRecognizedTextBlock {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bounding_box: Option<LayeredDesignTextBoundingBox>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f32>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecognizeLayeredDesignTextOutput {
    pub supported: bool,
    pub engine: String,
    pub blocks: Vec<LayeredDesignRecognizedTextBlock>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeLayeredDesignFlatImageOutput {
    pub supported: bool,
    pub engine: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<LayeredDesignStructuredAnalyzerResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LayeredDesignStructuredAnalyzerResult {
    pub analyzer: LayeredDesignStructuredAnalyzerInfo,
    pub generated_at: String,
    pub candidates: Vec<LayeredDesignStructuredCandidate>,
    pub clean_plate: LayeredDesignStructuredCleanPlate,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LayeredDesignStructuredAnalyzerInfo {
    pub kind: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LayeredDesignStructuredCandidate {
    pub id: String,
    #[serde(rename = "type")]
    pub candidate_type: String,
    pub role: String,
    pub name: String,
    pub confidence: f32,
    pub rect: LayeredDesignTextBoundingBox,
    pub z_index: i32,
    pub image: LayeredDesignStructuredAsset,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mask: Option<LayeredDesignStructuredAsset>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LayeredDesignStructuredAsset {
    pub id: String,
    pub kind: String,
    pub src: String,
    pub width: u32,
    pub height: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_alpha: Option<bool>,
    pub created_at: String,
    pub params: Value,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LayeredDesignStructuredCleanPlate {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset: Option<LayeredDesignStructuredAsset>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone)]
struct NativeAnalyzerCandidateSpec {
    id: &'static str,
    name: &'static str,
    role: &'static str,
    kind: &'static str,
    rect: NativeAnalyzerRect,
    confidence: f32,
    z_index: i32,
}

#[derive(Debug, Clone, Copy)]
struct NativeAnalyzerRect {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

#[derive(Debug, Clone)]
struct NativeAnalyzerCleanPlateResult {
    image: RgbaImage,
    filled_pixel_count: u64,
}

#[derive(Debug, Clone)]
struct PreparedExportFile {
    relative_path: PathBuf,
    content: Vec<u8>,
}

#[derive(Debug, Clone)]
struct CachedRemoteAsset {
    asset_id: String,
    original_src: String,
    filename: String,
    content: Vec<u8>,
}

fn normalize_required_string(value: &str, label: &str) -> Result<String, String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(format!("{label} 不能为空"));
    }
    Ok(normalized.to_string())
}

fn sanitize_directory_name(value: &str, fallback: &str) -> String {
    let mut output = String::new();
    let mut previous_dash = false;

    for character in value.trim().chars() {
        let next = if character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-') {
            previous_dash = false;
            Some(character.to_ascii_lowercase())
        } else if character.is_whitespace() || matches!(character, '/' | '\\' | ':' | '|') {
            if previous_dash {
                None
            } else {
                previous_dash = true;
                Some('-')
            }
        } else {
            None
        };

        if let Some(next) = next {
            output.push(next);
        }

        if output.len() >= 96 {
            break;
        }
    }

    let trimmed = output.trim_matches(|character| character == '-' || character == '.');
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn resolve_export_directory_name(request: &SaveLayeredDesignProjectExportRequest) -> String {
    let fallback = sanitize_directory_name(&request.document_id, "layered-design");
    let raw_name = request
        .directory_name
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            if request.title.trim().is_empty() {
                request.document_id.as_str()
            } else {
                request.title.as_str()
            }
        });

    sanitize_directory_name(raw_name, &fallback)
}

fn normalize_relative_path(relative_path: &str) -> Result<PathBuf, String> {
    let normalized = relative_path.trim().replace('\\', "/");
    if normalized.is_empty() {
        return Err("导出文件相对路径不能为空".to_string());
    }

    let candidate = Path::new(&normalized);
    if candidate.is_absolute() {
        return Err(format!("导出文件路径必须是相对路径: {relative_path}"));
    }

    let mut output = PathBuf::new();
    for component in candidate.components() {
        match component {
            Component::Normal(segment) => output.push(segment),
            _ => {
                return Err(format!(
                    "导出文件路径不能包含目录穿越或根路径: {relative_path}"
                ));
            }
        }
    }

    if output.as_os_str().is_empty() {
        return Err("导出文件相对路径不能为空".to_string());
    }

    Ok(output)
}

fn decode_export_file_content(file: &LayeredDesignProjectExportFile) -> Result<Vec<u8>, String> {
    let encoding = file.encoding.trim().to_ascii_lowercase();
    match encoding.as_str() {
        "utf8" | "utf-8" => Ok(file.content.as_bytes().to_vec()),
        "base64" => STANDARD.decode(file.content.trim()).map_err(|error| {
            format!(
                "导出文件 {} 的 base64 内容无效: {error}",
                file.relative_path
            )
        }),
        _ => Err(format!(
            "导出文件 {} 使用了不支持的编码: {}",
            file.relative_path, file.encoding
        )),
    }
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn relative_path_to_string(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn require_absolute_project_root(project_root_path: &str) -> Result<PathBuf, String> {
    let project_root_path = normalize_required_string(project_root_path, "projectRootPath")?;
    let project_root = PathBuf::from(project_root_path);
    if !project_root.is_absolute() {
        return Err("projectRootPath 必须是绝对路径".to_string());
    }
    Ok(project_root)
}

fn decode_layered_design_ocr_image_data_url(image_src: &str) -> Result<Option<Vec<u8>>, String> {
    let Some(rest) = image_src.trim().strip_prefix("data:") else {
        return Ok(None);
    };
    let Some((header, encoded)) = rest.split_once(',') else {
        return Err("OCR 图片 data URL 格式无效".to_string());
    };
    let mut header_parts = header.split(';');
    let mime_type = header_parts.next().unwrap_or_default();
    let is_base64 = header_parts.any(|part| part.eq_ignore_ascii_case("base64"));

    if !mime_type.to_ascii_lowercase().starts_with("image/") {
        return Ok(None);
    }
    if !is_base64 {
        return Err("OCR 图片 data URL 必须使用 base64 编码".to_string());
    }
    if encoded.len() > MAX_LAYERED_DESIGN_OCR_IMAGE_BYTES * 2 {
        return Err("OCR 图片 data URL 超过大小上限".to_string());
    }

    let bytes = STANDARD
        .decode(encoded.trim())
        .map_err(|error| format!("OCR 图片 base64 无效: {error}"))?;
    if bytes.len() > MAX_LAYERED_DESIGN_OCR_IMAGE_BYTES {
        return Err("OCR 图片超过大小上限".to_string());
    }

    Ok(Some(bytes))
}

fn decode_layered_design_analyzer_png_data_url(image_src: &str) -> Result<Option<Vec<u8>>, String> {
    let Some(rest) = image_src.trim().strip_prefix("data:") else {
        return Ok(None);
    };
    let Some((header, encoded)) = rest.split_once(',') else {
        return Err("Analyzer 图片 data URL 格式无效".to_string());
    };
    let mut header_parts = header.split(';');
    let mime_type = header_parts.next().unwrap_or_default().to_ascii_lowercase();
    let is_base64 = header_parts.any(|part| part.eq_ignore_ascii_case("base64"));

    if mime_type != "image/png" {
        return Ok(None);
    }
    if !is_base64 {
        return Err("Analyzer 图片 data URL 必须使用 base64 编码".to_string());
    }
    if encoded.len() > MAX_LAYERED_DESIGN_OCR_IMAGE_BYTES * 2 {
        return Err("Analyzer 图片 data URL 超过大小上限".to_string());
    }

    let bytes = STANDARD
        .decode(encoded.trim())
        .map_err(|error| format!("Analyzer 图片 base64 无效: {error}"))?;
    if bytes.len() > MAX_LAYERED_DESIGN_OCR_IMAGE_BYTES {
        return Err("Analyzer 图片超过大小上限".to_string());
    }

    Ok(Some(bytes))
}

fn native_analyzer_unsupported_output(
    message: impl Into<String>,
) -> AnalyzeLayeredDesignFlatImageOutput {
    AnalyzeLayeredDesignFlatImageOutput {
        supported: false,
        engine: "native_heuristic_analyzer".to_string(),
        result: None,
        message: Some(message.into()),
    }
}

fn clamp_u32(value: u32, min: u32, max: u32) -> u32 {
    value.max(min).min(max)
}

fn native_analyzer_crop_rect(
    image_width: u32,
    image_height: u32,
    left_ratio: f32,
    top_ratio: f32,
    width_ratio: f32,
    height_ratio: f32,
) -> NativeAnalyzerRect {
    let width = clamp_u32(
        (image_width as f32 * width_ratio).round() as u32,
        72_u32.min(image_width),
        image_width,
    );
    let height = clamp_u32(
        (image_height as f32 * height_ratio).round() as u32,
        72_u32.min(image_height),
        image_height,
    );
    let x = clamp_u32(
        (image_width as f32 * left_ratio).round() as u32,
        0,
        image_width.saturating_sub(width),
    );
    let y = clamp_u32(
        (image_height as f32 * top_ratio).round() as u32,
        0,
        image_height.saturating_sub(height),
    );

    NativeAnalyzerRect {
        x,
        y,
        width,
        height,
    }
}

fn build_native_analyzer_candidate_specs(
    image_width: u32,
    image_height: u32,
) -> Vec<NativeAnalyzerCandidateSpec> {
    vec![
        NativeAnalyzerCandidateSpec {
            id: "subject",
            name: "主体候选",
            role: "subject",
            kind: "subject",
            rect: native_analyzer_crop_rect(image_width, image_height, 0.16, 0.16, 0.68, 0.7),
            confidence: 0.74,
            z_index: 20,
        },
        NativeAnalyzerCandidateSpec {
            id: "headline",
            name: "标题文字候选",
            role: "text",
            kind: "text_raster",
            rect: native_analyzer_crop_rect(image_width, image_height, 0.12, 0.06, 0.76, 0.18),
            confidence: 0.62,
            z_index: 40,
        },
        NativeAnalyzerCandidateSpec {
            id: "logo",
            name: "Logo 候选",
            role: "logo",
            kind: "logo",
            rect: native_analyzer_crop_rect(image_width, image_height, 0.06, 0.06, 0.28, 0.16),
            confidence: 0.48,
            z_index: 48,
        },
        NativeAnalyzerCandidateSpec {
            id: "fragment",
            name: "边角碎片",
            role: "background_fragment",
            kind: "effect",
            rect: native_analyzer_crop_rect(image_width, image_height, 0.72, 0.72, 0.22, 0.22),
            confidence: 0.22,
            z_index: 56,
        },
    ]
}

fn is_inside_native_analyzer_ellipse(x: u32, y: u32, width: u32, height: u32) -> bool {
    let center_x = width as f32 / 2.0;
    let center_y = height as f32 / 2.0;
    let radius_x = (width as f32 * 0.42).max(1.0);
    let radius_y = (height as f32 * 0.46).max(1.0);
    let dx = (x as f32 + 0.5 - center_x) / radius_x;
    let dy = (y as f32 + 0.5 - center_y) / radius_y;
    dx * dx + dy * dy <= 1.0
}

fn native_analyzer_rect_pixel_count(rect: NativeAnalyzerRect) -> u64 {
    u64::from(rect.width) * u64::from(rect.height)
}

fn count_native_analyzer_ellipse_pixels(rect: NativeAnalyzerRect) -> u64 {
    let mut count = 0_u64;
    for y in 0..rect.height {
        for x in 0..rect.width {
            if is_inside_native_analyzer_ellipse(x, y, rect.width, rect.height) {
                count += 1;
            }
        }
    }
    count
}

fn encode_rgba_png_data_url(image: &RgbaImage) -> Result<String, String> {
    let mut output = Vec::new();
    let dynamic = DynamicImage::ImageRgba8(image.clone());
    dynamic
        .write_to(&mut Cursor::new(&mut output), ImageFormat::Png)
        .map_err(|error| format!("编码 analyzer PNG 失败: {error}"))?;
    Ok(format!("data:image/png;base64,{}", STANDARD.encode(output)))
}

fn crop_native_analyzer_image(source: &RgbaImage, rect: NativeAnalyzerRect) -> RgbaImage {
    image::imageops::crop_imm(source, rect.x, rect.y, rect.width, rect.height).to_image()
}

fn create_native_analyzer_mask(rect: NativeAnalyzerRect) -> RgbaImage {
    let mut mask = RgbaImage::from_pixel(rect.width, rect.height, Rgba([0, 0, 0, 255]));
    for y in 0..rect.height {
        for x in 0..rect.width {
            if is_inside_native_analyzer_ellipse(x, y, rect.width, rect.height) {
                mask.put_pixel(x, y, Rgba([255, 255, 255, 255]));
            }
        }
    }
    mask
}

fn apply_native_analyzer_mask(crop: &RgbaImage, rect: NativeAnalyzerRect) -> RgbaImage {
    let mut output = crop.clone();
    for y in 0..rect.height {
        for x in 0..rect.width {
            if !is_inside_native_analyzer_ellipse(x, y, rect.width, rect.height) {
                let pixel = output.get_pixel_mut(x, y);
                pixel.0[3] = 0;
            }
        }
    }
    output
}

fn average_native_analyzer_corner_color(source: &RgbaImage) -> Rgba<u8> {
    let width = source.width().saturating_sub(1);
    let height = source.height().saturating_sub(1);
    let samples = [
        source.get_pixel(0, 0),
        source.get_pixel(width, 0),
        source.get_pixel(0, height),
        source.get_pixel(width, height),
    ];
    let channel = |index: usize| -> u8 {
        (samples
            .iter()
            .map(|pixel| u32::from(pixel.0[index]))
            .sum::<u32>()
            / samples.len() as u32)
            .min(255) as u8
    };

    Rgba([channel(0), channel(1), channel(2), 250])
}

fn create_native_analyzer_clean_plate(
    source: &RgbaImage,
    rect: NativeAnalyzerRect,
) -> NativeAnalyzerCleanPlateResult {
    let mut output = source.clone();
    let fill = average_native_analyzer_corner_color(source);
    let mut filled_pixel_count = 0_u64;
    for y in 0..rect.height {
        for x in 0..rect.width {
            if is_inside_native_analyzer_ellipse(x, y, rect.width, rect.height) {
                let target_x = rect.x + x;
                let target_y = rect.y + y;
                if target_x < output.width() && target_y < output.height() {
                    output.put_pixel(target_x, target_y, fill);
                    filled_pixel_count += 1;
                }
            }
        }
    }
    NativeAnalyzerCleanPlateResult {
        image: output,
        filled_pixel_count,
    }
}

fn native_analyzer_rect_value(rect: NativeAnalyzerRect) -> Value {
    serde_json::json!({
        "x": rect.x,
        "y": rect.y,
        "width": rect.width,
        "height": rect.height,
    })
}

fn unsupported_layered_design_text_ocr_output(
    message: impl Into<String>,
) -> RecognizeLayeredDesignTextOutput {
    RecognizeLayeredDesignTextOutput {
        supported: false,
        engine: "native_ocr_unavailable".to_string(),
        blocks: Vec::new(),
        message: Some(message.into()),
    }
}

fn ensure_layered_design_export_relative_dir(relative_path: PathBuf) -> Result<PathBuf, String> {
    let export_root = Path::new(LAYERED_DESIGN_EXPORT_ROOT);
    if relative_path == export_root || relative_path.starts_with(export_root) {
        Ok(relative_path)
    } else {
        Err(format!(
            "图层设计工程目录必须位于 {LAYERED_DESIGN_EXPORT_ROOT}"
        ))
    }
}

fn metadata_updated_at_ms(path: &Path) -> Option<u64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    let duration = modified.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(duration.as_millis().min(u128::from(u64::MAX)) as u64)
}

fn count_files_recursive(root: &Path) -> Result<usize, String> {
    let mut count = 0_usize;
    if !root.exists() {
        return Ok(count);
    }

    for entry in std::fs::read_dir(root).map_err(|error| format!("读取目录失败: {error}"))? {
        let entry = entry.map_err(|error| format!("读取目录项失败: {error}"))?;
        let path = entry.path();
        if path.is_dir() {
            count += count_files_recursive(&path)?;
        } else if path.is_file() {
            count += 1;
        }
    }

    Ok(count)
}

fn prepare_export_files(
    files: &[LayeredDesignProjectExportFile],
) -> Result<Vec<PreparedExportFile>, String> {
    files
        .iter()
        .map(|file| {
            let _ = normalize_required_string(&file.mime_type, "mimeType")?;
            Ok(PreparedExportFile {
                relative_path: normalize_relative_path(&file.relative_path)?,
                content: decode_export_file_content(file)?,
            })
        })
        .collect()
}

fn find_prepared_file_index(files: &[PreparedExportFile], relative_path: &str) -> Option<usize> {
    files.iter().position(|file| {
        relative_path_to_string(&file.relative_path).eq_ignore_ascii_case(relative_path)
    })
}

fn decode_utf8_file_content(file: &PreparedExportFile, label: &str) -> Option<String> {
    String::from_utf8(file.content.clone())
        .map_err(|error| format!("读取 {label} UTF-8 内容失败: {error}"))
        .ok()
}

fn parse_json_value(content: &str, label: &str) -> Option<Value> {
    serde_json::from_str::<Value>(content)
        .map_err(|error| format!("解析 {label} 失败: {error}"))
        .ok()
}

fn serialize_json_value(value: &Value, label: &str) -> Result<Vec<u8>, String> {
    serde_json::to_vec_pretty(value).map_err(|error| format!("写回 {label} 失败: {error}"))
}

fn sanitize_asset_file_stem(value: &str, fallback: &str) -> String {
    let mut output = String::new();
    let mut previous_dash = false;

    for character in value.trim().chars() {
        let next = if character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-') {
            previous_dash = false;
            Some(character.to_ascii_lowercase())
        } else if previous_dash {
            None
        } else {
            previous_dash = true;
            Some('-')
        };

        if let Some(next) = next {
            output.push(next);
        }

        if output.len() >= 96 {
            break;
        }
    }

    let trimmed = output.trim_matches(|character| character == '-' || character == '.');
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn is_supported_remote_asset_url(value: &str) -> bool {
    matches!(
        Url::parse(value)
            .ok()
            .map(|url| url.scheme().to_ascii_lowercase()),
        Some(scheme) if scheme == "http" || scheme == "https"
    )
}

fn resolve_remote_asset_mime_type(content_type: Option<&str>, source_url: &str) -> Option<String> {
    let normalized_content_type = content_type
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .filter(|value| value.starts_with("image/"))
        .map(ToString::to_string);
    if normalized_content_type.is_some() {
        return normalized_content_type;
    }

    let lower = source_url.to_ascii_lowercase();
    if lower.contains(".png") {
        Some("image/png".to_string())
    } else if lower.contains(".jpg") || lower.contains(".jpeg") {
        Some("image/jpeg".to_string())
    } else if lower.contains(".webp") {
        Some("image/webp".to_string())
    } else if lower.contains(".gif") {
        Some("image/gif".to_string())
    } else if lower.contains(".svg") {
        Some("image/svg+xml".to_string())
    } else {
        None
    }
}

fn resolve_asset_extension_from_mime_type(mime_type: &str) -> &str {
    match mime_type {
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "image/svg+xml" => "svg",
        _ => "png",
    }
}

fn build_asset_data_url(mime_type: &str, content: &[u8]) -> String {
    format!("data:{mime_type};base64,{}", STANDARD.encode(content))
}

fn collect_remote_manifest_assets(manifest: &Value) -> Vec<(String, String)> {
    manifest
        .get("assets")
        .and_then(Value::as_array)
        .into_iter()
        .flat_map(|assets| assets.iter())
        .filter_map(|asset| {
            let asset_id = asset.get("id").and_then(Value::as_str)?.trim();
            let source = asset.get("source").and_then(Value::as_str)?.trim();
            let original_src = asset.get("originalSrc").and_then(Value::as_str)?.trim();

            if asset_id.is_empty()
                || source != "reference"
                || original_src.is_empty()
                || !is_supported_remote_asset_url(original_src)
            {
                return None;
            }

            Some((asset_id.to_string(), original_src.to_string()))
        })
        .collect()
}

fn apply_cached_remote_asset_to_manifest(manifest: &mut Value, cached: &CachedRemoteAsset) {
    let Some(assets) = manifest.get_mut("assets").and_then(Value::as_array_mut) else {
        return;
    };

    for asset in assets {
        let Some(asset_id) = asset.get("id").and_then(Value::as_str) else {
            continue;
        };
        if asset_id != cached.asset_id {
            continue;
        }

        if let Some(object) = asset.as_object_mut() {
            object.insert("source".to_string(), Value::String("file".to_string()));
            object.insert(
                "filename".to_string(),
                Value::String(cached.filename.clone()),
            );
            object.insert(
                "originalSrc".to_string(),
                Value::String(cached.original_src.clone()),
            );
        }
    }
}

fn apply_cached_remote_asset_to_psd_like_manifest(
    psd_like_manifest: &mut Value,
    cached: &CachedRemoteAsset,
) {
    let Some(layers) = psd_like_manifest
        .get_mut("layers")
        .and_then(Value::as_array_mut)
    else {
        return;
    };

    for layer in layers {
        let Some(asset) = layer.get_mut("asset").and_then(Value::as_object_mut) else {
            continue;
        };
        let Some(asset_id) = asset.get("id").and_then(Value::as_str) else {
            continue;
        };
        if asset_id != cached.asset_id {
            continue;
        }

        asset.insert("source".to_string(), Value::String("file".to_string()));
        asset.insert(
            "filename".to_string(),
            Value::String(cached.filename.clone()),
        );
        asset.insert(
            "originalSrc".to_string(),
            Value::String(cached.original_src.clone()),
        );
    }
}

async fn download_cached_remote_asset(
    client: &reqwest::Client,
    asset_id: &str,
    source_url: &str,
) -> Option<CachedRemoteAsset> {
    let response = client.get(source_url).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }

    if response
        .content_length()
        .map(|value| value > MAX_REMOTE_LAYERED_DESIGN_ASSET_BYTES as u64)
        .unwrap_or(false)
    {
        return None;
    }

    let mime_type = resolve_remote_asset_mime_type(
        response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
        source_url,
    )?;
    let extension = resolve_asset_extension_from_mime_type(&mime_type);
    let mut content = Vec::new();
    let mut response = response;

    while let Some(chunk) = response.chunk().await.ok()? {
        if content.len() + chunk.len() > MAX_REMOTE_LAYERED_DESIGN_ASSET_BYTES {
            return None;
        }
        content.extend_from_slice(&chunk);
    }

    Some(CachedRemoteAsset {
        asset_id: asset_id.to_string(),
        original_src: source_url.to_string(),
        filename: format!(
            "assets/{}.{}",
            sanitize_asset_file_stem(asset_id, "asset"),
            extension
        ),
        content,
    })
}

async fn cache_remote_manifest_assets(
    manifest: &mut Value,
    mut psd_like_manifest: Option<&mut Value>,
) -> Vec<CachedRemoteAsset> {
    let remote_assets = collect_remote_manifest_assets(manifest);
    if remote_assets.is_empty() {
        return Vec::new();
    }

    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(
            REMOTE_LAYERED_DESIGN_ASSET_TIMEOUT_SECS,
        ))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let mut cached_assets = Vec::new();

    for (asset_id, source_url) in remote_assets {
        let Some(cached) = download_cached_remote_asset(&client, &asset_id, &source_url).await
        else {
            continue;
        };

        apply_cached_remote_asset_to_manifest(manifest, &cached);
        if let Some(psd_like_manifest) = psd_like_manifest.as_deref_mut() {
            apply_cached_remote_asset_to_psd_like_manifest(psd_like_manifest, &cached);
        }
        cached_assets.push(cached);
    }

    cached_assets
}

fn hydrate_design_json_with_cached_assets(
    export_dir: &Path,
    design_json: &str,
    manifest_json: Option<&str>,
) -> String {
    let Some(manifest_json) = manifest_json else {
        return design_json.to_string();
    };
    let Some(mut design_value) = parse_json_value(design_json, "design.json") else {
        return design_json.to_string();
    };
    let Some(manifest_value) = parse_json_value(manifest_json, "export-manifest.json") else {
        return design_json.to_string();
    };

    let manifest_assets = manifest_value
        .get("assets")
        .and_then(Value::as_array)
        .into_iter()
        .flat_map(|assets| assets.iter())
        .filter_map(|asset| {
            let asset_id = asset.get("id").and_then(Value::as_str)?.trim();
            let source = asset.get("source").and_then(Value::as_str)?.trim();
            let filename = asset.get("filename").and_then(Value::as_str)?.trim();
            if asset_id.is_empty() || source != "file" || filename.is_empty() {
                return None;
            }

            Some((asset_id.to_string(), filename.to_string()))
        })
        .collect::<HashMap<_, _>>();
    if manifest_assets.is_empty() {
        return design_json.to_string();
    }

    let Some(design_assets) = design_value.get_mut("assets").and_then(Value::as_array_mut) else {
        return design_json.to_string();
    };

    let mut hydrated = false;
    for asset in design_assets {
        let Some(asset_object) = asset.as_object_mut() else {
            continue;
        };
        let Some(asset_id) = asset_object
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let Some(filename) = manifest_assets.get(asset_id) else {
            continue;
        };
        let src = asset_object
            .get("src")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("");
        if src.starts_with("data:") {
            continue;
        }

        let asset_path =
            export_dir.join(normalize_relative_path(filename).ok().unwrap_or_default());
        let Ok(content) = std::fs::read(&asset_path) else {
            continue;
        };
        let mime_type = resolve_remote_asset_mime_type(None, filename)
            .unwrap_or_else(|| "image/png".to_string());
        asset_object.insert(
            "src".to_string(),
            Value::String(build_asset_data_url(&mime_type, &content)),
        );
        hydrated = true;
    }

    if hydrated {
        serde_json::to_string_pretty(&design_value).unwrap_or_else(|_| design_json.to_string())
    } else {
        design_json.to_string()
    }
}

fn find_latest_layered_design_export_dir(project_root: &Path) -> Result<PathBuf, String> {
    let export_root = project_root.join(LAYERED_DESIGN_EXPORT_ROOT);
    if !export_root.exists() {
        return Err("当前项目还没有保存过图层设计工程".to_string());
    }

    let mut candidates: Vec<(PathBuf, u64)> = Vec::new();
    for entry in
        std::fs::read_dir(&export_root).map_err(|error| format!("读取图层设计目录失败: {error}"))?
    {
        let entry = entry.map_err(|error| format!("读取图层设计目录项失败: {error}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let design_path = path.join("design.json");
        if !design_path.is_file() {
            continue;
        }

        candidates.push((path, metadata_updated_at_ms(&design_path).unwrap_or(0)));
    }

    candidates
        .into_iter()
        .max_by_key(|(_, updated_at)| *updated_at)
        .map(|(path, _)| path)
        .ok_or_else(|| "当前项目没有可打开的图层设计工程".to_string())
}

fn resolve_layered_design_export_dir(
    project_root: &Path,
    export_directory_relative_path: Option<&str>,
) -> Result<(PathBuf, PathBuf), String> {
    if let Some(relative_path) =
        export_directory_relative_path.filter(|value| !value.trim().is_empty())
    {
        let relative_dir =
            ensure_layered_design_export_relative_dir(normalize_relative_path(relative_path)?)?;
        return Ok((project_root.join(&relative_dir), relative_dir));
    }

    let export_dir = find_latest_layered_design_export_dir(project_root)?;
    let relative_dir = export_dir
        .strip_prefix(project_root)
        .map_err(|_| "图层设计工程目录不在项目根目录内".to_string())?
        .to_path_buf();
    Ok((export_dir, relative_dir))
}

pub(crate) async fn save_layered_design_project_export_inner(
    request: SaveLayeredDesignProjectExportRequest,
) -> Result<SaveLayeredDesignProjectExportOutput, String> {
    let project_root_path =
        normalize_required_string(&request.project_root_path, "projectRootPath")?;
    let document_id = normalize_required_string(&request.document_id, "documentId")?;
    if request.files.is_empty() {
        return Err("图层设计工程导出文件不能为空".to_string());
    }
    if request.files.len() > MAX_LAYERED_DESIGN_EXPORT_FILES {
        return Err(format!(
            "图层设计工程导出文件数量超出限制: {}",
            MAX_LAYERED_DESIGN_EXPORT_FILES
        ));
    }

    let project_root = require_absolute_project_root(&project_root_path)?;

    let directory_name = resolve_export_directory_name(&request);
    let export_relative_dir = Path::new(LAYERED_DESIGN_EXPORT_ROOT).join(directory_name);
    let export_dir = project_root.join(&export_relative_dir);
    std::fs::create_dir_all(&export_dir)
        .map_err(|error| format!("创建图层设计工程目录失败: {error}"))?;
    let assets_dir = export_dir.join("assets");
    let mut prepared_files = prepare_export_files(&request.files)?;
    find_prepared_file_index(&prepared_files, "design.json")
        .ok_or_else(|| format!("图层设计工程 {document_id} 缺少 design.json 导出文件"))?;
    let manifest_index = find_prepared_file_index(&prepared_files, "export-manifest.json")
        .ok_or_else(|| format!("图层设计工程 {document_id} 缺少 export-manifest.json 导出文件"))?;
    let psd_like_index = find_prepared_file_index(&prepared_files, "psd-like-manifest.json");

    let mut cached_remote_assets = Vec::new();
    let manifest_content =
        decode_utf8_file_content(&prepared_files[manifest_index], "export-manifest.json");
    let psd_like_content = psd_like_index.and_then(|index| {
        decode_utf8_file_content(&prepared_files[index], "psd-like-manifest.json")
    });

    if let Some(manifest_content) = manifest_content {
        if let Some(mut manifest_value) =
            parse_json_value(&manifest_content, "export-manifest.json")
        {
            let mut psd_like_value = psd_like_content
                .as_deref()
                .and_then(|content| parse_json_value(content, "psd-like-manifest.json"));
            cached_remote_assets =
                cache_remote_manifest_assets(&mut manifest_value, psd_like_value.as_mut()).await;

            if !cached_remote_assets.is_empty() {
                prepared_files[manifest_index].content =
                    serialize_json_value(&manifest_value, "export-manifest.json")?;
                if let (Some(index), Some(psd_like_value)) =
                    (psd_like_index, psd_like_value.as_ref())
                {
                    prepared_files[index].content =
                        serialize_json_value(psd_like_value, "psd-like-manifest.json")?;
                }
            }
        }
    }

    let mut bytes_written = 0_u64;
    let mut design_path: Option<PathBuf> = None;
    let mut manifest_path: Option<PathBuf> = None;
    let mut preview_png_path: Option<PathBuf> = None;

    for file in &prepared_files {
        let target_path = export_dir.join(&file.relative_path);

        if let Some(parent) = target_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("创建图层设计导出子目录失败: {error}"))?;
        }

        std::fs::write(&target_path, &file.content)
            .map_err(|error| format!("写入图层设计导出文件失败: {error}"))?;
        bytes_written += file.content.len() as u64;

        let normalized_path = relative_path_to_string(&file.relative_path);
        if normalized_path == "design.json" {
            design_path = Some(target_path.clone());
        } else if normalized_path == "export-manifest.json" {
            manifest_path = Some(target_path.clone());
        } else if normalized_path == "preview.png" {
            preview_png_path = Some(target_path.clone());
        }
    }

    for cached_asset in &cached_remote_assets {
        let relative_path = normalize_relative_path(&cached_asset.filename)?;
        let target_path = export_dir.join(&relative_path);
        if let Some(parent) = target_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("创建图层设计缓存资产目录失败: {error}"))?;
        }
        std::fs::write(&target_path, &cached_asset.content)
            .map_err(|error| format!("写入图层设计缓存资产失败: {error}"))?;
        bytes_written += cached_asset.content.len() as u64;
    }

    let design_path = design_path.unwrap_or_else(|| export_dir.join("design.json"));
    let manifest_path = manifest_path.unwrap_or_else(|| export_dir.join("export-manifest.json"));
    let file_count = count_files_recursive(&export_dir)?;
    let asset_count = count_files_recursive(&assets_dir)?;

    Ok(SaveLayeredDesignProjectExportOutput {
        project_root_path,
        export_directory_path: path_to_string(&export_dir),
        export_directory_relative_path: export_relative_dir.to_string_lossy().replace('\\', "/"),
        design_path: path_to_string(&design_path),
        manifest_path: path_to_string(&manifest_path),
        preview_png_path: preview_png_path.as_deref().map(path_to_string),
        asset_count,
        file_count,
        bytes_written,
    })
}

pub(crate) fn read_layered_design_project_export_inner(
    request: ReadLayeredDesignProjectExportRequest,
) -> Result<ReadLayeredDesignProjectExportOutput, String> {
    let project_root_path =
        normalize_required_string(&request.project_root_path, "projectRootPath")?;
    let project_root = require_absolute_project_root(&project_root_path)?;
    let (export_dir, export_relative_dir) = resolve_layered_design_export_dir(
        &project_root,
        request.export_directory_relative_path.as_deref(),
    )?;
    let design_path = export_dir.join("design.json");
    if !design_path.is_file() {
        return Err("图层设计工程缺少 design.json".to_string());
    }

    let design_json = std::fs::read_to_string(&design_path)
        .map_err(|error| format!("读取 design.json 失败: {error}"))?;
    let manifest_path = export_dir.join("export-manifest.json");
    let manifest_json = if manifest_path.is_file() {
        Some(
            std::fs::read_to_string(&manifest_path)
                .map_err(|error| format!("读取 export-manifest.json 失败: {error}"))?,
        )
    } else {
        None
    };
    let psd_like_manifest_path = export_dir.join("psd-like-manifest.json");
    let psd_like_manifest_json = if psd_like_manifest_path.is_file() {
        Some(
            std::fs::read_to_string(&psd_like_manifest_path)
                .map_err(|error| format!("读取 psd-like-manifest.json 失败: {error}"))?,
        )
    } else {
        None
    };
    let preview_png_path = export_dir.join("preview.png");
    let assets_dir = export_dir.join("assets");
    let hydrated_design_json =
        hydrate_design_json_with_cached_assets(&export_dir, &design_json, manifest_json.as_deref());

    Ok(ReadLayeredDesignProjectExportOutput {
        project_root_path,
        export_directory_path: path_to_string(&export_dir),
        export_directory_relative_path: export_relative_dir.to_string_lossy().replace('\\', "/"),
        design_path: path_to_string(&design_path),
        design_json: hydrated_design_json,
        manifest_path: manifest_json
            .as_ref()
            .map(|_| path_to_string(&manifest_path)),
        manifest_json,
        psd_like_manifest_path: psd_like_manifest_json
            .as_ref()
            .map(|_| path_to_string(&psd_like_manifest_path)),
        psd_like_manifest_json,
        preview_png_path: preview_png_path
            .is_file()
            .then(|| path_to_string(&preview_png_path)),
        asset_count: count_files_recursive(&assets_dir)?,
        file_count: count_files_recursive(&export_dir)?,
        updated_at_ms: metadata_updated_at_ms(&design_path),
    })
}

pub(crate) fn recognize_layered_design_text_inner(
    request: RecognizeLayeredDesignTextRequest,
) -> Result<RecognizeLayeredDesignTextOutput, String> {
    if request.width == 0 || request.height == 0 {
        return Err("OCR 图片宽高必须大于 0".to_string());
    }
    let _candidate_id = request.candidate_id.as_deref();

    let Some(bytes) = decode_layered_design_ocr_image_data_url(&request.image_src)? else {
        return Ok(unsupported_layered_design_text_ocr_output(
            "当前 native OCR 只接收 data:image/*;base64 图片来源",
        ));
    };

    recognize_layered_design_text_from_image_bytes(&bytes, request.width, request.height)
}

#[cfg(target_os = "macos")]
#[link(name = "Vision", kind = "framework")]
unsafe extern "C" {}

#[cfg(target_os = "macos")]
#[allow(deprecated)]
fn recognize_layered_design_text_from_image_bytes(
    bytes: &[u8],
    width: u32,
    height: u32,
) -> Result<RecognizeLayeredDesignTextOutput, String> {
    use cocoa::base::{id, nil, BOOL, YES};
    use cocoa::foundation::{NSAutoreleasePool, NSRect, NSUInteger};
    use objc::runtime::Class;
    use objc::{class, msg_send, sel, sel_impl};
    use std::ffi::{c_void, CStr};
    use std::os::raw::c_char;

    unsafe fn nsstring_to_string(value: id) -> Option<String> {
        if value == nil {
            return None;
        }
        let c_string: *const c_char = msg_send![value, UTF8String];
        if c_string.is_null() {
            return None;
        }
        Some(CStr::from_ptr(c_string).to_string_lossy().into_owned())
    }

    unsafe fn nserror_to_string(error: id) -> Option<String> {
        if error == nil {
            return None;
        }
        let description: id = msg_send![error, localizedDescription];
        nsstring_to_string(description)
    }

    fn convert_vision_bounding_box(
        bounding_box: NSRect,
        image_width: u32,
        image_height: u32,
    ) -> LayeredDesignTextBoundingBox {
        let width = f64::from(image_width);
        let height = f64::from(image_height);
        let box_width = (bounding_box.size.width as f64 * width).max(1.0);
        let box_height = (bounding_box.size.height as f64 * height).max(1.0);
        let x = (bounding_box.origin.x as f64 * width).clamp(0.0, width);
        let y = ((1.0 - bounding_box.origin.y as f64 - bounding_box.size.height as f64) * height)
            .clamp(0.0, height);

        LayeredDesignTextBoundingBox {
            x,
            y,
            width: box_width.min((width - x).max(1.0)),
            height: box_height.min((height - y).max(1.0)),
        }
    }

    unsafe {
        let pool = NSAutoreleasePool::new(nil);
        let data: id = msg_send![
            class!(NSData),
            dataWithBytes: bytes.as_ptr() as *const c_void
            length: bytes.len() as NSUInteger
        ];
        if data == nil {
            pool.drain();
            return Err("创建 OCR 图片数据失败".to_string());
        }

        let Some(request_class) = Class::get("VNRecognizeTextRequest") else {
            pool.drain();
            return Ok(unsupported_layered_design_text_ocr_output(
                "当前 macOS 版本不支持 Vision OCR",
            ));
        };
        let Some(handler_class) = Class::get("VNImageRequestHandler") else {
            pool.drain();
            return Ok(unsupported_layered_design_text_ocr_output(
                "当前 macOS 版本不支持 Vision OCR 图片处理器",
            ));
        };

        let request: id = msg_send![request_class, alloc];
        let request: id = msg_send![request, init];
        if request == nil {
            pool.drain();
            return Err("创建 Vision OCR 请求失败".to_string());
        }

        let accurate_level = 1usize;
        let _: () = msg_send![request, setRecognitionLevel: accurate_level];
        let _: () = msg_send![request, setUsesLanguageCorrection: YES];

        let options: id = msg_send![class!(NSDictionary), dictionary];
        let handler: id = msg_send![handler_class, alloc];
        let handler: id = msg_send![handler, initWithData: data options: options];
        if handler == nil {
            pool.drain();
            return Err("创建 Vision OCR 图片处理器失败".to_string());
        }

        let requests: id = msg_send![class!(NSArray), arrayWithObject: request];
        let mut error: id = nil;
        let ok: BOOL = msg_send![handler, performRequests: requests error: &mut error];
        if ok != YES {
            let message =
                nserror_to_string(error).unwrap_or_else(|| "Vision OCR 执行失败".to_string());
            pool.drain();
            return Err(message);
        }

        let observations: id = msg_send![request, results];
        let count: NSUInteger = if observations == nil {
            0
        } else {
            msg_send![observations, count]
        };
        let mut blocks = Vec::new();
        for index in 0..count {
            let observation: id = msg_send![observations, objectAtIndex: index];
            if observation == nil {
                continue;
            }
            let candidates: id = msg_send![observation, topCandidates: 1usize];
            if candidates == nil {
                continue;
            }
            let text_candidate: id = msg_send![candidates, firstObject];
            if text_candidate == nil {
                continue;
            }
            let text_value: id = msg_send![text_candidate, string];
            let Some(text) = nsstring_to_string(text_value).map(|value| value.trim().to_string())
            else {
                continue;
            };
            if text.is_empty() {
                continue;
            }

            let bounding_box: NSRect = msg_send![observation, boundingBox];
            let confidence: f32 = msg_send![text_candidate, confidence];
            blocks.push(LayeredDesignRecognizedTextBlock {
                text,
                bounding_box: Some(convert_vision_bounding_box(bounding_box, width, height)),
                confidence: confidence.is_finite().then_some(confidence),
            });
        }

        pool.drain();
        Ok(RecognizeLayeredDesignTextOutput {
            supported: true,
            engine: "macos_vision".to_string(),
            blocks,
            message: None,
        })
    }
}

#[cfg(not(target_os = "macos"))]
fn recognize_layered_design_text_from_image_bytes(
    _bytes: &[u8],
    _width: u32,
    _height: u32,
) -> Result<RecognizeLayeredDesignTextOutput, String> {
    Ok(unsupported_layered_design_text_ocr_output(
        "当前平台尚未接入 native OCR 引擎",
    ))
}

pub(crate) fn analyze_layered_design_flat_image_inner(
    request: AnalyzeLayeredDesignFlatImageRequest,
) -> Result<AnalyzeLayeredDesignFlatImageOutput, String> {
    if request.image.width == 0 || request.image.height == 0 {
        return Err("Analyzer 图片宽高必须大于 0".to_string());
    }
    if request
        .image
        .mime_type
        .as_deref()
        .map(|mime| !mime.eq_ignore_ascii_case("image/png"))
        .unwrap_or(false)
    {
        return Ok(native_analyzer_unsupported_output(
            "当前 native analyzer 首刀只支持 image/png",
        ));
    }

    let Some(bytes) = decode_layered_design_analyzer_png_data_url(&request.image.src)? else {
        return Ok(native_analyzer_unsupported_output(
            "当前 native analyzer 只接收 data:image/png;base64 图片来源",
        ));
    };
    let source = image::load_from_memory_with_format(&bytes, ImageFormat::Png)
        .map_err(|error| format!("解析 analyzer PNG 失败: {error}"))?
        .to_rgba8();
    let image_width = source.width().max(1);
    let image_height = source.height().max(1);
    let generated_at = request
        .created_at
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
    let specs = build_native_analyzer_candidate_specs(image_width, image_height);
    let subject_id = specs
        .iter()
        .find(|spec| spec.role == "subject")
        .map(|spec| spec.id);
    let mut subject_rect = None;
    let mut candidates = Vec::new();

    for spec in specs {
        let is_subject = Some(spec.id) == subject_id;
        if is_subject {
            subject_rect = Some(spec.rect);
        }
        let total_pixel_count = native_analyzer_rect_pixel_count(spec.rect);
        let ellipse_pixel_count = if is_subject {
            count_native_analyzer_ellipse_pixels(spec.rect)
        } else {
            0
        };

        let crop = crop_native_analyzer_image(&source, spec.rect);
        let image_rgba = if is_subject {
            apply_native_analyzer_mask(&crop, spec.rect)
        } else {
            crop
        };
        let image_src = encode_rgba_png_data_url(&image_rgba)?;
        let mask = if is_subject {
            let mask = create_native_analyzer_mask(spec.rect);
            Some(LayeredDesignStructuredAsset {
                id: format!("{}-mask", spec.id),
                kind: "mask".to_string(),
                src: encode_rgba_png_data_url(&mask)?,
                width: spec.rect.width,
                height: spec.rect.height,
                has_alpha: Some(false),
                created_at: generated_at.clone(),
                params: serde_json::json!({
                    "seed": "native_heuristic_subject_mask",
                }),
            })
        } else {
            None
        };
        let mut image_params = serde_json::json!({
            "seed": if is_subject {
                "native_heuristic_subject_masked"
            } else {
                "native_heuristic_crop"
            },
            "inputMimeType": request.image.mime_type.as_deref().unwrap_or("image/png"),
            "outputMimeType": "image/png",
            "sourceRect": native_analyzer_rect_value(spec.rect),
            "totalPixelCount": total_pixel_count,
        });
        if is_subject {
            if let Some(params) = image_params.as_object_mut() {
                params.insert(
                    "foregroundPixelCount".to_string(),
                    Value::from(ellipse_pixel_count),
                );
                params.insert(
                    "detectedForegroundPixelCount".to_string(),
                    Value::from(0_u64),
                );
                params.insert("ellipseFallbackApplied".to_string(), Value::from(true));
            }
        }

        candidates.push(LayeredDesignStructuredCandidate {
            id: format!("{}-candidate", spec.id),
            candidate_type: "image".to_string(),
            role: spec.role.to_string(),
            name: spec.name.to_string(),
            confidence: spec.confidence,
            rect: LayeredDesignTextBoundingBox {
                x: f64::from(spec.rect.x),
                y: f64::from(spec.rect.y),
                width: f64::from(spec.rect.width),
                height: f64::from(spec.rect.height),
            },
            z_index: spec.z_index,
            image: LayeredDesignStructuredAsset {
                id: format!("{}-asset", spec.id),
                kind: spec.kind.to_string(),
                src: image_src,
                width: spec.rect.width,
                height: spec.rect.height,
                has_alpha: Some(is_subject || request.image.has_alpha.unwrap_or(false)),
                created_at: generated_at.clone(),
                params: image_params,
            },
            mask,
        });
    }

    let clean_plate = if let Some(rect) = subject_rect {
        let clean_plate = create_native_analyzer_clean_plate(&source, rect);
        let total_subject_pixel_count = count_native_analyzer_ellipse_pixels(rect);
        LayeredDesignStructuredCleanPlate {
            status: None,
            asset: Some(LayeredDesignStructuredAsset {
                id: "native-heuristic-clean-plate-asset".to_string(),
                kind: "clean_plate".to_string(),
                src: encode_rgba_png_data_url(&clean_plate.image)?,
                width: image_width,
                height: image_height,
                has_alpha: Some(false),
                created_at: generated_at.clone(),
                params: serde_json::json!({
                    "seed": "native_heuristic_clean_plate",
                    "sourceRect": native_analyzer_rect_value(rect),
                    "filledPixelCount": clean_plate.filled_pixel_count,
                    "totalSubjectPixelCount": total_subject_pixel_count,
                    "haloExpandedPixelCount": 0_u64,
                    "maskApplied": true,
                }),
            }),
            message: Some(
                "当前 clean plate 来自 Tauri native heuristic 近似修补；进入编辑后仍需人工核对主体移动边缘。"
                    .to_string(),
            ),
        }
    } else {
        LayeredDesignStructuredCleanPlate {
            status: Some("not_requested".to_string()),
            asset: None,
            message: Some("Tauri native heuristic 未找到主体候选。".to_string()),
        }
    };

    Ok(AnalyzeLayeredDesignFlatImageOutput {
        supported: true,
        engine: "native_heuristic_analyzer".to_string(),
        result: Some(LayeredDesignStructuredAnalyzerResult {
            analyzer: LayeredDesignStructuredAnalyzerInfo {
                kind: "local_heuristic".to_string(),
                label: "Tauri native heuristic analyzer".to_string(),
            },
            generated_at,
            candidates,
            clean_plate,
        }),
        message: None,
    })
}

#[tauri::command]
pub async fn save_layered_design_project_export(
    request: SaveLayeredDesignProjectExportRequest,
) -> Result<SaveLayeredDesignProjectExportOutput, String> {
    save_layered_design_project_export_inner(request).await
}

#[tauri::command]
pub fn read_layered_design_project_export(
    request: ReadLayeredDesignProjectExportRequest,
) -> Result<ReadLayeredDesignProjectExportOutput, String> {
    read_layered_design_project_export_inner(request)
}

#[tauri::command]
pub fn recognize_layered_design_text(
    request: RecognizeLayeredDesignTextRequest,
) -> Result<RecognizeLayeredDesignTextOutput, String> {
    recognize_layered_design_text_inner(request)
}

#[tauri::command]
pub fn analyze_layered_design_flat_image(
    request: AnalyzeLayeredDesignFlatImageRequest,
) -> Result<AnalyzeLayeredDesignFlatImageOutput, String> {
    analyze_layered_design_flat_image_inner(request)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{header::CONTENT_TYPE, HeaderValue, Response, StatusCode},
        routing::get,
        Router,
    };

    const TEST_REMOTE_PNG_BASE64: &str =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yF9sAAAAASUVORK5CYII=";

    fn export_file(
        relative_path: &str,
        mime_type: &str,
        encoding: &str,
        content: &str,
    ) -> LayeredDesignProjectExportFile {
        LayeredDesignProjectExportFile {
            relative_path: relative_path.to_string(),
            mime_type: mime_type.to_string(),
            encoding: encoding.to_string(),
            content: content.to_string(),
        }
    }

    fn test_png_data_url(width: u32, height: u32) -> String {
        let mut image = RgbaImage::new(width, height);
        for y in 0..height {
            for x in 0..width {
                image.put_pixel(
                    x,
                    y,
                    Rgba([((x * 23) % 255) as u8, ((y * 29) % 255) as u8, 180, 255]),
                );
            }
        }
        encode_rgba_png_data_url(&image).expect("test PNG should encode")
    }

    #[test]
    fn recognize_layered_design_text_should_skip_unsupported_source() {
        let output = recognize_layered_design_text_inner(RecognizeLayeredDesignTextRequest {
            image_src: "https://example.com/headline.png".to_string(),
            width: 320,
            height: 120,
            candidate_id: Some("headline-candidate".to_string()),
        })
        .expect("recognize text");

        assert!(!output.supported);
        assert_eq!(output.engine, "native_ocr_unavailable");
        assert!(output.blocks.is_empty());
        assert!(output
            .message
            .as_deref()
            .unwrap_or_default()
            .contains("data:image"));
    }

    #[test]
    fn recognize_layered_design_text_should_reject_empty_dimensions() {
        let error = recognize_layered_design_text_inner(RecognizeLayeredDesignTextRequest {
            image_src: "data:image/png;base64,ZmFrZQ==".to_string(),
            width: 0,
            height: 120,
            candidate_id: None,
        })
        .expect_err("empty dimensions should fail");

        assert!(error.contains("宽高"));
    }

    #[test]
    fn analyze_layered_design_flat_image_should_return_structured_native_result() {
        let output =
            analyze_layered_design_flat_image_inner(AnalyzeLayeredDesignFlatImageRequest {
                image: AnalyzeLayeredDesignFlatImageInput {
                    src: test_png_data_url(64, 96),
                    width: 64,
                    height: 96,
                    mime_type: Some("image/png".to_string()),
                    has_alpha: Some(false),
                },
                created_at: Some("2026-05-07T00:00:00.000Z".to_string()),
            })
            .expect("analyze flat image");

        assert!(output.supported);
        assert_eq!(output.engine, "native_heuristic_analyzer");
        let result = output.result.expect("structured result");
        assert_eq!(result.analyzer.label, "Tauri native heuristic analyzer");
        assert_eq!(result.generated_at, "2026-05-07T00:00:00.000Z");
        assert_eq!(result.candidates.len(), 4);
        let subject = result
            .candidates
            .iter()
            .find(|candidate| candidate.id == "subject-candidate")
            .expect("subject candidate");
        assert_eq!(subject.role, "subject");
        assert!(subject.image.src.starts_with("data:image/png;base64,"));
        assert!(subject.mask.is_some());
        assert_eq!(
            subject
                .image
                .params
                .get("ellipseFallbackApplied")
                .and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            subject
                .image
                .params
                .get("detectedForegroundPixelCount")
                .and_then(Value::as_u64),
            Some(0)
        );
        let foreground_pixel_count = subject
            .image
            .params
            .get("foregroundPixelCount")
            .and_then(Value::as_u64)
            .expect("foreground pixel count");
        let total_pixel_count = subject
            .image
            .params
            .get("totalPixelCount")
            .and_then(Value::as_u64)
            .expect("total pixel count");
        assert!(foreground_pixel_count > 0);
        assert!(foreground_pixel_count < total_pixel_count);
        let clean_plate_asset = result.clean_plate.asset.as_ref().expect("clean plate");
        assert_eq!(
            clean_plate_asset
                .params
                .get("maskApplied")
                .and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            clean_plate_asset
                .params
                .get("filledPixelCount")
                .and_then(Value::as_u64),
            Some(foreground_pixel_count)
        );
        assert_eq!(
            clean_plate_asset
                .params
                .get("totalSubjectPixelCount")
                .and_then(Value::as_u64),
            Some(foreground_pixel_count)
        );
        assert!(result
            .clean_plate
            .asset
            .as_ref()
            .expect("clean plate")
            .src
            .starts_with("data:image/png;base64,"));
    }

    #[test]
    fn analyze_layered_design_flat_image_should_skip_unsupported_source() {
        let output =
            analyze_layered_design_flat_image_inner(AnalyzeLayeredDesignFlatImageRequest {
                image: AnalyzeLayeredDesignFlatImageInput {
                    src: "https://example.com/flat.png".to_string(),
                    width: 64,
                    height: 96,
                    mime_type: Some("image/png".to_string()),
                    has_alpha: None,
                },
                created_at: None,
            })
            .expect("unsupported source should not fail command");

        assert!(!output.supported);
        assert!(output.result.is_none());
        assert!(output
            .message
            .as_deref()
            .unwrap_or_default()
            .contains("data:image/png"));
    }

    fn minimal_request(project_root_path: String) -> SaveLayeredDesignProjectExportRequest {
        SaveLayeredDesignProjectExportRequest {
            project_root_path,
            document_id: "design-test".to_string(),
            title: "图层化海报".to_string(),
            directory_name: Some("Design Test.layered-design".to_string()),
            files: vec![
                export_file("design.json", "application/json", "utf8", "{\"layers\":[]}"),
                export_file(
                    "export-manifest.json",
                    "application/json",
                    "utf8",
                    "{\"assets\":[]}",
                ),
                export_file("preview.svg", "image/svg+xml", "utf8", "<svg />"),
                export_file("preview.png", "image/png", "base64", "cHJldmlldy1wbmc="),
                export_file(
                    "assets/asset-subject.png",
                    "image/png",
                    "base64",
                    "YXNzZXQtcG5n",
                ),
            ],
        }
    }

    fn remote_asset_request(
        project_root_path: String,
        remote_asset_url: &str,
    ) -> SaveLayeredDesignProjectExportRequest {
        SaveLayeredDesignProjectExportRequest {
            project_root_path,
            document_id: "remote-design".to_string(),
            title: "远程图层设计".to_string(),
            directory_name: Some("remote-design.layered-design".to_string()),
            files: vec![
                export_file(
                    "design.json",
                    "application/json",
                    "utf8",
                    &format!(
                        "{{\"schemaVersion\":\"2026-05-05.p1\",\"id\":\"remote-design\",\"title\":\"远程图层设计\",\"status\":\"exported\",\"canvas\":{{\"width\":1080,\"height\":1440}},\"layers\":[{{\"id\":\"remote-layer\",\"name\":\"远程主体\",\"type\":\"image\",\"assetId\":\"remote-asset\",\"alphaMode\":\"embedded\",\"x\":0,\"y\":0,\"width\":320,\"height\":320,\"rotation\":0,\"opacity\":1,\"zIndex\":1,\"visible\":true,\"locked\":false,\"source\":\"generated\"}}],\"assets\":[{{\"id\":\"remote-asset\",\"kind\":\"subject\",\"src\":\"{remote_asset_url}\",\"width\":512,\"height\":512,\"hasAlpha\":true,\"createdAt\":\"2026-05-05T00:00:00.000Z\"}}],\"editHistory\":[],\"createdAt\":\"2026-05-05T00:00:00.000Z\",\"updatedAt\":\"2026-05-05T00:00:00.000Z\"}}"
                    ),
                ),
                export_file(
                    "export-manifest.json",
                    "application/json",
                    "utf8",
                    &format!(
                        "{{\"schemaVersion\":\"2026-05-05.export.p1\",\"documentId\":\"remote-design\",\"title\":\"远程图层设计\",\"exportedAt\":\"2026-05-06T00:00:00.000Z\",\"designFile\":\"design.json\",\"psdLikeManifestFile\":\"psd-like-manifest.json\",\"previewSvgFile\":\"preview.svg\",\"previewPngFile\":\"preview.png\",\"assets\":[{{\"id\":\"remote-asset\",\"kind\":\"subject\",\"source\":\"reference\",\"originalSrc\":\"{remote_asset_url}\",\"width\":512,\"height\":512,\"hasAlpha\":true}}]}}"
                    ),
                ),
                export_file(
                    "psd-like-manifest.json",
                    "application/json",
                    "utf8",
                    &format!(
                        "{{\"schemaVersion\":\"2026-05-06.psd-like.p1\",\"projectionKind\":\"psd-like-layer-stack\",\"source\":{{\"factSource\":\"LayeredDesignDocument\",\"documentSchemaVersion\":\"2026-05-05.p1\",\"documentId\":\"remote-design\",\"designFile\":\"design.json\"}},\"exportedAt\":\"2026-05-06T00:00:00.000Z\",\"canvas\":{{\"width\":1080,\"height\":1440}},\"preview\":{{\"svgFile\":\"preview.svg\",\"pngFile\":\"preview.png\"}},\"compatibility\":{{\"truePsd\":false,\"layerOrder\":\"back_to_front\",\"editableText\":true,\"rasterImageLayers\":true,\"vectorShapeProjection\":\"basic_svg_shape_semantics\",\"groupHierarchy\":\"reference_only\"}},\"layers\":[{{\"id\":\"remote-layer\",\"name\":\"远程主体\",\"type\":\"image\",\"source\":\"generated\",\"role\":\"raster_image\",\"visible\":true,\"locked\":false,\"blendMode\":\"normal\",\"transform\":{{\"x\":0,\"y\":0,\"width\":320,\"height\":320,\"rotation\":0,\"opacity\":1,\"zIndex\":1}},\"asset\":{{\"id\":\"remote-asset\",\"source\":\"reference\",\"originalSrc\":\"{remote_asset_url}\",\"width\":512,\"height\":512,\"hasAlpha\":true}}}}]}}"
                    ),
                ),
                export_file("preview.svg", "image/svg+xml", "utf8", "<svg />"),
                export_file("preview.png", "image/png", "base64", "cHJldmlldy1wbmc="),
            ],
        }
    }

    async fn spawn_remote_asset_server() -> String {
        let png_bytes = STANDARD
            .decode(TEST_REMOTE_PNG_BASE64)
            .expect("测试 PNG base64 无效");
        let app = Router::new().route(
            "/hero.png",
            get(move || {
                let png_bytes = png_bytes.clone();
                async move {
                    Response::builder()
                        .status(StatusCode::OK)
                        .header(CONTENT_TYPE, HeaderValue::from_static("image/png"))
                        .body(Body::from(png_bytes))
                        .expect("创建远程资源响应失败")
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("绑定测试端口失败");
        let address = listener.local_addr().expect("读取测试端口失败");
        tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("远程资源测试服务失败");
        });
        format!("http://{address}/hero.png")
    }

    #[tokio::test]
    async fn save_layered_design_project_export_should_write_project_directory() {
        let temp_dir = tempfile::tempdir().expect("创建临时目录失败");
        let request = minimal_request(path_to_string(temp_dir.path()));

        let output = save_layered_design_project_export_inner(request)
            .await
            .expect("保存图层设计工程失败");

        assert_eq!(
            output.export_directory_relative_path,
            ".lime/layered-designs/design-test.layered-design"
        );
        assert_eq!(output.file_count, 5);
        assert_eq!(output.asset_count, 1);
        assert_eq!(
            std::fs::read_to_string(
                temp_dir
                    .path()
                    .join(".lime/layered-designs/design-test.layered-design/design.json")
            )
            .expect("读取 design.json 失败"),
            "{\"layers\":[]}"
        );
        assert_eq!(
            std::fs::read(
                temp_dir
                    .path()
                    .join(".lime/layered-designs/design-test.layered-design/preview.png")
            )
            .expect("读取 preview.png 失败"),
            b"preview-png"
        );
        assert_eq!(
            std::fs::read(
                temp_dir.path().join(
                    ".lime/layered-designs/design-test.layered-design/assets/asset-subject.png"
                )
            )
            .expect("读取 asset 失败"),
            b"asset-png"
        );
    }

    #[tokio::test]
    async fn save_layered_design_project_export_should_reject_path_traversal() {
        let temp_dir = tempfile::tempdir().expect("创建临时目录失败");
        let mut request = minimal_request(path_to_string(temp_dir.path()));
        request
            .files
            .push(export_file("../escape.txt", "text/plain", "utf8", "escape"));

        let error = save_layered_design_project_export_inner(request)
            .await
            .expect_err("目录穿越路径应被拒绝");

        assert!(error.contains("目录穿越"));
    }

    #[tokio::test]
    async fn save_layered_design_project_export_should_cache_remote_assets_and_update_manifests() {
        let temp_dir = tempfile::tempdir().expect("创建临时目录失败");
        let remote_asset_url = spawn_remote_asset_server().await;
        let request = remote_asset_request(path_to_string(temp_dir.path()), &remote_asset_url);

        let output = save_layered_design_project_export_inner(request)
            .await
            .expect("保存远程图层设计工程失败");

        assert_eq!(output.file_count, 6);
        assert_eq!(output.asset_count, 1);
        let export_root = temp_dir
            .path()
            .join(".lime/layered-designs/remote-design.layered-design");
        let manifest_json = std::fs::read_to_string(export_root.join("export-manifest.json"))
            .expect("读取 export-manifest.json 失败");
        assert!(manifest_json.contains("\"source\": \"file\""));
        assert!(manifest_json.contains("\"filename\": \"assets/remote-asset.png\""));
        assert!(manifest_json.contains(&remote_asset_url));
        let psd_like_manifest_json =
            std::fs::read_to_string(export_root.join("psd-like-manifest.json"))
                .expect("读取 psd-like-manifest.json 失败");
        assert!(psd_like_manifest_json.contains("\"source\": \"file\""));
        assert!(psd_like_manifest_json.contains("\"filename\": \"assets/remote-asset.png\""));
        assert_eq!(
            std::fs::read(export_root.join("assets/remote-asset.png"))
                .expect("读取远程缓存资产失败"),
            STANDARD
                .decode(TEST_REMOTE_PNG_BASE64)
                .expect("测试 PNG base64 无效")
        );
        assert_eq!(
            std::fs::read_to_string(export_root.join("design.json"))
                .expect("读取 design.json 失败")
                .contains(&remote_asset_url),
            true
        );
    }

    #[tokio::test]
    async fn read_layered_design_project_export_should_restore_latest_saved_document() {
        let temp_dir = tempfile::tempdir().expect("创建临时目录失败");
        let request = minimal_request(path_to_string(temp_dir.path()));
        save_layered_design_project_export_inner(request)
            .await
            .expect("保存图层设计工程失败");

        let output =
            read_layered_design_project_export_inner(ReadLayeredDesignProjectExportRequest {
                project_root_path: path_to_string(temp_dir.path()),
                export_directory_relative_path: None,
            })
            .expect("读取图层设计工程失败");

        assert_eq!(
            output.export_directory_relative_path,
            ".lime/layered-designs/design-test.layered-design"
        );
        assert_eq!(output.design_json, "{\"layers\":[]}");
        assert_eq!(output.manifest_json.as_deref(), Some("{\"assets\":[]}"));
        assert_eq!(output.file_count, 5);
        assert_eq!(output.asset_count, 1);
        assert!(output.updated_at_ms.is_some());
    }

    #[tokio::test]
    async fn read_layered_design_project_export_should_hydrate_cached_remote_assets() {
        let temp_dir = tempfile::tempdir().expect("创建临时目录失败");
        let remote_asset_url = spawn_remote_asset_server().await;
        let request = remote_asset_request(path_to_string(temp_dir.path()), &remote_asset_url);
        save_layered_design_project_export_inner(request)
            .await
            .expect("保存远程图层设计工程失败");

        let output =
            read_layered_design_project_export_inner(ReadLayeredDesignProjectExportRequest {
                project_root_path: path_to_string(temp_dir.path()),
                export_directory_relative_path: Some(
                    ".lime/layered-designs/remote-design.layered-design".to_string(),
                ),
            })
            .expect("读取远程图层设计工程失败");

        assert!(output.design_json.contains("data:image/png;base64,"));
        assert!(!output.design_json.contains(&remote_asset_url));
        assert!(output
            .psd_like_manifest_json
            .as_deref()
            .unwrap_or_default()
            .contains("\"source\": \"file\""));
        assert!(output
            .psd_like_manifest_json
            .as_deref()
            .unwrap_or_default()
            .contains("\"filename\": \"assets/remote-asset.png\""));
        assert_eq!(output.asset_count, 1);
        assert_eq!(output.file_count, 6);
    }

    #[test]
    fn read_layered_design_project_export_should_reject_non_export_directory() {
        let temp_dir = tempfile::tempdir().expect("创建临时目录失败");

        let error =
            read_layered_design_project_export_inner(ReadLayeredDesignProjectExportRequest {
                project_root_path: path_to_string(temp_dir.path()),
                export_directory_relative_path: Some("notes".to_string()),
            })
            .expect_err("非图层设计目录应被拒绝");

        assert!(error.contains(".lime/layered-designs"));
    }
}
