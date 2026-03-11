//! Aster 事件转换器
//!
//! 将 Aster AgentEvent 转换为 Tauri 可用的事件格式
//! 用于前端实时显示流式响应

use aster::agents::AgentEvent;
use aster::conversation::message::{ActionRequiredData, Message, MessageContent};
use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::tool_io_offload::{maybe_offload_tool_arguments, maybe_offload_tool_result_payload};

const JSON_RECURSION_LIMIT: usize = 50;
const JSON_TRAVERSAL_NODE_LIMIT: usize = 4_096;
const TOOL_RESULT_MAX_TEXT_PARTS: usize = 256;
const TOOL_RESULT_MAX_OUTPUT_CHARS: usize = 16_000;
const TOOL_RESULT_MAX_IMAGES: usize = 12;
const TOOL_RESULT_TRUNCATED_NOTICE: &str = "\n\n[event_converter] 工具输出已截断";
const TOOL_RESULT_DIAG_WARN_JSON_BYTES: usize = 64 * 1024;
const TOOL_RESULT_DIAG_WARN_OUTPUT_CHARS: usize = 8_000;
const TOOL_RESULT_DIAG_WARN_IMAGE_COUNT: usize = 4;

fn enhance_execution_error_text(raw: &str) -> String {
    if !raw.contains("Execution error: No such file or directory (os error 2)") {
        return raw.to_string();
    }

    if raw.contains("排查建议：") {
        return raw.to_string();
    }

    format!(
        "{raw}\n\n排查建议：\n1) 检查工作区目录是否仍然存在（目录被移动/删除会触发该错误）。\n2) 若使用本地 CLI Provider，请确认对应命令已安装且在 PATH 中。\n3) 重启应用后重试；若仍失败，请复制该错误并附上系统信息。"
    )
}

fn dedupe_preserve_order(items: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut deduped = Vec::new();
    for item in items {
        if seen.insert(item.clone()) {
            deduped.push(item);
        }
    }
    deduped
}

#[derive(Debug, Default)]
struct TextCollectState {
    collected_chars: usize,
    truncated: bool,
}

fn truncate_chars(text: &str, max_chars: usize) -> (String, bool) {
    if max_chars == 0 {
        return (String::new(), !text.is_empty());
    }

    let mut char_count = 0usize;
    for (idx, _) in text.char_indices() {
        if char_count == max_chars {
            return (text[..idx].to_string(), true);
        }
        char_count += 1;
    }

    (text.to_string(), false)
}

fn push_non_empty_limited(
    target: &mut Vec<String>,
    value: Option<&str>,
    state: &mut TextCollectState,
) {
    let Some(raw) = value else {
        return;
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return;
    }
    if target.len() >= TOOL_RESULT_MAX_TEXT_PARTS
        || state.collected_chars >= TOOL_RESULT_MAX_OUTPUT_CHARS
    {
        state.truncated = true;
        return;
    }

    let remaining = TOOL_RESULT_MAX_OUTPUT_CHARS.saturating_sub(state.collected_chars);
    let (snippet, was_truncated) = truncate_chars(trimmed, remaining);
    if snippet.is_empty() {
        state.truncated = true;
        return;
    }

    state.collected_chars += snippet.chars().count();
    state.truncated |= was_truncated;
    target.push(snippet);
}

fn collect_tool_result_text(value: &serde_json::Value, target: &mut Vec<String>) -> bool {
    let mut stack = vec![(value, 0usize)];
    let mut visited_nodes = 0usize;
    let mut state = TextCollectState::default();

    while let Some((current, depth)) = stack.pop() {
        visited_nodes += 1;
        if visited_nodes > JSON_TRAVERSAL_NODE_LIMIT {
            state.truncated = true;
            break;
        }
        if depth >= JSON_RECURSION_LIMIT {
            state.truncated = true;
            continue;
        }

        match current {
            serde_json::Value::String(text) => {
                push_non_empty_limited(target, Some(text), &mut state);
            }
            serde_json::Value::Array(items) => {
                for item in items.iter().rev() {
                    stack.push((item, depth + 1));
                }
            }
            serde_json::Value::Object(obj) => {
                for key in ["text", "output", "stdout", "stderr", "message", "error"] {
                    push_non_empty_limited(
                        target,
                        obj.get(key).and_then(|v| v.as_str()),
                        &mut state,
                    );
                }
                if let Some(value) = obj.get("value") {
                    stack.push((value, depth + 1));
                }
                if let Some(content) = obj.get("content") {
                    stack.push((content, depth + 1));
                }
            }
            _ => {}
        }
    }

    state.truncated
}

