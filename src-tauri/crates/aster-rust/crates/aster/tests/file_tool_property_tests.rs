//! Property-based tests for File Tools
//!
//! **Property 6: File Read Tracking**
//! *For any* file operation, the file read history SHALL accurately track
//! which files have been read, and Edit/Write tools SHALL detect unread files.
//!
//! **Validates: Requirements 4.5, 4.6**

use aster::tools::file::{
    compute_content_hash, create_shared_history, EditTool, ReadTool, WriteTool,
};
use aster::tools::{Tool, ToolContext};
use proptest::prelude::*;
use std::fs;
use tempfile::TempDir;

// ============================================================================
// Arbitrary Generators
// ============================================================================

/// Generate arbitrary file content (non-empty text)
fn arb_file_content() -> impl Strategy<Value = String> {
    "[a-zA-Z0-9 \n]{10,200}".prop_map(|s| s)
}

/// Generate arbitrary file names (valid file names)
fn arb_file_name() -> impl Strategy<Value = String> {
    "[a-z][a-z0-9_]{2,10}\\.(txt|rs|py|md|json)".prop_map(|s| s)
}

// ============================================================================
// Helper Functions
// ============================================================================

fn create_test_context(dir: &std::path::Path) -> ToolContext {
    ToolContext::new(dir.to_path_buf())
        .with_session_id("test-session")
        .with_user("test-user")
}

