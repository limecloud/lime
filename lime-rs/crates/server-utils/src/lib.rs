//! 服务器工具函数 crate
//!
//! 包含响应解析、字符串处理、响应构建等公共工具函数。

use axum::{
    body::Body,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use futures::stream;
use lime_core::errors::{GatewayError, GatewayErrorCode, GatewayErrorResponse};
use lime_core::models::openai::{ContentPart, FunctionCall, MessageContent, ToolCall};
use std::collections::HashMap;

/// 从错误信息中解析 HTTP 状态码
pub fn parse_error_status_code(error_message: &str) -> StatusCode {
    if error_message.contains("429") {
        StatusCode::TOO_MANY_REQUESTS
    } else if error_message.contains("403") {
        StatusCode::FORBIDDEN
    } else if error_message.contains("401") {
        StatusCode::UNAUTHORIZED
    } else if error_message.contains("404") {
        StatusCode::NOT_FOUND
    } else if error_message.contains("400") {
        StatusCode::BAD_REQUEST
    } else if error_message.contains("503") {
        StatusCode::SERVICE_UNAVAILABLE
    } else if error_message.contains("502") {
        StatusCode::BAD_GATEWAY
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    }
}

/// 构建错误响应
pub fn build_error_response(error_message: &str) -> Response {
    let status_code = parse_error_status_code(error_message);
    build_error_response_with_meta(status_code.as_u16(), error_message, None, None, None)
}

/// 从 HTTP 状态码构建错误响应
pub fn build_error_response_with_status(status_code: u16, error_message: &str) -> Response {
    build_error_response_with_meta(status_code, error_message, None, None, None)
}

/// 从 HTTP 状态码构建错误响应（带元信息）
pub fn build_error_response_with_meta(
    status_code: u16,
    error_message: &str,
    request_id: Option<&str>,
    upstream_provider: Option<&str>,
    code_override: Option<GatewayErrorCode>,
) -> Response {
    let status = StatusCode::from_u16(status_code).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let body = build_gateway_error_json(
        status_code,
        error_message,
        request_id,
        upstream_provider,
        code_override,
    );
    (status, Json(body)).into_response()
}

/// 构建统一网关错误 JSON
pub fn build_gateway_error_json(
    status_code: u16,
    error_message: &str,
    request_id: Option<&str>,
    upstream_provider: Option<&str>,
    code_override: Option<GatewayErrorCode>,
) -> serde_json::Value {
    let code = code_override.unwrap_or_else(|| GatewayErrorCode::infer(status_code, error_message));
    let error = GatewayError::new(code, error_message)
        .with_request_id(request_id)
        .with_upstream_provider(upstream_provider);
    serde_json::to_value(GatewayErrorResponse::new(error)).unwrap_or_else(|_| {
        serde_json::json!({
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "序列化错误响应失败",
                "retryable": false
            }
        })
    })
}

/// CodeWhisperer 响应解析结果
#[derive(Debug, Default)]
pub struct CWParsedResponse {
    pub content: String,
    pub tool_calls: Vec<ToolCall>,
    pub usage_credits: f64,
    pub context_usage_percentage: f64,
}

impl CWParsedResponse {
    /// 估算 Token 使用量
    #[allow(dead_code)]
    pub fn estimate_tokens(&self) -> (u32, u32) {
        let mut output_tokens: u32 = (self.content.len() / 4) as u32;
        for tc in &self.tool_calls {
            output_tokens += (tc.function.arguments.len() / 4) as u32;
        }
        let input_tokens = ((self.context_usage_percentage / 100.0) * 200000.0) as u32;
        (input_tokens, output_tokens)
    }
}

/// 安全截断字符串到指定字符数，避免 UTF-8 边界问题
pub fn safe_truncate(s: &str, max_chars: usize) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() <= max_chars {
        s.to_string()
    } else {
        chars[..max_chars].iter().collect()
    }
}

/// 计算 MessageContent 的字符长度
pub fn message_content_len(content: &MessageContent) -> usize {
    match content {
        MessageContent::Text(s) => s.len(),
        MessageContent::Parts(parts) => parts
            .iter()
            .filter_map(|p| {
                if let ContentPart::Text { text } = p {
                    Some(text.len())
                } else {
                    None
                }
            })
            .sum(),
    }
}