fn extract_tool_result_text<T: serde::Serialize>(result: &T) -> String {
    if let Ok(json) = serde_json::to_value(result) {
        let mut parts = Vec::new();
        let traversal_truncated = collect_tool_result_text(&json, &mut parts);
        let deduped = dedupe_preserve_order(parts);
        if !deduped.is_empty() {
            let filtered = maybe_filter_web_content(&deduped.join("\n"));
            let (mut limited, output_truncated) =
                truncate_chars(&filtered, TOOL_RESULT_MAX_OUTPUT_CHARS);
            if traversal_truncated || output_truncated {
                limited.push_str(TOOL_RESULT_TRUNCATED_NOTICE);
            }
            return limited;
        }
    }
    String::new()
}

fn dynamic_filtering_enabled() -> bool {
    proxycast_core::tool_calling::tool_calling_dynamic_filtering_enabled()
}

fn maybe_filter_web_content(raw: &str) -> String {
    if !dynamic_filtering_enabled() {
        return raw.to_string();
    }

    let lowered = raw.to_ascii_lowercase();
    let looks_like_html =
        (lowered.contains("<html") || lowered.contains("<body") || lowered.contains("</div>"))
            && raw.len() > 4_000;
    if !looks_like_html {
        return raw.to_string();
    }

    let script_re = Regex::new(r"(?is)<script[^>]*>.*?</script>").ok();
    let style_re = Regex::new(r"(?is)<style[^>]*>.*?</style>").ok();
    let tag_re = Regex::new(r"(?is)<[^>]+>").ok();
    let space_re = Regex::new(r"[ \t]{2,}").ok();
    let newline_re = Regex::new(r"\n{3,}").ok();

    let mut cleaned = raw.to_string();
    if let Some(re) = script_re.as_ref() {
        cleaned = re.replace_all(&cleaned, " ").to_string();
    }
    if let Some(re) = style_re.as_ref() {
        cleaned = re.replace_all(&cleaned, " ").to_string();
    }
    if let Some(re) = tag_re.as_ref() {
        cleaned = re.replace_all(&cleaned, "\n").to_string();
    }
    if let Some(re) = space_re.as_ref() {
        cleaned = re.replace_all(&cleaned, " ").to_string();
    }
    if let Some(re) = newline_re.as_ref() {
        cleaned = re.replace_all(&cleaned, "\n\n").to_string();
    }
    cleaned = cleaned
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n");

    const MAX_FILTERED_CHARS: usize = 8_000;
    if cleaned.chars().count() > MAX_FILTERED_CHARS {
        let shortened = cleaned.chars().take(MAX_FILTERED_CHARS).collect::<String>();
        return format!(
            "{}\n\n[dynamic_filtering] 内容已裁剪，原始长度 {} 字符",
            shortened,
            cleaned.chars().count()
        );
    }

    cleaned
}

