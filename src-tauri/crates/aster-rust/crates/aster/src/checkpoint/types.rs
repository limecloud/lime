//! 检查点系统类型定义
//!
//! 包含文件检查点、会话、搜索选项等核心类型

use serde::{Deserialize, Serialize};

/// 文件检查点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileCheckpoint {
    /// 文件路径
    pub path: String,
    /// 完整内容（首次检查点）
    pub content: Option<String>,
    /// 增量 diff（后续检查点）
    pub diff: Option<String>,
    /// 内容哈希
    pub hash: String,
    /// 时间戳
    pub timestamp: i64,
    /// 用户定义名称
    pub name: Option<String>,
    /// 用户定义描述
    pub description: Option<String>,
    /// 关联的 git commit SHA
    pub git_commit: Option<String>,
    /// 自上次检查点以来的编辑次数
    pub edit_count: Option<u32>,
    /// 内容是否已压缩
    pub compressed: Option<bool>,
    /// 文件元数据
    pub metadata: Option<FileMetadata>,
    /// 用户定义标签
    pub tags: Option<Vec<String>>,
}

/// 文件元数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileMetadata {
    pub mode: Option<u32>,
    pub uid: Option<u32>,
    pub gid: Option<u32>,
    pub size: Option<u64>,
}

/// 检查点搜索选项
#[derive(Debug, Clone, Default)]
pub struct CheckpointSearchOptions {
    pub file_path: Option<String>,
    pub time_range: Option<TimeRange>,
    pub tags: Option<Vec<String>>,
    pub git_commit: Option<String>,
    pub name_pattern: Option<String>,
    pub limit: Option<usize>,
}

/// 时间范围
#[derive(Debug, Clone)]
pub struct TimeRange {
    pub start: i64,
    pub end: i64,
}

/// 检查点恢复选项
#[derive(Debug, Clone, Default)]
pub struct CheckpointRestoreOptions {
    pub create_backup: Option<bool>,
    pub dry_run: Option<bool>,
    pub preserve_metadata: Option<bool>,
}

/// 检查点统计信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckpointStats {
    pub total_checkpoints: usize,
    pub total_files: usize,
    pub total_size: u64,
    pub oldest_checkpoint: Option<i64>,
    pub newest_checkpoint: Option<i64>,
    pub compression_ratio: Option<f64>,
}

/// 检查点历史记录项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckpointHistoryItem {
    pub index: usize,
    pub timestamp: i64,
    pub hash: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub git_commit: Option<String>,
    pub tags: Option<Vec<String>>,
    pub size: Option<u64>,
    pub compressed: Option<bool>,
    pub current: bool,
}

/// 检查点历史
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckpointHistory {
    pub checkpoints: Vec<CheckpointHistoryItem>,
    pub current_index: i32,
}

/// 检查点 diff 结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckpointDiff {
    pub added: usize,
    pub removed: usize,
    pub modified: usize,
    pub diff_text: String,
}

/// 操作结果
#[derive(Debug, Clone)]
pub struct CheckpointResult {
    pub success: bool,
    pub message: String,
    pub content: Option<String>,
}

impl CheckpointResult {
    pub fn ok(message: impl Into<String>) -> Self {
        Self {
            success: true,
            message: message.into(),
            content: None,
        }
    }

    pub fn ok_with_content(message: impl Into<String>, content: String) -> Self {
        Self {
            success: true,
            message: message.into(),
            content: Some(content),
        }
    }

    pub fn err(message: impl Into<String>) -> Self {
        Self {
            success: false,
            message: message.into(),
            content: None,
        }
    }
}

/// 会话元数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMetadata {
    pub git_branch: Option<String>,
    pub git_commit: Option<String>,
    pub tags: Option<Vec<String>>,
    pub total_size: Option<u64>,
}

/// 会话信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub start_time: i64,
    pub working_directory: String,
    pub file_count: usize,
    pub total_size: u64,
}

/// 常量配置
pub const MAX_CHECKPOINTS_PER_FILE: usize = 100;
pub const CHECKPOINT_RETENTION_DAYS: u64 = 30;
pub const DEFAULT_AUTO_CHECKPOINT_INTERVAL: u32 = 5;
pub const MAX_STORAGE_SIZE_MB: u64 = 500;
pub const COMPRESSION_THRESHOLD_BYTES: usize = 1024;
