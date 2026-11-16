//! Request telemetry SQLite store.

use super::types::{RequestLog, RequestStatus};
use chrono::{Duration, SecondsFormat};
use rusqlite::{Connection, OptionalExtension, params, params_from_iter};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TelemetryStore {
    path: PathBuf,
}

impl TelemetryStore {
    pub fn initialize(path: impl AsRef<Path>) -> Result<Self, String> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!("无法创建 Telemetry DB 目录 {}: {error}", parent.display())
            })?;
        }
        let conn = Connection::open(&path)
            .map_err(|error| format!("无法打开 Telemetry DB {}: {error}", path.display()))?;
        create_schema(&conn)?;
        Ok(Self { path })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn upsert_request_log(&self, log: &RequestLog) -> Result<(), String> {
        let conn = Connection::open(&self.path)
            .map_err(|error| format!("无法打开 Telemetry DB {}: {error}", self.path.display()))?;
        upsert_request_log(&conn, log)
    }

    pub fn read_request_log(&self, request_id: &str) -> Result<Option<RequestLog>, String> {
        let conn = Connection::open(&self.path)
            .map_err(|error| format!("无法打开 Telemetry DB {}: {error}", self.path.display()))?;
        let summary_json: Option<String> = conn
            .query_row(
                "SELECT summary_json FROM request_logs WHERE request_id = ?1",
                params![request_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("无法读取 Telemetry DB request log: {error}"))?;
        summary_json
            .as_deref()
            .map(request_log_from_summary_json)
            .transpose()
    }

    pub fn read_request_logs_for_session(
        &self,
        session_id: &str,
    ) -> Result<Vec<RequestLog>, String> {
        self.read_request_logs_for_session_turn(session_id, None)
    }

    pub fn read_request_logs_for_session_turn(
        &self,
        session_id: &str,
        turn_id: Option<&str>,
    ) -> Result<Vec<RequestLog>, String> {
        let conn = Connection::open(&self.path)
            .map_err(|error| format!("无法打开 Telemetry DB {}: {error}", self.path.display()))?;
        let (sql, query_params): (&str, Vec<&str>) = match turn_id {
            Some(turn_id) => (
                "SELECT summary_json
                 FROM request_logs
                 WHERE session_id = ?1 AND turn_id = ?2
                 ORDER BY started_at ASC, request_id ASC",
                vec![session_id, turn_id],
            ),
            None => (
                "SELECT summary_json
                 FROM request_logs
                 WHERE session_id = ?1
                 ORDER BY started_at ASC, request_id ASC",
                vec![session_id],
            ),
        };
        let mut stmt = conn
            .prepare(sql)
            .map_err(|error| format!("无法准备 Telemetry DB 查询: {error}"))?;
        let mut rows = stmt
            .query(params_from_iter(query_params))
            .map_err(|error| format!("无法查询 Telemetry DB request logs: {error}"))?;
        let mut logs = Vec::new();
        while let Some(row) = rows
            .next()
            .map_err(|error| format!("无法读取 Telemetry DB 行: {error}"))?
        {
            let json: String = row
                .get::<_, String>(0)
                .map_err(|error| format!("无法读取 Telemetry DB 行: {error}"))?;
            logs.push(request_log_from_summary_json(&json)?);
        }
        Ok(logs)
    }

    pub fn clear_session(&self, session_id: &str) -> Result<usize, String> {
        let conn = Connection::open(&self.path)
            .map_err(|error| format!("无法打开 Telemetry DB {}: {error}", self.path.display()))?;
        conn.execute(
            "DELETE FROM request_logs WHERE session_id = ?1",
            params![session_id],
        )
        .map_err(|error| format!("无法清理 Telemetry DB session request logs: {error}"))
    }
}

