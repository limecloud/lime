//! Edit Tool Implementation
//!
//! This module implements the `EditTool` for editing files with:
//! - Smart string matching with quote normalization
//! - Batch edits with atomic rollback
//! - External file modification detection
//! - Match uniqueness validation
//!
//! Requirements: 4.7, 4.8, 4.9, 4.10

use std::fs;
use std::path::{Path, PathBuf};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tracing::debug;

use super::{compute_content_hash, FileReadRecord, SharedFileReadHistory};
use crate::tools::base::{PermissionCheckResult, Tool};
use crate::tools::context::{ToolContext, ToolOptions, ToolResult};
use crate::tools::error::ToolError;

/// A single edit operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Edit {
    /// The string to find and replace
    pub old_str: String,
    /// The replacement string
    pub new_str: String,
}

impl Edit {
    /// Create a new edit operation
    pub fn new(old_str: impl Into<String>, new_str: impl Into<String>) -> Self {
        Self {
            old_str: old_str.into(),
            new_str: new_str.into(),
        }
    }
}

/// Result of a string match operation
#[derive(Debug, Clone)]
pub struct MatchResult {
    /// Number of matches found
    pub count: usize,
    /// Positions of matches (byte offsets)
    pub positions: Vec<usize>,
}

/// Edit Tool for modifying files
///
/// Supports:
/// - Smart string matching with quote normalization
/// - Batch edits with atomic rollback
/// - External modification detection
/// - Match uniqueness validation
///
/// Requirements: 4.7, 4.8, 4.9, 4.10
#[derive(Debug)]
pub struct EditTool {
    /// Shared file read history
    read_history: SharedFileReadHistory,
    /// Whether to require file to be read before editing
    require_read_before_edit: bool,
    /// Whether to enable smart quote matching
    smart_quote_matching: bool,
}

impl EditTool {
    /// Create a new EditTool with shared history
    pub fn new(read_history: SharedFileReadHistory) -> Self {
        Self {
            read_history,
            require_read_before_edit: true,
            smart_quote_matching: true,
        }
    }

    /// Set whether to require read before edit
    pub fn with_require_read_before_edit(mut self, require: bool) -> Self {
        self.require_read_before_edit = require;
        self
    }

    /// Set whether to enable smart quote matching
    pub fn with_smart_quote_matching(mut self, enabled: bool) -> Self {
        self.smart_quote_matching = enabled;
        self
    }

    /// Get the shared read history
    pub fn read_history(&self) -> &SharedFileReadHistory {
        &self.read_history
    }

    /// Resolve a path relative to the working directory
    fn resolve_path(&self, path: &Path, context: &ToolContext) -> PathBuf {
        if path.is_absolute() {
            path.to_path_buf()
        } else {
            context.working_directory.join(path)
        }
    }
}

// =============================================================================
// Smart String Matching (Requirements: 4.7)
// =============================================================================

impl EditTool {
    /// Normalize quotes in a string for matching
    ///
    /// Converts various quote styles to standard ASCII quotes:
    /// - Smart quotes (" " ' ') -> ASCII quotes (" ')
    /// - Curly quotes -> straight quotes
    ///
    /// Requirements: 4.7
    pub fn normalize_quotes(s: &str) -> String {
        s.chars()
            .map(|c| match c {
                // Double quotes (using Unicode code points)
                // U+201C LEFT DOUBLE QUOTATION MARK
                // U+201D RIGHT DOUBLE QUOTATION MARK
                // U+201E DOUBLE LOW-9 QUOTATION MARK
                // U+201F DOUBLE HIGH-REVERSED-9 QUOTATION MARK
                '\u{201C}' | '\u{201D}' | '\u{201E}' | '\u{201F}' => '"',
                // Single quotes
                // U+2018 LEFT SINGLE QUOTATION MARK
                // U+2019 RIGHT SINGLE QUOTATION MARK
                // U+201A SINGLE LOW-9 QUOTATION MARK
                // U+201B SINGLE HIGH-REVERSED-9 QUOTATION MARK
                '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{201B}' => '\'',
                // Guillemets (optional)
                // U+00AB LEFT-POINTING DOUBLE ANGLE QUOTATION MARK
                // U+00BB RIGHT-POINTING DOUBLE ANGLE QUOTATION MARK
                // U+2039 SINGLE LEFT-POINTING ANGLE QUOTATION MARK
                // U+203A SINGLE RIGHT-POINTING ANGLE QUOTATION MARK
                '\u{00AB}' | '\u{00BB}' | '\u{2039}' | '\u{203A}' => '"',
                _ => c,
            })
            .collect()
    }

