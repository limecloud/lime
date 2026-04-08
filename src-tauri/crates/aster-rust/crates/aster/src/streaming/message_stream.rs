//! Enhanced Message Stream Handler
//!
//! Implements streaming message processing with delta events,
//! error handling, and abort control.
//!
//! Based on Anthropic API standard event model.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::time::{Duration, Instant};

/// 文本回调类型
pub(crate) type TextCallback = Box<dyn Fn(&str, &str) + Send + Sync>;

/// 思考回调类型
pub(crate) type ThinkingCallback = Box<dyn Fn(&str, &str) + Send + Sync>;

/// JSON 输入回调类型
pub(crate) type InputJsonCallback = Box<dyn Fn(&str, &serde_json::Value) + Send + Sync>;

/// 引用回调类型
pub(crate) type CitationCallback = Box<dyn Fn(&Citation, &[Citation]) + Send + Sync>;

/// 签名回调类型
pub(crate) type SignatureCallback = Box<dyn Fn(&str) + Send + Sync>;

/// 内容块回调类型
pub(crate) type ContentBlockCallback = Box<dyn Fn(&ContentBlock) + Send + Sync>;

/// 消息回调类型
pub(crate) type MessageCallback = Box<dyn Fn(&MessageState) + Send + Sync>;

/// 错误回调类型
pub(crate) type ErrorCallback = Box<dyn Fn(&StreamError) + Send + Sync>;

/// Anthropic API standard stream event types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StreamEventType {
    MessageStart,
    ContentBlockStart,
    ContentBlockDelta,
    ContentBlockStop,
    MessageDelta,
    MessageStop,
}

/// Delta types for content updates
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeltaType {
    TextDelta,
    ThinkingDelta,
    InputJsonDelta,
    CitationsDelta,
    SignatureDelta,
}

/// Content block types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContentBlockType {
    Text,
    Thinking,
    ToolUse,
    ServerToolUse,
    McpToolUse,
}

/// Text content block
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextContentBlock {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub citations: Option<Vec<Citation>>,
}

/// Citation reference
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Citation {
    pub r#type: String,
    pub cited_text: String,
    pub start: usize,
    pub end: usize,
}

/// Thinking content block
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThinkingContentBlock {
    pub thinking: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
}

/// Tool use content block
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolUseContentBlock {
    pub id: String,
    pub name: String,
    pub input: serde_json::Value,
    #[serde(skip)]
    json_buffer: String,
}

impl ToolUseContentBlock {
    /// Create a new tool use block
    pub fn new(id: String, name: String) -> Self {
        Self {
            id,
            name,
            input: serde_json::Value::Object(serde_json::Map::new()),
            json_buffer: String::new(),
        }
    }

    /// Append JSON delta and parse tolerantly
    pub fn append_json(&mut self, delta: &str) {
        self.json_buffer.push_str(delta);
        self.input = parse_tolerant_json(&self.json_buffer);
    }
}

/// Union content block type
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentBlock {
    Text(TextContentBlock),
    Thinking(ThinkingContentBlock),
    ToolUse(ToolUseContentBlock),
    ServerToolUse(ToolUseContentBlock),
    McpToolUse(ToolUseContentBlock),
}

impl ContentBlock {
    /// Get block type
    pub fn block_type(&self) -> ContentBlockType {
        match self {
            ContentBlock::Text(_) => ContentBlockType::Text,
            ContentBlock::Thinking(_) => ContentBlockType::Thinking,
            ContentBlock::ToolUse(_) => ContentBlockType::ToolUse,
            ContentBlock::ServerToolUse(_) => ContentBlockType::ServerToolUse,
            ContentBlock::McpToolUse(_) => ContentBlockType::McpToolUse,
        }
    }
}

/// Token usage information
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TokenUsage {
    pub input_tokens: usize,
    pub output_tokens: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_creation_input_tokens: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_read_input_tokens: Option<usize>,
}

