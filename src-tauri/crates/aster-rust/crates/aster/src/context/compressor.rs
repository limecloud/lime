//! Message Compressor Module
//!
//! This module provides message compression functionality to reduce context size
//! while preserving important content. It supports:
//!
//! - Code block compression (keeping head and tail lines)
//! - Tool output compression
//! - File content compression
//! - Incremental compression on message addition
//! - Progressive pruning based on context usage
//!
//! # Example
//!
//! ```rust,ignore
//! use aster::context::compressor::MessageCompressor;
//!
//! let code = "fn main() {\n    // 100 lines of code\n}";
//! let compressed = MessageCompressor::compress_code_block(code, 50);
//! ```

use crate::context::pruner::ProgressivePruner;
use crate::context::token_estimator::TokenEstimator;
use crate::context::types::{CodeBlock, CompressionConfig, CompressionResult, PruningConfig};
use crate::conversation::message::{Message, MessageContent};
use regex::Regex;
use std::sync::LazyLock;

// ============================================================================
// Constants
// ============================================================================

/// Default maximum lines for code blocks before compression
pub const DEFAULT_CODE_BLOCK_MAX_LINES: usize = 50;

/// Default maximum characters for tool output before compression
pub const DEFAULT_TOOL_OUTPUT_MAX_CHARS: usize = 2000;

/// Default maximum characters for file content before compression
pub const DEFAULT_FILE_CONTENT_MAX_CHARS: usize = 1500;

/// Percentage of lines to keep from the head (60%)
const HEAD_RATIO: f64 = 0.6;

/// Percentage of lines to keep from the tail (40%)
#[allow(dead_code)]
const TAIL_RATIO: f64 = 0.4;

/// Omission marker for compressed content
#[allow(dead_code)]
const OMISSION_MARKER: &str = "\n... [content omitted] ...\n";

/// Regex for detecting code blocks in markdown
static CODE_BLOCK_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"```(\w*)\n([\s\S]*?)```").expect("Invalid code block regex"));

/// Regex for detecting file paths
static FILE_PATH_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:^|\s)([./~]?(?:[\w.-]+/)+[\w.-]+\.\w+)").expect("Invalid file path regex")
});

// ============================================================================
// MessageCompressor
// ============================================================================

/// Message compressor for reducing context size while preserving important content.
pub struct MessageCompressor;

impl MessageCompressor {
    // ========================================================================
    // Code Block Compression
    // ========================================================================

    /// Compress a code block by keeping head and tail lines.
    ///
    /// When a code block exceeds `max_lines`, this function keeps approximately
    /// 60% of lines from the head and 40% from the tail, with an omission marker
    /// in between.
    ///
    /// # Arguments
    ///
    /// * `code` - The code content to compress
    /// * `max_lines` - Maximum number of lines to keep (excluding omission marker)
    ///
    /// # Returns
    ///
    /// The compressed code string. If the code is already within limits,
    /// returns the original code unchanged.
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// let code = (0..100).map(|i| format!("line {}", i)).collect::<Vec<_>>().join("\n");
    /// let compressed = MessageCompressor::compress_code_block(&code, 50);
    /// // Result: first 30 lines + omission marker + last 20 lines
    /// ```
    pub fn compress_code_block(code: &str, max_lines: usize) -> String {
        let lines: Vec<&str> = code.lines().collect();
        let total_lines = lines.len();

        // If within limits, return unchanged
        if total_lines <= max_lines {
            return code.to_string();
        }

        // Calculate head and tail sizes
        let head_lines = ((max_lines as f64) * HEAD_RATIO).ceil() as usize;
        let tail_lines = max_lines.saturating_sub(head_lines);

        // Ensure we don't exceed available lines
        let head_lines = head_lines.min(total_lines);
        let tail_lines = tail_lines.min(total_lines.saturating_sub(head_lines));

        // Build compressed content
        let head: Vec<&str> = lines.iter().take(head_lines).copied().collect();
        let tail: Vec<&str> = lines
            .iter()
            .skip(total_lines.saturating_sub(tail_lines))
            .copied()
            .collect();

        let omitted_count = total_lines - head_lines - tail_lines;
        let omission_text = format!("\n... [{} lines omitted] ...\n", omitted_count);

        format!("{}{}{}", head.join("\n"), omission_text, tail.join("\n"))
    }