// ============================================================================
// Property Tests - Property 6: File Read Tracking
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: tool-alignment, Property 6: File Read Tracking - Read records file**
    ///
    /// Property: Reading a file SHALL record it in the read history
    /// *For any* file that is read using ReadTool, the file SHALL be
    /// recorded in the shared read history.
    ///
    /// **Validates: Requirements 4.5**
    #[test]
    fn prop_read_records_file_in_history(
        content in arb_file_content(),
        file_name in arb_file_name()
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let file_path = temp_dir.path().join(&file_name);

            // Create test file
            fs::write(&file_path, &content).unwrap();

            let history = create_shared_history();
            let read_tool = ReadTool::new(history.clone());
            let context = create_test_context(temp_dir.path());

            // Read the file
            let params = serde_json::json!({
                "path": file_path.to_str().unwrap()
            });
            let result = read_tool.execute(params, &context).await;

            prop_assert!(result.is_ok(), "Read should succeed");

            // Verify file is in history
            let history_guard = history.read().unwrap();
            prop_assert!(
                history_guard.has_read(&file_path),
                "File should be recorded in read history"
            );

            // Verify content hash is correct
            let record = history_guard.get_record(&file_path);
            prop_assert!(record.is_some(), "Record should exist");
            let expected_hash = compute_content_hash(content.as_bytes());
            prop_assert_eq!(
                &record.unwrap().content_hash,
                &expected_hash,
                "Content hash should match"
            );

            Ok(())
        })?;
    }

    /// **Feature: tool-alignment, Property 6: File Read Tracking - Write requires read**
    ///
    /// Property: Writing to an existing file SHALL fail if not read first
    /// *For any* existing file that has not been read, WriteTool SHALL
    /// return an error when attempting to overwrite.
    ///
    /// **Validates: Requirements 4.6**
    #[test]
    fn prop_write_requires_read_for_existing_files(
        original_content in arb_file_content(),
        new_content in arb_file_content(),
        file_name in arb_file_name()
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let file_path = temp_dir.path().join(&file_name);

            // Create existing file
            fs::write(&file_path, &original_content).unwrap();

            let history = create_shared_history();
            let write_tool = WriteTool::new(history.clone());
            let context = create_test_context(temp_dir.path());

            // Try to write without reading first
            let params = serde_json::json!({
                "path": file_path.to_str().unwrap(),
                "content": new_content
            });
            let result = write_tool.execute(params, &context).await;

            // Should fail because file wasn't read
            prop_assert!(result.is_err(), "Write should fail for unread file");

            // Original content should be preserved
            let actual_content = fs::read_to_string(&file_path).unwrap();
            prop_assert_eq!(
                actual_content,
                original_content,
                "Original content should be preserved"
            );

            Ok(())
        })?;
    }

    /// **Feature: tool-alignment, Property 6: File Read Tracking - Write succeeds after read**
    ///
    /// Property: Writing to a file SHALL succeed after reading it
    /// *For any* file that has been read using ReadTool, WriteTool SHALL
    /// successfully overwrite the file.
    ///
    /// **Validates: Requirements 4.5, 4.6**
    #[test]
    fn prop_write_succeeds_after_read(
        original_content in arb_file_content(),
        new_content in arb_file_content(),
        file_name in arb_file_name()
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let file_path = temp_dir.path().join(&file_name);

            // Create existing file
            fs::write(&file_path, &original_content).unwrap();

            let history = create_shared_history();
            let read_tool = ReadTool::new(history.clone());
            let write_tool = WriteTool::new(history.clone());
            let context = create_test_context(temp_dir.path());

            // Read the file first
            let read_params = serde_json::json!({
                "path": file_path.to_str().unwrap()
            });
            let read_result = read_tool.execute(read_params, &context).await;
            prop_assert!(read_result.is_ok(), "Read should succeed");

            // Now write should succeed
            let write_params = serde_json::json!({
                "path": file_path.to_str().unwrap(),
                "content": new_content
            });
            let write_result = write_tool.execute(write_params, &context).await;
            prop_assert!(write_result.is_ok(), "Write should succeed after read");

            // Verify new content
            let actual_content = fs::read_to_string(&file_path).unwrap();
            prop_assert_eq!(
                actual_content,
                new_content,
                "New content should be written"
            );

            Ok(())
        })?;
    }

    /// **Feature: tool-alignment, Property 6: File Read Tracking - Edit requires read**
    ///
    /// Property: Editing a file SHALL fail if not read first
    /// *For any* file that has not been read, EditTool SHALL return an error.
    ///
    /// **Validates: Requirements 4.5**
    #[test]
    fn prop_edit_requires_read(
        content in "[a-zA-Z]{20,50}".prop_map(|s| s),
        file_name in arb_file_name()
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let file_path = temp_dir.path().join(&file_name);

            // Create file with content that has a unique substring
            fs::write(&file_path, &content).unwrap();

            let history = create_shared_history();
            let edit_tool = EditTool::new(history.clone());
            let context = create_test_context(temp_dir.path());

            // Try to edit without reading first
            // Use first 5 chars as old_str (should be unique in our generated content)
            #[allow(clippy::string_slice)]
            let old_str = &content[0..5.min(content.len())];
            let params = serde_json::json!({
                "path": file_path.to_str().unwrap(),
                "old_str": old_str,
                "new_str": "REPLACED"
            });
            let result = edit_tool.execute(params, &context).await;

            // Should fail because file wasn't read
            prop_assert!(result.is_err(), "Edit should fail for unread file");

            // Original content should be preserved
            let actual_content = fs::read_to_string(&file_path).unwrap();
            prop_assert_eq!(
                actual_content,
                content,
                "Original content should be preserved"
            );

            Ok(())
        })?;
    }

    /// **Feature: tool-alignment, Property 6: File Read Tracking - Write to new file**
    ///
    /// Property: Writing to a new file SHALL succeed without prior read
    /// *For any* new file (that doesn't exist), WriteTool SHALL successfully
    /// create and write to the file.
    ///
    /// **Validates: Requirements 4.6**
    #[test]
    fn prop_write_new_file_succeeds(
        content in arb_file_content(),
        file_name in arb_file_name()
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let file_path = temp_dir.path().join(&file_name);

            // File doesn't exist yet
            prop_assert!(!file_path.exists(), "File should not exist initially");

            let history = create_shared_history();
            let write_tool = WriteTool::new(history.clone());
            let context = create_test_context(temp_dir.path());

            // Write to new file should succeed
            let params = serde_json::json!({
                "path": file_path.to_str().unwrap(),
                "content": content
            });
            let result = write_tool.execute(params, &context).await;

            prop_assert!(result.is_ok(), "Write to new file should succeed");

            // Verify file was created with correct content
            prop_assert!(file_path.exists(), "File should exist after write");
            let actual_content = fs::read_to_string(&file_path).unwrap();
            prop_assert_eq!(
                actual_content,
                content,
                "Content should match"
            );

            Ok(())
        })?;
    }

    /// **Feature: tool-alignment, Property 6: File Read Tracking - History updates after write**
    ///
    /// Property: After writing, the file SHALL be recorded in read history
    /// *For any* successful write operation, the file SHALL be recorded in
    /// the read history with the new content hash.
    ///
    /// **Validates: Requirements 4.5, 4.6**
    #[test]
    fn prop_write_updates_history(
        content in arb_file_content(),
        file_name in arb_file_name()
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let temp_dir = TempDir::new().unwrap();
            let file_path = temp_dir.path().join(&file_name);

            let history = create_shared_history();
            let write_tool = WriteTool::new(history.clone());
            let context = create_test_context(temp_dir.path());

            // Write to new file
            let params = serde_json::json!({
                "path": file_path.to_str().unwrap(),
                "content": content
            });
            let result = write_tool.execute(params, &context).await;
            prop_assert!(result.is_ok(), "Write should succeed");

            // Verify file is in history with correct hash
            let history_guard = history.read().unwrap();
            prop_assert!(
                history_guard.has_read(&file_path),
                "File should be in history after write"
            );

            let record = history_guard.get_record(&file_path);
            prop_assert!(record.is_some(), "Record should exist");
            let expected_hash = compute_content_hash(content.as_bytes());
            prop_assert_eq!(
                &record.unwrap().content_hash,
                &expected_hash,
                "Content hash should match written content"
            );

            Ok(())
        })?;
    }
}
