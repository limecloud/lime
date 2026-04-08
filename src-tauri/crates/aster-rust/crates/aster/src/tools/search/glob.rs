//! Glob Tool Implementation
//!
//! Provides file search using glob patterns with results sorted by modification time.
//!
//! Requirements: 5.1, 5.2

use async_trait::async_trait;
use glob::glob as glob_match;
use std::cmp::Reverse;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use crate::tools::base::{PermissionCheckResult, Tool};
use crate::tools::context::{ToolContext, ToolOptions, ToolResult};
use crate::tools::error::ToolError;

use super::{format_search_results, truncate_results, SearchResult, DEFAULT_MAX_RESULTS};

/// Glob tool for finding files using glob patterns
///
/// Supports standard glob patterns:
/// - `*` matches any sequence of characters except path separators
/// - `**` matches any sequence of characters including path separators
/// - `?` matches any single character
/// - `[abc]` matches any character in the brackets
/// - `[!abc]` matches any character not in the brackets
///
/// Requirements: 5.1, 5.2
pub struct GlobTool {
    /// Maximum number of results to return
    max_results: usize,
}

impl Default for GlobTool {
    fn default() -> Self {
        Self::new()
    }
}

impl GlobTool {
    /// Create a new GlobTool with default settings
    pub fn new() -> Self {
        Self {
            max_results: DEFAULT_MAX_RESULTS,
        }
    }

    /// Set the maximum number of results
    pub fn with_max_results(mut self, max_results: usize) -> Self {
        self.max_results = max_results;
        self
    }

    /// Execute glob search
    pub fn search(&self, pattern: &str, base_path: &Path) -> Result<Vec<SearchResult>, ToolError> {
        // Construct the full pattern
        let full_pattern = if pattern.starts_with('/') || pattern.starts_with("./") {
            pattern.to_string()
        } else {
            format!("{}/{}", base_path.display(), pattern)
        };

        // Execute glob
        let paths = glob_match(&full_pattern)
            .map_err(|e| ToolError::invalid_params(format!("Invalid glob pattern: {}", e)))?;

        // Collect results with metadata
        let mut results: Vec<(SearchResult, Option<SystemTime>)> = Vec::new();

        for entry in paths {
            match entry {
                Ok(path) => {
                    // Skip directories unless explicitly requested
                    if path.is_dir() {
                        continue;
                    }

                    let mut result = SearchResult::file_match(path.clone());

                    // Get file metadata for sorting and display
                    if let Ok(metadata) = fs::metadata(&path) {
                        let mtime = metadata.modified().ok();
                        let size = metadata.len();

                        if let Some(mt) = mtime {
                            result = result.with_metadata(mt, size);
                        }

                        results.push((result, mtime));
                    } else {
                        results.push((result, None));
                    }
                }
                Err(e) => {
                    // Log but continue on individual file errors
                    tracing::warn!("Glob error for entry: {}", e);
                }
            }
        }

        // Sort by modification time (newest first)
        // Requirements: 5.2
        results.sort_by(|a, b| match (&a.1, &b.1) {
            (Some(a_time), Some(b_time)) => Reverse(a_time).cmp(&Reverse(b_time)),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => std::cmp::Ordering::Equal,
        });

        // Extract just the results
        let results: Vec<SearchResult> = results.into_iter().map(|(r, _)| r).collect();

        Ok(results)
    }

    /// Search with include/exclude patterns
    pub fn search_with_filters(
        &self,
        pattern: &str,
        base_path: &Path,
        exclude_patterns: &[String],
    ) -> Result<Vec<SearchResult>, ToolError> {
        let results = self.search(pattern, base_path)?;

        // Filter out excluded patterns
        let filtered: Vec<SearchResult> = results
            .into_iter()
            .filter(|r| {
                let path_str = r.path.to_string_lossy();
                !exclude_patterns.iter().any(|exclude| {
                    // Simple substring match for exclusion
                    path_str.contains(exclude)
                })
            })
            .collect();

        Ok(filtered)
    }
}

#[async_trait]
impl Tool for GlobTool {
    fn name(&self) -> &str {
        "Glob"
    }

