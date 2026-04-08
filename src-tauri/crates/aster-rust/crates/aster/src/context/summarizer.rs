//! Summarizer Module
//!
//! This module provides intelligent message summarization functionality to compress
//! old conversations while preserving key information. It supports:
//!
//! - AI-powered summarization using LLM
//! - Simple text extraction fallback
//! - Budget-aware message collection
//! - Conversation turn formatting
//!
//! # Example
//!
//! ```rust,ignore
//! use aster::context::summarizer::Summarizer;
//! use aster::context::types::ConversationTurn;
//!
//! let turns: Vec<ConversationTurn> = vec![/* ... */];
//! let summary = Summarizer::create_simple_summary(&turns);
//! ```

use crate::context::token_estimator::TokenEstimator;
use crate::context::types::{ContextError, ConversationTurn, TokenUsage};
use crate::conversation::message::{Message, MessageContent};
use async_trait::async_trait;
use rmcp::model::Content;
use std::result::Result;

// ============================================================================
// Constants
// ============================================================================

/// System prompt for AI summarization
pub const SUMMARY_SYSTEM_PROMPT: &str =
    "Summarize this coding conversation in under 50 characters.\n\
     Capture the main task, key files, problems addressed, and current status.";

/// Default context budget for summarization (in tokens)
pub const DEFAULT_SUMMARY_BUDGET: usize = 4000;

/// Maximum summary length in characters
pub const MAX_SUMMARY_LENGTH: usize = 500;

// ============================================================================
// SummarizerClient Trait
// ============================================================================

/// Response from the summarizer client
#[derive(Debug, Clone)]
pub struct SummarizerResponse {
    /// Content blocks from the response
    pub content: Vec<Content>,
    /// Token usage statistics
    pub usage: Option<TokenUsage>,
}

impl SummarizerResponse {
    /// Create a new SummarizerResponse
    pub fn new(content: Vec<Content>, usage: Option<TokenUsage>) -> Self {
        Self { content, usage }
    }

    /// Extract text content from the response
    pub fn text(&self) -> String {
        self.content
            .iter()
            .filter_map(|c| c.as_text().map(|t| t.text.clone()))
            .collect::<Vec<_>>()
            .join("")
    }
}

/// Trait for clients that can generate AI summaries.
///
/// This trait abstracts the LLM client interface, allowing for different
/// implementations (e.g., Anthropic, OpenAI) or mock clients for testing.
#[async_trait]
pub trait SummarizerClient: Send + Sync {
    /// Create a message using the LLM.
    ///
    /// # Arguments
    ///
    /// * `messages` - The conversation messages to send
    /// * `system_prompt` - Optional system prompt to guide the response
    ///
    /// # Returns
    ///
    /// A `SummarizerResponse` containing the generated content and usage stats.
    async fn create_message(
        &self,
        messages: Vec<Message>,
        system_prompt: Option<&str>,
    ) -> Result<SummarizerResponse, ContextError>;
}

// ============================================================================
// Summarizer
// ============================================================================

/// Intelligent summarizer for conversation turns.
///
/// Provides methods to generate concise summaries of conversation history,
/// either using AI or simple text extraction.
pub struct Summarizer;

