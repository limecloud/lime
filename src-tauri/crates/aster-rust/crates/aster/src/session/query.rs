use crate::session::subagent::{
    list_subagent_child_sessions, list_subagent_sessions_with_metadata,
    resolve_subagent_session_metadata,
};
use crate::session::{Session, SessionManager, SessionType};
use anyhow::{anyhow, Result};
use std::collections::{HashMap, HashSet, VecDeque};

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    let trimmed = value?.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn ensure_subagent_session(session: &Session) -> Result<()> {
    if session.session_type != SessionType::SubAgent {
        return Err(anyhow!(
            "会话不是 subagent session: session_id={}, session_type={}",
            session.id,
            session.session_type
        ));
    }
    Ok(())
}

pub async fn query_session(session_id: &str, include_messages: bool) -> Result<Session> {
    SessionManager::get_session(session_id, include_messages).await
}

pub async fn query_child_subagent_sessions(parent_session_id: &str) -> Result<Vec<Session>> {
    list_subagent_child_sessions(parent_session_id).await
}

pub async fn query_all_subagent_sessions_with_metadata() -> Result<Vec<Session>> {
    list_subagent_sessions_with_metadata().await
}

pub async fn query_subagent_session(session_id: &str) -> Result<Session> {
    let session = query_session(session_id, false).await?;
    ensure_subagent_session(&session)?;
    Ok(session)
}

pub fn query_subagent_parent_session_id(session: &Session) -> Option<String> {
    let metadata = resolve_subagent_session_metadata(&session.extension_data)?;
    normalize_optional_text(Some(metadata.parent_session_id))
}

pub async fn query_subagent_status_scope_session_ids(session_id: &str) -> Vec<String> {
    let mut scope_ids = Vec::new();
    let mut seen = HashSet::new();
    let mut current_session_id = session_id.to_string();

    while seen.insert(current_session_id.clone()) {
        scope_ids.push(current_session_id.clone());

        let session = match query_session(&current_session_id, false).await {
            Ok(session) => session,
            Err(error) => {
                tracing::warn!(
                    "[SessionQuery] 解析 team 事件 scope 失败: session_id={}, error={}",
                    current_session_id,
                    error
                );
                break;
            }
        };
        let Some(parent_session_id) = query_subagent_parent_session_id(&session) else {
            break;
        };
        current_session_id = parent_session_id;
    }

    scope_ids
}

pub async fn query_subagent_cascade_session_ids(session_id: &str) -> Result<Vec<String>> {
    let _ = query_subagent_session(session_id).await?;
    let sessions = query_all_subagent_sessions_with_metadata().await?;
    Ok(collect_subagent_cascade_session_ids(session_id, &sessions))
}

pub fn collect_subagent_cascade_session_ids(session_id: &str, sessions: &[Session]) -> Vec<String> {
    let mut children_by_parent: HashMap<String, Vec<String>> = HashMap::new();
    for session in sessions {
        let Some(parent_session_id) = query_subagent_parent_session_id(session) else {
            continue;
        };
        children_by_parent
            .entry(parent_session_id)
            .or_default()
            .push(session.id.clone());
    }

    let mut ordered = vec![session_id.to_string()];
    let mut queue = VecDeque::from([session_id.to_string()]);
    while let Some(parent_id) = queue.pop_front() {
        let Some(children) = children_by_parent.get(&parent_id) else {
            continue;
        };
        for child_id in children {
            ordered.push(child_id.clone());
            queue.push_back(child_id.clone());
        }
    }
    ordered
}
