//! 检查点系统测试
//!
//! 测试检查点管理器、存储、Diff 引擎等核心功能
//!
//! 测试覆盖：
//! - 类型创建和序列化
//! - Diff 计算和应用
//! - 存储压缩/解压
//! - 会话管理

use super::*;

// ============================================================================
// 类型测试
// ============================================================================

#[cfg(test)]
mod types_tests {
    use super::*;

    #[test]
    fn test_file_checkpoint_creation() {
        let checkpoint = FileCheckpoint {
            path: "/test/file.rs".to_string(),
            content: Some("fn main() {}".to_string()),
            diff: None,
            hash: "abc123".to_string(),
            timestamp: 1234567890,
            name: Some("Initial".to_string()),
            description: Some("First checkpoint".to_string()),
            git_commit: Some("abc123def".to_string()),
            edit_count: Some(5),
            compressed: Some(false),
            metadata: None,
            tags: Some(vec!["test".to_string()]),
        };

        assert_eq!(checkpoint.path, "/test/file.rs");
        assert!(checkpoint.content.is_some());
        assert!(checkpoint.diff.is_none());
    }

    #[test]
    fn test_file_metadata() {
        let metadata = FileMetadata {
            mode: Some(0o644),
            uid: Some(1000),
            gid: Some(1000),
            size: Some(1024),
        };

        assert_eq!(metadata.mode, Some(0o644));
        assert_eq!(metadata.size, Some(1024));
    }

    #[test]
    fn test_checkpoint_search_options_default() {
        let options = CheckpointSearchOptions::default();

        assert!(options.file_path.is_none());
        assert!(options.time_range.is_none());
        assert!(options.tags.is_none());
        assert!(options.limit.is_none());
    }

    #[test]
    fn test_time_range() {
        let range = TimeRange {
            start: 1000,
            end: 2000,
        };

        assert_eq!(range.start, 1000);
        assert_eq!(range.end, 2000);
    }

    #[test]
    fn test_checkpoint_restore_options_default() {
        let options = CheckpointRestoreOptions::default();

        assert!(options.create_backup.is_none());
        assert!(options.dry_run.is_none());
        assert!(options.preserve_metadata.is_none());
    }

    #[test]
    fn test_checkpoint_stats() {
        let stats = CheckpointStats {
            total_checkpoints: 10,
            total_files: 5,
            total_size: 1024,
            oldest_checkpoint: Some(1000),
            newest_checkpoint: Some(2000),
            compression_ratio: Some(0.5),
        };

        assert_eq!(stats.total_checkpoints, 10);
        assert_eq!(stats.total_files, 5);
    }

    #[test]
    fn test_checkpoint_history_item() {
        let item = CheckpointHistoryItem {
            index: 0,
            timestamp: 1234567890,
            hash: "abc123".to_string(),
            name: Some("Test".to_string()),
            description: None,
            git_commit: None,
            tags: None,
            size: Some(100),
            compressed: Some(false),
            current: true,
        };

        assert_eq!(item.index, 0);
        assert!(item.current);
    }

    #[test]
    fn test_checkpoint_history() {
        let history = CheckpointHistory {
            checkpoints: vec![],
            current_index: -1,
        };

        assert!(history.checkpoints.is_empty());
        assert_eq!(history.current_index, -1);
    }

    #[test]
    fn test_checkpoint_diff() {
        let diff = CheckpointDiff {
            added: 5,
            removed: 3,
            modified: 2,
            diff_text: "diff content".to_string(),
        };

        assert_eq!(diff.added, 5);
        assert_eq!(diff.removed, 3);
    }

    #[test]
    fn test_checkpoint_result_ok() {
        let result = CheckpointResult::ok("Success");

        assert!(result.success);
        assert_eq!(result.message, "Success");
        assert!(result.content.is_none());
    }

    #[test]
    fn test_checkpoint_result_ok_with_content() {
        let result = CheckpointResult::ok_with_content("Success", "content".to_string());

        assert!(result.success);
        assert_eq!(result.content, Some("content".to_string()));
    }