/// Message state accumulated from stream events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageState {
    pub id: String,
    pub role: String,
    pub content: Vec<ContentBlock>,
    pub model: String,
    pub stop_reason: Option<String>,
    pub stop_sequence: Option<String>,
    pub usage: TokenUsage,
}

impl Default for MessageState {
    fn default() -> Self {
        Self {
            id: String::new(),
            role: "assistant".to_string(),
            content: Vec::new(),
            model: String::new(),
            stop_reason: None,
            stop_sequence: None,
            usage: TokenUsage::default(),
        }
    }
}

/// Stream options for timeout and abort control
#[derive(Debug, Clone)]
pub struct StreamOptions {
    pub timeout: Option<Duration>,
    pub heartbeat_interval: Option<Duration>,
    pub heartbeat_timeout: Option<Duration>,
    pub max_queue_size: usize,
}

impl Default for StreamOptions {
    fn default() -> Self {
        Self {
            timeout: None,
            heartbeat_interval: Some(Duration::from_secs(5)),
            heartbeat_timeout: Some(Duration::from_secs(30)),
            max_queue_size: 100,
        }
    }
}

/// Stream callbacks for event handling
#[derive(Default)]
pub struct StreamCallbacks {
    pub on_text: Option<TextCallback>,
    pub on_thinking: Option<ThinkingCallback>,
    pub on_input_json: Option<InputJsonCallback>,
    pub on_citation: Option<CitationCallback>,
    pub on_signature: Option<SignatureCallback>,
    pub on_content_block: Option<ContentBlockCallback>,
    pub on_message: Option<MessageCallback>,
    pub on_error: Option<ErrorCallback>,
    pub on_abort: Option<Box<dyn Fn() + Send + Sync>>,
    pub on_complete: Option<Box<dyn Fn() + Send + Sync>>,
}

/// Stream error types
#[derive(Debug, Clone)]
pub enum StreamError {
    Timeout(String),
    HeartbeatTimeout,
    Aborted,
    ParseError(String),
    InvalidState(String),
}

impl std::fmt::Display for StreamError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StreamError::Timeout(msg) => write!(f, "Stream timeout: {}", msg),
            StreamError::HeartbeatTimeout => write!(f, "Stream heartbeat timeout"),
            StreamError::Aborted => write!(f, "Stream aborted"),
            StreamError::ParseError(msg) => write!(f, "Parse error: {}", msg),
            StreamError::InvalidState(msg) => write!(f, "Invalid state: {}", msg),
        }
    }
}

impl std::error::Error for StreamError {}

/// Tolerant JSON parser that auto-fixes incomplete JSON
pub fn parse_tolerant_json(json_str: &str) -> serde_json::Value {
    let trimmed = json_str.trim();
    if trimmed.is_empty() {
        return serde_json::Value::Object(serde_json::Map::new());
    }

    // Try standard parse first
    if let Ok(value) = serde_json::from_str(trimmed) {
        return value;
    }

    // Try to fix incomplete JSON
    let mut fixed = trimmed.to_string();

    // Remove trailing commas
    fixed = fixed.replace(",]", "]").replace(",}", "}");

    // Count brackets
    let open_braces = fixed.matches('{').count();
    let close_braces = fixed.matches('}').count();
    let open_brackets = fixed.matches('[').count();
    let close_brackets = fixed.matches(']').count();
    let quotes = fixed.matches('"').count();

    // Fix unclosed quotes
    if !quotes.is_multiple_of(2) {
        fixed.push('"');
    }

    // Fix unclosed brackets
    for _ in 0..(open_brackets.saturating_sub(close_brackets)) {
        fixed.push(']');
    }

    // Fix unclosed braces
    for _ in 0..(open_braces.saturating_sub(close_braces)) {
        fixed.push('}');
    }

    // Try parsing again
    serde_json::from_str(&fixed)
        .unwrap_or_else(|_| serde_json::Value::Object(serde_json::Map::new()))
}

