use crate::tool_definition::RuntimeToolDefinition;
use crate::tool_executor::{
    RuntimeToolExecutionError, RuntimeToolExecutionFuture, RuntimeToolExecutionRequest,
    RuntimeToolExecutionResult, RuntimeToolExecutor, RuntimeToolExecutorHandle,
    RuntimeToolPolicyErrorKind,
};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

pub const VIEW_IMAGE_TOOL_NAME: &str = "view_image";
pub const VIEW_IMAGE_LEGACY_ALIASES: &[&str] = &["ViewImage", "ViewImageTool"];
pub const MAX_VIEW_IMAGE_FILE_SIZE: u64 = 50 * 1024 * 1024;

#[derive(Debug, Default)]
pub struct RuntimeViewImageExecutor;

impl RuntimeViewImageExecutor {
    pub fn new() -> Self {
        Self
    }

    pub fn handle() -> RuntimeToolExecutorHandle {
        RuntimeToolExecutorHandle::new(Arc::new(Self::new()))
    }

    async fn execute_view_image(
        &self,
        request: RuntimeToolExecutionRequest<'_>,
    ) -> Result<RuntimeToolExecutionResult, RuntimeToolExecutionError> {
        if request.tool_name != VIEW_IMAGE_TOOL_NAME {
            return Err(view_image_error(format!(
                "view_image executor cannot run tool '{}'",
                request.tool_name
            )));
        }

        let input = parse_input(request.params.clone())?;
        let detail = ViewImageDetail::parse(input.detail.as_deref())?;
        let path = resolve_image_path(&input.path, request.context.working_directory())?;
        let image = read_image(&path)?;
        let output = format_output(&path, &image, detail);
        let mut metadata = HashMap::from([
            ("tool_family".to_string(), json!("view_image")),
            ("tool_result_kind".to_string(), json!("view_image")),
            ("model_visible_image".to_string(), json!(true)),
            ("image_url".to_string(), json!(image.image_url)),
            ("mime_type".to_string(), json!(image.mime_type)),
            ("path".to_string(), json!(path.display().to_string())),
            ("detail".to_string(), json!(detail.as_str())),
            ("original_size".to_string(), json!(image.original_size)),
            ("token_estimate".to_string(), json!(image.token_estimate)),
        ]);

        if let Some(dimensions) = image.dimensions {
            metadata.insert(
                "dimensions".to_string(),
                json!({
                    "original_width": dimensions.width,
                    "original_height": dimensions.height,
                    "display_width": dimensions.width,
                    "display_height": dimensions.height,
                }),
            );
        }

        Ok(RuntimeToolExecutionResult::new(
            true, output, None, metadata,
        ))
    }
}

impl RuntimeToolExecutor for RuntimeViewImageExecutor {
    fn execute<'a>(
        &'a self,
        request: RuntimeToolExecutionRequest<'a>,
    ) -> RuntimeToolExecutionFuture<'a> {
        Box::pin(async move { self.execute_view_image(request).await })
    }
}

pub fn runtime_view_image_executor_handle() -> RuntimeToolExecutorHandle {
    static HANDLE: OnceLock<RuntimeToolExecutorHandle> = OnceLock::new();
    HANDLE.get_or_init(RuntimeViewImageExecutor::handle).clone()
}

pub fn view_image_tool_definition() -> RuntimeToolDefinition {
    RuntimeToolDefinition::new(
        VIEW_IMAGE_TOOL_NAME,
        "View a local image file from the filesystem when visual inspection is needed. Use this for images already available on disk.",
        view_image_tool_input_schema(),
    )
}

pub fn view_image_tool_input_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Local filesystem path to an image file. Relative paths are resolved against the working directory."
            },
            "detail": {
                "type": "string",
                "enum": ["high", "original"],
                "description": "Image detail level. Defaults to `high`; use `original` to preserve exact resolution."
            }
        },
        "required": ["path"],
        "additionalProperties": false
    })
}

