//! Agent 会话存储服务
//!
//! 提供会话创建、列表查询、详情查询能力。
//! 数据事实源收敛到 lime_core::database::agent_session_repository + Lime 数据库。

use aster::model::ModelConfig;
use aster::session::{
    resolve_subagent_session_metadata, resolve_task_board_state, ExtensionState,
    Session as AsterSession, SessionRuntimeSnapshot, TaskBoardItem, TaskBoardItemStatus,
};
use chrono::Utc;
use lime_core::agent::types::{AgentMessage, AgentSession, ContentPart, MessageContent};
use lime_core::database::agent_session_repository::{
    self, SessionRecordDetail, SessionRecordMetadata, SessionRecordOverview,
    SessionRecordPreviewMessage,
};
use lime_core::database::dao::agent_timeline::{
    AgentThreadItem, AgentThreadTurn, AgentTimelineDao,
};
use lime_core::database::DbConnection;
use lime_core::workspace::WorkspaceManager;
use lime_services::aster_session_store::LimeSessionStore;
use std::collections::HashMap;
use std::path::Path;
use uuid::Uuid;

use crate::aster_runtime_support::load_aster_runtime_snapshot;
use crate::protocol::{
    AgentMessage as RuntimeAgentMessage, AgentMessageContent as RuntimeAgentMessageContent,
};
use crate::protocol_projection::{project_item_runtime, project_turn_runtime};
use crate::session_execution_runtime::{build_session_execution_runtime, SessionExecutionRuntime};
use crate::session_query::{list_child_subagent_sessions, read_session};
use crate::subagent_control::{load_subagent_runtime_status, SubagentRuntimeStatusKind};
use crate::subagent_profiles::{SubagentCustomizationState, SubagentSkillSummary};
use crate::tool_io_offload::{
    build_history_tool_io_eviction_plan_for_model, force_offload_plain_tool_output_for_history,
    force_offload_tool_arguments_for_history, maybe_offload_plain_tool_output,
    maybe_offload_tool_arguments,
};
#[cfg(test)]
use lime_core::database::dao::agent::AgentDao;

/// 会话信息（简化版）
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub messages_count: usize,
    pub execution_strategy: Option<String>,
    pub model: Option<String>,
    pub working_dir: Option<String>,
    pub workspace_id: Option<String>,
}

