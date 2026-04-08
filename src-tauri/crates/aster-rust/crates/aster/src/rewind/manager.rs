//! Rewind 管理器
//!
//! 协调文件历史和对话状态的回退

use super::file_history::{FileHistoryManager, RewindResult};
use serde::{Deserialize, Serialize};

/// Rewind 选项
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RewindOption {
    Code,
    Conversation,
    Both,
    Nevermind,
}

/// 可回退的消息信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RewindableMessage {
    pub uuid: String,
    pub index: usize,
    pub preview: String,
    pub timestamp: Option<i64>,
    pub has_file_changes: bool,
}

/// Rewind 操作结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RewindOperationResult {
    pub success: bool,
    pub option: RewindOption,
    pub code_result: Option<RewindResult>,
    pub conversation_result: Option<ConversationRewindResult>,
    pub error: Option<String>,
}

/// 对话回退结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationRewindResult {
    pub messages_removed: i32,
    pub new_message_count: usize,
}

/// Rewind 管理器
pub struct RewindManager {
    file_history: FileHistoryManager,
    message_count: usize,
}

impl RewindManager {
    /// 创建新的 Rewind 管理器
    pub fn new(session_id: impl Into<String>) -> Self {
        Self {
            file_history: FileHistoryManager::new(session_id),
            message_count: 0,
        }
    }

    /// 获取文件历史管理器
    pub fn get_file_history_manager(&self) -> &FileHistoryManager {
        &self.file_history
    }

    /// 获取可变文件历史管理器
    pub fn get_file_history_manager_mut(&mut self) -> &mut FileHistoryManager {
        &mut self.file_history
    }

    /// 记录用户消息（创建快照点）
    pub fn record_user_message(&mut self, message_id: impl Into<String>) {
        self.file_history.create_snapshot(message_id);
        self.message_count += 1;
    }

    /// 记录文件修改
    pub fn record_file_change(&mut self, file_path: impl AsRef<std::path::Path>) {
        self.file_history
            .backup_file_before_change(file_path.as_ref());
        self.file_history.track_file(file_path);
    }

    /// 执行回退操作
    pub fn rewind(&mut self, message_id: &str, option: RewindOption) -> RewindOperationResult {
        if option == RewindOption::Nevermind {
            return RewindOperationResult {
                success: true,
                option,
                code_result: None,
                conversation_result: None,
                error: None,
            };
        }

        let mut result = RewindOperationResult {
            success: true,
            option,
            code_result: None,
            conversation_result: None,
            error: None,
        };

        // 回退代码
        if option == RewindOption::Code || option == RewindOption::Both {
            let code_result = self.file_history.rewind_to_message(message_id, false);
            if !code_result.success {
                result.success = false;
                result.error = code_result.error.clone();
            }
            result.code_result = Some(code_result);
        }

        // 回退对话（简化实现，实际需要与消息存储集成）
        if option == RewindOption::Conversation || option == RewindOption::Both {
            result.conversation_result = Some(ConversationRewindResult {
                messages_removed: 0,
                new_message_count: self.message_count,
            });
        }

        result
    }

    /// 预览回退操作
    pub fn preview_rewind(&self, message_id: &str, option: RewindOption) -> RewindPreview {
        let mut preview = RewindPreview::default();

        if option == RewindOption::Code || option == RewindOption::Both {
            let result = self.file_history.rewind_to_message(message_id, true);
            preview.files_will_change = result.files_changed;
            preview.insertions = result.insertions;
            preview.deletions = result.deletions;
        }

        preview
    }

    /// 获取可回退的消息列表
    pub fn get_rewindable_messages(&self) -> Vec<RewindableMessage> {
        self.file_history
            .get_snapshots()
            .iter()
            .enumerate()
            .map(|(index, snapshot)| RewindableMessage {
                uuid: snapshot.message_id.clone(),
                index,
                preview: format!("快照 #{}", index + 1),
                timestamp: Some(snapshot.timestamp),
                has_file_changes: !snapshot.tracked_file_backups.is_empty(),
            })
            .collect()
    }

    /// 获取最后一个可回退点
    pub fn get_last_rewind_point(&self) -> Option<RewindableMessage> {
        self.get_rewindable_messages().pop()
    }

    /// 检查是否可以回退
    pub fn can_rewind(&self) -> bool {
        self.file_history.get_snapshots_count() > 0
    }

    /// 清理
    pub fn cleanup(&self) {
        self.file_history.cleanup();
    }
}

