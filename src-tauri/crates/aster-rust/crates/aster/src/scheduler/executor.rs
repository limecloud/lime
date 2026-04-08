//! 任务执行器模块
//!
//! 本模块定义任务执行器的 trait 和实现，包括：
//! - `TaskExecutor`: 任务执行器 trait
//! - `ExecutionResult`: 执行结果结构体
//! - `MainSessionExecutor`: 主会话执行器
//! - `IsolatedSessionExecutor`: 隔离会话执行器
//!
//! ## 需求映射
//!
//! - **Requirement 7.7**: 任务执行器 trait 定义
//! - **Requirement 7.8**: 执行结果结构体
//! - **Requirement 7.9**: 状态更新逻辑
//! - **Requirement 4.4**: 隔离会话创建
//! - **Requirement 4.5**: 隔离会话执行
//! - **Requirement 4.6**: 结果回传逻辑
//! - **Requirement 4.7**: 输出截断

use anyhow::Result;
use async_trait::async_trait;
use chrono::Utc;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

use super::types::{
    IsolationConfig, JobStatus, PostToMainMode, ScheduledJob as NewScheduledJob, SessionTarget,
};

// ============================================================================
// ExecutionResult 结构体 (Task 7.1)
// ============================================================================

/// 任务执行结果
///
/// 包含任务执行的完整结果信息，用于状态更新和结果投递。
///
/// # 字段说明
///
/// - `session_id`: 执行任务的会话 ID
/// - `output`: 执行输出内容（可选）
/// - `duration_ms`: 执行耗时（毫秒）
/// - `status`: 执行状态
/// - `error`: 错误信息（仅当 status 为 Error 时）
///
/// # 需求映射
///
/// - **Requirement 7.8**: 执行结果结构体
///
/// # 示例
///
/// ```rust
/// use aster::scheduler::executor::ExecutionResult;
/// use aster::scheduler::types::JobStatus;
///
/// // 成功的执行结果
/// let success = ExecutionResult {
///     session_id: "session-123".to_string(),
///     output: Some("Task completed successfully".to_string()),
///     duration_ms: 1500,
///     status: JobStatus::Ok,
///     error: None,
/// };
///
/// // 失败的执行结果
/// let failure = ExecutionResult {
///     session_id: "session-456".to_string(),
///     output: None,
///     duration_ms: 500,
///     status: JobStatus::Error,
///     error: Some("Connection timeout".to_string()),
/// };
/// ```
#[derive(Clone, Debug)]
pub struct ExecutionResult {
    /// 执行任务的会话 ID
    pub session_id: String,

    /// 执行输出内容
    ///
    /// 对于 AgentTurn 任务，这是 Agent 的最终输出。
    /// 对于 SystemEvent 任务，这可能是事件处理的结果。
    pub output: Option<String>,

    /// 执行耗时（毫秒）
    pub duration_ms: u64,

    /// 执行状态
    pub status: JobStatus,

    /// 错误信息
    ///
    /// 仅当 `status` 为 `Error` 时有值。
    pub error: Option<String>,
}

impl ExecutionResult {
    /// 创建成功的执行结果
    ///
    /// # 参数
    /// - `session_id`: 会话 ID
    /// - `output`: 输出内容
    /// - `duration_ms`: 执行耗时
    pub fn success(
        session_id: impl Into<String>,
        output: Option<String>,
        duration_ms: u64,
    ) -> Self {
        Self {
            session_id: session_id.into(),
            output,
            duration_ms,
            status: JobStatus::Ok,
            error: None,
        }
    }

    /// 创建失败的执行结果
    ///
    /// # 参数
    /// - `session_id`: 会话 ID
    /// - `error`: 错误信息
    /// - `duration_ms`: 执行耗时
    pub fn failure(
        session_id: impl Into<String>,
        error: impl Into<String>,
        duration_ms: u64,
    ) -> Self {
        Self {
            session_id: session_id.into(),
            output: None,
            duration_ms,
            status: JobStatus::Error,
            error: Some(error.into()),
        }
    }

    /// 创建跳过的执行结果
    ///
    /// # 参数
    /// - `session_id`: 会话 ID
    /// - `reason`: 跳过原因
    pub fn skipped(session_id: impl Into<String>, reason: impl Into<String>) -> Self {
        Self {
            session_id: session_id.into(),
            output: Some(reason.into()),
            duration_ms: 0,
            status: JobStatus::Skipped,
            error: None,
        }
    }

    /// 检查是否成功
    pub fn is_success(&self) -> bool {
        self.status.is_ok()
    }

    /// 检查是否失败
    pub fn is_failure(&self) -> bool {
        self.status.is_error()
    }