/// 在字节数组中查找子序列
pub fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/// 从字节数组中提取 JSON 对象字符串
pub fn extract_json_from_bytes(bytes: &[u8]) -> Option<String> {
    if bytes.is_empty() || bytes[0] != b'{' {
        return None;
    }

    let mut brace_count = 0;
    let mut in_string = false;
    let mut escape_next = false;
    let mut end_pos = None;

    for (i, &b) in bytes.iter().enumerate() {
        if escape_next {
            escape_next = false;
            continue;
        }
        match b {
            b'\\' if in_string => escape_next = true,
            b'"' => in_string = !in_string,
            b'{' if !in_string => brace_count += 1,
            b'}' if !in_string => {
                brace_count -= 1;
                if brace_count == 0 {
                    end_pos = Some(i + 1);
                    break;
                }
            }
            _ => {}
        }
    }

    end_pos.and_then(|end| String::from_utf8(bytes[..end].to_vec()).ok())
}

/// 从字符串中提取完整的 JSON 对象
#[allow(dead_code)]
pub fn extract_json_object(s: &str) -> Option<&str> {
    if !s.starts_with('{') {
        return None;
    }
    let mut brace_count = 0;
    let mut in_string = false;
    let mut escape_next = false;

    for (i, c) in s.char_indices() {
        if escape_next {
            escape_next = false;
            continue;
        }
        match c {
            '\\' if in_string => escape_next = true,
            '"' => in_string = !in_string,
            '{' if !in_string => brace_count += 1,
            '}' if !in_string => {
                brace_count -= 1;
                if brace_count == 0 {
                    return Some(&s[..=i]);
                }
            }
            _ => {}
        }
    }
    None
}

/// 解析 CodeWhisperer AWS Event Stream 响应
pub fn parse_cw_response(body: &str) -> CWParsedResponse {
    let mut result = CWParsedResponse::default();
    let mut tool_map: HashMap<String, (String, String)> = HashMap::new();
    let bytes = body.as_bytes();

    let json_patterns: &[&[u8]] = &[
        b"{\"content\":",
        b"{\"name\":",
        b"{\"input\":",
        b"{\"stop\":",
        b"{\"followupPrompt\":",
        b"{\"toolUseId\":",
        b"{\"unit\":",
        b"{\"contextUsagePercentage\":",
    ];

    let mut pos = 0;
    while pos < bytes.len() {
        let mut next_start: Option<usize> = None;

        for pattern in json_patterns {
            if let Some(idx) = find_subsequence(&bytes[pos..], pattern) {
                let abs_pos = pos + idx;
                if next_start.is_none_or(|start| abs_pos < start) {
                    next_start = Some(abs_pos);
                }
            }
        }

        let start = match next_start {
            Some(s) => s,
            None => break,
        };

        if let Some(json_str) = extract_json_from_bytes(&bytes[start..]) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&json_str) {
                if let Some(content) = value.get("content").and_then(|v| v.as_str()) {
                    if value.get("followupPrompt").is_none() {
                        result.content.push_str(content);
                    }
                } else if let Some(tool_use_id) = value.get("toolUseId").and_then(|v| v.as_str()) {
                    let name = value
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let input_chunk = value
                        .get("input")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let is_stop = value.get("stop").and_then(|v| v.as_bool()).unwrap_or(false);

                    let entry = tool_map
                        .entry(tool_use_id.to_string())
                        .or_insert_with(|| (String::new(), String::new()));
                    if !name.is_empty() {
                        entry.0 = name;
                    }
                    entry.1.push_str(&input_chunk);

                    if is_stop {
                        if let Some((name, input)) = tool_map.remove(tool_use_id) {
                            if !name.is_empty() {
                                result.tool_calls.push(ToolCall {
                                    id: tool_use_id.to_string(),
                                    call_type: "function".to_string(),
                                    function: FunctionCall {
                                        name,
                                        arguments: input,
                                    },
                                });
                            }
                        }
                    }
                } else if value.get("stop").and_then(|v| v.as_bool()).unwrap_or(false) {
                    // no-op
                } else if let Some(usage) = value.get("usage").and_then(|v| v.as_f64()) {
                    result.usage_credits = usage;
                } else if let Some(ctx_usage) =
                    value.get("contextUsagePercentage").and_then(|v| v.as_f64())
                {
                    result.context_usage_percentage = ctx_usage;
                }
            }
            pos = start + json_str.len();
        } else {
            pos = start + 1;
        }
    }

    // 处理未完成的 tool calls
    for (id, (name, input)) in tool_map {
        if !name.is_empty() {
            result.tool_calls.push(ToolCall {
                id,
                call_type: "function".to_string(),
                function: FunctionCall {
                    name,
                    arguments: input,
                },
            });
        }
    }

    parse_bracket_tool_calls(&mut result);
    result
}