/// Enhanced message stream handler
pub struct EnhancedMessageStream {
    current_message: Option<MessageState>,
    messages: Vec<MessageState>,
    aborted: bool,
    ended: bool,
    error: Option<StreamError>,
    event_queue: VecDeque<serde_json::Value>,
    last_activity: Instant,
    options: StreamOptions,
    callbacks: StreamCallbacks,
}

impl EnhancedMessageStream {
    /// Create a new enhanced message stream
    pub fn new(options: StreamOptions, callbacks: StreamCallbacks) -> Self {
        Self {
            current_message: None,
            messages: Vec::new(),
            aborted: false,
            ended: false,
            error: None,
            event_queue: VecDeque::new(),
            last_activity: Instant::now(),
            options,
            callbacks,
        }
    }

    /// Create with default options
    pub fn with_defaults() -> Self {
        Self::new(StreamOptions::default(), StreamCallbacks::default())
    }

    /// Update activity timestamp
    fn update_activity(&mut self) {
        self.last_activity = Instant::now();
    }

    /// Check for heartbeat timeout
    pub fn check_heartbeat(&self) -> Result<(), StreamError> {
        if let Some(timeout) = self.options.heartbeat_timeout {
            if self.last_activity.elapsed() > timeout {
                return Err(StreamError::HeartbeatTimeout);
            }
        }
        Ok(())
    }

    /// Abort the stream
    pub fn abort(&mut self) {
        if self.aborted || self.ended {
            return;
        }

        self.aborted = true;
        self.error = Some(StreamError::Aborted);

        if let Some(ref cb) = self.callbacks.on_abort {
            cb();
        }
    }

    /// Handle a stream event
    pub fn handle_event(&mut self, event: serde_json::Value) -> Result<(), StreamError> {
        if self.aborted || self.ended {
            return Ok(());
        }

        self.update_activity();

        // Backpressure control
        if self.event_queue.len() >= self.options.max_queue_size {
            return Ok(()); // Drop event
        }

        self.event_queue.push_back(event);
        self.process_queue()
    }

    /// Process event queue
    fn process_queue(&mut self) -> Result<(), StreamError> {
        while let Some(event) = self.event_queue.pop_front() {
            if self.aborted || self.ended {
                break;
            }
            self.process_event(event)?;
        }
        Ok(())
    }

    /// Process a single event
    fn process_event(&mut self, event: serde_json::Value) -> Result<(), StreamError> {
        let event_type = event.get("type").and_then(|v| v.as_str());

        match event_type {
            Some("message_start") => self.handle_message_start(&event),
            Some("content_block_start") => self.handle_content_block_start(&event),
            Some("content_block_delta") => self.handle_content_block_delta(&event),
            Some("content_block_stop") => self.handle_content_block_stop(&event),
            Some("message_delta") => self.handle_message_delta(&event),
            Some("message_stop") => self.handle_message_stop(),
            _ => Ok(()),
        }
    }

    fn handle_message_start(&mut self, event: &serde_json::Value) -> Result<(), StreamError> {
        if let Some(message) = event.get("message") {
            let state = MessageState {
                id: message
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                role: message
                    .get("role")
                    .and_then(|v| v.as_str())
                    .unwrap_or("assistant")
                    .to_string(),
                content: Vec::new(),
                model: message
                    .get("model")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                stop_reason: None,
                stop_sequence: None,
                usage: TokenUsage::default(),
            };
            self.current_message = Some(state);
        }
        Ok(())
    }

