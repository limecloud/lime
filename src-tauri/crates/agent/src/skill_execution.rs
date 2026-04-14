use crate::protocol::AgentEvent as RuntimeAgentEvent;
use crate::{
    artifact_protocol::{
        extend_unique_artifact_protocol_paths, push_unique_artifact_protocol_path,
    },
    protocol_projection::project_runtime_event,
    AsterAgentState, SessionConfigBuilder, WriteArtifactEventEmitter,
};
use aster::agents::SessionConfig;
use aster::conversation::message::Message;
use futures::StreamExt;
use lime_skills::{ExecutionCallback, LoadedSkillDefinition};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

pub type SkillEventEmitter = Arc<dyn Fn(String, RuntimeAgentEvent) + Send + Sync + 'static>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepResult {
    pub step_id: String,
    pub step_name: String,
    pub success: bool,
    pub output: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillInputImage {
    pub data: String,
    #[serde(alias = "mediaType")]
    pub media_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillExecutionResult {
    pub success: bool,
    pub output: Option<String>,
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub artifact_paths: Vec<String>,
    pub steps_completed: Vec<StepResult>,
}

pub struct SkillWorkflowExecution<'a> {
    pub aster_state: &'a AsterAgentState,
    pub skill: &'a LoadedSkillDefinition,
    pub user_input: &'a str,
    pub images: &'a [SkillInputImage],
    pub execution_id: &'a str,
    pub session_id: &'a str,
    pub callback: &'a dyn ExecutionCallback,
    pub memory_prompt: Option<&'a str>,
    pub emitter: SkillEventEmitter,
}

pub struct SkillPromptExecution<'a> {
    pub aster_state: &'a AsterAgentState,
    pub skill: &'a LoadedSkillDefinition,
    pub user_input: &'a str,
    pub images: &'a [SkillInputImage],
    pub execution_id: &'a str,
    pub session_id: &'a str,
    pub memory_prompt: Option<&'a str>,
    pub emitter: SkillEventEmitter,
}

#[derive(Debug, Clone)]
pub enum SkillExecutionError {
    SessionInitFailed(String),
}

impl std::fmt::Display for SkillExecutionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SessionInitFailed(message) => write!(f, "{message}"),
        }
    }
}

impl std::error::Error for SkillExecutionError {}

struct StreamedSkillReply {
    output: String,
    error: Option<String>,
    artifact_paths: Vec<String>,
}

fn emit_skill_event(emitter: &SkillEventEmitter, event_name: &str, event: RuntimeAgentEvent) {
    emitter(event_name.to_string(), event);
}

fn collect_artifact_path_from_event(target: &mut Vec<String>, event: &RuntimeAgentEvent) {
    if let RuntimeAgentEvent::ArtifactSnapshot { artifact } = event {
        push_unique_artifact_protocol_path(target, artifact.file_path.as_str());
    }
}

fn build_step_system_prompt(
    skill_markdown: &str,
    step_name: &str,
    step_number: usize,
    total_steps: usize,
    step_prompt: &str,
    memory_prompt: Option<&str>,
) -> String {
    let base_prompt = format!(
        "{skill_markdown}\n\n---\n\n## 当前步骤: {step_name} ({step_number}/{total_steps})\n\n{step_prompt}"
    );
    if let Some(memory_prompt) = memory_prompt {
        format!("{base_prompt}\n\n{memory_prompt}")
    } else {
        base_prompt
    }
}

fn build_step_input(user_input: &str, accumulated_context: &str, is_first_step: bool) -> String {
    if is_first_step {
        accumulated_context.to_string()
    } else {
        format!("原始需求：{user_input}\n\n前序步骤输出：\n{accumulated_context}")
    }
}

fn build_prompt_system_prompt(skill_markdown: &str, memory_prompt: Option<&str>) -> String {
    if let Some(memory_prompt) = memory_prompt {
        format!("{skill_markdown}\n\n{memory_prompt}")
    } else {
        skill_markdown.to_string()
    }
}

fn build_user_message(user_input: &str, images: &[SkillInputImage]) -> Message {
    let mut user_message = Message::user().with_text(user_input);
    for image in images {
        user_message = user_message.with_image(image.data.clone(), image.media_type.clone());
    }
    user_message
}

async fn stream_skill_session(
    aster_state: &AsterAgentState,
    session_id: &str,
    event_name: &str,
    session_config: SessionConfig,
    user_message: Message,
    emitter: &SkillEventEmitter,
) -> Result<StreamedSkillReply, SkillExecutionError> {
    let agent_arc = aster_state.get_agent_arc();
    let guard = agent_arc.read().await;
    let agent = guard.as_ref().ok_or_else(|| {
        SkillExecutionError::SessionInitFailed("Agent not initialized".to_string())
    })?;

    let cancel_token = aster_state.create_cancel_token(session_id).await;
    let stream_result = agent
        .reply(user_message, session_config, Some(cancel_token.clone()))
        .await;

    let mut output = String::new();
    let mut error: Option<String> = None;
    let mut artifact_paths = Vec::new();
    let mut write_artifact_emitter = WriteArtifactEventEmitter::new(session_id.to_string());

    match stream_result {
        Ok(mut stream) => {
            while let Some(event_result) = stream.next().await {
                match event_result {
                    Ok(agent_event) => {
                        let runtime_events = project_runtime_event(agent_event);
                        for mut runtime_event in runtime_events {
                            let extra_events =
                                write_artifact_emitter.process_event(&mut runtime_event);
                            for extra_event in extra_events {
                                collect_artifact_path_from_event(&mut artifact_paths, &extra_event);
                                emit_skill_event(emitter, event_name, extra_event);
                            }
                            collect_artifact_path_from_event(&mut artifact_paths, &runtime_event);
                            if let RuntimeAgentEvent::TextDelta { ref text } = runtime_event {
                                output.push_str(text);
                            }
                            emit_skill_event(emitter, event_name, runtime_event);
                        }
                    }
                    Err(stream_error) => {
                        error = Some(format!("Stream error: {stream_error}"));
                        break;
                    }
                }
            }
        }
        Err(agent_error) => {
            error = Some(format!("Agent error: {agent_error}"));
        }
    }

    aster_state.remove_cancel_token(session_id).await;

    Ok(StreamedSkillReply {
        output,
        error,
        artifact_paths,
    })
}