    /// Extract code blocks from markdown text.
    ///
    /// Detects fenced code blocks (```language ... ```) and returns
    /// information about each block including position and language.
    ///
    /// # Arguments
    ///
    /// * `text` - The markdown text to search
    ///
    /// # Returns
    ///
    /// A vector of `CodeBlock` structs containing the code, language,
    /// and position information.
    pub fn extract_code_blocks(text: &str) -> Vec<CodeBlock> {
        CODE_BLOCK_REGEX
            .captures_iter(text)
            .map(|cap| {
                let full_match = cap.get(0).unwrap();
                let language = cap.get(1).map(|m| m.as_str().to_string());
                let code = cap
                    .get(2)
                    .map(|m| m.as_str().to_string())
                    .unwrap_or_default();

                CodeBlock::new(
                    code,
                    if language.as_ref().map(|l| l.is_empty()).unwrap_or(true) {
                        None
                    } else {
                        language
                    },
                    full_match.start(),
                    full_match.end(),
                )
            })
            .collect()
    }

    /// Compress all code blocks in markdown text.
    ///
    /// Finds all code blocks and compresses those exceeding the max lines limit.
    ///
    /// # Arguments
    ///
    /// * `text` - The markdown text containing code blocks
    /// * `max_lines` - Maximum lines per code block
    ///
    /// # Returns
    ///
    /// The text with compressed code blocks.
    pub fn compress_code_blocks_in_text(text: &str, max_lines: usize) -> String {
        let mut result = text.to_string();
        let blocks = Self::extract_code_blocks(text);

        // Process blocks in reverse order to maintain positions
        for block in blocks.into_iter().rev() {
            if block.line_count() > max_lines {
                let compressed_code = Self::compress_code_block(&block.code, max_lines);
                let language = block.language.as_deref().unwrap_or("");
                let replacement = format!("```{}\n{}```", language, compressed_code);
                result.replace_range(block.start..block.end, &replacement);
            }
        }

        result
    }

    // ========================================================================
    // Tool Output Compression
    // ========================================================================

    /// Compress tool output by truncating with head/tail preservation.
    ///
    /// When tool output exceeds `max_chars`, keeps approximately 70% from
    /// the head and 30% from the tail, with an omission marker in between.
    ///
    /// # Arguments
    ///
    /// * `content` - The tool output content to compress
    /// * `max_chars` - Maximum characters to keep (excluding omission marker)
    ///
    /// # Returns
    ///
    /// The compressed content string.
    pub fn compress_tool_output(content: &str, max_chars: usize) -> String {
        if content.len() <= max_chars {
            return content.to_string();
        }

        // Check for code blocks - if present, prioritize code preservation
        let code_blocks = Self::extract_code_blocks(content);
        if !code_blocks.is_empty() {
            return Self::compress_tool_output_with_code(content, max_chars, &code_blocks);
        }

        // Standard head/tail compression (70/30 split)
        let head_chars = ((max_chars as f64) * 0.7).ceil() as usize;
        let tail_chars = max_chars.saturating_sub(head_chars);

        let head = Self::safe_substring(content, 0, head_chars);
        let tail = Self::safe_substring(
            content,
            content.len().saturating_sub(tail_chars),
            content.len(),
        );

        let omitted = content.len() - head.len() - tail.len();
        format!(
            "{}\n... [{} characters omitted] ...\n{}",
            head, omitted, tail
        )
    }

    /// Compress tool output while prioritizing code block preservation.
    fn compress_tool_output_with_code(
        content: &str,
        max_chars: usize,
        code_blocks: &[CodeBlock],
    ) -> String {
        // If we have code blocks, try to preserve them
        let total_code_chars: usize = code_blocks.iter().map(|b| b.code.len()).sum();

        if total_code_chars <= max_chars {
            // Code fits, compress surrounding text
            let remaining = max_chars.saturating_sub(total_code_chars);
            let text_before_first = code_blocks
                .first()
                .map(|b| content.get(..b.start).unwrap_or(""))
                .unwrap_or("");
            let text_after_last = code_blocks
                .last()
                .map(|b| content.get(b.end..).unwrap_or(""))
                .unwrap_or("");

            let before_budget = remaining / 2;
            let after_budget = remaining.saturating_sub(before_budget);

            let compressed_before = if text_before_first.len() > before_budget {
                format!(
                    "{}...",
                    Self::safe_substring(text_before_first, 0, before_budget)
                )
            } else {
                text_before_first.to_string()
            };

            let compressed_after = if text_after_last.len() > after_budget {
                format!(
                    "...{}",
                    Self::safe_substring(
                        text_after_last,
                        text_after_last.len().saturating_sub(after_budget),
                        text_after_last.len()
                    )
                )
            } else {
                text_after_last.to_string()
            };

            // Reconstruct with compressed code blocks
            let mut result = compressed_before;
            for block in code_blocks {
                let lang = block.language.as_deref().unwrap_or("");
                let compressed_code =
                    Self::compress_code_block(&block.code, DEFAULT_CODE_BLOCK_MAX_LINES);
                result.push_str(&format!("```{}\n{}```", lang, compressed_code));
            }
            result.push_str(&compressed_after);
            result
        } else {
            // Code blocks too large, compress them too
            let budget_per_block = max_chars / code_blocks.len().max(1);
            let lines_budget = budget_per_block / 40; // Rough estimate: 40 chars per line

            let mut result = String::new();
            for block in code_blocks {
                let lang = block.language.as_deref().unwrap_or("");
                let compressed = Self::compress_code_block(&block.code, lines_budget.max(10));
                result.push_str(&format!("```{}\n{}```\n", lang, compressed));
            }
            result
        }
    }

