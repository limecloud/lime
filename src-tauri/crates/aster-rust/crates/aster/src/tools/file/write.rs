//! Write Tool Implementation
//!
//! This module implements the `WriteTool` for writing files with:
//! - File creation and overwriting
//! - Read-before-overwrite validation
//! - Directory creation
//!
//! Requirements: 4.6

use std::fs;
use std::path::{Path, PathBuf};

use async_trait::async_trait;
use tracing::{debug, warn};

use super::{compute_content_hash, FileReadRecord, SharedFileReadHistory};
use crate::tools::base::{PermissionCheckResult, Tool};
use crate::tools::context::{ToolContext, ToolOptions, ToolResult};
use crate::tools::error::ToolError;

/// Maximum file size for writing (50MB)
pub const MAX_WRITE_SIZE: usize = 50 * 1024 * 1024;

/// Write Tool for writing files
///
/// Supports:
/// - Creating new files
/// - Overwriting existing files (with read validation)
/// - Creating parent directories
///
/// Requirements: 4.6
#[derive(Debug)]
pub struct WriteTool {
    /// Shared file read history
    read_history: SharedFileReadHistory,
    /// Whether to require read before overwrite
    require_read_before_overwrite: bool,
}

impl WriteTool {
    /// Create a new WriteTool with shared history
    pub fn new(read_history: SharedFileReadHistory) -> Self {
        Self {
            read_history,
            require_read_before_overwrite: true,
        }
    }

    /// Set whether to require read before overwrite
    pub fn with_require_read_before_overwrite(mut self, require: bool) -> Self {
        self.require_read_before_overwrite = require;
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
// File Writing Implementation (Requirements: 4.6)
// =============================================================================

impl WriteTool {
    /// Write content to a file
    ///
    /// If the file exists and require_read_before_overwrite is true,
    /// the file must have been read first.
    ///
    /// Requirements: 4.6
    pub async fn write_file(
        &self,
        path: &Path,
        content: &str,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let full_path = self.resolve_path(path, context);

        // Check content size
        if content.len() > MAX_WRITE_SIZE {
            return Err(ToolError::execution_failed(format!(
                "Content too large: {} bytes (max: {} bytes)",
                content.len(),
                MAX_WRITE_SIZE
            )));
        }

        // Check if file exists and validate read history
        if full_path.exists() && self.require_read_before_overwrite {
            let history = self.read_history.read().unwrap();
            if !history.has_read(&full_path) {
                return Err(ToolError::execution_failed(format!(
                    "File exists but has not been read: {}. \
                     Read the file first before overwriting.",
                    full_path.display()
                )));
            }

            // Check for external modifications
            if let Ok(metadata) = fs::metadata(&full_path) {
                if let Ok(mtime) = metadata.modified() {
                    if let Some(true) = history.is_file_modified(&full_path, mtime) {
                        warn!(
                            "File has been modified externally since last read: {}",
                            full_path.display()
                        );
                        return Err(ToolError::execution_failed(format!(
                            "File has been modified externally since last read: {}. \
                             Read the file again before overwriting.",
                            full_path.display()
                        )));
                    }
                }
            }
        }

        // Create parent directories if needed
        if let Some(parent) = full_path.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent)?;
                debug!("Created parent directories: {}", parent.display());
            }
        }

        // Write the file
        fs::write(&full_path, content)?;

        // Update read history with new content
        let content_bytes = content.as_bytes();
        let hash = compute_content_hash(content_bytes);
        let metadata = fs::metadata(&full_path)?;
        let mtime = metadata.modified().ok();

        let mut record = FileReadRecord::new(full_path.clone(), hash, metadata.len())
            .with_line_count(content.lines().count());

        if let Some(mt) = mtime {
            record = record.with_mtime(mt);
        }

        self.read_history.write().unwrap().record_read(record);

        debug!(
            "Wrote file: {} ({} bytes)",
            full_path.display(),
            content.len()
        );

