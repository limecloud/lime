use super::*;

#[tauri::command]
pub async fn agent_runtime_submit_turn(
    app: AppHandle,
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    api_key_provider_service: State<'_, ApiKeyProviderServiceState>,
    logs: State<'_, LogState>,
    config_manager: State<'_, GlobalConfigManagerState>,
    mcp_manager: State<'_, McpManagerState>,
    automation_state: State<'_, AutomationServiceState>,
    request: AgentRuntimeSubmitTurnRequest,
) -> Result<(), String> {
    let runtime_request: AsterChatRequest = request.into();
    let queue_if_busy = runtime_request.queue_if_busy.unwrap_or(false);
    let queued_task = build_queued_turn_task(runtime_request)?;
    submit_runtime_turn_service(
        app,
        state.inner(),
        db.inner(),
        api_key_provider_service.inner(),
        logs.inner(),
        config_manager.inner(),
        mcp_manager.inner(),
        automation_state.inner(),
        queued_task,
        queue_if_busy,
        build_runtime_queue_executor(),
    )
    .await
}

/// 统一运行时：中断当前 turn。
#[tauri::command]
pub async fn agent_runtime_interrupt_turn(
    app: AppHandle,
    state: State<'_, AsterAgentState>,
    request: AgentRuntimeInterruptTurnRequest,
) -> Result<bool, String> {
    let session_id = request.session_id;
    let cancelled = state.cancel_session(&session_id).await;
    let cleared = clear_runtime_queue_service(&app, &session_id).await?;
    Ok(cancelled || !cleared.is_empty())
}

/// 统一运行时：获取会话详情。
#[tauri::command]
pub async fn agent_runtime_get_session(
    app: AppHandle,
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    api_key_provider_service: State<'_, ApiKeyProviderServiceState>,
    logs: State<'_, LogState>,
    config_manager: State<'_, GlobalConfigManagerState>,
    mcp_manager: State<'_, McpManagerState>,
    automation_state: State<'_, AutomationServiceState>,
    session_id: String,
) -> Result<AgentRuntimeSessionDetail, String> {
    tracing::info!("[AsterAgent] 获取运行时会话: {}", session_id);
    let detail = AsterAgentWrapper::get_runtime_session_detail(db.inner(), &session_id).await?;

    if let Err(error) = resume_runtime_queue_if_needed_service(
        app,
        state.inner(),
        db.inner(),
        api_key_provider_service.inner(),
        logs.inner(),
        config_manager.inner(),
        mcp_manager.inner(),
        automation_state.inner(),
        session_id.clone(),
        build_runtime_queue_executor(),
    )
    .await
    {
        tracing::warn!(
            "[AsterAgent][Queue] 获取会话后恢复排队执行失败: session_id={}, error={}",
            session_id,
            error
        );
    }

    let queued_turns = list_runtime_queue_snapshots_service(&session_id).await?;
    Ok(AgentRuntimeSessionDetail::from_session_detail(
        detail,
        queued_turns,
    ))
}

