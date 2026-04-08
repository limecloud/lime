//! Stream JSON I/O
//!
//! Provides streaming JSON input/output for CLI communication.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::io::{BufRead, Write};

/// Stream message types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StreamMessageType {
    UserMessage,
    AssistantMessage,
    ToolUse,
    ToolResult,
    Error,
    Done,
    Partial,
    System,
}

/// Base stream message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamMessage {
    pub r#type: StreamMessageType,
    pub timestamp: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

/// User message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserStreamMessage {
    pub r#type: StreamMessageType,
    pub timestamp: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<Attachment>>,
}

/// Attachment for user messages
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attachment {
    pub r#type: AttachmentType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AttachmentType {
    File,
    Image,
}

/// Assistant message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistantStreamMessage {
    pub r#type: StreamMessageType,
    pub timestamp: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_reason: Option<String>,
}

/// Tool use message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolUseStreamMessage {
    pub r#type: StreamMessageType,
    pub timestamp: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub tool_id: String,
    pub tool_name: String,
    pub input: serde_json::Value,
}

/// Tool result message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResultStreamMessage {
    pub r#type: StreamMessageType,
    pub timestamp: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub tool_id: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Partial message (streaming output)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartialStreamMessage {
    pub r#type: StreamMessageType,
    pub timestamp: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub content: String,
    pub index: usize,
}

/// Error message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorStreamMessage {
    pub r#type: StreamMessageType,
    pub timestamp: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

/// Done message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DoneStreamMessage {
    pub r#type: StreamMessageType,
    pub timestamp: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stats: Option<StreamStats>,
}

/// Stream statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamStats {
    pub input_tokens: usize,
    pub output_tokens: usize,
    pub total_cost_usd: f64,
    pub duration_ms: u64,
}

/// System message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemStreamMessage {
    pub r#type: StreamMessageType,
    pub timestamp: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub event: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

/// Union type for all stream messages
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum AnyStreamMessage {
    User(UserStreamMessage),
    Assistant(AssistantStreamMessage),
    ToolUse(ToolUseStreamMessage),
    ToolResult(ToolResultStreamMessage),
    Partial(PartialStreamMessage),
    Error(ErrorStreamMessage),
    Done(DoneStreamMessage),
    System(SystemStreamMessage),
}

impl AnyStreamMessage {
    /// Get message type
    pub fn message_type(&self) -> StreamMessageType {
        match self {
            AnyStreamMessage::User(m) => m.r#type,
            AnyStreamMessage::Assistant(m) => m.r#type,
            AnyStreamMessage::ToolUse(m) => m.r#type,
            AnyStreamMessage::ToolResult(m) => m.r#type,
            AnyStreamMessage::Partial(m) => m.r#type,
            AnyStreamMessage::Error(m) => m.r#type,
            AnyStreamMessage::Done(m) => m.r#type,
            AnyStreamMessage::System(m) => m.r#type,
        }
    }
}

/// Get current timestamp in milliseconds
fn current_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Generate a session ID
fn generate_session_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let random: u64 = rand::random();
    format!("session_{}_{:x}", timestamp, random & 0xFFFFFFFF)
}

/// Stream JSON reader
pub struct StreamJsonReader {
    buffer: VecDeque<AnyStreamMessage>,
    closed: bool,
}

impl Default for StreamJsonReader {
    fn default() -> Self {
        Self::new()
    }
}

impl StreamJsonReader {
    /// Create a new reader
    pub fn new() -> Self {
        Self {
            buffer: VecDeque::new(),
            closed: false,
        }
    }

    /// Process a line of JSON
    pub fn process_line(&mut self, line: &str) -> Option<AnyStreamMessage> {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return None;
        }

        serde_json::from_str::<AnyStreamMessage>(trimmed).ok()
    }

    /// Read from a BufRead source
    pub fn read_from<R: BufRead>(
        &mut self,
        reader: &mut R,
    ) -> std::io::Result<Option<AnyStreamMessage>> {
        let mut line = String::new();
        let bytes = reader.read_line(&mut line)?;

        if bytes == 0 {
            self.closed = true;
            return Ok(None);
        }

        Ok(self.process_line(&line))
    }

    /// Check if closed
    pub fn is_closed(&self) -> bool {
        self.closed
    }
}

