//! 自动化任务命令

use crate::app::AppState;
use crate::config::GlobalConfigManagerState;
use crate::database::{lock_db, DbConnection};
use crate::services::automation_service::health::{
    query_automation_health, AutomationHealthQuery, AutomationHealthResult,
};
use crate::services::automation_service::schedule::{
    preview_next_run as preview_next_run_for_schedule, validate_schedule as validate_schedule_value,
};
use crate::services::automation_service::{
    AutomationCycleResult, AutomationJobDraft, AutomationJobRecord, AutomationJobUpdate,
    AutomationPayload, AutomationServiceState, AutomationStatus,
};
use lime_core::config::{AutomationExecutionMode, DeliveryConfig, TaskSchedule};
use lime_core::database::dao::agent_run::AgentRun;
use lime_core::database::dao::automation_job::AutomationJobDao;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationSchedulerConfigResponse {
    pub enabled: bool,
    pub poll_interval_secs: u64,
    pub enable_history: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationJobRequest {
    pub name: String,
    pub description: Option<String>,
    pub enabled: Option<bool>,
    pub workspace_id: String,
    pub execution_mode: Option<AutomationExecutionMode>,
    pub schedule: TaskSchedule,
    pub payload: AutomationPayload,
    pub delivery: Option<DeliveryConfig>,
    pub timeout_secs: Option<u64>,
    pub max_retries: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpdateAutomationJobRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub enabled: Option<bool>,
    pub workspace_id: Option<String>,
    pub execution_mode: Option<AutomationExecutionMode>,
    pub schedule: Option<TaskSchedule>,
    pub payload: Option<AutomationPayload>,
    pub delivery: Option<DeliveryConfig>,
    pub timeout_secs: Option<u64>,
    pub clear_timeout_secs: Option<bool>,
    pub max_retries: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleValidationResult {
    pub valid: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn get_automation_scheduler_config(
    config_manager: State<'_, GlobalConfigManagerState>,
) -> Result<AutomationSchedulerConfigResponse, String> {
    let config = config_manager.0.config();
    Ok(AutomationSchedulerConfigResponse {
        enabled: config.automation.enabled,
        poll_interval_secs: config.automation.poll_interval_secs,
        enable_history: config.automation.enable_history,
    })
}

#[tauri::command]
pub async fn update_automation_scheduler_config(
    state: State<'_, AppState>,
    config_manager: State<'_, GlobalConfigManagerState>,
    automation_state: State<'_, AutomationServiceState>,
    config: AutomationSchedulerConfigResponse,
    app: AppHandle,
) -> Result<(), String> {
    let was_enabled = {
        let state = state.read().await;
        state.config.automation.enabled
    };

    let next_config = {
        let mut state = state.write().await;
        state.config.automation.enabled = config.enabled;
        state.config.automation.poll_interval_secs = config.poll_interval_secs.max(5);
        state.config.automation.enable_history = config.enable_history;
        state.config.clone()
    };
    config_manager.0.save_config(&next_config).await?;

    let new_config = next_config.automation.clone();
    let mut service = automation_state.0.write().await;
    service.update_config(new_config);
    service.set_app_handle(app);
    let self_ref = automation_state.0.clone();
    if config.enabled && !was_enabled {
        service.start(self_ref).await?;
    } else if !config.enabled && was_enabled {
        service.stop().await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_automation_status(
    automation_state: State<'_, AutomationServiceState>,
) -> Result<AutomationStatus, String> {
    Ok(automation_state.1.read().clone())
}

#[tauri::command]
pub async fn get_automation_jobs(
    db: State<'_, DbConnection>,
) -> Result<Vec<AutomationJobRecord>, String> {
    let conn = lock_db(db.inner())?;
    AutomationJobDao::list(&conn).map_err(|e| format!("查询自动化任务失败: {e}"))
}

#[tauri::command]
pub async fn get_automation_job(
    db: State<'_, DbConnection>,
    id: String,
) -> Result<Option<AutomationJobRecord>, String> {
    let conn = lock_db(db.inner())?;
    AutomationJobDao::get(&conn, id.trim()).map_err(|e| format!("查询自动化任务失败: {e}"))
}

#[tauri::command]
pub async fn create_automation_job(
    automation_state: State<'_, AutomationServiceState>,
    request: AutomationJobRequest,
) -> Result<AutomationJobRecord, String> {
    let service = automation_state.0.read().await;
    service.create_job(AutomationJobDraft {
        name: request.name,
        description: request.description,
        enabled: request.enabled.unwrap_or(true),
        workspace_id: request.workspace_id,
        execution_mode: request
            .execution_mode
            .unwrap_or(AutomationExecutionMode::Intelligent),
        schedule: request.schedule,
        payload: request.payload,
        delivery: request.delivery.unwrap_or_default(),
        timeout_secs: request.timeout_secs,
        max_retries: request.max_retries.unwrap_or(3),
    })
}

#[tauri::command]
pub async fn update_automation_job(
    automation_state: State<'_, AutomationServiceState>,
    id: String,
    request: UpdateAutomationJobRequest,
) -> Result<AutomationJobRecord, String> {
    let service = automation_state.0.read().await;
    service.update_job(
        id.trim(),
        AutomationJobUpdate {
            name: request.name,
            description: request.description,
            enabled: request.enabled,
            workspace_id: request.workspace_id,
            execution_mode: request.execution_mode,
            schedule: request.schedule,
            payload: request.payload,
            delivery: request.delivery,
            timeout_secs: if request.clear_timeout_secs.unwrap_or(false) {
                Some(None)
            } else {
                request.timeout_secs.map(Some)
            },
            max_retries: request.max_retries,
        },
    )
}

#[tauri::command]
pub async fn delete_automation_job(
    automation_state: State<'_, AutomationServiceState>,
    id: String,
) -> Result<bool, String> {
    let service = automation_state.0.read().await;
    service.delete_job(id.trim())
}

#[tauri::command]
pub async fn run_automation_job_now(
    automation_state: State<'_, AutomationServiceState>,
    id: String,
) -> Result<AutomationCycleResult, String> {
    let service = automation_state.0.read().await;
    service.run_job_now(id.trim()).await
}

#[tauri::command]
pub async fn get_automation_health(
    db: State<'_, DbConnection>,
    query: Option<AutomationHealthQuery>,
) -> Result<AutomationHealthResult, String> {
    query_automation_health(db.inner(), query)
}

#[tauri::command]
pub async fn get_automation_run_history(
    db: State<'_, DbConnection>,
    id: String,
    limit: Option<usize>,
) -> Result<Vec<AgentRun>, String> {
    let conn = lock_db(db.inner())?;
    lime_core::database::dao::agent_run::AgentRunDao::list_runs_by_source_ref(
        &conn,
        "automation",
        id.trim(),
        limit.unwrap_or(20),
    )
    .map_err(|e| format!("查询自动化运行历史失败: {e}"))
}

#[tauri::command]
pub async fn preview_automation_schedule(schedule: TaskSchedule) -> Result<Option<String>, String> {
    preview_next_run_for_schedule(&schedule).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn validate_automation_schedule(
    schedule: TaskSchedule,
) -> Result<ScheduleValidationResult, String> {
    match validate_schedule_value(&schedule, chrono::Utc::now()) {
        Ok(()) => Ok(ScheduleValidationResult {
            valid: true,
            error: None,
        }),
        Err(error) => Ok(ScheduleValidationResult {
            valid: false,
            error: Some(error.to_string()),
        }),
    }
}