#[derive(Debug, Clone)]
struct ExtractedToolResult {
    output: String,
    images: Vec<TauriToolImage>,
    diagnostics: ToolResultDiagnostics,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct ToolResultDiagnostics {
    raw_json_bytes: Option<usize>,
    output_chars: usize,
    image_count: usize,
    text_truncated: bool,
    images_truncated: bool,
}

fn log_tool_result_diagnostics(tool_id: &str, diagnostics: &ToolResultDiagnostics) {
    let raw_json_bytes = diagnostics.raw_json_bytes.unwrap_or(0);
    let should_warn = diagnostics.text_truncated
        || diagnostics.images_truncated
        || raw_json_bytes >= TOOL_RESULT_DIAG_WARN_JSON_BYTES
        || diagnostics.output_chars >= TOOL_RESULT_DIAG_WARN_OUTPUT_CHARS
        || diagnostics.image_count >= TOOL_RESULT_DIAG_WARN_IMAGE_COUNT;

    if should_warn {
        tracing::warn!(
            "[AsterAgent][Diag] tool_end payload summary: tool_id={}, raw_json_bytes={}, output_chars={}, image_count={}, text_truncated={}, images_truncated={}",
            tool_id,
            raw_json_bytes,
            diagnostics.output_chars,
            diagnostics.image_count,
            diagnostics.text_truncated,
            diagnostics.images_truncated
        );
    } else {
        tracing::debug!(
            "[AsterAgent][Diag] tool_end payload summary: tool_id={}, raw_json_bytes={}, output_chars={}, image_count={}",
            tool_id,
            raw_json_bytes,
            diagnostics.output_chars,
            diagnostics.image_count
        );
    }
}

fn parse_mime_type_from_data_url(data_url: &str) -> Option<String> {
    let normalized = data_url.trim();
    if !normalized.starts_with("data:image/") {
        return None;
    }

    let comma_index = normalized.find(',')?;
    let meta = &normalized[5..comma_index];
    let mut parts = meta.split(';');
    let mime_type = parts.next()?.trim();
    if mime_type.starts_with("image/") {
        Some(mime_type.to_string())
    } else {
        None
    }
}

fn build_tool_image_from_data_url(raw: &str, origin: &str) -> Option<TauriToolImage> {
    let normalized = raw.trim();
    if !normalized.starts_with("data:image/") {
        return None;
    }

    let comma_index = normalized.find(',')?;
    let meta = &normalized[..comma_index];
    if !meta.to_ascii_lowercase().contains(";base64") {
        return None;
    }

    Some(TauriToolImage {
        src: normalized.to_string(),
        mime_type: parse_mime_type_from_data_url(normalized),
        origin: Some(origin.to_string()),
    })
}

fn extract_data_urls_from_text(text: &str) -> Vec<String> {
    const PREFIX: &str = "data:image/";
    let mut urls = Vec::new();
    let mut offset = 0usize;

    while offset < text.len() {
        let Some(relative_start) = text[offset..].find(PREFIX) else {
            break;
        };
        let start = offset + relative_start;
        let slice = &text[start..];

        let end = slice
            .char_indices()
            .find_map(|(idx, ch)| {
                if ch.is_whitespace()
                    || ch == '"'
                    || ch == '\''
                    || ch == ')'
                    || ch == ']'
                    || ch == '>'
                    || ch == '<'
                {
                    Some(idx)
                } else {
                    None
                }
            })
            .unwrap_or(slice.len());

        let candidate = slice[..end].trim_end_matches(['.', ',', ';']);
        if candidate.starts_with(PREFIX) {
            urls.push(candidate.to_string());
        }

        if end == 0 {
            break;
        }
        offset = start + end;
    }

    urls
}

fn push_tool_image_if_new(
    target: &mut Vec<TauriToolImage>,
    seen_sources: &mut std::collections::HashSet<String>,
    candidate: Option<TauriToolImage>,
) {
    if let Some(image) = candidate {
        if seen_sources.insert(image.src.clone()) {
            target.push(image);
        }
    }
}

fn collect_tool_result_images(
    value: &serde_json::Value,
    target: &mut Vec<TauriToolImage>,
    seen_sources: &mut std::collections::HashSet<String>,
) -> bool {
    let mut stack = vec![(value, 0usize)];
    let mut visited_nodes = 0usize;
    let mut truncated = false;

    while let Some((current, depth)) = stack.pop() {
        visited_nodes += 1;
        if visited_nodes > JSON_TRAVERSAL_NODE_LIMIT {
            truncated = true;
            break;
        }
        if depth >= JSON_RECURSION_LIMIT {
            truncated = true;
            continue;
        }
        if target.len() >= TOOL_RESULT_MAX_IMAGES {
            truncated = true;
            break;
        }

        match current {
            serde_json::Value::String(text) => {
                for data_url in extract_data_urls_from_text(text) {
                    if target.len() >= TOOL_RESULT_MAX_IMAGES {
                        truncated = true;
                        break;
                    }
                    push_tool_image_if_new(
                        target,
                        seen_sources,
                        build_tool_image_from_data_url(&data_url, "data_url"),
                    );
                }
            }
            serde_json::Value::Array(items) => {
                for item in items.iter().rev() {
                    stack.push((item, depth + 1));
                }
            }
            serde_json::Value::Object(obj) => {
                for key in ["image_url", "url", "data"] {
                    if target.len() >= TOOL_RESULT_MAX_IMAGES {
                        truncated = true;
                        break;
                    }
                    if let Some(serde_json::Value::String(raw)) = obj.get(key) {
                        push_tool_image_if_new(
                            target,
                            seen_sources,
                            build_tool_image_from_data_url(raw, "tool_payload"),
                        );
                    }
                }
                for nested in obj.values() {
                    stack.push((nested, depth + 1));
                }
            }
            _ => {}
        }
    }

    truncated
}

fn extract_tool_result_data<T: serde::Serialize>(result: &T) -> ExtractedToolResult {
    let output = extract_tool_result_text(result);
    let mut images = Vec::new();
    let mut seen_sources = std::collections::HashSet::new();
    let mut raw_json_bytes = None;
    let mut images_truncated = false;

    for data_url in extract_data_urls_from_text(&output) {
        push_tool_image_if_new(
            &mut images,
            &mut seen_sources,
            build_tool_image_from_data_url(&data_url, "data_url"),
        );
    }

    if let Ok(json) = serde_json::to_value(result) {
        raw_json_bytes = serde_json::to_vec(&json).ok().map(|bytes| bytes.len());
        images_truncated = collect_tool_result_images(&json, &mut images, &mut seen_sources);
    }

    let output_chars = output.chars().count();
    let image_count = images.len();
    let text_truncated = output.contains(TOOL_RESULT_TRUNCATED_NOTICE);

    ExtractedToolResult {
        output,
        images,
        diagnostics: ToolResultDiagnostics {
            raw_json_bytes,
            output_chars,
            image_count,
            text_truncated,
            images_truncated,
        },
    }
}

fn extract_tool_result_metadata<T: serde::Serialize>(
    result: &T,
) -> Option<std::collections::HashMap<String, serde_json::Value>> {
    fn find_metadata(
        value: &serde_json::Value,
        depth: usize,
    ) -> Option<std::collections::HashMap<String, serde_json::Value>> {
        if depth >= JSON_RECURSION_LIMIT {
            return None;
        }

        let object = value.as_object()?;

        for key in [
            "metadata",
            "meta",
            "structured_content",
            "structuredContent",
        ] {
            let Some(nested) = object.get(key) else {
                continue;
            };

            if let Some(record) = nested.as_object() {
                if !record.is_empty() {
                    return Some(
                        record
                            .iter()
                            .map(|(key, value)| (key.clone(), value.clone()))
                            .collect(),
                    );
                }
            }

            if let Some(found) = find_metadata(nested, depth + 1) {
                return Some(found);
            }
        }

        for nested in object.values() {
            if let Some(found) = find_metadata(nested, depth + 1) {
                return Some(found);
            }
        }

        None
    }

    serde_json::to_value(result)
        .ok()
        .and_then(|value| find_metadata(&value, 0))
}

/// Tauri Agent 事件
///
/// 用于前端消费的事件格式，与现有的 StreamEvent 兼容
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum TauriAgentEvent {
    /// 文本增量
    #[serde(rename = "text_delta")]
    TextDelta { text: String },

    /// 思考内容增量
    #[serde(rename = "thinking_delta")]
    ThinkingDelta { text: String },

    /// 工具调用开始
    #[serde(rename = "tool_start")]
    ToolStart {
        tool_name: String,
        tool_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        arguments: Option<String>,
    },

    /// 工具调用结束
    #[serde(rename = "tool_end")]
    ToolEnd {
        tool_id: String,
        result: TauriToolResult,
    },

    /// 需要用户操作（权限确认、用户输入等）
    #[serde(rename = "action_required")]
    ActionRequired {
        request_id: String,
        action_type: String,
        data: serde_json::Value,
    },

    /// 模型变更
    #[serde(rename = "model_change")]
    ModelChange { model: String, mode: String },

    /// 上下文准备轨迹
    #[serde(rename = "context_trace")]
    ContextTrace { steps: Vec<TauriContextTraceStep> },

    /// 完成（单次响应完成）
    #[serde(rename = "done")]
    Done {
        #[serde(skip_serializing_if = "Option::is_none")]
        usage: Option<TauriTokenUsage>,
    },

    /// 最终完成（整个对话完成）
    #[serde(rename = "final_done")]
    FinalDone {
        #[serde(skip_serializing_if = "Option::is_none")]
        usage: Option<TauriTokenUsage>,
    },

    /// 错误
    #[serde(rename = "error")]
    Error { message: String },

    /// 告警（不中断流程）
    #[serde(rename = "warning")]
    Warning {
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        message: String,
    },

    /// 完整消息（用于历史记录）
    #[serde(rename = "message")]
    Message { message: TauriMessage },
}

/// 工具执行结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TauriToolImage {
    pub src: String,
    #[serde(rename = "mimeType", skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
}

