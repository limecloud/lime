//! Typed user input shared by the runtime, history, and provider boundaries.
//!
//! The order of these parts is semantic. Callers must not concatenate text or
//! move images to a separate collection before the runtime has consumed skill
//! and mention parts and the provider boundary has lowered media.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::fmt;

/// Conservative cap shared by every product surface, measured in Unicode characters.
pub const MAX_USER_INPUT_TEXT_CHARS: usize = 1 << 20;

pub fn validate_user_input_text_length(actual_chars: usize) -> Result<(), AgentInputError> {
    if actual_chars > MAX_USER_INPUT_TEXT_CHARS {
        return Err(AgentInputError::InputTooLarge { actual_chars });
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ByteRange {
    /// Inclusive byte offset in the UTF-8 text buffer.
    pub start: usize,
    /// Exclusive byte offset in the UTF-8 text buffer.
    pub end: usize,
}

impl From<std::ops::Range<usize>> for ByteRange {
    fn from(range: std::ops::Range<usize>) -> Self {
        Self {
            start: range.start,
            end: range.end,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TextElement {
    pub byte_range: ByteRange,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
}

impl TextElement {
    pub fn new(byte_range: impl Into<ByteRange>, placeholder: Option<String>) -> Self {
        Self {
            byte_range: byte_range.into(),
            placeholder,
        }
    }

    pub fn placeholder<'a>(&'a self, text: &'a str) -> Option<&'a str> {
        self.placeholder
            .as_deref()
            .or_else(|| text.get(self.byte_range.start..self.byte_range.end))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ImageDetail {
    Auto,
    Low,
    High,
    Original,
}

/// Ordered user input accepted by the current runtime.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentInput {
    Text {
        text: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        text_elements: Vec<TextElement>,
    },
    Image {
        uri: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        detail: Option<ImageDetail>,
    },
    LocalImage {
        path: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        detail: Option<ImageDetail>,
    },
    Skill {
        name: String,
        path: String,
    },
    Mention {
        name: String,
        path: String,
    },
}

impl AgentInput {
    pub fn text_char_count(&self) -> usize {
        match self {
            Self::Text { text, .. } => text.chars().count(),
            _ => 0,
        }
    }

    pub fn text(text: impl Into<String>) -> Self {
        Self::Text {
            text: text.into(),
            text_elements: Vec::new(),
        }
    }

    pub fn validate(&self) -> Result<(), AgentInputError> {
        match self {
            Self::Text {
                text,
                text_elements,
            } => validate_text_elements(text, text_elements),
            Self::Image { uri, .. } => require_non_empty("image uri", uri),
            Self::LocalImage { path, .. } => require_non_empty("local image path", path),
            Self::Skill { name, path } => {
                require_non_empty("skill name", name)?;
                require_non_empty("skill path", path)
            }
            Self::Mention { name, path } => {
                require_non_empty("mention name", name)?;
                require_non_empty("mention path", path)
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentInputError {
    EmptyField(&'static str),
    InputTooLarge {
        actual_chars: usize,
    },
    InvalidTextElement {
        index: usize,
        start: usize,
        end: usize,
        text_bytes: usize,
    },
}

impl fmt::Display for AgentInputError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyField(field) => write!(formatter, "{field} must not be empty"),
            Self::InputTooLarge { .. } => write!(
                formatter,
                "Input exceeds the maximum length of {MAX_USER_INPUT_TEXT_CHARS} characters."
            ),
            Self::InvalidTextElement {
                index,
                start,
                end,
                text_bytes,
            } => write!(
                formatter,
                "text element {index} has invalid UTF-8 byte range {start}..{end} for {text_bytes} bytes"
            ),
        }
    }
}

impl std::error::Error for AgentInputError {}

fn require_non_empty(field: &'static str, value: &str) -> Result<(), AgentInputError> {
    if value.trim().is_empty() {
        Err(AgentInputError::EmptyField(field))
    } else {
        Ok(())
    }
}

fn validate_text_elements(
    text: &str,
    text_elements: &[TextElement],
) -> Result<(), AgentInputError> {
    for (index, element) in text_elements.iter().enumerate() {
        let ByteRange { start, end } = element.byte_range;
        if start > end
            || end > text.len()
            || !text.is_char_boundary(start)
            || !text.is_char_boundary(end)
        {
            return Err(AgentInputError::InvalidTextElement {
                index,
                start,
                end,
                text_bytes: text.len(),
            });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ordered_input_round_trips_without_flattening_parts() {
        let input = vec![
            AgentInput::Text {
                text: "hello 世界".to_string(),
                text_elements: vec![TextElement::new(6..12, Some("世界".to_string()))],
            },
            AgentInput::Image {
                uri: "https://example.com/image.png".to_string(),
                detail: Some(ImageDetail::High),
            },
            AgentInput::Skill {
                name: "review".to_string(),
                path: "/skills/review/SKILL.md".to_string(),
            },
            AgentInput::Mention {
                name: "docs".to_string(),
                path: "app://docs".to_string(),
            },
        ];

        for part in &input {
            part.validate().expect("valid typed input");
        }
        let value = serde_json::to_value(&input).expect("serialize typed input");
        assert_eq!(value[0]["type"], "text");
        assert_eq!(value[0]["text_elements"][0]["byteRange"]["start"], 6);
        assert!(value[0]["text_elements"][0].get("byte_range").is_none());
        assert_eq!(value[1]["type"], "image");
        assert_eq!(value[1]["detail"], "high");
        assert_eq!(value[2]["type"], "skill");
        assert_eq!(value[3]["type"], "mention");
        assert_eq!(
            serde_json::from_value::<Vec<AgentInput>>(value).expect("deserialize typed input"),
            input
        );
    }

    #[test]
    fn text_element_ranges_use_utf8_bytes_and_fail_closed() {
        let valid = AgentInput::Text {
            text: "a世界".to_string(),
            text_elements: vec![TextElement::new(1..7, None)],
        };
        assert_eq!(
            match &valid {
                AgentInput::Text {
                    text,
                    text_elements,
                } => text_elements[0].placeholder(text),
                _ => None,
            },
            Some("世界")
        );
        valid.validate().expect("valid UTF-8 byte range");

        let splits_codepoint = AgentInput::Text {
            text: "a世界".to_string(),
            text_elements: vec![TextElement::new(2..7, None)],
        };
        assert!(matches!(
            splits_codepoint.validate(),
            Err(AgentInputError::InvalidTextElement {
                index: 0,
                start: 2,
                end: 7,
                text_bytes: 7,
            })
        ));
    }

    #[test]
    fn named_and_media_parts_reject_empty_identity() {
        for input in [
            AgentInput::Image {
                uri: " ".to_string(),
                detail: None,
            },
            AgentInput::LocalImage {
                path: String::new(),
                detail: None,
            },
            AgentInput::Skill {
                name: "review".to_string(),
                path: " ".to_string(),
            },
            AgentInput::Mention {
                name: String::new(),
                path: "app://docs".to_string(),
            },
        ] {
            assert!(matches!(
                input.validate(),
                Err(AgentInputError::EmptyField(_))
            ));
        }

        assert_eq!(
            serde_json::to_value(AgentInput::LocalImage {
                path: "C:/work/image.png".to_string(),
                detail: Some(ImageDetail::Original),
            })
            .expect("serialize local image"),
            json!({
                "type": "local_image",
                "path": "C:/work/image.png",
                "detail": "original"
            })
        );
    }
}