pub async fn execute_skill_workflow(
    request: SkillWorkflowExecution<'_>,
) -> Result<SkillExecutionResult, SkillExecutionError> {
    let SkillWorkflowExecution {
        aster_state,
        skill,
        user_input,
        images,
        execution_id,
        session_id,
        callback,
        memory_prompt,
        emitter,
    } = request;
    let steps = &skill.workflow_steps;
    let total_steps = steps.len();
    let event_name = format!("skill-exec-{execution_id}");
    let mut steps_completed = Vec::new();
    let mut artifact_paths = Vec::new();
    let mut accumulated_context = user_input.to_string();
    let mut final_output = String::new();

    tracing::info!(
        "[execute_skill_workflow] 开始 workflow 执行: steps={}, skill={}",
        total_steps,
        skill.skill_name
    );

    for (idx, step) in steps.iter().enumerate() {
        let step_num = idx + 1;
        callback.on_step_start(&step.id, &step.name, step_num, total_steps);

        tracing::info!(
            "[execute_skill_workflow] 执行步骤 {}/{}: id={}, name={}",
            step_num,
            total_steps,
            step.id,
            step.name
        );

        let step_system_prompt = build_step_system_prompt(
            &skill.markdown_content,
            &step.name,
            step_num,
            total_steps,
            &step.prompt,
            memory_prompt,
        );
        let step_session_id = format!("{session_id}-step-{}", step.id);
        let session_config = SessionConfigBuilder::new(&step_session_id)
            .system_prompt(step_system_prompt)
            .include_context_trace(true)
            .build();
        let step_input = build_step_input(user_input, &accumulated_context, idx == 0);
        let user_message = build_user_message(&step_input, images);

        let reply = stream_skill_session(
            aster_state,
            &step_session_id,
            &event_name,
            session_config,
            user_message,
            &emitter,
        )
        .await?;
        extend_unique_artifact_protocol_paths(&mut artifact_paths, &reply.artifact_paths);

        if let Some(error) = &reply.error {
            callback.on_step_error(&step.id, error, false);
            steps_completed.push(StepResult {
                step_id: step.id.clone(),
                step_name: step.name.clone(),
                success: false,
                output: None,
                error: Some(error.clone()),
            });

            let final_error = format!("步骤 '{}' 执行失败: {}", step.name, error);
            callback.on_complete(false, None, Some(&final_error));
            emit_skill_event(
                &emitter,
                &event_name,
                RuntimeAgentEvent::FinalDone { usage: None },
            );

            return Ok(SkillExecutionResult {
                success: false,
                output: None,
                error: Some(final_error),
                artifact_paths,
                steps_completed,
            });
        }

        callback.on_step_complete(&step.id, &reply.output);
        steps_completed.push(StepResult {
            step_id: step.id.clone(),
            step_name: step.name.clone(),
            success: true,
            output: Some(reply.output.clone()),
            error: None,
        });
        accumulated_context = reply.output.clone();
        final_output = reply.output;
    }

    callback.on_complete(true, Some(&final_output), None);
    emit_skill_event(
        &emitter,
        &event_name,
        RuntimeAgentEvent::FinalDone { usage: None },
    );

    tracing::info!(
        "[execute_skill_workflow] Workflow 执行完成: skill={}, steps_completed={}",
        skill.skill_name,
        steps_completed.len()
    );

    Ok(SkillExecutionResult {
        success: true,
        output: Some(final_output),
        error: None,
        artifact_paths,
        steps_completed,
    })
}

pub async fn execute_skill_prompt(
    request: SkillPromptExecution<'_>,
) -> Result<SkillExecutionResult, SkillExecutionError> {
    let SkillPromptExecution {
        aster_state,
        skill,
        user_input,
        images,
        execution_id,
        session_id,
        memory_prompt,
        emitter,
    } = request;
    let event_name = format!("skill-exec-{execution_id}");
    let session_config = SessionConfigBuilder::new(session_id)
        .system_prompt(build_prompt_system_prompt(
            &skill.markdown_content,
            memory_prompt,
        ))
        .include_context_trace(true)
        .build();
    let user_message = build_user_message(user_input, images);
    let reply = stream_skill_session(
        aster_state,
        session_id,
        &event_name,
        session_config,
        user_message,
        &emitter,
    )
    .await?;

    if let Some(error) = reply.error {
        return Ok(SkillExecutionResult {
            success: false,
            output: None,
            error: Some(error.clone()),
            artifact_paths: reply.artifact_paths.clone(),
            steps_completed: vec![StepResult {
                step_id: "main".to_string(),
                step_name: skill.display_name.clone(),
                success: false,
                output: None,
                error: Some(error),
            }],
        });
    }

    Ok(SkillExecutionResult {
        success: true,
        output: Some(reply.output.clone()),
        error: None,
        artifact_paths: reply.artifact_paths,
        steps_completed: vec![StepResult {
            step_id: "main".to_string(),
            step_name: skill.display_name.clone(),
            success: true,
            output: Some(reply.output),
            error: None,
        }],
    })
}