    /// 检查是否跳过
    pub fn is_skipped(&self) -> bool {
        self.status.is_skipped()
    }

    /// 获取格式化的输出（用于回传）
    ///
    /// 根据隔离配置格式化输出内容。
    ///
    /// # 参数
    /// - `config`: 隔离配置
    pub fn format_output(&self, config: &IsolationConfig) -> String {
        match &self.output {
            Some(output) => config.format_message(output),
            None => match &self.error {
                Some(err) => config.format_message(&format!("Error: {}", err)),
                None => config.format_message("Task completed"),
            },
        }
    }
}

// ============================================================================
// ExecutionContext 结构体
// ============================================================================

/// 执行上下文
///
/// 包含任务执行所需的上下文信息。
#[derive(Clone, Debug)]
pub struct ExecutionContext {
    /// 取消令牌
    pub cancel_token: CancellationToken,

    /// 执行开始时间（毫秒时间戳）
    pub start_time_ms: i64,
}

impl ExecutionContext {
    /// 创建新的执行上下文
    pub fn new() -> Self {
        Self {
            cancel_token: CancellationToken::new(),
            start_time_ms: Utc::now().timestamp_millis(),
        }
    }

    /// 使用指定的取消令牌创建执行上下文
    pub fn with_cancel_token(cancel_token: CancellationToken) -> Self {
        Self {
            cancel_token,
            start_time_ms: Utc::now().timestamp_millis(),
        }
    }

    /// 计算已执行时间（毫秒）
    pub fn elapsed_ms(&self) -> u64 {
        let now = Utc::now().timestamp_millis();
        (now - self.start_time_ms).max(0) as u64
    }

    /// 检查是否已取消
    pub fn is_cancelled(&self) -> bool {
        self.cancel_token.is_cancelled()
    }
}

impl Default for ExecutionContext {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// TaskExecutor Trait (Task 7.1)
// ============================================================================

/// 任务执行器 trait
///
/// 定义任务执行的标准接口，支持不同的执行策略（主会话、隔离会话等）。
///
/// # 需求映射
///
/// - **Requirement 7.7**: 任务执行器 trait 定义
///
/// # 实现者
///
/// - `MainSessionExecutor`: 在主会话中执行任务
/// - `IsolatedSessionExecutor`: 在隔离会话中执行任务
///
/// # 示例
///
/// ```rust,ignore
/// use aster::scheduler::executor::{TaskExecutor, ExecutionResult, ExecutionContext};
///
/// struct MyExecutor;
///
/// #[async_trait]
/// impl TaskExecutor for MyExecutor {
///     async fn execute(
///         &self,
///         job: &ScheduledJob,
///         ctx: &ExecutionContext,
///     ) -> Result<ExecutionResult> {
///         // 执行任务逻辑
///         Ok(ExecutionResult::success("session-id", None, 100))
///     }
///
///     async fn cancel(&self, job_id: &str) -> Result<()> {
///         // 取消任务逻辑
///         Ok(())
///     }
/// }
/// ```
#[async_trait]
pub trait TaskExecutor: Send + Sync {
    /// 执行任务
    ///
    /// # 参数
    /// - `job`: 要执行的调度任务
    /// - `ctx`: 执行上下文
    ///
    /// # 返回值
    /// - `Ok(ExecutionResult)`: 执行结果
    /// - `Err`: 执行过程中的错误
    async fn execute(
        &self,
        job: &NewScheduledJob,
        ctx: &ExecutionContext,
    ) -> Result<ExecutionResult>;

    /// 取消执行
    ///
    /// # 参数
    /// - `job_id`: 要取消的任务 ID
    ///
    /// # 返回值
    /// - `Ok(())`: 取消成功
    /// - `Err`: 取消失败
    async fn cancel(&self, job_id: &str) -> Result<()>;

