//! Token Estimator Module
//!
//! Provides accurate token estimation for different content types including:
//! - Asian characters (Chinese, Japanese, Korean)
//! - Code content
//! - Regular English text
//!
//! # Token Estimation Strategy
//!
//! Different content types have different character-to-token ratios:
//! - Asian text: ~2 characters per token
//! - Code: ~3 characters per token
//! - English text: ~3.5 characters per token
//!
//! Special characters and newlines add additional weight.

use crate::context::types::{CHARS_PER_TOKEN_ASIAN, CHARS_PER_TOKEN_CODE, CHARS_PER_TOKEN_DEFAULT};
use crate::conversation::message::{Message, MessageContent};

/// Message overhead in tokens (role, formatting, etc.)
const MESSAGE_OVERHEAD_TOKENS: usize = 4;

/// Token Estimator for different content types.
///
/// Provides methods to estimate token counts for text, messages, and message arrays.
pub struct TokenEstimator;

impl TokenEstimator {
    /// Estimate the number of tokens in a text string.
    ///
    /// Uses different character-per-token ratios based on content type:
    /// - Asian characters: ~2 chars/token
    /// - Code: ~3 chars/token
    /// - English text: ~3.5 chars/token
    ///
    /// Also adds weight for special characters and newlines.
    ///
    /// # Arguments
    ///
    /// * `text` - The text to estimate tokens for
    ///
    /// # Returns
    ///
    /// Estimated number of tokens
    ///
    /// # Example
    ///
    /// ```
    /// use aster::context::token_estimator::TokenEstimator;
    ///
    /// let english_text = "Hello, world!";
    /// let tokens = TokenEstimator::estimate_tokens(english_text);
    /// assert!(tokens > 0);
    /// ```
    pub fn estimate_tokens(text: &str) -> usize {
        if text.is_empty() {
            return 0;
        }

        // Determine the primary content type
        let chars_per_token = if Self::has_asian_chars(text) {
            CHARS_PER_TOKEN_ASIAN
        } else if Self::is_code(text) {
            CHARS_PER_TOKEN_CODE
        } else {
            CHARS_PER_TOKEN_DEFAULT
        };

        // Count base characters
        let char_count = text.chars().count();

        // Calculate base token estimate
        let base_tokens = (char_count as f64 / chars_per_token).ceil() as usize;

        // Add weight for special characters and newlines
        let special_weight = Self::calculate_special_weight(text);

        base_tokens + special_weight
    }

    /// Check if text contains Asian characters (Chinese, Japanese, Korean).
    ///
    /// # Arguments
    ///
    /// * `text` - The text to check
    ///
    /// # Returns
    ///
    /// `true` if the text contains significant Asian characters
    pub fn has_asian_chars(text: &str) -> bool {
        let total_chars = text.chars().count();
        if total_chars == 0 {
            return false;
        }

        let asian_count = text.chars().filter(|c| Self::is_asian_char(*c)).count();

        // Consider text as Asian if more than 20% of characters are Asian
        (asian_count as f64 / total_chars as f64) > 0.2
    }

    /// Check if a single character is an Asian character.
    fn is_asian_char(c: char) -> bool {
        matches!(c,
            // CJK Unified Ideographs
            '\u{4E00}'..='\u{9FFF}' |
            // CJK Unified Ideographs Extension A
            '\u{3400}'..='\u{4DBF}' |
            // CJK Unified Ideographs Extension B
            '\u{20000}'..='\u{2A6DF}' |
            // CJK Compatibility Ideographs
            '\u{F900}'..='\u{FAFF}' |
            // Hiragana
            '\u{3040}'..='\u{309F}' |
            // Katakana
            '\u{30A0}'..='\u{30FF}' |
            // Hangul Syllables
            '\u{AC00}'..='\u{D7AF}' |
            // Hangul Jamo
            '\u{1100}'..='\u{11FF}' |
            // Bopomofo
            '\u{3100}'..='\u{312F}'
        )
    }