    fn handle_content_block_start(&mut self, event: &serde_json::Value) -> Result<(), StreamError> {
        let msg = self
            .current_message
            .as_mut()
            .ok_or_else(|| StreamError::InvalidState("No current message".to_string()))?;

        if let Some(block) = event.get("content_block") {
            let block_type = block.get("type").and_then(|v| v.as_str());

            let content_block = match block_type {
                Some("text") => ContentBlock::Text(TextContentBlock {
                    text: String::new(),
                    citations: None,
                }),
                Some("thinking") => ContentBlock::Thinking(ThinkingContentBlock {
                    thinking: String::new(),
                    signature: None,
                }),
                Some("tool_use") => {
                    let id = block
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let name = block
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    ContentBlock::ToolUse(ToolUseContentBlock::new(id, name))
                }
                _ => return Ok(()),
            };

            msg.content.push(content_block);
        }
        Ok(())
    }

    fn handle_content_block_delta(&mut self, event: &serde_json::Value) -> Result<(), StreamError> {
        let msg = self
            .current_message
            .as_mut()
            .ok_or_else(|| StreamError::InvalidState("No current message".to_string()))?;

        let index = event.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
        let delta = event.get("delta");

        if index >= msg.content.len() {
            return Ok(());
        }

        let delta_type = delta.and_then(|d| d.get("type")).and_then(|v| v.as_str());

        match delta_type {
            Some("text_delta") => self.apply_text_delta(index, delta),
            Some("thinking_delta") => self.apply_thinking_delta(index, delta),
            Some("input_json_delta") => self.apply_input_json_delta(index, delta),
            Some("citations_delta") => self.apply_citations_delta(index, delta),
            Some("signature_delta") => self.apply_signature_delta(index, delta),
            _ => Ok(()),
        }
    }

    fn apply_text_delta(
        &mut self,
        index: usize,
        delta: Option<&serde_json::Value>,
    ) -> Result<(), StreamError> {
        let msg = self.current_message.as_mut().unwrap();

        if let ContentBlock::Text(ref mut block) = msg.content[index] {
            if let Some(text) = delta.and_then(|d| d.get("text")).and_then(|v| v.as_str()) {
                block.text.push_str(text);

                if let Some(ref cb) = self.callbacks.on_text {
                    cb(text, &block.text);
                }
            }
        }
        Ok(())
    }

    fn apply_thinking_delta(
        &mut self,
        index: usize,
        delta: Option<&serde_json::Value>,
    ) -> Result<(), StreamError> {
        let msg = self.current_message.as_mut().unwrap();

        if let ContentBlock::Thinking(ref mut block) = msg.content[index] {
            if let Some(thinking) = delta
                .and_then(|d| d.get("thinking"))
                .and_then(|v| v.as_str())
            {
                block.thinking.push_str(thinking);

                if let Some(ref cb) = self.callbacks.on_thinking {
                    cb(thinking, &block.thinking);
                }
            }
        }
        Ok(())
    }

    fn apply_input_json_delta(
        &mut self,
        index: usize,
        delta: Option<&serde_json::Value>,
    ) -> Result<(), StreamError> {
        let msg = self.current_message.as_mut().unwrap();

        let partial_json = delta
            .and_then(|d| d.get("partial_json"))
            .and_then(|v| v.as_str())
            .unwrap_or("");

        match &mut msg.content[index] {
            ContentBlock::ToolUse(ref mut block)
            | ContentBlock::ServerToolUse(ref mut block)
            | ContentBlock::McpToolUse(ref mut block) => {
                block.append_json(partial_json);

                if let Some(ref cb) = self.callbacks.on_input_json {
                    cb(partial_json, &block.input);
                }
            }
            _ => {}
        }
        Ok(())
    }

    fn apply_citations_delta(
        &mut self,
        index: usize,
        delta: Option<&serde_json::Value>,
    ) -> Result<(), StreamError> {
        let msg = self.current_message.as_mut().unwrap();

        if let ContentBlock::Text(ref mut block) = msg.content[index] {
            if let Some(citation_value) = delta.and_then(|d| d.get("citation")) {
                if let Ok(citation) = serde_json::from_value::<Citation>(citation_value.clone()) {
                    let citations = block.citations.get_or_insert_with(Vec::new);
                    citations.push(citation.clone());

                    if let Some(ref cb) = self.callbacks.on_citation {
                        cb(&citation, citations);
                    }
                }
            }
        }
        Ok(())
    }