    /// 获取执行器名称
    fn name(&self) -> &str;
}

// ============================================================================
// MainSessionExecutor (Task 7.2)
// ============================================================================

/// 主会话执行器
///
/// 在主会话中执行调度任务，任务执行结果直接影响主会话状态。
///
/// # 需求映射
///
/// - **Requirement 7.7**: 主会话执行器实现
/// - **Requirement 7.8**: 执行结果返回
/// - **Requirement 7.9**: 状态更新
///
/// # 使用场景
///
/// 适用于需要与用户当前会话交互的任务，如：
/// - 定时提醒
/// - 状态报告
/// - 需要用户响应的任务
///
/// # 示例
///
/// ```rust,ignore
/// use aster::scheduler::executor::{MainSessionExecutor, ExecutionContext};
///
/// let executor = MainSessionExecutor::new();
/// let ctx = ExecutionContext::new();
/// let result = executor.execute(&job, &ctx).await?;
/// ```
pub struct MainSessionExecutor {
    /// 执行器名称
    name: String,
}

impl MainSessionExecutor {
    /// 创建新的主会话执行器
    pub fn new() -> Self {
        Self {
            name: "main_session".to_string(),
        }
    }
}

impl Default for MainSessionExecutor {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl TaskExecutor for MainSessionExecutor {
    async fn execute(
        &self,
        job: &NewScheduledJob,
        ctx: &ExecutionContext,
    ) -> Result<ExecutionResult> {
        // 检查任务是否启用
        if !job.enabled {
            return Ok(ExecutionResult::skipped(
                "main",
                format!("Job '{}' is disabled", job.id),
            ));
        }

        // 检查是否已取消
        if ctx.is_cancelled() {
            return Ok(ExecutionResult::skipped(
                "main",
                format!("Job '{}' was cancelled before execution", job.id),
            ));
        }

        // 获取任务文本
        let task_text = job.payload.get_text();

        // 模拟执行（实际实现需要集成 Agent）
        // TODO: 集成实际的 Agent 执行逻辑
        tracing::info!(
            "MainSessionExecutor: Executing job '{}' with payload: {}",
            job.id,
            task_text
        );

        let duration_ms = ctx.elapsed_ms();

        // 返回成功结果
        Ok(ExecutionResult::success(
            "main",
            Some(format!("Executed: {}", task_text)),
            duration_ms,
        ))
    }

    async fn cancel(&self, job_id: &str) -> Result<()> {
        tracing::info!("MainSessionExecutor: Cancelling job '{}'", job_id);
        // 主会话取消逻辑
        // TODO: 实现实际的取消逻辑
        Ok(())
    }

    fn name(&self) -> &str {
        &self.name
    }
}

// ============================================================================
// IsolatedSessionExecutor (Task 7.3)
// ============================================================================

/// 隔离会话执行器
///
/// 在独立的隔离会话中执行调度任务，不影响主会话状态。
/// 执行完成后可以将结果回传到主会话。
///
/// # 需求映射
///
/// - **Requirement 4.4**: 隔离会话创建
/// - **Requirement 4.5**: 隔离会话执行
/// - **Requirement 4.6**: 结果回传逻辑
/// - **Requirement 4.7**: 输出截断
///
/// # 使用场景
///
/// 适用于需要独立执行的任务，如：
/// - 长时间运行的任务
/// - 可能产生大量输出的任务
/// - 不希望影响主会话状态的任务
///
/// # 示例
///
/// ```rust,ignore
/// use aster::scheduler::executor::{IsolatedSessionExecutor, ExecutionContext};
///
/// let executor = IsolatedSessionExecutor::new();
/// let ctx = ExecutionContext::new();
/// let result = executor.execute(&job, &ctx).await?;
/// ```
pub struct IsolatedSessionExecutor {
    /// 执行器名称
    name: String,
}

impl IsolatedSessionExecutor {
    /// 创建新的隔离会话执行器
    pub fn new() -> Self {
        Self {
            name: "isolated_session".to_string(),
        }
    }

    /// 生成隔离会话 ID
    fn generate_session_id(&self, job_id: &str) -> String {
        let timestamp = Utc::now().timestamp_millis();
        format!("isolated-{}-{}", job_id, timestamp)
    }

    /// 处理执行结果，应用隔离配置
    fn process_result(
        &self,
        result: ExecutionResult,
        isolation: &IsolationConfig,
    ) -> ExecutionResult {
        if !isolation.enabled {
            return result;
        }

        // 根据配置处理输出
        let processed_output = result.output.map(|output| {
            match isolation.post_to_main_mode {
                PostToMainMode::Summary => {
                    // 摘要模式：生成简短状态
                    if result.status.is_ok() {
                        "Task completed successfully".to_string()
                    } else if result.status.is_error() {
                        format!(
                            "Task failed: {}",
                            result.error.as_deref().unwrap_or("Unknown error")
                        )
                    } else {
                        "Task skipped".to_string()
                    }
                }
                PostToMainMode::Full => {
                    // 完整模式：截断输出
                    isolation.truncate_output(&output)
                }
            }
        });

        ExecutionResult {
            output: processed_output,
            ..result
        }
    }
}

impl Default for IsolatedSessionExecutor {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl TaskExecutor for IsolatedSessionExecutor {
    async fn execute(
        &self,
        job: &NewScheduledJob,
        ctx: &ExecutionContext,
    ) -> Result<ExecutionResult> {
        // 检查任务是否启用
        if !job.enabled {
            return Ok(ExecutionResult::skipped(
                self.generate_session_id(&job.id),
                format!("Job '{}' is disabled", job.id),
            ));
        }

        // 检查是否已取消
        if ctx.is_cancelled() {
            return Ok(ExecutionResult::skipped(
                self.generate_session_id(&job.id),
                format!("Job '{}' was cancelled before execution", job.id),
            ));
        }

        // 生成隔离会话 ID
        let session_id = self.generate_session_id(&job.id);

        tracing::info!(
            "IsolatedSessionExecutor: Creating isolated session '{}' for job '{}'",
            session_id,
            job.id
        );

        // 获取任务文本
        let task_text = job.payload.get_text();

        // 模拟执行（实际实现需要集成 Agent 和 SessionManager）
        // TODO: 集成实际的隔离会话创建和 Agent 执行逻辑
        tracing::info!(
            "IsolatedSessionExecutor: Executing job '{}' in session '{}' with payload: {}",
            job.id,
            session_id,
            task_text
        );

        let duration_ms = ctx.elapsed_ms();

        // 创建执行结果
        let result = ExecutionResult::success(
            session_id,
            Some(format!("Isolated execution: {}", task_text)),
            duration_ms,
        );

        // 应用隔离配置处理结果
        let isolation = job.isolation.as_ref().cloned().unwrap_or_default();
        Ok(self.process_result(result, &isolation))
    }

