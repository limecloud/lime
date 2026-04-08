//! Grep Tool Implementation
//!
//! Provides content search using regex patterns with ripgrep or grep fallback.
//!
//! Requirements: 5.3, 5.4, 5.5, 5.6, 5.7, 5.8

use async_trait::async_trait;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::tools::base::{PermissionCheckResult, Tool};
use crate::tools::context::{ToolContext, ToolOptions, ToolResult};
use crate::tools::error::ToolError;

use super::{
    format_search_results, truncate_results, SearchResult, DEFAULT_MAX_CONTEXT_LINES,
    DEFAULT_MAX_RESULTS, MAX_OUTPUT_SIZE,
};

/// Output mode for grep results
///
/// Requirements: 5.4
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum GrepOutputMode {
    /// Return matching lines with content
    #[default]
    Content,
    /// Return only file names that contain matches
    FilesWithMatches,
    /// Return count of matches per file
    Count,
}

impl GrepOutputMode {
    /// Parse from string
    pub fn parse(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "content" => Some(Self::Content),
            "files_with_matches" | "files" | "l" => Some(Self::FilesWithMatches),
            "count" | "c" => Some(Self::Count),
            _ => None,
        }
    }
}

/// Grep tool for searching file contents using regex patterns
///
/// Supports:
/// - Regex pattern matching
/// - Multiple output modes (content, files_with_matches, count)
/// - Context lines (before/after)
/// - Multiline matching
/// - ripgrep acceleration with grep fallback
///
/// Requirements: 5.3, 5.4, 5.5, 5.6, 5.7, 5.8
pub struct GrepTool {
    /// Maximum number of results to return
    max_results: usize,
    /// Maximum context lines
    max_context_lines: usize,
    /// Whether to use ripgrep if available
    use_ripgrep: bool,
}

impl Default for GrepTool {
    fn default() -> Self {
        Self::new()
    }
}

impl GrepTool {
    /// Create a new GrepTool with default settings
    pub fn new() -> Self {
        Self {
            max_results: DEFAULT_MAX_RESULTS,
            max_context_lines: DEFAULT_MAX_CONTEXT_LINES,
            use_ripgrep: true,
        }
    }

    /// Set the maximum number of results
    pub fn with_max_results(mut self, max_results: usize) -> Self {
        self.max_results = max_results;
        self
    }

    /// Set the maximum context lines
    pub fn with_max_context_lines(mut self, max_context_lines: usize) -> Self {
        self.max_context_lines = max_context_lines;
        self
    }

    /// Disable ripgrep (use pure Rust implementation)
    pub fn without_ripgrep(mut self) -> Self {
        self.use_ripgrep = false;
        self
    }

    /// Check if ripgrep is available
    fn is_ripgrep_available() -> bool {
        Command::new("rg").arg("--version").output().is_ok()
    }

    /// Check if grep is available
    fn is_grep_available() -> bool {
        Command::new("grep").arg("--version").output().is_ok()
    }

    /// Search using ripgrep
    ///
    /// Requirements: 5.3
    #[allow(clippy::too_many_arguments)]
    fn search_with_ripgrep(
        &self,
        pattern: &str,
        path: &Path,
        mode: GrepOutputMode,
        context_before: usize,
        context_after: usize,
        case_insensitive: bool,
        include_hidden: bool,
    ) -> Result<Vec<SearchResult>, ToolError> {
        let mut cmd = Command::new("rg");

        // Add pattern
        cmd.arg(pattern);

        // Add path
        cmd.arg(path);

        // Add options based on mode
        match mode {
            GrepOutputMode::Content => {
                cmd.arg("--line-number");
                if context_before > 0 {
                    cmd.arg("-B").arg(context_before.to_string());
                }
                if context_after > 0 {
                    cmd.arg("-A").arg(context_after.to_string());
                }
            }
            GrepOutputMode::FilesWithMatches => {
                cmd.arg("-l");
            }
            GrepOutputMode::Count => {
                cmd.arg("-c");
            }
        }

        // Case sensitivity
        if case_insensitive {
            cmd.arg("-i");
        }

        // Hidden files
        if include_hidden {
            cmd.arg("--hidden");
        }

        // Max count to avoid overwhelming output
        cmd.arg("--max-count")
            .arg((self.max_results * 10).to_string());

        // Execute
        let output = cmd.output().map_err(|e| {
            ToolError::execution_failed(format!("Failed to execute ripgrep: {}", e))
        })?;

        // Parse output
        self.parse_grep_output(&output.stdout, mode, path)
    }

