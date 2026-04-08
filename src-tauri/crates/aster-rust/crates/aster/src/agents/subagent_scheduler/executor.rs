//! SubAgent 调度执行器
//!
//! 核心调度逻辑，整合上下文管理、并行执行、结果聚合

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use tokio::sync::{Mutex, RwLock};
use tokio::task::JoinSet;
use tokio::time::timeout;
use tracing::{info, warn};

use crate::agents::context::{AgentContext, AgentContextManager, ContextIsolation};
use crate::agents::parallel::{
    create_dependency_graph, validate_task_dependencies, DependencyGraph,
};

use super::config::SchedulerConfig;
use super::strategy::{SchedulingStrategy, StrategySelector};
use super::summary::{calculate_total_token_usage, SummaryGenerator};

use super::types::*;

/// SubAgent 任务执行器 trait
///
/// 由应用层实现具体的任务执行逻辑
#[async_trait::async_trait]
pub trait SubAgentExecutor: Send + Sync {
    /// 执行单个 SubAgent 任务
    async fn execute_task(
        &self,
        task: &SubAgentTask,
        context: &AgentContext,
    ) -> SchedulerResult<SubAgentResult>;
}

/// SubAgent 调度器
pub struct SubAgentScheduler<E: SubAgentExecutor> {
    /// 配置
    config: SchedulerConfig,
    /// 任务执行器
    executor: Arc<E>,
    /// 上下文管理器
    context_manager: Arc<RwLock<AgentContextManager>>,
    /// 上下文隔离管理器
    context_isolation: Arc<RwLock<ContextIsolation>>,
    /// 任务执行信息
    tasks: Arc<Mutex<HashMap<String, TaskExecutionInfo>>>,
    /// 是否正在运行
    running: Arc<Mutex<bool>>,
    /// 是否已取消
    cancelled: Arc<Mutex<bool>>,
    /// 事件回调
    event_callback: Option<Arc<dyn Fn(SchedulerEvent) + Send + Sync>>,
}