    #[test]
    fn test_checkpoint_result_err() {
        let result = CheckpointResult::err("Error");

        assert!(!result.success);
        assert_eq!(result.message, "Error");
    }

    #[test]
    fn test_session_metadata() {
        let metadata = SessionMetadata {
            git_branch: Some("main".to_string()),
            git_commit: Some("abc123".to_string()),
            tags: Some(vec!["test".to_string()]),
            total_size: Some(1024),
        };

        assert_eq!(metadata.git_branch, Some("main".to_string()));
    }

    #[test]
    fn test_session_info() {
        let info = SessionInfo {
            id: "session-1".to_string(),
            start_time: 1234567890,
            working_directory: "/test".to_string(),
            file_count: 5,
            total_size: 1024,
        };

        assert_eq!(info.id, "session-1");
        assert_eq!(info.file_count, 5);
    }

    #[test]
    fn test_constants() {
        assert_eq!(MAX_CHECKPOINTS_PER_FILE, 100);
        assert_eq!(CHECKPOINT_RETENTION_DAYS, 30);
        assert_eq!(DEFAULT_AUTO_CHECKPOINT_INTERVAL, 5);
        assert_eq!(MAX_STORAGE_SIZE_MB, 500);
        assert_eq!(COMPRESSION_THRESHOLD_BYTES, 1024);
    }

    #[test]
    fn test_serialization() {
        let checkpoint = FileCheckpoint {
            path: "/test.rs".to_string(),
            content: Some("test".to_string()),
            diff: None,
            hash: "abc".to_string(),
            timestamp: 1000,
            name: None,
            description: None,
            git_commit: None,
            edit_count: None,
            compressed: None,
            metadata: None,
            tags: None,
        };

        let json = serde_json::to_string(&checkpoint).unwrap();
        let parsed: FileCheckpoint = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.path, checkpoint.path);
        assert_eq!(parsed.hash, checkpoint.hash);
    }
}

// ============================================================================
// Diff 引擎测试
// ============================================================================

#[cfg(test)]
mod diff_tests {
    use super::*;

    #[test]
    fn test_diff_engine_creation() {
        let engine = DiffEngine::new();
        let _ = engine; // 确保创建成功
    }

    #[test]
    fn test_diff_engine_default() {
        let engine = DiffEngine;
        let _ = engine;
    }

    #[test]
    fn test_calculate_diff_identical() {
        let engine = DiffEngine::new();
        let content = "line1\nline2\nline3";

        let diff = engine.calculate_diff(content, content);
        let entries: Vec<DiffEntry> = serde_json::from_str(&diff).unwrap();

        // 所有行应该是 Eq
        for entry in &entries {
            assert!(matches!(entry.op, DiffOp::Eq));
        }
    }

    #[test]
    fn test_calculate_diff_add_lines() {
        let engine = DiffEngine::new();
        let old = "line1\nline2";
        let new = "line1\nline2\nline3";

        let diff = engine.calculate_diff(old, new);
        let entries: Vec<DiffEntry> = serde_json::from_str(&diff).unwrap();

        // 应该有 Add 操作
        let has_add = entries.iter().any(|e| matches!(e.op, DiffOp::Add));
        assert!(has_add);
    }

    #[test]
    fn test_calculate_diff_remove_lines() {
        let engine = DiffEngine::new();
        let old = "line1\nline2\nline3";
        let new = "line1\nline2";

        let diff = engine.calculate_diff(old, new);
        let entries: Vec<DiffEntry> = serde_json::from_str(&diff).unwrap();

        // 应该有 Del 操作
        let has_del = entries.iter().any(|e| matches!(e.op, DiffOp::Del));
        assert!(has_del);
    }