    /// Extract file path references from text.
    ///
    /// Detects file paths in various formats (relative, absolute, home-relative).
    ///
    /// # Arguments
    ///
    /// * `text` - The text to search for file references
    ///
    /// # Returns
    ///
    /// A vector of file path strings found in the text.
    pub fn extract_file_references(text: &str) -> Vec<String> {
        FILE_PATH_REGEX
            .captures_iter(text)
            .filter_map(|cap| cap.get(1).map(|m| m.as_str().to_string()))
            .collect()
    }

    // ========================================================================
    // Message Compression
    // ========================================================================

    /// Compress a message's content based on configuration.
    ///
    /// Applies compression to text content, code blocks, and tool outputs
    /// according to the provided configuration.
    ///
    /// # Arguments
    ///
    /// * `message` - The message to compress
    /// * `config` - Compression configuration
    ///
    /// # Returns
    ///
    /// A new message with compressed content.
    pub fn compress_message(message: &Message, config: &CompressionConfig) -> Message {
        let compressed_content: Vec<MessageContent> = message
            .content
            .iter()
            .map(|content| Self::compress_content(content, config))
            .collect();

        Message {
            id: message.id.clone(),
            role: message.role.clone(),
            created: message.created,
            content: compressed_content,
            metadata: message.metadata,
        }
    }

    /// Compress a single content block.
    fn compress_content(content: &MessageContent, config: &CompressionConfig) -> MessageContent {
        match content {
            MessageContent::Text(text_content) => {
                let compressed_text = Self::compress_code_blocks_in_text(
                    &text_content.text,
                    config.code_block_max_lines,
                );
                MessageContent::text(compressed_text)
            }
            MessageContent::ToolResponse(tool_response) => {
                Self::compress_tool_response(tool_response, config)
            }
            // Other content types pass through unchanged
            other => other.clone(),
        }
    }

    /// Compress a tool response.
    fn compress_tool_response(
        tool_response: &crate::conversation::message::ToolResponse,
        config: &CompressionConfig,
    ) -> MessageContent {
        use rmcp::model::{CallToolResult, Content, RawContent, RawTextContent};

        match &tool_response.tool_result {
            Ok(result) => {
                let compressed_content: Vec<Content> = result
                    .content
                    .iter()
                    .map(|c| {
                        if let RawContent::Text(text) = &c.raw {
                            let compressed = Self::compress_tool_output(
                                &text.text,
                                config.tool_output_max_chars,
                            );
                            Content {
                                raw: RawContent::Text(RawTextContent {
                                    text: compressed,
                                    meta: text.meta.clone(),
                                }),
                                annotations: c.annotations.clone(),
                            }
                        } else {
                            c.clone()
                        }
                    })
                    .collect();

                MessageContent::ToolResponse(crate::conversation::message::ToolResponse {
                    id: tool_response.id.clone(),
                    tool_result: Ok(CallToolResult {
                        content: compressed_content,
                        is_error: result.is_error,
                        meta: result.meta.clone(),
                        structured_content: result.structured_content.clone(),
                    }),
                    metadata: tool_response.metadata.clone(),
                })
            }
            Err(e) => MessageContent::ToolResponse(crate::conversation::message::ToolResponse {
                id: tool_response.id.clone(),
                tool_result: Err(e.clone()),
                metadata: tool_response.metadata.clone(),
            }),
        }
    }