    /// Check if text appears to be code.
    ///
    /// Uses heuristics to detect code content:
    /// - Presence of code-specific characters ({}, [], ;, etc.)
    /// - Indentation patterns with code keywords
    /// - Common code keywords
    ///
    /// # Arguments
    ///
    /// * `text` - The text to check
    ///
    /// # Returns
    ///
    /// `true` if the text appears to be code
    pub fn is_code(text: &str) -> bool {
        // Check for code block markers
        if text.contains("```") || text.contains("~~~") {
            return true;
        }

        // Count code-specific indicators
        let code_indicators = [
            '{', '}', '[', ']', '(', ')', ';', '=', '+', '-', '*', '/', '<', '>', '&', '|', '!',
        ];

        let total_chars = text.chars().count();
        if total_chars == 0 {
            return false;
        }

        let code_char_count = text.chars().filter(|c| code_indicators.contains(c)).count();

        // Check for common code patterns (keywords followed by specific syntax)
        let has_code_patterns = text.contains("fn ")
            || text.contains("def ")
            || text.contains("function ")
            || text.contains("class ")
            || text.contains("const ")
            || text.contains("let ")
            || text.contains("var ")
            || text.contains("import ")
            || text.contains("pub ")
            || text.contains("async ")
            || text.contains("await ")
            || text.contains("return ")
            || text.contains("if ")
            || text.contains("for ")
            || text.contains("while ");

        // Check for indentation with code patterns (more strict)
        // Only consider it code if there's indentation AND code patterns
        let has_indentation_with_code = text.lines().any(|line| {
            let trimmed = line.trim_start();
            let indent_size = line.len() - trimmed.len();
            // Require at least 2 spaces of indentation AND the line must have code-like content
            indent_size >= 2
                && (trimmed.contains('{')
                    || trimmed.contains('}')
                    || trimmed.contains(';')
                    || trimmed.starts_with("let ")
                    || trimmed.starts_with("const ")
                    || trimmed.starts_with("return ")
                    || trimmed.starts_with("if ")
                    || trimmed.starts_with("for ")
                    || trimmed.starts_with("while ")
                    || trimmed.starts_with("//")
                    || trimmed.starts_with("#"))
        });

        // Consider it code if:
        // - More than 5% of characters are code indicators, OR
        // - Has code patterns (keywords), OR
        // - Has indentation with code-like content
        (code_char_count as f64 / total_chars as f64) > 0.05
            || has_code_patterns
            || has_indentation_with_code
    }

    /// Calculate additional weight for special characters and newlines.
    fn calculate_special_weight(text: &str) -> usize {
        let newline_count = text.chars().filter(|c| *c == '\n').count();
        let special_count = text
            .chars()
            .filter(|c| {
                matches!(
                    c,
                    '\t' | '\r' | '\\' | '"' | '\'' | '`' | '~' | '@' | '#' | '$' | '%' | '^'
                )
            })
            .count();

        // Each newline adds ~0.5 tokens, special chars add ~0.25 tokens
        (newline_count as f64 * 0.5).ceil() as usize + (special_count as f64 * 0.25).ceil() as usize
    }

    /// Estimate the number of tokens in a message.
    ///
    /// Includes message overhead (role, formatting) plus content tokens.
    ///
    /// # Arguments
    ///
    /// * `message` - The message to estimate tokens for
    ///
    /// # Returns
    ///
    /// Estimated number of tokens
    pub fn estimate_message_tokens(message: &Message) -> usize {
        let content_tokens: usize = message
            .content
            .iter()
            .map(Self::estimate_content_tokens)
            .sum();

        content_tokens + MESSAGE_OVERHEAD_TOKENS
    }

    /// Estimate tokens for a single message content block.
    fn estimate_content_tokens(content: &MessageContent) -> usize {
        match content {
            MessageContent::Text(text_content) => Self::estimate_tokens(&text_content.text),
            MessageContent::Image(_) => {
                // Images typically use a fixed token count
                // Claude uses ~1600 tokens for a typical image
                1600
            }
            MessageContent::ToolRequest(tool_request) => {
                // Estimate based on tool name and arguments
                let mut tokens = 10; // Base overhead for tool request structure

                if let Ok(call) = &tool_request.tool_call {
                    tokens += Self::estimate_tokens(&call.name);
                    if let Some(args) = &call.arguments {
                        let args_str = serde_json::to_string(args).unwrap_or_default();
                        tokens += Self::estimate_tokens(&args_str);
                    }
                }

                tokens
            }
            MessageContent::ToolResponse(tool_response) => {
                let mut tokens = 10; // Base overhead

                if let Ok(result) = &tool_response.tool_result {
                    for content in &result.content {
                        if let Some(text) = content.as_text() {
                            tokens += Self::estimate_tokens(&text.text);
                        }
                    }
                }

                tokens
            }
            MessageContent::Thinking(thinking) => Self::estimate_tokens(&thinking.thinking),
            MessageContent::RedactedThinking(_) => 50, // Fixed estimate for redacted thinking
            MessageContent::ToolConfirmationRequest(req) => {
                let args_str = serde_json::to_string(&req.arguments).unwrap_or_default();
                10 + Self::estimate_tokens(&req.tool_name) + Self::estimate_tokens(&args_str)
            }
            MessageContent::ActionRequired(action) => {
                match &action.data {
                    crate::conversation::message::ActionRequiredData::ToolConfirmation {
                        tool_name,
                        arguments,
                        ..
                    } => {
                        let args_str = serde_json::to_string(arguments).unwrap_or_default();
                        10 + Self::estimate_tokens(tool_name) + Self::estimate_tokens(&args_str)
                    }
                    crate::conversation::message::ActionRequiredData::Elicitation {
                        message,
                        ..
                    } => 10 + Self::estimate_tokens(message),
                    crate::conversation::message::ActionRequiredData::ElicitationResponse {
                        ..
                    } => 20, // Fixed estimate
                }
            }
            MessageContent::FrontendToolRequest(req) => {
                let mut tokens = 10;
                if let Ok(call) = &req.tool_call {
                    tokens += Self::estimate_tokens(&call.name);
                    if let Some(args) = &call.arguments {
                        let args_str = serde_json::to_string(args).unwrap_or_default();
                        tokens += Self::estimate_tokens(&args_str);
                    }
                }
                tokens
            }
            MessageContent::SystemNotification(notification) => {
                Self::estimate_tokens(&notification.msg)
            }
        }
    }

