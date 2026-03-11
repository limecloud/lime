//! Aster SessionStore 实现
//!
//! 实现 aster::session::SessionStore trait，将 aster 的会话数据
//! 存储到 ProxyCast 的 SQLite 数据库中。
//!
//! 这是应用层接管框架层存储的关键桥接模块。

use anyhow::{anyhow, Result};
use aster::conversation::message::{Message, MessageContent};
use aster::conversation::Conversation;
use aster::model::ModelConfig;
use aster::recipe::Recipe;
use aster::session::extension_data::ExtensionData;
use aster::session::{
    ChatHistoryMatch, CommitOptions, CommitReport, MemoryCategory, MemoryHealth, MemoryRecord,
    MemorySearchResult, MemoryStats, Session, SessionInsights, SessionStore, SessionType,
    TokenStatsUpdate,
};
use async_trait::async_trait;
use chrono::Utc;
use proxycast_core::database::DbConnection;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

/// ProxyCast 的 SessionStore 实现
///
/// 将 aster 的会话数据存储到 ProxyCast 的 SQLite 数据库
pub struct ProxyCastSessionStore {
    db: DbConnection,
}

impl ProxyCastSessionStore {
    /// 创建新的 SessionStore 实例
    pub fn new(db: DbConnection) -> Self {
        Self { db }
    }

    /// 将 Message 的 role 转换为字符串
    /// 通过检查 Message::user() 和 Message::assistant() 的 role 来判断
    fn message_role_to_string(message: &Message) -> String {
        // 使用 Debug 格式来获取 role 字符串
        let role_debug = format!("{:?}", message.role);
        if role_debug.contains("User") {
            "user".to_string()
        } else {
            "assistant".to_string()
        }
    }

    /// 解析会话 working_dir（优先默认 workspace，其次应用默认项目目录）
    fn resolve_session_working_dir(conn: &rusqlite::Connection) -> PathBuf {
        // 1) 优先使用默认 workspace（is_default = 1）
        let default_workspace_path: Option<String> = conn
            .query_row(
                "SELECT root_path FROM workspaces WHERE is_default = 1 LIMIT 1",
                [],
                |row| row.get(0),
            )
            .ok();

        if let Some(path) = default_workspace_path {
            if !path.trim().is_empty() {
                let pb = PathBuf::from(path);
                return if pb.is_absolute() {
                    pb
                } else {
                    std::env::current_dir()
                        .unwrap_or_else(|_| PathBuf::from("."))
                        .join(pb)
                };
            }
        }

        // 2) 回退到 ~/.proxycast/projects/default
        if let Some(home) = dirs::home_dir() {
            let fallback = home.join(".proxycast").join("projects").join("default");
            if !fallback.exists() {
                let _ = fs::create_dir_all(&fallback);
            }
            return fallback;
        }

        // 3) 最终回退到进程当前目录
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    }

    /// 标准化 working_dir（相对路径转绝对路径）
    fn normalize_working_dir(path: PathBuf) -> PathBuf {
        if path.is_absolute() {
            path
        } else {
            std::env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join(path)
        }
    }

    /// 从数据库字段解析会话 working_dir（为空时回退默认 workspace）
    fn parse_session_working_dir(
        conn: &rusqlite::Connection,
        working_dir: Option<String>,
    ) -> PathBuf {
        match working_dir {
            Some(path) if !path.trim().is_empty() => {
                Self::normalize_working_dir(PathBuf::from(path))
            }
            _ => Self::resolve_session_working_dir(conn),
        }
    }
}

#[async_trait]
impl SessionStore for ProxyCastSessionStore {
    async fn create_session(
        &self,
        working_dir: PathBuf,
        name: String,
        session_type: SessionType,
    ) -> Result<Session> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now();
        let now_str = now.to_rfc3339();

        let conn = self.db.lock().map_err(|e| anyhow!("数据库锁定失败: {e}"))?;

        let type_str = session_type.to_string();

