//! Server-Sent Events (SSE) Parser
//!
//! Implements standard SSE protocol parsing with support for:
//! - event: and data: field parsing
//! - Multi-line data fields
//! - CRLF and LF line endings
//! - Stream reconnection
//!

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

/// SSE Event structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SSEEvent {
    /// Event type (defaults to "message")
    pub event: String,
    /// Event data
    pub data: String,
    /// Raw lines that made up this event
    pub raw: Vec<String>,
    /// Event ID (optional)
    pub id: Option<String>,
    /// Retry time in milliseconds (optional)
    pub retry: Option<u64>,
}

impl SSEEvent {
    /// Create a new SSE event with default values
    pub fn new(data: String) -> Self {
        Self {
            event: "message".to_string(),
            data,
            raw: Vec::new(),
            id: None,
            retry: None,
        }
    }

    /// Create with specific event type
    pub fn with_event(mut self, event: impl Into<String>) -> Self {
        self.event = event.into();
        self
    }

    /// Parse the data as JSON
    pub fn parse_json<T: for<'de> Deserialize<'de>>(&self) -> Result<T, serde_json::Error> {
        serde_json::from_str(&self.data)
    }
}

/// SSE Event Decoder
/// Parses SSE protocol line by line
pub struct SSEDecoder {
    event_type: Option<String>,
    data_lines: Vec<String>,
    chunks: Vec<String>,
    event_id: Option<String>,
    retry_time: Option<u64>,
}

impl Default for SSEDecoder {
    fn default() -> Self {
        Self::new()
    }
}

impl SSEDecoder {
    /// Create a new SSE decoder
    pub fn new() -> Self {
        Self {
            event_type: None,
            data_lines: Vec::new(),
            chunks: Vec::new(),
            event_id: None,
            retry_time: None,
        }
    }

    /// Decode a single line of SSE data
    /// Returns a complete SSE event if the line is empty (event boundary)
    pub fn decode(&mut self, line: &str) -> Option<SSEEvent> {
        self.chunks.push(line.to_string());

        // Empty line indicates event end
        if line.trim().is_empty() {
            if self.data_lines.is_empty() {
                self.reset();
                return None;
            }

            let event = SSEEvent {
                event: self
                    .event_type
                    .take()
                    .unwrap_or_else(|| "message".to_string()),
                data: self.data_lines.join("\n"),
                raw: std::mem::take(&mut self.chunks),
                id: self.event_id.clone(),
                retry: self.retry_time,
            };

            self.reset();
            return Some(event);
        }

        // Comment line (starts with :)
        if line.starts_with(':') {
            return None;
        }

        // Parse field
        if let Some((field, value)) = split_first(line, ':') {
            let value = value.strip_prefix(' ').unwrap_or(value);

            match field {
                "event" => self.event_type = Some(value.to_string()),
                "data" => self.data_lines.push(value.to_string()),
                "id" => self.event_id = Some(value.to_string()),
                "retry" => {
                    if let Ok(retry) = value.parse::<u64>() {
                        self.retry_time = Some(retry);
                    }
                }
                _ => {}
            }
        }

        None
    }

    /// Flush the buffer (force complete current event)
    pub fn flush(&mut self) -> Option<SSEEvent> {
        if self.data_lines.is_empty() {
            return None;
        }

        let event = SSEEvent {
            event: self
                .event_type
                .take()
                .unwrap_or_else(|| "message".to_string()),
            data: self.data_lines.join("\n"),
            raw: std::mem::take(&mut self.chunks),
            id: self.event_id.clone(),
            retry: self.retry_time,
        };

        self.reset();
        Some(event)
    }

    fn reset(&mut self) {
        self.event_type = None;
        self.data_lines.clear();
        self.chunks.clear();
        // id and retry are not reset per SSE spec
    }
}

