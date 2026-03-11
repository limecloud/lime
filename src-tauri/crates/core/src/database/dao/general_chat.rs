//! 通用对话会话和消息的数据访问层
//!
//! 提供通用对话会话和消息的持久化存储功能
//!
//! ## 主要功能
//! - `create_session` - 创建新会话
//! - `list_sessions` - 获取会话列表
//! - `get_session` - 获取单个会话
//! - `delete_session` - 删除会话
//! - `rename_session` - 重命名会话
//! - `update_session_time` - 更新会话时间
//! - `add_message` - 添加消息
//! - `get_messages` - 获取消息列表
//! - `get_message_count` - 获取消息数量
//! - `delete_messages` - 删除会话消息

use crate::general_chat::{ChatMessage, ChatSession, ContentBlock, MessageRole};
use rusqlite::{params, Connection};

pub struct GeneralChatDao;

impl GeneralChatDao {
    // ==================== 会话 CRUD ====================

    /// 创建新会话
    pub fn create_session(conn: &Connection, session: &ChatSession) -> Result<(), rusqlite::Error> {
        let metadata_json = session
            .metadata
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

        conn.execute(
            "INSERT INTO general_chat_sessions (id, name, created_at, updated_at, metadata)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                session.id,
                session.name,
                session.created_at,
                session.updated_at,
                metadata_json,
            ],
        )?;
        Ok(())
    }

    /// 获取所有会话列表（按更新时间降序排列）
    pub fn list_sessions(conn: &Connection) -> Result<Vec<ChatSession>, rusqlite::Error> {
        let mut stmt = conn.prepare(
            "SELECT id, name, created_at, updated_at, metadata
             FROM general_chat_sessions ORDER BY updated_at DESC",
        )?;

        let sessions = stmt.query_map([], |row| {
            let metadata_json: Option<String> = row.get(4)?;
            let metadata = metadata_json
                .map(|json| serde_json::from_str(&json))
                .transpose()
                .map_err(|e| {
                    rusqlite::Error::FromSqlConversionFailure(
                        4,
                        rusqlite::types::Type::Text,
                        Box::new(e),
                    )
                })?;

            Ok(ChatSession {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
                metadata,
            })
        })?;

        sessions.collect()
    }

    /// 获取单个会话（不包含消息）
    pub fn get_session(
        conn: &Connection,
        session_id: &str,
    ) -> Result<Option<ChatSession>, rusqlite::Error> {
        let mut stmt = conn.prepare(
            "SELECT id, name, created_at, updated_at, metadata
             FROM general_chat_sessions WHERE id = ?",
        )?;

        let mut rows = stmt.query([session_id])?;

        if let Some(row) = rows.next()? {
            let metadata_json: Option<String> = row.get(4)?;
            let metadata = metadata_json
                .map(|json| serde_json::from_str(&json))
                .transpose()
                .map_err(|e| {
                    rusqlite::Error::FromSqlConversionFailure(
                        4,
                        rusqlite::types::Type::Text,
                        Box::new(e),
                    )
                })?;

            Ok(Some(ChatSession {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
                metadata,
            }))
        } else {
            Ok(None)
        }
    }

    /// 删除会话（消息会通过外键级联删除）
    pub fn delete_session(conn: &Connection, session_id: &str) -> Result<bool, rusqlite::Error> {
        let rows = conn.execute(
            "DELETE FROM general_chat_sessions WHERE id = ?",
            [session_id],
        )?;
        Ok(rows > 0)
    }

    /// 重命名会话
    pub fn rename_session(
        conn: &Connection,
        session_id: &str,
        name: &str,
    ) -> Result<bool, rusqlite::Error> {
        let now = chrono::Utc::now().timestamp_millis();
        let rows = conn.execute(
            "UPDATE general_chat_sessions SET name = ?, updated_at = ? WHERE id = ?",
            params![name, now, session_id],
        )?;
        Ok(rows > 0)
    }

    /// 更新会话的 updated_at 时间
    pub fn update_session_time(
        conn: &Connection,
        session_id: &str,
        updated_at: i64,
    ) -> Result<(), rusqlite::Error> {
        conn.execute(
            "UPDATE general_chat_sessions SET updated_at = ? WHERE id = ?",
            params![updated_at, session_id],
        )?;
        Ok(())
    }

    /// 检查会话是否存在
    pub fn session_exists(conn: &Connection, session_id: &str) -> Result<bool, rusqlite::Error> {
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM general_chat_sessions WHERE id = ?",
            [session_id],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    // ==================== 消息 CRUD ====================

    /// 添加消息到会话
    pub fn add_message(conn: &Connection, message: &ChatMessage) -> Result<(), rusqlite::Error> {
        let blocks_json = message
            .blocks
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

        let metadata_json = message
            .metadata
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

        let role_str = match message.role {
            MessageRole::User => "user",
            MessageRole::Assistant => "assistant",
            MessageRole::System => "system",
        };

        conn.execute(
            "INSERT INTO general_chat_messages (id, session_id, role, content, blocks, status, created_at, metadata)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                message.id,
                message.session_id,
                role_str,
                message.content,
                blocks_json,
                message.status,
                message.created_at,
                metadata_json,
            ],
        )?;

        // 更新会话的 updated_at
        Self::update_session_time(conn, &message.session_id, message.created_at)?;

        Ok(())
    }

    /// 获取会话的消息列表
    ///
    /// # Arguments
    /// * `conn` - 数据库连接
    /// * `session_id` - 会话 ID
    /// * `limit` - 限制返回数量（可选）
    /// * `before_id` - 在此消息 ID 之前的消息（用于分页）
    pub fn get_messages(
        conn: &Connection,
        session_id: &str,
        limit: Option<i32>,
        before_id: Option<&str>,
    ) -> Result<Vec<ChatMessage>, rusqlite::Error> {
        let before_filter = r#"
            AND (
                NOT EXISTS (
                    SELECT 1
                    FROM general_chat_messages before_message
                    WHERE before_message.session_id = ?1
                      AND before_message.id = ?2
                )
                OR created_at < (
                    SELECT before_message.created_at
                    FROM general_chat_messages before_message
                    WHERE before_message.session_id = ?1
                      AND before_message.id = ?2
                )
                OR (
                    created_at = (
                        SELECT before_message.created_at
                        FROM general_chat_messages before_message
                        WHERE before_message.session_id = ?1
                          AND before_message.id = ?2
                    )
                    AND id < ?2
                )
            )
        "#;

        let query = match (limit, before_id) {
            (Some(lim), Some(_bid)) => {
                format!(
                    "SELECT id, session_id, role, content, blocks, status, created_at, metadata
                     FROM general_chat_messages
                     WHERE session_id = ?1
                     {before_filter}
                     ORDER BY created_at DESC, id DESC
                     LIMIT {lim}"
                )
            }
            (Some(lim), None) => {
                format!(
                    "SELECT id, session_id, role, content, blocks, status, created_at, metadata
                     FROM general_chat_messages
                     WHERE session_id = ?1
                     ORDER BY created_at DESC, id DESC
                     LIMIT {lim}"
                )
            }
            (None, Some(_)) => {
                format!(
                    "SELECT id, session_id, role, content, blocks, status, created_at, metadata
                     FROM general_chat_messages
                     WHERE session_id = ?1
                     {before_filter}
                     ORDER BY created_at ASC, id ASC"
                )
            }
            (None, None) => {
                "SELECT id, session_id, role, content, blocks, status, created_at, metadata
                 FROM general_chat_messages
                 WHERE session_id = ?1
                 ORDER BY created_at ASC, id ASC"
                    .to_string()
            }
        };

        let mut stmt = conn.prepare(&query)?;

        let messages = if before_id.is_some() {
            stmt.query_map(params![session_id, before_id], Self::map_message_row)?
        } else {
            stmt.query_map(params![session_id], Self::map_message_row)?
        };

        let mut result: Vec<ChatMessage> = messages.collect::<Result<Vec<_>, _>>()?;

        // 如果有 limit，结果是倒序的，需要反转
        if limit.is_some() {
            result.reverse();
        }

        Ok(result)
    }

    /// 获取会话的消息数量
    pub fn get_message_count(conn: &Connection, session_id: &str) -> Result<i64, rusqlite::Error> {
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM general_chat_messages WHERE session_id = ?",
            [session_id],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    /// 删除会话的所有消息
    pub fn delete_messages(conn: &Connection, session_id: &str) -> Result<(), rusqlite::Error> {
        conn.execute(
            "DELETE FROM general_chat_messages WHERE session_id = ?",
            [session_id],
        )?;
        Ok(())
    }

    // ==================== 辅助方法 ====================

    /// 从数据库行映射到 ChatMessage
    fn map_message_row(row: &rusqlite::Row) -> Result<ChatMessage, rusqlite::Error> {
        let role_str: String = row.get(2)?;
        let role = match role_str.as_str() {
            "user" => MessageRole::User,
            "assistant" => MessageRole::Assistant,
            "system" => MessageRole::System,
            _ => MessageRole::User,
        };

        let blocks_json: Option<String> = row.get(4)?;
        let blocks: Option<Vec<ContentBlock>> = blocks_json
            .map(|json| serde_json::from_str(&json))
            .transpose()
            .map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(
                    4,
                    rusqlite::types::Type::Text,
                    Box::new(e),
                )
            })?;

        let metadata_json: Option<String> = row.get(7)?;
        let metadata = metadata_json
            .map(|json| serde_json::from_str(&json))
            .transpose()
            .map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(
                    7,
                    rusqlite::types::Type::Text,
                    Box::new(e),
                )
            })?;

        Ok(ChatMessage {
            id: row.get(0)?,
            session_id: row.get(1)?,
            role,
            content: row.get(3)?,
            blocks,
            status: row.get(5)?,
            created_at: row.get(6)?,
            metadata,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::general_chat::MessageRole;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();

        // 创建会话表
        conn.execute(
            "CREATE TABLE general_chat_sessions (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                metadata TEXT
            )",
            [],
        )
        .unwrap();

        // 创建消息表
        conn.execute(
            "CREATE TABLE general_chat_messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
                content TEXT NOT NULL,
                blocks TEXT,
                status TEXT NOT NULL DEFAULT 'complete',
                created_at INTEGER NOT NULL,
                metadata TEXT,
                FOREIGN KEY (session_id) REFERENCES general_chat_sessions(id) ON DELETE CASCADE
            )",
            [],
        )
        .unwrap();

        // 启用外键约束
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();

        conn
    }

    fn create_test_session(id: &str, name: &str) -> ChatSession {
        let now = chrono::Utc::now().timestamp_millis();
        ChatSession {
            id: id.to_string(),
            name: name.to_string(),
            created_at: now,
            updated_at: now,
            metadata: None,
        }
    }

    fn create_test_message(
        id: &str,
        session_id: &str,
        role: MessageRole,
        content: &str,
    ) -> ChatMessage {
        let now = chrono::Utc::now().timestamp_millis();
        ChatMessage {
            id: id.to_string(),
            session_id: session_id.to_string(),
            role,
            content: content.to_string(),
            blocks: None,
            status: "complete".to_string(),
            created_at: now,
            metadata: None,
        }
    }

    fn create_test_message_with_timestamp(
        id: &str,
        session_id: &str,
        role: MessageRole,
        content: &str,
        created_at: i64,
    ) -> ChatMessage {
        ChatMessage {
            id: id.to_string(),
            session_id: session_id.to_string(),
            role,
            content: content.to_string(),
            blocks: None,
            status: "complete".to_string(),
            created_at,
            metadata: None,
        }
    }

    #[test]
    fn test_create_and_get_session() {
        let conn = setup_test_db();
        let session = create_test_session("session-1", "测试会话");

        GeneralChatDao::create_session(&conn, &session).unwrap();

        let loaded = GeneralChatDao::get_session(&conn, "session-1").unwrap();
        assert!(loaded.is_some());

        let loaded = loaded.unwrap();
        assert_eq!(loaded.id, "session-1");
        assert_eq!(loaded.name, "测试会话");
    }

    #[test]
    fn test_list_sessions() {
        let conn = setup_test_db();

        let session1 = create_test_session("session-1", "会话1");
        let session2 = create_test_session("session-2", "会话2");

        GeneralChatDao::create_session(&conn, &session1).unwrap();
        GeneralChatDao::create_session(&conn, &session2).unwrap();

        let sessions = GeneralChatDao::list_sessions(&conn).unwrap();
        assert_eq!(sessions.len(), 2);
    }

    #[test]
    fn test_delete_session() {
        let conn = setup_test_db();
        let session = create_test_session("session-1", "测试会话");

        GeneralChatDao::create_session(&conn, &session).unwrap();

        let deleted = GeneralChatDao::delete_session(&conn, "session-1").unwrap();
        assert!(deleted);

        let loaded = GeneralChatDao::get_session(&conn, "session-1").unwrap();
        assert!(loaded.is_none());
    }

    #[test]
    fn test_delete_nonexistent_session() {
        let conn = setup_test_db();

        let deleted = GeneralChatDao::delete_session(&conn, "nonexistent").unwrap();
        assert!(!deleted);
    }

    #[test]
    fn test_rename_session() {
        let conn = setup_test_db();
        let session = create_test_session("session-1", "原名称");

        GeneralChatDao::create_session(&conn, &session).unwrap();

        let renamed = GeneralChatDao::rename_session(&conn, "session-1", "新名称").unwrap();
        assert!(renamed);

        let loaded = GeneralChatDao::get_session(&conn, "session-1")
            .unwrap()
            .unwrap();
        assert_eq!(loaded.name, "新名称");
    }

    #[test]
    fn test_session_exists() {
        let conn = setup_test_db();
        let session = create_test_session("session-1", "测试会话");

        assert!(!GeneralChatDao::session_exists(&conn, "session-1").unwrap());

        GeneralChatDao::create_session(&conn, &session).unwrap();

        assert!(GeneralChatDao::session_exists(&conn, "session-1").unwrap());
    }

    #[test]
    fn test_add_and_get_messages() {
        let conn = setup_test_db();
        let session = create_test_session("session-1", "测试会话");
        GeneralChatDao::create_session(&conn, &session).unwrap();

        let msg1 = create_test_message("msg-1", "session-1", MessageRole::User, "你好");
        let msg2 = create_test_message(
            "msg-2",
            "session-1",
            MessageRole::Assistant,
            "你好！有什么可以帮助你的？",
        );

        GeneralChatDao::add_message(&conn, &msg1).unwrap();
        GeneralChatDao::add_message(&conn, &msg2).unwrap();

        let messages = GeneralChatDao::get_messages(&conn, "session-1", None, None).unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].content, "你好");
        assert_eq!(messages[1].content, "你好！有什么可以帮助你的？");
    }

    #[test]
    fn test_get_messages_with_limit() {
        let conn = setup_test_db();
        let session = create_test_session("session-1", "测试会话");
        GeneralChatDao::create_session(&conn, &session).unwrap();

        for i in 1..=5 {
            let msg = create_test_message(
                &format!("msg-{i}"),
                "session-1",
                MessageRole::User,
                &format!("消息 {i}"),
            );
            GeneralChatDao::add_message(&conn, &msg).unwrap();
        }

        let messages = GeneralChatDao::get_messages(&conn, "session-1", Some(3), None).unwrap();
        assert_eq!(messages.len(), 3);
    }

    #[test]
    fn test_get_message_count() {
        let conn = setup_test_db();
        let session = create_test_session("session-1", "测试会话");
        GeneralChatDao::create_session(&conn, &session).unwrap();

        assert_eq!(
            GeneralChatDao::get_message_count(&conn, "session-1").unwrap(),
            0
        );

        let msg = create_test_message("msg-1", "session-1", MessageRole::User, "你好");
        GeneralChatDao::add_message(&conn, &msg).unwrap();

        assert_eq!(
            GeneralChatDao::get_message_count(&conn, "session-1").unwrap(),
            1
        );
    }

    #[test]
    fn test_delete_messages() {
        let conn = setup_test_db();
        let session = create_test_session("session-1", "测试会话");
        GeneralChatDao::create_session(&conn, &session).unwrap();

        let msg = create_test_message("msg-1", "session-1", MessageRole::User, "你好");
        GeneralChatDao::add_message(&conn, &msg).unwrap();

        GeneralChatDao::delete_messages(&conn, "session-1").unwrap();

        assert_eq!(
            GeneralChatDao::get_message_count(&conn, "session-1").unwrap(),
            0
        );
    }

    #[test]
    fn test_message_with_blocks() {
        let conn = setup_test_db();
        let session = create_test_session("session-1", "测试会话");
        GeneralChatDao::create_session(&conn, &session).unwrap();

        let now = chrono::Utc::now().timestamp_millis();
        let msg = ChatMessage {
            id: "msg-1".to_string(),
            session_id: "session-1".to_string(),
            role: MessageRole::Assistant,
            content: "这是一段代码：".to_string(),
            blocks: Some(vec![ContentBlock {
                r#type: "code".to_string(),
                content: "fn main() {}".to_string(),
                language: Some("rust".to_string()),
                filename: None,
                mime_type: None,
            }]),
            status: "complete".to_string(),
            created_at: now,
            metadata: None,
        };

        GeneralChatDao::add_message(&conn, &msg).unwrap();

        let messages = GeneralChatDao::get_messages(&conn, "session-1", None, None).unwrap();
        assert_eq!(messages.len(), 1);

        let loaded = &messages[0];
        assert!(loaded.blocks.is_some());

        let blocks = loaded.blocks.as_ref().unwrap();
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].r#type, "code");
        assert_eq!(blocks[0].language, Some("rust".to_string()));
    }

    #[test]
    fn test_get_messages_before_id_uses_created_at_pagination() {
        let conn = setup_test_db();
        let session = create_test_session("session-1", "测试会话");
        GeneralChatDao::create_session(&conn, &session).unwrap();

        let oldest = create_test_message_with_timestamp(
            "z-message",
            "session-1",
            MessageRole::User,
            "第一条",
            1_700_000_000_001,
        );
        let middle = create_test_message_with_timestamp(
            "a-message",
            "session-1",
            MessageRole::Assistant,
            "第二条",
            1_700_000_000_002,
        );
        let newest = create_test_message_with_timestamp(
            "m-message",
            "session-1",
            MessageRole::User,
            "第三条",
            1_700_000_000_003,
        );

        GeneralChatDao::add_message(&conn, &oldest).unwrap();
        GeneralChatDao::add_message(&conn, &middle).unwrap();
        GeneralChatDao::add_message(&conn, &newest).unwrap();

        let messages =
            GeneralChatDao::get_messages(&conn, "session-1", Some(10), Some("a-message")).unwrap();

        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].id, "z-message");
    }
}