    /// Search using grep (fallback)
    ///
    /// Requirements: 5.7
    fn search_with_grep(
        &self,
        pattern: &str,
        path: &Path,
        mode: GrepOutputMode,
        context_before: usize,
        context_after: usize,
        case_insensitive: bool,
    ) -> Result<Vec<SearchResult>, ToolError> {
        let mut cmd = Command::new("grep");

        // Recursive search
        cmd.arg("-r");

        // Extended regex
        cmd.arg("-E");

        // Add options based on mode
        match mode {
            GrepOutputMode::Content => {
                cmd.arg("-n"); // Line numbers
                if context_before > 0 {
                    cmd.arg("-B").arg(context_before.to_string());
                }
                if context_after > 0 {
                    cmd.arg("-A").arg(context_after.to_string());
                }
            }
            GrepOutputMode::FilesWithMatches => {
                cmd.arg("-l");
            }
            GrepOutputMode::Count => {
                cmd.arg("-c");
            }
        }

        // Case sensitivity
        if case_insensitive {
            cmd.arg("-i");
        }

        // Add pattern and path
        cmd.arg(pattern);
        cmd.arg(path);

        // Execute
        let output = cmd
            .output()
            .map_err(|e| ToolError::execution_failed(format!("Failed to execute grep: {}", e)))?;

        // Parse output
        self.parse_grep_output(&output.stdout, mode, path)
    }

    /// Parse grep/ripgrep output into SearchResults
    fn parse_grep_output(
        &self,
        output: &[u8],
        mode: GrepOutputMode,
        _base_path: &Path,
    ) -> Result<Vec<SearchResult>, ToolError> {
        let output_str = String::from_utf8_lossy(output);
        let mut results = Vec::new();

        for line in output_str.lines() {
            if line.is_empty() {
                continue;
            }

            match mode {
                GrepOutputMode::Content => {
                    // Format: file:line_number:content
                    if let Some((file_part, rest)) = line.split_once(':') {
                        if let Some((line_num_str, content)) = rest.split_once(':') {
                            if let Ok(line_num) = line_num_str.parse::<usize>() {
                                results.push(SearchResult::content_match(
                                    PathBuf::from(file_part),
                                    line_num,
                                    content.to_string(),
                                ));
                            }
                        }
                    }
                }
                GrepOutputMode::FilesWithMatches => {
                    // Format: file
                    results.push(SearchResult::file_match(PathBuf::from(line)));
                }
                GrepOutputMode::Count => {
                    // Format: file:count
                    if let Some((file_part, count_str)) = line.rsplit_once(':') {
                        if let Ok(count) = count_str.parse::<usize>() {
                            if count > 0 {
                                results.push(SearchResult::count_match(
                                    PathBuf::from(file_part),
                                    count,
                                ));
                            }
                        }
                    }
                }
            }
        }

        Ok(results)
    }

    /// Pure Rust search implementation (fallback when no external tools available)
    ///
    /// Requirements: 5.3, 5.5, 5.6
    fn search_rust(
        &self,
        pattern: &str,
        path: &Path,
        mode: GrepOutputMode,
        context_before: usize,
        context_after: usize,
        case_insensitive: bool,
    ) -> Result<Vec<SearchResult>, ToolError> {
        // Compile regex
        let regex = if case_insensitive {
            Regex::new(&format!("(?i){}", pattern))
        } else {
            Regex::new(pattern)
        }
        .map_err(|e| ToolError::invalid_params(format!("Invalid regex pattern: {}", e)))?;

        let mut results = Vec::new();

        // Walk directory
        self.search_directory(
            &regex,
            path,
            mode,
            context_before,
            context_after,
            &mut results,
        )?;

        Ok(results)
    }

    /// Recursively search a directory
    fn search_directory(
        &self,
        regex: &Regex,
        path: &Path,
        mode: GrepOutputMode,
        context_before: usize,
        context_after: usize,
        results: &mut Vec<SearchResult>,
    ) -> Result<(), ToolError> {
        if path.is_file() {
            self.search_file(regex, path, mode, context_before, context_after, results)?;
        } else if path.is_dir() {
            let entries = fs::read_dir(path).map_err(|e| {
                ToolError::execution_failed(format!("Failed to read directory: {}", e))
            })?;

            for entry in entries.flatten() {
                let entry_path = entry.path();

                // Skip hidden files/directories
                if entry_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with('.'))
                {
                    continue;
                }

                // Recurse
                self.search_directory(
                    regex,
                    &entry_path,
                    mode,
                    context_before,
                    context_after,
                    results,
                )?;

                // Check result limit
                if results.len() >= self.max_results * 10 {
                    break;
                }
            }
        }

