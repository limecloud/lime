//! 自动化任务执行器
//!
//! 负责把结构化自动化任务映射到 Aster 执行链路。

use super::{AutomationJobRecord, AutomationPayload};
use crate::agent::{AsterAgentState, AsterAgentWrapper};
use crate::app::AppState;
use crate::commands::browser_runtime_cmd::{
    launch_browser_session_with_db, LaunchBrowserSessionRequest,
};
use crate::database::DbConnection;
use crate::services::workspace_health_service::ensure_workspace_ready_with_auto_relocate;
use crate::workspace::WorkspaceManager;
use chrono::Utc;
use proxycast_browser_runtime::CdpSessionState;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

#[derive(Debug)]
pub struct JobExecutionResult {
    pub output: String,
    pub output_data: Option<Value>,
    pub session_id: Option<String>,
    pub browser_session: Option<CdpSessionState>,
}

pub async fn execute_job(
    job: &AutomationJobRecord,
    db: &DbConnection,
    app_handle: &Option<AppHandle>,
) -> Result<JobExecutionResult, String> {
    match job.execution_mode {
        proxycast_core::config::AutomationExecutionMode::LogOnly => Ok(JobExecutionResult {
            output: "Log only mode".to_string(),
            output_data: Some(json!({
                "kind": "log_only",
                "job_id": job.id.clone(),
                "job_name": job.name.clone(),
                "workspace_id": job.workspace_id.clone(),
            })),
            session_id: None,
            browser_session: None,
        }),
        proxycast_core::config::AutomationExecutionMode::Intelligent
        | proxycast_core::config::AutomationExecutionMode::Skill => {
            let payload = serde_json::from_value::<AutomationPayload>(job.payload.clone())
                .map_err(|e| format!("解析自动化任务负载失败: {e}"))?;
            match payload {
                AutomationPayload::AgentTurn {
                    prompt,
                    system_prompt,
                    web_search,
                } => {
                    execute_agent_turn(job, db, app_handle, prompt, system_prompt, web_search).await
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
                    execute_browser_session(
                        job,
                        db,
                        app_handle,
                        LaunchBrowserSessionRequest {
                            profile_id: Some(profile_id),
                            profile_key,
                            url,
                            environment_preset_id,
                            environment: None,
                            target_id,
                            open_window,
                            stream_mode,
                        },
                    )
                    .await
                }
            }
        }
    }
}

async fn execute_agent_turn(
    job: &AutomationJobRecord,
    db: &DbConnection,
    app_handle: &Option<AppHandle>,
    prompt: String,
    system_prompt: Option<String>,
    web_search: bool,
) -> Result<JobExecutionResult, String> {
    let app = app_handle
        .as_ref()
        .ok_or_else(|| "应用句柄不可用，无法执行自动化任务".to_string())?;
    let prompt = build_prompt(job, &prompt, system_prompt.as_deref(), web_search);

    let workspace_manager = WorkspaceManager::new(db.clone());
    let workspace = workspace_manager
        .get(&job.workspace_id)
        .map_err(|e| format!("读取 workspace 失败: {e}"))?
        .ok_or_else(|| format!("Workspace 不存在: {}", job.workspace_id))?;
    let ensured = ensure_workspace_ready_with_auto_relocate(&workspace_manager, &workspace)?;
    let workspace_root = ensured.root_path.to_string_lossy().to_string();

    let session_name = format!("[自动化] {}", job.name);
    let session_id = AsterAgentWrapper::create_session_sync(
        db,
        Some(session_name),
        Some(workspace_root),
        job.workspace_id.clone(),
        Some("auto".to_string()),
    )?;

    let agent_state = app
        .try_state::<AsterAgentState>()
        .ok_or_else(|| "AsterAgentState 未初始化".to_string())?;
    let event_name = format!("automation:agent:{}:{}", job.id, Utc::now().timestamp());
    AsterAgentWrapper::send_message(
        &agent_state,
        db,
        app,
        prompt,
        session_id.clone(),
        event_name,
    )
    .await?;

    Ok(JobExecutionResult {
        output: "Agent 执行完成".to_string(),
        output_data: Some(json!({
            "kind": "agent_turn",
            "job_id": job.id.clone(),
            "job_name": job.name.clone(),
            "workspace_id": job.workspace_id.clone(),
            "session_id": session_id.clone(),
            "status": "success",
        })),
        session_id: Some(session_id),
        browser_session: None,
    })
}

async fn execute_browser_session(
    job: &AutomationJobRecord,
    db: &DbConnection,
    app_handle: &Option<AppHandle>,
    request: LaunchBrowserSessionRequest,
) -> Result<JobExecutionResult, String> {
    let app = app_handle
        .as_ref()
        .ok_or_else(|| "应用句柄不可用，无法执行浏览器自动化任务".to_string())?;
    let app_state = app
        .try_state::<AppState>()
        .ok_or_else(|| "AppState 未初始化，无法执行浏览器自动化任务".to_string())?;
    let app_state = app_state.inner().clone();

    let response =
        launch_browser_session_with_db(app.clone(), app_state, db.clone(), request).await?;
    let session_id = response.session.session_id.clone();
    Ok(JobExecutionResult {
        output: format!("浏览器任务已启动: {} -> {}", job.name, session_id),
        output_data: Some(json!({
            "kind": "browser_session",
            "job_id": job.id.clone(),
            "job_name": job.name.clone(),
            "workspace_id": job.workspace_id.clone(),
            "session_id": response.session.session_id.clone(),
            "profile_key": response.session.profile_key.clone(),
            "environment_preset_id": response.session.environment_preset_id.clone(),
            "environment_preset_name": response.session.environment_preset_name.clone(),
            "target_id": response.session.target_id.clone(),
            "target_title": response.session.target_title.clone(),
            "target_url": response.session.target_url.clone(),
            "lifecycle_state": response.session.lifecycle_state,
            "control_mode": response.session.control_mode,
            "remote_debugging_port": response.session.remote_debugging_port,
            "ws_debugger_url": response.session.ws_debugger_url.clone(),
        })),
        session_id: Some(session_id),
        browser_session: Some(response.session),
    })
}

fn build_prompt(
    job: &AutomationJobRecord,
    prompt: &str,
    system_prompt: Option<&str>,
    web_search: bool,
) -> String {
    let mut sections = vec![
        "你是一个自动化任务执行助手。".to_string(),
        format!("任务名称：{}", job.name),
        format!("任务描述：{}", job.description.clone().unwrap_or_default()),
        format!("工作区 ID：{}", job.workspace_id),
    ];
    if let Some(system_prompt) = system_prompt {
        let trimmed = system_prompt.trim();
        if !trimmed.is_empty() {
            sections.push(format!("附加系统指令：{trimmed}"));
        }
    }
    if web_search {
        sections.push("允许按需使用 WebSearch。".to_string());
    }
    sections.push("请执行以下自动化任务：".to_string());
    sections.push(prompt.trim().to_string());
    sections.join("\n\n")
}