    fn apply_signature_delta(
        &mut self,
        index: usize,
        delta: Option<&serde_json::Value>,
    ) -> Result<(), StreamError> {
        let msg = self.current_message.as_mut().unwrap();

        if let ContentBlock::Thinking(ref mut block) = msg.content[index] {
            if let Some(sig) = delta
                .and_then(|d| d.get("signature"))
                .and_then(|v| v.as_str())
            {
                block.signature = Some(sig.to_string());

                if let Some(ref cb) = self.callbacks.on_signature {
                    cb(sig);
                }
            }
        }
        Ok(())
    }

    fn handle_content_block_stop(&mut self, _event: &serde_json::Value) -> Result<(), StreamError> {
        if let Some(ref msg) = self.current_message {
            if let Some(block) = msg.content.last() {
                if let Some(ref cb) = self.callbacks.on_content_block {
                    cb(block);
                }
            }
        }
        Ok(())
    }

    fn handle_message_delta(&mut self, event: &serde_json::Value) -> Result<(), StreamError> {
        let msg = self
            .current_message
            .as_mut()
            .ok_or_else(|| StreamError::InvalidState("No current message".to_string()))?;

        if let Some(delta) = event.get("delta") {
            if let Some(stop_reason) = delta.get("stop_reason").and_then(|v| v.as_str()) {
                msg.stop_reason = Some(stop_reason.to_string());
            }
            if let Some(stop_seq) = delta.get("stop_sequence").and_then(|v| v.as_str()) {
                msg.stop_sequence = Some(stop_seq.to_string());
            }
        }

        if let Some(usage) = event.get("usage") {
            if let Some(output) = usage.get("output_tokens").and_then(|v| v.as_u64()) {
                msg.usage.output_tokens = output as usize;
            }
            if let Some(input) = usage.get("input_tokens").and_then(|v| v.as_u64()) {
                msg.usage.input_tokens = input as usize;
            }
        }
        Ok(())
    }

    fn handle_message_stop(&mut self) -> Result<(), StreamError> {
        if let Some(msg) = self.current_message.take() {
            if let Some(ref cb) = self.callbacks.on_message {
                cb(&msg);
            }
            self.messages.push(msg);
        }

        self.ended = true;

        if let Some(ref cb) = self.callbacks.on_complete {
            cb();
        }
        Ok(())
    }

    /// Get the final message
    pub fn get_final_message(&self) -> Option<&MessageState> {
        self.messages.last()
    }

    /// Get final text from all text blocks
    pub fn get_final_text(&self) -> String {
        self.get_final_message()
            .map(|msg| {
                msg.content
                    .iter()
                    .filter_map(|block| {
                        if let ContentBlock::Text(text_block) = block {
                            Some(text_block.text.as_str())
                        } else {
                            None
                        }
                    })
                    .collect::<Vec<_>>()
                    .join(" ")
            })
            .unwrap_or_default()
    }

    /// Get all messages
    pub fn get_messages(&self) -> &[MessageState] {
        &self.messages
    }

    /// Check if stream has ended
    pub fn is_ended(&self) -> bool {
        self.ended
    }

    /// Check if stream was aborted
    pub fn is_aborted(&self) -> bool {
        self.aborted
    }

