//! Property-based tests for Message Compressor
//!
//! These tests validate the correctness properties defined in the design document
//! using the proptest framework.
//!
//! **Feature: context-alignment**
//! - Property 5: Code Block Compression
//! - Property 6: Tool Output Compression
//! - Property 7: Incremental Compression

#[cfg(test)]
mod property_tests {
    use crate::context::compressor::MessageCompressor;
    use proptest::prelude::*;

    // ============================================================================
    // Strategies for generating test data
    // ============================================================================

    /// Strategy for generating code lines
    fn code_line_strategy() -> impl Strategy<Value = String> {
        prop_oneof![
            Just("    let x = 5;".to_string()),
            Just("    println!(\"hello\");".to_string()),
            Just("    if condition {".to_string()),
            Just("    }".to_string()),
            Just("    for i in 0..10 {".to_string()),
            Just("    return result;".to_string()),
            Just("fn function_name() {".to_string()),
            Just("pub struct MyStruct {".to_string()),
            Just("    field: Type,".to_string()),
            Just("impl MyStruct {".to_string()),
            "[a-zA-Z_][a-zA-Z0-9_]{0,20}".prop_map(|s| format!("    let {} = value;", s)),
        ]
    }

    /// Strategy for generating code blocks with variable number of lines
    fn code_block_strategy(min_lines: usize, max_lines: usize) -> impl Strategy<Value = String> {
        prop::collection::vec(code_line_strategy(), min_lines..max_lines)
            .prop_map(|lines| lines.join("\n"))
    }

    /// Strategy for generating tool output content
    fn tool_output_strategy(min_chars: usize, max_chars: usize) -> impl Strategy<Value = String> {
        prop::collection::vec(
            prop_oneof![
                Just("File: src/main.rs\n".to_string()),
                Just("Output: success\n".to_string()),
                Just("Error: none\n".to_string()),
                "[a-zA-Z0-9 ]{10,50}".prop_map(|s| format!("{}\n", s)),
            ],
            1..20,
        )
        .prop_map(move |parts| {
            let content = parts.join("");
            if content.len() > max_chars {
                content.chars().take(max_chars).collect()
            } else if content.len() < min_chars {
                format!("{}{}", content, "x".repeat(min_chars - content.len()))
            } else {
                content
            }
        })
    }

    // ============================================================================
    // Property 5: Code Block Compression
    // ============================================================================

    // **Property 5: Code Block Compression**
    //
    // *For any* code block exceeding max_lines, compression SHALL:
    // - Keep approximately 60% of head lines
    // - Keep approximately 40% of tail lines
    // - Include an omission marker indicating lines removed
    // - Result in exactly max_lines total (excluding marker)
    //
    // **Validates: Requirements 4.1, 4.2**
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        /// Test that code blocks within limit are unchanged
        #[test]
        fn property_5_code_block_within_limit_unchanged(
            code in code_block_strategy(5, 30),
            max_lines in 30usize..100
        ) {
            let result = MessageCompressor::compress_code_block(&code, max_lines);
            let original_lines = code.lines().count();

            if original_lines <= max_lines {
                prop_assert_eq!(
                    result, code,
                    "Code within limit should be unchanged"
                );
            }
        }

        /// Test that compressed code blocks have correct structure
        #[test]
        fn property_5_code_block_compression_structure(
            code in code_block_strategy(60, 150),
            max_lines in 20usize..50
        ) {
            let original_lines = code.lines().count();

            // Only test when compression is needed
            prop_assume!(original_lines > max_lines);

            let result = MessageCompressor::compress_code_block(&code, max_lines);

            // Should contain omission marker
            prop_assert!(
                result.contains("lines omitted"),
                "Compressed code should contain omission marker"
            );

            // Count content lines (excluding omission marker line)
            let result_lines: Vec<&str> = result.lines().collect();
            let content_lines: Vec<&str> = result_lines
                .iter()
                .filter(|l| !l.contains("omitted"))
                .copied()
                .collect();

            // Should have approximately max_lines content lines
            // Allow some variance due to rounding
            prop_assert!(
                content_lines.len() >= max_lines.saturating_sub(2) &&
                content_lines.len() <= max_lines + 2,
                "Content lines {} should be approximately {} (±2)",
                content_lines.len(), max_lines
            );
        }