/// 会话详情（包含消息）
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SessionDetail {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub thread_id: String,
    pub model: Option<String>,
    pub working_dir: Option<String>,
    pub workspace_id: Option<String>,
    pub messages: Vec<RuntimeAgentMessage>,
    pub execution_strategy: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_runtime: Option<SessionExecutionRuntime>,
    pub turns: Vec<AgentThreadTurn>,
    pub items: Vec<AgentThreadItem>,
    #[serde(default)]
    pub todo_items: Vec<SessionTodoItem>,
    #[serde(default)]
    pub child_subagent_sessions: Vec<ChildSubagentSession>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subagent_parent_context: Option<SubagentParentContext>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ChildSubagentSession {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub session_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role_hint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_tool: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_from_turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blueprint_role_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blueprint_role_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team_preset_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_contract: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skill_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skills: Vec<SubagentSkillSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_status: Option<ChildSubagentRuntimeStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_turn_status: Option<ChildSubagentRuntimeStatus>,
    #[serde(default, skip_serializing_if = "is_zero_usize")]
    pub queued_turn_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team_phase: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team_parallel_budget: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team_active_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team_queued_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_concurrency_group: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_parallel_budget: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub queue_reason: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub retryable_overload: bool,
}

impl ChildSubagentSession {
    #[allow(clippy::too_many_arguments)]
    fn new_base(
        id: String,
        name: String,
        created_at: i64,
        updated_at: i64,
        session_type: String,
        model: Option<String>,
        provider_name: Option<String>,
        working_dir: Option<String>,
        workspace_id: Option<String>,
    ) -> Self {
        Self {
            id,
            name,
            created_at,
            updated_at,
            session_type,
            model,
            provider_name,
            working_dir,
            workspace_id,
            task_summary: None,
            role_hint: None,
            origin_tool: None,
            created_from_turn_id: None,
            blueprint_role_id: None,
            blueprint_role_label: None,
            profile_id: None,
            profile_name: None,
            role_key: None,
            team_preset_id: None,
            theme: None,
            output_contract: None,
            skill_ids: Vec::new(),
            skills: Vec::new(),
            runtime_status: None,
            latest_turn_status: None,
            queued_turn_count: 0,
            team_phase: None,
            team_parallel_budget: None,
            team_active_count: None,
            team_queued_count: None,
            provider_concurrency_group: None,
            provider_parallel_budget: None,
            queue_reason: None,
            retryable_overload: false,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SubagentParentContext {
    pub parent_session_id: String,
    pub parent_session_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role_hint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_tool: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_from_turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blueprint_role_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blueprint_role_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team_preset_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_contract: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skill_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skills: Vec<SubagentSkillSummary>,
    #[serde(default)]
    pub sibling_subagent_sessions: Vec<ChildSubagentSession>,
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChildSubagentRuntimeStatus {
    Idle,
    Queued,
    Running,
    Completed,
    Failed,
    Aborted,
    Closed,
}

fn is_zero_usize(value: &usize) -> bool {
    *value == 0
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SessionTodoStatus {
    Pending,
    InProgress,
    Completed,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct SessionTodoItem {
    pub content: String,
    pub status: SessionTodoStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_form: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct CreateSessionRecordInput {
    pub session_id: Option<String>,
    pub title: Option<String>,
    pub model: Option<String>,
    pub system_prompt: Option<String>,
    pub working_dir: Option<String>,
    pub workspace_id: Option<String>,
    pub execution_strategy: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct PersistedSessionMetadata {
    pub system_prompt: Option<String>,
    pub working_dir: Option<String>,
    pub execution_strategy: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionTitlePreviewMessage {
    pub role: String,
    pub content: String,
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    let trimmed = value?.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn normalize_optional_nonempty_body(value: Option<String>) -> Option<String> {
    let text = value?;
    if text.trim().is_empty() {
        None
    } else {
        Some(text)
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct SessionProviderRoutingState {
    provider_selector: String,
}

impl ExtensionState for SessionProviderRoutingState {
    const EXTENSION_NAME: &'static str = "lime_provider_routing";
    const VERSION: &'static str = "v0";
}

fn resolve_session_provider_selector(session: &AsterSession) -> Option<String> {
    SessionProviderRoutingState::from_extension_data(&session.extension_data)
        .and_then(|state| normalize_optional_text(Some(state.provider_selector)))
}

fn map_session_todo_status(status: TaskBoardItemStatus) -> SessionTodoStatus {
    match status {
        TaskBoardItemStatus::Pending => SessionTodoStatus::Pending,
        TaskBoardItemStatus::InProgress => SessionTodoStatus::InProgress,
        TaskBoardItemStatus::Completed => SessionTodoStatus::Completed,
    }
}

fn map_session_todo_item(item: TaskBoardItem) -> Option<SessionTodoItem> {
    let content = item.subject.trim().to_string();
    if content.is_empty() {
        return None;
    }

    let active_form = normalize_optional_nonempty_body(item.active_form);
    Some(SessionTodoItem {
        content,
        status: map_session_todo_status(item.status),
        active_form,
    })
}

fn load_session_todo_items_from_conn(
    conn: &rusqlite::Connection,
    session_id: &str,
) -> Vec<SessionTodoItem> {
    let extension_data = match LimeSessionStore::load_extension_data_from_conn(conn, session_id) {
        Ok(extension_data) => extension_data,
        Err(error) => {
            tracing::warn!(
                "[SessionStore] 读取 session todo 状态失败: session_id={}, error={}",
                session_id,
                error
            );
            return Vec::new();
        }
    };

    resolve_task_board_state(&extension_data)
        .map(|task_board| {
            task_board
                .items
                .into_iter()
                .filter_map(map_session_todo_item)
                .collect()
        })
        .unwrap_or_default()
}

fn resolve_workspace_id_by_working_dir(
    db: &DbConnection,
    working_dir: Option<&str>,
) -> Option<String> {
    let resolved_working_dir = working_dir?.trim();
    if resolved_working_dir.is_empty() {
        return None;
    }

    let manager = WorkspaceManager::new(db.clone());
    match manager.get_by_path(Path::new(resolved_working_dir)) {
        Ok(workspace) => workspace.map(|entry| entry.id),
        Err(error) => {
            tracing::warn!(
                "[SessionStore] 解析 child subagent workspace 失败，已降级忽略: working_dir={}, error={}",
                resolved_working_dir,
                error
            );
            None
        }
    }
}

fn resolve_subagent_model_name(session: &AsterSession) -> Option<String> {
    session
        .model_config
        .as_ref()
        .map(|config| config.model_name.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| normalize_optional_text(session.provider_name.clone()))
}

fn map_child_subagent_runtime_status(
    status: SubagentRuntimeStatusKind,
) -> Option<ChildSubagentRuntimeStatus> {
    match status {
        SubagentRuntimeStatusKind::Idle => Some(ChildSubagentRuntimeStatus::Idle),
        SubagentRuntimeStatusKind::Queued => Some(ChildSubagentRuntimeStatus::Queued),
        SubagentRuntimeStatusKind::Running => Some(ChildSubagentRuntimeStatus::Running),
        SubagentRuntimeStatusKind::Completed => Some(ChildSubagentRuntimeStatus::Completed),
        SubagentRuntimeStatusKind::Failed => Some(ChildSubagentRuntimeStatus::Failed),
        SubagentRuntimeStatusKind::Aborted => Some(ChildSubagentRuntimeStatus::Aborted),
        SubagentRuntimeStatusKind::Closed => Some(ChildSubagentRuntimeStatus::Closed),
        SubagentRuntimeStatusKind::NotFound => None,
    }
}

#[cfg(test)]
fn resolve_child_subagent_runtime_status_from_snapshot(
    snapshot: &SessionRuntimeSnapshot,
) -> ChildSubagentRuntimeStatus {
    snapshot
        .threads
        .iter()
        .flat_map(|thread| thread.turns.iter())
        .max_by(|left, right| {
            left.updated_at
                .cmp(&right.updated_at)
                .then_with(|| left.created_at.cmp(&right.created_at))
                .then_with(|| left.id.cmp(&right.id))
        })
        .and_then(|turn| {
            map_child_subagent_runtime_status(match turn.status {
                aster::session::TurnStatus::Queued => SubagentRuntimeStatusKind::Queued,
                aster::session::TurnStatus::Running => SubagentRuntimeStatusKind::Running,
                aster::session::TurnStatus::Completed => SubagentRuntimeStatusKind::Completed,
                aster::session::TurnStatus::Failed => SubagentRuntimeStatusKind::Failed,
                aster::session::TurnStatus::Aborted => SubagentRuntimeStatusKind::Aborted,
            })
        })
        .unwrap_or(ChildSubagentRuntimeStatus::Idle)
}

#[derive(Debug, Clone, Default)]
struct SubagentPresentationProjection {
    parent_session_id: String,
    task_summary: Option<String>,
    role_hint: Option<String>,
    origin_tool: Option<String>,
    created_from_turn_id: Option<String>,
    blueprint_role_id: Option<String>,
    blueprint_role_label: Option<String>,
    profile_id: Option<String>,
    profile_name: Option<String>,
    role_key: Option<String>,
    team_preset_id: Option<String>,
    theme: Option<String>,
    output_contract: Option<String>,
    skill_ids: Vec<String>,
    skills: Vec<SubagentSkillSummary>,
}

impl SubagentPresentationProjection {
    fn from_session(session: &AsterSession) -> Option<Self> {
        let metadata = resolve_subagent_session_metadata(&session.extension_data)?;
        let customization = SubagentCustomizationState::from_session(session).unwrap_or_default();
        Some(Self {
            parent_session_id: metadata.parent_session_id,
            task_summary: normalize_optional_nonempty_body(metadata.task_summary),
            role_hint: normalize_optional_text(metadata.role_hint),
            origin_tool: normalize_optional_text(Some(metadata.origin_tool)),
            created_from_turn_id: normalize_optional_text(metadata.created_from_turn_id),
            blueprint_role_id: customization.blueprint_role_id,
            blueprint_role_label: customization.blueprint_role_label,
            profile_id: customization.profile_id,
            profile_name: customization.profile_name,
            role_key: customization.role_key,
            team_preset_id: customization.team_preset_id,
            theme: customization.theme,
            output_contract: customization.output_contract,
            skill_ids: customization.skill_ids,
            skills: customization.skills,
        })
    }

    fn apply_to_child_summary(self, summary: &mut ChildSubagentSession) {
        summary.task_summary = self.task_summary;
        summary.role_hint = self.role_hint;
        summary.origin_tool = self.origin_tool;
        summary.created_from_turn_id = self.created_from_turn_id;
        summary.blueprint_role_id = self.blueprint_role_id;
        summary.blueprint_role_label = self.blueprint_role_label;
        summary.profile_id = self.profile_id;
        summary.profile_name = self.profile_name;
        summary.role_key = self.role_key;
        summary.team_preset_id = self.team_preset_id;
        summary.theme = self.theme;
        summary.output_contract = self.output_contract;
        summary.skill_ids = self.skill_ids;
        summary.skills = self.skills;
    }

    fn into_parent_context(
        self,
        parent_session_name: String,
        current_session_id: &str,
        sibling_subagent_sessions: Vec<ChildSubagentSession>,
    ) -> SubagentParentContext {
        SubagentParentContext {
            parent_session_id: self.parent_session_id,
            parent_session_name,
            role_hint: self.role_hint,
            task_summary: self.task_summary,
            origin_tool: self.origin_tool,
            created_from_turn_id: self.created_from_turn_id,
            blueprint_role_id: self.blueprint_role_id,
            blueprint_role_label: self.blueprint_role_label,
            profile_id: self.profile_id,
            profile_name: self.profile_name,
            role_key: self.role_key,
            team_preset_id: self.team_preset_id,
            theme: self.theme,
            output_contract: self.output_contract,
            skill_ids: self.skill_ids,
            skills: self.skills,
            sibling_subagent_sessions: filter_sibling_subagent_sessions(
                current_session_id,
                sibling_subagent_sessions,
            ),
        }
    }
}

fn filter_sibling_subagent_sessions(
    current_session_id: &str,
    sibling_subagent_sessions: Vec<ChildSubagentSession>,
) -> Vec<ChildSubagentSession> {
    sibling_subagent_sessions
        .into_iter()
        .filter(|session| session.id != current_session_id)
        .collect()
}

fn build_child_subagent_session_summary(
    db: Option<&DbConnection>,
    session: AsterSession,
) -> Option<ChildSubagentSession> {
    let projection = SubagentPresentationProjection::from_session(&session)?;
    let working_dir =
        normalize_optional_text(Some(session.working_dir.to_string_lossy().to_string()));
    let workspace_id =
        db.and_then(|conn| resolve_workspace_id_by_working_dir(conn, working_dir.as_deref()));
    let model = resolve_subagent_model_name(&session);
    let provider_name = normalize_optional_text(session.provider_name.clone());
    let name = normalize_optional_text(Some(session.name.clone()))
        .unwrap_or_else(|| "子代理会话".to_string());

    let mut summary = ChildSubagentSession::new_base(
        session.id,
        name,
        session.created_at.timestamp(),
        session.updated_at.timestamp(),
        session.session_type.to_string(),
        model,
        provider_name,
        working_dir,
        workspace_id,
    );
    projection.apply_to_child_summary(&mut summary);
    Some(summary)
}

fn apply_runtime_status_to_child_subagent_session(
    summary: &mut ChildSubagentSession,
    status: crate::subagent_control::SubagentRuntimeStatus,
) {
    summary.runtime_status = map_child_subagent_runtime_status(status.kind);
    summary.latest_turn_status = status
        .latest_turn_status
        .and_then(map_child_subagent_runtime_status);
    summary.queued_turn_count = status.queued_turn_count;
    summary.team_phase = status.team_phase;
    summary.team_parallel_budget = status.team_parallel_budget;
    summary.team_active_count = status.team_active_count;
    summary.team_queued_count = status.team_queued_count;
    summary.provider_concurrency_group = status.provider_concurrency_group;
    summary.provider_parallel_budget = status.provider_parallel_budget;
    summary.queue_reason = status.queue_reason;
    summary.retryable_overload = status.retryable_overload;
}

fn build_child_subagent_session_summaries(
    db: Option<&DbConnection>,
    sessions: Vec<AsterSession>,
) -> Vec<ChildSubagentSession> {
    let mut summaries = sessions
        .into_iter()
        .filter_map(|session| build_child_subagent_session_summary(db, session))
        .collect::<Vec<_>>();

    summaries.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| left.id.cmp(&right.id))
    });
    summaries
}

fn build_subagent_parent_context(
    current_session_id: &str,
    parent_session: Option<&AsterSession>,
    projection: SubagentPresentationProjection,
    sibling_subagent_sessions: Vec<ChildSubagentSession>,
) -> SubagentParentContext {
    let parent_session_name = parent_session
        .and_then(|session| normalize_optional_text(Some(session.name.clone())))
        .unwrap_or_else(|| "父会话".to_string());

    projection.into_parent_context(
        parent_session_name,
        current_session_id,
        sibling_subagent_sessions,
    )
}

async fn load_child_subagent_sessions(
    db: &DbConnection,
    session_id: &str,
) -> Result<Vec<ChildSubagentSession>, String> {
    let sessions =
        list_child_subagent_sessions(session_id, "读取 child subagent sessions 失败").await?;
    let mut summaries = build_child_subagent_session_summaries(Some(db), sessions);
    for summary in &mut summaries {
        match load_subagent_runtime_status(&summary.id).await {
            Ok(status) => apply_runtime_status_to_child_subagent_session(summary, status),
            Err(error) => {
                tracing::debug!(
                    "[SessionStore] child subagent runtime 状态不可用，按 idle 展示: session_id={}, error={}",
                    summary.id,
                    error
                );
            }
        }
    }
    Ok(summaries)
}

async fn load_subagent_parent_context(
    db: &DbConnection,
    session_id: &str,
) -> Result<Option<SubagentParentContext>, String> {
    let current_session = read_session(session_id, false, "读取当前 subagent session 失败").await?;
    let Some(projection) = SubagentPresentationProjection::from_session(&current_session) else {
        return Ok(None);
    };
    let parent_session_id = projection.parent_session_id.clone();

    let parent_session = match read_session(&parent_session_id, false, "读取 parent session 失败")
        .await
    {
        Ok(session) => Some(session),
        Err(error) => {
            tracing::warn!(
                "[SessionStore] 读取 parent session 失败，已降级为匿名父会话: session_id={}, parent_session_id={}, error={}",
                session_id,
                parent_session_id,
                error
            );
            None
        }
    };

    let sibling_subagent_sessions = match load_child_subagent_sessions(db, &parent_session_id).await
    {
        Ok(sessions) => sessions,
        Err(error) => {
            tracing::warn!(
                "[SessionStore] 读取 sibling subagent sessions 失败，已降级为空列表: session_id={}, parent_session_id={}, error={}",
                session_id,
                parent_session_id,
                error
            );
            Vec::new()
        }
    };

    Ok(Some(build_subagent_parent_context(
        session_id,
        parent_session.as_ref(),
        projection,
        sibling_subagent_sessions,
    )))
}

fn sort_runtime_turns(turns: &mut [AgentThreadTurn]) {
    turns.sort_by(|left, right| {
        left.started_at
            .cmp(&right.started_at)
            .then(left.created_at.cmp(&right.created_at))
            .then(left.id.cmp(&right.id))
    });
}

fn sort_runtime_items(items: &mut [AgentThreadItem], turn_started_at: &HashMap<String, String>) {
    items.sort_by(|left, right| {
        let left_turn_started = turn_started_at
            .get(&left.turn_id)
            .map(String::as_str)
            .unwrap_or(left.started_at.as_str());
        let right_turn_started = turn_started_at
            .get(&right.turn_id)
            .map(String::as_str)
            .unwrap_or(right.started_at.as_str());

        left_turn_started
            .cmp(right_turn_started)
            .then(left.sequence.cmp(&right.sequence))
            .then(left.turn_id.cmp(&right.turn_id))
            .then(left.started_at.cmp(&right.started_at))
            .then(left.id.cmp(&right.id))
    });
}

fn apply_aster_runtime_snapshot(detail: &mut SessionDetail, snapshot: &SessionRuntimeSnapshot) {
    if let Some(thread) = snapshot.threads.first() {
        detail.thread_id = thread.thread.id.clone();
    }

    if snapshot.threads.is_empty() {
        return;
    }

    let mut turns_by_id = detail
        .turns
        .drain(..)
        .map(|turn| (turn.id.clone(), turn))
        .collect::<HashMap<_, _>>();
    for thread in &snapshot.threads {
        for turn in &thread.turns {
            turns_by_id.insert(turn.id.clone(), project_turn_runtime(turn.clone()));
        }
    }
    detail.turns = turns_by_id.into_values().collect();
    sort_runtime_turns(&mut detail.turns);

    let turn_started_at = detail
        .turns
        .iter()
        .map(|turn| (turn.id.clone(), turn.started_at.clone()))
        .collect::<HashMap<_, _>>();

    let mut items_by_id = detail
        .items
        .drain(..)
        .map(|item| (item.id.clone(), item))
        .collect::<HashMap<_, _>>();
    for thread in &snapshot.threads {
        for item in &thread.items {
            items_by_id.insert(item.id.clone(), project_item_runtime(item.clone()));
        }
    }
    detail.items = items_by_id.into_values().collect();
    sort_runtime_items(&mut detail.items, &turn_started_at);
}

fn build_runtime_session_info(overview: SessionRecordOverview) -> SessionInfo {
    let working_dir = overview.working_dir;
    let workspace_id = overview.workspace_id;

    SessionInfo {
        id: overview.id,
        name: overview.title.unwrap_or_else(|| "未命名".to_string()),
        created_at: chrono::DateTime::parse_from_rfc3339(&overview.created_at)
            .map(|dt| dt.timestamp())
            .unwrap_or(0),
        updated_at: chrono::DateTime::parse_from_rfc3339(&overview.updated_at)
            .map(|dt| dt.timestamp())
            .unwrap_or(0),
        messages_count: overview.messages_count,
        execution_strategy: overview.execution_strategy,
        model: Some(overview.model),
        working_dir,
        workspace_id,
    }
}

/// 解析会话 working_dir（优先入参，其次 workspace_id）
fn resolve_session_working_dir(
    db: &DbConnection,
    working_dir: Option<String>,
    workspace_id: String,
) -> Result<Option<String>, String> {
    if let Some(path) = working_dir {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return Ok(Some(trimmed.to_string()));
        }
    }

    let workspace_id = workspace_id.trim().to_string();
    if workspace_id.is_empty() {
        return Err("workspace_id 必填，请先选择项目工作区".to_string());
    }

    let manager = WorkspaceManager::new(db.clone());
    if let Some(workspace) = manager.get(&workspace_id)? {
        return Ok(Some(workspace.root_path.to_string_lossy().to_string()));
    }

    Err(format!("Workspace 不存在: {}", workspace_id))
}

fn normalize_execution_strategy(execution_strategy: Option<String>) -> String {
    match execution_strategy.as_deref() {
        Some("code_orchestrated") => "code_orchestrated".to_string(),
        Some("auto") => "auto".to_string(),
        _ => "react".to_string(),
    }
}

fn resolve_optional_session_working_dir(
    db: &DbConnection,
    working_dir: Option<String>,
    workspace_id: Option<String>,
) -> Result<Option<String>, String> {
    if let Some(path) = normalize_optional_text(working_dir) {
        return Ok(Some(path));
    }

    if let Some(workspace_id) = normalize_optional_text(workspace_id) {
        return resolve_session_working_dir(db, None, workspace_id);
    }

    Ok(None)
}

/// 创建并持久化会话记录
pub(crate) fn create_session_record_sync(
    db: &DbConnection,
    input: CreateSessionRecordInput,
) -> Result<AgentSession, String> {
    let now = Utc::now().to_rfc3339();
    let session = AgentSession {
        id: normalize_optional_text(input.session_id).unwrap_or_else(|| Uuid::new_v4().to_string()),
        model: normalize_optional_text(input.model).unwrap_or_else(|| "agent:default".to_string()),
        messages: Vec::new(),
        system_prompt: normalize_optional_nonempty_body(input.system_prompt),
        title: normalize_optional_text(input.title),
        working_dir: resolve_optional_session_working_dir(
            db,
            input.working_dir,
            input.workspace_id,
        )?,
        execution_strategy: Some(normalize_execution_strategy(input.execution_strategy)),
        created_at: now.clone(),
        updated_at: now,
    };

    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    agent_session_repository::create_session(&conn, &session)?;

    Ok(session)
}

/// 创建新会话
pub fn create_session_sync(
    db: &DbConnection,
    name: Option<String>,
    working_dir: Option<String>,
    workspace_id: String,
    execution_strategy: Option<String>,
) -> Result<String, String> {
    let session = create_session_record_sync(
        db,
        CreateSessionRecordInput {
            title: Some(normalize_optional_text(name).unwrap_or_else(|| "新对话".to_string())),
            working_dir,
            workspace_id: Some(workspace_id),
            execution_strategy,
            ..CreateSessionRecordInput::default()
        },
    )?;

    Ok(session.id)
}

/// 列出所有会话
pub fn list_sessions_sync(db: &DbConnection) -> Result<Vec<SessionInfo>, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    let sessions = agent_session_repository::list_session_overviews(&conn)?;

    Ok(sessions
        .into_iter()
        .map(build_runtime_session_info)
        .collect())
}

pub fn get_persisted_session_metadata_sync(
    db: &DbConnection,
    session_id: &str,
) -> Result<Option<PersistedSessionMetadata>, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    let session = agent_session_repository::get_persisted_session_metadata(&conn, session_id)?;

    Ok(
        session.map(|metadata: SessionRecordMetadata| PersistedSessionMetadata {
            system_prompt: metadata.system_prompt,
            working_dir: metadata.working_dir,
            execution_strategy: metadata.execution_strategy,
        }),
    )
}

pub fn list_title_preview_messages_sync(
    db: &DbConnection,
    session_id: &str,
    limit: usize,
) -> Result<Vec<SessionTitlePreviewMessage>, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    let messages = agent_session_repository::list_title_preview_messages(&conn, session_id, limit)?;

    Ok(messages
        .into_iter()
        .map(
            |msg: SessionRecordPreviewMessage| SessionTitlePreviewMessage {
                role: msg.role,
                content: msg.content,
            },
        )
        .collect())
}

/// 获取会话详情
pub fn get_session_sync(db: &DbConnection, session_id: &str) -> Result<SessionDetail, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;

    let SessionRecordDetail {
        session,
        workspace_id,
    } = agent_session_repository::get_session_with_messages(&conn, session_id)?
        .ok_or_else(|| format!("会话不存在: {session_id}"))?;

    let turns = AgentTimelineDao::list_turns_by_thread(&conn, session_id)
        .map_err(|e| format!("获取 turn 历史失败: {e}"))?;
    let items = AgentTimelineDao::list_items_by_thread(&conn, session_id)
        .map_err(|e| format!("获取 item 历史失败: {e}"))?;
    let working_dir = session.working_dir.clone();
    let todo_items = load_session_todo_items_from_conn(&conn, session_id);

    let tauri_messages = convert_agent_messages(&session.messages, Some(session.model.as_str()));

    tracing::debug!(
        "[SessionStore] 会话消息转换完成: session_id={}, messages_count={}",
        session_id,
        tauri_messages.len()
    );

    Ok(SessionDetail {
        id: session.id,
        name: session.title.unwrap_or_else(|| "未命名".to_string()),
        created_at: chrono::DateTime::parse_from_rfc3339(&session.created_at)
            .map(|dt| dt.timestamp())
            .unwrap_or(0),
        updated_at: chrono::DateTime::parse_from_rfc3339(&session.updated_at)
            .map(|dt| dt.timestamp())
            .unwrap_or(0),
        thread_id: session_id.to_string(),
        model: Some(session.model),
        working_dir,
        workspace_id,
        messages: tauri_messages,
        execution_strategy: session.execution_strategy,
        execution_runtime: None,
        turns,
        items,
        todo_items,
        child_subagent_sessions: Vec::new(),
        subagent_parent_context: None,
    })
}

pub async fn get_runtime_session_detail(
    db: &DbConnection,
    session_id: &str,
) -> Result<SessionDetail, String> {
    let mut detail = get_session_sync(db, session_id)?;
    let session = match read_session(session_id, false, "读取运行态 session 失败").await {
        Ok(session) => Some(session),
        Err(error) => {
            tracing::warn!(
                "[SessionStore] 读取运行态 session 失败，execution runtime 已降级忽略: session_id={}, error={}",
                session_id,
                error
            );
            None
        }
    };
    let runtime_snapshot = match load_aster_runtime_snapshot(session_id).await {
        Ok(snapshot) => Some(snapshot),
        Err(error) => {
            tracing::warn!(
                "[SessionStore] 读取 Aster runtime snapshot 失败: session_id={}, error={}",
                session_id,
                error
            );
            None
        }
    };

    detail.execution_runtime = build_session_execution_runtime(
        session_id,
        session.as_ref(),
        detail.execution_strategy.clone(),
        runtime_snapshot.as_ref(),
        session.as_ref().and_then(resolve_session_provider_selector),
    );

    if let Some(snapshot) = runtime_snapshot.as_ref() {
        apply_aster_runtime_snapshot(&mut detail, snapshot);
    }

    match load_child_subagent_sessions(db, session_id).await {
        Ok(child_subagent_sessions) => {
            detail.child_subagent_sessions = child_subagent_sessions;
        }
        Err(error) => {
            tracing::warn!(
                "[SessionStore] 读取 child subagent sessions 失败: session_id={}, error={}",
                session_id,
                error
            );
        }
    }

    match load_subagent_parent_context(db, session_id).await {
        Ok(subagent_parent_context) => {
            detail.subagent_parent_context = subagent_parent_context;
        }
        Err(error) => {
            tracing::warn!(
                "[SessionStore] 读取 subagent parent context 失败: session_id={}, error={}",
                session_id,
                error
            );
        }
    }

    Ok(detail)
}

/// 重命名会话
pub fn rename_session_sync(db: &DbConnection, session_id: &str, name: &str) -> Result<(), String> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("会话名称不能为空".to_string());
    }

    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    let now = Utc::now().to_rfc3339();
    agent_session_repository::rename_session(&conn, session_id, trimmed_name, &now)?;

    Ok(())
}

pub fn update_session_working_dir_sync(
    db: &DbConnection,
    session_id: &str,
    working_dir: &str,
) -> Result<(), String> {
    let trimmed_working_dir = working_dir.trim();
    if trimmed_working_dir.is_empty() {
        return Err("working_dir 不能为空".to_string());
    }

    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    agent_session_repository::update_session_working_dir(&conn, session_id, trimmed_working_dir)?;

    Ok(())
}

pub fn update_session_execution_strategy_sync(
    db: &DbConnection,
    session_id: &str,
    execution_strategy: &str,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    agent_session_repository::update_session_execution_strategy(
        &conn,
        session_id,
        execution_strategy,
    )?;
    Ok(())
}

pub fn update_session_provider_config_sync(
    db: &DbConnection,
    session_id: &str,
    provider_name: Option<&str>,
    model_name: Option<&str>,
) -> Result<(), String> {
    let normalized_provider_name = provider_name
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let normalized_model_name = model_name.map(str::trim).filter(|value| !value.is_empty());

    if normalized_provider_name.is_none() && normalized_model_name.is_none() {
        return Ok(());
    }

    let model_config_json = normalized_model_name
        .map(ModelConfig::new)
        .transpose()
        .map_err(|error| format!("构建 model_config 失败: {error}"))?
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|error| format!("序列化 model_config 失败: {error}"))?;
    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    let now = Utc::now().to_rfc3339();

    agent_session_repository::update_session_provider_config(
        &conn,
        session_id,
        normalized_provider_name,
        normalized_model_name,
        model_config_json.as_deref(),
        &now,
    )?;
    Ok(())
}

/// 删除会话
pub async fn delete_session(db: &DbConnection, session_id: &str) -> Result<(), String> {
    aster::session::SessionStore::delete_session(&LimeSessionStore::new(db.clone()), session_id)
        .await
        .map_err(|e| format!("删除会话失败: {e}"))
}

fn parse_tool_call_arguments(arguments: &str) -> serde_json::Value {
    let trimmed = arguments.trim();
    if trimmed.is_empty() {
        return serde_json::json!({});
    }

    serde_json::from_str::<serde_json::Value>(trimmed)
        .unwrap_or_else(|_| serde_json::json!({ "raw": arguments }))
}

fn parse_data_url(url: &str) -> Option<(String, String)> {
    let trimmed = url.trim();
    let payload = trimmed.strip_prefix("data:")?;
    let (meta, data) = payload.split_once(',')?;
    if data.trim().is_empty() {
        return None;
    }

    let mut segments = meta.split(';');
    let mime_type = segments.next().unwrap_or_default().trim();
    let has_base64 = segments.any(|segment| segment.eq_ignore_ascii_case("base64"));

    if !has_base64 {
        return None;
    }

    let normalized_mime = if mime_type.is_empty() {
        "application/octet-stream".to_string()
    } else {
        mime_type.to_string()
    };

    Some((normalized_mime, data.trim().to_string()))
}

fn convert_image_part(image_url: &str) -> Option<RuntimeAgentMessageContent> {
    let normalized = image_url.trim();
    if normalized.is_empty() {
        return None;
    }

    if let Some((mime_type, data)) = parse_data_url(normalized) {
        return Some(RuntimeAgentMessageContent::Image { mime_type, data });
    }

    if normalized.starts_with("data:") {
        return Some(RuntimeAgentMessageContent::Text {
            text: "[图片消息]".to_string(),
        });
    }

    Some(RuntimeAgentMessageContent::Text {
        text: format!("![image]({normalized})"),
    })
}

/// 将 AgentMessage 转换为运行时协议消息
fn convert_agent_messages(
    messages: &[AgentMessage],
    model_name: Option<&str>,
) -> Vec<RuntimeAgentMessage> {
    let eviction_plan = build_history_tool_io_eviction_plan_for_model(messages, model_name);
    messages
        .iter()
        .map(|message| convert_agent_message(message, &eviction_plan))
        .collect()
}

fn convert_agent_message(
    message: &AgentMessage,
    eviction_plan: &crate::tool_io_offload::HistoryToolIoEvictionPlan,
) -> RuntimeAgentMessage {
    let mut content = match &message.content {
        MessageContent::Text(text) => {
            if text.trim().is_empty() {
                Vec::new()
            } else {
                vec![RuntimeAgentMessageContent::Text { text: text.clone() }]
            }
        }
        MessageContent::Parts(parts) => parts
            .iter()
            .filter_map(|part| match part {
                ContentPart::Text { text } => {
                    if text.trim().is_empty() {
                        None
                    } else {
                        Some(RuntimeAgentMessageContent::Text { text: text.clone() })
                    }
                }
                ContentPart::ImageUrl { image_url } => convert_image_part(&image_url.url),
            })
            .collect(),
    };

    // 添加 reasoning_content 作为 thinking 类型
    if let Some(reasoning) = &message.reasoning_content {
        content.insert(
            0,
            RuntimeAgentMessageContent::Thinking {
                text: reasoning.clone(),
            },
        );
    }

    if let Some(tool_calls) = &message.tool_calls {
        for call in tool_calls {
            let parsed_arguments = parse_tool_call_arguments(&call.function.arguments);
            let arguments = if eviction_plan.request_ids.contains(&call.id) {
                force_offload_tool_arguments_for_history(&call.id, &parsed_arguments)
            } else {
                maybe_offload_tool_arguments(&call.id, &parsed_arguments)
            };
            content.push(RuntimeAgentMessageContent::ToolRequest {
                id: call.id.clone(),
                tool_name: call.function.name.clone(),
                arguments,
            });
        }
    }

    if let Some(tool_call_id) = &message.tool_call_id {
        let tool_output = message.content.as_text();
        let offloaded = if eviction_plan.response_ids.contains(tool_call_id) {
            force_offload_plain_tool_output_for_history(tool_call_id, &tool_output, None)
        } else {
            maybe_offload_plain_tool_output(tool_call_id, &tool_output, None)
        };

        // tool/user 的工具结果协议消息都不应作为普通文本重复渲染。
        if message.role.eq_ignore_ascii_case("tool") || message.role.eq_ignore_ascii_case("user") {
            content.retain(|part| !matches!(part, RuntimeAgentMessageContent::Text { .. }));
        }

        content.push(RuntimeAgentMessageContent::ToolResponse {
            id: tool_call_id.clone(),
            success: true,
            output: offloaded.output,
            error: None,
            images: None,
            metadata: if offloaded.metadata.is_empty() {
                None
            } else {
                Some(offloaded.metadata)
            },
        });
    }

    let timestamp = chrono::DateTime::parse_from_rfc3339(&message.timestamp)
        .map(|dt| dt.timestamp())
        .unwrap_or(0);

    let result = RuntimeAgentMessage {
        id: None,
        role: message.role.clone(),
        content,
        timestamp,
    };

    // 调试日志
    tracing::debug!(
        "[SessionStore] 转换消息: role={}, content_items={}",
        result.role,
        result.content.len()
    );

    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use aster::session::{
        SessionType as AsterSessionType, SubagentSessionMetadata, ThreadRuntime,
        ThreadRuntimeSnapshot, TurnRuntime, TurnStatus,
    };
    use chrono::{Duration, Utc};
    use lime_core::agent::types::{FunctionCall, ImageUrl, ToolCall};
    use lime_core::database::{schema, DbConnection};
    use std::ffi::OsString;
    use std::sync::{Arc, Mutex, OnceLock};

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    struct EnvGuard {
        values: Vec<(&'static str, Option<OsString>)>,
    }

    impl EnvGuard {
        fn set(entries: &[(&'static str, OsString)]) -> Self {
            let mut values = Vec::new();
            for (key, value) in entries {
                values.push((*key, std::env::var_os(key)));
                std::env::set_var(key, value);
            }
            Self { values }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            for (key, previous) in self.values.drain(..) {
                if let Some(value) = previous {
                    std::env::set_var(key, value);
                } else {
                    std::env::remove_var(key);
                }
            }
        }
    }

    fn create_test_db() -> DbConnection {
        let conn = rusqlite::Connection::open_in_memory().expect("open in-memory db");
        schema::create_tables(&conn).expect("create tables");
        Arc::new(Mutex::new(conn))
    }

    fn insert_test_workspace(db: &DbConnection, workspace_id: &str, root_path: &str) {
        let conn = db.lock().expect("lock db");
        conn.execute(
            "INSERT INTO workspaces (id, name, workspace_type, root_path, is_default, settings_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 0, '{}', 0, 0)",
            rusqlite::params![workspace_id, "测试工作区", "general", root_path],
        )
        .expect("insert workspace");
    }

    fn insert_test_session_with_message(
        db: &DbConnection,
        session_id: &str,
        working_dir: &str,
        message_text: &str,
    ) {
        create_session_record_sync(
            db,
            CreateSessionRecordInput {
                session_id: Some(session_id.to_string()),
                title: Some("测试会话".to_string()),
                model: Some("agent:test".to_string()),
                working_dir: Some(working_dir.to_string()),
                execution_strategy: Some("react".to_string()),
                ..CreateSessionRecordInput::default()
            },
        )
        .expect("create session");

        let conn = db.lock().expect("lock db");
        AgentDao::add_message(
            &conn,
            session_id,
            &AgentMessage {
                role: "user".to_string(),
                content: MessageContent::Text(message_text.to_string()),
                timestamp: "2026-03-18T08:00:00Z".to_string(),
                tool_calls: None,
                tool_call_id: None,
                reasoning_content: None,
            },
        )
        .expect("add message");
    }

    fn build_test_subagent_session(
        session_id: &str,
        name: &str,
        parent_session_id: Option<&str>,
        updated_at: chrono::DateTime<Utc>,
        task_summary: Option<&str>,
        role_hint: Option<&str>,
        created_from_turn_id: Option<&str>,
    ) -> AsterSession {
        let mut session = AsterSession {
            id: session_id.to_string(),
            name: name.to_string(),
            session_type: AsterSessionType::SubAgent,
            created_at: updated_at - Duration::minutes(1),
            updated_at,
            provider_name: Some("openai".to_string()),
            working_dir: std::path::PathBuf::from("/tmp/workspace-child"),
            ..AsterSession::default()
        };

        if let Some(parent_session_id) = parent_session_id {
            session.extension_data = SubagentSessionMetadata::new(parent_session_id.to_string())
                .with_task_summary(task_summary.map(str::to_string))
                .with_role_hint(role_hint.map(str::to_string))
                .with_created_from_turn_id(created_from_turn_id.map(str::to_string))
                .into_updated_extension_data(&AsterSession::default())
                .expect("build child metadata");
        }

        session
    }

    #[test]
    fn parse_tool_call_arguments_should_parse_json_or_keep_raw() {
        let parsed = parse_tool_call_arguments(r#"{"path":"./a.txt"}"#);
        assert_eq!(parsed["path"], serde_json::json!("./a.txt"));

        let fallback = parse_tool_call_arguments("not-json");
        assert_eq!(fallback["raw"], serde_json::json!("not-json"));
    }

    #[test]
    fn build_child_subagent_session_summaries_should_filter_and_sort_by_updated_at_desc() {
        let now = Utc::now();
        let summaries = build_child_subagent_session_summaries(
            None,
            vec![
                build_test_subagent_session(
                    "child-old",
                    "旧子代理",
                    Some("parent-1"),
                    now - Duration::minutes(5),
                    Some("先检查日志"),
                    Some("explorer"),
                    Some("turn-1"),
                ),
                build_test_subagent_session(
                    "ignored",
                    "忽略项",
                    None,
                    now - Duration::minutes(1),
                    None,
                    None,
                    None,
                ),
                build_test_subagent_session(
                    "child-new",
                    "新子代理",
                    Some("parent-1"),
                    now,
                    Some("补充真实 team runtime"),
                    Some("planner"),
                    Some("turn-2"),
                ),
            ],
        );

        assert_eq!(summaries.len(), 2);
        assert_eq!(summaries[0].id, "child-new");
        assert_eq!(summaries[0].session_type, "sub_agent");
        assert_eq!(
            summaries[0].task_summary.as_deref(),
            Some("补充真实 team runtime")
        );
        assert_eq!(summaries[0].role_hint.as_deref(), Some("planner"));
        assert_eq!(summaries[0].created_from_turn_id.as_deref(), Some("turn-2"));
        assert_eq!(summaries[1].id, "child-old");
    }

    #[test]
    fn build_child_subagent_session_summary_should_merge_customization_state() {
        let now = Utc::now();
        let mut session = build_test_subagent_session(
            "child-customized",
            "自定义子代理",
            Some("parent-1"),
            now,
            Some("整理 customization"),
            Some("Image #1"),
            Some("turn-9"),
        );
        session.extension_data = SubagentCustomizationState {
            blueprint_role_id: Some("runtime-explorer".to_string()),
            blueprint_role_label: Some("分析".to_string()),
            profile_id: Some("code-explorer".to_string()),
            profile_name: Some("代码分析员".to_string()),
            role_key: Some("explorer".to_string()),
            team_preset_id: Some("code-triage-team".to_string()),
            theme: Some("engineering".to_string()),
            output_contract: Some("输出证据、影响面与建议。".to_string()),
            system_overlay: None,
            skill_ids: vec!["repo-exploration".to_string()],
            skills: vec![SubagentSkillSummary {
                id: "repo-exploration".to_string(),
                name: "仓库探索".to_string(),
                description: Some("优先读事实源".to_string()),
                source: Some("builtin".to_string()),
                directory: None,
            }],
        }
        .into_updated_extension_data(&session)
        .expect("merge customization");

        let summary = build_child_subagent_session_summary(None, session)
            .expect("child summary should exist");

        assert_eq!(
            summary.blueprint_role_id.as_deref(),
            Some("runtime-explorer")
        );
        assert_eq!(summary.blueprint_role_label.as_deref(), Some("分析"));
        assert_eq!(summary.profile_id.as_deref(), Some("code-explorer"));
        assert_eq!(summary.profile_name.as_deref(), Some("代码分析员"));
        assert_eq!(summary.role_key.as_deref(), Some("explorer"));
        assert_eq!(summary.team_preset_id.as_deref(), Some("code-triage-team"));
        assert_eq!(summary.theme.as_deref(), Some("engineering"));
        assert_eq!(
            summary.output_contract.as_deref(),
            Some("输出证据、影响面与建议。")
        );
        assert_eq!(summary.skill_ids, vec!["repo-exploration".to_string()]);
        assert_eq!(summary.skills.len(), 1);
        assert_eq!(summary.skills[0].name, "仓库探索");
    }

    #[test]
    fn build_subagent_parent_context_should_keep_parent_name_and_filter_current_session() {
        let now = Utc::now();
        let session = build_test_subagent_session(
            "child-current",
            "Image #1",
            Some("parent-1"),
            now - Duration::seconds(10),
            Some("处理父线程拆分出来的图片任务"),
            Some("Image #1"),
            Some("turn-2"),
        );
        let parent_session = AsterSession {
            id: "parent-1".to_string(),
            name: "主线程会话".to_string(),
            session_type: AsterSessionType::User,
            ..AsterSession::default()
        };
        let sibling_subagent_sessions = build_child_subagent_session_summaries(
            None,
            vec![
                build_test_subagent_session(
                    "child-current",
                    "Image #1",
                    Some("parent-1"),
                    now - Duration::seconds(10),
                    Some("当前子代理"),
                    Some("Image #1"),
                    Some("turn-2"),
                ),
                build_test_subagent_session(
                    "child-sibling",
                    "Image #2",
                    Some("parent-1"),
                    now,
                    Some("兄弟子代理"),
                    Some("Image #2"),
                    Some("turn-2"),
                ),
            ],
        );
        let projection =
            SubagentPresentationProjection::from_session(&session).expect("parent projection");

        let context = build_subagent_parent_context(
            "child-current",
            Some(&parent_session),
            projection,
            sibling_subagent_sessions,
        );

        assert_eq!(context.parent_session_id, "parent-1");
        assert_eq!(context.parent_session_name, "主线程会话");
        assert_eq!(context.role_hint.as_deref(), Some("Image #1"));
        assert_eq!(
            context.task_summary.as_deref(),
            Some("处理父线程拆分出来的图片任务")
        );
        assert_eq!(context.created_from_turn_id.as_deref(), Some("turn-2"));
        assert_eq!(context.sibling_subagent_sessions.len(), 1);
        assert_eq!(context.sibling_subagent_sessions[0].id, "child-sibling");
    }

    #[test]
    fn build_subagent_parent_context_should_merge_customization_projection() {
        let now = Utc::now();
        let mut session = build_test_subagent_session(
            "child-customized",
            "自定义子代理",
            Some("parent-1"),
            now,
            Some("整理 customization"),
            Some("Image #1"),
            Some("turn-9"),
        );
        session.extension_data = SubagentCustomizationState {
            blueprint_role_id: Some("runtime-explorer".to_string()),
            blueprint_role_label: Some("分析".to_string()),
            profile_id: Some("code-explorer".to_string()),
            profile_name: Some("代码分析员".to_string()),
            role_key: Some("explorer".to_string()),
            team_preset_id: Some("code-triage-team".to_string()),
            theme: Some("engineering".to_string()),
            output_contract: Some("输出证据、影响面与建议。".to_string()),
            system_overlay: None,
            skill_ids: vec!["repo-exploration".to_string()],
            skills: vec![SubagentSkillSummary {
                id: "repo-exploration".to_string(),
                name: "仓库探索".to_string(),
                description: Some("优先读事实源".to_string()),
                source: Some("builtin".to_string()),
                directory: None,
            }],
        }
        .into_updated_extension_data(&session)
        .expect("merge customization");

        let context = build_subagent_parent_context(
            "child-customized",
            None,
            SubagentPresentationProjection::from_session(&session)
                .expect("parent projection should exist"),
            Vec::new(),
        );

        assert_eq!(
            context.blueprint_role_id.as_deref(),
            Some("runtime-explorer")
        );
        assert_eq!(context.blueprint_role_label.as_deref(), Some("分析"));
        assert_eq!(context.profile_id.as_deref(), Some("code-explorer"));
        assert_eq!(context.profile_name.as_deref(), Some("代码分析员"));
        assert_eq!(context.role_key.as_deref(), Some("explorer"));
        assert_eq!(context.team_preset_id.as_deref(), Some("code-triage-team"));
        assert_eq!(context.theme.as_deref(), Some("engineering"));
        assert_eq!(
            context.output_contract.as_deref(),
            Some("输出证据、影响面与建议。")
        );
        assert_eq!(context.skill_ids, vec!["repo-exploration".to_string()]);
        assert_eq!(context.skills.len(), 1);
        assert_eq!(context.skills[0].name, "仓库探索");
    }

    #[test]
    fn resolve_child_subagent_runtime_status_from_snapshot_should_use_latest_turn_status() {
        let now = Utc::now();
        let snapshot = SessionRuntimeSnapshot {
            session_id: "child-session-1".to_string(),
            threads: vec![ThreadRuntimeSnapshot {
                thread: ThreadRuntime::new(
                    "thread-1",
                    "child-session-1",
                    std::path::PathBuf::from("/tmp/workspace-child"),
                ),
                turns: vec![
                    TurnRuntime {
                        id: "turn-old".to_string(),
                        session_id: "child-session-1".to_string(),
                        thread_id: "thread-1".to_string(),
                        status: TurnStatus::Running,
                        input_text: Some("旧任务".to_string()),
                        error_message: None,
                        context_override: None,
                        output_schema_runtime: None,
                        created_at: now - Duration::minutes(2),
                        started_at: Some(now - Duration::minutes(2)),
                        completed_at: None,
                        updated_at: now - Duration::minutes(1),
                    },
                    TurnRuntime {
                        id: "turn-new".to_string(),
                        session_id: "child-session-1".to_string(),
                        thread_id: "thread-1".to_string(),
                        status: TurnStatus::Completed,
                        input_text: Some("新任务".to_string()),
                        error_message: None,
                        context_override: None,
                        output_schema_runtime: None,
                        created_at: now - Duration::seconds(30),
                        started_at: Some(now - Duration::seconds(30)),
                        completed_at: Some(now - Duration::seconds(10)),
                        updated_at: now,
                    },
                ],
                items: Vec::new(),
            }],
        };

        assert_eq!(
            resolve_child_subagent_runtime_status_from_snapshot(&snapshot),
            ChildSubagentRuntimeStatus::Completed
        );
    }

    #[test]
    fn apply_runtime_status_to_child_subagent_session_should_keep_runtime_detail() {
        let mut summary = ChildSubagentSession::new_base(
            "child-1".to_string(),
            "研究员".to_string(),
            1_710_000_000,
            1_710_000_100,
            "sub_agent".to_string(),
            Some("claude-sonnet-4".to_string()),
            Some("openai".to_string()),
            Some("/tmp/workspace-child".to_string()),
            Some("workspace-1".to_string()),
        );
        summary.task_summary = Some("整理事实源".to_string());
        summary.role_hint = Some("explorer".to_string());
        summary.origin_tool = Some("Agent".to_string());
        summary.created_from_turn_id = Some("turn-1".to_string());

        apply_runtime_status_to_child_subagent_session(
            &mut summary,
            crate::subagent_control::SubagentRuntimeStatus {
                session_id: "child-1".to_string(),
                kind: SubagentRuntimeStatusKind::Queued,
                latest_turn_id: Some("turn-queued".to_string()),
                latest_turn_status: Some(SubagentRuntimeStatusKind::Completed),
                queued_turn_count: 2,
                team_phase: Some("queued".to_string()),
                team_parallel_budget: Some(2),
                team_active_count: Some(2),
                team_queued_count: Some(1),
                provider_concurrency_group: Some("zhipuai".to_string()),
                provider_parallel_budget: Some(1),
                queue_reason: Some(
                    "为了避免当前模型通道因并发过多直接拒绝请求，系统已切换为低并发顺序处理。"
                        .to_string(),
                ),
                retryable_overload: true,
                closed: false,
            },
        );

        assert_eq!(
            summary.runtime_status,
            Some(ChildSubagentRuntimeStatus::Queued)
        );
        assert_eq!(
            summary.latest_turn_status,
            Some(ChildSubagentRuntimeStatus::Completed)
        );
        assert_eq!(summary.queued_turn_count, 2);
        assert_eq!(summary.team_phase.as_deref(), Some("queued"));
        assert_eq!(
            summary.provider_concurrency_group.as_deref(),
            Some("zhipuai")
        );
        assert!(summary.retryable_overload);
    }

    #[test]
    fn convert_agent_message_should_preserve_tool_request_and_response() {
        let assistant = AgentMessage {
            role: "assistant".to_string(),
            content: MessageContent::Text("".to_string()),
            timestamp: "2026-02-19T13:00:00Z".to_string(),
            tool_calls: Some(vec![ToolCall {
                id: "call-1".to_string(),
                call_type: "function".to_string(),
                function: FunctionCall {
                    name: "Write".to_string(),
                    arguments: r#"{"path":"./a.txt"}"#.to_string(),
                },
            }]),
            tool_call_id: None,
            reasoning_content: None,
        };

        let assistant_converted = convert_agent_message(
            &assistant,
            &crate::tool_io_offload::HistoryToolIoEvictionPlan::default(),
        );
        assert!(assistant_converted.content.iter().any(|part| {
            matches!(
                part,
                RuntimeAgentMessageContent::ToolRequest { id, tool_name, .. }
                    if id == "call-1" && tool_name == "Write"
            )
        }));

        let tool = AgentMessage {
            role: "tool".to_string(),
            content: MessageContent::Text("写入成功".to_string()),
            timestamp: "2026-02-19T13:00:01Z".to_string(),
            tool_calls: None,
            tool_call_id: Some("call-1".to_string()),
            reasoning_content: None,
        };

        let tool_converted = convert_agent_message(
            &tool,
            &crate::tool_io_offload::HistoryToolIoEvictionPlan::default(),
        );
        assert!(!tool_converted
            .content
            .iter()
            .any(|part| matches!(part, RuntimeAgentMessageContent::Text { .. })));
        assert!(tool_converted.content.iter().any(|part| {
            matches!(
                part,
                RuntimeAgentMessageContent::ToolResponse { id, output, .. }
                    if id == "call-1" && output == "写入成功"
            )
        }));
    }

    #[test]
    fn convert_agent_message_should_keep_image_parts_for_history() {
        let user_with_image = AgentMessage {
            role: "user".to_string(),
            content: MessageContent::Parts(vec![
                ContentPart::Text {
                    text: "参考图".to_string(),
                },
                ContentPart::ImageUrl {
                    image_url: ImageUrl {
                        url: "data:image/png;base64,aGVsbG8=".to_string(),
                        detail: None,
                    },
                },
            ]),
            timestamp: "2026-02-19T13:00:02Z".to_string(),
            tool_calls: None,
            tool_call_id: None,
            reasoning_content: None,
        };

        let converted = convert_agent_message(
            &user_with_image,
            &crate::tool_io_offload::HistoryToolIoEvictionPlan::default(),
        );
        assert!(converted.content.iter().any(|part| {
            matches!(
                part,
                RuntimeAgentMessageContent::Image { mime_type, data }
                    if mime_type == "image/png" && data == "aGVsbG8="
            )
        }));
        assert!(converted.content.iter().any(
            |part| matches!(part, RuntimeAgentMessageContent::Text { text } if text == "参考图")
        ));
    }

    #[test]
    fn convert_agent_message_should_not_render_user_tool_response_as_plain_text() {
        let user_tool_response = AgentMessage {
            role: "user".to_string(),
            content: MessageContent::Text("任务已完成".to_string()),
            timestamp: "2026-02-19T13:00:03Z".to_string(),
            tool_calls: None,
            tool_call_id: Some("call-2".to_string()),
            reasoning_content: None,
        };

        let converted = convert_agent_message(
            &user_tool_response,
            &crate::tool_io_offload::HistoryToolIoEvictionPlan::default(),
        );
        assert!(!converted
            .content
            .iter()
            .any(|part| matches!(part, RuntimeAgentMessageContent::Text { .. })));
        assert!(converted.content.iter().any(|part| {
            matches!(
                part,
                RuntimeAgentMessageContent::ToolResponse { id, output, .. }
                    if id == "call-2" && output == "任务已完成"
            )
        }));
    }

    #[test]
    fn convert_agent_messages_should_force_offload_old_large_tool_calls_under_context_pressure() {
        let _lock = env_lock().lock().expect("lock env");
        let _env = EnvGuard::set(&[
            (
                crate::tool_io_offload::TOOL_TOKEN_LIMIT_BEFORE_EVICT_ENV_KEYS[0],
                OsString::from("50"),
            ),
            (
                crate::tool_io_offload::CONTEXT_MAX_INPUT_TOKENS_ENV_KEYS[0],
                OsString::from("600"),
            ),
            (
                crate::tool_io_offload::CONTEXT_WINDOW_TRIGGER_RATIO_ENV_KEYS[0],
                OsString::from("0.5"),
            ),
            (
                crate::tool_io_offload::CONTEXT_KEEP_RECENT_MESSAGES_ENV_KEYS[0],
                OsString::from("1"),
            ),
        ]);

        let messages = vec![
            AgentMessage {
                role: "assistant".to_string(),
                content: MessageContent::Text(String::new()),
                timestamp: "2026-03-11T00:00:00Z".to_string(),
                tool_calls: Some(vec![ToolCall {
                    id: "call-history-1".to_string(),
                    call_type: "function".to_string(),
                    function: FunctionCall {
                        name: "Write".to_string(),
                        arguments: serde_json::json!({
                            "path": "docs/huge.md",
                            "content": "token ".repeat(220),
                        })
                        .to_string(),
                    },
                }]),
                tool_call_id: None,
                reasoning_content: None,
            },
            AgentMessage {
                role: "user".to_string(),
                content: MessageContent::Text("token ".repeat(320)),
                timestamp: "2026-03-11T00:00:01Z".to_string(),
                tool_calls: None,
                tool_call_id: None,
                reasoning_content: None,
            },
            AgentMessage {
                role: "assistant".to_string(),
                content: MessageContent::Text("最近一条消息".to_string()),
                timestamp: "2026-03-11T00:00:02Z".to_string(),
                tool_calls: None,
                tool_call_id: None,
                reasoning_content: None,
            },
        ];

        let converted = convert_agent_messages(&messages, Some("gpt-4"));
        let first = converted.first().expect("first message");
        let request = first
            .content
            .iter()
            .find_map(|part| match part {
                RuntimeAgentMessageContent::ToolRequest { arguments, .. } => Some(arguments),
                _ => None,
            })
            .expect("tool request");

        let record = request
            .as_object()
            .expect("offloaded request should be object");
        assert!(record.contains_key(crate::tool_io_offload::LIME_TOOL_ARGUMENTS_OFFLOAD_KEY));
    }

    #[test]
    fn list_sessions_sync_should_resolve_workspace_id_from_working_dir() {
        let db = create_test_db();
        insert_test_workspace(&db, "workspace-1", "/tmp/lime-workspace-1");
        insert_test_session_with_message(&db, "session-1", "/tmp/lime-workspace-1", "你好，世界");

        let sessions = list_sessions_sync(&db).expect("list sessions");
        let session = sessions
            .iter()
            .find(|item| item.id == "session-1")
            .expect("session exists");

        assert_eq!(session.workspace_id.as_deref(), Some("workspace-1"));
        assert_eq!(
            session.working_dir.as_deref(),
            Some("/tmp/lime-workspace-1")
        );
        assert_eq!(session.messages_count, 1);
    }

    #[test]
    fn get_session_sync_should_resolve_workspace_id_from_working_dir() {
        let db = create_test_db();
        insert_test_workspace(&db, "workspace-2", "/tmp/lime-workspace-2");
        insert_test_session_with_message(&db, "session-2", "/tmp/lime-workspace-2", "继续处理");

        let detail = get_session_sync(&db, "session-2").expect("get session");

        assert_eq!(detail.workspace_id.as_deref(), Some("workspace-2"));
        assert_eq!(detail.working_dir.as_deref(), Some("/tmp/lime-workspace-2"));
        assert_eq!(detail.messages.len(), 1);
    }

    #[test]
    fn update_session_working_dir_sync_should_refresh_workspace_binding() {
        let db = create_test_db();
        insert_test_workspace(&db, "workspace-3", "/tmp/lime-workspace-3");
        insert_test_workspace(&db, "workspace-4", "/tmp/lime-workspace-4");
        insert_test_session_with_message(&db, "session-3", "/tmp/lime-workspace-3", "切换目录");

        update_session_working_dir_sync(&db, "session-3", "/tmp/lime-workspace-4")
            .expect("update working_dir");

        let detail = get_session_sync(&db, "session-3").expect("get session");
        assert_eq!(detail.working_dir.as_deref(), Some("/tmp/lime-workspace-4"));
        assert_eq!(detail.workspace_id.as_deref(), Some("workspace-4"));
    }

    #[test]
    fn update_session_provider_config_sync_should_persist_provider_and_model_config() {
        let db = create_test_db();
        insert_test_session_with_message(
            &db,
            "session-provider-config",
            "/tmp/lime-workspace-provider-config",
            "切换模型",
        );

        update_session_provider_config_sync(
            &db,
            "session-provider-config",
            Some("openai"),
            Some("gpt-5.4-mini"),
        )
        .expect("update provider config");

        let conn = db.lock().expect("lock db");
        let (provider_name, model_name, model_config_json): (
            Option<String>,
            String,
            Option<String>,
        ) = conn
            .query_row(
                "SELECT provider_name, model, model_config_json FROM agent_sessions WHERE id = ?",
                ["session-provider-config"],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("query session provider config");

        assert_eq!(provider_name.as_deref(), Some("openai"));
        assert_eq!(model_name, "gpt-5.4-mini");
        assert!(model_config_json
            .as_deref()
            .is_some_and(|value| value.contains("\"model_name\":\"gpt-5.4-mini\"")));
    }

    #[test]
    fn rename_session_sync_should_update_session_title() {
        let db = create_test_db();
        insert_test_session_with_message(
            &db,
            "session-rename",
            "/tmp/lime-workspace-5",
            "原始消息",
        );

        rename_session_sync(&db, "session-rename", "新的会话标题").expect("rename session");

        let session = get_session_sync(&db, "session-rename").expect("get session");
        assert_eq!(session.name, "新的会话标题");
    }

    #[test]
    fn list_title_preview_messages_sync_should_only_keep_chat_roles() {
        let db = create_test_db();
        create_session_record_sync(
            &db,
            CreateSessionRecordInput {
                session_id: Some("session-title".to_string()),
                title: Some("测试标题".to_string()),
                model: Some("agent:test".to_string()),
                execution_strategy: Some("react".to_string()),
                ..CreateSessionRecordInput::default()
            },
        )
        .expect("create session");

        let conn = db.lock().expect("lock db");
        AgentDao::add_message(
            &conn,
            "session-title",
            &AgentMessage {
                role: "system".to_string(),
                content: MessageContent::Text("忽略这条系统消息".to_string()),
                timestamp: "2026-03-18T08:00:00Z".to_string(),
                tool_calls: None,
                tool_call_id: None,
                reasoning_content: None,
            },
        )
        .expect("add system message");
        AgentDao::add_message(
            &conn,
            "session-title",
            &AgentMessage {
                role: "user".to_string(),
                content: MessageContent::Text("第一条用户消息".to_string()),
                timestamp: "2026-03-18T08:01:00Z".to_string(),
                tool_calls: None,
                tool_call_id: None,
                reasoning_content: None,
            },
        )
        .expect("add user message");
        AgentDao::add_message(
            &conn,
            "session-title",
            &AgentMessage {
                role: "assistant".to_string(),
                content: MessageContent::Text("第一条助手消息".to_string()),
                timestamp: "2026-03-18T08:02:00Z".to_string(),
                tool_calls: None,
                tool_call_id: None,
                reasoning_content: None,
            },
        )
        .expect("add assistant message");
        AgentDao::add_message(
            &conn,
            "session-title",
            &AgentMessage {
                role: "tool".to_string(),
                content: MessageContent::Text("忽略工具输出".to_string()),
                timestamp: "2026-03-18T08:03:00Z".to_string(),
                tool_calls: None,
                tool_call_id: Some("tool-1".to_string()),
                reasoning_content: None,
            },
        )
        .expect("add tool message");
        drop(conn);

        let preview =
            list_title_preview_messages_sync(&db, "session-title", 4).expect("load preview");
        assert_eq!(
            preview,
            vec![
                SessionTitlePreviewMessage {
                    role: "user".to_string(),
                    content: "第一条用户消息".to_string(),
                },
                SessionTitlePreviewMessage {
                    role: "assistant".to_string(),
                    content: "第一条助手消息".to_string(),
                },
            ]
        );
    }
}