    /// Find all matches of a string in content
    ///
    /// If smart_quote_matching is enabled, normalizes quotes before matching.
    ///
    /// Requirements: 4.7
    pub fn find_matches(&self, content: &str, search: &str) -> MatchResult {
        if self.smart_quote_matching {
            self.find_matches_smart(content, search)
        } else {
            self.find_matches_exact(content, search)
        }
    }

    /// Find exact matches without quote normalization
    fn find_matches_exact(&self, content: &str, search: &str) -> MatchResult {
        let positions: Vec<usize> = content.match_indices(search).map(|(pos, _)| pos).collect();

        MatchResult {
            count: positions.len(),
            positions,
        }
    }

    /// Find matches with smart quote normalization
    fn find_matches_smart(&self, content: &str, search: &str) -> MatchResult {
        let normalized_content = Self::normalize_quotes(content);
        let normalized_search = Self::normalize_quotes(search);

        // First try exact match
        let exact_result = self.find_matches_exact(content, search);
        if exact_result.count > 0 {
            return exact_result;
        }

        // Try normalized match
        let positions: Vec<usize> = normalized_content
            .match_indices(&normalized_search)
            .map(|(pos, _)| pos)
            .collect();

        MatchResult {
            count: positions.len(),
            positions,
        }
    }

    /// Check if a match is unique (exactly one occurrence)
    pub fn is_unique_match(&self, content: &str, search: &str) -> bool {
        self.find_matches(content, search).count == 1
    }
}

// =============================================================================
// Single Edit Implementation
// =============================================================================

impl EditTool {
    /// Apply a single edit to a file
    ///
    /// Requirements: 4.7, 4.9, 4.10
    pub async fn edit_file(
        &self,
        path: &Path,
        old_str: &str,
        new_str: &str,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let full_path = self.resolve_path(path, context);

        // Check file exists
        if !full_path.exists() {
            return Err(ToolError::execution_failed(format!(
                "File not found: {}",
                full_path.display()
            )));
        }

        // Check read history
        if self.require_read_before_edit {
            let history = self.read_history.read().unwrap();
            if !history.has_read(&full_path) {
                return Err(ToolError::execution_failed(format!(
                    "File has not been read: {}. Read the file first before editing.",
                    full_path.display()
                )));
            }
        }

        // Check for external modifications (Requirements: 4.9)
        self.check_external_modification(&full_path)?;

        // Read current content
        let content = fs::read_to_string(&full_path)?;

        // Find matches (Requirements: 4.10)
        let match_result = self.find_matches(&content, old_str);

        if match_result.count == 0 {
            return Err(ToolError::execution_failed(format!(
                "String not found in file: '{}'",
                if old_str.len() > 50 {
                    format!("{}...", old_str.get(..50).unwrap_or(old_str))
                } else {
                    old_str.to_string()
                }
            )));
        }

        if match_result.count > 1 {
            return Err(ToolError::execution_failed(format!(
                "String is not unique: found {} occurrences. \
                 Please provide more context to make the match unique.",
                match_result.count
            )));
        }

        // Apply the edit
        let new_content = if self.smart_quote_matching {
            // Use the actual position from normalized matching
            let pos = match_result.positions[0];
            let actual_old_str = content.get(pos..pos + old_str.len()).unwrap_or(old_str);
            content.replacen(actual_old_str, new_str, 1)
        } else {
            content.replacen(old_str, new_str, 1)
        };

        // Write the file
        fs::write(&full_path, &new_content)?;

        // Update read history
        self.update_read_history(&full_path, &new_content)?;

        debug!(
            "Edited file: {} (replaced {} bytes with {} bytes)",
            full_path.display(),
            old_str.len(),
            new_str.len()
        );

        Ok(
            ToolResult::success(format!("Successfully edited {}", full_path.display()))
                .with_metadata("path", serde_json::json!(full_path.to_string_lossy()))
                .with_metadata("old_length", serde_json::json!(old_str.len()))
                .with_metadata("new_length", serde_json::json!(new_str.len())),
        )
    }