        conn.execute(
            "INSERT INTO agent_sessions (id, model, system_prompt, title, created_at, updated_at, working_dir)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                id,
                type_str,
                None::<String>,
                name,
                now_str,
                now_str,
                working_dir.to_string_lossy().to_string()
            ],
        )
        .map_err(|e| anyhow!("创建会话失败: {e}"))?;

        Ok(Session {
            id,
            working_dir,
            name,
            user_set_name: false,
            session_type,
            created_at: now,
            updated_at: now,
            extension_data: ExtensionData::default(),
            total_tokens: None,
            input_tokens: None,
            output_tokens: None,
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

    async fn get_session(&self, id: &str, include_messages: bool) -> Result<Session> {
        tracing::info!(
            "[SessionStore] get_session 被调用: id={}, include_messages={}",
            id,
            include_messages
        );

        let conn = self.db.lock().map_err(|e| anyhow!("数据库锁定失败: {e}"))?;

        // 检查 session 是否存在
        let session_exists: bool = conn
            .query_row("SELECT 1 FROM agent_sessions WHERE id = ?", [id], |_| {
                Ok(true)
            })
            .unwrap_or(false);

        tracing::info!("[SessionStore] session_exists={}", session_exists);

        // 如果不存在，自动创建
        if !session_exists {
            let now = Utc::now().to_rfc3339();
            let working_dir = Self::resolve_session_working_dir(&conn);
            conn.execute(
                "INSERT INTO agent_sessions (id, model, system_prompt, title, created_at, updated_at, working_dir)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    id,
                    "agent:default",
                    None::<String>,
                    "新对话",
                    now,
                    now,
                    working_dir.to_string_lossy().to_string()
                ],
            )
            .map_err(|e| anyhow!("自动创建会话失败: {e}"))?;
            tracing::info!("[SessionStore] get_session 自动创建会话: {}", id);
        }

        let mut stmt = conn
            .prepare(
                "SELECT id, model, system_prompt, title, created_at, updated_at, working_dir
                 FROM agent_sessions WHERE id = ?",
            )
            .map_err(|e| anyhow!("准备查询失败: {e}"))?;

        let session_row = stmt
            .query_row([id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, Option<String>>(6)?,
                ))
            })
            .map_err(|e| anyhow!("会话不存在: {e}"))?;

        let (id, model, _system_prompt, title, created_at, updated_at, db_working_dir) =
            session_row;

        let created_at = chrono::DateTime::parse_from_rfc3339(&created_at)
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now());
        let updated_at = chrono::DateTime::parse_from_rfc3339(&updated_at)
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now());

        let session_type = model.parse().unwrap_or(SessionType::User);
        let working_dir = Self::parse_session_working_dir(&conn, db_working_dir);

        let conversation = if include_messages {
            Some(self.load_conversation(&conn, &id)?)
        } else {
            None
        };

        let message_count = self.count_messages(&conn, &id)?;

        Ok(Session {
            id: id.to_string(),
            working_dir,
            name: title.unwrap_or_else(|| "未命名会话".to_string()),
            user_set_name: false,
            session_type,
            created_at,
            updated_at,
            extension_data: ExtensionData::default(),
            total_tokens: None,
            input_tokens: None,
            output_tokens: None,
            accumulated_total_tokens: None,
            accumulated_input_tokens: None,
            accumulated_output_tokens: None,
            schedule_id: None,
            recipe: None,
            user_recipe_values: None,
            conversation,
            message_count,
            provider_name: None,
            model_config: match model.trim() {
                "" | "agent:default" => None,
                normalized => ModelConfig::new(normalized).ok(),
            },
        })
    }

    async fn add_message(&self, session_id: &str, message: &Message) -> Result<()> {
        tracing::info!(
            "[SessionStore] add_message 被调用: session_id={}",
            session_id
        );

        let conn = self.db.lock().map_err(|e| anyhow!("数据库锁定失败: {e}"))?;

        // 检查会话是否存在，如果不存在则自动创建
        let session_exists: bool = conn
            .query_row(
                "SELECT 1 FROM agent_sessions WHERE id = ?",
                [session_id],
                |_| Ok(true),
            )
            .unwrap_or(false);

        if !session_exists {
            let now = Utc::now().to_rfc3339();
            let working_dir = Self::resolve_session_working_dir(&conn);
            conn.execute(
                "INSERT INTO agent_sessions (id, model, system_prompt, title, created_at, updated_at, working_dir)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    session_id,
                    "agent:default",
                    None::<String>,
                    "新对话",
                    now,
                    now,
                    working_dir.to_string_lossy().to_string()
                ],
            )
            .map_err(|e| anyhow!("自动创建会话失败: {e}"))?;
            tracing::info!("[SessionStore] 自动创建会话: {}", session_id);
        }

        let role = Self::message_role_to_string(message);
        let content_json = serde_json::to_string(&message.content)
            .map_err(|e| anyhow!("序列化消息内容失败: {e}"))?;
        let timestamp = Utc::now().to_rfc3339();

        // 从 content 中提取 tool_calls（ToolRequest 类型）
        let tool_requests: Vec<_> = message
            .content
            .iter()
            .filter_map(|c| {
                if let MessageContent::ToolRequest(req) = c {
                    Some(req.clone())
                } else {
                    None
                }
            })
            .collect();

        let tool_calls_json: Option<String> = if !tool_requests.is_empty() {
            Some(serde_json::to_string(&tool_requests)?)
        } else {
            None
        };

        // 从 content 中提取 tool_call_id（ToolResponse 类型）
        let tool_call_id: Option<String> = message.content.iter().find_map(|c| {
            if let MessageContent::ToolResponse(resp) = c {
                Some(resp.id.clone())
            } else {
                None
            }
        });

        conn.execute(
            "INSERT INTO agent_messages (session_id, role, content_json, timestamp, tool_calls_json, tool_call_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![session_id, role, content_json, timestamp, tool_calls_json, tool_call_id],
        )
        .map_err(|e| anyhow!("添加消息失败: {e}"))?;

        conn.execute(
            "UPDATE agent_sessions SET updated_at = ? WHERE id = ?",
            rusqlite::params![timestamp, session_id],
        )
        .map_err(|e| anyhow!("更新会话时间失败: {e}"))?;

        Ok(())
    }

    async fn replace_conversation(
        &self,
        session_id: &str,
        conversation: &Conversation,
    ) -> Result<()> {
        let conn = self.db.lock().map_err(|e| anyhow!("数据库锁定失败: {e}"))?;

        conn.execute(
            "DELETE FROM agent_messages WHERE session_id = ?",
            [session_id],
        )
        .map_err(|e| anyhow!("删除旧消息失败: {e}"))?;

        for message in conversation.messages() {
            let role = Self::message_role_to_string(message);
            let content_json = serde_json::to_string(&message.content)?;
            let timestamp = Utc::now().to_rfc3339();

            let tool_requests: Vec<_> = message
                .content
                .iter()
                .filter_map(|c| {
                    if let MessageContent::ToolRequest(req) = c {
                        Some(req.clone())
                    } else {
                        None
                    }
                })
                .collect();

            let tool_calls_json: Option<String> = if !tool_requests.is_empty() {
                Some(serde_json::to_string(&tool_requests)?)
            } else {
                None
            };

            let tool_call_id: Option<String> = message.content.iter().find_map(|c| {
                if let MessageContent::ToolResponse(resp) = c {
                    Some(resp.id.clone())
                } else {
                    None
                }
            });

            conn.execute(
                "INSERT INTO agent_messages (session_id, role, content_json, timestamp, tool_calls_json, tool_call_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![session_id, role, content_json, timestamp, tool_calls_json, tool_call_id],
            )?;
        }

        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE agent_sessions SET updated_at = ? WHERE id = ?",
            rusqlite::params![now, session_id],
        )?;

        Ok(())
    }

    async fn list_sessions(&self) -> Result<Vec<Session>> {
        let conn = self.db.lock().map_err(|e| anyhow!("数据库锁定失败: {e}"))?;

        let mut stmt = conn.prepare(
            "SELECT id, model, system_prompt, title, created_at, updated_at, working_dir
             FROM agent_sessions ORDER BY updated_at DESC",
        )?;

        let sessions: Vec<Session> = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let model: String = row.get(1)?;
                let title: Option<String> = row.get(3)?;
                let created_at: String = row.get(4)?;
                let updated_at: String = row.get(5)?;
                let working_dir: Option<String> = row.get(6)?;

                Ok((id, model, title, created_at, updated_at, working_dir))
            })?
            .filter_map(|r| r.ok())
            .map(
                |(id, model, title, created_at, updated_at, db_working_dir)| {
                    let created_at = chrono::DateTime::parse_from_rfc3339(&created_at)
                        .map(|dt| dt.with_timezone(&Utc))
                        .unwrap_or_else(|_| Utc::now());
                    let updated_at = chrono::DateTime::parse_from_rfc3339(&updated_at)
                        .map(|dt| dt.with_timezone(&Utc))
                        .unwrap_or_else(|_| Utc::now());
                    let session_type = model.parse().unwrap_or(SessionType::User);
                    let working_dir = Self::parse_session_working_dir(&conn, db_working_dir);

                    Session {
                        id,
                        working_dir,
                        name: title.unwrap_or_else(|| "未命名会话".to_string()),
                        user_set_name: false,
                        session_type,
                        created_at,
                        updated_at,
                        extension_data: ExtensionData::default(),
                        total_tokens: None,
                        input_tokens: None,
                        output_tokens: None,
                        accumulated_total_tokens: None,
                        accumulated_input_tokens: None,
                        accumulated_output_tokens: None,
                        schedule_id: None,
                        recipe: None,
                        user_recipe_values: None,
                        conversation: None,
                        message_count: 0,
                        provider_name: None,
                        model_config: None,
                    }
                },
            )
            .collect();

        Ok(sessions)
    }

    async fn list_sessions_by_types(&self, types: &[SessionType]) -> Result<Vec<Session>> {
        let all_sessions = self.list_sessions().await?;
        Ok(all_sessions
            .into_iter()
            .filter(|s| types.contains(&s.session_type))
            .collect())
    }

    async fn delete_session(&self, id: &str) -> Result<()> {
        let conn = self.db.lock().map_err(|e| anyhow!("数据库锁定失败: {e}"))?;
        conn.execute("DELETE FROM agent_sessions WHERE id = ?", [id])?;
        Ok(())
    }

    async fn get_insights(&self) -> Result<SessionInsights> {
        let conn = self.db.lock().map_err(|e| anyhow!("数据库锁定失败: {e}"))?;

        let total_sessions: i64 =
            conn.query_row("SELECT COUNT(*) FROM agent_sessions", [], |row| row.get(0))?;

        Ok(SessionInsights {
            total_sessions: total_sessions as usize,
            total_tokens: 0,
        })
    }

    async fn export_session(&self, id: &str) -> Result<String> {
        let session = self.get_session(id, true).await?;
        serde_json::to_string_pretty(&session).map_err(|e| anyhow!("导出会话失败: {e}"))
    }

    async fn import_session(&self, json: &str) -> Result<Session> {
        let session: Session =
            serde_json::from_str(json).map_err(|e| anyhow!("解析会话 JSON 失败: {e}"))?;

        let new_session = self
            .create_session(
                session.working_dir.clone(),
                session.name.clone(),
                session.session_type,
            )
            .await?;

        if let Some(conversation) = &session.conversation {
            self.replace_conversation(&new_session.id, conversation)
                .await?;
        }

        Ok(new_session)
    }

    async fn copy_session(&self, session_id: &str, new_name: String) -> Result<Session> {
        let original = self.get_session(session_id, true).await?;

        let new_session = self
            .create_session(
                original.working_dir.clone(),
                new_name,
                original.session_type,
            )
            .await?;

        if let Some(conversation) = &original.conversation {
            self.replace_conversation(&new_session.id, conversation)
                .await?;
        }

        Ok(new_session)
    }

    async fn truncate_conversation(&self, session_id: &str, timestamp: i64) -> Result<()> {
        let conn = self.db.lock().map_err(|e| anyhow!("数据库锁定失败: {e}"))?;

        let dt = chrono::DateTime::from_timestamp(timestamp, 0).unwrap_or_else(Utc::now);
        let timestamp_str = dt.to_rfc3339();

        conn.execute(
            "DELETE FROM agent_messages WHERE session_id = ? AND timestamp > ?",
            rusqlite::params![session_id, timestamp_str],
        )?;

        Ok(())
    }

    async fn update_session_name(
        &self,
        session_id: &str,
        name: String,
        _user_set: bool,
    ) -> Result<()> {
        let conn = self.db.lock().map_err(|e| anyhow!("数据库锁定失败: {e}"))?;
        conn.execute(
            "UPDATE agent_sessions SET title = ? WHERE id = ?",
            rusqlite::params![name, session_id],
        )?;
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
        session_id: &str,
        provider_name: Option<String>,
        model_config: Option<ModelConfig>,
    ) -> Result<()> {
        if let Some(model_name) = model_config
            .as_ref()
            .map(|config| config.model_name.trim().to_string())
            .filter(|value| !value.is_empty())
            .or(provider_name.filter(|value| !value.trim().is_empty()))
        {
            let conn = self.db.lock().map_err(|e| anyhow!("数据库锁定失败: {e}"))?;
            conn.execute(
                "UPDATE agent_sessions SET model = ? WHERE id = ?",
                rusqlite::params![model_name, session_id],
            )?;
        }
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
        query: &str,
        limit: Option<usize>,
        _after_date: Option<chrono::DateTime<chrono::Utc>>,
        _before_date: Option<chrono::DateTime<chrono::Utc>>,
        _exclude_session_id: Option<String>,
    ) -> Result<Vec<ChatHistoryMatch>> {
        let conn = self.db.lock().map_err(|e| anyhow!("数据库锁定失败: {e}"))?;
        let limit = limit.unwrap_or(50);

        let mut stmt = conn.prepare(
            "SELECT m.session_id, s.title, m.role, m.content_json, m.timestamp
             FROM agent_messages m
             JOIN agent_sessions s ON m.session_id = s.id
             WHERE m.content_json LIKE ?
             ORDER BY m.timestamp DESC
             LIMIT ?",
        )?;

        let pattern = format!("%{query}%");
        let matches: Vec<ChatHistoryMatch> = stmt
            .query_map(rusqlite::params![pattern, limit as i64], |row| {
                let session_id: String = row.get(0)?;
                let session_name: Option<String> = row.get(1)?;
                let role: String = row.get(2)?;
                let content_json: String = row.get(3)?;
                let timestamp: String = row.get(4)?;

                Ok((session_id, session_name, role, content_json, timestamp))
            })?
            .filter_map(|r| r.ok())
            .map(
                |(session_id, session_name, role, content_json, timestamp)| {
                    let timestamp = chrono::DateTime::parse_from_rfc3339(&timestamp)
                        .map(|dt| dt.with_timezone(&Utc))
                        .unwrap_or_else(|_| Utc::now());

                    ChatHistoryMatch {
                        session_id,
                        session_name: session_name.unwrap_or_else(|| "未命名".to_string()),
                        message_role: role,
                        message_content: content_json,
                        timestamp,
                        relevance_score: 1.0,
                    }
                },
            )
            .collect();

        Ok(matches)
    }

    async fn commit_session(&self, id: &str, _options: CommitOptions) -> Result<CommitReport> {
        Ok(CommitReport {
            session_id: id.to_string(),
            messages_scanned: 0,
            memories_created: 0,
            memories_merged: 0,
            source_start_ts: None,
            source_end_ts: None,
            warnings: vec!["ProxyCastSessionStore: memory commit skipped".to_string()],
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
            message: "ProxyCastSessionStore: memory subsystem disabled".to_string(),
        })
    }
}

