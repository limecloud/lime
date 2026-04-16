//! 统一执行追踪服务
//!
//! 负责跨入口（chat / skill / automation）的运行摘要记录，
//! 通过单点服务避免各模块重复实现生命周期写库逻辑。

use crate::database::dao::agent_run::{AgentRun, AgentRunDao, AgentRunStatus};
use crate::database::DbConnection;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::future::Future;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunSource {
    Chat,
    Skill,
    Automation,
}

impl RunSource {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Chat => "chat",
            Self::Skill => "skill",
            Self::Automation => "automation",
        }
    }
}

#[derive(Debug, Clone)]
pub struct RunHandle {
    pub id: String,
    started_at_ms: i64,
}

#[derive(Debug, Clone)]
pub struct ExecutionTracker {
    db: DbConnection,
    enabled: bool,
}

#[derive(Debug, Clone, Default)]
pub struct RunFinalizeOptions {
    pub success_metadata: Option<Value>,
    pub error_code: Option<String>,
    pub error_metadata: Option<Value>,
}

#[derive(Debug, Clone)]
pub struct RunFinishDecision {
    pub status: AgentRunStatus,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub metadata: Option<Value>,
}

impl ExecutionTracker {
    pub fn new(db: DbConnection) -> Self {
        Self {
            db,
            enabled: is_tracker_enabled(),
        }
    }

    pub fn db(&self) -> &DbConnection {
        &self.db
    }

    pub fn start(
        &self,
        source: RunSource,
        source_ref: Option<String>,
        session_id: Option<String>,
        metadata: Option<Value>,
    ) -> Option<RunHandle> {
        if !self.enabled {
            return None;
        }

        let now = Utc::now();
        let now_rfc3339 = now.to_rfc3339();
        let run_id = Uuid::new_v4().to_string();
        let run = AgentRun {
            id: run_id.clone(),
            source: source.as_str().to_string(),
            source_ref,
            session_id,
            status: AgentRunStatus::Running,
            started_at: now_rfc3339.clone(),
            finished_at: None,
            duration_ms: None,
            error_code: None,
            error_message: None,
            metadata: metadata.map(|v| v.to_string()),
            created_at: now_rfc3339.clone(),
            updated_at: now_rfc3339,
        };

        let conn = match self.db.lock() {
            Ok(conn) => conn,
            Err(e) => {
                tracing::warn!("[ExecutionTracker] 数据库锁定失败，跳过 start: {}", e);
                return None;
            }
        };

        if let Err(e) = AgentRunDao::create_run(&conn, &run) {
            tracing::warn!("[ExecutionTracker] 创建 run 失败，跳过追踪: {}", e);
            return None;
        }

        Some(RunHandle {
            id: run_id,
            started_at_ms: now.timestamp_millis(),
        })
    }

    pub fn finish_success(&self, handle: &RunHandle, metadata: Option<Value>) {
        self.finish(handle, AgentRunStatus::Success, None, None, metadata);
    }

    pub fn finish_error(
        &self,
        handle: &RunHandle,
        error_code: Option<&str>,
        error_message: Option<&str>,
        metadata: Option<Value>,
    ) {
        self.finish(
            handle,
            AgentRunStatus::Error,
            error_code,
            error_message,
            metadata,
        );
    }

    pub fn finish_with_status(
        &self,
        handle: &RunHandle,
        status: AgentRunStatus,
        error_code: Option<&str>,
        error_message: Option<&str>,
        metadata: Option<Value>,
    ) {
        self.finish(handle, status, error_code, error_message, metadata);
    }

    pub fn refresh_running_metadata(
        &self,
        handle: &RunHandle,
        session_id: Option<&str>,
        metadata: Option<Value>,
    ) {
        if !self.enabled {
            return;
        }

        let updated_at = Utc::now().to_rfc3339();
        let metadata_json = metadata.map(|value| value.to_string());
        let conn = match self.db.lock() {
            Ok(conn) => conn,
            Err(e) => {
                tracing::warn!("[ExecutionTracker] 数据库锁定失败，跳过 refresh: {}", e);
                return;
            }
        };

        if let Err(e) = AgentRunDao::refresh_running_run(
            &conn,
            &handle.id,
            &updated_at,
            session_id,
            metadata_json.as_deref(),
        ) {
            tracing::warn!("[ExecutionTracker] 刷新运行中 run 失败: {}", e);
        }
    }

