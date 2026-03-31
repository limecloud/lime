//! 统一对话数据访问层
//!
//! 提供统一的会话和消息存储功能，支持多种对话模式：
//! - Agent: AI Agent 模式，支持工具调用
//! - General: 通用对话模式，纯文本
//! - Workbench: 工作台模式，支持画布输出
//!
//! ## 设计原则
//! - 单一数据源：所有对话数据统一存储
//! - 模式化设计：通过 ChatMode 区分不同场景
//! - 向后兼容：复用现有的 agent_sessions/agent_messages 表

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

// ============================================================================
// 数据模型
// ============================================================================

/// 对话模式
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ChatMode {
    /// AI Agent 模式，支持工具调用
    Agent,
    /// 通用对话模式，纯文本
    #[default]
    General,
    /// 工作台模式，支持画布输出
    #[serde(rename = "workbench")]
    Workbench,
}

impl std::fmt::Display for ChatMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ChatMode::Agent => write!(f, "agent"),
            ChatMode::General => write!(f, "general"),
            ChatMode::Workbench => write!(f, "workbench"),
        }
    }
}

impl std::str::FromStr for ChatMode {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "agent" => Ok(ChatMode::Agent),
            "general" => Ok(ChatMode::General),
            "workbench" => Ok(ChatMode::Workbench),
            _ => Err(format!("未知的对话模式: {s}")),
        }
    }
}

/// 统一会话结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSession {
    /// 会话 ID
    pub id: String,
    /// 对话模式
    pub mode: ChatMode,
    /// 会话标题
    pub title: Option<String>,
    /// 系统提示词
    pub system_prompt: Option<String>,
    /// 模型名称
    pub model: Option<String>,
    /// Provider 类型
    pub provider_type: Option<String>,
    /// 凭证 UUID
    pub credential_uuid: Option<String>,
    /// 扩展元数据（JSON）
    pub metadata: Option<serde_json::Value>,
    /// 创建时间
    pub created_at: String,
    /// 更新时间
    pub updated_at: String,
}

/// 统一消息结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    /// 消息 ID
    pub id: i64,
    /// 会话 ID
    pub session_id: String,
    /// 角色 (user/assistant/system/tool)
    pub role: String,
    /// 消息内容（JSON 格式）
    pub content: serde_json::Value,
    /// 工具调用信息（JSON）
    pub tool_calls: Option<serde_json::Value>,
    /// 工具调用 ID
    pub tool_call_id: Option<String>,
    /// 扩展元数据（JSON）
    pub metadata: Option<serde_json::Value>,
    /// 创建时间
    pub created_at: String,
}

/// 会话详情（包含消息）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSessionDetail {
    /// 会话信息
    pub session: ChatSession,
    /// 消息列表
    pub messages: Vec<ChatMessage>,
    /// 消息总数
    pub message_count: usize,
}

// ============================================================================
// 数据访问对象
// ============================================================================

/// 统一对话 DAO
pub struct ChatDao;

impl ChatDao {
    // ------------------------------------------------------------------------
    // 会话管理
    // ------------------------------------------------------------------------

    /// 创建新会话
    pub fn create_session(conn: &Connection, session: &ChatSession) -> Result<(), rusqlite::Error> {
        // 使用现有的 agent_sessions 表，通过 model 字段存储 mode
        // 这样可以保持向后兼容
        let mode_str = session.mode.to_string();
        let metadata_json = session
            .metadata
            .as_ref()
            .map(|m| serde_json::to_string(m).unwrap_or_default());

        conn.execute(
            "INSERT INTO agent_sessions (id, model, system_prompt, title, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                session.id,
                format!(
                    "{}:{}",
                    mode_str,
                    session.model.as_deref().unwrap_or("default")
                ),
                session.system_prompt,
                session.title,
                session.created_at,
                session.updated_at,
            ],
        )?;

        // 如果有扩展元数据，存储到单独的字段（未来可扩展）
        if metadata_json.is_some() {
            tracing::debug!("[ChatDao] 会话 {} 有扩展元数据，暂存于内存", session.id);
        }

