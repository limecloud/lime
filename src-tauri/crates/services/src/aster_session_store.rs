//! Aster SessionStore 实现
//!
//! 实现 aster::session::SessionStore trait，将 aster 的会话数据
//! 存储到 Lime 的 SQLite 数据库中。
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
use lime_core::app_paths;
use lime_core::database::DbConnection;
use lime_core::workspace::WorkspaceManager;
use serde::de::DeserializeOwned;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex as StdMutex;

/// Lime 的 SessionStore 实现
///
/// 将 aster 的会话数据存储到 Lime 的 SQLite 数据库
pub struct LimeSessionStore {
    db: DbConnection,
    metadata_cache: StdMutex<HashMap<String, Session>>,
}

impl LimeSessionStore {
    /// 创建新的 SessionStore 实例
    pub fn new(db: DbConnection) -> Self {
        Self {
            db,
            metadata_cache: StdMutex::new(HashMap::new()),
        }
    }

    pub fn load_extension_data_from_conn(
        conn: &rusqlite::Connection,
        session_id: &str,
    ) -> Result<ExtensionData> {
        let extension_data_json: String = conn
            .query_row(
                "SELECT extension_data_json FROM agent_sessions WHERE id = ?1",
                rusqlite::params![session_id],
                |row| row.get(0),
            )
            .map_err(|e| anyhow!("读取 extension_data 失败: {e}"))?;

        Ok(serde_json::from_str(&extension_data_json).unwrap_or_default())
    }

    pub fn load_extension_data_sync(db: &DbConnection, session_id: &str) -> Result<ExtensionData> {
        let conn = db.lock().map_err(|e| anyhow!("数据库锁定失败: {e}"))?;
        Self::load_extension_data_from_conn(&conn, session_id)
    }

    fn normalize_optional_text(value: Option<String>) -> Option<String> {
        let value = value?;
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    }

    fn parse_optional_json<T: DeserializeOwned>(raw: Option<String>) -> Option<T> {
        raw.and_then(|text| serde_json::from_str(&text).ok())
    }

