//! Agent 线程时间线数据访问层
//!
//! 在现有 `agent_sessions` 基础上补充 turn / item 一等事件持久化。

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

const HISTORY_FILE_ARTIFACT_INLINE_CONTENT_BYTES_LIMIT: usize = 16 * 1024;

fn history_item_payload_json_projection_sql() -> String {
    format!(
        "CASE
             WHEN item_type = 'file_artifact'
                  AND length(payload_json) > {limit}
                  AND json_valid(payload_json)
             THEN json_remove(payload_json, '$.content')
             ELSE payload_json
         END",
        limit = HISTORY_FILE_ARTIFACT_INLINE_CONTENT_BYTES_LIMIT,
    )
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentThreadTurnStatus {
    Running,
    Completed,
    Failed,
    Aborted,
}

impl AgentThreadTurnStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Aborted => "aborted",
        }
    }
}

impl TryFrom<&str> for AgentThreadTurnStatus {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "running" => Ok(Self::Running),
            "completed" => Ok(Self::Completed),
            "failed" => Ok(Self::Failed),
            "aborted" => Ok(Self::Aborted),
            other => Err(format!("未知 turn 状态: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentThreadItemStatus {
    InProgress,
    Completed,
    Failed,
}

impl AgentThreadItemStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::InProgress => "in_progress",
            Self::Completed => "completed",
            Self::Failed => "failed",
        }
    }
}