impl Summarizer {
    /// Generate an AI-powered summary of conversation turns.
    ///
    /// Uses an LLM to create a concise summary capturing the main task,
    /// key files, problems addressed, and current status.
    ///
    /// # Arguments
    ///
    /// * `turns` - The conversation turns to summarize
    /// * `client` - The LLM client to use for summarization
    /// * `context_budget` - Maximum tokens to include in the summarization request
    ///
    /// # Returns
    ///
    /// A summary string, or falls back to simple summary on failure.
    pub async fn generate_ai_summary(
        turns: &[ConversationTurn],
        client: &dyn SummarizerClient,
        context_budget: usize,
    ) -> Result<String, ContextError> {
        if turns.is_empty() {
            return Ok(String::new());
        }

        // Collect turns within budget
        let (collected_turns, _tokens_used) = Self::collect_within_budget(turns, context_budget);

        if collected_turns.is_empty() {
            return Ok(Self::create_simple_summary(turns));
        }

        // Format turns as text for summarization
        let formatted_text = Self::format_turns_as_text(&collected_turns);

        // Create the summarization request
        let messages = vec![Message::user().with_text(formatted_text)];

        // Call the LLM
        match client
            .create_message(messages, Some(SUMMARY_SYSTEM_PROMPT))
            .await
        {
            Ok(response) => {
                let summary = response.text();
                if summary.is_empty() {
                    // Fall back to simple summary if AI returns empty
                    Ok(Self::create_simple_summary(turns))
                } else {
                    // Truncate if too long
                    Ok(Self::truncate_summary(&summary, MAX_SUMMARY_LENGTH))
                }
            }
            Err(_) => {
                // Fall back to simple summary on error
                Ok(Self::create_simple_summary(turns))
            }
        }
    }

    /// Create a simple summary without using AI.
    ///
    /// Extracts key information from conversation turns including:
    /// - Number of turns
    /// - Key topics mentioned
    /// - Files referenced
    /// - Tools used
    ///
    /// # Arguments
    ///
    /// * `turns` - The conversation turns to summarize
    ///
    /// # Returns
    ///
    /// A simple text summary.
    pub fn create_simple_summary(turns: &[ConversationTurn]) -> String {
        if turns.is_empty() {
            return String::new();
        }

        let mut summary_parts: Vec<String> = Vec::new();

        // Add turn count
        summary_parts.push(format!("[{} turns]", turns.len()));

        // Collect unique tools used
        let mut tools_used: Vec<String> = Vec::new();
        for turn in turns {
            Self::collect_tools_from_message(&turn.user, &mut tools_used);
            Self::collect_tools_from_message(&turn.assistant, &mut tools_used);
        }
        if !tools_used.is_empty() {
            tools_used.sort();
            tools_used.dedup();
            let tools_str = tools_used
                .iter()
                .take(5)
                .cloned()
                .collect::<Vec<_>>()
                .join(", ");
            summary_parts.push(format!("Tools: {}", tools_str));
        }

        // Extract first user message as topic indicator
        if let Some(first_turn) = turns.first() {
            let first_text = Self::extract_message_text(&first_turn.user);
            if !first_text.is_empty() {
                let topic = Self::truncate_summary(&first_text, 100);
                summary_parts.push(format!("Started: {}", topic));
            }
        }

        // Extract last assistant response as status indicator
        if let Some(last_turn) = turns.last() {
            let last_text = Self::extract_message_text(&last_turn.assistant);
            if !last_text.is_empty() {
                let status = Self::truncate_summary(&last_text, 100);
                summary_parts.push(format!("Last: {}", status));
            }
        }

        summary_parts.join(" | ")
    }

    /// Collect conversation turns within a token budget.
    ///
    /// Iterates through turns from oldest to newest, collecting as many
    /// as will fit within the specified token budget.
    ///
    /// # Arguments
    ///
    /// * `turns` - The conversation turns to collect from
    /// * `budget` - Maximum tokens to collect
    ///
    /// # Returns
    ///
    /// A tuple of (collected turns, total tokens used).
    pub fn collect_within_budget(
        turns: &[ConversationTurn],
        budget: usize,
    ) -> (Vec<ConversationTurn>, usize) {
        let mut collected: Vec<ConversationTurn> = Vec::new();
        let mut tokens_used: usize = 0;

        for turn in turns {
            let turn_tokens = turn.token_estimate;
            if tokens_used + turn_tokens <= budget {
                collected.push(turn.clone());
                tokens_used += turn_tokens;
            } else {
                // Budget exceeded, stop collecting
                break;
            }
        }

        (collected, tokens_used)
    }

