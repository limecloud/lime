//! Canonical item projection shared by live events and history loading.

use super::*;

pub(super) fn project_item(item: canonical::ThreadItem) -> Result<v2::ThreadItem, JsonRpcError> {
    let id = item.item_id.as_str().to_string();
    let status = item.status;
    let metadata = item.metadata;
    match item.payload {
        canonical::ThreadItemPayload::UserMessage { content, client_id } => {
            Ok(v2::ThreadItem::UserMessage {
                id,
                client_id,
                content: content.into_iter().map(project_user_input).collect(),
            })
        }
        canonical::ThreadItemPayload::HookPrompt { fragments } => {
            Ok(v2::ThreadItem::HookPrompt {
                id,
                fragments: fragments
                    .into_iter()
                    .map(|fragment| v2::HookPromptFragment {
                        text: fragment.text,
                        hook_run_id: fragment.hook_run_id,
                    })
                    .collect(),
            })
        }
        canonical::ThreadItemPayload::AgentMessage { text, phase, content_parts, delivery, questions } => {
            if content_parts.iter().any(|part| !part.is_safe()) {
                return Err(projection_error("unsafe agent message content reference"));
            }
            Ok(v2::ThreadItem::AgentMessage {
                id,
                text,
                content_parts,
                phase,
                memory_citation: metadata
                    .get("memoryCitation")
                    .or_else(|| metadata.get("memory_citation"))
                    .and_then(crate::memory_store::parse_memory_citation),
                delivery,
                questions,
            })
        }
        canonical::ThreadItemPayload::Plan { text, .. } => {
            Ok(v2::ThreadItem::Plan {
                id,
                text,
            })
        }
        canonical::ThreadItemPayload::Reasoning { summary, content } => {
            Ok(v2::ThreadItem::Reasoning {
                id,
                summary,
                content,
            })
        }
        canonical::ThreadItemPayload::Tool {
            name,
            arguments,
            output,
            ..
        } => {
            if let Some(image) =
                project_image_generation_item(&id, status, &metadata)?
            {
                return Ok(v2::ThreadItem::ImageGeneration(image));
            }
            let duration_ms = output.as_ref().and_then(|value| value.duration_ms);
            let success = output
                .as_ref()
                .map(|value| value.error.is_none())
                .or_else(|| terminal_success(status));
            Ok(v2::ThreadItem::DynamicToolCall {
                id,
                namespace: None,
                tool: name,
                arguments: bounded_safe_json(
                    serde_json::to_value(arguments)
                        .map_err(|error| projection_error(format!("tool arguments: {error}")))?,
                )
                .0,
                status: project_dynamic_tool_status(status),
                content_items: output_content_items(output.as_ref()),
                success,
                duration_ms: duration_ms.map(saturating_i64),
            })
        }
        canonical::ThreadItemPayload::DynamicToolCall {
            namespace,
            tool,
            arguments,
            content_items,
            success,
            duration_ms,
            ..
        } => Ok(v2::ThreadItem::DynamicToolCall {
            id,
            namespace,
            tool,
            arguments: bounded_safe_json(arguments).0,
            status: project_dynamic_tool_status(status),
            content_items: (!content_items.is_empty()).then(|| {
                content_items
                    .into_iter()
                    .map(project_dynamic_tool_content_item)
                    .collect()
            }),
            success: success.or_else(|| terminal_success(status)),
            duration_ms: duration_ms.map(saturating_i64),
        }),
        canonical::ThreadItemPayload::McpToolCall {
            server_name,
            tool_name,
            app_context,
            mcp_app_resource_uri,
            plugin_id,
            arguments,
            output,
            ..
        } => {
            let error = output
                .as_ref()
                .and_then(|value| value.error.clone())
                .map(|message| v2::McpToolCallError {
                    message: bounded_safe_text(&message, MAX_DISPLAY_STRING_BYTES).0,
                });
            let result = output
                .as_ref()
                .filter(|value| value.error.is_none())
                .map(project_mcp_tool_result)
                .map(Box::new);
            Ok(v2::ThreadItem::McpToolCall {
                id,
                server: server_name,
                tool: tool_name,
                status: project_mcp_status(status),
                arguments: bounded_safe_json(
                    serde_json::to_value(arguments)
                        .map_err(|error| projection_error(format!("MCP arguments: {error}")))?,
                )
                .0,
                app_context: app_context.map(project_mcp_app_context),
                mcp_app_resource_uri,
                plugin_id,
                read_only_hint: metadata_bool(
                    &metadata,
                    &["readOnlyHint", "read_only_hint"],
                ),
                result,
                error,
                duration_ms: output
                    .as_ref()
                    .and_then(|value| value.duration_ms)
                    .map(saturating_i64),
            })
        }
        canonical::ThreadItemPayload::CollabAgentToolCall {
            operation,
            target_thread_id,
            message,
            agent_states,
            ..
        } => Ok(v2::ThreadItem::CollabAgentToolCall {
            id,
            tool: project_collab_tool(operation),
            status: project_collab_status(status),
            sender_thread_id: item.thread_id.as_str().to_string(),
            receiver_thread_ids: target_thread_id
                .map(|value| vec![value.as_str().to_string()])
                .unwrap_or_default(),
            prompt: message,
            model: metadata_string(&metadata, &["model", "modelName", "model_name"]),
            reasoning_effort: metadata_string(
                &metadata,
                &["reasoningEffort", "reasoning_effort"],
            )
            .and_then(v2::ReasoningEffort::new),
            agents_states: agent_states
                .into_iter()
                .map(|(thread_id, state)| {
                    (
                        thread_id.as_str().to_string(),
                        project_collab_agent_state(state),
                    )
                })
                .collect(),
        }),
        canonical::ThreadItemPayload::Approval { .. } => Err(projection_error(format!(
            "canonical approval item {id} has no v2 ThreadItem representation"
        ))),
        canonical::ThreadItemPayload::Command {
            command,
            cwd,
            output,
            exit_code,
        } => Ok(v2::ThreadItem::CommandExecution {
            id,
            plugin_id: metadata_string(&metadata, &["pluginId", "plugin_id"]),
            script_path: metadata_string(&metadata, &["scriptPath", "script_path"]),
            command_actions: project_command_actions(&command, cwd.as_deref(), &metadata),
            command,
            cwd: cwd.unwrap_or_default(),
            process_id: metadata_string(&metadata, &["processId", "process_id"]),
            source: project_command_source(&metadata),
            status: project_command_status(status, &metadata),
            aggregated_output: output
                .map(|value| bounded_safe_text(&value, MAX_DISPLAY_JSON_BYTES).0),
            exit_code,
            duration_ms: metadata_u64(&metadata, &["durationMs", "duration_ms"])
                .map(saturating_i64),
            terminal_interactions: project_terminal_interactions(&metadata),
        }),
        canonical::ThreadItemPayload::File { changes, status } => {
            Ok(v2::ThreadItem::FileChange {
                id,
                changes: changes
                    .into_iter()
                    .map(|change| v2::FileUpdateChange {
                        path: change.path,
                        kind: project_patch_change_kind(change.kind),
                        diff: change.diff,
                    })
                    .collect(),
                status: project_patch_status(status),
            })
        }
        canonical::ThreadItemPayload::Media {
            uri,
            mime_type,
            ..
        } if mime_type.starts_with("image/") => Ok(v2::ThreadItem::ImageView {
            id,
            path: uri,
        }),
        canonical::ThreadItemPayload::Media { mime_type, .. } => Err(projection_error(format!(
            "canonical media item {id} with MIME type {mime_type} has no v2 ThreadItem representation"
        ))),
        canonical::ThreadItemPayload::SubAgent {
            child_thread_id,
            activity,
            ..
        } => Ok(v2::ThreadItem::SubAgentActivity {
            id,
            kind: project_subagent_activity(activity),
            agent_thread_id: child_thread_id.as_str().to_string(),
            agent_path: metadata_string(&metadata, &["agentPath", "agent_path"])
                .unwrap_or_else(|| child_thread_id.as_str().to_string()),
        }),
        canonical::ThreadItemPayload::ContextCompaction { .. } => {
            Ok(v2::ThreadItem::ContextCompaction {
                id,
            })
        }
        canonical::ThreadItemPayload::Unknown {
            upstream_type,
            field_names,
        } => Ok(v2::ThreadItem::UnknownItem {
            id,
            upstream_type,
            field_names,
        }),
        canonical::ThreadItemPayload::Extension { name, data } => {
            match name.as_str() {
                "enteredReviewMode" | "exitedReviewMode" => {
                    let review = data
                        .get("review")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .ok_or_else(|| {
                            projection_error(format!(
                                "canonical review item {id} ({name}) is missing review text"
                            ))
                        })?;
                    if name == "enteredReviewMode" {
                        Ok(v2::ThreadItem::EnteredReviewMode {
                            id,
                            review,
                        })
                    } else {
                        Ok(v2::ThreadItem::ExitedReviewMode {
                            id,
                            review,
                        })
                    }
                }
                _ => Err(projection_error(format!(
                    "canonical extension item {id} ({name}) has no v2 ThreadItem representation"
                ))),
            }
        }
    }
}

