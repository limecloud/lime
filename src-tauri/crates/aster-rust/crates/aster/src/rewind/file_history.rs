//! 文件历史跟踪系统
//!
//! 提供文件修改跟踪、快照创建、状态恢复功能

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

/// 文件备份信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileBackup {
    /// 备份文件名
    pub backup_file_name: Option<String>,
    /// 原始文件的最后修改时间
    pub mtime: u64,
    /// 版本号
    pub version: u32,
    /// 文件哈希
    pub hash: Option<String>,
}

/// 快照数据结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileSnapshot {
    /// 关联的消息 ID
    pub message_id: String,
    /// 快照创建时间
    pub timestamp: i64,
    /// 被跟踪文件的备份信息
    pub tracked_file_backups: HashMap<String, FileBackup>,
}

/// Rewind 结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RewindResult {
    pub success: bool,
    pub files_changed: Vec<String>,
    pub insertions: u32,
    pub deletions: u32,
    pub error: Option<String>,
}

impl RewindResult {
    pub fn success(files_changed: Vec<String>, insertions: u32, deletions: u32) -> Self {
        Self {
            success: true,
            files_changed,
            insertions,
            deletions,
            error: None,
        }
    }

    pub fn error(msg: impl Into<String>) -> Self {
        Self {
            success: false,
            files_changed: vec![],
            insertions: 0,
            deletions: 0,
            error: Some(msg.into()),
        }
    }
}

/// 文件历史管理器
pub struct FileHistoryManager {
    session_id: String,
    tracked_files: HashSet<String>,
    snapshots: Vec<FileSnapshot>,
    backup_dir: PathBuf,
    enabled: bool,
}

impl FileHistoryManager {
    /// 创建新的文件历史管理器
    pub fn new(session_id: impl Into<String>) -> Self {
        let session_id = session_id.into();
        let backup_dir = dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("~/.config"))
            .join("aster")
            .join("file-history")
            .join(&session_id);

        // 确保备份目录存在
        let _ = fs::create_dir_all(&backup_dir);