pub fn check_runtime_view_image_permissions(
    params: &Value,
    working_directory: &Path,
) -> Result<(), RuntimeToolExecutionError> {
    let input = parse_input(params.clone())?;
    ViewImageDetail::parse(input.detail.as_deref())?;
    resolve_image_path(&input.path, working_directory)?;
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ViewImageInput {
    path: String,
    #[serde(default)]
    detail: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ViewImageDetail {
    High,
    Original,
}

impl ViewImageDetail {
    fn parse(raw: Option<&str>) -> Result<Self, RuntimeToolExecutionError> {
        match raw {
            None | Some("high") => Ok(Self::High),
            Some("original") => Ok(Self::Original),
            Some(value) => Err(view_image_error(format!(
                "view_image.detail only supports `high` or `original`; omit `detail` for default high resized behavior, got `{value}`"
            ))),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::High => "high",
            Self::Original => "original",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ImageDimensions {
    width: u32,
    height: u32,
}

#[derive(Debug)]
struct ViewedImage {
    image_url: String,
    mime_type: String,
    original_size: u64,
    token_estimate: u64,
    dimensions: Option<ImageDimensions>,
}

fn parse_input(params: Value) -> Result<ViewImageInput, RuntimeToolExecutionError> {
    let input: ViewImageInput = serde_json::from_value(params)
        .map_err(|error| view_image_error(format!("view_image 参数无效: {error}")))?;
    if input.path.trim().is_empty() {
        return Err(view_image_error("Missing required parameter: path"));
    }
    Ok(input)
}

fn resolve_image_path(
    raw_path: &str,
    working_directory: &Path,
) -> Result<PathBuf, RuntimeToolExecutionError> {
    let trimmed = raw_path.trim();
    if trimmed.starts_with("file://") {
        return url::Url::parse(trimmed)
            .map_err(|error| view_image_error(format!("Invalid file URL `{trimmed}`: {error}")))?
            .to_file_path()
            .map_err(|_| view_image_error(format!("Invalid local file URL `{trimmed}`")));
    }

    let path = PathBuf::from(trimmed);
    if path.is_absolute() {
        Ok(path)
    } else {
        Ok(working_directory.join(path))
    }
}

fn read_image(path: &Path) -> Result<ViewedImage, RuntimeToolExecutionError> {
    let metadata = std::fs::metadata(path).map_err(|error| {
        view_image_error(format!(
            "unable to locate image at `{}`: {error}",
            path.display()
        ))
    })?;
    if !metadata.is_file() {
        return Err(view_image_error(format!(
            "image path `{}` is not a file",
            path.display()
        )));
    }
    if metadata.len() == 0 {
        return Err(view_image_error(format!(
            "image file is empty: {}",
            path.display()
        )));
    }
    if metadata.len() > MAX_VIEW_IMAGE_FILE_SIZE {
        return Err(view_image_error(format!(
            "image too large: {} bytes (max: {} bytes)",
            metadata.len(),
            MAX_VIEW_IMAGE_FILE_SIZE
        )));
    }

    let bytes = std::fs::read(path).map_err(|error| {
        view_image_error(format!(
            "unable to read image at `{}`: {error}",
            path.display()
        ))
    })?;
    let mime_type = detect_image_mime_type(&bytes, path).ok_or_else(|| {
        view_image_error(format!(
            "unsupported image format `{}`. Supported formats: png, jpg, jpeg, gif, webp",
            path.extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
        ))
    })?;
    let base64 = BASE64_STANDARD.encode(&bytes);
    let token_estimate = estimate_image_tokens(&base64);
    let image_url = format!("data:{mime_type};base64,{base64}");
    let dimensions = image_dimensions(mime_type, &bytes);

    Ok(ViewedImage {
        image_url,
        mime_type: mime_type.to_string(),
        original_size: metadata.len(),
        token_estimate,
        dimensions,
    })
}

fn format_output(path: &Path, image: &ViewedImage, detail: ViewImageDetail) -> String {
    let mut lines = vec![
        format!("Viewed image: {}", path.display()),
        format!("Format: {}", image.mime_type),
        format!(
            "Size: {} KB ({} bytes)",
            image.original_size.div_ceil(1024),
            image.original_size
        ),
        format!("Detail: {}", detail.as_str()),
        format!("Estimated tokens: {}", image.token_estimate),
    ];

    if let Some(dimensions) = image.dimensions {
        lines.push(format!(
            "Dimensions: {}x{}",
            dimensions.width, dimensions.height
        ));
    }

    lines.push("Image content is attached to this tool result.".to_string());
    lines.join("\n")
}

fn detect_image_mime_type(bytes: &[u8], path: &Path) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some("image/png");
    }
    if bytes.len() >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff {
        return Some("image/jpeg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }

    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.trim_start_matches('.').to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => Some("image/png"),
        Some("jpg" | "jpeg") => Some("image/jpeg"),
        Some("gif") => Some("image/gif"),
        Some("webp") => Some("image/webp"),
        _ => None,
    }
}

fn estimate_image_tokens(base64: &str) -> u64 {
    (base64.len() as f64 * 0.125).ceil() as u64
}

fn image_dimensions(mime_type: &str, bytes: &[u8]) -> Option<ImageDimensions> {
    match mime_type {
        "image/png" => png_dimensions(bytes),
        "image/jpeg" => jpeg_dimensions(bytes),
        "image/gif" => gif_dimensions(bytes),
        "image/webp" => webp_dimensions(bytes),
        _ => None,
    }
}

fn png_dimensions(bytes: &[u8]) -> Option<ImageDimensions> {
    if bytes.len() < 24 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return None;
    }
    Some(ImageDimensions {
        width: u32::from_be_bytes(bytes[16..20].try_into().ok()?),
        height: u32::from_be_bytes(bytes[20..24].try_into().ok()?),
    })
}

fn gif_dimensions(bytes: &[u8]) -> Option<ImageDimensions> {
    if bytes.len() < 10 || !(bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")) {
        return None;
    }
    Some(ImageDimensions {
        width: u16::from_le_bytes(bytes[6..8].try_into().ok()?) as u32,
        height: u16::from_le_bytes(bytes[8..10].try_into().ok()?) as u32,
    })
}

fn jpeg_dimensions(bytes: &[u8]) -> Option<ImageDimensions> {
    if bytes.len() < 4 || bytes[0] != 0xff || bytes[1] != 0xd8 {
        return None;
    }

    let mut cursor = 2usize;
    while cursor + 3 < bytes.len() {
        if bytes[cursor] != 0xff {
            cursor += 1;
            continue;
        }
        while cursor < bytes.len() && bytes[cursor] == 0xff {
            cursor += 1;
        }
        if cursor >= bytes.len() {
            return None;
        }

        let marker = bytes[cursor];
        cursor += 1;
        if marker == 0xd9 || marker == 0xda {
            return None;
        }
        if marker == 0x01 || (0xd0..=0xd8).contains(&marker) {
            continue;
        }
        if cursor + 2 > bytes.len() {
            return None;
        }

        let segment_len = u16::from_be_bytes(bytes[cursor..cursor + 2].try_into().ok()?) as usize;
        if segment_len < 2 || cursor + segment_len > bytes.len() {
            return None;
        }
        let payload = cursor + 2;
        if matches!(
            marker,
            0xc0 | 0xc1
                | 0xc2
                | 0xc3
                | 0xc5
                | 0xc6
                | 0xc7
                | 0xc9
                | 0xca
                | 0xcb
                | 0xcd
                | 0xce
                | 0xcf
        ) && segment_len >= 7
        {
            return Some(ImageDimensions {
                height: u16::from_be_bytes(bytes[payload + 1..payload + 3].try_into().ok()?) as u32,
                width: u16::from_be_bytes(bytes[payload + 3..payload + 5].try_into().ok()?) as u32,
            });
        }

        cursor += segment_len;
    }

    None
}

fn webp_dimensions(bytes: &[u8]) -> Option<ImageDimensions> {
    if bytes.len() < 16 || !bytes.starts_with(b"RIFF") || &bytes[8..12] != b"WEBP" {
        return None;
    }

    match &bytes[12..16] {
        b"VP8X" if bytes.len() >= 30 => Some(ImageDimensions {
            width: read_u24_le(&bytes[24..27])? + 1,
            height: read_u24_le(&bytes[27..30])? + 1,
        }),
        b"VP8L" if bytes.len() >= 25 => {
            let packed = u32::from_le_bytes(bytes[21..25].try_into().ok()?);
            Some(ImageDimensions {
                width: (packed & 0x3fff) + 1,
                height: ((packed >> 14) & 0x3fff) + 1,
            })
        }
        b"VP8 " if bytes.len() >= 30 && &bytes[23..26] == b"\x9d\x01\x2a" => {
            Some(ImageDimensions {
                width: (u16::from_le_bytes(bytes[26..28].try_into().ok()?) & 0x3fff) as u32,
                height: (u16::from_le_bytes(bytes[28..30].try_into().ok()?) & 0x3fff) as u32,
            })
        }
        _ => None,
    }
}

fn read_u24_le(bytes: &[u8]) -> Option<u32> {
    if bytes.len() < 3 {
        return None;
    }
    Some(bytes[0] as u32 | ((bytes[1] as u32) << 8) | ((bytes[2] as u32) << 16))
}

fn view_image_error(message: impl Into<String>) -> RuntimeToolExecutionError {
    let message = message.into();
    RuntimeToolExecutionError::new(
        message.clone(),
        Some(RuntimeToolPolicyErrorKind::ExecutionFailed(message)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tool_executor::{RuntimeToolExecutionContext, RuntimeToolExecutionContextInput};
    use serde_json::json;
    use std::path::PathBuf;
    use tempfile::tempdir;

    const PNG_BYTES: &[u8] = &[
        0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n', 0, 0, 0, 13, b'I', b'H', b'D', b'R', 0,
        0, 0, 2, 0, 0, 0, 3, 8, 2, 0, 0, 0,
    ];

    fn context(path: PathBuf) -> RuntimeToolExecutionContext {
        RuntimeToolExecutionContext::new(RuntimeToolExecutionContextInput {
            working_directory: path,
            session_id: "session-view-image-1".to_string(),
            cancel_token: None,
            workspace_sandbox: None,
        })
    }

    #[test]
    fn view_image_definition_uses_codex_style_schema() {
        let definition = view_image_tool_definition();

        assert_eq!(definition.name, VIEW_IMAGE_TOOL_NAME);
        assert_eq!(
            definition.input_schema["properties"]["detail"]["enum"],
            json!(["high", "original"])
        );
        assert_eq!(
            definition.input_schema["additionalProperties"],
            json!(false)
        );
    }

    #[test]
    fn view_image_permission_rejects_unknown_detail() {
        let dir = tempdir().expect("tempdir");
        let result = check_runtime_view_image_permissions(
            &json!({
                "path": "sample.png",
                "detail": "low"
            }),
            dir.path(),
        );

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn view_image_executor_returns_model_visible_image_metadata_without_base64_output() {
        let dir = tempdir().expect("tempdir");
        let image_path = dir.path().join("sample.png");
        std::fs::write(&image_path, PNG_BYTES).expect("write image");
        let runtime_context = context(dir.path().to_path_buf());

        let result = runtime_view_image_executor_handle()
            .execute(RuntimeToolExecutionRequest {
                tool_name: VIEW_IMAGE_TOOL_NAME,
                params: &json!({ "path": "sample.png", "detail": "original" }),
                context: &runtime_context,
                turn_context: None,
            })
            .await
            .expect("view image should execute");

        assert!(result.success);
        assert!(result.output.contains("Viewed image:"));
        assert!(result.output.contains("Dimensions: 2x3"));
        assert!(!result.output.contains("base64,"));
        assert_eq!(
            result.metadata.get("tool_family"),
            Some(&json!("view_image"))
        );
        assert_eq!(
            result.metadata.get("model_visible_image"),
            Some(&json!(true))
        );
        assert_eq!(result.metadata.get("mime_type"), Some(&json!("image/png")));
        assert_eq!(result.metadata.get("detail"), Some(&json!("original")));
        assert!(
            result
                .metadata
                .get("image_url")
                .and_then(Value::as_str)
                .is_some_and(|value| value.starts_with("data:image/png;base64,"))
        );
    }
}
