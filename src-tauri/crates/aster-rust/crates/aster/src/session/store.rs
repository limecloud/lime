//! Session 存储抽象层
//!
//! 定义 `SessionStore` trait，允许应用层注入自定义存储实现。
//! 框架层不再直接依赖具体的存储实现（如 SQLite）。

use crate::conversation::message::Message;
use crate::conversation::Conversation;
use crate::model::ModelConfig;
use crate::recipe::Recipe;
use crate::session::extension_data::ExtensionData;
use crate::session::memory::{
    CommitOptions, CommitReport, MemoryCategory, MemoryHealth, MemoryRecord, MemorySearchResult,
    MemoryStats,
};
use crate::session::session_manager::{Session, SessionInsights, SessionType};
use anyhow::Result;
use async_trait::async_trait;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

/// Session 存储 trait
///
/// 应用层可以实现此 trait 来提供自定义的 session 存储。
/// 框架提供默认的 SQLite 实现 (`SqliteSessionStore`)。
#[async_trait]
pub trait SessionStore: Send + Sync {
    /// 创建新 session
    async fn create_session(
        &self,
        working_dir: PathBuf,
        name: String,
        session_type: SessionType,
    ) -> Result<Session>;

    /// 获取 session
    async fn get_session(&self, id: &str, include_messages: bool) -> Result<Session>;

    /// 添加消息到 session
    async fn add_message(&self, session_id: &str, message: &Message) -> Result<()>;

    /// 替换整个对话历史
    async fn replace_conversation(
        &self,
        session_id: &str,
        conversation: &Conversation,
    ) -> Result<()>;

    /// 列出所有 session
    async fn list_sessions(&self) -> Result<Vec<Session>>;

    /// 按类型列出 session
    async fn list_sessions_by_types(&self, types: &[SessionType]) -> Result<Vec<Session>>;

    /// 删除 session
    async fn delete_session(&self, id: &str) -> Result<()>;

    /// 获取统计信息
    async fn get_insights(&self) -> Result<SessionInsights>;

    /// 导出 session 为 JSON
    async fn export_session(&self, id: &str) -> Result<String>;

    /// 从 JSON 导入 session
    async fn import_session(&self, json: &str) -> Result<Session>;

    /// 复制 session
    async fn copy_session(&self, session_id: &str, new_name: String) -> Result<Session>;

    /// 截断对话（删除指定时间戳之后的消息）
    async fn truncate_conversation(&self, session_id: &str, timestamp: i64) -> Result<()>;

    /// 更新 session 名称
    async fn update_session_name(
        &self,
        session_id: &str,
        name: String,
        user_set: bool,
    ) -> Result<()>;

    /// 更新 session 扩展数据
    async fn update_extension_data(
        &self,
        session_id: &str,
        extension_data: ExtensionData,
    ) -> Result<()>;

    /// 更新 session token 统计
    async fn update_token_stats(&self, session_id: &str, stats: TokenStatsUpdate) -> Result<()>;

    /// 更新 session 的 provider 和 model 配置
    async fn update_provider_config(
        &self,
        session_id: &str,
        provider_name: Option<String>,
        model_config: Option<ModelConfig>,
    ) -> Result<()>;

    /// 更新 session 的 recipe 配置
    async fn update_recipe(
        &self,
        session_id: &str,
        recipe: Option<Recipe>,
        user_recipe_values: Option<HashMap<String, String>>,
    ) -> Result<()>;

    /// 搜索聊天历史
    async fn search_chat_history(
        &self,
        query: &str,
        limit: Option<usize>,
        after_date: Option<chrono::DateTime<chrono::Utc>>,
        before_date: Option<chrono::DateTime<chrono::Utc>>,
        exclude_session_id: Option<String>,
    ) -> Result<Vec<ChatHistoryMatch>>;

    /// 将指定 session 的新增消息提交到 memory 子系统
    async fn commit_session(&self, id: &str, options: CommitOptions) -> Result<CommitReport>;