        Self {
            session_id,
            tracked_files: HashSet::new(),
            snapshots: Vec::new(),
            backup_dir,
            enabled: true,
        }
    }

    /// 检查是否启用
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    /// 启用/禁用文件历史
    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    /// 开始跟踪文件
    pub fn track_file(&mut self, file_path: impl AsRef<Path>) {
        if !self.enabled {
            return;
        }
        let path = self.normalize_path(file_path.as_ref());
        self.tracked_files.insert(path);
    }

    /// 检查文件是否被跟踪
    pub fn is_tracked(&self, file_path: impl AsRef<Path>) -> bool {
        let path = self.normalize_path(file_path.as_ref());
        self.tracked_files.contains(&path)
    }

    /// 在文件修改前创建备份
    pub fn backup_file_before_change(&mut self, file_path: impl AsRef<Path>) -> Option<FileBackup> {
        if !self.enabled {
            return None;
        }

        let path = file_path.as_ref();
        let normalized = self.normalize_path(path);

        // 如果文件不存在，返回空备份
        if !path.exists() {
            return Some(FileBackup {
                backup_file_name: None,
                mtime: 0,
                version: 1,
                hash: None,
            });
        }

        // 读取文件内容并计算哈希
        let content = fs::read(path).ok()?;
        let hash = self.compute_hash(&content);
        let mtime = fs::metadata(path)
            .ok()?
            .modified()
            .ok()?
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_secs();

        // 生成备份文件名
        let backup_file_name = self.generate_backup_file_name(path, &hash);
        let backup_path = self.backup_dir.join(&backup_file_name);

        // 如果备份不存在，创建它
        if !backup_path.exists() {
            let _ = fs::write(&backup_path, &content);
        }

        // 开始跟踪这个文件
        self.tracked_files.insert(normalized);

        Some(FileBackup {
            backup_file_name: Some(backup_file_name),
            mtime,
            version: 1,
            hash: Some(hash),
        })
    }

    /// 创建快照
    pub fn create_snapshot(&mut self, message_id: impl Into<String>) {
        if !self.enabled {
            return;
        }

        let mut tracked_file_backups = HashMap::new();

        for file_path in self.tracked_files.clone() {
            if let Some(backup) = self.backup_file_before_change(&file_path) {
                tracked_file_backups.insert(file_path, backup);
            }
        }

        self.snapshots.push(FileSnapshot {
            message_id: message_id.into(),
            timestamp: chrono::Utc::now().timestamp(),
            tracked_file_backups,
        });
    }

    /// 检查是否有指定消息的快照
    pub fn has_snapshot(&self, message_id: &str) -> bool {
        self.snapshots.iter().any(|s| s.message_id == message_id)
    }

    /// 获取快照列表
    pub fn get_snapshots(&self) -> &[FileSnapshot] {
        &self.snapshots
    }

    /// 回退到指定消息的状态
    pub fn rewind_to_message(&self, message_id: &str, dry_run: bool) -> RewindResult {
        if !self.enabled {
            return RewindResult::error("文件历史已禁用");
        }

        // 查找快照
        let snapshot = self
            .snapshots
            .iter()
            .rev()
            .find(|s| s.message_id == message_id);
        let snapshot = match snapshot {
            Some(s) => s,
            None => return RewindResult::error(format!("未找到消息 {} 的快照", message_id)),
        };

        self.apply_snapshot(snapshot, dry_run)
    }

    /// 应用快照
    fn apply_snapshot(&self, snapshot: &FileSnapshot, dry_run: bool) -> RewindResult {
        let mut files_changed = Vec::new();
        let mut insertions = 0u32;
        let mut deletions = 0u32;

        // 遍历快照中的所有文件备份
        for (file_path, backup) in &snapshot.tracked_file_backups {
            let path = Path::new(file_path);

            if backup.backup_file_name.is_none() {
                // 文件在快照时不存在，应该删除
                if path.exists() {
                    deletions += self.count_lines(path);
                    if !dry_run {
                        let _ = fs::remove_file(path);
                    }
                    files_changed.push(file_path.clone());
                }
            } else if let Some(ref backup_name) = backup.backup_file_name {
                // 恢复文件内容
                let backup_path = self.backup_dir.join(backup_name);
                if !backup_path.exists() {
                    continue;
                }

                // 检查文件是否需要恢复（通过哈希比较）
                let current_hash = if path.exists() {
                    fs::read(path).ok().map(|c| self.compute_hash(&c))
                } else {
                    None
                };

                let needs_restore = current_hash.as_ref() != backup.hash.as_ref();

                if needs_restore {
                    let (ins, del) = self.calculate_diff(path, &backup_path);
                    insertions += ins;
                    deletions += del;

                    if !dry_run {
                        if let Ok(content) = fs::read(&backup_path) {
                            if let Some(parent) = path.parent() {
                                let _ = fs::create_dir_all(parent);
                            }
                            let _ = fs::write(path, content);
                        }
                    }
                    files_changed.push(file_path.clone());
                }
            }
        }

        RewindResult::success(files_changed, insertions, deletions)
    }

    /// 计算文件差异
    fn calculate_diff(&self, current: &Path, backup: &Path) -> (u32, u32) {
        let current_lines = self.count_lines(current);
        let backup_lines = self.count_lines(backup);

        let insertions = backup_lines.saturating_sub(current_lines);
        let deletions = current_lines.saturating_sub(backup_lines);

        (insertions, deletions)
    }

    /// 计算文件行数
    fn count_lines(&self, path: &Path) -> u32 {
        fs::read_to_string(path)
            .map(|s| s.lines().count() as u32)
            .unwrap_or(0)
    }

    /// 生成备份文件名
    fn generate_backup_file_name(&self, file_path: &Path, hash: &str) -> String {
        let _file_name = file_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("file");
        let ext = file_path.extension().and_then(|e| e.to_str()).unwrap_or("");
        let name = file_path
            .file_stem()
            .and_then(|n| n.to_str())
            .unwrap_or("file");

        if ext.is_empty() {
            format!("{}_{}", name, hash.get(..8).unwrap_or(hash))
        } else {
            format!("{}_{}.{}", name, hash.get(..8).unwrap_or(hash), ext)
        }
    }

    /// 计算文件内容的哈希
    fn compute_hash(&self, content: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(content);
        format!("{:x}", hasher.finalize())
    }

    /// 规范化文件路径
    fn normalize_path(&self, path: &Path) -> String {
        if path.is_absolute() {
            path.display().to_string()
        } else {
            std::env::current_dir()
                .map(|cwd| cwd.join(path).display().to_string())
                .unwrap_or_else(|_| path.display().to_string())
        }
    }

    /// 清理备份文件
    pub fn cleanup(&self) {
        let _ = fs::remove_dir_all(&self.backup_dir);
    }

    /// 获取被跟踪的文件数量
    pub fn get_tracked_files_count(&self) -> usize {
        self.tracked_files.len()
    }

    /// 获取快照数量
    pub fn get_snapshots_count(&self) -> usize {
        self.snapshots.len()
    }
}