        /// Test that head/tail ratio is approximately 60/40
        #[test]
        fn property_5_code_block_head_tail_ratio(
            max_lines in 20usize..100
        ) {
            // Generate code with exactly 200 lines for predictable testing
            let lines: Vec<String> = (0..200).map(|i| format!("line_{}", i)).collect();
            let code = lines.join("\n");

            let result = MessageCompressor::compress_code_block(&code, max_lines);

            // Find the omission marker position
            let result_lines: Vec<&str> = result.lines().collect();
            let marker_idx = result_lines.iter().position(|l| l.contains("omitted"));

            if let Some(idx) = marker_idx {
                let head_count = idx;
                let tail_count = result_lines.len() - idx - 1;

                // Head should be approximately 60% of max_lines
                let expected_head = ((max_lines as f64) * 0.6).ceil() as usize;
                prop_assert!(
                    head_count >= expected_head.saturating_sub(2) &&
                    head_count <= expected_head + 2,
                    "Head lines {} should be approximately {} (60% of {})",
                    head_count, expected_head, max_lines
                );

                // Tail should be approximately 40% of max_lines
                let expected_tail = max_lines.saturating_sub(expected_head);
                prop_assert!(
                    tail_count >= expected_tail.saturating_sub(2) &&
                    tail_count <= expected_tail + 2,
                    "Tail lines {} should be approximately {} (40% of {})",
                    tail_count, expected_tail, max_lines
                );
            }
        }

        /// Test that first and last lines are preserved
        #[test]
        fn property_5_code_block_preserves_boundaries(
            code in code_block_strategy(60, 150),
            max_lines in 20usize..50
        ) {
            let original_lines: Vec<&str> = code.lines().collect();
            let original_count = original_lines.len();

            // Only test when compression is needed
            prop_assume!(original_count > max_lines);

            let result = MessageCompressor::compress_code_block(&code, max_lines);

            // First line should be preserved
            if let Some(first_original) = original_lines.first() {
                prop_assert!(
                    result.starts_with(first_original),
                    "First line should be preserved"
                );
            }

            // Last line should be preserved
            if let Some(last_original) = original_lines.last() {
                prop_assert!(
                    result.ends_with(last_original),
                    "Last line should be preserved"
                );
            }
        }

