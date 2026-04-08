//! OpenAI Chat Completion API data models
//!
//! Supports standard OpenAI format and extended tool types (e.g. web_search).
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageUrl {
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ContentPart {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image_url")]
    ImageUrl { image_url: ImageUrl },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub call_type: String,
    pub function: FunctionCall,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionCall {
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MessageContent {
    Text(String),
    Parts(Vec<ContentPart>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<MessageContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_content: Option<String>,
}

impl ChatMessage {
    pub fn get_content_text(&self) -> String {
        match &self.content {
            Some(MessageContent::Text(s)) => s.clone(),
            Some(MessageContent::Parts(parts)) => parts
                .iter()
                .filter_map(|p| {
                    if let ContentPart::Text { text } = p {
                        Some(text.clone())
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
                .join(""),
            None => String::new(),
        }
    }

    /// Extract image URLs from message content.
    /// Returns a list of (format, base64_data) tuples.
    pub fn get_images(&self) -> Vec<(String, String)> {
        match &self.content {
            Some(MessageContent::Parts(parts)) => parts
                .iter()
                .filter_map(|p| {
                    if let ContentPart::ImageUrl { image_url } = p {
                        if image_url.url.starts_with("data:") {
                            let parts: Vec<&str> = image_url.url.splitn(2, ',').collect();
                            if parts.len() == 2 {
                                let header = parts[0];
                                let data = parts[1];
                                let media_type = header
                                    .strip_prefix("data:")
                                    .and_then(|s| s.split(';').next())
                                    .unwrap_or("image/jpeg");
                                let format =
                                    media_type.split('/').nth(1).unwrap_or("jpeg").to_string();
                                return Some((format, data.to_string()));
                            }
                        }
                        None
                    } else {
                        None
                    }
                })
                .collect(),
            _ => Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionDef {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parameters: Option<serde_json::Value>,
}

/// Tool definition supporting multiple tool types.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Tool {
    #[serde(rename = "function")]
    Function { function: FunctionDef },
    #[serde(rename = "web_search")]
    WebSearch,
    #[serde(rename = "web_search_20250305")]
    WebSearch20250305,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f32>,
    #[serde(default)]
    pub stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<Tool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_choice: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Usage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResponseMessage {
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Choice {
    pub index: u32,
    pub message: ResponseMessage,
    pub finish_reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionResponse {
    pub id: String,
    pub object: String,
    pub created: u64,
    pub model: String,
    pub choices: Vec<Choice>,
    pub usage: Usage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamDelta {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamChoice {
    pub index: u32,
    pub delta: StreamDelta,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finish_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionChunk {
    pub id: String,
    pub object: String,
    pub created: u64,
    pub model: String,
    pub choices: Vec<StreamChoice>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chat_message_roundtrip() {
        let msg = ChatMessage {
            role: "user".to_string(),
            content: Some(MessageContent::Text("Hello".to_string())),
            tool_calls: None,
            tool_call_id: None,
            reasoning_content: None,
        };
        let json = serde_json::to_string(&msg).unwrap();
        let parsed: ChatMessage = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.get_content_text(), "Hello");
    }

    #[test]
    fn test_stream_delta_with_reasoning_content() {
        let delta = StreamDelta {
            role: Some("assistant".to_string()),
            content: Some("answer".to_string()),
            tool_calls: None,
            reasoning_content: Some("thinking...".to_string()),
        };
        let json = serde_json::to_string(&delta).unwrap();
        assert!(json.contains("reasoning_content"));

        let parsed: StreamDelta = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.reasoning_content.as_deref(), Some("thinking..."));
    }

    #[test]
    fn test_stream_delta_without_reasoning_content_skips_field() {
        let delta = StreamDelta {
            role: None,
            content: Some("hello".to_string()),
            tool_calls: None,
            reasoning_content: None,
        };
        let json = serde_json::to_string(&delta).unwrap();
        assert!(!json.contains("reasoning_content"));
    }

    #[test]
    fn test_tool_function_roundtrip() {
        let tool_json = r#"{"type":"function","function":{"name":"get_weather","description":"Get weather","parameters":{"type":"object"}}}"#;
        let tool: Tool = serde_json::from_str(tool_json).unwrap();
        if let Tool::Function { function } = &tool {
            assert_eq!(function.name, "get_weather");
        } else {
            panic!("Expected Function variant");
        }
    }

    #[test]
    fn test_tool_web_search_roundtrip() {
        let tool_json = r#"{"type":"web_search"}"#;
        let tool: Tool = serde_json::from_str(tool_json).unwrap();
        assert!(matches!(tool, Tool::WebSearch));
    }

    #[test]
    fn test_chat_completion_request_roundtrip() {
        let req = ChatCompletionRequest {
            model: "gpt-4".to_string(),
            messages: vec![ChatMessage {
                role: "user".to_string(),
                content: Some(MessageContent::Text("Hi".to_string())),
                tool_calls: None,
                tool_call_id: None,
                reasoning_content: None,
            }],
            temperature: Some(0.7),
            max_tokens: Some(1024),
            top_p: None,
            stream: false,
            tools: None,
            tool_choice: None,
            reasoning_effort: None,
        };
        let json = serde_json::to_string(&req).unwrap();
        let parsed: ChatCompletionRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.model, "gpt-4");
        assert_eq!(parsed.messages.len(), 1);
    }

    #[test]
    fn test_chat_completion_response_roundtrip() {
        let resp_json = r#"{
            "id": "chatcmpl-123",
            "object": "chat.completion",
            "created": 1700000000,
            "model": "gpt-4",
            "choices": [{
                "index": 0,
                "message": {"role": "assistant", "content": "Hello!"},
                "finish_reason": "stop"
            }],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
        }"#;
        let resp: ChatCompletionResponse = serde_json::from_str(resp_json).unwrap();
        assert_eq!(resp.id, "chatcmpl-123");
        assert_eq!(resp.choices[0].message.content.as_deref(), Some("Hello!"));
    }

    #[test]
    fn test_content_part_multimodal() {
        let parts_json = r#"[
            {"type": "text", "text": "What is this?"},
            {"type": "image_url", "image_url": {"url": "https://example.com/img.png"}}
        ]"#;
        let parts: Vec<ContentPart> = serde_json::from_str(parts_json).unwrap();
        assert_eq!(parts.len(), 2);
    }

    #[test]
    fn test_message_content_untagged() {
        // String variant
        let text: MessageContent = serde_json::from_str(r#""hello""#).unwrap();
        assert!(matches!(text, MessageContent::Text(s) if s == "hello"));

        // Array variant
        let parts: MessageContent =
            serde_json::from_str(r#"[{"type":"text","text":"hi"}]"#).unwrap();
        assert!(matches!(parts, MessageContent::Parts(p) if p.len() == 1));
    }

    #[test]
    fn test_get_images_from_data_url() {
        let msg = ChatMessage {
            role: "user".to_string(),
            content: Some(MessageContent::Parts(vec![ContentPart::ImageUrl {
                image_url: ImageUrl {
                    url: "data:image/png;base64,iVBORw0KGgo=".to_string(),
                    detail: None,
                },
            }])),
            tool_calls: None,
            tool_call_id: None,
            reasoning_content: None,
        };
        let images = msg.get_images();
        assert_eq!(images.len(), 1);
        assert_eq!(images[0].0, "png");
        assert_eq!(images[0].1, "iVBORw0KGgo=");
    }

    #[test]
    fn test_streaming_chunk_roundtrip() {
        let chunk_json = r#"{
            "id": "chatcmpl-123",
            "object": "chat.completion.chunk",
            "created": 1700000000,
            "model": "gpt-4",
            "choices": [{
                "index": 0,
                "delta": {"role": "assistant", "content": "Hi"},
                "finish_reason": null
            }]
        }"#;
        let chunk: ChatCompletionChunk = serde_json::from_str(chunk_json).unwrap();
        assert_eq!(chunk.choices[0].delta.content.as_deref(), Some("Hi"));
    }
}