    /// 搜索 memory 记录
    async fn search_memories(
        &self,
        query: &str,
        limit: Option<usize>,
        session_scope: Option<&str>,
        categories: Option<Vec<MemoryCategory>>,
    ) -> Result<Vec<MemorySearchResult>>;

    /// 检索上下文 memory（优先 session scope，不命中时全局兜底）
    async fn retrieve_context_memories(
        &self,
        session_id: &str,
        query: &str,
        limit: usize,
    ) -> Result<Vec<MemoryRecord>>;

    /// 获取 memory 统计信息
    async fn memory_stats(&self) -> Result<MemoryStats>;

    /// 获取 memory 健康状态
    async fn memory_health(&self) -> Result<MemoryHealth>;
}

/// 聊天历史搜索结果
#[derive(Debug, Clone)]
pub struct ChatHistoryMatch {
    pub session_id: String,
    pub session_name: String,
    pub message_role: String,
    pub message_content: String,
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub relevance_score: f32,
}

/// Token 统计更新参数
#[derive(Debug, Clone, Default)]
pub struct TokenStatsUpdate {
    pub schedule_id: Option<String>,
    pub total_tokens: Option<i32>,
    pub input_tokens: Option<i32>,
    pub output_tokens: Option<i32>,
    pub cached_input_tokens: Option<i32>,
    pub cache_creation_input_tokens: Option<i32>,
    pub accumulated_total: Option<i32>,
    pub accumulated_input: Option<i32>,
    pub accumulated_output: Option<i32>,
}

/// 空存储实现（不保存任何数据）
///
/// 用于不需要持久化的场景，如测试或无状态 API 服务。
pub struct NoopSessionStore;

#[async_trait]
impl SessionStore for NoopSessionStore {
    async fn create_session(
        &self,
        working_dir: PathBuf,
        name: String,
        session_type: SessionType,
    ) -> Result<Session> {
        Ok(Session {
            id: uuid::Uuid::new_v4().to_string(),
            working_dir,
            name,
            user_set_name: false,
            session_type,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            extension_data: ExtensionData::default(),
            total_tokens: None,
            input_tokens: None,
            output_tokens: None,
            cached_input_tokens: None,
            cache_creation_input_tokens: None,
            accumulated_total_tokens: None,
            accumulated_input_tokens: None,
            accumulated_output_tokens: None,
            schedule_id: None,
            recipe: None,
            user_recipe_values: None,
            conversation: Some(Conversation::default()),
            message_count: 0,
            provider_name: None,
            model_config: None,
        })
    }

    async fn get_session(&self, _id: &str, _include_messages: bool) -> Result<Session> {
        Err(anyhow::anyhow!("NoopSessionStore: session not found"))
    }

    async fn add_message(&self, _session_id: &str, _message: &Message) -> Result<()> {
        Ok(()) // 静默忽略
    }

    async fn replace_conversation(
        &self,
        _session_id: &str,
        _conversation: &Conversation,
    ) -> Result<()> {
        Ok(())
    }

    async fn list_sessions(&self) -> Result<Vec<Session>> {
        Ok(vec![])
    }

    async fn list_sessions_by_types(&self, _types: &[SessionType]) -> Result<Vec<Session>> {
        Ok(vec![])
    }

    async fn delete_session(&self, _id: &str) -> Result<()> {
        Ok(())
    }

    async fn get_insights(&self) -> Result<SessionInsights> {
        Ok(SessionInsights {
            total_sessions: 0,
            total_tokens: 0,
        })
    }

    async fn export_session(&self, _id: &str) -> Result<String> {
        Err(anyhow::anyhow!("NoopSessionStore: export not supported"))
    }

    async fn import_session(&self, _json: &str) -> Result<Session> {
        Err(anyhow::anyhow!("NoopSessionStore: import not supported"))
    }

