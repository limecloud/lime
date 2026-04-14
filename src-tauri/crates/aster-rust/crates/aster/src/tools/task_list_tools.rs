//! 新版任务板工具
//!
//! 提供与当前任务板语义对齐的一组工具：
//! - `TaskCreate`
//! - `TaskList`
//! - `TaskGet`
//! - `TaskUpdate`

use async_trait::async_trait;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::{Arc, RwLock};

use super::base::{PermissionCheckResult, Tool};
use super::context::{ToolContext, ToolResult};
use super::error::ToolError;
use crate::conversation::message::{ActionRequiredScope, Message};
use crate::hooks::{is_blocked, run_hooks, HookEvent, HookInput};
use crate::session::extension_data::{
    persist_task_board_state, resolve_task_board_state, TaskBoardItem, TaskBoardItemStatus,
    TaskBoardState,
};
use crate::session::{
    resolve_team_context, resolve_team_task_list_id, SessionManager, SessionType,
    TeamMembershipState, TeamSessionState,
};
use crate::user_message_manager::UserMessageManager;

const TASK_CREATE_TOOL_ALIASES: &[&str] = &["TaskCreateTool"];
const TASK_LIST_TOOL_ALIASES: &[&str] = &["TaskListTool"];
const TASK_GET_TOOL_ALIASES: &[&str] = &["TaskGetTool"];
const TASK_UPDATE_TOOL_ALIASES: &[&str] = &["TaskUpdateTool"];

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