    fn parse_timestamp_or_now(raw: &str) -> chrono::DateTime<Utc> {
        chrono::DateTime::parse_from_rfc3339(raw)
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now())
    }

    fn cache_session_metadata(&self, session: &Session) {
        let mut cached = session.clone();
        cached.conversation = None;

        if let Ok(mut metadata_cache) = self.metadata_cache.lock() {
            metadata_cache.insert(cached.id.clone(), cached);
        }
    }

    fn cached_session_metadata(&self, session_id: &str) -> Option<Session> {
        self.metadata_cache
            .lock()
            .ok()
            .and_then(|metadata_cache| metadata_cache.get(session_id).cloned())
    }

    fn invalidate_cached_session_metadata(&self, session_id: &str) {
        if let Ok(mut metadata_cache) = self.metadata_cache.lock() {
            metadata_cache.remove(session_id);
        }
    }

    fn update_cached_session_metadata(&self, session_id: &str, updater: impl FnOnce(&mut Session)) {
        if let Ok(mut metadata_cache) = self.metadata_cache.lock() {
            if let Some(session) = metadata_cache.get_mut(session_id) {
                updater(session);
            }
        }
    }

    fn resolve_session_type(raw: Option<String>, model: &str) -> SessionType {
        let parsed_model = model.parse::<SessionType>().ok();
        match raw
            .as_deref()
            .and_then(|value| value.parse::<SessionType>().ok())
        {
            Some(SessionType::User) if matches!(parsed_model, Some(parsed) if parsed != SessionType::User) => {
                parsed_model.unwrap_or(SessionType::User)
            }
            Some(session_type) => session_type,
            None => parsed_model.unwrap_or(SessionType::User),
        }
    }

    fn default_model_name() -> String {
        "agent:default".to_string()
    }

    fn insert_session_row(
        conn: &rusqlite::Connection,
        id: &str,
        title: &str,
        working_dir: &Path,
        session_type: SessionType,
    ) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO agent_sessions (
                id, model, system_prompt, title, created_at, updated_at, working_dir,
                execution_strategy, session_type, user_set_name, extension_data_json
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            rusqlite::params![
                id,
                Self::default_model_name(),
                None::<String>,
                title,
                now,
                now,
                working_dir.to_string_lossy().to_string(),
                "react",
                session_type.to_string(),
                false,
                serde_json::to_string(&ExtensionData::default())
                    .map_err(|e| anyhow!("序列化 extension_data 失败: {e}"))?,
            ],
        )
        .map_err(|e| anyhow!("创建会话失败: {e}"))?;
        Ok(())
    }

    fn ensure_session_row(conn: &rusqlite::Connection, session_id: &str) -> Result<()> {
        let session_exists: bool = conn
            .query_row(
                "SELECT 1 FROM agent_sessions WHERE id = ?",
                [session_id],
                |_| Ok(true),
            )
            .unwrap_or(false);

        if session_exists {
            return Ok(());
        }

        let working_dir = Self::resolve_session_working_dir(conn);
        Self::insert_session_row(conn, session_id, "新对话", &working_dir, SessionType::User)
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
        if let Some(path) = WorkspaceManager::get_default_root_path_from_conn(conn)
            .ok()
            .flatten()
        {
            let normalized = Self::normalize_working_dir(path);
            if !normalized.as_os_str().is_empty() {
                return normalized;
            }
        }

        if let Ok(default_project_dir) = app_paths::resolve_default_project_dir() {
            return default_project_dir;
        }

        tracing::warn!(
            "[SessionStore] 解析默认 working_dir 失败，已回退当前目录；建议检查 app_paths 配置"
        );
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
impl SessionStore for LimeSessionStore {
    async fn create_session(
        &self,
        working_dir: PathBuf,
        name: String,
        session_type: SessionType,
    ) -> Result<Session> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now();
        let conn = self.db.lock().map_err(|e| anyhow!("数据库锁定失败: {e}"))?;
        Self::insert_session_row(&conn, &id, &name, &working_dir, session_type)?;

        let session = Session {
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
        };
        self.cache_session_metadata(&session);

        Ok(session)
    }

    async fn get_session(&self, id: &str, include_messages: bool) -> Result<Session> {
        if !include_messages {
            if let Some(cached) = self.cached_session_metadata(id) {
                tracing::debug!(
                    "[SessionStore] get_session 命中 metadata cache: id={}, include_messages={}",
                    id,
                    include_messages
                );
                return Ok(cached);
            }
        }

        tracing::debug!(
            "[SessionStore] get_session 读取数据库: id={}, include_messages={}",
            id,
            include_messages
        );

        let conn = self.db.lock().map_err(|e| anyhow!("数据库锁定失败: {e}"))?;
        Self::ensure_session_row(&conn, id)?;
        tracing::debug!("[SessionStore] get_session 已确保会话存在: {}", id);

        let mut stmt = conn
            .prepare(
                "SELECT id, model, system_prompt, title, created_at, updated_at, working_dir,
                        session_type, user_set_name, extension_data_json,
                        total_tokens, input_tokens, output_tokens,
                        accumulated_total_tokens, accumulated_input_tokens, accumulated_output_tokens,
                        schedule_id, recipe_json, user_recipe_values_json,
                        provider_name, model_config_json
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
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, bool>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, Option<i32>>(10)?,
                    row.get::<_, Option<i32>>(11)?,
                    row.get::<_, Option<i32>>(12)?,
                    row.get::<_, Option<i32>>(13)?,
                    row.get::<_, Option<i32>>(14)?,
                    row.get::<_, Option<i32>>(15)?,
                    row.get::<_, Option<String>>(16)?,
                    row.get::<_, Option<String>>(17)?,
                    row.get::<_, Option<String>>(18)?,
                    row.get::<_, Option<String>>(19)?,
                    row.get::<_, Option<String>>(20)?,
                ))
            })
            .map_err(|e| anyhow!("会话不存在: {e}"))?;

        let (
            id,
            model,
            _system_prompt,
            title,
            created_at,
            updated_at,
            db_working_dir,
            session_type_raw,
            user_set_name,
            extension_data_json,
            total_tokens,
            input_tokens,
            output_tokens,
            accumulated_total_tokens,
            accumulated_input_tokens,
            accumulated_output_tokens,
            schedule_id,
            recipe_json,
            user_recipe_values_json,
            provider_name,
            model_config_json,
        ) = session_row;

        let created_at = Self::parse_timestamp_or_now(&created_at);
        let updated_at = Self::parse_timestamp_or_now(&updated_at);

        let session_type = Self::resolve_session_type(session_type_raw, &model);
        let working_dir = Self::parse_session_working_dir(&conn, db_working_dir);

        let conversation = if include_messages {
            Some(self.load_conversation(&conn, &id)?)
        } else {
            None
        };

        let message_count = self.count_messages(&conn, &id)?;

        let session = Session {
            id: id.to_string(),
            working_dir,
            name: title.unwrap_or_else(|| "未命名会话".to_string()),
            user_set_name,
            session_type,
            created_at,
            updated_at,
            extension_data: serde_json::from_str(&extension_data_json).unwrap_or_default(),
            total_tokens,
            input_tokens,
            output_tokens,
            accumulated_total_tokens,
            accumulated_input_tokens,
            accumulated_output_tokens,
            schedule_id,
            recipe: Self::parse_optional_json(recipe_json),
            user_recipe_values: Self::parse_optional_json(user_recipe_values_json),
            conversation,
            message_count,
            provider_name,
            model_config: Self::parse_optional_json(model_config_json).or_else(|| {
                match model.trim() {
                    "" | "agent:default" => None,
                    normalized => ModelConfig::new(normalized).ok(),
                }
            }),
        };
        self.cache_session_metadata(&session);

        Ok(session)
    }

    async fn add_message(&self, session_id: &str, message: &Message) -> Result<()> {
        tracing::debug!(
            "[SessionStore] add_message 被调用: session_id={}",
            session_id
        );

        let conn = self.db.lock().map_err(|e| anyhow!("数据库锁定失败: {e}"))?;
        Self::ensure_session_row(&conn, session_id)?;

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

        let updated_at = Self::parse_timestamp_or_now(&timestamp);
        self.update_cached_session_metadata(session_id, |session| {
            session.updated_at = updated_at;
            session.message_count = session.message_count.saturating_add(1);
        });

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

        let updated_at = Self::parse_timestamp_or_now(&now);
        self.update_cached_session_metadata(session_id, |session| {
            session.updated_at = updated_at;
            session.message_count = conversation.messages().len();
        });

        Ok(())
    }

    async fn list_sessions(&self) -> Result<Vec<Session>> {
        let conn = self.db.lock().map_err(|e| anyhow!("数据库锁定失败: {e}"))?;

        let mut stmt = conn.prepare(
            "SELECT id, model, system_prompt, title, created_at, updated_at, working_dir,
                    session_type, user_set_name, extension_data_json,
                    total_tokens, input_tokens, output_tokens,
                    accumulated_total_tokens, accumulated_input_tokens, accumulated_output_tokens,
                    schedule_id, recipe_json, user_recipe_values_json,
                    provider_name, model_config_json
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
                let session_type: Option<String> = row.get(7)?;
                let user_set_name: bool = row.get(8)?;
                let extension_data_json: String = row.get(9)?;
                let total_tokens: Option<i32> = row.get(10)?;
                let input_tokens: Option<i32> = row.get(11)?;
                let output_tokens: Option<i32> = row.get(12)?;
                let accumulated_total_tokens: Option<i32> = row.get(13)?;
                let accumulated_input_tokens: Option<i32> = row.get(14)?;
                let accumulated_output_tokens: Option<i32> = row.get(15)?;
                let schedule_id: Option<String> = row.get(16)?;
                let recipe_json: Option<String> = row.get(17)?;
                let user_recipe_values_json: Option<String> = row.get(18)?;
                let provider_name: Option<String> = row.get(19)?;
                let model_config_json: Option<String> = row.get(20)?;

                Ok((
                    id,
                    model,
                    title,
                    created_at,
                    updated_at,
                    working_dir,
                    session_type,
                    user_set_name,
                    extension_data_json,
                    total_tokens,
                    input_tokens,
                    output_tokens,
                    accumulated_total_tokens,
                    accumulated_input_tokens,
                    accumulated_output_tokens,
                    schedule_id,
                    recipe_json,
                    user_recipe_values_json,
                    provider_name,
                    model_config_json,
                ))
            })?
            .filter_map(|r| r.ok())
            .map(
                |(
                    id,
                    model,
                    title,
                    created_at,
                    updated_at,
                    db_working_dir,
                    session_type_raw,
                    user_set_name,
                    extension_data_json,
                    total_tokens,
                    input_tokens,
                    output_tokens,
                    accumulated_total_tokens,
                    accumulated_input_tokens,
                    accumulated_output_tokens,
                    schedule_id,
                    recipe_json,
                    user_recipe_values_json,
                    provider_name,
                    model_config_json,
                )| {
                    let created_at = chrono::DateTime::parse_from_rfc3339(&created_at)
                        .map(|dt| dt.with_timezone(&Utc))
                        .unwrap_or_else(|_| Utc::now());
                    let updated_at = chrono::DateTime::parse_from_rfc3339(&updated_at)
                        .map(|dt| dt.with_timezone(&Utc))
                        .unwrap_or_else(|_| Utc::now());
                    let session_type = Self::resolve_session_type(session_type_raw, &model);
                    let working_dir = Self::parse_session_working_dir(&conn, db_working_dir);
                    let message_count = self.count_messages(&conn, &id).unwrap_or(0);

                    Session {
                        id,
                        working_dir,
                        name: title.unwrap_or_else(|| "未命名会话".to_string()),
                        user_set_name,
                        session_type,
                        created_at,
                        updated_at,
                        extension_data: serde_json::from_str(&extension_data_json)
                            .unwrap_or_default(),
                        total_tokens,
                        input_tokens,
                        output_tokens,
                        accumulated_total_tokens,
                        accumulated_input_tokens,
                        accumulated_output_tokens,
                        schedule_id,
                        recipe: Self::parse_optional_json(recipe_json),
                        user_recipe_values: Self::parse_optional_json(user_recipe_values_json),
                        conversation: None,
                        message_count,
                        provider_name,
                        model_config: Self::parse_optional_json(model_config_json).or_else(|| {
                            match model.trim() {
                                "" | "agent:default" => None,
                                normalized => ModelConfig::new(normalized).ok(),
                            }
                        }),
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
        {
            let conn = self.db.lock().map_err(|e| anyhow!("数据库锁定失败: {e}"))?;
            conn.execute("DELETE FROM agent_sessions WHERE id = ?", [id])?;
        }
        self.invalidate_cached_session_metadata(id);

        Ok(())
    }

    async fn get_insights(&self) -> Result<SessionInsights> {
        let conn = self.db.lock().map_err(|e| anyhow!("数据库锁定失败: {e}"))?;

        let total_sessions: i64 =
            conn.query_row("SELECT COUNT(*) FROM agent_sessions", [], |row| row.get(0))?;
        let total_tokens: i64 = conn.query_row(
            "SELECT COALESCE(SUM(COALESCE(accumulated_total_tokens, total_tokens, 0)), 0)
             FROM agent_sessions",
            [],
            |row| row.get(0),
        )?;

        Ok(SessionInsights {
            total_sessions: total_sessions as usize,
            total_tokens,
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

        self.update_session_name(&new_session.id, session.name.clone(), session.user_set_name)
            .await?;
        self.update_extension_data(&new_session.id, session.extension_data.clone())
            .await?;
        self.update_token_stats(
            &new_session.id,
            TokenStatsUpdate {
                schedule_id: session.schedule_id.clone(),
                total_tokens: session.total_tokens,
                input_tokens: session.input_tokens,
                output_tokens: session.output_tokens,
                accumulated_total: session.accumulated_total_tokens,
                accumulated_input: session.accumulated_input_tokens,
                accumulated_output: session.accumulated_output_tokens,
            },
        )
        .await?;
        self.update_provider_config(
            &new_session.id,
            session.provider_name.clone(),
            session.model_config.clone(),
        )
        .await?;
        self.update_recipe(
            &new_session.id,
            session.recipe.clone(),
            session.user_recipe_values.clone(),
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
        let created_session_name = new_name.clone();
        let persisted_session_name = new_name.clone();

        let new_session = self
            .create_session(
                original.working_dir.clone(),
                created_session_name,
                original.session_type,
            )
            .await?;

        self.update_session_name(&new_session.id, persisted_session_name, true)
            .await?;
        self.update_extension_data(&new_session.id, original.extension_data.clone())
            .await?;
        self.update_token_stats(
            &new_session.id,
            TokenStatsUpdate {
                schedule_id: original.schedule_id.clone(),
                total_tokens: original.total_tokens,
                input_tokens: original.input_tokens,
                output_tokens: original.output_tokens,
                accumulated_total: original.accumulated_total_tokens,
                accumulated_input: original.accumulated_input_tokens,
                accumulated_output: original.accumulated_output_tokens,
            },
        )
        .await?;
        self.update_provider_config(
            &new_session.id,
            original.provider_name.clone(),
            original.model_config.clone(),
        )
        .await?;
        self.update_recipe(
            &new_session.id,
            original.recipe.clone(),
            original.user_recipe_values.clone(),
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
        self.invalidate_cached_session_metadata(session_id);

        Ok(())
    }

    async fn update_session_name(
        &self,
        session_id: &str,
        name: String,
        user_set: bool,
    ) -> Result<()> {
        let conn = self.db.lock().map_err(|e| anyhow!("数据库锁定失败: {e}"))?;
        let now = Utc::now().to_rfc3339();
        let cached_name = name.clone();
        conn.execute(
            "UPDATE agent_sessions SET title = ?1, user_set_name = ?2, updated_at = ?3 WHERE id = ?4",
            rusqlite::params![name, user_set, now, session_id],
        )?;
        let updated_at = Self::parse_timestamp_or_now(&now);
        self.update_cached_session_metadata(session_id, |session| {
            session.name = cached_name;
            session.user_set_name = user_set;
            session.updated_at = updated_at;
        });
        Ok(())
    }

    async fn update_extension_data(
        &self,
        session_id: &str,
        extension_data: ExtensionData,
    ) -> Result<()> {
        let conn = self.db.lock().map_err(|e| anyhow!("数据库锁定失败: {e}"))?;
        let now = Utc::now().to_rfc3339();
        let cached_extension_data = extension_data.clone();
        let extension_data_json = serde_json::to_string(&extension_data)
            .map_err(|e| anyhow!("序列化 extension_data 失败: {e}"))?;
        conn.execute(
            "UPDATE agent_sessions SET extension_data_json = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![extension_data_json, now, session_id],
        )?;
        let updated_at = Self::parse_timestamp_or_now(&now);
        self.update_cached_session_metadata(session_id, |session| {
            session.extension_data = cached_extension_data;
            session.updated_at = updated_at;
        });
        Ok(())
    }

    async fn update_token_stats(&self, session_id: &str, stats: TokenStatsUpdate) -> Result<()> {
        let normalized_schedule_id = Self::normalize_optional_text(stats.schedule_id.clone());
        let conn = self.db.lock().map_err(|e| anyhow!("数据库锁定失败: {e}"))?;
        let now = Utc::now().to_rfc3339();
        // 当前 store 边界把 None 视为“跳过更新”，不是“清空字段”。
        // 调用方若要重置当前窗口 token，必须显式写 Some(0)；schedule_id 也不能靠 None/空串清空。
        conn.execute(
            "UPDATE agent_sessions SET
                total_tokens = COALESCE(?1, total_tokens),
                input_tokens = COALESCE(?2, input_tokens),
                output_tokens = COALESCE(?3, output_tokens),
                accumulated_total_tokens = COALESCE(?4, accumulated_total_tokens),
                accumulated_input_tokens = COALESCE(?5, accumulated_input_tokens),
                accumulated_output_tokens = COALESCE(?6, accumulated_output_tokens),
                schedule_id = COALESCE(?7, schedule_id),
                updated_at = ?8
             WHERE id = ?9",
            rusqlite::params![
                stats.total_tokens,
                stats.input_tokens,
                stats.output_tokens,
                stats.accumulated_total,
                stats.accumulated_input,
                stats.accumulated_output,
                normalized_schedule_id.clone(),
                now,
                session_id,
            ],
        )?;
        let updated_at = Self::parse_timestamp_or_now(&now);
        self.update_cached_session_metadata(session_id, |session| {
            if let Some(total_tokens) = stats.total_tokens {
                session.total_tokens = Some(total_tokens);
            }
            if let Some(input_tokens) = stats.input_tokens {
                session.input_tokens = Some(input_tokens);
            }
            if let Some(output_tokens) = stats.output_tokens {
                session.output_tokens = Some(output_tokens);
            }
            if let Some(accumulated_total) = stats.accumulated_total {
                session.accumulated_total_tokens = Some(accumulated_total);
            }
            if let Some(accumulated_input) = stats.accumulated_input {
                session.accumulated_input_tokens = Some(accumulated_input);
            }
            if let Some(accumulated_output) = stats.accumulated_output {
                session.accumulated_output_tokens = Some(accumulated_output);
            }
            if let Some(schedule_id) = normalized_schedule_id {
                session.schedule_id = Some(schedule_id);
            }
            session.updated_at = updated_at;
        });
        Ok(())
    }

    async fn update_provider_config(
        &self,
        session_id: &str,
        provider_name: Option<String>,
        model_config: Option<ModelConfig>,
    ) -> Result<()> {
        let normalized_provider_name = Self::normalize_optional_text(provider_name);
        let normalized_model_name = model_config
            .as_ref()
            .map(|config| config.model_name.trim().to_string())
            .filter(|value| !value.is_empty());
        let cached_provider_name = normalized_provider_name.clone();
        let cached_model_config = model_config.clone();
        let model_config_json = model_config
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| anyhow!("序列化 model_config 失败: {e}"))?;

        if normalized_provider_name.is_none() && normalized_model_name.is_none() {
            return Ok(());
        }

        let conn = self.db.lock().map_err(|e| anyhow!("数据库锁定失败: {e}"))?;
        let now = Utc::now().to_rfc3339();
        // provider/model_config 走“保留旧值”语义，None 不会清空已持久化的 provider 配置。
        conn.execute(
            "UPDATE agent_sessions SET
                provider_name = COALESCE(?1, provider_name),
                model = COALESCE(?2, model),
                model_config_json = CASE WHEN ?3 IS NULL THEN model_config_json ELSE ?3 END,
                updated_at = ?4
             WHERE id = ?5",
            rusqlite::params![
                normalized_provider_name.clone(),
                normalized_model_name,
                model_config_json,
                now,
                session_id,
            ],
        )?;
        let updated_at = Self::parse_timestamp_or_now(&now);
        self.update_cached_session_metadata(session_id, |session| {
            if let Some(provider_name) = cached_provider_name {
                session.provider_name = Some(provider_name);
            }
            if let Some(model_config) = cached_model_config {
                session.model_config = Some(model_config);
            }
            session.updated_at = updated_at;
        });
        Ok(())
    }

    async fn update_recipe(
        &self,
        session_id: &str,
        recipe: Option<Recipe>,
        user_recipe_values: Option<HashMap<String, String>>,
    ) -> Result<()> {
        let conn = self.db.lock().map_err(|e| anyhow!("数据库锁定失败: {e}"))?;
        let now = Utc::now().to_rfc3339();
        let cached_recipe = recipe.clone();
        let cached_user_recipe_values = user_recipe_values.clone();
        let recipe_json = recipe
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| anyhow!("序列化 recipe 失败: {e}"))?;
        let user_recipe_values_json = user_recipe_values
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| anyhow!("序列化 user_recipe_values 失败: {e}"))?;
        // recipe 走“直接覆盖”语义，None 会落库为 NULL，用于显式清空旧 recipe。
        conn.execute(
            "UPDATE agent_sessions SET
                recipe_json = ?1,
                user_recipe_values_json = ?2,
                updated_at = ?3
             WHERE id = ?4",
            rusqlite::params![recipe_json, user_recipe_values_json, now, session_id],
        )?;
        let updated_at = Self::parse_timestamp_or_now(&now);
        self.update_cached_session_metadata(session_id, |session| {
            session.recipe = cached_recipe;
            session.user_recipe_values = cached_user_recipe_values;
            session.updated_at = updated_at;
        });
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
            warnings: vec!["LimeSessionStore: memory commit skipped".to_string()],
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
            message: "LimeSessionStore: memory subsystem disabled".to_string(),
        })
    }
}

