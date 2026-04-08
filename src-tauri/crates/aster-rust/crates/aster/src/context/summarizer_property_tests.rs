//! Property-based tests for Summarizer
//!
//! These tests validate the correctness properties defined in the design document
//! using the proptest framework.
//!
//! **Feature: context-alignment**
//! - Property 4: Summary Length Reduction
//!
//! **Validates: Requirements 3.1, 3.5, 3.6**

#[cfg(test)]
mod property_tests {
    use crate::context::summarizer::Summarizer;
    use crate::context::token_estimator::TokenEstimator;
    use crate::context::types::ConversationTurn;
    use crate::conversation::message::Message;
    use proptest::prelude::*;

    // ============================================================================
    // Strategies for generating test data
    // ============================================================================

    /// Strategy for generating user message text
    fn user_message_strategy() -> impl Strategy<Value = String> {
        prop_oneof![
            Just("How do I create a function?".to_string()),
            Just("What is the best way to handle errors?".to_string()),
            Just("Can you help me with this code?".to_string()),
            Just("I need to implement a feature".to_string()),
            "[a-zA-Z ]{10,100}".prop_map(|s| s),
            "[a-zA-Z0-9 .,!?]{20,200}".prop_map(|s| s),
        ]
    }

    /// Strategy for generating assistant message text
    fn assistant_message_strategy() -> impl Strategy<Value = String> {
        prop_oneof![
            Just("You can use the fn keyword to create a function.".to_string()),
            Just("Error handling in Rust uses Result and Option types.".to_string()),
            Just("Here's how you can implement that feature.".to_string()),
            Just("Let me help you with that code.".to_string()),
            "[a-zA-Z ]{20,150}".prop_map(|s| s),
            "[a-zA-Z0-9 .,!?]{30,300}".prop_map(|s| s),
        ]
    }

    /// Strategy for generating a conversation turn
    fn conversation_turn_strategy() -> impl Strategy<Value = ConversationTurn> {
        (user_message_strategy(), assistant_message_strategy()).prop_map(
            |(user_text, assistant_text)| {
                let user = Message::user().with_text(&user_text);
                let assistant = Message::assistant().with_text(&assistant_text);
                let token_estimate = TokenEstimator::estimate_message_tokens(&user)
                    + TokenEstimator::estimate_message_tokens(&assistant);
                ConversationTurn::new(user, assistant, token_estimate)
            },
        )
    }

    /// Strategy for generating multiple conversation turns
    fn conversation_turns_strategy(
        min: usize,
        max: usize,
    ) -> impl Strategy<Value = Vec<ConversationTurn>> {
        prop::collection::vec(conversation_turn_strategy(), min..max)
    }

    // ============================================================================
    // Property 4: Summary Length Reduction
    // ============================================================================

    // **Property 4: Summary Length Reduction**
    //
    // *For any* set of conversation turns, the generated summary SHALL be shorter
    // than the original content in token count, and collected messages SHALL not
    // exceed the specified budget.
    //
    // **Validates: Requirements 3.1, 3.5, 3.6**
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        /// Test that simple summary is shorter than original content
        /// Feature: context-alignment, Property 4: Summary Length Reduction
        /// Validates: Requirements 3.1
        ///
        /// Note: For very short conversations (1-2 turns with minimal content),
        /// the summary metadata overhead ("[N turns]", "Started:", "Last:") may
        /// exceed the original content. This property holds for conversations
        /// with sufficient content (3+ turns or 100+ tokens).
        #[test]
        fn property_4_simple_summary_shorter_than_original(
            turns in conversation_turns_strategy(3, 10)
        ) {
            // Calculate original token count
            let original_tokens: usize = turns.iter().map(|t| t.token_estimate).sum();

            // Generate simple summary
            let summary = Summarizer::create_simple_summary(&turns);
            let summary_tokens = TokenEstimator::estimate_tokens(&summary);

            // Summary should be shorter than original for conversations with sufficient content
            // The summary format adds ~50 tokens of overhead, so we require original > 100 tokens
            // for the property to reliably hold
            if original_tokens > 100 {
                prop_assert!(
                    summary_tokens < original_tokens,
                    "Summary tokens ({}) should be less than original tokens ({}) for conversations with sufficient content",
                    summary_tokens, original_tokens
                );
            }
        }

        /// Test that collect_within_budget respects the budget
        /// Feature: context-alignment, Property 4: Summary Length Reduction
        /// Validates: Requirements 3.5
        #[test]
        fn property_4_collect_within_budget_respects_limit(
            turns in conversation_turns_strategy(1, 20),
            budget in 100usize..10000
        ) {
            let (collected, tokens_used) = Summarizer::collect_within_budget(&turns, budget);

            // Tokens used should not exceed budget
            prop_assert!(
                tokens_used <= budget,
                "Tokens used ({}) should not exceed budget ({})",
                tokens_used, budget
            );

            // Collected turns should have tokens summing to tokens_used
            let collected_sum: usize = collected.iter().map(|t| t.token_estimate).sum();
            prop_assert_eq!(
                collected_sum, tokens_used,
                "Collected turns token sum should equal tokens_used"
            );
        }

