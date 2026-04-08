//! Message Priority Sorter Module
//!
//! This module provides message priority sorting functionality for context management.
//! It assigns priority levels to messages based on their type, recency, and content,
//! enabling intelligent compression and truncation decisions.
//!
//! # Priority Levels
//!
//! - **Critical**: System messages and summaries (must be preserved)
//! - **High**: Recent messages (last 20%) and messages with tool calls
//! - **Medium**: Middle messages (50-80% of conversation)
//! - **Low**: Older messages (20-50% of conversation)
//! - **Minimal**: Oldest messages (first 20%)
//!
//! # Example
//!
//! ```rust,ignore
//! use aster::context::priority_sorter::PrioritySorter;
//! use aster::context::types::MessagePriority;
//!
//! let messages = vec![/* ... */];
//! let prioritized = PrioritySorter::sort_by_priority(&messages, |m| estimate_tokens(m));
//! ```

use crate::context::token_estimator::TokenEstimator;
use crate::context::types::{MessagePriority, PrioritizedMessage};
use crate::conversation::message::{Message, MessageContent};

// ============================================================================
// Constants
// ============================================================================

/// Threshold for recent messages (last 20%)
const RECENT_THRESHOLD: f64 = 0.8;

/// Threshold for medium priority messages (50-80%)
const MEDIUM_THRESHOLD: f64 = 0.5;

/// Threshold for low priority messages (20-50%)
const LOW_THRESHOLD: f64 = 0.2;

/// Keywords that indicate a summary message
const SUMMARY_KEYWORDS: &[&str] = &[
    "[summary]",
    "[conversation summary]",
    "summary:",
    "summarized:",
    "previous conversation:",
];

// ============================================================================
// PrioritySorter
// ============================================================================

/// Message priority sorter for intelligent context management.
///
/// Assigns priority levels to messages based on:
/// - Message role (system messages are critical)
/// - Message content (summaries are critical)
/// - Message position (recent messages are high priority)
/// - Tool calls (messages with tool calls are high priority)
pub struct PrioritySorter;

impl PrioritySorter {
    /// Evaluate the priority of a message based on its position and content.
    ///
    /// # Priority Assignment Rules
    ///
    /// 1. System messages and summaries → Critical
    /// 2. Recent messages (last 20%) → High
    /// 3. Messages with tool calls → High
    /// 4. Middle messages (50-80%) → Medium
    /// 5. Older messages (20-50%) → Low
    /// 6. Oldest messages (first 20%) → Minimal
    ///
    /// # Arguments
    ///
    /// * `message` - The message to evaluate
    /// * `index` - The message's position in the conversation (0-based)
    /// * `total_messages` - Total number of messages in the conversation
    ///
    /// # Returns
    ///
    /// The assigned `MessagePriority` level.
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// let priority = PrioritySorter::evaluate_priority(&message, 5, 10);
    /// assert_eq!(priority, MessagePriority::High); // Last 50% = recent
    /// ```
    pub fn evaluate_priority(
        message: &Message,
        index: usize,
        total_messages: usize,
    ) -> MessagePriority {
        // Rule 1: System messages and summaries are Critical
        if Self::is_system_or_summary(message) {
            return MessagePriority::Critical;
        }

        // Rule 2 & 3: Check for tool calls (High priority)
        if Self::has_tool_calls(message) {
            return MessagePriority::High;
        }

        // Calculate position ratio (0.0 = oldest, 1.0 = newest)
        let position_ratio = if total_messages <= 1 {
            1.0
        } else {
            index as f64 / (total_messages - 1) as f64
        };

        // Rule 2: Recent messages (last 20%) are High priority
        if position_ratio >= RECENT_THRESHOLD {
            return MessagePriority::High;
        }

        // Rule 4: Middle messages (50-80%) are Medium priority
        if position_ratio >= MEDIUM_THRESHOLD {
            return MessagePriority::Medium;
        }

        // Rule 5: Older messages (20-50%) are Low priority
        if position_ratio >= LOW_THRESHOLD {
            return MessagePriority::Low;
        }

        // Rule 6: Oldest messages (first 20%) are Minimal priority
        MessagePriority::Minimal
    }