    async fn cancel(&self, job_id: &str) -> Result<()> {
        tracing::info!("IsolatedSessionExecutor: Cancelling job '{}'", job_id);
        // 隔离会话取消逻辑
        // TODO: 实现实际的取消逻辑
        Ok(())
    }

    fn name(&self) -> &str {
        &self.name
    }
}

// ============================================================================
// ExecutorFactory
// ============================================================================

/// 执行器工厂
///
/// 根据任务配置创建合适的执行器。
pub struct ExecutorFactory;

impl ExecutorFactory {
    /// 根据会话目标创建执行器
    ///
    /// # 参数
    /// - `target`: 会话目标
    ///
    /// # 返回值
    /// 返回对应的执行器实例
    pub fn create(target: &SessionTarget) -> Arc<dyn TaskExecutor> {
        match target {
            SessionTarget::Main => Arc::new(MainSessionExecutor::new()),
            SessionTarget::Isolated => Arc::new(IsolatedSessionExecutor::new()),
        }
    }

    /// 为任务创建执行器
    ///
    /// # 参数
    /// - `job`: 调度任务
    ///
    /// # 返回值
    /// 返回对应的执行器实例
    pub fn create_for_job(job: &NewScheduledJob) -> Arc<dyn TaskExecutor> {
        Self::create(&job.session_target)
    }
}

// ============================================================================
// 单元测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scheduler::types::{CronPayload, JobState, ScheduleType, WakeMode};

    // 创建测试用的 ScheduledJob
    fn create_test_job(id: &str, enabled: bool, target: SessionTarget) -> NewScheduledJob {
        NewScheduledJob {
            id: id.to_string(),
            agent_id: None,
            name: id.to_string(),
            description: None,
            enabled,
            delete_after_run: false,
            created_at_ms: Utc::now().timestamp_millis(),
            updated_at_ms: Utc::now().timestamp_millis(),
            schedule: ScheduleType::Cron {
                expr: "0 0 9 * * *".to_string(),
                tz: None,
            },
            session_target: target,
            wake_mode: WakeMode::Now,
            payload: CronPayload::agent_turn("Test task"),
            isolation: None,
            delivery: None,
            state: JobState::default(),
            source: None,
            cron: None,
        }
    }

    // ------------------------------------------------------------------------
    // ExecutionResult 测试
    // ------------------------------------------------------------------------

    #[test]
    fn test_execution_result_success() {
        let result = ExecutionResult::success("session-1", Some("output".to_string()), 100);

        assert_eq!(result.session_id, "session-1");
        assert_eq!(result.output, Some("output".to_string()));
        assert_eq!(result.duration_ms, 100);
        assert!(result.is_success());
        assert!(!result.is_failure());
        assert!(!result.is_skipped());
        assert!(result.error.is_none());
    }

    #[test]
    fn test_execution_result_failure() {
        let result = ExecutionResult::failure("session-2", "Connection error", 50);

        assert_eq!(result.session_id, "session-2");
        assert!(result.output.is_none());
        assert_eq!(result.duration_ms, 50);
        assert!(!result.is_success());
        assert!(result.is_failure());
        assert!(!result.is_skipped());
        assert_eq!(result.error, Some("Connection error".to_string()));
    }

    #[test]
    fn test_execution_result_skipped() {
        let result = ExecutionResult::skipped("session-3", "Job disabled");

        assert_eq!(result.session_id, "session-3");
        assert_eq!(result.output, Some("Job disabled".to_string()));
        assert_eq!(result.duration_ms, 0);
        assert!(!result.is_success());
        assert!(!result.is_failure());
        assert!(result.is_skipped());
        assert!(result.error.is_none());
    }