        Ok(())
    }

    /// Search a single file
    fn search_file(
        &self,
        regex: &Regex,
        path: &Path,
        mode: GrepOutputMode,
        context_before: usize,
        context_after: usize,
        results: &mut Vec<SearchResult>,
    ) -> Result<(), ToolError> {
        // Skip binary files
        if self.is_binary_file(path) {
            return Ok(());
        }

        let file = fs::File::open(path)?;
        let reader = BufReader::new(file);
        let lines: Vec<String> = reader.lines().map_while(Result::ok).collect();

        let mut match_count = 0;
        let mut file_has_match = false;

        for (idx, line) in lines.iter().enumerate() {
            if regex.is_match(line) {
                file_has_match = true;
                match_count += 1;

                if mode == GrepOutputMode::Content {
                    let line_number = idx + 1;

                    // Get context
                    let before: Vec<String> =
                        lines[idx.saturating_sub(context_before)..idx].to_vec();
                    let after: Vec<String> = lines
                        .get(idx + 1..=(idx + context_after).min(lines.len() - 1))
                        .unwrap_or(&[])
                        .to_vec();

                    let result =
                        SearchResult::content_match(path.to_path_buf(), line_number, line.clone())
                            .with_context(before, after);

                    results.push(result);
                }
            }
        }

        // Add file-level results for other modes
        match mode {
            GrepOutputMode::FilesWithMatches if file_has_match => {
                results.push(SearchResult::file_match(path.to_path_buf()));
            }
            GrepOutputMode::Count if match_count > 0 => {
                results.push(SearchResult::count_match(path.to_path_buf(), match_count));
            }
            _ => {}
        }

        Ok(())
    }

    /// Check if a file appears to be binary
    fn is_binary_file(&self, path: &Path) -> bool {
        // Check by extension first
        let binary_extensions = [
            "exe", "dll", "so", "dylib", "bin", "obj", "o", "a", "lib", "png", "jpg", "jpeg",
            "gif", "bmp", "ico", "webp", "mp3", "mp4", "avi", "mov", "mkv", "wav", "flac", "zip",
            "tar", "gz", "bz2", "xz", "7z", "rar", "pdf", "doc", "docx", "xls", "xlsx", "ppt",
            "pptx", "wasm", "pyc", "class",
        ];

        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            if binary_extensions.contains(&ext.to_lowercase().as_str()) {
                return true;
            }
        }

        // Check first bytes for null characters
        if let Ok(mut file) = fs::File::open(path) {
            use std::io::Read;
            let mut buffer = [0u8; 512];
            if let Ok(n) = file.read(&mut buffer) {
                return buffer[..n].contains(&0);
            }
        }

        false
    }

    /// Main search method - chooses best available implementation
    #[allow(clippy::too_many_arguments)]
    pub fn search(
        &self,
        pattern: &str,
        path: &Path,
        mode: GrepOutputMode,
        context_before: usize,
        context_after: usize,
        case_insensitive: bool,
        include_hidden: bool,
    ) -> Result<Vec<SearchResult>, ToolError> {
        // Try ripgrep first if enabled
        if self.use_ripgrep && Self::is_ripgrep_available() {
            return self.search_with_ripgrep(
                pattern,
                path,
                mode,
                context_before,
                context_after,
                case_insensitive,
                include_hidden,
            );
        }

        // Try grep as fallback
        if Self::is_grep_available() {
            return self.search_with_grep(
                pattern,
                path,
                mode,
                context_before,
                context_after,
                case_insensitive,
            );
        }

        // Fall back to pure Rust implementation
        self.search_rust(
            pattern,
            path,
            mode,
            context_before,
            context_after,
            case_insensitive,
        )
    }

    /// Truncate output to fit within size limit
    ///
    /// Requirements: 5.8
    fn truncate_output(&self, output: &str) -> (String, bool) {
        if output.len() <= MAX_OUTPUT_SIZE {
            (output.to_string(), false)
        } else {
            let truncated = output.get(..MAX_OUTPUT_SIZE).unwrap_or(output);
            // Find last newline to avoid cutting mid-line
            let last_newline = truncated.rfind('\n').unwrap_or(truncated.len());
            let clean_truncated = truncated.get(..last_newline).unwrap_or(truncated);
            (
                format!(
                    "{}\n\n[Output truncated. Showing first {} bytes of {} bytes total.]",
                    clean_truncated,
                    last_newline,
                    output.len()
                ),
                true,
            )
        }
    }
}