// ============================================================================
// 辅助方法
// ============================================================================

impl LimeSessionStore {
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
    use lime_core::database::schema::create_tables;
    use rusqlite::Connection;
    use std::ffi::OsString;
    use std::sync::{Arc, Mutex};
    use tempfile::tempdir;

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: std::sync::OnceLock<Mutex<()>> = std::sync::OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    struct EnvGuard {
        values: Vec<(&'static str, Option<OsString>)>,
    }

    impl EnvGuard {
        fn set(entries: &[(&'static str, OsString)]) -> Self {
            let mut values = Vec::new();
            for (key, value) in entries {
                values.push((*key, std::env::var_os(key)));
                std::env::set_var(key, value);
            }
            Self { values }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            for (key, previous) in self.values.drain(..) {
                if let Some(value) = previous {
                    std::env::set_var(key, value);
                } else {
                    std::env::remove_var(key);
                }
            }
        }
    }

    fn setup_test_store() -> LimeSessionStore {
        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        create_tables(&conn).expect("初始化表结构失败");
        LimeSessionStore::new(Arc::new(Mutex::new(conn)))
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

    #[tokio::test]
    async fn get_session_should_prefer_default_workspace_root_when_missing_row() {
        let store = setup_test_store();
        let workspace_root = std::env::temp_dir().join("lime-aster-default-workspace");
        let conn = store.db.lock().expect("锁数据库");
        conn.execute(
            "INSERT INTO workspaces (id, name, workspace_type, root_path, is_default, settings_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 1, '{}', 0, 0)",
            rusqlite::params![
                "workspace-default",
                "默认工作区",
                "general",
                workspace_root.to_string_lossy().to_string(),
            ],
        )
        .expect("插入默认 workspace 失败");
        drop(conn);

        let session = store
            .get_session("missing-default-workspace-session", false)
            .await
            .expect("读取缺失会话失败");

        assert_eq!(session.working_dir, workspace_root);
    }

    #[tokio::test]
    async fn get_session_should_fallback_to_app_paths_default_project_dir() {
        let _env_guard = env_lock().lock().expect("锁环境变量");
        let temp = tempdir().expect("创建临时目录失败");
        let home = temp.path().join("home");
        let app_data = temp.path().join("appdata");
        std::fs::create_dir_all(&home).expect("创建 home 目录失败");
        std::fs::create_dir_all(&app_data).expect("创建 appdata 目录失败");
        let _guard = EnvGuard::set(&[
            ("HOME", home.as_os_str().to_os_string()),
            ("XDG_DATA_HOME", app_data.as_os_str().to_os_string()),
            ("APPDATA", app_data.as_os_str().to_os_string()),
            ("LOCALAPPDATA", app_data.as_os_str().to_os_string()),
        ]);

        let store = setup_test_store();
        let session = store
            .get_session("missing-fallback-session", false)
            .await
            .expect("读取缺失会话失败");
        let expected = app_paths::resolve_default_project_dir().expect("解析默认项目目录失败");

        assert_eq!(session.working_dir, expected);
        assert!(session.working_dir.is_absolute());
        assert!(session
            .working_dir
            .ends_with(PathBuf::from("projects").join("default")));
        assert!(!session
            .working_dir
            .to_string_lossy()
            .contains(".lime/projects/default"));
    }

    #[tokio::test]
    async fn update_session_metadata_should_roundtrip() {
        let store = setup_test_store();
        let session = store
            .create_session(
                PathBuf::from("."),
                "元数据测试".to_string(),
                SessionType::SubAgent,
            )
            .await
            .expect("创建会话失败");

        let mut extension_data = ExtensionData::new();
        extension_data.set_extension_state("todo", "v0", serde_json::json!({"items":["a"]}));

        store
            .update_session_name(&session.id, "已命名会话".to_string(), true)
            .await
            .expect("更新名称失败");
        store
            .update_extension_data(&session.id, extension_data.clone())
            .await
            .expect("更新 extension_data 失败");
        store
            .update_token_stats(
                &session.id,
                TokenStatsUpdate {
                    schedule_id: Some("job-1".to_string()),
                    total_tokens: Some(100),
                    input_tokens: Some(60),
                    output_tokens: Some(40),
                    accumulated_total: Some(300),
                    accumulated_input: Some(180),
                    accumulated_output: Some(120),
                },
            )
            .await
            .expect("更新 token 统计失败");
        store
            .update_provider_config(
                &session.id,
                Some("openai".to_string()),
                Some(ModelConfig::new("gpt-4.1").expect("model config")),
            )
            .await
            .expect("更新 provider 配置失败");
        store
            .update_recipe(
                &session.id,
                Some(Recipe {
                    version: "1.0.0".to_string(),
                    title: "demo".to_string(),
                    description: "demo recipe".to_string(),
                    instructions: None,
                    prompt: None,
                    extensions: None,
                    settings: None,
                    activities: None,
                    author: None,
                    parameters: None,
                    response: None,
                    sub_recipes: None,
                    retry: None,
                }),
                Some(HashMap::from([(
                    "temperature".to_string(),
                    "0.2".to_string(),
                )])),
            )
            .await
            .expect("更新 recipe 失败");

        let loaded = store
            .get_session(&session.id, false)
            .await
            .expect("读取会话失败");

        assert_eq!(loaded.name, "已命名会话");
        assert!(loaded.user_set_name);
        assert_eq!(loaded.session_type, SessionType::SubAgent);
        assert_eq!(loaded.total_tokens, Some(100));
        assert_eq!(loaded.accumulated_total_tokens, Some(300));
        assert_eq!(loaded.schedule_id.as_deref(), Some("job-1"));
        assert_eq!(loaded.provider_name.as_deref(), Some("openai"));
        assert_eq!(
            loaded
                .model_config
                .as_ref()
                .map(|config| config.model_name.as_str()),
            Some("gpt-4.1")
        );
        assert_eq!(
            loaded
                .extension_data
                .get_extension_state("todo", "v0")
                .cloned(),
            extension_data.get_extension_state("todo", "v0").cloned()
        );
        assert_eq!(
            loaded.recipe.as_ref().map(|recipe| recipe.title.as_str()),
            Some("demo")
        );
        assert_eq!(
            loaded
                .user_recipe_values
                .as_ref()
                .and_then(|values| values.get("temperature"))
                .map(String::as_str),
            Some("0.2")
        );
    }

    #[tokio::test]
    async fn update_provider_config_should_keep_existing_values_when_input_is_none() {
        let store = setup_test_store();
        let session = store
            .create_session(
                PathBuf::from("."),
                "provider 守卫测试".to_string(),
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
            .expect("初始化 provider 配置失败");

        store
            .update_provider_config(&session.id, None, None)
            .await
            .expect("更新空 provider 配置失败");

        let loaded = store
            .get_session(&session.id, false)
            .await
            .expect("读取会话失败");

        assert_eq!(loaded.provider_name.as_deref(), Some("openai"));
        assert_eq!(
            loaded
                .model_config
                .as_ref()
                .map(|config| config.model_name.as_str()),
            Some("gpt-4.1")
        );
    }

    #[tokio::test]
    async fn metadata_cache_should_refresh_after_add_message() {
        let store = setup_test_store();
        let session = store
            .create_session(
                PathBuf::from("."),
                "缓存消息计数测试".to_string(),
                SessionType::User,
            )
            .await
            .expect("创建会话失败");

        let cached = store
            .get_session(&session.id, false)
            .await
            .expect("预热缓存失败");
        assert_eq!(cached.message_count, 0);

        store
            .add_message(&session.id, &Message::user().with_text("hello"))
            .await
            .expect("追加消息失败");

        let refreshed = store
            .get_session(&session.id, false)
            .await
            .expect("读取缓存会话失败");
        assert_eq!(refreshed.message_count, 1);
    }

    #[tokio::test]
    async fn metadata_cache_should_refresh_after_provider_update() {
        let store = setup_test_store();
        let session = store
            .create_session(
                PathBuf::from("."),
                "缓存 provider 测试".to_string(),
                SessionType::User,
            )
            .await
            .expect("创建会话失败");

        store
            .get_session(&session.id, false)
            .await
            .expect("预热缓存失败");

        store
            .update_provider_config(
                &session.id,
                Some("openai".to_string()),
                Some(ModelConfig::new("gpt-4.1").expect("model config")),
            )
            .await
            .expect("更新 provider 配置失败");

        let refreshed = store
            .get_session(&session.id, false)
            .await
            .expect("读取缓存会话失败");
        assert_eq!(refreshed.provider_name.as_deref(), Some("openai"));
        assert_eq!(
            refreshed
                .model_config
                .as_ref()
                .map(|config| config.model_name.as_str()),
            Some("gpt-4.1")
        );
    }

    #[tokio::test]
    async fn update_recipe_should_clear_existing_values_when_input_is_none() {
        let store = setup_test_store();
        let session = store
            .create_session(
                PathBuf::from("."),
                "recipe 清空测试".to_string(),
                SessionType::User,
            )
            .await
            .expect("创建会话失败");

        store
            .update_recipe(
                &session.id,
                Some(Recipe {
                    version: "1.0.0".to_string(),
                    title: "demo".to_string(),
                    description: "demo recipe".to_string(),
                    instructions: None,
                    prompt: None,
                    extensions: None,
                    settings: None,
                    activities: None,
                    author: None,
                    parameters: None,
                    response: None,
                    sub_recipes: None,
                    retry: None,
                }),
                Some(HashMap::from([(
                    "temperature".to_string(),
                    "0.2".to_string(),
                )])),
            )
            .await
            .expect("初始化 recipe 失败");

        store
            .update_recipe(&session.id, None, None)
            .await
            .expect("清空 recipe 失败");

        let loaded = store
            .get_session(&session.id, false)
            .await
            .expect("读取会话失败");

        assert!(loaded.recipe.is_none());
        assert!(loaded.user_recipe_values.is_none());
    }

    #[tokio::test]
    async fn update_token_stats_should_keep_existing_values_when_fields_are_none() {
        let store = setup_test_store();
        let session = store
            .create_session(
                PathBuf::from("."),
                "token 守卫测试".to_string(),
                SessionType::User,
            )
            .await
            .expect("创建会话失败");

        store
            .update_token_stats(
                &session.id,
                TokenStatsUpdate {
                    schedule_id: Some("job-1".to_string()),
                    total_tokens: Some(100),
                    input_tokens: Some(60),
                    output_tokens: Some(40),
                    accumulated_total: Some(300),
                    accumulated_input: Some(180),
                    accumulated_output: Some(120),
                },
            )
            .await
            .expect("初始化 token 统计失败");

        store
            .update_token_stats(
                &session.id,
                TokenStatsUpdate {
                    schedule_id: None,
                    total_tokens: None,
                    input_tokens: None,
                    output_tokens: None,
                    accumulated_total: None,
                    accumulated_input: None,
                    accumulated_output: None,
                },
            )
            .await
            .expect("更新空 token 统计失败");

        let loaded = store
            .get_session(&session.id, false)
            .await
            .expect("读取会话失败");

        assert_eq!(loaded.schedule_id.as_deref(), Some("job-1"));
        assert_eq!(loaded.total_tokens, Some(100));
        assert_eq!(loaded.input_tokens, Some(60));
        assert_eq!(loaded.output_tokens, Some(40));
        assert_eq!(loaded.accumulated_total_tokens, Some(300));
        assert_eq!(loaded.accumulated_input_tokens, Some(180));
        assert_eq!(loaded.accumulated_output_tokens, Some(120));
    }

    #[tokio::test]
    async fn update_token_stats_should_overwrite_current_window_with_explicit_zero() {
        let store = setup_test_store();
        let session = store
            .create_session(
                PathBuf::from("."),
                "token 清零测试".to_string(),
                SessionType::User,
            )
            .await
            .expect("创建会话失败");

        store
            .update_token_stats(
                &session.id,
                TokenStatsUpdate {
                    schedule_id: Some("job-1".to_string()),
                    total_tokens: Some(100),
                    input_tokens: Some(60),
                    output_tokens: Some(40),
                    accumulated_total: Some(300),
                    accumulated_input: Some(180),
                    accumulated_output: Some(120),
                },
            )
            .await
            .expect("初始化 token 统计失败");

        store
            .update_token_stats(
                &session.id,
                TokenStatsUpdate {
                    schedule_id: None,
                    total_tokens: Some(0),
                    input_tokens: Some(0),
                    output_tokens: Some(0),
                    accumulated_total: None,
                    accumulated_input: None,
                    accumulated_output: None,
                },
            )
            .await
            .expect("清零当前窗口 token 失败");

        let loaded = store
            .get_session(&session.id, false)
            .await
            .expect("读取会话失败");

        assert_eq!(loaded.schedule_id.as_deref(), Some("job-1"));
        assert_eq!(loaded.total_tokens, Some(0));
        assert_eq!(loaded.input_tokens, Some(0));
        assert_eq!(loaded.output_tokens, Some(0));
        assert_eq!(loaded.accumulated_total_tokens, Some(300));
        assert_eq!(loaded.accumulated_input_tokens, Some(180));
        assert_eq!(loaded.accumulated_output_tokens, Some(120));
    }
}
