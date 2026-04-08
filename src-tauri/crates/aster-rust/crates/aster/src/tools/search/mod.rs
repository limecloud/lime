//! Search Tools Module
//!
//! This module provides search tools including:
//! - GlobTool: Find files using glob patterns
//! - GrepTool: Search file contents using regex patterns
//! - ripgrep: Enhanced ripgrep integration with vendored binary support
//!
//! Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8

pub mod glob;
pub mod grep;
pub mod ripgrep;

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::SystemTime;

// Re-export tools
pub use glob::GlobTool;
pub use grep::{GrepOutputMode, GrepTool};

/// Maximum number of search results to return by default
pub const DEFAULT_MAX_RESULTS: usize = 100;

/// Maximum number of context lines for grep
pub const DEFAULT_MAX_CONTEXT_LINES: usize = 5;

/// Maximum total output size in bytes
pub const MAX_OUTPUT_SIZE: usize = 100_000;

/// A single search result entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    /// Path to the matched file
    pub path: PathBuf,

    /// Line number (1-indexed) where match was found (for grep)
    pub line_number: Option<usize>,

    /// The matched line content (for grep)
    pub line_content: Option<String>,

    /// Context lines before the match
    pub context_before: Vec<String>,

    /// Context lines after the match
    pub context_after: Vec<String>,

    /// File modification time (for glob)
    pub mtime: Option<SystemTime>,

    /// File size in bytes (for glob)
    pub size: Option<u64>,

    /// Match count (for count mode)
    pub match_count: Option<usize>,
}

impl SearchResult {
    /// Create a new SearchResult for a file match (glob)
    pub fn file_match(path: PathBuf) -> Self {
        Self {
            path,
            line_number: None,
            line_content: None,
            context_before: Vec::new(),
            context_after: Vec::new(),
            mtime: None,
            size: None,
            match_count: None,
        }
    }

    /// Create a new SearchResult for a content match (grep)
    pub fn content_match(path: PathBuf, line_number: usize, line_content: String) -> Self {
        Self {
            path,
            line_number: Some(line_number),
            line_content: Some(line_content),
            context_before: Vec::new(),
            context_after: Vec::new(),
            mtime: None,
            size: None,
            match_count: None,
        }
    }

    /// Create a new SearchResult for count mode
    pub fn count_match(path: PathBuf, count: usize) -> Self {
        Self {
            path,
            line_number: None,
            line_content: None,
            context_before: Vec::new(),
            context_after: Vec::new(),
            mtime: None,
            size: None,
            match_count: Some(count),
        }
    }

    /// Set file metadata
    pub fn with_metadata(mut self, mtime: SystemTime, size: u64) -> Self {
        self.mtime = Some(mtime);
        self.size = Some(size);
        self
    }

    /// Set context lines
    pub fn with_context(mut self, before: Vec<String>, after: Vec<String>) -> Self {
        self.context_before = before;
        self.context_after = after;
        self
    }
}

/// Format search results for output
pub fn format_search_results(results: &[SearchResult], truncated: bool) -> String {
    let mut output = String::new();

    for result in results {
        if let Some(line_number) = result.line_number {
            // Grep-style output
            output.push_str(&format!(
                "{}:{}:{}\n",
                result.path.display(),
                line_number,
                result.line_content.as_deref().unwrap_or("")
            ));
        } else if let Some(count) = result.match_count {
            // Count mode output
            output.push_str(&format!("{}:{}\n", result.path.display(), count));
        } else {
            // Glob-style output (just the path)
            output.push_str(&format!("{}\n", result.path.display()));
        }
    }

    if truncated {
        output.push_str(&format!(
            "\n[Results truncated. Showing {} of more results.]\n",
            results.len()
        ));
    }

    output
}

/// Truncate results to fit within size limit
pub fn truncate_results(
    results: Vec<SearchResult>,
    max_results: usize,
) -> (Vec<SearchResult>, bool) {
    if results.len() > max_results {
        (results.into_iter().take(max_results).collect(), true)
    } else {
        (results, false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_search_result_file_match() {
        let result = SearchResult::file_match(PathBuf::from("/tmp/test.txt"));
        assert_eq!(result.path, PathBuf::from("/tmp/test.txt"));
        assert!(result.line_number.is_none());
        assert!(result.line_content.is_none());
    }

    #[test]
    fn test_search_result_content_match() {
        let result = SearchResult::content_match(
            PathBuf::from("/tmp/test.txt"),
            42,
            "Hello, World!".to_string(),
        );
        assert_eq!(result.path, PathBuf::from("/tmp/test.txt"));
        assert_eq!(result.line_number, Some(42));
        assert_eq!(result.line_content, Some("Hello, World!".to_string()));
    }

    #[test]
    fn test_search_result_count_match() {
        let result = SearchResult::count_match(PathBuf::from("/tmp/test.txt"), 10);
        assert_eq!(result.path, PathBuf::from("/tmp/test.txt"));
        assert_eq!(result.match_count, Some(10));
    }

    #[test]
    fn test_search_result_with_metadata() {
        let mtime = SystemTime::now();
        let result =
            SearchResult::file_match(PathBuf::from("/tmp/test.txt")).with_metadata(mtime, 1024);
        assert_eq!(result.mtime, Some(mtime));
        assert_eq!(result.size, Some(1024));
    }

    #[test]
    fn test_search_result_with_context() {
        let result = SearchResult::content_match(
            PathBuf::from("/tmp/test.txt"),
            5,
            "match line".to_string(),
        )
        .with_context(
            vec!["line 3".to_string(), "line 4".to_string()],
            vec!["line 6".to_string(), "line 7".to_string()],
        );
        assert_eq!(result.context_before.len(), 2);
        assert_eq!(result.context_after.len(), 2);
    }

    #[test]
    fn test_format_search_results_grep() {
        let results = vec![
            SearchResult::content_match(PathBuf::from("/tmp/test.txt"), 10, "Hello".to_string()),
            SearchResult::content_match(PathBuf::from("/tmp/test.txt"), 20, "World".to_string()),
        ];

        let output = format_search_results(&results, false);
        assert!(output.contains("/tmp/test.txt:10:Hello"));
        assert!(output.contains("/tmp/test.txt:20:World"));
    }

    #[test]
    fn test_format_search_results_glob() {
        let results = vec![
            SearchResult::file_match(PathBuf::from("/tmp/a.txt")),
            SearchResult::file_match(PathBuf::from("/tmp/b.txt")),
        ];

        let output = format_search_results(&results, false);
        assert!(output.contains("/tmp/a.txt"));
        assert!(output.contains("/tmp/b.txt"));
    }

    #[test]
    fn test_format_search_results_truncated() {
        let results = vec![SearchResult::file_match(PathBuf::from("/tmp/test.txt"))];
        let output = format_search_results(&results, true);
        assert!(output.contains("[Results truncated"));
    }

    #[test]
    fn test_truncate_results() {
        let results: Vec<SearchResult> = (0..10)
            .map(|i| SearchResult::file_match(PathBuf::from(format!("/tmp/test{}.txt", i))))
            .collect();

        let (truncated, was_truncated) = truncate_results(results.clone(), 5);
        assert_eq!(truncated.len(), 5);
        assert!(was_truncated);

        let (not_truncated, was_truncated) = truncate_results(results, 20);
        assert_eq!(not_truncated.len(), 10);
        assert!(!was_truncated);
    }
}
