use crate::commands::aster_agent_cmd::{
    build_incidents, build_last_outcome, build_pending_requests, AgentRuntimeIncidentView,
    AgentRuntimeOutcomeView, AgentRuntimeRequestView,
};
use lime_agent::SessionDetail;
use lime_core::database::dao::agent_thread_incident::{
    AgentThreadIncidentDao, AgentThreadIncidentRecord,
};
use lime_core::database::dao::agent_turn_outcome::{AgentTurnOutcomeDao, AgentTurnOutcomeRecord};
use lime_core::database::{lock_db, DbConnection};
use rusqlite::Connection;
use std::collections::HashSet;

#[derive(Debug, Clone)]
pub struct ThreadReliabilityProjection {
    pub pending_requests: Vec<AgentRuntimeRequestView>,
    pub last_outcome: Option<AgentRuntimeOutcomeView>,
    pub incidents: Vec<AgentRuntimeIncidentView>,
}

pub fn sync_thread_reliability_projection(
    db: &DbConnection,
    detail: &SessionDetail,
) -> Result<ThreadReliabilityProjection, String> {
    let conn = lock_db(db)?;
    sync_thread_reliability_projection_with_conn(&conn, detail)
}

fn sync_thread_reliability_projection_with_conn(
    conn: &Connection,
    detail: &SessionDetail,
) -> Result<ThreadReliabilityProjection, String> {
    let pending_requests = build_pending_requests(detail);
    let derived_outcome = build_last_outcome(detail);
    let derived_incidents = build_incidents(detail, &pending_requests);

    if let Some(outcome) = derived_outcome.as_ref() {
        let record = outcome_record_from_view(outcome);
        AgentTurnOutcomeDao::upsert(conn, &record)
            .map_err(|error| format!("写入 turn outcome 失败: {error}"))?;
    }

    let persisted_outcome = match (detail.turns.last(), derived_outcome.as_ref()) {
        (Some(turn), Some(_)) => AgentTurnOutcomeDao::get_by_turn(conn, &turn.id)
            .map_err(|error| format!("读取 turn outcome 失败: {error}"))?
            .map(outcome_view_from_record),
        _ => None,
    };

    let now = chrono::Utc::now().to_rfc3339();
    let active_incident_ids = derived_incidents
        .iter()
        .map(|incident| incident.id.clone())
        .collect::<HashSet<_>>();

    for incident in &derived_incidents {
        let record = incident_record_from_view(incident);
        AgentThreadIncidentDao::upsert_active(conn, &record)
            .map_err(|error| format!("写入 thread incident 失败: {error}"))?;
    }

    for existing in AgentThreadIncidentDao::list_active_by_thread(conn, &detail.thread_id)
        .map_err(|error| format!("读取 active incidents 失败: {error}"))?
    {
        if active_incident_ids.contains(&existing.id) {
            continue;
        }
        AgentThreadIncidentDao::clear(conn, &existing.id, &now, &now)
            .map_err(|error| format!("清理过期 incident 失败: {error}"))?;
    }

    let persisted_incidents =
        AgentThreadIncidentDao::list_active_by_thread(conn, &detail.thread_id)
            .map_err(|error| format!("读取同步后的 active incidents 失败: {error}"))?
            .into_iter()
            .map(incident_view_from_record)
            .collect();

    Ok(ThreadReliabilityProjection {
        pending_requests,
        last_outcome: persisted_outcome,
        incidents: persisted_incidents,
    })
}

fn outcome_record_from_view(view: &AgentRuntimeOutcomeView) -> AgentTurnOutcomeRecord {
    let now = chrono::Utc::now().to_rfc3339();
    AgentTurnOutcomeRecord {
        turn_id: view.turn_id.clone().unwrap_or_default(),
        thread_id: view.thread_id.clone(),
        outcome_type: view.outcome_type.clone(),
        summary: view.summary.clone().unwrap_or_default(),
        primary_cause: view.primary_cause.clone(),
        retryable: view.retryable,
        details_json: None,
        ended_at: view.ended_at.clone().unwrap_or_else(|| now.clone()),
        created_at: now.clone(),
        updated_at: now,
    }
}

fn outcome_view_from_record(record: AgentTurnOutcomeRecord) -> AgentRuntimeOutcomeView {
    AgentRuntimeOutcomeView {
        thread_id: record.thread_id,
        turn_id: Some(record.turn_id),
        outcome_type: record.outcome_type,
        summary: Some(record.summary),
        primary_cause: record.primary_cause,
        retryable: record.retryable,
        ended_at: Some(record.ended_at),
    }
}

fn incident_record_from_view(view: &AgentRuntimeIncidentView) -> AgentThreadIncidentRecord {
    let now = chrono::Utc::now().to_rfc3339();
    AgentThreadIncidentRecord {
        id: view.id.clone(),
        thread_id: view.thread_id.clone(),
        turn_id: view.turn_id.clone(),
        item_id: view.item_id.clone(),
        incident_type: view.incident_type.clone(),
        severity: view.severity.clone(),
        status: view.status.clone(),
        title: view.title.clone(),
        details_json: view
            .details
            .as_ref()
            .map(|value: &serde_json::Value| value.to_string()),
        detected_at: view.detected_at.clone().unwrap_or_else(|| now.clone()),
        cleared_at: view.cleared_at.clone(),
        created_at: now.clone(),
        updated_at: now,
    }
}

