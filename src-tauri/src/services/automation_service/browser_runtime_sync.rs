use super::{apply_terminal_job_state, build_browser_session_run_metadata, set_active_job_state};
use crate::database::dao::agent_run::{AgentRun, AgentRunDao, AgentRunStatus};
use crate::database::DbConnection;
use chrono::Utc;
use proxycast_browser_runtime::{BrowserSessionLifecycleState, CdpSessionState};
use proxycast_core::database::dao::automation_job::{AutomationJob, AutomationJobDao};
use rusqlite::Connection;

enum BrowserSessionSyncDisposition {
    Active(&'static str),
    FinishSuccess,
    FinishError(String),
}

pub fn sync_browser_session_runtime_state(
    db: &DbConnection,
    session: &CdpSessionState,
) -> Result<(), String> {
    sync_browser_session_runtime_state_internal(db, session, false)
}

pub fn complete_browser_session_after_resume(
    db: &DbConnection,
    session: &CdpSessionState,
) -> Result<(), String> {
    sync_browser_session_runtime_state_internal(db, session, true)
}

fn sync_browser_session_runtime_state_internal(
    db: &DbConnection,
    session: &CdpSessionState,
    finalize_on_resume: bool,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    let Some((run, mut job)) = resolve_related_automation_run(&conn, &session.session_id)? else {
        return Ok(());
    };

    if run.status.is_terminal() {
        return Ok(());
    }

    match resolve_sync_disposition(session, finalize_on_resume) {
        BrowserSessionSyncDisposition::Active(status) => {
            let updated_at = Utc::now().to_rfc3339();
            let retry_count = job.last_retry_count;
            let metadata =
                build_browser_session_run_metadata(&job, session, status, retry_count, None)
                    .to_string();

            AgentRunDao::refresh_running_run(
                &conn,
                &run.id,
                &updated_at,
                Some(session.session_id.as_str()),
                Some(metadata.as_str()),
            )
            .map_err(|e| format!("刷新自动化运行态失败: {e}"))?;

            let started_at = job
                .running_started_at
                .clone()
                .unwrap_or_else(|| run.started_at.clone());
            set_active_job_state(
                &mut job,
                status,
                started_at.as_str(),
                &updated_at,
                retry_count,
            );
            AutomationJobDao::update(&conn, &job)
                .map_err(|e| format!("更新自动化任务运行态失败: {e}"))?;
            Ok(())
        }
        BrowserSessionSyncDisposition::FinishSuccess => finish_browser_session_run(
            &conn,
            &run,
            &mut job,
            session,
            AgentRunStatus::Success,
            None,
        ),
        BrowserSessionSyncDisposition::FinishError(message) => finish_browser_session_run(
            &conn,
            &run,
            &mut job,
            session,
            AgentRunStatus::Error,
            Some(message.as_str()),
        ),
    }
}

fn resolve_related_automation_run(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<(AgentRun, AutomationJob)>, String> {
    let runs = AgentRunDao::list_runs_by_session(conn, session_id, 20)
        .map_err(|e| format!("查询浏览器会话关联运行失败: {e}"))?;
    let Some(run) = runs
        .into_iter()
        .find(|item| item.source == "automation" && item.source_ref.is_some())
    else {
        return Ok(None);
    };
    let Some(job_id) = run.source_ref.as_deref() else {
        return Ok(None);
    };
    let Some(job) =
        AutomationJobDao::get(conn, job_id).map_err(|e| format!("读取自动化任务失败: {e}"))?
    else {
        return Ok(None);
    };
    Ok(Some((run, job)))
}

fn resolve_sync_disposition(
    session: &CdpSessionState,
    finalize_on_resume: bool,
) -> BrowserSessionSyncDisposition {
    if finalize_on_resume {
        return BrowserSessionSyncDisposition::FinishSuccess;
    }

    match session.lifecycle_state {
        BrowserSessionLifecycleState::Launching | BrowserSessionLifecycleState::Live => {
            BrowserSessionSyncDisposition::Active("running")
        }
        BrowserSessionLifecycleState::WaitingForHuman => {
            BrowserSessionSyncDisposition::Active("waiting_for_human")
        }
        BrowserSessionLifecycleState::HumanControlling => {
            BrowserSessionSyncDisposition::Active("human_controlling")
        }
        BrowserSessionLifecycleState::AgentResuming => {
            BrowserSessionSyncDisposition::Active("agent_resuming")
        }
        BrowserSessionLifecycleState::Closed => BrowserSessionSyncDisposition::FinishSuccess,
        BrowserSessionLifecycleState::Failed => {
            BrowserSessionSyncDisposition::FinishError(resolve_session_error(session))
        }
    }
}

fn resolve_session_error(session: &CdpSessionState) -> String {
    session
        .last_error
        .clone()
        .or_else(|| session.human_reason.clone())
        .unwrap_or_else(|| "浏览器会话执行失败".to_string())
}

fn finish_browser_session_run(
    conn: &Connection,
    run: &AgentRun,
    job: &mut AutomationJob,
    session: &CdpSessionState,
    run_status: AgentRunStatus,
    error_message: Option<&str>,
) -> Result<(), String> {
    let finished_at = Utc::now();
    let retry_count = job.last_retry_count;
    let is_success = run_status == AgentRunStatus::Success;
    let status_text = if is_success { "success" } else { "error" };
    let duration_ms = apply_terminal_job_state(
        job,
        status_text,
        error_message.unwrap_or_default(),
        retry_count,
        run.started_at.as_str(),
        finished_at,
    )?;
    let metadata = build_browser_session_run_metadata(
        job,
        session,
        status_text,
        retry_count,
        Some(duration_ms),
    )
    .to_string();
    let finished_at_str = finished_at.to_rfc3339();
    let error_code = if is_success {
        None
    } else {
        Some("browser_session_failed")
    };

    AgentRunDao::finish_run(
        conn,
        &run.id,
        run_status,
        &finished_at_str,
        Some(duration_ms),
        error_code,
        error_message,
        Some(metadata.as_str()),
    )
    .map_err(|e| format!("结束浏览器自动化运行失败: {e}"))?;

    AutomationJobDao::update(conn, job).map_err(|e| format!("保存自动化任务结果失败: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::schema::create_tables;
    use proxycast_browser_runtime::{BrowserControlMode, BrowserTransportKind};
    use proxycast_core::config::{AutomationExecutionMode, DeliveryConfig, TaskSchedule};
    use proxycast_core::database::dao::agent_run::AgentRun;
    use rusqlite::Connection;
    use serde_json::json;
    use std::sync::{Arc, Mutex};

    fn setup_db() -> DbConnection {
        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        create_tables(&conn).expect("创建数据表失败");
        Arc::new(Mutex::new(conn))
    }

    fn sample_browser_job() -> AutomationJob {
        AutomationJob {
            id: "job-browser-1".to_string(),
            name: "浏览器巡检".to_string(),
            description: Some("等待人工处理".to_string()),
            enabled: true,
            workspace_id: "workspace-1".to_string(),
            execution_mode: AutomationExecutionMode::Intelligent,
            schedule: TaskSchedule::Every { every_secs: 300 },
            payload: json!({
                "kind": "browser_session",
                "profile_id": "profile-1",
                "profile_key": "shop_us",
                "url": "https://seller.example.com/dashboard",
                "environment_preset_id": "preset-1",
                "target_id": null,
                "open_window": false,
                "stream_mode": "events"
            }),
            delivery: DeliveryConfig::default(),
            timeout_secs: Some(180),
            max_retries: 2,
            next_run_at: None,
            last_status: Some("running".to_string()),
            last_error: None,
            last_run_at: Some("2026-03-16T00:00:00Z".to_string()),
            last_finished_at: None,
            running_started_at: Some("2026-03-16T00:00:00Z".to_string()),
            consecutive_failures: 0,
            last_retry_count: 0,
            auto_disabled_until: None,
            last_delivery: None,
            created_at: "2026-03-16T00:00:00Z".to_string(),
            updated_at: "2026-03-16T00:00:00Z".to_string(),
        }
    }

    fn sample_run(session_id: &str) -> AgentRun {
        AgentRun {
            id: "run-browser-1".to_string(),
            source: "automation".to_string(),
            source_ref: Some("job-browser-1".to_string()),
            session_id: Some(session_id.to_string()),
            status: AgentRunStatus::Running,
            started_at: "2026-03-16T00:00:00Z".to_string(),
            finished_at: None,
            duration_ms: None,
            error_code: None,
            error_message: None,
            metadata: None,
            created_at: "2026-03-16T00:00:00Z".to_string(),
            updated_at: "2026-03-16T00:00:00Z".to_string(),
        }
    }

    fn sample_session(
        session_id: &str,
        lifecycle_state: BrowserSessionLifecycleState,
    ) -> CdpSessionState {
        CdpSessionState {
            session_id: session_id.to_string(),
            profile_key: "shop_us".to_string(),
            environment_preset_id: Some("preset-1".to_string()),
            environment_preset_name: Some("美区桌面".to_string()),
            target_id: "target-1".to_string(),
            target_title: "店铺后台".to_string(),
            target_url: "https://seller.example.com/dashboard".to_string(),
            remote_debugging_port: 13001,
            ws_debugger_url: "ws://127.0.0.1:13001/devtools/page/target-1".to_string(),
            devtools_frontend_url: None,
            stream_mode: None,
            transport_kind: BrowserTransportKind::CdpFrames,
            lifecycle_state,
            control_mode: BrowserControlMode::Agent,
            human_reason: None,
            last_page_info: None,
            last_event_at: Some("2026-03-16T00:00:01Z".to_string()),
            last_frame_at: None,
            last_error: None,
            created_at: "2026-03-16T00:00:00Z".to_string(),
            connected: true,
        }
    }

    #[test]
    fn sync_browser_session_runtime_state_should_mark_waiting_for_human() {
        let db = setup_db();
        let conn = db.lock().expect("数据库锁定失败");
        AutomationJobDao::create(&conn, &sample_browser_job()).expect("写入 job 失败");
        AgentRunDao::create_run(&conn, &sample_run("session-1")).expect("写入 run 失败");
        drop(conn);

        let mut session =
            sample_session("session-1", BrowserSessionLifecycleState::WaitingForHuman);
        session.control_mode = BrowserControlMode::Shared;
        session.human_reason = Some("等待你确认是否继续执行".to_string());
        sync_browser_session_runtime_state(&db, &session).expect("同步浏览器运行态失败");

        let conn = db.lock().expect("数据库锁定失败");
        let job = AutomationJobDao::get(&conn, "job-browser-1")
            .expect("查询 job 失败")
            .expect("job 不存在");
        let run = AgentRunDao::get_run(&conn, "run-browser-1")
            .expect("查询 run 失败")
            .expect("run 不存在");
        assert_eq!(job.last_status.as_deref(), Some("waiting_for_human"));
        assert!(job.running_started_at.is_some());
        assert_eq!(run.status, AgentRunStatus::Running);
        assert!(run
            .metadata
            .as_deref()
            .unwrap_or_default()
            .contains("\"browser_lifecycle_state\":\"waiting_for_human\""));
    }

    #[test]
    fn complete_browser_session_after_resume_should_finalize_success() {
        let db = setup_db();
        let mut job = sample_browser_job();
        job.last_status = Some("human_controlling".to_string());

        let conn = db.lock().expect("数据库锁定失败");
        AutomationJobDao::create(&conn, &job).expect("写入 job 失败");
        AgentRunDao::create_run(&conn, &sample_run("session-2")).expect("写入 run 失败");
        drop(conn);

        let mut session = sample_session("session-2", BrowserSessionLifecycleState::AgentResuming);
        session.human_reason = Some("人工处理完成，继续执行".to_string());
        complete_browser_session_after_resume(&db, &session).expect("恢复后收口失败");

        let conn = db.lock().expect("数据库锁定失败");
        let job = AutomationJobDao::get(&conn, "job-browser-1")
            .expect("查询 job 失败")
            .expect("job 不存在");
        let run = AgentRunDao::get_run(&conn, "run-browser-1")
            .expect("查询 run 失败")
            .expect("run 不存在");
        assert_eq!(job.last_status.as_deref(), Some("success"));
        assert!(job.running_started_at.is_none());
        assert_eq!(run.status, AgentRunStatus::Success);
        assert!(run.finished_at.is_some());
    }
}
