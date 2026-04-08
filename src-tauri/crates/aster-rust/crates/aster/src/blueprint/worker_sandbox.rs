//! Worker 沙箱隔离机制
//!
//! 实现多 Worker 并发执行的隔离和同步：
//! - 文件系统隔离：每个 Worker 有独立的沙箱目录
//! - 文件锁机制：防止并发修改冲突
//! - 资源限制：控制 Worker 的资源使用
//!

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

// ============================================================================
// 类型定义
// ============================================================================

/// 沙箱配置
#[derive(Debug, Clone)]
pub struct SandboxConfig {
    /// Worker ID
    pub worker_id: String,
    /// 任务 ID
    pub task_id: String,
    /// 项目根目录
    pub base_dir: PathBuf,
    /// 沙箱目录（默认 ~/.aster/sandbox/{worker_id}）
    pub sandbox_dir: Option<PathBuf>,
}

/// 文件同步结果
#[derive(Debug, Clone, Default)]
pub struct SyncResult {
    /// 同步成功的文件
    pub success: Vec<String>,
    /// 同步失败的文件
    pub failed: Vec<SyncFailure>,
    /// 冲突的文件
    pub conflicts: Vec<SyncConflict>,
    /// 总计文件数
    pub total: usize,
}

/// 同步失败信息
#[derive(Debug, Clone)]
pub struct SyncFailure {
    pub file: String,
    pub error: String,
}

/// 同步冲突信息
#[derive(Debug, Clone)]
pub struct SyncConflict {
    pub file: String,
    pub reason: String,
}

/// 锁信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LockInfo {
    /// Worker ID
    pub worker_id: String,
    /// 进程 ID
    pub pid: u32,
    /// 文件路径
    pub file_path: String,
    /// 锁定时间戳
    pub timestamp: DateTime<Utc>,
    /// 超时时间（毫秒）
    pub timeout: u64,
}

/// 文件元数据
#[derive(Debug, Clone)]
#[allow(dead_code)]
struct FileMetadata {
    /// 文件路径（相对于 base_dir）
    relative_path: String,
    /// 文件内容 hash
    hash: String,
    /// 修改时间
    mtime: i64,
    /// 文件大小
    size: u64,
}

// ============================================================================
// 工具函数
// ============================================================================

/// 计算文件内容的 hash
fn compute_file_hash(file_path: &Path) -> Result<String, std::io::Error> {
    let content = fs::read(file_path)?;
    let mut hasher = Sha256::new();
    hasher.update(&content);
    Ok(format!("{:x}", hasher.finalize()))
}

/// 计算字符串的 hash（用于文件路径）
fn compute_string_hash(s: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(s.as_bytes());
    let hash = format!("{:x}", hasher.finalize());
    hash.get(..16).unwrap_or(&hash).to_string()
}

/// 递归复制目录
fn copy_directory_recursive(src: &Path, dest: &Path) -> Result<(), std::io::Error> {
    if !dest.exists() {
        fs::create_dir_all(dest)?;
    }

    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());

        if src_path.is_dir() {
            copy_directory_recursive(&src_path, &dest_path)?;
        } else {
            fs::copy(&src_path, &dest_path)?;
        }
    }

    Ok(())
}

/// 获取默认沙箱根目录
fn get_default_sandbox_root() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".aster")
        .join("sandbox")
}

// ============================================================================
// 文件锁管理器
// ============================================================================

/// 文件锁管理器
///
/// 使用文件系统实现分布式锁：
/// - 锁文件存储在 ~/.aster/sandbox/locks/
/// - 支持超时和死锁检测
pub struct FileLockManager {
    lock_dir: PathBuf,
    locks: Arc<RwLock<HashMap<String, LockInfo>>>,
    default_timeout: u64,
}

impl FileLockManager {
    /// 创建新的文件锁管理器
    pub fn new(lock_dir: Option<PathBuf>) -> Self {
        let lock_dir = lock_dir.unwrap_or_else(|| get_default_sandbox_root().join("locks"));

        // 确保锁目录存在
        let _ = fs::create_dir_all(&lock_dir);

        Self {
            lock_dir,
            locks: Arc::new(RwLock::new(HashMap::new())),
            default_timeout: 300000, // 5 分钟
        }
    }