    fn finish(
        &self,
        handle: &RunHandle,
        status: AgentRunStatus,
        error_code: Option<&str>,
        error_message: Option<&str>,
        metadata: Option<Value>,
    ) {
        if !self.enabled {
            return;
        }
        if !status.is_terminal() {
            return;
        }

        let finished_at = Utc::now();
        let duration_ms = finished_at.timestamp_millis() - handle.started_at_ms;
        let finished_at_str = finished_at.to_rfc3339();
        let metadata_json = metadata.map(|v| v.to_string());

        let conn = match self.db.lock() {
            Ok(conn) => conn,
            Err(e) => {
                tracing::warn!("[ExecutionTracker] 数据库锁定失败，跳过 finish: {}", e);
                return;
            }
        };

        if let Err(e) = AgentRunDao::finish_run(
            &conn,
            &handle.id,
            status,
            &finished_at_str,
            Some(duration_ms),
            error_code,
            error_message,
            metadata_json.as_deref(),
        ) {
            tracing::warn!("[ExecutionTracker] 结束 run 失败: {}", e);
        }
    }

    pub fn list_runs(&self, limit: usize, offset: usize) -> Result<Vec<AgentRun>, String> {
        let conn = self.db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
        AgentRunDao::list_runs(&conn, limit, offset).map_err(|e| format!("查询执行记录失败: {e}"))
    }

    pub fn get_run(&self, id: &str) -> Result<Option<AgentRun>, String> {
        let conn = self.db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
        AgentRunDao::get_run(&conn, id).map_err(|e| format!("查询执行记录失败: {e}"))
    }

    pub fn list_runs_by_session(
        &self,
        session_id: &str,
        limit: usize,
    ) -> Result<Vec<AgentRun>, String> {
        let conn = self.db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
        AgentRunDao::list_runs_by_session(&conn, session_id, limit)
            .map_err(|e| format!("查询会话执行记录失败: {e}"))
    }

