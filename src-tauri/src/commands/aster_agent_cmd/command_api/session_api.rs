use super::*;

/// 创建新会话
#[tauri::command]
pub async fn agent_runtime_create_session(
    db: State<'_, DbConnection>,
    workspace_id: String,
    name: Option<String>,
    execution_strategy: Option<AsterExecutionStrategy>,
) -> Result<String, String> {
    create_runtime_session_internal(db.inner(), None, workspace_id, name, execution_strategy).await
}

#[tauri::command]
pub async fn agent_runtime_list_sessions(
    db: State<'_, DbConnection>,
    logs: State<'_, LogState>,
) -> Result<Vec<SessionInfo>, String> {
    let started_at = Instant::now();
    logs.write()
        .await
        .add("info", "[AgentDiag] agent_runtime_list_sessions.start");

    match list_runtime_sessions_internal(db.inner()) {
        Ok(sessions) => {
            logs.write().await.add(
                "info",
                &format!(
                    "[AgentDiag] agent_runtime_list_sessions.success duration_ms={} sessions={}",
                    started_at.elapsed().as_millis(),
                    sessions.len()
                ),
            );
            Ok(sessions)
        }
        Err(error) => {
            logs.write().await.add(
                "error",
                &format!(
                    "[AgentDiag] agent_runtime_list_sessions.error duration_ms={} error={}",
                    started_at.elapsed().as_millis(),
                    crate::logger::sanitize_log_message(&error)
                ),
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn agent_runtime_update_session(
    db: State<'_, DbConnection>,
    request: AgentRuntimeUpdateSessionRequest,
) -> Result<(), String> {
    let trimmed_session_id = request.session_id.trim().to_string();
    if trimmed_session_id.is_empty() {
        return Err("session_id 不能为空".to_string());
    }

    if let Some(name) = request.name.as_ref() {
        let normalized_name = name.trim();
        if !normalized_name.is_empty() {
            rename_runtime_session_internal(db.inner(), &trimmed_session_id, normalized_name)?;
        }
    }

    if let Some(execution_strategy) = request.execution_strategy {
        update_runtime_session_execution_strategy_internal(
            db.inner(),
            &trimmed_session_id,
            execution_strategy,
        )?;
    }

    Ok(())
}