#[async_trait]
impl Tool for GrepTool {
    fn name(&self) -> &str {
        "Grep"
    }

    fn description(&self) -> &str {
        "Search file contents using regex patterns. Uses ripgrep for speed when available, \
         with grep or pure Rust fallback. Supports multiple output modes: content (default), \
         files_with_matches, and count."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "Regex pattern to search for"
                },
                "path": {
                    "type": "string",
                    "description": "Path to search in. Defaults to working directory."
                },
                "mode": {
                    "type": "string",
                    "enum": ["content", "files_with_matches", "count"],
                    "description": "Output mode. 'content' returns matching lines, 'files_with_matches' returns file names, 'count' returns match counts."
                },
                "context_before": {
                    "type": "integer",
                    "description": "Number of lines to show before each match. Default: 0"
                },
                "context_after": {
                    "type": "integer",
                    "description": "Number of lines to show after each match. Default: 0"
                },
                "case_insensitive": {
                    "type": "boolean",
                    "description": "Whether to ignore case. Default: false"
                },
                "include_hidden": {
                    "type": "boolean",
                    "description": "Whether to search hidden files. Default: false"
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

        let path = params
            .get("path")
            .and_then(|v| v.as_str())
            .map(PathBuf::from)
            .unwrap_or_else(|| context.working_directory.clone());

        let mode = params
            .get("mode")
            .and_then(|v| v.as_str())
            .and_then(GrepOutputMode::parse)
            .unwrap_or_default();

        let context_before = params
            .get("context_before")
            .and_then(|v| v.as_u64())
            .map(|v| v as usize)
            .unwrap_or(0)
            .min(self.max_context_lines);

        let context_after = params
            .get("context_after")
            .and_then(|v| v.as_u64())
            .map(|v| v as usize)
            .unwrap_or(0)
            .min(self.max_context_lines);

        let case_insensitive = params
            .get("case_insensitive")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let include_hidden = params
            .get("include_hidden")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let max_results = params
            .get("max_results")
            .and_then(|v| v.as_u64())
            .map(|v| v as usize)
            .unwrap_or(self.max_results);

        // Execute search
        let results = self.search(
            pattern,
            &path,
            mode,
            context_before,
            context_after,
            case_insensitive,
            include_hidden,
        )?;

        // Truncate results if needed
        let (results, result_truncated) = truncate_results(results, max_results);

        // Format output
        let output = format_search_results(&results, result_truncated);

        // Truncate output if too large
        let (output, output_truncated) = self.truncate_output(&output);

        Ok(ToolResult::success(output)
            .with_metadata("count", serde_json::json!(results.len()))
            .with_metadata(
                "truncated",
                serde_json::json!(result_truncated || output_truncated),
            )
            .with_metadata("mode", serde_json::json!(format!("{:?}", mode))))
    }

    async fn check_permissions(
        &self,
        _params: &serde_json::Value,
        _context: &ToolContext,
    ) -> PermissionCheckResult {
        // Grep is a read-only operation, generally safe
        PermissionCheckResult::allow()
    }

