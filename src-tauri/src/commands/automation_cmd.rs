//! 自动化任务命令

use crate::app::AppState;
use crate::services::automation_service::health::{AutomationHealthQuery, AutomationHealthResult};
use crate::services::automation_service::schedule::{
    preview_next_run as preview_next_run_for_schedule, validate_schedule as validate_schedule_value,
};
use crate::services::automation_service::{
    AutomationCycleResult, AutomationJobDraft, AutomationJobRecord, AutomationJobUpdate,
    AutomationPayload, AutomationServiceState, AutomationStatus,
};
use proxycast_core::config::{AutomationExecutionMode, DeliveryConfig, TaskSchedule};
use proxycast_core::database::dao::agent_run::AgentRun;
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
    state: State<'_, AppState>,
) -> Result<AutomationSchedulerConfigResponse, String> {
    let state = state.read().await;
    Ok(AutomationSchedulerConfigResponse {
        enabled: state.config.automation.enabled,
        poll_interval_secs: state.config.automation.poll_interval_secs,
        enable_history: state.config.automation.enable_history,
    })
}

#[tauri::command]
pub async fn update_automation_scheduler_config(
    state: State<'_, AppState>,
    automation_state: State<'_, AutomationServiceState>,
    config: AutomationSchedulerConfigResponse,
    app: AppHandle,
) -> Result<(), String> {
    let was_enabled = {
        let state = state.read().await;
        state.config.automation.enabled
    };

    {
        let mut state = state.write().await;
        state.config.automation.enabled = config.enabled;
        state.config.automation.poll_interval_secs = config.poll_interval_secs.max(5);
        state.config.automation.enable_history = config.enable_history;
        crate::config::save_config(&state.config).map_err(|e| e.to_string())?;
    }

    let new_config = {
        let state = state.read().await;
        state.config.automation.clone()
    };
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
    let service = automation_state.0.read().await;
    Ok(service.get_status())
}

#[tauri::command]
pub async fn get_automation_jobs(
    automation_state: State<'_, AutomationServiceState>,
) -> Result<Vec<AutomationJobRecord>, String> {
    let service = automation_state.0.read().await;
    service.list_jobs()
}

#[tauri::command]
pub async fn get_automation_job(
    automation_state: State<'_, AutomationServiceState>,
    id: String,
) -> Result<Option<AutomationJobRecord>, String> {
    let service = automation_state.0.read().await;
    service.get_job(id.trim())
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
    automation_state: State<'_, AutomationServiceState>,
    query: Option<AutomationHealthQuery>,
) -> Result<AutomationHealthResult, String> {
    let service = automation_state.0.read().await;
    service.get_health(query)
}

#[tauri::command]
pub async fn get_automation_run_history(
    automation_state: State<'_, AutomationServiceState>,
    id: String,
    limit: Option<usize>,
) -> Result<Vec<AgentRun>, String> {
    let service = automation_state.0.read().await;
    service.get_job_runs(id.trim(), limit.unwrap_or(20))
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