    #[test]
    fn test_execution_result_format_output_with_output() {
        let result = ExecutionResult::success("session", Some("Task output".to_string()), 100);
        let config = IsolationConfig {
            enabled: true,
            post_to_main_prefix: Some("[Task]".to_string()),
            post_to_main_mode: PostToMainMode::Full,
            post_to_main_max_chars: 1000,
        };

        let formatted = result.format_output(&config);
        assert!(formatted.starts_with("[Task]"));
        assert!(formatted.contains("Task output"));
    }

    #[test]
    fn test_execution_result_format_output_with_error() {
        let result = ExecutionResult::failure("session", "Some error", 100);
        let config = IsolationConfig::default();

        let formatted = result.format_output(&config);
        assert!(formatted.contains("Error:"));
        assert!(formatted.contains("Some error"));
    }

    #[test]
    fn test_execution_result_format_output_no_output() {
        let result = ExecutionResult {
            session_id: "session".to_string(),
            output: None,
            duration_ms: 100,
            status: JobStatus::Ok,
            error: None,
        };
        let config = IsolationConfig::default();

        let formatted = result.format_output(&config);
        assert!(formatted.contains("Task completed"));
    }

    // ------------------------------------------------------------------------
    // ExecutionContext 测试
    // ------------------------------------------------------------------------

    #[test]
    fn test_execution_context_new() {
        let ctx = ExecutionContext::new();

        assert!(!ctx.is_cancelled());
        assert!(ctx.start_time_ms > 0);
    }

    #[test]
    fn test_execution_context_with_cancel_token() {
        let token = CancellationToken::new();
        let ctx = ExecutionContext::with_cancel_token(token.clone());

        assert!(!ctx.is_cancelled());

        token.cancel();
        assert!(ctx.is_cancelled());
    }

    #[test]
    fn test_execution_context_elapsed_ms() {
        let ctx = ExecutionContext::new();

        // 应该返回非负值
        let elapsed = ctx.elapsed_ms();
        assert!(elapsed < 1000); // 应该很快
    }

    #[test]
    fn test_execution_context_default() {
        let ctx = ExecutionContext::default();

        assert!(!ctx.is_cancelled());
        assert!(ctx.start_time_ms > 0);
    }

    // ------------------------------------------------------------------------
    // MainSessionExecutor 测试
    // ------------------------------------------------------------------------

    #[tokio::test]
    async fn test_main_session_executor_execute_enabled() {
        let executor = MainSessionExecutor::new();
        let job = create_test_job("test-job", true, SessionTarget::Main);
        let ctx = ExecutionContext::new();

        let result = executor.execute(&job, &ctx).await.unwrap();

        assert!(result.is_success());
        assert_eq!(result.session_id, "main");
        assert!(result.output.is_some());
    }

    #[tokio::test]
    async fn test_main_session_executor_execute_disabled() {
        let executor = MainSessionExecutor::new();
        let job = create_test_job("disabled-job", false, SessionTarget::Main);
        let ctx = ExecutionContext::new();

        let result = executor.execute(&job, &ctx).await.unwrap();

        assert!(result.is_skipped());
        assert!(result.output.unwrap().contains("disabled"));
    }

    #[tokio::test]
    async fn test_main_session_executor_execute_cancelled() {
        let executor = MainSessionExecutor::new();
        let job = create_test_job("cancelled-job", true, SessionTarget::Main);
        let token = CancellationToken::new();
        token.cancel();
        let ctx = ExecutionContext::with_cancel_token(token);

        let result = executor.execute(&job, &ctx).await.unwrap();

        assert!(result.is_skipped());
        assert!(result.output.unwrap().contains("cancelled"));
    }

    #[tokio::test]
    async fn test_main_session_executor_cancel() {
        let executor = MainSessionExecutor::new();

        let result = executor.cancel("test-job").await;
        assert!(result.is_ok());
    }

    #[test]
    fn test_main_session_executor_name() {
        let executor = MainSessionExecutor::new();
        assert_eq!(executor.name(), "main_session");
    }

    // ------------------------------------------------------------------------
    // IsolatedSessionExecutor 测试
    // ------------------------------------------------------------------------

    #[tokio::test]
    async fn test_isolated_session_executor_execute_enabled() {
        let executor = IsolatedSessionExecutor::new();
        let job = create_test_job("test-job", true, SessionTarget::Isolated);
        let ctx = ExecutionContext::new();

        let result = executor.execute(&job, &ctx).await.unwrap();

        assert!(result.is_success());
        assert!(result.session_id.starts_with("isolated-"));
        assert!(result.session_id.contains("test-job"));
        assert!(result.output.is_some());
    }

