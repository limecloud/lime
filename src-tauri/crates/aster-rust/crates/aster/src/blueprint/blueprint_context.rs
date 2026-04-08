//! 蓝图上下文管理器
//!
//! 单例模式，用于在工具执行时提供当前蓝图任务的上下文信息。
//! 这是连接蓝图系统和工具系统的桥梁。
//!
//! 使用场景：
//! 1. Queen 分配任务时，设置活跃任务上下文
//! 2. Edit/Write 工具执行时，检查是否有活跃上下文，如有则进行边界检查
//! 3. Worker 完成任务后，清除上下文

use chrono::{DateTime, Utc};
use once_cell::sync::Lazy;
use std::collections::HashMap;
use tokio::sync::RwLock;

use super::boundary_checker::{create_boundary_checker, BoundaryCheckResult, BoundaryChecker};
use super::types::Blueprint;

// ============================================================================
// 任务上下文类型
// ============================================================================

/// 活跃任务上下文
#[derive(Debug, Clone)]
pub struct ActiveTaskContext {
    /// 蓝图 ID
    pub blueprint_id: String,
    /// 任务 ID
    pub task_id: String,
    /// 任务所属模块 ID
    pub module_id: Option<String>,
    /// Worker Agent ID
    pub worker_id: String,
    /// 开始时间
    pub started_at: DateTime<Utc>,
}

/// 文件操作类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum FileOperation {
    Read,
    #[default]
    Write,
    Delete,
}

// ============================================================================
// 蓝图上下文管理器
// ============================================================================

/// 蓝图上下文管理器（内部状态）
struct BlueprintContextInner {
    /// 当前蓝图（可能没有）
    current_blueprint: Option<Blueprint>,
    /// 边界检查器（基于当前蓝图）
    boundary_checker: Option<BoundaryChecker>,
    /// 活跃任务上下文（Worker ID -> 上下文）
    active_tasks: HashMap<String, ActiveTaskContext>,
    /// 是否启用边界检查
    boundary_check_enabled: bool,
}

impl Default for BlueprintContextInner {
    fn default() -> Self {
        Self {
            current_blueprint: None,
            boundary_checker: None,
            active_tasks: HashMap::new(),
            boundary_check_enabled: true,
        }
    }
}

/// 蓝图上下文管理器
pub struct BlueprintContextManager {
    inner: RwLock<BlueprintContextInner>,
}

impl BlueprintContextManager {
    /// 创建新实例
    fn new() -> Self {
        Self {
            inner: RwLock::new(BlueprintContextInner::default()),
        }
    }

    // --------------------------------------------------------------------------
    // 蓝图管理
    // --------------------------------------------------------------------------

    /// 设置当前蓝图（启动蜂群时调用）
    pub async fn set_blueprint(&self, blueprint: Blueprint) {
        let mut inner = self.inner.write().await;
        let checker = create_boundary_checker(blueprint.clone(), None);
        inner.current_blueprint = Some(blueprint);
        inner.boundary_checker = Some(checker);
    }

    /// 清除当前蓝图（蜂群完成时调用）
    pub async fn clear_blueprint(&self) {
        let mut inner = self.inner.write().await;
        inner.current_blueprint = None;
        inner.boundary_checker = None;
        inner.active_tasks.clear();
    }

    /// 获取当前蓝图
    pub async fn get_blueprint(&self) -> Option<Blueprint> {
        let inner = self.inner.read().await;
        inner.current_blueprint.clone()
    }

    // --------------------------------------------------------------------------
    // 任务上下文管理
    // --------------------------------------------------------------------------

    /// 设置活跃任务（Worker 开始任务时调用）
    pub async fn set_active_task(&self, context: ActiveTaskContext) {
        let mut inner = self.inner.write().await;
        inner
            .active_tasks
            .insert(context.worker_id.clone(), context);
    }

    /// 获取活跃任务上下文
    pub async fn get_active_task(&self, worker_id: &str) -> Option<ActiveTaskContext> {
        let inner = self.inner.read().await;
        inner.active_tasks.get(worker_id).cloned()
    }

    /// 清除活跃任务（Worker 完成任务时调用）
    pub async fn clear_active_task(&self, worker_id: &str) {
        let mut inner = self.inner.write().await;
        inner.active_tasks.remove(worker_id);
    }

    /// 获取所有活跃任务
    pub async fn get_all_active_tasks(&self) -> Vec<ActiveTaskContext> {
        let inner = self.inner.read().await;
        inner.active_tasks.values().cloned().collect()
    }

    /// 获取当前线程的任务上下文
    /// 注意：在单线程环境中，如果只有一个活跃任务，返回它
    pub async fn get_current_task_context(&self) -> Option<ActiveTaskContext> {
        let tasks = self.get_all_active_tasks().await;
        // 如果只有一个活跃任务，返回它
        if tasks.len() == 1 {
            return tasks.into_iter().next();
        }
        // 多个任务时，返回 None（需要明确指定 workerId）
        None
    }