    fn description(&self) -> &str {
        "Find files using glob patterns. Supports wildcards like *, **, ?, and character classes. \
         Results are sorted by modification time (newest first)."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "Glob pattern to match files. Examples: '*.rs', 'src/**/*.ts', 'test_*.py'"
                },
                "path": {
                    "type": "string",
                    "description": "Base path to search from. Defaults to working directory."
                },
                "exclude": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Patterns to exclude from results (e.g., ['node_modules', '.git'])"
                },
                "max_results": {
                    "type": "integer",
                    "description": "Maximum number of results to return. Default: 100"
                }
            },
            "required": ["pattern"]
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        // Check for cancellation
        if context.is_cancelled() {
            return Err(ToolError::Cancelled);
        }

        // Parse parameters
        let pattern = params
            .get("pattern")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::invalid_params("Missing required parameter: pattern"))?;

        let base_path = params
            .get("path")
            .and_then(|v| v.as_str())
            .map(PathBuf::from)
            .unwrap_or_else(|| context.working_directory.clone());

        let exclude_patterns: Vec<String> = params
            .get("exclude")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        let max_results = params
            .get("max_results")
            .and_then(|v| v.as_u64())
            .map(|v| v as usize)
            .unwrap_or(self.max_results);

        // Execute search
        let results = if exclude_patterns.is_empty() {
            self.search(pattern, &base_path)?
        } else {
            self.search_with_filters(pattern, &base_path, &exclude_patterns)?
        };

        // Truncate if needed
        let (results, truncated) = truncate_results(results, max_results);

        // Format output
        let output = format_search_results(&results, truncated);

        Ok(ToolResult::success(output)
            .with_metadata("count", serde_json::json!(results.len()))
            .with_metadata("truncated", serde_json::json!(truncated)))
    }

    async fn check_permissions(
        &self,
        _params: &serde_json::Value,
        _context: &ToolContext,
    ) -> PermissionCheckResult {
        // Glob is a read-only operation, generally safe
        PermissionCheckResult::allow()
    }

    fn options(&self) -> ToolOptions {
        ToolOptions::default().with_base_timeout(std::time::Duration::from_secs(60))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use tempfile::TempDir;

    fn create_test_files(dir: &TempDir) -> Vec<PathBuf> {
        let files = vec![
            "test1.txt",
            "test2.txt",
            "src/main.rs",
            "src/lib.rs",
            "src/utils/helper.rs",
            "docs/readme.md",
        ];

        let mut paths = Vec::new();
        for file in files {
            let path = dir.path().join(file);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            let mut f = File::create(&path).unwrap();
            writeln!(f, "content of {}", file).unwrap();
            paths.push(path);
            // Small delay to ensure different mtimes
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        paths
    }

    #[test]
    fn test_glob_tool_new() {
        let tool = GlobTool::new();
        assert_eq!(tool.max_results, DEFAULT_MAX_RESULTS);
    }

    #[test]
    fn test_glob_tool_with_max_results() {
        let tool = GlobTool::new().with_max_results(50);
        assert_eq!(tool.max_results, 50);
    }

    #[test]
    fn test_glob_search_simple() {
        let temp_dir = TempDir::new().unwrap();
        create_test_files(&temp_dir);

        let tool = GlobTool::new();
        let results = tool.search("*.txt", temp_dir.path()).unwrap();

        assert_eq!(results.len(), 2);
        assert!(results.iter().all(|r| r.path.extension().unwrap() == "txt"));
    }

    #[test]
    fn test_glob_search_recursive() {
        let temp_dir = TempDir::new().unwrap();
        create_test_files(&temp_dir);

        let tool = GlobTool::new();
        let results = tool.search("**/*.rs", temp_dir.path()).unwrap();

        assert_eq!(results.len(), 3);
        assert!(results.iter().all(|r| r.path.extension().unwrap() == "rs"));
    }

    #[test]
    fn test_glob_search_sorted_by_mtime() {
        let temp_dir = TempDir::new().unwrap();
        create_test_files(&temp_dir);

        let tool = GlobTool::new();
        let results = tool.search("**/*", temp_dir.path()).unwrap();

        // Results should be sorted by mtime (newest first)
        for i in 0..results.len().saturating_sub(1) {
            if let (Some(mtime1), Some(mtime2)) = (results[i].mtime, results[i + 1].mtime) {
                assert!(
                    mtime1 >= mtime2,
                    "Results should be sorted by mtime (newest first)"
                );
            }
        }
    }

    #[test]
    fn test_glob_search_with_exclude() {
        let temp_dir = TempDir::new().unwrap();
        create_test_files(&temp_dir);

        let tool = GlobTool::new();
        let results = tool
            .search_with_filters("**/*", temp_dir.path(), &["utils".to_string()])
            .unwrap();

        // Should not include files in utils directory
        assert!(results
            .iter()
            .all(|r| !r.path.to_string_lossy().contains("utils")));
    }

    #[test]
    fn test_glob_invalid_pattern() {
        let temp_dir = TempDir::new().unwrap();
        let tool = GlobTool::new();

        // Invalid pattern with unclosed bracket
        let result = tool.search("[invalid", temp_dir.path());
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_glob_tool_execute() {
        let temp_dir = TempDir::new().unwrap();
        create_test_files(&temp_dir);

        let tool = GlobTool::new();
        let context = ToolContext::new(temp_dir.path().to_path_buf());
        let params = serde_json::json!({
            "pattern": "*.txt"
        });

        let result = tool.execute(params, &context).await.unwrap();
        assert!(result.is_success());
        assert!(result.output.is_some());

        let output = result.output.unwrap();
        assert!(output.contains("test1.txt"));
        assert!(output.contains("test2.txt"));
    }

    #[tokio::test]
    async fn test_glob_tool_execute_with_path() {
        let temp_dir = TempDir::new().unwrap();
        create_test_files(&temp_dir);

        let tool = GlobTool::new();
        let context = ToolContext::new(PathBuf::from("/tmp"));
        let params = serde_json::json!({
            "pattern": "*.rs",
            "path": temp_dir.path().join("src").to_str().unwrap()
        });

        let result = tool.execute(params, &context).await.unwrap();
        assert!(result.is_success());

        let output = result.output.unwrap();
        assert!(output.contains("main.rs"));
        assert!(output.contains("lib.rs"));
    }

    #[tokio::test]
    async fn test_glob_tool_execute_with_exclude() {
        let temp_dir = TempDir::new().unwrap();
        create_test_files(&temp_dir);

        let tool = GlobTool::new();
        let context = ToolContext::new(temp_dir.path().to_path_buf());
        let params = serde_json::json!({
            "pattern": "**/*.rs",
            "exclude": ["utils"]
        });

        let result = tool.execute(params, &context).await.unwrap();
        assert!(result.is_success());

        let output = result.output.unwrap();
        assert!(!output.contains("helper.rs"));
        assert!(output.contains("main.rs"));
    }

    #[tokio::test]
    async fn test_glob_tool_execute_with_max_results() {
        let temp_dir = TempDir::new().unwrap();
        create_test_files(&temp_dir);

        let tool = GlobTool::new();
        let context = ToolContext::new(temp_dir.path().to_path_buf());
        let params = serde_json::json!({
            "pattern": "**/*",
            "max_results": 2
        });

        let result = tool.execute(params, &context).await.unwrap();
        assert!(result.is_success());

        // Check metadata
        assert_eq!(result.metadata.get("count"), Some(&serde_json::json!(2)));
        assert_eq!(
            result.metadata.get("truncated"),
            Some(&serde_json::json!(true))
        );
    }

    #[tokio::test]
    async fn test_glob_tool_missing_pattern() {
        let tool = GlobTool::new();
        let context = ToolContext::new(PathBuf::from("/tmp"));
        let params = serde_json::json!({});

        let result = tool.execute(params, &context).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::InvalidParams(_)));
    }

    #[test]
    fn test_glob_tool_name() {
        let tool = GlobTool::new();
        assert_eq!(tool.name(), "Glob");
    }

    #[test]
    fn test_glob_tool_description() {
        let tool = GlobTool::new();
        assert!(!tool.description().is_empty());
        assert!(tool.description().contains("glob"));
    }

    #[test]
    fn test_glob_tool_input_schema() {
        let tool = GlobTool::new();
        let schema = tool.input_schema();

        assert_eq!(schema["type"], "object");
        assert!(schema["properties"]["pattern"].is_object());
        assert!(schema["properties"]["path"].is_object());
        assert!(schema["properties"]["exclude"].is_object());
        assert!(schema["required"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("pattern")));
    }

    #[tokio::test]
    async fn test_glob_tool_check_permissions() {
        let tool = GlobTool::new();
        let context = ToolContext::new(PathBuf::from("/tmp"));
        let params = serde_json::json!({"pattern": "*.txt"});

        let result = tool.check_permissions(&params, &context).await;
        assert!(result.is_allowed());
    }

    #[tokio::test]
    async fn test_glob_tool_cancellation() {
        let tool = GlobTool::new();
        let token = tokio_util::sync::CancellationToken::new();
        token.cancel();

        let context = ToolContext::new(PathBuf::from("/tmp")).with_cancellation_token(token);
        let params = serde_json::json!({"pattern": "*.txt"});

        let result = tool.execute(params, &context).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::Cancelled));
    }
}