// ============ 增强功能 ============

impl FileHistoryManager {
    /// 获取会话 ID
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    /// 获取备份目录
    pub fn backup_dir(&self) -> &Path {
        &self.backup_dir
    }

    /// 获取所有被跟踪的文件
    pub fn get_tracked_files(&self) -> Vec<String> {
        self.tracked_files.iter().cloned().collect()
    }

    /// 停止跟踪文件
    pub fn untrack_file(&mut self, file_path: impl AsRef<Path>) {
        let path = self.normalize_path(file_path.as_ref());
        self.tracked_files.remove(&path);
    }

    /// 清除所有跟踪的文件
    pub fn clear_tracked_files(&mut self) {
        self.tracked_files.clear();
    }

    /// 获取指定消息的快照
    pub fn get_snapshot(&self, message_id: &str) -> Option<&FileSnapshot> {
        self.snapshots.iter().find(|s| s.message_id == message_id)
    }

    /// 获取最新的快照
    pub fn get_latest_snapshot(&self) -> Option<&FileSnapshot> {
        self.snapshots.last()
    }

    /// 删除指定消息之后的所有快照
    pub fn remove_snapshots_after(&mut self, message_id: &str) -> usize {
        let idx = self
            .snapshots
            .iter()
            .position(|s| s.message_id == message_id);
        match idx {
            Some(i) if i + 1 < self.snapshots.len() => {
                let removed = self.snapshots.len() - i - 1;
                self.snapshots.truncate(i + 1);
                removed
            }
            _ => 0,
        }
    }

    /// 获取文件在指定快照时的内容
    pub fn get_file_content_at_snapshot(
        &self,
        message_id: &str,
        file_path: &str,
    ) -> Option<Vec<u8>> {
        let snapshot = self.get_snapshot(message_id)?;
        let backup = snapshot.tracked_file_backups.get(file_path)?;
        let backup_name = backup.backup_file_name.as_ref()?;
        let backup_path = self.backup_dir.join(backup_name);
        fs::read(&backup_path).ok()
    }

    /// 获取备份目录大小（字节）
    pub fn get_backup_size(&self) -> u64 {
        self.calculate_dir_size(&self.backup_dir)
    }

    fn calculate_dir_size(&self, path: &Path) -> u64 {
        fs::read_dir(path)
            .map(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .map(|e| e.metadata().map(|m| m.len()).unwrap_or(0))
                    .sum()
            })
            .unwrap_or(0)
    }
}

