//! Typed v2 projection at the App Server thread command boundary.

use agent_protocol as canonical;
use app_server_protocol::protocol::v2;
use app_server_protocol::{error_codes, AgentEvent, JsonRpcError};
use serde_json::Value;
use std::path::PathBuf;

use super::ProjectedEvent;
use safe_display::{
    bounded_safe_json, bounded_safe_text, MAX_DISPLAY_JSON_BYTES, MAX_DISPLAY_STRING_BYTES,
};

mod command;
mod item;
mod mcp;
mod safe_display;
mod thread;

use command::{
    project_command_actions, project_command_source, project_command_status,
    project_terminal_interactions,
};
use item::project_item;
use mcp::{project_mcp_app_context, project_mcp_status, project_mcp_tool_result};
use thread::{current_model_provider, project_thread};

pub(super) fn lower_thread_read_params(
    params: &v2::ThreadReadParams,
) -> Result<canonical::thread::ThreadReadParams, JsonRpcError> {
    Ok(canonical::thread::ThreadReadParams {
        thread_id: canonical::ThreadId::new(non_empty(&params.thread_id, "threadId")?),
        turns_view: if params.include_turns {
            canonical::ThreadTurnsView::Full
        } else {
            canonical::ThreadTurnsView::NotLoaded
        },
    })
}

pub(super) fn lower_thread_list_params(
    params: &v2::ThreadListParams,
) -> Result<canonical::ThreadListParams, JsonRpcError> {
    if params.ancestor_thread_id.is_some() {
        return Err(invalid_params(
            "thread/list ancestorThreadId is not implemented by the canonical store boundary",
        ));
    }
    if params
        .parent_thread_id
        .as_deref()
        .is_some_and(|value| value.trim().is_empty())
    {
        return Err(invalid_params(
            "thread/list parentThreadId must not be empty",
        ));
    }

    Ok(canonical::ThreadListParams {
        page: canonical::PageCursor {
            cursor: params.cursor.clone(),
            limit: params.limit,
            sort_direction: match (params.sort_direction, params.sort_key) {
                (Some(direction), _) => lower_sort_direction(Some(direction)),
                (None, Some(v2::ThreadSortKey::SectionPosition)) => canonical::SortDirection::Asc,
                (None, _) => canonical::SortDirection::Desc,
            },
        },
        // The current store's flag means "include archived". The projection
        // below applies the v2 exact archived filter to the returned page.
        include_archived: params.archived.unwrap_or(false),
        turns_view: canonical::ThreadTurnsView::NotLoaded,
        section: params.section_id.clone(),
        project: params.project_id.clone(),
        sort_by_section_position: matches!(
            params.sort_key,
            Some(v2::ThreadSortKey::SectionPosition)
        ),
    })
}

pub(super) fn lower_thread_search_params(
    params: &v2::ThreadSearchParams,
) -> Result<thread_store::SearchThreadsParams, JsonRpcError> {
    let cursor = params
        .cursor
        .clone()
        .map(thread_store::StoreCursor::new)
        .transpose()
        .map_err(invalid_params)?;
    let source_kinds = match params.source_kinds.as_deref() {
        None | Some([]) => vec![
            thread_store::ThreadSearchSourceKind::Cli,
            thread_store::ThreadSearchSourceKind::VsCode,
        ],
        Some(source_kinds) => source_kinds
            .iter()
            .copied()
            .map(lower_thread_search_source_kind)
            .collect(),
    };
    Ok(thread_store::SearchThreadsParams {
        cursor,
        page_size: params.limit.unwrap_or(25).clamp(1, 100) as usize,
        sort_key: match params.sort_key.unwrap_or(v2::ThreadSortKey::CreatedAt) {
            v2::ThreadSortKey::CreatedAt => thread_store::ThreadSearchSortKey::CreatedAt,
            v2::ThreadSortKey::UpdatedAt => thread_store::ThreadSearchSortKey::UpdatedAt,
            v2::ThreadSortKey::RecencyAt => thread_store::ThreadSearchSortKey::RecencyAt,
            v2::ThreadSortKey::SectionPosition => {
                return Err(invalid_params(
                    "thread/search does not support section_position sorting",
                ));
            }
        },
        sort_direction: lower_sort_direction(params.sort_direction),
        source_kinds,
        archived: params.archived.unwrap_or(false),
        search_term: params.search_term.trim().to_string(),
    })
}