    /// Check for external file modifications since last read
    ///
    /// Requirements: 4.9
    fn check_external_modification(&self, path: &Path) -> Result<(), ToolError> {
        let history = self.read_history.read().unwrap();

        if let Some(record) = history.get_record(&path.to_path_buf()) {
            if let Ok(metadata) = fs::metadata(path) {
                if let Ok(current_mtime) = metadata.modified() {
                    if record.is_modified(current_mtime) {
                        return Err(ToolError::execution_failed(format!(
                            "File has been modified externally since last read: {}. \
                             Read the file again before editing.",
                            path.display()
                        )));
                    }
                }
            }
        }

        Ok(())
    }

    /// Update read history after editing
    fn update_read_history(&self, path: &Path, content: &str) -> Result<(), ToolError> {
        let content_bytes = content.as_bytes();
        let hash = compute_content_hash(content_bytes);
        let metadata = fs::metadata(path)?;
        let mtime = metadata.modified().ok();

        let mut record = FileReadRecord::new(path.to_path_buf(), hash, metadata.len())
            .with_line_count(content.lines().count());

        if let Some(mt) = mtime {
            record = record.with_mtime(mt);
        }

        self.read_history.write().unwrap().record_read(record);
        Ok(())
    }
}

// =============================================================================
// Batch Edit Implementation (Requirements: 4.8)
// =============================================================================

impl EditTool {
    /// Apply multiple edits to a file atomically
    ///
    /// All edits are validated before any are applied.
    /// If any edit fails validation, no changes are made.
    ///
    /// Requirements: 4.8
    pub async fn batch_edit(
        &self,
        path: &Path,
        edits: &[Edit],
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let full_path = self.resolve_path(path, context);

        // Check file exists
        if !full_path.exists() {
            return Err(ToolError::execution_failed(format!(
                "File not found: {}",
                full_path.display()
            )));
        }

        // Check read history
        if self.require_read_before_edit {
            let history = self.read_history.read().unwrap();
            if !history.has_read(&full_path) {
                return Err(ToolError::execution_failed(format!(
                    "File has not been read: {}. Read the file first before editing.",
                    full_path.display()
                )));
            }
        }

        // Check for external modifications
        self.check_external_modification(&full_path)?;

        // Read current content
        let original_content = fs::read_to_string(&full_path)?;
        let mut content = original_content.clone();

        // Validate all edits first
        for (i, edit) in edits.iter().enumerate() {
            let match_result = self.find_matches(&content, &edit.old_str);

            if match_result.count == 0 {
                return Err(ToolError::execution_failed(format!(
                    "Edit {}: String not found: '{}'",
                    i + 1,
                    if edit.old_str.len() > 50 {
                        format!("{}...", edit.old_str.get(..50).unwrap_or(&edit.old_str))
                    } else {
                        edit.old_str.clone()
                    }
                )));
            }

            if match_result.count > 1 {
                return Err(ToolError::execution_failed(format!(
                    "Edit {}: String is not unique: found {} occurrences",
                    i + 1,
                    match_result.count
                )));
            }

            // Apply edit to working content for subsequent validation
            content = content.replacen(&edit.old_str, &edit.new_str, 1);
        }

        // All validations passed, write the final content
        fs::write(&full_path, &content)?;

        // Update read history
        self.update_read_history(&full_path, &content)?;

        debug!(
            "Batch edited file: {} ({} edits applied)",
            full_path.display(),
            edits.len()
        );

        Ok(ToolResult::success(format!(
            "Successfully applied {} edits to {}",
            edits.len(),
            full_path.display()
        ))
        .with_metadata("path", serde_json::json!(full_path.to_string_lossy()))
        .with_metadata("edit_count", serde_json::json!(edits.len())))
    }
}