/// 解析 bracket 格式的 tool calls: [Called xxx with args: {...}]
pub fn parse_bracket_tool_calls(result: &mut CWParsedResponse) {
    let re =
        regex::Regex::new(r"\[Called\s+(\w+)\s+with\s+args:\s*(\{[^}]*(?:\{[^}]*\}[^}]*)*\})\]")
            .ok();

    if let Some(re) = re {
        let mut to_remove = Vec::new();
        for cap in re.captures_iter(&result.content) {
            if let (Some(name), Some(args)) = (cap.get(1), cap.get(2)) {
                let tool_id = format!(
                    "call_{}",
                    &uuid::Uuid::new_v4().to_string().replace('-', "")[..8]
                );
                result.tool_calls.push(ToolCall {
                    id: tool_id,
                    call_type: "function".to_string(),
                    function: FunctionCall {
                        name: name.as_str().to_string(),
                        arguments: args.as_str().to_string(),
                    },
                });
                if let Some(full_match) = cap.get(0) {
                    to_remove.push(full_match.as_str().to_string());
                }
            }
        }
        for s in to_remove {
            result.content = result.content.replace(&s, "");
        }
        result.content = result.content.trim().to_string();
    }
}

/// 构建 Anthropic 非流式响应
pub fn build_anthropic_response(model: &str, parsed: &CWParsedResponse) -> Response {
    let has_tool_calls = !parsed.tool_calls.is_empty();
    let mut content_array: Vec<serde_json::Value> = Vec::new();

    if !parsed.content.is_empty() {
        content_array.push(serde_json::json!({
            "type": "text",
            "text": parsed.content
        }));
    }

    for tc in &parsed.tool_calls {
        let input: serde_json::Value =
            serde_json::from_str(&tc.function.arguments).unwrap_or(serde_json::json!({}));
        content_array.push(serde_json::json!({
            "type": "tool_use",
            "id": tc.id,
            "name": tc.function.name,
            "input": input
        }));
    }

    if content_array.is_empty() {
        content_array.push(serde_json::json!({"type": "text", "text": ""}));
    }

    let mut output_tokens: u32 = (parsed.content.len() / 4) as u32;
    for tc in &parsed.tool_calls {
        output_tokens += (tc.function.arguments.len() / 4) as u32;
    }
    let input_tokens = ((parsed.context_usage_percentage / 100.0) * 200000.0) as u32;

    let response = serde_json::json!({
        "id": format!("msg_{}", uuid::Uuid::new_v4()),
        "type": "message",
        "role": "assistant",
        "content": content_array,
        "model": model,
        "stop_reason": if has_tool_calls { "tool_use" } else { "end_turn" },
        "stop_sequence": null,
        "usage": {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens
        }
    });
    Json(response).into_response()
}

