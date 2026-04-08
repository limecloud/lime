//! Enhanced Context Manager Module
//!
//! This module provides comprehensive context management functionality including:
//!
//! - Conversation turn storage with token estimates
//! - Automatic compression when threshold is exceeded
//! - AI-powered and simple summarization
//! - Export/import of context state
//! - Statistics and reporting
//! - Tool reference collapsing
//!
//! # Example
//!
//! ```rust,ignore
//! use aster::context::manager::EnhancedContextManager;
//! use aster::context::types::ContextConfig;
//!
//! let config = ContextConfig::default();
//! let mut manager = EnhancedContextManager::new(config);
//! manager.set_system_prompt("You are a helpful assistant.");
//!
//! // Add conversation turns
//! manager.add_turn(user_message, assistant_message, Some(usage));
//!
//! // Get messages for API call
//! let messages = manager.get_messages();
//! ```

use crate::context::compressor::MessageCompressor;
use crate::context::summarizer::{Summarizer, SummarizerClient, DEFAULT_SUMMARY_BUDGET};
use crate::context::token_estimator::TokenEstimator;
use crate::context::types::{
    CompressionConfig, CompressionDetails, CompressionResult, ContextConfig, ContextError,
    ContextExport, ContextStats, ContextUsage, ConversationTurn, TokenUsage,
};
use crate::conversation::message::{Message, MessageContent};
use std::sync::Arc;

// ============================================================================
// Constants
// ============================================================================

/// Placeholder text for collapsed tool references
const TOOL_REFERENCE_PLACEHOLDER: &str = "[Tool reference collapsed]";

/// Summary message prefix
const SUMMARY_PREFIX: &str = "[Previous conversation summary]\n";

// ============================================================================
// EnhancedContextManager
// ============================================================================

/// Enhanced context manager with compression, summarization, and statistics.
///
/// Manages conversation history with automatic compression when token limits
/// are approached, supports AI-powered summarization, and provides detailed
/// statistics about context usage.
pub struct EnhancedContextManager {
    /// Configuration for the context manager
    config: ContextConfig,

    /// Stored conversation turns
    turns: Vec<ConversationTurn>,

    /// System prompt for the conversation
    system_prompt: String,

    /// Number of compression operations performed
    compression_count: usize,

    /// Total tokens saved through compression
    saved_tokens: usize,

    /// Optional client for AI summarization
    summarizer_client: Option<Arc<dyn SummarizerClient>>,
}

impl EnhancedContextManager {
    // ========================================================================
    // Constructor and Setup (Task 14.1)
    // ========================================================================

    /// Create a new EnhancedContextManager with the given configuration.
    ///
    /// # Arguments
    ///
    /// * `config` - Configuration for token limits, compression thresholds, etc.
    ///
    /// # Returns
    ///
    /// A new EnhancedContextManager instance.
    pub fn new(config: ContextConfig) -> Self {
        Self {
            config,
            turns: Vec::new(),
            system_prompt: String::new(),
            compression_count: 0,
            saved_tokens: 0,
            summarizer_client: None,
        }
    }

    /// Create a new EnhancedContextManager with default configuration.
    pub fn with_default_config() -> Self {
        Self::new(ContextConfig::default())
    }

    /// Set the system prompt for the conversation.
    ///
    /// # Arguments
    ///
    /// * `prompt` - The system prompt text
    pub fn set_system_prompt(&mut self, prompt: impl Into<String>) {
        self.system_prompt = prompt.into();
    }

    /// Get the current system prompt.
    pub fn system_prompt(&self) -> &str {
        &self.system_prompt
    }

    /// Set the summarizer client for AI-powered summarization.
    ///
    /// # Arguments
    ///
    /// * `client` - The summarizer client implementation
    pub fn set_summarizer_client(&mut self, client: Arc<dyn SummarizerClient>) {
        self.summarizer_client = Some(client);
    }

    /// Check if AI summarization is available.
    pub fn has_summarizer_client(&self) -> bool {
        self.summarizer_client.is_some() && self.config.enable_ai_summary
    }

    // ========================================================================
    // Turn Management (Task 14.1)
    // ========================================================================

