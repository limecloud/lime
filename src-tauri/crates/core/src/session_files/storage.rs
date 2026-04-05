//! 会话文件存储服务
//!
//! 提供会话文件的 CRUD 操作和生命周期管理。

use crate::app_paths;
use std::fs;
use std::path::{Component, PathBuf};

use chrono::Utc;

use super::types::{SessionDetail, SessionFile, SessionMeta, SessionSummary};

/// 会话文件存储服务
pub struct SessionFileStorage {
    /// 存储根目录
    base_dir: PathBuf,
}

impl SessionFileStorage {
    /// 创建新的存储服务
    ///
    /// 默认使用应用数据目录下的 `lime/sessions`，并兼容旧 Home 历史目录
    pub fn new() -> Result<Self, String> {
        let base_dir = Self::get_default_base_dir()?;
        fs::create_dir_all(&base_dir).map_err(|e| format!("创建会话存储目录失败: {e}"))?;
        Ok(Self { base_dir })
    }

    /// 使用指定目录创建存储服务
    pub fn with_base_dir(base_dir: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&base_dir).map_err(|e| format!("创建会话存储目录失败: {e}"))?;
        Ok(Self { base_dir })
    }

    /// 获取默认存储目录
    fn get_default_base_dir() -> Result<PathBuf, String> {
        app_paths::resolve_sessions_dir()
    }

    /// 获取会话目录路径
    fn get_session_dir(&self, session_id: &str) -> PathBuf {
        self.base_dir.join(session_id)
    }

    /// 获取会话元数据文件路径
    fn get_meta_path(&self, session_id: &str) -> PathBuf {
        self.get_session_dir(session_id).join(".meta.json")
    }

    /// 获取会话文件目录路径
    fn get_files_dir(&self, session_id: &str) -> PathBuf {
        self.get_session_dir(session_id).join("files")
    }

    // ========================================================================
    // 会话管理
    // ========================================================================

    /// 创建新会话目录
    pub fn create_session(&self, session_id: &str) -> Result<SessionMeta, String> {
        let session_dir = self.get_session_dir(session_id);
        let files_dir = self.get_files_dir(session_id);

        // 创建目录
        fs::create_dir_all(&files_dir).map_err(|e| format!("创建会话目录失败: {e}"))?;

        // 创建元数据
        let meta = SessionMeta::new(session_id.to_string());
        self.save_meta(session_id, &meta)?;

        tracing::info!("[SessionFileStorage] 创建会话目录: {:?}", session_dir);
        Ok(meta)
    }

    /// 检查会话是否存在
    pub fn session_exists(&self, session_id: &str) -> bool {
        self.get_session_dir(session_id).exists()
    }

    /// 获取或创建会话
    pub fn get_or_create_session(&self, session_id: &str) -> Result<SessionMeta, String> {
        if self.session_exists(session_id) {
            self.get_meta(session_id)
        } else {
            self.create_session(session_id)
        }
    }

    /// 删除会话目录（包括所有文件）
    pub fn delete_session(&self, session_id: &str) -> Result<(), String> {
        let session_dir = self.get_session_dir(session_id);
        if session_dir.exists() {
            fs::remove_dir_all(&session_dir).map_err(|e| format!("删除会话目录失败: {e}"))?;
            tracing::info!("[SessionFileStorage] 删除会话目录: {:?}", session_dir);
        }
        Ok(())
    }

    /// 列出所有会话
    pub fn list_sessions(&self) -> Result<Vec<SessionSummary>, String> {
        let mut sessions = Vec::new();

        if !self.base_dir.exists() {
            return Ok(sessions);
        }

        let entries = fs::read_dir(&self.base_dir).map_err(|e| format!("读取会话目录失败: {e}"))?;

        for entry in entries.flatten() {
            if entry.path().is_dir() {
                if let Some(session_id) = entry.file_name().to_str() {
                    // 跳过隐藏目录
                    if session_id.starts_with('.') {
                        continue;
                    }
                    if let Ok(meta) = self.get_meta(session_id) {
                        sessions.push(SessionSummary {
                            session_id: meta.session_id,
                            title: meta.title,
                            theme: meta.theme,
                            created_at: meta.created_at,
                            updated_at: meta.updated_at,
                            file_count: meta.file_count,
                        });
                    }
                }
            }
        }

        // 按更新时间倒序排列
        sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(sessions)
    }

    // ========================================================================
    // 元数据管理
    // ========================================================================

    /// 读取会话元数据
    pub fn get_meta(&self, session_id: &str) -> Result<SessionMeta, String> {
        let meta_path = self.get_meta_path(session_id);
        let content = fs::read_to_string(&meta_path).map_err(|e| format!("读取元数据失败: {e}"))?;
        serde_json::from_str(&content).map_err(|e| format!("解析元数据失败: {e}"))
    }

    /// 保存会话元数据
    pub fn save_meta(&self, session_id: &str, meta: &SessionMeta) -> Result<(), String> {
        let meta_path = self.get_meta_path(session_id);
        let content =
            serde_json::to_string_pretty(meta).map_err(|e| format!("序列化元数据失败: {e}"))?;
        fs::write(&meta_path, content).map_err(|e| format!("写入元数据失败: {e}"))
    }

    /// 更新会话元数据
    pub fn update_meta(
        &self,
        session_id: &str,
        title: Option<String>,
        theme: Option<String>,
        creation_mode: Option<String>,
    ) -> Result<SessionMeta, String> {
        let mut meta = self.get_meta(session_id)?;

        if title.is_some() {
            meta.title = title;
        }
        if theme.is_some() {
            meta.theme = theme;
        }
        if creation_mode.is_some() {
            meta.creation_mode = creation_mode;
        }
        meta.updated_at = Utc::now().timestamp_millis();

        self.save_meta(session_id, &meta)?;
        Ok(meta)
    }

    // ========================================================================
    // 文件管理
    // ========================================================================

    /// 保存文件到会话目录
    pub fn save_file(
        &self,
        session_id: &str,
        file_name: &str,
        content: &str,
    ) -> Result<SessionFile, String> {
        // 确保会话存在
        self.get_or_create_session(session_id)?;

        let file_path = self.resolve_session_file_path(session_id, file_name)?;

        if let Some(parent_dir) = file_path.parent() {
            fs::create_dir_all(parent_dir).map_err(|e| format!("创建文件目录失败: {e}"))?;
        }

        // 写入文件
        fs::write(&file_path, content).map_err(|e| format!("写入文件失败: {e}"))?;

        let now = Utc::now().timestamp_millis();
        let size = content.len() as u64;

        // 更新元数据
        self.refresh_meta_stats(session_id)?;

        tracing::debug!(
            "[SessionFileStorage] 保存文件: {} -> {:?}",
            file_name,
            file_path
        );

        Ok(SessionFile {
            name: file_name.to_string(),
            file_type: Self::detect_file_type(file_name),
            size,
            created_at: now,
            updated_at: now,
        })
    }

    /// 读取会话文件内容
    pub fn read_file(&self, session_id: &str, file_name: &str) -> Result<String, String> {
        let file_path = self.resolve_session_file_path(session_id, file_name)?;
        fs::read_to_string(&file_path).map_err(|e| format!("读取文件失败: {e}"))
    }

    /// 解析会话文件的绝对路径
    pub fn resolve_file_path(&self, session_id: &str, file_name: &str) -> Result<String, String> {
        let files_dir = self.get_files_dir(session_id);
        let file_path = self.resolve_session_file_path(session_id, file_name)?;

        if !file_path.exists() {
            return Err("文件不存在".to_string());
        }

        let canonical_file_path = file_path
            .canonicalize()
            .map_err(|e| format!("解析文件路径失败: {e}"))?;
        let canonical_files_dir = files_dir
            .canonicalize()
            .map_err(|e| format!("解析会话目录失败: {e}"))?;

        if !canonical_file_path.starts_with(&canonical_files_dir) {
            return Err("非法文件路径".to_string());
        }

        Ok(canonical_file_path.to_string_lossy().to_string())
    }

    /// 删除会话文件
    pub fn delete_file(&self, session_id: &str, file_name: &str) -> Result<(), String> {
        let file_path = self.resolve_session_file_path(session_id, file_name)?;
        if file_path.exists() {
            fs::remove_file(&file_path).map_err(|e| format!("删除文件失败: {e}"))?;
            self.refresh_meta_stats(session_id)?;
        }
        Ok(())
    }

    /// 列出会话中的所有文件
    pub fn list_files(&self, session_id: &str) -> Result<Vec<SessionFile>, String> {
        let files_dir = self.get_files_dir(session_id);
        let mut files = Vec::new();

        if !files_dir.exists() {
            return Ok(files);
        }

        let entries = fs::read_dir(&files_dir).map_err(|e| format!("读取文件目录失败: {e}"))?;

        for entry in entries.flatten() {
            if entry.path().is_file() {
                if let Some(name) = entry.file_name().to_str() {
                    // 跳过隐藏文件
                    if name.starts_with('.') {
                        continue;
                    }
                    if let Ok(metadata) = entry.metadata() {
                        let created_at = metadata
                            .created()
                            .map(|t| {
                                t.duration_since(std::time::UNIX_EPOCH)
                                    .map(|d| d.as_millis() as i64)
                                    .unwrap_or(0)
                            })
                            .unwrap_or(0);
                        let updated_at = metadata
                            .modified()
                            .map(|t| {
                                t.duration_since(std::time::UNIX_EPOCH)
                                    .map(|d| d.as_millis() as i64)
                                    .unwrap_or(0)
                            })
                            .unwrap_or(0);

                        files.push(SessionFile {
                            name: name.to_string(),
                            file_type: Self::detect_file_type(name),
                            size: metadata.len(),
                            created_at,
                            updated_at,
                        });
                    }
                }
            }
        }

        // 按更新时间倒序排列
        files.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(files)
    }

    /// 获取会话详情（包括文件列表）
    pub fn get_session_detail(&self, session_id: &str) -> Result<SessionDetail, String> {
        let meta = self.get_meta(session_id)?;
        let files = self.list_files(session_id)?;
        Ok(SessionDetail { meta, files })
    }

    // ========================================================================
    // 清理功能
    // ========================================================================

    /// 清理过期会话（默认 30 天）
    pub fn cleanup_expired(&self, max_age_days: u32) -> Result<u32, String> {
        let cutoff = Utc::now().timestamp_millis() - (max_age_days as i64 * 24 * 60 * 60 * 1000);
        let mut cleaned = 0;

        let sessions = self.list_sessions()?;
        for session in sessions {
            if session.updated_at < cutoff && self.delete_session(&session.session_id).is_ok() {
                cleaned += 1;
                tracing::info!("[SessionFileStorage] 清理过期会话: {}", session.session_id);
            }
        }

        Ok(cleaned)
    }

    /// 清理空会话（没有文件的会话）
    pub fn cleanup_empty(&self) -> Result<u32, String> {
        let mut cleaned = 0;

        let sessions = self.list_sessions()?;
        for session in sessions {
            if session.file_count == 0 && self.delete_session(&session.session_id).is_ok() {
                cleaned += 1;
            }
        }

        Ok(cleaned)
    }

    // ========================================================================
    // 辅助函数
    // ========================================================================

    /// 刷新元数据统计信息
    fn refresh_meta_stats(&self, session_id: &str) -> Result<(), String> {
        let files = self.list_files(session_id)?;
        let file_count = files.len() as u32;
        let total_size: u64 = files.iter().map(|f| f.size).sum();

        let mut meta = self.get_meta(session_id)?;
        meta.file_count = file_count;
        meta.total_size = total_size;
        meta.updated_at = Utc::now().timestamp_millis();
        self.save_meta(session_id, &meta)
    }

    fn resolve_session_file_path(
        &self,
        session_id: &str,
        file_name: &str,
    ) -> Result<PathBuf, String> {
        let relative_path = Self::validate_relative_file_path(file_name)?;
        Ok(self.get_files_dir(session_id).join(relative_path))
    }

    fn validate_relative_file_path(file_name: &str) -> Result<PathBuf, String> {
        let relative_path = PathBuf::from(file_name);

        if relative_path.as_os_str().is_empty() {
            return Err("文件路径不能为空".to_string());
        }

        if relative_path.is_absolute() {
            return Err("非法文件路径".to_string());
        }

        if relative_path.components().any(|component| {
            matches!(
                component,
                Component::CurDir
                    | Component::ParentDir
                    | Component::RootDir
                    | Component::Prefix(_)
            )
        }) {
            return Err("非法文件路径".to_string());
        }

        Ok(relative_path)
    }

    /// 根据文件扩展名检测文件类型
    fn detect_file_type(file_name: &str) -> String {
        let ext = file_name.rsplit('.').next().unwrap_or("").to_lowercase();

        match ext.as_str() {
            "md" | "txt" => "document".to_string(),
            "json" => "json".to_string(),
            "png" | "jpg" | "jpeg" | "gif" | "webp" => "image".to_string(),
            "mp3" | "wav" | "midi" | "mid" => "audio".to_string(),
            "mp4" | "mov" | "avi" => "video".to_string(),
            _ => "other".to_string(),
        }
    }
}