/// 构建 Anthropic 流式响应 (SSE)
pub fn build_anthropic_stream_response(model: &str, parsed: &CWParsedResponse) -> Response {
    let has_tool_calls = !parsed.tool_calls.is_empty();
    let message_id = format!("msg_{}", uuid::Uuid::new_v4());
    let model = model.to_string();
    let content = parsed.content.clone();
    let tool_calls = parsed.tool_calls.clone();

    let mut output_tokens: u32 = (parsed.content.len() / 4) as u32;
    for tc in &parsed.tool_calls {
        output_tokens += (tc.function.arguments.len() / 4) as u32;
    }
    let input_tokens = ((parsed.context_usage_percentage / 100.0) * 200000.0) as u32;

    let mut events: Vec<String> = Vec::new();

    // 1. message_start
    let message_start = serde_json::json!({
        "type": "message_start",
        "message": {
            "id": message_id, "type": "message", "role": "assistant",
            "model": model, "content": [], "stop_reason": null,
            "stop_sequence": null,
            "usage": {"input_tokens": input_tokens, "output_tokens": 0}
        }
    });
    events.push(format!("event: message_start\ndata: {message_start}\n\n"));

    let mut block_index = 0;

    // 2. 文本内容块
    let block_start = serde_json::json!({
        "type": "content_block_start", "index": block_index,
        "content_block": {"type": "text", "text": ""}
    });
    events.push(format!(
        "event: content_block_start\ndata: {block_start}\n\n"
    ));

    if !content.is_empty() {
        let block_delta = serde_json::json!({
            "type": "content_block_delta", "index": block_index,
            "delta": {"type": "text_delta", "text": content}
        });
        events.push(format!(
            "event: content_block_delta\ndata: {block_delta}\n\n"
        ));
    }

    let block_stop = serde_json::json!({"type": "content_block_stop", "index": block_index});
    events.push(format!("event: content_block_stop\ndata: {block_stop}\n\n"));
    block_index += 1;

    // 3. Tool use 块
    for tc in &tool_calls {
        let block_start = serde_json::json!({
            "type": "content_block_start", "index": block_index,
            "content_block": {
                "type": "tool_use", "id": tc.id,
                "name": tc.function.name, "input": {}
            }
        });
        events.push(format!(
            "event: content_block_start\ndata: {block_start}\n\n"
        ));

        let partial_json = if tc.function.arguments.is_empty() {
            "{}".to_string()
        } else {
            tc.function.arguments.clone()
        };
        let block_delta = serde_json::json!({
            "type": "content_block_delta", "index": block_index,
            "delta": {"type": "input_json_delta", "partial_json": partial_json}
        });
        events.push(format!(
            "event: content_block_delta\ndata: {block_delta}\n\n"
        ));

        let block_stop = serde_json::json!({"type": "content_block_stop", "index": block_index});
        events.push(format!("event: content_block_stop\ndata: {block_stop}\n\n"));
        block_index += 1;
    }

    // 4. message_delta
    let message_delta = serde_json::json!({
        "type": "message_delta",
        "delta": {
            "stop_reason": if has_tool_calls { "tool_use" } else { "end_turn" },
            "stop_sequence": null
        },
        "usage": {"output_tokens": output_tokens}
    });
    events.push(format!("event: message_delta\ndata: {message_delta}\n\n"));

    // 5. message_stop
    let message_stop = serde_json::json!({"type": "message_stop"});
    events.push(format!("event: message_stop\ndata: {message_stop}\n\n"));

    let body_stream = stream::iter(events.into_iter().map(Ok::<_, std::convert::Infallible>));
    let body = Body::from_stream(body_stream);

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-cache")
        .header(header::CONNECTION, "keep-alive")
        .body(body)
        .unwrap_or_else(|e| {
            tracing::error!("Failed to build SSE response: {}", e);
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Body::empty())
                .unwrap_or_default()
        })
}

/// 构建 Gemini CLI OAuth 请求体
pub fn build_gemini_cli_request(
    request: &serde_json::Value,
    model: &str,
    project_id: &str,
) -> serde_json::Value {
    let enable_thinking = model.ends_with("-thinking")
        || model == "gemini-2.5-pro"
        || model.starts_with("gemini-3-pro-");

    let mut inner_request = request.clone();

    if inner_request.get("generationConfig").is_none() {
        inner_request["generationConfig"] = serde_json::json!({
            "temperature": 1.0, "maxOutputTokens": 8096,
            "topP": 0.85, "topK": 50, "candidateCount": 1,
            "thinkingConfig": {
                "includeThoughts": enable_thinking,
                "thinkingBudget": if enable_thinking { 1024 } else { 0 }
            }
        });
    } else if inner_request["generationConfig"]
        .get("thinkingConfig")
        .is_none()
    {
        inner_request["generationConfig"]["thinkingConfig"] = serde_json::json!({
            "includeThoughts": enable_thinking,
            "thinkingBudget": if enable_thinking { 1024 } else { 0 }
        });
    }

    if let Some(obj) = inner_request.as_object_mut() {
        obj.remove("safetySettings");
    }

    serde_json::json!({
        "project": project_id,
        "model": model,
        "request": inner_request
    })
}

