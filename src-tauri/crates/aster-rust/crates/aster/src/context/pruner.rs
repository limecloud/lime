//! Progressive Pruner Module
//!
//! This module provides progressive pruning functionality for Tool outputs
//! to manage context size while preserving important information.
//!
//! # Pruning Strategies
//!
//! - **Soft Trim**: Preserves head and tail of content, replacing middle with "..."
//! - **Hard Clear**: Completely replaces content with a placeholder
//!
//! # Example
//!
//! ```rust,ignore
//! use aster::context::pruner::ProgressivePruner;
//! use aster::context::PruningConfig;
//!
//! let config = PruningConfig::default();
//! let content = "Very long tool output...";
//!
//! // Soft trim: keep head and tail
//! let trimmed = ProgressivePruner::soft_trim(content, 500, 300);
//!
//! // Hard clear: replace with placeholder
//! let cleared = ProgressivePruner::hard_clear("[content cleared]");
//! ```

use crate::context::types::{PruningConfig, PruningLevel};
use crate::conversation::message::{Message, MessageContent};
use glob::Pattern;
use rmcp::model::{CallToolResult, Content, RawContent, RawTextContent, Role};

/// Progressive pruner for Tool output management.
///
/// Provides methods for soft trimming and hard clearing of content
/// based on context usage thresholds.
pub struct ProgressivePruner;

impl ProgressivePruner {
    // ========================================================================
    // Core Pruning Operations
    // ========================================================================

    /// Soft trim content by preserving head and tail, replacing middle with "...".
    ///
    /// # Arguments
    ///
    /// * `content` - The content to trim
    /// * `head_chars` - Number of characters to preserve from the head
    /// * `tail_chars` - Number of characters to preserve from the tail
    ///
    /// # Returns
    ///
    /// The trimmed content string. If content is shorter than head_chars + tail_chars,
    /// returns the original content unchanged.
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// let content = "A".repeat(2000);
    /// let trimmed = ProgressivePruner::soft_trim(&content, 500, 300);
    /// // Result: first 500 chars + "..." + last 300 chars
    /// ```
    pub fn soft_trim(content: &str, head_chars: usize, tail_chars: usize) -> String {
        let total_len = content.len();
        let min_len = head_chars + tail_chars;

        // If content is short enough, return unchanged
        if total_len <= min_len {
            return content.to_string();
        }

        let head = Self::safe_substring(content, 0, head_chars);
        let tail = Self::safe_substring(content, total_len.saturating_sub(tail_chars), total_len);

        let omitted = total_len - head.len() - tail.len();
        format!("{}...[{} chars omitted]...{}", head, omitted, tail)
    }

    /// Hard clear content by replacing it entirely with a placeholder.
    ///
    /// # Arguments
    ///
    /// * `placeholder` - The placeholder text to use
    ///
    /// # Returns
    ///
    /// The placeholder string.
    pub fn hard_clear(placeholder: &str) -> String {
        placeholder.to_string()
    }

    // ========================================================================
    // Message Pruning
    // ========================================================================

    /// Prune messages based on context usage ratio.
    ///
    /// This function applies progressive pruning to Tool outputs in messages
    /// based on the current context usage ratio and configuration.
    ///
    /// # Arguments
    ///
    /// * `messages` - The messages to prune
    /// * `usage_ratio` - Current context usage ratio (0.0-1.0)
    /// * `config` - Pruning configuration
    ///
    /// # Returns
    ///
    /// A new vector of messages with pruned Tool outputs.
    pub fn prune_messages(
        messages: &[Message],
        usage_ratio: f64,
        config: &PruningConfig,
    ) -> Vec<Message> {
        let pruning_level = config.get_pruning_level(usage_ratio);

        if pruning_level == PruningLevel::None {
            return messages.to_vec();
        }

        // Find indices of assistant messages to protect
        let protected_indices = Self::find_protected_indices(messages, config.keep_last_assistants);

        messages
            .iter()
            .enumerate()
            .map(|(idx, msg)| {
                if protected_indices.contains(&idx) {
                    // Protected message, don't prune
                    msg.clone()
                } else {
                    Self::prune_message(msg, pruning_level, config)
                }
            })
            .collect()
    }

    /// Prune a single message's Tool responses.
    fn prune_message(
        message: &Message,
        pruning_level: PruningLevel,
        config: &PruningConfig,
    ) -> Message {
        let pruned_content: Vec<MessageContent> = message
            .content
            .iter()
            .map(|content| Self::prune_content(content, pruning_level, config))
            .collect();

        Message {
            id: message.id.clone(),
            role: message.role.clone(),
            created: message.created,
            content: pruned_content,
            metadata: message.metadata,
        }
    }