    /// Estimate the total number of tokens for an array of messages.
    ///
    /// # Arguments
    ///
    /// * `messages` - The messages to estimate tokens for
    ///
    /// # Returns
    ///
    /// Total estimated tokens across all messages
    pub fn estimate_total_tokens(messages: &[Message]) -> usize {
        messages.iter().map(Self::estimate_message_tokens).sum()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_estimate_tokens_empty() {
        assert_eq!(TokenEstimator::estimate_tokens(""), 0);
    }

    #[test]
    fn test_estimate_tokens_english() {
        let text = "Hello, world! This is a test.";
        let tokens = TokenEstimator::estimate_tokens(text);
        // ~30 chars / 3.5 ≈ 9 tokens + special weight
        assert!(tokens > 0);
        assert!(tokens < 20);
    }

    #[test]
    fn test_estimate_tokens_chinese() {
        let text = "你好世界，这是一个测试。";
        let tokens = TokenEstimator::estimate_tokens(text);
        // ~12 chars / 2 ≈ 6 tokens
        assert!(tokens > 0);
        assert!(tokens < 15);
    }

    #[test]
    fn test_estimate_tokens_code() {
        let text = r#"
fn main() {
    println!("Hello, world!");
}
"#;
        let tokens = TokenEstimator::estimate_tokens(text);
        assert!(tokens > 0);
    }

    #[test]
    fn test_has_asian_chars_chinese() {
        assert!(TokenEstimator::has_asian_chars("你好世界"));
        assert!(TokenEstimator::has_asian_chars("Hello 你好"));
    }

    #[test]
    fn test_has_asian_chars_japanese() {
        assert!(TokenEstimator::has_asian_chars("こんにちは"));
        assert!(TokenEstimator::has_asian_chars("カタカナ"));
    }

    #[test]
    fn test_has_asian_chars_korean() {
        assert!(TokenEstimator::has_asian_chars("안녕하세요"));
    }

    #[test]
    fn test_has_asian_chars_english() {
        assert!(!TokenEstimator::has_asian_chars("Hello, world!"));
        assert!(!TokenEstimator::has_asian_chars(""));
    }

    #[test]
    fn test_is_code_rust() {
        let code = r#"
fn main() {
    let x = 5;
    println!("{}", x);
}
"#;
        assert!(TokenEstimator::is_code(code));
    }

    #[test]
    fn test_is_code_javascript() {
        let code = r#"
function hello() {
    const x = 5;
    return x + 1;
}
"#;
        assert!(TokenEstimator::is_code(code));
    }

    #[test]
    fn test_is_code_python() {
        let code = r#"
def hello():
    x = 5
    return x + 1
"#;
        assert!(TokenEstimator::is_code(code));
    }

    #[test]
    fn test_is_code_markdown_block() {
        let text = "```rust\nfn main() {}\n```";
        assert!(TokenEstimator::is_code(text));
    }

    #[test]
    fn test_is_code_plain_text() {
        let text = "This is just plain English text without any code.";
        assert!(!TokenEstimator::is_code(text));
    }

    #[test]
    fn test_estimate_message_tokens() {
        let message = Message::user().with_text("Hello, world!");
        let tokens = TokenEstimator::estimate_message_tokens(&message);
        // Content tokens + MESSAGE_OVERHEAD_TOKENS
        assert!(tokens >= MESSAGE_OVERHEAD_TOKENS);
    }

    #[test]
    fn test_estimate_total_tokens() {
        let messages = vec![
            Message::user().with_text("Hello"),
            Message::assistant().with_text("Hi there!"),
        ];
        let total = TokenEstimator::estimate_total_tokens(&messages);
        assert!(total > 0);
        assert!(total >= MESSAGE_OVERHEAD_TOKENS * 2);
    }

    #[test]
    fn test_estimate_tokens_with_newlines() {
        let text = "Line 1\nLine 2\nLine 3";
        let tokens = TokenEstimator::estimate_tokens(text);
        // Should include weight for newlines
        assert!(tokens > 0);
    }

    #[test]
    fn test_estimate_tokens_with_special_chars() {
        let text = "Hello @user #tag $var %percent";
        let tokens = TokenEstimator::estimate_tokens(text);
        // Should include weight for special characters
        assert!(tokens > 0);
    }
}