    /// Add a conversation turn (user message + assistant response).
    ///
    /// Estimates tokens for the turn and optionally applies incremental
    /// compression if enabled in the configuration.
    ///
    /// # Arguments
    ///
    /// * `user` - The user's message
    /// * `assistant` - The assistant's response
    /// * `api_usage` - Optional token usage from the API call
    pub fn add_turn(&mut self, user: Message, assistant: Message, api_usage: Option<TokenUsage>) {
        // Estimate tokens for the turn
        let user_tokens = TokenEstimator::estimate_message_tokens(&user);
        let assistant_tokens = TokenEstimator::estimate_message_tokens(&assistant);
        let total_tokens = user_tokens + assistant_tokens;

        // Apply incremental compression if enabled
        let (final_user, final_assistant, final_tokens) = if self
            .config
            .enable_incremental_compression
        {
            let compression_config = CompressionConfig {
                code_block_max_lines: self.config.code_block_max_lines,
                tool_output_max_chars: self.config.tool_output_max_chars,
                ..Default::default()
            };

            let compressed_user = MessageCompressor::compress_message(&user, &compression_config);
            let compressed_assistant =
                MessageCompressor::compress_message(&assistant, &compression_config);

            let compressed_user_tokens = TokenEstimator::estimate_message_tokens(&compressed_user);
            let compressed_assistant_tokens =
                TokenEstimator::estimate_message_tokens(&compressed_assistant);
            let compressed_total = compressed_user_tokens + compressed_assistant_tokens;

            (compressed_user, compressed_assistant, compressed_total)
        } else {
            (user, assistant, total_tokens)
        };

        // Create the turn
        let mut turn = ConversationTurn::new(final_user, final_assistant, final_tokens);
        turn.original_tokens = total_tokens;

        // Mark as compressed if tokens were saved
        if final_tokens < total_tokens {
            turn.compressed = true;
            self.saved_tokens += total_tokens - final_tokens;
        }

        // Add API usage if provided
        if let Some(usage) = api_usage {
            turn.api_usage = Some(usage);
        }

        self.turns.push(turn);
    }

    /// Get the number of conversation turns.
    pub fn turn_count(&self) -> usize {
        self.turns.len()
    }

    /// Get a reference to all conversation turns.
    pub fn turns(&self) -> &[ConversationTurn] {
        &self.turns
    }

    /// Get a mutable reference to all conversation turns.
    pub fn turns_mut(&mut self) -> &mut Vec<ConversationTurn> {
        &mut self.turns
    }

    // ========================================================================
    // Message Retrieval (Task 14.1)
    // ========================================================================

    /// Get all messages for an API call.
    ///
    /// Returns messages in the correct order for sending to an LLM:
    /// 1. System prompt (if set)
    /// 2. Summary of old turns (if any are summarized)
    /// 3. All conversation turns (user/assistant pairs)
    ///
    /// # Returns
    ///
    /// A vector of messages ready for an API call.
    pub fn get_messages(&self) -> Vec<Message> {
        let mut messages: Vec<Message> = Vec::new();

        // Add system prompt if set
        if !self.system_prompt.is_empty() {
            messages.push(Message::user().with_text(&self.system_prompt));
        }

        // Check if we have any summarized turns
        let summarized_turns: Vec<&ConversationTurn> =
            self.turns.iter().filter(|t| t.summarized).collect();

        if !summarized_turns.is_empty() {
            // Combine summaries into a single message
            let combined_summary = summarized_turns
                .iter()
                .filter_map(|t| t.summary.as_ref())
                .cloned()
                .collect::<Vec<_>>()
                .join("\n\n");

            if !combined_summary.is_empty() {
                let summary_text = format!("{}{}", SUMMARY_PREFIX, combined_summary);
                messages.push(Message::user().with_text(summary_text));
            }
        }

        // Add non-summarized turns
        for turn in &self.turns {
            if !turn.summarized {
                messages.push(turn.user.clone());
                messages.push(turn.assistant.clone());
            }
        }

        messages
    }

    /// Get messages with tool references collapsed.
    ///
    /// Similar to `get_messages()` but collapses tool_reference blocks
    /// to placeholder text to save tokens.
    pub fn get_messages_collapsed(&self) -> Vec<Message> {
        self.get_messages()
            .into_iter()
            .map(|msg| Self::collapse_tool_references(&msg))
            .collect()
    }

    // ========================================================================
    // Token Management (Task 14.2)
    // ========================================================================