/// Stream JSON writer
pub struct StreamJsonWriter<W: Write> {
    output: W,
    session_id: String,
    message_index: usize,
}

impl<W: Write> StreamJsonWriter<W> {
    /// Create a new writer
    pub fn new(output: W, session_id: Option<String>) -> Self {
        Self {
            output,
            session_id: session_id.unwrap_or_else(generate_session_id),
            message_index: 0,
        }
    }

    /// Write a raw message
    pub fn write(&mut self, message: &impl Serialize) -> std::io::Result<()> {
        let json = serde_json::to_string(message)?;
        writeln!(self.output, "{}", json)?;
        self.output.flush()
    }

    /// Write user message
    pub fn write_user_message(
        &mut self,
        content: &str,
        attachments: Option<Vec<Attachment>>,
    ) -> std::io::Result<()> {
        let msg = UserStreamMessage {
            r#type: StreamMessageType::UserMessage,
            timestamp: current_timestamp(),
            session_id: Some(self.session_id.clone()),
            content: content.to_string(),
            attachments,
        };
        self.write(&msg)
    }

    /// Write assistant message
    pub fn write_assistant_message(
        &mut self,
        content: &str,
        model: Option<&str>,
        stop_reason: Option<&str>,
    ) -> std::io::Result<()> {
        let msg = AssistantStreamMessage {
            r#type: StreamMessageType::AssistantMessage,
            timestamp: current_timestamp(),
            session_id: Some(self.session_id.clone()),
            content: content.to_string(),
            model: model.map(|s| s.to_string()),
            stop_reason: stop_reason.map(|s| s.to_string()),
        };
        self.write(&msg)
    }

    /// Write tool use
    pub fn write_tool_use(
        &mut self,
        tool_id: &str,
        tool_name: &str,
        input: serde_json::Value,
    ) -> std::io::Result<()> {
        let msg = ToolUseStreamMessage {
            r#type: StreamMessageType::ToolUse,
            timestamp: current_timestamp(),
            session_id: Some(self.session_id.clone()),
            tool_id: tool_id.to_string(),
            tool_name: tool_name.to_string(),
            input,
        };
        self.write(&msg)
    }

    /// Write tool result
    pub fn write_tool_result(
        &mut self,
        tool_id: &str,
        success: bool,
        output: Option<&str>,
        error: Option<&str>,
    ) -> std::io::Result<()> {
        let msg = ToolResultStreamMessage {
            r#type: StreamMessageType::ToolResult,
            timestamp: current_timestamp(),
            session_id: Some(self.session_id.clone()),
            tool_id: tool_id.to_string(),
            success,
            output: output.map(|s| s.to_string()),
            error: error.map(|s| s.to_string()),
        };
        self.write(&msg)
    }

    /// Write partial message
    pub fn write_partial(&mut self, content: &str) -> std::io::Result<()> {
        let msg = PartialStreamMessage {
            r#type: StreamMessageType::Partial,
            timestamp: current_timestamp(),
            session_id: Some(self.session_id.clone()),
            content: content.to_string(),
            index: self.message_index,
        };
        self.message_index += 1;
        self.write(&msg)
    }

    /// Write error
    pub fn write_error(
        &mut self,
        code: &str,
        message: &str,
        details: Option<serde_json::Value>,
    ) -> std::io::Result<()> {
        let msg = ErrorStreamMessage {
            r#type: StreamMessageType::Error,
            timestamp: current_timestamp(),
            session_id: Some(self.session_id.clone()),
            code: code.to_string(),
            message: message.to_string(),
            details,
        };
        self.write(&msg)
    }

    /// Write done
    pub fn write_done(&mut self, stats: Option<StreamStats>) -> std::io::Result<()> {
        let msg = DoneStreamMessage {
            r#type: StreamMessageType::Done,
            timestamp: current_timestamp(),
            session_id: Some(self.session_id.clone()),
            stats,
        };
        self.write(&msg)
    }

