//! Agent 会话持久化访问边界。
//!
//! 统一收口 Agent session 的数据库读写与 workspace 绑定解析，
//! 避免上层 crate 继续散落 direct AgentDao 调用或手写 workspace SQL。

use crate::agent::types::AgentSession;
use crate::database::dao::agent::{AgentDao, AgentSessionOverviewRow, SessionArchiveFilter};
use rusqlite::{Connection, OptionalExtension};

#[derive(Debug, Clone)]
pub struct SessionRecordOverview {
    pub id: String,
    pub model: String,
    pub system_prompt: Option<String>,
    pub title: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
    pub working_dir: Option<String>,
    pub workspace_id: Option<String>,
    pub execution_strategy: Option<String>,
    pub messages_count: usize,
}

#[derive(Debug, Clone)]
pub struct SessionRecordDetail {
    pub session: AgentSession,
    pub workspace_id: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct SessionRecordMetadata {
    pub system_prompt: Option<String>,
    pub working_dir: Option<String>,
    pub execution_strategy: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionRecordPreviewMessage {
    pub role: String,
    pub content: String,
}

fn resolve_workspace_id_by_working_dir(
    conn: &Connection,
    working_dir: Option<&str>,
) -> Option<String> {
    let resolved_working_dir = working_dir?.trim();
    if resolved_working_dir.is_empty() {
        return None;
    }

    match conn
        .query_row(
            "SELECT id FROM workspaces WHERE root_path = ? LIMIT 1",
            [resolved_working_dir],
            |row| row.get::<_, String>(0),
        )
        .optional()
    {
        Ok(workspace_id) => workspace_id,
        Err(error) => {
            tracing::warn!(
                "[AgentSessionRepository] 解析 workspace_id 失败，已降级忽略: working_dir={}, error={}",
                resolved_working_dir,
                error
            );
            None
        }
    }
}

fn map_session_overview(overview: AgentSessionOverviewRow) -> SessionRecordOverview {
    let AgentSessionOverviewRow {
        session,
        messages_count,
        archived_at,
        workspace_id,
    } = overview;
    let AgentSession {
        id,
        model,
        system_prompt,
        title,
        created_at,
        updated_at,
        working_dir,
        execution_strategy,
        ..
    } = session;

    SessionRecordOverview {
        id,
        model,
        system_prompt,
        title,
        created_at,
        updated_at,
        archived_at,
        working_dir,
        workspace_id,
        execution_strategy,
        messages_count,
    }
}

pub fn create_session(conn: &Connection, session: &AgentSession) -> Result<(), String> {
    AgentDao::create_session(conn, session).map_err(|error| format!("创建会话失败: {error}"))
}

pub fn list_session_overviews(
    conn: &Connection,
    archive_filter: SessionArchiveFilter,
    workspace_id: Option<&str>,
    limit: Option<usize>,
) -> Result<Vec<SessionRecordOverview>, String> {
    AgentDao::list_session_overviews(conn, archive_filter, workspace_id, limit)
        .map(|rows| rows.into_iter().map(map_session_overview).collect())
        .map_err(|error| format!("获取会话列表失败: {error}"))
}

pub fn get_session_overview(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<SessionRecordOverview>, String> {
    AgentDao::get_session_overview(conn, session_id)
        .map(|row| row.map(map_session_overview))
        .map_err(|error| format!("获取会话失败: {error}"))
}

pub fn get_session_with_messages(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<SessionRecordDetail>, String> {
    AgentDao::get_session_with_messages(conn, session_id)
        .map(|session| {
            session.map(|session| SessionRecordDetail {
                workspace_id: resolve_workspace_id_by_working_dir(
                    conn,
                    session.working_dir.as_deref(),
                ),
                session,
            })
        })
        .map_err(|error| format!("获取会话详情失败: {error}"))
}

pub fn get_session_with_messages_tail(
    conn: &Connection,
    session_id: &str,
    limit: usize,
) -> Result<Option<SessionRecordDetail>, String> {
    AgentDao::get_session_with_messages_tail(conn, session_id, limit)
        .map(|session| {
            session.map(|session| SessionRecordDetail {
                workspace_id: resolve_workspace_id_by_working_dir(
                    conn,
                    session.working_dir.as_deref(),
                ),
                session,
            })
        })
        .map_err(|error| format!("获取会话详情失败: {error}"))
}

pub fn get_persisted_session_metadata(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<SessionRecordMetadata>, String> {
    get_session_overview(conn, session_id).map(|overview| {
        overview.map(|overview| SessionRecordMetadata {
            system_prompt: overview.system_prompt,
            working_dir: overview.working_dir,
            execution_strategy: overview.execution_strategy,
        })
    })
}

pub fn list_title_preview_messages(
    conn: &Connection,
    session_id: &str,
    limit: usize,
) -> Result<Vec<SessionRecordPreviewMessage>, String> {
    if limit == 0 {
        return Ok(Vec::new());
    }

    AgentDao::get_messages(conn, session_id)
        .map(|messages| {
            messages
                .into_iter()
                .filter(|msg| msg.role == "user" || msg.role == "assistant")
                .take(limit)
                .map(|msg| SessionRecordPreviewMessage {
                    role: msg.role,
                    content: msg.content.as_text(),
                })
                .collect()
        })
        .map_err(|error| format!("获取标题预览消息失败: {error}"))
}

pub fn rename_session(
    conn: &Connection,
    session_id: &str,
    title: &str,
    updated_at: &str,
) -> Result<(), String> {
    AgentDao::rename_session(conn, session_id, title, updated_at)
        .map_err(|error| format!("重命名会话失败: {error}"))
}

pub fn update_session_working_dir(
    conn: &Connection,
    session_id: &str,
    working_dir: &str,
) -> Result<(), String> {
    AgentDao::update_working_dir(conn, session_id, working_dir)
        .map_err(|error| format!("更新 session working_dir 失败: {error}"))
}

pub fn update_session_execution_strategy(
    conn: &Connection,
    session_id: &str,
    execution_strategy: &str,
) -> Result<(), String> {
    AgentDao::update_execution_strategy(conn, session_id, execution_strategy)
        .map_err(|error| format!("更新会话执行策略失败: {error}"))
}

pub fn update_session_provider_config(
    conn: &Connection,
    session_id: &str,
    provider_name: Option<&str>,
    model_name: Option<&str>,
    model_config_json: Option<&str>,
    updated_at: &str,
) -> Result<(), String> {
    AgentDao::update_provider_config(
        conn,
        session_id,
        provider_name,
        model_name,
        model_config_json,
        updated_at,
    )
    .map_err(|error| format!("更新会话 provider/model 失败: {error}"))
}

pub fn update_session_archived_at(
    conn: &Connection,
    session_id: &str,
    archived_at: Option<&str>,
    updated_at: &str,
) -> Result<(), String> {
    AgentDao::update_archived_at(conn, session_id, archived_at, updated_at)
        .map_err(|error| format!("更新会话归档状态失败: {error}"))
}

pub fn update_latest_assistant_message_usage(
    conn: &Connection,
    session_id: &str,
    input_tokens: u32,
    output_tokens: u32,
    cached_input_tokens: Option<u32>,
    cache_creation_input_tokens: Option<u32>,
) -> Result<bool, String> {
    AgentDao::update_latest_assistant_message_usage(
        conn,
        session_id,
        input_tokens,
        output_tokens,
        cached_input_tokens,
        cache_creation_input_tokens,
    )
    .map_err(|error| format!("更新最新 assistant 消息 usage 失败: {error}"))
}
