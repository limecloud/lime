use agent_protocol::response_item::MessagePhase;
use app_server_protocol::protocol::v2::{
    CommandAction, HookRunStatus, ServerNotification, ThreadItem, TurnStatus,
};
use std::collections::{HashMap, HashSet};

use crate::history_cell::ComputerActivityFacts;
use crate::history_filter::{
    filter_review_mode_items, filter_review_mode_items_with_state, filter_user_message_ids,
};

use items::{format_patch, project_item, project_item_with_scope, WebSearchLifecycle};

mod history;
mod items;
mod plans;
mod reasoning;
mod streaming;
mod token_usage;

pub(crate) use reasoning::ReasoningSummary;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EntryKind {
    User,
    Assistant,
    Reasoning,
    Command,
    Patch,
    Mcp,
    Plan,
    MultiAgent,
    Tool,
    Warning,
    Error,
    System,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EntryStatus {
    Running,
    Completed,
    Failed,
    Declined,
    Interrupted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ActivityGroupKind {
    Exploration,
    Computer,
}

/// Render-only grouping key derived from canonical item facts and a canonical turn boundary.
///
/// The key never crosses the App Server protocol or persistence boundary. Transcript surfaces use
/// it only to combine adjacent compatible activities while retaining every canonical item id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ActivityGroupKey {
    pub(crate) kind: ActivityGroupKind,
    pub(crate) scope: String,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum ActivityDetail {
    Exploration {
        actions: Vec<CommandAction>,
        exit_code: Option<i32>,
    },
    Computer(ComputerActivityFacts),
    /// Transcript-only reasoning may stay inside the preceding activity when this canonical
    /// turn scope matches. Structured parts retain status and placeholder boundaries; entry text
    /// is the renderable body derived from these facts.
    Reasoning {
        scope: String,
        summary: ReasoningSummary,
    },
}

// `CommandAction` contains only strings and optional strings, but the protocol type intentionally
// derives only `PartialEq`. The render-only projection can still promise equivalence safely.
impl Eq for ActivityDetail {}

impl ActivityGroupKey {
    pub(crate) fn new(kind: ActivityGroupKind, scope: impl Into<String>) -> Self {
        Self {
            kind,
            scope: scope.into(),
        }
    }
}

impl EntryStatus {
    pub(crate) const fn label(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Declined => "declined",
            Self::Interrupted => "interrupted",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TranscriptEntry {
    pub(crate) id: String,
    pub(crate) kind: EntryKind,
    pub(crate) text: String,
    pub(crate) streaming: bool,
    pub(crate) status: Option<EntryStatus>,
    /// Stable, display-ready facts derived from the canonical item payload.
    pub(crate) summary: Vec<String>,
    /// Adjacent activity entries may share a disclosure group only when this full key matches.
    pub(crate) activity_group: Option<ActivityGroupKey>,
    /// Structured canonical facts used by grouped compact presentation.
    pub(crate) activity_detail: Option<ActivityDetail>,
}

/// Completion metadata is attached to the last visible item of a completed turn.
///
/// It deliberately lives beside the item projection rather than inside `TranscriptEntry`: a
/// separator is presentation metadata and must not become a fake canonical ThreadItem or leak
/// into transcript export.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CompletionBoundary {
    pub(crate) after_entry_id: String,
    pub(crate) elapsed_seconds: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CompletionMetadata {
    pub(crate) elapsed_seconds: Option<u64>,
}

#[derive(Debug, Clone)]
pub(crate) struct HistoryItemGroup {
    pub(crate) items: Vec<ThreadItem>,
    pub(crate) activity_scope: Option<String>,
    pub(crate) completion: Option<CompletionMetadata>,
}

#[derive(Debug, Default)]
pub(crate) struct ConversationProjection {
    entries: Vec<TranscriptEntry>,
    completion_boundaries: Vec<CompletionBoundary>,
    active_turn_id: Option<String>,
    /// Turn ids whose terminal notification or hydrated canonical record has already settled.
    /// Late stream notifications for these turns must not create new provisional entries.
    closed_turn_ids: HashSet<String>,
    status: String,
    /// Latest usable reasoning summary while the active turn is still running.
    reasoning_status: Option<String>,
    /// Host-owned recovery intent, never a canonical item completion fact.
    resumed_reasoning: Option<history::ResumedReasoning>,
    review_mode: bool,
    active_hooks: Vec<ActiveHook>,
    /// Explicit assistant phases keyed by canonical item id. Legacy items
    /// omit this field and retain the historical final-answer behavior.
    assistant_phases: HashMap<String, MessagePhase>,
    last_plan_progress: Option<plans::PlanProgress>,
    token_usage: token_usage::TokenUsageState,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ActiveHook {
    id: String,
    turn_id: Option<String>,
    status_message: Option<String>,
}

impl ConversationProjection {
    pub(crate) fn entries(&self) -> &[TranscriptEntry] {
        &self.entries
    }

    pub(crate) fn completion_after(&self, entry_id: &str) -> Option<&CompletionBoundary> {
        self.completion_boundaries
            .iter()
            .find(|boundary| boundary.after_entry_id == entry_id)
    }

    pub(crate) fn add_completion_boundary(
        &mut self,
        after_entry_id: impl Into<String>,
        elapsed_seconds: Option<u64>,
    ) {
        let after_entry_id = after_entry_id.into();
        if self
            .completion_boundaries
            .iter()
            .any(|boundary| boundary.after_entry_id == after_entry_id)
        {
            return;
        }
        self.completion_boundaries.push(CompletionBoundary {
            after_entry_id,
            elapsed_seconds,
        });
    }

    /// Remove entries previously projected from a page whose canonical review classification was
    /// completed only after loading adjacent Turn metadata.
    pub(crate) fn remove_hidden_entries(&mut self, hidden_ids: &HashSet<String>) {
        if hidden_ids.is_empty() {
            return;
        }
        self.entries.retain(|entry| !hidden_ids.contains(&entry.id));
        self.completion_boundaries
            .retain(|boundary| !hidden_ids.contains(&boundary.after_entry_id));
    }

    pub(crate) fn active_turn_id(&self) -> Option<&str> {
        self.active_turn_id.as_deref()
    }

    pub(crate) fn status(&self) -> &str {
        if let Some(hook) = self.hook_status_message() {
            return hook;
        }
        if self.active_turn_id.is_some() {
            if let Some(reasoning) = self.reasoning_status.as_deref() {
                return reasoning;
            }
        }
        &self.status
    }

    /// Returns the active hook summary for the status indicator, if any.
    ///
    /// Hook state remains owned by the canonical projection; the view only consumes this
    /// display-ready string and never inspects individual protocol notifications.
    pub(crate) fn hook_status_message(&self) -> Option<&str> {
        if self.active_hooks.is_empty() {
            return None;
        }
        let first = self.active_hooks[0]
            .status_message
            .as_deref()
            .map(str::trim)
            .filter(|message| !message.is_empty());
        if self.active_hooks.len() == 1 {
            return first.or(Some("running hook"));
        }
        if first.is_some()
            && self
                .active_hooks
                .iter()
                .all(|hook| hook.status_message.as_deref().map(str::trim) == first)
        {
            return first;
        }
        Some("running hooks")
    }

    pub(crate) fn set_status(&mut self, status: impl Into<String>) {
        self.reasoning_status = None;
        self.status = status.into();
    }

    pub(crate) fn add_warning_message(&mut self, message: impl Into<String>) {
        self.push_notice(EntryKind::Warning, message.into());
    }

    pub(crate) fn add_info_message(&mut self, message: impl Into<String>) {
        self.push_notice(EntryKind::System, message.into());
    }

    pub(crate) fn add_error_message(&mut self, message: impl Into<String>) {
        self.push_notice(EntryKind::Error, message.into());
    }

    pub(crate) fn start_turn(&mut self, turn_id: String) {
        self.finish_resumed_reasoning();
        self.token_usage.note_turn_id(&turn_id);
        self.reasoning_status = None;
        self.active_turn_id = Some(turn_id);
        self.status = "running".to_string();
    }

    pub(crate) fn final_answer(&self) -> String {
        self.entries
            .iter()
            .rev()
            .find(|entry| {
                entry.kind == EntryKind::Assistant
                    && !entry.text.is_empty()
                    && self.assistant_phases.get(&entry.id) != Some(&MessagePhase::Commentary)
            })
            .map(|entry| entry.text.clone())
            .unwrap_or_default()
    }

    /// Prepend older canonical items while preserving transcript order.
    pub(crate) fn prepend_items(&mut self, items: impl IntoIterator<Item = ThreadItem>) {
        let items = filter_review_mode_items(&items.into_iter().collect::<Vec<_>>());
        let mut older = Vec::new();
        for item in items {
            self.record_assistant_phase(&item);
            if let Some(entry) = project_item(&item, false) {
                if !self.entries.iter().any(|current| current.id == entry.id) {
                    older.push(entry);
                }
            }
        }
        if older.is_empty() {
            return;
        }
        older.append(&mut self.entries);
        self.entries = older;
    }

    /// Prepend grouped history while applying canonical-id review filtering from Turn metadata.
    ///
    /// The completion boundary is resolved against the original group tail before filtering, so
    /// hiding a canonical user message cannot move a separator onto a previous visible item.
    pub(crate) fn prepend_grouped_items_with_hidden_ids(
        &mut self,
        groups: impl IntoIterator<Item = HistoryItemGroup>,
        hidden_ids: &HashSet<String>,
    ) {
        let mut older = Vec::new();
        let mut boundaries = Vec::new();
        for group in groups {
            let HistoryItemGroup {
                items,
                activity_scope,
                completion,
            } = group;
            let final_entry_id = items
                .last()
                .and_then(|item| project_item(item, false).map(|entry| entry.id));
            let filtered = filter_user_message_ids(&filter_review_mode_items(&items), hidden_ids);
            for item in filtered {
                self.record_assistant_phase(&item);
                if let Some(entry) = project_item_with_scope(
                    &item,
                    false,
                    WebSearchLifecycle::Historical,
                    activity_scope.as_deref(),
                ) {
                    if !self.entries.iter().any(|current| current.id == entry.id)
                        && !older
                            .iter()
                            .any(|current: &TranscriptEntry| current.id == entry.id)
                    {
                        older.push(entry);
                    }
                }
            }
            if let (Some(final_entry_id), Some(completion)) = (final_entry_id, completion) {
                if self.entries.iter().any(|entry| entry.id == final_entry_id)
                    || older.iter().any(|entry| entry.id == final_entry_id)
                {
                    boundaries.push(CompletionBoundary {
                        after_entry_id: final_entry_id,
                        elapsed_seconds: completion.elapsed_seconds,
                    });
                }
            }
        }
        if !older.is_empty() {
            older.append(&mut self.entries);
            self.entries = older;
        }
        boundaries.retain(|boundary| {
            !self
                .completion_boundaries
                .iter()
                .any(|known| known.after_entry_id == boundary.after_entry_id)
        });
        boundaries.append(&mut self.completion_boundaries);
        self.completion_boundaries = boundaries;
    }

    pub(crate) fn apply(&mut self, notification: ServerNotification) {
        if !self.recover_resumed_reasoning(&notification) {
            return;
        }
        match notification {
            ServerNotification::TurnStarted(params) => {
                self.finish_resumed_reasoning();
                self.token_usage
                    .begin_turn(&params.thread_id, &params.turn.id);
                self.closed_turn_ids.remove(&params.turn.id);
                self.reasoning_status = None;
                self.active_turn_id = Some(params.turn.id);
                self.status = "running".to_string();
            }
            ServerNotification::TurnCompleted(params) => {
                self.finish_resumed_reasoning();
                self.active_turn_id = None;
                self.reasoning_status = None;
                self.active_hooks
                    .retain(|hook| hook.turn_id.as_deref() != Some(params.turn.id.as_str()));
                // The terminal client may miss an item delta or item/completed
                // notification while the transport is reconnecting. The
                // completed turn is the canonical repair point for those
                // transcript entries.
                let web_search_lifecycle = match params.turn.status {
                    TurnStatus::Completed => WebSearchLifecycle::Completed,
                    TurnStatus::Interrupted | TurnStatus::Failed | TurnStatus::InProgress => {
                        WebSearchLifecycle::Historical
                    }
                };
                self.merge_canonical_items(
                    &params.turn.items,
                    web_search_lifecycle,
                    &params.turn.id,
                );
                if params.turn.status == TurnStatus::Completed {
                    let last_entry_id = params.turn.items.last().and_then(|item| {
                        project_item(item, false)
                            .map(|entry| entry.id)
                            .filter(|id| self.entries.iter().any(|current| current.id == *id))
                    });
                    if let Some(entry_id) = last_entry_id {
                        self.add_completion_boundary(
                            entry_id,
                            params
                                .turn
                                .duration_ms
                                .and_then(|duration| u64::try_from(duration).ok())
                                .map(|duration| duration / 1_000),
                        );
                    }
                }
                self.settle_running_entries(params.turn.status);
                if matches!(
                    params.turn.status,
                    TurnStatus::Completed | TurnStatus::Failed | TurnStatus::Interrupted
                ) {
                    self.closed_turn_ids.insert(params.turn.id.clone());
                }
                self.status = turn_status(params.turn.status).to_string();
            }
            ServerNotification::ItemStarted(params) => {
                if self.closed_turn_ids.contains(&params.turn_id) {
                    return;
                }
                if self.should_hide_realtime_item(&params.item) {
                    return;
                }
                if let Some(entry) = project_item_with_scope(
                    &params.item,
                    true,
                    WebSearchLifecycle::Started,
                    Some(&params.turn_id),
                ) {
                    self.remember_reasoning_status(&params.turn_id, &entry);
                    self.record_assistant_phase(&params.item);
                    self.replace_entry(entry);
                }
            }
            ServerNotification::ItemCompleted(params) => {
                if self.should_hide_realtime_item(&params.item) {
                    return;
                }
                if let Some(entry) = project_item_with_scope(
                    &params.item,
                    false,
                    WebSearchLifecycle::Completed,
                    Some(&params.turn_id),
                ) {
                    self.remember_reasoning_status(&params.turn_id, &entry);
                    self.record_assistant_phase(&params.item);
                    self.replace_entry(entry);
                }
            }
            ServerNotification::AgentMessageDelta(params) => {
                self.append_delta(
                    params.turn_id,
                    params.item_id,
                    EntryKind::Assistant,
                    params.delta,
                );
            }
            ServerNotification::ReasoningSummaryTextDelta(params) => {
                self.append_reasoning_summary(
                    params.turn_id,
                    params.item_id,
                    params.summary_index,
                    params.delta,
                );
            }
            ServerNotification::ReasoningSummaryPartAdded(params) => {
                self.append_reasoning_summary(
                    params.turn_id,
                    params.item_id,
                    params.summary_index,
                    String::new(),
                );
            }
            // Codex hides raw reasoning by default; only typed summary deltas drive this surface.
            ServerNotification::ReasoningTextDelta(_) => {}
            ServerNotification::PlanDelta(params) => {
                self.append_delta(
                    params.turn_id,
                    params.item_id,
                    EntryKind::Plan,
                    params.delta,
                );
            }
            ServerNotification::CommandExecutionOutputDelta(params) => {
                self.append_delta(
                    params.turn_id,
                    params.item_id,
                    EntryKind::Command,
                    params.delta,
                );
            }
            ServerNotification::FileChangePatchUpdated(params) => {
                if self.closed_turn_ids.contains(&params.turn_id) {
                    return;
                }
                self.replace_entry(TranscriptEntry {
                    id: params.item_id,
                    kind: EntryKind::Patch,
                    text: format_patch(&params.changes),
                    streaming: true,
                    status: Some(EntryStatus::Running),
                    summary: Vec::new(),
                    activity_group: None,
                    activity_detail: None,
                });
            }
            ServerNotification::TurnDiffUpdated(params) => {
                if self.closed_turn_ids.contains(&params.turn_id) {
                    return;
                }
                self.replace_entry(TranscriptEntry {
                    id: format!("turn-{}-diff", params.turn_id),
                    kind: EntryKind::Patch,
                    text: params.diff,
                    streaming: true,
                    status: Some(EntryStatus::Running),
                    summary: Vec::new(),
                    activity_group: None,
                    activity_detail: None,
                });
            }
            ServerNotification::TurnPlanUpdated(params) => self.project_plan_update(params),
            ServerNotification::ThreadTokenUsageUpdated(params) => self.token_usage.update(params),
            ServerNotification::Warning(params) => {
                self.push_notice(EntryKind::Warning, params.message);
            }
            ServerNotification::Error(params) => {
                self.reasoning_status = None;
                self.status = if params.will_retry {
                    "retrying".to_string()
                } else {
                    "failed".to_string()
                };
                self.push_notice(EntryKind::Error, params.error.message);
            }
            ServerNotification::HookStarted(params) => {
                self.start_hook(params.turn_id, params.run);
            }
            ServerNotification::HookCompleted(params) => {
                self.complete_hook(params.run);
            }
            _ => {}
        }
    }

    fn start_hook(
        &mut self,
        turn_id: Option<String>,
        run: app_server_protocol::protocol::v2::HookRunSummary,
    ) {
        if run.status != HookRunStatus::Running {
            return;
        }
        if let Some(existing) = self.active_hooks.iter_mut().find(|hook| hook.id == run.id) {
            existing.turn_id = turn_id;
            existing.status_message = run.status_message;
            return;
        }
        self.active_hooks.push(ActiveHook {
            id: run.id,
            turn_id,
            status_message: run.status_message,
        });
    }

    fn complete_hook(&mut self, run: app_server_protocol::protocol::v2::HookRunSummary) {
        self.active_hooks.retain(|hook| hook.id != run.id);
        let Some(text) = crate::history_cell::status_text(run.status) else {
            return;
        };
        if crate::history_cell::is_quiet_success(&run) {
            return;
        }
        let status = match run.status {
            HookRunStatus::Completed => EntryStatus::Completed,
            HookRunStatus::Running => EntryStatus::Running,
            HookRunStatus::Failed | HookRunStatus::Blocked | HookRunStatus::Stopped => {
                EntryStatus::Failed
            }
        };
        self.replace_entry(TranscriptEntry {
            id: format!("hook-{}", run.id),
            kind: EntryKind::System,
            text: text.to_string(),
            streaming: false,
            status: Some(status),
            summary: crate::history_cell::output_details(&run),
            activity_group: None,
            activity_detail: None,
        });
    }

    fn update_review_mode(&mut self, item: &ThreadItem) {
        match item {
            ThreadItem::EnteredReviewMode { .. } => self.review_mode = true,
            ThreadItem::ExitedReviewMode { .. } => self.review_mode = false,
            _ => {}
        }
    }

    fn should_hide_realtime_item(&mut self, item: &ThreadItem) -> bool {
        let hidden = matches!(item, ThreadItem::UserMessage { .. }) && self.review_mode;
        self.update_review_mode(item);
        hidden
    }

    fn replace_entry(&mut self, entry: TranscriptEntry) {
        if let Some(current) = self
            .entries
            .iter_mut()
            .find(|current| current.id == entry.id)
        {
            *current = entry;
        } else {
            self.entries.push(entry);
        }
    }

    fn merge_canonical_items(
        &mut self,
        items: &[ThreadItem],
        web_search_lifecycle: WebSearchLifecycle,
        activity_scope: &str,
    ) {
        let initial_review_mode = self.review_mode;
        let filtered = filter_review_mode_items_with_state(items, initial_review_mode);
        for item in items {
            self.update_review_mode(item);
            self.record_assistant_phase(item);
        }
        let projected = filtered
            .iter()
            .filter_map(|item| {
                project_item_with_scope(item, false, web_search_lifecycle, Some(activity_scope))
            })
            .collect::<Vec<_>>();

        for (index, entry) in projected.into_iter().enumerate() {
            if let Some(current) = self
                .entries
                .iter_mut()
                .find(|current| current.id == entry.id)
            {
                *current = entry;
                continue;
            }

            // Place a repaired item next to the nearest canonical neighbor so
            // a missing user message cannot appear after its assistant reply.
            let next_index = filtered
                .iter()
                .skip(index + 1)
                .filter_map(projected_item_id)
                .find_map(|id| self.entries.iter().position(|current| current.id == id));
            let previous_index = filtered
                .iter()
                .take(index)
                .filter_map(projected_item_id)
                .rev()
                .find_map(|id| self.entries.iter().position(|current| current.id == id));
            let insert_at = next_index
                .or_else(|| previous_index.map(|position| position + 1))
                .unwrap_or(self.entries.len());
            self.entries.insert(insert_at, entry);
        }
    }

    fn push_notice(&mut self, kind: EntryKind, text: String) {
        debug_assert!(matches!(
            kind,
            EntryKind::Warning | EntryKind::Error | EntryKind::System
        ));
        self.entries.push(TranscriptEntry {
            id: format!("system-{}", self.entries.len()),
            kind,
            text,
            streaming: false,
            status: None,
            summary: Vec::new(),
            activity_group: None,
            activity_detail: None,
        });
    }

    fn record_assistant_phase(&mut self, item: &ThreadItem) {
        if let ThreadItem::AgentMessage { id, phase, .. } = item {
            match phase {
                Some(phase) => {
                    self.assistant_phases.insert(id.clone(), phase.clone());
                }
                None => {
                    self.assistant_phases.remove(id);
                }
            }
        }
    }

    fn settle_running_entries(&mut self, status: TurnStatus) {
        let Some(entry_status) = (match status {
            TurnStatus::Completed => Some(EntryStatus::Completed),
            TurnStatus::Failed => Some(EntryStatus::Failed),
            TurnStatus::Interrupted => Some(EntryStatus::Interrupted),
            TurnStatus::InProgress => None,
        }) else {
            return;
        };

        for entry in &mut self.entries {
            if entry.status == Some(EntryStatus::Running) {
                entry.status = Some(entry_status);
            }
            // Assistant and reasoning entries intentionally have no running status, but they
            // still carry a provisional stream flag. A terminal turn closes those tails too.
            entry.streaming = false;
        }
    }
}

fn projected_item_id(item: &ThreadItem) -> Option<String> {
    project_item(item, false).map(|entry| entry.id)
}

fn turn_status(status: TurnStatus) -> &'static str {
    match status {
        TurnStatus::Completed => "ready",
        TurnStatus::Interrupted => "interrupted",
        TurnStatus::Failed => "failed",
        TurnStatus::InProgress => "running",
    }
}

#[cfg(test)]
fn mcp_content_previews(content: &[serde_json::Value]) -> Vec<String> {
    crate::history_cell::content_previews(content)
}

#[cfg(test)]
#[path = "projection_tests.rs"]
mod tests;