/// 回退预览
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RewindPreview {
    pub files_will_change: Vec<String>,
    pub messages_will_remove: usize,
    pub insertions: u32,
    pub deletions: u32,
}

// ============ 全局实例管理 ============

use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

/// 全局 RewindManager 缓存
static MANAGERS: Lazy<RwLock<HashMap<String, Arc<RwLock<RewindManager>>>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

/// 获取或创建 Rewind 管理器
pub fn get_rewind_manager(session_id: &str) -> Arc<RwLock<RewindManager>> {
    let mut managers = MANAGERS.write().unwrap();

    if let Some(manager) = managers.get(session_id) {
        return Arc::clone(manager);
    }

    let manager = Arc::new(RwLock::new(RewindManager::new(session_id)));
    managers.insert(session_id.to_string(), Arc::clone(&manager));
    manager
}

/// 清理指定会话的 Rewind 管理器
pub fn cleanup_rewind_manager(session_id: &str) {
    let mut managers = MANAGERS.write().unwrap();

    if let Some(manager) = managers.remove(session_id) {
        if let Ok(m) = manager.read() {
            m.cleanup();
        }
    }
}

/// 清理所有 Rewind 管理器
pub fn cleanup_all_rewind_managers() {
    let mut managers = MANAGERS.write().unwrap();

    for (_, manager) in managers.drain() {
        if let Ok(m) = manager.read() {
            m.cleanup();
        }
    }
}

// ============ 增强功能 ============

impl RewindManager {
    /// 获取会话 ID
    pub fn session_id(&self) -> &str {
        self.file_history.session_id()
    }

    /// 获取消息数量
    pub fn message_count(&self) -> usize {
        self.message_count
    }

    /// 获取被跟踪的文件数量
    pub fn tracked_files_count(&self) -> usize {
        self.file_history.get_tracked_files_count()
    }

    /// 获取快照数量
    pub fn snapshots_count(&self) -> usize {
        self.file_history.get_snapshots_count()
    }

    /// 检查是否有指定消息的快照
    pub fn has_snapshot(&self, message_id: &str) -> bool {
        self.file_history.has_snapshot(message_id)
    }

    /// 获取备份目录大小
    pub fn backup_size(&self) -> u64 {
        self.file_history.get_backup_size()
    }

    /// 批量记录文件修改
    pub fn record_file_changes(&mut self, file_paths: &[impl AsRef<std::path::Path>]) {
        for path in file_paths {
            self.record_file_change(path);
        }
    }

    /// 回退到最后一个快照点
    pub fn rewind_to_last(&mut self, option: RewindOption) -> RewindOperationResult {
        match self.get_last_rewind_point() {
            Some(msg) => self.rewind(&msg.uuid, option),
            None => RewindOperationResult {
                success: false,
                option,
                code_result: None,
                conversation_result: None,
                error: Some("没有可回退的快照".to_string()),
            },
        }
    }

    /// 获取指定消息的快照详情
    pub fn get_snapshot_details(&self, message_id: &str) -> Option<SnapshotDetails> {
        let snapshot = self.file_history.get_snapshot(message_id)?;
        Some(SnapshotDetails {
            message_id: snapshot.message_id.clone(),
            timestamp: snapshot.timestamp,
            files_count: snapshot.tracked_file_backups.len(),
            files: snapshot.tracked_file_backups.keys().cloned().collect(),
        })
    }
}

/// 快照详情
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotDetails {
    pub message_id: String,
    pub timestamp: i64,
    pub files_count: usize,
    pub files: Vec<String>,
}