    /// Batch compress tool results in a message array.
    ///
    /// # Arguments
    ///
    /// * `messages` - The messages to process
    /// * `max_chars` - Maximum characters for tool output
    ///
    /// # Returns
    ///
    /// A new vector of messages with compressed tool results.
    pub fn batch_compress_tool_results(messages: &[Message], max_chars: usize) -> Vec<Message> {
        let config = CompressionConfig {
            tool_output_max_chars: max_chars,
            ..Default::default()
        };

        messages
            .iter()
            .map(|msg| Self::compress_message(msg, &config))
            .collect()
    }

    // ========================================================================
    // Message Truncation
    // ========================================================================

    /// Intelligently truncate a message array to fit within token limits.
    ///
    /// Keeps the first N and last M messages, removing middle messages
    /// to fit within the token budget.
    ///
    /// # Arguments
    ///
    /// * `messages` - The messages to truncate
    /// * `max_tokens` - Maximum total tokens allowed
    /// * `keep_first` - Number of messages to keep from the start
    /// * `keep_last` - Number of messages to keep from the end
    ///
    /// # Returns
    ///
    /// A truncated vector of messages fitting within the token limit.
    pub fn truncate_messages(
        messages: &[Message],
        max_tokens: usize,
        keep_first: usize,
        keep_last: usize,
    ) -> Vec<Message> {
        if messages.is_empty() {
            return Vec::new();
        }

        let total_tokens = TokenEstimator::estimate_total_tokens(messages);
        if total_tokens <= max_tokens {
            return messages.to_vec();
        }

        let total_messages = messages.len();

        // If we can keep all requested messages, do so
        if keep_first + keep_last >= total_messages {
            return messages.to_vec();
        }

        // Start with first and last messages
        let mut result: Vec<Message> = Vec::new();
        let mut current_tokens = 0;

        // Add first messages
        for msg in messages.iter().take(keep_first) {
            let msg_tokens = TokenEstimator::estimate_message_tokens(msg);
            if current_tokens + msg_tokens <= max_tokens {
                result.push(msg.clone());
                current_tokens += msg_tokens;
            }
        }

        // Calculate tokens needed for last messages
        let last_messages: Vec<&Message> =
            messages.iter().skip(total_messages - keep_last).collect();
        let last_tokens: usize = last_messages
            .iter()
            .map(|m| TokenEstimator::estimate_message_tokens(m))
            .sum();

        // Add middle messages if there's room
        let available_for_middle = max_tokens.saturating_sub(current_tokens + last_tokens);
        let mut middle_tokens = 0;

        for msg in messages
            .iter()
            .skip(keep_first)
            .take(total_messages - keep_first - keep_last)
        {
            let msg_tokens = TokenEstimator::estimate_message_tokens(msg);
            if middle_tokens + msg_tokens <= available_for_middle {
                result.push(msg.clone());
                middle_tokens += msg_tokens;
            } else {
                break;
            }
        }

        // Add last messages
        for msg in last_messages {
            result.push(msg.clone());
        }

        result
    }

    // ========================================================================
    // Utility Functions
    // ========================================================================

    /// Safely extract a substring respecting UTF-8 boundaries.
    ///
    /// Returns a substring from `start` to `end` (exclusive), adjusted to valid
    /// UTF-8 character boundaries. The start is adjusted forward to the next
    /// character boundary, and the end is adjusted backward to the previous
    /// character boundary (or to s.len() if end >= s.len()).
    fn safe_substring(s: &str, start: usize, end: usize) -> &str {
        if s.is_empty() || start >= s.len() {
            return "";
        }

        // Find the valid start position (first char boundary >= start)
        let valid_start = s
            .char_indices()
            .map(|(i, _)| i)
            .find(|&i| i >= start)
            .unwrap_or(s.len());

        // Find the valid end position
        // If end >= s.len(), use s.len() to include the entire remaining string
        let valid_end = if end >= s.len() {
            s.len()
        } else {
            // Find the last char boundary that is <= end
            s.char_indices()
                .map(|(i, _)| i)
                .take_while(|&i| i <= end)
                .last()
                .unwrap_or(0)
        };

        if valid_start >= valid_end {
            return "";
        }

        s.get(valid_start..valid_end).unwrap_or("")
    }