    /// 获取锁文件路径
    fn get_lock_file_path(&self, file_path: &str) -> PathBuf {
        let hash = compute_string_hash(file_path);
        self.lock_dir.join(format!("{}.lock", hash))
    }

    /// 读取锁信息
    fn read_lock_info(&self, lock_file_path: &Path) -> Option<LockInfo> {
        let content = fs::read_to_string(lock_file_path).ok()?;
        serde_json::from_str(&content).ok()
    }

    /// 写入锁信息
    fn write_lock_info(&self, lock_file_path: &Path, lock_info: &LockInfo) -> Result<(), String> {
        let content = serde_json::to_string_pretty(lock_info)
            .map_err(|e| format!("序列化锁信息失败: {}", e))?;
        fs::write(lock_file_path, content).map_err(|e| format!("写入锁文件失败: {}", e))
    }

    /// 检查锁是否过期
    fn is_lock_expired(&self, lock_info: &LockInfo) -> bool {
        let now = Utc::now();
        let elapsed = (now - lock_info.timestamp).num_milliseconds() as u64;
        elapsed > lock_info.timeout
    }

    /// 获取文件锁
    pub fn acquire_lock(
        &self,
        file_path: &str,
        worker_id: &str,
        timeout: Option<u64>,
    ) -> Result<bool, String> {
        let lock_file_path = self.get_lock_file_path(file_path);
        let timeout = timeout.unwrap_or(self.default_timeout);

        // 检查是否已经存在锁
        if lock_file_path.exists() {
            if let Some(existing_lock) = self.read_lock_info(&lock_file_path) {
                // 如果是同一个 Worker，允许重入
                if existing_lock.worker_id == worker_id {
                    return Ok(true);
                }

                // 检查锁是否过期
                if self.is_lock_expired(&existing_lock) {
                    // 锁已过期，删除它
                    let _ = fs::remove_file(&lock_file_path);
                } else {
                    // 锁仍然有效，无法获取
                    return Ok(false);
                }
            }
        }

        // 创建锁信息
        let lock_info = LockInfo {
            worker_id: worker_id.to_string(),
            pid: std::process::id(),
            file_path: file_path.to_string(),
            timestamp: Utc::now(),
            timeout,
        };

        // 写入锁文件
        self.write_lock_info(&lock_file_path, &lock_info)?;

        // 记录锁
        if let Ok(mut locks) = self.locks.write() {
            locks.insert(file_path.to_string(), lock_info);
        }

        Ok(true)
    }

    /// 释放文件锁
    pub fn release_lock(&self, file_path: &str, worker_id: &str) -> Result<(), String> {
        let lock_file_path = self.get_lock_file_path(file_path);

        if !lock_file_path.exists() {
            return Ok(());
        }

        if let Some(lock_info) = self.read_lock_info(&lock_file_path) {
            // 只有持有锁的 Worker 才能释放
            if lock_info.worker_id != worker_id {
                return Err(format!(
                    "无法释放锁：文件被 worker {} 锁定，而非 {}",
                    lock_info.worker_id, worker_id
                ));
            }
        }

        fs::remove_file(&lock_file_path).map_err(|e| format!("删除锁文件失败: {}", e))?;

        if let Ok(mut locks) = self.locks.write() {
            locks.remove(file_path);
        }

        Ok(())
    }

    /// 检查文件是否被锁定
    pub fn is_locked(&self, file_path: &str) -> bool {
        let lock_file_path = self.get_lock_file_path(file_path);

        if !lock_file_path.exists() {
            return false;
        }

        if let Some(lock_info) = self.read_lock_info(&lock_file_path) {
            if self.is_lock_expired(&lock_info) {
                let _ = fs::remove_file(&lock_file_path);
                return false;
            }
            return true;
        }

        false
    }

    /// 获取锁定该文件的 Worker
    pub fn get_locker(&self, file_path: &str) -> Option<String> {
        let lock_file_path = self.get_lock_file_path(file_path);

        if !lock_file_path.exists() {
            return None;
        }

        let lock_info = self.read_lock_info(&lock_file_path)?;

        if self.is_lock_expired(&lock_info) {
            let _ = fs::remove_file(&lock_file_path);
            return None;
        }

        Some(lock_info.worker_id)
    }