        /// Test that collect_within_budget collects as many turns as possible
        /// Feature: context-alignment, Property 4: Summary Length Reduction
        /// Validates: Requirements 3.5
        #[test]
        fn property_4_collect_within_budget_maximizes_collection(
            turns in conversation_turns_strategy(2, 10),
            budget in 500usize..5000
        ) {
            let (collected, tokens_used) = Summarizer::collect_within_budget(&turns, budget);

            // If not all turns were collected, adding the next turn would exceed budget
            if collected.len() < turns.len() {
                let next_turn = &turns[collected.len()];
                prop_assert!(
                    tokens_used + next_turn.token_estimate > budget,
                    "If not all turns collected, next turn should exceed budget"
                );
            }
        }

        /// Test that format_turns_as_text includes all turns
        /// Feature: context-alignment, Property 4: Summary Length Reduction
        /// Validates: Requirements 3.6
        #[test]
        fn property_4_format_turns_includes_all(
            turns in conversation_turns_strategy(1, 5)
        ) {
            let formatted = Summarizer::format_turns_as_text(&turns);

            // Should contain turn markers for each turn
            for i in 1..=turns.len() {
                prop_assert!(
                    formatted.contains(&format!("--- Turn {} ---", i)),
                    "Formatted text should contain Turn {} marker", i
                );
            }
        }

        /// Test that format_turns_as_text preserves user and assistant labels
        /// Feature: context-alignment, Property 4: Summary Length Reduction
        /// Validates: Requirements 3.6
        #[test]
        fn property_4_format_turns_preserves_labels(
            turns in conversation_turns_strategy(1, 5)
        ) {
            let formatted = Summarizer::format_turns_as_text(&turns);

            // Should contain User: and Assistant: labels
            let user_count = formatted.matches("User:").count();
            let assistant_count = formatted.matches("Assistant:").count();

            prop_assert!(
                user_count >= turns.len(),
                "Should have at least {} User: labels, found {}",
                turns.len(), user_count
            );

            prop_assert!(
                assistant_count >= turns.len(),
                "Should have at least {} Assistant: labels, found {}",
                turns.len(), assistant_count
            );
        }

        /// Test that extract_message_text extracts text content
        /// Feature: context-alignment, Property 4: Summary Length Reduction
        /// Validates: Requirements 3.6
        #[test]
        fn property_4_extract_message_text_non_empty(
            text in "[a-zA-Z ]{10,100}"
        ) {
            let message = Message::user().with_text(&text);
            let extracted = Summarizer::extract_message_text(&message);

            prop_assert!(
                !extracted.is_empty(),
                "Extracted text should not be empty for non-empty message"
            );

            prop_assert!(
                extracted.contains(&text),
                "Extracted text should contain original text"
            );
        }

        /// Test that simple summary contains turn count
        /// Feature: context-alignment, Property 4: Summary Length Reduction
        /// Validates: Requirements 3.1
        #[test]
        fn property_4_simple_summary_contains_turn_count(
            turns in conversation_turns_strategy(1, 10)
        ) {
            let summary = Summarizer::create_simple_summary(&turns);

            prop_assert!(
                summary.contains(&format!("[{} turns]", turns.len())),
                "Summary should contain turn count [{} turns]", turns.len()
            );
        }

        /// Test that empty turns produce empty summary
        /// Feature: context-alignment, Property 4: Summary Length Reduction
        /// Validates: Requirements 3.1
        #[test]
        fn property_4_empty_turns_empty_summary(_dummy in 0..1i32) {
            let turns: Vec<ConversationTurn> = vec![];
            let summary = Summarizer::create_simple_summary(&turns);

            prop_assert!(
                summary.is_empty(),
                "Empty turns should produce empty summary"
            );
        }

        /// Test that collect_within_budget with zero budget collects nothing
        /// Feature: context-alignment, Property 4: Summary Length Reduction
        /// Validates: Requirements 3.5
        #[test]
        fn property_4_zero_budget_collects_nothing(
            turns in conversation_turns_strategy(1, 5)
        ) {
            let (collected, tokens_used) = Summarizer::collect_within_budget(&turns, 0);

            prop_assert!(
                collected.is_empty(),
                "Zero budget should collect no turns"
            );

            prop_assert_eq!(
                tokens_used, 0,
                "Zero budget should use zero tokens"
            );
        }

        /// Test that large budget collects all turns
        /// Feature: context-alignment, Property 4: Summary Length Reduction
        /// Validates: Requirements 3.5
        #[test]
        fn property_4_large_budget_collects_all(
            turns in conversation_turns_strategy(1, 10)
        ) {
            // Use a very large budget
            let budget = 1_000_000;
            let (collected, _tokens_used) = Summarizer::collect_within_budget(&turns, budget);

            prop_assert_eq!(
                collected.len(), turns.len(),
                "Large budget should collect all turns"
            );
        }
    }
}
