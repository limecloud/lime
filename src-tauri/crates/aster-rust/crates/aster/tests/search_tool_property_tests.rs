//! Property-based tests for Search Tools
//!
//! **Property 10: Result Truncation**
//! *For any* search operation that produces results exceeding the configured limit,
//! the results SHALL be truncated and a truncation indicator SHALL be included.
//!
//! **Validates: Requirements 5.8**

use aster::tools::search::{format_search_results, truncate_results, SearchResult};
use aster::tools::{GlobTool, GrepTool, Tool, ToolContext};
use proptest::prelude::*;
use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;
use tempfile::TempDir;

// ============================================================================
// Arbitrary Generators
// ============================================================================

/// Generate arbitrary file paths
fn arb_file_path() -> impl Strategy<Value = PathBuf> {
    "[a-z]{1,8}/[a-z]{1,8}\\.(txt|rs|py|md)".prop_map(PathBuf::from)
}

/// Generate arbitrary line numbers
fn arb_line_number() -> impl Strategy<Value = usize> {
    1usize..10000
}

/// Generate arbitrary line content
fn arb_line_content() -> impl Strategy<Value = String> {
    "[a-zA-Z0-9 ]{10,100}".prop_map(|s| s)
}

/// Generate arbitrary match counts
fn arb_match_count() -> impl Strategy<Value = usize> {
    1usize..1000
}

/// Generate arbitrary max results limit
fn arb_max_results() -> impl Strategy<Value = usize> {
    1usize..50
}

/// Generate arbitrary SearchResult for content match
fn arb_content_search_result() -> impl Strategy<Value = SearchResult> {
    (arb_file_path(), arb_line_number(), arb_line_content()).prop_map(
        |(path, line_number, content)| SearchResult::content_match(path, line_number, content),
    )
}

/// Generate arbitrary SearchResult for file match
fn arb_file_search_result() -> impl Strategy<Value = SearchResult> {
    arb_file_path().prop_map(SearchResult::file_match)
}

/// Generate arbitrary SearchResult for count match
fn arb_count_search_result() -> impl Strategy<Value = SearchResult> {
    (arb_file_path(), arb_match_count())
        .prop_map(|(path, count)| SearchResult::count_match(path, count))
}

/// Generate a vector of search results
fn arb_search_results(max_count: usize) -> impl Strategy<Value = Vec<SearchResult>> {
    prop::collection::vec(
        prop_oneof![
            arb_content_search_result(),
            arb_file_search_result(),
            arb_count_search_result(),
        ],
        0..max_count,
    )
}

// ============================================================================
// Helper Functions
// ============================================================================

fn create_test_files(dir: &TempDir, count: usize) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    for i in 0..count {
        let path = dir.path().join(format!("test_{}.txt", i));
        let mut f = File::create(&path).unwrap();
        writeln!(f, "Line 1 of file {}", i).unwrap();
        writeln!(f, "Line 2 with searchable content").unwrap();
        writeln!(f, "Line 3 end of file {}", i).unwrap();
        paths.push(path);
    }
    paths
}