    #[test]
    fn test_calculate_diff_modify_lines() {
        let engine = DiffEngine::new();
        let old = "line1\nline2\nline3";
        let new = "line1\nmodified\nline3";

        let diff = engine.calculate_diff(old, new);
        let entries: Vec<DiffEntry> = serde_json::from_str(&diff).unwrap();

        // 应该有 Add 和 Del 操作
        let has_add = entries.iter().any(|e| matches!(e.op, DiffOp::Add));
        let has_del = entries.iter().any(|e| matches!(e.op, DiffOp::Del));
        assert!(has_add);
        assert!(has_del);
    }

    #[test]
    fn test_apply_diff_add() {
        let engine = DiffEngine::new();
        let old = "line1\nline2";
        let new = "line1\nline2\nline3";

        let diff = engine.calculate_diff(old, new);
        let result = engine.apply_diff(old, &diff);

        assert_eq!(result, new);
    }

    #[test]
    fn test_apply_diff_remove() {
        let engine = DiffEngine::new();
        let old = "line1\nline2\nline3";
        let new = "line1\nline3";

        let diff = engine.calculate_diff(old, new);
        let result = engine.apply_diff(old, &diff);

        assert_eq!(result, new);
    }

    #[test]
    fn test_apply_diff_invalid_json() {
        let engine = DiffEngine::new();
        let content = "original content";

        let result = engine.apply_diff(content, "invalid json");
        assert_eq!(result, content);
    }

    #[test]
    fn test_apply_diff_empty() {
        let engine = DiffEngine::new();
        let old = "";
        let new = "new content";

        let diff = engine.calculate_diff(old, new);
        let result = engine.apply_diff(old, &diff);

        assert_eq!(result, new);
    }

    #[test]
    fn test_diff_op_serialization() {
        let add = DiffOp::Add;
        let del = DiffOp::Del;
        let eq = DiffOp::Eq;

        assert_eq!(serde_json::to_string(&add).unwrap(), "\"add\"");
        assert_eq!(serde_json::to_string(&del).unwrap(), "\"del\"");
        assert_eq!(serde_json::to_string(&eq).unwrap(), "\"eq\"");
    }

    #[test]
    fn test_diff_entry_serialization() {
        let entry = DiffEntry {
            op: DiffOp::Add,
            line: "test line".to_string(),
            num: 5,
        };

        let json = serde_json::to_string(&entry).unwrap();
        let parsed: DiffEntry = serde_json::from_str(&json).unwrap();

        assert!(matches!(parsed.op, DiffOp::Add));
        assert_eq!(parsed.line, "test line");
        assert_eq!(parsed.num, 5);
    }
}

// ============================================================================
// 存储测试
// ============================================================================

#[cfg(test)]
mod storage_tests {
    use super::*;

    #[test]
    fn test_storage_creation() {
        let storage = CheckpointStorage::new();
        let _ = storage;
    }

    #[test]
    fn test_storage_default() {
        let storage = CheckpointStorage::default();
        let _ = storage;
    }

    #[test]
    fn test_compress_decompress() {
        let storage = CheckpointStorage::new();
        let original = "Hello, World! This is test content.";

        let compressed = storage.compress_content(original);
        let decompressed = storage.decompress_content(&compressed);

        assert_eq!(decompressed, original);
    }

    #[test]
    fn test_compress_empty() {
        let storage = CheckpointStorage::new();
        let original = "";

        let compressed = storage.compress_content(original);
        let decompressed = storage.decompress_content(&compressed);

        assert_eq!(decompressed, original);
    }

    #[test]
    fn test_compress_unicode() {
        let storage = CheckpointStorage::new();
        let original = "你好世界！这是测试内容。🎉";

        let compressed = storage.compress_content(original);
        let decompressed = storage.decompress_content(&compressed);

        assert_eq!(decompressed, original);
    }

    #[test]
    fn test_decompress_invalid() {
        let storage = CheckpointStorage::new();
        let invalid = "not valid base64!!!";

        // 无效输入应该返回原始字符串
        let result = storage.decompress_content(invalid);
        assert_eq!(result, invalid);
    }

    #[test]
    fn test_compress_large_content() {
        let storage = CheckpointStorage::new();
        let original: String = "x".repeat(10000);

        let compressed = storage.compress_content(&original);
        let decompressed = storage.decompress_content(&compressed);

        assert_eq!(decompressed, original);
    }
}