    /// Calculate compression result for a message.
    pub fn calculate_compression_result(
        original: &Message,
        compressed: &Message,
    ) -> CompressionResult {
        let original_tokens = TokenEstimator::estimate_message_tokens(original);
        let compressed_tokens = TokenEstimator::estimate_message_tokens(compressed);

        CompressionResult::new(original_tokens, compressed_tokens, "message_compression")
    }

    // ========================================================================
    // Progressive Pruning Integration
    // ========================================================================

    /// Apply progressive pruning to messages based on context usage.
    ///
    /// This method combines standard compression with progressive pruning
    /// to manage context size more effectively.
    ///
    /// # Arguments
    ///
    /// * `messages` - The messages to process
    /// * `usage_ratio` - Current context usage ratio (0.0-1.0)
    /// * `compression_config` - Configuration for standard compression
    /// * `pruning_config` - Configuration for progressive pruning
    ///
    /// # Returns
    ///
    /// A new vector of messages with both compression and pruning applied.
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// let messages = vec![...];
    /// let compressed = MessageCompressor::compress_with_pruning(
    ///     &messages,
    ///     0.4, // 40% context usage
    ///     &CompressionConfig::default(),
    ///     &PruningConfig::default(),
    /// );
    /// ```
    pub fn compress_with_pruning(
        messages: &[Message],
        usage_ratio: f64,
        compression_config: &CompressionConfig,
        pruning_config: &PruningConfig,
    ) -> Vec<Message> {
        // First apply standard compression
        let compressed: Vec<Message> = messages
            .iter()
            .map(|msg| Self::compress_message(msg, compression_config))
            .collect();

        // Then apply progressive pruning based on usage ratio
        ProgressivePruner::prune_messages(&compressed, usage_ratio, pruning_config)
    }

    /// Compress tool output with progressive pruning support.
    ///
    /// This method extends the standard tool output compression with
    /// progressive pruning based on context usage.
    ///
    /// # Arguments
    ///
    /// * `content` - The tool output content to compress
    /// * `max_chars` - Maximum characters for standard compression
    /// * `usage_ratio` - Current context usage ratio (0.0-1.0)
    /// * `pruning_config` - Configuration for progressive pruning
    ///
    /// # Returns
    ///
    /// The compressed/pruned content string.
    pub fn compress_tool_output_with_pruning(
        content: &str,
        max_chars: usize,
        usage_ratio: f64,
        pruning_config: &PruningConfig,
    ) -> String {
        let pruning_level = pruning_config.get_pruning_level(usage_ratio);

        match pruning_level {
            crate::context::types::PruningLevel::HardClear => {
                ProgressivePruner::hard_clear(&pruning_config.hard_clear_placeholder)
            }
            crate::context::types::PruningLevel::SoftTrim => ProgressivePruner::soft_trim(
                content,
                pruning_config.soft_trim_head_chars,
                pruning_config.soft_trim_tail_chars,
            ),
            crate::context::types::PruningLevel::None => {
                // Apply standard compression
                Self::compress_tool_output(content, max_chars)
            }
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compress_code_block_within_limit() {
        let code = "line 1\nline 2\nline 3";
        let result = MessageCompressor::compress_code_block(code, 10);
        assert_eq!(result, code);
    }

    #[test]
    fn test_compress_code_block_exceeds_limit() {
        let lines: Vec<String> = (0..100).map(|i| format!("line {}", i)).collect();
        let code = lines.join("\n");

        let result = MessageCompressor::compress_code_block(&code, 50);

        // Should contain head lines
        assert!(result.contains("line 0"));
        assert!(result.contains("line 29")); // 60% of 50 = 30 lines (0-29)

        // Should contain omission marker
        assert!(result.contains("lines omitted"));

        // Should contain tail lines
        assert!(result.contains("line 99"));
        assert!(result.contains("line 80")); // Last 20 lines (80-99)

        // Should not contain middle lines
        assert!(!result.contains("line 50"));
    }

    #[test]
    fn test_extract_code_blocks() {
        let text = r#"
Some text before

```rust
fn main() {
    println!("Hello");
}
```

More text

```python
print("world")
```
"#;

        let blocks = MessageCompressor::extract_code_blocks(text);
        assert_eq!(blocks.len(), 2);

        assert_eq!(blocks[0].language, Some("rust".to_string()));
        assert!(blocks[0].code.contains("fn main()"));

        assert_eq!(blocks[1].language, Some("python".to_string()));
        assert!(blocks[1].code.contains("print"));
    }

    #[test]
    fn test_extract_code_blocks_no_language() {
        let text = "```\nplain code\n```";
        let blocks = MessageCompressor::extract_code_blocks(text);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].language, None);
    }

