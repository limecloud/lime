use app_server_protocol::protocol::v2;

use super::super::exec_events as events;

pub(super) fn map_item(item: &v2::ThreadItem) -> Option<(&str, events::ThreadItemDetails)> {
    use events::ThreadItemDetails as Details;
    let details = match item {
        v2::ThreadItem::AgentMessage { text, .. } | v2::ThreadItem::Plan { text, .. } => {
            Details::AgentMessage(events::AgentMessageItem { text: text.clone() })
        }
        v2::ThreadItem::Reasoning { summary, .. } => {
            let text = summary.join("\n");
            if text.trim().is_empty() {
                return None;
            }
            Details::Reasoning(events::ReasoningItem { text })
        }
        v2::ThreadItem::CommandExecution {
            command,
            aggregated_output,
            exit_code,
            status,
            ..
        } => Details::CommandExecution(events::CommandExecutionItem {
            command: command.clone(),
            aggregated_output: aggregated_output.clone().unwrap_or_default(),
            exit_code: *exit_code,
            status: match status {
                v2::CommandExecutionStatus::InProgress => {
                    events::CommandExecutionStatus::InProgress
                }
                v2::CommandExecutionStatus::Completed => events::CommandExecutionStatus::Completed,
                v2::CommandExecutionStatus::Failed => events::CommandExecutionStatus::Failed,
                v2::CommandExecutionStatus::Declined => events::CommandExecutionStatus::Declined,
            },
        }),
        v2::ThreadItem::FileChange {
            changes, status, ..
        } => Details::FileChange(events::FileChangeItem {
            changes: changes
                .iter()
                .map(|change| events::FileUpdateChange {
                    path: change.path.clone(),
                    kind: match change.kind {
                        v2::PatchChangeKind::Add => events::PatchChangeKind::Add,
                        v2::PatchChangeKind::Delete => events::PatchChangeKind::Delete,
                        v2::PatchChangeKind::Update { .. } => events::PatchChangeKind::Update,
                    },
                })
                .collect(),
            status: match status {
                v2::PatchApplyStatus::InProgress => events::PatchApplyStatus::InProgress,
                v2::PatchApplyStatus::Completed => events::PatchApplyStatus::Completed,
                v2::PatchApplyStatus::Failed | v2::PatchApplyStatus::Declined => {
                    events::PatchApplyStatus::Failed
                }
            },
        }),
        v2::ThreadItem::McpToolCall {
            server,
            tool,
            status,
            arguments,
            result,
            error,
            ..
        } => Details::McpToolCall(events::McpToolCallItem {
            server: server.clone(),
            tool: tool.clone(),
            arguments: arguments.clone(),
            result: result.as_ref().map(|result| events::McpToolCallItemResult {
                content: result.content.clone(),
                meta: result.meta.clone(),
                structured_content: result.structured_content.clone(),
            }),
            error: error.as_ref().map(|error| events::McpToolCallItemError {
                message: error.message.clone(),
            }),
            status: match status {
                v2::McpToolCallStatus::InProgress => events::McpToolCallStatus::InProgress,
                v2::McpToolCallStatus::Completed => events::McpToolCallStatus::Completed,
                v2::McpToolCallStatus::Failed => events::McpToolCallStatus::Failed,
            },
        }),
        v2::ThreadItem::CollabAgentToolCall {
            tool,
            sender_thread_id,
            receiver_thread_ids,
            prompt,
            agents_states,
            status,
            ..
        } => Details::CollabToolCall(events::CollabToolCallItem {
            tool: match tool {
                v2::CollabAgentTool::SpawnAgent => events::CollabTool::SpawnAgent,
                v2::CollabAgentTool::SendInput => events::CollabTool::SendInput,
                v2::CollabAgentTool::ResumeAgent | v2::CollabAgentTool::Wait => {
                    events::CollabTool::Wait
                }
                v2::CollabAgentTool::CloseAgent => events::CollabTool::CloseAgent,
            },
            sender_thread_id: sender_thread_id.clone(),
            receiver_thread_ids: receiver_thread_ids.clone(),
            prompt: prompt.clone(),
            agents_states: agents_states
                .iter()
                .map(|(id, state)| {
                    (
                        id.clone(),
                        events::CollabAgentState {
                            message: state.message.clone(),
                            status: match state.status {
                                v2::CollabAgentStatus::PendingInit => {
                                    events::CollabAgentStatus::PendingInit
                                }
                                v2::CollabAgentStatus::Running => {
                                    events::CollabAgentStatus::Running
                                }
                                v2::CollabAgentStatus::Interrupted => {
                                    events::CollabAgentStatus::Interrupted
                                }
                                v2::CollabAgentStatus::Completed => {
                                    events::CollabAgentStatus::Completed
                                }
                                v2::CollabAgentStatus::Errored => {
                                    events::CollabAgentStatus::Errored
                                }
                                v2::CollabAgentStatus::Shutdown => {
                                    events::CollabAgentStatus::Shutdown
                                }
                                v2::CollabAgentStatus::NotFound => {
                                    events::CollabAgentStatus::NotFound
                                }
                            },
                        },
                    )
                })
                .collect(),
            status: match status {
                v2::CollabAgentToolCallStatus::InProgress => {
                    events::CollabToolCallStatus::InProgress
                }
                v2::CollabAgentToolCallStatus::Completed => events::CollabToolCallStatus::Completed,
                v2::CollabAgentToolCallStatus::Failed => events::CollabToolCallStatus::Failed,
            },
        }),
        v2::ThreadItem::WebSearch(item) => Details::WebSearch(events::WebSearchItem {
            query: item.query.clone().unwrap_or_default(),
            action: item
                .action
                .clone()
                .and_then(|action| serde_json::from_value(action).ok())
                .unwrap_or(events::WebSearchAction::Other),
            // V2 currently supplies no typed search results; never read raw metadata as a substitute.
            results: None,
        }),
        _ => return None,
    };
    let id = match item {
        v2::ThreadItem::AgentMessage { id, .. }
        | v2::ThreadItem::Plan { id, .. }
        | v2::ThreadItem::Reasoning { id, .. }
        | v2::ThreadItem::CommandExecution { id, .. }
        | v2::ThreadItem::FileChange { id, .. }
        | v2::ThreadItem::McpToolCall { id, .. }
        | v2::ThreadItem::CollabAgentToolCall { id, .. } => id,
        v2::ThreadItem::WebSearch(item) => &item.id,
        _ => return None,
    };
    Some((id, details))
}
