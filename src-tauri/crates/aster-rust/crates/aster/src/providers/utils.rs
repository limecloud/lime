use super::base::{MessageStream, Usage};
use super::errors::GoogleErrorCode;
use crate::config::paths::Paths;
use crate::model::ModelConfig;
use crate::providers::errors::ProviderError;
use crate::providers::formats::openai::response_to_streaming_message;
use anyhow::{anyhow, Result};
use async_stream::try_stream;
use base64::Engine;
use futures::TryStreamExt;
use regex::Regex;
use reqwest::{Response, StatusCode};
use rmcp::model::{AnnotateAble, ImageContent, RawImageContent};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::any::{type_name, Any};
use std::collections::BTreeMap;
use std::fmt::Display;
use std::fs::File;
use std::io;
use std::io::{BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;
use tokio::pin;
use tokio_stream::StreamExt;
use tokio_util::codec::{FramedRead, LinesCodec};
use tokio_util::io::StreamReader;
use uuid::Uuid;

#[derive(Debug, Copy, Clone, Serialize, Deserialize)]
pub enum ImageFormat {
    OpenAi,
    Anthropic,
}

/// Convert an image content into an image json based on format
pub fn convert_image(image: &ImageContent, image_format: &ImageFormat) -> Value {
    match image_format {
        ImageFormat::OpenAi => json!({
            "type": "image_url",
            "image_url": {
                "url": format!("data:{};base64,{}", image.mime_type, image.data)
            }
        }),
        ImageFormat::Anthropic => json!({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": image.mime_type,
                "data": image.data,
            }
        }),
    }
}

pub fn filter_extensions_from_system_prompt(system: &str) -> String {
    let Some(extensions_start) = system.find("# Extensions") else {
        return system.to_string();
    };

    let Some(after_extensions) = system.get(extensions_start + 1..) else {
        return system.to_string();
    };

    if let Some(next_section_pos) = after_extensions.find("\n# ") {
        let Some(before) = system.get(..extensions_start) else {
            return system.to_string();
        };
        let Some(after) = system.get(extensions_start + next_section_pos + 1..) else {
            return system.to_string();
        };
        format!("{}{}", before.trim_end(), after)
    } else {
        system
            .get(..extensions_start)
            .map(|s| s.trim_end().to_string())
            .unwrap_or_else(|| system.to_string())
    }
}

fn check_context_length_exceeded(text: &str) -> bool {
    let check_phrases = [
        "too long",
        "context length",
        "context_length_exceeded",
        "reduce the length",
        "token count",
        "exceeds",
        "exceed context limit",
        "input length",
        "max_tokens",
        "decrease input length",
        "context limit",
    ];
    let text_lower = text.to_lowercase();
    check_phrases
        .iter()
        .any(|phrase| text_lower.contains(phrase))
}

fn format_server_error_message(status_code: StatusCode, payload: Option<&Value>) -> String {
    match payload {
        Some(Value::Null) | None => format!(
            "HTTP {}: No response body received from server",
            status_code.as_u16()
        ),
        Some(p) => format!("HTTP {}: {}", status_code.as_u16(), p),
    }
}

pub fn map_http_error_to_provider_error(
    status: StatusCode,
    payload: Option<Value>,
) -> ProviderError {
    let extract_message = || -> String {
        payload
            .as_ref()
            .and_then(|p| {
                p.get("error")
                    .and_then(|e| e.get("message"))
                    .or_else(|| p.get("message"))
                    .and_then(|m| m.as_str())
                    .map(String::from)
            })
            .unwrap_or_else(|| payload.as_ref().map(|p| p.to_string()).unwrap_or_default())
    };

    let error = match status {
        StatusCode::OK => unreachable!("Should not call this function with OK status"),
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => ProviderError::Authentication(format!(
            "Authentication failed. Status: {}. Response: {}",
            status,
            extract_message()
        )),
        StatusCode::NOT_FOUND => {
            ProviderError::RequestFailed(format!("Resource not found (404): {}", extract_message()))
        }
        StatusCode::PAYLOAD_TOO_LARGE => ProviderError::ContextLengthExceeded(extract_message()),
        StatusCode::BAD_REQUEST => {
            let payload_str = extract_message();
            if check_context_length_exceeded(&payload_str) {
                ProviderError::ContextLengthExceeded(payload_str)
            } else {
                ProviderError::RequestFailed(format!("Bad request (400): {}", payload_str))
            }
        }
        StatusCode::TOO_MANY_REQUESTS => ProviderError::RateLimitExceeded {
            details: extract_message(),
            retry_delay: None,
        },
        _ if status.is_server_error() => {
            ProviderError::ServerError(format!("Server error ({}): {}", status, extract_message()))
        }
        _ => ProviderError::RequestFailed(format!(
            "Request failed with status {}: {}",
            status,
            extract_message()
        )),
    };

    if !status.is_success() {
        tracing::warn!(
            "Provider request failed with status: {}. Payload: {:?}. Returning error: {:?}",
            status,
            payload,
            error
        );
    }

    error
}

pub async fn handle_status_openai_compat(response: Response) -> Result<Response, ProviderError> {
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let payload = serde_json::from_str::<Value>(&body).ok();
        return Err(map_http_error_to_provider_error(status, payload));
    }
    Ok(response)
}

pub async fn handle_response_openai_compat(response: Response) -> Result<Value, ProviderError> {
    let response = handle_status_openai_compat(response).await?;

    response.json::<Value>().await.map_err(|e| {
        ProviderError::RequestFailed(format!("Response body is not valid JSON: {}", e))
    })
}

pub fn stream_openai_compat(
    response: Response,
    mut log: RequestLog,
) -> Result<MessageStream, ProviderError> {
    let stream = response.bytes_stream().map_err(io::Error::other);

    Ok(Box::pin(try_stream! {
        let stream_reader = StreamReader::new(stream);
        let framed = FramedRead::new(stream_reader, LinesCodec::new())
            .map_err(anyhow::Error::from);

        let message_stream = response_to_streaming_message(framed);
        pin!(message_stream);
        while let Some(message) = message_stream.next().await {
            let (message, usage) = message.map_err(|e|
                ProviderError::RequestFailed(format!("Stream decode error: {}", e))
            )?;
            log.write(&message, usage.as_ref().map(|f| f.usage).as_ref())?;
            yield (message, usage);
        }
    }))
}

