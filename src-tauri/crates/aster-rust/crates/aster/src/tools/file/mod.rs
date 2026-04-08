//! File Tools Module
//!
//! This module provides file operation tools including:
//! - ReadTool: Read text files, images, PDFs, and Jupyter notebooks
//! - WriteTool: Write files with read-before-overwrite validation
//! - EditTool: Smart string matching and batch edits
//!
//! Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10

pub mod edit;
pub mod read;
pub mod write;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use std::sync::RwLock;

// Re-export tools
pub use edit::EditTool;
pub use read::ReadTool;
pub use write::WriteTool;

/// Record of a file read operation
///
/// Tracks when a file was read and its content hash at that time.
/// Used by EditTool and WriteTool to validate file state.
///
/// Requirements: 4.5
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileReadRecord {
    /// Path to the file that was read
    pub path: PathBuf,

    /// Timestamp when the file was read
    pub read_at: SystemTime,

    /// Hash of the file content when read (for change detection)
    pub content_hash: String,

    /// File modification time when read
    pub mtime: Option<SystemTime>,

    /// File size when read
    pub size: u64,

    /// Number of lines in the file (for text files)
    pub line_count: Option<usize>,
}

impl FileReadRecord {
    /// Create a new FileReadRecord
    pub fn new(path: PathBuf, content_hash: String, size: u64) -> Self {
        Self {
            path,
            read_at: SystemTime::now(),
            content_hash,
            mtime: None,
            size,
            line_count: None,
        }
    }

    /// Set the modification time
    pub fn with_mtime(mut self, mtime: SystemTime) -> Self {
        self.mtime = Some(mtime);
        self
    }

    /// Set the line count
    pub fn with_line_count(mut self, line_count: usize) -> Self {
        self.line_count = Some(line_count);
        self
    }

    /// Check if the file has been modified since it was read
    pub fn is_modified(&self, current_mtime: SystemTime) -> bool {
        match self.mtime {
            Some(recorded_mtime) => current_mtime != recorded_mtime,
            None => false, // Can't determine, assume not modified
        }
    }
}

/// File read history tracker
///
/// Maintains a history of file read operations for validation.
/// Used by EditTool to ensure files are read before editing,
/// and by WriteTool to ensure files are read before overwriting.
///
/// Requirements: 4.5
#[derive(Debug, Default)]
pub struct FileReadHistory {
    /// Map of file paths to their read records
    records: HashMap<PathBuf, FileReadRecord>,
}

impl FileReadHistory {
    /// Create a new empty FileReadHistory
    pub fn new() -> Self {
        Self {
            records: HashMap::new(),
        }
    }

    /// Record a file read operation
    pub fn record_read(&mut self, record: FileReadRecord) {
        let path = record.path.clone();
        self.records.insert(path, record);
    }

    /// Check if a file has been read
    pub fn has_read(&self, path: &PathBuf) -> bool {
        self.records.contains_key(path)
    }

    /// Get the read record for a file
    pub fn get_record(&self, path: &PathBuf) -> Option<&FileReadRecord> {
        self.records.get(path)
    }

    /// Remove a read record (e.g., after successful write)
    pub fn remove_record(&mut self, path: &PathBuf) -> Option<FileReadRecord> {
        self.records.remove(path)
    }

    /// Clear all read records
    pub fn clear(&mut self) {
        self.records.clear();
    }

    /// Get the number of tracked files
    pub fn len(&self) -> usize {
        self.records.len()
    }

    /// Check if the history is empty
    pub fn is_empty(&self) -> bool {
        self.records.is_empty()
    }

    /// Get all tracked file paths
    pub fn tracked_files(&self) -> Vec<&PathBuf> {
        self.records.keys().collect()
    }

    /// Check if a file has been modified since it was read
    ///
    /// Returns:
    /// - Some(true) if the file has been modified
    /// - Some(false) if the file has not been modified
    /// - None if the file has not been read or mtime is not available
    pub fn is_file_modified(&self, path: &PathBuf, current_mtime: SystemTime) -> Option<bool> {
        self.records
            .get(path)
            .map(|record| record.is_modified(current_mtime))
    }
}

/// Shared file read history for use across tools
pub type SharedFileReadHistory = Arc<RwLock<FileReadHistory>>;

/// Create a new shared file read history
pub fn create_shared_history() -> SharedFileReadHistory {
    Arc::new(RwLock::new(FileReadHistory::new()))
}