/// 构建 Gemini 原生请求体
pub fn build_gemini_native_request(
    request: &serde_json::Value,
    model: &str,
    project_id: &str,
) -> serde_json::Value {
    let actual_model = match model {
        "gemini-2.5-computer-use-preview-10-2025" => "rev19-uic3-1p",
        "gemini-3-pro-image-preview" => "gemini-3-pro-image",
        "gemini-3-pro-preview" => "gemini-3-pro-high",
        "gemini-claude-sonnet-4-5" => "claude-sonnet-4-5",
        "gemini-claude-sonnet-4-5-thinking" => "claude-sonnet-4-5-thinking",
        _ => model,
    };

    let enable_thinking = model.ends_with("-thinking")
        || model == "gemini-2.5-pro"
        || model.starts_with("gemini-3-pro-")
        || model == "rev19-uic3-1p"
        || model == "gpt-oss-120b-medium";

    let request_id = format!("agent-{}", uuid::Uuid::new_v4());
    let session_id = {
        let uuid = uuid::Uuid::new_v4();
        let bytes = uuid.as_bytes();
        let n: u64 = u64::from_le_bytes([
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        ]) % 9_000_000_000_000_000_000;
        format!("-{n}")
    };

    let mut inner_request = request.clone();
    inner_request["sessionId"] = serde_json::json!(session_id);

    if inner_request.get("generationConfig").is_none() {
        inner_request["generationConfig"] = serde_json::json!({
            "temperature": 1.0, "maxOutputTokens": 8096,
            "topP": 0.85, "topK": 50, "candidateCount": 1,
            "stopSequences": [
                "<|user|>", "<|bot|>", "<|context_request|>",
                "<|endoftext|>", "<|end_of_turn|>"
            ],
            "thinkingConfig": {
                "includeThoughts": enable_thinking,
                "thinkingBudget": if enable_thinking { 1024 } else { 0 }
            }
        });
    } else if inner_request["generationConfig"]
        .get("thinkingConfig")
        .is_none()
    {
        inner_request["generationConfig"]["thinkingConfig"] = serde_json::json!({
            "includeThoughts": enable_thinking,
            "thinkingBudget": if enable_thinking { 1024 } else { 0 }
        });
    }

    if let Some(obj) = inner_request.as_object_mut() {
        obj.remove("safetySettings");
    }

    serde_json::json!({
        "project": project_id,
        "requestId": request_id,
        "request": inner_request,
        "model": actual_model,
        "userAgent": "antigravity"
    })
}

/// 健康检查端点响应
pub async fn health() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "healthy",
        "version": env!("CARGO_PKG_VERSION")
    }))
}

/// 模型列表端点响应
pub async fn models() -> impl IntoResponse {
    Json(lime_core::config::ModelsConfig::default().model_list())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_safe_truncate() {
        assert_eq!(safe_truncate("hello", 10), "hello");
        assert_eq!(safe_truncate("hello world", 5), "hello");
        assert_eq!(safe_truncate("你好世界", 2), "你好");
    }

    #[test]
    fn test_find_subsequence() {
        let haystack = b"hello world";
        assert_eq!(find_subsequence(haystack, b"world"), Some(6));
        assert_eq!(find_subsequence(haystack, b"foo"), None);
    }

    #[test]
    fn test_extract_json_from_bytes() {
        let json = b"{\"key\":\"value\"}";
        assert_eq!(
            extract_json_from_bytes(json),
            Some("{\"key\":\"value\"}".to_string())
        );
        let nested = b"{\"outer\":{\"inner\":\"value\"}}";
        assert_eq!(
            extract_json_from_bytes(nested),
            Some("{\"outer\":{\"inner\":\"value\"}}".to_string())
        );
        assert_eq!(extract_json_from_bytes(b"not json"), None);
    }

    #[test]
    fn test_build_gateway_error_json_with_request_id() {
        let body = build_gateway_error_json(
            503,
            "No available credentials",
            Some("req_test_123"),
            Some("kiro"),
            None,
        );

        assert_eq!(
            body.get("error")
                .and_then(|e| e.get("code"))
                .and_then(|v| v.as_str()),
            Some("NO_CREDENTIALS")
        );
        assert_eq!(
            body.get("error")
                .and_then(|e| e.get("requestId"))
                .and_then(|v| v.as_str()),
            Some("req_test_123")
        );
        assert_eq!(
            body.get("error")
                .and_then(|e| e.get("upstream"))
                .and_then(|u| u.get("provider"))
                .and_then(|v| v.as_str()),
            Some("kiro")
        );
    }

    #[test]
    fn test_build_error_response_with_meta_uses_gateway_shape() {
        let response =
            build_error_response_with_meta(429, "Rate limited", Some("req_rate"), None, None);
        let (parts, body) = response.into_parts();
        assert_eq!(parts.status, StatusCode::TOO_MANY_REQUESTS);

        let rt = tokio::runtime::Runtime::new().expect("runtime");
        let bytes = rt
            .block_on(async { axum::body::to_bytes(body, usize::MAX).await })
            .expect("bytes");
        let json: serde_json::Value = serde_json::from_slice(&bytes).expect("json");

        assert_eq!(
            json.get("error")
                .and_then(|e| e.get("code"))
                .and_then(|v| v.as_str()),
            Some("RATE_LIMITED")
        );
        assert_eq!(
            json.get("error")
                .and_then(|e| e.get("requestId"))
                .and_then(|v| v.as_str()),
            Some("req_rate")
        );
    }
}

