//! 对话记忆模块
//!
//! 负责存储和管理对话摘要，支持：
//! - 层级压缩（工作记忆 → 短期记忆 → 核心记忆）
//! - 关键词/话题/时间范围搜索
//! - 核心记忆管理（永不遗忘）

use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};

use super::types::{
    ChatMemoryStats, ChatMemoryStore, ConversationSummary, MemoryHierarchyConfig, MemoryImportance,
    Timestamp,
};

const CHAT_MEMORY_VERSION: &str = "1.0.0";
const SUMMARIES_FILE: &str = "summaries.json";
const CORE_FILE: &str = "core.json";

/// 获取当前时间戳
fn now() -> Timestamp {
    Utc::now().to_rfc3339()
}

/// 解析时间戳
fn parse_timestamp(ts: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(ts)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

/// 计算天数差
fn days_between(start: &str, end: &str) -> i64 {
    let start_dt = parse_timestamp(start);
    let end_dt = parse_timestamp(end);

    match (start_dt, end_dt) {
        (Some(s), Some(e)) => (e - s).num_days(),
        _ => 0,
    }
}

/// 对话记忆管理器
pub struct ChatMemory {
    global_dir: PathBuf,
    project_dir: Option<PathBuf>,
    store: ChatMemoryStore,
    config: MemoryHierarchyConfig,
}

impl ChatMemory {
    /// 创建新的对话记忆管理器
    pub fn new(project_path: Option<&Path>, config: Option<MemoryHierarchyConfig>) -> Self {
        let global_dir = dirs::home_dir()
            .unwrap_or_default()
            .join(".aster")
            .join("memory")
            .join("chat");

        let project_dir = project_path.map(|p| p.join(".aster").join("memory").join("chat"));

        let cfg = config.unwrap_or_default();
        let project_path_str = project_path
            .map(|p| p.display().to_string())
            .unwrap_or_default();

        let mut memory = Self {
            global_dir,
            project_dir,
            store: Self::create_empty_store(&project_path_str),
            config: cfg,
        };

        memory.load();
        memory
    }

    /// 添加对话摘要
    pub fn add_conversation(&mut self, mut summary: ConversationSummary) {
        if summary.id.is_empty() {
            summary.id = nanoid::nanoid!();
        }

        self.store.summaries.push(summary);
        self.update_stats();

        if self.store.summaries.len() > self.config.compression_threshold {
            self.compress();
        }

        self.save();
    }

    /// 搜索对话
    pub fn search(&self, query: &str, limit: Option<usize>) -> Vec<&ConversationSummary> {
        let limit = limit.unwrap_or(10);
        let query_lower = query.to_lowercase();

        let mut results: Vec<(&ConversationSummary, f32)> = self
            .store
            .summaries
            .iter()
            .filter_map(|summary| {
                let mut score = 0.0;

                // 摘要内容匹配
                if summary.summary.to_lowercase().contains(&query_lower) {
                    score += 2.0;
                }

                // 话题匹配
                let topic_matches = summary
                    .topics
                    .iter()
                    .filter(|t| t.to_lowercase().contains(&query_lower))
                    .count();
                score += topic_matches as f32 * 3.0;

                // 文件名匹配
                if summary
                    .files_discussed
                    .iter()
                    .any(|f| f.to_lowercase().contains(&query_lower))
                {
                    score += 1.0;
                }

                // 符号匹配
                if summary
                    .symbols_discussed
                    .iter()
                    .any(|s| s.to_lowercase().contains(&query_lower))
                {
                    score += 1.0;
                }

                // 重要性加权
                score += summary.importance as u8 as f32;

                if score > 0.0 {
                    Some((summary, score))
                } else {
                    None
                }
            })
            .collect();

        results.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        results.into_iter().take(limit).map(|(s, _)| s).collect()
    }

    /// 按话题搜索
    pub fn search_by_topic(&self, topic: &str, limit: Option<usize>) -> Vec<&ConversationSummary> {
        let limit = limit.unwrap_or(10);
        let topic_lower = topic.to_lowercase();

        let mut results: Vec<_> = self
            .store
            .summaries
            .iter()
            .filter(|s| {
                s.topics
                    .iter()
                    .any(|t| t.to_lowercase().contains(&topic_lower))
            })
            .collect();

        results.sort_by(|a, b| b.end_time.cmp(&a.end_time));
        results.into_iter().take(limit).collect()
    }

    /// 压缩旧记忆
    pub fn compress(&mut self) {
        let current_time = now();
        let mut summaries = std::mem::take(&mut self.store.summaries);

        // 按时间排序（新到旧）
        summaries.sort_by(|a, b| b.end_time.cmp(&a.end_time));

        // 分离工作记忆
        let working_memory: Vec<_> = summaries
            .iter()
            .take(self.config.working_memory_size)
            .cloned()
            .collect();

        let older_memories: Vec<_> = summaries
            .into_iter()
            .skip(self.config.working_memory_size)
            .collect();

        // 分离短期和长期记忆
        let mut short_term = Vec::new();
        let mut long_term = Vec::new();

        for memory in older_memories {
            let days = days_between(&memory.end_time, &current_time);
            if days <= self.config.short_term_days as i64 {
                short_term.push(memory);
            } else {
                long_term.push(memory);
            }
        }

        // 处理长期记忆（保留高重要性的）
        let compressed_long_term: Vec<_> = long_term
            .into_iter()
            .filter(|m| m.importance >= MemoryImportance::Medium)
            .collect();

        // 合并结果
        self.store.summaries = working_memory;
        self.store.summaries.extend(short_term);
        self.store.summaries.extend(compressed_long_term);

        self.update_stats();
        self.save();
    }

    /// 获取核心记忆
    pub fn get_core_memories(&self) -> &[String] {
        &self.store.core_memories
    }

    /// 添加核心记忆
    pub fn add_core_memory(&mut self, memory: String) {
        if self.store.core_memories.contains(&memory) {
            return;
        }

        if self.store.core_memories.len() >= self.config.max_core_memories {
            self.store.core_memories.remove(0);
        }

        self.store.core_memories.push(memory);
        self.save();
    }

    /// 移除核心记忆
    pub fn remove_core_memory(&mut self, memory: &str) -> bool {
        if let Some(pos) = self.store.core_memories.iter().position(|m| m == memory) {
            self.store.core_memories.remove(pos);
            self.save();
            true
        } else {
            false
        }
    }

    /// 获取最近 N 条摘要
    pub fn get_recent(&self, count: usize) -> Vec<&ConversationSummary> {
        let mut sorted: Vec<_> = self.store.summaries.iter().collect();
        sorted.sort_by(|a, b| b.end_time.cmp(&a.end_time));
        sorted.into_iter().take(count).collect()
    }

    /// 获取所有摘要
    pub fn get_all(&self) -> &[ConversationSummary] {
        &self.store.summaries
    }

    /// 根据 ID 获取摘要
    pub fn get_by_id(&self, id: &str) -> Option<&ConversationSummary> {
        self.store.summaries.iter().find(|s| s.id == id)
    }

    /// 删除摘要
    pub fn delete_summary(&mut self, id: &str) -> bool {
        if let Some(pos) = self.store.summaries.iter().position(|s| s.id == id) {
            self.store.summaries.remove(pos);
            self.update_stats();
            self.save();
            true
        } else {
            false
        }
    }

    /// 获取统计信息
    pub fn get_stats(&self) -> &ChatMemoryStats {
        &self.store.stats
    }

    /// 导出记忆
    pub fn export(&self) -> String {
        serde_json::to_string_pretty(&self.store).unwrap_or_default()
    }

    /// 导入记忆
    pub fn import(&mut self, data: &str) -> Result<(), String> {
        let parsed: ChatMemoryStore =
            serde_json::from_str(data).map_err(|e| format!("Invalid format: {}", e))?;

        // 合并摘要
        for summary in parsed.summaries {
            if !self.store.summaries.iter().any(|s| s.id == summary.id) {
                self.store.summaries.push(summary);
            }
        }

        // 合并核心记忆
        for memory in parsed.core_memories {
            if !self.store.core_memories.contains(&memory) {
                self.add_core_memory(memory);
            }
        }

        self.update_stats();
        self.save();
        Ok(())
    }

    /// 清空所有记忆
    pub fn clear(&mut self) {
        self.store = Self::create_empty_store(&self.store.project_path);
        self.save();
    }

    // === 私有方法 ===

    fn create_empty_store(project_path: &str) -> ChatMemoryStore {
        let current_time = now();
        ChatMemoryStore {
            version: CHAT_MEMORY_VERSION.to_string(),
            project_path: project_path.to_string(),
            summaries: Vec::new(),
            core_memories: Vec::new(),
            last_updated: current_time.clone(),
            stats: ChatMemoryStats {
                total_conversations: 0,
                total_messages: 0,
                oldest_conversation: current_time.clone(),
                newest_conversation: current_time,
            },
        }
    }

    fn update_stats(&mut self) {
        let summaries = &self.store.summaries;

        self.store.stats.total_conversations = summaries.len();
        self.store.stats.total_messages = summaries.iter().map(|s| s.message_count as usize).sum();

        if !summaries.is_empty() {
            let mut sorted: Vec<_> = summaries.iter().collect();
            sorted.sort_by(|a, b| a.start_time.cmp(&b.start_time));

            self.store.stats.oldest_conversation = sorted.first().unwrap().start_time.clone();
            self.store.stats.newest_conversation = sorted.last().unwrap().end_time.clone();
        }

        self.store.last_updated = now();
    }

    fn load(&mut self) {
        // 加载全局数据
        if let Some(global_store) = self.load_from_dir(&self.global_dir) {
            self.store.summaries = global_store.summaries;
            self.store.core_memories = global_store.core_memories;
        }

        // 加载项目数据并合并
        if let Some(ref project_dir) = self.project_dir {
            if let Some(project_store) = self.load_from_dir(project_dir) {
                for summary in project_store.summaries {
                    if !self.store.summaries.iter().any(|s| s.id == summary.id) {
                        self.store.summaries.push(summary);
                    }
                }
                for memory in project_store.core_memories {
                    if !self.store.core_memories.contains(&memory) {
                        self.store.core_memories.push(memory);
                    }
                }
            }
        }

        self.update_stats();
    }

    fn load_from_dir(&self, dir: &Path) -> Option<ChatMemoryStore> {
        let summaries_path = dir.join(SUMMARIES_FILE);
        if !summaries_path.exists() {
            return None;
        }

        let content = fs::read_to_string(&summaries_path).ok()?;
        serde_json::from_str(&content).ok()
    }

    fn save(&self) {
        self.save_to_dir(&self.global_dir);
        if let Some(ref project_dir) = self.project_dir {
            self.save_to_dir(project_dir);
        }
    }

    fn save_to_dir(&self, dir: &Path) {
        if let Err(e) = fs::create_dir_all(dir) {
            eprintln!("Failed to create directory {:?}: {}", dir, e);
            return;
        }

        let summaries_path = dir.join(SUMMARIES_FILE);
        let core_path = dir.join(CORE_FILE);

        if let Ok(content) = serde_json::to_string_pretty(&self.store) {
            let _ = fs::write(&summaries_path, content);
        }

        let core_data = serde_json::json!({
            "version": CHAT_MEMORY_VERSION,
            "memories": &self.store.core_memories,
            "last_updated": &self.store.last_updated,
        });

        if let Ok(content) = serde_json::to_string_pretty(&core_data) {
            let _ = fs::write(&core_path, content);
        }
    }
}

impl Default for ChatMemory {
    fn default() -> Self {
        Self::new(None, None)
    }
}
