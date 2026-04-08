//! 检查点存储管理
//!
//! 负责检查点的磁盘存储、加载和清理

use std::path::PathBuf;
use tokio::fs;

use super::session::CheckpointSession;
use super::types::*;

/// 检查点存储
pub struct CheckpointStorage {
    checkpoint_dir: PathBuf,
}

impl CheckpointStorage {
    /// 创建新的存储管理器
    pub fn new() -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        Self {
            checkpoint_dir: home.join(".aster").join("checkpoints"),
        }
    }

    /// 确保检查点目录存在
    pub async fn ensure_checkpoint_dir(&self) -> Result<(), String> {
        if !self.checkpoint_dir.exists() {
            fs::create_dir_all(&self.checkpoint_dir)
                .await
                .map_err(|e| format!("Failed to create checkpoint directory: {}", e))?;
        }
        Ok(())
    }

    /// 获取会话目录
    fn get_session_dir(&self, session_id: &str) -> PathBuf {
        self.checkpoint_dir.join(session_id)
    }

    /// 保存检查点到磁盘
    pub async fn save_checkpoint(
        &self,
        session_id: &str,
        checkpoint: &FileCheckpoint,
    ) -> Result<(), String> {
        let session_dir = self.get_session_dir(session_id);
        if !session_dir.exists() {
            fs::create_dir_all(&session_dir)
                .await
                .map_err(|e| format!("Failed to create session directory: {}", e))?;
        }

        let file_hash = self.get_path_hash(&checkpoint.path);
        let checkpoint_file =
            session_dir.join(format!("{}-{}.json", file_hash, checkpoint.timestamp));

        let data = serde_json::to_string_pretty(checkpoint)
            .map_err(|e| format!("Failed to serialize checkpoint: {}", e))?;

        fs::write(&checkpoint_file, data)
            .await
            .map_err(|e| format!("Failed to write checkpoint file: {}", e))?;

        Ok(())
    }

    /// 加载会话
    pub async fn load_session(&self, session_id: &str) -> Result<CheckpointSession, String> {
        let session_dir = self.get_session_dir(session_id);
        if !session_dir.exists() {
            return Err("Session not found".to_string());
        }

        let mut session = CheckpointSession::new(
            Some(session_id.to_string()),
            ".".to_string(),
            DEFAULT_AUTO_CHECKPOINT_INTERVAL,
        );

        let mut entries = fs::read_dir(&session_dir)
            .await
            .map_err(|e| format!("Failed to read session directory: {}", e))?;

        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "json") {
                if path.file_name().is_some_and(|n| n == "session.json") {
                    continue;
                }

                if let Ok(data) = fs::read_to_string(&path).await {
                    if let Ok(checkpoint) = serde_json::from_str::<FileCheckpoint>(&data) {
                        session
                            .checkpoints
                            .entry(checkpoint.path.clone())
                            .or_default()
                            .push(checkpoint);
                    }
                }
            }
        }

        // 按时间戳排序
        for checkpoints in session.checkpoints.values_mut() {
            checkpoints.sort_by_key(|c| c.timestamp);
        }

        // 更新索引
        for (path, checkpoints) in &session.checkpoints {
            session
                .current_index
                .insert(path.clone(), checkpoints.len().saturating_sub(1));
        }

        Ok(session)
    }

    /// 清理旧检查点
    pub async fn cleanup_old_checkpoints(&self) {
        let cutoff_time = chrono::Utc::now().timestamp_millis()
            - (CHECKPOINT_RETENTION_DAYS as i64 * 24 * 60 * 60 * 1000);

        if let Ok(mut entries) = fs::read_dir(&self.checkpoint_dir).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                if path.is_dir() {
                    if let Ok(metadata) = fs::metadata(&path).await {
                        if let Ok(modified) = metadata.modified() {
                            let modified_ms = modified
                                .duration_since(std::time::UNIX_EPOCH)
                                .map(|d| d.as_millis() as i64)
                                .unwrap_or(0);

                            if modified_ms < cutoff_time {
                                let _ = fs::remove_dir_all(&path).await;
                            }
                        }
                    }
                }
            }
        }
    }

    /// 压缩内容（简化实现，使用 base64 编码）
    pub fn compress_content(&self, content: &str) -> String {
        use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
        BASE64.encode(content.as_bytes())
    }

    /// 解压缩内容
    pub fn decompress_content(&self, compressed: &str) -> String {
        use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
        if let Ok(data) = BASE64.decode(compressed) {
            if let Ok(s) = String::from_utf8(data) {
                return s;
            }
        }
        compressed.to_string()
    }

    /// 获取路径哈希
    fn get_path_hash(&self, path: &str) -> String {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(path.as_bytes());
        let result = hasher.finalize();
        hex::encode(&result[..8])
    }
}

impl Default for CheckpointStorage {
    fn default() -> Self {
        Self::new()
    }
}
