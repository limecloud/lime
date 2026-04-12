use super::*;
use crate::services::runtime_analysis_handoff_service::{
    export_runtime_analysis_handoff, RuntimeAnalysisHandoffExportResult,
};
use crate::services::runtime_evidence_pack_service::{
    export_runtime_evidence_pack, RuntimeEvidencePackExportResult,
};
use crate::services::runtime_handoff_artifact_service::{
    export_runtime_handoff_bundle, RuntimeHandoffBundleExportResult,
};
use crate::services::runtime_replay_case_service::{
    export_runtime_replay_case, RuntimeReplayCaseExportResult,
};
use crate::services::runtime_review_decision_service::{
    export_runtime_review_decision_template, save_runtime_review_decision,
    RuntimeReviewDecisionContent, RuntimeReviewDecisionTemplateExportResult,
};
use crate::services::thread_reliability_projection_service::sync_thread_reliability_projection;
use std::path::PathBuf;

async fn resume_runtime_queue_with_warning(
    runtime: &RuntimeCommandContext,
    session_id: &str,
    action_label: &str,
) {
    if let Err(error) = runtime
        .resume_runtime_queue_if_needed(session_id.to_string())
        .await
    {
        tracing::warn!(
            "[AsterAgent][Queue] {}恢复排队执行失败: session_id={}, error={}",
            action_label,
            session_id,
            error
        );
    }
}

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
    let runtime = build_runtime_command_context(
        app,
        state,
        db,
        api_key_provider_service,
        logs,
        config_manager,
        mcp_manager,
        automation_state,
    );
    let runtime_request: AsterChatRequest = request.into();
    let queue_if_busy = runtime_request.queue_if_busy.unwrap_or(false);
    let queued_task = build_queued_turn_task(runtime_request)?;
    runtime
        .submit_runtime_turn(queued_task, queue_if_busy)
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
    if cancelled {
        let _ = state
            .record_interrupt_request(&session_id, "user", "用户主动停止当前执行")
            .await;
    }
    let cleared = clear_runtime_queue_service(&app, &session_id).await?;
    Ok(cancelled || !cleared.is_empty())
}

/// 统一运行时：压缩当前会话上下文。
#[tauri::command]
pub async fn agent_runtime_compact_session(
    app: AppHandle,
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    request: AgentRuntimeCompactSessionRequest,
) -> Result<(), String> {
    crate::commands::aster_agent_cmd::runtime_turn::compact_runtime_session_internal(
        &app,
        state.inner(),
        db.inner(),
        request,
    )
    .await
}

/// 统一运行时：恢复当前线程的排队执行。
#[tauri::command]
pub async fn agent_runtime_resume_thread(
    app: AppHandle,
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    api_key_provider_service: State<'_, ApiKeyProviderServiceState>,
    logs: State<'_, LogState>,
    config_manager: State<'_, GlobalConfigManagerState>,
    mcp_manager: State<'_, McpManagerState>,
    automation_state: State<'_, AutomationServiceState>,
    request: AgentRuntimeResumeThreadRequest,
) -> Result<bool, String> {
    let runtime = build_runtime_command_context(
        app,
        state,
        db,
        api_key_provider_service,
        logs,
        config_manager,
        mcp_manager,
        automation_state,
    );
    let session_id = request.session_id.trim().to_string();
    if session_id.is_empty() {
        return Ok(false);
    }

    runtime.resume_runtime_queue_if_needed(session_id).await
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
    let runtime = build_runtime_command_context(
        app,
        state,
        db,
        api_key_provider_service,
        logs,
        config_manager,
        mcp_manager,
        automation_state,
    );
    tracing::info!("[AsterAgent] 获取运行时会话: {}", session_id);
    resume_runtime_queue_with_warning(&runtime, &session_id, "获取会话后").await;

    let detail = AsterAgentWrapper::get_runtime_session_detail(runtime.db(), &session_id).await?;
    let queued_turns = list_runtime_queue_snapshots_service(&session_id).await?;
    let projection = sync_thread_reliability_projection(runtime.db(), &detail)?;
    let interrupt_marker = runtime.state().get_interrupt_marker(&session_id).await;
    let thread_read = AgentRuntimeThreadReadModel::from_parts(
        &detail,
        &queued_turns,
        projection.pending_requests,
        projection.last_outcome,
        projection.incidents,
        interrupt_marker.as_ref(),
    );
    Ok(
        AgentRuntimeSessionDetail::from_session_detail_with_thread_read(
            detail,
            queued_turns,
            thread_read,
        ),
    )
}