// =============================================================================
// Tool Trait Implementation
// =============================================================================

#[async_trait]
impl Tool for EditTool {
    fn name(&self) -> &str {
        "Edit"
    }

    fn description(&self) -> &str {
        "Edit a file by replacing a specific string with a new string. \
         The string to replace must be unique in the file. \
         Supports smart quote matching and batch edits. \
         The file must be read first before editing."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Path to the file to edit (relative to working directory or absolute)"
                },
                "old_str": {
                    "type": "string",
                    "description": "The string to find and replace (must be unique in the file)"
                },
                "new_str": {
                    "type": "string",
                    "description": "The replacement string"
                },
                "edits": {
                    "type": "array",
                    "description": "Array of edit operations for batch editing",
                    "items": {
                        "type": "object",
                        "properties": {
                            "old_str": { "type": "string" },
                            "new_str": { "type": "string" }
                        },
                        "required": ["old_str", "new_str"]
                    }
                }
            },
            "required": ["path"]
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

        // Extract path parameter
        let path_str = params
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::invalid_params("Missing required parameter: path"))?;

        let path = Path::new(path_str);

        // Check for batch edits
        if let Some(edits_value) = params.get("edits") {
            let edits: Vec<Edit> = serde_json::from_value(edits_value.clone())
                .map_err(|e| ToolError::invalid_params(format!("Invalid edits array: {}", e)))?;

            if edits.is_empty() {
                return Err(ToolError::invalid_params("Edits array is empty"));
            }

            return self.batch_edit(path, &edits, context).await;
        }

        // Single edit
        let old_str = params
            .get("old_str")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::invalid_params("Missing required parameter: old_str"))?;

        let new_str = params
            .get("new_str")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::invalid_params("Missing required parameter: new_str"))?;

        self.edit_file(path, old_str, new_str, context).await
    }

    async fn check_permissions(
        &self,
        params: &serde_json::Value,
        context: &ToolContext,
    ) -> PermissionCheckResult {
        // Extract path for permission check
        let path_str = match params.get("path").and_then(|v| v.as_str()) {
            Some(p) => p,
            None => return PermissionCheckResult::deny("Missing path parameter"),
        };

        let path = Path::new(path_str);
        let full_path = self.resolve_path(path, context);

        // Check if file exists
        if !full_path.exists() {
            return PermissionCheckResult::deny(format!(
                "File does not exist: {}",
                full_path.display()
            ));
        }

        // Check if file has been read
        if self.require_read_before_edit {
            let history = self.read_history.read().unwrap();
            if !history.has_read(&full_path) {
                return PermissionCheckResult::ask(format!(
                    "File '{}' has not been read. \
                     Do you want to edit it without reading first?",
                    full_path.display()
                ));
            }
        }

        debug!("Permission check for edit: {}", full_path.display());
        PermissionCheckResult::allow()
    }

    fn options(&self) -> ToolOptions {
        ToolOptions::new()
            .with_max_retries(0) // Don't retry edits
            .with_base_timeout(std::time::Duration::from_secs(30))
    }
}