/// 工具执行结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TauriToolResult {
    pub success: bool,
    pub output: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<TauriToolImage>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<std::collections::HashMap<String, serde_json::Value>>,
}

/// Token 使用量
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TauriTokenUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
}

/// 上下文准备轨迹步骤
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TauriContextTraceStep {
    pub stage: String,
    pub detail: String,
}

/// 简化的消息结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TauriMessage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub role: String,
    pub content: Vec<TauriMessageContent>,
    pub timestamp: i64,
}

/// 简化的消息内容
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum TauriMessageContent {
    #[serde(rename = "text")]
    Text { text: String },

    #[serde(rename = "thinking")]
    Thinking { text: String },

    #[serde(rename = "tool_request")]
    ToolRequest {
        id: String,
        tool_name: String,
        arguments: serde_json::Value,
    },

    #[serde(rename = "tool_response")]
    ToolResponse {
        id: String,
        success: bool,
        output: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        images: Option<Vec<TauriToolImage>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        metadata: Option<std::collections::HashMap<String, serde_json::Value>>,
    },

    #[serde(rename = "action_required")]
    ActionRequired {
        id: String,
        action_type: String,
        data: serde_json::Value,
    },

    #[serde(rename = "image")]
    Image { mime_type: String, data: String },
}

/// 将 Aster AgentEvent 转换为 TauriAgentEvent 列表
///
/// 一个 AgentEvent 可能产生多个 TauriAgentEvent
pub fn convert_agent_event(event: AgentEvent) -> Vec<TauriAgentEvent> {
    match event {
        AgentEvent::Message(message) => convert_message(message),
        AgentEvent::McpNotification((server_name, notification)) => {
            // MCP 通知暂时忽略或转换为日志
            tracing::debug!("MCP notification from {}: {:?}", server_name, notification);
            vec![]
        }
        AgentEvent::ModelChange { model, mode } => {
            vec![TauriAgentEvent::ModelChange { model, mode }]
        }
        AgentEvent::HistoryReplaced(_conversation) => vec![TauriAgentEvent::ContextTrace {
            steps: vec![TauriContextTraceStep {
                stage: "context_management".to_string(),
                detail: "会话历史已自动压缩，以继续当前对话。".to_string(),
            }],
        }],
        AgentEvent::ContextTrace { steps } => vec![TauriAgentEvent::ContextTrace {
            steps: steps
                .into_iter()
                .map(|step| TauriContextTraceStep {
                    stage: step.stage,
                    detail: step.detail,
                })
                .collect(),
        }],
    }
}