/// 统一运行时：仅获取线程稳定读模型。
#[tauri::command]
pub async fn agent_runtime_get_thread_read(
    app: AppHandle,
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    api_key_provider_service: State<'_, ApiKeyProviderServiceState>,
    logs: State<'_, LogState>,
    config_manager: State<'_, GlobalConfigManagerState>,
    mcp_manager: State<'_, McpManagerState>,
    automation_state: State<'_, AutomationServiceState>,
    session_id: String,
) -> Result<AgentRuntimeThreadReadModel, String> {
    let runtime = build_runtime_command_context(
        app,
        state,
        db,
        api_key_provider_service,
        logs,
        config_manager,
        mcp_manager,
        automation_state,
    );
    tracing::info!("[AsterAgent] 获取运行时线程读模型: {}", session_id);
    resume_runtime_queue_with_warning(&runtime, &session_id, "获取线程读模型后").await;

    let detail = AsterAgentWrapper::get_runtime_session_detail(runtime.db(), &session_id).await?;
    let queued_turns = list_runtime_queue_snapshots_service(&session_id).await?;
    let projection = sync_thread_reliability_projection(runtime.db(), &detail)?;
    let interrupt_marker = runtime.state().get_interrupt_marker(&session_id).await;
    Ok(AgentRuntimeThreadReadModel::from_parts(
        &detail,
        &queued_turns,
        projection.pending_requests,
        projection.last_outcome,
        projection.incidents,
        interrupt_marker.as_ref(),
    ))
}

struct RuntimeExportContext {
    detail: SessionDetail,
    thread_read: AgentRuntimeThreadReadModel,
    workspace_root: PathBuf,
}

fn resolve_runtime_export_workspace_root(
    db: &DbConnection,
    detail: &SessionDetail,
) -> Result<PathBuf, String> {
    if let Some(workspace_id) = detail
        .workspace_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let manager = WorkspaceManager::new(db.clone());
        let workspace_id = workspace_id.to_string();
        let workspace = manager
            .get(&workspace_id)
            .map_err(|error| format!("读取 workspace 失败: {error}"))?
            .ok_or_else(|| format!("Workspace 不存在: {workspace_id}"))?;
        let ensured = ensure_workspace_ready_with_auto_relocate(&manager, &workspace)?;
        return Ok(ensured.root_path);
    }

    if let Some(working_dir) = detail
        .working_dir
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(PathBuf::from(working_dir));
    }

    Err("当前会话缺少 workspace / working_dir，无法导出运行时制品".to_string())
}

async fn load_runtime_export_context(
    runtime: &RuntimeCommandContext,
    session_id: &str,
    action_label: &str,
) -> Result<RuntimeExportContext, String> {
    resume_runtime_queue_with_warning(runtime, session_id, action_label).await;

    let detail = AsterAgentWrapper::get_runtime_session_detail(runtime.db(), session_id).await?;
    let queued_turns = list_runtime_queue_snapshots_service(session_id).await?;
    let projection = sync_thread_reliability_projection(runtime.db(), &detail)?;
    let interrupt_marker = runtime.state().get_interrupt_marker(session_id).await;
    let thread_read = AgentRuntimeThreadReadModel::from_parts(
        &detail,
        &queued_turns,
        projection.pending_requests,
        projection.last_outcome,
        projection.incidents,
        interrupt_marker.as_ref(),
    );
    let workspace_root = resolve_runtime_export_workspace_root(runtime.db(), &detail)?;

    Ok(RuntimeExportContext {
        detail,
        thread_read,
        workspace_root,
    })
}