#[cfg(test)]
mod property_tests {
    use super::*;
    use axum::http::header;
    use proptest::prelude::*;

    fn arb_text_content() -> impl Strategy<Value = String> {
        "[a-zA-Z0-9 .,!?\\n]{0,500}".prop_map(|s| s)
    }

    fn arb_model_name() -> impl Strategy<Value = String> {
        prop_oneof![
            Just("claude-3-sonnet".to_string()),
            Just("claude-3-opus".to_string()),
            Just("claude-3-haiku".to_string()),
            Just("claude-sonnet-4-5".to_string()),
            Just("claude-3-5-sonnet-latest".to_string()),
        ]
    }

    fn arb_tool_call() -> impl Strategy<Value = ToolCall> {
        (
            "[a-z0-9]{8,16}",
            prop_oneof![
                Just("read_file".to_string()),
                Just("write_file".to_string()),
                Just("execute_command".to_string()),
                Just("search".to_string()),
            ],
            prop_oneof![
                Just("{}".to_string()),
                Just("{\"path\":\"/tmp/test\"}".to_string()),
                Just("{\"content\":\"hello\"}".to_string()),
                Just("{\"query\":\"test\",\"limit\":10}".to_string()),
            ],
        )
            .prop_map(|(id, name, args)| ToolCall {
                id: format!("call_{id}"),
                call_type: "function".to_string(),
                function: FunctionCall {
                    name,
                    arguments: args,
                },
            })
    }

    fn arb_cw_parsed_response() -> impl Strategy<Value = CWParsedResponse> {
        (
            arb_text_content(),
            prop::collection::vec(arb_tool_call(), 0..3),
            0.0f64..100.0f64,
            0.0f64..100.0f64,
        )
            .prop_map(
                |(content, tool_calls, usage_credits, context_usage_percentage)| CWParsedResponse {
                    content,
                    tool_calls,
                    usage_credits,
                    context_usage_percentage,
                },
            )
    }

    proptest! {
        #[test]
        fn prop_non_streaming_response_format(
            model in arb_model_name(),
            parsed in arb_cw_parsed_response()
        ) {
            let response = build_anthropic_response(&model, &parsed);
            let (parts, _body) = response.into_parts();
            prop_assert_eq!(parts.status, StatusCode::OK);

            let content_type = parts.headers.get(header::CONTENT_TYPE);
            prop_assert!(content_type.is_some());
            prop_assert!(content_type.unwrap().to_str().unwrap().contains("application/json"));
        }

        #[test]
        fn prop_non_streaming_response_empty_content(model in arb_model_name()) {
            let parsed = CWParsedResponse {
                content: String::new(), tool_calls: Vec::new(),
                usage_credits: 0.0, context_usage_percentage: 0.0,
            };
            let response = build_anthropic_response(&model, &parsed);
            let (parts, _body) = response.into_parts();
            prop_assert_eq!(parts.status, StatusCode::OK);
        }

        #[test]
        fn prop_non_streaming_response_tool_calls_only(
            model in arb_model_name(),
            tool_calls in prop::collection::vec(arb_tool_call(), 1..3)
        ) {
            let parsed = CWParsedResponse {
                content: String::new(), tool_calls,
                usage_credits: 0.0, context_usage_percentage: 50.0,
            };
            let response = build_anthropic_response(&model, &parsed);
            let (parts, _body) = response.into_parts();
            prop_assert_eq!(parts.status, StatusCode::OK);
            prop_assert!(!parsed.tool_calls.is_empty());
        }

        #[test]
        fn prop_token_estimation(
            content in arb_text_content(),
            context_percentage in 0.0f64..100.0f64
        ) {
            let parsed = CWParsedResponse {
                content: content.clone(), tool_calls: Vec::new(),
                usage_credits: 0.0, context_usage_percentage: context_percentage,
            };
            let (input_tokens, output_tokens) = parsed.estimate_tokens();
            let expected_output = (content.len() / 4) as u32;
            prop_assert_eq!(output_tokens, expected_output);
            let expected_input = ((context_percentage / 100.0) * 200000.0) as u32;
            prop_assert_eq!(input_tokens, expected_input);
        }
    }