    /// Get the number of tokens currently used in context.
    ///
    /// Includes system prompt tokens and all turn tokens.
    pub fn get_used_tokens(&self) -> usize {
        let system_tokens = TokenEstimator::estimate_tokens(&self.system_prompt);
        let turn_tokens: usize = self.turns.iter().map(|t| t.token_estimate).sum();
        system_tokens + turn_tokens
    }

    /// Get the number of available tokens (max - used).
    pub fn get_available_tokens(&self) -> usize {
        let available = self.config.available_tokens();
        let used = self.get_used_tokens();
        available.saturating_sub(used)
    }

    /// Check if compression should be triggered based on threshold.
    fn should_compress(&self) -> bool {
        let used = self.get_used_tokens();
        let threshold = self.config.summarize_token_threshold();
        used > threshold
    }

    // ========================================================================
    // Compression (Task 14.2)
    // ========================================================================

    /// Check and perform compression if threshold is exceeded.
    ///
    /// This method is called automatically after adding turns if
    /// auto-compression is needed.
    ///
    /// # Returns
    ///
    /// Ok(()) if compression was successful or not needed.
    pub async fn maybe_compress(&mut self) -> Result<(), ContextError> {
        if self.should_compress() {
            self.compact().await?;
        }
        Ok(())
    }

    /// Force compression of old conversation turns.
    ///
    /// Summarizes older turns while keeping recent messages intact.
    /// Uses AI summarization if available, otherwise falls back to
    /// simple text extraction.
    ///
    /// # Returns
    ///
    /// Ok(()) if compression was successful.
    pub async fn compact(&mut self) -> Result<(), ContextError> {
        let total_turns = self.turns.len();
        if total_turns == 0 {
            return Ok(());
        }

        // Determine which turns to summarize (keep recent ones)
        let keep_recent = self.config.keep_recent_messages.min(total_turns);
        let turns_to_summarize = total_turns.saturating_sub(keep_recent);

        if turns_to_summarize == 0 {
            return Ok(());
        }

        // Get turns to summarize (excluding already summarized ones)
        let unsummarized_indices: Vec<usize> = self
            .turns
            .iter()
            .enumerate()
            .take(turns_to_summarize)
            .filter(|(_, t)| !t.summarized)
            .map(|(i, _)| i)
            .collect();

        if unsummarized_indices.is_empty() {
            return Ok(());
        }

        // Collect turns for summarization
        let turns_for_summary: Vec<ConversationTurn> = unsummarized_indices
            .iter()
            .map(|&i| self.turns[i].clone())
            .collect();

        // Generate summary
        let summary = if self.has_summarizer_client() {
            let client = self.summarizer_client.as_ref().unwrap();
            Summarizer::generate_ai_summary(
                &turns_for_summary,
                client.as_ref(),
                DEFAULT_SUMMARY_BUDGET,
            )
            .await?
        } else {
            Summarizer::create_simple_summary(&turns_for_summary)
        };

        // Calculate tokens saved
        let original_tokens: usize = turns_for_summary.iter().map(|t| t.token_estimate).sum();
        let summary_tokens = TokenEstimator::estimate_tokens(&summary);

        // Mark turns as summarized
        for &idx in &unsummarized_indices {
            let turn = &mut self.turns[idx];
            turn.mark_summarized(summary.clone(), summary_tokens / unsummarized_indices.len());
        }

        // Update statistics
        self.compression_count += 1;
        self.saved_tokens += original_tokens.saturating_sub(summary_tokens);

        Ok(())
    }

    // ========================================================================
    // Export/Import (Task 14.4)
    // ========================================================================

    /// Export the context state for persistence.
    ///
    /// # Returns
    ///
    /// A ContextExport struct that can be serialized.
    pub fn export(&self) -> ContextExport {
        ContextExport::new(
            self.system_prompt.clone(),
            self.turns.clone(),
            self.config.clone(),
            self.compression_count,
            self.saved_tokens,
        )
    }

    /// Import context state from an export.
    ///
    /// Replaces the current state with the imported data.
    ///
    /// # Arguments
    ///
    /// * `data` - The exported context data to import
    pub fn import(&mut self, data: ContextExport) {
        self.system_prompt = data.system_prompt;
        self.turns = data.turns;
        self.config = data.config;
        self.compression_count = data.compression_count;
        self.saved_tokens = data.saved_tokens;
    }