pub(super) fn lower_thread_turns_list_params(
    params: &v2::ThreadTurnsListParams,
) -> Result<canonical::ThreadTurnsListParams, JsonRpcError> {
    Ok(canonical::ThreadTurnsListParams {
        thread_id: canonical::ThreadId::new(non_empty(&params.thread_id, "threadId")?),
        page: canonical::PageCursor {
            cursor: params.cursor.clone(),
            limit: params.limit,
            sort_direction: lower_sort_direction(params.sort_direction),
        },
        items_view: lower_items_view(params.items_view.unwrap_or_default()),
    })
}

pub(super) fn lower_thread_items_list_params(
    params: &v2::ThreadItemsListParams,
) -> Result<canonical::ThreadItemsListParams, JsonRpcError> {
    Ok(canonical::ThreadItemsListParams {
        thread_id: canonical::ThreadId::new(non_empty(&params.thread_id, "threadId")?),
        turn_id: params
            .turn_id
            .as_deref()
            .map(|value| non_empty(value, "turnId").map(canonical::TurnId::new))
            .transpose()?,
        page: canonical::PageCursor {
            cursor: params.cursor.clone(),
            limit: params.limit,
            sort_direction: lower_sort_direction(params.sort_direction),
        },
    })
}

pub(in crate::processor) fn project_thread_read_response(
    response: canonical::thread::ThreadReadResponse,
) -> Result<v2::ThreadReadResponse, JsonRpcError> {
    Ok(v2::ThreadReadResponse {
        thread: project_thread(response.thread)?,
    })
}

pub(super) fn project_thread_list_response(
    response: canonical::ThreadListResponse,
    params: &v2::ThreadListParams,
) -> Result<v2::ThreadListResponse, JsonRpcError> {
    let data = response
        .data
        .into_iter()
        .filter(|thread| thread_matches_list_filters(thread, params))
        .map(project_thread)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(v2::ThreadListResponse {
        data,
        next_cursor: response.next_cursor,
        backwards_cursor: response.backwards_cursor,
    })
}

pub(super) fn project_thread_search_response(
    response: thread_store::ThreadSearchPage,
) -> Result<v2::ThreadSearchResponse, JsonRpcError> {
    Ok(v2::ThreadSearchResponse {
        data: response
            .data
            .into_iter()
            .map(|result| {
                Ok(v2::ThreadSearchResult {
                    thread: project_thread(result.thread)?,
                    snippet: result.snippet,
                })
            })
            .collect::<Result<Vec<_>, JsonRpcError>>()?,
        next_cursor: response
            .next_cursor
            .map(thread_store::StoreCursor::into_string),
        backwards_cursor: response
            .backwards_cursor
            .map(thread_store::StoreCursor::into_string),
    })
}

pub(super) fn project_thread_turns_list_response(
    response: canonical::ThreadTurnsListResponse,
) -> Result<v2::ThreadTurnsListResponse, JsonRpcError> {
    Ok(v2::ThreadTurnsListResponse {
        data: response
            .data
            .into_iter()
            .filter(|turn| !matches!(turn.queue, canonical::TurnQueueState::Queued { .. }))
            .map(project_turn)
            .collect::<Result<Vec<_>, _>>()?,
        next_cursor: response.next_cursor,
        backwards_cursor: response.backwards_cursor,
    })
}

pub(super) fn project_thread_items_list_response(
    response: canonical::ThreadItemsListResponse,
) -> Result<v2::ThreadItemsListResponse, JsonRpcError> {
    Ok(v2::ThreadItemsListResponse {
        data: response
            .data
            .into_iter()
            .filter(|item| !is_out_of_band_control_item(item))
            .map(|item| {
                let turn_id = item.turn_id.as_str().to_string();
                Ok(v2::ThreadItemEntry {
                    turn_id,
                    item: project_item(item)?,
                })
            })
            .collect::<Result<Vec<_>, JsonRpcError>>()?,
        next_cursor: response.next_cursor,
        backwards_cursor: response.backwards_cursor,
    })
}