// ============================================================================
// 辅助方法
// ============================================================================

impl ProxyCastSessionStore {
    /// 加载会话的对话历史
    fn load_conversation(
        &self,
        conn: &rusqlite::Connection,
        session_id: &str,
    ) -> Result<Conversation> {
        let mut stmt = conn.prepare(
            "SELECT role, content_json, timestamp, tool_calls_json, tool_call_id
             FROM agent_messages WHERE session_id = ? ORDER BY id ASC",
        )?;

        let messages: Vec<Message> = stmt
            .query_map([session_id], |row| {
                let role: String = row.get(0)?;
                let content_json: String = row.get(1)?;
                let _timestamp: String = row.get(2)?;
                let _tool_calls_json: Option<String> = row.get(3)?;
                let _tool_call_id: Option<String> = row.get(4)?;

                Ok((role, content_json))
            })?
            .filter_map(|r| r.ok())
            .filter_map(|(role, content_json)| {
                // 尝试解析消息内容
                let content: Vec<MessageContent> = serde_json::from_str(&content_json).ok()?;

                // 根据角色创建消息
                let mut message = if role == "assistant" {
                    Message::assistant()
                } else {
                    Message::user()
                };

                // 添加所有内容
                for c in content {
                    message = message.with_content(c);
                }

                Some(message)
            })
            .collect();

        Ok(Conversation::new_unvalidated(messages))
    }