// ============================================================================
// Property Tests - Property 10: Result Truncation
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: tool-alignment, Property 10: Result Truncation**
    ///
    /// Property: Results exceeding max_results are truncated
    /// *For any* set of search results larger than max_results,
    /// truncate_results SHALL return exactly max_results items.
    ///
    /// **Validates: Requirements 5.8**
    #[test]
    fn prop_results_truncated_to_max(
        results in arb_search_results(100),
        max_results in arb_max_results()
    ) {
        let (truncated, was_truncated) = truncate_results(results.clone(), max_results);

        if results.len() > max_results {
            prop_assert_eq!(
                truncated.len(),
                max_results,
                "Truncated results should have exactly max_results items"
            );
            prop_assert!(
                was_truncated,
                "was_truncated should be true when results exceed limit"
            );
        } else {
            prop_assert_eq!(
                truncated.len(),
                results.len(),
                "Results within limit should not be truncated"
            );
            prop_assert!(
                !was_truncated,
                "was_truncated should be false when results within limit"
            );
        }
    }

    /// **Feature: tool-alignment, Property 10: Result Truncation**
    ///
    /// Property: Truncation preserves order
    /// *For any* set of search results, truncation SHALL preserve
    /// the original order of results.
    ///
    /// **Validates: Requirements 5.8**
    #[test]
    fn prop_truncation_preserves_order(
        results in arb_search_results(50),
        max_results in 1usize..20
    ) {
        let (truncated, _) = truncate_results(results.clone(), max_results);

        // Verify order is preserved
        for (i, result) in truncated.iter().enumerate() {
            prop_assert_eq!(
                &result.path,
                &results[i].path,
                "Truncation should preserve order at index {}", i
            );
        }
    }

    /// **Feature: tool-alignment, Property 10: Result Truncation**
    ///
    /// Property: Formatted output indicates truncation
    /// *For any* truncated results, the formatted output SHALL
    /// contain a truncation indicator.
    ///
    /// **Validates: Requirements 5.8**
    #[test]
    fn prop_formatted_output_indicates_truncation(
        results in arb_search_results(20)
    ) {
        let output_truncated = format_search_results(&results, true);
        let output_not_truncated = format_search_results(&results, false);

        prop_assert!(
            output_truncated.contains("[Results truncated"),
            "Truncated output should contain truncation indicator"
        );
        prop_assert!(
            !output_not_truncated.contains("[Results truncated"),
            "Non-truncated output should not contain truncation indicator"
        );
    }

    /// **Feature: tool-alignment, Property 10: Result Truncation**
    ///
    /// Property: Content match format is consistent
    /// *For any* content search result, the formatted output SHALL
    /// contain the file path, line number, and content.
    ///
    /// **Validates: Requirements 5.8**
    #[test]
    fn prop_content_match_format_consistent(
        path in arb_file_path(),
        line_number in arb_line_number(),
        content in arb_line_content()
    ) {
        let result = SearchResult::content_match(path.clone(), line_number, content.clone());
        let output = format_search_results(&[result], false);

        prop_assert!(
            output.contains(&path.to_string_lossy().to_string()),
            "Output should contain file path"
        );
        prop_assert!(
            output.contains(&line_number.to_string()),
            "Output should contain line number"
        );
        prop_assert!(
            output.contains(&content),
            "Output should contain line content"
        );
    }

    /// **Feature: tool-alignment, Property 10: Result Truncation**
    ///
    /// Property: Count match format is consistent
    /// *For any* count search result, the formatted output SHALL
    /// contain the file path and match count.
    ///
    /// **Validates: Requirements 5.8**
    #[test]
    fn prop_count_match_format_consistent(
        path in arb_file_path(),
        count in arb_match_count()
    ) {
        let result = SearchResult::count_match(path.clone(), count);
        let output = format_search_results(&[result], false);

        prop_assert!(
            output.contains(&path.to_string_lossy().to_string()),
            "Output should contain file path"
        );
        prop_assert!(
            output.contains(&count.to_string()),
            "Output should contain match count"
        );
    }

    /// **Feature: tool-alignment, Property 10: Result Truncation**
    ///
    /// Property: File match format is consistent
    /// *For any* file search result, the formatted output SHALL
    /// contain the file path.
    ///
    /// **Validates: Requirements 5.8**
    #[test]
    fn prop_file_match_format_consistent(
        path in arb_file_path()
    ) {
        let result = SearchResult::file_match(path.clone());
        let output = format_search_results(&[result], false);

        prop_assert!(
            output.contains(&path.to_string_lossy().to_string()),
            "Output should contain file path"
        );
    }
}