pub(super) fn project_event(event: &AgentEvent) -> Option<ProjectedEvent> {
    match event.event_type.as_str() {
        "thread.created" | "thread.started" | "thread.updated" => {
            canonical_entity(&event.payload, "thread")
                .and_then(|thread| project_thread(thread).ok())
                .map(ProjectedEvent::Thread)
        }
        "turn.accepted" | "turn.started" | "turn.completed" | "turn.failed" | "turn.canceled" => {
            canonical_entity(&event.payload, "turn")
                .and_then(|turn| project_turn(turn).ok())
                .map(ProjectedEvent::Turn)
        }
        _ => canonical_entity(&event.payload, "item")
            .and_then(|item| project_item(item).ok())
            .map(ProjectedEvent::Item),
    }
}

fn canonical_entity<T>(payload: &Value, key: &str) -> Option<T>
where
    T: serde::de::DeserializeOwned,
{
    serde_json::from_value(payload.get(key)?.clone()).ok()
}

fn project_turn(turn: canonical::Turn) -> Result<v2::Turn, JsonRpcError> {
    if matches!(turn.queue, canonical::TurnQueueState::Queued { .. }) {
        return Err(invalid_params(
            "queued submissions are not execution history turns",
        ));
    }
    Ok(v2::Turn {
        id: turn.turn_id.as_str().to_string(),
        items: turn
            .items
            .into_iter()
            .filter(|item| !is_out_of_band_control_item(item))
            .map(project_item)
            .collect::<Result<Vec<_>, _>>()?,
        items_view: project_items_view(turn.items_view),
        status: project_turn_status(turn.status),
        error: turn.error.map(|error| v2::TurnError {
            message: error.message,
            lime_error_info: crate::processor::v2_notifications::error::lime_error_info_from_code(
                error.code.as_deref(),
            ),
            additional_details: error.details,
        }),
        started_at: turn.started_at_ms.map(millis_to_seconds),
        completed_at: turn.completed_at_ms.map(millis_to_seconds),
        duration_ms: turn.duration_ms.map(saturating_i64),
    })
}

fn is_out_of_band_control_item(item: &canonical::ThreadItem) -> bool {
    matches!(&item.payload, canonical::ThreadItemPayload::Approval { .. })
}

fn thread_matches_list_filters(thread: &canonical::Thread, params: &v2::ThreadListParams) -> bool {
    if thread.archived != params.archived.unwrap_or(false) {
        return false;
    }
    if let Some(section_id) = params.section_id.as_ref() {
        let actual = project_thread_section(&thread.metadata).map(|section| section.id);
        if actual.as_deref() != section_id.as_deref() {
            return false;
        }
    }
    if params.model_providers.as_ref().is_some_and(|providers| {
        !providers
            .iter()
            .any(|provider| provider == current_model_provider(thread))
    }) {
        return false;
    }
    if params.parent_thread_id.as_ref().is_some_and(|parent| {
        thread
            .parent_thread_id
            .as_ref()
            .map(canonical::ThreadId::as_str)
            != Some(parent.trim())
    }) {
        return false;
    }
    if params.cwd.as_ref().is_some_and(|filter| {
        let cwd = metadata_string(&thread.metadata, &["workingDir", "working_dir", "cwd"])
            .unwrap_or_default();
        !cwd_matches(filter, &cwd)
    }) {
        return false;
    }
    if params.search_term.as_ref().is_some_and(|search| {
        let search = search.trim().to_lowercase();
        !search.is_empty()
            && !thread.preview.to_lowercase().contains(&search)
            && !thread
                .name
                .as_deref()
                .unwrap_or_default()
                .to_lowercase()
                .contains(&search)
    }) {
        return false;
    }
    if params.source_kinds.as_ref().is_some_and(|kinds| {
        let source = metadata_string(
            &thread.metadata,
            &["sourceKind", "source_kind", "source", "threadSource"],
        )
        .unwrap_or_else(|| "appServer".to_string());
        !kinds.iter().any(|kind| source_kind_matches(*kind, &source))
    }) {
        return false;
    }
    true
}