    /// Prune a single content block.
    fn prune_content(
        content: &MessageContent,
        pruning_level: PruningLevel,
        config: &PruningConfig,
    ) -> MessageContent {
        match content {
            MessageContent::ToolResponse(tool_response) => {
                // Check if this tool should be pruned
                let tool_name = Self::extract_tool_name_from_response(tool_response);
                if !Self::is_tool_prunable(&tool_name, config) {
                    return content.clone();
                }

                Self::prune_tool_response(tool_response, pruning_level, config)
            }
            // Other content types pass through unchanged
            other => other.clone(),
        }
    }

    /// Prune a tool response based on pruning level.
    fn prune_tool_response(
        tool_response: &crate::conversation::message::ToolResponse,
        pruning_level: PruningLevel,
        config: &PruningConfig,
    ) -> MessageContent {
        match &tool_response.tool_result {
            Ok(result) => {
                let pruned_content: Vec<Content> = result
                    .content
                    .iter()
                    .map(|c| {
                        if let RawContent::Text(text) = &c.raw {
                            let pruned_text = match pruning_level {
                                PruningLevel::SoftTrim => Self::soft_trim(
                                    &text.text,
                                    config.soft_trim_head_chars,
                                    config.soft_trim_tail_chars,
                                ),
                                PruningLevel::HardClear => {
                                    Self::hard_clear(&config.hard_clear_placeholder)
                                }
                                PruningLevel::None => text.text.clone(),
                            };
                            Content {
                                raw: RawContent::Text(RawTextContent {
                                    text: pruned_text,
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
                        content: pruned_content,
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

    // ========================================================================
    // Tool Filtering
    // ========================================================================

    /// Check if a tool is allowed to be pruned based on configuration.
    ///
    /// # Arguments
    ///
    /// * `tool_name` - The name of the tool
    /// * `config` - Pruning configuration
    ///
    /// # Returns
    ///
    /// `true` if the tool can be pruned, `false` otherwise.
    pub fn is_tool_prunable(tool_name: &str, config: &PruningConfig) -> bool {
        // Check denied list first (takes precedence)
        for denied in &config.denied_tools {
            if Self::matches_pattern(tool_name, denied) {
                return false;
            }
        }

        // If allowed list is empty, all tools are allowed (except denied)
        if config.allowed_tools.is_empty() {
            return true;
        }

        // Check allowed list
        for allowed in &config.allowed_tools {
            if Self::matches_pattern(tool_name, allowed) {
                return true;
            }
        }

        false
    }

    /// Check if a tool name matches a pattern (supports glob patterns).
    fn matches_pattern(tool_name: &str, pattern: &str) -> bool {
        // Try glob pattern matching first
        if let Ok(glob_pattern) = Pattern::new(pattern) {
            return glob_pattern.matches(tool_name);
        }

        // Fall back to exact match
        tool_name == pattern
    }

    /// Extract tool name from a tool response (if available).
    fn extract_tool_name_from_response(
        tool_response: &crate::conversation::message::ToolResponse,
    ) -> String {
        // The tool name is typically stored in metadata or can be inferred
        // For now, we'll use the id as a fallback
        tool_response
            .metadata
            .as_ref()
            .and_then(|m| m.get("tool_name"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| tool_response.id.clone())
    }

    // ========================================================================
    // Helper Functions
    // ========================================================================

    /// Find indices of messages that should be protected from pruning.
    ///
    /// Protects the last N assistant messages.
    fn find_protected_indices(messages: &[Message], keep_last: usize) -> Vec<usize> {
        let mut protected = Vec::new();
        let mut assistant_count = 0;

        // Iterate in reverse to find the last N assistant messages
        for (idx, msg) in messages.iter().enumerate().rev() {
            if msg.role == Role::Assistant && assistant_count < keep_last {
                protected.push(idx);
                assistant_count += 1;
            }
        }

        protected
    }

    /// Safely extract a substring respecting UTF-8 boundaries.
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
        let valid_end = if end >= s.len() {
            s.len()
        } else {
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
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_soft_trim_short_content() {
        let content = "Short content";
        let result = ProgressivePruner::soft_trim(content, 500, 300);
        assert_eq!(result, content);
    }

    #[test]
    fn test_soft_trim_long_content() {
        let content = "A".repeat(2000);
        let result = ProgressivePruner::soft_trim(&content, 500, 300);

        // Should start with head
        assert!(result.starts_with(&"A".repeat(500)));
        // Should contain omission marker
        assert!(result.contains("chars omitted"));
        // Should end with tail
        assert!(result.ends_with(&"A".repeat(300)));
        // Should be shorter than original
        assert!(result.len() < content.len());
    }

    #[test]
    fn test_soft_trim_preserves_head_tail() {
        let content = format!("{}MIDDLE{}", "HEAD".repeat(100), "TAIL".repeat(100));
        let result = ProgressivePruner::soft_trim(&content, 400, 400);

        assert!(result.starts_with("HEAD"));
        assert!(result.ends_with("TAIL"));
        assert!(result.contains("chars omitted"));
    }

    #[test]
    fn test_hard_clear() {
        let result = ProgressivePruner::hard_clear("[content cleared]");
        assert_eq!(result, "[content cleared]");
    }

    #[test]
    fn test_is_tool_prunable_empty_lists() {
        let config = PruningConfig::default();
        assert!(ProgressivePruner::is_tool_prunable("read_file", &config));
        assert!(ProgressivePruner::is_tool_prunable("write", &config));
    }

    #[test]
    fn test_is_tool_prunable_denied_takes_precedence() {
        let config = PruningConfig::default()
            .with_allowed_tools(vec!["*".to_string()])
            .with_denied_tools(vec!["write".to_string()]);

        assert!(ProgressivePruner::is_tool_prunable("read_file", &config));
        assert!(!ProgressivePruner::is_tool_prunable("write", &config));
    }

    #[test]
    fn test_is_tool_prunable_glob_patterns() {
        let config = PruningConfig::default()
            .with_allowed_tools(vec!["read_*".to_string(), "grep".to_string()]);

        assert!(ProgressivePruner::is_tool_prunable("read_file", &config));
        assert!(ProgressivePruner::is_tool_prunable("read_dir", &config));
        assert!(ProgressivePruner::is_tool_prunable("grep", &config));
        assert!(!ProgressivePruner::is_tool_prunable("write", &config));
    }

    #[test]
    fn test_is_tool_prunable_denied_glob() {
        let config = PruningConfig::default().with_denied_tools(vec!["write_*".to_string()]);

        assert!(ProgressivePruner::is_tool_prunable("read_file", &config));
        assert!(!ProgressivePruner::is_tool_prunable("write_file", &config));
        assert!(!ProgressivePruner::is_tool_prunable("write_dir", &config));
    }

    #[test]
    fn test_safe_substring_ascii() {
        let s = "Hello, World!";
        assert_eq!(ProgressivePruner::safe_substring(s, 0, 5), "Hello");
        assert_eq!(ProgressivePruner::safe_substring(s, 7, 12), "World");
    }

    #[test]
    fn test_safe_substring_unicode() {
        let s = "Hello, 世界!";
        let result = ProgressivePruner::safe_substring(s, 0, 7);
        assert_eq!(result, "Hello, ");

        // Test with multi-byte characters
        let result = ProgressivePruner::safe_substring(s, 7, 13);
        assert!(result.contains("世"));
    }

    #[test]
    fn test_safe_substring_empty() {
        assert_eq!(ProgressivePruner::safe_substring("", 0, 10), "");
        assert_eq!(ProgressivePruner::safe_substring("hello", 10, 20), "");
    }

    #[test]
    fn test_find_protected_indices() {
        let messages = vec![
            Message::user().with_text("user 1"),
            Message::assistant().with_text("assistant 1"),
            Message::user().with_text("user 2"),
            Message::assistant().with_text("assistant 2"),
            Message::user().with_text("user 3"),
            Message::assistant().with_text("assistant 3"),
        ];

        let protected = ProgressivePruner::find_protected_indices(&messages, 2);

        // Should protect the last 2 assistant messages (indices 5 and 3)
        assert!(protected.contains(&5));
        assert!(protected.contains(&3));
        assert!(!protected.contains(&1));
    }

    #[test]
    fn test_prune_messages_no_pruning() {
        let messages = vec![
            Message::user().with_text("Hello"),
            Message::assistant().with_text("Hi there"),
        ];
        let config = PruningConfig::default();

        // Usage ratio below soft_trim_ratio (0.3)
        let result = ProgressivePruner::prune_messages(&messages, 0.2, &config);

        assert_eq!(result.len(), messages.len());
    }
}