    #[tokio::test]
    async fn test_isolated_session_executor_execute_disabled() {
        let executor = IsolatedSessionExecutor::new();
        let job = create_test_job("disabled-job", false, SessionTarget::Isolated);
        let ctx = ExecutionContext::new();

        let result = executor.execute(&job, &ctx).await.unwrap();

        assert!(result.is_skipped());
        assert!(result.output.unwrap().contains("disabled"));
    }

    #[tokio::test]
    async fn test_isolated_session_executor_execute_cancelled() {
        let executor = IsolatedSessionExecutor::new();
        let job = create_test_job("cancelled-job", true, SessionTarget::Isolated);
        let token = CancellationToken::new();
        token.cancel();
        let ctx = ExecutionContext::with_cancel_token(token);

        let result = executor.execute(&job, &ctx).await.unwrap();

        assert!(result.is_skipped());
        assert!(result.output.unwrap().contains("cancelled"));
    }

    #[tokio::test]
    async fn test_isolated_session_executor_with_isolation_config() {
        let executor = IsolatedSessionExecutor::new();
        let mut job = create_test_job("isolated-job", true, SessionTarget::Isolated);
        job.isolation = Some(IsolationConfig {
            enabled: true,
            post_to_main_prefix: Some("[Scheduled]".to_string()),
            post_to_main_mode: PostToMainMode::Summary,
            post_to_main_max_chars: 100,
        });
        let ctx = ExecutionContext::new();

        let result = executor.execute(&job, &ctx).await.unwrap();

        assert!(result.is_success());
        // Summary 模式下输出应该是简短的状态信息
        assert!(result.output.unwrap().contains("completed"));
    }

    #[tokio::test]
    async fn test_isolated_session_executor_cancel() {
        let executor = IsolatedSessionExecutor::new();

        let result = executor.cancel("test-job").await;
        assert!(result.is_ok());
    }

    #[test]
    fn test_isolated_session_executor_name() {
        let executor = IsolatedSessionExecutor::new();
        assert_eq!(executor.name(), "isolated_session");
    }

    #[test]
    fn test_isolated_session_executor_generate_session_id() {
        let executor = IsolatedSessionExecutor::new();

        let id1 = executor.generate_session_id("job-1");
        let id2 = executor.generate_session_id("job-1");

        assert!(id1.starts_with("isolated-job-1-"));
        assert!(id2.starts_with("isolated-job-1-"));
        // 时间戳不同，ID 应该不同
        // 注意：在快速执行时可能相同，所以不做严格断言
    }

    // ------------------------------------------------------------------------
    // ExecutorFactory 测试
    // ------------------------------------------------------------------------

    #[test]
    fn test_executor_factory_create_main() {
        let executor = ExecutorFactory::create(&SessionTarget::Main);
        assert_eq!(executor.name(), "main_session");
    }

    #[test]
    fn test_executor_factory_create_isolated() {
        let executor = ExecutorFactory::create(&SessionTarget::Isolated);
        assert_eq!(executor.name(), "isolated_session");
    }

    #[test]
    fn test_executor_factory_create_for_job_main() {
        let job = create_test_job("test", true, SessionTarget::Main);
        let executor = ExecutorFactory::create_for_job(&job);
        assert_eq!(executor.name(), "main_session");
    }

    #[test]
    fn test_executor_factory_create_for_job_isolated() {
        let job = create_test_job("test", true, SessionTarget::Isolated);
        let executor = ExecutorFactory::create_for_job(&job);
        assert_eq!(executor.name(), "isolated_session");
    }
}

// ============================================================================
// 属性测试 (Property-Based Tests) - Task 7.4
// ============================================================================

#[cfg(test)]
mod property_tests {
    use super::*;
    use crate::scheduler::types::{CronPayload, JobState, ScheduleType, WakeMode};
    use proptest::prelude::*;

    // ------------------------------------------------------------------------
    // 生成器 (Generators)
    // ------------------------------------------------------------------------

    /// 生成有效的任务 ID
    fn arb_job_id() -> impl Strategy<Value = String> {
        "[a-z][a-z0-9-]{0,20}".prop_filter("非空 ID", |s| !s.is_empty())
    }

    /// 生成 SessionTarget
    fn arb_session_target() -> impl Strategy<Value = SessionTarget> {
        prop_oneof![Just(SessionTarget::Main), Just(SessionTarget::Isolated),]
    }