pub fn is_google_model(payload: &Value) -> bool {
    payload
        .get("model")
        .and_then(|m| m.as_str())
        .unwrap_or("")
        .to_lowercase()
        .contains("google")
}

/// Extracts `StatusCode` from response status or payload error code.
/// This function first checks the status code of the response. If the status is successful (2xx),
/// it then checks the payload for any error codes and maps them to appropriate `StatusCode`.
/// If the status is not successful (e.g., 4xx or 5xx), the original status code is returned.
fn get_google_final_status(status: StatusCode, payload: Option<&Value>) -> StatusCode {
    // If the status is successful, check for an error in the payload
    if status.is_success() {
        if let Some(payload) = payload {
            if let Some(error) = payload.get("error") {
                if let Some(code) = error.get("code").and_then(|c| c.as_u64()) {
                    if let Some(google_error) = GoogleErrorCode::from_code(code) {
                        return google_error.to_status_code();
                    }
                }
            }
        }
    }
    status
}

fn parse_google_retry_delay(payload: &Value) -> Option<Duration> {
    payload
        .get("error")
        .and_then(|error| error.get("details"))
        .and_then(|details| details.as_array())
        .and_then(|details_array| {
            details_array.iter().find_map(|detail| {
                if detail
                    .get("@type")
                    .and_then(|t| t.as_str())
                    .is_some_and(|s| s.ends_with("RetryInfo"))
                {
                    detail
                        .get("retryDelay")
                        .and_then(|delay| delay.as_str())
                        .and_then(|s| s.strip_suffix('s'))
                        .and_then(|num| num.parse::<u64>().ok())
                        .map(Duration::from_secs)
                } else {
                    None
                }
            })
        })
}

/// Handle response from Google Gemini API-compatible endpoints.
///
/// Processes HTTP responses, handling specific statuses and parsing the payload
/// for error messages. Logs the response payload for debugging purposes.
///
/// ### References
/// - Error Codes: https://ai.google.dev/gemini-api/docs/troubleshooting?lang=python
///
/// ### Arguments
/// - `response`: The HTTP response to process.
///
/// ### Returns
/// - `Ok(Value)`: Parsed JSON on success.
/// - `Err(ProviderError)`: Describes the failure reason.
pub async fn handle_response_google_compat(response: Response) -> Result<Value, ProviderError> {
    let status = response.status();
    let payload: Option<Value> = response.json().await.ok();
    let final_status = get_google_final_status(status, payload.as_ref());

    match final_status {
        StatusCode::OK =>  payload.ok_or_else( || ProviderError::RequestFailed("Response body is not valid JSON".to_string()) ),
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
            Err(ProviderError::Authentication(format!("Authentication failed. Please ensure your API keys are valid and have the required permissions. \
                Status: {}. Response: {:?}", final_status, payload )))
        }
        StatusCode::BAD_REQUEST | StatusCode::NOT_FOUND => {
            let mut error_msg = "Unknown error".to_string();
            if let Some(payload) = &payload {
                if let Some(error) = payload.get("error") {
                    error_msg = error.get("message").and_then(|m| m.as_str()).unwrap_or("Unknown error").to_string();
                    let error_status = error.get("status").and_then(|s| s.as_str()).unwrap_or("Unknown status");
                    if error_status == "INVALID_ARGUMENT" && error_msg.to_lowercase().contains("exceeds") {
                        return Err(ProviderError::ContextLengthExceeded(error_msg.to_string()));
                    }
                }
            }
            tracing::debug!(
                "{}", format!("Provider request failed with status: {}. Payload: {:?}", final_status, payload)
            );
            Err(ProviderError::RequestFailed(format!("Request failed with status: {}. Message: {}", final_status, error_msg)))
        }
        StatusCode::TOO_MANY_REQUESTS => {
            let retry_delay = payload.as_ref().and_then(parse_google_retry_delay);
            Err(ProviderError::RateLimitExceeded {
                details: format!("{:?}", payload),
                retry_delay,
            })
        }
        _ if final_status.is_server_error() => Err(ProviderError::ServerError(
            format_server_error_message(final_status, payload.as_ref()),
        )),
        _ => {
            tracing::debug!(
                "{}", format!("Provider request failed with status: {}. Payload: {:?}", final_status, payload)
            );
            Err(ProviderError::RequestFailed(format!("Request failed with status: {}", final_status)))
        }
    }
}

pub fn sanitize_function_name(name: &str) -> String {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"[^a-zA-Z0-9_-]").unwrap());
    re.replace_all(name, "_").to_string()
}

pub fn is_valid_function_name(name: &str) -> bool {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"^[a-zA-Z0-9_-]+$").unwrap());
    re.is_match(name)
}

/// Extract the model name from a JSON object. Common with most providers to have this top level attribute.
pub fn get_model(data: &Value) -> String {
    if let Some(model) = data.get("model") {
        if let Some(model_str) = model.as_str() {
            model_str.to_string()
        } else {
            "Unknown".to_string()
        }
    } else {
        "Unknown".to_string()
    }
}

/// Check if a file is actually an image by examining its magic bytes
fn is_image_file(path: &Path) -> bool {
    if let Ok(mut file) = std::fs::File::open(path) {
        let mut buffer = [0u8; 8]; // Large enough for most image magic numbers
        if file.read(&mut buffer).is_ok() {
            // Check magic numbers for common image formats
            return match &buffer[0..4] {
                // PNG: 89 50 4E 47
                [0x89, 0x50, 0x4E, 0x47] => true,
                // JPEG: FF D8 FF
                [0xFF, 0xD8, 0xFF, _] => true,
                // GIF: 47 49 46 38
                [0x47, 0x49, 0x46, 0x38] => true,
                _ => false,
            };
        }
    }
    false
}

