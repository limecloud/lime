//! 自动化调度服务
//!
//! 负责自动化任务的结构化存储、后台轮询与执行。

pub mod browser_runtime_sync;
pub mod delivery;
pub mod executor;
pub mod health;
pub mod schedule;

use self::delivery::{
    build_delivery_attempt_id, deliver_result, DeliveryContext, TaskOutput, TaskResult,
};
use self::executor::execute_job;
use self::health::{query_automation_health, AutomationHealthQuery, AutomationHealthResult};
use self::schedule::{
    describe_schedule, next_run_for_schedule, preview_next_run, validate_schedule,
};
use crate::database::dao::agent_run::AgentRunStatus;
use crate::services::browser_environment_service::get_browser_environment_preset;
use crate::services::browser_profile_service::get_browser_profile;
use crate::services::execution_tracker_service::{ExecutionTracker, RunHandle, RunSource};
use chrono::Utc;
use lime_browser_runtime::{BrowserStreamMode, CdpSessionState};
use lime_core::config::{
    AutomationExecutionMode, AutomationSettings, DeliveryConfig, TaskSchedule,
};
use lime_core::database::dao::agent_run::{AgentRun, AgentRunDao};
use lime_core::database::dao::automation_job::{
    AutomationJob, AutomationJobDao, AutomationJobLastDelivery,
};
use lime_core::database::DbConnection;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::sync::Arc;
use std::time::Duration;
use tauri::Emitter;
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;
use url::Url;
use uuid::Uuid;

pub type AutomationJobRecord = AutomationJob;

#[derive(Clone)]
pub struct AutomationServiceState(pub Arc<RwLock<AutomationService>>);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationStatus {
    pub running: bool,
    pub last_polled_at: Option<String>,
    pub next_poll_at: Option<String>,
    pub last_job_count: usize,
    pub total_executions: u64,
    pub active_job_id: Option<String>,
    pub active_job_name: Option<String>,
}

fn default_browser_session_open_window() -> bool {
    false
}