    /// Get error if any
    pub fn get_error(&self) -> Option<&StreamError> {
        self.error.as_ref()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_tolerant_json_valid() {
        let result = parse_tolerant_json(r#"{"name": "test"}"#);
        assert_eq!(result["name"], "test");
    }

    #[test]
    fn test_parse_tolerant_json_incomplete_brace() {
        let result = parse_tolerant_json(r#"{"name": "test""#);
        assert_eq!(result["name"], "test");
    }

    #[test]
    fn test_parse_tolerant_json_incomplete_bracket() {
        let result = parse_tolerant_json(r#"[1, 2, 3"#);
        assert!(result.is_array());
    }

    #[test]
    fn test_parse_tolerant_json_trailing_comma() {
        let result = parse_tolerant_json(r#"{"a": 1,}"#);
        assert_eq!(result["a"], 1);
    }

    #[test]
    fn test_parse_tolerant_json_empty() {
        let result = parse_tolerant_json("");
        assert!(result.is_object());
    }

    #[test]
    fn test_message_state_default() {
        let state = MessageState::default();
        assert_eq!(state.role, "assistant");
        assert!(state.content.is_empty());
    }

    #[test]
    fn test_stream_options_default() {
        let opts = StreamOptions::default();
        assert!(opts.timeout.is_none());
        assert_eq!(opts.max_queue_size, 100);
    }

    #[test]
    fn test_tool_use_content_block_append_json() {
        let mut block = ToolUseContentBlock::new("id1".to_string(), "tool1".to_string());
        block.append_json(r#"{"key": "val"#);
        block.append_json(r#"ue"}"#);
        assert_eq!(block.input["key"], "value");
    }

    #[test]
    fn test_enhanced_message_stream_abort() {
        let mut stream = EnhancedMessageStream::with_defaults();
        assert!(!stream.is_aborted());

        stream.abort();
        assert!(stream.is_aborted());
    }

    #[test]
    fn test_enhanced_message_stream_handle_message_start() {
        let mut stream = EnhancedMessageStream::with_defaults();

        let event = serde_json::json!({
            "type": "message_start",
            "message": {
                "id": "msg_123",
                "role": "assistant",
                "model": "claude-3"
            }
        });

        stream.handle_event(event).unwrap();
        assert!(stream.current_message.is_some());
    }

    #[test]
    fn test_enhanced_message_stream_text_delta() {
        let mut stream = EnhancedMessageStream::with_defaults();

        // Start message
        stream
            .handle_event(serde_json::json!({
                "type": "message_start",
                "message": { "id": "msg_1", "role": "assistant", "model": "claude" }
            }))
            .unwrap();

        // Start content block
        stream
            .handle_event(serde_json::json!({
                "type": "content_block_start",
                "index": 0,
                "content_block": { "type": "text" }
            }))
            .unwrap();

        // Text delta
        stream
            .handle_event(serde_json::json!({
                "type": "content_block_delta",
                "index": 0,
                "delta": { "type": "text_delta", "text": "Hello " }
            }))
            .unwrap();

        stream
            .handle_event(serde_json::json!({
                "type": "content_block_delta",
                "index": 0,
                "delta": { "type": "text_delta", "text": "World" }
            }))
            .unwrap();

        let msg = stream.current_message.as_ref().unwrap();
        if let ContentBlock::Text(block) = &msg.content[0] {
            assert_eq!(block.text, "Hello World");
        }
    }

    #[test]
    fn test_enhanced_message_stream_complete_flow() {
        let mut stream = EnhancedMessageStream::with_defaults();

        stream
            .handle_event(serde_json::json!({
                "type": "message_start",
                "message": { "id": "msg_1", "role": "assistant", "model": "claude" }
            }))
            .unwrap();

        stream
            .handle_event(serde_json::json!({
                "type": "content_block_start",
                "index": 0,
                "content_block": { "type": "text" }
            }))
            .unwrap();

        stream
            .handle_event(serde_json::json!({
                "type": "content_block_delta",
                "index": 0,
                "delta": { "type": "text_delta", "text": "Test" }
            }))
            .unwrap();

        stream
            .handle_event(serde_json::json!({
                "type": "message_stop"
            }))
            .unwrap();

        assert!(stream.is_ended());
        assert_eq!(stream.get_final_text(), "Test");
    }
}