/// 将 Aster Message 转换为 TauriAgentEvent 列表
fn convert_message(message: Message) -> Vec<TauriAgentEvent> {
    let mut events = Vec::new();

    for content in &message.content {
        match content {
            MessageContent::Text(text_content) => {
                events.push(TauriAgentEvent::TextDelta {
                    text: enhance_execution_error_text(&text_content.text),
                });
            }
            MessageContent::Thinking(thinking) => {
                events.push(TauriAgentEvent::ThinkingDelta {
                    text: thinking.thinking.clone(),
                });
            }
            MessageContent::ToolRequest(tool_request) => match &tool_request.tool_call {
                Ok(call) => {
                    let arguments_value = serde_json::to_value(&call.arguments).unwrap_or_default();
                    events.push(TauriAgentEvent::ToolStart {
                        tool_name: call.name.to_string(),
                        tool_id: tool_request.id.clone(),
                        arguments: serde_json::to_string(&maybe_offload_tool_arguments(
                            &tool_request.id,
                            &arguments_value,
                        ))
                        .ok(),
                    });
                }
                Err(e) => {
                    events.push(TauriAgentEvent::Error {
                        message: format!("Invalid tool call: {e}"),
                    });
                }
            },
            MessageContent::ToolResponse(tool_response) => {
                let (success, output, error, images, metadata) = match &tool_response.tool_result {
                    Ok(result) => {
                        let extracted = extract_tool_result_data(result);
                        log_tool_result_diagnostics(&tool_response.id, &extracted.diagnostics);
                        let offloaded = maybe_offload_tool_result_payload(
                            &tool_response.id,
                            &extracted.output,
                            result,
                            extract_tool_result_metadata(result),
                        );
                        (
                            true,
                            offloaded.output,
                            None,
                            if extracted.images.is_empty() {
                                None
                            } else {
                                Some(extracted.images)
                            },
                            if offloaded.metadata.is_empty() {
                                None
                            } else {
                                Some(offloaded.metadata)
                            },
                        )
                    }
                    Err(e) => (false, String::new(), Some(e.to_string()), None, None),
                };

                events.push(TauriAgentEvent::ToolEnd {
                    tool_id: tool_response.id.clone(),
                    result: TauriToolResult {
                        success,
                        output,
                        error,
                        images,
                        metadata,
                    },
                });
            }
            MessageContent::ActionRequired(action_required) => {
                let (request_id, action_type, data) = match &action_required.data {
                    ActionRequiredData::ToolConfirmation {
                        id,
                        tool_name,
                        arguments,
                        prompt,
                    } => (
                        id.clone(),
                        "tool_confirmation".to_string(),
                        serde_json::json!({
                            "tool_name": tool_name,
                            "arguments": arguments,
                            "prompt": prompt,
                        }),
                    ),
                    ActionRequiredData::Elicitation {
                        id,
                        message,
                        requested_schema,
                    } => (
                        id.clone(),
                        "elicitation".to_string(),
                        serde_json::json!({
                            "message": message,
                            "requested_schema": requested_schema,
                        }),
                    ),
                    ActionRequiredData::ElicitationResponse { id, user_data } => (
                        id.clone(),
                        "elicitation_response".to_string(),
                        serde_json::json!({
                            "user_data": user_data,
                        }),
                    ),
                };

                events.push(TauriAgentEvent::ActionRequired {
                    request_id,
                    action_type,
                    data,
                });
            }
            MessageContent::SystemNotification(notification) => {
                // 系统通知转换为文本
                events.push(TauriAgentEvent::TextDelta {
                    text: notification.msg.clone(),
                });
            }
            MessageContent::Image(image) => {
                // 图片内容暂时忽略
                tracing::debug!("Image content: {}", image.mime_type);
            }
            MessageContent::ToolConfirmationRequest(req) => {
                events.push(TauriAgentEvent::ActionRequired {
                    request_id: req.id.clone(),
                    action_type: "tool_confirmation".to_string(),
                    data: serde_json::json!({
                        "tool_name": req.tool_name,
                        "arguments": req.arguments,
                        "prompt": req.prompt,
                    }),
                });
            }
            MessageContent::FrontendToolRequest(req) => match &req.tool_call {
                Ok(call) => {
                    events.push(TauriAgentEvent::ToolStart {
                        tool_name: call.name.to_string(),
                        tool_id: req.id.clone(),
                        arguments: serde_json::to_string(&call.arguments).ok(),
                    });
                }
                Err(e) => {
                    events.push(TauriAgentEvent::Error {
                        message: format!("Invalid frontend tool call: {e}"),
                    });
                }
            },
            MessageContent::RedactedThinking(_) => {
                // 隐藏的思考内容，忽略
            }
        }
    }

    events
}

