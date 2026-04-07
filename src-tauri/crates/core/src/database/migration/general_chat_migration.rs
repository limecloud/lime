use rusqlite::{params, Connection};

use super::{is_true_setting, mark_true_setting};

pub const GENERAL_CHAT_MIGRATION_COMPLETED_KEY: &str = "migrated_general_chat_to_unified";
const LEGACY_GENERAL_CHAT_SESSIONS_TABLE: &str = "general_chat_sessions";
const LEGACY_GENERAL_CHAT_MESSAGES_TABLE: &str = "general_chat_messages";

pub fn is_general_chat_migration_completed(conn: &Connection) -> bool {
    is_true_setting(conn, GENERAL_CHAT_MIGRATION_COMPLETED_KEY)
}

/// 执行 General Chat 数据迁移到统一表
///
/// 将 general_chat_sessions/messages 数据迁移到 agent_sessions/messages 表
/// - general_chat_sessions → agent_sessions (mode 前缀为 "general:")
/// - general_chat_messages → agent_messages
pub fn migrate_general_chat_to_unified(conn: &Connection) -> Result<usize, String> {
    if is_general_chat_migration_completed(conn) {
        tracing::debug!("[迁移] General Chat 已迁移过，跳过");
        return Ok(0);
    }

    let general_session_count =
        legacy_general_chat_row_count(conn, LEGACY_GENERAL_CHAT_SESSIONS_TABLE)?.unwrap_or(0);
    let general_message_count =
        legacy_general_chat_row_count(conn, LEGACY_GENERAL_CHAT_MESSAGES_TABLE)?.unwrap_or(0);

    if general_session_count == 0 && general_message_count == 0 {
        tracing::info!("[迁移] 未检测到 legacy general_chat 数据，无需迁移");
        mark_true_setting(conn, GENERAL_CHAT_MIGRATION_COMPLETED_KEY)?;
        return Ok(0);
    }

    tracing::info!(
        "[迁移] 检测到 legacy general_chat 数据待迁移: sessions={}, messages={}",
        general_session_count,
        general_message_count
    );

    let migrated_sessions = if general_session_count > 0 {
        let migrated_sessions = migrate_general_sessions(conn)?;
        tracing::info!("[迁移] 迁移了 {} 个会话", migrated_sessions);
        migrated_sessions
    } else {
        0
    };

    let migrated_messages = if general_message_count > 0 {
        let migrated_messages = migrate_general_messages(conn)?;
        tracing::info!("[迁移] 迁移了 {} 条消息", migrated_messages);
        migrated_messages
    } else {
        0
    };

    mark_true_setting(conn, GENERAL_CHAT_MIGRATION_COMPLETED_KEY)?;

    tracing::info!("[迁移] General Chat 数据迁移完成！");
    Ok(migrated_sessions + migrated_messages)
}

fn legacy_general_chat_row_count(
    conn: &Connection,
    table_name: &str,
) -> Result<Option<i64>, String> {
    if !legacy_table_exists(conn, table_name)? {
        return Ok(None);
    }

    conn.query_row(&format!("SELECT COUNT(*) FROM {table_name}"), [], |row| {
        row.get(0)
    })
    .map(Some)
    .map_err(|error| format!("查询 legacy 表 {table_name} 行数失败: {error}"))
}

fn legacy_table_exists(conn: &Connection, table_name: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1 LIMIT 1",
        [table_name],
        |_| Ok(()),
    )
    .map(|_| true)
    .or_else(|error| match error {
        rusqlite::Error::QueryReturnedNoRows => Ok(false),
        _ => Err(format!("检测 legacy 表 {table_name} 是否存在失败: {error}")),
    })
}

fn migrate_general_sessions(conn: &Connection) -> Result<usize, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, created_at, updated_at, metadata
             FROM general_chat_sessions",
        )
        .map_err(|e| format!("准备查询语句失败: {e}"))?;

    let sessions: Vec<(String, String, i64, i64, Option<String>)> = stmt
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        })
        .map_err(|e| format!("查询会话失败: {e}"))?
        .filter_map(|row| row.ok())
        .collect();

    let mut count = 0;
    for (id, name, created_at, updated_at, _metadata) in sessions {
        let exists: bool = conn
            .query_row(
                "SELECT 1 FROM agent_sessions WHERE id = ?",
                params![&id],
                |_| Ok(true),
            )
            .unwrap_or(false);

        if exists {
            tracing::warn!("[迁移] 会话 {} 已存在，跳过", id);
            continue;
        }

        let created_str = timestamp_ms_to_rfc3339(created_at);
        let updated_str = timestamp_ms_to_rfc3339(updated_at);

        conn.execute(
            "INSERT INTO agent_sessions (id, model, system_prompt, title, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                id,
                "general:default",
                Option::<String>::None,
                name,
                created_str,
                updated_str,
            ],
        )
        .map_err(|e| format!("插入会话失败: {e}"))?;

        count += 1;
    }

    Ok(count)
}