    /// Format conversation turns as readable text for summarization.
    ///
    /// Creates a structured text representation of the conversation
    /// suitable for sending to an LLM for summarization.
    ///
    /// # Arguments
    ///
    /// * `turns` - The conversation turns to format
    ///
    /// # Returns
    ///
    /// A formatted text string.
    pub fn format_turns_as_text(turns: &[ConversationTurn]) -> String {
        let mut parts: Vec<String> = Vec::new();

        for (i, turn) in turns.iter().enumerate() {
            parts.push(format!("--- Turn {} ---", i + 1));

            // Format user message
            let user_text = Self::extract_message_text(&turn.user);
            if !user_text.is_empty() {
                parts.push(format!("User: {}", user_text));
            }

            // Format assistant message
            let assistant_text = Self::extract_message_text(&turn.assistant);
            if !assistant_text.is_empty() {
                parts.push(format!("Assistant: {}", assistant_text));
            }

            // Add summary if already summarized
            if let Some(summary) = &turn.summary {
                parts.push(format!("(Summary: {})", summary));
            }

            parts.push(String::new()); // Empty line between turns
        }

        parts.join("\n")
    }

    /// Extract text content from a message.
    ///
    /// Concatenates all text content blocks from the message,
    /// ignoring non-text content like images or tool calls.
    ///
    /// # Arguments
    ///
    /// * `message` - The message to extract text from
    ///
    /// # Returns
    ///
    /// The concatenated text content.
    pub fn extract_message_text(message: &Message) -> String {
        message
            .content
            .iter()
            .filter_map(|content| match content {
                MessageContent::Text(text_content) => Some(text_content.text.clone()),
                MessageContent::Thinking(thinking) => Some(thinking.thinking.clone()),
                MessageContent::ToolRequest(req) => {
                    // Include tool name for context
                    req.tool_call
                        .as_ref()
                        .ok()
                        .map(|call| format!("[Tool: {}]", call.name))
                }
                MessageContent::ToolResponse(resp) => {
                    // Include brief tool result
                    resp.tool_result.as_ref().ok().map(|result| {
                        let text: String = result
                            .content
                            .iter()
                            .filter_map(|c| c.as_text().map(|t| t.text.clone()))
                            .take(1)
                            .collect::<Vec<_>>()
                            .join("");
                        if text.len() > 100 {
                            format!("[Tool result: {}...]", text.get(..100).unwrap_or(&text))
                        } else if !text.is_empty() {
                            format!("[Tool result: {}]", text)
                        } else {
                            String::new()
                        }
                    })
                }
                _ => None,
            })
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(" ")
    }

    /// Collect tool names from a message.
    fn collect_tools_from_message(message: &Message, tools: &mut Vec<String>) {
        for content in &message.content {
            if let MessageContent::ToolRequest(req) = content {
                if let Ok(call) = &req.tool_call {
                    tools.push(call.name.to_string());
                }
            }
        }
    }

    /// Truncate a summary to a maximum length.
    fn truncate_summary(text: &str, max_len: usize) -> String {
        let trimmed = text.trim();
        if trimmed.len() <= max_len {
            trimmed.to_string()
        } else {
            // Find a good break point (word boundary)
            let truncated = trimmed.get(..max_len).unwrap_or(trimmed);
            if let Some(last_space) = truncated.rfind(' ') {
                format!("{}...", truncated.get(..last_space).unwrap_or(truncated))
            } else {
                format!("{}...", truncated)
            }
        }
    }

