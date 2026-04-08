//! 增量缓存管理器
//!
//! 支持增量更新，只重新分析变更的文件

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::types::{CacheData, CacheEntry, ModuleNode};

/// 增量缓存
pub struct IncrementalCache {
    cache_file: PathBuf,
    cache: Option<CacheData>,
    dirty: bool,
}

impl IncrementalCache {
    pub fn new(project_root: impl AsRef<Path>) -> Self {
        let cache_file = project_root.as_ref().join(".claude").join("map-cache.json");
        Self {
            cache_file,
            cache: None,
            dirty: false,
        }
    }

    /// 加载缓存
    pub fn load(&mut self) -> bool {
        if !self.cache_file.exists() {
            self.cache = None;
            return false;
        }

        match std::fs::read_to_string(&self.cache_file) {
            Ok(content) => match serde_json::from_str(&content) {
                Ok(data) => {
                    self.cache = Some(data);
                    self.dirty = false;
                    true
                }
                Err(_) => {
                    self.cache = None;
                    false
                }
            },
            Err(_) => {
                self.cache = None;
                false
            }
        }
    }

    /// 保存缓存
    pub fn save(&mut self) -> bool {
        if self.cache.is_none() || !self.dirty {
            return true;
        }

        if let Some(ref mut cache) = self.cache {
            cache.generated_at = chrono::Utc::now().to_rfc3339();
        }

        if let Some(parent) = self.cache_file.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        if let Ok(content) = serde_json::to_string_pretty(&self.cache) {
            if std::fs::write(&self.cache_file, content).is_ok() {
                self.dirty = false;
                return true;
            }
        }
        false
    }

    /// 检查文件是否需要重新分析
    pub fn needs_reanalysis(&self, file_path: &Path) -> bool {
        let cache = match &self.cache {
            Some(c) => c,
            None => return true,
        };

        let relative = self.get_relative_path(file_path);
        let entry = match cache.entries.get(&relative) {
            Some(e) => e,
            None => return true,
        };

        match std::fs::metadata(file_path) {
            Ok(meta) => {
                let mtime = meta
                    .modified()
                    .map(|t| {
                        t.duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as u64
                    })
                    .unwrap_or(0);
                if entry.mtime != mtime {
                    if let Ok(content) = std::fs::read_to_string(file_path) {
                        let hash = self.calculate_hash(&content);
                        return hash != entry.hash;
                    }
                }
                false
            }
            Err(_) => true,
        }
    }

    /// 批量检查文件
    pub fn check_files(&self, file_paths: &[PathBuf]) -> FileCheckResult {
        let mut changed = Vec::new();
        let mut unchanged = Vec::new();
        let mut removed = Vec::new();

        let current_files: std::collections::HashSet<_> = file_paths
            .iter()
            .map(|f| self.get_relative_path(f))
            .collect();

        for path in file_paths {
            if self.needs_reanalysis(path) {
                changed.push(path.clone());
            } else {
                unchanged.push(path.clone());
            }
        }

        if let Some(ref cache) = self.cache {
            for cached_path in cache.entries.keys() {
                if !current_files.contains(cached_path) {
                    removed.push(cached_path.clone());
                }
            }
        }

        FileCheckResult {
            changed,
            unchanged,
            removed,
        }
    }

    /// 获取缓存的模块
    pub fn get_cached_module(&self, file_path: &Path) -> Option<ModuleNode> {
        let cache = self.cache.as_ref()?;
        let relative = self.get_relative_path(file_path);
        cache.entries.get(&relative).map(|e| e.module.clone())
    }

    /// 更新缓存条目
    pub fn update_entry(&mut self, file_path: &Path, module: ModuleNode) {
        if self.cache.is_none() {
            self.cache = Some(CacheData {
                version: "1.0.0".to_string(),
                root_path: self
                    .cache_file
                    .parent()
                    .and_then(|p| p.parent())
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default(),
                generated_at: chrono::Utc::now().to_rfc3339(),
                entries: HashMap::new(),
            });
        }

        if let Ok(meta) = std::fs::metadata(file_path) {
            if let Ok(content) = std::fs::read_to_string(file_path) {
                let hash = self.calculate_hash(&content);
                let mtime = meta
                    .modified()
                    .map(|t| {
                        t.duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as u64
                    })
                    .unwrap_or(0);

                let relative = self.get_relative_path(file_path);
                if let Some(cache) = self.cache.as_mut() {
                    cache.entries.insert(
                        relative,
                        CacheEntry {
                            hash,
                            mtime,
                            module,
                        },
                    );
                    self.dirty = true;
                }
            }
        }
    }

    /// 删除缓存条目
    pub fn remove_entry(&mut self, file_path: &Path) {
        let relative = self.get_relative_path(file_path);
        if let Some(ref mut cache) = self.cache {
            if cache.entries.remove(&relative).is_some() {
                self.dirty = true;
            }
        }
    }

    /// 清除所有缓存
    pub fn clear(&mut self) {
        self.cache = None;
        self.dirty = false;
        let _ = std::fs::remove_file(&self.cache_file);
    }

    /// 获取缓存统计信息
    pub fn get_stats(&self) -> CacheStats {
        let cache_file_size = std::fs::metadata(&self.cache_file)
            .map(|m| m.len() as usize)
            .unwrap_or(0);

        CacheStats {
            entry_count: self.cache.as_ref().map(|c| c.entries.len()).unwrap_or(0),
            cache_file_size,
            last_generated: self.cache.as_ref().map(|c| c.generated_at.clone()),
        }
    }

    fn get_relative_path(&self, file_path: &Path) -> String {
        if let Some(ref cache) = self.cache {
            if let Ok(rel) = file_path.strip_prefix(&cache.root_path) {
                return rel.to_string_lossy().replace('\\', "/");
            }
        }
        if let Some(parent) = self.cache_file.parent().and_then(|p| p.parent()) {
            if let Ok(rel) = file_path.strip_prefix(parent) {
                return rel.to_string_lossy().replace('\\', "/");
            }
        }
        file_path.to_string_lossy().replace('\\', "/")
    }

    fn calculate_hash(&self, content: &str) -> String {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        content.hash(&mut hasher);
        format!("{:x}", hasher.finish())
    }
}

/// 文件检查结果
#[derive(Debug, Clone, Default)]
pub struct FileCheckResult {
    pub changed: Vec<PathBuf>,
    pub unchanged: Vec<PathBuf>,
    pub removed: Vec<String>,
}

/// 缓存统计
#[derive(Debug, Clone, Default)]
pub struct CacheStats {
    pub entry_count: usize,
    pub cache_file_size: usize,
    pub last_generated: Option<String>,
}

/// 便捷函数：创建缓存管理器
pub fn create_cache(project_root: impl AsRef<Path>) -> IncrementalCache {
    IncrementalCache::new(project_root)
}