    fn get_model_list_data() -> Vec<serde_json::Value> {
        lime_core::config::ModelsConfig::default().model_list()["data"]
            .as_array()
            .unwrap()
            .clone()
    }

    #[test]
    fn prop_model_list_structure_and_ownership() {
        let models = get_model_list_data();

        for model in &models {
            let id = model.get("id").and_then(|v| v.as_str());
            assert!(id.is_some(), "Model should have id field");
            assert!(!id.unwrap().is_empty(), "Model id should not be empty");

            let object = model.get("object").and_then(|v| v.as_str());
            assert_eq!(object, Some("model"), "Model object should be 'model'");

            let owned_by = model.get("owned_by").and_then(|v| v.as_str());
            assert!(owned_by.is_some(), "Model should have owned_by field");

            let model_id = id.unwrap();
            let owner = owned_by.unwrap();

            if model_id.starts_with("gemini-") {
                assert_eq!(owner, "google", "Gemini models should be owned by google");
            } else if model_id.starts_with("claude-") {
                assert_eq!(
                    owner, "anthropic",
                    "Claude models should be owned by anthropic"
                );
            } else if model_id.starts_with("qwen") {
                assert_eq!(owner, "alibaba", "Qwen models should be owned by alibaba");
            }
        }
    }

    #[test]
    fn model_list_has_unique_ids_and_excludes_retired_routes() {
        let models = get_model_list_data();
        let ids: Vec<_> = models
            .iter()
            .map(|model| model["id"].as_str().unwrap())
            .collect();
        let unique: std::collections::HashSet<_> = ids.iter().collect();
        assert_eq!(ids.len(), unique.len());
        assert!(!ids.iter().any(|id| id.starts_with("gemini-claude-")));
        assert!(!models
            .iter()
            .any(|model| model["owned_by"] == "claude_oauth"));
    }