/// 统一运行时：导出当前会话的交接制品 bundle。
#[tauri::command]
pub async fn agent_runtime_export_handoff_bundle(
    app: AppHandle,
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    api_key_provider_service: State<'_, ApiKeyProviderServiceState>,
    logs: State<'_, LogState>,
    config_manager: State<'_, GlobalConfigManagerState>,
    mcp_manager: State<'_, McpManagerState>,
    automation_state: State<'_, AutomationServiceState>,
    session_id: String,
) -> Result<RuntimeHandoffBundleExportResult, String> {
    let runtime = build_runtime_command_context(
        app,
        state,
        db,
        api_key_provider_service,
        logs,
        config_manager,
        mcp_manager,
        automation_state,
    );
    tracing::info!("[AsterAgent] 导出 handoff bundle: {}", session_id);
    let context =
        load_runtime_export_context(&runtime, &session_id, "导出 handoff bundle 前").await?;

    export_runtime_handoff_bundle(
        &context.detail,
        &context.thread_read,
        &context.workspace_root,
    )
}

/// 统一运行时：导出当前会话的最小问题证据包。
#[tauri::command]
pub async fn agent_runtime_export_evidence_pack(
    app: AppHandle,
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    api_key_provider_service: State<'_, ApiKeyProviderServiceState>,
    logs: State<'_, LogState>,
    config_manager: State<'_, GlobalConfigManagerState>,
    mcp_manager: State<'_, McpManagerState>,
    automation_state: State<'_, AutomationServiceState>,
    session_id: String,
) -> Result<RuntimeEvidencePackExportResult, String> {
    let runtime = build_runtime_command_context(
        app,
        state,
        db,
        api_key_provider_service,
        logs,
        config_manager,
        mcp_manager,
        automation_state,
    );
    tracing::info!("[AsterAgent] 导出 evidence pack: {}", session_id);
    let context =
        load_runtime_export_context(&runtime, &session_id, "导出 evidence pack 前").await?;

    export_runtime_evidence_pack(
        &context.detail,
        &context.thread_read,
        &context.workspace_root,
    )
}

/// 统一运行时：导出当前会话的外部分析交接包。
#[tauri::command]
pub async fn agent_runtime_export_analysis_handoff(
    app: AppHandle,
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    api_key_provider_service: State<'_, ApiKeyProviderServiceState>,
    logs: State<'_, LogState>,
    config_manager: State<'_, GlobalConfigManagerState>,
    mcp_manager: State<'_, McpManagerState>,
    automation_state: State<'_, AutomationServiceState>,
    session_id: String,
) -> Result<RuntimeAnalysisHandoffExportResult, String> {
    let runtime = build_runtime_command_context(
        app,
        state,
        db,
        api_key_provider_service,
        logs,
        config_manager,
        mcp_manager,
        automation_state,
    );
    tracing::info!("[AsterAgent] 导出 analysis handoff: {}", session_id);
    let context =
        load_runtime_export_context(&runtime, &session_id, "导出 analysis handoff 前").await?;

    export_runtime_analysis_handoff(
        &context.detail,
        &context.thread_read,
        &context.workspace_root,
    )
}

/// 统一运行时：导出当前会话的人工审核记录模板。
#[tauri::command]
pub async fn agent_runtime_export_review_decision_template(
    app: AppHandle,
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    api_key_provider_service: State<'_, ApiKeyProviderServiceState>,
    logs: State<'_, LogState>,
    config_manager: State<'_, GlobalConfigManagerState>,
    mcp_manager: State<'_, McpManagerState>,
    automation_state: State<'_, AutomationServiceState>,
    session_id: String,
) -> Result<RuntimeReviewDecisionTemplateExportResult, String> {
    let runtime = build_runtime_command_context(
        app,
        state,
        db,
        api_key_provider_service,
        logs,
        config_manager,
        mcp_manager,
        automation_state,
    );
    tracing::info!("[AsterAgent] 导出 review decision 模板: {}", session_id);
    let context =
        load_runtime_export_context(&runtime, &session_id, "导出 review decision 模板前").await?;

    export_runtime_review_decision_template(
        &context.detail,
        &context.thread_read,
        &context.workspace_root,
    )
}

