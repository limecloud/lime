//! 会话上下文管理服务
//!
//! 提供会话上下文的持久化、恢复和智能管理功能，解决 AI 对话中的上下文丢失问题

use crate::ai_summary_service::AISummaryService;
use lime_core::database::dao::chat::{ChatDao, ChatMessage as UnifiedChatMessage, ChatMode};
use lime_core::general_chat::{ChatMessage, MessageRole};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tracing::{debug, info, warn};

/// 会话上下文摘要
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionSummary {
    /// 会话 ID
    pub session_id: String,
    /// 摘要内容
    pub summary: String,
    /// 关键主题
    pub key_topics: Vec<String>,
    /// 重要决策
    pub decisions: Vec<String>,
    /// 创建时间
    pub created_at: i64,
    /// 覆盖的消息数量
    pub message_count: i32,
    /// 最后消息 ID
    pub last_message_id: String,
}

/// 上下文窗口配置
#[derive(Debug, Clone)]
pub struct ContextWindowConfig {
    /// 最大消息数量
    pub max_messages: usize,
    /// 最大字符数
    pub max_characters: usize,
    /// 是否启用智能摘要
    pub enable_smart_summary: bool,
    /// 摘要触发阈值（消息数量）
    pub summary_threshold: usize,
}

impl Default for ContextWindowConfig {
    fn default() -> Self {
        Self {
            max_messages: 50,
            max_characters: 100000,
            enable_smart_summary: true,
            summary_threshold: 30,
        }
    }
}

/// 会话上下文管理器
pub struct SessionContextService {
    /// 数据库连接
    db_connection: Arc<Mutex<Connection>>,
    /// 配置
    config: ContextWindowConfig,
    /// 会话摘要缓存
    summary_cache: Arc<Mutex<HashMap<String, SessionSummary>>>,
    /// AI 摘要服务（可选）
    ai_summary_service: Option<Arc<AISummaryService>>,
}

impl SessionContextService {
    /// 创建新的会话上下文服务
    pub fn new(db_connection: Arc<Mutex<Connection>>, config: ContextWindowConfig) -> Self {
        Self {
            db_connection,
            config,
            summary_cache: Arc::new(Mutex::new(HashMap::new())),
            ai_summary_service: None,
        }
    }

    /// 创建带 AI 摘要服务的会话上下文服务
    pub fn new_with_ai_summary(
        db_connection: Arc<Mutex<Connection>>,
        config: ContextWindowConfig,
        ai_summary_service: Arc<AISummaryService>,
    ) -> Self {
        Self {
            db_connection,
            config,
            summary_cache: Arc::new(Mutex::new(HashMap::new())),
            ai_summary_service: Some(ai_summary_service),
        }
    }

    /// 获取会话的有效上下文
    ///
    /// 返回适合发送给 AI 的消息列表，包括摘要和最近的消息
    pub async fn get_effective_context(
        &self,
        session_id: &str,
    ) -> Result<Vec<ChatMessage>, String> {
        let conn = self.db_connection.lock().map_err(|e| e.to_string())?;

        let all_messages = Self::load_session_messages(&conn, session_id)?;

        if all_messages.is_empty() {
            return Ok(vec![]);
        }

        // 检查是否需要应用上下文窗口限制
        if all_messages.len() <= self.config.max_messages {
            let total_chars: usize = all_messages.iter().map(|m| m.content.len()).sum();
            if total_chars <= self.config.max_characters {
                return Ok(all_messages);
            }
        }

        // 需要应用上下文管理
        self.apply_context_window_management(session_id, all_messages)
            .await
    }

