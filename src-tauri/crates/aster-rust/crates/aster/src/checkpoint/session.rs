//! 检查点会话管理
//!
//! 管理检查点会话的创建、加载和保存

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use super::diff::DiffEngine;
use super::storage::CheckpointStorage;
use super::types::*;

/// 检查点会话
pub struct CheckpointSession {
    pub id: String,
    pub start_time: i64,
    pub working_directory: String,
    pub checkpoints: HashMap<String, Vec<FileCheckpoint>>,
    pub current_index: HashMap<String, usize>,
    pub edit_counts: HashMap<String, u32>,
    pub auto_checkpoint_interval: u32,
    pub metadata: Option<SessionMetadata>,
}

impl CheckpointSession {
    /// 创建新会话
    pub fn new(
        id: Option<String>,
        working_directory: String,
        auto_checkpoint_interval: u32,
    ) -> Self {
        let session_id = id.unwrap_or_else(generate_session_id);

        Self {
            id: session_id,
            start_time: chrono::Utc::now().timestamp_millis(),
            working_directory,
            checkpoints: HashMap::new(),
            current_index: HashMap::new(),
            edit_counts: HashMap::new(),
            auto_checkpoint_interval,
            metadata: Some(SessionMetadata {
                git_branch: get_git_branch(),
                git_commit: get_git_commit(),
                tags: None,
                total_size: Some(0),
            }),
        }
    }

    /// 获取文件的检查点列表
    pub fn get_checkpoints(&self, file_path: &str) -> Option<&Vec<FileCheckpoint>> {
        self.checkpoints.get(file_path)
    }

    /// 获取文件的当前检查点索引
    pub fn get_current_index(&self, file_path: &str) -> Option<usize> {
        self.current_index.get(file_path).copied()
    }
}

/// 检查点管理器
pub struct CheckpointManager {
    session: Arc<RwLock<Option<CheckpointSession>>>,
    storage: CheckpointStorage,
    diff_engine: DiffEngine,
}

impl CheckpointManager {
    /// 创建新的检查点管理器
    pub fn new() -> Self {
        Self {
            session: Arc::new(RwLock::new(None)),
            storage: CheckpointStorage::new(),
            diff_engine: DiffEngine::new(),
        }
    }

    /// 初始化检查点系统
    pub async fn init(
        &self,
        session_id: Option<String>,
        auto_checkpoint_interval: u32,
    ) -> Result<(), String> {
        self.storage.ensure_checkpoint_dir().await?;

        let working_dir = std::env::current_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| ".".to_string());

        let session =
            CheckpointSession::new(session_id.clone(), working_dir, auto_checkpoint_interval);

        // 如果有 session_id，尝试加载现有会话
        if let Some(ref id) = session_id {
            if let Ok(loaded) = self.storage.load_session(id).await {
                *self.session.write().await = Some(loaded);
                return Ok(());
            }
        }

        *self.session.write().await = Some(session);

        // 清理旧检查点
        self.storage.cleanup_old_checkpoints().await;