/// Detect if a string contains a path to an image file
pub fn detect_image_path(text: &str) -> Option<&str> {
    // Basic image file extension check
    let extensions = [".png", ".jpg", ".jpeg"];

    // Find any word that ends with an image extension
    for word in text.split_whitespace() {
        if extensions
            .iter()
            .any(|ext| word.to_lowercase().ends_with(ext))
        {
            let path = Path::new(word);
            // Check if it's an absolute path and file exists
            if path.is_absolute() && path.is_file() {
                // Verify it's actually an image file
                if is_image_file(path) {
                    return Some(word);
                }
            }
        }
    }
    None
}

/// Convert a local image file to base64 encoded ImageContent
pub fn load_image_file(path: &str) -> Result<ImageContent, ProviderError> {
    let path = Path::new(path);

    // Verify it's an image before proceeding
    if !is_image_file(path) {
        return Err(ProviderError::RequestFailed(
            "File is not a valid image".to_string(),
        ));
    }

    // Read the file
    let bytes = std::fs::read(path)
        .map_err(|e| ProviderError::RequestFailed(format!("Failed to read image file: {}", e)))?;

    // Detect mime type from extension
    let mime_type = match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => match ext.to_lowercase().as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            _ => {
                return Err(ProviderError::RequestFailed(
                    "Unsupported image format".to_string(),
                ))
            }
        },
        None => {
            return Err(ProviderError::RequestFailed(
                "Unknown image format".to_string(),
            ))
        }
    };

    // Convert to base64
    let data = base64::prelude::BASE64_STANDARD.encode(&bytes);

    Ok(RawImageContent {
        mime_type: mime_type.to_string(),
        data,
        meta: None,
    }
    .no_annotation())
}

pub fn unescape_json_values(value: &Value) -> Value {
    let mut cloned = value.clone();
    unescape_json_values_in_place(&mut cloned);
    cloned
}

fn unescape_json_values_in_place(value: &mut Value) {
    match value {
        Value::Object(map) => {
            for v in map.values_mut() {
                unescape_json_values_in_place(v);
            }
        }
        Value::Array(arr) => {
            for v in arr.iter_mut() {
                unescape_json_values_in_place(v);
            }
        }
        Value::String(s) => {
            if s.contains('\\') {
                *s = s
                    .replace("\\\\n", "\n")
                    .replace("\\\\t", "\t")
                    .replace("\\\\r", "\r")
                    .replace("\\\\\"", "\"")
                    .replace("\\n", "\n")
                    .replace("\\t", "\t")
                    .replace("\\r", "\r")
                    .replace("\\\"", "\"");
            }
        }
        _ => {}
    }
}

pub struct RequestLog {
    writer: Option<BufWriter<File>>,
    temp_path: PathBuf,
}

pub const LOGS_TO_KEEP: usize = 10;
const REQUEST_LOG_KEY_SAMPLE_LIMIT: usize = 12;
const REQUEST_LOG_TOOL_NAME_SAMPLE_LIMIT: usize = 8;
const REQUEST_LOG_TEXT_PREVIEW_CHARS: usize = 160;

#[derive(Default)]
struct RequestLogContentStats {
    block_count: usize,
    text_chars: usize,
    cache_control_blocks: usize,
    type_counts: BTreeMap<String, usize>,
    first_text_preview: Option<String>,
}

impl RequestLogContentStats {
    fn ingest_block(&mut self, block: &Value) {
        self.block_count += 1;
        *self
            .type_counts
            .entry(request_log_value_type_hint(block))
            .or_default() += 1;

        if block.get("cache_control").is_some() {
            self.cache_control_blocks += 1;
        }

        if let Some(text) = request_log_text_candidate(block) {
            self.ingest_text_preview(text);
        }
    }

    fn ingest_text_preview(&mut self, text: &str) {
        let chars = text.chars().count();
        self.text_chars += chars;
        if self.first_text_preview.is_none() && !text.trim().is_empty() {
            self.first_text_preview = Some(request_log_truncate_text(text));
        }
    }

    fn into_json(self) -> Value {
        let mut summary = serde_json::Map::new();
        summary.insert("blocks".to_string(), json!(self.block_count));
        summary.insert("type_counts".to_string(), json!(self.type_counts));

        if self.text_chars > 0 {
            summary.insert("text_chars".to_string(), json!(self.text_chars));
        }
        if self.cache_control_blocks > 0 {
            summary.insert(
                "cache_control_blocks".to_string(),
                json!(self.cache_control_blocks),
            );
        }
        if let Some(preview) = self.first_text_preview {
            summary.insert("text_preview".to_string(), json!(preview));
        }

        Value::Object(summary)
    }
}

fn request_log_truncate_text(text: &str) -> String {
    let mut preview = text
        .chars()
        .take(REQUEST_LOG_TEXT_PREVIEW_CHARS)
        .collect::<String>();
    if text.chars().count() > REQUEST_LOG_TEXT_PREVIEW_CHARS {
        preview.push_str("...");
    }
    preview
}

fn request_log_scalar_summary(value: &Value) -> Value {
    match value {
        Value::Null => json!({ "type": "null" }),
        Value::Bool(boolean) => json!({ "type": "bool", "value": boolean }),
        Value::Number(number) => json!({ "type": "number", "value": number }),
        Value::String(text) => json!({
            "type": "string",
            "chars": text.chars().count(),
            "preview": request_log_truncate_text(text),
        }),
        Value::Array(items) => json!({
            "type": "array",
            "len": items.len(),
        }),
        Value::Object(object) => json!({
            "type": "object",
            "keys": object
                .keys()
                .take(REQUEST_LOG_KEY_SAMPLE_LIMIT)
                .cloned()
                .collect::<Vec<_>>(),
        }),
    }
}

