//! 自动化任务执行器
//!
//! 负责把结构化自动化任务映射到 Aster 执行链路。

use super::{AutomationJobRecord, AutomationPayload};
use crate::agent::AsterAgentWrapper;
use crate::app::AppState;
use crate::commands::api_key_provider_cmd::ApiKeyProviderServiceState;
use crate::commands::aster_agent_cmd::{
    build_queued_turn_task, build_runtime_queue_executor, AsterChatRequest,
};
use crate::commands::browser_runtime_cmd::{
    launch_browser_session_with_db, LaunchBrowserSessionRequest,
};
use crate::config::GlobalConfigManagerState;
use crate::database::DbConnection;
use crate::mcp::McpManagerState;
use crate::services::automation_service::AutomationServiceState;
use crate::services::workspace_health_service::ensure_workspace_ready_with_auto_relocate;
use crate::workspace::WorkspaceManager;
use crate::LogState;
use chrono::Utc;
use lime_browser_runtime::CdpSessionState;
use serde_json::{json, Map, Value};
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
        lime_core::config::AutomationExecutionMode::LogOnly => Ok(JobExecutionResult {
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
        lime_core::config::AutomationExecutionMode::Intelligent
        | lime_core::config::AutomationExecutionMode::Skill => {
            let payload = serde_json::from_value::<AutomationPayload>(job.payload.clone())
                .map_err(|e| format!("解析自动化任务负载失败: {e}"))?;
            match payload {
                AutomationPayload::AgentTurn {
                    prompt,
                    system_prompt,
                    web_search,
                    request_metadata,
                    content_id,
                } => {
                    execute_agent_turn(
                        job,
                        db,
                        app_handle,
                        prompt,
                        system_prompt,
                        web_search,
                        request_metadata,
                        content_id,
                    )
                    .await
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
    request_metadata: Option<Value>,
    content_id: Option<String>,
) -> Result<JobExecutionResult, String> {
    let app = app_handle
        .as_ref()
        .ok_or_else(|| "应用句柄不可用，无法执行自动化任务".to_string())?;
    let prompt = build_prompt(job, &prompt, web_search);

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
        .try_state::<crate::agent::AsterAgentState>()
        .ok_or_else(|| "AsterAgentState 未初始化".to_string())?;
    let api_key_provider_service = app
        .try_state::<ApiKeyProviderServiceState>()
        .ok_or_else(|| "ApiKeyProviderServiceState 未初始化".to_string())?;
    let logs = app
        .try_state::<LogState>()
        .ok_or_else(|| "LogState 未初始化".to_string())?;
    let config_manager = app
        .try_state::<GlobalConfigManagerState>()
        .ok_or_else(|| "GlobalConfigManagerState 未初始化".to_string())?;
    let mcp_manager = app
        .try_state::<McpManagerState>()
        .ok_or_else(|| "McpManagerState 未初始化".to_string())?;
    let automation_state = app
        .try_state::<AutomationServiceState>()
        .ok_or_else(|| "AutomationServiceState 未初始化".to_string())?;
    let event_name = format!("automation:agent:{}:{}", job.id, Utc::now().timestamp());
    let runtime_request = AsterChatRequest {
        message: prompt,
        session_id: session_id.clone(),
        event_name,
        images: None,
        provider_config: None,
        provider_preference: None,
        model_preference: None,
        thinking_enabled: None,
        project_id: None,
        workspace_id: job.workspace_id.clone(),
        web_search: Some(web_search),
        search_mode: None,
        execution_strategy: None,
        auto_continue: None,
        system_prompt,
        metadata: normalize_agent_turn_request_metadata(request_metadata, content_id.clone()),
        turn_id: None,
        queue_if_busy: Some(false),
        queued_turn_id: None,
    };
    let queued_task = build_queued_turn_task(runtime_request)?;
    crate::agent::runtime_queue_service::submit_runtime_turn(
        app.clone(),
        agent_state.inner(),
        db,
        api_key_provider_service.inner(),
        logs.inner(),
        config_manager.inner(),
        mcp_manager.inner(),
        automation_state.inner(),
        queued_task,
        false,
        build_runtime_queue_executor(),
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
            "content_id": content_id,
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

fn build_prompt(job: &AutomationJobRecord, prompt: &str, web_search: bool) -> String {
    let mut sections = vec![
        "你是一个自动化任务执行助手。".to_string(),
        format!("任务名称：{}", job.name),
        format!("任务描述：{}", job.description.clone().unwrap_or_default()),
        format!("工作区 ID：{}", job.workspace_id),
    ];
    if web_search {
        sections.push("允许按需使用 WebSearch。".to_string());
    }
    sections.push("请执行以下自动化任务：".to_string());
    sections.push(prompt.trim().to_string());
    sections.join("\n\n")
}

fn normalize_agent_turn_request_metadata(
    request_metadata: Option<Value>,
    content_id: Option<String>,
) -> Option<Value> {
    let normalized_content_id = content_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    if request_metadata.is_none() && normalized_content_id.is_none() {
        return None;
    }

    let mut root = match request_metadata {
        Some(Value::Object(object)) => object,
        Some(other) => {
            let mut object = Map::new();
            object.insert("request_metadata".to_string(), other);
            object
        }
        None => Map::new(),
    };

    if let Some(content_id) = normalized_content_id {
        let harness_entry = root
            .entry("harness".to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        if !harness_entry.is_object() {
            *harness_entry = Value::Object(Map::new());
        }
        if let Some(harness) = harness_entry.as_object_mut() {
            harness.insert("content_id".to_string(), Value::String(content_id));
        }
    }

    Some(Value::Object(root))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn normalize_agent_turn_request_metadata_should_attach_content_id_to_harness() {
        let normalized = normalize_agent_turn_request_metadata(
            Some(json!({
                "artifact": {
                    "artifact_mode": "draft",
                    "artifact_kind": "analysis"
                }
            })),
            Some("content-1".to_string()),
        )
        .expect("normalized metadata");

        assert_eq!(
            normalized
                .pointer("/harness/content_id")
                .and_then(Value::as_str),
            Some("content-1")
        );
        assert_eq!(
            normalized
                .pointer("/artifact/artifact_kind")
                .and_then(Value::as_str),
            Some("analysis")
        );
    }

    #[test]
    fn normalize_agent_turn_request_metadata_should_create_minimal_harness_when_only_content_id_exists(
    ) {
        let normalized = normalize_agent_turn_request_metadata(None, Some("content-2".to_string()))
            .expect("normalized metadata");

        assert_eq!(
            normalized
                .pointer("/harness/content_id")
                .and_then(Value::as_str),
            Some("content-2")
        );
    }
}