        Ok(())
    }

    /// 创建检查点
    pub async fn create_checkpoint(
        &self,
        file_path: &str,
        options: Option<CreateCheckpointOptions>,
    ) -> Option<FileCheckpoint> {
        let mut session_guard = self.session.write().await;
        let session = session_guard.as_mut()?;

        let absolute_path = std::path::Path::new(file_path)
            .canonicalize()
            .ok()?
            .to_string_lossy()
            .to_string();

        // 读取文件内容
        let content = tokio::fs::read_to_string(&absolute_path).await.ok()?;
        let hash = get_content_hash(&content);

        // 检查内容是否与上次检查点相同
        let existing = session.checkpoints.get(&absolute_path);
        if let Some(checkpoints) = existing {
            if let Some(last) = checkpoints.last() {
                if last.hash == hash {
                    return Some(last.clone());
                }
            }
        }

        let opts = options.unwrap_or_default();
        let edit_count = session
            .edit_counts
            .get(&absolute_path)
            .copied()
            .unwrap_or(0);

        // 决定使用完整内容还是 diff
        let use_full_content =
            existing.is_none_or(|c| c.is_empty()) || opts.force_full_content.unwrap_or(false);

        let (checkpoint_content, checkpoint_diff, compressed) = if use_full_content {
            let (content_str, is_compressed) = if content.len() > COMPRESSION_THRESHOLD_BYTES {
                (self.storage.compress_content(&content), true)
            } else {
                (content.clone(), false)
            };
            (Some(content_str), None, is_compressed)
        } else {
            let last_content = self.reconstruct_content_internal(session, &absolute_path, None)?;
            let diff = self.diff_engine.calculate_diff(&last_content, &content);
            (None, Some(diff), false)
        };

        let metadata = tokio::fs::metadata(&absolute_path)
            .await
            .ok()
            .map(|m| FileMetadata {
                mode: None,
                uid: None,
                gid: None,
                size: Some(m.len()),
            });

        let checkpoint = FileCheckpoint {
            path: absolute_path.clone(),
            content: checkpoint_content,
            diff: checkpoint_diff,
            hash,
            timestamp: chrono::Utc::now().timestamp_millis(),
            name: opts.name,
            description: opts.description,
            git_commit: get_git_commit(),
            edit_count: Some(edit_count),
            compressed: Some(compressed),
            metadata,
            tags: opts.tags,
        };

        // 添加到会话
        session
            .checkpoints
            .entry(absolute_path.clone())
            .or_insert_with(Vec::new)
            .push(checkpoint.clone());

        // 限制检查点数量
        if let Some(checkpoints) = session.checkpoints.get_mut(&absolute_path) {
            if checkpoints.len() > MAX_CHECKPOINTS_PER_FILE {
                let to_remove = checkpoints.len() - MAX_CHECKPOINTS_PER_FILE;
                checkpoints.drain(1..=to_remove);
            }
        }

        // 更新索引
        let len = session
            .checkpoints
            .get(&absolute_path)
            .map_or(0, |c| c.len());
        session
            .current_index
            .insert(absolute_path.clone(), len.saturating_sub(1));
        session.edit_counts.insert(absolute_path, 0);

        // 保存到磁盘
        let _ = self.storage.save_checkpoint(&session.id, &checkpoint).await;

        Some(checkpoint)
    }

    /// 跟踪文件编辑
    pub async fn track_file_edit(&self, file_path: &str) {
        let should_checkpoint = {
            let mut session_guard = self.session.write().await;
            if let Some(session) = session_guard.as_mut() {
                let absolute_path = std::path::Path::new(file_path)
                    .canonicalize()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|_| file_path.to_string());

                let edit_count = session
                    .edit_counts
                    .entry(absolute_path.clone())
                    .or_insert(0);
                *edit_count += 1;

                // 检查是否需要自动检查点
                if *edit_count >= session.auto_checkpoint_interval {
                    Some((absolute_path, *edit_count))
                } else {
                    None
                }
            } else {
                None
            }
        };

        // 在锁释放后创建检查点
        if let Some((absolute_path, edit_count)) = should_checkpoint {
            self.create_checkpoint(
                &absolute_path,
                Some(CreateCheckpointOptions {
                    name: Some(format!("Auto-checkpoint at {} edits", edit_count)),
                    ..Default::default()
                }),
            )
            .await;
        }
    }

    /// 恢复检查点
    pub async fn restore_checkpoint(
        &self,
        file_path: &str,
        index: Option<usize>,
        options: Option<CheckpointRestoreOptions>,
    ) -> CheckpointResult {
        let absolute_path = std::path::Path::new(file_path)
            .canonicalize()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| file_path.to_string());

        let opts = options.unwrap_or_default();

        // 第一阶段：读取并重建内容
        let (content, checkpoint_name, should_backup) = {
            let session_guard = self.session.read().await;
            let session = match session_guard.as_ref() {
                Some(s) => s,
                None => return CheckpointResult::err("No active checkpoint session"),
            };

            let checkpoints = match session.checkpoints.get(&absolute_path) {
                Some(c) if !c.is_empty() => c,
                _ => return CheckpointResult::err("No checkpoints found for this file"),
            };

            let target_index = index.unwrap_or_else(|| {
                session
                    .current_index
                    .get(&absolute_path)
                    .copied()
                    .unwrap_or(checkpoints.len() - 1)
            });

            if target_index >= checkpoints.len() {
                return CheckpointResult::err("Invalid checkpoint index");
            }

            let content = match self.reconstruct_content_internal(
                session,
                &absolute_path,
                Some(target_index),
            ) {
                Some(c) => c,
                None => return CheckpointResult::err("Failed to reconstruct content"),
            };

            // Dry run 模式
            if opts.dry_run.unwrap_or(false) {
                return CheckpointResult::ok_with_content("Dry run successful", content);
            }

            let checkpoint = &checkpoints[target_index];
            let name = checkpoint.name.clone().unwrap_or_else(|| {
                format!(
                    "checkpoint from {}",
                    chrono::DateTime::from_timestamp_millis(checkpoint.timestamp)
                        .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
                        .unwrap_or_else(|| "unknown".to_string())
                )
            });

            (content, name, opts.create_backup.unwrap_or(true))
        };

        // 第二阶段：创建备份（锁已释放）
        if should_backup {
            self.create_checkpoint(
                &absolute_path,
                Some(CreateCheckpointOptions {
                    name: Some("Pre-restore backup".to_string()),
                    ..Default::default()
                }),
            )
            .await;
        }

        // 第三阶段：恢复内容
        if let Err(e) = tokio::fs::write(&absolute_path, &content).await {
            return CheckpointResult::err(format!("Failed to restore: {}", e));
        }

        CheckpointResult::ok(format!("Restored to: {}", checkpoint_name))
    }

    /// 内部重建内容方法
    fn reconstruct_content_internal(
        &self,
        session: &CheckpointSession,
        file_path: &str,
        index: Option<usize>,
    ) -> Option<String> {
        let checkpoints = session.checkpoints.get(file_path)?;
        let target_index = index.unwrap_or(checkpoints.len().saturating_sub(1));

        if target_index >= checkpoints.len() {
            return None;
        }

        // 找到最近的完整内容检查点
        let mut base_index = target_index;
        while base_index > 0 && checkpoints[base_index].content.is_none() {
            base_index -= 1;
        }

        let base_checkpoint = &checkpoints[base_index];
        let mut content = base_checkpoint.content.clone()?;

        // 解压缩
        if base_checkpoint.compressed.unwrap_or(false) {
            content = self.storage.decompress_content(&content);
        }

        // 应用 diff
        for checkpoint in checkpoints
            .iter()
            .take(target_index + 1)
            .skip(base_index + 1)
        {
            if let Some(ref diff) = checkpoint.diff {
                content = self.diff_engine.apply_diff(&content, diff);
            } else if let Some(ref c) = checkpoint.content {
                content = if checkpoint.compressed.unwrap_or(false) {
                    self.storage.decompress_content(c)
                } else {
                    c.clone()
                };
            }
        }

        Some(content)
    }

    /// Undo - 回到上一个检查点
    pub async fn undo(&self, file_path: &str) -> CheckpointResult {
        let session_guard = self.session.read().await;
        let session = match session_guard.as_ref() {
            Some(s) => s,
            None => return CheckpointResult::err("No active checkpoint session"),
        };

        let absolute_path = std::path::Path::new(file_path)
            .canonicalize()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| file_path.to_string());

        let current_index = session
            .current_index
            .get(&absolute_path)
            .copied()
            .unwrap_or(0);
        if current_index == 0 {
            return CheckpointResult::err("Already at oldest checkpoint");
        }

        drop(session_guard);
        self.restore_checkpoint(&absolute_path, Some(current_index - 1), None)
            .await
    }

    /// Redo - 前进到下一个检查点
    pub async fn redo(&self, file_path: &str) -> CheckpointResult {
        let session_guard = self.session.read().await;
        let session = match session_guard.as_ref() {
            Some(s) => s,
            None => return CheckpointResult::err("No active checkpoint session"),
        };

        let absolute_path = std::path::Path::new(file_path)
            .canonicalize()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| file_path.to_string());

        let checkpoints = match session.checkpoints.get(&absolute_path) {
            Some(c) => c,
            None => return CheckpointResult::err("No checkpoints available"),
        };

        let current_index = session
            .current_index
            .get(&absolute_path)
            .copied()
            .unwrap_or(0);
        if current_index >= checkpoints.len() - 1 {
            return CheckpointResult::err("Already at newest checkpoint");
        }

        drop(session_guard);
        self.restore_checkpoint(&absolute_path, Some(current_index + 1), None)
            .await
    }

    /// 获取检查点历史
    pub async fn get_checkpoint_history(&self, file_path: &str) -> CheckpointHistory {
        let session_guard = self.session.read().await;
        let session = match session_guard.as_ref() {
            Some(s) => s,
            None => {
                return CheckpointHistory {
                    checkpoints: vec![],
                    current_index: -1,
                }
            }
        };

        let absolute_path = std::path::Path::new(file_path)
            .canonicalize()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| file_path.to_string());

        let checkpoints = session.checkpoints.get(&absolute_path);
        let current_index = session
            .current_index
            .get(&absolute_path)
            .copied()
            .unwrap_or(0);

        let items = checkpoints.map_or(vec![], |cps| {
            cps.iter()
                .enumerate()
                .map(|(idx, cp)| CheckpointHistoryItem {
                    index: idx,
                    timestamp: cp.timestamp,
                    hash: cp.hash.clone(),
                    name: cp.name.clone(),
                    description: cp.description.clone(),
                    git_commit: cp.git_commit.clone(),
                    tags: cp.tags.clone(),
                    size: cp.metadata.as_ref().and_then(|m| m.size),
                    compressed: cp.compressed,
                    current: idx == current_index,
                })
                .collect()
        });

        CheckpointHistory {
            checkpoints: items,
            current_index: current_index as i32,
        }
    }

    /// 获取统计信息
    pub async fn get_stats(&self) -> CheckpointStats {
        let session_guard = self.session.read().await;
        let session = match session_guard.as_ref() {
            Some(s) => s,
            None => {
                return CheckpointStats {
                    total_checkpoints: 0,
                    total_files: 0,
                    total_size: 0,
                    oldest_checkpoint: None,
                    newest_checkpoint: None,
                    compression_ratio: None,
                }
            }
        };

        let mut total_checkpoints = 0;
        let mut oldest: Option<i64> = None;
        let mut newest: Option<i64> = None;

        for checkpoints in session.checkpoints.values() {
            total_checkpoints += checkpoints.len();
            for cp in checkpoints {
                oldest = Some(oldest.map_or(cp.timestamp, |o| o.min(cp.timestamp)));
                newest = Some(newest.map_or(cp.timestamp, |n| n.max(cp.timestamp)));
            }
        }

        CheckpointStats {
            total_checkpoints,
            total_files: session.checkpoints.len(),
            total_size: session
                .metadata
                .as_ref()
                .and_then(|m| m.total_size)
                .unwrap_or(0),
            oldest_checkpoint: oldest,
            newest_checkpoint: newest,
            compression_ratio: None,
        }
    }

    /// 结束会话
    pub async fn end_session(&self) {
        *self.session.write().await = None;
    }
}

/// 创建检查点选项
#[derive(Debug, Clone, Default)]
pub struct CreateCheckpointOptions {
    pub name: Option<String>,
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
    pub force_full_content: Option<bool>,
}

/// 生成会话 ID
fn generate_session_id() -> String {
    let uuid_str = uuid::Uuid::new_v4().to_string();
    format!(
        "{}-{}",
        chrono::Utc::now().timestamp_millis(),
        uuid_str.get(..8).unwrap_or(&uuid_str)
    )
}

/// 获取内容哈希
fn get_content_hash(content: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    let result = hasher.finalize();
    hex::encode(&result[..8])
}

/// 获取当前 git 分支
fn get_git_branch() -> Option<String> {
    std::process::Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout)
                    .ok()
                    .map(|s| s.trim().to_string())
            } else {
                None
            }
        })
}

/// 获取当前 git commit
fn get_git_commit() -> Option<String> {
    std::process::Command::new("git")
        .args(["rev-parse", "HEAD"])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout)
                    .ok()
                    .map(|s| s.trim().to_string())
            } else {
                None
            }
        })
}

impl Default for CheckpointManager {
    fn default() -> Self {
        Self::new()
    }
}