fn migrate_general_messages(conn: &Connection) -> Result<usize, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, role, content, blocks, status, created_at, metadata
             FROM general_chat_messages",
        )
        .map_err(|e| format!("准备查询语句失败: {e}"))?;

    #[allow(clippy::type_complexity)]
    let messages: Vec<(
        String,
        String,
        String,
        String,
        Option<String>,
        String,
        i64,
        Option<String>,
    )> = stmt
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
                row.get(7)?,
            ))
        })
        .map_err(|e| format!("查询消息失败: {e}"))?
        .filter_map(|row| row.ok())
        .collect();

    let mut count = 0;
    for (_id, session_id, role, content, blocks, _status, created_at, _metadata) in messages {
        let session_exists: bool = conn
            .query_row(
                "SELECT 1 FROM agent_sessions WHERE id = ?",
                params![&session_id],
                |_| Ok(true),
            )
            .unwrap_or(false);

        if !session_exists {
            tracing::warn!("[迁移] 消息的会话 {} 不存在，跳过", session_id);
            continue;
        }

        let content_json = convert_general_content_to_json(&content, &blocks);
        let timestamp_str = timestamp_ms_to_rfc3339(created_at);

        if general_message_already_migrated(
            conn,
            &session_id,
            &role,
            &content_json,
            &timestamp_str,
        )? {
            tracing::debug!(
                "[迁移] general_chat 消息已存在于 unified 表，跳过: session_id={}, timestamp={}",
                session_id,
                timestamp_str
            );
            continue;
        }

        conn.execute(
            "INSERT INTO agent_messages (session_id, role, content_json, timestamp, tool_calls_json, tool_call_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                session_id,
                role,
                content_json,
                timestamp_str,
                Option::<String>::None,
                Option::<String>::None,
            ],
        )
        .map_err(|e| format!("插入消息失败: {e}"))?;

        count += 1;
    }

    Ok(count)
}

fn general_message_already_migrated(
    conn: &Connection,
    session_id: &str,
    role: &str,
    content_json: &str,
    timestamp: &str,
) -> Result<bool, String> {
    let exists = conn
        .query_row(
            "SELECT 1
             FROM agent_messages
             WHERE session_id = ?1
               AND role = ?2
               AND content_json = ?3
               AND timestamp = ?4
             LIMIT 1",
            params![session_id, role, content_json, timestamp],
            |_| Ok(true),
        )
        .unwrap_or(false);

    Ok(exists)
}

fn timestamp_ms_to_rfc3339(timestamp_ms: i64) -> String {
    use chrono::{TimeZone, Utc};

    let secs = timestamp_ms / 1000;
    let nsecs = ((timestamp_ms % 1000) * 1_000_000) as u32;

    match Utc.timestamp_opt(secs, nsecs) {
        chrono::LocalResult::Single(dt) => dt.to_rfc3339(),
        _ => Utc::now().to_rfc3339(),
    }
}

fn convert_general_content_to_json(content: &str, blocks: &Option<String>) -> String {
    if let Some(blocks_str) = blocks {
        if let Ok(blocks_arr) = serde_json::from_str::<Vec<serde_json::Value>>(blocks_str) {
            let converted: Vec<serde_json::Value> = blocks_arr
                .into_iter()
                .map(|block| {
                    if let Some(block_type) = block.get("type").and_then(|value| value.as_str()) {
                        match block_type {
                            "text" => {
                                let text = block
                                    .get("content")
                                    .and_then(|value| value.as_str())
                                    .unwrap_or("");
                                serde_json::json!({ "type": "text", "text": text })
                            }
                            "image" => {
                                let url = block
                                    .get("content")
                                    .and_then(|value| value.as_str())
                                    .unwrap_or("");
                                serde_json::json!({ "type": "image", "url": url })
                            }
                            _ => serde_json::json!({ "type": "text", "text": content }),
                        }
                    } else {
                        serde_json::json!({ "type": "text", "text": content })
                    }
                })
                .collect();

            if let Ok(json_str) = serde_json::to_string(&converted) {
                return json_str;
            }
        }
    }

    serde_json::json!([{ "type": "text", "text": content }]).to_string()
}

