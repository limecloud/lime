use super::request_context::RuntimeSessionScope;
use crate::{AppDataSource, ExecutionRequest, RuntimeCoreError, RuntimeEventSink};
mod events;
mod intent;
mod presentation;
#[cfg(test)]
mod tests;
use events::{
    emit_assistant_intro, emit_create_failed, emit_create_failed_after_tool_started,
    emit_intent_accepted, emit_parameter_required, emit_planning_summary,
    emit_presentation_generated, emit_task_created, emit_task_created_turn_completed,
    emit_tool_started, emit_workflow_run_completed, emit_workflow_run_started,
    emit_workflow_step_completed, emit_workflow_step_started, tool_call_id, workflow_run_id,
};
use intent::{parse_image_command_intent, ImageCommandIntent};

#[cfg(test)]
use crate::RuntimeEvent;
#[cfg(test)]
use agent_protocol::{ItemStatus, ThreadItem, ThreadItemPayload};
#[cfg(test)]
use app_server_protocol::{MediaTaskArtifactImageCreateParams, MediaTaskArtifactResponse};
#[cfg(test)]
use lime_agent::{agent_tools::catalog::LIME_CREATE_IMAGE_TASK_TOOL_NAME, AgentTokenUsage};
#[cfg(test)]
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::time::{timeout, Duration};

// Presentation is part of the user-visible turn. Live text providers can take
// longer than a few seconds on cold start or queueing, so keep this above the
// media task handoff fast path budget instead of dropping the assistant lead.
const PRESENTATION_GENERATION_TIMEOUT: Duration = Duration::from_secs(45);

pub(super) fn is_image_command_turn(
    request: &ExecutionRequest,
    scope: &RuntimeSessionScope,
) -> Result<bool, RuntimeCoreError> {
    Ok(parse_image_command_intent(request, scope)?.is_some())
}