    /// Estimate the token count for a summary.
    pub fn estimate_summary_tokens(summary: &str) -> usize {
        TokenEstimator::estimate_tokens(summary)
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_turn(user_text: &str, assistant_text: &str) -> ConversationTurn {
        let user = Message::user().with_text(user_text);
        let assistant = Message::assistant().with_text(assistant_text);
        let token_estimate = TokenEstimator::estimate_message_tokens(&user)
            + TokenEstimator::estimate_message_tokens(&assistant);
        ConversationTurn::new(user, assistant, token_estimate)
    }

    #[test]
    fn test_create_simple_summary_empty() {
        let turns: Vec<ConversationTurn> = vec![];
        let summary = Summarizer::create_simple_summary(&turns);
        assert!(summary.is_empty());
    }

    #[test]
    fn test_create_simple_summary_single_turn() {
        let turns = vec![create_test_turn(
            "How do I create a function in Rust?",
            "You can create a function using the fn keyword.",
        )];

        let summary = Summarizer::create_simple_summary(&turns);

        assert!(summary.contains("[1 turns]"));
        assert!(summary.contains("Started:"));
        assert!(summary.contains("Last:"));
    }

    #[test]
    fn test_create_simple_summary_multiple_turns() {
        let turns = vec![
            create_test_turn("Hello", "Hi there!"),
            create_test_turn("How are you?", "I'm doing well, thanks!"),
            create_test_turn("Goodbye", "See you later!"),
        ];

        let summary = Summarizer::create_simple_summary(&turns);

        assert!(summary.contains("[3 turns]"));
    }

    #[test]
    fn test_collect_within_budget_all_fit() {
        let turns = vec![
            create_test_turn("Short", "Reply"),
            create_test_turn("Another", "Response"),
        ];

        let (collected, tokens) = Summarizer::collect_within_budget(&turns, 10000);

        assert_eq!(collected.len(), 2);
        assert!(tokens > 0);
    }

    #[test]
    fn test_collect_within_budget_partial() {
        let turns = vec![
            create_test_turn("Short", "Reply"),
            create_test_turn("A".repeat(1000).as_str(), "B".repeat(1000).as_str()),
        ];

        // Very small budget should only fit first turn
        let (collected, _tokens) = Summarizer::collect_within_budget(&turns, 50);

        assert_eq!(collected.len(), 1);
    }

    #[test]
    fn test_collect_within_budget_none_fit() {
        let turns = vec![create_test_turn(
            "A".repeat(1000).as_str(),
            "B".repeat(1000).as_str(),
        )];

        // Budget too small for any turn
        let (collected, tokens) = Summarizer::collect_within_budget(&turns, 10);

        assert!(collected.is_empty());
        assert_eq!(tokens, 0);
    }

    #[test]
    fn test_format_turns_as_text() {
        let turns = vec![
            create_test_turn("Hello", "Hi there!"),
            create_test_turn("How are you?", "I'm fine."),
        ];

        let formatted = Summarizer::format_turns_as_text(&turns);

        assert!(formatted.contains("--- Turn 1 ---"));
        assert!(formatted.contains("--- Turn 2 ---"));
        assert!(formatted.contains("User: Hello"));
        assert!(formatted.contains("Assistant: Hi there!"));
        assert!(formatted.contains("User: How are you?"));
        assert!(formatted.contains("Assistant: I'm fine."));
    }

    #[test]
    fn test_extract_message_text_simple() {
        let message = Message::user().with_text("Hello, world!");
        let text = Summarizer::extract_message_text(&message);
        assert_eq!(text, "Hello, world!");
    }

    #[test]
    fn test_extract_message_text_multiple_blocks() {
        let message = Message::user()
            .with_text("First part")
            .with_text("Second part");
        let text = Summarizer::extract_message_text(&message);
        assert!(text.contains("First part"));
        assert!(text.contains("Second part"));
    }

    #[test]
    fn test_truncate_summary_short() {
        let text = "Short text";
        let result = Summarizer::truncate_summary(text, 100);
        assert_eq!(result, "Short text");
    }

    #[test]
    fn test_truncate_summary_long() {
        let text = "This is a very long text that needs to be truncated at a word boundary";
        let result = Summarizer::truncate_summary(text, 30);
        assert!(result.len() <= 33); // 30 + "..."
        assert!(result.ends_with("..."));
    }

    #[test]
    fn test_estimate_summary_tokens() {
        let summary = "This is a test summary";
        let tokens = Summarizer::estimate_summary_tokens(summary);
        assert!(tokens > 0);
    }

    #[test]
    fn test_summarizer_response_text() {
        use rmcp::model::{RawContent, RawTextContent};

        let content = vec![Content {
            raw: RawContent::Text(RawTextContent {
                text: "Summary text".to_string(),
                meta: None,
            }),
            annotations: None,
        }];

        let response = SummarizerResponse::new(content, None);
        assert_eq!(response.text(), "Summary text");
    }

    #[test]
    fn test_summarizer_response_empty() {
        let response = SummarizerResponse::new(vec![], None);
        assert!(response.text().is_empty());
    }

    // Mock client for testing AI summary
    struct MockSummarizerClient {
        response: Option<String>,
        should_fail: bool,
    }

    impl MockSummarizerClient {
        fn new(response: Option<String>) -> Self {
            Self {
                response,
                should_fail: false,
            }
        }

        fn failing() -> Self {
            Self {
                response: None,
                should_fail: true,
            }
        }
    }

    #[async_trait]
    impl SummarizerClient for MockSummarizerClient {
        async fn create_message(
            &self,
            _messages: Vec<Message>,
            _system_prompt: Option<&str>,
        ) -> Result<SummarizerResponse, ContextError> {
            if self.should_fail {
                return Err(ContextError::SummarizationFailed(
                    "Mock failure".to_string(),
                ));
            }

            let content = match &self.response {
                Some(text) => {
                    use rmcp::model::{RawContent, RawTextContent};
                    vec![Content {
                        raw: RawContent::Text(RawTextContent {
                            text: text.clone(),
                            meta: None,
                        }),
                        annotations: None,
                    }]
                }
                None => vec![],
            };

            Ok(SummarizerResponse::new(content, None))
        }
    }

    #[tokio::test]
    async fn test_generate_ai_summary_success() {
        let turns = vec![create_test_turn("Hello", "Hi there!")];
        let client = MockSummarizerClient::new(Some("AI generated summary".to_string()));

        let result = Summarizer::generate_ai_summary(&turns, &client, 10000).await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "AI generated summary");
    }