fn create_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        PRAGMA user_version = 1;

        CREATE TABLE IF NOT EXISTS request_logs (
            request_id TEXT PRIMARY KEY,
            session_id TEXT,
            thread_id TEXT,
            turn_id TEXT,
            pending_request_id TEXT,
            queued_turn_id TEXT,
            subagent_session_id TEXT,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            status TEXT NOT NULL,
            started_at TEXT NOT NULL,
            completed_at TEXT,
            duration_ms INTEGER NOT NULL DEFAULT 0,
            prompt_tokens INTEGER,
            completion_tokens INTEGER,
            total_tokens INTEGER,
            cached_input_tokens INTEGER,
            credential_id TEXT,
            http_status INTEGER,
            error_category TEXT,
            error_message TEXT,
            is_streaming INTEGER NOT NULL DEFAULT 0,
            retry_count INTEGER NOT NULL DEFAULT 0,
            summary_json TEXT NOT NULL DEFAULT '{}'
        );

        CREATE INDEX IF NOT EXISTS idx_request_logs_session_turn
            ON request_logs(session_id, turn_id, started_at);

        CREATE INDEX IF NOT EXISTS idx_request_logs_started
            ON request_logs(started_at);
        "#,
    )
    .map_err(|error| format!("无法初始化 Telemetry DB schema: {error}"))?;
    Ok(())
}

fn upsert_request_log(conn: &Connection, log: &RequestLog) -> Result<(), String> {
    let summary_json =
        serde_json::to_string(log).map_err(|error| format!("无法序列化 RequestLog: {error}"))?;
    let started_at = log.timestamp.to_rfc3339_opts(SecondsFormat::Millis, true);
    let completed_at = completed_at(log);
    let http_status = log.http_status.map(i64::from);
    let prompt_tokens = log.input_tokens.map(i64::from);
    let completion_tokens = log.output_tokens.map(i64::from);
    let total_tokens = log.total_tokens.map(i64::from);
    let duration_ms = i64::try_from(log.duration_ms).unwrap_or(i64::MAX);
    let retry_count = i64::from(log.retry_count);
    let provider = log.provider.to_string();
    let status = log.status.to_string();
    let error_category = error_category(log);
    let is_streaming = if log.is_streaming { 1_i64 } else { 0_i64 };

    conn.execute(
        r#"
        INSERT INTO request_logs (
            request_id,
            session_id,
            thread_id,
            turn_id,
            pending_request_id,
            queued_turn_id,
            subagent_session_id,
            provider,
            model,
            status,
            started_at,
            completed_at,
            duration_ms,
            prompt_tokens,
            completion_tokens,
            total_tokens,
            cached_input_tokens,
            credential_id,
            http_status,
            error_category,
            error_message,
            is_streaming,
            retry_count,
            summary_json
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
            ?13, ?14, ?15, ?16, NULL, ?17, ?18, ?19, ?20, ?21, ?22, ?23
        )
        ON CONFLICT(request_id) DO UPDATE SET
            session_id = excluded.session_id,
            thread_id = excluded.thread_id,
            turn_id = excluded.turn_id,
            pending_request_id = excluded.pending_request_id,
            queued_turn_id = excluded.queued_turn_id,
            subagent_session_id = excluded.subagent_session_id,
            provider = excluded.provider,
            model = excluded.model,
            status = excluded.status,
            started_at = excluded.started_at,
            completed_at = excluded.completed_at,
            duration_ms = excluded.duration_ms,
            prompt_tokens = excluded.prompt_tokens,
            completion_tokens = excluded.completion_tokens,
            total_tokens = excluded.total_tokens,
            cached_input_tokens = excluded.cached_input_tokens,
            credential_id = excluded.credential_id,
            http_status = excluded.http_status,
            error_category = excluded.error_category,
            error_message = excluded.error_message,
            is_streaming = excluded.is_streaming,
            retry_count = excluded.retry_count,
            summary_json = excluded.summary_json
        "#,
        params![
            log.id.as_str(),
            log.session_id.as_deref(),
            log.thread_id.as_deref(),
            log.turn_id.as_deref(),
            log.pending_request_id.as_deref(),
            log.queued_turn_id.as_deref(),
            log.subagent_session_id.as_deref(),
            provider.as_str(),
            log.model.as_str(),
            status.as_str(),
            started_at,
            completed_at,
            duration_ms,
            prompt_tokens,
            completion_tokens,
            total_tokens,
            log.credential_id.as_deref(),
            http_status,
            error_category,
            log.error_message.as_deref(),
            is_streaming,
            retry_count,
            summary_json,
        ],
    )
    .map_err(|error| format!("无法写入 Telemetry DB request log: {error}"))?;
    Ok(())
}

fn request_log_from_summary_json(json: &str) -> Result<RequestLog, String> {
    serde_json::from_str(json)
        .map_err(|error| format!("无法解析 Telemetry DB request log: {error}"))
}

