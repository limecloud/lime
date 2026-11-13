//! Helpers for rendering and navigating multi-agent state in the TUI.
//!
//! This module owns the presentation shape for collaboration tool calls and sub-agent activity.
//! Thread scheduling, lifecycle, and persistence remain App Server responsibilities.

use std::collections::HashMap;

use app_server_protocol::protocol::v2::{
    CollabAgentState, CollabAgentStatus, CollabAgentTool, CollabAgentToolCallStatus,
    ReasoningEffort, SubAgentActivityKind, ThreadItem,
};
use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};

const COLLAB_PROMPT_PREVIEW_GRAPHEMES: usize = 160;
const COLLAB_AGENT_ERROR_PREVIEW_GRAPHEMES: usize = 160;
const COLLAB_AGENT_RESPONSE_PREVIEW_GRAPHEMES: usize = 240;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SubAgentActivityDisplay {
    pub(crate) thread_id: String,
    pub(crate) agent_path: String,
    pub(crate) is_running_hint: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AgentPickerThreadEntry {
    pub(crate) agent_nickname: Option<String>,
    pub(crate) agent_role: Option<String>,
    pub(crate) agent_path: Option<String>,
    pub(crate) is_running: bool,
    pub(crate) is_closed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SpawnRequestSummary {
    pub(crate) model: String,
    pub(crate) reasoning_effort: ReasoningEffort,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MultiAgentHistoryCell {
    pub(crate) title: String,
    pub(crate) details: Vec<String>,
}

pub(crate) fn format_agent_picker_item_name(
    agent_nickname: Option<&str>,
    agent_role: Option<&str>,
    is_primary: bool,
) -> String {
    if is_primary {
        return "Main [default]".to_string();
    }

    let agent_nickname = agent_nickname
        .map(str::trim)
        .filter(|nickname| !nickname.is_empty());
    let agent_role = agent_role.map(str::trim).filter(|role| !role.is_empty());
    match (agent_nickname, agent_role) {
        (Some(agent_nickname), Some(agent_role)) => format!("{agent_nickname} [{agent_role}]"),
        (Some(agent_nickname), None) => agent_nickname.to_string(),
        (None, Some(agent_role)) => format!("[{agent_role}]"),
        (None, None) => "Agent".to_string(),
    }
}

pub(crate) fn previous_agent_shortcut() -> KeyCode {
    KeyCode::Left
}

pub(crate) fn next_agent_shortcut() -> KeyCode {
    KeyCode::Right
}

pub(crate) fn previous_agent_shortcut_matches(
    key_event: KeyEvent,
    allow_word_motion_fallback: bool,
) -> bool {
    (key_event.kind == KeyEventKind::Press
        && key_event.code == previous_agent_shortcut()
        && key_event.modifiers.contains(KeyModifiers::ALT))
        || (cfg!(target_os = "macos")
            && allow_word_motion_fallback
            && key_event.kind == KeyEventKind::Press
            && key_event.code == KeyCode::Char('b')
            && key_event.modifiers.contains(KeyModifiers::ALT))
}

pub(crate) fn next_agent_shortcut_matches(
    key_event: KeyEvent,
    allow_word_motion_fallback: bool,
) -> bool {
    (key_event.kind == KeyEventKind::Press
        && key_event.code == next_agent_shortcut()
        && key_event.modifiers.contains(KeyModifiers::ALT))
        || (cfg!(target_os = "macos")
            && allow_word_motion_fallback
            && key_event.kind == KeyEventKind::Press
            && key_event.code == KeyCode::Char('f')
            && key_event.modifiers.contains(KeyModifiers::ALT))
}

pub(crate) fn spawn_request_summary(item: &ThreadItem) -> Option<SpawnRequestSummary> {
    match item {
        ThreadItem::CollabAgentToolCall {
            tool: CollabAgentTool::SpawnAgent,
            model: Some(model),
            reasoning_effort: Some(reasoning_effort),
            ..
        } => Some(SpawnRequestSummary {
            model: model.clone(),
            reasoning_effort: reasoning_effort.clone(),
        }),
        _ => None,
    }
}

pub(crate) fn tool_call_history_cell(item: &ThreadItem) -> Option<MultiAgentHistoryCell> {
    let ThreadItem::CollabAgentToolCall {
        tool,
        status,
        receiver_thread_ids,
        prompt,
        agents_states,
        ..
    } = item
    else {
        return None;
    };

    let receiver = receiver_thread_ids
        .first()
        .map(String::as_str)
        .unwrap_or("agents");
    let title = match (tool, status) {
        (CollabAgentTool::SpawnAgent, CollabAgentToolCallStatus::InProgress) => return None,
        (CollabAgentTool::SpawnAgent, _) => format!("Spawned {receiver}"),
        (CollabAgentTool::SendInput, CollabAgentToolCallStatus::InProgress) => return None,
        (CollabAgentTool::SendInput, _) => format!("Sent input to {receiver}"),
        (CollabAgentTool::ResumeAgent, CollabAgentToolCallStatus::InProgress) => {
            format!("Resuming {receiver}")
        }
        (CollabAgentTool::ResumeAgent, _) => format!("Resumed {receiver}"),
        (CollabAgentTool::Wait, CollabAgentToolCallStatus::InProgress) => {
            if receiver_thread_ids.len() == 1 {
                format!("Waiting for {receiver}")
            } else {
                format!("Waiting for {} agents", receiver_thread_ids.len())
            }
        }
        (CollabAgentTool::Wait, _) => "Finished waiting".to_string(),
        (CollabAgentTool::CloseAgent, CollabAgentToolCallStatus::InProgress) => return None,
        (CollabAgentTool::CloseAgent, _) => format!("Closed {receiver}"),
    };

    let mut details = Vec::new();
    if let Some(prompt) = prompt_line(prompt.as_deref().unwrap_or_default()) {
        details.push(prompt);
    }
    if matches!(tool, CollabAgentTool::SpawnAgent) {
        if let Some(spawn_request) = spawn_request_summary(item) {
            details.push(format!(
                "model: {} effort: {}",
                compact_text(&spawn_request.model, COLLAB_PROMPT_PREVIEW_GRAPHEMES),
                spawn_request.reasoning_effort.as_str()
            ));
        }
    }
    if matches!(tool, CollabAgentTool::Wait)
        && !matches!(status, CollabAgentToolCallStatus::InProgress)
    {
        details.extend(wait_complete_lines(receiver_thread_ids, agents_states));
    }
    if matches!(tool, CollabAgentTool::ResumeAgent)
        && !matches!(status, CollabAgentToolCallStatus::InProgress)
    {
        details.push(
            receiver_thread_ids
                .first()
                .and_then(|id| agents_states.get(id))
                .map_or_else(
                    || "Error - Agent resume failed".to_string(),
                    status_summary_text,
                ),
        );
    }

    Some(MultiAgentHistoryCell { title, details })
}

pub(crate) fn sub_agent_activity_display(item: &ThreadItem) -> Option<SubAgentActivityDisplay> {
    let ThreadItem::SubAgentActivity {
        kind,
        agent_thread_id,
        agent_path,
        ..
    } = item
    else {
        return None;
    };
    let is_running_hint = match kind {
        SubAgentActivityKind::Started => true,
        SubAgentActivityKind::Interacted => return None,
        SubAgentActivityKind::Interrupted => false,
    };
    Some(SubAgentActivityDisplay {
        thread_id: agent_thread_id.clone(),
        agent_path: agent_path.clone(),
        is_running_hint,
    })
}

pub(crate) fn sub_agent_activity_summary(kind: SubAgentActivityKind, agent_path: &str) -> String {
    let prefix = match kind {
        SubAgentActivityKind::Started => "Started",
        SubAgentActivityKind::Interacted => "Interacted with",
        SubAgentActivityKind::Interrupted => "Interrupted",
    };
    format!("{prefix} `{agent_path}`")
}

pub(crate) fn collab_agent_status_label(status: CollabAgentStatus) -> &'static str {
    match status {
        CollabAgentStatus::PendingInit => "pending",
        CollabAgentStatus::Running => "running",
        CollabAgentStatus::Interrupted => "interrupted",
        CollabAgentStatus::Completed => "completed",
        CollabAgentStatus::Errored => "errored",
        CollabAgentStatus::Shutdown => "shutdown",
        CollabAgentStatus::NotFound => "not-found",
    }
}

pub(crate) fn collab_summary(
    agents_states: &HashMap<String, CollabAgentState>,
    prompt: Option<&str>,
    model: Option<&str>,
    reasoning_effort: Option<&ReasoningEffort>,
) -> Vec<String> {
    let mut details = vec![format!("agents: {}", agents_states.len())];
    let mut counts = std::collections::BTreeMap::<&'static str, usize>::new();
    for state in agents_states.values() {
        *counts
            .entry(collab_agent_status_label(state.status))
            .or_default() += 1;
    }
    details.extend(
        counts
            .into_iter()
            .map(|(label, count)| format!("{label}: {count}")),
    );
    if let Some(model) = non_empty(model) {
        details.push(format!("model: {}", compact_text(model, 160)));
    }
    if let Some(reasoning_effort) = reasoning_effort {
        details.push(format!("effort: {}", reasoning_effort.as_str()));
    }
    if let Some(prompt) = non_empty(prompt) {
        details.push(format!(
            "prompt: {}",
            compact_text(prompt, COLLAB_PROMPT_PREVIEW_GRAPHEMES)
        ));
    }
    details
}

/// Build the canonical summary for a collaboration item.
///
/// Status/model facts are useful for every collaboration call, while the history cell owns
/// lifecycle-specific details such as per-agent wait results and resume errors. Keeping this
/// composition here means `ConversationProjection` only maps canonical items and does not need to
/// duplicate 上游 tool lifecycle branching.
pub(crate) fn collab_summary_for_item(item: &ThreadItem) -> Vec<String> {
    let ThreadItem::CollabAgentToolCall {
        agents_states,
        prompt,
        model,
        reasoning_effort,
        ..
    } = item
    else {
        return Vec::new();
    };

    let mut summary = collab_summary(
        agents_states,
        prompt.as_deref(),
        model.as_deref(),
        reasoning_effort.as_ref(),
    );
    let Some(cell) = tool_call_history_cell(item) else {
        return summary;
    };

    for detail in cell.details {
        // Prompt/model/effort are already represented by the stable key/value facts above. The
        // history cell's remaining lines are lifecycle results that are not otherwise visible.
        if detail.starts_with("model: ")
            || summary
                .iter()
                .any(|existing| existing == &format!("prompt: {detail}"))
        {
            continue;
        }
        summary.push(detail);
    }
    summary
}

fn wait_complete_lines(
    receiver_thread_ids: &[String],
    agents_states: &HashMap<String, CollabAgentState>,
) -> Vec<String> {
    let mut ids = receiver_thread_ids.to_vec();
    let extras = agents_states
        .keys()
        .filter(|id| !ids.iter().any(|seen| seen == *id))
        .cloned()
        .collect::<Vec<_>>();
    ids.extend(extras);
    ids.sort();
    ids.dedup();
    if ids.is_empty() {
        return vec!["No agents completed yet".to_string()];
    }
    ids.into_iter()
        .map(|id| {
            let status = agents_states.get(&id).map_or_else(
                || "Error - agent state unavailable".to_string(),
                status_summary_text,
            );
            format!("{id}: {status}")
        })
        .collect()
}

fn status_summary_text(status: &CollabAgentState) -> String {
    match status.status {
        CollabAgentStatus::PendingInit => "Pending init".to_string(),
        CollabAgentStatus::Running => "Running".to_string(),
        CollabAgentStatus::Interrupted => "Interrupted".to_string(),
        CollabAgentStatus::Completed => status.message.as_deref().map_or_else(
            || "Completed".to_string(),
            |message| {
                format!(
                    "Completed - {}",
                    compact_text(message, COLLAB_AGENT_RESPONSE_PREVIEW_GRAPHEMES)
                )
            },
        ),
        CollabAgentStatus::Errored => format!(
            "Error - {}",
            compact_text(
                status.message.as_deref().unwrap_or("Agent errored"),
                COLLAB_AGENT_ERROR_PREVIEW_GRAPHEMES
            )
        ),
        CollabAgentStatus::Shutdown => "Shutdown".to_string(),
        CollabAgentStatus::NotFound => "Not found".to_string(),
    }
}

fn prompt_line(prompt: &str) -> Option<String> {
    let prompt = non_empty(Some(prompt))?;
    Some(compact_text(prompt, COLLAB_PROMPT_PREVIEW_GRAPHEMES))
}

fn compact_text(value: &str, max_graphemes: usize) -> String {
    let value = value.lines().next().unwrap_or(value);
    let mut text = value.chars().take(max_graphemes).collect::<String>();
    if value.chars().count() > max_graphemes {
        text.push_str("...");
    }
    text
}

fn non_empty(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use app_server_protocol::protocol::v2::{CollabAgentTool, ThreadItem};

    fn activity(kind: SubAgentActivityKind) -> ThreadItem {
        ThreadItem::SubAgentActivity {
            id: "activity-1".to_string(),
            kind,
            agent_thread_id: "agent-1".to_string(),
            agent_path: "/root/child".to_string(),
        }
    }

    #[test]
    fn interacted_sub_agent_activity_does_not_change_liveness() {
        assert_eq!(
            sub_agent_activity_display(&activity(SubAgentActivityKind::Interacted)),
            None
        );
    }

    #[test]
    fn interrupted_sub_agent_activity_stops_running_liveness() {
        assert_eq!(
            sub_agent_activity_display(&activity(SubAgentActivityKind::Interrupted)),
            Some(SubAgentActivityDisplay {
                thread_id: "agent-1".to_string(),
                agent_path: "/root/child".to_string(),
                is_running_hint: false,
            })
        );
    }

    #[test]
    fn tool_call_history_cells_cover_collaboration_lifecycle() {
        let mut agents_states = HashMap::new();
        agents_states.insert(
            "agent-1".to_string(),
            CollabAgentState {
                status: CollabAgentStatus::Completed,
                message: Some("39916800".to_string()),
            },
        );
        let item = ThreadItem::CollabAgentToolCall {
            id: "call-wait".to_string(),
            tool: CollabAgentTool::Wait,
            status: CollabAgentToolCallStatus::Completed,
            sender_thread_id: "thread-1".to_string(),
            receiver_thread_ids: vec!["agent-1".to_string()],
            prompt: None,
            model: None,
            reasoning_effort: None,
            agents_states,
        };
        let cell = tool_call_history_cell(&item).expect("wait history cell");
        assert_eq!(cell.title, "Finished waiting");
        assert_eq!(cell.details, vec!["agent-1: Completed - 39916800"]);
    }

    #[test]
    fn spawn_request_summary_preserves_model_and_effort() {
        let effort = ReasoningEffort::new("high").expect("effort");
        let item = ThreadItem::CollabAgentToolCall {
            id: "call-spawn".to_string(),
            tool: CollabAgentTool::SpawnAgent,
            status: CollabAgentToolCallStatus::Completed,
            sender_thread_id: "thread-1".to_string(),
            receiver_thread_ids: vec!["agent-1".to_string()],
            prompt: None,
            model: Some("gpt-5".to_string()),
            reasoning_effort: Some(effort.clone()),
            agents_states: HashMap::new(),
        };
        assert_eq!(
            spawn_request_summary(&item),
            Some(SpawnRequestSummary {
                model: "gpt-5".to_string(),
                reasoning_effort: effort,
            })
        );
    }
}