fn project_thread_section(metadata: &Value) -> Option<v2::ThreadSection> {
    let section = metadata.get("section")?.as_object()?;
    Some(v2::ThreadSection {
        id: section.get("id")?.as_str()?.to_string(),
        name: section.get("name")?.as_str()?.to_string(),
    })
}

fn project_session_source(source: &str) -> v2::SessionSource {
    match source.trim().to_ascii_lowercase().as_str() {
        "cli" => v2::SessionSource::Cli,
        "vscode" => v2::SessionSource::VsCode,
        "exec" => v2::SessionSource::Exec,
        "appserver" | "app-server" | "app_server" | "mcp" => v2::SessionSource::AppServer,
        "unknown" => v2::SessionSource::Unknown,
        _ => v2::SessionSource::Custom(source.to_string()),
    }
}

fn cwd_matches(filter: &v2::ThreadListCwdFilter, cwd: &str) -> bool {
    let cwd = normalize_path(cwd);
    match filter {
        v2::ThreadListCwdFilter::One(value) => normalize_path(value) == cwd,
        v2::ThreadListCwdFilter::Many(values) => {
            values.iter().any(|value| normalize_path(value) == cwd)
        }
    }
}

fn normalize_path(value: &str) -> &str {
    value.trim().trim_end_matches(&['/', '\\'][..])
}