    /// Clear all conversation history.
    ///
    /// Resets turns and statistics but preserves configuration
    /// and system prompt.
    pub fn clear(&mut self) {
        self.turns.clear();
        self.compression_count = 0;
        self.saved_tokens = 0;
    }

    /// Clear everything including system prompt.
    pub fn reset(&mut self) {
        self.clear();
        self.system_prompt.clear();
    }

    // ========================================================================
    // Statistics and Reporting (Task 14.6)
    // ========================================================================

    /// Get statistics about the current context state.
    pub fn get_stats(&self) -> ContextStats {
        let total_messages = self.turns.len() * 2; // user + assistant per turn
        let estimated_tokens = self.get_used_tokens();
        let summarized_messages = self.turns.iter().filter(|t| t.summarized).count() * 2;

        let original_tokens: usize = self.turns.iter().map(|t| t.original_tokens).sum();
        let current_tokens: usize = self.turns.iter().map(|t| t.token_estimate).sum();

        let compression_ratio = if original_tokens > 0 {
            current_tokens as f64 / original_tokens as f64
        } else {
            1.0
        };

        ContextStats {
            total_messages,
            estimated_tokens,
            summarized_messages,
            compression_ratio,
            saved_tokens: self.saved_tokens,
            compression_count: self.compression_count,
        }
    }

    /// Get detailed compression information.
    pub fn get_compression_details(&self) -> CompressionDetails {
        let total_turns = self.turns.len();
        let summarized_turns = self.turns.iter().filter(|t| t.summarized).count();
        let compressed_turns = self.turns.iter().filter(|t| t.compressed).count();
        let recent_turns = total_turns.saturating_sub(summarized_turns);

        let original_tokens: usize = self.turns.iter().map(|t| t.original_tokens).sum();
        let current_tokens: usize = self.turns.iter().map(|t| t.token_estimate).sum();

        let compression_ratio = if original_tokens > 0 {
            current_tokens as f64 / original_tokens as f64
        } else {
            1.0
        };

        CompressionDetails {
            total_turns,
            summarized_turns,
            compressed_turns,
            recent_turns,
            compression_ratio,
            saved_tokens: self.saved_tokens,
        }
    }

    /// Get current context usage information.
    pub fn get_context_usage(&self) -> ContextUsage {
        let used = self.get_used_tokens();
        let total = self.config.max_tokens;
        ContextUsage::new(used, total)
    }

    /// Check if context is near the limit.
    ///
    /// Returns true if usage exceeds the summarize threshold.
    pub fn is_near_limit(&self) -> bool {
        let usage = self.get_context_usage();
        usage.percentage > (self.config.summarize_threshold * 100.0)
    }

    /// Get a formatted statistics report.
    pub fn get_formatted_report(&self) -> String {
        let stats = self.get_stats();
        let usage = self.get_context_usage();
        let details = self.get_compression_details();

        format!(
            "Context Statistics:\n\
             - Total messages: {}\n\
             - Estimated tokens: {} / {} ({:.1}%)\n\
             - Available tokens: {}\n\
             - Summarized messages: {}\n\
             - Compression ratio: {:.2}\n\
             - Tokens saved: {}\n\
             - Compression operations: {}\n\
             \n\
             Compression Details:\n\
             - Total turns: {}\n\
             - Summarized turns: {}\n\
             - Compressed turns: {}\n\
             - Recent turns: {}",
            stats.total_messages,
            usage.used,
            usage.total,
            usage.percentage,
            usage.available,
            stats.summarized_messages,
            stats.compression_ratio,
            stats.saved_tokens,
            stats.compression_count,
            details.total_turns,
            details.summarized_turns,
            details.compressed_turns,
            details.recent_turns,
        )
    }

    /// Analyze compression effectiveness.
    pub fn analyze_compression(&self) -> CompressionResult {
        let original_tokens: usize = self.turns.iter().map(|t| t.original_tokens).sum();
        let current_tokens: usize = self.turns.iter().map(|t| t.token_estimate).sum();

        CompressionResult::new(original_tokens, current_tokens, "context_compression")
    }

    // ========================================================================
    // Tool Reference Collapsing (Task 14.7)
    // ========================================================================