    #[test]
    fn test_compress_tool_output_within_limit() {
        let content = "Short output";
        let result = MessageCompressor::compress_tool_output(content, 100);
        assert_eq!(result, content);
    }

    #[test]
    fn test_compress_tool_output_exceeds_limit() {
        let content = "A".repeat(1000);
        let result = MessageCompressor::compress_tool_output(&content, 100);

        assert!(result.len() < content.len());
        assert!(result.contains("characters omitted"));
        assert!(result.starts_with("AAAA"));
        assert!(result.ends_with("AAAA"));
    }

    #[test]
    fn test_extract_file_references() {
        let text = "Check src/main.rs and ./lib/utils.ts for details";
        let refs = MessageCompressor::extract_file_references(text);

        assert!(refs.contains(&"src/main.rs".to_string()));
        assert!(refs.contains(&"./lib/utils.ts".to_string()));
    }

    #[test]
    fn test_compress_code_blocks_in_text() {
        let lines: Vec<String> = (0..100).map(|i| format!("    line {}", i)).collect();
        let code = lines.join("\n");
        let text = format!("Before\n```rust\n{}```\nAfter", code);

        let result = MessageCompressor::compress_code_blocks_in_text(&text, 50);

        assert!(result.contains("Before"));
        assert!(result.contains("After"));
        assert!(result.contains("lines omitted"));
    }

    #[test]
    fn test_truncate_messages_within_limit() {
        let messages = vec![
            Message::user().with_text("Hello"),
            Message::assistant().with_text("Hi there"),
        ];

        let result = MessageCompressor::truncate_messages(&messages, 10000, 1, 1);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_safe_substring() {
        let s = "Hello, 世界!";
        let result = MessageCompressor::safe_substring(s, 0, 7);
        assert_eq!(result, "Hello, ");

        // Test with multi-byte characters
        let result = MessageCompressor::safe_substring(s, 7, 13);
        assert!(result.contains("世"));
    }

    #[test]
    fn test_head_tail_ratio() {
        // Verify the 60/40 split
        let lines: Vec<String> = (0..100).map(|i| format!("line {}", i)).collect();
        let code = lines.join("\n");

        let result = MessageCompressor::compress_code_block(&code, 50);
        let result_lines: Vec<&str> = result.lines().collect();

        // Count actual content lines (excluding omission marker)
        let content_lines: Vec<&str> = result_lines
            .iter()
            .filter(|l| !l.contains("omitted"))
            .copied()
            .collect();

        // Should have approximately 50 lines (30 head + 20 tail)
        assert!(content_lines.len() >= 48 && content_lines.len() <= 52);
    }

    #[test]
    fn test_compress_tool_output_with_pruning_no_pruning() {
        let content = "A".repeat(1000);
        let config = PruningConfig::default();

        // Usage below soft_trim_ratio (0.3)
        let result =
            MessageCompressor::compress_tool_output_with_pruning(&content, 2000, 0.2, &config);

        // Should return original (no standard compression needed either)
        assert_eq!(result, content);
    }

    #[test]
    fn test_compress_tool_output_with_pruning_soft_trim() {
        let content = "A".repeat(2000);
        let config = PruningConfig::default();

        // Usage between soft_trim_ratio (0.3) and hard_clear_ratio (0.5)
        let result =
            MessageCompressor::compress_tool_output_with_pruning(&content, 3000, 0.4, &config);

        // Should be soft trimmed
        assert!(result.contains("chars omitted"));
        assert!(result.len() < content.len());
    }

    #[test]
    fn test_compress_tool_output_with_pruning_hard_clear() {
        let content = "A".repeat(2000);
        let config = PruningConfig::default();

        // Usage above hard_clear_ratio (0.5)
        let result =
            MessageCompressor::compress_tool_output_with_pruning(&content, 3000, 0.6, &config);

        // Should be hard cleared
        assert_eq!(result, "[content cleared]");
    }

    #[test]
    fn test_compress_with_pruning() {
        let messages = vec![
            Message::user().with_text("Hello"),
            Message::assistant().with_text("Hi there"),
        ];
        let compression_config = CompressionConfig::default();
        let pruning_config = PruningConfig::default();

        // Low usage - no pruning
        let result = MessageCompressor::compress_with_pruning(
            &messages,
            0.2,
            &compression_config,
            &pruning_config,
        );

        assert_eq!(result.len(), messages.len());
    }
}
