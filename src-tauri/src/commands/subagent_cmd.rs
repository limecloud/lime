//! SubAgent 调度器命令
//!
//! 提供 SubAgent 调度功能的 Tauri 命令接口

use std::sync::Arc;
use tauri::{AppHandle, State};
use tokio::sync::RwLock;

use aster::agents::context::AgentContext;
use aster::agents::subagent_scheduler::{SchedulerConfig, SchedulerExecutionResult, SubAgentTask};

use crate::agent::subagent_scheduler::{ProxyCastScheduler, SubAgentRole};
use crate::database::DbConnection;

/// SubAgent 调度器状态
pub struct SubAgentSchedulerState {
    #[allow(dead_code)]
    scheduler: Arc<RwLock<Option<ProxyCastScheduler>>>,
}

impl SubAgentSchedulerState {
    pub fn new() -> Self {
        Self {
            scheduler: Arc::new(RwLock::new(None)),
        }
    }
}

impl Default for SubAgentSchedulerState {
    fn default() -> Self {
        Self::new()
    }
}

/// 初始化 SubAgent 调度器
#[allow(dead_code)]
#[tauri::command]
pub async fn init_subagent_scheduler(
    app: AppHandle,
    db: State<'_, DbConnection>,
    state: State<'_, SubAgentSchedulerState>,
    config: Option<SchedulerConfig>,
    session_id: Option<String>,
) -> Result<(), String> {
    let mut scheduler = ProxyCastScheduler::new(db.inner().clone()).with_app_handle(app);
    if let Some(session_id) = session_id.filter(|value| !value.trim().is_empty()) {
        scheduler = scheduler.with_event_session_id(session_id);
    }

    scheduler.init(config).await;

    *state.scheduler.write().await = Some(scheduler);

    Ok(())
}

/// 执行 SubAgent 任务
#[allow(dead_code)]
#[tauri::command]
pub async fn execute_subagent_tasks(
    app: AppHandle,
    db: State<'_, DbConnection>,
    state: State<'_, SubAgentSchedulerState>,
    tasks: Vec<SubAgentTask>,
    config: Option<SchedulerConfig>,
    role: Option<SubAgentRole>,
    session_id: Option<String>,
) -> Result<SchedulerExecutionResult, String> {
    let mut scheduler = ProxyCastScheduler::new(db.inner().clone()).with_app_handle(app);
    if let Some(session_id) = session_id.filter(|value| !value.trim().is_empty()) {
        scheduler = scheduler.with_event_session_id(session_id);
    }
    scheduler.init(config.clone()).await;
    *state.scheduler.write().await = Some(scheduler);

    let scheduler_guard = state.scheduler.read().await;
    let scheduler = scheduler_guard
        .as_ref()
        .ok_or_else(|| "调度器初始化失败".to_string())?;

    // 创建父上下文
    let parent_context = AgentContext::new();

    // 根据是否指定角色选择执行方式
    match role {
        Some(role) => scheduler
            .execute_with_role(tasks, Some(&parent_context), role)
            .await
            .map_err(|e| e.to_string()),
        None => scheduler
            .execute(tasks, Some(&parent_context))
            .await
            .map_err(|e| e.to_string()),
    }
}

/// 取消 SubAgent 任务
#[allow(dead_code)]
#[tauri::command]
pub async fn cancel_subagent_tasks(state: State<'_, SubAgentSchedulerState>) -> Result<(), String> {
    let scheduler_guard = state.scheduler.read().await;

    if let Some(scheduler) = scheduler_guard.as_ref() {
        scheduler.cancel().await;
    }

    Ok(())
}