    /// 统计会话消息数量
    fn count_messages(&self, conn: &rusqlite::Connection, session_id: &str) -> Result<usize> {
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM agent_messages WHERE session_id = ?",
            [session_id],
            |row| row.get(0),
        )?;
        Ok(count as usize)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aster::session::{SessionStore, SessionType};
    use proxycast_core::database::schema::create_tables;
    use rusqlite::Connection;
    use std::sync::{Arc, Mutex};

    fn setup_test_store() -> ProxyCastSessionStore {
        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        create_tables(&conn).expect("初始化表结构失败");
        ProxyCastSessionStore::new(Arc::new(Mutex::new(conn)))
    }

    #[tokio::test]
    async fn update_provider_config_should_persist_model_name_first() {
        let store = setup_test_store();
        let session = store
            .create_session(
                PathBuf::from("."),
                "测试会话".to_string(),
                SessionType::User,
            )
            .await
            .expect("创建会话失败");

        store
            .update_provider_config(
                &session.id,
                Some("openai".to_string()),
                Some(ModelConfig::new("gpt-4.1").expect("model config")),
            )
            .await
            .expect("更新 provider 配置失败");

        let conn = store.db.lock().expect("锁数据库");
        let persisted_model: String = conn
            .query_row(
                "SELECT model FROM agent_sessions WHERE id = ?",
                [session.id.as_str()],
                |row| row.get(0),
            )
            .expect("查询 model 失败");

        assert_eq!(persisted_model, "gpt-4.1");
    }
}