fn request_log_value_type_hint(value: &Value) -> String {
    value
        .get("type")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| match value {
            Value::Null => "null".to_string(),
            Value::Bool(_) => "bool".to_string(),
            Value::Number(_) => "number".to_string(),
            Value::String(_) => "string".to_string(),
            Value::Array(_) => "array".to_string(),
            Value::Object(_) => "object".to_string(),
        })
}

fn request_log_text_candidate(value: &Value) -> Option<&str> {
    ["text", "input_text", "content"]
        .iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
}

fn summarize_request_log_messages(messages: &[Value]) -> Value {
    let roles = messages
        .iter()
        .filter_map(|message| message.get("role").and_then(Value::as_str))
        .map(str::to_string)
        .collect::<Vec<_>>();

    let mut stats = RequestLogContentStats::default();
    let mut last_user_preview = None;

    for message in messages {
        let role = message.get("role").and_then(Value::as_str);
        match message.get("content") {
            Some(Value::Array(blocks)) => {
                for block in blocks {
                    stats.ingest_block(block);
                }
                if role == Some("user") {
                    last_user_preview = blocks
                        .iter()
                        .find_map(request_log_text_candidate)
                        .map(request_log_truncate_text);
                }
            }
            Some(Value::String(text)) => {
                stats.ingest_text_preview(text);
                if role == Some("user") {
                    last_user_preview = Some(request_log_truncate_text(text));
                }
            }
            _ => {}
        }
    }

    let mut summary = serde_json::Map::new();
    summary.insert("count".to_string(), json!(messages.len()));
    if !roles.is_empty() {
        summary.insert("roles".to_string(), json!(roles));
    }
    summary.insert("content".to_string(), stats.into_json());
    if let Some(preview) = last_user_preview {
        summary.insert("last_user_preview".to_string(), json!(preview));
    }
    Value::Object(summary)
}

fn summarize_request_log_tools(tools: &[Value]) -> Value {
    let names = tools
        .iter()
        .filter_map(|tool| tool.get("name").and_then(Value::as_str))
        .take(REQUEST_LOG_TOOL_NAME_SAMPLE_LIMIT)
        .map(str::to_string)
        .collect::<Vec<_>>();
    let cache_control_tools = tools
        .iter()
        .filter(|tool| tool.get("cache_control").is_some())
        .count();

    let mut summary = serde_json::Map::new();
    summary.insert("count".to_string(), json!(tools.len()));
    if !names.is_empty() {
        summary.insert("names".to_string(), json!(names));
    }
    if cache_control_tools > 0 {
        summary.insert(
            "cache_control_tools".to_string(),
            json!(cache_control_tools),
        );
    }
    Value::Object(summary)
}

fn summarize_request_log_system(system: &Value) -> Value {
    match system {
        Value::Array(blocks) => {
            let mut stats = RequestLogContentStats::default();
            for block in blocks {
                stats.ingest_block(block);
            }
            let mut summary = serde_json::Map::new();
            summary.insert("format".to_string(), json!("blocks"));
            summary.insert("content".to_string(), stats.into_json());
            Value::Object(summary)
        }
        Value::String(text) => json!({
            "format": "string",
            "chars": text.chars().count(),
            "preview": request_log_truncate_text(text),
        }),
        _ => request_log_scalar_summary(system),
    }
}

fn summarize_request_log_input_items(items: &[Value]) -> Value {
    let roles = items
        .iter()
        .filter_map(|item| item.get("role").and_then(Value::as_str))
        .map(str::to_string)
        .collect::<Vec<_>>();

    let mut stats = RequestLogContentStats::default();
    for item in items {
        match item.get("content") {
            Some(Value::Array(content_items)) => {
                for content_item in content_items {
                    stats.ingest_block(content_item);
                }
            }
            Some(Value::String(text)) => stats.ingest_text_preview(text),
            _ => stats.ingest_block(item),
        }
    }

    let mut summary = serde_json::Map::new();
    summary.insert("count".to_string(), json!(items.len()));
    if !roles.is_empty() {
        summary.insert("roles".to_string(), json!(roles));
    }
    summary.insert("content".to_string(), stats.into_json());
    Value::Object(summary)
}

fn summarize_request_log_json_payload(payload: &Value, payload_type: &'static str) -> Value {
    let mut summary = serde_json::Map::new();
    summary.insert("logging_mode".to_string(), json!("summary"));
    summary.insert("payload_type".to_string(), json!(payload_type));

    match payload {
        Value::Object(object) => {
            summary.insert("kind".to_string(), json!("object"));
            summary.insert(
                "keys".to_string(),
                json!(object
                    .keys()
                    .take(REQUEST_LOG_KEY_SAMPLE_LIMIT)
                    .cloned()
                    .collect::<Vec<_>>()),
            );

            for key in ["model", "stream", "max_tokens", "temperature", "seed"] {
                if let Some(value) = object.get(key) {
                    summary.insert(key.to_string(), request_log_scalar_summary(value));
                }
            }

            if let Some(messages) = object.get("messages").and_then(Value::as_array) {
                summary.insert(
                    "messages".to_string(),
                    summarize_request_log_messages(messages),
                );
            }
            if let Some(system) = object.get("system") {
                summary.insert("system".to_string(), summarize_request_log_system(system));
            }
            if let Some(tools) = object.get("tools").and_then(Value::as_array) {
                summary.insert("tools".to_string(), summarize_request_log_tools(tools));
            }
            if let Some(input) = object.get("input").and_then(Value::as_array) {
                summary.insert(
                    "input".to_string(),
                    summarize_request_log_input_items(input),
                );
            }
        }
        Value::Array(items) => {
            summary.insert("kind".to_string(), json!("array"));
            summary.insert(
                "items".to_string(),
                summarize_request_log_input_items(items),
            );
        }
        _ => {
            summary.insert(
                "kind".to_string(),
                json!(request_log_value_type_hint(payload)),
            );
            summary.insert("value".to_string(), request_log_scalar_summary(payload));
        }
    }

    Value::Object(summary)
}