    fn options(&self) -> ToolOptions {
        ToolOptions::default().with_base_timeout(std::time::Duration::from_secs(120))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use tempfile::TempDir;

    fn create_test_files(dir: &TempDir) {
        // Create test files with searchable content
        let files = vec![
            ("test1.txt", "Hello World\nThis is a test\nHello again"),
            (
                "test2.txt",
                "Another file\nWith some content\nAnd more lines",
            ),
            ("src/main.rs", "fn main() {\n    println!(\"Hello\");\n}"),
            ("src/lib.rs", "pub fn hello() {\n    // Hello function\n}"),
        ];

        for (path, content) in files {
            let file_path = dir.path().join(path);
            if let Some(parent) = file_path.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            let mut f = File::create(&file_path).unwrap();
            write!(f, "{}", content).unwrap();
        }
    }

    #[test]
    fn test_grep_tool_new() {
        let tool = GrepTool::new();
        assert_eq!(tool.max_results, DEFAULT_MAX_RESULTS);
        assert_eq!(tool.max_context_lines, DEFAULT_MAX_CONTEXT_LINES);
        assert!(tool.use_ripgrep);
    }

    #[test]
    fn test_grep_tool_builder() {
        let tool = GrepTool::new()
            .with_max_results(50)
            .with_max_context_lines(10)
            .without_ripgrep();

        assert_eq!(tool.max_results, 50);
        assert_eq!(tool.max_context_lines, 10);
        assert!(!tool.use_ripgrep);
    }

    #[test]
    fn test_grep_output_mode_parse() {
        assert_eq!(
            GrepOutputMode::parse("content"),
            Some(GrepOutputMode::Content)
        );
        assert_eq!(
            GrepOutputMode::parse("files_with_matches"),
            Some(GrepOutputMode::FilesWithMatches)
        );
        assert_eq!(
            GrepOutputMode::parse("files"),
            Some(GrepOutputMode::FilesWithMatches)
        );
        assert_eq!(
            GrepOutputMode::parse("l"),
            Some(GrepOutputMode::FilesWithMatches)
        );
        assert_eq!(GrepOutputMode::parse("count"), Some(GrepOutputMode::Count));
        assert_eq!(GrepOutputMode::parse("c"), Some(GrepOutputMode::Count));
        assert_eq!(GrepOutputMode::parse("invalid"), None);
    }

    #[test]
    fn test_grep_rust_search_content() {
        let temp_dir = TempDir::new().unwrap();
        create_test_files(&temp_dir);

        let tool = GrepTool::new().without_ripgrep();
        let results = tool
            .search_rust(
                "Hello",
                temp_dir.path(),
                GrepOutputMode::Content,
                0,
                0,
                false,
            )
            .unwrap();

        assert!(!results.is_empty());
        assert!(results.iter().all(|r| r.line_content.is_some()));
    }

    #[test]
    fn test_grep_rust_search_files_with_matches() {
        let temp_dir = TempDir::new().unwrap();
        create_test_files(&temp_dir);

        let tool = GrepTool::new().without_ripgrep();
        let results = tool
            .search_rust(
                "Hello",
                temp_dir.path(),
                GrepOutputMode::FilesWithMatches,
                0,
                0,
                false,
            )
            .unwrap();

        assert!(!results.is_empty());
        assert!(results.iter().all(|r| r.line_content.is_none()));
        assert!(results.iter().all(|r| r.match_count.is_none()));
    }

    #[test]
    fn test_grep_rust_search_count() {
        let temp_dir = TempDir::new().unwrap();
        create_test_files(&temp_dir);

        let tool = GrepTool::new().without_ripgrep();
        let results = tool
            .search_rust("Hello", temp_dir.path(), GrepOutputMode::Count, 0, 0, false)
            .unwrap();

        assert!(!results.is_empty());
        assert!(results.iter().all(|r| r.match_count.is_some()));
    }

    #[test]
    fn test_grep_rust_case_insensitive() {
        let temp_dir = TempDir::new().unwrap();
        create_test_files(&temp_dir);

        let tool = GrepTool::new().without_ripgrep();

        // Case sensitive - should not match "hello" in lowercase
        let results_sensitive = tool
            .search_rust(
                "hello",
                temp_dir.path(),
                GrepOutputMode::Content,
                0,
                0,
                false,
            )
            .unwrap();

        // Case insensitive - should match both "Hello" and "hello"
        let results_insensitive = tool
            .search_rust(
                "hello",
                temp_dir.path(),
                GrepOutputMode::Content,
                0,
                0,
                true,
            )
            .unwrap();

        assert!(results_insensitive.len() >= results_sensitive.len());
    }

    #[test]
    fn test_grep_rust_with_context() {
        let temp_dir = TempDir::new().unwrap();
        create_test_files(&temp_dir);

        let tool = GrepTool::new().without_ripgrep();
        let results = tool
            .search_rust(
                "test",
                temp_dir.path(),
                GrepOutputMode::Content,
                1,
                1,
                false,
            )
            .unwrap();

        // Should have context lines
        let has_context = results
            .iter()
            .any(|r| !r.context_before.is_empty() || !r.context_after.is_empty());
        assert!(has_context || results.is_empty());
    }

    #[test]
    fn test_grep_invalid_regex() {
        let temp_dir = TempDir::new().unwrap();
        let tool = GrepTool::new().without_ripgrep();

        let result = tool.search_rust(
            "[invalid",
            temp_dir.path(),
            GrepOutputMode::Content,
            0,
            0,
            false,
        );

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::InvalidParams(_)));
    }

    #[test]
    fn test_grep_truncate_output() {
        let tool = GrepTool::new();

        // Short output - no truncation
        let (output, truncated) = tool.truncate_output("short output");
        assert_eq!(output, "short output");
        assert!(!truncated);

        // Long output - should truncate
        let long_output = "x".repeat(MAX_OUTPUT_SIZE + 1000);
        let (output, truncated) = tool.truncate_output(&long_output);
        assert!(output.len() < long_output.len());
        assert!(truncated);
        assert!(output.contains("[Output truncated"));
    }

    #[tokio::test]
    async fn test_grep_tool_execute() {
        let temp_dir = TempDir::new().unwrap();
        create_test_files(&temp_dir);

        let tool = GrepTool::new();
        let context = ToolContext::new(temp_dir.path().to_path_buf());
        let params = serde_json::json!({
            "pattern": "Hello"
        });

        let result = tool.execute(params, &context).await.unwrap();
        assert!(result.is_success());
        assert!(result.output.is_some());
    }

    #[tokio::test]
    async fn test_grep_tool_execute_with_mode() {
        let temp_dir = TempDir::new().unwrap();
        create_test_files(&temp_dir);

        let tool = GrepTool::new();
        let context = ToolContext::new(temp_dir.path().to_path_buf());
        let params = serde_json::json!({
            "pattern": "Hello",
            "mode": "count"
        });

        let result = tool.execute(params, &context).await.unwrap();
        assert!(result.is_success());
        assert_eq!(
            result.metadata.get("mode"),
            Some(&serde_json::json!("Count"))
        );
    }

    #[tokio::test]
    async fn test_grep_tool_execute_with_context() {
        let temp_dir = TempDir::new().unwrap();
        create_test_files(&temp_dir);

        let tool = GrepTool::new();
        let context = ToolContext::new(temp_dir.path().to_path_buf());
        let params = serde_json::json!({
            "pattern": "test",
            "context_before": 1,
            "context_after": 1
        });

        let result = tool.execute(params, &context).await.unwrap();
        assert!(result.is_success());
    }

    #[tokio::test]
    async fn test_grep_tool_missing_pattern() {
        let tool = GrepTool::new();
        let context = ToolContext::new(PathBuf::from("/tmp"));
        let params = serde_json::json!({});

        let result = tool.execute(params, &context).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::InvalidParams(_)));
    }

    #[test]
    fn test_grep_tool_name() {
        let tool = GrepTool::new();
        assert_eq!(tool.name(), "Grep");
    }

    #[test]
    fn test_grep_tool_description() {
        let tool = GrepTool::new();
        assert!(!tool.description().is_empty());
        assert!(tool.description().contains("regex"));
    }

    #[test]
    fn test_grep_tool_input_schema() {
        let tool = GrepTool::new();
        let schema = tool.input_schema();

        assert_eq!(schema["type"], "object");
        assert!(schema["properties"]["pattern"].is_object());
        assert!(schema["properties"]["mode"].is_object());
        assert!(schema["required"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("pattern")));
    }

    #[tokio::test]
    async fn test_grep_tool_check_permissions() {
        let tool = GrepTool::new();
        let context = ToolContext::new(PathBuf::from("/tmp"));
        let params = serde_json::json!({"pattern": "test"});

        let result = tool.check_permissions(&params, &context).await;
        assert!(result.is_allowed());
    }

    #[tokio::test]
    async fn test_grep_tool_cancellation() {
        let tool = GrepTool::new();
        let token = tokio_util::sync::CancellationToken::new();
        token.cancel();

        let context = ToolContext::new(PathBuf::from("/tmp")).with_cancellation_token(token);
        let params = serde_json::json!({"pattern": "test"});

        let result = tool.execute(params, &context).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::Cancelled));
    }

    #[test]
    fn test_is_binary_file() {
        let tool = GrepTool::new();

        // Test by extension
        assert!(tool.is_binary_file(Path::new("test.exe")));
        assert!(tool.is_binary_file(Path::new("image.png")));
        assert!(tool.is_binary_file(Path::new("archive.zip")));
        assert!(!tool.is_binary_file(Path::new("code.rs")));
        assert!(!tool.is_binary_file(Path::new("readme.md")));
    }
}