    /// 应用上下文窗口管理
    async fn apply_context_window_management(
        &self,
        session_id: &str,
        all_messages: Vec<ChatMessage>,
    ) -> Result<Vec<ChatMessage>, String> {
        let mut result = Vec::new();

        // 如果启用智能摘要且消息数量超过阈值
        if self.config.enable_smart_summary && all_messages.len() > self.config.summary_threshold {
            // 尝试获取或创建摘要
            if let Ok(summary) = self.get_or_create_summary(session_id, &all_messages).await {
                // 添加摘要作为系统消息
                let summary_message = ChatMessage {
                    id: format!("summary-{session_id}"),
                    session_id: session_id.to_string(),
                    role: MessageRole::System,
                    content: format!(
                        "会话摘要（基于前 {} 条消息）：\n{}\n\n关键主题：{}\n重要决策：{}",
                        summary.message_count,
                        summary.summary,
                        summary.key_topics.join(", "),
                        summary.decisions.join("; ")
                    ),
                    blocks: None,
                    status: "complete".to_string(),
                    created_at: summary.created_at,
                    metadata: None,
                };
                result.push(summary_message);

                // 找到摘要覆盖的最后一条消息的位置
                if let Some(last_idx) = all_messages
                    .iter()
                    .position(|m| m.id == summary.last_message_id)
                {
                    // 添加摘要之后的消息
                    let remaining_messages: Vec<_> =
                        all_messages.into_iter().skip(last_idx + 1).collect();

                    result.extend(self.select_recent_messages(remaining_messages)?);
                } else {
                    // 如果找不到对应的消息，使用最近的消息
                    result.extend(self.select_recent_messages(all_messages)?);
                }
            } else {
                // 摘要创建失败，使用最近的消息
                result.extend(self.select_recent_messages(all_messages)?);
            }
        } else {
            // 不使用摘要，直接选择最近的消息
            result.extend(self.select_recent_messages(all_messages)?);
        }

        Ok(result)
    }

    fn load_session_messages(
        conn: &Connection,
        session_id: &str,
    ) -> Result<Vec<ChatMessage>, String> {
        let session =
            ChatDao::get_session(conn, session_id).map_err(|e| format!("获取统一会话失败: {e}"))?;

        let Some(session) = session else {
            debug!("会话 {} 未命中 unified chat，跳过上下文加载", session_id);
            return Ok(vec![]);
        };

        if session.mode != ChatMode::General {
            debug!(
                "会话 {} 不是 general 模式，跳过上下文加载: {:?}",
                session_id, session.mode
            );
            return Ok(vec![]);
        }

        ChatDao::get_messages(conn, session_id, None)
            .map_err(|e| format!("获取统一消息失败: {e}"))
            .map(|messages| {
                messages
                    .into_iter()
                    .map(Self::convert_unified_message)
                    .collect()
            })
    }

    fn convert_unified_message(message: UnifiedChatMessage) -> ChatMessage {
        ChatMessage {
            id: message.id.to_string(),
            session_id: message.session_id,
            role: Self::convert_unified_role(&message.role),
            content: Self::extract_unified_text_content(&message.content),
            blocks: None,
            status: "complete".to_string(),
            created_at: Self::parse_unified_timestamp(&message.created_at),
            metadata: message.metadata,
        }
    }

    fn convert_unified_role(role: &str) -> MessageRole {
        match role {
            "assistant" => MessageRole::Assistant,
            "system" => MessageRole::System,
            _ => MessageRole::User,
        }
    }

    fn extract_unified_text_content(content: &serde_json::Value) -> String {
        match content {
            serde_json::Value::Null => String::new(),
            serde_json::Value::String(text) => text.clone(),
            serde_json::Value::Array(items) => {
                let parts: Vec<String> = items
                    .iter()
                    .filter_map(Self::extract_unified_text_fragment)
                    .filter(|text| !text.trim().is_empty())
                    .collect();

                if parts.is_empty() {
                    content.to_string()
                } else {
                    parts.join("\n")
                }
            }
            serde_json::Value::Object(_) => {
                Self::extract_unified_text_fragment(content).unwrap_or_else(|| content.to_string())
            }
            _ => content.to_string(),
        }
    }