fn summarize_request_log_input<Payload>(payload: &Payload) -> Value
where
    Payload: Any,
{
    if let Some(value) = (payload as &dyn Any).downcast_ref::<Value>() {
        return summarize_request_log_json_payload(value, type_name::<Payload>());
    }

    json!({
        "logging_mode": "summary",
        "payload_type": type_name::<Payload>(),
    })
}

impl RequestLog {
    pub fn start<Payload>(model_config: &ModelConfig, payload: &Payload) -> Result<Self>
    where
        Payload: Any,
    {
        let logs_dir = Paths::in_state_dir("logs");

        let request_id = Uuid::new_v4();
        let temp_name = format!("llm_request.{request_id}.jsonl");
        let temp_path = logs_dir.join(PathBuf::from(temp_name));

        let mut writer = BufWriter::new(
            File::options()
                .write(true)
                .create(true)
                .truncate(true)
                .open(&temp_path)?,
        );

        let data = serde_json::json!({
            "model_config": model_config,
            "input": summarize_request_log_input(payload),
        });
        writeln!(writer, "{}", serde_json::to_string(&data)?)?;

        Ok(Self {
            writer: Some(writer),
            temp_path,
        })
    }

    fn write_json(&mut self, line: &serde_json::Value) -> Result<()> {
        let writer = self
            .writer
            .as_mut()
            .ok_or_else(|| anyhow!("logger is finished"))?;
        writeln!(writer, "{}", serde_json::to_string(line)?)?;
        Ok(())
    }

    pub fn error<E>(&mut self, error: E) -> Result<()>
    where
        E: Display,
    {
        self.write_json(&serde_json::json!({
            "error": format!("{}", error),
        }))
    }

    pub fn write<Payload>(&mut self, data: &Payload, usage: Option<&Usage>) -> Result<()>
    where
        Payload: Serialize,
    {
        self.write_json(&serde_json::json!({
            "data": data,
            "usage": usage,
        }))
    }

    fn finish(&mut self) -> Result<()> {
        if let Some(mut writer) = self.writer.take() {
            writer.flush()?;
            let logs_dir = Paths::in_state_dir("logs");
            let log_path = |i| logs_dir.join(format!("llm_request.{}.jsonl", i));

            for i in (0..LOGS_TO_KEEP - 1).rev() {
                let _ = std::fs::rename(log_path(i), log_path(i + 1));
            }

            std::fs::rename(&self.temp_path, log_path(0))?;
        }
        Ok(())
    }
}

impl Drop for RequestLog {
    fn drop(&mut self) {
        if std::thread::panicking() {
            return;
        }
        let _ = self.finish();
    }
}

/// Safely parse a JSON string that may contain doubly-encoded or malformed JSON.
/// This function first attempts to parse the input string as-is. If that fails,
/// it applies control character escaping and tries again.
///
/// This approach preserves valid JSON like `{"key1": "value1",\n"key2": "value"}`
/// (which contains a literal \n but is perfectly valid JSON) while still fixing
/// broken JSON like `{"key1": "value1\n","key2": "value"}` (which contains an
/// unescaped newline character).
pub fn safely_parse_json(s: &str) -> Result<serde_json::Value, serde_json::Error> {
    // First, try parsing the string as-is
    match serde_json::from_str(s) {
        Ok(value) => Ok(value),
        Err(_) => {
            // If that fails, try with control character escaping
            let escaped = json_escape_control_chars_in_string(s);
            serde_json::from_str(&escaped)
        }
    }
}

fn strip_wrapping_code_fence(s: &str) -> &str {
    let trimmed = s.trim();
    let Some(stripped_prefix) = trimmed.strip_prefix("```") else {
        return trimmed;
    };
    let Some(first_newline) = stripped_prefix.find('\n') else {
        return trimmed;
    };
    let fenced_body = &stripped_prefix[first_newline + 1..];
    fenced_body
        .trim_end()
        .strip_suffix("```")
        .map(str::trim)
        .unwrap_or(trimmed)
}

fn tool_protocol_tag_regex() -> &'static Regex {
    static TOOL_PROTOCOL_TAG_RE: OnceLock<Regex> = OnceLock::new();
    TOOL_PROTOCOL_TAG_RE.get_or_init(|| {
        Regex::new(
            r#"(?is)</?(?:tool_call|tool_use|tool_result|function_call|function_calls)\b[^>]*>"#,
        )
        .expect("tool protocol tag regex should compile")
    })
}

fn strip_tool_protocol_markup(s: &str) -> String {
    tool_protocol_tag_regex().replace_all(s, " ").into_owned()
}

fn push_unique_candidate(candidates: &mut Vec<String>, candidate: &str) {
    let trimmed = candidate.trim();
    if trimmed.is_empty() {
        return;
    }
    if !candidates.iter().any(|existing| existing == trimmed) {
        candidates.push(trimmed.to_string());
    }
}

