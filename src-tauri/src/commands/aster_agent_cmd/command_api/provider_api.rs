use super::*;

fn build_agent_status(
    initialized: bool,
    provider_config: Option<ProviderConfig>,
) -> AsterAgentStatus {
    AsterAgentStatus {
        initialized,
        provider_configured: provider_config.is_some(),
        provider_name: provider_config.as_ref().map(|c| c.provider_name.clone()),
        provider_selector: provider_config
            .as_ref()
            .and_then(|c| c.provider_selector.clone()),
        model_name: provider_config.as_ref().map(|c| c.model_name.clone()),
        credential_uuid: provider_config.and_then(|c| c.credential_uuid),
    }
}

#[tauri::command]
pub async fn aster_agent_init(
    app: AppHandle,
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    api_key_provider_service: State<'_, ApiKeyProviderServiceState>,
    mcp_manager: State<'_, McpManagerState>,
) -> Result<AsterAgentStatus, String> {
    tracing::info!("[AsterAgent] 初始化 Agent");

    state.init_agent_with_db(&db).await?;
    ensure_runtime_support_tools_registered(
        &app,
        state.inner(),
        db.inner(),
        api_key_provider_service.inner(),
        mcp_manager.inner(),
    )
    .await?;

    let provider_config = state.get_provider_config().await;

    tracing::info!("[AsterAgent] Agent 初始化成功");

    Ok(build_agent_status(true, provider_config))
}

/// 配置 Aster Agent 的 Provider
#[tauri::command]
pub async fn aster_agent_configure_provider(
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    mut request: ConfigureProviderRequest,
    session_id: String,
) -> Result<AsterAgentStatus, String> {
    ensure_provider_runtime_ready(&request).await?;
    let runtime_tool_call_decision =
        enrich_provider_config_with_runtime_tool_strategy(&mut request).await;
    tracing::info!(
        "[AsterAgent] 配置 Provider: {} / {}，tool_call_strategy={:?}，toolshim_model={:?}",
        request.provider_name,
        request.model_name,
        runtime_tool_call_decision.strategy,
        runtime_tool_call_decision.toolshim_model
    );

    let provider_selector = request
        .provider_id
        .clone()
        .or_else(|| Some(request.provider_name.clone()));
    let config = ProviderConfig {
        provider_name: request.provider_name,
        provider_selector,
        model_name: request.model_name,
        api_key: request.api_key,
        base_url: request.base_url,
        credential_uuid: None,
        force_responses_api: false,
        toolshim: matches!(
            request.tool_call_strategy,
            Some(RuntimeToolCallStrategy::ToolShim)
        ),
        toolshim_model: request.toolshim_model.clone(),
    };

    state
        .configure_provider(config.clone(), &session_id, &db)
        .await?;
    persist_session_provider_routing(
        &session_id,
        config
            .provider_selector
            .as_deref()
            .unwrap_or(&config.provider_name),
    )
    .await?;

    Ok(AsterAgentStatus {
        initialized: true,
        provider_configured: true,
        provider_name: Some(config.provider_name),
        provider_selector: config.provider_selector,
        model_name: Some(config.model_name),
        credential_uuid: None,
    })
}

/// 获取 Aster Agent 状态
#[tauri::command]
pub async fn aster_agent_status(
    state: State<'_, AsterAgentState>,
) -> Result<AsterAgentStatus, String> {
    let provider_config = state.get_provider_config().await;
    Ok(build_agent_status(
        state.is_initialized().await,
        provider_config,
    ))
}

/// 重置 Aster Agent
///
/// 清除当前 Provider 配置，下次对话时会重新从凭证池选择凭证。
/// 用于切换凭证后无需重启应用即可生效。
#[tauri::command]
pub async fn aster_agent_reset(
    state: State<'_, AsterAgentState>,
) -> Result<AsterAgentStatus, String> {
    tracing::info!("[AsterAgent] 重置 Agent Provider 配置");

    state.clear_provider_config().await;

    Ok(AsterAgentStatus {
        initialized: state.is_initialized().await,
        provider_configured: false,
        provider_name: None,
        provider_selector: None,
        model_name: None,
        credential_uuid: None,
    })
}
