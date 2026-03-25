//! Skill 执行编排适配层
//!
//! prompt/workflow 纯逻辑已下沉到 `lime-agent`，
//! 本模块只保留 Tauri emitter 与错误码映射。

use lime_agent::{
    artifact_protocol::extend_unique_artifact_protocol_paths,
    execute_skill_prompt as execute_agent_skill_prompt,
    execute_skill_workflow as execute_agent_skill_workflow, AgentEvent as RuntimeAgentEvent,
    AsterAgentState, SkillEventEmitter, SkillExecutionError, SkillWorkflowExecution,
};
use lime_skills::{ExecutionCallback, LoadedSkillDefinition};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::commands::api_key_provider_cmd::ApiKeyProviderServiceState;
use crate::commands::skill_error::{
    format_skill_error, SKILL_ERR_EXECUTE_FAILED, SKILL_ERR_SESSION_INIT_FAILED,
};
use crate::config::GlobalConfigManagerState;
use crate::database::DbConnection;
use crate::services::execution_tracker_service::{ExecutionTracker, RunSource};

use super::execution_callback::TauriExecutionCallback;
use super::load_executable_skill_definition;
use super::runtime::{
    build_skill_run_finish_decision, build_skill_run_start_metadata, prepare_skill_execution,
};
use super::social_post::finalize_skill_output;

#[derive(Debug, Clone)]
pub struct SkillExecutionRequest {
    pub skill_name: String,
    pub user_input: String,
    pub provider_override: Option<String>,
    pub model_override: Option<String>,
    pub execution_id: Option<String>,
    pub session_id: Option<String>,
}

fn ensure_skill_error_code(code: &str, message: &str) -> String {
    if message.contains('|') {
        message.to_string()
    } else {
        format_skill_error(code, message)
    }
}

struct TauriExecutionCallbackAdapter<'a> {
    inner: &'a TauriExecutionCallback,
}

impl<'a> TauriExecutionCallbackAdapter<'a> {
    fn new(inner: &'a TauriExecutionCallback) -> Self {
        Self { inner }
    }
}

impl ExecutionCallback for TauriExecutionCallbackAdapter<'_> {
    fn on_step_start(
        &self,
        step_id: &str,
        step_name: &str,
        current_step: usize,
        total_steps: usize,
    ) {
        self.inner
            .on_step_start(step_id, step_name, current_step, total_steps);
    }

    fn on_step_complete(&self, step_id: &str, output: &str) {
        self.inner.on_step_complete(step_id, output);
    }

    fn on_step_error(&self, step_id: &str, error: &str, will_retry: bool) {
        self.inner.on_step_error(step_id, error, will_retry);
    }

    fn on_complete(&self, success: bool, final_output: Option<&str>, error: Option<&str>) {
        let mapped_error = if success {
            error.map(|value| value.to_string())
        } else {
            error.map(|value| ensure_skill_error_code(SKILL_ERR_EXECUTE_FAILED, value))
        };
        self.inner
            .on_complete(success, final_output, mapped_error.as_deref());
    }
}

fn create_skill_event_emitter(app_handle: &AppHandle) -> SkillEventEmitter {
    let app_handle = app_handle.clone();
    Arc::new(move |event_name: String, event: RuntimeAgentEvent| {
        if let Err(error) = app_handle.emit(&event_name, &event) {
            tracing::error!("[execute_skill_workflow] 发送事件失败: {}", error);
        }
    })
}

fn emit_skill_final_done(app_handle: &AppHandle, execution_id: &str) {
    let event_name = format!("skill-exec-{execution_id}");
    if let Err(error) = app_handle.emit(&event_name, RuntimeAgentEvent::FinalDone { usage: None }) {
        tracing::error!("[execute_skill] 发送完成事件失败: {}", error);
    }
}