fn completed_at(log: &RequestLog) -> Option<String> {
    if log.status == RequestStatus::Retrying {
        return None;
    }
    let duration = Duration::milliseconds(i64::try_from(log.duration_ms).unwrap_or(i64::MAX));
    Some((log.timestamp + duration).to_rfc3339_opts(SecondsFormat::Millis, true))
}

fn error_category(log: &RequestLog) -> Option<&'static str> {
    match log.status {
        RequestStatus::Failed => Some("failed"),
        RequestStatus::Timeout => Some("timeout"),
        RequestStatus::Cancelled => Some("cancelled"),
        RequestStatus::Success | RequestStatus::Retrying => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use chrono::Utc;
    use lime_core::ProviderType;

    fn request_log(request_id: &str, turn_id: &str) -> RequestLog {
        let mut log = RequestLog::new(
            request_id.to_string(),
            ProviderType::OpenAI,
            "gpt-5".to_string(),
            true,
        );
        log.session_id = Some("sess-telemetry".to_string());
        log.thread_id = Some("thread-telemetry".to_string());
        log.turn_id = Some(turn_id.to_string());
        log.pending_request_id = Some("pending-1".to_string());
        log.timestamp = Utc
            .with_ymd_and_hms(2026, 6, 14, 12, 0, 0)
            .single()
            .expect("timestamp");
        log.mark_success(123, 200);
        log.set_tokens(Some(10), Some(20));
        log.set_credential_id("cred-1".to_string());
        log
    }

    #[test]
    fn upsert_and_read_request_logs_by_session_and_turn() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = TelemetryStore::initialize(temp.path().join("runtime/telemetry_1.sqlite"))
            .expect("store");

        let first = request_log("req-1", "turn-1");
        let second = request_log("req-2", "turn-2");
        store.upsert_request_log(&first).expect("first upsert");
        store.upsert_request_log(&second).expect("second upsert");

        let session_logs = store
            .read_request_logs_for_session("sess-telemetry")
            .expect("session logs");
        assert_eq!(session_logs.len(), 2);
        assert_eq!(session_logs[0].id, "req-1");
        assert_eq!(session_logs[1].id, "req-2");

        let turn_logs = store
            .read_request_logs_for_session_turn("sess-telemetry", Some("turn-2"))
            .expect("turn logs");
        assert_eq!(turn_logs.len(), 1);
        assert_eq!(turn_logs[0].id, "req-2");
        assert_eq!(turn_logs[0].total_tokens, Some(30));

        let by_id = store
            .read_request_log("req-1")
            .expect("read by id")
            .expect("request log");
        assert_eq!(by_id.provider, ProviderType::OpenAI);
    }

    #[test]
    fn upsert_replaces_existing_request_log() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store =
            TelemetryStore::initialize(temp.path().join("telemetry_1.sqlite")).expect("store");
        let mut log = request_log("req-retry", "turn-1");
        log.status = RequestStatus::Retrying;
        store.upsert_request_log(&log).expect("first upsert");

        log.mark_failed(456, Some(500), "provider failed".to_string());
        store.upsert_request_log(&log).expect("replacement upsert");

        let logs = store
            .read_request_logs_for_session_turn("sess-telemetry", Some("turn-1"))
            .expect("logs");
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].status, RequestStatus::Failed);
        assert_eq!(logs[0].duration_ms, 456);
        assert_eq!(logs[0].error_message.as_deref(), Some("provider failed"));
    }

    #[test]
    fn clear_session_removes_only_matching_request_logs_and_is_idempotent() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store =
            TelemetryStore::initialize(temp.path().join("telemetry_1.sqlite")).expect("store");
        let matching = request_log("req-matching", "turn-1");
        let mut retained = request_log("req-retained", "turn-2");
        retained.session_id = Some("sess-retained".to_string());
        store
            .upsert_request_log(&matching)
            .expect("matching upsert");
        store
            .upsert_request_log(&retained)
            .expect("retained upsert");

        assert_eq!(store.clear_session("sess-telemetry").expect("clear"), 1);
        assert_eq!(
            store
                .clear_session("sess-telemetry")
                .expect("clear missing"),
            0
        );
        assert!(
            store
                .read_request_log("req-matching")
                .expect("read cleared")
                .is_none()
        );
        assert!(
            store
                .read_request_log("req-retained")
                .expect("read retained")
                .is_some()
        );
    }
}
