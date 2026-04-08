//! 简单记忆管理器
//!
//! 持久化存储用户偏好和项目上下文

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;

use super::types::{MemoryEntry, MemoryScope, SimpleMemoryStore, Timestamp};

const MEMORY_VERSION: &str = "1.0.0";

/// 获取当前时间戳
fn now() -> Timestamp {
    Utc::now().to_rfc3339()
}

/// 记忆管理器
pub struct MemoryManager {
    global_store_path: PathBuf,
    project_store_path: PathBuf,
    global_store: SimpleMemoryStore,
    project_store: SimpleMemoryStore,
}

impl MemoryManager {
    /// 创建新的记忆管理器
    pub fn new(project_dir: Option<&Path>) -> Self {
        let global_dir = dirs::home_dir()
            .unwrap_or_default()
            .join(".aster")
            .join("memory");

        let project_dir_path = project_dir
            .map(|p| p.join(".aster").join("memory"))
            .unwrap_or_else(|| {
                std::env::current_dir()
                    .unwrap_or_default()
                    .join(".aster")
                    .join("memory")
            });

        let global_store_path = global_dir.join("memory.json");
        let project_store_path = project_dir_path.join("memory.json");

        let global_store = Self::load_store(&global_store_path);
        let project_store = Self::load_store(&project_store_path);

        Self {
            global_store_path,
            project_store_path,
            global_store,
            project_store,
        }
    }

    /// 设置记忆值
    pub fn set(&mut self, key: &str, value: &str, scope: MemoryScope) {
        let (store, store_path) = match scope {
            MemoryScope::Global => (&mut self.global_store, &self.global_store_path),
            MemoryScope::Project => (&mut self.project_store, &self.project_store_path),
        };

        let current_time = now();
        let existing = store.entries.get(key);

        let entry = MemoryEntry {
            key: key.to_string(),
            value: value.to_string(),
            scope,
            created_at: existing
                .map(|e| e.created_at.clone())
                .unwrap_or_else(|| current_time.clone()),
            updated_at: current_time,
        };

        store.entries.insert(key.to_string(), entry);
        Self::save_store(store_path, store);
    }

    /// 获取记忆值
    pub fn get(&self, key: &str, scope: Option<MemoryScope>) -> Option<&str> {
        match scope {
            Some(MemoryScope::Global) => {
                self.global_store.entries.get(key).map(|e| e.value.as_str())
            }
            Some(MemoryScope::Project) => self
                .project_store
                .entries
                .get(key)
                .map(|e| e.value.as_str()),
            None => {
                // 先查项目，再查全局
                self.project_store
                    .entries
                    .get(key)
                    .or_else(|| self.global_store.entries.get(key))
                    .map(|e| e.value.as_str())
            }
        }
    }

    /// 删除记忆值
    pub fn delete(&mut self, key: &str, scope: MemoryScope) -> bool {
        let (store, store_path) = match scope {
            MemoryScope::Global => (&mut self.global_store, &self.global_store_path),
            MemoryScope::Project => (&mut self.project_store, &self.project_store_path),
        };

        if store.entries.remove(key).is_some() {
            Self::save_store(store_path, store);
            true
        } else {
            false
        }
    }

    /// 列出所有记忆条目
    pub fn list(&self, scope: Option<MemoryScope>) -> Vec<&MemoryEntry> {
        let mut entries: Vec<&MemoryEntry> = Vec::new();

        if scope != Some(MemoryScope::Project) {
            entries.extend(self.global_store.entries.values());
        }
        if scope != Some(MemoryScope::Global) {
            entries.extend(self.project_store.entries.values());
        }

        entries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        entries
    }

    /// 清空记忆
    pub fn clear(&mut self, scope: MemoryScope) {
        let (store, store_path) = match scope {
            MemoryScope::Global => (&mut self.global_store, &self.global_store_path),
            MemoryScope::Project => (&mut self.project_store, &self.project_store_path),
        };

        store.entries.clear();
        Self::save_store(store_path, store);
    }

    /// 获取记忆摘要（用于 system prompt）
    pub fn get_summary(&self) -> String {
        let entries = self.list(None);
        if entries.is_empty() {
            return String::new();
        }

        let lines: Vec<String> = entries
            .iter()
            .take(20)
            .map(|e| format!("- {}: {}", e.key, e.value))
            .collect();

        format!("User Memory:\n{}", lines.join("\n"))
    }

    /// 搜索记忆
    pub fn search(&self, query: &str) -> Vec<&MemoryEntry> {
        let entries = self.list(None);
        let lower_query = query.to_lowercase();

        entries
            .into_iter()
            .filter(|e| {
                e.key.to_lowercase().contains(&lower_query)
                    || e.value.to_lowercase().contains(&lower_query)
            })
            .collect()
    }

    // === 私有方法 ===

    fn load_store(path: &Path) -> SimpleMemoryStore {
        if path.exists() {
            if let Ok(content) = fs::read_to_string(path) {
                if let Ok(store) = serde_json::from_str(&content) {
                    return store;
                }
            }
        }
        SimpleMemoryStore {
            entries: HashMap::new(),
            version: MEMORY_VERSION.to_string(),
        }
    }

    fn save_store(path: &Path, store: &SimpleMemoryStore) {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(content) = serde_json::to_string_pretty(store) {
            let _ = fs::write(path, content);
        }
    }
}

impl Default for MemoryManager {
    fn default() -> Self {
        Self::new(None)
    }
}