    /// 获取所有活跃的锁
    pub fn get_active_locks(&self) -> Vec<LockInfo> {
        let mut locks = Vec::new();

        if !self.lock_dir.exists() {
            return locks;
        }

        if let Ok(entries) = fs::read_dir(&self.lock_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().is_some_and(|ext| ext == "lock") {
                    if let Some(lock_info) = self.read_lock_info(&path) {
                        if !self.is_lock_expired(&lock_info) {
                            locks.push(lock_info);
                        }
                    }
                }
            }
        }

        locks
    }

    /// 清理所有过期锁
    pub fn cleanup_stale_locks(&self) -> usize {
        let mut cleaned = 0;

        if !self.lock_dir.exists() {
            return cleaned;
        }

        if let Ok(entries) = fs::read_dir(&self.lock_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().is_some_and(|ext| ext == "lock") {
                    if let Some(lock_info) = self.read_lock_info(&path) {
                        if self.is_lock_expired(&lock_info) && fs::remove_file(&path).is_ok() {
                            cleaned += 1;
                        }
                    }
                }
            }
        }

        cleaned
    }

    /// 释放指定 Worker 的所有锁
    pub fn release_all_locks(&self, worker_id: &str) -> usize {
        let mut released = 0;

        if !self.lock_dir.exists() {
            return released;
        }

        if let Ok(entries) = fs::read_dir(&self.lock_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().is_some_and(|ext| ext == "lock") {
                    if let Some(lock_info) = self.read_lock_info(&path) {
                        if lock_info.worker_id == worker_id && fs::remove_file(&path).is_ok() {
                            released += 1;
                        }
                    }
                }
            }
        }

        released
    }
}

impl Default for FileLockManager {
    fn default() -> Self {
        Self::new(None)
    }
}

// ============================================================================
// Worker 沙箱
// ============================================================================

/// Worker 沙箱
///
/// 为每个 Worker 提供隔离的工作环境：
/// - 独立的文件系统空间
/// - 文件修改的版本控制
/// - 安全的同步机制
pub struct WorkerSandbox {
    config: SandboxConfig,
    sandbox_dir: PathBuf,
    lock_manager: Arc<FileLockManager>,
    copied_files: HashMap<String, FileMetadata>,
}

impl WorkerSandbox {
    /// 创建新的 Worker 沙箱
    pub fn new(config: SandboxConfig, lock_manager: Option<Arc<FileLockManager>>) -> Self {
        let sandbox_dir = config
            .sandbox_dir
            .clone()
            .unwrap_or_else(|| get_default_sandbox_root().join(&config.worker_id));

        Self {
            config,
            sandbox_dir,
            lock_manager: lock_manager.unwrap_or_else(|| Arc::new(FileLockManager::default())),
            copied_files: HashMap::new(),
        }
    }

    /// 创建沙箱环境
    pub fn setup(&self) -> Result<(), String> {
        // 创建沙箱目录
        fs::create_dir_all(&self.sandbox_dir).map_err(|e| format!("创建沙箱目录失败: {}", e))?;

        // 创建元数据文件
        let metadata_path = self.sandbox_dir.join(".sandbox-metadata.json");
        let metadata = serde_json::json!({
            "worker_id": self.config.worker_id,
            "task_id": self.config.task_id,
            "base_dir": self.config.base_dir.to_string_lossy(),
            "created_at": Utc::now().to_rfc3339(),
            "pid": std::process::id(),
        });

        fs::write(
            &metadata_path,
            serde_json::to_string_pretty(&metadata).unwrap(),
        )
        .map_err(|e| format!("写入元数据失败: {}", e))?;

        Ok(())
    }

