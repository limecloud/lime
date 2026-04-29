use super::*;
use crate::commands::aster_agent_cmd::dto::AgentRuntimeSessionHistoryCursor;
use crate::sceneapp::application::SceneAppService;
use crate::services::execution_tracker_service::ExecutionTracker;
use crate::services::runtime_analysis_handoff_service::{
    export_runtime_analysis_handoff, RuntimeAnalysisHandoffExportResult,
};
use crate::services::runtime_evidence_pack_service::{
    export_runtime_evidence_pack, resolve_runtime_export_workspace_root,
    RuntimeEvidencePackExportResult,
};
use crate::services::runtime_file_checkpoint_service::{
    diff_file_checkpoint, get_file_checkpoint, list_file_checkpoints,
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
use aster::hooks::SessionSource;
use lime_core::database::dao::agent::AgentDao;
use lime_core::database::dao::agent_timeline::{AgentThreadItemStatus, AgentThreadTurnStatus};
use std::path::PathBuf;
use std::time::Instant;

const RUNTIME_SESSION_OPEN_HISTORY_LIMIT: usize = 40;
const RUNTIME_SESSION_MAX_HISTORY_LIMIT: usize = 2_000;

fn normalize_runtime_session_history_limit(history_limit: Option<usize>) -> Option<usize> {
    match history_limit {
        // 兼容需要完整详情的调用者：显式传 0 表示不裁剪。
        Some(0) => None,
        Some(limit) => Some(limit.min(RUNTIME_SESSION_MAX_HISTORY_LIMIT)),
        None => Some(RUNTIME_SESSION_OPEN_HISTORY_LIMIT),
    }
}

fn normalize_runtime_session_history_offset(
    history_limit: Option<usize>,
    history_offset: Option<usize>,
) -> usize {
    if history_limit.is_none() {
        return 0;
    }

    history_offset.unwrap_or(0)
}

fn normalize_runtime_session_history_before_message_id(
    history_limit: Option<usize>,
    history_before_message_id: Option<i64>,
) -> Option<i64> {
    if history_limit.is_none() {
        return None;
    }

    history_before_message_id.filter(|message_id| *message_id > 0)
}

fn should_list_runtime_queue_snapshots(
    detail: &lime_agent::SessionDetail,
    history_limit: Option<usize>,
    history_offset: usize,
    history_before_message_id: Option<i64>,
) -> bool {
    if history_offset > 0 || history_before_message_id.is_some() {
        return false;
    }

    if detail.is_persisted_empty() {
        return false;
    }
    if history_limit.is_none() {
        return true;
    }

    detail
        .turns
        .iter()
        .any(|turn| matches!(turn.status, AgentThreadTurnStatus::Running))
        || detail
            .items
            .iter()
            .any(|item| matches!(item.status, AgentThreadItemStatus::InProgress))
}

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
    config_manager: State<'_, GlobalConfigManagerState>,
    request: AgentRuntimeCompactSessionRequest,
) -> Result<(), String> {
    crate::commands::aster_agent_cmd::runtime_turn::compact_runtime_session_internal(
        &app,
        state.inner(),
        db.inner(),
        config_manager.inner(),
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
    resume_session_start_hooks: Option<bool>,
    history_limit: Option<usize>,
    history_offset: Option<usize>,
    history_before_message_id: Option<i64>,
) -> Result<AgentRuntimeSessionDetail, String> {
    let started_at = Instant::now();
    let resume_hooks = resume_session_start_hooks.unwrap_or(false);
    let normalized_history_limit = normalize_runtime_session_history_limit(history_limit);
    let normalized_history_offset =
        normalize_runtime_session_history_offset(normalized_history_limit, history_offset);
    let normalized_history_before_message_id = normalize_runtime_session_history_before_message_id(
        normalized_history_limit,
        history_before_message_id,
    );
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
    let result = async {
        // 读取会话详情应保持只读，避免打开会话时顺带恢复排队执行。
        let resume_queue_ms = 0;

        let detail_started_at = Instant::now();
        let detail = AsterAgentWrapper::get_runtime_session_detail_with_history_page(
            runtime.db(),
            &session_id,
            normalized_history_limit,
            normalized_history_offset,
            normalized_history_before_message_id,
        )
        .await?;
        let detail_ms = detail_started_at.elapsed().as_millis();

        let hooks_ms = if resume_hooks {
            let hooks_started_at = Instant::now();
            crate::commands::aster_agent_cmd::runtime_project_hooks::run_runtime_session_start_project_hooks_for_session_with_runtime(
                runtime.db(),
                runtime.state(),
                runtime.mcp_manager(),
                &session_id,
                SessionSource::Resume,
            )
            .await;
            hooks_started_at.elapsed().as_millis()
        } else {
            0
        };

        let queue_snapshots_started_at = Instant::now();
        let list_runtime_queue_snapshots = should_list_runtime_queue_snapshots(
            &detail,
            normalized_history_limit,
            normalized_history_offset,
            normalized_history_before_message_id,
        );
        let queued_turns = if !list_runtime_queue_snapshots {
            Vec::new()
        } else {
            list_runtime_queue_snapshots_service(&session_id).await?
        };
        let queue_snapshots_ms = queue_snapshots_started_at.elapsed().as_millis();

        let interrupt_marker_started_at = Instant::now();
        let interrupt_marker = runtime.state().get_interrupt_marker(&session_id).await;
        let interrupt_marker_ms = interrupt_marker_started_at.elapsed().as_millis();

        let projection_started_at = Instant::now();
        let thread_read = if normalized_history_limit.is_some() {
            let pending_requests =
                crate::commands::aster_agent_cmd::build_pending_requests(&detail);
            let last_outcome = crate::commands::aster_agent_cmd::build_last_outcome(&detail);
            let incidents =
                crate::commands::aster_agent_cmd::build_incidents(&detail, &pending_requests);
            AgentRuntimeThreadReadModel::from_parts(
                &detail,
                &queued_turns,
                pending_requests,
                last_outcome,
                incidents,
                interrupt_marker.as_ref(),
            )
        } else {
            let projection = sync_thread_reliability_projection(runtime.db(), &detail)?;
            AgentRuntimeThreadReadModel::from_parts(
                &detail,
                &queued_turns,
                projection.pending_requests,
                projection.last_outcome,
                projection.incidents,
                interrupt_marker.as_ref(),
            )
        };
        let projection_ms = projection_started_at.elapsed().as_millis();

        let dto_started_at = Instant::now();
        let loaded_messages_count = detail.messages.len();
        let messages_count =
            lime_agent::count_session_messages_sync(runtime.db(), &session_id)
                .unwrap_or(loaded_messages_count);
        let mut response = AgentRuntimeSessionDetail::from_session_detail_with_thread_read(
            detail,
            queued_turns,
            thread_read,
        );
        response.messages_count = messages_count;
        response.history_limit = normalized_history_limit;
        response.history_offset = normalized_history_limit.map(|_| normalized_history_offset);
        response.history_cursor = if let Some(limit) = normalized_history_limit {
            let conn = runtime
                .db()
                .lock()
                .map_err(|error| format!("数据库锁定失败: {error}"))?;
            let window_info = AgentDao::get_message_window_info(
                &conn,
                &session_id,
                limit,
                normalized_history_offset,
                normalized_history_before_message_id,
            )
            .map_err(|error| format!("读取历史游标失败: {error}"))?;
            Some(AgentRuntimeSessionHistoryCursor {
                oldest_message_id: window_info.oldest_message_id,
                start_index: window_info.start_index,
                loaded_count: window_info.loaded_count,
            })
        } else {
            None
        };
        response.history_truncated = response
            .history_cursor
            .as_ref()
            .map(|cursor| cursor.start_index > 0)
            .unwrap_or(false);
        let dto_ms = dto_started_at.elapsed().as_millis();

        Ok::<_, String>((
            response,
            resume_queue_ms,
            detail_ms,
            hooks_ms,
            queue_snapshots_ms,
            projection_ms,
            interrupt_marker_ms,
            dto_ms,
        ))
    }
    .await;

    match result {
        Ok((
            response,
            resume_queue_ms,
            detail_ms,
            hooks_ms,
            queue_snapshots_ms,
            projection_ms,
            interrupt_marker_ms,
            dto_ms,
        )) => {
            let total_ms = started_at.elapsed().as_millis();
            tracing::info!(
                "[AsterAgent] 获取运行时会话完成: session_id={}, total_ms={}, resume_queue_ms={}, detail_ms={}, hooks_ms={}, queue_snapshots_ms={}, projection_ms={}, interrupt_marker_ms={}, dto_ms={}, history_limit={:?}, history_offset={}, history_before_message_id={:?}, messages={}, turns={}, items={}, queued_turns={}, resume_hooks={}",
                session_id,
                total_ms,
                resume_queue_ms,
                detail_ms,
                hooks_ms,
                queue_snapshots_ms,
                projection_ms,
                interrupt_marker_ms,
                dto_ms,
                normalized_history_limit,
                normalized_history_offset,
                normalized_history_before_message_id,
                response.messages.len(),
                response.turns.len(),
                response.items.len(),
                response.queued_turns.len(),
                resume_hooks,
            );
            Ok(response)
        }
        Err(error) => {
            let total_ms = started_at.elapsed().as_millis();
            tracing::error!(
                "[AsterAgent] 获取运行时会话失败: session_id={}, total_ms={}, resume_hooks={}, history_limit={:?}, history_offset={}, history_before_message_id={:?}, error={}",
                session_id,
                total_ms,
                resume_hooks,
                normalized_history_limit,
                normalized_history_offset,
                normalized_history_before_message_id,
                error
            );
            Err(error)
        }
    }
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

    let detail = AsterAgentWrapper::get_runtime_session_detail(runtime.db(), &session_id).await?;
    let queued_turns = if detail.is_persisted_empty() {
        Vec::new()
    } else {
        list_runtime_queue_snapshots_service(&session_id).await?
    };
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

/// 统一运行时：列出当前线程的文件快照。
#[tauri::command]
pub async fn agent_runtime_list_file_checkpoints(
    app: AppHandle,
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    api_key_provider_service: State<'_, ApiKeyProviderServiceState>,
    logs: State<'_, LogState>,
    config_manager: State<'_, GlobalConfigManagerState>,
    mcp_manager: State<'_, McpManagerState>,
    automation_state: State<'_, AutomationServiceState>,
    request: AgentRuntimeListFileCheckpointsRequest,
) -> Result<AgentRuntimeFileCheckpointListResult, String> {
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
    tracing::info!("[AsterAgent] 列出文件快照: {}", request.session_id);
    let context =
        load_runtime_export_context(&runtime, &request.session_id, "列出文件快照前").await?;
    Ok(list_file_checkpoints(&context.detail))
}

/// 统一运行时：获取单个文件快照详情。
#[tauri::command]
pub async fn agent_runtime_get_file_checkpoint(
    app: AppHandle,
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    api_key_provider_service: State<'_, ApiKeyProviderServiceState>,
    logs: State<'_, LogState>,
    config_manager: State<'_, GlobalConfigManagerState>,
    mcp_manager: State<'_, McpManagerState>,
    automation_state: State<'_, AutomationServiceState>,
    request: AgentRuntimeGetFileCheckpointRequest,
) -> Result<AgentRuntimeFileCheckpointDetail, String> {
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
    tracing::info!(
        "[AsterAgent] 获取文件快照详情: session_id={}, checkpoint_id={}",
        request.session_id,
        request.checkpoint_id
    );
    let context =
        load_runtime_export_context(&runtime, &request.session_id, "获取文件快照详情前").await?;
    get_file_checkpoint(
        &context.detail,
        &context.workspace_root,
        request.checkpoint_id.as_str(),
    )
}

/// 统一运行时：获取单个文件快照 diff。
#[tauri::command]
pub async fn agent_runtime_diff_file_checkpoint(
    app: AppHandle,
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    api_key_provider_service: State<'_, ApiKeyProviderServiceState>,
    logs: State<'_, LogState>,
    config_manager: State<'_, GlobalConfigManagerState>,
    mcp_manager: State<'_, McpManagerState>,
    automation_state: State<'_, AutomationServiceState>,
    request: AgentRuntimeDiffFileCheckpointRequest,
) -> Result<AgentRuntimeFileCheckpointDiffResult, String> {
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
    tracing::info!(
        "[AsterAgent] 获取文件快照 diff: session_id={}, checkpoint_id={}",
        request.session_id,
        request.checkpoint_id
    );
    let context =
        load_runtime_export_context(&runtime, &request.session_id, "获取文件快照 diff 前").await?;
    diff_file_checkpoint(&context.detail, request.checkpoint_id.as_str())
}

struct RuntimeExportContext {
    detail: SessionDetail,
    thread_read: AgentRuntimeThreadReadModel,
    workspace_root: PathBuf,
}

async fn load_runtime_export_context(
    runtime: &RuntimeCommandContext,
    session_id: &str,
    action_label: &str,
) -> Result<RuntimeExportContext, String> {
    resume_runtime_queue_with_warning(runtime, session_id, action_label).await;

    let detail = AsterAgentWrapper::get_runtime_session_detail(runtime.db(), session_id).await?;
    let queued_turns = if detail.is_persisted_empty() {
        Vec::new()
    } else {
        list_runtime_queue_snapshots_service(session_id).await?
    };
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

    let saved = save_runtime_review_decision(
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
    )?;

    let tracker = ExecutionTracker::new(runtime.db().clone());
    if let Err(error) = SceneAppService::sync_review_decision_feedback_for_session(
        &tracker,
        &session_id,
        &saved.decision,
    ) {
        tracing::warn!(
            "[AsterAgent] 保存 review decision 后同步 SceneApp feedback 失败: session_id={}, error={}",
            session_id,
            error
        );
    }

    Ok(saved)
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
    app: AppHandle,
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    api_key_provider_service: State<'_, ApiKeyProviderServiceState>,
    config_manager: State<'_, GlobalConfigManagerState>,
    mcp_manager: State<'_, McpManagerState>,
    request: Option<AgentRuntimeToolInventoryRequest>,
) -> Result<crate::agent_tools::inventory::AgentToolInventorySnapshot, String> {
    if state.is_initialized().await {
        ensure_runtime_support_tools_registered(
            &app,
            state.inner(),
            db.inner(),
            api_key_provider_service.inner(),
            mcp_manager.inner(),
        )
        .await?;
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
            current_surface_tool_names: Vec::new(),
            extension_configs: Vec::new(),
            visible_extension_tools: Vec::new(),
            searchable_extension_tools: Vec::new(),
        }));
    };

    let registry_arc = agent.tool_registry().clone();
    let registry = registry_arc.read().await;
    let mut registry_definitions = registry.get_definitions();
    drop(registry);

    let existing_runtime_tool_names = registry_definitions
        .iter()
        .map(|definition| definition.name.clone())
        .collect::<std::collections::HashSet<_>>();
    let mut current_surface_tool_names = Vec::new();
    for definition in crate::commands::aster_agent_cmd::tool_runtime::list_current_surface_tool_definitions_from_agent(agent)
        .await
    {
        if existing_runtime_tool_names.contains(&definition.name) {
            continue;
        }

        current_surface_tool_names.push(definition.name.clone());
        registry_definitions.push(definition);
    }

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
        current_surface_tool_names,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn detail_with_turn_status(status: AgentThreadTurnStatus) -> lime_agent::SessionDetail {
        lime_agent::SessionDetail {
            id: "session-runtime-queue".to_string(),
            name: "队列快路径判定".to_string(),
            created_at: 0,
            updated_at: 0,
            thread_id: "session-runtime-queue".to_string(),
            model: Some("agent:test".to_string()),
            working_dir: None,
            workspace_id: None,
            messages: Vec::new(),
            execution_strategy: Some("react".to_string()),
            execution_runtime: None,
            turns: vec![lime_core::database::dao::agent_timeline::AgentThreadTurn {
                id: "turn-runtime-queue".to_string(),
                thread_id: "session-runtime-queue".to_string(),
                prompt_text: "测试".to_string(),
                status,
                started_at: "2026-03-18T08:00:00Z".to_string(),
                completed_at: None,
                error_message: None,
                created_at: "2026-03-18T08:00:00Z".to_string(),
                updated_at: "2026-03-18T08:00:00Z".to_string(),
            }],
            items: Vec::new(),
            todo_items: Vec::new(),
            child_subagent_sessions: Vec::new(),
            subagent_parent_context: None,
        }
    }

    #[test]
    fn normalize_runtime_session_history_limit_should_default_to_open_tail() {
        assert_eq!(
            normalize_runtime_session_history_limit(None),
            Some(RUNTIME_SESSION_OPEN_HISTORY_LIMIT)
        );
    }

    #[test]
    fn normalize_runtime_session_history_limit_should_keep_zero_as_full_history() {
        assert_eq!(normalize_runtime_session_history_limit(Some(0)), None);
    }

    #[test]
    fn normalize_runtime_session_history_limit_should_clamp_large_values() {
        assert_eq!(
            normalize_runtime_session_history_limit(Some(9_999)),
            Some(RUNTIME_SESSION_MAX_HISTORY_LIMIT)
        );
    }

    #[test]
    fn normalize_runtime_session_history_offset_should_ignore_full_history() {
        assert_eq!(normalize_runtime_session_history_offset(None, Some(120)), 0);
    }

    #[test]
    fn normalize_runtime_session_history_offset_should_keep_limited_offset() {
        assert_eq!(
            normalize_runtime_session_history_offset(Some(50), Some(40)),
            40
        );
    }

    #[test]
    fn normalize_runtime_session_history_before_message_id_should_ignore_full_history() {
        assert_eq!(
            normalize_runtime_session_history_before_message_id(None, Some(120)),
            None
        );
    }

    #[test]
    fn normalize_runtime_session_history_before_message_id_should_keep_positive_cursor() {
        assert_eq!(
            normalize_runtime_session_history_before_message_id(Some(50), Some(120)),
            Some(120)
        );
    }

    #[test]
    fn should_skip_runtime_queue_snapshots_for_completed_limited_history() {
        let detail = detail_with_turn_status(AgentThreadTurnStatus::Completed);

        assert!(!should_list_runtime_queue_snapshots(
            &detail,
            Some(80),
            0,
            None
        ));
    }

    #[test]
    fn should_list_runtime_queue_snapshots_for_running_limited_history() {
        let detail = detail_with_turn_status(AgentThreadTurnStatus::Running);

        assert!(should_list_runtime_queue_snapshots(
            &detail,
            Some(80),
            0,
            None
        ));
    }

    #[test]
    fn should_skip_runtime_queue_snapshots_for_older_history_page() {
        let detail = detail_with_turn_status(AgentThreadTurnStatus::Running);

        assert!(!should_list_runtime_queue_snapshots(
            &detail,
            Some(80),
            40,
            None
        ));
    }

    #[test]
    fn should_skip_runtime_queue_snapshots_for_cursor_history_page() {
        let detail = detail_with_turn_status(AgentThreadTurnStatus::Running);

        assert!(!should_list_runtime_queue_snapshots(
            &detail,
            Some(80),
            0,
            Some(120)
        ));
    }

    #[test]
    fn should_list_runtime_queue_snapshots_for_full_history() {
        let detail = detail_with_turn_status(AgentThreadTurnStatus::Completed);

        assert!(should_list_runtime_queue_snapshots(&detail, None, 0, None));
    }
}
