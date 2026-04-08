//! Anthropic Messages API data models
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AnthropicContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    #[serde(rename = "tool_result")]
    ToolResult {
        tool_use_id: String,
        content: serde_json::Value,
    },
    #[serde(rename = "image")]
    Image { source: ImageSource },
    #[serde(rename = "thinking")]
    Thinking { thinking: String, signature: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageSource {
    #[serde(rename = "type")]
    pub source_type: String,
    pub media_type: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnthropicMessage {
    pub role: String,
    pub content: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnthropicTool {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_schema: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnthropicMessagesRequest {
    pub model: String,
    pub messages: Vec<AnthropicMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<AnthropicTool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_choice: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnthropicUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct AnthropicMessagesResponse {
    pub id: String,
    #[serde(rename = "type")]
    pub response_type: String,
    pub role: String,
    pub content: Vec<AnthropicContentBlock>,
    pub model: String,
    pub stop_reason: Option<String>,
    pub usage: AnthropicUsage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AnthropicStreamEvent {
    #[serde(rename = "message_start")]
    MessageStart { message: AnthropicMessageStart },
    #[serde(rename = "content_block_start")]
    ContentBlockStart {
        index: u32,
        content_block: AnthropicContentBlock,
    },
    #[serde(rename = "content_block_delta")]
    ContentBlockDelta { index: u32, delta: AnthropicDelta },
    #[serde(rename = "content_block_stop")]
    ContentBlockStop { index: u32 },
    #[serde(rename = "message_delta")]
    MessageDelta {
        delta: AnthropicMessageDelta,
        usage: AnthropicUsage,
    },
    #[serde(rename = "message_stop")]
    MessageStop,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnthropicMessageStart {
    pub id: String,
    #[serde(rename = "type")]
    pub msg_type: String,
    pub role: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AnthropicDelta {
    #[serde(rename = "text_delta")]
    TextDelta { text: String },
    #[serde(rename = "input_json_delta")]
    InputJsonDelta { partial_json: String },
    #[serde(rename = "thinking_delta")]
    ThinkingDelta { thinking: String },
    #[serde(rename = "signature_delta")]
    SignatureDelta { signature: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnthropicMessageDelta {
    pub stop_reason: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_anthropic_content_block_text() {
        let json = r#"{"type":"text","text":"Hello"}"#;
        let block: AnthropicContentBlock = serde_json::from_str(json).unwrap();
        if let AnthropicContentBlock::Text { text } = &block {
            assert_eq!(text, "Hello");
        } else {
            panic!("Expected Text variant");
        }
        let roundtrip = serde_json::to_string(&block).unwrap();
        let parsed: AnthropicContentBlock = serde_json::from_str(&roundtrip).unwrap();
        assert!(matches!(parsed, AnthropicContentBlock::Text { .. }));
    }

    #[test]
    fn test_anthropic_content_block_tool_use() {
        let json = r#"{"type":"tool_use","id":"tu_1","name":"get_weather","input":{"city":"NYC"}}"#;
        let block: AnthropicContentBlock = serde_json::from_str(json).unwrap();
        if let AnthropicContentBlock::ToolUse { id, name, input } = &block {
            assert_eq!(id, "tu_1");
            assert_eq!(name, "get_weather");
            assert_eq!(input["city"], "NYC");
        } else {
            panic!("Expected ToolUse variant");
        }
    }

    #[test]
    fn test_anthropic_content_block_thinking() {
        let json = r#"{"type":"thinking","thinking":"Let me think...","signature":"sig123"}"#;
        let block: AnthropicContentBlock = serde_json::from_str(json).unwrap();
        assert!(matches!(block, AnthropicContentBlock::Thinking { .. }));
    }

    #[test]
    fn test_anthropic_messages_request_roundtrip() {
        let req = AnthropicMessagesRequest {
            model: "claude-sonnet-4-20250514".to_string(),
            messages: vec![AnthropicMessage {
                role: "user".to_string(),
                content: serde_json::json!("Hello"),
            }],
            max_tokens: Some(1024),
            system: None,
            temperature: Some(0.7),
            stream: false,
            tools: None,
            tool_choice: None,
        };
        let json = serde_json::to_string(&req).unwrap();
        let parsed: AnthropicMessagesRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.model, "claude-sonnet-4-20250514");
    }

    #[test]
    fn test_anthropic_messages_response_roundtrip() {
        let resp_json = r#"{
            "id": "msg_123",
            "type": "message",
            "role": "assistant",
            "content": [{"type": "text", "text": "Hello!"}],
            "model": "claude-sonnet-4-20250514",
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 10, "output_tokens": 5}
        }"#;
        let resp: AnthropicMessagesResponse = serde_json::from_str(resp_json).unwrap();
        assert_eq!(resp.id, "msg_123");
        assert_eq!(resp.content.len(), 1);
    }

    #[test]
    fn test_anthropic_stream_event_message_start() {
        let json = r#"{"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-sonnet-4-20250514"}}"#;
        let event: AnthropicStreamEvent = serde_json::from_str(json).unwrap();
        assert!(matches!(event, AnthropicStreamEvent::MessageStart { .. }));
    }

    #[test]
    fn test_anthropic_delta_variants() {
        let text_delta = r#"{"type":"text_delta","text":"Hello"}"#;
        let delta: AnthropicDelta = serde_json::from_str(text_delta).unwrap();
        assert!(matches!(delta, AnthropicDelta::TextDelta { .. }));

        let thinking_delta = r#"{"type":"thinking_delta","thinking":"hmm"}"#;
        let delta: AnthropicDelta = serde_json::from_str(thinking_delta).unwrap();
        assert!(matches!(delta, AnthropicDelta::ThinkingDelta { .. }));

        let sig_delta = r#"{"type":"signature_delta","signature":"abc"}"#;
        let delta: AnthropicDelta = serde_json::from_str(sig_delta).unwrap();
        assert!(matches!(delta, AnthropicDelta::SignatureDelta { .. }));
    }
}