fn find_outer_json_span(s: &str) -> Option<(usize, usize)> {
    let mut start: Option<usize> = None;
    let mut stack: Vec<char> = Vec::new();
    let mut in_string = false;
    let mut escaping = false;

    for (index, ch) in s.char_indices() {
        if start.is_none() {
            match ch {
                '{' => {
                    start = Some(index);
                    stack.push('}');
                }
                '[' => {
                    start = Some(index);
                    stack.push(']');
                }
                _ => {}
            }
            continue;
        }

        if in_string {
            if escaping {
                escaping = false;
                continue;
            }
            match ch {
                '\\' => escaping = true,
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }

        match ch {
            '"' => in_string = true,
            '{' => stack.push('}'),
            '[' => stack.push(']'),
            '}' | ']' => {
                if stack.last().copied() != Some(ch) {
                    return None;
                }
                stack.pop();
                if stack.is_empty() {
                    return start.map(|start_index| (start_index, index + ch.len_utf8()));
                }
            }
            _ => {}
        }
    }

    None
}

fn build_tool_argument_candidates(raw: &str) -> Vec<String> {
    let mut candidates = Vec::new();
    push_unique_candidate(&mut candidates, raw);

    let without_fence = strip_wrapping_code_fence(raw);
    push_unique_candidate(&mut candidates, without_fence);

    let without_markup = strip_tool_protocol_markup(without_fence);
    push_unique_candidate(&mut candidates, &without_markup);

    let seed_candidates = candidates.clone();
    for candidate in seed_candidates {
        if let Some((start, end)) = find_outer_json_span(&candidate) {
            push_unique_candidate(&mut candidates, &candidate[start..end]);
        }
    }

    candidates
}

fn parse_tool_arguments_candidate(candidate: &str, depth: usize) -> Option<serde_json::Value> {
    let parsed = safely_parse_json(candidate).ok()?;
    match parsed {
        Value::Object(_) => Some(parsed),
        Value::String(inner) if depth == 0 => {
            for nested_candidate in build_tool_argument_candidates(&inner) {
                if let Some(value) = parse_tool_arguments_candidate(&nested_candidate, depth + 1) {
                    return Some(value);
                }
            }
            None
        }
        _ => None,
    }
}

pub fn parse_tool_arguments_json_object(raw: &str) -> anyhow::Result<serde_json::Value> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(json!({}));
    }

    for candidate in build_tool_argument_candidates(trimmed) {
        if let Some(parsed) = parse_tool_arguments_candidate(&candidate, 0) {
            return Ok(parsed);
        }
    }

    Err(anyhow!(
        "Could not interpret tool use parameters as a JSON object"
    ))
}