    /// Sort messages by priority, then by timestamp (descending).
    ///
    /// Creates a list of `PrioritizedMessage` objects sorted by:
    /// 1. Priority (Critical > High > Medium > Low > Minimal)
    /// 2. Timestamp (newer messages first within same priority)
    ///
    /// # Arguments
    ///
    /// * `messages` - The messages to sort
    /// * `estimate_tokens` - Function to estimate token count for a message
    ///
    /// # Returns
    ///
    /// A vector of `PrioritizedMessage` sorted by priority and timestamp.
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// let sorted = PrioritySorter::sort_by_priority(&messages, |m| {
    ///     TokenEstimator::estimate_message_tokens(m)
    /// });
    /// ```
    pub fn sort_by_priority<F>(messages: &[Message], estimate_tokens: F) -> Vec<PrioritizedMessage>
    where
        F: Fn(&Message) -> usize,
    {
        let total_messages = messages.len();

        let mut prioritized: Vec<PrioritizedMessage> = messages
            .iter()
            .enumerate()
            .map(|(index, message)| {
                let priority = Self::evaluate_priority(message, index, total_messages);
                let tokens = estimate_tokens(message);

                PrioritizedMessage::new(message.clone(), priority, message.created, tokens)
            })
            .collect();

        // Sort by priority (descending) then by timestamp (descending)
        prioritized.sort_by(|a, b| match b.priority.cmp(&a.priority) {
            std::cmp::Ordering::Equal => b.timestamp.cmp(&a.timestamp),
            other => other,
        });

        prioritized
    }

    /// Sort messages by priority using the default token estimator.
    ///
    /// Convenience method that uses `TokenEstimator::estimate_message_tokens`.
    ///
    /// # Arguments
    ///
    /// * `messages` - The messages to sort
    ///
    /// # Returns
    ///
    /// A vector of `PrioritizedMessage` sorted by priority and timestamp.
    pub fn sort_by_priority_default(messages: &[Message]) -> Vec<PrioritizedMessage> {
        Self::sort_by_priority(messages, TokenEstimator::estimate_message_tokens)
    }

    /// Check if a message is a system message or contains a summary.
    ///
    /// # Arguments
    ///
    /// * `message` - The message to check
    ///
    /// # Returns
    ///
    /// `true` if the message is a system message or contains summary content.
    pub fn is_system_or_summary(message: &Message) -> bool {
        // Check if it's a system role (Note: rmcp::model::Role doesn't have System,
        // but we check for user messages that might contain system-like content)
        // In practice, system prompts are handled separately, so we focus on summaries

        // Check message content for summary indicators
        for content in &message.content {
            if let MessageContent::Text(text_content) = content {
                let text_lower = text_content.text.to_lowercase();
                for keyword in SUMMARY_KEYWORDS {
                    if text_lower.contains(keyword) {
                        return true;
                    }
                }
            }
        }

        false
    }

    /// Check if a message contains tool calls (requests or responses).
    ///
    /// # Arguments
    ///
    /// * `message` - The message to check
    ///
    /// # Returns
    ///
    /// `true` if the message contains any tool-related content.
    pub fn has_tool_calls(message: &Message) -> bool {
        message.content.iter().any(|content| {
            matches!(
                content,
                MessageContent::ToolRequest(_)
                    | MessageContent::ToolResponse(_)
                    | MessageContent::ToolConfirmationRequest(_)
                    | MessageContent::FrontendToolRequest(_)
            )
        })
    }

    /// Filter messages by minimum priority level.
    ///
    /// Returns only messages with priority >= the specified minimum.
    ///
    /// # Arguments
    ///
    /// * `prioritized` - The prioritized messages to filter
    /// * `min_priority` - Minimum priority level to include
    ///
    /// # Returns
    ///
    /// A vector of messages meeting the minimum priority requirement.
    pub fn filter_by_priority(
        prioritized: &[PrioritizedMessage],
        min_priority: MessagePriority,
    ) -> Vec<PrioritizedMessage> {
        prioritized
            .iter()
            .filter(|p| p.priority >= min_priority)
            .cloned()
            .collect()
    }