// ============ 单元测试 ============

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;
    use tempfile::TempDir;

    fn create_test_file(dir: &std::path::Path, name: &str, content: &str) -> std::path::PathBuf {
        let path = dir.join(name);
        let mut file = fs::File::create(&path).unwrap();
        file.write_all(content.as_bytes()).unwrap();
        path
    }

    #[test]
    fn test_new_manager() {
        let manager = RewindManager::new("test-session");
        assert_eq!(manager.session_id(), "test-session");
        assert_eq!(manager.message_count(), 0);
        assert!(!manager.can_rewind());
        manager.cleanup();
    }

    #[test]
    fn test_record_user_message() {
        let mut manager = RewindManager::new("test-msg");
        manager.record_user_message("msg-1");
        assert_eq!(manager.message_count(), 1);
        assert_eq!(manager.snapshots_count(), 1);
        assert!(manager.has_snapshot("msg-1"));
        assert!(manager.can_rewind());
        manager.cleanup();
    }

    #[test]
    fn test_record_file_change() {
        let temp_dir = TempDir::new().unwrap();
        let test_file = create_test_file(temp_dir.path(), "test.txt", "content");

        let mut manager = RewindManager::new("test-file");
        manager.record_file_change(&test_file);
        assert_eq!(manager.tracked_files_count(), 1);
        manager.cleanup();
    }

    #[test]
    fn test_rewindable_messages() {
        let mut manager = RewindManager::new("test-rewindable");
        manager.record_user_message("msg-1");
        manager.record_user_message("msg-2");

        let messages = manager.get_rewindable_messages();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].uuid, "msg-1");
        assert_eq!(messages[1].uuid, "msg-2");

        let last = manager.get_last_rewind_point();
        assert!(last.is_some());
        assert_eq!(last.unwrap().uuid, "msg-2");

        manager.cleanup();
    }

    #[test]
    fn test_rewind_nevermind() {
        let mut manager = RewindManager::new("test-nevermind");
        manager.record_user_message("msg-1");

        let result = manager.rewind("msg-1", RewindOption::Nevermind);
        assert!(result.success);
        assert_eq!(result.option, RewindOption::Nevermind);
        assert!(result.code_result.is_none());

        manager.cleanup();
    }

    #[test]
    fn test_rewind_code() {
        let temp_dir = TempDir::new().unwrap();
        let test_file = create_test_file(temp_dir.path(), "test.txt", "original");

        let mut manager = RewindManager::new("test-rewind-code");
        manager.record_file_change(&test_file);
        manager.record_user_message("msg-1");

        // 修改文件
        fs::write(&test_file, "modified").unwrap();

        // 回退代码
        let result = manager.rewind("msg-1", RewindOption::Code);
        assert!(result.success);
        assert!(result.code_result.is_some());

        // 验证文件恢复
        let content = fs::read_to_string(&test_file).unwrap();
        assert_eq!(content, "original");

        manager.cleanup();
    }

    #[test]
    fn test_preview_rewind() {
        let temp_dir = TempDir::new().unwrap();
        let test_file = create_test_file(temp_dir.path(), "test.txt", "line1\nline2\n");

        let mut manager = RewindManager::new("test-preview");
        manager.record_file_change(&test_file);
        manager.record_user_message("msg-1");

        // 修改文件
        fs::write(&test_file, "line1\nline2\nline3\n").unwrap();

        let preview = manager.preview_rewind("msg-1", RewindOption::Code);
        assert!(!preview.files_will_change.is_empty());

        // 文件应该没有变化（预览模式）
        let content = fs::read_to_string(&test_file).unwrap();
        assert_eq!(content, "line1\nline2\nline3\n");

        manager.cleanup();
    }

    #[test]
    fn test_rewind_to_last() {
        let mut manager = RewindManager::new("test-last");

        // 没有快照时回退
        let result = manager.rewind_to_last(RewindOption::Code);
        assert!(!result.success);

        // 有快照时回退
        manager.record_user_message("msg-1");
        let result = manager.rewind_to_last(RewindOption::Code);
        assert!(result.success);

        manager.cleanup();
    }

    #[test]
    fn test_snapshot_details() {
        let temp_dir = TempDir::new().unwrap();
        let test_file = create_test_file(temp_dir.path(), "test.txt", "content");

        let mut manager = RewindManager::new("test-details");
        manager.record_file_change(&test_file);
        manager.record_user_message("msg-1");

        let details = manager.get_snapshot_details("msg-1");
        assert!(details.is_some());
        let details = details.unwrap();
        assert_eq!(details.message_id, "msg-1");
        assert_eq!(details.files_count, 1);

        manager.cleanup();
    }

    #[test]
    fn test_global_manager() {
        let manager1 = get_rewind_manager("global-test");
        let manager2 = get_rewind_manager("global-test");

        // 应该是同一个实例
        assert!(Arc::ptr_eq(&manager1, &manager2));

        cleanup_rewind_manager("global-test");
    }

    #[test]
    fn test_batch_file_changes() {
        let temp_dir = TempDir::new().unwrap();
        let file1 = create_test_file(temp_dir.path(), "a.txt", "a");
        let file2 = create_test_file(temp_dir.path(), "b.txt", "b");

        let mut manager = RewindManager::new("test-batch");
        manager.record_file_changes(&[&file1, &file2]);
        assert_eq!(manager.tracked_files_count(), 2);

        manager.cleanup();
    }
}