impl<E: SubAgentExecutor + 'static> SubAgentScheduler<E> {
    /// 创建新的调度器
    pub fn new(config: SchedulerConfig, executor: E) -> Self {
        Self {
            config,
            executor: Arc::new(executor),
            context_manager: Arc::new(RwLock::new(AgentContextManager::new())),
            context_isolation: Arc::new(RwLock::new(ContextIsolation::new())),
            tasks: Arc::new(Mutex::new(HashMap::new())),
            running: Arc::new(Mutex::new(false)),
            cancelled: Arc::new(Mutex::new(false)),
            event_callback: None,
        }
    }

    /// 设置事件回调
    pub fn with_event_callback<F>(mut self, callback: F) -> Self
    where
        F: Fn(SchedulerEvent) + Send + Sync + 'static,
    {
        self.event_callback = Some(Arc::new(callback));
        self
    }

    /// 获取配置
    pub fn config(&self) -> &SchedulerConfig {
        &self.config
    }

    /// 执行任务（自动选择策略）
    pub async fn execute(
        &self,
        tasks: Vec<SubAgentTask>,
        parent_context: Option<&AgentContext>,
    ) -> SchedulerResult<SchedulerExecutionResult> {
        let strategy = StrategySelector::select(&tasks);
        self.execute_with_strategy(tasks, parent_context, strategy)
            .await
    }

    /// 使用指定策略执行任务
    pub async fn execute_with_strategy(
        &self,
        tasks: Vec<SubAgentTask>,
        parent_context: Option<&AgentContext>,
        strategy: SchedulingStrategy,
    ) -> SchedulerResult<SchedulerExecutionResult> {
        info!("开始执行 {} 个任务，策略: {:?}", tasks.len(), strategy);

        let queue_limit = self.config.max_queue_size.max(1);
        if tasks.len() > queue_limit {
            self.emit_event(SchedulerEvent::QueueRejected {
                requested: tasks.len(),
                limit: queue_limit,
            });
            return Err(SchedulerError::QueueFull {
                requested: tasks.len(),
                limit: queue_limit,
            });
        }

        // 验证依赖
        let validation = validate_task_dependencies(
            &tasks
                .iter()
                .map(|t| self.to_agent_task(t))
                .collect::<Vec<_>>(),
        );
        if !validation.valid {
            if let Some(cycle) = validation.circular_dependencies {
                return Err(SchedulerError::CircularDependency(cycle));
            }
            if let Some((task_id, dep)) = validation.missing_dependencies.first() {
                return Err(SchedulerError::InvalidDependency {
                    task_id: task_id.clone(),
                    dependency: dep.clone(),
                });
            }
        }

        let start_time = Utc::now();

        // 初始化任务跟踪
        {
            let mut task_map = self.tasks.lock().await;
            task_map.clear();
            for task in &tasks {
                task_map.insert(task.id.clone(), TaskExecutionInfo::new(task.clone()));
            }
        }

        // 设置运行状态
        {
            *self.running.lock().await = true;
            *self.cancelled.lock().await = false;
        }

        // 发送开始事件
        self.emit_event(SchedulerEvent::Started {
            total_tasks: tasks.len(),
        });

        // 根据策略执行
        let result = match strategy {
            SchedulingStrategy::SingleAgent => self.execute_single(tasks, parent_context).await,
            SchedulingStrategy::Sequential => self.execute_sequential(tasks, parent_context).await,
            SchedulingStrategy::Parallel | SchedulingStrategy::BreadthFirst => {
                self.execute_parallel(tasks, parent_context).await
            }
            SchedulingStrategy::Adaptive => {
                // 自适应策略：选择最优策略后直接执行（避免递归）
                let auto_strategy = StrategySelector::select(&tasks);
                match auto_strategy {
                    SchedulingStrategy::SingleAgent => {
                        self.execute_single(tasks, parent_context).await
                    }
                    SchedulingStrategy::Sequential => {
                        self.execute_sequential(tasks, parent_context).await
                    }
                    _ => self.execute_parallel(tasks, parent_context).await,
                }
            }
        };

        // 设置运行状态
        *self.running.lock().await = false;

        // 计算总时长
        let end_time = Utc::now();
        let duration = (end_time - start_time).to_std().unwrap_or(Duration::ZERO);

        // 发送完成事件
        self.emit_event(SchedulerEvent::Completed {
            success: result.as_ref().map(|r| r.success).unwrap_or(false),
            duration_ms: duration.as_millis() as u64,
        });

        result
    }

    /// 单任务执行
    async fn execute_single(
        &self,
        tasks: Vec<SubAgentTask>,
        parent_context: Option<&AgentContext>,
    ) -> SchedulerResult<SchedulerExecutionResult> {
        let mut results = Vec::new();

        for task in tasks {
            let result = self
                .execute_task_with_context(&task, parent_context)
                .await?;
            results.push(result);
        }

        self.build_execution_result(results).await
    }

    /// 串行执行
    async fn execute_sequential(
        &self,
        tasks: Vec<SubAgentTask>,
        parent_context: Option<&AgentContext>,
    ) -> SchedulerResult<SchedulerExecutionResult> {
        let mut results = Vec::new();
        let mut completed_results: HashMap<String, SubAgentResult> = HashMap::new();

        // 按优先级排序
        let mut sorted_tasks = tasks;
        sorted_tasks.sort_by_key(|t| std::cmp::Reverse(t.effective_priority()));

        // 创建依赖图
        let graph = create_dependency_graph(
            &sorted_tasks
                .iter()
                .map(|t| self.to_agent_task(t))
                .collect::<Vec<_>>(),
        );

        // 按依赖顺序执行
        let mut pending: VecDeque<SubAgentTask> = sorted_tasks.into_iter().collect();
        let mut completed_ids: HashSet<String> = HashSet::new();

        while !pending.is_empty() {
            // 检查取消
            if *self.cancelled.lock().await {
                return Err(SchedulerError::Cancelled);
            }

            // 找到可执行的任务
            let ready_idx = pending
                .iter()
                .position(|t| !graph.has_unmet_dependencies(&t.id, &completed_ids));

            let task = match ready_idx {
                Some(idx) => pending.remove(idx).unwrap(),
                None => {
                    // 没有可执行的任务，可能有循环依赖
                    warn!("没有可执行的任务，可能存在未检测到的依赖问题");
                    break;
                }
            };

            // 检查依赖是否失败
            if self.config.stop_on_first_error {
                let deps = task.get_dependencies();
                let has_failed_dep = deps.iter().any(|d| {
                    completed_results
                        .get(d)
                        .map(|r| !r.success)
                        .unwrap_or(false)
                });

                if has_failed_dep {
                    // 跳过此任务
                    self.update_task_status(&task.id, SubAgentTaskStatus::Skipped)
                        .await;
                    self.emit_event(SchedulerEvent::TaskSkipped {
                        task_id: task.id.clone(),
                        reason: "依赖任务失败".to_string(),
                    });
                    continue;
                }
            }

            // 执行任务
            let result = self.execute_task_with_context(&task, parent_context).await;

            match result {
                Ok(r) => {
                    completed_ids.insert(task.id.clone());
                    completed_results.insert(task.id.clone(), r.clone());
                    results.push(r);
                }
                Err(e) => {
                    if self.config.stop_on_first_error {
                        return Err(e);
                    }
                    // 记录失败但继续
                    completed_ids.insert(task.id.clone());
                }
            }
        }

        self.build_execution_result(results).await
    }

    /// 并行执行
    async fn execute_parallel(
        &self,
        tasks: Vec<SubAgentTask>,
        parent_context: Option<&AgentContext>,
    ) -> SchedulerResult<SchedulerExecutionResult> {
        let results = Arc::new(Mutex::new(Vec::new()));
        let completed = Arc::new(Mutex::new(HashSet::<String>::new()));
        let failed = Arc::new(Mutex::new(HashSet::<String>::new()));

        // 按优先级排序
        let mut sorted_tasks = tasks;
        sorted_tasks.sort_by_key(|t| std::cmp::Reverse(t.effective_priority()));

        // 创建依赖图
        let graph = create_dependency_graph(
            &sorted_tasks
                .iter()
                .map(|t| self.to_agent_task(t))
                .collect::<Vec<_>>(),
        );

        let pending: Arc<Mutex<VecDeque<SubAgentTask>>> =
            Arc::new(Mutex::new(sorted_tasks.into_iter().collect()));
        let running: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));
        let max_concurrency = self.config.max_concurrency.max(1);
        let mut join_set = JoinSet::new();

        loop {
            // 检查取消
            if *self.cancelled.lock().await {
                join_set.abort_all();
                return Err(SchedulerError::Cancelled);
            }

            let running_count = running.lock().await.len();
            let available_slots = max_concurrency.saturating_sub(running_count);

            if available_slots > 0 {
                let ready_tasks = self
                    .get_ready_tasks(
                        &pending,
                        &completed,
                        &running,
                        &failed,
                        &graph,
                        available_slots,
                    )
                    .await;

                for task in ready_tasks {
                    // 标记为运行中
                    running.lock().await.insert(task.id.clone());
                    self.update_task_status(&task.id, SubAgentTaskStatus::Running)
                        .await;

                    let executor = self.clone_for_task();
                    let parent_ctx = parent_context.cloned();
                    let results = results.clone();
                    let completed = completed.clone();
                    let failed = failed.clone();
                    let running = running.clone();

                    join_set.spawn(async move {
                        let task_id = task.id.clone();
                        let result = executor
                            .execute_task_with_context(&task, parent_ctx.as_ref())
                            .await;

                        match &result {
                            Ok(r) => {
                                completed.lock().await.insert(task_id.clone());
                                results.lock().await.push(r.clone());
                            }
                            Err(_) => {
                                failed.lock().await.insert(task_id.clone());
                            }
                        }

                        running.lock().await.remove(&task_id);
                        result
                    });
                }
            }

            // 检查是否完成
            {
                let pending_guard = pending.lock().await;
                let running_guard = running.lock().await;

                if pending_guard.is_empty() && running_guard.is_empty() && join_set.is_empty() {
                    break;
                }

                if join_set.is_empty() && running_guard.is_empty() && !pending_guard.is_empty() {
                    warn!("并行调度没有可运行任务，提前结束剩余任务");
                    break;
                }
            }

            // 等待至少一个任务完成，然后继续补位
            if let Some(join_result) = join_set.join_next().await {
                if let Err(err) = join_result {
                    warn!("并行任务 Join 失败: {}", err);
                }
            } else {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }

            // 更新进度
            self.emit_progress().await;
        }

        let final_results = results.lock().await.clone();
        self.build_execution_result(final_results).await
    }

    /// 执行单个任务（带上下文）
    async fn execute_task_with_context(
        &self,
        task: &SubAgentTask,
        parent_context: Option<&AgentContext>,
    ) -> SchedulerResult<SubAgentResult> {
        let task_id = task.id.clone();
        info!("开始执行任务: {}", task_id);

        self.emit_event(SchedulerEvent::TaskStarted {
            task_id: task_id.clone(),
            task_type: task.task_type.clone(),
        });

        // 创建子上下文
        let child_context = self.create_child_context(parent_context, task).await?;

        // 更新任务状态为 Running
        {
            let mut tasks = self.tasks.lock().await;
            if let Some(info) = tasks.get_mut(&task_id) {
                info.status = SubAgentTaskStatus::Running;
                info.started_at = Some(Utc::now());
                info.context_id = Some(child_context.context_id.clone());
            }
        }

        // 执行任务（带重试）
        let effective_timeout = task.timeout.unwrap_or(self.config.default_timeout);
        let (result, retries) = self
            .execute_with_retry(task, &child_context, effective_timeout)
            .await;

        // 更新最终状态并发送事件
        self.finalize_task(&task_id, &result, retries, effective_timeout)
            .await;

        result
    }

    /// 执行任务并在失败时重试
    async fn execute_with_retry(
        &self,
        task: &SubAgentTask,
        context: &AgentContext,
        effective_timeout: Duration,
    ) -> (SchedulerResult<SubAgentResult>, usize) {
        let task_id = &task.id;
        let max_retries = if self.config.retry_on_failure {
            self.config.max_retries
        } else {
            0
        };
        let mut retries = 0;

        let result = loop {
            if *self.cancelled.lock().await {
                break Err(SchedulerError::Cancelled);
            }

            let exec_result =
                timeout(effective_timeout, self.executor.execute_task(task, context)).await;

            match exec_result {
                Ok(Ok(r)) => break Ok(r),
                Ok(Err(e)) => {
                    if retries < max_retries {
                        retries += 1;
                        warn!(
                            "任务 {} 失败，重试 {}/{}: {:?}",
                            task_id, retries, max_retries, e
                        );
                        self.emit_event(SchedulerEvent::TaskRetry {
                            task_id: task_id.clone(),
                            retry_count: retries,
                        });
                        tokio::time::sleep(self.config.retry_delay).await;
                    } else {
                        break Err(e);
                    }
                }
                Err(_) => {
                    let timeout_error = SchedulerError::TaskTimeout(task_id.clone());
                    if retries < max_retries {
                        retries += 1;
                        warn!(
                            "任务 {} 超时，重试 {}/{} (timeout={}ms)",
                            task_id,
                            retries,
                            max_retries,
                            effective_timeout.as_millis()
                        );
                        self.emit_event(SchedulerEvent::TaskRetry {
                            task_id: task_id.clone(),
                            retry_count: retries,
                        });
                        tokio::time::sleep(self.config.retry_delay).await;
                    } else {
                        break Err(timeout_error);
                    }
                }
            }
        };

        (result, retries)
    }

    /// 更新任务最终状态并发送完成事件
    async fn finalize_task(
        &self,
        task_id: &str,
        result: &SchedulerResult<SubAgentResult>,
        retries: usize,
        effective_timeout: Duration,
    ) {
        {
            let mut tasks = self.tasks.lock().await;
            if let Some(info) = tasks.get_mut(task_id) {
                info.completed_at = Some(Utc::now());
                info.retries = retries;
                match result {
                    Ok(r) => {
                        info.status = SubAgentTaskStatus::Completed;
                        info.result = Some(r.clone());
                    }
                    Err(e) => {
                        info.status = if matches!(e, SchedulerError::Cancelled) {
                            SubAgentTaskStatus::Cancelled
                        } else {
                            SubAgentTaskStatus::Failed
                        };
                        info.last_error = Some(e.to_string());
                    }
                }
            }
        }

        match result {
            Ok(r) => {
                self.emit_event(SchedulerEvent::TaskCompleted {
                    task_id: task_id.to_string(),
                    duration_ms: r.duration.as_millis() as u64,
                });
            }
            Err(SchedulerError::TaskTimeout(_)) => {
                self.emit_event(SchedulerEvent::TaskTimedOut {
                    task_id: task_id.to_string(),
                    timeout_ms: effective_timeout.as_millis() as u64,
                });
            }
            Err(SchedulerError::Cancelled) => {}
            Err(e) => {
                self.emit_event(SchedulerEvent::TaskFailed {
                    task_id: task_id.to_string(),
                    error: e.to_string(),
                });
            }
        }
    }

    /// 创建子上下文
    async fn create_child_context(
        &self,
        parent: Option<&AgentContext>,
        task: &SubAgentTask,
    ) -> SchedulerResult<AgentContext> {
        let mut manager = self.context_manager.write().await;

        // 配置继承
        let mut inheritance_config = self.config.context_inheritance.clone();

        // 根据任务配置调整
        if let Some(max_tokens) = task.max_tokens {
            inheritance_config.target_tokens = Some(max_tokens);
            inheritance_config.compress_context = true;
        }

        // 创建上下文
        let context = manager.create_context(parent, Some(inheritance_config));

        // 如果有工具限制，创建沙箱
        if task.allowed_tools.is_some() || task.denied_tools.is_some() {
            let mut isolation = self.context_isolation.write().await;
            let restrictions = crate::agents::context::SandboxRestrictions {
                max_tokens: task.max_tokens.unwrap_or(100000),
                max_files: 50,
                max_tool_results: 100,
                allowed_tools: task
                    .allowed_tools
                    .as_ref()
                    .map(|v| v.iter().cloned().collect()),
                denied_tools: task
                    .denied_tools
                    .as_ref()
                    .map(|v| v.iter().cloned().collect()),
            };
            isolation.create_sandbox(context.clone(), Some(task.id.clone()), Some(restrictions));
        }

        Ok(context)
    }

    /// 获取可执行的任务
    async fn get_ready_tasks(
        &self,
        pending: &Arc<Mutex<VecDeque<SubAgentTask>>>,
        completed: &Arc<Mutex<HashSet<String>>>,
        running: &Arc<Mutex<HashSet<String>>>,
        failed: &Arc<Mutex<HashSet<String>>>,
        graph: &DependencyGraph,
        max_tasks: usize,
    ) -> Vec<SubAgentTask> {
        let completed_guard = completed.lock().await;
        let running_guard = running.lock().await;
        let failed_guard = failed.lock().await;
        let mut pending_guard = pending.lock().await;

        let mut ready = Vec::new();
        let mut still_pending = VecDeque::new();

        while let Some(task) = pending_guard.pop_front() {
            if !graph.has_unmet_dependencies(&task.id, &completed_guard)
                && !running_guard.contains(&task.id)
            {
                // 检查依赖是否失败
                let deps = task.get_dependencies();
                let has_failed_dep = deps.iter().any(|d| failed_guard.contains(d));

                if has_failed_dep && self.config.stop_on_first_error {
                    self.update_task_status(&task.id, SubAgentTaskStatus::Skipped)
                        .await;
                    self.emit_event(SchedulerEvent::TaskSkipped {
                        task_id: task.id.clone(),
                        reason: "依赖任务失败".to_string(),
                    });
                    continue;
                }

                if ready.len() < max_tasks {
                    ready.push(task);
                } else {
                    still_pending.push_back(task);
                }
            } else {
                still_pending.push_back(task);
            }
        }

        *pending_guard = still_pending;
        ready
    }

    /// 构建执行结果
    async fn build_execution_result(
        &self,
        results: Vec<SubAgentResult>,
    ) -> SchedulerResult<SchedulerExecutionResult> {
        let successful_count = results.iter().filter(|r| r.success).count();
        let (failed_count, skipped_count) = {
            let tasks = self.tasks.lock().await;
            let failed = tasks
                .values()
                .filter(|t| {
                    matches!(
                        t.status,
                        SubAgentTaskStatus::Failed | SubAgentTaskStatus::Cancelled
                    )
                })
                .count();
            let skipped = tasks
                .values()
                .filter(|t| t.status == SubAgentTaskStatus::Skipped)
                .count();
            (failed, skipped)
        };

        let total_duration: Duration = results.iter().map(|r| r.duration).sum();

        // 生成合并摘要
        let merged_summary = if self.config.auto_summarize {
            let generator = SummaryGenerator::new(self.config.summary_max_tokens);
            Some(generator.merge_summaries(&results))
        } else {
            None
        };

        let total_token_usage = calculate_total_token_usage(&results);

        Ok(SchedulerExecutionResult {
            success: failed_count == 0 && skipped_count == 0,
            results,
            total_duration,
            successful_count,
            failed_count,
            skipped_count,
            merged_summary,
            total_token_usage,
        })
    }

    /// 转换为 AgentTask（用于依赖图）
    fn to_agent_task(&self, task: &SubAgentTask) -> crate::agents::parallel::AgentTask {
        crate::agents::parallel::AgentTask::new(&task.id, &task.task_type, &task.prompt)
            .with_dependencies(task.get_dependencies())
            .with_priority(task.effective_priority())
    }

    /// 更新任务状态
    async fn update_task_status(&self, task_id: &str, status: SubAgentTaskStatus) {
        let mut tasks = self.tasks.lock().await;
        if let Some(info) = tasks.get_mut(task_id) {
            info.status = status;
        }
    }

    /// 发送事件
    fn emit_event(&self, event: SchedulerEvent) {
        if let Some(callback) = &self.event_callback {
            callback(event);
        }
    }

    /// 发送进度事件
    async fn emit_progress(&self) {
        let progress = self.get_progress().await;
        self.emit_event(SchedulerEvent::Progress(progress));
    }

    /// 获取当前进度
    pub async fn get_progress(&self) -> SchedulerProgress {
        let tasks = self.tasks.lock().await;
        let cancelled = *self.cancelled.lock().await;

        let mut progress = SchedulerProgress {
            total: tasks.len(),
            cancelled,
            ..Default::default()
        };

        for (task_id, info) in tasks.iter() {
            match info.status {
                SubAgentTaskStatus::Pending => progress.pending += 1,
                SubAgentTaskStatus::WaitingForDependencies => progress.pending += 1,
                SubAgentTaskStatus::Running => {
                    progress.running += 1;
                    progress.current_tasks.push(task_id.clone());
                }
                SubAgentTaskStatus::Completed => progress.completed += 1,
                SubAgentTaskStatus::Failed => progress.failed += 1,
                SubAgentTaskStatus::Cancelled => progress.failed += 1,
                SubAgentTaskStatus::Skipped => progress.skipped += 1,
            }
        }

        let finished = progress.completed + progress.failed + progress.skipped;
        progress.percentage = if progress.total > 0 {
            (finished as f64 / progress.total as f64) * 100.0
        } else {
            0.0
        };

        progress
    }

    /// 取消执行
    pub async fn cancel(&self) {
        *self.cancelled.lock().await = true;
        self.emit_event(SchedulerEvent::Cancelled);
    }

    /// 克隆用于任务执行
    fn clone_for_task(&self) -> Self {
        Self {
            config: self.config.clone(),
            executor: self.executor.clone(),
            context_manager: self.context_manager.clone(),
            context_isolation: self.context_isolation.clone(),
            tasks: self.tasks.clone(),
            running: self.running.clone(),
            cancelled: self.cancelled.clone(),
            event_callback: self.event_callback.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Instant;

    /// 测试用执行器
    struct MockExecutor {
        call_count: AtomicUsize,
    }

    impl MockExecutor {
        fn new() -> Self {
            Self {
                call_count: AtomicUsize::new(0),
            }
        }
    }

    struct VariableDelayExecutor {
        delays_ms: HashMap<String, u64>,
    }

    #[async_trait::async_trait]
    impl SubAgentExecutor for VariableDelayExecutor {
        async fn execute_task(
            &self,
            task: &SubAgentTask,
            _context: &AgentContext,
        ) -> SchedulerResult<SubAgentResult> {
            let delay_ms = *self.delays_ms.get(&task.id).unwrap_or(&10);
            tokio::time::sleep(Duration::from_millis(delay_ms)).await;

            Ok(SubAgentResult {
                task_id: task.id.clone(),
                success: true,
                output: Some(format!("任务 {} 完成", task.id)),
                summary: Some(format!("摘要: {}", task.id)),
                error: None,
                duration: Duration::from_millis(delay_ms),
                retries: 0,
                started_at: Utc::now(),
                completed_at: Utc::now(),
                token_usage: None,
                metadata: HashMap::new(),
            })
        }
    }

    struct SleepExecutor {
        delay_ms: u64,
    }

    #[async_trait::async_trait]
    impl SubAgentExecutor for SleepExecutor {
        async fn execute_task(
            &self,
            task: &SubAgentTask,
            _context: &AgentContext,
        ) -> SchedulerResult<SubAgentResult> {
            tokio::time::sleep(Duration::from_millis(self.delay_ms)).await;

            Ok(SubAgentResult {
                task_id: task.id.clone(),
                success: true,
                output: Some(format!("任务 {} 完成", task.id)),
                summary: Some(format!("摘要: {}", task.id)),
                error: None,
                duration: Duration::from_millis(self.delay_ms),
                retries: 0,
                started_at: Utc::now(),
                completed_at: Utc::now(),
                token_usage: None,
                metadata: HashMap::new(),
            })
        }
    }

    #[async_trait::async_trait]
    impl SubAgentExecutor for MockExecutor {
        async fn execute_task(
            &self,
            task: &SubAgentTask,
            _context: &AgentContext,
        ) -> SchedulerResult<SubAgentResult> {
            self.call_count.fetch_add(1, Ordering::SeqCst);

            // 模拟执行时间
            tokio::time::sleep(Duration::from_millis(10)).await;

            Ok(SubAgentResult {
                task_id: task.id.clone(),
                success: true,
                output: Some(format!("任务 {} 完成", task.id)),
                summary: Some(format!("摘要: {}", task.id)),
                error: None,
                duration: Duration::from_millis(10),
                retries: 0,
                started_at: Utc::now(),
                completed_at: Utc::now(),
                token_usage: None,
                metadata: HashMap::new(),
            })
        }
    }

    #[tokio::test]
    async fn test_execute_single_task() {
        let executor = MockExecutor::new();
        let scheduler = SubAgentScheduler::new(SchedulerConfig::default(), executor);

        let tasks = vec![SubAgentTask::new("task-1", "test", "测试任务")];
        let result = scheduler.execute(tasks, None).await.unwrap();

        assert!(result.success);
        assert_eq!(result.successful_count, 1);
    }

    #[tokio::test]
    async fn test_execute_parallel_tasks() {
        let executor = MockExecutor::new();
        let scheduler = SubAgentScheduler::new(SchedulerConfig::default(), executor);

        let tasks = vec![
            SubAgentTask::new("task-1", "test", "任务1"),
            SubAgentTask::new("task-2", "test", "任务2"),
            SubAgentTask::new("task-3", "test", "任务3"),
        ];

        let result = scheduler.execute(tasks, None).await.unwrap();

        assert!(result.success);
        assert_eq!(result.successful_count, 3);
    }

    #[tokio::test]
    async fn test_execute_with_dependencies() {
        let executor = MockExecutor::new();
        let scheduler = SubAgentScheduler::new(SchedulerConfig::default(), executor);

        let tasks = vec![
            SubAgentTask::new("task-1", "test", "任务1"),
            SubAgentTask::new("task-2", "test", "任务2").with_dependencies(vec!["task-1"]),
        ];

        let result = scheduler.execute(tasks, None).await.unwrap();

        assert!(result.success);
        assert_eq!(result.successful_count, 2);
    }

    #[tokio::test]
    async fn test_circular_dependency_detection() {
        let executor = MockExecutor::new();
        let scheduler = SubAgentScheduler::new(SchedulerConfig::default(), executor);

        let tasks = vec![
            SubAgentTask::new("task-1", "test", "任务1").with_dependencies(vec!["task-2"]),
            SubAgentTask::new("task-2", "test", "任务2").with_dependencies(vec!["task-1"]),
        ];

        let result = scheduler.execute(tasks, None).await;

        assert!(matches!(result, Err(SchedulerError::CircularDependency(_))));
    }

    #[tokio::test]
    async fn test_max_queue_size_rejection() {
        let executor = MockExecutor::new();
        let config = SchedulerConfig::default().with_max_queue_size(1);
        let scheduler = SubAgentScheduler::new(config, executor);

        let tasks = vec![
            SubAgentTask::new("task-1", "test", "任务1"),
            SubAgentTask::new("task-2", "test", "任务2"),
        ];

        let result = scheduler.execute(tasks, None).await;

        assert!(matches!(
            result,
            Err(SchedulerError::QueueFull {
                requested: 2,
                limit: 1
            })
        ));
    }

    #[tokio::test]
    async fn test_parallel_execution_refills_available_slots() {
        let executor = VariableDelayExecutor {
            delays_ms: HashMap::from([
                ("task-1".to_string(), 220),
                ("task-2".to_string(), 40),
                ("task-3".to_string(), 40),
            ]),
        };
        let config = SchedulerConfig::default().with_max_concurrency(2);
        let scheduler = SubAgentScheduler::new(config, executor);

        let tasks = vec![
            SubAgentTask::new("task-1", "test", "任务1"),
            SubAgentTask::new("task-2", "test", "任务2"),
            SubAgentTask::new("task-3", "test", "任务3"),
        ];

        let started = Instant::now();
        let result = scheduler
            .execute_with_strategy(tasks, None, SchedulingStrategy::Parallel)
            .await
            .unwrap();

        assert!(result.success);
        assert!(started.elapsed().as_millis() < 250);
    }

    #[tokio::test]
    async fn test_task_timeout_uses_default_timeout() {
        let executor = SleepExecutor { delay_ms: 80 };
        let config = SchedulerConfig::default()
            .with_timeout(Duration::from_millis(30))
            .with_retry(false, 0);
        let scheduler = SubAgentScheduler::new(config, executor);

        let tasks = vec![SubAgentTask::new("task-1", "test", "会超时")];
        let result = scheduler.execute(tasks, None).await;

        assert!(matches!(
            result,
            Err(SchedulerError::TaskTimeout(task_id)) if task_id == "task-1"
        ));
    }

    #[tokio::test]
    async fn test_task_timeout_can_be_overridden_per_task() {
        let executor = SleepExecutor { delay_ms: 60 };
        let config = SchedulerConfig::default()
            .with_timeout(Duration::from_millis(20))
            .with_retry(false, 0);
        let scheduler = SubAgentScheduler::new(config, executor);

        let tasks = vec![SubAgentTask::new("task-1", "test", "不会超时")
            .with_timeout(Duration::from_millis(120))];
        let result = scheduler.execute(tasks, None).await.unwrap();

        assert!(result.success);
        assert_eq!(result.successful_count, 1);
    }
}
