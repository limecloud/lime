use crate::database::dao::agent::{AgentDao, AgentModelPatternMatch};
use chrono::{Local, TimeZone};
use rusqlite::Connection;
use std::collections::HashSet;

const GENERAL_MODE_PATTERN: &str = "general:%";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemorySourceCandidate {
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub created_at: i64,
}

pub fn load_memory_source_candidates(
    conn: &Connection,
    from_timestamp: Option<i64>,
    to_timestamp: Option<i64>,
    limit: usize,
    min_message_length: usize,
) -> Result<Vec<MemorySourceCandidate>, String> {
    let mut candidates = Vec::new();
    let mut seen = HashSet::new();

    load_unified_general_candidates(
        conn,
        from_timestamp,
        to_timestamp,
        limit,
        min_message_length,
        &mut candidates,
        &mut seen,
    )?;
    load_non_general_agent_candidates(
        conn,
        from_timestamp,
        to_timestamp,
        limit,
        min_message_length,
        &mut candidates,
        &mut seen,
    )?;

    candidates.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    candidates.truncate(limit);

    Ok(candidates)
}

pub fn load_session_memory_source_candidates(
    conn: &Connection,
    session_id: &str,
    limit: usize,
    min_message_length: usize,
) -> Result<Vec<MemorySourceCandidate>, String> {
    let rows = AgentDao::list_message_text_rows_by_session_id(conn, session_id, limit)
        .map_err(|e| format!("读取 session agent_messages 失败: {e}"))?;
    let mut candidates = Vec::new();
    let mut seen = HashSet::new();

    for row in rows {
        push_candidate(
            &mut candidates,
            &mut seen,
            row.session_id,
            row.role,
            row.content,
            row.timestamp_ms,
            min_message_length,
        );
    }

    candidates.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    candidates.truncate(limit);

    Ok(candidates)
}

fn load_unified_general_candidates(
    conn: &Connection,
    from_timestamp: Option<i64>,
    to_timestamp: Option<i64>,
    limit: usize,
    min_message_length: usize,
    candidates: &mut Vec<MemorySourceCandidate>,
    seen: &mut HashSet<String>,
) -> Result<(), String> {
    let from_datetime = from_timestamp.map(format_sqlite_datetime);
    let to_datetime = to_timestamp.map(format_sqlite_datetime);

    let rows = AgentDao::list_message_text_rows_by_model_pattern(
        conn,
        GENERAL_MODE_PATTERN,
        AgentModelPatternMatch::Like,
        from_datetime.as_deref(),
        to_datetime.as_deref(),
        limit,
    )
    .map_err(|e| format!("读取 unified general agent_messages 失败: {e}"))?;

    for row in rows {
        push_candidate(
            candidates,
            seen,
            row.session_id,
            row.role,
            row.content,
            row.timestamp_ms,
            min_message_length,
        );
    }

    Ok(())
}

fn load_non_general_agent_candidates(
    conn: &Connection,
    from_timestamp: Option<i64>,
    to_timestamp: Option<i64>,
    limit: usize,
    min_message_length: usize,
    candidates: &mut Vec<MemorySourceCandidate>,
    seen: &mut HashSet<String>,
) -> Result<(), String> {
    let from_datetime = from_timestamp.map(format_sqlite_datetime);
    let to_datetime = to_timestamp.map(format_sqlite_datetime);

    let rows = AgentDao::list_message_text_rows_by_model_pattern(
        conn,
        GENERAL_MODE_PATTERN,
        AgentModelPatternMatch::NotLike,
        from_datetime.as_deref(),
        to_datetime.as_deref(),
        limit,
    )
    .map_err(|e| format!("读取非通用 agent_messages 失败: {e}"))?;

    for row in rows {
        push_candidate(
            candidates,
            seen,
            row.session_id,
            row.role,
            row.content,
            row.timestamp_ms,
            min_message_length,
        );
    }

    Ok(())
}

fn push_candidate(
    candidates: &mut Vec<MemorySourceCandidate>,
    seen: &mut HashSet<String>,
    session_id: String,
    role: String,
    content: String,
    created_at: i64,
    min_message_length: usize,
) {
    let normalized = normalize_candidate_content(&content);
    if normalized.len() < min_message_length {
        return;
    }

    let normalized_role = role.to_lowercase();
    if normalized_role != "user" && normalized_role != "assistant" {
        return;
    }

    let normalized_created_at = normalize_timestamp(created_at);
    let dedupe_key = format!(
        "{}:{}:{}:{}",
        session_id, normalized_role, normalized_created_at, normalized
    );

    if !seen.insert(dedupe_key) {
        return;
    }

    candidates.push(MemorySourceCandidate {
        session_id,
        role: normalized_role,
        content: normalized,
        created_at: normalized_created_at,
    });
}

