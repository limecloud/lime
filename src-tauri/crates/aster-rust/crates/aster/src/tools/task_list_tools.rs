//! 新版任务板工具
//!
//! 提供与当前任务板语义对齐的一组工具：
//! - `TaskCreate`
//! - `TaskList`
//! - `TaskGet`
//! - `TaskUpdate`

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::{Arc, RwLock};

use super::base::{PermissionCheckResult, Tool};
use super::context::{ToolContext, ToolResult};
use super::error::ToolError;
use crate::session::extension_data::{
    persist_task_board_state, resolve_task_board_state, TaskBoardItem, TaskBoardItemStatus,
    TaskBoardState,
};
use crate::session::{resolve_team_task_list_id, SessionManager};

#[derive(Debug, Default)]
pub struct TaskListStorage {
    storage: RwLock<HashMap<String, TaskBoardState>>,
}

impl TaskListStorage {
    pub fn new() -> Self {
        Self::default()
    }

    fn get(&self, task_list_id: &str) -> Option<TaskBoardState> {
        self.storage.read().unwrap().get(task_list_id).cloned()
    }

    fn set(&self, task_list_id: &str, state: TaskBoardState) {
        self.storage
            .write()
            .unwrap()
            .insert(task_list_id.to_string(), state);
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCreateInput {
    pub subject: String,
    pub description: String,
    #[serde(default, alias = "active_form")]
    pub active_form: Option<String>,
    #[serde(default)]
    pub metadata: Option<BTreeMap<String, Value>>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct TaskListInput {}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskGetInput {
    #[serde(alias = "task_id")]
    pub task_id: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskUpdateStatus {
    Pending,
    InProgress,
    Completed,
    Deleted,
}

impl TaskUpdateStatus {
    fn into_task_status(self) -> Option<TaskBoardItemStatus> {
        match self {
            Self::Pending => Some(TaskBoardItemStatus::Pending),
            Self::InProgress => Some(TaskBoardItemStatus::InProgress),
            Self::Completed => Some(TaskBoardItemStatus::Completed),
            Self::Deleted => None,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskUpdateInput {
    #[serde(alias = "task_id")]
    pub task_id: String,
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default, alias = "active_form")]
    pub active_form: Option<String>,
    #[serde(default)]
    pub status: Option<TaskUpdateStatus>,
    #[serde(default, alias = "add_blocks")]
    pub add_blocks: Option<Vec<String>>,
    #[serde(default, alias = "add_blocked_by")]
    pub add_blocked_by: Option<Vec<String>>,
    #[serde(default)]
    pub owner: Option<String>,
    #[serde(default)]
    pub metadata: Option<BTreeMap<String, Value>>,
}

async fn resolve_task_list_id(context: &ToolContext) -> String {
    if let Some(task_list_id) = context
        .environment
        .get("TASK_LIST_ID")
        .cloned()
        .filter(|value| !value.trim().is_empty())
    {
        return task_list_id;
    }

    if !context.session_id.trim().is_empty() {
        if let Ok(session) = SessionManager::get_session(&context.session_id, false).await {
            if let Some(task_list_id) = resolve_team_task_list_id(&session.extension_data) {
                return task_list_id;
            }
        }

        return context.session_id.clone();
    }

    "main".to_string()
}

fn ensure_non_empty(value: &str, field_name: &str) -> Result<(), ToolError> {
    if value.trim().is_empty() {
        return Err(ToolError::invalid_params(format!("{field_name} 不能为空")));
    }
    Ok(())
}

fn dedupe_ids(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .filter(|value| !value.trim().is_empty())
        .filter(|value| seen.insert(value.clone()))
        .collect()
}

fn normalize_metadata_patch(
    current: Option<BTreeMap<String, Value>>,
    patch: BTreeMap<String, Value>,
) -> Option<BTreeMap<String, Value>> {
    let mut merged = current.unwrap_or_default();
    for (key, value) in patch {
        if value.is_null() {
            merged.remove(&key);
        } else {
            merged.insert(key, value);
        }
    }

    if merged.is_empty() {
        None
    } else {
        Some(merged)
    }
}

fn render_task_summary(task: &TaskBoardItem) -> String {
    let mut lines = vec![
        format!("Task #{}: {}", task.id, task.subject),
        format!("Status: {}", task_status_label(&task.status)),
        format!("Description: {}", task.description),
    ];

    if let Some(owner) = task.owner.as_ref() {
        lines.push(format!("Owner: {owner}"));
    }
    if !task.blocked_by.is_empty() {
        lines.push(format!(
            "Blocked by: {}",
            task.blocked_by
                .iter()
                .map(|id| format!("#{id}"))
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    if !task.blocks.is_empty() {
        lines.push(format!(
            "Blocks: {}",
            task.blocks
                .iter()
                .map(|id| format!("#{id}"))
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }

    lines.join("\n")
}

fn task_status_label(status: &TaskBoardItemStatus) -> &'static str {
    match status {
        TaskBoardItemStatus::Pending => "pending",
        TaskBoardItemStatus::InProgress => "in_progress",
        TaskBoardItemStatus::Completed => "completed",
    }
}

fn is_internal_task(task: &TaskBoardItem) -> bool {
    task.metadata
        .as_ref()
        .and_then(|metadata| metadata.get("_internal"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn build_harness_snapshot(state: &TaskBoardState) -> Vec<Value> {
    state
        .items
        .iter()
        .map(|task| {
            json!({
                "id": task.id.clone(),
                "content": task.subject.clone(),
                "status": task_status_label(&task.status),
            })
        })
        .collect()
}

fn build_task_metadata(task: &TaskBoardItem) -> Value {
    json!({
        "id": task.id.clone(),
        "subject": task.subject.clone(),
        "description": task.description.clone(),
        "activeForm": task.active_form.clone(),
        "status": task_status_label(&task.status),
        "owner": task.owner.clone(),
        "blocks": task.blocks.clone(),
        "blockedBy": task.blocked_by.clone(),
        "metadata": task.metadata.clone(),
    })
}

async fn load_task_board_state(
    storage: &TaskListStorage,
    task_list_id: &str,
    context: &ToolContext,
) -> TaskBoardState {
    if let Ok(session) = SessionManager::get_session(&context.session_id, false).await {
        if let Some(state) = resolve_task_board_state(&session.extension_data) {
            storage.set(task_list_id, state.clone());
            return state;
        }
    }

    storage.get(task_list_id).unwrap_or_default()
}

async fn persist_task_board(
    storage: &TaskListStorage,
    task_list_id: &str,
    context: &ToolContext,
    state: TaskBoardState,
) {
    storage.set(task_list_id, state.clone());

    if let Ok(mut session) = SessionManager::get_session(&context.session_id, false).await {
        if persist_task_board_state(&mut session.extension_data, state).is_ok() {
            let _ = SessionManager::update_session(&context.session_id)
                .extension_data(session.extension_data)
                .apply()
                .await;
        }
    }
}

fn find_task_index(state: &TaskBoardState, task_id: &str) -> Option<usize> {
    state.items.iter().position(|item| item.id == task_id)
}

fn apply_dependency(
    state: &mut TaskBoardState,
    blocker_id: &str,
    blocked_id: &str,
) -> Result<(), ToolError> {
    let Some(blocker_index) = find_task_index(state, blocker_id) else {
        return Err(ToolError::invalid_params(format!(
            "任务未找到: {blocker_id}"
        )));
    };
    let Some(blocked_index) = find_task_index(state, blocked_id) else {
        return Err(ToolError::invalid_params(format!(
            "任务未找到: {blocked_id}"
        )));
    };

    if blocker_index == blocked_index {
        return Ok(());
    }

    let blocker_blocks = dedupe_ids({
        let mut values = state.items[blocker_index].blocks.clone();
        values.push(blocked_id.to_string());
        values
    });
    state.items[blocker_index].blocks = blocker_blocks;

    let blocked_by = dedupe_ids({
        let mut values = state.items[blocked_index].blocked_by.clone();
        values.push(blocker_id.to_string());
        values
    });
    state.items[blocked_index].blocked_by = blocked_by;

    Ok(())
}

fn remove_task_from_dependencies(state: &mut TaskBoardState, task_id: &str) {
    for task in &mut state.items {
        task.blocks.retain(|value| value != task_id);
        task.blocked_by.retain(|value| value != task_id);
    }
}

#[derive(Debug)]
pub struct TaskCreateTool {
    storage: Arc<TaskListStorage>,
}

impl TaskCreateTool {
    pub fn new() -> Self {
        Self {
            storage: Arc::new(TaskListStorage::new()),
        }
    }

    pub fn with_storage(storage: Arc<TaskListStorage>) -> Self {
        Self { storage }
    }
}

impl Default for TaskCreateTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for TaskCreateTool {
    fn name(&self) -> &str {
        "TaskCreate"
    }

    fn description(&self) -> &str {
        "创建新版结构化任务。用于在当前会话中建立可跟踪的任务板条目。"
    }

    fn input_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "subject": {
                    "type": "string",
                    "description": "任务标题"
                },
                "description": {
                    "type": "string",
                    "description": "任务描述"
                },
                "activeForm": {
                    "type": "string",
                    "description": "进行中展示文案（可选）"
                },
                "metadata": {
                    "type": "object",
                    "description": "附加元数据（可选）"
                }
            },
            "required": ["subject", "description"]
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input: TaskCreateInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("参数解析失败: {error}")))?;

        ensure_non_empty(&input.subject, "subject")?;
        ensure_non_empty(&input.description, "description")?;

        let task_list_id = resolve_task_list_id(context).await;
        let mut state = load_task_board_state(&self.storage, &task_list_id, context).await;
        let task_id = state.allocate_id();

        let task = TaskBoardItem {
            id: task_id.clone(),
            subject: input.subject,
            description: input.description,
            active_form: input.active_form.filter(|value| !value.trim().is_empty()),
            status: TaskBoardItemStatus::Pending,
            owner: None,
            blocks: Vec::new(),
            blocked_by: Vec::new(),
            metadata: input.metadata.filter(|value| !value.is_empty()),
        };
        state.items.push(task.clone());
        persist_task_board(&self.storage, &task_list_id, context, state.clone()).await;

        Ok(ToolResult::success(format!(
            "Task #{} created successfully: {}",
            task.id, task.subject
        ))
        .with_metadata("task", build_task_metadata(&task))
        .with_metadata("task_list_id", json!(task_list_id))
        .with_metadata("task_list", json!(build_harness_snapshot(&state)))
        .with_metadata(
            "tasks",
            json!(state
                .items
                .iter()
                .map(build_task_metadata)
                .collect::<Vec<_>>()),
        ))
    }

    async fn check_permissions(
        &self,
        _params: &serde_json::Value,
        _context: &ToolContext,
    ) -> PermissionCheckResult {
        PermissionCheckResult::allow()
    }
}

#[derive(Debug)]
pub struct TaskListTool {
    storage: Arc<TaskListStorage>,
}

impl TaskListTool {
    pub fn new() -> Self {
        Self {
            storage: Arc::new(TaskListStorage::new()),
        }
    }

    pub fn with_storage(storage: Arc<TaskListStorage>) -> Self {
        Self { storage }
    }
}

impl Default for TaskListTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for TaskListTool {
    fn name(&self) -> &str {
        "TaskList"
    }

    fn description(&self) -> &str {
        "列出当前任务板中的全部任务摘要。"
    }

    fn input_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {},
            "additionalProperties": false
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let _: TaskListInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("参数解析失败: {error}")))?;

        let task_list_id = resolve_task_list_id(context).await;
        let state = load_task_board_state(&self.storage, &task_list_id, context).await;
        let visible_tasks = state
            .items
            .iter()
            .filter(|task| !is_internal_task(task))
            .collect::<Vec<_>>();

        if visible_tasks.is_empty() {
            return Ok(ToolResult::success("No tasks found")
                .with_metadata("task_list_id", json!(task_list_id))
                .with_metadata("task_list", json!([]))
                .with_metadata("tasks", json!([])));
        }

        let resolved_task_ids = state
            .items
            .iter()
            .filter(|task| !is_internal_task(task))
            .filter(|task| task.status == TaskBoardItemStatus::Completed)
            .map(|task| task.id.clone())
            .collect::<HashSet<_>>();

        let lines = visible_tasks
            .iter()
            .map(|task| {
                let owner = task
                    .owner
                    .as_ref()
                    .map(|value| format!(" ({value})"))
                    .unwrap_or_default();
                let blocked_by = task
                    .blocked_by
                    .iter()
                    .filter(|id| !resolved_task_ids.contains(*id))
                    .cloned()
                    .collect::<Vec<_>>();
                let blocked_suffix = if blocked_by.is_empty() {
                    String::new()
                } else {
                    format!(
                        " [blocked by {}]",
                        blocked_by
                            .iter()
                            .map(|id| format!("#{id}"))
                            .collect::<Vec<_>>()
                            .join(", ")
                    )
                };

                format!(
                    "#{} [{}] {}{}{}",
                    task.id,
                    task_status_label(&task.status),
                    task.subject,
                    owner,
                    blocked_suffix
                )
            })
            .collect::<Vec<_>>();

        Ok(ToolResult::success(lines.join("\n"))
            .with_metadata("task_list_id", json!(task_list_id))
            .with_metadata(
                "task_list",
                json!(visible_tasks
                    .iter()
                    .map(|task| {
                        json!({
                            "id": task.id.clone(),
                            "content": task.subject.clone(),
                            "status": task_status_label(&task.status),
                        })
                    })
                    .collect::<Vec<_>>()),
            )
            .with_metadata(
                "tasks",
                json!(visible_tasks
                    .iter()
                    .map(|task| build_task_metadata(task))
                    .collect::<Vec<_>>()),
            ))
    }

    async fn check_permissions(
        &self,
        _params: &serde_json::Value,
        _context: &ToolContext,
    ) -> PermissionCheckResult {
        PermissionCheckResult::allow()
    }
}

#[derive(Debug)]
pub struct TaskGetTool {
    storage: Arc<TaskListStorage>,
}

impl TaskGetTool {
    pub fn new() -> Self {
        Self {
            storage: Arc::new(TaskListStorage::new()),
        }
    }

    pub fn with_storage(storage: Arc<TaskListStorage>) -> Self {
        Self { storage }
    }
}

impl Default for TaskGetTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for TaskGetTool {
    fn name(&self) -> &str {
        "TaskGet"
    }

    fn description(&self) -> &str {
        "获取单个任务的完整详情。"
    }

    fn input_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "taskId": {
                    "type": "string",
                    "description": "任务 ID"
                }
            },
            "required": ["taskId"]
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input: TaskGetInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("参数解析失败: {error}")))?;
        ensure_non_empty(&input.task_id, "taskId")?;

        let task_list_id = resolve_task_list_id(context).await;
        let state = load_task_board_state(&self.storage, &task_list_id, context).await;
        let task = state
            .items
            .iter()
            .find(|item| item.id == input.task_id)
            .cloned();

        match task {
            Some(task) => Ok(ToolResult::success(render_task_summary(&task))
                .with_metadata("task", build_task_metadata(&task))
                .with_metadata("task_list_id", json!(task_list_id))
                .with_metadata("task_list", json!(build_harness_snapshot(&state)))),
            None => Ok(ToolResult::success("Task not found")
                .with_metadata("task", Value::Null)
                .with_metadata("task_list_id", json!(task_list_id))
                .with_metadata("task_list", json!(build_harness_snapshot(&state)))),
        }
    }

    async fn check_permissions(
        &self,
        _params: &serde_json::Value,
        _context: &ToolContext,
    ) -> PermissionCheckResult {
        PermissionCheckResult::allow()
    }
}

#[derive(Debug)]
pub struct TaskUpdateTool {
    storage: Arc<TaskListStorage>,
}

impl TaskUpdateTool {
    pub fn new() -> Self {
        Self {
            storage: Arc::new(TaskListStorage::new()),
        }
    }