    fn extract_unified_text_fragment(value: &serde_json::Value) -> Option<String> {
        match value {
            serde_json::Value::Null => None,
            serde_json::Value::String(text) => Some(text.clone()),
            serde_json::Value::Array(items) => {
                let parts: Vec<String> = items
                    .iter()
                    .filter_map(Self::extract_unified_text_fragment)
                    .filter(|text| !text.trim().is_empty())
                    .collect();

                if parts.is_empty() {
                    None
                } else {
                    Some(parts.join("\n"))
                }
            }
            serde_json::Value::Object(map) => map
                .get("text")
                .and_then(|value| value.as_str())
                .or_else(|| map.get("content").and_then(|value| value.as_str()))
                .or_else(|| map.get("value").and_then(|value| value.as_str()))
                .map(ToString::to_string),
            _ => None,
        }
    }

    fn parse_unified_timestamp(timestamp: &str) -> i64 {
        chrono::DateTime::parse_from_rfc3339(timestamp)
            .map(|value| value.timestamp_millis())
            .or_else(|_| timestamp.parse::<i64>())
            .unwrap_or_default()
    }

    /// 选择最近的消息，确保不超过配置限制
    fn select_recent_messages(
        &self,
        messages: Vec<ChatMessage>,
    ) -> Result<Vec<ChatMessage>, String> {
        let mut selected = Vec::new();
        let mut char_count = 0;

        // 从最新的消息开始选择
        for message in messages.into_iter().rev() {
            let message_chars = message.content.len();

            // 检查是否会超过限制
            if selected.len() >= self.config.max_messages
                || char_count + message_chars > self.config.max_characters
            {
                break;
            }

            char_count += message_chars;
            selected.push(message);
        }

        // 恢复正确的时间顺序
        selected.reverse();
        Ok(selected)
    }

    /// 获取或创建会话摘要
    async fn get_or_create_summary(
        &self,
        session_id: &str,
        messages: &[ChatMessage],
    ) -> Result<SessionSummary, String> {
        // 检查缓存
        {
            let cache = self.summary_cache.lock().map_err(|e| e.to_string())?;
            if let Some(summary) = cache.get(session_id) {
                return Ok(summary.clone());
            }
        }

        // 创建新摘要
        let summary = self.create_summary(session_id, messages).await?;

        // 缓存摘要
        {
            let mut cache = self.summary_cache.lock().map_err(|e| e.to_string())?;
            cache.insert(session_id.to_string(), summary.clone());
        }

        Ok(summary)
    }

    /// 创建会话摘要（优先使用 AI，失败时降级到本地）
    async fn create_summary(
        &self,
        session_id: &str,
        messages: &[ChatMessage],
    ) -> Result<SessionSummary, String> {
        if messages.is_empty() {
            return Err("无法为空消息列表创建摘要".to_string());
        }

        // 计算要摘要的消息数量（前 N 条消息）
        let summary_count = (messages.len() * 2 / 3).min(self.config.summary_threshold);
        let messages_to_summarize = &messages[..summary_count];

        // 尝试使用 AI 摘要
        if let Some(ai_service) = &self.ai_summary_service {
            match ai_service.generate_summary(messages_to_summarize).await {
                Ok(ai_summary) => {
                    info!("AI 摘要生成成功，会话: {}", session_id);
                    let last_message = messages_to_summarize.last().unwrap();
                    return Ok(SessionSummary {
                        session_id: session_id.to_string(),
                        summary: ai_summary.summary,
                        key_topics: ai_summary.key_topics,
                        decisions: ai_summary.decisions,
                        created_at: chrono::Utc::now().timestamp_millis(),
                        message_count: summary_count as i32,
                        last_message_id: last_message.id.clone(),
                    });
                }
                Err(e) => {
                    warn!("AI 摘要生成失败，降级到本地摘要: {}", e);
                }
            }
        }

        // 降级到本地关键词提取
        self.create_summary_local(session_id, messages_to_summarize)
    }