/// Compute a hash of file content for change detection
pub fn compute_content_hash(content: &[u8]) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    content.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_file_read_record_new() {
        let record = FileReadRecord::new(PathBuf::from("/tmp/test.txt"), "abc123".to_string(), 100);

        assert_eq!(record.path, PathBuf::from("/tmp/test.txt"));
        assert_eq!(record.content_hash, "abc123");
        assert_eq!(record.size, 100);
        assert!(record.mtime.is_none());
        assert!(record.line_count.is_none());
    }

    #[test]
    fn test_file_read_record_with_mtime() {
        let mtime = SystemTime::now();
        let record = FileReadRecord::new(PathBuf::from("/tmp/test.txt"), "abc123".to_string(), 100)
            .with_mtime(mtime);

        assert_eq!(record.mtime, Some(mtime));
    }

    #[test]
    fn test_file_read_record_with_line_count() {
        let record = FileReadRecord::new(PathBuf::from("/tmp/test.txt"), "abc123".to_string(), 100)
            .with_line_count(50);

        assert_eq!(record.line_count, Some(50));
    }

    #[test]
    fn test_file_read_record_is_modified() {
        let mtime = SystemTime::now();
        let record = FileReadRecord::new(PathBuf::from("/tmp/test.txt"), "abc123".to_string(), 100)
            .with_mtime(mtime);

        // Same mtime - not modified
        assert!(!record.is_modified(mtime));

        // Different mtime - modified
        let new_mtime = mtime + std::time::Duration::from_secs(1);
        assert!(record.is_modified(new_mtime));
    }

    #[test]
    fn test_file_read_history_new() {
        let history = FileReadHistory::new();
        assert!(history.is_empty());
        assert_eq!(history.len(), 0);
    }

    #[test]
    fn test_file_read_history_record_read() {
        let mut history = FileReadHistory::new();
        let path = PathBuf::from("/tmp/test.txt");
        let record = FileReadRecord::new(path.clone(), "abc123".to_string(), 100);

        history.record_read(record);

        assert!(history.has_read(&path));
        assert_eq!(history.len(), 1);
    }

    #[test]
    fn test_file_read_history_get_record() {
        let mut history = FileReadHistory::new();
        let path = PathBuf::from("/tmp/test.txt");
        let record = FileReadRecord::new(path.clone(), "abc123".to_string(), 100);

        history.record_read(record);

        let retrieved = history.get_record(&path);
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().content_hash, "abc123");
    }

    #[test]
    fn test_file_read_history_remove_record() {
        let mut history = FileReadHistory::new();
        let path = PathBuf::from("/tmp/test.txt");
        let record = FileReadRecord::new(path.clone(), "abc123".to_string(), 100);

        history.record_read(record);
        assert!(history.has_read(&path));

        let removed = history.remove_record(&path);
        assert!(removed.is_some());
        assert!(!history.has_read(&path));
    }

    #[test]
    fn test_file_read_history_clear() {
        let mut history = FileReadHistory::new();
        history.record_read(FileReadRecord::new(
            PathBuf::from("/tmp/test1.txt"),
            "abc".to_string(),
            100,
        ));
        history.record_read(FileReadRecord::new(
            PathBuf::from("/tmp/test2.txt"),
            "def".to_string(),
            200,
        ));

        assert_eq!(history.len(), 2);

        history.clear();
        assert!(history.is_empty());
    }

    #[test]
    fn test_file_read_history_tracked_files() {
        let mut history = FileReadHistory::new();
        let path1 = PathBuf::from("/tmp/test1.txt");
        let path2 = PathBuf::from("/tmp/test2.txt");

        history.record_read(FileReadRecord::new(path1.clone(), "abc".to_string(), 100));
        history.record_read(FileReadRecord::new(path2.clone(), "def".to_string(), 200));

        let tracked = history.tracked_files();
        assert_eq!(tracked.len(), 2);
        assert!(tracked.contains(&&path1));
        assert!(tracked.contains(&&path2));
    }

    #[test]
    fn test_file_read_history_is_file_modified() {
        let mut history = FileReadHistory::new();
        let path = PathBuf::from("/tmp/test.txt");
        let mtime = SystemTime::now();
        let record = FileReadRecord::new(path.clone(), "abc123".to_string(), 100).with_mtime(mtime);

        history.record_read(record);

        // Same mtime - not modified
        assert_eq!(history.is_file_modified(&path, mtime), Some(false));

        // Different mtime - modified
        let new_mtime = mtime + std::time::Duration::from_secs(1);
        assert_eq!(history.is_file_modified(&path, new_mtime), Some(true));

        // Unknown file
        let unknown_path = PathBuf::from("/tmp/unknown.txt");
        assert_eq!(history.is_file_modified(&unknown_path, mtime), None);
    }

    #[test]
    fn test_compute_content_hash() {
        let content1 = b"Hello, World!";
        let content2 = b"Hello, World!";
        let content3 = b"Different content";

        let hash1 = compute_content_hash(content1);
        let hash2 = compute_content_hash(content2);
        let hash3 = compute_content_hash(content3);

        // Same content should produce same hash
        assert_eq!(hash1, hash2);

        // Different content should produce different hash
        assert_ne!(hash1, hash3);

        // Hash should be 16 hex characters
        assert_eq!(hash1.len(), 16);
    }

    #[test]
    fn test_create_shared_history() {
        let history = create_shared_history();

        // Should be able to write
        {
            let mut write_guard = history.write().unwrap();
            write_guard.record_read(FileReadRecord::new(
                PathBuf::from("/tmp/test.txt"),
                "abc".to_string(),
                100,
            ));
        }

        // Should be able to read
        {
            let read_guard = history.read().unwrap();
            assert!(read_guard.has_read(&PathBuf::from("/tmp/test.txt")));
        }
    }
}