fn project_user_input(input: canonical::AgentInput) -> v2::UserInput {
    match input {
        canonical::AgentInput::Text {
            text,
            text_elements,
        } => v2::UserInput::Text {
            text,
            text_elements,
        },
        canonical::AgentInput::Image { uri, detail } => v2::UserInput::Image { detail, url: uri },
        canonical::AgentInput::LocalImage { path, detail } => {
            v2::UserInput::LocalImage { detail, path }
        }
        canonical::AgentInput::Skill { name, path } => v2::UserInput::Skill { name, path },
        canonical::AgentInput::Mention { name, path } => v2::UserInput::Mention { name, path },
    }
}

fn project_dynamic_tool_status(status: canonical::ItemStatus) -> v2::DynamicToolCallStatus {
    match status {
        canonical::ItemStatus::Pending | canonical::ItemStatus::InProgress => {
            v2::DynamicToolCallStatus::InProgress
        }
        canonical::ItemStatus::Completed => v2::DynamicToolCallStatus::Completed,
        canonical::ItemStatus::Failed
        | canonical::ItemStatus::Interrupted
        | canonical::ItemStatus::Cancelled => v2::DynamicToolCallStatus::Failed,
    }
}

fn project_image_generation_item(
    item_id: &str,
    item_status: canonical::ItemStatus,
    metadata: &Value,
) -> Result<Option<v2::ImageGenerationItem>, JsonRpcError> {
    let Some(raw_item) = metadata.pointer("/provider_metadata/raw_response_item") else {
        return Ok(None);
    };
    if raw_item.get("type").and_then(Value::as_str) != Some("image_generation_call") {
        return Ok(None);
    }

    let status = raw_item
        .get("status")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| canonical_image_generation_status(item_status).to_string());
    let result = raw_item
        .get("result")
        .and_then(Value::as_str)
        .map(str::to_string);
    if status == "completed" && result.is_none() {
        return Err(projection_error(
            "completed image_generation_call omitted string result",
        ));
    }

    Ok(Some(v2::ImageGenerationItem {
        id: raw_item
            .get("id")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(item_id)
            .to_string(),
        status,
        revised_prompt: raw_item
            .get("revised_prompt")
            .and_then(Value::as_str)
            .map(str::to_string),
        result: result.unwrap_or_default(),
        saved_path: raw_item
            .get("saved_path")
            .and_then(Value::as_str)
            .map(str::to_string),
    }))
}

