use super::*;

/// 创建新会话
#[tauri::command]
pub async fn agent_runtime_create_session(
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    mcp_manager: State<'_, McpManagerState>,
    workspace_id: String,
    name: Option<String>,
    execution_strategy: Option<AsterExecutionStrategy>,
) -> Result<String, String> {
    create_runtime_session_internal_with_runtime(
        db.inner(),
        state.inner(),
        mcp_manager.inner(),
        None,
        workspace_id,
        name,
        execution_strategy,
    )
    .await
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

    let provider_name = request
        .provider_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let provider_selector = request
        .provider_selector
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let model_name = request
        .model_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if provider_name.is_some() || model_name.is_some() {
        AsterAgentWrapper::update_session_provider_config_sync(
            db.inner(),
            &trimmed_session_id,
            provider_name,
            model_name,
        )?;
    }
    if let Some(provider_selector) = provider_selector.or(provider_name) {
        persist_session_provider_routing(&trimmed_session_id, provider_selector).await?;
    }

    if let Some(recent_preferences) = request.recent_preferences {
        AsterAgentWrapper::persist_session_recent_preferences(
            &trimmed_session_id,
            recent_preferences,
        )
        .await?;
    }

    if let Some(recent_access_mode) = request.recent_access_mode {
        AsterAgentWrapper::persist_session_recent_access_mode(
            &trimmed_session_id,
            recent_access_mode,
        )
        .await?;
    }

    if let Some(recent_team_selection) = request.recent_team_selection {
        AsterAgentWrapper::persist_session_recent_team_selection(
            &trimmed_session_id,
            recent_team_selection,
        )
        .await?;
    }

    Ok(())
}