    pub fn with_storage(storage: Arc<TaskListStorage>) -> Self {
        Self { storage }
    }
}

impl Default for TaskUpdateTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for TaskUpdateTool {
    fn name(&self) -> &str {
        "TaskUpdate"
    }

    fn description(&self) -> &str {
        "更新任务板中的任务状态、描述、依赖或所有者。"
    }

    fn input_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "taskId": {
                    "type": "string",
                    "description": "任务 ID"
                },
                "subject": {
                    "type": "string",
                    "description": "新的任务标题"
                },
                "description": {
                    "type": "string",
                    "description": "新的任务描述"
                },
                "activeForm": {
                    "type": "string",
                    "description": "新的进行中展示文案"
                },
                "status": {
                    "type": "string",
                    "enum": ["pending", "in_progress", "completed", "deleted"]
                },
                "addBlocks": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "当前任务阻塞的任务 ID 列表"
                },
                "addBlockedBy": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "阻塞当前任务的任务 ID 列表"
                },
                "owner": {
                    "type": "string",
                    "description": "任务负责人"
                },
                "metadata": {
                    "type": "object",
                    "description": "合并写入的元数据，值为 null 时表示删除键"
                }
            },
            "required": ["taskId"]
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input: TaskUpdateInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("参数解析失败: {error}")))?;
        ensure_non_empty(&input.task_id, "taskId")?;

        let task_list_id = resolve_task_list_id(context).await;
        let mut state = load_task_board_state(&self.storage, &task_list_id, context).await;
        let Some(task_index) = find_task_index(&state, &input.task_id) else {
            return Ok(ToolResult::success("Task not found")
                .with_metadata("success", json!(false))
                .with_metadata("task_id", json!(input.task_id))
                .with_metadata("task_list_id", json!(task_list_id))
                .with_metadata("task_list", json!(build_harness_snapshot(&state))));
        };
        let previous_status = state.items[task_index].status.clone();

        if input.status == Some(TaskUpdateStatus::Deleted) {
            state.items.remove(task_index);
            remove_task_from_dependencies(&mut state, &input.task_id);
            persist_task_board(&self.storage, &task_list_id, context, state.clone()).await;
            return Ok(ToolResult::success(format!(
                "Task #{} deleted successfully",
                input.task_id
            ))
            .with_metadata("success", json!(true))
            .with_metadata(
                "status_change",
                json!({
                    "from": task_status_label(&previous_status),
                    "to": "deleted"
                }),
            )
            .with_metadata("task_id", json!(input.task_id))
            .with_metadata("task_list_id", json!(task_list_id))
            .with_metadata("task_list", json!(build_harness_snapshot(&state))));
        }

        let mut updated_fields = Vec::new();

        if let Some(subject) = input.subject {
            ensure_non_empty(&subject, "subject")?;
            if state.items[task_index].subject != subject {
                state.items[task_index].subject = subject;
                updated_fields.push("subject");
            }
        }

        if let Some(description) = input.description {
            ensure_non_empty(&description, "description")?;
            if state.items[task_index].description != description {
                state.items[task_index].description = description;
                updated_fields.push("description");
            }
        }

        if let Some(active_form) = input.active_form {
            let normalized = if active_form.trim().is_empty() {
                None
            } else {
                Some(active_form)
            };
            if state.items[task_index].active_form != normalized {
                state.items[task_index].active_form = normalized;
                updated_fields.push("activeForm");
            }
        }

        if let Some(owner) = input.owner {
            let normalized = if owner.trim().is_empty() {
                None
            } else {
                Some(owner)
            };
            if state.items[task_index].owner != normalized {
                state.items[task_index].owner = normalized;
                updated_fields.push("owner");
            }
        }

        if let Some(metadata_patch) = input.metadata {
            let updated_metadata =
                normalize_metadata_patch(state.items[task_index].metadata.clone(), metadata_patch);
            if state.items[task_index].metadata != updated_metadata {
                state.items[task_index].metadata = updated_metadata;
                updated_fields.push("metadata");
            }
        }

        if let Some(status) = input.status {
            if let Some(next_status) = status.into_task_status() {
                if state.items[task_index].status != next_status {
                    state.items[task_index].status = next_status;
                    updated_fields.push("status");
                }
            }
        }

        if let Some(add_blocks) = input.add_blocks {
            for blocked_id in dedupe_ids(add_blocks) {
                apply_dependency(&mut state, &input.task_id, &blocked_id)?;
            }
            updated_fields.push("addBlocks");
        }

        if let Some(add_blocked_by) = input.add_blocked_by {
            for blocker_id in dedupe_ids(add_blocked_by) {
                apply_dependency(&mut state, &blocker_id, &input.task_id)?;
            }
            updated_fields.push("addBlockedBy");
        }

        let task = state.items[task_index].clone();
        persist_task_board(&self.storage, &task_list_id, context, state.clone()).await;

        let mut result = ToolResult::success(format!(
            "Task #{} updated successfully: {}",
            task.id, task.subject
        ))
        .with_metadata("success", json!(true))
        .with_metadata("task_id", json!(task.id))
        .with_metadata("updated_fields", json!(updated_fields))
        .with_metadata("task", build_task_metadata(&task))
        .with_metadata("task_list_id", json!(task_list_id))
        .with_metadata("task_list", json!(build_harness_snapshot(&state)))
        .with_metadata(
            "tasks",
            json!(state
                .items
                .iter()
                .map(build_task_metadata)
                .collect::<Vec<_>>()),
        );

        if previous_status != task.status {
            result = result.with_metadata(
                "status_change",
                json!({
                    "from": task_status_label(&previous_status),
                    "to": task_status_label(&task.status)
                }),
            );
        }

        Ok(result)
    }

    async fn check_permissions(
        &self,
        _params: &serde_json::Value,
        _context: &ToolContext,
    ) -> PermissionCheckResult {
        PermissionCheckResult::allow()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn create_test_context() -> ToolContext {
        ToolContext::new(PathBuf::from("/tmp")).with_session_id("task-board-session")
    }

    #[tokio::test]
    async fn test_task_create_and_list_tools() {
        let storage = Arc::new(TaskListStorage::new());
        let create_tool = TaskCreateTool::with_storage(storage.clone());
        let list_tool = TaskListTool::with_storage(storage);
        let context = create_test_context();

        let create_result = create_tool
            .execute(
                json!({
                    "subject": "整理任务板",
                    "description": "把 Task* 工具接进框架层"
                }),
                &context,
            )
            .await
            .expect("create should succeed");
        assert!(create_result.success);
        assert_eq!(create_result.metadata["task"]["id"], json!("1"));

        let list_result = list_tool
            .execute(json!({}), &context)
            .await
            .expect("list should succeed");
        assert!(list_result
            .output
            .unwrap_or_default()
            .contains("整理任务板"));
        assert_eq!(list_result.metadata["task_list"][0]["id"], json!("1"));
    }

    #[tokio::test]
    async fn test_task_get_tool_returns_task_details() {
        let storage = Arc::new(TaskListStorage::new());
        let create_tool = TaskCreateTool::with_storage(storage.clone());
        let get_tool = TaskGetTool::with_storage(storage);
        let context = create_test_context();

        create_tool
            .execute(
                json!({
                    "subject": "切换注册表",
                    "description": "移除旧 Task 和 TodoWrite"
                }),
                &context,
            )
            .await
            .expect("create should succeed");

        let get_result = get_tool
            .execute(json!({ "taskId": "1" }), &context)
            .await
            .expect("get should succeed");
        assert!(get_result
            .output
            .unwrap_or_default()
            .contains("移除旧 Task 和 TodoWrite"));
    }

    #[tokio::test]
    async fn test_task_update_tool_updates_status_and_dependencies() {
        let storage = Arc::new(TaskListStorage::new());
        let create_tool = TaskCreateTool::with_storage(storage.clone());
        let update_tool = TaskUpdateTool::with_storage(storage.clone());
        let list_tool = TaskListTool::with_storage(storage);
        let context = create_test_context();

        create_tool
            .execute(
                json!({
                    "subject": "任务一",
                    "description": "先做主链"
                }),
                &context,
            )
            .await
            .expect("task 1 create should succeed");
        create_tool
            .execute(
                json!({
                    "subject": "任务二",
                    "description": "依赖任务一"
                }),
                &context,
            )
            .await
            .expect("task 2 create should succeed");

        let update_result = update_tool
            .execute(
                json!({
                    "taskId": "1",
                    "status": "in_progress",
                    "addBlocks": ["2"]
                }),
                &context,
            )
            .await
            .expect("update should succeed");

        assert_eq!(
            update_result.metadata["status_change"]["to"],
            json!("in_progress")
        );

        let list_result = list_tool
            .execute(json!({}), &context)
            .await
            .expect("list should succeed");
        let output = list_result.output.unwrap_or_default();
        assert!(output.contains("#1 [in_progress] 任务一"));
        assert!(output.contains("#2 [pending] 任务二 [blocked by #1]"));
    }

    #[tokio::test]
    async fn test_task_update_tool_deletes_task() {
        let storage = Arc::new(TaskListStorage::new());
        let create_tool = TaskCreateTool::with_storage(storage.clone());
        let update_tool = TaskUpdateTool::with_storage(storage.clone());
        let list_tool = TaskListTool::with_storage(storage);
        let context = create_test_context();

        create_tool
            .execute(
                json!({
                    "subject": "待删除任务",
                    "description": "验证删除路径"
                }),
                &context,
            )
            .await
            .expect("create should succeed");

        update_tool
            .execute(
                json!({
                    "taskId": "1",
                    "status": "deleted"
                }),
                &context,
            )
            .await
            .expect("delete should succeed");

        let list_result = list_tool
            .execute(json!({}), &context)
            .await
            .expect("list should succeed");
        assert_eq!(list_result.output.unwrap_or_default(), "No tasks found");
    }

    #[tokio::test]
    async fn test_task_list_tool_rejects_unknown_fields() {
        let storage = Arc::new(TaskListStorage::new());
        let list_tool = TaskListTool::with_storage(storage);
        let context = create_test_context();

        let result = list_tool
            .execute(json!({ "unexpected": true }), &context)
            .await;
        assert!(matches!(result, Err(ToolError::InvalidParams(_))));
    }

    #[tokio::test]
    async fn test_task_list_tool_hides_internal_tasks() {
        let storage = Arc::new(TaskListStorage::new());
        let create_tool = TaskCreateTool::with_storage(storage.clone());
        let list_tool = TaskListTool::with_storage(storage);
        let context = create_test_context();

        create_tool
            .execute(
                json!({
                    "subject": "用户可见任务",
                    "description": "应该正常展示"
                }),
                &context,
            )
            .await
            .expect("visible task should succeed");

        create_tool
            .execute(
                json!({
                    "subject": "内部任务",
                    "description": "不应暴露给 TaskList",
                    "metadata": {
                        "_internal": true
                    }
                }),
                &context,
            )
            .await
            .expect("internal task should succeed");

        let list_result = list_tool
            .execute(json!({}), &context)
            .await
            .expect("list should succeed");
        let output = list_result.output.unwrap_or_default();

        assert!(output.contains("用户可见任务"));
        assert!(!output.contains("内部任务"));
        assert_eq!(
            list_result.metadata["task_list"].as_array().unwrap().len(),
            1
        );
        assert_eq!(list_result.metadata["tasks"].as_array().unwrap().len(), 1);
    }
}