fn map_execution_error(error: SkillExecutionError) -> String {
    match error {
        SkillExecutionError::SessionInitFailed(message) => {
            format_skill_error(SKILL_ERR_SESSION_INIT_FAILED, message)
        }
    }
}

fn map_execution_result(mut result: SkillExecutionResult) -> SkillExecutionResult {
    if !result.success {
        result.error = result
            .error
            .take()
            .map(|error| ensure_skill_error_code(SKILL_ERR_EXECUTE_FAILED, &error));
    }
    result
}

pub async fn execute_named_skill(
    app_handle: &AppHandle,
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderServiceState,
    config_manager: &GlobalConfigManagerState,
    aster_state: &AsterAgentState,
    request: SkillExecutionRequest,
) -> Result<SkillExecutionResult, String> {
    let SkillExecutionRequest {
        skill_name,
        user_input,
        provider_override,
        model_override,
        execution_id,
        session_id,
    } = request;

    let execution_id = execution_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let session_id = session_id.unwrap_or_else(|| format!("skill-exec-{}", Uuid::new_v4()));
    let tracker = ExecutionTracker::new(db.clone());
    let provider_selection = Arc::new(Mutex::new(None));
    let start_metadata = build_skill_run_start_metadata(
        skill_name.as_str(),
        execution_id.as_str(),
        user_input.as_str(),
        provider_override.as_deref(),
        model_override.as_deref(),
    );
    let provider_selection_for_run = Arc::clone(&provider_selection);
    let provider_selection_for_finalize = Arc::clone(&provider_selection);
    let skill_name_for_run = skill_name.clone();
    let execution_id_for_run = execution_id.clone();
    let session_id_for_run = session_id.clone();
    let user_input_for_run = user_input.clone();
    let provider_override_for_run = provider_override.clone();
    let model_override_for_run = model_override.clone();
    let skill_name_for_finalize = skill_name.clone();
    let execution_id_for_finalize = execution_id.clone();
    let provider_override_for_finalize = provider_override.clone();
    let model_override_for_finalize = model_override.clone();
    let app_handle = app_handle.clone();
    let db = db.clone();
    let api_key_provider_service = ApiKeyProviderServiceState(api_key_provider_service.0.clone());
    let config_manager = GlobalConfigManagerState(config_manager.0.clone());
    let aster_state = aster_state.clone();

    tracker
        .with_run_custom(
            RunSource::Skill,
            Some(skill_name.clone()),
            Some(session_id.clone()),
            Some(start_metadata),
            async move {
                tracing::info!(
                    "[execute_skill] 开始执行 Skill: name={}, execution_id={}, session_id={}, provider_override={:?}, model_override={:?}",
                    skill_name_for_run,
                    execution_id_for_run,
                    session_id_for_run,
                    provider_override_for_run,
                    model_override_for_run
                );

                let skill = load_executable_skill_definition(&skill_name_for_run)?;
                let prepared = prepare_skill_execution(
                    &app_handle,
                    &db,
                    &api_key_provider_service,
                    &config_manager,
                    &aster_state,
                    &skill,
                    &execution_id_for_run,
                    &session_id_for_run,
                    provider_override_for_run.as_deref(),
                    model_override_for_run.as_deref(),
                )
                .await?;

                if let Ok(mut slot) = provider_selection_for_run.lock() {
                    *slot = Some(prepared.provider_selection.clone());
                } else {
                    tracing::warn!(
                        "[execute_skill] provider 选择状态锁定失败，运行记录将缺少 resolved provider 元数据"
                    );
                }

                execute_skill_definition(
                    &app_handle,
                    &aster_state,
                    &skill,
                    &user_input_for_run,
                    &execution_id_for_run,
                    &session_id_for_run,
                    &prepared.callback,
                    prepared.memory_prompt.as_deref(),
                )
                .await
            },
            move |result| {
                let provider_selection = provider_selection_for_finalize
                    .lock()
                    .ok()
                    .and_then(|slot| slot.as_ref().cloned());
                build_skill_run_finish_decision(
                    &skill_name_for_finalize,
                    &execution_id_for_finalize,
                    provider_override_for_finalize.as_deref(),
                    model_override_for_finalize.as_deref(),
                    provider_selection.as_ref(),
                    result,
                )
            },
        )
        .await
}