#[derive(Debug, Clone)]
struct ResolvedTaskBoardBinding {
    task_list_id: String,
    owner_session_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
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
#[serde(deny_unknown_fields)]
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
#[serde(deny_unknown_fields)]
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

async fn resolve_task_board_binding(context: &ToolContext) -> ResolvedTaskBoardBinding {
    if let Some(task_list_id) = context
        .environment
        .get("TASK_LIST_ID")
        .cloned()
        .filter(|value| !value.trim().is_empty())
    {
        return ResolvedTaskBoardBinding {
            task_list_id,
            owner_session_id: (!context.session_id.trim().is_empty())
                .then(|| context.session_id.clone()),
        };
    }

    if !context.session_id.trim().is_empty() {
        if let Ok(Some(team_context)) = resolve_team_context(&context.session_id).await {
            return ResolvedTaskBoardBinding {
                task_list_id: team_context.team_state.team_name,
                owner_session_id: Some(team_context.lead_session_id),
            };
        }

        if let Ok(session) = SessionManager::get_session(&context.session_id, false).await {
            if let Some(task_list_id) = resolve_team_task_list_id(&session.extension_data) {
                return ResolvedTaskBoardBinding {
                    task_list_id,
                    owner_session_id: Some(context.session_id.clone()),
                };
            }
        }

        return ResolvedTaskBoardBinding {
            task_list_id: context.session_id.clone(),
            owner_session_id: Some(context.session_id.clone()),
        };
    }

    ResolvedTaskBoardBinding {
        task_list_id: "main".to_string(),
        owner_session_id: None,
    }
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

fn build_task_list_output_tasks(
    tasks: &[&TaskBoardItem],
    resolved_task_ids: &HashSet<String>,
) -> Vec<Value> {
    tasks
        .iter()
        .map(|task| {
            json!({
                "id": task.id.clone(),
                "subject": task.subject.clone(),
                "status": task_status_label(&task.status),
                "owner": task.owner.clone(),
                "blockedBy": task
                    .blocked_by
                    .iter()
                    .filter(|task_id| !resolved_task_ids.contains(*task_id))
                    .cloned()
                    .collect::<Vec<_>>(),
            })
        })
        .collect()
}

fn pretty_json<T: Serialize>(value: &T) -> Result<String, ToolError> {
    serde_json::to_string_pretty(value)
        .map_err(|error| ToolError::execution_failed(format!("序列化任务结果失败: {error}")))
}

async fn load_task_board_state(
    storage: &TaskListStorage,
    binding: &ResolvedTaskBoardBinding,
) -> TaskBoardState {
    if let Some(owner_session_id) = binding.owner_session_id.as_deref() {
        if let Ok(session) = SessionManager::get_session(owner_session_id, false).await {
            if let Some(state) = resolve_task_board_state(&session.extension_data) {
                storage.set(&binding.task_list_id, state.clone());
                return state;
            }
        }
    }

    storage.get(&binding.task_list_id).unwrap_or_default()
}

async fn persist_task_board(
    storage: &TaskListStorage,
    binding: &ResolvedTaskBoardBinding,
    state: TaskBoardState,
) {
    storage.set(&binding.task_list_id, state.clone());

    let Some(owner_session_id) = binding.owner_session_id.as_deref() else {
        return;
    };

    if let Ok(mut session) = SessionManager::get_session(owner_session_id, false).await {
        if persist_task_board_state(&mut session.extension_data, state).is_ok() {
            let _ = SessionManager::update_session(owner_session_id)
                .extension_data(session.extension_data)
                .apply()
                .await;
        }
    }
}

fn current_session_id(context: &ToolContext) -> Option<String> {
    (!context.session_id.trim().is_empty()).then(|| context.session_id.clone())
}

async fn blocking_task_hook_feedback(
    event: HookEvent,
    task: &TaskBoardItem,
    context: &ToolContext,
) -> Option<String> {
    let team_context = resolve_team_context(&context.session_id)
        .await
        .ok()
        .flatten();
    let results = run_hooks(HookInput {
        event: Some(event),
        task_id: Some(task.id.clone()),
        task_subject: Some(task.subject.clone()),
        task_description: Some(task.description.clone()),
        teammate_name: team_context
            .as_ref()
            .map(|team_context| team_context.current_member_name.clone()),
        team_name: team_context
            .as_ref()
            .map(|team_context| team_context.team_state.team_name.clone()),
        session_id: current_session_id(context),
        ..Default::default()
    })
    .await;
    let (blocked, message) = is_blocked(&results);
    if !blocked {
        return None;
    }

    let fallback = "Blocked by hook".to_string();
    let detail = message.unwrap_or(fallback);
    Some(match event {
        HookEvent::TaskCreated => format!("TaskCreated hook feedback:\n{detail}"),
        HookEvent::TaskCompleted => format!("TaskCompleted hook feedback:\n{detail}"),
        _ => detail,
    })
}

async fn resolve_assignment_target_session_id(
    team_state: &TeamSessionState,
    owner_name: &str,
) -> Option<String> {
    let member = team_state.find_member_by_name(owner_name)?.clone();
    let session = SessionManager::get_session(&member.agent_id, false)
        .await
        .ok()?;

    if member.is_lead {
        let lead_state = TeamSessionState::from_session(&session)?;
        if session.id == team_state.lead_session_id
            && member.agent_id == team_state.lead_session_id
            && lead_state.team_name == team_state.team_name
            && lead_state.lead_session_id == team_state.lead_session_id
        {
            Some(member.agent_id)
        } else {
            None
        }
    } else {
        let membership = TeamMembershipState::from_session(&session)?;
        if membership.team_name == team_state.team_name
            && membership.lead_session_id == team_state.lead_session_id
            && membership.agent_id == member.agent_id
            && membership.name == member.name
        {
            Some(member.agent_id)
        } else {
            None
        }
    }
}

async fn enqueue_task_assignment_message(
    context: &ToolContext,
    existing_task: &TaskBoardItem,
    owner_name: &str,
) {
    let Some(team_context) = resolve_team_context(&context.session_id)
        .await
        .ok()
        .flatten()
    else {
        return;
    };
    let Some(target_session_id) =
        resolve_assignment_target_session_id(&team_context.team_state, owner_name).await
    else {
        return;
    };

    let Ok(payload) = serde_json::to_string(&json!({
        "type": "task_assignment",
        "taskId": existing_task.id.clone(),
        "subject": existing_task.subject.clone(),
        "description": existing_task.description.clone(),
        "assignedBy": team_context.current_member_name,
        "timestamp": Utc::now().to_rfc3339(),
    })) else {
        return;
    };

    UserMessageManager::global()
        .enqueue_scoped(
            ActionRequiredScope {
                session_id: Some(target_session_id.clone()),
                thread_id: Some(target_session_id),
                turn_id: None,
            },
            Message::user().with_text(payload).agent_only(),
        )
        .await;
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

    fn aliases(&self) -> &'static [&'static str] {
        TASK_CREATE_TOOL_ALIASES
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
            "required": ["subject", "description"],
            "additionalProperties": false
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

        let binding = resolve_task_board_binding(context).await;
        let mut state = load_task_board_state(&self.storage, &binding).await;
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
        persist_task_board(&self.storage, &binding, state.clone()).await;
        if let Some(blocking_message) =
            blocking_task_hook_feedback(HookEvent::TaskCreated, &task, context).await
        {
            state.items.retain(|item| item.id != task.id);
            persist_task_board(&self.storage, &binding, state).await;
            return Err(ToolError::execution_failed(blocking_message));
        }

        let output = json!({
            "task": {
                "id": task.id.clone(),
                "subject": task.subject.clone(),
            }
        });

        Ok(ToolResult::success(pretty_json(&output)?)
            .with_metadata("task", build_task_metadata(&task))
            .with_metadata("task_list_id", json!(binding.task_list_id))
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

    fn aliases(&self) -> &'static [&'static str] {
        TASK_LIST_TOOL_ALIASES
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

        let binding = resolve_task_board_binding(context).await;
        let state = load_task_board_state(&self.storage, &binding).await;
        let visible_tasks = state
            .items
            .iter()
            .filter(|task| !is_internal_task(task))
            .collect::<Vec<_>>();
        let resolved_task_ids = visible_tasks
            .iter()
            .filter(|task| task.status == TaskBoardItemStatus::Completed)
            .map(|task| task.id.clone())
            .collect::<HashSet<_>>();
        let task_output = build_task_list_output_tasks(&visible_tasks, &resolved_task_ids);

        if visible_tasks.is_empty() {
            return Ok(ToolResult::success(pretty_json(&json!({ "tasks": [] }))?)
                .with_metadata("task_list_id", json!(binding.task_list_id))
                .with_metadata("task_list", json!([]))
                .with_metadata("tasks", json!([])));
        }

        Ok(ToolResult::success(pretty_json(&json!({
            "tasks": task_output,
        }))?)
        .with_metadata("task_list_id", json!(binding.task_list_id))
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

    fn aliases(&self) -> &'static [&'static str] {
        TASK_GET_TOOL_ALIASES
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
            "required": ["taskId"],
            "additionalProperties": false
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

        let binding = resolve_task_board_binding(context).await;
        let state = load_task_board_state(&self.storage, &binding).await;
        let task = state
            .items
            .iter()
            .find(|item| item.id == input.task_id)
            .cloned();

        match task {
            Some(task) => Ok(ToolResult::success(pretty_json(&json!({
                "task": {
                    "id": task.id.clone(),
                    "subject": task.subject.clone(),
                    "description": task.description.clone(),
                    "status": task_status_label(&task.status),
                    "blocks": task.blocks.clone(),
                    "blockedBy": task.blocked_by.clone(),
                }
            }))?)
            .with_metadata("task", build_task_metadata(&task))
            .with_metadata("task_list_id", json!(binding.task_list_id))
            .with_metadata("task_list", json!(build_harness_snapshot(&state)))),
            None => Ok(
                ToolResult::success(pretty_json(&json!({ "task": Value::Null }))?)
                    .with_metadata("task", Value::Null)
                    .with_metadata("task_list_id", json!(binding.task_list_id))
                    .with_metadata("task_list", json!(build_harness_snapshot(&state))),
            ),
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

    fn aliases(&self) -> &'static [&'static str] {
        TASK_UPDATE_TOOL_ALIASES
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
            "required": ["taskId"],
            "additionalProperties": false
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

        let binding = resolve_task_board_binding(context).await;
        let state = load_task_board_state(&self.storage, &binding).await;
        let Some(task_index) = find_task_index(&state, &input.task_id) else {
            return Ok(ToolResult::success(pretty_json(&json!({
                "success": false,
                "taskId": input.task_id,
                "updatedFields": [],
                "error": "Task not found",
            }))?)
            .with_metadata("success", json!(false))
            .with_metadata("task_id", json!(input.task_id))
            .with_metadata("task_list_id", json!(binding.task_list_id))
            .with_metadata("task_list", json!(build_harness_snapshot(&state))));
        };
        let previous_task = state.items[task_index].clone();
        let previous_status = previous_task.status.clone();
        let team_context = resolve_team_context(&context.session_id)
            .await
            .ok()
            .flatten();
        let auto_owner = if input.status == Some(TaskUpdateStatus::InProgress)
            && input.owner.is_none()
            && previous_task.owner.is_none()
        {
            team_context
                .as_ref()
                .map(|team_context| team_context.current_member_name.clone())
        } else {
            None
        };

        if input.status == Some(TaskUpdateStatus::Deleted) {
            let mut next_state = state.clone();
            next_state.items.remove(task_index);
            remove_task_from_dependencies(&mut next_state, &input.task_id);
            persist_task_board(&self.storage, &binding, next_state.clone()).await;
            return Ok(ToolResult::success(pretty_json(&json!({
                "success": true,
                "taskId": input.task_id,
                "updatedFields": ["deleted"],
                "statusChange": {
                    "from": task_status_label(&previous_status),
                    "to": "deleted",
                }
            }))?)
            .with_metadata("success", json!(true))
            .with_metadata(
                "status_change",
                json!({
                    "from": task_status_label(&previous_status),
                    "to": "deleted"
                }),
            )
            .with_metadata("task_id", json!(input.task_id))
            .with_metadata("task_list_id", json!(binding.task_list_id))
            .with_metadata("task_list", json!(build_harness_snapshot(&next_state))));
        }

        if input.status == Some(TaskUpdateStatus::Completed)
            && previous_status != TaskBoardItemStatus::Completed
        {
            if let Some(blocking_message) =
                blocking_task_hook_feedback(HookEvent::TaskCompleted, &previous_task, context).await
            {
                return Ok(ToolResult::success(pretty_json(&json!({
                    "success": false,
                    "taskId": input.task_id,
                    "updatedFields": [],
                    "error": blocking_message,
                }))?)
                .with_metadata("success", json!(false))
                .with_metadata("task_id", json!(input.task_id))
                .with_metadata("task_list_id", json!(binding.task_list_id))
                .with_metadata("task_list", json!(build_harness_snapshot(&state))));
            }
        }

        let mut next_state = state.clone();
        let mut updated_fields = Vec::new();
        let mut assigned_owner = None;

        if let Some(subject) = input.subject {
            ensure_non_empty(&subject, "subject")?;
            if next_state.items[task_index].subject != subject {
                next_state.items[task_index].subject = subject;
                updated_fields.push("subject");
            }
        }

        if let Some(description) = input.description {
            ensure_non_empty(&description, "description")?;
            if next_state.items[task_index].description != description {
                next_state.items[task_index].description = description;
                updated_fields.push("description");
            }
        }

        if let Some(active_form) = input.active_form {
            let normalized = if active_form.trim().is_empty() {
                None
            } else {
                Some(active_form)
            };
            if next_state.items[task_index].active_form != normalized {
                next_state.items[task_index].active_form = normalized;
                updated_fields.push("activeForm");
            }
        }

        if let Some(owner) = auto_owner {
            if next_state.items[task_index].owner.is_none() {
                next_state.items[task_index].owner = Some(owner.clone());
                assigned_owner = Some(owner);
                updated_fields.push("owner");
            }
        }

        if let Some(owner) = input.owner {
            let normalized = if owner.trim().is_empty() {
                None
            } else {
                Some(owner)
            };
            if next_state.items[task_index].owner != normalized {
                next_state.items[task_index].owner = normalized.clone();
                assigned_owner = normalized;
                updated_fields.push("owner");
            }
        }

        if let Some(metadata_patch) = input.metadata {
            let updated_metadata = normalize_metadata_patch(
                next_state.items[task_index].metadata.clone(),
                metadata_patch,
            );
            if next_state.items[task_index].metadata != updated_metadata {
                next_state.items[task_index].metadata = updated_metadata;
                updated_fields.push("metadata");
            }
        }

        if let Some(status) = input.status {
            if let Some(next_status) = status.into_task_status() {
                if next_state.items[task_index].status != next_status {
                    next_state.items[task_index].status = next_status;
                    updated_fields.push("status");
                }
            }
        }

        if let Some(add_blocks) = input.add_blocks {
            let mut added_blocks = false;
            for blocked_id in dedupe_ids(add_blocks) {
                let already_present = next_state.items[task_index].blocks.contains(&blocked_id);
                apply_dependency(&mut next_state, &input.task_id, &blocked_id)?;
                added_blocks |= !already_present;
            }
            if added_blocks {
                updated_fields.push("blocks");
            }
        }

        if let Some(add_blocked_by) = input.add_blocked_by {
            let mut added_blockers = false;
            for blocker_id in dedupe_ids(add_blocked_by) {
                let already_present = next_state.items[task_index]
                    .blocked_by
                    .contains(&blocker_id);
                apply_dependency(&mut next_state, &blocker_id, &input.task_id)?;
                added_blockers |= !already_present;
            }
            if added_blockers {
                updated_fields.push("blockedBy");
            }
        }

        let task = next_state.items[task_index].clone();
        persist_task_board(&self.storage, &binding, next_state.clone()).await;
        if let Some(owner_name) = assigned_owner.as_deref() {
            enqueue_task_assignment_message(context, &previous_task, owner_name).await;
        }
        let status_change = (previous_status != task.status).then(|| {
            json!({
                "from": task_status_label(&previous_status),
                "to": task_status_label(&task.status)
            })
        });
        let should_emit_verification_nudge =
            SessionManager::get_session(&context.session_id, false)
                .await
                .map(|session| session.session_type != SessionType::SubAgent)
                .unwrap_or(true);
        let verification_nudge_needed = should_emit_verification_nudge
            && previous_status != TaskBoardItemStatus::Completed
            && task.status == TaskBoardItemStatus::Completed
            && {
                let visible_tasks = next_state
                    .items
                    .iter()
                    .filter(|item| !is_internal_task(item))
                    .collect::<Vec<_>>();
                visible_tasks.len() >= 3
                    && visible_tasks
                        .iter()
                        .all(|item| item.status == TaskBoardItemStatus::Completed)
                    && !visible_tasks
                        .iter()
                        .any(|item| item.subject.to_ascii_lowercase().contains("verif"))
            };

        let mut output = json!({
            "success": true,
            "taskId": task.id.clone(),
            "updatedFields": updated_fields,
        });
        if let Some(status_change) = status_change.clone() {
            output["statusChange"] = status_change;
        }
        if verification_nudge_needed {
            output["verificationNudgeNeeded"] = json!(true);
        }

        let mut result = ToolResult::success(pretty_json(&output)?)
            .with_metadata("success", json!(true))
            .with_metadata("task_id", json!(task.id))
            .with_metadata("updated_fields", json!(output["updatedFields"].clone()))
            .with_metadata("task", build_task_metadata(&task))
            .with_metadata("task_list_id", json!(binding.task_list_id))
            .with_metadata("task_list", json!(build_harness_snapshot(&next_state)))
            .with_metadata(
                "tasks",
                json!(next_state
                    .items
                    .iter()
                    .map(build_task_metadata)
                    .collect::<Vec<_>>()),
            );

        if let Some(status_change) = status_change {
            result = result.with_metadata("status_change", status_change);
        }
        if verification_nudge_needed {
            result = result.with_metadata("verification_nudge_needed", json!(true));
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
    use crate::hooks::{clear_hooks, register_hook, CommandHookConfig, HookConfig};
    use crate::session::{
        save_team_membership, save_team_state, SessionManager, SessionType, TeamMember,
        TeamMembershipState, TeamSessionState,
    };
    use serial_test::serial;
    use std::path::PathBuf;
    use tempfile::tempdir;
    use uuid::Uuid;

    struct HookRegistryGuard;

    impl HookRegistryGuard {
        fn new() -> Self {
            clear_hooks();
            Self
        }
    }

    impl Drop for HookRegistryGuard {
        fn drop(&mut self) {
            clear_hooks();
        }
    }

    fn create_test_context() -> ToolContext {
        ToolContext::new(PathBuf::from("/tmp")).with_session_id("task-board-session")
    }

    #[tokio::test]
    #[serial(task_list_tools)]
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
    #[serial(task_list_tools)]
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
    #[serial(task_list_tools)]
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
        let output: serde_json::Value = serde_json::from_str(
            list_result
                .output
                .as_deref()
                .expect("expected TaskList output json"),
        )
        .expect("valid task list json");
        assert_eq!(output["tasks"][0]["id"], json!("1"));
        assert_eq!(output["tasks"][0]["status"], json!("in_progress"));
        assert_eq!(output["tasks"][1]["id"], json!("2"));
        assert_eq!(output["tasks"][1]["blockedBy"], json!(["1"]));
    }

    #[tokio::test]
    #[serial(task_list_tools)]
    async fn test_task_list_filters_completed_blockers_from_blocked_by() {
        let storage = Arc::new(TaskListStorage::new());
        let create_tool = TaskCreateTool::with_storage(storage.clone());
        let update_tool = TaskUpdateTool::with_storage(storage.clone());
        let list_tool = TaskListTool::with_storage(storage);
        let context = create_test_context();

        create_tool
            .execute(
                json!({
                    "subject": "先完成 blocker",
                    "description": "完成后不应继续阻塞后续任务"
                }),
                &context,
            )
            .await
            .expect("task 1 create should succeed");
        create_tool
            .execute(
                json!({
                    "subject": "后续任务",
                    "description": "被 blocker 解除后应显示为未阻塞"
                }),
                &context,
            )
            .await
            .expect("task 2 create should succeed");

        update_tool
            .execute(
                json!({
                    "taskId": "1",
                    "addBlocks": ["2"]
                }),
                &context,
            )
            .await
            .expect("dependency update should succeed");
        update_tool
            .execute(
                json!({
                    "taskId": "1",
                    "status": "completed"
                }),
                &context,
            )
            .await
            .expect("completion update should succeed");

        let list_result = list_tool
            .execute(json!({}), &context)
            .await
            .expect("list should succeed");
        let output: Value =
            serde_json::from_str(&list_result.output.unwrap_or_default()).expect("valid json");
        assert_eq!(output["tasks"][0]["status"], json!("completed"));
        assert_eq!(output["tasks"][1]["blockedBy"], json!([]));
    }

    #[tokio::test]
    #[serial(task_list_tools)]
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
        let output: Value =
            serde_json::from_str(&list_result.output.unwrap_or_default()).expect("valid json");
        assert_eq!(output, json!({ "tasks": [] }));
    }

    #[tokio::test]
    #[serial(task_list_tools)]
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
    #[serial(task_list_tools)]
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

    #[tokio::test]
    #[serial(task_list_tools)]
    async fn test_team_sessions_share_task_board_via_lead_session() {
        let temp_dir = tempdir().expect("tempdir should succeed");
        let lead = SessionManager::create_session(
            temp_dir.path().to_path_buf(),
            format!("task-team-lead-{}", Uuid::new_v4()),
            SessionType::Hidden,
        )
        .await
        .expect("lead session should be created");
        let child = SessionManager::create_session(
            temp_dir.path().to_path_buf(),
            format!("task-team-child-{}", Uuid::new_v4()),
            SessionType::SubAgent,
        )
        .await
        .expect("child session should be created");

        let mut team_state = TeamSessionState::new("delivery-team", lead.id.clone(), None, None);
        team_state.add_or_update_member(TeamMember::teammate(
            child.id.clone(),
            "researcher".to_string(),
            None,
        ));
        save_team_state(&lead.id, Some(team_state))
            .await
            .expect("team state should be saved");
        save_team_membership(
            &child.id,
            Some(TeamMembershipState {
                team_name: "delivery-team".to_string(),
                lead_session_id: lead.id.clone(),
                agent_id: child.id.clone(),
                name: "researcher".to_string(),
                agent_type: None,
            }),
        )
        .await
        .expect("membership should be saved");

        let lead_storage = Arc::new(TaskListStorage::new());
        let child_storage = Arc::new(TaskListStorage::new());
        let lead_create_tool = TaskCreateTool::with_storage(lead_storage.clone());
        let lead_list_tool = TaskListTool::with_storage(lead_storage);
        let child_list_tool = TaskListTool::with_storage(child_storage.clone());
        let child_update_tool = TaskUpdateTool::with_storage(child_storage);

        let lead_context =
            ToolContext::new(temp_dir.path().to_path_buf()).with_session_id(&lead.id);
        let child_context =
            ToolContext::new(temp_dir.path().to_path_buf()).with_session_id(&child.id);

        let create_result = lead_create_tool
            .execute(
                json!({
                    "subject": "共享任务",
                    "description": "team 成员都应该读到同一份任务板"
                }),
                &lead_context,
            )
            .await
            .expect("team lead create should succeed");
        assert_eq!(
            create_result.metadata["task_list_id"],
            json!("delivery-team")
        );

        let child_list_result = child_list_tool
            .execute(json!({}), &child_context)
            .await
            .expect("child list should see shared board");
        let child_tasks: Value = serde_json::from_str(
            child_list_result
                .output
                .as_deref()
                .expect("child list output should exist"),
        )
        .expect("child task list output should be valid json");
        assert_eq!(child_tasks["tasks"][0]["subject"], json!("共享任务"));

        let child_update_result = child_update_tool
            .execute(
                json!({
                    "taskId": "1",
                    "status": "in_progress"
                }),
                &child_context,
            )
            .await
            .expect("child update should succeed");
        assert_eq!(
            child_update_result.metadata["task"]["owner"],
            json!("researcher")
        );

        let lead_list_result = lead_list_tool
            .execute(json!({}), &lead_context)
            .await
            .expect("lead list should reflect child update");
        let lead_tasks: Value = serde_json::from_str(
            lead_list_result
                .output
                .as_deref()
                .expect("lead list output should exist"),
        )
        .expect("lead task list output should be valid json");
        assert_eq!(lead_tasks["tasks"][0]["status"], json!("in_progress"));
    }

    #[tokio::test]
    #[serial(task_list_tools)]
    async fn test_task_update_skips_verification_nudge_for_subagents() {
        let temp_dir = tempdir().expect("tempdir should succeed");
        let session = SessionManager::create_session(
            temp_dir.path().to_path_buf(),
            format!("task-subagent-{}", Uuid::new_v4()),
            SessionType::SubAgent,
        )
        .await
        .expect("subagent session should be created");
        let context = ToolContext::new(temp_dir.path().to_path_buf()).with_session_id(&session.id);

        let storage = Arc::new(TaskListStorage::new());
        let create_tool = TaskCreateTool::with_storage(storage.clone());
        let update_tool = TaskUpdateTool::with_storage(storage);

        for index in 1..=3 {
            create_tool
                .execute(
                    json!({
                        "subject": format!("任务 {index}"),
                        "description": format!("子代理任务 {index}")
                    }),
                    &context,
                )
                .await
                .expect("create should succeed");
        }

        update_tool
            .execute(json!({ "taskId": "1", "status": "completed" }), &context)
            .await
            .expect("task 1 completion should succeed");
        update_tool
            .execute(json!({ "taskId": "2", "status": "completed" }), &context)
            .await
            .expect("task 2 completion should succeed");
        let final_result = update_tool
            .execute(json!({ "taskId": "3", "status": "completed" }), &context)
            .await
            .expect("task 3 completion should succeed");

        assert!(final_result
            .metadata
            .get("verification_nudge_needed")
            .is_none());
    }

    #[tokio::test]
    #[serial(task_list_tools)]
    async fn test_task_create_rolls_back_when_task_created_hook_blocks() {
        let _hook_guard = HookRegistryGuard::new();
        register_hook(
            HookEvent::TaskCreated,
            HookConfig::Command(CommandHookConfig {
                command: "printf '{\"blocked\":true,\"message\":\"请先补任务说明\"}'; exit 1"
                    .to_string(),
                args: vec![],
                env: HashMap::new(),
                timeout: 30_000,
                blocking: true,
                matcher: None,
            }),
        );

        let storage = Arc::new(TaskListStorage::new());
        let create_tool = TaskCreateTool::with_storage(storage.clone());
        let list_tool = TaskListTool::with_storage(storage);
        let context = create_test_context();

        let create_result = create_tool
            .execute(
                json!({
                    "subject": "受阻任务",
                    "description": "TaskCreated hook 会阻止这个任务"
                }),
                &context,
            )
            .await;

        assert!(matches!(
            create_result,
            Err(ToolError::ExecutionFailed(message))
                if message.contains("TaskCreated hook feedback:\n请先补任务说明")
        ));

        let list_result = list_tool
            .execute(json!({}), &context)
            .await
            .expect("list should succeed");
        let output: Value =
            serde_json::from_str(&list_result.output.unwrap_or_default()).expect("valid json");
        assert_eq!(output, json!({ "tasks": [] }));
    }

    #[tokio::test]
    #[serial(task_list_tools)]
    async fn test_task_update_returns_success_false_when_task_completed_hook_blocks() {
        let _hook_guard = HookRegistryGuard::new();
        register_hook(
            HookEvent::TaskCompleted,
            HookConfig::Command(CommandHookConfig {
                command: "printf '{\"blocked\":true,\"message\":\"需要先跑验证\"}'; exit 1"
                    .to_string(),
                args: vec![],
                env: HashMap::new(),
                timeout: 30_000,
                blocking: true,
                matcher: None,
            }),
        );

        let storage = Arc::new(TaskListStorage::new());
        let create_tool = TaskCreateTool::with_storage(storage.clone());
        let update_tool = TaskUpdateTool::with_storage(storage.clone());
        let get_tool = TaskGetTool::with_storage(storage);
        let context = create_test_context();

        create_tool
            .execute(
                json!({
                    "subject": "待完成任务",
                    "description": "TaskCompleted hook 会阻止完成"
                }),
                &context,
            )
            .await
            .expect("create should succeed");

        let update_result = update_tool
            .execute(json!({ "taskId": "1", "status": "completed" }), &context)
            .await
            .expect("update should return structured failure");
        let output: Value =
            serde_json::from_str(&update_result.output.unwrap_or_default()).expect("valid json");
        assert_eq!(output["success"], json!(false));
        assert_eq!(output["updatedFields"], json!([]));
        assert_eq!(
            output["error"],
            json!("TaskCompleted hook feedback:\n需要先跑验证")
        );

        let get_result = get_tool
            .execute(json!({ "taskId": "1" }), &context)
            .await
            .expect("get should succeed");
        let task_output: Value =
            serde_json::from_str(&get_result.output.unwrap_or_default()).expect("valid json");
        assert_eq!(task_output["task"]["status"], json!("pending"));
    }

    #[tokio::test]
    #[serial(task_list_tools)]
    async fn test_task_update_enqueues_assignment_message_for_owner_change() {
        let temp_dir = tempdir().expect("tempdir should succeed");
        let lead = SessionManager::create_session(
            temp_dir.path().to_path_buf(),
            format!("task-assignment-lead-{}", Uuid::new_v4()),
            SessionType::Hidden,
        )
        .await
        .expect("lead session should be created");
        let child = SessionManager::create_session(
            temp_dir.path().to_path_buf(),
            format!("task-assignment-child-{}", Uuid::new_v4()),
            SessionType::SubAgent,
        )
        .await
        .expect("child session should be created");

        let mut team_state = TeamSessionState::new("dispatch-team", lead.id.clone(), None, None);
        team_state.add_or_update_member(TeamMember::teammate(
            child.id.clone(),
            "researcher".to_string(),
            None,
        ));
        save_team_state(&lead.id, Some(team_state))
            .await
            .expect("team state should be saved");
        save_team_membership(
            &child.id,
            Some(TeamMembershipState {
                team_name: "dispatch-team".to_string(),
                lead_session_id: lead.id.clone(),
                agent_id: child.id.clone(),
                name: "researcher".to_string(),
                agent_type: None,
            }),
        )
        .await
        .expect("membership should be saved");

        let storage = Arc::new(TaskListStorage::new());
        let create_tool = TaskCreateTool::with_storage(storage.clone());
        let update_tool = TaskUpdateTool::with_storage(storage);
        let lead_context =
            ToolContext::new(temp_dir.path().to_path_buf()).with_session_id(&lead.id);

        create_tool
            .execute(
                json!({
                    "subject": "指派任务",
                    "description": "把任务交给 researcher"
                }),
                &lead_context,
            )
            .await
            .expect("create should succeed");

        update_tool
            .execute(
                json!({
                    "taskId": "1",
                    "owner": "researcher"
                }),
                &lead_context,
            )
            .await
            .expect("assignment should succeed");

        let scope = ActionRequiredScope {
            session_id: Some(child.id.clone()),
            thread_id: Some(child.id.clone()),
            turn_id: None,
        };
        let queued_messages = UserMessageManager::global()
            .drain_messages_for_scope(&scope)
            .await;
        assert_eq!(queued_messages.len(), 1);
        assert!(queued_messages[0].metadata.agent_visible);
        assert!(!queued_messages[0].metadata.user_visible);

        let payload: Value =
            serde_json::from_str(&queued_messages[0].as_concat_text()).expect("valid json");
        assert_eq!(payload["type"], json!("task_assignment"));
        assert_eq!(payload["taskId"], json!("1"));
        assert_eq!(payload["subject"], json!("指派任务"));
        assert_eq!(payload["description"], json!("把任务交给 researcher"));
        assert_eq!(payload["assignedBy"], json!("team-lead"));

        update_tool
            .execute(
                json!({
                    "taskId": "1",
                    "owner": "researcher"
                }),
                &lead_context,
            )
            .await
            .expect("same owner update should still succeed");

        let drained_again = UserMessageManager::global()
            .drain_messages_for_scope(&scope)
            .await;
        assert!(drained_again.is_empty());
    }
}