// ============ 单元测试 ============

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    fn create_test_file(dir: &Path, name: &str, content: &str) -> PathBuf {
        let path = dir.join(name);
        let mut file = fs::File::create(&path).unwrap();
        file.write_all(content.as_bytes()).unwrap();
        path
    }

    #[test]
    fn test_new_manager() {
        let manager = FileHistoryManager::new("test-session");
        assert_eq!(manager.session_id(), "test-session");
        assert!(manager.is_enabled());
        assert_eq!(manager.get_tracked_files_count(), 0);
        assert_eq!(manager.get_snapshots_count(), 0);
        manager.cleanup();
    }

    #[test]
    fn test_track_file() {
        let mut manager = FileHistoryManager::new("test-track");
        manager.track_file("/tmp/test.rs");
        assert!(manager.is_tracked("/tmp/test.rs"));
        assert!(!manager.is_tracked("/tmp/other.rs"));
        assert_eq!(manager.get_tracked_files_count(), 1);
        manager.cleanup();
    }

    #[test]
    fn test_untrack_file() {
        let mut manager = FileHistoryManager::new("test-untrack");
        manager.track_file("/tmp/test.rs");
        assert!(manager.is_tracked("/tmp/test.rs"));
        manager.untrack_file("/tmp/test.rs");
        assert!(!manager.is_tracked("/tmp/test.rs"));
        manager.cleanup();
    }

    #[test]
    fn test_backup_and_snapshot() {
        let temp_dir = TempDir::new().unwrap();
        let test_file = create_test_file(temp_dir.path(), "test.txt", "hello world");

        let mut manager = FileHistoryManager::new("test-backup");

        // 备份文件
        let backup = manager.backup_file_before_change(&test_file);
        assert!(backup.is_some());
        let backup = backup.unwrap();
        assert!(backup.backup_file_name.is_some());
        assert!(backup.hash.is_some());

        // 创建快照
        manager.create_snapshot("msg-1");
        assert_eq!(manager.get_snapshots_count(), 1);
        assert!(manager.has_snapshot("msg-1"));

        manager.cleanup();
    }

    #[test]
    fn test_rewind_to_message() {
        let temp_dir = TempDir::new().unwrap();
        let test_file = create_test_file(temp_dir.path(), "test.txt", "original content");

        let mut manager = FileHistoryManager::new("test-rewind");

        // 备份原始状态
        manager.backup_file_before_change(&test_file);
        manager.create_snapshot("msg-1");

        // 修改文件
        fs::write(&test_file, "modified content").unwrap();

        // 预览回退
        let preview = manager.rewind_to_message("msg-1", true);
        assert!(preview.success);

        // 文件应该还是修改后的内容（dry_run）
        let content = fs::read_to_string(&test_file).unwrap();
        assert_eq!(content, "modified content");

        // 实际回退
        let result = manager.rewind_to_message("msg-1", false);
        assert!(result.success);

        // 文件应该恢复为原始内容
        let content = fs::read_to_string(&test_file).unwrap();
        assert_eq!(content, "original content");

        manager.cleanup();
    }

    #[test]
    fn test_rewind_nonexistent_snapshot() {
        let manager = FileHistoryManager::new("test-nonexistent");
        let result = manager.rewind_to_message("nonexistent", false);
        assert!(!result.success);
        assert!(result.error.is_some());
        manager.cleanup();
    }

    #[test]
    fn test_disabled_manager() {
        let mut manager = FileHistoryManager::new("test-disabled");
        manager.set_enabled(false);
        assert!(!manager.is_enabled());

        manager.track_file("/tmp/test.rs");
        assert_eq!(manager.get_tracked_files_count(), 0);

        manager.create_snapshot("msg-1");
        assert_eq!(manager.get_snapshots_count(), 0);

        let result = manager.rewind_to_message("msg-1", false);
        assert!(!result.success);

        manager.cleanup();
    }

    #[test]
    fn test_remove_snapshots_after() {
        let mut manager = FileHistoryManager::new("test-remove");

        manager.create_snapshot("msg-1");
        manager.create_snapshot("msg-2");
        manager.create_snapshot("msg-3");
        assert_eq!(manager.get_snapshots_count(), 3);

        let removed = manager.remove_snapshots_after("msg-1");
        assert_eq!(removed, 2);
        assert_eq!(manager.get_snapshots_count(), 1);
        assert!(manager.has_snapshot("msg-1"));
        assert!(!manager.has_snapshot("msg-2"));

        manager.cleanup();
    }

    #[test]
    fn test_compute_hash() {
        let manager = FileHistoryManager::new("test-hash");
        let hash1 = manager.compute_hash(b"hello");
        let hash2 = manager.compute_hash(b"hello");
        let hash3 = manager.compute_hash(b"world");

        assert_eq!(hash1, hash2);
        assert_ne!(hash1, hash3);
        assert_eq!(hash1.len(), 64); // SHA256 hex

        manager.cleanup();
    }
}