pub async fn execute_skill_prompt(
    app_handle: &AppHandle,
    aster_state: &AsterAgentState,
    skill: &LoadedSkillDefinition,
    user_input: &str,
    execution_id: &str,
    session_id: &str,
    callback: &TauriExecutionCallback,
    memory_prompt: Option<&str>,
) -> Result<SkillExecutionResult, String> {
    let callback_adapter = TauriExecutionCallbackAdapter::new(callback);
    callback_adapter.on_step_start("main", &skill.display_name, 1, 1);

    let mut result = map_execution_result(
        execute_agent_skill_prompt(
            aster_state,
            skill,
            user_input,
            execution_id,
            session_id,
            memory_prompt,
            create_skill_event_emitter(app_handle),
        )
        .await
        .map_err(map_execution_error)?,
    );

    if !result.success {
        let error_message = result
            .error
            .clone()
            .unwrap_or_else(|| format_skill_error(SKILL_ERR_EXECUTE_FAILED, "Unknown error"));
        callback_adapter.on_step_error("main", &error_message, false);
        callback_adapter.on_complete(false, None, Some(&error_message));
        emit_skill_final_done(app_handle, execution_id);
        return Ok(result);
    }

    let finalized = finalize_skill_output(
        app_handle,
        &skill.skill_name,
        user_input,
        execution_id,
        result.output.as_deref().unwrap_or(""),
    );
    extend_unique_artifact_protocol_paths(&mut result.artifact_paths, &finalized.artifact_paths);
    result.output = Some(finalized.final_output.clone());
    if let Some(step_result) = result.steps_completed.get_mut(0) {
        step_result.output = Some(finalized.final_output.clone());
    }

    callback_adapter.on_step_complete("main", &finalized.final_output);
    callback_adapter.on_complete(true, Some(&finalized.final_output), None);
    emit_skill_final_done(app_handle, execution_id);
    Ok(result)
}

pub async fn execute_skill_workflow(
    app_handle: &AppHandle,
    aster_state: &AsterAgentState,
    skill: &LoadedSkillDefinition,
    user_input: &str,
    execution_id: &str,
    session_id: &str,
    callback: &TauriExecutionCallback,
    memory_prompt: Option<&str>,
) -> Result<SkillExecutionResult, String> {
    let callback_adapter = TauriExecutionCallbackAdapter::new(callback);
    execute_agent_skill_workflow(SkillWorkflowExecution {
        aster_state,
        skill,
        user_input,
        execution_id,
        session_id,
        callback: &callback_adapter,
        memory_prompt,
        emitter: create_skill_event_emitter(app_handle),
    })
    .await
    .map(map_execution_result)
    .map_err(map_execution_error)
}

pub async fn execute_skill_definition(
    app_handle: &AppHandle,
    aster_state: &AsterAgentState,
    skill: &LoadedSkillDefinition,
    user_input: &str,
    execution_id: &str,
    session_id: &str,
    callback: &TauriExecutionCallback,
    memory_prompt: Option<&str>,
) -> Result<SkillExecutionResult, String> {
    if skill.execution_mode == "workflow" && !skill.workflow_steps.is_empty() {
        execute_skill_workflow(
            app_handle,
            aster_state,
            skill,
            user_input,
            execution_id,
            session_id,
            callback,
            memory_prompt,
        )
        .await
    } else {
        execute_skill_prompt(
            app_handle,
            aster_state,
            skill,
            user_input,
            execution_id,
            session_id,
            callback,
            memory_prompt,
        )
        .await
    }
}

pub use lime_agent::{SkillExecutionResult, StepResult};