    /// 生成 IsolationConfig
    fn arb_isolation_config() -> impl Strategy<Value = Option<IsolationConfig>> {
        prop_oneof![
            Just(None),
            (
                proptest::bool::ANY,
                proptest::option::of("[A-Za-z\\[\\]]{1,10}"),
                prop_oneof![Just(PostToMainMode::Summary), Just(PostToMainMode::Full),],
                100usize..10000usize,
            )
                .prop_map(|(enabled, prefix, mode, max_chars)| {
                    Some(IsolationConfig {
                        enabled,
                        post_to_main_prefix: prefix,
                        post_to_main_mode: mode,
                        post_to_main_max_chars: max_chars,
                    })
                }),
        ]
    }

    /// 生成测试用 ScheduledJob
    fn arb_test_job() -> impl Strategy<Value = NewScheduledJob> {
        (
            arb_job_id(),
            proptest::bool::ANY,
            arb_session_target(),
            arb_isolation_config(),
        )
            .prop_map(|(id, enabled, target, isolation)| NewScheduledJob {
                id: id.clone(),
                agent_id: None,
                name: id,
                description: None,
                enabled,
                delete_after_run: false,
                created_at_ms: Utc::now().timestamp_millis(),
                updated_at_ms: Utc::now().timestamp_millis(),
                schedule: ScheduleType::Cron {
                    expr: "0 0 9 * * *".to_string(),
                    tz: None,
                },
                session_target: target,
                wake_mode: WakeMode::Now,
                payload: CronPayload::agent_turn("Test"),
                isolation,
                delivery: None,
                state: JobState::default(),
                source: None,
                cron: None,
            })
    }

    // ------------------------------------------------------------------------
    // Property 6: 隔离会话创建
    // ------------------------------------------------------------------------

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(50))]