    /// 本地关键词提取摘要（保留作为降级方案）
    fn create_summary_local(
        &self,
        session_id: &str,
        messages_to_summarize: &[ChatMessage],
    ) -> Result<SessionSummary, String> {
        // 提取关键信息
        let mut key_topics = Vec::new();
        let mut decisions = Vec::new();
        let mut content_parts = Vec::new();

        for message in messages_to_summarize {
            content_parts.push(format!("{:?}: {}", message.role, message.content));

            // 简单的关键词提取
            if message.content.contains("决定") || message.content.contains("选择") {
                decisions.push(self.extract_decision(&message.content));
            }

            // 提取主题关键词
            key_topics.extend(self.extract_topics(&message.content));
        }

        // 去重并限制数量
        key_topics.sort();
        key_topics.dedup();
        key_topics.truncate(10);

        decisions.truncate(5);

        // 创建摘要
        let summary_content = if content_parts.len() > 10 {
            format!(
                "本会话包含 {} 条消息，主要讨论了以下内容：\n{}",
                messages_to_summarize.len(),
                content_parts
                    .join("\n")
                    .chars()
                    .take(1000)
                    .collect::<String>()
            )
        } else {
            content_parts.join("\n")
        };

        let last_message = messages_to_summarize.last().unwrap();

        Ok(SessionSummary {
            session_id: session_id.to_string(),
            summary: summary_content,
            key_topics,
            decisions,
            created_at: chrono::Utc::now().timestamp_millis(),
            message_count: messages_to_summarize.len() as i32,
            last_message_id: last_message.id.clone(),
        })
    }

    /// 提取决策信息
    fn extract_decision(&self, content: &str) -> String {
        // 简单的决策提取逻辑
        let sentences: Vec<&str> = content.split('。').collect();
        for sentence in sentences {
            if sentence.contains("决定") || sentence.contains("选择") {
                return sentence.trim().to_string();
            }
        }
        content.chars().take(100).collect()
    }

    /// 提取主题关键词
    fn extract_topics(&self, content: &str) -> Vec<String> {
        let mut topics = Vec::new();

        // 简单的关键词提取
        let keywords = [
            "项目",
            "功能",
            "问题",
            "解决",
            "实现",
            "设计",
            "架构",
            "代码",
            "数据库",
            "API",
            "前端",
            "后端",
            "测试",
            "部署",
            "优化",
            "性能",
        ];

        for keyword in &keywords {
            if content.contains(keyword) {
                topics.push(keyword.to_string());
            }
        }

        topics
    }

    /// 清理会话摘要缓存
    pub fn clear_summary_cache(&self, session_id: Option<&str>) -> Result<(), String> {
        let mut cache = self.summary_cache.lock().map_err(|e| e.to_string())?;

        if let Some(id) = session_id {
            cache.remove(id);
            info!("已清理会话 {} 的摘要缓存", id);
        } else {
            cache.clear();
            info!("已清理所有会话摘要缓存");
        }

        Ok(())
    }

    /// 获取会话统计信息
    pub fn get_session_stats(&self, session_id: &str) -> Result<SessionStats, String> {
        let conn = self.db_connection.lock().map_err(|e| e.to_string())?;

        let messages = Self::load_session_messages(&conn, session_id)?;
        let message_count = messages.len();

        let total_characters: usize = messages.iter().map(|m| m.content.len()).sum();
        let user_messages = messages
            .iter()
            .filter(|m| matches!(m.role, MessageRole::User))
            .count();
        let assistant_messages = messages
            .iter()
            .filter(|m| matches!(m.role, MessageRole::Assistant))
            .count();

        let needs_summary =
            self.config.enable_smart_summary && message_count > self.config.summary_threshold;

        let exceeds_context_window = message_count > self.config.max_messages
            || total_characters > self.config.max_characters;

        Ok(SessionStats {
            session_id: session_id.to_string(),
            total_messages: message_count,
            user_messages,
            assistant_messages,
            total_characters,
            needs_summary,
            exceeds_context_window,
            has_cached_summary: {
                let cache = self.summary_cache.lock().map_err(|e| e.to_string())?;
                cache.contains_key(session_id)
            },
        })
    }