    /// Collapse tool references in a message to placeholder text.
    ///
    /// Detects tool_reference content blocks and replaces them with
    /// a placeholder to save tokens.
    ///
    /// # Arguments
    ///
    /// * `message` - The message to process
    ///
    /// # Returns
    ///
    /// A new message with tool references collapsed.
    pub fn collapse_tool_references(message: &Message) -> Message {
        let mut has_non_reference = false;
        let mut has_reference = false;

        // First pass: check what types of content we have
        for content in &message.content {
            match content {
                MessageContent::ToolResponse(resp) => {
                    // Check if this is a tool reference (contains reference marker)
                    if Self::is_tool_reference_response(resp) {
                        has_reference = true;
                    } else {
                        has_non_reference = true;
                    }
                }
                _ => {
                    has_non_reference = true;
                }
            }
        }

        // If no references, return unchanged
        if !has_reference {
            return message.clone();
        }

        // Second pass: build new content
        let mut new_content: Vec<MessageContent> = Vec::new();
        let mut reference_collapsed = false;

        for content in &message.content {
            match content {
                MessageContent::ToolResponse(resp) => {
                    if Self::is_tool_reference_response(resp) {
                        // Collapse to placeholder (only add one placeholder)
                        if !reference_collapsed {
                            new_content.push(MessageContent::text(TOOL_REFERENCE_PLACEHOLDER));
                            reference_collapsed = true;
                        }
                    } else {
                        new_content.push(content.clone());
                    }
                }
                _ => {
                    new_content.push(content.clone());
                }
            }
        }

        // If all content was references, ensure we have at least the placeholder
        if (new_content.is_empty() || (!has_non_reference && reference_collapsed))
            && new_content.is_empty()
        {
            new_content.push(MessageContent::text(TOOL_REFERENCE_PLACEHOLDER));
        }

        Message {
            id: message.id.clone(),
            role: message.role.clone(),
            created: message.created,
            content: new_content,
            metadata: message.metadata,
        }
    }

    /// Check if a tool response is a tool reference.
    ///
    /// Tool references typically contain markers like "tool_reference" or
    /// specific patterns indicating they're references to previous tool calls.
    fn is_tool_reference_response(resp: &crate::conversation::message::ToolResponse) -> bool {
        if let Ok(result) = &resp.tool_result {
            for content in &result.content {
                if let Some(text) = content.as_text() {
                    // Check for common tool reference patterns
                    if text.text.contains("tool_reference")
                        || text.text.contains("[Reference to tool")
                        || text.text.starts_with("ref:")
                    {
                        return true;
                    }
                }
            }
        }
        false
    }

    // ========================================================================
    // Configuration Access
    // ========================================================================

    /// Get a reference to the current configuration.
    pub fn config(&self) -> &ContextConfig {
        &self.config
    }

    /// Get a mutable reference to the configuration.
    pub fn config_mut(&mut self) -> &mut ContextConfig {
        &mut self.config
    }

    /// Update the configuration.
    pub fn set_config(&mut self, config: ContextConfig) {
        self.config = config;
    }
}