fn normalize_candidate_content(content: &str) -> String {
    content
        .replace('\n', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn normalize_timestamp(ts: i64) -> i64 {
    if ts <= 0 {
        return chrono::Utc::now().timestamp_millis();
    }
    if ts > 1_000_000_000_000 {
        ts
    } else {
        ts * 1000
    }
}

fn format_sqlite_datetime(timestamp_ms: i64) -> String {
    let normalized = normalize_timestamp(timestamp_ms);
    Local
        .timestamp_millis_opt(normalized)
        .single()
        .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
        .unwrap_or_else(|| Local::now().format("%Y-%m-%d %H:%M:%S").to_string())
}

#[cfg(test)]
mod tests {
    use super::{load_memory_source_candidates, load_session_memory_source_candidates};
    use rusqlite::{params, Connection};

    fn create_test_schema(conn: &Connection) {
        conn.execute_batch(
            "
            CREATE TABLE agent_sessions (
                id TEXT PRIMARY KEY,
                model TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
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
            ",
        )
        .expect("create test schema");
    }

    #[test]
    fn load_memory_source_candidates_only_reads_unified_general_and_agent_messages() {
        let conn = Connection::open_in_memory().expect("open in memory db");
        create_test_schema(&conn);

        conn.execute(
            "INSERT INTO agent_sessions (id, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![
                "general-migrated",
                "general:default",
                "2026-03-12T10:00:00+08:00",
                "2026-03-12T10:00:00+08:00"
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agent_sessions (id, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![
                "agent-1",
                "claude-sonnet-4",
                "2026-03-12T10:05:00+08:00",
                "2026-03-12T10:05:00+08:00"
            ],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO agent_messages (session_id, role, content_json, timestamp) VALUES (?1, ?2, ?3, ?4)",
            params![
                "general-migrated",
                "user",
                r#"[{"type":"text","text":"这条消息已经迁移"}]"#,
                "2025-03-12T10:00:00+08:00"
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agent_messages (session_id, role, content_json, timestamp) VALUES (?1, ?2, ?3, ?4)",
            params![
                "agent-1",
                "assistant",
                r#"[{"type":"text","text":"这是一条 agent 消息"}]"#,
                "2025-03-12T10:05:00+08:00"
            ],
        )
        .unwrap();

        let candidates =
            load_memory_source_candidates(&conn, None, None, 20, 1).expect("load candidates");

        let session_ids = candidates
            .iter()
            .map(|item| item.session_id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(candidates.len(), 2);
        assert!(session_ids.contains(&"general-migrated"));
        assert!(session_ids.contains(&"agent-1"));
    }

    #[test]
    fn load_memory_source_candidates_ignores_pending_general_tables() {
        let conn = Connection::open_in_memory().expect("open in memory db");
        create_test_schema(&conn);

        conn.execute(
            "INSERT INTO agent_sessions (id, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![
                "general-migrated",
                "general:default",
                "2026-03-12T10:00:00+08:00",
                "2026-03-12T10:00:00+08:00"
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agent_sessions (id, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![
                "agent-1",
                "claude-sonnet-4",
                "2026-03-12T10:05:00+08:00",
                "2026-03-12T10:05:00+08:00"
            ],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO general_chat_sessions (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params!["legacy-only", "旧会话", 1_741_744_100_000i64, 1_741_744_100_000i64],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO general_chat_messages (id, session_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["g1", "legacy-only", "assistant", "这条消息不应再参与运行时候选", 1_741_744_100_000i64],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO agent_messages (session_id, role, content_json, timestamp) VALUES (?1, ?2, ?3, ?4)",
            params![
                "general-migrated",
                "user",
                r#"[{"type":"text","text":"这是 unified general 消息"}]"#,
                "2026-03-12T10:00:00+08:00"
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agent_messages (session_id, role, content_json, timestamp) VALUES (?1, ?2, ?3, ?4)",
            params![
                "agent-1",
                "assistant",
                r#"[{"type":"text","text":"这是 agent 消息"}]"#,
                "2026-03-12T10:05:00+08:00"
            ],
        )
        .unwrap();

        let candidates =
            load_memory_source_candidates(&conn, None, None, 20, 1).expect("load candidates");

        let session_ids = candidates
            .iter()
            .map(|item| item.session_id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(candidates.len(), 2);
        assert!(session_ids.contains(&"general-migrated"));
        assert!(session_ids.contains(&"agent-1"));
        assert!(!session_ids.contains(&"legacy-only"));
    }

    #[test]
    fn load_session_memory_source_candidates_only_reads_target_session() {
        let conn = Connection::open_in_memory().expect("open in memory db");
        create_test_schema(&conn);

        conn.execute(
            "INSERT INTO agent_sessions (id, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![
                "agent-1",
                "claude-sonnet-4",
                "2026-03-12T10:00:00+08:00",
                "2026-03-12T10:00:00+08:00"
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agent_sessions (id, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![
                "agent-2",
                "claude-sonnet-4",
                "2026-03-12T10:05:00+08:00",
                "2026-03-12T10:05:00+08:00"
            ],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO agent_messages (session_id, role, content_json, timestamp) VALUES (?1, ?2, ?3, ?4)",
            params![
                "agent-1",
                "user",
                r#"[{"type":"text","text":"请记住我现在更偏好 pnpm 工作流"}]"#,
                "2026-03-12T10:00:00+08:00"
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agent_messages (session_id, role, content_json, timestamp) VALUES (?1, ?2, ?3, ?4)",
            params![
                "agent-2",
                "assistant",
                r#"[{"type":"text","text":"这条消息不该进入 agent-1 的自动抽取"}]"#,
                "2026-03-12T10:05:00+08:00"
            ],
        )
        .unwrap();

        let candidates = load_session_memory_source_candidates(&conn, "agent-1", 10, 1)
            .expect("load session candidates");

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].session_id, "agent-1");
        assert!(candidates[0].content.contains("pnpm"));
    }
}