    // --------------------------------------------------------------------------
    // 边界检查
    // --------------------------------------------------------------------------

    /// 启用/禁用边界检查
    pub async fn set_boundary_check_enabled(&self, enabled: bool) {
        let mut inner = self.inner.write().await;
        inner.boundary_check_enabled = enabled;
    }

    /// 检查文件操作是否允许
    pub async fn check_file_operation(
        &self,
        file_path: &str,
        _operation: FileOperation,
        worker_id: Option<&str>,
    ) -> BoundaryCheckResult {
        let inner = self.inner.read().await;

        // 如果未启用边界检查，直接通过
        if !inner.boundary_check_enabled {
            return BoundaryCheckResult::allow();
        }

        // 如果没有蓝图或边界检查器，直接通过
        let checker = match &inner.boundary_checker {
            Some(c) => c,
            None => return BoundaryCheckResult::allow(),
        };

        // 如果没有活跃任务，直接通过（不在蓝图执行上下文中）
        if inner.active_tasks.is_empty() {
            return BoundaryCheckResult::allow();
        }

        // 确定任务上下文
        let context = if let Some(wid) = worker_id {
            inner.active_tasks.get(wid).cloned()
        } else if inner.active_tasks.len() == 1 {
            inner.active_tasks.values().next().cloned()
        } else {
            None
        };

        // 如果有任务上下文，使用任务边界检查
        if let Some(ctx) = context {
            if let Some(ref module_id) = ctx.module_id {
                return checker.check_task_boundary(Some(module_id.as_str()), file_path);
            }
        }

        // 否则使用通用边界检查（无任务上下文时，不限制模块）
        checker.check_task_boundary(None, file_path)
    }

    /// 检查并抛出异常（如果不允许）
    /// 用于工具层面的硬约束
    pub async fn enforce_file_operation(
        &self,
        file_path: &str,
        operation: FileOperation,
        worker_id: Option<&str>,
    ) -> Result<(), String> {
        let result = self
            .check_file_operation(file_path, operation, worker_id)
            .await;
        if !result.allowed {
            Err(format!(
                "[蓝图边界检查] {}",
                result.reason.unwrap_or_default()
            ))
        } else {
            Ok(())
        }
    }

    // --------------------------------------------------------------------------
    // 调试和状态
    // --------------------------------------------------------------------------

    /// 获取当前状态（调试用）
    pub async fn get_status(&self) -> BlueprintContextStatus {
        let inner = self.inner.read().await;
        BlueprintContextStatus {
            has_blueprint: inner.current_blueprint.is_some(),
            blueprint_id: inner.current_blueprint.as_ref().map(|b| b.id.clone()),
            boundary_check_enabled: inner.boundary_check_enabled,
            active_task_count: inner.active_tasks.len(),
            active_tasks: inner.active_tasks.values().cloned().collect(),
        }
    }
}

/// 蓝图上下文状态
#[derive(Debug, Clone)]
pub struct BlueprintContextStatus {
    pub has_blueprint: bool,
    pub blueprint_id: Option<String>,
    pub boundary_check_enabled: bool,
    pub active_task_count: usize,
    pub active_tasks: Vec<ActiveTaskContext>,
}

// ============================================================================
// 全局单例
// ============================================================================

/// 全局蓝图上下文单例
static BLUEPRINT_CONTEXT: Lazy<BlueprintContextManager> = Lazy::new(BlueprintContextManager::new);

/// 获取全局蓝图上下文
pub fn get_blueprint_context() -> &'static BlueprintContextManager {
    &BLUEPRINT_CONTEXT
}

// ============================================================================
// 便捷函数导出
// ============================================================================

/// 设置当前蓝图
pub async fn set_blueprint(blueprint: Blueprint) {
    get_blueprint_context().set_blueprint(blueprint).await;
}

/// 清除当前蓝图
pub async fn clear_blueprint() {
    get_blueprint_context().clear_blueprint().await;
}

/// 设置活跃任务
pub async fn set_active_task(context: ActiveTaskContext) {
    get_blueprint_context().set_active_task(context).await;
}

/// 清除活跃任务
pub async fn clear_active_task(worker_id: &str) {
    get_blueprint_context().clear_active_task(worker_id).await;
}

/// 检查文件操作
pub async fn check_file_operation(
    file_path: &str,
    operation: FileOperation,
    worker_id: Option<&str>,
) -> BoundaryCheckResult {
    get_blueprint_context()
        .check_file_operation(file_path, operation, worker_id)
        .await
}

/// 强制检查文件操作（失败时返回错误）
pub async fn enforce_file_operation(
    file_path: &str,
    operation: FileOperation,
    worker_id: Option<&str>,
) -> Result<(), String> {
    get_blueprint_context()
        .enforce_file_operation(file_path, operation, worker_id)
        .await
}
