//! Lower canonical App Server items into the shared terminal projection.

use app_server_protocol::protocol::v2::{
    CollabAgentToolCallStatus, CommandAction, CommandExecutionSource, CommandExecutionStatus,
    DynamicToolCallStatus, McpToolCallStatus, PatchApplyStatus, PatchChangeKind, ThreadItem,
    UserInput,
};

use crate::history_cell::{
    compact_text, computer_activity_facts, computer_activity_summary,
    invocation_text as mcp_invocation_text, is_computer_activity, summary as mcp_summary,
    web_search_detail,
};
use crate::multi_agents;

use super::{
    ActivityDetail, ActivityGroupKey, ActivityGroupKind, EntryKind, EntryStatus, ReasoningSummary,
    TranscriptEntry,
};

pub(super) fn project_item(item: &ThreadItem, streaming: bool) -> Option<TranscriptEntry> {
    project_item_with_lifecycle(item, streaming, WebSearchLifecycle::Historical)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum WebSearchLifecycle {
    Historical,
    Started,
    Completed,
}

fn project_item_with_lifecycle(
    item: &ThreadItem,
    streaming: bool,
    web_search_lifecycle: WebSearchLifecycle,
) -> Option<TranscriptEntry> {
    project_item_with_scope(item, streaming, web_search_lifecycle, None)
}

pub(super) fn project_item_with_scope(
    item: &ThreadItem,
    streaming: bool,
    web_search_lifecycle: WebSearchLifecycle,
    activity_scope: Option<&str>,
) -> Option<TranscriptEntry> {
    let activity_group = activity_scope
        .and_then(|scope| activity_group_kind(item).map(|kind| ActivityGroupKey::new(kind, scope)));
    let activity_detail = activity_group
        .as_ref()
        .and_then(|_| project_activity_detail(item))
        .or_else(|| match (item, activity_scope) {
            (ThreadItem::Reasoning { summary, .. }, Some(scope)) => {
                Some(ActivityDetail::Reasoning {
                    scope: scope.to_string(),
                    summary: ReasoningSummary::from_parts(summary),
                })
            }
            _ => None,
        });
    let (id, kind, text, status, summary) = match item {
        ThreadItem::UserMessage {
            id,
            client_id,
            content,
            ..
        } => {
            let (text, summary) = user_input_projection(content);
            (
                client_id.as_ref().unwrap_or(id).clone(),
                EntryKind::User,
                text,
                None,
                summary,
            )
        }
        ThreadItem::HookPrompt { id, fragments, .. } => (
            id.clone(),
            EntryKind::System,
            fragments
                .iter()
                .map(|fragment| fragment.text.as_str())
                .collect::<Vec<_>>()
                .join("\n"),
            None,
            Vec::new(),
        ),
        ThreadItem::AgentMessage { id, text, .. } => (
            id.clone(),
            EntryKind::Assistant,
            text.clone(),
            None,
            Vec::new(),
        ),
        ThreadItem::Plan { id, text, .. } => (
            id.clone(),
            EntryKind::Plan,
            text.clone(),
            Some(EntryStatus::Completed),
            Vec::new(),
        ),
        ThreadItem::Reasoning { id, summary, .. } => {
            // Raw content is distinct from the user-facing summary and hidden by default.
            let text = ReasoningSummary::from_parts(summary).content();
            (id.clone(), EntryKind::Reasoning, text, None, Vec::new())
        }
        ThreadItem::CommandExecution {
            id,
            command,
            status,
            aggregated_output,
            exit_code,
            duration_ms,
            ..
        } => {
            let mut summary = Vec::new();
            if let Some(exit_code) = exit_code {
                summary.push(format!("exit {exit_code}"));
            }
            if let Some(duration_ms) = duration_ms {
                summary.push(format!("duration {duration_ms}ms"));
            }
            (
                id.clone(),
                EntryKind::Command,
                command_text(command, aggregated_output.as_deref(), streaming),
                Some(command_entry_status(*status)),
                summary,
            )
        }
        ThreadItem::FileChange {
            id,
            changes,
            status,
            ..
        } => (
            id.clone(),
            EntryKind::Patch,
            format_patch(changes),
            Some(patch_entry_status(*status)),
            patch_summary(changes),
        ),
        ThreadItem::McpToolCall {
            id,
            server,
            tool,
            arguments,
            status,
            result,
            error,
            duration_ms,
            ..
        } => {
            let mut summary = mcp_summary(result.as_deref(), error.as_ref(), *duration_ms);
            if is_computer_activity(server) {
                summary.extend(computer_activity_summary(
                    arguments,
                    result.as_deref(),
                    error.as_ref(),
                ));
            }
            (
                id.clone(),
                EntryKind::Mcp,
                mcp_invocation_text(server, tool, arguments),
                Some(mcp_entry_status(*status)),
                summary,
            )
        }
        ThreadItem::DynamicToolCall {
            id,
            tool,
            status,
            content_items,
            success,
            duration_ms,
            ..
        } => (
            id.clone(),
            EntryKind::Tool,
            tool.clone(),
            Some(dynamic_entry_status(*status)),
            dynamic_summary(content_items.as_deref(), *success, *duration_ms),
        ),
        item @ ThreadItem::CollabAgentToolCall {
            id, tool, status, ..
        } => {
            let text = multi_agents::tool_call_history_cell(item)
                .map(|cell| cell.title)
                .unwrap_or_else(|| format!("{tool:?}"));
            (
                id.clone(),
                EntryKind::MultiAgent,
                text,
                Some(collab_entry_status(*status)),
                multi_agents::collab_summary_for_item(item),
            )
        }
        item @ ThreadItem::SubAgentActivity {
            id,
            kind,
            agent_path,
            ..
        } => {
            let status = multi_agents::sub_agent_activity_display(item)
                .map(|activity| {
                    if activity.is_running_hint {
                        EntryStatus::Running
                    } else {
                        EntryStatus::Interrupted
                    }
                })
                .or(Some(EntryStatus::Running));
            (
                id.clone(),
                EntryKind::MultiAgent,
                multi_agents::sub_agent_activity_summary(*kind, agent_path),
                status,
                Vec::new(),
            )
        }
        ThreadItem::WebSearch(item) => {
            let detail =
                web_search_detail(item.query.as_deref().unwrap_or(""), item.action.as_ref());
            let text = match web_search_lifecycle {
                WebSearchLifecycle::Historical => {
                    if detail.is_empty() {
                        "web search".to_string()
                    } else {
                        format!("web search: {detail}")
                    }
                }
                WebSearchLifecycle::Started => {
                    if detail.is_empty() {
                        "searching the web".to_string()
                    } else {
                        format!("searching the web {detail}")
                    }
                }
                WebSearchLifecycle::Completed => {
                    if detail.is_empty() {
                        "searched the web".to_string()
                    } else {
                        format!("searched the web for {detail}")
                    }
                }
            };
            (item.id.clone(), EntryKind::Tool, text, None, Vec::new())
        }
        ThreadItem::ImageView { id, path, .. } => (
            id.clone(),
            EntryKind::Tool,
            format!("view image: {path}"),
            None,
            Vec::new(),
        ),
        // Sleep is an internal runtime control item in Codex and is not part of the
        // user-visible transcript or agent status feed.
        ThreadItem::Sleep(_) => return None,
        ThreadItem::ImageGeneration(item) => {
            let mut summary = Vec::new();
            if let Some(path) = item.saved_path.as_deref() {
                summary.push(format!("saved: {path}"));
            }
            if let Some(prompt) = item.revised_prompt.as_deref() {
                summary.push(format!("revised prompt: {}", compact_text(prompt)));
            }
            (
                item.id.clone(),
                EntryKind::Tool,
                "image generation".to_string(),
                image_generation_status(&item.status),
                summary,
            )
        }
        ThreadItem::EnteredReviewMode { id, review, .. } => (
            id.clone(),
            EntryKind::System,
            format!("review started: {review}"),
            Some(EntryStatus::Running),
            Vec::new(),
        ),
        ThreadItem::ExitedReviewMode { id, review, .. } => (
            id.clone(),
            EntryKind::System,
            format!("review completed: {review}"),
            Some(EntryStatus::Completed),
            Vec::new(),
        ),
        ThreadItem::ContextCompaction { id, .. } => (
            id.clone(),
            EntryKind::System,
            "context compacted".to_string(),
            None,
            Vec::new(),
        ),
        ThreadItem::UnknownItem {
            id, upstream_type, ..
        } => (
            id.clone(),
            EntryKind::System,
            format!("unsupported item: {upstream_type}"),
            Some(EntryStatus::Failed),
            Vec::new(),
        ),
    };

    Some(TranscriptEntry {
        id,
        kind,
        text,
        streaming,
        status,
        summary,
        activity_group,
        activity_detail,
    })
}

pub(super) fn activity_group_kind(item: &ThreadItem) -> Option<ActivityGroupKind> {
    match item {
        ThreadItem::CommandExecution {
            source,
            command_actions,
            ..
        } if *source != CommandExecutionSource::UserShell
            && !command_actions.is_empty()
            && command_actions.iter().all(|action| {
                matches!(
                    action,
                    CommandAction::Read { .. }
                        | CommandAction::ListFiles { .. }
                        | CommandAction::Search { .. }
                )
            }) =>
        {
            Some(ActivityGroupKind::Exploration)
        }
        ThreadItem::McpToolCall { server, .. } if is_computer_activity(server) => {
            Some(ActivityGroupKind::Computer)
        }
        _ => None,
    }
}

fn project_activity_detail(item: &ThreadItem) -> Option<ActivityDetail> {
    match item {
        ThreadItem::CommandExecution {
            command_actions,
            exit_code,
            ..
        } => Some(ActivityDetail::Exploration {
            actions: command_actions.clone(),
            exit_code: *exit_code,
        }),
        ThreadItem::McpToolCall {
            arguments,
            result,
            error,
            ..
        } => Some(ActivityDetail::Computer(computer_activity_facts(
            arguments,
            result.as_deref(),
            error.as_ref(),
        ))),
        _ => None,
    }
}

fn command_text(command: &str, output: Option<&str>, streaming: bool) -> String {
    let mut text = command.to_string();
    if let Some(output) = output.filter(|output| !output.is_empty()) {
        if !text.ends_with('\n') {
            text.push('\n');
        }
        text.push_str(output);
    } else if streaming && !text.ends_with('\n') {
        text.push('\n');
    }
    text
}

fn patch_summary(changes: &[app_server_protocol::protocol::v2::FileUpdateChange]) -> Vec<String> {
    let mut added = 0;
    let mut deleted = 0;
    let mut updated = 0;
    for change in changes {
        match &change.kind {
            PatchChangeKind::Add => added += 1,
            PatchChangeKind::Delete => deleted += 1,
            PatchChangeKind::Update { .. } => updated += 1,
        }
    }
    let mut details = vec![format!("files: {}", changes.len())];
    if added > 0 {
        details.push(format!("added: {added}"));
    }
    if deleted > 0 {
        details.push(format!("deleted: {deleted}"));
    }
    if updated > 0 {
        details.push(format!("updated: {updated}"));
    }
    details
}

pub(super) fn dynamic_summary(
    content_items: Option<&[app_server_protocol::protocol::v2::DynamicToolCallOutputContentItem]>,
    success: Option<bool>,
    duration_ms: Option<i64>,
) -> Vec<String> {
    let mut details = Vec::new();
    if let Some(success) = success {
        details.push(format!("success: {success}"));
    }
    if let Some(content_items) = content_items {
        details.push(format!("content items: {}", content_items.len()));
        details.extend(dynamic_content_previews(content_items));
    }
    if let Some(duration_ms) = duration_ms {
        details.push(format!("duration {duration_ms}ms"));
    }
    details
}

fn dynamic_content_previews(
    content_items: &[app_server_protocol::protocol::v2::DynamicToolCallOutputContentItem],
) -> Vec<String> {
    content_items
        .iter()
        .filter_map(|item| match item {
            app_server_protocol::protocol::v2::DynamicToolCallOutputContentItem::InputText {
                text,
            } if !text.trim().is_empty() => Some(format!("output: {}", compact_text(text))),
            _ => None,
        })
        .take(4)
        .collect()
}

fn command_entry_status(status: CommandExecutionStatus) -> EntryStatus {
    match status {
        CommandExecutionStatus::InProgress => EntryStatus::Running,
        CommandExecutionStatus::Completed => EntryStatus::Completed,
        CommandExecutionStatus::Failed => EntryStatus::Failed,
        CommandExecutionStatus::Declined => EntryStatus::Declined,
    }
}

fn patch_entry_status(status: PatchApplyStatus) -> EntryStatus {
    match status {
        PatchApplyStatus::InProgress => EntryStatus::Running,
        PatchApplyStatus::Completed => EntryStatus::Completed,
        PatchApplyStatus::Failed => EntryStatus::Failed,
        PatchApplyStatus::Declined => EntryStatus::Declined,
    }
}

fn mcp_entry_status(status: McpToolCallStatus) -> EntryStatus {
    match status {
        McpToolCallStatus::InProgress => EntryStatus::Running,
        McpToolCallStatus::Completed => EntryStatus::Completed,
        McpToolCallStatus::Failed => EntryStatus::Failed,
    }
}

fn dynamic_entry_status(status: DynamicToolCallStatus) -> EntryStatus {
    match status {
        DynamicToolCallStatus::InProgress => EntryStatus::Running,
        DynamicToolCallStatus::Completed => EntryStatus::Completed,
        DynamicToolCallStatus::Failed => EntryStatus::Failed,
    }
}

fn collab_entry_status(status: CollabAgentToolCallStatus) -> EntryStatus {
    match status {
        CollabAgentToolCallStatus::InProgress => EntryStatus::Running,
        CollabAgentToolCallStatus::Completed => EntryStatus::Completed,
        CollabAgentToolCallStatus::Failed => EntryStatus::Failed,
    }
}

fn image_generation_status(status: &str) -> Option<EntryStatus> {
    match status.to_ascii_lowercase().as_str() {
        "in_progress" | "in-progress" | "running" => Some(EntryStatus::Running),
        "completed" | "succeeded" | "success" => Some(EntryStatus::Completed),
        "failed" | "error" => Some(EntryStatus::Failed),
        "declined" => Some(EntryStatus::Declined),
        _ => None,
    }
}

pub(super) fn format_patch(
    changes: &[app_server_protocol::protocol::v2::FileUpdateChange],
) -> String {
    changes
        .iter()
        .map(|change| {
            let (kind, move_path) = match &change.kind {
                app_server_protocol::protocol::v2::PatchChangeKind::Add => ("added", None),
                app_server_protocol::protocol::v2::PatchChangeKind::Delete => ("deleted", None),
                app_server_protocol::protocol::v2::PatchChangeKind::Update { move_path } => {
                    ("updated", move_path.as_deref())
                }
            };
            let path = move_path
                .filter(|path| !path.trim().is_empty())
                .map(|path| format!("{} → {path}", change.path))
                .unwrap_or_else(|| change.path.clone());
            if change.diff.trim().is_empty() {
                format!("{kind} {path}")
            } else {
                format!("{kind} {path}\n{}", change.diff)
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn user_input_projection(content: &[UserInput]) -> (String, Vec<String>) {
    let mut text = Vec::new();
    let mut image_count = 0usize;

    for input in content {
        match input {
            UserInput::Text { text: value, .. } => text.push(value.clone()),
            UserInput::Image { .. } | UserInput::LocalImage { .. } => {
                image_count += 1;
            }
            UserInput::Skill { name, .. } => text.push(format!("[skill: {name}]")),
            UserInput::Mention { name, .. } => text.push(format!("[@{name}]")),
        }
    }

    let summary = (1..=image_count)
        .map(|index| format!("image: {index}"))
        .collect();
    (text.join("\n"), summary)
}