/// Split string at first occurrence of separator
fn split_first(s: &str, sep: char) -> Option<(&str, &str)> {
    let idx = s.find(sep)?;
    Some((s.get(..idx)?, s.get(idx + 1..)?))
}

/// Newline Decoder for byte-level buffering
/// Handles both CRLF and LF line endings
pub struct NewlineDecoder {
    buffer: Vec<u8>,
    carriage_index: Option<usize>,
}

impl Default for NewlineDecoder {
    fn default() -> Self {
        Self::new()
    }
}

impl NewlineDecoder {
    /// Create a new newline decoder
    pub fn new() -> Self {
        Self {
            buffer: Vec::new(),
            carriage_index: None,
        }
    }

    /// Decode a chunk of bytes, extracting complete lines
    pub fn decode(&mut self, chunk: &[u8]) -> Vec<String> {
        self.buffer.extend_from_slice(chunk);

        let mut lines = Vec::new();

        while let Some(line_end) = self.find_newline() {
            let line_bytes = &self.buffer[..line_end.preceding];
            if let Ok(line) = String::from_utf8(line_bytes.to_vec()) {
                lines.push(line);
            }

            self.buffer = self.buffer[line_end.index..].to_vec();
            self.carriage_index = None;
        }

        lines
    }

    /// Flush remaining buffer as final line
    pub fn flush(&mut self) -> Vec<String> {
        if self.buffer.is_empty() {
            return Vec::new();
        }

        let line = String::from_utf8_lossy(&self.buffer).to_string();
        self.buffer.clear();
        self.carriage_index = None;
        vec![line]
    }

    fn find_newline(&self) -> Option<LineEnd> {
        let start = self.carriage_index.unwrap_or(0);

        for i in start..self.buffer.len() {
            let byte = self.buffer[i];

            if byte == 0x0a {
                // LF
                let preceding = if i > 0 && self.buffer[i - 1] == 0x0d {
                    i - 1 // CRLF
                } else {
                    i // LF only
                };

                return Some(LineEnd {
                    index: i + 1,
                    preceding,
                });
            }
        }

        None
    }
}

struct LineEnd {
    index: usize,
    preceding: usize,
}

/// SSE Stream wrapper for high-level SSE processing
pub struct SSEStream<T> {
    decoder: SSEDecoder,
    newline_decoder: NewlineDecoder,
    event_queue: VecDeque<SSEEvent>,
    aborted: bool,
    _phantom: std::marker::PhantomData<T>,
}

impl<T> Default for SSEStream<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T> SSEStream<T> {
    /// Create a new SSE stream
    pub fn new() -> Self {
        Self {
            decoder: SSEDecoder::new(),
            newline_decoder: NewlineDecoder::new(),
            event_queue: VecDeque::new(),
            aborted: false,
            _phantom: std::marker::PhantomData,
        }
    }

    /// Process incoming bytes
    pub fn process_bytes(&mut self, bytes: &[u8]) {
        if self.aborted {
            return;
        }

        let lines = self.newline_decoder.decode(bytes);
        for line in lines {
            if let Some(event) = self.decoder.decode(&line) {
                self.event_queue.push_back(event);
            }
        }
    }

    /// Get next event from queue
    pub fn next_event(&mut self) -> Option<SSEEvent> {
        self.event_queue.pop_front()
    }

    /// Flush and get remaining events
    pub fn flush(&mut self) -> Vec<SSEEvent> {
        let mut events = Vec::new();

        // Flush newline decoder
        for line in self.newline_decoder.flush() {
            if let Some(event) = self.decoder.decode(&line) {
                events.push(event);
            }
        }

        // Flush SSE decoder
        if let Some(event) = self.decoder.flush() {
            events.push(event);
        }

        // Drain queue
        events.extend(self.event_queue.drain(..));
        events
    }

    /// Abort the stream
    pub fn abort(&mut self) {
        self.aborted = true;
    }

    /// Check if stream is aborted
    pub fn is_aborted(&self) -> bool {
        self.aborted
    }