// ============================================================================
// GlobTool Property Tests
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: tool-alignment, Property 10: Result Truncation**
    ///
    /// Property: GlobTool respects max_results parameter
    /// *For any* glob search with max_results set, the tool SHALL
    /// return at most max_results items.
    ///
    /// **Validates: Requirements 5.8**
    #[test]
    fn prop_glob_respects_max_results(
        max_results in 1usize..10
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            // Create more files than max_results
            create_test_files(&temp_dir, max_results + 5);

            let tool = GlobTool::new().with_max_results(max_results);
            let context = ToolContext::new(temp_dir.path().to_path_buf());
            let params = serde_json::json!({
                "pattern": "*.txt",
                "max_results": max_results
            });

            let result = tool.execute(params, &context).await.unwrap();
            let count = result.metadata.get("count")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as usize;

            prop_assert!(
                count <= max_results,
                "GlobTool should return at most {} results, got {}",
                max_results,
                count
            );

            Ok(())
        })?;
    }

    /// **Feature: tool-alignment, Property 10: Result Truncation**
    ///
    /// Property: GlobTool indicates truncation in metadata
    /// *For any* glob search that exceeds max_results, the metadata
    /// SHALL indicate truncation.
    ///
    /// **Validates: Requirements 5.8**
    #[test]
    fn prop_glob_indicates_truncation(
        max_results in 1usize..5
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            // Create more files than max_results
            create_test_files(&temp_dir, max_results + 10);

            let tool = GlobTool::new();
            let context = ToolContext::new(temp_dir.path().to_path_buf());
            let params = serde_json::json!({
                "pattern": "*.txt",
                "max_results": max_results
            });

            let result = tool.execute(params, &context).await.unwrap();
            let truncated = result.metadata.get("truncated")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            prop_assert!(
                truncated,
                "GlobTool should indicate truncation when results exceed limit"
            );

            Ok(())
        })?;
    }
}

// ============================================================================
// GrepTool Property Tests
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: tool-alignment, Property 10: Result Truncation**
    ///
    /// Property: GrepTool respects max_results parameter
    /// *For any* grep search with max_results set, the tool SHALL
    /// return at most max_results items.
    ///
    /// **Validates: Requirements 5.8**
    #[test]
    fn prop_grep_respects_max_results(
        max_results in 1usize..10
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            // Create files with searchable content
            for i in 0..(max_results + 5) {
                let path = temp_dir.path().join(format!("test_{}.txt", i));
                let mut f = File::create(&path).unwrap();
                for j in 0..5 {
                    writeln!(f, "searchable line {} in file {}", j, i).unwrap();
                }
            }

            let tool = GrepTool::new().with_max_results(max_results);
            let context = ToolContext::new(temp_dir.path().to_path_buf());
            let params = serde_json::json!({
                "pattern": "searchable",
                "max_results": max_results
            });

            let result = tool.execute(params, &context).await.unwrap();
            let count = result.metadata.get("count")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as usize;

            prop_assert!(
                count <= max_results,
                "GrepTool should return at most {} results, got {}",
                max_results,
                count
            );

            Ok(())
        })?;
    }

    /// **Feature: tool-alignment, Property 10: Result Truncation**
    ///
    /// Property: GrepTool output mode is preserved
    /// *For any* grep search with a specific mode, the metadata
    /// SHALL reflect the requested mode.
    ///
    /// **Validates: Requirements 5.4**
    #[test]
    fn prop_grep_mode_preserved(
        mode in prop_oneof![
            Just("content"),
            Just("files_with_matches"),
            Just("count"),
        ]
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            create_test_files(&temp_dir, 3);

            let tool = GrepTool::new();
            let context = ToolContext::new(temp_dir.path().to_path_buf());
            let params = serde_json::json!({
                "pattern": "Line",
                "mode": mode
            });

            let result = tool.execute(params, &context).await.unwrap();
            let result_mode = result.metadata.get("mode")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            // Mode should be reflected in metadata (capitalized enum variant)
            let expected_mode = match mode {
                "content" => "Content",
                "files_with_matches" => "FilesWithMatches",
                "count" => "Count",
                _ => "",
            };

            prop_assert_eq!(
                result_mode,
                expected_mode,
                "GrepTool mode should be preserved in metadata"
            );

            Ok(())
        })?;
    }
}

// ============================================================================
// Edge Case Unit Tests
// ============================================================================

#[cfg(test)]
mod edge_case_tests {
    use super::*;