pub(super) async fn handle_image_command_turn_if_present(
    runtime_backend: Option<&super::RuntimeBackend>,
    request: &ExecutionRequest,
    scope: &RuntimeSessionScope,
    app_data_source: Option<Arc<dyn AppDataSource>>,
    sink: &mut dyn RuntimeEventSink,
) -> Result<bool, RuntimeCoreError> {
    let Some(mut intent) = parse_image_command_intent(request, scope)? else {
        return Ok(false);
    };

    tracing::info!(
        session_id = %intent.scope.session_id,
        thread_id = %intent.scope.thread_id,
        turn_id = %intent.scope.turn_id,
        workflow_run_id = %workflow_run_id(&intent.scope),
        entry_source = ?intent.entry_source,
        provider_id = ?intent.provider_id,
        model = ?intent.model,
        "[RuntimeBackend] ImageCommandWorkflow accepted"
    );
    emit_workflow_run_started(&intent, sink)?;
    emit_intent_accepted(&intent, sink)?;
    emit_workflow_step_completed(&intent, "intent", "解析图片需求", "accepted", None, sink)?;

    if let Some(missing) = intent.missing_parameters() {
        emit_parameter_required(&intent, missing, sink)?;
        return Ok(true);
    }

    let Some(app_data_source) = app_data_source else {
        emit_create_failed(
            &intent,
            "app_data_source_unavailable",
            "App Server image command workflow requires AppDataSource",
            sink,
        )?;
        return Ok(true);
    };

    if let Some(existing_presentation) = presentation::normalize_existing_presentation(&intent) {
        apply_generated_presentation(&mut intent, existing_presentation, sink)?;
    } else if let Some(runtime_backend) = runtime_backend {
        match timeout(
            PRESENTATION_GENERATION_TIMEOUT,
            presentation::generate_image_task_presentation(runtime_backend, request, &intent),
        )
        .await
        {
            Ok(Ok(Some(generated_presentation))) => {
                apply_generated_presentation(&mut intent, generated_presentation, sink)?;
            }
            Ok(Ok(None)) => {
                emit_create_failed(
                    &intent,
                    "image_task_presentation_empty",
                    "Image command presentation returned empty or invalid model output",
                    sink,
                )?;
                return Ok(true);
            }
            Ok(Err(error)) => {
                let reason_code = presentation_failure_reason_code(&error);
                tracing::warn!(
                    session_id = %intent.scope.session_id,
                    thread_id = %intent.scope.thread_id,
                    turn_id = %intent.scope.turn_id,
                    workflow_run_id = %workflow_run_id(&intent.scope),
                    reason_code = reason_code,
                    error = %error,
                    "[RuntimeBackend] ImageCommandWorkflow presentation generation failed"
                );
                emit_create_failed(&intent, reason_code, &error.to_string(), sink)?;
                return Ok(true);
            }
            Err(_) => {
                tracing::warn!(
                    session_id = %intent.scope.session_id,
                    thread_id = %intent.scope.thread_id,
                    turn_id = %intent.scope.turn_id,
                    workflow_run_id = %workflow_run_id(&intent.scope),
                    timeout_ms = PRESENTATION_GENERATION_TIMEOUT.as_millis(),
                    "[RuntimeBackend] ImageCommandWorkflow presentation generation timed out"
                );
                emit_create_failed(
                    &intent,
                    "image_task_presentation_timeout",
                    "Image command presentation generation timed out",
                    sink,
                )?;
                return Ok(true);
            }
        }
    } else {
        emit_create_failed(
            &intent,
            "image_task_presentation_runtime_unavailable",
            "Image command presentation generation skipped because runtime backend is unavailable",
            sink,
        )?;
        return Ok(true);
    }

    let tool_call_id = tool_call_id(scope);
    let create_params = intent.clone().into_create_params();
    let tool_started_at_ms = chrono::Utc::now().timestamp_millis();
    emit_workflow_step_started(&intent, "create_tasks", "创建图片任务", None, sink)?;
    emit_tool_started(
        scope,
        &tool_call_id,
        &create_params,
        tool_started_at_ms,
        sink,
    )?;
    match app_data_source
        .create_image_media_task_artifact(create_params.clone())
        .await
    {
        Ok(response) => {
            let task_id = response.task_id.clone();
            let artifact_path = response.artifact_path.clone();
            emit_task_created(
                scope,
                &tool_call_id,
                &create_params,
                tool_started_at_ms,
                response,
                sink,
            )?;
            tracing::info!(
                session_id = %intent.scope.session_id,
                thread_id = %intent.scope.thread_id,
                turn_id = %intent.scope.turn_id,
                workflow_run_id = %workflow_run_id(&intent.scope),
                task_id = %task_id,
                "[RuntimeBackend] ImageCommandWorkflow task created"
            );
            emit_workflow_step_completed(
                &intent,
                "create_tasks",
                "创建图片任务",
                "task_created",
                Some(&task_id),
                sink,
            )?;
            emit_workflow_run_completed(&intent, "task_created", Some(&task_id), sink)?;
            emit_task_created_turn_completed(
                &task_id,
                &artifact_path,
                intent.presentation_usage.as_ref(),
                sink,
            )?;
        }
        Err(error) => {
            emit_create_failed_after_tool_started(
                &intent,
                &tool_call_id,
                &create_params,
                tool_started_at_ms,
                "image_task_create_failed",
                &error.to_string(),
                sink,
            )?;
        }
    }
    Ok(true)
}

fn apply_generated_presentation(
    intent: &mut ImageCommandIntent,
    generated_presentation: presentation::GeneratedImageTaskPresentation,
    sink: &mut dyn RuntimeEventSink,
) -> Result<(), RuntimeCoreError> {
    let presentation_usage = generated_presentation.usage.clone();
    if let Some(planning_summary) = generated_presentation.planning_summary.as_deref() {
        emit_planning_summary(intent, planning_summary, sink)?;
    }
    if let Some(assistant_intro) = generated_presentation.assistant_intro.as_deref() {
        emit_assistant_intro(intent, assistant_intro, sink)?;
    }
    emit_presentation_generated(intent, &generated_presentation, sink)?;
    intent.presentation = presentation::merge_generated_presentation(
        intent.presentation.take(),
        &generated_presentation,
    );
    intent.presentation_usage = presentation_usage;
    Ok(())
}

fn presentation_failure_reason_code(error: &RuntimeCoreError) -> &'static str {
    let message = error.to_string();
    if message.contains("presentation_text_model_unavailable") {
        return "image_task_presentation_text_model_unavailable";
    }
    if message.contains("presentation_text_route_unavailable") {
        return "image_task_presentation_text_route_unavailable";
    }
    "image_task_presentation_failed"
}