    /// 预热会话上下文（提前创建摘要）
    pub async fn preheat_session_context(&self, session_id: &str) -> Result<(), String> {
        let conn = self.db_connection.lock().map_err(|e| e.to_string())?;

        let messages = Self::load_session_messages(&conn, session_id)?;

        if messages.len() > self.config.summary_threshold {
            debug!("为会话 {} 预热上下文", session_id);
            self.get_or_create_summary(session_id, &messages).await?;
            info!("会话 {} 上下文预热完成", session_id);
        }

        Ok(())
    }
}

/// 会话统计信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionStats {
    pub session_id: String,
    pub total_messages: usize,
    pub user_messages: usize,
    pub assistant_messages: usize,
    pub total_characters: usize,
    pub needs_summary: bool,
    pub exceeds_context_window: bool,
    pub has_cached_summary: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use lime_core::database::dao::chat::{
        ChatDao, ChatMessage as UnifiedChatMessage, ChatMode, ChatSession as UnifiedChatSession,
    };
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();

        conn.execute(
            "CREATE TABLE agent_sessions (
                id TEXT PRIMARY KEY,
                model TEXT NOT NULL,
                system_prompt TEXT,
                title TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                working_dir TEXT,
                execution_strategy TEXT NOT NULL DEFAULT 'react'
            )",
            [],
        )
        .unwrap();

        conn.execute(
            "CREATE TABLE agent_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content_json TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                tool_calls_json TEXT,
                tool_call_id TEXT,
                reasoning_content TEXT,
                input_tokens INTEGER,
                output_tokens INTEGER,
                FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE
            )",
            [],
        )
        .unwrap();

        conn.execute(
            "CREATE TABLE settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            [],
        )
        .unwrap();

        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();
        conn
    }

    fn create_unified_general_session(session_id: &str) -> UnifiedChatSession {
        let now = chrono::Utc::now().to_rfc3339();
        UnifiedChatSession {
            id: session_id.to_string(),
            mode: ChatMode::General,
            title: Some("测试会话".to_string()),
            system_prompt: None,
            model: None,
            provider_type: None,
            credential_uuid: None,
            metadata: None,
            created_at: now.clone(),
            updated_at: now,
        }
    }

    fn create_unified_messages(session_id: &str, count: usize) -> Vec<UnifiedChatMessage> {
        let base_time = chrono::Utc::now();

        (0..count)
            .map(|index| {
                let role = if index % 2 == 0 { "user" } else { "assistant" };
                let content = format!("这是第 {} 条消息，包含一些测试内容", index + 1);

                UnifiedChatMessage {
                    id: 0,
                    session_id: session_id.to_string(),
                    role: role.to_string(),
                    content: serde_json::json!([{ "type": "text", "text": content }]),
                    tool_calls: None,
                    tool_call_id: None,
                    metadata: None,
                    created_at: (base_time + chrono::Duration::milliseconds(index as i64))
                        .to_rfc3339(),
                }
            })
            .collect()
    }

    #[tokio::test]
    async fn test_context_service_creation() {
        let conn = Arc::new(Mutex::new(setup_test_db()));
        let config = ContextWindowConfig::default();
        let service = SessionContextService::new(conn, config);

        assert!(service.summary_cache.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_get_effective_context_small_session() {
        let conn = Arc::new(Mutex::new(setup_test_db()));
        let config = ContextWindowConfig {
            max_messages: 50,
            max_characters: 100000,
            enable_smart_summary: true,
            summary_threshold: 30,
        };
        let service = SessionContextService::new(conn.clone(), config);

        {
            let conn_guard = conn.lock().unwrap();
            ChatDao::create_session(&conn_guard, &create_unified_general_session("test-session"))
                .unwrap();

            let messages = create_unified_messages("test-session", 5);
            for msg in &messages {
                ChatDao::add_message(&conn_guard, msg).unwrap();
            }
        }

        // 获取有效上下文
        let context = service.get_effective_context("test-session").await.unwrap();
        assert_eq!(context.len(), 5);
    }

    #[test]
    fn test_session_stats() {
        let conn = Arc::new(Mutex::new(setup_test_db()));
        let config = ContextWindowConfig::default();
        let service = SessionContextService::new(conn.clone(), config);

        {
            let conn_guard = conn.lock().unwrap();
            ChatDao::create_session(&conn_guard, &create_unified_general_session("test-session"))
                .unwrap();

            let messages = create_unified_messages("test-session", 10);
            for msg in &messages {
                ChatDao::add_message(&conn_guard, msg).unwrap();
            }
        }

        let stats = service.get_session_stats("test-session").unwrap();
        assert_eq!(stats.total_messages, 10);
        assert_eq!(stats.user_messages, 5);
        assert_eq!(stats.assistant_messages, 5);
        assert!(!stats.needs_summary); // 少于阈值
        assert!(!stats.exceeds_context_window);
    }

    #[test]
    fn test_clear_summary_cache() {
        let conn = Arc::new(Mutex::new(setup_test_db()));
        let config = ContextWindowConfig::default();
        let service = SessionContextService::new(conn, config);

        // 手动添加缓存项
        {
            let mut cache = service.summary_cache.lock().unwrap();
            cache.insert(
                "session-1".to_string(),
                SessionSummary {
                    session_id: "session-1".to_string(),
                    summary: "测试摘要".to_string(),
                    key_topics: vec!["测试".to_string()],
                    decisions: vec![],
                    created_at: chrono::Utc::now().timestamp_millis(),
                    message_count: 10,
                    last_message_id: "msg-10".to_string(),
                },
            );
        }

        assert_eq!(service.summary_cache.lock().unwrap().len(), 1);

        // 清理特定会话
        service.clear_summary_cache(Some("session-1")).unwrap();
        assert_eq!(service.summary_cache.lock().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn test_get_effective_context_returns_empty_when_unified_session_missing() {
        let conn = Arc::new(Mutex::new(setup_test_db()));
        let service = SessionContextService::new(conn.clone(), ContextWindowConfig::default());

        let context = service
            .get_effective_context("legacy-session")
            .await
            .unwrap();
        assert!(context.is_empty());
    }

    #[tokio::test]
    async fn test_get_effective_context_keeps_empty_when_general_migration_completed() {
        let conn = Arc::new(Mutex::new(setup_test_db()));
        let service = SessionContextService::new(conn.clone(), ContextWindowConfig::default());

        {
            let conn_guard = conn.lock().unwrap();
            conn_guard
                .execute(
                    "INSERT INTO settings (key, value) VALUES (?1, ?2)",
                    rusqlite::params!["migrated_general_chat_to_unified", "true"],
                )
                .unwrap();
        }

        let context = service
            .get_effective_context("legacy-session")
            .await
            .unwrap();
        assert!(context.is_empty());
    }

    #[tokio::test]
    async fn test_non_general_unified_session_returns_empty_context() {
        let conn = Arc::new(Mutex::new(setup_test_db()));
        let service = SessionContextService::new(conn.clone(), ContextWindowConfig::default());

        {
            let conn_guard = conn.lock().unwrap();
            let now = chrono::Utc::now().to_rfc3339();
            ChatDao::create_session(
                &conn_guard,
                &UnifiedChatSession {
                    id: "agent-session".to_string(),
                    mode: ChatMode::Agent,
                    title: Some("Agent 会话".to_string()),
                    system_prompt: None,
                    model: Some("claude-sonnet-4".to_string()),
                    provider_type: None,
                    credential_uuid: None,
                    metadata: None,
                    created_at: now.clone(),
                    updated_at: now,
                },
            )
            .unwrap();
        }

        let context = service
            .get_effective_context("agent-session")
            .await
            .unwrap();
        assert!(context.is_empty());
    }
}
