use crate::{
    agents::{subagent_task_config::TaskConfig, AgentEvent, SessionConfig},
    conversation::{message::Message, Conversation},
    execution::manager::AgentManager,
    prompt_template::render_global_file,
    recipe::Recipe,
};
use anyhow::{anyhow, Result};
use futures::StreamExt;
use rmcp::model::{ErrorCode, ErrorData};
use serde::Serialize;
use std::future::Future;
use std::pin::Pin;
use tokio_util::sync::CancellationToken;
use tracing::{debug, info};

#[derive(Serialize)]
struct SubagentPromptContext {
    max_turns: usize,
    subagent_id: String,
    task_instructions: String,
    tool_count: usize,
    available_tools: String,
}

type AgentMessagesFuture =
    Pin<Box<dyn Future<Output = Result<(Conversation, Option<String>)>> + Send>>;

fn build_subagent_session_config(
    session_id: String,
    task_config: &TaskConfig,
    recipe_retry: Option<crate::agents::types::RetryConfig>,
) -> SessionConfig {
    SessionConfig {
        id: session_id,
        thread_id: None,
        turn_id: None,
        schedule_id: None,
        max_turns: task_config.max_turns.map(|v| v as u32),
        retry_config: recipe_retry,
        system_prompt: None,
        include_context_trace: None,
        turn_context: task_config.turn_context.clone(),
    }
}

/// Standalone function to run a complete subagent task with output options
pub async fn run_complete_subagent_task(
    recipe: Recipe,
    task_config: TaskConfig,
    return_last_only: bool,
    session_id: String,
    images: Option<Vec<crate::agents::subagent_tool::ImageData>>,
    cancellation_token: Option<CancellationToken>,
) -> Result<String, anyhow::Error> {
    let (messages, final_output) =
        get_agent_messages(recipe, task_config, session_id, images, cancellation_token)
            .await
            .map_err(|e| {
                ErrorData::new(
                    ErrorCode::INTERNAL_ERROR,
                    format!("Failed to execute task: {}", e),
                    None,
                )
            })?;

    if let Some(output) = final_output {
        return Ok(output);
    }

    let response_text = if return_last_only {
        messages
            .messages()
            .last()
            .and_then(|message| {
                message.content.iter().find_map(|content| match content {
                    crate::conversation::message::MessageContent::Text(text_content) => {
                        Some(text_content.text.clone())
                    }
                    _ => None,
                })
            })
            .unwrap_or_else(|| String::from("No text content in last message"))
    } else {
        let all_text_content: Vec<String> = messages
            .iter()
            .flat_map(|message| {
                message.content.iter().filter_map(|content| {
                    match content {
                        crate::conversation::message::MessageContent::Text(text_content) => {
                            Some(text_content.text.clone())
                        }
                        crate::conversation::message::MessageContent::ToolResponse(
                            tool_response,
                        ) => {
                            // Extract text from tool response
                            if let Ok(result) = &tool_response.tool_result {
                                let texts: Vec<String> = result
                                    .content
                                    .iter()
                                    .filter_map(|content| {
                                        if let rmcp::model::RawContent::Text(raw_text_content) =
                                            &content.raw
                                        {
                                            Some(raw_text_content.text.clone())
                                        } else {
                                            None
                                        }
                                    })
                                    .collect();
                                if !texts.is_empty() {
                                    Some(format!("Tool result: {}", texts.join("\n")))
                                } else {
                                    None
                                }
                            } else {
                                None
                            }
                        }
                        _ => None,
                    }
                })
            })
            .collect();

        all_text_content.join("\n")
    };

    Ok(response_text)
}