impl TryFrom<&str> for AgentThreadItemStatus {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "in_progress" => Ok(Self::InProgress),
            "completed" => Ok(Self::Completed),
            "failed" => Ok(Self::Failed),
            other => Err(format!("未知 item 状态: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AgentRequestOption {
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AgentRequestQuestion {
    pub question: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<AgentRequestOption>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub multi_select: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentThreadItemPayload {
    UserMessage {
        content: String,
    },
    AgentMessage {
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        phase: Option<String>,
    },
    Plan {
        text: String,
    },
    Reasoning {
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        summary: Option<Vec<String>>,
    },
    ToolCall {
        tool_name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        arguments: Option<serde_json::Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        output: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        success: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        metadata: Option<serde_json::Value>,
    },
    CommandExecution {
        command: String,
        cwd: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        aggregated_output: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        exit_code: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    WebSearch {
        #[serde(skip_serializing_if = "Option::is_none")]
        query: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        action: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        output: Option<String>,
    },
    ApprovalRequest {
        request_id: String,
        action_type: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        prompt: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_name: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        arguments: Option<serde_json::Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        response: Option<serde_json::Value>,
    },
    RequestUserInput {
        request_id: String,
        action_type: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        prompt: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        questions: Option<Vec<AgentRequestQuestion>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        response: Option<serde_json::Value>,
    },
    FileArtifact {
        path: String,
        source: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        content: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        metadata: Option<serde_json::Value>,
    },
    SubagentActivity {
        status_label: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        summary: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        role: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        model: Option<String>,
    },
    Warning {
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
    },
    ContextCompaction {
        stage: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        trigger: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        detail: Option<String>,
    },
    Error {
        message: String,
    },
    TurnSummary {
        text: String,
    },
}

impl AgentThreadItemPayload {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::UserMessage { .. } => "user_message",
            Self::AgentMessage { .. } => "agent_message",
            Self::Plan { .. } => "plan",
            Self::Reasoning { .. } => "reasoning",
            Self::ToolCall { .. } => "tool_call",
            Self::CommandExecution { .. } => "command_execution",
            Self::WebSearch { .. } => "web_search",
            Self::ApprovalRequest { .. } => "approval_request",
            Self::RequestUserInput { .. } => "request_user_input",
            Self::FileArtifact { .. } => "file_artifact",
            Self::SubagentActivity { .. } => "subagent_activity",
            Self::Warning { .. } => "warning",
            Self::ContextCompaction { .. } => "context_compaction",
            Self::Error { .. } => "error",
            Self::TurnSummary { .. } => "turn_summary",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AgentThreadTurn {
    pub id: String,
    pub thread_id: String,
    pub prompt_text: String,
    pub status: AgentThreadTurnStatus,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AgentThreadItem {
    pub id: String,
    pub thread_id: String,
    pub turn_id: String,
    pub sequence: i64,
    pub status: AgentThreadItemStatus,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    pub updated_at: String,
    #[serde(flatten)]
    pub payload: AgentThreadItemPayload,
}

pub struct AgentTimelineDao;

impl AgentTimelineDao {
    pub fn create_turn(conn: &Connection, turn: &AgentThreadTurn) -> Result<(), rusqlite::Error> {
        conn.execute(
            "INSERT INTO agent_thread_turns (
                id, session_id, prompt_text, status, started_at, completed_at,
                error_message, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                turn.id,
                turn.thread_id,
                turn.prompt_text,
                turn.status.as_str(),
                turn.started_at,
                turn.completed_at,
                turn.error_message,
                turn.created_at,
                turn.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn upsert_turn(conn: &Connection, turn: &AgentThreadTurn) -> Result<(), rusqlite::Error> {
        conn.execute(
            "INSERT INTO agent_thread_turns (
                id, session_id, prompt_text, status, started_at, completed_at,
                error_message, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(id) DO UPDATE SET
                session_id = excluded.session_id,
                prompt_text = excluded.prompt_text,
                status = excluded.status,
                started_at = excluded.started_at,
                completed_at = excluded.completed_at,
                error_message = excluded.error_message,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at",
            params![
                turn.id,
                turn.thread_id,
                turn.prompt_text,
                turn.status.as_str(),
                turn.started_at,
                turn.completed_at,
                turn.error_message,
                turn.created_at,
                turn.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn update_turn_status(
        conn: &Connection,
        turn_id: &str,
        status: AgentThreadTurnStatus,
        completed_at: Option<&str>,
        error_message: Option<&str>,
        updated_at: &str,
    ) -> Result<(), rusqlite::Error> {
        conn.execute(
            "UPDATE agent_thread_turns
             SET status = ?1,
                 completed_at = COALESCE(?2, completed_at),
                 error_message = COALESCE(?3, error_message),
                 updated_at = ?4
             WHERE id = ?5",
            params![
                status.as_str(),
                completed_at,
                error_message,
                updated_at,
                turn_id,
            ],
        )?;
        Ok(())
    }

    pub fn list_turns_by_thread(
        conn: &Connection,
        thread_id: &str,
    ) -> Result<Vec<AgentThreadTurn>, rusqlite::Error> {
        let mut stmt = conn.prepare(
            "SELECT id, session_id, prompt_text, status, started_at, completed_at,
                    error_message, created_at, updated_at
             FROM agent_thread_turns
             WHERE session_id = ?1
             ORDER BY started_at ASC, id ASC",
        )?;

        let rows = stmt.query_map(params![thread_id], |row| {
            let status_raw: String = row.get(3)?;
            let status = AgentThreadTurnStatus::try_from(status_raw.as_str()).map_err(|_| {
                rusqlite::Error::InvalidColumnType(3, "status".into(), rusqlite::types::Type::Text)
            })?;

            Ok(AgentThreadTurn {
                id: row.get(0)?,
                thread_id: row.get(1)?,
                prompt_text: row.get(2)?,
                status,
                started_at: row.get(4)?,
                completed_at: row.get(5)?,
                error_message: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })?;

        rows.collect()
    }

    pub fn list_turns_by_thread_tail(
        conn: &Connection,
        thread_id: &str,
        limit: usize,
    ) -> Result<Vec<AgentThreadTurn>, rusqlite::Error> {
        Self::list_turns_by_thread_tail_page(conn, thread_id, limit, 0)
    }

    pub fn list_turns_by_thread_tail_page(
        conn: &Connection,
        thread_id: &str,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<AgentThreadTurn>, rusqlite::Error> {
        if limit == 0 {
            return Ok(Vec::new());
        }

        let mut stmt = conn.prepare(
            "SELECT id, session_id, prompt_text, status, started_at, completed_at,
                    error_message, created_at, updated_at
             FROM (
                 SELECT id, session_id, prompt_text, status, started_at, completed_at,
                        error_message, created_at, updated_at
                 FROM agent_thread_turns
                 WHERE session_id = ?1
                 ORDER BY started_at DESC, id DESC
                 LIMIT ?2
                 OFFSET ?3
             )
             ORDER BY started_at ASC, id ASC",
        )?;

        let rows = stmt.query_map(params![thread_id, limit as i64, offset as i64], |row| {
            let status_raw: String = row.get(3)?;
            let status = AgentThreadTurnStatus::try_from(status_raw.as_str()).map_err(|_| {
                rusqlite::Error::InvalidColumnType(3, "status".into(), rusqlite::types::Type::Text)
            })?;

            Ok(AgentThreadTurn {
                id: row.get(0)?,
                thread_id: row.get(1)?,
                prompt_text: row.get(2)?,
                status,
                started_at: row.get(4)?,
                completed_at: row.get(5)?,
                error_message: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })?;

        rows.collect()
    }

    pub fn list_turns_by_thread_before(
        conn: &Connection,
        thread_id: &str,
        limit: usize,
        before_started_at: &str,
    ) -> Result<Vec<AgentThreadTurn>, rusqlite::Error> {
        if limit == 0 || before_started_at.trim().is_empty() {
            return Ok(Vec::new());
        }

        let mut stmt = conn.prepare(
            "SELECT id, session_id, prompt_text, status, started_at, completed_at,
                    error_message, created_at, updated_at
             FROM (
                 SELECT id, session_id, prompt_text, status, started_at, completed_at,
                        error_message, created_at, updated_at
                 FROM agent_thread_turns
                 WHERE session_id = ?1 AND started_at < ?2
                 ORDER BY started_at DESC, id DESC
                 LIMIT ?3
             )
             ORDER BY started_at ASC, id ASC",
        )?;

        let rows = stmt.query_map(params![thread_id, before_started_at, limit as i64], |row| {
            let status_raw: String = row.get(3)?;
            let status = AgentThreadTurnStatus::try_from(status_raw.as_str()).map_err(|_| {
                rusqlite::Error::InvalidColumnType(3, "status".into(), rusqlite::types::Type::Text)
            })?;

            Ok(AgentThreadTurn {
                id: row.get(0)?,
                thread_id: row.get(1)?,
                prompt_text: row.get(2)?,
                status,
                started_at: row.get(4)?,
                completed_at: row.get(5)?,
                error_message: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })?;

        rows.collect()
    }

    pub fn upsert_item(conn: &Connection, item: &AgentThreadItem) -> Result<(), rusqlite::Error> {
        let payload_json = serde_json::to_string(&item.payload)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

        conn.execute(
            "INSERT INTO agent_thread_items (
                id, session_id, turn_id, sequence, item_type, status, started_at,
                completed_at, updated_at, payload_json
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            ON CONFLICT(id) DO UPDATE SET
                session_id = excluded.session_id,
                turn_id = excluded.turn_id,
                sequence = excluded.sequence,
                item_type = excluded.item_type,
                status = excluded.status,
                started_at = excluded.started_at,
                completed_at = excluded.completed_at,
                updated_at = excluded.updated_at,
                payload_json = excluded.payload_json",
            params![
                item.id,
                item.thread_id,
                item.turn_id,
                item.sequence,
                item.payload.kind(),
                item.status.as_str(),
                item.started_at,
                item.completed_at,
                item.updated_at,
                payload_json,
            ],
        )?;
        Ok(())
    }

    pub fn get_item(
        conn: &Connection,
        item_id: &str,
    ) -> Result<Option<AgentThreadItem>, rusqlite::Error> {
        let mut stmt = conn.prepare(
            "SELECT id, session_id, turn_id, sequence, status, started_at, completed_at,
                    updated_at, payload_json
             FROM agent_thread_items
             WHERE id = ?1",
        )?;

        let mut rows = stmt.query(params![item_id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(Self::row_to_item(row)?))
        } else {
            Ok(None)
        }
    }

    pub fn list_items_by_thread(
        conn: &Connection,
        thread_id: &str,
    ) -> Result<Vec<AgentThreadItem>, rusqlite::Error> {
        let mut stmt = conn.prepare(
            "SELECT id, session_id, turn_id, sequence, status, started_at, completed_at,
                    updated_at, payload_json
             FROM agent_thread_items
             WHERE session_id = ?1
             ORDER BY (
                 SELECT started_at
                 FROM agent_thread_turns
                 WHERE agent_thread_turns.id = agent_thread_items.turn_id
             ) ASC, sequence ASC, id ASC",
        )?;

        let rows = stmt.query_map(params![thread_id], Self::row_to_item)?;
        rows.collect()
    }

    pub fn list_items_by_thread_tail(
        conn: &Connection,
        thread_id: &str,
        limit: usize,
    ) -> Result<Vec<AgentThreadItem>, rusqlite::Error> {
        Self::list_items_by_thread_tail_page(conn, thread_id, limit, 0)
    }

    pub fn list_items_by_thread_tail_page(
        conn: &Connection,
        thread_id: &str,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<AgentThreadItem>, rusqlite::Error> {
        if limit == 0 {
            return Ok(Vec::new());
        }

        let payload_json_projection = history_item_payload_json_projection_sql();
        let sql = format!(
            "SELECT id, session_id, turn_id, sequence, status, started_at, completed_at,
                    updated_at, payload_json, sort_started_at
             FROM (
                 SELECT id, session_id, turn_id, sequence, status, started_at, completed_at,
                        updated_at, {payload_json_projection} AS payload_json,
                        COALESCE(
                            (
                                SELECT started_at
                                FROM agent_thread_turns
                                WHERE agent_thread_turns.id = agent_thread_items.turn_id
                            ),
                            started_at
                        ) AS sort_started_at
                 FROM agent_thread_items
                 WHERE session_id = ?1
                 ORDER BY sort_started_at DESC, sequence DESC, id DESC
                 LIMIT ?2
                 OFFSET ?3
             )
             ORDER BY sort_started_at ASC, sequence ASC, id ASC",
        );
        let mut stmt = conn.prepare(&sql)?;

        let rows = stmt.query_map(
            params![thread_id, limit as i64, offset as i64],
            Self::row_to_item,
        )?;
        rows.collect()
    }

    pub fn list_items_by_thread_before(
        conn: &Connection,
        thread_id: &str,
        limit: usize,
        before_started_at: &str,
    ) -> Result<Vec<AgentThreadItem>, rusqlite::Error> {
        if limit == 0 || before_started_at.trim().is_empty() {
            return Ok(Vec::new());
        }

        let payload_json_projection = history_item_payload_json_projection_sql();
        let sql = format!(
            "SELECT id, session_id, turn_id, sequence, status, started_at, completed_at,
                    updated_at, payload_json, sort_started_at
             FROM (
                 SELECT id, session_id, turn_id, sequence, status, started_at, completed_at,
                        updated_at, {payload_json_projection} AS payload_json,
                        COALESCE(
                            (
                                SELECT started_at
                                FROM agent_thread_turns
                                WHERE agent_thread_turns.id = agent_thread_items.turn_id
                            ),
                            started_at
                        ) AS sort_started_at
                 FROM agent_thread_items
                 WHERE session_id = ?1
                   AND COALESCE(
                         (
                             SELECT started_at
                             FROM agent_thread_turns
                             WHERE agent_thread_turns.id = agent_thread_items.turn_id
                         ),
                         started_at
                       ) < ?2
                 ORDER BY sort_started_at DESC, sequence DESC, id DESC
                 LIMIT ?3
             )
             ORDER BY sort_started_at ASC, sequence ASC, id ASC",
        );
        let mut stmt = conn.prepare(&sql)?;

        let rows = stmt.query_map(
            params![thread_id, before_started_at, limit as i64],
            Self::row_to_item,
        )?;
        rows.collect()
    }

    fn row_to_item(row: &rusqlite::Row<'_>) -> Result<AgentThreadItem, rusqlite::Error> {
        let status_raw: String = row.get(4)?;
        let status = AgentThreadItemStatus::try_from(status_raw.as_str()).map_err(|_| {
            rusqlite::Error::InvalidColumnType(4, "status".into(), rusqlite::types::Type::Text)
        })?;
        let payload_json: String = row.get(8)?;
        let payload: AgentThreadItemPayload =
            serde_json::from_str(&payload_json).map_err(|_| {
                rusqlite::Error::InvalidColumnType(
                    8,
                    "payload_json".into(),
                    rusqlite::types::Type::Text,
                )
            })?;

        Ok(AgentThreadItem {
            id: row.get(0)?,
            thread_id: row.get(1)?,
            turn_id: row.get(2)?,
            sequence: row.get(3)?,
            status,
            started_at: row.get(5)?,
            completed_at: row.get(6)?,
            updated_at: row.get(7)?,
            payload,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::schema::create_tables;
    use rusqlite::Connection;

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        create_tables(&conn).expect("创建表结构失败");
        conn.execute(
            "INSERT INTO agent_sessions (id, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params!["thread-1", "general:test", "2026-03-13T00:00:00Z", "2026-03-13T00:00:00Z"],
        )
        .unwrap();
        conn
    }

    #[test]
    fn create_turn_and_upsert_item_should_roundtrip() {
        let conn = setup_conn();
        let turn = AgentThreadTurn {
            id: "turn-1".to_string(),
            thread_id: "thread-1".to_string(),
            prompt_text: "帮我做个计划".to_string(),
            status: AgentThreadTurnStatus::Running,
            started_at: "2026-03-13T01:00:00Z".to_string(),
            completed_at: None,
            error_message: None,
            created_at: "2026-03-13T01:00:00Z".to_string(),
            updated_at: "2026-03-13T01:00:00Z".to_string(),
        };

        AgentTimelineDao::create_turn(&conn, &turn).unwrap();

        let item = AgentThreadItem {
            id: "item-1".to_string(),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            sequence: 1,
            status: AgentThreadItemStatus::Completed,
            started_at: "2026-03-13T01:00:01Z".to_string(),
            completed_at: Some("2026-03-13T01:00:01Z".to_string()),
            updated_at: "2026-03-13T01:00:01Z".to_string(),
            payload: AgentThreadItemPayload::UserMessage {
                content: "帮我做个计划".to_string(),
            },
        };

        AgentTimelineDao::upsert_item(&conn, &item).unwrap();

        let turns = AgentTimelineDao::list_turns_by_thread(&conn, "thread-1").unwrap();
        let items = AgentTimelineDao::list_items_by_thread(&conn, "thread-1").unwrap();

        assert_eq!(turns.len(), 1);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0], item);
    }

    #[test]
    fn tail_queries_should_keep_recent_timeline_in_display_order() {
        let conn = setup_conn();

        for index in 1..=4 {
            let turn = AgentThreadTurn {
                id: format!("turn-{index}"),
                thread_id: "thread-1".to_string(),
                prompt_text: format!("任务 {index}"),
                status: AgentThreadTurnStatus::Completed,
                started_at: format!("2026-03-13T0{index}:00:00Z"),
                completed_at: Some(format!("2026-03-13T0{index}:00:10Z")),
                error_message: None,
                created_at: format!("2026-03-13T0{index}:00:00Z"),
                updated_at: format!("2026-03-13T0{index}:00:10Z"),
            };
            AgentTimelineDao::create_turn(&conn, &turn).unwrap();
            AgentTimelineDao::upsert_item(
                &conn,
                &AgentThreadItem {
                    id: format!("item-{index}"),
                    thread_id: "thread-1".to_string(),
                    turn_id: turn.id,
                    sequence: 1,
                    status: AgentThreadItemStatus::Completed,
                    started_at: format!("2026-03-13T0{index}:00:01Z"),
                    completed_at: Some(format!("2026-03-13T0{index}:00:02Z")),
                    updated_at: format!("2026-03-13T0{index}:00:02Z"),
                    payload: AgentThreadItemPayload::AgentMessage {
                        text: format!("结果 {index}"),
                        phase: None,
                    },
                },
            )
            .unwrap();
        }

        let turns = AgentTimelineDao::list_turns_by_thread_tail(&conn, "thread-1", 2).unwrap();
        let items = AgentTimelineDao::list_items_by_thread_tail(&conn, "thread-1", 2).unwrap();

        assert_eq!(
            turns
                .iter()
                .map(|turn| turn.id.as_str())
                .collect::<Vec<_>>(),
            vec!["turn-3", "turn-4"],
        );
        assert_eq!(
            items
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec!["item-3", "item-4"],
        );

        let older_turns =
            AgentTimelineDao::list_turns_by_thread_tail_page(&conn, "thread-1", 2, 2).unwrap();
        let older_items =
            AgentTimelineDao::list_items_by_thread_tail_page(&conn, "thread-1", 2, 2).unwrap();

        assert_eq!(
            older_turns
                .iter()
                .map(|turn| turn.id.as_str())
                .collect::<Vec<_>>(),
            vec!["turn-1", "turn-2"],
        );
        assert_eq!(
            older_items
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec!["item-1", "item-2"],
        );
    }

    #[test]
    fn item_tail_query_should_omit_large_file_artifact_content() {
        let conn = setup_conn();
        let turn = AgentThreadTurn {
            id: "turn-artifact".to_string(),
            thread_id: "thread-1".to_string(),
            prompt_text: "生成报告".to_string(),
            status: AgentThreadTurnStatus::Completed,
            started_at: "2026-03-13T05:00:00Z".to_string(),
            completed_at: Some("2026-03-13T05:00:10Z".to_string()),
            error_message: None,
            created_at: "2026-03-13T05:00:00Z".to_string(),
            updated_at: "2026-03-13T05:00:10Z".to_string(),
        };
        AgentTimelineDao::create_turn(&conn, &turn).unwrap();

        AgentTimelineDao::upsert_item(
            &conn,
            &AgentThreadItem {
                id: "item-large-artifact".to_string(),
                thread_id: "thread-1".to_string(),
                turn_id: turn.id,
                sequence: 1,
                status: AgentThreadItemStatus::Completed,
                started_at: "2026-03-13T05:00:01Z".to_string(),
                completed_at: Some("2026-03-13T05:00:02Z".to_string()),
                updated_at: "2026-03-13T05:00:02Z".to_string(),
                payload: AgentThreadItemPayload::FileArtifact {
                    path: ".lime/artifacts/thread-1/report.artifact.json".to_string(),
                    source: "artifact_document_service".to_string(),
                    content: Some("正文".repeat(20_000)),
                    metadata: Some(serde_json::json!({
                        "artifactTitle": "日报",
                        "previewText": "首屏摘要",
                    })),
                },
            },
        )
        .unwrap();

        let full_items = AgentTimelineDao::list_items_by_thread(&conn, "thread-1").unwrap();
        let tail_items = AgentTimelineDao::list_items_by_thread_tail(&conn, "thread-1", 1).unwrap();

        assert!(matches!(
            &full_items[0].payload,
            AgentThreadItemPayload::FileArtifact { content: Some(content), .. }
                if content.contains("正文")
        ));
        assert!(matches!(
            &tail_items[0].payload,
            AgentThreadItemPayload::FileArtifact { content: None, metadata, .. }
                if metadata
                    .as_ref()
                    .and_then(|value| value.get("artifactTitle"))
                    .and_then(serde_json::Value::as_str)
                    == Some("日报")
        ));
    }

    #[test]
    fn update_turn_status_should_persist_terminal_state() {
        let conn = setup_conn();
        let turn = AgentThreadTurn {
            id: "turn-2".to_string(),
            thread_id: "thread-1".to_string(),
            prompt_text: "继续".to_string(),
            status: AgentThreadTurnStatus::Running,
            started_at: "2026-03-13T02:00:00Z".to_string(),
            completed_at: None,
            error_message: None,
            created_at: "2026-03-13T02:00:00Z".to_string(),
            updated_at: "2026-03-13T02:00:00Z".to_string(),
        };
        AgentTimelineDao::create_turn(&conn, &turn).unwrap();

        AgentTimelineDao::update_turn_status(
            &conn,
            "turn-2",
            AgentThreadTurnStatus::Failed,
            Some("2026-03-13T02:00:03Z"),
            Some("boom"),
            "2026-03-13T02:00:03Z",
        )
        .unwrap();

        let turns = AgentTimelineDao::list_turns_by_thread(&conn, "thread-1").unwrap();
        assert_eq!(turns[0].status, AgentThreadTurnStatus::Failed);
        assert_eq!(turns[0].error_message.as_deref(), Some("boom"));
    }
}