        /// Property 6: 隔离会话创建
        ///
        /// **Validates: Requirements 4.4**
        ///
        /// *For any* 启用隔离的 ScheduledJob，执行时应创建新的隔离会话，
        /// 且该会话 ID 与主会话不同。
        #[test]
        fn prop_isolated_session_id_differs_from_main(job in arb_test_job()) {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let executor = IsolatedSessionExecutor::new();
                let ctx = ExecutionContext::new();

                if job.enabled {
                    let result = executor.execute(&job, &ctx).await.unwrap();

                    // 隔离会话 ID 应该以 "isolated-" 开头
                    prop_assert!(
                        result.session_id.starts_with("isolated-"),
                        "隔离会话 ID 应以 'isolated-' 开头"
                    );

                    // 隔离会话 ID 应该包含任务 ID
                    prop_assert!(
                        result.session_id.contains(&job.id),
                        "隔离会话 ID 应包含任务 ID"
                    );

                    // 隔离会话 ID 不应该是 "main"
                    prop_assert_ne!(
                        result.session_id,
                        "main",
                        "隔离会话 ID 不应为 'main'"
                    );
                }

                Ok(())
            })?;
        }

        /// Property 6.2: 主会话执行器使用固定会话 ID
        #[test]
        fn prop_main_session_uses_fixed_id(job in arb_test_job()) {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let executor = MainSessionExecutor::new();
                let ctx = ExecutionContext::new();

                if job.enabled {
                    let result = executor.execute(&job, &ctx).await.unwrap();

                    // 主会话 ID 应该是 "main"
                    prop_assert_eq!(
                        result.session_id,
                        "main",
                        "主会话 ID 应为 'main'"
                    );
                }

                Ok(())
            })?;
        }
    }

    // ------------------------------------------------------------------------
    // Property 7: 任务状态跟踪
    // ------------------------------------------------------------------------

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(50))]

        /// Property 7.1: 执行结果包含正确的状态
        ///
        /// **Validates: Requirements 7.7, 7.8, 7.9**
        #[test]
        fn prop_execution_result_has_correct_status(job in arb_test_job()) {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let executor = ExecutorFactory::create_for_job(&job);
                let ctx = ExecutionContext::new();

                let result = executor.execute(&job, &ctx).await.unwrap();

                if job.enabled {
                    // 启用的任务应该成功执行
                    prop_assert!(
                        result.is_success(),
                        "启用的任务应成功执行"
                    );
                } else {
                    // 禁用的任务应该被跳过
                    prop_assert!(
                        result.is_skipped(),
                        "禁用的任务应被跳过"
                    );
                }

                Ok(())
            })?;
        }

        /// Property 7.2: 执行结果包含耗时信息
        ///
        /// **Validates: Requirements 7.8**
        #[test]
        fn prop_execution_result_has_duration(job in arb_test_job()) {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let executor = ExecutorFactory::create_for_job(&job);
                let ctx = ExecutionContext::new();

                let result = executor.execute(&job, &ctx).await.unwrap();

                // 耗时应该是非负数
                // 跳过的任务耗时为 0
                if job.enabled {
                    // 启用的任务耗时可能为 0 或更大
                    prop_assert!(
                        result.duration_ms < 10000,
                        "执行耗时应在合理范围内"
                    );
                } else {
                    prop_assert_eq!(
                        result.duration_ms,
                        0,
                        "跳过的任务耗时应为 0"
                    );
                }

                Ok(())
            })?;
        }

        /// Property 7.3: 取消的任务返回跳过状态
        ///
        /// **Validates: Requirements 7.9**
        #[test]
        fn prop_cancelled_task_returns_skipped(job in arb_test_job()) {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let executor = ExecutorFactory::create_for_job(&job);
                let token = CancellationToken::new();
                token.cancel();
                let ctx = ExecutionContext::with_cancel_token(token);

                let result = executor.execute(&job, &ctx).await.unwrap();

                // 取消的任务应该被跳过
                prop_assert!(
                    result.is_skipped(),
                    "取消的任务应被跳过"
                );

                // 输出应该包含 "cancelled"
                if let Some(output) = &result.output {
                    prop_assert!(
                        output.contains("cancelled") || output.contains("disabled"),
                        "跳过原因应包含 'cancelled' 或 'disabled'"
                    );
                }

                Ok(())
            })?;
        }
    }

    // ------------------------------------------------------------------------
    // ExecutorFactory 属性测试
    // ------------------------------------------------------------------------

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(50))]

        /// 工厂创建的执行器类型与会话目标匹配
        #[test]
        fn prop_factory_creates_correct_executor(target in arb_session_target()) {
            let executor = ExecutorFactory::create(&target);

            match target {
                SessionTarget::Main => {
                    prop_assert_eq!(
                        executor.name(),
                        "main_session",
                        "Main 目标应创建 main_session 执行器"
                    );
                }
                SessionTarget::Isolated => {
                    prop_assert_eq!(
                        executor.name(),
                        "isolated_session",
                        "Isolated 目标应创建 isolated_session 执行器"
                    );
                }
            }
        }

        /// 工厂为任务创建正确的执行器
        #[test]
        fn prop_factory_creates_correct_executor_for_job(job in arb_test_job()) {
            let executor = ExecutorFactory::create_for_job(&job);

            match job.session_target {
                SessionTarget::Main => {
                    prop_assert_eq!(
                        executor.name(),
                        "main_session"
                    );
                }
                SessionTarget::Isolated => {
                    prop_assert_eq!(
                        executor.name(),
                        "isolated_session"
                    );
                }
            }
        }
    }

    // ------------------------------------------------------------------------
    // ExecutionResult 属性测试
    // ------------------------------------------------------------------------

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        /// 成功结果的状态一致性
        #[test]
        fn prop_success_result_consistency(
            session_id in "[a-z]{5,15}",
            output in proptest::option::of("[a-zA-Z0-9 ]{0,100}"),
            duration in 0u64..100000u64,
        ) {
            let result = ExecutionResult::success(session_id.clone(), output.clone(), duration);

            prop_assert_eq!(&result.session_id, &session_id);
            prop_assert_eq!(&result.output, &output);
            prop_assert_eq!(result.duration_ms, duration);
            prop_assert!(result.is_success());
            prop_assert!(!result.is_failure());
            prop_assert!(!result.is_skipped());
            prop_assert!(result.error.is_none());
        }

        /// 失败结果的状态一致性
        #[test]
        fn prop_failure_result_consistency(
            session_id in "[a-z]{5,15}",
            error in "[a-zA-Z0-9 ]{1,50}",
            duration in 0u64..100000u64,
        ) {
            let result = ExecutionResult::failure(session_id.clone(), error.clone(), duration);

            prop_assert_eq!(&result.session_id, &session_id);
            prop_assert!(result.output.is_none());
            prop_assert_eq!(result.duration_ms, duration);
            prop_assert!(!result.is_success());
            prop_assert!(result.is_failure());
            prop_assert!(!result.is_skipped());
            prop_assert_eq!(&result.error, &Some(error));
        }

        /// 跳过结果的状态一致性
        #[test]
        fn prop_skipped_result_consistency(
            session_id in "[a-z]{5,15}",
            reason in "[a-zA-Z0-9 ]{1,50}",
        ) {
            let result = ExecutionResult::skipped(session_id.clone(), reason.clone());

            prop_assert_eq!(&result.session_id, &session_id);
            prop_assert_eq!(&result.output, &Some(reason));
            prop_assert_eq!(result.duration_ms, 0);
            prop_assert!(!result.is_success());
            prop_assert!(!result.is_failure());
            prop_assert!(result.is_skipped());
            prop_assert!(result.error.is_none());
        }
    }
}