    #[test]
    fn test_empty_results_truncation() {
        let results: Vec<SearchResult> = vec![];
        let (truncated, was_truncated) = truncate_results(results, 10);
        assert!(truncated.is_empty());
        assert!(!was_truncated);
    }

    #[test]
    fn test_exact_limit_results() {
        let results: Vec<SearchResult> = (0..10)
            .map(|i| SearchResult::file_match(PathBuf::from(format!("file{}.txt", i))))
            .collect();
        let (truncated, was_truncated) = truncate_results(results, 10);
        assert_eq!(truncated.len(), 10);
        assert!(!was_truncated);
    }

    #[test]
    fn test_format_empty_results() {
        let results: Vec<SearchResult> = vec![];
        let output = format_search_results(&results, false);
        assert!(output.is_empty());
    }

    #[test]
    fn test_search_result_with_context() {
        let result =
            SearchResult::content_match(PathBuf::from("test.txt"), 5, "match line".to_string())
                .with_context(
                    vec!["before 1".to_string(), "before 2".to_string()],
                    vec!["after 1".to_string()],
                );

        assert_eq!(result.context_before.len(), 2);
        assert_eq!(result.context_after.len(), 1);
    }

    #[tokio::test]
    async fn test_glob_no_matches() {
        let temp_dir = TempDir::new().unwrap();
        create_test_files(&temp_dir, 3);

        let tool = GlobTool::new();
        let context = ToolContext::new(temp_dir.path().to_path_buf());
        let params = serde_json::json!({
            "pattern": "*.nonexistent"
        });

        let result = tool.execute(params, &context).await.unwrap();
        let count = result
            .metadata
            .get("count")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn test_grep_no_matches() {
        let temp_dir = TempDir::new().unwrap();
        create_test_files(&temp_dir, 3);

        let tool = GrepTool::new();
        let context = ToolContext::new(temp_dir.path().to_path_buf());
        let params = serde_json::json!({
            "pattern": "nonexistent_pattern_xyz"
        });

        let result = tool.execute(params, &context).await.unwrap();
        let count = result
            .metadata
            .get("count")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn test_glob_with_exclude() {
        let temp_dir = TempDir::new().unwrap();

        // Create files in different directories
        fs::create_dir_all(temp_dir.path().join("src")).unwrap();
        fs::create_dir_all(temp_dir.path().join("node_modules")).unwrap();

        File::create(temp_dir.path().join("src/main.txt")).unwrap();
        File::create(temp_dir.path().join("node_modules/dep.txt")).unwrap();

        let tool = GlobTool::new();
        let context = ToolContext::new(temp_dir.path().to_path_buf());
        let params = serde_json::json!({
            "pattern": "**/*.txt",
            "exclude": ["node_modules"]
        });

        let result = tool.execute(params, &context).await.unwrap();
        let output = result.output.unwrap();

        assert!(output.contains("main.txt"));
        assert!(!output.contains("node_modules"));
    }

    #[tokio::test]
    async fn test_grep_case_insensitive() {
        let temp_dir = TempDir::new().unwrap();
        let path = temp_dir.path().join("test.txt");
        let mut f = File::create(&path).unwrap();
        writeln!(f, "Hello World").unwrap();
        writeln!(f, "hello world").unwrap();
        writeln!(f, "HELLO WORLD").unwrap();

        let tool = GrepTool::new();
        let context = ToolContext::new(temp_dir.path().to_path_buf());

        // Case sensitive
        let params_sensitive = serde_json::json!({
            "pattern": "Hello",
            "case_insensitive": false
        });
        let result_sensitive = tool.execute(params_sensitive, &context).await.unwrap();

        // Case insensitive
        let params_insensitive = serde_json::json!({
            "pattern": "Hello",
            "case_insensitive": true
        });
        let result_insensitive = tool.execute(params_insensitive, &context).await.unwrap();

        let count_sensitive = result_sensitive
            .metadata
            .get("count")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let count_insensitive = result_insensitive
            .metadata
            .get("count")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);

        assert!(count_insensitive >= count_sensitive);
    }
}
