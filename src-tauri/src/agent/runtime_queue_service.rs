//! Agent runtime queue 共享服务边界。
//!
//! 命令层只保留 Tauri 状态装配；
//! queue 的纯调度与数据事实源统一委托给 `lime-agent`。

use super::aster_state::AsterAgentState;
use crate::commands::api_key_provider_cmd::ApiKeyProviderServiceState;
use crate::config::GlobalConfigManagerState;
use crate::database::DbConnection;
use crate::mcp::McpManagerState;
use crate::services::automation_service::AutomationServiceState;
use crate::LogState;
use aster::session::QueuedTurnRuntime;
use lime_agent::{
    clear_runtime_queue as clear_runtime_queue_impl,
    list_runtime_queue_snapshots as list_runtime_queue_snapshots_impl,
    promote_runtime_queued_turn as promote_runtime_queued_turn_impl,
    remove_runtime_queued_turn as remove_runtime_queued_turn_impl,
    resume_persisted_runtime_queues_on_startup as resume_persisted_runtime_queues_on_startup_impl,
    resume_runtime_queue_if_needed as resume_runtime_queue_if_needed_impl,
    submit_runtime_turn as submit_runtime_turn_impl, AgentEvent as RuntimeAgentEvent,
    QueuedTurnSnapshot, QueuedTurnTask, RuntimeQueueEventEmitter,
    RuntimeQueueExecutor as SharedRuntimeQueueExecutor,
};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

pub(crate) type RuntimeQueueExecutor = SharedRuntimeQueueExecutor<AgentRuntimeQueueContext>;

pub(crate) struct AgentRuntimeQueueContext {
    pub(crate) app: AppHandle,
    pub(crate) state: AsterAgentState,
    pub(crate) db: DbConnection,
    pub(crate) api_key_provider_service: ApiKeyProviderServiceState,
    pub(crate) logs: LogState,
    pub(crate) config_manager: GlobalConfigManagerState,
    pub(crate) mcp_manager: McpManagerState,
    pub(crate) automation_state: AutomationServiceState,
}

impl Clone for AgentRuntimeQueueContext {
    fn clone(&self) -> Self {
        Self {
            app: self.app.clone(),
            state: self.state.clone(),
            db: self.db.clone(),
            api_key_provider_service: ApiKeyProviderServiceState(
                self.api_key_provider_service.0.clone(),
            ),
            logs: self.logs.clone(),
            config_manager: GlobalConfigManagerState(self.config_manager.0.clone()),
            mcp_manager: self.mcp_manager.clone(),
            automation_state: self.automation_state.clone(),
        }
    }
}

fn build_runtime_queue_context(
    app: AppHandle,
    state: &AsterAgentState,
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderServiceState,
    logs: &LogState,
    config_manager: &GlobalConfigManagerState,
    mcp_manager: &McpManagerState,
    automation_state: &AutomationServiceState,
) -> AgentRuntimeQueueContext {
    AgentRuntimeQueueContext {
        app,
        state: state.clone(),
        db: db.clone(),
        api_key_provider_service: ApiKeyProviderServiceState(api_key_provider_service.0.clone()),
        logs: logs.clone(),
        config_manager: GlobalConfigManagerState(config_manager.0.clone()),
        mcp_manager: mcp_manager.clone(),
        automation_state: automation_state.clone(),
    }
}

fn build_runtime_queue_event_emitter(app: &AppHandle) -> RuntimeQueueEventEmitter {
    let app = app.clone();
    std::sync::Arc::new(move |event_name: String, event: RuntimeAgentEvent| {
        if let Err(error) = app.emit(&event_name, &event) {
            tracing::warn!(
                "[AsterAgent][Queue] 发送队列事件失败: event_name={}, error={}",
                event_name,
                error
            );
        }
    })
}

pub(crate) async fn resume_runtime_queue_if_needed(
    app: AppHandle,
    state: &AsterAgentState,
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderServiceState,
    logs: &LogState,
    config_manager: &GlobalConfigManagerState,
    mcp_manager: &McpManagerState,
    automation_state: &AutomationServiceState,
    session_id: String,
    executor: RuntimeQueueExecutor,
) -> Result<bool, String> {
    let context = build_runtime_queue_context(
        app,
        state,
        db,
        api_key_provider_service,
        logs,
        config_manager,
        mcp_manager,
        automation_state,
    );
    resume_runtime_queue_if_needed_impl(
        session_id,
        context.clone(),
        executor,
        build_runtime_queue_event_emitter(&context.app),
    )
    .await
}

pub(crate) async fn submit_runtime_turn(
    app: AppHandle,
    state: &AsterAgentState,
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderServiceState,
    logs: &LogState,
    config_manager: &GlobalConfigManagerState,
    mcp_manager: &McpManagerState,
    automation_state: &AutomationServiceState,
    queued_task: QueuedTurnTask<Value>,
    queue_if_busy: bool,
    skip_pre_submit_resume: bool,
    executor: RuntimeQueueExecutor,
) -> Result<(), String> {
    let context = build_runtime_queue_context(
        app,
        state,
        db,
        api_key_provider_service,
        logs,
        config_manager,
        mcp_manager,
        automation_state,
    );
    submit_runtime_turn_impl(
        queued_task,
        queue_if_busy,
        skip_pre_submit_resume,
        context.clone(),
        executor,
        build_runtime_queue_event_emitter(&context.app),
    )
    .await
}

pub(crate) async fn clear_runtime_queue(
    app: &AppHandle,
    session_id: &str,
) -> Result<Vec<QueuedTurnRuntime>, String> {
    clear_runtime_queue_impl(session_id, build_runtime_queue_event_emitter(app)).await
}

pub(crate) async fn list_runtime_queue_snapshots(
    session_id: &str,
) -> Result<Vec<QueuedTurnSnapshot>, String> {
    list_runtime_queue_snapshots_impl(session_id).await
}

pub(crate) async fn remove_runtime_queued_turn(
    app: &AppHandle,
    session_id: &str,
    queued_turn_id: &str,
) -> Result<bool, String> {
    remove_runtime_queued_turn_impl(
        session_id,
        queued_turn_id,
        build_runtime_queue_event_emitter(app),
    )
    .await
}

pub(crate) async fn promote_runtime_queued_turn(
    session_id: &str,
    queued_turn_id: &str,
) -> Result<bool, String> {
    promote_runtime_queued_turn_impl(session_id, queued_turn_id).await
}

pub(crate) async fn resume_persisted_runtime_queues_on_startup(
    app: AppHandle,
    state: &AsterAgentState,
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderServiceState,
    logs: &LogState,
    config_manager: &GlobalConfigManagerState,
    mcp_manager: &McpManagerState,
    automation_state: &AutomationServiceState,
    executor: RuntimeQueueExecutor,
) -> Result<usize, String> {
    let context = build_runtime_queue_context(
        app.clone(),
        state,
        db,
        api_key_provider_service,
        logs,
        config_manager,
        mcp_manager,
        automation_state,
    );

    resume_persisted_runtime_queues_on_startup_impl(
        context,
        executor,
        build_runtime_queue_event_emitter(&app),
    )
    .await
}