// ============================================================================
// 会话测试
// ============================================================================

#[cfg(test)]
mod session_tests {
    use super::*;

    #[test]
    fn test_checkpoint_session_new() {
        let session =
            CheckpointSession::new(Some("test-session".to_string()), "/test/dir".to_string(), 5);

        assert_eq!(session.id, "test-session");
        assert_eq!(session.working_directory, "/test/dir");
        assert_eq!(session.auto_checkpoint_interval, 5);
        assert!(session.checkpoints.is_empty());
    }

    #[test]
    fn test_checkpoint_session_auto_id() {
        let session = CheckpointSession::new(None, "/test/dir".to_string(), 5);

        assert!(!session.id.is_empty());
        assert!(session.id.contains('-'));
    }

    #[test]
    fn test_checkpoint_session_get_checkpoints() {
        let mut session = CheckpointSession::new(None, "/test".to_string(), 5);

        // 空时返回 None
        assert!(session.get_checkpoints("/test/file.rs").is_none());

        // 添加检查点
        session.checkpoints.insert(
            "/test/file.rs".to_string(),
            vec![FileCheckpoint {
                path: "/test/file.rs".to_string(),
                content: Some("test".to_string()),
                diff: None,
                hash: "abc".to_string(),
                timestamp: 1000,
                name: None,
                description: None,
                git_commit: None,
                edit_count: None,
                compressed: None,
                metadata: None,
                tags: None,
            }],
        );

        let checkpoints = session.get_checkpoints("/test/file.rs");
        assert!(checkpoints.is_some());
        assert_eq!(checkpoints.unwrap().len(), 1);
    }

    #[test]
    fn test_checkpoint_session_get_current_index() {
        let mut session = CheckpointSession::new(None, "/test".to_string(), 5);

        // 空时返回 None
        assert!(session.get_current_index("/test/file.rs").is_none());

        // 设置索引
        session.current_index.insert("/test/file.rs".to_string(), 3);

        assert_eq!(session.get_current_index("/test/file.rs"), Some(3));
    }

    #[test]
    fn test_checkpoint_manager_new() {
        let manager = CheckpointManager::new();
        let _ = manager;
    }

    #[test]
    fn test_checkpoint_manager_default() {
        let manager = CheckpointManager::default();
        let _ = manager;
    }

    #[tokio::test]
    async fn test_checkpoint_manager_get_stats_no_session() {
        let manager = CheckpointManager::new();

        let stats = manager.get_stats().await;

        assert_eq!(stats.total_checkpoints, 0);
        assert_eq!(stats.total_files, 0);
    }

    #[tokio::test]
    async fn test_checkpoint_manager_get_history_no_session() {
        let manager = CheckpointManager::new();

        let history = manager.get_checkpoint_history("/test/file.rs").await;

        assert!(history.checkpoints.is_empty());
        assert_eq!(history.current_index, -1);
    }

    #[tokio::test]
    async fn test_checkpoint_manager_undo_no_session() {
        let manager = CheckpointManager::new();

        let result = manager.undo("/test/file.rs").await;

        assert!(!result.success);
        assert!(result.message.contains("No active"));
    }

    #[tokio::test]
    async fn test_checkpoint_manager_redo_no_session() {
        let manager = CheckpointManager::new();

        let result = manager.redo("/test/file.rs").await;

        assert!(!result.success);
        assert!(result.message.contains("No active"));
    }

    #[tokio::test]
    async fn test_checkpoint_manager_end_session() {
        let manager = CheckpointManager::new();

        // 结束会话不应该 panic
        manager.end_session().await;
    }

    #[test]
    fn test_create_checkpoint_options_default() {
        let options = CreateCheckpointOptions::default();

        assert!(options.name.is_none());
        assert!(options.description.is_none());
        assert!(options.tags.is_none());
        assert!(options.force_full_content.is_none());
    }
}