fn get_agent_messages(
    recipe: Recipe,
    task_config: TaskConfig,
    session_id: String,
    images: Option<Vec<crate::agents::subagent_tool::ImageData>>,
    cancellation_token: Option<CancellationToken>,
) -> AgentMessagesFuture {
    Box::pin(async move {
        let system_instructions = recipe.instructions.clone().unwrap_or_default();
        let user_task = recipe
            .prompt
            .clone()
            .unwrap_or_else(|| "Begin.".to_string());

        let agent_manager = AgentManager::instance()
            .await
            .map_err(|e| anyhow!("Failed to create AgentManager: {}", e))?;

        let agent = agent_manager
            .get_or_create_agent(session_id.clone())
            .await
            .map_err(|e| anyhow!("Failed to get sub agent session file path: {}", e))?;

        agent
            .update_provider(task_config.provider.clone(), &session_id)
            .await
            .map_err(|e| anyhow!("Failed to set provider on sub agent: {}", e))?;

        for extension in &task_config.extensions {
            if let Err(e) = agent.add_extension(extension.clone()).await {
                debug!(
                    "Failed to add extension '{}' to subagent: {}",
                    extension.name(),
                    e
                );
            }
        }

        let has_response_schema = recipe.response.is_some();
        agent
            .apply_recipe_components(recipe.sub_recipes.clone(), recipe.response.clone(), true)
            .await
            .map_err(|e| anyhow!("Failed to configure subagent recipe components: {}", e))?;

        let tools = agent.list_tools(None).await;
        let subagent_prompt = render_global_file(
            "subagent_system.md",
            &SubagentPromptContext {
                max_turns: task_config
                    .max_turns
                    .expect("TaskConfig always sets max_turns"),
                subagent_id: session_id.clone(),
                task_instructions: system_instructions,
                tool_count: tools.len(),
                available_tools: tools
                    .iter()
                    .map(|t| t.name.to_string())
                    .collect::<Vec<_>>()
                    .join(", "),
            },
        )
        .map_err(|e| anyhow!("Failed to render subagent system prompt: {}", e))?;
        agent.override_system_prompt(subagent_prompt).await;

        let mut user_message = Message::user().with_text(user_task);

        // 添加图片内容到用户消息中
        if let Some(images) = images {
            for image in images {
                user_message = user_message.with_image(image.data, image.mime_type);
            }
        }

        let mut conversation = Conversation::new_unvalidated(vec![user_message.clone()]);

        if let Some(activities) = recipe.activities {
            for activity in activities {
                info!("Recipe activity: {}", activity);
            }
        }
        let session_config =
            build_subagent_session_config(session_id.clone(), &task_config, recipe.retry);

        let mut stream = crate::session_context::with_session_id(Some(session_id.clone()), async {
            agent
                .reply(user_message, session_config, cancellation_token)
                .await
        })
        .await
        .map_err(|e| anyhow!("Failed to get reply from agent: {}", e))?;
        while let Some(message_result) = stream.next().await {
            match message_result {
                Ok(AgentEvent::TurnStarted { .. })
                | Ok(AgentEvent::ItemStarted { .. })
                | Ok(AgentEvent::ItemUpdated { .. })
                | Ok(AgentEvent::ItemCompleted { .. })
                | Ok(AgentEvent::ContextCompactionStarted { .. })
                | Ok(AgentEvent::ContextCompactionCompleted { .. })
                | Ok(AgentEvent::ContextCompactionWarning { .. }) => {}
                Ok(AgentEvent::Message(msg)) => conversation.push(msg),
                Ok(AgentEvent::McpNotification(_)) | Ok(AgentEvent::ModelChange { .. }) => {}
                Ok(AgentEvent::HistoryReplaced(updated_conversation)) => {
                    conversation = updated_conversation;
                }
                Ok(AgentEvent::ContextTrace { .. }) => {}
                Err(e) => {
                    tracing::error!("Error receiving message from subagent: {}", e);
                    break;
                }
            }
        }

        let final_output = if has_response_schema {
            agent
                .final_output_tool
                .lock()
                .await
                .as_ref()
                .and_then(|tool| tool.final_output.clone())
        } else {
            None
        };

        Ok((conversation, final_output))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::testprovider::TestProvider;
    use crate::session::TurnContextOverride;
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::Arc;

    #[test]
    fn build_subagent_session_config_preserves_inherited_turn_context() {
        let task_config = TaskConfig {
            provider: Arc::new(
                TestProvider::new_replaying("/tmp/aster-subagent-handler.json").expect("provider"),
            ),
            parent_session_id: "parent-session-1".to_string(),
            parent_working_dir: PathBuf::from("/tmp/workspace-parent"),
            extensions: Vec::new(),
            max_turns: Some(7),
            turn_context: Some(TurnContextOverride {
                model: Some("gpt-5.4".to_string()),
                effort: Some("high".to_string()),
                metadata: HashMap::new(),
                ..TurnContextOverride::default()
            }),
        };

        let session_config =
            build_subagent_session_config("subagent-session-1".to_string(), &task_config, None);

        assert_eq!(session_config.max_turns, Some(7));
        assert_eq!(
            session_config
                .turn_context
                .as_ref()
                .and_then(|context| context.model.as_deref()),
            Some("gpt-5.4")
        );
        assert_eq!(
            session_config
                .turn_context
                .as_ref()
                .and_then(|context| context.effort.as_deref()),
            Some("high")
        );
    }
}