    /// Check if there are pending events
    pub fn has_events(&self) -> bool {
        !self.event_queue.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sse_event_new() {
        let event = SSEEvent::new("test data".to_string());
        assert_eq!(event.event, "message");
        assert_eq!(event.data, "test data");
    }

    #[test]
    fn test_sse_event_with_event() {
        let event = SSEEvent::new("data".to_string()).with_event("custom");
        assert_eq!(event.event, "custom");
    }

    #[test]
    fn test_sse_decoder_simple() {
        let mut decoder = SSEDecoder::new();

        assert!(decoder.decode("data: hello").is_none());
        let event = decoder.decode("").unwrap();

        assert_eq!(event.event, "message");
        assert_eq!(event.data, "hello");
    }

    #[test]
    fn test_sse_decoder_with_event_type() {
        let mut decoder = SSEDecoder::new();

        decoder.decode("event: custom");
        decoder.decode("data: test");
        let event = decoder.decode("").unwrap();

        assert_eq!(event.event, "custom");
        assert_eq!(event.data, "test");
    }

    #[test]
    fn test_sse_decoder_multiline_data() {
        let mut decoder = SSEDecoder::new();

        decoder.decode("data: line1");
        decoder.decode("data: line2");
        let event = decoder.decode("").unwrap();

        assert_eq!(event.data, "line1\nline2");
    }

    #[test]
    fn test_sse_decoder_comment() {
        let mut decoder = SSEDecoder::new();

        decoder.decode(": this is a comment");
        decoder.decode("data: actual data");
        let event = decoder.decode("").unwrap();

        assert_eq!(event.data, "actual data");
    }

    #[test]
    fn test_sse_decoder_id_and_retry() {
        let mut decoder = SSEDecoder::new();

        decoder.decode("id: 123");
        decoder.decode("retry: 5000");
        decoder.decode("data: test");
        let event = decoder.decode("").unwrap();

        assert_eq!(event.id, Some("123".to_string()));
        assert_eq!(event.retry, Some(5000));
    }

    #[test]
    fn test_sse_decoder_flush() {
        let mut decoder = SSEDecoder::new();

        decoder.decode("data: incomplete");
        let event = decoder.flush().unwrap();

        assert_eq!(event.data, "incomplete");
    }

    #[test]
    fn test_newline_decoder_lf() {
        let mut decoder = NewlineDecoder::new();
        let lines = decoder.decode(b"line1\nline2\n");
        assert_eq!(lines, vec!["line1", "line2"]);
    }

    #[test]
    fn test_newline_decoder_crlf() {
        let mut decoder = NewlineDecoder::new();
        let lines = decoder.decode(b"line1\r\nline2\r\n");
        assert_eq!(lines, vec!["line1", "line2"]);
    }

    #[test]
    fn test_newline_decoder_partial() {
        let mut decoder = NewlineDecoder::new();

        let lines1 = decoder.decode(b"par");
        assert!(lines1.is_empty());

        let lines2 = decoder.decode(b"tial\n");
        assert_eq!(lines2, vec!["partial"]);
    }

    #[test]
    fn test_newline_decoder_flush() {
        let mut decoder = NewlineDecoder::new();
        decoder.decode(b"incomplete");
        let lines = decoder.flush();
        assert_eq!(lines, vec!["incomplete"]);
    }

    #[test]
    fn test_sse_stream_process() {
        let mut stream: SSEStream<()> = SSEStream::new();

        stream.process_bytes(b"data: hello\n\n");

        let event = stream.next_event().unwrap();
        assert_eq!(event.data, "hello");
    }

    #[test]
    fn test_sse_stream_abort() {
        let mut stream: SSEStream<()> = SSEStream::new();

        stream.abort();
        assert!(stream.is_aborted());

        stream.process_bytes(b"data: ignored\n\n");
        assert!(stream.next_event().is_none());
    }
}