fn default_browser_session_stream_mode() -> BrowserStreamMode {
    BrowserStreamMode::Events
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AutomationPayload {
    AgentTurn {
        prompt: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        system_prompt: Option<String>,
        #[serde(default)]
        web_search: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        request_metadata: Option<Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        content_id: Option<String>,
    },
    BrowserSession {
        profile_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        profile_key: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        url: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        environment_preset_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        target_id: Option<String>,
        #[serde(default = "default_browser_session_open_window")]
        open_window: bool,
        #[serde(default = "default_browser_session_stream_mode")]
        stream_mode: BrowserStreamMode,
    },
}

impl AutomationPayload {
    fn kind(&self) -> &'static str {
        match self {
            Self::AgentTurn { .. } => "agent_turn",
            Self::BrowserSession { .. } => "browser_session",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationJobDraft {
    pub name: String,
    pub description: Option<String>,
    pub enabled: bool,
    pub workspace_id: String,
    pub execution_mode: AutomationExecutionMode,
    pub schedule: TaskSchedule,
    pub payload: AutomationPayload,
    pub delivery: DeliveryConfig,
    pub timeout_secs: Option<u64>,
    pub max_retries: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AutomationJobUpdate {
    pub name: Option<String>,
    pub description: Option<String>,
    pub enabled: Option<bool>,
    pub workspace_id: Option<String>,
    pub execution_mode: Option<AutomationExecutionMode>,
    pub schedule: Option<TaskSchedule>,
    pub payload: Option<AutomationPayload>,
    pub delivery: Option<DeliveryConfig>,
    pub timeout_secs: Option<Option<u64>>,
    pub max_retries: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationCycleResult {
    pub job_count: usize,
    pub success_count: usize,
    pub failed_count: usize,
    pub timeout_count: usize,
}

pub struct AutomationService {
    config: AutomationSettings,
    cancel_token: Option<CancellationToken>,
    status: AutomationStatus,
    db: Option<DbConnection>,
    app_handle: Option<tauri::AppHandle>,
}

impl AutomationService {
    pub fn new(config: AutomationSettings) -> Self {
        Self {
            config,
            cancel_token: None,
            status: AutomationStatus {
                running: false,
                last_polled_at: None,
                next_poll_at: None,
                last_job_count: 0,
                total_executions: 0,
                active_job_id: None,
                active_job_name: None,
            },
            db: None,
            app_handle: None,
        }
    }

    pub fn set_db(&mut self, db: DbConnection) {
        self.db = Some(db);
    }

    pub fn set_app_handle(&mut self, handle: tauri::AppHandle) {
        self.app_handle = Some(handle);
    }

    pub fn update_config(&mut self, config: AutomationSettings) {
        self.config = config;
    }

    pub fn get_config(&self) -> &AutomationSettings {
        &self.config
    }

    pub fn get_status(&self) -> AutomationStatus {
        self.status.clone()
    }

    pub async fn start(&mut self, self_ref: Arc<RwLock<AutomationService>>) -> Result<(), String> {
        if self.status.running {
            return Ok(());
        }
        let db = self
            .db
            .clone()
            .ok_or_else(|| "数据库未初始化，无法启动自动化服务".to_string())?;

        let cancel_token = CancellationToken::new();
        self.cancel_token = Some(cancel_token.clone());
        self.status.running = true;
        self.update_next_poll();

        let interval_secs = self.config.poll_interval_secs.max(5);
        let app_handle = self.app_handle.clone();
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(interval_secs));
            loop {
                tokio::select! {
                    _ = ticker.tick() => {
                        let result = Self::execute_due_jobs(&self_ref, &db, &app_handle).await;
                        if let Err(error) = result {
                            tracing::warn!("[Automation] 轮询执行失败: {}", error);
                        }
                    }
                    _ = cancel_token.cancelled() => break,
                }
            }
        });

        Ok(())
    }

    pub async fn stop(&mut self) -> Result<(), String> {
        if let Some(token) = self.cancel_token.take() {
            token.cancel();
        }
        self.status.running = false;
        self.status.active_job_id = None;
        self.status.active_job_name = None;
        Ok(())
    }

    pub fn list_jobs(&self) -> Result<Vec<AutomationJobRecord>, String> {
        let db = self
            .db
            .as_ref()
            .ok_or_else(|| "数据库未初始化".to_string())?;
        let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
        AutomationJobDao::list(&conn).map_err(|e| format!("查询自动化任务失败: {e}"))
    }

    pub fn get_job(&self, id: &str) -> Result<Option<AutomationJobRecord>, String> {
        let db = self
            .db
            .as_ref()
            .ok_or_else(|| "数据库未初始化".to_string())?;
        let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
        AutomationJobDao::get(&conn, id).map_err(|e| format!("查询自动化任务失败: {e}"))
    }

    pub fn create_job(&self, draft: AutomationJobDraft) -> Result<AutomationJobRecord, String> {
        validate_draft(&draft)?;
        let db = self
            .db
            .as_ref()
            .ok_or_else(|| "数据库未初始化".to_string())?;
        let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
        validate_payload_with_conn(&conn, &draft.payload)?;

        let now = Utc::now().to_rfc3339();
        let next_run_at = if draft.enabled {
            preview_next_run(&draft.schedule)?
        } else {
            None
        };
        let job = AutomationJob {
            id: Uuid::new_v4().to_string(),
            name: draft.name.trim().to_string(),
            description: normalize_optional_string(draft.description),
            enabled: draft.enabled,
            workspace_id: draft.workspace_id.trim().to_string(),
            execution_mode: draft.execution_mode,
            schedule: draft.schedule,
            payload: serde_json::to_value(draft.payload)
                .map_err(|e| format!("序列化自动化负载失败: {e}"))?,
            delivery: draft.delivery,
            timeout_secs: draft.timeout_secs,
            max_retries: draft.max_retries.max(1),
            next_run_at,
            last_status: None,
            last_error: None,
            last_run_at: None,
            last_finished_at: None,
            running_started_at: None,
            consecutive_failures: 0,
            last_retry_count: 0,
            auto_disabled_until: None,
            last_delivery: None,
            created_at: now.clone(),
            updated_at: now,
        };

        AutomationJobDao::create(&conn, &job).map_err(|e| format!("创建自动化任务失败: {e}"))?;
        Ok(job)
    }

    pub fn update_job(
        &self,
        id: &str,
        update: AutomationJobUpdate,
    ) -> Result<AutomationJobRecord, String> {
        let db = self
            .db
            .as_ref()
            .ok_or_else(|| "数据库未初始化".to_string())?;
        let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
        let mut job = AutomationJobDao::get(&conn, id)
            .map_err(|e| format!("读取自动化任务失败: {e}"))?
            .ok_or_else(|| format!("自动化任务不存在: {id}"))?;

        if let Some(value) = update.name {
            job.name = value.trim().to_string();
        }
        if let Some(value) = update.description {
            job.description = normalize_optional_string(Some(value));
        }
        if let Some(value) = update.enabled {
            job.enabled = value;
        }
        if let Some(value) = update.workspace_id {
            job.workspace_id = value.trim().to_string();
        }
        if let Some(value) = update.execution_mode {
            job.execution_mode = value;
        }
        if let Some(value) = update.schedule {
            validate_schedule(&value, Utc::now())?;
            job.schedule = value;
        }
        if let Some(value) = update.payload {
            validate_payload(&value)?;
            job.payload =
                serde_json::to_value(value).map_err(|e| format!("序列化自动化负载失败: {e}"))?;
        }
        if let Some(value) = update.delivery {
            job.delivery = value;
        }
        if let Some(value) = update.timeout_secs {
            job.timeout_secs = value;
        }
        if let Some(value) = update.max_retries {
            job.max_retries = value.max(1);
        }

        if job.enabled && job.running_started_at.is_none() {
            job.next_run_at = preview_next_run(&job.schedule)?;
        } else if !job.enabled {
            job.next_run_at = None;
        }
        job.updated_at = Utc::now().to_rfc3339();

        validate_job(&conn, &job)?;
        AutomationJobDao::update(&conn, &job).map_err(|e| format!("更新自动化任务失败: {e}"))?;
        Ok(job)
    }

    pub fn delete_job(&self, id: &str) -> Result<bool, String> {
        let db = self
            .db
            .as_ref()
            .ok_or_else(|| "数据库未初始化".to_string())?;
        let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
        AutomationJobDao::delete(&conn, id).map_err(|e| format!("删除自动化任务失败: {e}"))
    }

    pub async fn run_job_now(&self, id: &str) -> Result<AutomationCycleResult, String> {
        let db = self
            .db
            .as_ref()
            .ok_or_else(|| "数据库未初始化".to_string())?;
        let job = {
            let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
            AutomationJobDao::get(&conn, id)
                .map_err(|e| format!("读取自动化任务失败: {e}"))?
                .ok_or_else(|| format!("自动化任务不存在: {id}"))?
        };

        let result = Self::execute_job_once(&job, db, &self.app_handle, &self.config).await?;
        Ok(AutomationCycleResult {
            job_count: 1,
            success_count: usize::from(result == "success"),
            failed_count: usize::from(result == "error"),
            timeout_count: usize::from(result == "timeout"),
        })
    }

    pub fn get_job_runs(&self, id: &str, limit: usize) -> Result<Vec<AgentRun>, String> {
        let db = self
            .db
            .as_ref()
            .ok_or_else(|| "数据库未初始化".to_string())?;
        let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
        AgentRunDao::list_runs_by_source_ref(&conn, "automation", id, limit)
            .map_err(|e| format!("查询自动化运行历史失败: {e}"))
    }

    pub fn get_health(
        &self,
        query: Option<AutomationHealthQuery>,
    ) -> Result<AutomationHealthResult, String> {
        let db = self
            .db
            .as_ref()
            .ok_or_else(|| "数据库未初始化".to_string())?;
        query_automation_health(db, query)
    }

    fn update_next_poll(&mut self) {
        let now = Utc::now();
        self.status.next_poll_at = Some(
            (now + chrono::Duration::seconds(self.config.poll_interval_secs.max(5) as i64))
                .to_rfc3339(),
        );
    }

    async fn execute_due_jobs(
        self_ref: &Arc<RwLock<AutomationService>>,
        db: &DbConnection,
        app_handle: &Option<tauri::AppHandle>,
    ) -> Result<(), String> {
        let jobs = {
            let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
            AutomationJobDao::list_due(&conn, &Utc::now().to_rfc3339(), 10)
                .map_err(|e| format!("查询到期自动化任务失败: {e}"))?
        };

        {
            let mut service = self_ref.write().await;
            service.status.last_polled_at = Some(Utc::now().to_rfc3339());
            service.status.last_job_count = jobs.len();
            service.update_next_poll();
        }

        for job in jobs {
            {
                let mut service = self_ref.write().await;
                service.status.active_job_id = Some(job.id.clone());
                service.status.active_job_name = Some(job.name.clone());
            }
            let config = { self_ref.read().await.config.clone() };
            let result = Self::execute_job_once(&job, db, app_handle, &config).await?;
            {
                let mut service = self_ref.write().await;
                service.status.total_executions += 1;
                service.status.active_job_id = None;
                service.status.active_job_name = None;
                if result == "error" || result == "timeout" {
                    service.status.last_job_count = service.status.last_job_count.max(1);
                }
            }
        }

        Ok(())
    }

    async fn execute_job_once(
        job: &AutomationJobRecord,
        db: &DbConnection,
        app_handle: &Option<tauri::AppHandle>,
        config: &AutomationSettings,
    ) -> Result<String, String> {
        let tracker = ExecutionTracker::new(db.clone());
        let mut working_job = job.clone();
        let started_at = Utc::now();
        let started_at_str = started_at.to_rfc3339();
        let is_browser_session = is_browser_session_payload(&working_job.payload);

        set_active_job_state(
            &mut working_job,
            "running",
            &started_at_str,
            &started_at_str,
            0,
        );
        {
            let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
            AutomationJobDao::update(&conn, &working_job)
                .map_err(|e| format!("更新任务运行状态失败: {e}"))?;
        }

        if let Some(handle) = app_handle {
            let _ = handle.emit(
                "automation:job_start",
                json!({ "job_id": working_job.id, "name": working_job.name }),
            );
        }

        let run_handle = if config.enable_history {
            tracker.start(
                RunSource::Automation,
                Some(working_job.id.clone()),
                None,
                Some(build_tracker_start_metadata(&working_job)),
            )
        } else {
            None
        };

        let max_attempts = working_job.max_retries.max(1);
        let mut retry_count = 0u32;
        let mut status = "error".to_string();
        let mut output = String::new();
        let mut output_data: Option<Value> = None;
        let mut session_id: Option<String> = None;
        let mut browser_session: Option<CdpSessionState> = None;

        for attempt in 0..max_attempts {
            if attempt > 0 {
                retry_count = attempt;
            }

            let fut = execute_job(&working_job, db, app_handle);
            let execution = if let Some(timeout_secs) = working_job.timeout_secs {
                match tokio::time::timeout(Duration::from_secs(timeout_secs), fut).await {
                    Ok(result) => result,
                    Err(_) => {
                        status = "timeout".to_string();
                        output = format!("任务执行超时（{}s）", timeout_secs);
                        break;
                    }
                }
            } else {
                fut.await
            };

            match execution {
                Ok(result) => {
                    status = if is_browser_session && result.browser_session.is_some() {
                        "running".to_string()
                    } else {
                        "success".to_string()
                    };
                    output = result.output;
                    output_data = result.output_data;
                    session_id = result.session_id;
                    browser_session = result.browser_session;
                    break;
                }
                Err(error) => {
                    status = "error".to_string();
                    output = error;
                    output_data = None;
                    if attempt + 1 >= max_attempts {
                        break;
                    }
                }
            }
        }

        if let Some(session) = browser_session.as_ref() {
            if let Some(handle) = run_handle.as_ref() {
                tracker.refresh_running_metadata(
                    handle,
                    Some(session.session_id.as_str()),
                    Some(build_browser_session_run_metadata(
                        &working_job,
                        session,
                        "running",
                        retry_count,
                        None,
                    )),
                );
            }

            working_job.last_retry_count = retry_count;
            working_job.updated_at = Utc::now().to_rfc3339();
            working_job.next_run_at = None;
            {
                let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
                AutomationJobDao::update(&conn, &working_job)
                    .map_err(|e| format!("保存浏览器自动化运行态失败: {e}"))?;
            }
            return Ok(status);
        }

        let execution_status = status.clone();
        let execution_output = output.clone();
        let mut last_delivery: Option<AutomationJobLastDelivery> = None;
        if working_job.delivery.mode != "none" {
            let delivery_started_at = Utc::now();
            let delivery_duration_ms = delivery_started_at
                .timestamp_millis()
                .saturating_sub(started_at.timestamp_millis());
            let delivery_output_data = output_data.clone().or_else(|| {
                if execution_status == "success" {
                    None
                } else {
                    Some(json!({
                        "kind": "error",
                        "job_id": working_job.id.clone(),
                        "job_name": working_job.name.clone(),
                        "status": execution_status.clone(),
                        "message": execution_output.clone(),
                    }))
                }
            });
            let delivery_output_kind = if delivery_output_data.is_some() {
                "json".to_string()
            } else {
                "text".to_string()
            };
            let delivery_context = build_delivery_context(
                &working_job,
                &started_at_str,
                retry_count,
                run_handle.as_ref(),
            );
            let delivery_result = deliver_result(
                &working_job.delivery,
                &TaskResult {
                    task: working_job.name.clone(),
                    status: execution_status.clone(),
                    output: TaskOutput {
                        kind: delivery_output_kind,
                        text: execution_output.clone(),
                        data: delivery_output_data,
                    },
                    duration_ms: delivery_duration_ms,
                    timestamp: delivery_started_at.to_rfc3339(),
                },
                &delivery_context,
            )
            .await;
            last_delivery = Some(build_last_delivery_record(
                &delivery_result,
                &working_job.delivery,
                &Utc::now().to_rfc3339(),
            ));
            working_job.last_delivery = last_delivery.clone();
            if !delivery_result.success {
                tracing::warn!("[Automation] 输出投递失败: {}", delivery_result.message);
                if !working_job.delivery.best_effort {
                    status = "error".to_string();
                    output = build_required_delivery_failure_message(
                        &execution_status,
                        &execution_output,
                        &delivery_result.message,
                    );
                }
            }
        }

        let finished_at = Utc::now();
        let duration_ms = apply_terminal_job_state(
            &mut working_job,
            &status,
            &output,
            retry_count,
            &started_at_str,
            finished_at,
        )?;

        {
            let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
            AutomationJobDao::update(&conn, &working_job)
                .map_err(|e| format!("保存自动化任务结果失败: {e}"))?;
        }

        if let Some(handle) = run_handle.as_ref() {
            let run_status = match status.as_str() {
                "success" => AgentRunStatus::Success,
                "timeout" => AgentRunStatus::Timeout,
                _ => AgentRunStatus::Error,
            };
            let run_succeeded = run_status == AgentRunStatus::Success;
            tracker.finish_with_status(
                handle,
                run_status,
                if run_succeeded {
                    None
                } else {
                    Some("automation_job_failed")
                },
                if run_succeeded {
                    None
                } else {
                    Some(output.as_str())
                },
                Some(build_tracker_finish_metadata(
                    &working_job,
                    session_id.as_deref(),
                    &status,
                    &execution_status,
                    retry_count,
                    duration_ms,
                    last_delivery.as_ref(),
                )),
            );
        }

        if let Some(handle) = app_handle {
            let _ = handle.emit(
                "automation:job_complete",
                json!({
                    "job_id": working_job.id,
                    "name": working_job.name,
                    "status": status,
                    "duration_ms": duration_ms,
                    "retry_count": retry_count,
                }),
            );
        }

        Ok(status)
    }
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn validate_optional_http_url(value: Option<&str>, field_name: &str) -> Result<(), String> {
    let Some(raw) = value.map(str::trim).filter(|item| !item.is_empty()) else {
        return Ok(());
    };
    let parsed = Url::parse(raw).map_err(|error| format!("{field_name}无效: {error}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(()),
        _ => Err(format!("{field_name}仅支持 http/https")),
    }
}

fn validate_draft(draft: &AutomationJobDraft) -> Result<(), String> {
    validate_schedule(&draft.schedule, Utc::now())?;
    validate_payload(&draft.payload)?;
    if draft.name.trim().is_empty() {
        return Err("任务名称不能为空".to_string());
    }
    if draft.workspace_id.trim().is_empty() {
        return Err("workspace_id 必填".to_string());
    }
    Ok(())
}

fn validate_job(conn: &Connection, job: &AutomationJobRecord) -> Result<(), String> {
    validate_schedule(&job.schedule, Utc::now())?;
    let payload = serde_json::from_value::<AutomationPayload>(job.payload.clone())
        .map_err(|e| format!("解析自动化负载失败: {e}"))?;
    validate_payload(&payload)?;
    validate_payload_with_conn(conn, &payload)?;
    if job.name.trim().is_empty() {
        return Err("任务名称不能为空".to_string());
    }
    if job.workspace_id.trim().is_empty() {
        return Err("workspace_id 必填".to_string());
    }
    Ok(())
}

fn validate_payload(payload: &AutomationPayload) -> Result<(), String> {
    match payload {
        AutomationPayload::AgentTurn {
            prompt,
            request_metadata,
            content_id,
            ..
        } => {
            if prompt.trim().is_empty() {
                return Err("自动化任务内容不能为空".to_string());
            }
            if let Some(content_id) = content_id {
                if content_id.trim().is_empty() {
                    return Err("自动化任务 content_id 不能为空字符串".to_string());
                }
            }
            if let Some(request_metadata) = request_metadata {
                if !request_metadata.is_object() {
                    return Err("自动化任务 request_metadata 必须为对象".to_string());
                }
            }
        }
        AutomationPayload::BrowserSession { profile_id, .. } => {
            if profile_id.trim().is_empty() {
                return Err("浏览器任务必须绑定浏览器资料".to_string());
            }
        }
    }
    Ok(())
}

fn validate_payload_with_conn(
    conn: &Connection,
    payload: &AutomationPayload,
) -> Result<(), String> {
    match payload {
        AutomationPayload::AgentTurn { .. } => Ok(()),
        AutomationPayload::BrowserSession {
            profile_id,
            profile_key,
            url,
            environment_preset_id,
            ..
        } => {
            let profile_id = profile_id.trim();
            let profile = get_browser_profile(conn, profile_id)?
                .filter(|record| record.archived_at.is_none())
                .ok_or_else(|| format!("未找到可用的浏览器资料: {profile_id}"))?;

            if let Some(expected_profile_key) = profile_key
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                if profile.profile_key != expected_profile_key {
                    return Err(format!(
                        "浏览器资料 {profile_id} 的 profile_key 与任务配置不一致: {} != {expected_profile_key}",
                        profile.profile_key
                    ));
                }
            }

            if let Some(environment_preset_id) = environment_preset_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                get_browser_environment_preset(conn, environment_preset_id)?
                    .filter(|record| record.archived_at.is_none())
                    .ok_or_else(|| {
                        format!("未找到可用的浏览器环境预设: {environment_preset_id}")
                    })?;
            }

            validate_optional_http_url(url.as_deref(), "浏览器启动地址")
        }
    }
}

fn build_tracker_start_metadata(job: &AutomationJobRecord) -> Value {
    let mut metadata = Map::from_iter([
        ("job_id".to_string(), Value::String(job.id.clone())),
        ("job_name".to_string(), Value::String(job.name.clone())),
        (
            "workspace_id".to_string(),
            Value::String(job.workspace_id.clone()),
        ),
        (
            "schedule".to_string(),
            Value::String(describe_schedule(&job.schedule)),
        ),
    ]);
    append_payload_tracking_metadata(&mut metadata, &job.payload);
    Value::Object(metadata)
}

pub(super) fn set_active_job_state(
    job: &mut AutomationJobRecord,
    status: &str,
    started_at: &str,
    updated_at: &str,
    retry_count: u32,
) {
    job.running_started_at = Some(started_at.to_string());
    job.last_status = Some(status.to_string());
    job.last_error = None;
    job.last_run_at = Some(started_at.to_string());
    job.last_finished_at = None;
    job.last_retry_count = retry_count;
    job.next_run_at = None;
    job.updated_at = updated_at.to_string();
}

fn build_tracker_finish_metadata(
    job: &AutomationJobRecord,
    session_id: Option<&str>,
    status: &str,
    execution_status: &str,
    retry_count: u32,
    duration_ms: i64,
    last_delivery: Option<&AutomationJobLastDelivery>,
) -> Value {
    let mut metadata = Map::from_iter([
        ("job_id".to_string(), Value::String(job.id.clone())),
        ("job_name".to_string(), Value::String(job.name.clone())),
        (
            "workspace_id".to_string(),
            Value::String(job.workspace_id.clone()),
        ),
        ("status".to_string(), Value::String(status.to_string())),
        ("retry_count".to_string(), json!(retry_count)),
        ("duration_ms".to_string(), json!(duration_ms)),
    ]);
    if execution_status != status {
        metadata.insert(
            "execution_status".to_string(),
            Value::String(execution_status.to_string()),
        );
    }
    if let Some(session_id) = session_id {
        metadata.insert(
            "session_id".to_string(),
            Value::String(session_id.to_string()),
        );
    }
    if let Some(last_delivery) = last_delivery {
        if let Ok(value) = serde_json::to_value(last_delivery) {
            metadata.insert("delivery".to_string(), value);
        }
    }
    append_payload_tracking_metadata(&mut metadata, &job.payload);
    Value::Object(metadata)
}

fn build_last_delivery_record(
    result: &self::delivery::DeliveryResult,
    config: &DeliveryConfig,
    attempted_at: &str,
) -> AutomationJobLastDelivery {
    AutomationJobLastDelivery {
        success: result.success,
        message: result.message.clone(),
        channel: result.channel.clone().or_else(|| config.channel.clone()),
        target: result.target.clone().or_else(|| config.target.clone()),
        output_kind: result.output_kind.clone(),
        output_schema: result.output_schema.clone(),
        output_format: result.output_format.clone(),
        output_preview: result.output_preview.clone(),
        delivery_attempt_id: Some(result.delivery_attempt_id.clone()),
        run_id: result.run_id.clone(),
        execution_retry_count: result.execution_retry_count,
        delivery_attempts: result.delivery_attempts,
        attempted_at: attempted_at.to_string(),
    }
}

fn build_delivery_context(
    job: &AutomationJobRecord,
    started_at: &str,
    retry_count: u32,
    run_handle: Option<&RunHandle>,
) -> DeliveryContext {
    let run_id = run_handle.map(|handle| handle.id.clone());
    let attempt_id = build_delivery_attempt_id(&job.id, started_at, retry_count, run_id.as_deref());
    DeliveryContext {
        attempt_id,
        run_id,
        job_id: job.id.clone(),
        execution_retry_count: retry_count,
    }
}

fn build_required_delivery_failure_message(
    execution_status: &str,
    execution_output: &str,
    delivery_message: &str,
) -> String {
    match execution_status {
        "success" => format!("任务执行成功，但输出投递失败: {delivery_message}"),
        "timeout" => format!(
            "任务执行超时，且输出投递失败: {delivery_message}\n原始执行结果: {execution_output}"
        ),
        _ => format!(
            "任务执行失败，且输出投递失败: {delivery_message}\n原始执行结果: {execution_output}"
        ),
    }
}

pub(super) fn build_browser_session_run_metadata(
    job: &AutomationJobRecord,
    session: &CdpSessionState,
    status: &str,
    retry_count: u32,
    duration_ms: Option<i64>,
) -> Value {
    let mut metadata = Map::from_iter([
        ("job_id".to_string(), Value::String(job.id.clone())),
        ("job_name".to_string(), Value::String(job.name.clone())),
        (
            "workspace_id".to_string(),
            Value::String(job.workspace_id.clone()),
        ),
        (
            "schedule".to_string(),
            Value::String(describe_schedule(&job.schedule)),
        ),
        ("status".to_string(), Value::String(status.to_string())),
        ("retry_count".to_string(), json!(retry_count)),
        (
            "session_id".to_string(),
            Value::String(session.session_id.clone()),
        ),
        (
            "browser_lifecycle_state".to_string(),
            json!(session.lifecycle_state),
        ),
        ("control_mode".to_string(), json!(session.control_mode)),
        ("connected".to_string(), Value::Bool(session.connected)),
        (
            "browser_target_id".to_string(),
            Value::String(session.target_id.clone()),
        ),
        (
            "browser_target_url".to_string(),
            Value::String(session.target_url.clone()),
        ),
    ]);
    if let Some(reason) = session.human_reason.as_deref() {
        metadata.insert(
            "human_reason".to_string(),
            Value::String(reason.to_string()),
        );
    }
    if let Some(last_error) = session.last_error.as_deref() {
        metadata.insert(
            "browser_last_error".to_string(),
            Value::String(last_error.to_string()),
        );
    }
    if let Some(duration_ms) = duration_ms {
        metadata.insert("duration_ms".to_string(), json!(duration_ms));
    }
    append_payload_tracking_metadata(&mut metadata, &job.payload);
    Value::Object(metadata)
}

pub(super) fn apply_terminal_job_state(
    job: &mut AutomationJobRecord,
    status: &str,
    output: &str,
    retry_count: u32,
    started_at: &str,
    finished_at: chrono::DateTime<Utc>,
) -> Result<i64, String> {
    let started_at = chrono::DateTime::parse_from_rfc3339(started_at)
        .map(|value| value.with_timezone(&Utc))
        .unwrap_or(finished_at);
    let duration_ms = finished_at
        .timestamp_millis()
        .saturating_sub(started_at.timestamp_millis());

    job.last_status = Some(status.to_string());
    job.last_error = if status == "success" {
        None
    } else {
        Some(output.to_string())
    };
    job.last_run_at = Some(started_at.to_rfc3339());
    job.last_finished_at = Some(finished_at.to_rfc3339());
    job.running_started_at = None;
    job.last_retry_count = retry_count;
    job.updated_at = finished_at.to_rfc3339();

    if status == "success" {
        job.consecutive_failures = 0;
        job.auto_disabled_until = None;
    } else {
        job.consecutive_failures = job.consecutive_failures.saturating_add(1);
        if job.consecutive_failures >= 3 {
            job.auto_disabled_until =
                Some((finished_at + chrono::Duration::minutes(5)).to_rfc3339());
        }
    }

    match &job.schedule {
        TaskSchedule::At { .. } => {
            job.enabled = false;
            job.next_run_at = None;
        }
        _ => {
            job.next_run_at =
                next_run_for_schedule(&job.schedule, finished_at)?.map(|value| value.to_rfc3339());
        }
    }

    Ok(duration_ms)
}

fn is_browser_session_payload(payload: &Value) -> bool {
    matches!(
        serde_json::from_value::<AutomationPayload>(payload.clone()),
        Ok(AutomationPayload::BrowserSession { .. })
    )
}

pub(super) fn append_payload_tracking_metadata(metadata: &mut Map<String, Value>, payload: &Value) {
    let Ok(parsed_payload) = serde_json::from_value::<AutomationPayload>(payload.clone()) else {
        return;
    };
    metadata.insert(
        "payload_kind".to_string(),
        Value::String(parsed_payload.kind().to_string()),
    );

    match parsed_payload {
        AutomationPayload::AgentTurn {
            request_metadata,
            content_id,
            ..
        } => {
            if let Some(content_id) = content_id.clone() {
                metadata.insert("content_id".to_string(), Value::String(content_id));
            }

            let request_metadata = request_metadata.as_ref().and_then(Value::as_object);
            if let Some(service_skill) = request_metadata.and_then(|value| {
                value
                    .get("service_skill")
                    .or_else(|| value.get("serviceSkill"))
            }) {
                metadata.insert("service_skill".to_string(), service_skill.clone());
            }

            let harness = request_metadata
                .and_then(|value| value.get("harness"))
                .and_then(Value::as_object)
                .map(|value| {
                    let mut next = value.clone();
                    if let Some(content_id) = content_id.as_ref() {
                        if !next.contains_key("content_id") && !next.contains_key("contentId") {
                            next.insert(
                                "content_id".to_string(),
                                Value::String(content_id.clone()),
                            );
                        }
                    }
                    Value::Object(next)
                })
                .or_else(|| {
                    content_id.map(|value| {
                        json!({
                            "content_id": value
                        })
                    })
                });
            if let Some(harness) = harness {
                metadata.insert("harness".to_string(), harness);
            }
        }
        AutomationPayload::BrowserSession {
            profile_id,
            profile_key,
            url,
            environment_preset_id,
            target_id,
            open_window,
            stream_mode,
        } => {
            metadata.insert("profile_id".to_string(), Value::String(profile_id));
            if let Some(profile_key) = profile_key {
                metadata.insert("profile_key".to_string(), Value::String(profile_key));
            }
            if let Some(url) = url {
                metadata.insert("url".to_string(), Value::String(url));
            }
            if let Some(environment_preset_id) = environment_preset_id {
                metadata.insert(
                    "environment_preset_id".to_string(),
                    Value::String(environment_preset_id),
                );
            }
            if let Some(target_id) = target_id {
                metadata.insert("target_id".to_string(), Value::String(target_id));
            }
            metadata.insert("open_window".to_string(), Value::Bool(open_window));
            metadata.insert("stream_mode".to_string(), json!(stream_mode));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::schema::create_tables;
    use crate::services::browser_environment_service::{
        save_browser_environment_preset, SaveBrowserEnvironmentPresetInput,
    };
    use crate::services::browser_profile_service::{save_browser_profile, SaveBrowserProfileInput};
    use lime_core::database::dao::browser_profile::BrowserProfileTransportKind;
    use rusqlite::Connection;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        create_tables(&conn).expect("创建数据表失败");
        conn
    }

    #[test]
    fn validate_payload_with_conn_should_accept_browser_session_payload() {
        let conn = setup_db();
        let profile = save_browser_profile(
            &conn,
            SaveBrowserProfileInput {
                id: None,
                profile_key: "shop_us".to_string(),
                name: "美区店铺".to_string(),
                description: None,
                site_scope: None,
                launch_url: Some("https://seller.example.com".to_string()),
                transport_kind: BrowserProfileTransportKind::ManagedCdp,
            },
        )
        .expect("保存浏览器资料失败");
        let preset = save_browser_environment_preset(
            &conn,
            SaveBrowserEnvironmentPresetInput {
                id: None,
                name: "美区桌面".to_string(),
                description: None,
                proxy_server: None,
                timezone_id: Some("America/Los_Angeles".to_string()),
                locale: Some("en-US".to_string()),
                accept_language: Some("en-US,en;q=0.9".to_string()),
                geolocation_lat: None,
                geolocation_lng: None,
                geolocation_accuracy_m: None,
                user_agent: None,
                platform: None,
                viewport_width: Some(1440),
                viewport_height: Some(900),
                device_scale_factor: Some(2.0),
            },
        )
        .expect("保存浏览器环境预设失败");

        let payload = AutomationPayload::BrowserSession {
            profile_id: profile.id,
            profile_key: Some("shop_us".to_string()),
            url: Some("https://seller.example.com/dashboard".to_string()),
            environment_preset_id: Some(preset.id),
            target_id: None,
            open_window: false,
            stream_mode: BrowserStreamMode::Events,
        };

        validate_payload_with_conn(&conn, &payload).expect("浏览器任务负载校验失败");
    }

    #[test]
    fn validate_payload_with_conn_should_reject_missing_browser_profile() {
        let conn = setup_db();
        let payload = AutomationPayload::BrowserSession {
            profile_id: "missing-profile".to_string(),
            profile_key: Some("shop_us".to_string()),
            url: Some("https://seller.example.com/dashboard".to_string()),
            environment_preset_id: None,
            target_id: None,
            open_window: false,
            stream_mode: BrowserStreamMode::Events,
        };

        let error =
            validate_payload_with_conn(&conn, &payload).expect_err("缺失浏览器资料时应返回错误");
        assert!(error.contains("未找到可用的浏览器资料"));
    }

    #[test]
    fn build_tracker_finish_metadata_should_include_browser_payload_context() {
        let payload = AutomationPayload::BrowserSession {
            profile_id: "profile-1".to_string(),
            profile_key: Some("shop_us".to_string()),
            url: Some("https://seller.example.com/dashboard".to_string()),
            environment_preset_id: Some("preset-1".to_string()),
            target_id: Some("target-1".to_string()),
            open_window: false,
            stream_mode: BrowserStreamMode::Events,
        };
        let job = AutomationJob {
            id: "job-1".to_string(),
            name: "店铺巡检".to_string(),
            description: None,
            enabled: true,
            workspace_id: "workspace-1".to_string(),
            execution_mode: AutomationExecutionMode::Intelligent,
            schedule: TaskSchedule::Every { every_secs: 300 },
            payload: serde_json::to_value(payload).expect("序列化负载失败"),
            delivery: DeliveryConfig::default(),
            timeout_secs: None,
            max_retries: 3,
            next_run_at: None,
            last_status: None,
            last_error: None,
            last_run_at: None,
            last_finished_at: None,
            running_started_at: None,
            consecutive_failures: 0,
            last_retry_count: 0,
            auto_disabled_until: None,
            last_delivery: None,
            created_at: "2026-03-15T00:00:00Z".to_string(),
            updated_at: "2026-03-15T00:00:00Z".to_string(),
        };

        let metadata = build_tracker_finish_metadata(
            &job,
            Some("session-1"),
            "success",
            "success",
            0,
            1200,
            None,
        );

        assert_eq!(
            metadata.get("payload_kind"),
            Some(&json!("browser_session"))
        );
        assert_eq!(metadata.get("profile_key"), Some(&json!("shop_us")));
        assert_eq!(
            metadata.get("environment_preset_id"),
            Some(&json!("preset-1"))
        );
        assert_eq!(metadata.get("session_id"), Some(&json!("session-1")));
    }

    #[test]
    fn build_tracker_finish_metadata_should_include_delivery_summary() {
        let job = AutomationJob {
            id: "job-1".to_string(),
            name: "店铺巡检".to_string(),
            description: None,
            enabled: true,
            workspace_id: "workspace-1".to_string(),
            execution_mode: AutomationExecutionMode::Intelligent,
            schedule: TaskSchedule::Every { every_secs: 300 },
            payload: json!({
                "kind": "agent_turn",
                "prompt": "汇总今日异常",
                "web_search": false
            }),
            delivery: DeliveryConfig::default(),
            timeout_secs: None,
            max_retries: 3,
            next_run_at: None,
            last_status: None,
            last_error: None,
            last_run_at: None,
            last_finished_at: None,
            running_started_at: None,
            consecutive_failures: 0,
            last_retry_count: 0,
            auto_disabled_until: None,
            last_delivery: None,
            created_at: "2026-03-15T00:00:00Z".to_string(),
            updated_at: "2026-03-15T00:00:00Z".to_string(),
        };
        let last_delivery = AutomationJobLastDelivery {
            success: false,
            message: "Webhook 返回错误: 500".to_string(),
            channel: Some("webhook".to_string()),
            target: Some("https://example.com/webhook".to_string()),
            output_kind: "json".to_string(),
            output_schema: "json".to_string(),
            output_format: "json".to_string(),
            output_preview: "{\"status\":\"error\"}".to_string(),
            delivery_attempt_id: Some("dlv-run-1".to_string()),
            run_id: Some("run-1".to_string()),
            execution_retry_count: 2,
            delivery_attempts: 3,
            attempted_at: "2026-03-16T00:00:00Z".to_string(),
        };

        let metadata = build_tracker_finish_metadata(
            &job,
            None,
            "error",
            "success",
            0,
            1200,
            Some(&last_delivery),
        );

        assert_eq!(metadata.get("execution_status"), Some(&json!("success")));
        assert_eq!(
            metadata
                .get("delivery")
                .and_then(Value::as_object)
                .and_then(|delivery| delivery.get("success")),
            Some(&json!(false))
        );
        assert_eq!(
            metadata
                .get("delivery")
                .and_then(Value::as_object)
                .and_then(|delivery| delivery.get("delivery_attempt_id")),
            Some(&json!("dlv-run-1"))
        );
    }

    #[test]
    fn build_tracker_finish_metadata_should_include_agent_turn_service_skill_context() {
        let job = AutomationJob {
            id: "job-1".to_string(),
            name: "每日趋势摘要".to_string(),
            description: Some("围绕指定平台输出趋势摘要".to_string()),
            enabled: true,
            workspace_id: "workspace-1".to_string(),
            execution_mode: AutomationExecutionMode::Skill,
            schedule: TaskSchedule::Cron {
                expr: "0 9 * * *".to_string(),
                tz: Some("Asia/Shanghai".to_string()),
            },
            payload: json!({
                "kind": "agent_turn",
                "prompt": "[服务型技能] 每日趋势摘要",
                "web_search": false,
                "content_id": "content-1",
                "request_metadata": {
                    "service_skill": {
                        "id": "daily-trend-briefing",
                        "title": "每日趋势摘要",
                        "runner_type": "scheduled",
                        "execution_location": "client_default",
                        "source": "cloud_catalog",
                        "slot_values": [
                            {
                                "key": "platform",
                                "label": "监测平台",
                                "value": "小红书"
                            }
                        ],
                        "user_input": "关注增长最快的话题"
                    },
                    "harness": {
                        "theme": "social-media"
                    }
                }
            }),
            delivery: DeliveryConfig::default(),
            timeout_secs: None,
            max_retries: 3,
            next_run_at: None,
            last_status: None,
            last_error: None,
            last_run_at: None,
            last_finished_at: None,
            running_started_at: None,
            consecutive_failures: 0,
            last_retry_count: 0,
            auto_disabled_until: None,
            last_delivery: None,
            created_at: "2026-03-15T00:00:00Z".to_string(),
            updated_at: "2026-03-15T00:00:00Z".to_string(),
        };

        let metadata = build_tracker_finish_metadata(
            &job,
            Some("session-1"),
            "success",
            "success",
            0,
            1200,
            None,
        );

        assert_eq!(metadata.get("content_id"), Some(&json!("content-1")));
        assert_eq!(
            metadata.pointer("/service_skill/title"),
            Some(&json!("每日趋势摘要"))
        );
        assert_eq!(
            metadata.pointer("/service_skill/slot_values/0/label"),
            Some(&json!("监测平台"))
        );
        assert_eq!(
            metadata.pointer("/service_skill/user_input"),
            Some(&json!("关注增长最快的话题"))
        );
        assert_eq!(
            metadata.pointer("/harness/theme"),
            Some(&json!("social-media"))
        );
        assert_eq!(
            metadata.pointer("/harness/content_id"),
            Some(&json!("content-1"))
        );
    }

    #[test]
    fn build_delivery_context_should_build_stable_attempt_id_without_run_id() {
        let job = AutomationJob {
            id: "job-1".to_string(),
            name: "店铺巡检".to_string(),
            description: None,
            enabled: true,
            workspace_id: "workspace-1".to_string(),
            execution_mode: AutomationExecutionMode::Intelligent,
            schedule: TaskSchedule::Every { every_secs: 300 },
            payload: json!({
                "kind": "agent_turn",
                "prompt": "汇总今日异常",
                "web_search": false
            }),
            delivery: DeliveryConfig::default(),
            timeout_secs: None,
            max_retries: 3,
            next_run_at: None,
            last_status: None,
            last_error: None,
            last_run_at: None,
            last_finished_at: None,
            running_started_at: None,
            consecutive_failures: 0,
            last_retry_count: 0,
            auto_disabled_until: None,
            last_delivery: None,
            created_at: "2026-03-15T00:00:00Z".to_string(),
            updated_at: "2026-03-15T00:00:00Z".to_string(),
        };
        let context = build_delivery_context(&job, "2026-03-16T00:00:00Z", 2, None);
        let repeated = build_delivery_context(&job, "2026-03-16T00:00:00Z", 2, None);

        assert!(context.run_id.is_none());
        assert_eq!(context.attempt_id, repeated.attempt_id);
        assert!(context.attempt_id.starts_with("dlv-"));
        assert_eq!(context.execution_retry_count, 2);
    }

    #[test]
    fn validate_payload_should_reject_blank_agent_turn_content_id() {
        let payload = AutomationPayload::AgentTurn {
            prompt: "汇总今日异常".to_string(),
            system_prompt: None,
            web_search: false,
            request_metadata: Some(json!({
                "harness": {
                    "theme": "social-media",
                }
            })),
            content_id: Some("   ".to_string()),
        };

        assert_eq!(
            validate_payload(&payload),
            Err("自动化任务 content_id 不能为空字符串".to_string())
        );
    }

    #[test]
    fn validate_payload_should_reject_non_object_request_metadata() {
        let payload = AutomationPayload::AgentTurn {
            prompt: "汇总今日异常".to_string(),
            system_prompt: None,
            web_search: false,
            request_metadata: Some(json!(["invalid"])),
            content_id: Some("content-1".to_string()),
        };

        assert_eq!(
            validate_payload(&payload),
            Err("自动化任务 request_metadata 必须为对象".to_string())
        );
    }
}