// =============================================================================
// Unit Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_test_context(dir: &Path) -> ToolContext {
        ToolContext::new(dir.to_path_buf())
            .with_session_id("test-session")
            .with_user("test-user")
    }

    fn create_edit_tool() -> EditTool {
        EditTool::new(super::super::create_shared_history())
    }

    fn create_edit_tool_with_history(history: SharedFileReadHistory) -> EditTool {
        EditTool::new(history)
    }

    #[test]
    fn test_edit_new() {
        let edit = Edit::new("old", "new");
        assert_eq!(edit.old_str, "old");
        assert_eq!(edit.new_str, "new");
    }

    #[test]
    fn test_normalize_quotes() {
        // Smart double quotes - using Unicode escape sequences
        let smart_double_open = "\u{201C}"; // "
        let smart_double_close = "\u{201D}"; // "
        let smart_single_open = "\u{2018}"; // '
        let smart_single_close = "\u{2019}"; // '

        // Test smart double quotes
        let input = format!("{}hello{}", smart_double_open, smart_double_close);
        assert_eq!(EditTool::normalize_quotes(&input), "\"hello\"");

        // Test smart single quotes
        let input = format!("{}hello{}", smart_single_open, smart_single_close);
        assert_eq!(EditTool::normalize_quotes(&input), "'hello'");

        // Test mixed
        let input = format!(
            "{}it{}s{}",
            smart_double_open, smart_single_close, smart_double_close
        );
        assert_eq!(EditTool::normalize_quotes(&input), "\"it's\"");

        // No quotes
        assert_eq!(EditTool::normalize_quotes("hello"), "hello");
    }

    #[test]
    fn test_find_matches_exact() {
        let tool = create_edit_tool().with_smart_quote_matching(false);
        let content = "hello world hello";

        let result = tool.find_matches(content, "hello");
        assert_eq!(result.count, 2);
        assert_eq!(result.positions, vec![0, 12]);
    }

    #[test]
    fn test_find_matches_unique() {
        let tool = create_edit_tool();
        let content = "hello world";

        let result = tool.find_matches(content, "world");
        assert_eq!(result.count, 1);
        assert!(tool.is_unique_match(content, "world"));
    }

    #[test]
    fn test_find_matches_not_found() {
        let tool = create_edit_tool();
        let content = "hello world";

        let result = tool.find_matches(content, "foo");
        assert_eq!(result.count, 0);
    }

    #[test]
    fn test_find_matches_smart_quotes() {
        let tool = create_edit_tool();
        // Using Unicode escape sequences for smart quotes
        let smart_double_open = "\u{201C}"; // "
        let smart_double_close = "\u{201D}"; // "
        let content = format!("say {}hello{}", smart_double_open, smart_double_close);

        // Should match with straight quotes
        let result = tool.find_matches(&content, "\"hello\"");
        assert_eq!(result.count, 1);
    }

    #[tokio::test]
    async fn test_edit_file_success() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.txt");
        fs::write(&file_path, "hello world").unwrap();

        let history = super::super::create_shared_history();
        let tool = create_edit_tool_with_history(history.clone());
        let context = create_test_context(temp_dir.path());

        // Simulate reading the file first
        let content = fs::read(&file_path).unwrap();
        let metadata = fs::metadata(&file_path).unwrap();
        let hash = compute_content_hash(&content);
        let mut record = FileReadRecord::new(file_path.clone(), hash, metadata.len());
        if let Ok(mtime) = metadata.modified() {
            record = record.with_mtime(mtime);
        }
        history.write().unwrap().record_read(record);

        let result = tool
            .edit_file(&file_path, "world", "universe", &context)
            .await
            .unwrap();

        assert!(result.is_success());
        assert_eq!(fs::read_to_string(&file_path).unwrap(), "hello universe");
    }

    #[tokio::test]
    async fn test_edit_file_not_read() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.txt");
        fs::write(&file_path, "hello world").unwrap();

        let tool = create_edit_tool();
        let context = create_test_context(temp_dir.path());

        let result = tool
            .edit_file(&file_path, "world", "universe", &context)
            .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_edit_file_not_found() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("nonexistent.txt");

        let tool = create_edit_tool();
        let context = create_test_context(temp_dir.path());

        let result = tool.edit_file(&file_path, "old", "new", &context).await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_edit_file_string_not_found() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.txt");
        fs::write(&file_path, "hello world").unwrap();

        let history = super::super::create_shared_history();
        let tool = create_edit_tool_with_history(history.clone());
        let context = create_test_context(temp_dir.path());

        // Simulate reading
        let content = fs::read(&file_path).unwrap();
        let metadata = fs::metadata(&file_path).unwrap();
        let hash = compute_content_hash(&content);
        let mut record = FileReadRecord::new(file_path.clone(), hash, metadata.len());
        if let Ok(mtime) = metadata.modified() {
            record = record.with_mtime(mtime);
        }
        history.write().unwrap().record_read(record);

        let result = tool.edit_file(&file_path, "foo", "bar", &context).await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_edit_file_not_unique() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.txt");
        fs::write(&file_path, "hello hello world").unwrap();

        let history = super::super::create_shared_history();
        let tool = create_edit_tool_with_history(history.clone());
        let context = create_test_context(temp_dir.path());

        // Simulate reading
        let content = fs::read(&file_path).unwrap();
        let metadata = fs::metadata(&file_path).unwrap();
        let hash = compute_content_hash(&content);
        let mut record = FileReadRecord::new(file_path.clone(), hash, metadata.len());
        if let Ok(mtime) = metadata.modified() {
            record = record.with_mtime(mtime);
        }
        history.write().unwrap().record_read(record);

        let result = tool.edit_file(&file_path, "hello", "hi", &context).await;

        assert!(result.is_err());
        // Original content should be preserved
        assert_eq!(fs::read_to_string(&file_path).unwrap(), "hello hello world");
    }

    #[tokio::test]
    async fn test_batch_edit_success() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.txt");
        fs::write(&file_path, "hello world foo").unwrap();

        let history = super::super::create_shared_history();
        let tool = create_edit_tool_with_history(history.clone());
        let context = create_test_context(temp_dir.path());

        // Simulate reading
        let content = fs::read(&file_path).unwrap();
        let metadata = fs::metadata(&file_path).unwrap();
        let hash = compute_content_hash(&content);
        let mut record = FileReadRecord::new(file_path.clone(), hash, metadata.len());
        if let Ok(mtime) = metadata.modified() {
            record = record.with_mtime(mtime);
        }
        history.write().unwrap().record_read(record);

        let edits = vec![
            Edit::new("hello", "hi"),
            Edit::new("world", "universe"),
            Edit::new("foo", "bar"),
        ];

        let result = tool.batch_edit(&file_path, &edits, &context).await.unwrap();

        assert!(result.is_success());
        assert_eq!(fs::read_to_string(&file_path).unwrap(), "hi universe bar");
    }

    #[tokio::test]
    async fn test_batch_edit_atomic_rollback() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.txt");
        fs::write(&file_path, "hello world").unwrap();

        let history = super::super::create_shared_history();
        let tool = create_edit_tool_with_history(history.clone());
        let context = create_test_context(temp_dir.path());

        // Simulate reading
        let content = fs::read(&file_path).unwrap();
        let metadata = fs::metadata(&file_path).unwrap();
        let hash = compute_content_hash(&content);
        let mut record = FileReadRecord::new(file_path.clone(), hash, metadata.len());
        if let Ok(mtime) = metadata.modified() {
            record = record.with_mtime(mtime);
        }
        history.write().unwrap().record_read(record);

        // Second edit will fail (string not found after first edit)
        let edits = vec![Edit::new("hello", "hi"), Edit::new("nonexistent", "bar")];

        let result = tool.batch_edit(&file_path, &edits, &context).await;

        assert!(result.is_err());
        // Original content should be preserved (atomic rollback)
        assert_eq!(fs::read_to_string(&file_path).unwrap(), "hello world");
    }

    #[tokio::test]
    async fn test_tool_execute_single_edit() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.txt");
        fs::write(&file_path, "hello world").unwrap();

        let history = super::super::create_shared_history();
        let tool = create_edit_tool_with_history(history.clone());
        let context = create_test_context(temp_dir.path());

        // Simulate reading
        let content = fs::read(&file_path).unwrap();
        let metadata = fs::metadata(&file_path).unwrap();
        let hash = compute_content_hash(&content);
        let mut record = FileReadRecord::new(file_path.clone(), hash, metadata.len());
        if let Ok(mtime) = metadata.modified() {
            record = record.with_mtime(mtime);
        }
        history.write().unwrap().record_read(record);

        let params = serde_json::json!({
            "path": file_path.to_str().unwrap(),
            "old_str": "world",
            "new_str": "universe"
        });

        let result = tool.execute(params, &context).await.unwrap();

        assert!(result.is_success());
        assert_eq!(fs::read_to_string(&file_path).unwrap(), "hello universe");
    }

    #[tokio::test]
    async fn test_tool_execute_batch_edit() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.txt");
        fs::write(&file_path, "hello world").unwrap();

        let history = super::super::create_shared_history();
        let tool = create_edit_tool_with_history(history.clone());
        let context = create_test_context(temp_dir.path());

        // Simulate reading
        let content = fs::read(&file_path).unwrap();
        let metadata = fs::metadata(&file_path).unwrap();
        let hash = compute_content_hash(&content);
        let mut record = FileReadRecord::new(file_path.clone(), hash, metadata.len());
        if let Ok(mtime) = metadata.modified() {
            record = record.with_mtime(mtime);
        }
        history.write().unwrap().record_read(record);

        let params = serde_json::json!({
            "path": file_path.to_str().unwrap(),
            "edits": [
                { "old_str": "hello", "new_str": "hi" },
                { "old_str": "world", "new_str": "universe" }
            ]
        });

        let result = tool.execute(params, &context).await.unwrap();

        assert!(result.is_success());
        assert_eq!(fs::read_to_string(&file_path).unwrap(), "hi universe");
    }

    #[tokio::test]
    async fn test_tool_execute_missing_path() {
        let temp_dir = TempDir::new().unwrap();
        let tool = create_edit_tool();
        let context = create_test_context(temp_dir.path());
        let params = serde_json::json!({
            "old_str": "old",
            "new_str": "new"
        });

        let result = tool.execute(params, &context).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::InvalidParams(_)));
    }

    #[test]
    fn test_tool_name() {
        let tool = create_edit_tool();
        assert_eq!(tool.name(), "Edit");
    }

    #[test]
    fn test_tool_description() {
        let tool = create_edit_tool();
        assert!(!tool.description().is_empty());
        assert!(tool.description().contains("Edit"));
    }

    #[test]
    fn test_tool_input_schema() {
        let tool = create_edit_tool();
        let schema = tool.input_schema();
        assert_eq!(schema["type"], "object");
        assert!(schema["properties"]["path"].is_object());
        assert!(schema["properties"]["old_str"].is_object());
        assert!(schema["properties"]["new_str"].is_object());
        assert!(schema["properties"]["edits"].is_object());
    }

    #[tokio::test]
    async fn test_check_permissions_file_not_read() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.txt");
        fs::write(&file_path, "content").unwrap();

        let tool = create_edit_tool();
        let context = create_test_context(temp_dir.path());
        let params = serde_json::json!({
            "path": file_path.to_str().unwrap(),
            "old_str": "content",
            "new_str": "new"
        });

        let result = tool.check_permissions(&params, &context).await;
        assert!(result.requires_confirmation());
    }

    #[tokio::test]
    async fn test_check_permissions_file_not_exists() {
        let temp_dir = TempDir::new().unwrap();
        let tool = create_edit_tool();
        let context = create_test_context(temp_dir.path());
        let params = serde_json::json!({
            "path": "nonexistent.txt",
            "old_str": "old",
            "new_str": "new"
        });

        let result = tool.check_permissions(&params, &context).await;
        assert!(result.is_denied());
    }
}