/// 将 Aster Message 转换为 TauriMessage
pub fn convert_to_tauri_message(message: &Message) -> TauriMessage {
    let content = message
        .content
        .iter()
        .filter_map(convert_message_content)
        .collect();

    TauriMessage {
        id: message.id.clone(),
        role: format!("{:?}", message.role).to_lowercase(),
        content,
        timestamp: message.created,
    }
}

/// 将 MessageContent 转换为 TauriMessageContent
fn convert_message_content(content: &MessageContent) -> Option<TauriMessageContent> {
    match content {
        MessageContent::Text(text) => Some(TauriMessageContent::Text {
            text: text.text.clone(),
        }),
        MessageContent::Thinking(thinking) => Some(TauriMessageContent::Thinking {
            text: thinking.thinking.clone(),
        }),
        MessageContent::ToolRequest(req) => req.tool_call.as_ref().ok().map(|call| {
            let arguments_value = serde_json::to_value(&call.arguments).unwrap_or_default();
            TauriMessageContent::ToolRequest {
                id: req.id.clone(),
                tool_name: call.name.to_string(),
                arguments: maybe_offload_tool_arguments(&req.id, &arguments_value),
            }
        }),
        MessageContent::ToolResponse(resp) => {
            let (success, output, error, images, metadata) = match &resp.tool_result {
                Ok(result) => {
                    let extracted = extract_tool_result_data(result);
                    let offloaded = maybe_offload_tool_result_payload(
                        &resp.id,
                        &extracted.output,
                        result,
                        extract_tool_result_metadata(result),
                    );
                    (
                        true,
                        offloaded.output,
                        None,
                        if extracted.images.is_empty() {
                            None
                        } else {
                            Some(extracted.images)
                        },
                        if offloaded.metadata.is_empty() {
                            None
                        } else {
                            Some(offloaded.metadata)
                        },
                    )
                }
                Err(e) => (false, String::new(), Some(e.to_string()), None, None),
            };
            Some(TauriMessageContent::ToolResponse {
                id: resp.id.clone(),
                success,
                output,
                error,
                images,
                metadata,
            })
        }
        MessageContent::ActionRequired(action) => {
            let (id, action_type, data) = match &action.data {
                ActionRequiredData::ToolConfirmation {
                    id,
                    tool_name,
                    arguments,
                    prompt,
                } => (
                    id.clone(),
                    "tool_confirmation".to_string(),
                    serde_json::json!({
                        "tool_name": tool_name,
                        "arguments": arguments,
                        "prompt": prompt,
                    }),
                ),
                ActionRequiredData::Elicitation {
                    id,
                    message,
                    requested_schema,
                } => (
                    id.clone(),
                    "elicitation".to_string(),
                    serde_json::json!({
                        "message": message,
                        "requested_schema": requested_schema,
                    }),
                ),
                ActionRequiredData::ElicitationResponse { id, user_data } => (
                    id.clone(),
                    "elicitation_response".to_string(),
                    user_data.clone(),
                ),
            };
            Some(TauriMessageContent::ActionRequired {
                id,
                action_type,
                data,
            })
        }
        MessageContent::Image(image) => Some(TauriMessageContent::Image {
            mime_type: image.mime_type.clone(),
            data: image.data.clone(),
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_convert_text_delta() {
        let message = Message::assistant().with_text("Hello, world!");
        let events = convert_message(message);

        assert_eq!(events.len(), 1);
        match &events[0] {
            TauriAgentEvent::TextDelta { text } => {
                assert_eq!(text, "Hello, world!");
            }
            _ => panic!("Expected TextDelta event"),
        }
    }

    #[test]
    fn test_convert_model_change() {
        let event = AgentEvent::ModelChange {
            model: "claude-3".to_string(),
            mode: "chat".to_string(),
        };
        let events = convert_agent_event(event);

        assert_eq!(events.len(), 1);
        match &events[0] {
            TauriAgentEvent::ModelChange { model, mode } => {
                assert_eq!(model, "claude-3");
                assert_eq!(mode, "chat");
            }
            _ => panic!("Expected ModelChange event"),
        }
    }

    #[test]
    fn test_convert_context_trace() {
        let event = AgentEvent::ContextTrace {
            steps: vec![aster::context::ContextTraceStep {
                stage: "memory_injection".to_string(),
                detail: "query_len=10,injected=2".to_string(),
            }],
        };

        let events = convert_agent_event(event);
        assert_eq!(events.len(), 1);
        match &events[0] {
            TauriAgentEvent::ContextTrace { steps } => {
                assert_eq!(steps.len(), 1);
                assert_eq!(steps[0].stage, "memory_injection");
                assert_eq!(steps[0].detail, "query_len=10,injected=2");
            }
            _ => panic!("Expected ContextTrace event"),
        }
    }

    #[test]
    fn test_convert_history_replaced_to_context_management_trace() {
        let event = AgentEvent::HistoryReplaced(aster::conversation::Conversation::empty());

        let events = convert_agent_event(event);
        assert_eq!(events.len(), 1);
        match &events[0] {
            TauriAgentEvent::ContextTrace { steps } => {
                assert_eq!(steps.len(), 1);
                assert_eq!(steps[0].stage, "context_management");
                assert!(steps[0].detail.contains("自动压缩"));
            }
            _ => panic!("Expected ContextTrace event"),
        }
    }

    #[test]
    fn test_extract_tool_result_text_should_handle_nested_content_and_error() {
        let payload = serde_json::json!({
            "status": "success",
            "value": {
                "content": [
                    { "type": "text", "text": "任务已启动" },
                    { "type": "text", "text": "任务 ID: 123" }
                ]
            }
        });
        let text = extract_tool_result_text(&payload);
        assert!(text.contains("任务已启动"));
        assert!(text.contains("任务 ID: 123"));

        let error_payload = serde_json::json!({
            "status": "error",
            "error": "-32603: Tool not found"
        });
        let error_text = extract_tool_result_text(&error_payload);
        assert_eq!(error_text, "-32603: Tool not found");
    }

    #[test]
    fn test_extract_tool_result_data_extracts_image_data_url_from_text() {
        let payload = serde_json::json!({
            "content": [
                {
                    "type": "text",
                    "text": "图片如下 data:image/png;base64,aGVsbG8= 结束"
                }
            ]
        });

        let extracted = extract_tool_result_data(&payload);
        assert_eq!(
            extracted.output,
            "图片如下 data:image/png;base64,aGVsbG8= 结束"
        );
        assert_eq!(extracted.images.len(), 1);
        assert_eq!(extracted.images[0].src, "data:image/png;base64,aGVsbG8=");
        assert_eq!(extracted.images[0].mime_type.as_deref(), Some("image/png"));
    }

    #[test]
    fn test_extract_tool_result_data_should_dedupe_same_image() {
        let payload = serde_json::json!({
            "content": [
                {
                    "type": "text",
                    "text": "data:image/png;base64,aGVsbG8="
                },
                {
                    "type": "text",
                    "text": "重复 data:image/png;base64,aGVsbG8="
                }
            ]
        });

        let extracted = extract_tool_result_data(&payload);
        assert_eq!(extracted.images.len(), 1);
        assert_eq!(extracted.images[0].src, "data:image/png;base64,aGVsbG8=");
    }

    #[test]
    fn test_maybe_filter_web_content_should_strip_html_noise() {
        let html = format!(
            "<html><head><style>body{{color:red}}</style><script>alert(1)</script></head><body>{}</body></html>",
            "正文".repeat(2500)
        );
        let filtered = maybe_filter_web_content(&html);
        assert!(!filtered.to_ascii_lowercase().contains("<html"));
        assert!(!filtered.to_ascii_lowercase().contains("<script"));
        assert!(filtered.contains("正文"));
    }

    #[test]
    fn test_extract_tool_result_text_should_stop_on_excessive_depth() {
        let mut nested = serde_json::json!({ "text": "不会到达" });
        for _ in 0..(JSON_RECURSION_LIMIT + 10) {
            nested = serde_json::json!({ "value": nested });
        }

        let text = extract_tool_result_text(&nested);
        assert_eq!(text, "");
    }

    #[test]
    fn test_extract_tool_result_text_should_truncate_large_payload() {
        let payload = serde_json::json!({
            "content": [
                {
                    "type": "text",
                    "text": "A".repeat(TOOL_RESULT_MAX_OUTPUT_CHARS + 128)
                }
            ]
        });

        let text = extract_tool_result_text(&payload);
        assert!(text.contains("[event_converter] 工具输出已截断"));
        assert!(text.chars().count() <= TOOL_RESULT_MAX_OUTPUT_CHARS + 64);
    }

    #[test]
    fn test_extract_tool_result_data_should_limit_image_count() {
        let payload = serde_json::json!({
            "images": (0..(TOOL_RESULT_MAX_IMAGES + 4))
                .map(|index| {
                    serde_json::json!({
                        "data": format!("data:image/png;base64,image{index}")
                    })
                })
                .collect::<Vec<_>>()
        });

        let extracted = extract_tool_result_data(&payload);
        assert_eq!(extracted.images.len(), TOOL_RESULT_MAX_IMAGES);
        assert!(extracted.diagnostics.images_truncated);
    }

    #[test]
    fn test_extract_tool_result_data_should_record_diagnostics() {
        let payload = serde_json::json!({
            "content": [
                {
                    "type": "text",
                    "text": "hello"
                }
            ]
        });

        let extracted = extract_tool_result_data(&payload);
        assert_eq!(extracted.diagnostics.output_chars, 5);
        assert_eq!(extracted.diagnostics.image_count, 0);
        assert_eq!(extracted.diagnostics.text_truncated, false);
        assert!(extracted.diagnostics.raw_json_bytes.is_some());
    }

    #[test]
    fn test_extract_tool_result_metadata_should_read_meta_object() {
        let payload = serde_json::json!({
            "content": [
                {
                    "type": "text",
                    "text": "任务已完成"
                }
            ],
            "meta": {
                "exit_code": 1,
                "output_file": "/tmp/aster_tasks/task-1.log"
            }
        });

        let metadata = extract_tool_result_metadata(&payload).expect("metadata should exist");
        assert_eq!(metadata.get("exit_code"), Some(&serde_json::json!(1)));
        assert_eq!(
            metadata.get("output_file"),
            Some(&serde_json::json!("/tmp/aster_tasks/task-1.log"))
        );
    }
}