impl Default for EnhancedContextManager {
    fn default() -> Self {
        Self::with_default_config()
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_message(text: &str, is_user: bool) -> Message {
        if is_user {
            Message::user().with_text(text)
        } else {
            Message::assistant().with_text(text)
        }
    }

    #[test]
    fn test_new_manager() {
        let config = ContextConfig::default();
        let manager = EnhancedContextManager::new(config);

        assert_eq!(manager.turn_count(), 0);
        assert!(manager.system_prompt().is_empty());
        assert!(!manager.has_summarizer_client());
    }

    #[test]
    fn test_set_system_prompt() {
        let mut manager = EnhancedContextManager::default();
        manager.set_system_prompt("You are a helpful assistant.");

        assert_eq!(manager.system_prompt(), "You are a helpful assistant.");
    }

    #[test]
    fn test_add_turn() {
        let mut manager = EnhancedContextManager::default();

        let user = create_test_message("Hello", true);
        let assistant = create_test_message("Hi there!", false);

        manager.add_turn(user, assistant, None);

        assert_eq!(manager.turn_count(), 1);
        assert!(manager.get_used_tokens() > 0);
    }

    #[test]
    fn test_add_turn_with_usage() {
        let mut manager = EnhancedContextManager::default();

        let user = create_test_message("Hello", true);
        let assistant = create_test_message("Hi there!", false);
        let usage = TokenUsage::new(10, 20);

        manager.add_turn(user, assistant, Some(usage));

        assert_eq!(manager.turn_count(), 1);
        let turn = &manager.turns()[0];
        assert!(turn.api_usage.is_some());
        assert_eq!(turn.api_usage.as_ref().unwrap().input_tokens, 10);
    }

    #[test]
    fn test_get_messages_empty() {
        let manager = EnhancedContextManager::default();
        let messages = manager.get_messages();
        assert!(messages.is_empty());
    }

    #[test]
    fn test_get_messages_with_system_prompt() {
        let mut manager = EnhancedContextManager::default();
        manager.set_system_prompt("System prompt");

        let messages = manager.get_messages();
        assert_eq!(messages.len(), 1);
    }

    #[test]
    fn test_get_messages_with_turns() {
        let mut manager = EnhancedContextManager::default();
        manager.set_system_prompt("System prompt");

        let user = create_test_message("Hello", true);
        let assistant = create_test_message("Hi!", false);
        manager.add_turn(user, assistant, None);

        let messages = manager.get_messages();
        // System prompt + user + assistant = 3 messages
        assert_eq!(messages.len(), 3);
    }

    #[test]
    fn test_get_used_tokens() {
        let mut manager = EnhancedContextManager::default();
        manager.set_system_prompt("Short prompt");

        let initial_tokens = manager.get_used_tokens();
        assert!(initial_tokens > 0);

        let user = create_test_message("Hello world", true);
        let assistant = create_test_message("Hi there!", false);
        manager.add_turn(user, assistant, None);

        let after_turn_tokens = manager.get_used_tokens();
        assert!(after_turn_tokens > initial_tokens);
    }

    #[test]
    fn test_get_available_tokens() {
        let config = ContextConfig {
            max_tokens: 1000,
            reserve_tokens: 200,
            ..Default::default()
        };
        let manager = EnhancedContextManager::new(config);

        // Available = max - reserve - used
        // With empty context, used is 0
        assert_eq!(manager.get_available_tokens(), 800);
    }

    #[test]
    fn test_export_import() {
        let mut manager = EnhancedContextManager::default();
        manager.set_system_prompt("Test prompt");

        let user = create_test_message("Hello", true);
        let assistant = create_test_message("Hi!", false);
        manager.add_turn(user, assistant, None);

        // Export
        let export = manager.export();
        assert_eq!(export.system_prompt, "Test prompt");
        assert_eq!(export.turns.len(), 1);

        // Import into new manager
        let mut new_manager = EnhancedContextManager::default();
        new_manager.import(export);

        assert_eq!(new_manager.system_prompt(), "Test prompt");
        assert_eq!(new_manager.turn_count(), 1);
    }

    #[test]
    fn test_clear() {
        let mut manager = EnhancedContextManager::default();
        manager.set_system_prompt("Test prompt");

        let user = create_test_message("Hello", true);
        let assistant = create_test_message("Hi!", false);
        manager.add_turn(user, assistant, None);

        manager.clear();

        assert_eq!(manager.turn_count(), 0);
        assert_eq!(manager.system_prompt(), "Test prompt"); // Preserved
    }

    #[test]
    fn test_reset() {
        let mut manager = EnhancedContextManager::default();
        manager.set_system_prompt("Test prompt");

        let user = create_test_message("Hello", true);
        let assistant = create_test_message("Hi!", false);
        manager.add_turn(user, assistant, None);

        manager.reset();

        assert_eq!(manager.turn_count(), 0);
        assert!(manager.system_prompt().is_empty()); // Cleared
    }

    #[test]
    fn test_get_stats() {
        let mut manager = EnhancedContextManager::default();

        let user = create_test_message("Hello", true);
        let assistant = create_test_message("Hi!", false);
        manager.add_turn(user, assistant, None);

        let stats = manager.get_stats();
        assert_eq!(stats.total_messages, 2); // 1 turn = 2 messages
        assert!(stats.estimated_tokens > 0);
        assert_eq!(stats.summarized_messages, 0);
    }

    #[test]
    fn test_get_compression_details() {
        let mut manager = EnhancedContextManager::default();

        let user = create_test_message("Hello", true);
        let assistant = create_test_message("Hi!", false);
        manager.add_turn(user, assistant, None);

        let details = manager.get_compression_details();
        assert_eq!(details.total_turns, 1);
        assert_eq!(details.summarized_turns, 0);
        assert_eq!(details.recent_turns, 1);
    }

    #[test]
    fn test_get_context_usage() {
        let config = ContextConfig {
            max_tokens: 1000,
            ..Default::default()
        };
        let mut manager = EnhancedContextManager::new(config);

        let user = create_test_message("Hello", true);
        let assistant = create_test_message("Hi!", false);
        manager.add_turn(user, assistant, None);

        let usage = manager.get_context_usage();
        assert!(usage.used > 0);
        assert_eq!(usage.total, 1000);
        assert!(usage.percentage > 0.0);
    }

    #[test]
    fn test_is_near_limit() {
        let config = ContextConfig {
            max_tokens: 100,
            summarize_threshold: 0.5, // 50%
            ..Default::default()
        };
        let mut manager = EnhancedContextManager::new(config);

        // Initially not near limit
        assert!(!manager.is_near_limit());

        // Add enough content to exceed threshold
        let long_text = "A".repeat(200);
        let user = create_test_message(&long_text, true);
        let assistant = create_test_message(&long_text, false);
        manager.add_turn(user, assistant, None);

        // Now should be near limit
        assert!(manager.is_near_limit());
    }

    #[test]
    fn test_get_formatted_report() {
        let mut manager = EnhancedContextManager::default();

        let user = create_test_message("Hello", true);
        let assistant = create_test_message("Hi!", false);
        manager.add_turn(user, assistant, None);

        let report = manager.get_formatted_report();
        assert!(report.contains("Context Statistics"));
        assert!(report.contains("Total messages"));
        assert!(report.contains("Compression Details"));
    }

    #[test]
    fn test_analyze_compression() {
        let mut manager = EnhancedContextManager::default();

        let user = create_test_message("Hello", true);
        let assistant = create_test_message("Hi!", false);
        manager.add_turn(user, assistant, None);

        let result = manager.analyze_compression();
        assert!(result.original_tokens > 0);
        assert!(result.compressed_tokens > 0);
    }

    #[test]
    fn test_collapse_tool_references_no_references() {
        let message = Message::user().with_text("Hello world");
        let collapsed = EnhancedContextManager::collapse_tool_references(&message);

        // Should be unchanged
        assert_eq!(collapsed.content.len(), 1);
    }

    #[test]
    fn test_should_compress() {
        let config = ContextConfig {
            max_tokens: 100,
            summarize_threshold: 0.5,
            ..Default::default()
        };
        let mut manager = EnhancedContextManager::new(config);

        // Initially should not compress
        assert!(!manager.should_compress());

        // Add content to exceed threshold
        let long_text = "A".repeat(200);
        let user = create_test_message(&long_text, true);
        let assistant = create_test_message(&long_text, false);
        manager.add_turn(user, assistant, None);

        // Now should compress
        assert!(manager.should_compress());
    }

    #[tokio::test]
    async fn test_compact_empty() {
        let mut manager = EnhancedContextManager::default();
        let result = manager.compact().await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_compact_with_turns() {
        let config = ContextConfig {
            keep_recent_messages: 1,
            ..Default::default()
        };
        let mut manager = EnhancedContextManager::new(config);

        // Add multiple turns
        for i in 0..5 {
            let user = create_test_message(&format!("Message {}", i), true);
            let assistant = create_test_message(&format!("Response {}", i), false);
            manager.add_turn(user, assistant, None);
        }

        let result = manager.compact().await;
        assert!(result.is_ok());

        // Check that some turns were summarized
        let summarized_count = manager.turns().iter().filter(|t| t.summarized).count();
        assert!(summarized_count > 0);
    }

    #[tokio::test]
    async fn test_maybe_compress_below_threshold() {
        let config = ContextConfig {
            max_tokens: 100000,
            summarize_threshold: 0.9,
            ..Default::default()
        };
        let mut manager = EnhancedContextManager::new(config);

        let user = create_test_message("Hello", true);
        let assistant = create_test_message("Hi!", false);
        manager.add_turn(user, assistant, None);

        let result = manager.maybe_compress().await;
        assert!(result.is_ok());

        // Should not have compressed (below threshold)
        assert_eq!(manager.compression_count, 0);
    }
}