    async fn copy_session(&self, _session_id: &str, _new_name: String) -> Result<Session> {
        Err(anyhow::anyhow!("NoopSessionStore: copy not supported"))
    }

    async fn truncate_conversation(&self, _session_id: &str, _timestamp: i64) -> Result<()> {
        Ok(())
    }

    async fn update_session_name(
        &self,
        _session_id: &str,
        _name: String,
        _user_set: bool,
    ) -> Result<()> {
        Ok(())
    }

    async fn update_extension_data(
        &self,
        _session_id: &str,
        _extension_data: ExtensionData,
    ) -> Result<()> {
        Ok(())
    }

    async fn update_token_stats(&self, _session_id: &str, _stats: TokenStatsUpdate) -> Result<()> {
        Ok(())
    }

    async fn update_provider_config(
        &self,
        _session_id: &str,
        _provider_name: Option<String>,
        _model_config: Option<ModelConfig>,
    ) -> Result<()> {
        Ok(())
    }

    async fn update_recipe(
        &self,
        _session_id: &str,
        _recipe: Option<Recipe>,
        _user_recipe_values: Option<HashMap<String, String>>,
    ) -> Result<()> {
        Ok(())
    }

    async fn search_chat_history(
        &self,
        _query: &str,
        _limit: Option<usize>,
        _after_date: Option<chrono::DateTime<chrono::Utc>>,
        _before_date: Option<chrono::DateTime<chrono::Utc>>,
        _exclude_session_id: Option<String>,
    ) -> Result<Vec<ChatHistoryMatch>> {
        Ok(vec![])
    }

    async fn commit_session(&self, id: &str, _options: CommitOptions) -> Result<CommitReport> {
        Ok(CommitReport {
            session_id: id.to_string(),
            messages_scanned: 0,
            memories_created: 0,
            memories_merged: 0,
            source_start_ts: None,
            source_end_ts: None,
            warnings: vec!["NoopSessionStore: memory commit skipped".to_string()],
        })
    }

    async fn search_memories(
        &self,
        _query: &str,
        _limit: Option<usize>,
        _session_scope: Option<&str>,
        _categories: Option<Vec<MemoryCategory>>,
    ) -> Result<Vec<MemorySearchResult>> {
        Ok(vec![])
    }

    async fn retrieve_context_memories(
        &self,
        _session_id: &str,
        _query: &str,
        _limit: usize,
    ) -> Result<Vec<MemoryRecord>> {
        Ok(vec![])
    }

    async fn memory_stats(&self) -> Result<MemoryStats> {
        Ok(MemoryStats::default())
    }

    async fn memory_health(&self) -> Result<MemoryHealth> {
        Ok(MemoryHealth {
            healthy: true,
            message: "NoopSessionStore: memory subsystem disabled".to_string(),
        })
    }
}

/// 全局 session store 实例
///
/// 用于向后兼容，允许现有代码继续使用 `SessionManager::` 静态方法。
/// 新代码应该使用 `Agent::with_session_store()` 注入存储。
static GLOBAL_SESSION_STORE: tokio::sync::OnceCell<Arc<dyn SessionStore>> =
    tokio::sync::OnceCell::const_new();

/// 设置全局 session store
///
/// 必须在使用 `SessionManager` 静态方法之前调用。
/// 通常在应用启动时调用一次。
pub async fn install_global_session_store(store: Arc<dyn SessionStore>) -> Result<()> {
    GLOBAL_SESSION_STORE
        .set(store)
        .map_err(|_| anyhow::anyhow!("Global session store already set"))
}

/// 获取全局 session store
///
/// 如果未设置，返回错误。
pub fn get_global_session_store() -> Result<Arc<dyn SessionStore>> {
    GLOBAL_SESSION_STORE
        .get()
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("Global session store not initialized"))
}

/// 检查全局 session store 是否已设置
pub fn is_global_session_store_set() -> bool {
    GLOBAL_SESSION_STORE.get().is_some()
}