fn incident_view_from_record(record: AgentThreadIncidentRecord) -> AgentRuntimeIncidentView {
    AgentRuntimeIncidentView {
        id: record.id,
        thread_id: record.thread_id,
        turn_id: record.turn_id,
        item_id: record.item_id,
        incident_type: record.incident_type,
        severity: record.severity,
        status: record.status,
        title: record.title,
        details: record
            .details_json
            .as_deref()
            .and_then(|value| serde_json::from_str(value).ok()),
        detected_at: Some(record.detected_at),
        cleared_at: record.cleared_at,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use lime_core::database::dao::agent_thread_incident::AgentThreadIncidentDao;
    use lime_core::database::dao::agent_timeline::{
        AgentThreadItem, AgentThreadItemPayload, AgentThreadItemStatus, AgentThreadTurn,
        AgentThreadTurnStatus,
    };
    use lime_core::database::dao::agent_turn_outcome::AgentTurnOutcomeDao;
    use lime_core::database::schema::create_tables;
    use rusqlite::Connection;
    use std::sync::{Arc, Mutex};

    fn setup_db() -> DbConnection {
        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        create_tables(&conn).expect("创建表结构失败");
        Arc::new(Mutex::new(conn))
    }

    fn base_detail() -> SessionDetail {
        SessionDetail {
            id: "session-1".to_string(),
            name: "可靠性测试".to_string(),
            created_at: 0,
            updated_at: 0,
            thread_id: "thread-1".to_string(),
            model: None,
            working_dir: None,
            workspace_id: None,
            messages: Vec::new(),
            execution_strategy: None,
            execution_runtime: None,
            turns: Vec::new(),
            items: Vec::new(),
            todo_items: Vec::new(),
            child_subagent_sessions: Vec::new(),
            subagent_parent_context: None,
        }
    }

    #[test]
    fn should_persist_failed_outcome_and_clear_stale_incident() {
        let db = setup_db();

        let mut failed_detail = base_detail();
        failed_detail.turns.push(AgentThreadTurn {
            id: "turn-failed".to_string(),
            thread_id: "thread-1".to_string(),
            prompt_text: "继续生成周报".to_string(),
            status: AgentThreadTurnStatus::Failed,
            started_at: "2026-03-23T09:55:00Z".to_string(),
            completed_at: Some("2026-03-23T09:56:00Z".to_string()),
            error_message: Some("provider rate limit".to_string()),
            created_at: "2026-03-23T09:55:00Z".to_string(),
            updated_at: "2026-03-23T09:56:00Z".to_string(),
        });
        failed_detail.items.push(AgentThreadItem {
            id: "item-tool-1".to_string(),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-failed".to_string(),
            sequence: 1,
            status: AgentThreadItemStatus::Failed,
            started_at: "2026-03-23T09:55:10Z".to_string(),
            completed_at: Some("2026-03-23T09:55:20Z".to_string()),
            updated_at: "2026-03-23T09:55:20Z".to_string(),
            payload: AgentThreadItemPayload::ToolCall {
                tool_name: "web_search".to_string(),
                arguments: None,
                output: None,
                success: Some(false),
                error: Some("rate limit".to_string()),
                metadata: None,
            },
        });

        let projection = sync_thread_reliability_projection(&db, &failed_detail)
            .expect("failed projection 应成功");
        assert_eq!(
            projection
                .last_outcome
                .as_ref()
                .map(|value| value.outcome_type.as_str()),
            Some("failed_tool")
        );
        assert_eq!(projection.incidents.len(), 1);

        let conn = lock_db(&db).expect("获取数据库连接失败");
        assert!(AgentTurnOutcomeDao::get_by_turn(&conn, "turn-failed")
            .expect("读取 outcome 应成功")
            .is_some());
        assert_eq!(
            AgentThreadIncidentDao::list_active_by_thread(&conn, "thread-1")
                .expect("读取 active incident 应成功")
                .len(),
            1
        );
        drop(conn);

        let mut recovered_detail = base_detail();
        recovered_detail.turns.push(AgentThreadTurn {
            id: "turn-running".to_string(),
            thread_id: "thread-1".to_string(),
            prompt_text: "重新执行".to_string(),
            status: AgentThreadTurnStatus::Running,
            started_at: chrono::Utc::now().to_rfc3339(),
            completed_at: None,
            error_message: None,
            created_at: chrono::Utc::now().to_rfc3339(),
            updated_at: chrono::Utc::now().to_rfc3339(),
        });

        let recovered_projection = sync_thread_reliability_projection(&db, &recovered_detail)
            .expect("recovered projection 应成功");
        assert!(recovered_projection.last_outcome.is_none());
        assert!(recovered_projection.incidents.is_empty());

        let conn = lock_db(&db).expect("获取数据库连接失败");
        assert!(
            AgentThreadIncidentDao::list_active_by_thread(&conn, "thread-1")
                .expect("读取 active incident 应成功")
                .is_empty()
        );
    }
}
