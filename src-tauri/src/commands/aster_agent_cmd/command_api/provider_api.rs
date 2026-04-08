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
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    mcp_manager: State<'_, McpManagerState>,
) -> Result<AsterAgentStatus, String> {
    tracing::info!("[AsterAgent] 初始化 Agent");

    state.init_agent_with_db(&db).await?;
    ensure_runtime_support_tools_registered(state.inner(), mcp_manager.inner()).await?;

    let provider_config = state.get_provider_config().await;

    tracing::info!("[AsterAgent] Agent 初始化成功");

    Ok(build_agent_status(true, provider_config))
}

/// 配置 Aster Agent 的 Provider
#[tauri::command]
pub async fn aster_agent_configure_provider(
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    request: ConfigureProviderRequest,
    session_id: String,
) -> Result<AsterAgentStatus, String> {
    tracing::info!(
        "[AsterAgent] 配置 Provider: {} / {}",
        request.provider_name,
        request.model_name
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
        credential_path: None,
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

/// 从凭证池配置 Aster Agent 的 Provider
///
/// 自动从 Lime 凭证池选择可用凭证并配置 Aster Provider
#[tauri::command]
pub async fn aster_agent_configure_from_pool(
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    request: ConfigureFromPoolRequest,
    session_id: String,
) -> Result<AsterAgentStatus, String> {
    tracing::info!(
        "[AsterAgent] 从凭证池配置 Provider: {} / {}",
        request.provider_type,
        request.model_name
    );

    let aster_config = state
        .configure_provider_from_pool(
            &db,
            &request.provider_type,
            &request.model_name,
            &session_id,
        )
        .await?;
    persist_session_provider_routing(&session_id, &request.provider_type).await?;

    Ok(AsterAgentStatus {
        initialized: true,
        provider_configured: true,
        provider_name: Some(aster_config.provider_name),
        provider_selector: aster_config.provider_selector,
        model_name: Some(aster_config.model_name),
        credential_uuid: Some(aster_config.credential_uuid),
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