/// Helper to escape control characters in a string that is supposed to be a JSON document.
/// This function iterates through the input string `s` and replaces any literal
/// control characters (U+0000 to U+001F) with their JSON-escaped equivalents
/// (e.g., '\n' becomes "\\n", '\u0001' becomes "\\u0001").
///
/// It does NOT escape quotes (") or backslashes (\) because it assumes `s` is a
/// full JSON document, and these characters might be structural (e.g., object delimiters,
/// existing valid escape sequences). The goal is to fix common LLM errors where
/// control characters are emitted raw into what should be JSON string values,
/// making the overall JSON structure unparsable.
///
/// If the input string `s` has other JSON syntax errors (e.g., an unescaped quote
/// *within* a string value like `{"key": "string with " quote"}`), this function
/// will not fix them. It specifically targets unescaped control characters.
pub fn json_escape_control_chars_in_string(s: &str) -> String {
    let mut r = String::with_capacity(s.len()); // Pre-allocate for efficiency
    for c in s.chars() {
        match c {
            // ASCII Control characters (U+0000 to U+001F)
            '\u{0000}'..='\u{001F}' => {
                match c {
                    '\u{0008}' => r.push_str("\\b"), // Backspace
                    '\u{000C}' => r.push_str("\\f"), // Form feed
                    '\n' => r.push_str("\\n"),       // Line feed
                    '\r' => r.push_str("\\r"),       // Carriage return
                    '\t' => r.push_str("\\t"),       // Tab
                    // Other control characters (e.g., NUL, SOH, VT, etc.)
                    // that don't have a specific short escape sequence.
                    _ => {
                        r.push_str(&format!("\\u{:04x}", c as u32));
                    }
                }
            }
            // Other characters are passed through.
            // This includes quotes (") and backslashes (\). If these are part of the
            // JSON structure (e.g. {"key": "value"}) or part of an already correctly
            // escaped sequence within a string value (e.g. "string with \\\" quote"),
            // they are preserved as is. This function does not attempt to fix
            // malformed quote or backslash usage *within* string values if the LLM
            // generates them incorrectly (e.g. {"key": "unescaped " quote in string"}).
            _ => r.push(c),
        }
    }
    r
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_detect_image_path() {
        // Create a temporary PNG file with valid PNG magic numbers
        let temp_dir = tempfile::tempdir().unwrap();
        let png_path = temp_dir.path().join("test.png");
        let png_data = [
            0x89, 0x50, 0x4E, 0x47, // PNG magic number
            0x0D, 0x0A, 0x1A, 0x0A, // PNG header
            0x00, 0x00, 0x00, 0x0D, // Rest of fake PNG data
        ];
        std::fs::write(&png_path, png_data).unwrap();
        let png_path_str = png_path.to_str().unwrap();

        // Create a fake PNG (wrong magic numbers)
        let fake_png_path = temp_dir.path().join("fake.png");
        std::fs::write(&fake_png_path, b"not a real png").unwrap();

        // Test with valid PNG file using absolute path
        let text = format!("Here is an image {}", png_path_str);
        assert_eq!(detect_image_path(&text), Some(png_path_str));

        // Test with non-image file that has .png extension
        let text = format!("Here is a fake image {}", fake_png_path.to_str().unwrap());
        assert_eq!(detect_image_path(&text), None);

        // Test with non-existent file
        let text = "Here is a fake.png that doesn't exist";
        assert_eq!(detect_image_path(text), None);

        // Test with non-image file
        let text = "Here is a file.txt";
        assert_eq!(detect_image_path(text), None);

        // Test with relative path (should not match)
        let text = "Here is a relative/path/image.png";
        assert_eq!(detect_image_path(text), None);
    }

    #[test]
    fn test_load_image_file() {
        // Create a temporary PNG file with valid PNG magic numbers
        let temp_dir = tempfile::tempdir().unwrap();
        let png_path = temp_dir.path().join("test.png");
        let png_data = [
            0x89, 0x50, 0x4E, 0x47, // PNG magic number
            0x0D, 0x0A, 0x1A, 0x0A, // PNG header
            0x00, 0x00, 0x00, 0x0D, // Rest of fake PNG data
        ];
        std::fs::write(&png_path, png_data).unwrap();
        let png_path_str = png_path.to_str().unwrap();

        // Create a fake PNG (wrong magic numbers)
        let fake_png_path = temp_dir.path().join("fake.png");
        std::fs::write(&fake_png_path, b"not a real png").unwrap();
        let fake_png_path_str = fake_png_path.to_str().unwrap();

        // Test loading valid PNG file
        let result = load_image_file(png_path_str);
        assert!(result.is_ok());
        let image = result.unwrap();
        assert_eq!(image.mime_type, "image/png");

        // Test loading fake PNG file
        let result = load_image_file(fake_png_path_str);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("not a valid image"));

        // Test non-existent file
        let result = load_image_file("nonexistent.png");
        assert!(result.is_err());

        // Create a GIF file with valid header bytes
        let gif_path = temp_dir.path().join("test.gif");
        // Minimal GIF89a header
        let gif_data = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
        std::fs::write(&gif_path, gif_data).unwrap();
        let gif_path_str = gif_path.to_str().unwrap();

        // Test loading unsupported GIF format
        let result = load_image_file(gif_path_str);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Unsupported image format"));
    }

    #[test]
    fn test_sanitize_function_name() {
        assert_eq!(sanitize_function_name("hello-world"), "hello-world");
        assert_eq!(sanitize_function_name("hello world"), "hello_world");
        assert_eq!(sanitize_function_name("hello@world"), "hello_world");
    }

    #[test]
    fn test_is_valid_function_name() {
        assert!(is_valid_function_name("hello-world"));
        assert!(is_valid_function_name("hello_world"));
        assert!(!is_valid_function_name("hello world"));
        assert!(!is_valid_function_name("hello@world"));
    }

    #[test]
    fn unescape_json_values_with_object() {
        let value = json!({"text": "Hello\\nWorld"});
        let unescaped_value = unescape_json_values(&value);
        assert_eq!(unescaped_value, json!({"text": "Hello\nWorld"}));
    }

    #[test]
    fn unescape_json_values_with_array() {
        let value = json!(["Hello\\nWorld", "Goodbye\\tWorld"]);
        let unescaped_value = unescape_json_values(&value);
        assert_eq!(unescaped_value, json!(["Hello\nWorld", "Goodbye\tWorld"]));
    }

    #[test]
    fn unescape_json_values_with_string() {
        let value = json!("Hello\\nWorld");
        let unescaped_value = unescape_json_values(&value);
        assert_eq!(unescaped_value, json!("Hello\nWorld"));
    }

    #[test]
    fn unescape_json_values_with_mixed_content() {
        let value = json!({
            "text": "Hello\\nWorld\\\\n!",
            "array": ["Goodbye\\tWorld", "See you\\rlater"],
            "nested": {
                "inner_text": "Inner\\\"Quote\\\""
            }
        });
        let unescaped_value = unescape_json_values(&value);
        assert_eq!(
            unescaped_value,
            json!({
                "text": "Hello\nWorld\n!",
                "array": ["Goodbye\tWorld", "See you\rlater"],
                "nested": {
                    "inner_text": "Inner\"Quote\""
                }
            })
        );
    }

    #[test]
    fn unescape_json_values_with_no_escapes() {
        let value = json!({"text": "Hello World"});
        let unescaped_value = unescape_json_values(&value);
        assert_eq!(unescaped_value, json!({"text": "Hello World"}));
    }

    #[test]
    fn test_is_google_model() {
        // Define the test cases as a vector of tuples
        let test_cases = vec![
            // (input, expected_result)
            (json!({ "model": "google_gemini" }), true),
            (json!({ "model": "microsoft_bing" }), false),
            (json!({ "model": "" }), false),
            (json!({}), false),
            (json!({ "model": "Google_XYZ" }), true),
            (json!({ "model": "google_abc" }), true),
        ];

        // Iterate through each test case and assert the result
        for (payload, expected_result) in test_cases {
            assert_eq!(is_google_model(&payload), expected_result);
        }
    }

    #[test]
    fn test_get_google_final_status_success() {
        let status = StatusCode::OK;
        let payload = json!({});
        let result = get_google_final_status(status, Some(&payload));
        assert_eq!(result, StatusCode::OK);
    }

    #[test]
    fn test_get_google_final_status_with_error_code() {
        // Test error code mappings for different payload error codes
        let test_cases = vec![
            // (error code, status, expected status code)
            (200, None, StatusCode::OK),
            (429, Some(StatusCode::OK), StatusCode::TOO_MANY_REQUESTS),
            (400, Some(StatusCode::OK), StatusCode::BAD_REQUEST),
            (401, Some(StatusCode::OK), StatusCode::UNAUTHORIZED),
            (403, Some(StatusCode::OK), StatusCode::FORBIDDEN),
            (404, Some(StatusCode::OK), StatusCode::NOT_FOUND),
            (500, Some(StatusCode::OK), StatusCode::INTERNAL_SERVER_ERROR),
            (503, Some(StatusCode::OK), StatusCode::SERVICE_UNAVAILABLE),
            (999, Some(StatusCode::OK), StatusCode::INTERNAL_SERVER_ERROR),
            (500, Some(StatusCode::BAD_REQUEST), StatusCode::BAD_REQUEST),
            (
                404,
                Some(StatusCode::INTERNAL_SERVER_ERROR),
                StatusCode::INTERNAL_SERVER_ERROR,
            ),
        ];

        for (error_code, status, expected_status) in test_cases {
            let payload = if let Some(_status) = status {
                json!({
                    "error": {
                        "code": error_code,
                        "message": "Error message"
                    }
                })
            } else {
                json!({})
            };

            let result = get_google_final_status(status.unwrap_or(StatusCode::OK), Some(&payload));
            assert_eq!(result, expected_status);
        }
    }

    #[test]
    fn test_safely_parse_json() {
        // Test valid JSON that should parse without escaping (contains proper escape sequence)
        let valid_json = r#"{"key1": "value1","key2": "value2"}"#;
        let result = safely_parse_json(valid_json).unwrap();
        assert_eq!(result["key1"], "value1");
        assert_eq!(result["key2"], "value2");

        // Test JSON with actual unescaped newlines that needs escaping
        let invalid_json = "{\"key1\": \"value1\n\",\"key2\": \"value2\"}";
        let result = safely_parse_json(invalid_json).unwrap();
        assert_eq!(result["key1"], "value1\n");
        assert_eq!(result["key2"], "value2");

        // Test already valid JSON - should parse on first try
        let good_json = r#"{"test": "value"}"#;
        let result = safely_parse_json(good_json).unwrap();
        assert_eq!(result["test"], "value");

        // Test completely invalid JSON that can't be fixed
        let broken_json = r#"{"key": "unclosed_string"#;
        assert!(safely_parse_json(broken_json).is_err());

        // Test empty object
        let empty_json = "{}";
        let result = safely_parse_json(empty_json).unwrap();
        assert!(result.as_object().unwrap().is_empty());

        // Test JSON with escaped newlines (valid JSON) - should parse on first try
        let escaped_json = r#"{"key": "value with\nnewline"}"#;
        let result = safely_parse_json(escaped_json).unwrap();
        assert_eq!(result["key"], "value with\nnewline");
    }

    #[test]
    fn test_parse_tool_arguments_json_object_with_tool_markup_suffix() {
        let raw = r#"{"command":"ls /Users/coso/Documents/dev/js/claudecode"} </tool_call>"#;
        let parsed = parse_tool_arguments_json_object(raw).unwrap();
        assert_eq!(
            parsed["command"],
            "ls /Users/coso/Documents/dev/js/claudecode"
        );
    }

    #[test]
    fn test_parse_tool_arguments_json_object_with_wrapping_tool_call_tag() {
        let raw =
            r#"<tool_call>{"command":"ls /Users/coso/Documents/dev/js/claudecode"}</tool_call>"#;
        let parsed = parse_tool_arguments_json_object(raw).unwrap();
        assert_eq!(
            parsed["command"],
            "ls /Users/coso/Documents/dev/js/claudecode"
        );
    }

    #[test]
    fn test_parse_tool_arguments_json_object_with_stringified_object() {
        let raw = r#""{\"command\":\"ls /tmp\"}""#;
        let parsed = parse_tool_arguments_json_object(raw).unwrap();
        assert_eq!(parsed["command"], "ls /tmp");
    }

    #[test]
    fn test_json_escape_control_chars_in_string() {
        // Test basic control character escaping
        assert_eq!(
            json_escape_control_chars_in_string("Hello\nWorld"),
            "Hello\\nWorld"
        );
        assert_eq!(
            json_escape_control_chars_in_string("Hello\tWorld"),
            "Hello\\tWorld"
        );
        assert_eq!(
            json_escape_control_chars_in_string("Hello\rWorld"),
            "Hello\\rWorld"
        );

        // Test multiple control characters
        assert_eq!(
            json_escape_control_chars_in_string("Hello\n\tWorld\r"),
            "Hello\\n\\tWorld\\r"
        );

        // Test that quotes and backslashes are preserved (not escaped)
        assert_eq!(
            json_escape_control_chars_in_string("Hello \"World\""),
            "Hello \"World\""
        );
        assert_eq!(
            json_escape_control_chars_in_string("Hello\\World"),
            "Hello\\World"
        );

        // Test JSON-like string with control characters
        assert_eq!(
            json_escape_control_chars_in_string("{\"message\": \"Hello\nWorld\"}"),
            "{\"message\": \"Hello\\nWorld\"}"
        );

        // Test no changes for normal strings
        assert_eq!(
            json_escape_control_chars_in_string("Hello World"),
            "Hello World"
        );

        // Test other control characters get unicode escapes
        assert_eq!(
            json_escape_control_chars_in_string("Hello\u{0001}World"),
            "Hello\\u0001World"
        );
    }

    #[test]
    fn test_parse_google_retry_delay() {
        let payload = json!({
            "error": {
                "details": [
                    {
                        "@type": "type.googleapis.com/google.rpc.RetryInfo",
                        "retryDelay": "42s"
                    }
                ]
            }
        });
        assert_eq!(
            parse_google_retry_delay(&payload),
            Some(Duration::from_secs(42))
        );
    }

    #[test]
    fn test_summarize_request_log_json_payload_compacts_anthropic_request() {
        let payload = json!({
            "model": "glm-5.1",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "对比 Claude Code 与 Lime 的 task 调度差异",
                            "cache_control": { "type": "ephemeral" }
                        },
                        {
                            "type": "image",
                            "source": { "type": "base64" }
                        }
                    ]
                }
            ],
            "system": [
                {
                    "type": "text",
                    "text": "你是一个代码助手",
                    "cache_control": { "type": "ephemeral" }
                }
            ],
            "tools": [
                { "name": "Read", "input_schema": { "type": "object" } },
                { "name": "Glob", "input_schema": { "type": "object" }, "cache_control": { "type": "ephemeral" } }
            ],
            "stream": true,
            "max_tokens": 64000
        });

        let summary = summarize_request_log_json_payload(&payload, "serde_json::Value");

        assert_eq!(summary["logging_mode"], "summary");
        assert_eq!(summary["messages"]["count"], 1);
        assert_eq!(summary["messages"]["content"]["type_counts"]["text"], 1);
        assert_eq!(summary["messages"]["content"]["type_counts"]["image"], 1);
        assert_eq!(summary["system"]["content"]["cache_control_blocks"], 1);
        assert_eq!(summary["tools"]["count"], 2);
        assert_eq!(summary["tools"]["cache_control_tools"], 1);
        assert_eq!(summary["model"]["preview"], "glm-5.1");
        assert!(summary.get("value").is_none());
    }

    #[test]
    fn test_summarize_request_log_input_for_non_json_payload_keeps_type_only() {
        #[derive(Serialize)]
        struct ExamplePayload {
            value: &'static str,
        }

        let summary = summarize_request_log_input(&ExamplePayload { value: "hello" });
        assert_eq!(summary["logging_mode"], "summary");
        assert!(summary["payload_type"]
            .as_str()
            .expect("payload_type should be a string")
            .contains("ExamplePayload"));
        assert!(summary.get("value").is_none());
    }
}