fn canonical_image_generation_status(status: canonical::ItemStatus) -> &'static str {
    match status {
        canonical::ItemStatus::Completed => "completed",
        canonical::ItemStatus::Failed
        | canonical::ItemStatus::Interrupted
        | canonical::ItemStatus::Cancelled => "failed",
        canonical::ItemStatus::Pending | canonical::ItemStatus::InProgress => "in_progress",
    }
}

fn project_collab_status(status: canonical::ItemStatus) -> v2::CollabAgentToolCallStatus {
    match status {
        canonical::ItemStatus::Pending | canonical::ItemStatus::InProgress => {
            v2::CollabAgentToolCallStatus::InProgress
        }
        canonical::ItemStatus::Completed => v2::CollabAgentToolCallStatus::Completed,
        canonical::ItemStatus::Failed
        | canonical::ItemStatus::Interrupted
        | canonical::ItemStatus::Cancelled => v2::CollabAgentToolCallStatus::Failed,
    }
}

fn project_collab_agent_state(state: canonical::CollabAgentState) -> v2::CollabAgentState {
    v2::CollabAgentState {
        status: match state.status {
            canonical::CollabAgentStatus::PendingInit => v2::CollabAgentStatus::PendingInit,
            canonical::CollabAgentStatus::Running => v2::CollabAgentStatus::Running,
            canonical::CollabAgentStatus::Interrupted => v2::CollabAgentStatus::Interrupted,
            canonical::CollabAgentStatus::Completed => v2::CollabAgentStatus::Completed,
            canonical::CollabAgentStatus::Errored => v2::CollabAgentStatus::Errored,
            canonical::CollabAgentStatus::Shutdown => v2::CollabAgentStatus::Shutdown,
            canonical::CollabAgentStatus::NotFound => v2::CollabAgentStatus::NotFound,
        },
        message: state
            .message
            .map(|message| bounded_safe_text(&message, MAX_DISPLAY_STRING_BYTES).0),
    }
}

