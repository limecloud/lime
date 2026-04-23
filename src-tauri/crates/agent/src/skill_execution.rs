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
use aster::session::TurnContextOverride;
use futures::StreamExt;
use lime_skills::{ExecutionCallback, LoadedSkillDefinition};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
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

fn build_skill_turn_context(skill: &LoadedSkillDefinition) -> Option<TurnContextOverride> {
    let allowed_tools = skill
        .allowed_tools
        .as_ref()
        .filter(|tools| !tools.is_empty())?;

    let mut metadata = HashMap::new();
    metadata.insert(
        "subagent".to_string(),
        json!({
            "allowed_tools": allowed_tools,
        }),
    );

    Some(TurnContextOverride {
        metadata,
        ..TurnContextOverride::default()
    })
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
    let skill_turn_context = build_skill_turn_context(skill);

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
        let mut session_config_builder = SessionConfigBuilder::new(&step_session_id)
            .system_prompt(step_system_prompt)
            .include_context_trace(true);
        if let Some(turn_context) = skill_turn_context.clone() {
            session_config_builder = session_config_builder.turn_context(turn_context);
        }
        let session_config = session_config_builder.build();
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
    let mut session_config_builder = SessionConfigBuilder::new(session_id)
        .system_prompt(build_prompt_system_prompt(
            &skill.markdown_content,
            memory_prompt,
        ))
        .include_context_trace(true);
    if let Some(turn_context) = build_skill_turn_context(skill) {
        session_config_builder = session_config_builder.turn_context(turn_context);
    }
    let session_config = session_config_builder.build();
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

#[cfg(test)]
mod tests {
    use super::build_skill_turn_context;
    use lime_skills::LoadedSkillDefinition;
    use std::collections::HashMap;

    fn build_loaded_skill(allowed_tools: Option<Vec<&str>>) -> LoadedSkillDefinition {
        LoadedSkillDefinition {
            skill_name: "image_generate".to_string(),
            display_name: "配图".to_string(),
            description: "测试 skill".to_string(),
            markdown_content: "test".to_string(),
            license: None,
            metadata: HashMap::new(),
            allowed_tools: allowed_tools.map(|tools| {
                tools
                    .into_iter()
                    .map(|tool| tool.to_string())
                    .collect::<Vec<_>>()
            }),
            argument_hint: None,
            when_to_use: None,
            when_to_use_config: None,
            model: None,
            provider: None,
            disable_model_invocation: false,
            execution_mode: "prompt".to_string(),
            workflow_ref: None,
            workflow_steps: Vec::new(),
            standard_compliance: Default::default(),
        }
    }

    #[test]
    fn build_skill_turn_context_forwards_allowed_tools_to_subagent_scope_metadata() {
        let skill = build_loaded_skill(Some(vec![
            "lime_create_image_generation_task",
            "social_generate_cover_image",
        ]));

        let turn_context = build_skill_turn_context(&skill).expect("turn context");
        assert_eq!(
            turn_context.metadata["subagent"]["allowed_tools"],
            serde_json::json!([
                "lime_create_image_generation_task",
                "social_generate_cover_image"
            ])
        );
    }

    #[test]
    fn build_skill_turn_context_skips_empty_allowed_tools() {
        let skill = build_loaded_skill(Some(Vec::new()));
        assert!(build_skill_turn_context(&skill).is_none());

        let skill = build_loaded_skill(None);
        assert!(build_skill_turn_context(&skill).is_none());
    }
}
