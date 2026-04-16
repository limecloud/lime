use aster::session::{
    collect_subagent_cascade_session_ids as collect_query_subagent_cascade_session_ids,
    query_all_subagent_sessions_with_metadata, query_child_subagent_sessions, query_session,
    query_subagent_parent_session_id, query_subagent_session, Session, SessionType,
};
use std::collections::HashSet;

pub(crate) fn ensure_subagent_session(session: &Session) -> Result<(), String> {
    if session.session_type != SessionType::SubAgent {
        return Err(format!(
            "会话不是 subagent session: session_id={}, session_type={}",
            session.id, session.session_type
        ));
    }
    Ok(())
}

pub async fn read_session(
    session_id: &str,
    with_conversation: bool,
    error_context: &str,
) -> Result<Session, String> {
    query_session(session_id, with_conversation)
        .await
        .map_err(|error| format!("{error_context}: {error}"))
}

pub async fn list_child_subagent_sessions(
    parent_session_id: &str,
    error_context: &str,
) -> Result<Vec<Session>, String> {
    query_child_subagent_sessions(parent_session_id)
        .await
        .map_err(|error| format!("{error_context}: {error}"))
}

async fn list_subagent_sessions_with_metadata_query() -> Result<Vec<Session>, String> {
    query_all_subagent_sessions_with_metadata()
        .await
        .map_err(|error| format!("读取 subagent session 列表失败: {error}"))
}

pub(crate) async fn read_subagent_session(
    session_id: &str,
    error_context: &str,
) -> Result<Session, String> {
    query_subagent_session(session_id)
        .await
        .map_err(|error| format!("{error_context}: {error}"))
}

pub(crate) fn resolve_subagent_parent_session_id(session: &Session) -> Option<String> {
    query_subagent_parent_session_id(session)
}

pub async fn list_subagent_status_scope_session_ids(session_id: &str) -> Vec<String> {
    let mut scope_ids = Vec::new();
    let mut seen = HashSet::new();
    let mut current_session_id = session_id.to_string();

    while seen.insert(current_session_id.clone()) {
        scope_ids.push(current_session_id.clone());

        let session = match read_session(&current_session_id, false, "解析 team 事件 scope 失败")
            .await
        {
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
        let Some(parent_session_id) = resolve_subagent_parent_session_id(&session) else {
            break;
        };
        current_session_id = parent_session_id;
    }

    scope_ids
}

pub async fn list_subagent_cascade_session_ids(session_id: &str) -> Result<Vec<String>, String> {
    let _ = read_subagent_session(session_id, "读取 subagent session 失败").await?;
    let sessions = list_subagent_sessions_with_metadata_query().await?;
    Ok(collect_subagent_cascade_session_ids(session_id, &sessions))
}

pub fn collect_subagent_cascade_session_ids(session_id: &str, sessions: &[Session]) -> Vec<String> {
    collect_query_subagent_cascade_session_ids(session_id, sessions)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Duration, Utc};

    #[test]
    fn collect_subagent_cascade_session_ids_returns_breadth_first_tree() {
        let now = Utc::now();
        let child_a = Session {
            id: "child-a".to_string(),
            session_type: SessionType::SubAgent,
            updated_at: now,
            extension_data: aster::session::SubagentSessionMetadata::new("root")
                .into_updated_extension_data(&Session::default())
                .unwrap(),
            ..Session::default()
        };
        let child_b = Session {
            id: "child-b".to_string(),
            session_type: SessionType::SubAgent,
            updated_at: now - Duration::minutes(1),
            extension_data: aster::session::SubagentSessionMetadata::new("root")
                .into_updated_extension_data(&Session::default())
                .unwrap(),
            ..Session::default()
        };
        let grandchild = Session {
            id: "grandchild".to_string(),
            session_type: SessionType::SubAgent,
            updated_at: now - Duration::minutes(2),
            extension_data: aster::session::SubagentSessionMetadata::new("child-a")
                .into_updated_extension_data(&Session::default())
                .unwrap(),
            ..Session::default()
        };

        let ids = collect_subagent_cascade_session_ids("root", &[child_a, child_b, grandchild]);

        assert_eq!(ids, vec!["root", "child-a", "child-b", "grandchild"]);
    }
}