        Ok(())
    }

    /// 获取会话
    pub fn get_session(
        conn: &Connection,
        session_id: &str,
    ) -> Result<Option<ChatSession>, rusqlite::Error> {
        let mut stmt = conn.prepare(
            "SELECT id, model, system_prompt, title, created_at, updated_at
             FROM agent_sessions WHERE id = ?",
        )?;

        let mut rows = stmt.query([session_id])?;

        if let Some(row) = rows.next()? {
            let model_str: String = row.get(1)?;
            let (mode, model) = Self::parse_mode_model(&model_str);

            Ok(Some(ChatSession {
                id: row.get(0)?,
                mode,
                title: row.get(3)?,
                system_prompt: row.get(2)?,
                model,
                provider_type: None,
                credential_uuid: None,
                metadata: None,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            }))
        } else {
            Ok(None)
        }
    }

    /// 获取会话列表
    pub fn list_sessions(
        conn: &Connection,
        mode: Option<ChatMode>,
    ) -> Result<Vec<ChatSession>, rusqlite::Error> {
        let mut stmt = conn.prepare(
            "SELECT id, model, system_prompt, title, created_at, updated_at
             FROM agent_sessions ORDER BY updated_at DESC",
        )?;

        let sessions: Vec<ChatSession> = stmt
            .query_map([], |row| {
                let model_str: String = row.get(1)?;
                let (parsed_mode, model) = Self::parse_mode_model(&model_str);

                Ok(ChatSession {
                    id: row.get(0)?,
                    mode: parsed_mode,
                    title: row.get(3)?,
                    system_prompt: row.get(2)?,
                    model,
                    provider_type: None,
                    credential_uuid: None,
                    metadata: None,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        // 如果指定了模式，过滤结果
        if let Some(filter_mode) = mode {
            Ok(sessions
                .into_iter()
                .filter(|s| s.mode == filter_mode)
                .collect())
        } else {
            Ok(sessions)
        }
    }

    /// 删除会话
    pub fn delete_session(conn: &Connection, session_id: &str) -> Result<bool, rusqlite::Error> {
        let rows = conn.execute("DELETE FROM agent_sessions WHERE id = ?", [session_id])?;
        Ok(rows > 0)
    }

    /// 更新会话标题
    pub fn update_title(
        conn: &Connection,
        session_id: &str,
        title: &str,
    ) -> Result<(), rusqlite::Error> {
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE agent_sessions SET title = ?, updated_at = ? WHERE id = ?",
            params![title, now, session_id],
        )?;
        Ok(())
    }

    /// 检查会话是否存在
    pub fn session_exists(conn: &Connection, session_id: &str) -> Result<bool, rusqlite::Error> {
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM agent_sessions WHERE id = ?",
            [session_id],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    // ------------------------------------------------------------------------
    // 消息管理
    // ------------------------------------------------------------------------

    /// 添加消息
    pub fn add_message(conn: &Connection, message: &ChatMessage) -> Result<i64, rusqlite::Error> {
        let content_json = serde_json::to_string(&message.content)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

        let tool_calls_json = message
            .tool_calls
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

        conn.execute(
            "INSERT INTO agent_messages (session_id, role, content_json, timestamp, tool_calls_json, tool_call_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                message.session_id,
                message.role,
                content_json,
                message.created_at,
                tool_calls_json,
                message.tool_call_id,
            ],
        )?;

        let id = conn.last_insert_rowid();

        // 更新会话时间
        conn.execute(
            "UPDATE agent_sessions SET updated_at = ? WHERE id = ?",
            params![message.created_at, message.session_id],
        )?;

        Ok(id)
    }

    /// 获取会话消息
    pub fn get_messages(
        conn: &Connection,
        session_id: &str,
        limit: Option<i32>,
    ) -> Result<Vec<ChatMessage>, rusqlite::Error> {
        let query = if limit.is_some() {
            "SELECT id, session_id, role, content_json, timestamp, tool_calls_json, tool_call_id
             FROM agent_messages WHERE session_id = ? ORDER BY id ASC LIMIT ?"
        } else {
            "SELECT id, session_id, role, content_json, timestamp, tool_calls_json, tool_call_id
             FROM agent_messages WHERE session_id = ? ORDER BY id ASC"
        };

        let mut stmt = conn.prepare(query)?;

        let messages: Vec<ChatMessage> = if let Some(lim) = limit {
            stmt.query_map(params![session_id, lim], Self::map_message_row)?
        } else {
            stmt.query_map([session_id], Self::map_message_row)?
        }
        .filter_map(|r| r.ok())
        .collect();

        Ok(messages)
    }

    /// 获取消息数量
    pub fn get_message_count(
        conn: &Connection,
        session_id: &str,
    ) -> Result<usize, rusqlite::Error> {
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM agent_messages WHERE session_id = ?",
            [session_id],
            |row| row.get(0),
        )?;
        Ok(count as usize)
    }

    /// 删除会话消息
    pub fn delete_messages(conn: &Connection, session_id: &str) -> Result<(), rusqlite::Error> {
        conn.execute(
            "DELETE FROM agent_messages WHERE session_id = ?",
            [session_id],
        )?;
        Ok(())
    }

    // ------------------------------------------------------------------------
    // 辅助方法
    // ------------------------------------------------------------------------

    /// 解析 mode:model 格式的字符串
    fn parse_mode_model(model_str: &str) -> (ChatMode, Option<String>) {
        if let Some((mode_part, model_part)) = model_str.split_once(':') {
            let mode = mode_part.parse().unwrap_or(ChatMode::Agent);
            let model = if model_part == "default" || model_part.is_empty() {
                None
            } else {
                Some(model_part.to_string())
            };
            (mode, model)
        } else {
            // 兼容旧数据：没有 mode 前缀的视为 Agent 模式
            (ChatMode::Agent, Some(model_str.to_string()))
        }
    }

    /// 映射消息行
    fn map_message_row(row: &rusqlite::Row) -> Result<ChatMessage, rusqlite::Error> {
        let content_json: String = row.get(3)?;
        let tool_calls_json: Option<String> = row.get(5)?;

        // 解析内容 JSON
        let content: serde_json::Value = serde_json::from_str(&content_json).unwrap_or_else(|_| {
            // 如果解析失败，包装为文本
            serde_json::json!([{"type": "text", "text": content_json}])
        });

        let tool_calls: Option<serde_json::Value> =
            tool_calls_json.and_then(|json| serde_json::from_str(&json).ok());

        Ok(ChatMessage {
            id: row.get(0)?,
            session_id: row.get(1)?,
            role: row.get(2)?,
            content,
            tool_calls,
            tool_call_id: row.get(6)?,
            metadata: None,
            created_at: row.get(4)?,
        })
    }

    /// 获取会话详情（包含消息）
    pub fn get_session_detail(
        conn: &Connection,
        session_id: &str,
        message_limit: Option<i32>,
    ) -> Result<Option<ChatSessionDetail>, rusqlite::Error> {
        let session = match Self::get_session(conn, session_id)? {
            Some(s) => s,
            None => return Ok(None),
        };

        let messages = Self::get_messages(conn, session_id, message_limit)?;
        let message_count = Self::get_message_count(conn, session_id)?;

        Ok(Some(ChatSessionDetail {
            session,
            messages,
            message_count,
        }))
    }
}