    /// Write system event
    pub fn write_system(
        &mut self,
        event: &str,
        data: Option<serde_json::Value>,
    ) -> std::io::Result<()> {
        let msg = SystemStreamMessage {
            r#type: StreamMessageType::System,
            timestamp: current_timestamp(),
            session_id: Some(self.session_id.clone()),
            event: event.to_string(),
            data,
        };
        self.write(&msg)
    }

    /// Get session ID
    pub fn session_id(&self) -> &str {
        &self.session_id
    }
}

/// Stream session handler
pub struct StreamSession<R: BufRead, W: Write> {
    reader: StreamJsonReader,
    writer: StreamJsonWriter<W>,
    input: R,
}

impl<R: BufRead, W: Write> StreamSession<R, W> {
    /// Create a new stream session
    pub fn new(input: R, output: W) -> Self {
        Self {
            reader: StreamJsonReader::new(),
            writer: StreamJsonWriter::new(output, None),
            input,
        }
    }

    /// Get the writer
    pub fn writer(&mut self) -> &mut StreamJsonWriter<W> {
        &mut self.writer
    }

    /// Read next message
    pub fn read_message(&mut self) -> std::io::Result<Option<AnyStreamMessage>> {
        self.reader.read_from(&mut self.input)
    }

    /// Start session
    pub fn start(&mut self) -> std::io::Result<()> {
        self.writer.write_system("session_start", None)
    }

    /// End session
    pub fn end(&mut self) -> std::io::Result<()> {
        self.writer.write_done(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn test_stream_message_type_serialize() {
        let msg_type = StreamMessageType::UserMessage;
        let json = serde_json::to_string(&msg_type).unwrap();
        assert_eq!(json, r#""user_message""#);
    }

    #[test]
    fn test_stream_json_reader_process_line() {
        let mut reader = StreamJsonReader::new();

        let line = r#"{"type":"user_message","timestamp":123,"content":"hello"}"#;
        let msg = reader.process_line(line);

        assert!(msg.is_some());
    }

    #[test]
    fn test_stream_json_reader_empty_line() {
        let mut reader = StreamJsonReader::new();
        assert!(reader.process_line("").is_none());
        assert!(reader.process_line("   ").is_none());
    }

    #[test]
    fn test_stream_json_writer_partial() {
        let mut buffer = Vec::new();
        {
            let mut writer = StreamJsonWriter::new(&mut buffer, Some("test_session".to_string()));
            writer.write_partial("Hello").unwrap();
        }

        let output = String::from_utf8(buffer).unwrap();
        assert!(output.contains("partial"));
        assert!(output.contains("Hello"));
    }

    #[test]
    fn test_stream_json_writer_error() {
        let mut buffer = Vec::new();
        {
            let mut writer = StreamJsonWriter::new(&mut buffer, None);
            writer.write_error("ERR001", "Test error", None).unwrap();
        }

        let output = String::from_utf8(buffer).unwrap();
        assert!(output.contains("error"));
        assert!(output.contains("ERR001"));
    }

    #[test]
    fn test_stream_json_writer_done() {
        let mut buffer = Vec::new();
        {
            let mut writer = StreamJsonWriter::new(&mut buffer, None);
            let stats = StreamStats {
                input_tokens: 100,
                output_tokens: 50,
                total_cost_usd: 0.001,
                duration_ms: 1000,
            };
            writer.write_done(Some(stats)).unwrap();
        }

        let output = String::from_utf8(buffer).unwrap();
        assert!(output.contains("done"));
        assert!(output.contains("100"));
    }

    #[test]
    fn test_stream_session() {
        let input = Cursor::new(Vec::new());
        let mut output = Vec::new();

        {
            let mut session = StreamSession::new(input, &mut output);
            session.start().unwrap();
            session.end().unwrap();
        }

        let output_str = String::from_utf8(output).unwrap();
        assert!(output_str.contains("session_start"));
        assert!(output_str.contains("done"));
    }

    #[test]
    fn test_any_stream_message_type() {
        let msg = AnyStreamMessage::Error(ErrorStreamMessage {
            r#type: StreamMessageType::Error,
            timestamp: 0,
            session_id: None,
            code: "E1".to_string(),
            message: "test".to_string(),
            details: None,
        });

        assert_eq!(msg.message_type(), StreamMessageType::Error);
    }
}