/// 统一运行时：获取工具库存快照。
#[tauri::command]
pub async fn agent_runtime_get_tool_inventory(
    state: State<'_, AsterAgentState>,
    config_manager: State<'_, GlobalConfigManagerState>,
    mcp_manager: State<'_, McpManagerState>,
    request: Option<AgentRuntimeToolInventoryRequest>,
) -> Result<crate::agent_tools::inventory::AgentToolInventorySnapshot, String> {
    let request = request.unwrap_or_default();
    let caller = lime_core::tool_calling::normalize_tool_caller(request.caller.as_deref())
        .unwrap_or_else(|| "assistant".to_string());
    let surface = match (request.creator, request.browser_assist) {
        (true, true) => WorkspaceToolSurface::creator_with_browser_assist(),
        (true, false) => WorkspaceToolSurface::creator(),
        (false, true) => WorkspaceToolSurface::browser_assist(),
        (false, false) => WorkspaceToolSurface::core(),
    };

    let mut warnings = Vec::new();

    let (mcp_server_names, mcp_tools) = {
        let manager = mcp_manager.lock().await;
        let server_names = manager.get_running_servers().await;
        let tools = match manager.list_tools().await {
            Ok(tools) => tools,
            Err(error) => {
                warnings.push(format!("读取 MCP 工具列表失败: {error}"));
                Vec::new()
            }
        };
        (server_names, tools)
    };

    let agent_arc = state.get_agent_arc();
    let guard = agent_arc.read().await;
    let Some(agent) = guard.as_ref() else {
        return Ok(build_tool_inventory(AgentToolInventoryBuildInput {
            surface,
            caller,
            agent_initialized: false,
            warnings: {
                warnings.push(
                    "Aster Agent 尚未初始化，runtime registry / extension 快照为空".to_string(),
                );
                warnings
            },
            persisted_execution_policy: Some(config_manager.config().agent.tool_execution),
            request_metadata: request.metadata.clone(),
            mcp_server_names,
            mcp_tools,
            registry_definitions: Vec::new(),
            extension_configs: Vec::new(),
            visible_extension_tools: Vec::new(),
            searchable_extension_tools: Vec::new(),
        }));
    };

    let registry_arc = agent.tool_registry().clone();
    let registry = registry_arc.read().await;
    let registry_definitions = registry.get_definitions();
    drop(registry);

    let extension_configs = agent.get_extension_configs().await;
    let extension_manager = agent.extension_manager.clone();
    let visible_extension_tools = match extension_manager.get_prefixed_tools(None).await {
        Ok(tools) => tools
            .into_iter()
            .map(|tool| ExtensionToolInventorySeed {
                name: tool.name.to_string(),
                description: tool.description.clone().unwrap_or_default().to_string(),
            })
            .collect(),
        Err(error) => {
            warnings.push(format!("读取已加载 extension tools 失败: {error}"));
            Vec::new()
        }
    };
    let searchable_extension_tools =
        match extension_manager.get_prefixed_tools_for_search(None).await {
            Ok(tools) => tools
                .into_iter()
                .map(|tool| ExtensionToolInventorySeed {
                    name: tool.name.to_string(),
                    description: tool.description.clone().unwrap_or_default().to_string(),
                })
                .collect(),
            Err(error) => {
                warnings.push(format!("读取 extension 搜索工具面失败: {error}"));
                Vec::new()
            }
        };

    Ok(build_tool_inventory(AgentToolInventoryBuildInput {
        surface,
        caller,
        agent_initialized: true,
        warnings,
        persisted_execution_policy: Some(config_manager.config().agent.tool_execution),
        request_metadata: request.metadata.clone(),
        mcp_server_names,
        mcp_tools,
        registry_definitions,
        extension_configs,
        visible_extension_tools,
        searchable_extension_tools,
    }))
}

/// 统一运行时：移除单个排队 turn。
#[tauri::command]
pub async fn agent_runtime_remove_queued_turn(
    app: AppHandle,
    request: AgentRuntimeRemoveQueuedTurnRequest,
) -> Result<bool, String> {
    let session_id = request.session_id.trim().to_string();
    let queued_turn_id = request.queued_turn_id.trim().to_string();
    if session_id.is_empty() || queued_turn_id.is_empty() {
        return Ok(false);
    }

    remove_runtime_queued_turn_service(&app, &session_id, &queued_turn_id).await
}

/// 统一运行时：将指定排队 turn 提前到下一条执行。
#[tauri::command]
pub async fn agent_runtime_promote_queued_turn(
    app: AppHandle,
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    api_key_provider_service: State<'_, ApiKeyProviderServiceState>,
    logs: State<'_, LogState>,
    config_manager: State<'_, GlobalConfigManagerState>,
    mcp_manager: State<'_, McpManagerState>,
    automation_state: State<'_, AutomationServiceState>,
    request: AgentRuntimePromoteQueuedTurnRequest,
) -> Result<bool, String> {
    let session_id = request.session_id.trim().to_string();
    let queued_turn_id = request.queued_turn_id.trim().to_string();
    if session_id.is_empty() || queued_turn_id.is_empty() {
        return Ok(false);
    }

    let promoted = promote_runtime_queued_turn_service(&session_id, &queued_turn_id).await?;
    if !promoted {
        return Ok(false);
    }

    let _ = state.cancel_session(&session_id).await;
    let _ = resume_runtime_queue_if_needed_service(
        app,
        state.inner(),
        db.inner(),
        api_key_provider_service.inner(),
        logs.inner(),
        config_manager.inner(),
        mcp_manager.inner(),
        automation_state.inner(),
        session_id,
        build_runtime_queue_executor(),
    )
    .await?;

    Ok(true)
}