        Ok(ToolResult::success(format!(
            "Successfully wrote {} bytes to {}",
            content.len(),
            full_path.display()
        ))
        .with_metadata("path", serde_json::json!(full_path.to_string_lossy()))
        .with_metadata("size", serde_json::json!(content.len())))
    }

    /// Check if a file can be written (exists and has been read, or doesn't exist)
    pub fn can_write(&self, path: &Path, context: &ToolContext) -> bool {
        let full_path = self.resolve_path(path, context);

        if !full_path.exists() {
            return true;
        }

        if !self.require_read_before_overwrite {
            return true;
        }

        self.read_history.read().unwrap().has_read(&full_path)
    }
}

// =============================================================================
// Tool Trait Implementation
// =============================================================================

#[async_trait]
impl Tool for WriteTool {
    fn name(&self) -> &str {
        "Write"
    }

    fn description(&self) -> &str {
        "Write content to a file. Creates parent directories if needed. \
         For existing files, the file must be read first before overwriting \
         to prevent accidental data loss."
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Path to the file to write (relative to working directory or absolute)"
                },
                "content": {
                    "type": "string",
                    "description": "Content to write to the file"
                }
            },
            "required": ["path", "content"]
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

        // Extract content parameter
        let content = params
            .get("content")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::invalid_params("Missing required parameter: content"))?;

        let path = Path::new(path_str);
        self.write_file(path, content, context).await
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

        // Check if file exists and hasn't been read
        if full_path.exists() && self.require_read_before_overwrite {
            let history = self.read_history.read().unwrap();
            if !history.has_read(&full_path) {
                return PermissionCheckResult::ask(format!(
                    "File '{}' exists but has not been read. \
                     Do you want to overwrite it without reading first?",
                    full_path.display()
                ));
            }
        }

        debug!("Permission check for write: {}", full_path.display());
        PermissionCheckResult::allow()
    }

    fn options(&self) -> ToolOptions {
        ToolOptions::new()
            .with_max_retries(1)
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

    fn create_write_tool() -> WriteTool {
        WriteTool::new(super::super::create_shared_history())
    }

    #[tokio::test]
    async fn test_write_new_file() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("new_file.txt");

        let tool = create_write_tool();
        let context = create_test_context(temp_dir.path());

        let result = tool
            .write_file(&file_path, "Hello, World!", &context)
            .await
            .unwrap();

        assert!(result.is_success());
        assert!(file_path.exists());
        assert_eq!(fs::read_to_string(&file_path).unwrap(), "Hello, World!");
    }

    #[tokio::test]
    async fn test_write_creates_parent_directories() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("subdir/nested/file.txt");

        let tool = create_write_tool();
        let context = create_test_context(temp_dir.path());

        let result = tool
            .write_file(&file_path, "Nested content", &context)
            .await
            .unwrap();

        assert!(result.is_success());
        assert!(file_path.exists());
        assert_eq!(fs::read_to_string(&file_path).unwrap(), "Nested content");
    }

    #[tokio::test]
    async fn test_write_existing_file_without_read() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("existing.txt");

        // Create existing file
        fs::write(&file_path, "Original content").unwrap();

        let tool = create_write_tool();
        let context = create_test_context(temp_dir.path());

        // Try to write without reading first
        let result = tool.write_file(&file_path, "New content", &context).await;

        assert!(result.is_err());
        // Original content should be preserved
        assert_eq!(fs::read_to_string(&file_path).unwrap(), "Original content");
    }

    #[tokio::test]
    async fn test_write_existing_file_after_read() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("existing.txt");

        // Create existing file
        fs::write(&file_path, "Original content").unwrap();

        let history = super::super::create_shared_history();
        let tool = WriteTool::new(history.clone());
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

        // Now write should succeed
        let result = tool
            .write_file(&file_path, "New content", &context)
            .await
            .unwrap();

        assert!(result.is_success());
        assert_eq!(fs::read_to_string(&file_path).unwrap(), "New content");
    }

    #[tokio::test]
    async fn test_write_without_read_requirement() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("existing.txt");

        // Create existing file
        fs::write(&file_path, "Original content").unwrap();

        let tool = create_write_tool().with_require_read_before_overwrite(false);
        let context = create_test_context(temp_dir.path());

        // Write without reading first should succeed
        let result = tool
            .write_file(&file_path, "New content", &context)
            .await
            .unwrap();

        assert!(result.is_success());
        assert_eq!(fs::read_to_string(&file_path).unwrap(), "New content");
    }

    #[tokio::test]
    async fn test_write_content_too_large() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("large.txt");

        let tool = create_write_tool();
        let context = create_test_context(temp_dir.path());

        // Create content larger than MAX_WRITE_SIZE
        let large_content = "x".repeat(MAX_WRITE_SIZE + 1);

        let result = tool.write_file(&file_path, &large_content, &context).await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_can_write_new_file() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("new.txt");

        let tool = create_write_tool();
        let context = create_test_context(temp_dir.path());

        assert!(tool.can_write(&file_path, &context));
    }

    #[tokio::test]
    async fn test_can_write_existing_file_without_read() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("existing.txt");
        fs::write(&file_path, "content").unwrap();

        let tool = create_write_tool();
        let context = create_test_context(temp_dir.path());

        assert!(!tool.can_write(&file_path, &context));
    }

    #[tokio::test]
    async fn test_tool_execute() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.txt");

        let tool = create_write_tool();
        let context = create_test_context(temp_dir.path());
        let params = serde_json::json!({
            "path": file_path.to_str().unwrap(),
            "content": "Test content"
        });

        let result = tool.execute(params, &context).await.unwrap();

        assert!(result.is_success());
        assert!(file_path.exists());
    }

    #[tokio::test]
    async fn test_tool_execute_missing_path() {
        let temp_dir = TempDir::new().unwrap();
        let tool = create_write_tool();
        let context = create_test_context(temp_dir.path());
        let params = serde_json::json!({
            "content": "Test content"
        });

        let result = tool.execute(params, &context).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::InvalidParams(_)));
    }

    #[tokio::test]
    async fn test_tool_execute_missing_content() {
        let temp_dir = TempDir::new().unwrap();
        let tool = create_write_tool();
        let context = create_test_context(temp_dir.path());
        let params = serde_json::json!({
            "path": "test.txt"
        });

        let result = tool.execute(params, &context).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::InvalidParams(_)));
    }

    #[test]
    fn test_tool_name() {
        let tool = create_write_tool();
        assert_eq!(tool.name(), "Write");
    }

    #[test]
    fn test_tool_description() {
        let tool = create_write_tool();
        assert!(!tool.description().is_empty());
        assert!(tool.description().contains("Write"));
    }

    #[test]
    fn test_tool_input_schema() {
        let tool = create_write_tool();
        let schema = tool.input_schema();
        assert_eq!(schema["type"], "object");
        assert!(schema["properties"]["path"].is_object());
        assert!(schema["properties"]["content"].is_object());
    }

    #[tokio::test]
    async fn test_check_permissions_new_file() {
        let temp_dir = TempDir::new().unwrap();
        let tool = create_write_tool();
        let context = create_test_context(temp_dir.path());
        let params = serde_json::json!({
            "path": "new_file.txt",
            "content": "content"
        });

        let result = tool.check_permissions(&params, &context).await;
        assert!(result.is_allowed());
    }

    #[tokio::test]
    async fn test_check_permissions_existing_file_not_read() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("existing.txt");
        fs::write(&file_path, "content").unwrap();

        let tool = create_write_tool();
        let context = create_test_context(temp_dir.path());
        let params = serde_json::json!({
            "path": file_path.to_str().unwrap(),
            "content": "new content"
        });

        let result = tool.check_permissions(&params, &context).await;
        assert!(result.requires_confirmation());
    }

    #[tokio::test]
    async fn test_check_permissions_missing_path() {
        let temp_dir = TempDir::new().unwrap();
        let tool = create_write_tool();
        let context = create_test_context(temp_dir.path());
        let params = serde_json::json!({});

        let result = tool.check_permissions(&params, &context).await;
        assert!(result.is_denied());
    }

    #[tokio::test]
    async fn test_write_updates_read_history() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("new.txt");

        let tool = create_write_tool();
        let context = create_test_context(temp_dir.path());

        tool.write_file(&file_path, "content", &context)
            .await
            .unwrap();

        // After writing, the file should be in read history
        assert!(tool.read_history.read().unwrap().has_read(&file_path));
    }
}