    #[test]
    fn model_list_projects_enabled_configured_models() {
        use lime_core::config::{ModelInfo, ModelsConfig, ProviderModelsConfig};
        let config = ModelsConfig {
            providers: std::collections::HashMap::from([(
                "custom".to_string(),
                ProviderModelsConfig {
                    label: "Custom".to_string(),
                    models: [
                        ("z-model", true),
                        ("disabled-model", false),
                        ("a-model", true),
                        ("z-model", true),
                    ]
                    .into_iter()
                    .map(|(id, enabled)| ModelInfo {
                        id: id.to_string(),
                        name: None,
                        enabled,
                    })
                    .collect(),
                },
            )]),
            ..Default::default()
        };
        let list = config.model_list();
        let models = list["data"].as_array().unwrap();
        let ids: Vec<_> = models
            .iter()
            .map(|model| model["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, vec!["a-model", "z-model"]);
        assert!(models.iter().all(|model| model["owned_by"] == "custom"));
    }

    #[allow(dead_code)]
    fn get_expected_model_mapping(model: &str) -> &str {
        match model {
            "gemini-2.5-computer-use-preview-10-2025" => "rev19-uic3-1p",
            "gemini-3-pro-image-preview" => "gemini-3-pro-image",
            "gemini-3-pro-preview" => "gemini-3-pro-high",
            "gemini-claude-sonnet-4-5" => "claude-sonnet-4-5",
            "gemini-claude-sonnet-4-5-thinking" => "claude-sonnet-4-5-thinking",
            _ => model,
        }
    }

    #[test]
    fn prop_model_name_mapping_correctness() {
        let test_request = serde_json::json!({
            "contents": [{"role": "user", "parts": [{"text": "test"}]}]
        });
        let project_id = "test-project";

        let known_mappings = [
            ("gemini-2.5-computer-use-preview-10-2025", "rev19-uic3-1p"),
            ("gemini-3-pro-image-preview", "gemini-3-pro-image"),
            ("gemini-3-pro-preview", "gemini-3-pro-high"),
            ("gemini-claude-sonnet-4-5", "claude-sonnet-4-5"),
            (
                "gemini-claude-sonnet-4-5-thinking",
                "claude-sonnet-4-5-thinking",
            ),
        ];

        for (input, expected) in &known_mappings {
            let result = build_gemini_native_request(&test_request, input, project_id);
            let actual_model = result.get("model").and_then(|v| v.as_str()).unwrap();
            assert_eq!(
                actual_model, *expected,
                "Model {input} should map to {expected}"
            );
        }

        let unknown_models = ["gemini-2.0-flash", "gemini-2.5-flash", "custom-model"];
        for model in &unknown_models {
            let result = build_gemini_native_request(&test_request, model, project_id);
            let actual_model = result.get("model").and_then(|v| v.as_str()).unwrap();
            assert_eq!(
                actual_model, *model,
                "Unknown model {model} should be returned unchanged"
            );
        }
    }

    fn should_enable_thinking(model: &str) -> bool {
        model.ends_with("-thinking")
            || model == "gemini-2.5-pro"
            || model.starts_with("gemini-3-pro-")
            || model == "rev19-uic3-1p"
            || model == "gpt-oss-120b-medium"
    }

    #[test]
    fn prop_thinking_mode_enablement_logic() {
        let thinking_enabled_models = [
            "gemini-claude-sonnet-4-5-thinking",
            "gemini-claude-opus-4-5-thinking",
            "gemini-3-pro-preview",
            "gemini-3-pro-image-preview",
            "gemini-3-pro-high",
            "rev19-uic3-1p",
            "gpt-oss-120b-medium",
        ];

        for model in &thinking_enabled_models {
            assert!(
                should_enable_thinking(model),
                "Model {model} should have thinking enabled"
            );
        }

        let thinking_disabled_models = [
            "gemini-claude-sonnet-4-5",
            "claude-sonnet-4-5",
            "custom-model",
        ];

        for model in &thinking_disabled_models {
            assert!(
                !should_enable_thinking(model),
                "Model {model} should have thinking disabled"
            );
        }
    }

    #[test]
    fn prop_thinking_configuration_values() {
        let test_request = serde_json::json!({
            "contents": [{"role": "user", "parts": [{"text": "test"}]}]
        });
        let project_id = "test-project";

        let thinking_enabled_models = [
            "gemini-3-pro-preview",
            "gemini-2.5-pro",
            "gemini-claude-sonnet-4-5-thinking",
        ];

        for model in &thinking_enabled_models {
            let result = build_gemini_native_request(&test_request, model, project_id);
            let thinking_config = &result["request"]["generationConfig"]["thinkingConfig"];

            assert_eq!(
                thinking_config["includeThoughts"].as_bool(),
                Some(true),
                "Model {model} should have includeThoughts=true"
            );
            assert_eq!(
                thinking_config["thinkingBudget"].as_i64(),
                Some(1024),
                "Model {model} should have thinkingBudget=1024"
            );
        }

        let thinking_disabled_models = [
            "gemini-2.0-flash",
            "gemini-2.5-flash",
            "gemini-claude-sonnet-4-5",
        ];

        for model in &thinking_disabled_models {
            let result = build_gemini_native_request(&test_request, model, project_id);
            let thinking_config = &result["request"]["generationConfig"]["thinkingConfig"];

            assert_eq!(
                thinking_config["includeThoughts"].as_bool(),
                Some(false),
                "Model {model} should have includeThoughts=false"
            );
            assert_eq!(
                thinking_config["thinkingBudget"].as_i64(),
                Some(0),
                "Model {model} should have thinkingBudget=0"
            );
        }
    }
}