impl Default for SessionFileStorage {
    fn default() -> Self {
        Self::new().expect("创建默认会话文件存储失败")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_test_storage() -> (SessionFileStorage, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let storage = SessionFileStorage::with_base_dir(temp_dir.path().to_path_buf()).unwrap();
        (storage, temp_dir)
    }

    #[test]
    fn test_create_session() {
        let (storage, _temp) = create_test_storage();
        let meta = storage.create_session("test-session-1").unwrap();
        assert_eq!(meta.session_id, "test-session-1");
        assert!(storage.session_exists("test-session-1"));
    }

    #[test]
    fn test_save_and_read_file() {
        let (storage, _temp) = create_test_storage();
        storage.create_session("test-session-2").unwrap();

        let content = "# Test Article\n\nThis is a test.";
        storage
            .save_file("test-session-2", "article.md", content)
            .unwrap();

        let read_content = storage.read_file("test-session-2", "article.md").unwrap();
        assert_eq!(read_content, content);
    }

    #[test]
    fn test_list_files() {
        let (storage, _temp) = create_test_storage();
        storage.create_session("test-session-3").unwrap();

        storage
            .save_file("test-session-3", "file1.md", "content1")
            .unwrap();
        storage
            .save_file("test-session-3", "file2.txt", "content2")
            .unwrap();

        let files = storage.list_files("test-session-3").unwrap();
        assert_eq!(files.len(), 2);
    }

    #[test]
    fn test_delete_session() {
        let (storage, _temp) = create_test_storage();
        storage.create_session("test-session-4").unwrap();
        storage
            .save_file("test-session-4", "test.md", "content")
            .unwrap();

        assert!(storage.session_exists("test-session-4"));
        storage.delete_session("test-session-4").unwrap();
        assert!(!storage.session_exists("test-session-4"));
    }

    #[test]
    fn test_resolve_file_path() {
        let (storage, _temp) = create_test_storage();
        storage.create_session("test-session-5").unwrap();
        storage
            .save_file("test-session-5", "demo.md", "content")
            .unwrap();

        let resolved = storage
            .resolve_file_path("test-session-5", "demo.md")
            .unwrap();
        let expected_suffix = std::path::Path::new("test-session-5")
            .join("files")
            .join("demo.md");
        assert!(std::path::Path::new(&resolved).ends_with(&expected_suffix));
    }

    #[test]
    fn test_save_nested_file_creates_parent_dirs() {
        let (storage, temp_dir) = create_test_storage();
        storage.create_session("test-session-6").unwrap();

        let nested_file = ".lime/artifacts/thread-1/report.artifact.json";
        storage
            .save_file("test-session-6", nested_file, "{\"ok\":true}")
            .unwrap();

        let expected_path = temp_dir
            .path()
            .join("test-session-6")
            .join("files")
            .join(".lime")
            .join("artifacts")
            .join("thread-1")
            .join("report.artifact.json");

        assert!(expected_path.exists());
        assert_eq!(
            storage.read_file("test-session-6", nested_file).unwrap(),
            "{\"ok\":true}"
        );
    }

    #[test]
    fn test_save_file_rejects_parent_dir_traversal() {
        let (storage, _temp) = create_test_storage();
        storage.create_session("test-session-7").unwrap();

        let error = storage
            .save_file("test-session-7", "../escape.txt", "content")
            .unwrap_err();

        assert!(error.contains("非法文件路径"));
    }
}