pub fn check_general_chat_migration_status(conn: &Connection) -> GeneralChatMigrationStatus {
    let migrated = is_general_chat_migration_completed(conn);

    let general_sessions = legacy_general_chat_row_count(conn, LEGACY_GENERAL_CHAT_SESSIONS_TABLE)
        .ok()
        .flatten()
        .unwrap_or(0);

    let general_messages = legacy_general_chat_row_count(conn, LEGACY_GENERAL_CHAT_MESSAGES_TABLE)
        .ok()
        .flatten()
        .unwrap_or(0);

    let unified_general_sessions: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM agent_sessions WHERE model LIKE 'general:%'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    GeneralChatMigrationStatus {
        general_sessions_count: general_sessions as usize,
        general_messages_count: general_messages as usize,
        migrated_sessions_count: unified_general_sessions as usize,
        needs_migration: (general_sessions > 0 || general_messages > 0) && !migrated,
    }
}

#[derive(Debug)]
pub struct GeneralChatMigrationStatus {
    pub general_sessions_count: usize,
    pub general_messages_count: usize,
    pub migrated_sessions_count: usize,
    pub needs_migration: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_general_chat_migration_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE general_chat_sessions (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                metadata TEXT
            );
            CREATE TABLE general_chat_messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                blocks TEXT,
                status TEXT NOT NULL DEFAULT 'complete',
                created_at INTEGER NOT NULL,
                metadata TEXT
            );
            CREATE TABLE agent_sessions (
                id TEXT PRIMARY KEY,
                model TEXT NOT NULL,
                system_prompt TEXT,
                title TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                working_dir TEXT,
                execution_strategy TEXT NOT NULL DEFAULT 'react'
            );
            CREATE TABLE agent_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content_json TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                tool_calls_json TEXT,
                tool_call_id TEXT,
                reasoning_content TEXT,
                input_tokens INTEGER,
                output_tokens INTEGER
            );
            ",
        )
        .unwrap();
        conn
    }

    fn setup_unified_only_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE agent_sessions (
                id TEXT PRIMARY KEY,
                model TEXT NOT NULL,
                system_prompt TEXT,
                title TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                working_dir TEXT,
                execution_strategy TEXT NOT NULL DEFAULT 'react'
            );
            CREATE TABLE agent_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content_json TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                tool_calls_json TEXT,
                tool_call_id TEXT,
                reasoning_content TEXT,
                input_tokens INTEGER,
                output_tokens INTEGER
            );
            ",
        )
        .unwrap();
        conn
    }

    #[test]
    fn migrate_general_chat_to_unified_is_safe_to_rerun() {
        let conn = setup_general_chat_migration_db();

        conn.execute(
            "INSERT INTO general_chat_sessions (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params!["legacy-session", "Legacy", 1_700_000_000_000i64, 1_700_000_000_100i64],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO general_chat_messages (id, session_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["legacy-msg-1", "legacy-session", "user", "你好", 1_700_000_000_001i64],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO general_chat_messages (id, session_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["legacy-msg-2", "legacy-session", "assistant", "你好！", 1_700_000_000_002i64],
        )
        .unwrap();

        let migrated = migrate_general_chat_to_unified(&conn).unwrap();
        assert_eq!(migrated, 3);

        let session_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM agent_sessions", [], |row| row.get(0))
            .unwrap();
        let message_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM agent_messages", [], |row| row.get(0))
            .unwrap();
        assert_eq!(session_count, 1);
        assert_eq!(message_count, 2);

        conn.execute(
            "DELETE FROM settings WHERE key = ?1",
            [GENERAL_CHAT_MIGRATION_COMPLETED_KEY],
        )
        .unwrap();

        let migrated_again = migrate_general_chat_to_unified(&conn).unwrap();
        assert_eq!(migrated_again, 0);

        let message_count_after: i64 = conn
            .query_row("SELECT COUNT(*) FROM agent_messages", [], |row| row.get(0))
            .unwrap();
        assert_eq!(message_count_after, 2);
    }

    #[test]
    fn general_chat_migration_status_uses_completion_flag() {
        let conn = setup_general_chat_migration_db();

        conn.execute(
            "INSERT INTO general_chat_sessions (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params!["legacy-session", "Legacy", 1_700_000_000_000i64, 1_700_000_000_100i64],
        )
        .unwrap();

        let pending = check_general_chat_migration_status(&conn);
        assert!(pending.needs_migration);

        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, 'true')",
            [GENERAL_CHAT_MIGRATION_COMPLETED_KEY],
        )
        .unwrap();

        let completed = check_general_chat_migration_status(&conn);
        assert!(!completed.needs_migration);
    }

    #[test]
    fn migrate_general_chat_without_legacy_tables_marks_completed() {
        let conn = setup_unified_only_db();

        let migrated = migrate_general_chat_to_unified(&conn).unwrap();
        assert_eq!(migrated, 0);
        assert!(is_general_chat_migration_completed(&conn));

        let status = check_general_chat_migration_status(&conn);
        assert_eq!(status.general_sessions_count, 0);
        assert_eq!(status.general_messages_count, 0);
        assert_eq!(status.migrated_sessions_count, 0);
        assert!(!status.needs_migration);
    }
}