    #[tokio::test]
    async fn test_generate_ai_summary_empty_response_fallback() {
        let turns = vec![create_test_turn("Hello", "Hi there!")];
        let client = MockSummarizerClient::new(None); // Empty response

        let result = Summarizer::generate_ai_summary(&turns, &client, 10000).await;

        assert!(result.is_ok());
        let summary = result.unwrap();
        // Should fall back to simple summary
        assert!(summary.contains("[1 turns]"));
    }

    #[tokio::test]
    async fn test_generate_ai_summary_error_fallback() {
        let turns = vec![create_test_turn("Hello", "Hi there!")];
        let client = MockSummarizerClient::failing();

        let result = Summarizer::generate_ai_summary(&turns, &client, 10000).await;

        assert!(result.is_ok());
        let summary = result.unwrap();
        // Should fall back to simple summary
        assert!(summary.contains("[1 turns]"));
    }

    #[tokio::test]
    async fn test_generate_ai_summary_empty_turns() {
        let turns: Vec<ConversationTurn> = vec![];
        let client = MockSummarizerClient::new(Some("Should not be called".to_string()));

        let result = Summarizer::generate_ai_summary(&turns, &client, 10000).await;

        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_generate_ai_summary_truncates_long_response() {
        let turns = vec![create_test_turn("Hello", "Hi there!")];
        let long_response = "A".repeat(1000);
        let client = MockSummarizerClient::new(Some(long_response));

        let result = Summarizer::generate_ai_summary(&turns, &client, 10000).await;

        assert!(result.is_ok());
        let summary = result.unwrap();
        // Should be truncated to MAX_SUMMARY_LENGTH
        assert!(summary.len() <= MAX_SUMMARY_LENGTH + 3); // +3 for "..."
    }
}