    /// 将文件复制到沙箱
    pub fn copy_to_sandbox(&mut self, files: &[String]) -> Result<(), String> {
        for file in files {
            let absolute_path = if Path::new(file).is_absolute() {
                PathBuf::from(file)
            } else {
                self.config.base_dir.join(file)
            };

            if !absolute_path.exists() {
                continue;
            }

            // 计算相对路径
            let relative_path = absolute_path
                .strip_prefix(&self.config.base_dir)
                .map_err(|_| format!("文件不在基础目录内: {}", file))?
                .to_string_lossy()
                .to_string();

            let sandbox_path = self.sandbox_dir.join(&relative_path);

            // 确保目标目录存在
            if let Some(parent) = sandbox_path.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
            }

            // 复制文件或目录
            let metadata =
                fs::metadata(&absolute_path).map_err(|e| format!("获取文件元数据失败: {}", e))?;

            if metadata.is_dir() {
                copy_directory_recursive(&absolute_path, &sandbox_path)
                    .map_err(|e| format!("复制目录失败: {}", e))?;
            } else {
                fs::copy(&absolute_path, &sandbox_path)
                    .map_err(|e| format!("复制文件失败: {}", e))?;

                // 记录文件元数据
                if let Ok(hash) = compute_file_hash(&absolute_path) {
                    self.copied_files.insert(
                        relative_path.clone(),
                        FileMetadata {
                            relative_path,
                            hash,
                            mtime: metadata
                                .modified()
                                .map(|t| {
                                    t.duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()
                                        as i64
                                })
                                .unwrap_or(0),
                            size: metadata.len(),
                        },
                    );
                }
            }
        }

        Ok(())
    }

    /// 将修改同步回主目录（需要锁）
    pub fn sync_back(&self) -> SyncResult {
        let mut result = SyncResult::default();

        // 扫描沙箱中的文件
        let sandbox_files = self.scan_sandbox_files();
        result.total = sandbox_files.len();

        for sandbox_file in sandbox_files {
            let relative_path = sandbox_file
                .strip_prefix(&self.sandbox_dir)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();

            let original_path = self.config.base_dir.join(&relative_path);

            // 获取沙箱文件的 hash
            let sandbox_hash = match compute_file_hash(&sandbox_file) {
                Ok(h) => h,
                Err(e) => {
                    result.failed.push(SyncFailure {
                        file: relative_path,
                        error: format!("计算 hash 失败: {}", e),
                    });
                    continue;
                }
            };

            // 检查文件是否被修改
            if let Some(original_metadata) = self.copied_files.get(&relative_path) {
                if original_metadata.hash == sandbox_hash {
                    // 文件未修改，跳过
                    continue;
                }
            }

            // 获取文件锁
            let lock_acquired = self.lock_manager.acquire_lock(
                original_path.to_str().unwrap_or(""),
                &self.config.worker_id,
                Some(60000),
            );

            match lock_acquired {
                Ok(true) => {
                    // 冲突检测：检查主目录文件是否也被修改
                    if original_path.exists() {
                        if let Some(original_metadata) = self.copied_files.get(&relative_path) {
                            if let Ok(current_hash) = compute_file_hash(&original_path) {
                                if original_metadata.hash != current_hash {
                                    result.conflicts.push(SyncConflict {
                                        file: relative_path.clone(),
                                        reason: "文件在沙箱和主目录中都被修改".to_string(),
                                    });
                                    let _ = self.lock_manager.release_lock(
                                        original_path.to_str().unwrap_or(""),
                                        &self.config.worker_id,
                                    );
                                    continue;
                                }
                            }
                        }
                    }

                    // 同步文件
                    if let Some(parent) = original_path.parent() {
                        let _ = fs::create_dir_all(parent);
                    }

                    match fs::copy(&sandbox_file, &original_path) {
                        Ok(_) => result.success.push(relative_path.clone()),
                        Err(e) => result.failed.push(SyncFailure {
                            file: relative_path.clone(),
                            error: format!("复制文件失败: {}", e),
                        }),
                    }

                    // 释放锁
                    let _ = self
                        .lock_manager
                        .release_lock(original_path.to_str().unwrap_or(""), &self.config.worker_id);
                }
                Ok(false) => {
                    let locker = self
                        .lock_manager
                        .get_locker(original_path.to_str().unwrap_or(""));
                    result.failed.push(SyncFailure {
                        file: relative_path,
                        error: format!("无法获取锁，被 {:?} 锁定", locker),
                    });
                }
                Err(e) => {
                    result.failed.push(SyncFailure {
                        file: relative_path,
                        error: e,
                    });
                }
            }
        }

        result
    }

    /// 扫描沙箱中的所有文件
    fn scan_sandbox_files(&self) -> Vec<PathBuf> {
        let mut files = Vec::new();
        self.scan_directory(&self.sandbox_dir, &mut files);
        files
    }

    fn scan_directory(&self, dir: &Path, files: &mut Vec<PathBuf>) {
        if !dir.exists() {
            return;
        }

        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();

                // 跳过元数据文件
                if path
                    .file_name()
                    .is_some_and(|n| n == ".sandbox-metadata.json")
                {
                    continue;
                }

                if path.is_dir() {
                    self.scan_directory(&path, files);
                } else if path.is_file() {
                    files.push(path);
                }
            }
        }
    }

    /// 清理沙箱
    pub fn cleanup(&self) -> Result<usize, String> {
        // 释放所有锁
        let released = self.lock_manager.release_all_locks(&self.config.worker_id);

        // 删除沙箱目录
        if self.sandbox_dir.exists() {
            fs::remove_dir_all(&self.sandbox_dir)
                .map_err(|e| format!("删除沙箱目录失败: {}", e))?;
        }

        Ok(released)
    }

    /// 获取沙箱目录
    pub fn sandbox_dir(&self) -> &Path {
        &self.sandbox_dir
    }

    /// 获取沙箱中的文件路径
    pub fn get_sandbox_path(&self, relative_path: &str) -> PathBuf {
        self.sandbox_dir.join(relative_path)
    }

    /// 检查文件是否在沙箱中
    pub fn has_file(&self, relative_path: &str) -> bool {
        self.get_sandbox_path(relative_path).exists()
    }

    /// 获取沙箱统计信息
    pub fn get_stats(&self) -> SandboxStats {
        let files = self.scan_sandbox_files();
        let total_size: u64 = files
            .iter()
            .filter_map(|f| fs::metadata(f).ok())
            .map(|m| m.len())
            .sum();

        SandboxStats {
            file_count: files.len(),
            total_size,
            copied_files: self.copied_files.len(),
        }
    }
}