    pub fn list_terminal_runs_by_session(
        &self,
        session_id: &str,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<AgentRun>, String> {
        let conn = self.db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
        AgentRunDao::list_terminal_runs_by_session(&conn, session_id, limit, offset)
            .map_err(|e| format!("查询会话终态执行记录失败: {e}"))
    }

    pub async fn with_run<T, Fut>(
        &self,
        source: RunSource,
        source_ref: Option<String>,
        session_id: Option<String>,
        start_metadata: Option<Value>,
        finalize: RunFinalizeOptions,
        fut: Fut,
    ) -> Result<T, String>
    where
        Fut: Future<Output = Result<T, String>>,
    {
        self.with_run_custom(
            source,
            source_ref,
            session_id,
            start_metadata,
            fut,
            move |result| match result {
                Ok(_) => RunFinishDecision {
                    status: AgentRunStatus::Success,
                    error_code: None,
                    error_message: None,
                    metadata: finalize.success_metadata,
                },
                Err(err) => RunFinishDecision {
                    status: AgentRunStatus::Error,
                    error_code: finalize.error_code,
                    error_message: Some(err.clone()),
                    metadata: finalize.error_metadata,
                },
            },
        )
        .await
    }

    pub async fn with_run_custom<T, Fut, Finalize>(
        &self,
        source: RunSource,
        source_ref: Option<String>,
        session_id: Option<String>,
        start_metadata: Option<Value>,
        fut: Fut,
        finalize: Finalize,
    ) -> Result<T, String>
    where
        Fut: Future<Output = Result<T, String>>,
        Finalize: FnOnce(&Result<T, String>) -> RunFinishDecision,
    {
        let run_handle = self.start(source, source_ref, session_id, start_metadata);
        let result = fut.await;

        if let Some(handle) = &run_handle {
            let decision = finalize(&result);
            self.finish(
                handle,
                decision.status,
                decision.error_code.as_deref(),
                decision.error_message.as_deref(),
                decision.metadata,
            );
        }

        result
    }
}

fn is_tracker_enabled() -> bool {
    match lime_core::env_compat::var(&[
        "LIME_EXECUTION_TRACKER_ENABLED",
        "PROXYCAST_EXECUTION_TRACKER_ENABLED",
    ]) {
        Some(raw) => {
            let normalized = raw.trim().to_ascii_lowercase();
            !matches!(normalized.as_str(), "0" | "false" | "off" | "no")
        }
        None => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::schema::create_tables;
    use rusqlite::Connection;
    use std::sync::{Arc, Mutex};

    fn setup_db() -> DbConnection {
        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        create_tables(&conn).expect("创建数据表失败");
        Arc::new(Mutex::new(conn))
    }

    #[tokio::test]
    async fn with_run_should_write_success_status() {
        let tracker = ExecutionTracker::new(setup_db());
        let result = tracker
            .with_run(
                RunSource::Chat,
                Some("test_chat".to_string()),
                Some("session-1".to_string()),
                Some(serde_json::json!({"k":"v"})),
                RunFinalizeOptions {
                    success_metadata: Some(serde_json::json!({"done": true})),
                    error_code: Some("chat_failed".to_string()),
                    error_metadata: None,
                },
                async { Ok::<_, String>("ok".to_string()) },
            )
            .await
            .expect("with_run 返回失败");

        assert_eq!(result, "ok");
        let runs = tracker.list_runs(10, 0).expect("查询 run 失败");
        assert!(!runs.is_empty());
        assert_eq!(runs[0].source, "chat");
        assert_eq!(runs[0].status, AgentRunStatus::Success);
    }

    #[tokio::test]
    async fn with_run_should_write_error_status() {
        let tracker = ExecutionTracker::new(setup_db());
        let result = tracker
            .with_run(
                RunSource::Skill,
                Some("test_skill".to_string()),
                Some("session-2".to_string()),
                None,
                RunFinalizeOptions {
                    success_metadata: None,
                    error_code: Some("skill_failed".to_string()),
                    error_metadata: Some(serde_json::json!({"kind":"expected"})),
                },
                async { Err::<String, _>("boom".to_string()) },
            )
            .await;

        assert!(result.is_err());
        let runs = tracker.list_runs(10, 0).expect("查询 run 失败");
        assert!(!runs.is_empty());
        assert_eq!(runs[0].source, "skill");
        assert_eq!(runs[0].status, AgentRunStatus::Error);
        assert_eq!(runs[0].error_code.as_deref(), Some("skill_failed"));
    }

    #[tokio::test]
    async fn with_run_custom_should_allow_ok_but_error_status() {
        let tracker = ExecutionTracker::new(setup_db());
        let result = tracker
            .with_run_custom(
                RunSource::Skill,
                Some("custom_skill".to_string()),
                Some("session-3".to_string()),
                None,
                async { Ok::<_, String>(false) },
                |run_result| match run_result {
                    Ok(false) => RunFinishDecision {
                        status: AgentRunStatus::Error,
                        error_code: Some("skill_failed".to_string()),
                        error_message: Some("skill returned success=false".to_string()),
                        metadata: Some(serde_json::json!({"success": false})),
                    },
                    Ok(true) => RunFinishDecision {
                        status: AgentRunStatus::Success,
                        error_code: None,
                        error_message: None,
                        metadata: Some(serde_json::json!({"success": true})),
                    },
                    Err(err) => RunFinishDecision {
                        status: AgentRunStatus::Error,
                        error_code: Some("skill_failed".to_string()),
                        error_message: Some(err.clone()),
                        metadata: None,
                    },
                },
            )
            .await
            .expect("with_run_custom 返回失败");

        assert!(!result);
        let runs = tracker.list_runs(10, 0).expect("查询 run 失败");
        assert!(!runs.is_empty());
        assert_eq!(runs[0].status, AgentRunStatus::Error);
        assert_eq!(runs[0].error_code.as_deref(), Some("skill_failed"));
    }

    #[test]
    fn refresh_running_metadata_should_update_session_and_metadata() {
        let tracker = ExecutionTracker::new(setup_db());
        let handle = tracker
            .start(RunSource::Automation, Some("job-1".to_string()), None, None)
            .expect("应创建运行句柄");

        tracker.refresh_running_metadata(
            &handle,
            Some("session-1"),
            Some(serde_json::json!({
                "browser_lifecycle_state": "human_controlling"
            })),
        );

        let run = tracker
            .get_run(&handle.id)
            .expect("查询 run 失败")
            .expect("run 不存在");
        assert_eq!(run.session_id.as_deref(), Some("session-1"));
        assert_eq!(
            run.metadata.as_deref(),
            Some("{\"browser_lifecycle_state\":\"human_controlling\"}")
        );
    }
}