    /// Select messages within a token budget, prioritizing higher priority messages.
    ///
    /// # Arguments
    ///
    /// * `prioritized` - The prioritized messages (should be pre-sorted)
    /// * `max_tokens` - Maximum total tokens to include
    ///
    /// # Returns
    ///
    /// A vector of messages fitting within the token budget.
    pub fn select_within_budget(
        prioritized: &[PrioritizedMessage],
        max_tokens: usize,
    ) -> Vec<PrioritizedMessage> {
        let mut result = Vec::new();
        let mut current_tokens = 0;

        for pm in prioritized {
            if current_tokens + pm.tokens <= max_tokens {
                result.push(pm.clone());
                current_tokens += pm.tokens;
            }
        }

        result
    }

    /// Get priority distribution statistics for a set of messages.
    ///
    /// # Arguments
    ///
    /// * `messages` - The messages to analyze
    ///
    /// # Returns
    ///
    /// A tuple of (critical_count, high_count, medium_count, low_count, minimal_count)
    pub fn get_priority_distribution(messages: &[Message]) -> (usize, usize, usize, usize, usize) {
        let total = messages.len();
        let mut critical = 0;
        let mut high = 0;
        let mut medium = 0;
        let mut low = 0;
        let mut minimal = 0;

        for (index, message) in messages.iter().enumerate() {
            match Self::evaluate_priority(message, index, total) {
                MessagePriority::Critical => critical += 1,
                MessagePriority::High => high += 1,
                MessagePriority::Medium => medium += 1,
                MessagePriority::Low => low += 1,
                MessagePriority::Minimal => minimal += 1,
            }
        }

        (critical, high, medium, low, minimal)
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use rmcp::model::{CallToolRequestParam, JsonObject, Role};

    fn create_text_message(role: Role, text: &str) -> Message {
        match role {
            Role::User => Message::user().with_text(text),
            Role::Assistant => Message::assistant().with_text(text),
        }
    }

    fn create_tool_call_message() -> Message {
        Message::assistant().with_tool_request(
            "tool_1",
            Ok(CallToolRequestParam {
                name: "test_tool".into(),
                arguments: Some(JsonObject::new()),
            }),
        )
    }

    fn create_summary_message() -> Message {
        Message::user().with_text("[Summary] Previous conversation discussed file operations.")
    }

    #[test]
    fn test_evaluate_priority_summary_is_critical() {
        let message = create_summary_message();
        let priority = PrioritySorter::evaluate_priority(&message, 0, 10);
        assert_eq!(priority, MessagePriority::Critical);
    }

    #[test]
    fn test_evaluate_priority_tool_call_is_high() {
        let message = create_tool_call_message();
        let priority = PrioritySorter::evaluate_priority(&message, 0, 10);
        assert_eq!(priority, MessagePriority::High);
    }

    #[test]
    fn test_evaluate_priority_recent_is_high() {
        let message = create_text_message(Role::User, "Recent message");
        // Index 9 out of 10 = 90% position (recent)
        let priority = PrioritySorter::evaluate_priority(&message, 9, 10);
        assert_eq!(priority, MessagePriority::High);
    }

    #[test]
    fn test_evaluate_priority_middle_is_medium() {
        let message = create_text_message(Role::User, "Middle message");
        // Index 6 out of 10 = 66% position (medium)
        let priority = PrioritySorter::evaluate_priority(&message, 6, 10);
        assert_eq!(priority, MessagePriority::Medium);
    }

    #[test]
    fn test_evaluate_priority_older_is_low() {
        let message = create_text_message(Role::User, "Older message");
        // Index 3 out of 10 = 33% position (low)
        let priority = PrioritySorter::evaluate_priority(&message, 3, 10);
        assert_eq!(priority, MessagePriority::Low);
    }

    #[test]
    fn test_evaluate_priority_oldest_is_minimal() {
        let message = create_text_message(Role::User, "Oldest message");
        // Index 1 out of 10 = 11% position (minimal)
        let priority = PrioritySorter::evaluate_priority(&message, 1, 10);
        assert_eq!(priority, MessagePriority::Minimal);
    }

    #[test]
    fn test_is_system_or_summary_with_summary() {
        let message = create_summary_message();
        assert!(PrioritySorter::is_system_or_summary(&message));
    }

    #[test]
    fn test_is_system_or_summary_without_summary() {
        let message = create_text_message(Role::User, "Regular message");
        assert!(!PrioritySorter::is_system_or_summary(&message));
    }

    #[test]
    fn test_has_tool_calls_with_tool() {
        let message = create_tool_call_message();
        assert!(PrioritySorter::has_tool_calls(&message));
    }

    #[test]
    fn test_has_tool_calls_without_tool() {
        let message = create_text_message(Role::User, "No tools here");
        assert!(!PrioritySorter::has_tool_calls(&message));
    }

    #[test]
    fn test_sort_by_priority_ordering() {
        let messages = vec![
            create_text_message(Role::User, "First message"), // Minimal (index 0)
            create_text_message(Role::Assistant, "Second message"), // Low (index 1)
            create_summary_message(),                         // Critical (summary)
            create_text_message(Role::User, "Fourth message"), // Medium (index 3)
            create_text_message(Role::Assistant, "Fifth message"), // High (index 4)
        ];

        let sorted = PrioritySorter::sort_by_priority_default(&messages);

        // Critical should be first
        assert_eq!(sorted[0].priority, MessagePriority::Critical);
        // High should be second
        assert_eq!(sorted[1].priority, MessagePriority::High);
    }

    #[test]
    fn test_filter_by_priority() {
        let messages = vec![
            create_text_message(Role::User, "First"),
            create_text_message(Role::Assistant, "Second"),
            create_text_message(Role::User, "Third"),
            create_text_message(Role::Assistant, "Fourth"),
            create_text_message(Role::User, "Fifth"),
        ];

        let prioritized = PrioritySorter::sort_by_priority_default(&messages);
        let high_and_above =
            PrioritySorter::filter_by_priority(&prioritized, MessagePriority::High);

        // Only high priority messages should remain
        for pm in &high_and_above {
            assert!(pm.priority >= MessagePriority::High);
        }
    }

    #[test]
    fn test_select_within_budget() {
        let messages = vec![
            create_text_message(Role::User, "Short"),
            create_text_message(Role::Assistant, "Also short"),
            create_text_message(Role::User, "Another short one"),
        ];

        let prioritized = PrioritySorter::sort_by_priority_default(&messages);
        let selected = PrioritySorter::select_within_budget(&prioritized, 50);

        // Should select some messages within budget
        let total_tokens: usize = selected.iter().map(|p| p.tokens).sum();
        assert!(total_tokens <= 50);
    }

    #[test]
    fn test_get_priority_distribution() {
        let messages = vec![
            create_summary_message(),                       // Critical
            create_text_message(Role::User, "First"),       // Minimal
            create_text_message(Role::Assistant, "Second"), // Low
            create_text_message(Role::User, "Third"),       // Low
            create_text_message(Role::Assistant, "Fourth"), // Medium
            create_text_message(Role::User, "Fifth"),       // Medium
            create_text_message(Role::Assistant, "Sixth"),  // Medium
            create_text_message(Role::User, "Seventh"),     // High
            create_text_message(Role::Assistant, "Eighth"), // High
            create_tool_call_message(),                     // High (tool call)
        ];

        let (critical, high, medium, low, _minimal) =
            PrioritySorter::get_priority_distribution(&messages);

        assert_eq!(critical, 1); // Summary message
        assert!(high >= 1); // At least the tool call message
        assert!(medium >= 1);
        assert!(low >= 1);
        // Minimal might be 0 or 1 depending on exact thresholds
    }

    #[test]
    fn test_single_message_is_high_priority() {
        let message = create_text_message(Role::User, "Only message");
        let priority = PrioritySorter::evaluate_priority(&message, 0, 1);
        // Single message should be high priority (position ratio = 1.0)
        assert_eq!(priority, MessagePriority::High);
    }

    #[test]
    fn test_empty_messages() {
        let messages: Vec<Message> = vec![];
        let sorted = PrioritySorter::sort_by_priority_default(&messages);
        assert!(sorted.is_empty());
    }

    #[test]
    fn test_summary_keywords_case_insensitive() {
        let message = create_text_message(Role::User, "[SUMMARY] This is a summary");
        assert!(PrioritySorter::is_system_or_summary(&message));

        let message2 = create_text_message(Role::User, "Conversation Summary: blah blah");
        assert!(PrioritySorter::is_system_or_summary(&message2));
    }
}
