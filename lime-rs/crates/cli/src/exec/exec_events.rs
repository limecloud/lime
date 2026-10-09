//! Codex-shaped JSONL output contract, separate from App Server transport DTOs.

use std::collections::HashMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, JsonSchema)]
#[serde(tag = "type")]
pub(super) enum ThreadEvent {
    #[serde(rename = "thread.started")]
    ThreadStarted(ThreadStartedEvent),
    #[serde(rename = "turn.started")]
    TurnStarted(TurnStartedEvent),
    #[serde(rename = "turn.completed")]
    TurnCompleted(TurnCompletedEvent),
    #[serde(rename = "turn.failed")]
    TurnFailed(TurnFailedEvent),
    #[serde(rename = "item.started")]
    ItemStarted(ItemStartedEvent),
    #[serde(rename = "item.updated")]
    ItemUpdated(ItemUpdatedEvent),
    #[serde(rename = "item.completed")]
    ItemCompleted(ItemCompletedEvent),
    #[serde(rename = "error")]
    Error(ThreadErrorEvent),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, JsonSchema)]
pub(super) struct ThreadStartedEvent {
    pub(super) thread_id: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, JsonSchema)]
pub(super) struct TurnStartedEvent {}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, JsonSchema)]
pub(super) struct TurnCompletedEvent {
    pub(super) usage: Usage,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, JsonSchema)]
pub(super) struct TurnFailedEvent {
    pub(super) error: ThreadErrorEvent,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, JsonSchema)]
pub(super) struct Usage {
    pub(super) input_tokens: i64,
    pub(super) cached_input_tokens: i64,
    #[serde(default)]
    pub(super) cache_write_input_tokens: i64,
    pub(super) output_tokens: i64,
    pub(super) reasoning_output_tokens: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, JsonSchema)]
pub(super) struct ItemStartedEvent {
    pub(super) item: ThreadItem,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, JsonSchema)]
pub(super) struct ItemUpdatedEvent {
    pub(super) item: ThreadItem,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, JsonSchema)]
pub(super) struct ItemCompletedEvent {
    pub(super) item: ThreadItem,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, JsonSchema)]
pub(super) struct ThreadErrorEvent {
    pub(super) message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, JsonSchema)]
pub(super) struct ThreadItem {
    pub(super) id: String,
    #[serde(flatten)]
    pub(super) details: ThreadItemDetails,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(super) enum ThreadItemDetails {
    AgentMessage(AgentMessageItem),
    Reasoning(ReasoningItem),
    CommandExecution(CommandExecutionItem),
    FileChange(FileChangeItem),
    McpToolCall(McpToolCallItem),
    CollabToolCall(CollabToolCallItem),
    WebSearch(WebSearchItem),
    TodoList(TodoListItem),
    Error(ErrorItem),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, JsonSchema)]
pub(super) struct AgentMessageItem {
    pub(super) text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, JsonSchema)]
pub(super) struct ReasoningItem {
    pub(super) text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub(super) enum CommandExecutionStatus {
    InProgress,
    Completed,
    Failed,
    Declined,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, JsonSchema)]
pub(super) struct CommandExecutionItem {
    pub(super) command: String,
    pub(super) aggregated_output: String,
    pub(super) exit_code: Option<i32>,
    pub(super) status: CommandExecutionStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub(super) enum PatchApplyStatus {
    InProgress,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub(super) enum PatchChangeKind {
    Add,
    Delete,
    Update,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, JsonSchema)]
pub(super) struct FileUpdateChange {
    pub(super) path: String,
    pub(super) kind: PatchChangeKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, JsonSchema)]
pub(super) struct FileChangeItem {
    pub(super) changes: Vec<FileUpdateChange>,
    pub(super) status: PatchApplyStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub(super) enum McpToolCallStatus {
    InProgress,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, JsonSchema)]
pub(super) struct McpToolCallItemResult {
    pub(super) content: Vec<Value>,
    #[serde(rename = "_meta", skip_serializing_if = "Option::is_none")]
    pub(super) meta: Option<Value>,
    pub(super) structured_content: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, JsonSchema)]
pub(super) struct McpToolCallItemError {
    pub(super) message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, JsonSchema)]
pub(super) struct McpToolCallItem {
    pub(super) server: String,
    pub(super) tool: String,
    #[serde(default)]
    pub(super) arguments: Value,
    pub(super) result: Option<McpToolCallItemResult>,
    pub(super) error: Option<McpToolCallItemError>,
    pub(super) status: McpToolCallStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub(super) enum CollabTool {
    SpawnAgent,
    SendInput,
    Wait,
    CloseAgent,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub(super) enum CollabToolCallStatus {
    InProgress,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub(super) enum CollabAgentStatus {
    PendingInit,
    Running,
    Interrupted,
    Completed,
    Errored,
    Shutdown,
    NotFound,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, JsonSchema)]
pub(super) struct CollabAgentState {
    pub(super) status: CollabAgentStatus,
    pub(super) message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, JsonSchema)]
pub(super) struct CollabToolCallItem {
    pub(super) tool: CollabTool,
    pub(super) sender_thread_id: String,
    pub(super) receiver_thread_ids: Vec<String>,
    pub(super) prompt: Option<String>,
    pub(super) agents_states: HashMap<String, CollabAgentState>,
    pub(super) status: CollabToolCallStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(super) enum WebSearchAction {
    Search {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        query: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        queries: Option<Vec<String>>,
    },
    OpenPage {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        url: Option<String>,
    },
    FindInPage {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        url: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pattern: Option<String>,
    },
    #[serde(other)]
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, JsonSchema)]
pub(super) struct WebSearchItem {
    // The flattened ThreadItem owns id; a second id would emit duplicate JSON keys.
    pub(super) query: String,
    pub(super) action: WebSearchAction,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) results: Option<Vec<Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, JsonSchema)]
pub(super) struct ErrorItem {
    pub(super) message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, JsonSchema)]
pub(super) struct TodoItem {
    pub(super) text: String,
    pub(super) completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, JsonSchema)]
pub(super) struct TodoListItem {
    pub(super) items: Vec<TodoItem>,
}

#[cfg(test)]
pub(super) fn schema() -> schemars::Schema {
    schemars::generate::SchemaSettings::draft2020_12()
        .for_serialize()
        .into_generator()
        .into_root_schema_for::<ThreadEvent>()
}

#[cfg(test)]
#[path = "exec_events_tests.rs"]
mod tests;