/// 沙箱统计信息
#[derive(Debug, Clone)]
pub struct SandboxStats {
    pub file_count: usize,
    pub total_size: u64,
    pub copied_files: usize,
}

// ============================================================================
// 工厂函数
// ============================================================================

/// 创建全局文件锁管理器
pub fn create_lock_manager(lock_dir: Option<PathBuf>) -> Arc<FileLockManager> {
    Arc::new(FileLockManager::new(lock_dir))
}

/// 创建 Worker 沙箱
pub fn create_worker_sandbox(
    config: SandboxConfig,
    lock_manager: Option<Arc<FileLockManager>>,
) -> WorkerSandbox {
    WorkerSandbox::new(config, lock_manager)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env::temp_dir;

    #[test]
    fn test_compute_string_hash() {
        let hash1 = compute_string_hash("test");
        let hash2 = compute_string_hash("test");
        let hash3 = compute_string_hash("different");

        assert_eq!(hash1, hash2);
        assert_ne!(hash1, hash3);
        assert_eq!(hash1.len(), 16);
    }

    #[test]
    fn test_file_lock_manager() {
        let lock_dir = temp_dir().join("aster_test_locks");
        let manager = FileLockManager::new(Some(lock_dir.clone()));

        // 获取锁
        let result = manager.acquire_lock("/test/file.rs", "worker1", None);
        assert!(result.is_ok());
        assert!(result.unwrap());

        // 检查锁状态
        assert!(manager.is_locked("/test/file.rs"));
        assert_eq!(
            manager.get_locker("/test/file.rs"),
            Some("worker1".to_string())
        );

        // 释放锁
        let result = manager.release_lock("/test/file.rs", "worker1");
        assert!(result.is_ok());
        assert!(!manager.is_locked("/test/file.rs"));

        // 清理
        let _ = fs::remove_dir_all(lock_dir);
    }

    #[test]
    fn test_sandbox_config() {
        let config = SandboxConfig {
            worker_id: "test_worker".to_string(),
            task_id: "test_task".to_string(),
            base_dir: PathBuf::from("/tmp/test"),
            sandbox_dir: None,
        };

        assert_eq!(config.worker_id, "test_worker");
        assert_eq!(config.task_id, "test_task");
    }
}