fn project_patch_status(status: canonical::FileChangeStatus) -> v2::PatchApplyStatus {
    match status {
        canonical::FileChangeStatus::Proposed => v2::PatchApplyStatus::InProgress,
        canonical::FileChangeStatus::Applied => v2::PatchApplyStatus::Completed,
        canonical::FileChangeStatus::Rejected => v2::PatchApplyStatus::Declined,
        canonical::FileChangeStatus::Failed => v2::PatchApplyStatus::Failed,
    }
}

fn project_patch_change_kind(kind: canonical::FileChangeKind) -> v2::PatchChangeKind {
    match kind {
        canonical::FileChangeKind::Add => v2::PatchChangeKind::Add,
        canonical::FileChangeKind::Delete => v2::PatchChangeKind::Delete,
        canonical::FileChangeKind::Update { move_path } => {
            v2::PatchChangeKind::Update { move_path }
        }
    }
}

fn project_collab_tool(operation: canonical::CollabAgentOperation) -> v2::CollabAgentTool {
    match operation {
        canonical::CollabAgentOperation::Spawn => v2::CollabAgentTool::SpawnAgent,
        canonical::CollabAgentOperation::SendMessage
        | canonical::CollabAgentOperation::FollowUp => v2::CollabAgentTool::SendInput,
        canonical::CollabAgentOperation::Wait => v2::CollabAgentTool::Wait,
        canonical::CollabAgentOperation::Resume => v2::CollabAgentTool::ResumeAgent,
        canonical::CollabAgentOperation::Interrupt | canonical::CollabAgentOperation::Close => {
            v2::CollabAgentTool::CloseAgent
        }
    }
}

fn project_subagent_activity(
    activity: canonical::SubAgentActivityKind,
) -> v2::SubAgentActivityKind {
    match activity {
        canonical::SubAgentActivityKind::Started => v2::SubAgentActivityKind::Started,
        canonical::SubAgentActivityKind::Interacted => v2::SubAgentActivityKind::Interacted,
        canonical::SubAgentActivityKind::Interrupted => v2::SubAgentActivityKind::Interrupted,
    }
}

fn output_content_items(
    output: Option<&canonical::ToolOutput>,
) -> Option<Vec<v2::DynamicToolCallOutputContentItem>> {
    let output = output?;
    let mut items = Vec::new();
    if let Some(text) = output.text.as_ref().filter(|value| !value.is_empty()) {
        items.push(v2::DynamicToolCallOutputContentItem::InputText {
            text: bounded_safe_text(text, MAX_DISPLAY_STRING_BYTES).0,
        });
    }
    if let Some(value) = &output.structured_content {
        items.push(v2::DynamicToolCallOutputContentItem::InputText {
            text: bounded_safe_text(
                &bounded_safe_json(value.clone()).0.to_string(),
                MAX_DISPLAY_STRING_BYTES,
            )
            .0,
        });
    }
    if let Some(error) = output.error.as_ref().filter(|value| !value.is_empty()) {
        items.push(v2::DynamicToolCallOutputContentItem::InputText {
            text: bounded_safe_text(error, MAX_DISPLAY_STRING_BYTES).0,
        });
    }
    (!items.is_empty()).then_some(items)
}

fn project_dynamic_tool_content_item(
    item: canonical::DynamicToolCallContentItem,
) -> v2::DynamicToolCallOutputContentItem {
    match item {
        canonical::DynamicToolCallContentItem::InputText { text } => {
            v2::DynamicToolCallOutputContentItem::InputText {
                text: bounded_dynamic_tool_text(&text),
            }
        }
        canonical::DynamicToolCallContentItem::InputImage { image_url } => {
            v2::DynamicToolCallOutputContentItem::InputImage { image_url }
        }
        canonical::DynamicToolCallContentItem::InputAudio { audio_url } => {
            v2::DynamicToolCallOutputContentItem::InputAudio { audio_url }
        }
    }
}

fn bounded_dynamic_tool_text(text: &str) -> String {
    let safe_text = serde_json::from_str::<Value>(text)
        .ok()
        .filter(|value| value.is_object() || value.is_array())
        .map(|value| bounded_safe_json(value).0.to_string())
        .unwrap_or_else(|| text.to_string());
    bounded_safe_text(&safe_text, MAX_DISPLAY_STRING_BYTES).0
}

fn terminal_success(status: canonical::ItemStatus) -> Option<bool> {
    match status {
        canonical::ItemStatus::Completed => Some(true),
        canonical::ItemStatus::Failed
        | canonical::ItemStatus::Interrupted
        | canonical::ItemStatus::Cancelled => Some(false),
        canonical::ItemStatus::Pending | canonical::ItemStatus::InProgress => None,
    }
}