        /// Test that omission marker shows correct count
        #[test]
        fn property_5_omission_marker_accuracy(
            max_lines in 20usize..50
        ) {
            // Generate code with exactly 100 lines
            let lines: Vec<String> = (0..100).map(|i| format!("line_{}", i)).collect();
            let code = lines.join("\n");

            let result = MessageCompressor::compress_code_block(&code, max_lines);

            // Extract omitted count from marker
            if let Some(marker_line) = result.lines().find(|l| l.contains("omitted")) {
                // Parse the number from "[N lines omitted]"
                let parts: Vec<&str> = marker_line.split_whitespace().collect();
                if let Some(count_str) = parts.iter().find(|s| s.chars().all(|c| c.is_ascii_digit())) {
                    if let Ok(omitted_count) = count_str.parse::<usize>() {
                        let expected_omitted = 100 - max_lines;
                        prop_assert!(
                            omitted_count >= expected_omitted.saturating_sub(2) &&
                            omitted_count <= expected_omitted + 2,
                            "Omitted count {} should be approximately {}",
                            omitted_count, expected_omitted
                        );
                    }
                }
            }
        }
    }

    // ============================================================================
    // Property 6: Tool Output Compression
    // ============================================================================

    // **Property 6: Tool Output Compression**
    //
    // *For any* tool output exceeding max_chars:
    // - Preserve head portion (approximately 70%)
    // - Preserve tail portion (approximately 30%)
    // - Include omission marker
    // - If contains code blocks, code SHALL be preserved with priority
    //
    // **Validates: Requirements 4.3, 4.4, 4.5**
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        /// Test that tool output within limit is unchanged
        #[test]
        fn property_6_tool_output_within_limit_unchanged(
            content in "[a-zA-Z0-9 ]{10,50}",
            max_chars in 100usize..500
        ) {
            let result = MessageCompressor::compress_tool_output(&content, max_chars);

            if content.len() <= max_chars {
                prop_assert_eq!(
                    result, content,
                    "Tool output within limit should be unchanged"
                );
            }
        }

        /// Test that compressed tool output has omission marker
        #[test]
        fn property_6_tool_output_has_omission_marker(
            max_chars in 50usize..200
        ) {
            // Generate content larger than max_chars
            let content = "A".repeat(max_chars * 3);

            let result = MessageCompressor::compress_tool_output(&content, max_chars);

            prop_assert!(
                result.contains("omitted") || result.contains("..."),
                "Compressed tool output should contain omission indicator"
            );
        }

        /// Test that compressed tool output is smaller than original
        #[test]
        fn property_6_tool_output_compression_reduces_size(
            max_chars in 50usize..200
        ) {
            // Generate content larger than max_chars
            let content = "A".repeat(max_chars * 3);

            let result = MessageCompressor::compress_tool_output(&content, max_chars);

            prop_assert!(
                result.len() < content.len(),
                "Compressed output {} should be smaller than original {}",
                result.len(), content.len()
            );
        }

        /// Test that head and tail are preserved
        #[test]
        fn property_6_tool_output_preserves_boundaries(
            max_chars in 100usize..500
        ) {
            // Generate predictable content
            let content = format!("HEAD_START{}{}_END_TAIL", "X".repeat(max_chars * 2), "Y".repeat(100));

            let result = MessageCompressor::compress_tool_output(&content, max_chars);

            // Head should be preserved
            prop_assert!(
                result.starts_with("HEAD_START"),
                "Head should be preserved in compressed output"
            );

            // Tail should be preserved
            prop_assert!(
                result.ends_with("_END_TAIL"),
                "Tail should be preserved in compressed output"
            );
        }
    }

    // ============================================================================
    // Property 7: Incremental Compression
    // ============================================================================

    // **Property 7: Incremental Compression**
    //
    // *For any* message added to context manager with incremental compression enabled,
    // if the message content exceeds thresholds, it SHALL be compressed before storage.
    //
    // **Validates: Requirements 4.6**
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        /// Test that extract_code_blocks finds all code blocks
        #[test]
        fn property_7_extract_code_blocks_complete(
            num_blocks in 1usize..5
        ) {
            // Generate text with multiple code blocks
            let mut text = String::new();
            for i in 0..num_blocks {
                text.push_str(&format!("Text before block {}\n", i));
                text.push_str(&format!("```rust\nfn block_{}() {{}}\n```\n", i));
            }

            let blocks = MessageCompressor::extract_code_blocks(&text);

            prop_assert_eq!(
                blocks.len(), num_blocks,
                "Should find all {} code blocks", num_blocks
            );
        }

        /// Test that extract_file_references finds file paths
        #[test]
        fn property_7_extract_file_references(
            filename in "[a-z]{3,10}",
            extension in prop::sample::select(vec!["rs", "ts", "js", "py", "go"])
        ) {
            let path = format!("src/{}.{}", filename, extension);
            let text = format!("Check the file {} for details", path);

            let refs = MessageCompressor::extract_file_references(&text);

            prop_assert!(
                refs.contains(&path),
                "Should find file reference {} in {:?}", path, refs
            );
        }

        /// Test that compress_code_blocks_in_text handles multiple blocks
        #[test]
        fn property_7_compress_multiple_code_blocks(
            max_lines in 10usize..30
        ) {
            // Create text with multiple large code blocks
            let large_code: String = (0..100).map(|i| format!("    line_{}\n", i)).collect();
            let text = format!(
                "First block:\n```rust\n{}```\nSecond block:\n```python\n{}```",
                large_code, large_code
            );

            let result = MessageCompressor::compress_code_blocks_in_text(&text, max_lines);

            // Both blocks should be compressed
            let omission_count = result.matches("lines omitted").count();
            prop_assert_eq!(
                omission_count, 2,
                "Both code blocks should be compressed"
            );
        }

        /// Test that truncate_messages preserves first and last messages
        #[test]
        fn property_7_truncate_preserves_boundaries(
            keep_first in 1usize..5,
            keep_last in 1usize..5
        ) {
            use crate::conversation::message::Message;

            // Create messages with identifiable content
            let mut messages = Vec::new();
            for i in 0..20 {
                messages.push(Message::user().with_text(format!("Message {}", i)));
            }

            let result = MessageCompressor::truncate_messages(&messages, 100000, keep_first, keep_last);

            // First messages should be preserved
            for (i, msg) in result.iter().enumerate().take(keep_first.min(result.len())) {
                let text = msg.as_concat_text();
                prop_assert!(
                    text.contains(&format!("Message {}", i)),
                    "First message {} should be preserved", i
                );
            }

            // Last messages should be preserved
            if result.len() >= keep_last {
                for i in 0..keep_last {
                    let idx = result.len() - keep_last + i;
                    let original_idx = 20 - keep_last + i;
                    let text = result[idx].as_concat_text();
                    prop_assert!(
                        text.contains(&format!("Message {}", original_idx)),
                        "Last message {} should be preserved", original_idx
                    );
                }
            }
        }
    }
}