fn source_kind_matches(kind: v2::ThreadSourceKind, source: &str) -> bool {
    let normalized = source
        .chars()
        .filter(|value| value.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase();
    match kind {
        v2::ThreadSourceKind::Cli => normalized == "cli",
        v2::ThreadSourceKind::VsCode => normalized == "vscode",
        v2::ThreadSourceKind::Exec => normalized == "exec",
        v2::ThreadSourceKind::AppServer => normalized == "appserver",
        v2::ThreadSourceKind::SubAgent => normalized == "subagent",
        v2::ThreadSourceKind::SubAgentReview => normalized == "subagentreview",
        v2::ThreadSourceKind::SubAgentCompact => normalized == "subagentcompact",
        v2::ThreadSourceKind::SubAgentThreadSpawn => normalized == "subagentthreadspawn",
        v2::ThreadSourceKind::SubAgentOther => normalized == "subagentother",
        v2::ThreadSourceKind::Unknown => !matches!(
            normalized.as_str(),
            "cli"
                | "vscode"
                | "exec"
                | "appserver"
                | "subagent"
                | "subagentreview"
                | "subagentcompact"
                | "subagentthreadspawn"
                | "subagentother"
        ),
    }
}

fn project_git_info(metadata: &Value) -> Option<v2::GitInfo> {
    let git = metadata.get("gitInfo").or_else(|| metadata.get("git_info"));
    let sha = git.and_then(|value| metadata_string(value, &["sha", "commitHash", "commit_hash"]));
    let branch = git.and_then(|value| metadata_string(value, &["branch"]));
    let origin_url = git.and_then(|value| {
        metadata_string(
            value,
            &["originUrl", "origin_url", "repositoryUrl", "repository_url"],
        )
    });
    (sha.is_some() || branch.is_some() || origin_url.is_some()).then_some(v2::GitInfo {
        sha,
        branch,
        origin_url,
    })
}

fn project_thread_status(status: canonical::ThreadStatus) -> v2::ThreadStatus {
    match status {
        canonical::ThreadStatus::NotLoaded => v2::ThreadStatus::NotLoaded,
        canonical::ThreadStatus::Idle => v2::ThreadStatus::Idle,
        canonical::ThreadStatus::SystemError => v2::ThreadStatus::SystemError,
        canonical::ThreadStatus::Active { active_flags } => v2::ThreadStatus::Active {
            active_flags: active_flags
                .into_iter()
                .map(|flag| match flag {
                    canonical::ThreadActiveFlag::WaitingOnApproval => {
                        v2::ThreadActiveFlag::WaitingOnApproval
                    }
                    canonical::ThreadActiveFlag::WaitingOnUserInput => {
                        v2::ThreadActiveFlag::WaitingOnUserInput
                    }
                })
                .collect(),
        },
    }
}

fn project_turn_status(status: canonical::TurnStatus) -> v2::TurnStatus {
    match status {
        canonical::TurnStatus::InProgress => v2::TurnStatus::InProgress,
        canonical::TurnStatus::Completed => v2::TurnStatus::Completed,
        canonical::TurnStatus::Interrupted => v2::TurnStatus::Interrupted,
        canonical::TurnStatus::Failed => v2::TurnStatus::Failed,
    }
}

fn lower_items_view(view: v2::TurnItemsView) -> canonical::TurnItemsView {
    match view {
        v2::TurnItemsView::NotLoaded => canonical::TurnItemsView::NotLoaded,
        v2::TurnItemsView::Summary => canonical::TurnItemsView::Summary,
        v2::TurnItemsView::Full => canonical::TurnItemsView::Full,
    }
}

fn project_items_view(view: canonical::TurnItemsView) -> v2::TurnItemsView {
    match view {
        canonical::TurnItemsView::NotLoaded => v2::TurnItemsView::NotLoaded,
        canonical::TurnItemsView::Summary => v2::TurnItemsView::Summary,
        canonical::TurnItemsView::Full => v2::TurnItemsView::Full,
    }
}

fn lower_sort_direction(direction: Option<v2::SortDirection>) -> canonical::SortDirection {
    match direction.unwrap_or(v2::SortDirection::Desc) {
        v2::SortDirection::Asc => canonical::SortDirection::Asc,
        v2::SortDirection::Desc => canonical::SortDirection::Desc,
    }
}

fn lower_thread_search_source_kind(
    kind: v2::ThreadSourceKind,
) -> thread_store::ThreadSearchSourceKind {
    match kind {
        v2::ThreadSourceKind::Cli => thread_store::ThreadSearchSourceKind::Cli,
        v2::ThreadSourceKind::VsCode => thread_store::ThreadSearchSourceKind::VsCode,
        v2::ThreadSourceKind::Exec => thread_store::ThreadSearchSourceKind::Exec,
        v2::ThreadSourceKind::AppServer => thread_store::ThreadSearchSourceKind::AppServer,
        v2::ThreadSourceKind::SubAgent => thread_store::ThreadSearchSourceKind::SubAgent,
        v2::ThreadSourceKind::SubAgentReview => {
            thread_store::ThreadSearchSourceKind::SubAgentReview
        }
        v2::ThreadSourceKind::SubAgentCompact => {
            thread_store::ThreadSearchSourceKind::SubAgentCompact
        }
        v2::ThreadSourceKind::SubAgentThreadSpawn => {
            thread_store::ThreadSearchSourceKind::SubAgentThreadSpawn
        }
        v2::ThreadSourceKind::SubAgentOther => thread_store::ThreadSearchSourceKind::SubAgentOther,
        v2::ThreadSourceKind::Unknown => thread_store::ThreadSearchSourceKind::Unknown,
    }
}

fn metadata_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(key).and_then(Value::as_str))
        .map(ToString::to_string)
        .filter(|value| !value.trim().is_empty())
}

fn metadata_bool(value: &Value, keys: &[&str]) -> Option<bool> {
    keys.iter()
        .find_map(|key| value.get(key).and_then(Value::as_bool))
}

fn metadata_i64(value: &Value, keys: &[&str]) -> Option<i64> {
    keys.iter().find_map(|key| {
        value.get(key).and_then(|value| {
            value
                .as_i64()
                .or_else(|| value.as_str()?.parse::<i64>().ok())
        })
    })
}

fn metadata_u64(value: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter().find_map(|key| {
        value.get(key).and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.as_str()?.parse::<u64>().ok())
        })
    })
}

fn millis_to_seconds(value: i64) -> i64 {
    value.div_euclid(1_000)
}

fn saturating_i64(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

fn non_empty(value: &str, field: &str) -> Result<String, JsonRpcError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(invalid_params(format!("thread request requires {field}")));
    }
    Ok(value.to_string())
}

fn invalid_params(message: impl Into<String>) -> JsonRpcError {
    JsonRpcError::new(error_codes::INVALID_PARAMS, message)
}

fn projection_error(message: impl Into<String>) -> JsonRpcError {
    JsonRpcError::new(error_codes::RUNTIME_ERROR, message)
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod command_tests;