/// 统一运行时：保存当前会话的人工审核结果。
#[tauri::command]
pub async fn agent_runtime_save_review_decision(
    app: AppHandle,
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    api_key_provider_service: State<'_, ApiKeyProviderServiceState>,
    logs: State<'_, LogState>,
    config_manager: State<'_, GlobalConfigManagerState>,
    mcp_manager: State<'_, McpManagerState>,
    automation_state: State<'_, AutomationServiceState>,
    request: AgentRuntimeSaveReviewDecisionRequest,
) -> Result<RuntimeReviewDecisionTemplateExportResult, String> {
    let runtime = build_runtime_command_context(
        app,
        state,
        db,
        api_key_provider_service,
        logs,
        config_manager,
        mcp_manager,
        automation_state,
    );
    let session_id = request.session_id.trim().to_string();
    tracing::info!("[AsterAgent] 保存 review decision: {}", session_id);
    let context =
        load_runtime_export_context(&runtime, &session_id, "保存 review decision 前").await?;

    save_runtime_review_decision(
        &context.detail,
        &context.thread_read,
        &context.workspace_root,
        RuntimeReviewDecisionContent {
            decision_status: request.decision_status,
            decision_summary: request.decision_summary,
            chosen_fix_strategy: request.chosen_fix_strategy,
            risk_level: request.risk_level,
            risk_tags: request.risk_tags,
            human_reviewer: request.human_reviewer,
            reviewed_at: request.reviewed_at,
            followup_actions: request.followup_actions,
            regression_requirements: request.regression_requirements,
            notes: request.notes,
        },
    )
}

/// 统一运行时：导出当前会话的 replay case。
#[tauri::command]
pub async fn agent_runtime_export_replay_case(
    app: AppHandle,
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    api_key_provider_service: State<'_, ApiKeyProviderServiceState>,
    logs: State<'_, LogState>,
    config_manager: State<'_, GlobalConfigManagerState>,
    mcp_manager: State<'_, McpManagerState>,
    automation_state: State<'_, AutomationServiceState>,
    session_id: String,
) -> Result<RuntimeReplayCaseExportResult, String> {
    let runtime = build_runtime_command_context(
        app,
        state,
        db,
        api_key_provider_service,
        logs,
        config_manager,
        mcp_manager,
        automation_state,
    );
    tracing::info!("[AsterAgent] 导出 replay case: {}", session_id);
    let context = load_runtime_export_context(&runtime, &session_id, "导出 replay case 前").await?;

    export_runtime_replay_case(
        &context.detail,
        &context.thread_read,
        &context.workspace_root,
    )
}

/// 统一运行时：重新拉起指定 pending request 的前端交互载荷。
#[tauri::command]
pub async fn agent_runtime_replay_request(
    db: State<'_, DbConnection>,
    request: AgentRuntimeReplayRequestRequest,
) -> Result<Option<AgentRuntimeReplayedActionRequiredView>, String> {
    let session_id = request.session_id.trim().to_string();
    let request_id = request.request_id.trim().to_string();
    if session_id.is_empty() || request_id.is_empty() {
        return Ok(None);
    }

    let detail = AsterAgentWrapper::get_runtime_session_detail(db.inner(), &session_id).await?;
    Ok(AgentRuntimeReplayedActionRequiredView::from_session_detail(
        &detail,
        &request_id,
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
    if state.is_initialized().await {
        ensure_runtime_support_tools_registered(state.inner(), mcp_manager.inner()).await?;
    }

    let request = request.unwrap_or_default();
    let caller = lime_core::tool_calling::normalize_tool_caller(request.caller.as_deref())
        .unwrap_or_else(|| "assistant".to_string());
    let surface = match (request.workbench, request.browser_assist) {
        (true, true) => WorkspaceToolSurface::workbench_with_browser_assist(),
        (true, false) => WorkspaceToolSurface::workbench(),
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
    let runtime = build_runtime_command_context(
        app,
        state,
        db,
        api_key_provider_service,
        logs,
        config_manager,
        mcp_manager,
        automation_state,
    );
    let session_id = request.session_id.trim().to_string();
    let queued_turn_id = request.queued_turn_id.trim().to_string();
    if session_id.is_empty() || queued_turn_id.is_empty() {
        return Ok(false);
    }

    let promoted = promote_runtime_queued_turn_service(&session_id, &queued_turn_id).await?;
    if !promoted {
        return Ok(false);
    }

    let _ = runtime.state().cancel_session(&session_id).await;
    let _ = runtime.resume_runtime_queue_if_needed(session_id).await?;

    Ok(true)
}
