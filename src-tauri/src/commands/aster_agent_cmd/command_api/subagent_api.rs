use super::*;

#[tauri::command]
pub async fn agent_runtime_spawn_subagent(
    app: AppHandle,
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    api_key_provider_service: State<'_, ApiKeyProviderServiceState>,
    logs: State<'_, LogState>,
    config_manager: State<'_, GlobalConfigManagerState>,
    mcp_manager: State<'_, McpManagerState>,
    automation_state: State<'_, AutomationServiceState>,
    request: AgentRuntimeSpawnSubagentRequest,
) -> Result<AgentRuntimeSpawnSubagentResponse, String> {
    agent_runtime_spawn_subagent_internal(
        &build_subagent_control_runtime(
            app,
            state,
            db,
            api_key_provider_service,
            logs,
            config_manager,
            mcp_manager,
            automation_state,
        ),
        request,
    )
    .await
}

#[tauri::command]
pub async fn agent_runtime_send_subagent_input(
    app: AppHandle,
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    api_key_provider_service: State<'_, ApiKeyProviderServiceState>,
    logs: State<'_, LogState>,
    config_manager: State<'_, GlobalConfigManagerState>,
    mcp_manager: State<'_, McpManagerState>,
    automation_state: State<'_, AutomationServiceState>,
    request: AgentRuntimeSendSubagentInputRequest,
) -> Result<AgentRuntimeSendSubagentInputResponse, String> {
    agent_runtime_send_subagent_input_internal(
        &build_subagent_control_runtime(
            app,
            state,
            db,
            api_key_provider_service,
            logs,
            config_manager,
            mcp_manager,
            automation_state,
        ),
        request,
    )
    .await
}

#[tauri::command]
pub async fn agent_runtime_wait_subagents(
    app: AppHandle,
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    api_key_provider_service: State<'_, ApiKeyProviderServiceState>,
    logs: State<'_, LogState>,
    config_manager: State<'_, GlobalConfigManagerState>,
    mcp_manager: State<'_, McpManagerState>,
    automation_state: State<'_, AutomationServiceState>,
    request: AgentRuntimeWaitSubagentsRequest,
) -> Result<AgentRuntimeWaitSubagentsResponse, String> {
    agent_runtime_wait_subagents_internal(
        &build_subagent_control_runtime(
            app,
            state,
            db,
            api_key_provider_service,
            logs,
            config_manager,
            mcp_manager,
            automation_state,
        ),
        request,
    )
    .await
}

#[tauri::command]
pub async fn agent_runtime_resume_subagent(
    app: AppHandle,
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    api_key_provider_service: State<'_, ApiKeyProviderServiceState>,
    logs: State<'_, LogState>,
    config_manager: State<'_, GlobalConfigManagerState>,
    mcp_manager: State<'_, McpManagerState>,
    automation_state: State<'_, AutomationServiceState>,
    request: AgentRuntimeResumeSubagentRequest,
) -> Result<AgentRuntimeResumeSubagentResponse, String> {
    agent_runtime_resume_subagent_internal(
        &build_subagent_control_runtime(
            app,
            state,
            db,
            api_key_provider_service,
            logs,
            config_manager,
            mcp_manager,
            automation_state,
        ),
        request,
    )
    .await
}

#[tauri::command]
pub async fn agent_runtime_close_subagent(
    app: AppHandle,
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    api_key_provider_service: State<'_, ApiKeyProviderServiceState>,
    logs: State<'_, LogState>,
    config_manager: State<'_, GlobalConfigManagerState>,
    mcp_manager: State<'_, McpManagerState>,
    automation_state: State<'_, AutomationServiceState>,
    request: AgentRuntimeCloseSubagentRequest,
) -> Result<AgentRuntimeCloseSubagentResponse, String> {
    agent_runtime_close_subagent_internal(
        &build_subagent_control_runtime(
            app,
            state,
            db,
            api_key_provider_service,
            logs,
            config_manager,
            mcp_manager,
            automation_state,
        ),
        request,
    )
    .await
}
