//! SubAgent 调度器类型定义
//!
//! 定义 SubAgent 任务、结果、进度等核心类型

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::time::Duration;
use thiserror::Error;

/// SubAgent 调度器错误类型
#[derive(Debug, Error, Clone)]
pub enum SchedulerError {
    /// 任务未找到
    #[error("任务未找到: {0}")]
    TaskNotFound(String),

    /// 任务超时
    #[error("任务超时: {0}")]
    TaskTimeout(String),

    /// 任务执行失败
    #[error("任务执行失败: {task_id}, 错误: {error}")]
    TaskFailed { task_id: String, error: String },

    /// 循环依赖
    #[error("检测到循环依赖: {0:?}")]
    CircularDependency(Vec<String>),

    /// 无效依赖
    #[error("无效依赖: 任务 {task_id} 依赖不存在的任务 {dependency}")]
    InvalidDependency { task_id: String, dependency: String },

    /// 执行已取消
    #[error("执行已取消")]
    Cancelled,

    /// 重试次数耗尽
    #[error("任务重试次数耗尽: {0}")]
    RetriesExhausted(String),

    /// 上下文错误
    #[error("上下文错误: {0}")]
    ContextError(String),

    /// Provider 错误
    #[error("Provider 错误: {0}")]
    ProviderError(String),

    /// 资源限制超出
    #[error("资源限制超出: {0}")]
    ResourceLimitExceeded(String),

    /// 超出队列容量限制
    #[error("任务数超出队列上限: requested={requested}, limit={limit}")]
    QueueFull { requested: usize, limit: usize },
}

/// 调度器结果类型别名
pub type SchedulerResult<T> = Result<T, SchedulerError>;

/// SubAgent 任务状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum SubAgentTaskStatus {
    /// 等待执行
    #[default]
    Pending,
    /// 等待依赖完成
    WaitingForDependencies,
    /// 正在执行
    Running,
    /// 执行成功
    Completed,
    /// 执行失败
    Failed,
    /// 已取消
    Cancelled,
    /// 已跳过（依赖失败）
    Skipped,
}

/// SubAgent 任务定义
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubAgentTask {
    /// 任务唯一标识
    pub id: String,
    /// 任务类型（explore, plan, code, test, review 等）
    pub task_type: String,
    /// 任务指令/提示
    pub prompt: String,
    /// 任务描述
    pub description: Option<String>,
    /// 额外选项
    pub options: Option<HashMap<String, Value>>,
    /// 优先级（数字越大优先级越高）
    pub priority: Option<u8>,
    /// 依赖的任务 ID 列表
    pub dependencies: Option<Vec<String>>,
    /// 任务超时时间（覆盖全局配置）
    pub timeout: Option<Duration>,
    /// 模型选择（sonnet, opus, haiku）
    pub model: Option<String>,
    /// 是否返回摘要（默认 true）
    pub return_summary: bool,
    /// 允许的工具列表（None 表示继承父 Agent）
    pub allowed_tools: Option<Vec<String>>,
    /// 禁止的工具列表
    pub denied_tools: Option<Vec<String>>,
    /// 最大 token 限制
    pub max_tokens: Option<usize>,
}

impl SubAgentTask {
    /// 创建新任务
    pub fn new(
        id: impl Into<String>,
        task_type: impl Into<String>,
        prompt: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            task_type: task_type.into(),
            prompt: prompt.into(),
            description: None,
            options: None,
            priority: None,
            dependencies: None,
            timeout: None,
            model: None,
            return_summary: true,
            allowed_tools: None,
            denied_tools: None,
            max_tokens: None,
        }
    }

    /// 设置描述
    pub fn with_description(mut self, description: impl Into<String>) -> Self {
        self.description = Some(description.into());
        self
    }

    /// 设置优先级
    pub fn with_priority(mut self, priority: u8) -> Self {
        self.priority = Some(priority);
        self
    }

    /// 设置依赖
    pub fn with_dependencies(mut self, dependencies: Vec<impl Into<String>>) -> Self {
        self.dependencies = Some(dependencies.into_iter().map(|d| d.into()).collect());
        self
    }

    /// 设置超时
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = Some(timeout);
        self
    }

    /// 设置模型
    pub fn with_model(mut self, model: impl Into<String>) -> Self {
        self.model = Some(model.into());
        self
    }

    /// 设置是否返回摘要
    pub fn with_summary(mut self, return_summary: bool) -> Self {
        self.return_summary = return_summary;
        self
    }

    /// 设置允许的工具
    pub fn with_allowed_tools(mut self, tools: Vec<impl Into<String>>) -> Self {
        self.allowed_tools = Some(tools.into_iter().map(|t| t.into()).collect());
        self
    }

    /// 设置禁止的工具
    pub fn with_denied_tools(mut self, tools: Vec<impl Into<String>>) -> Self {
        self.denied_tools = Some(tools.into_iter().map(|t| t.into()).collect());
        self
    }

    /// 设置最大 token 限制
    pub fn with_max_tokens(mut self, max_tokens: usize) -> Self {
        self.max_tokens = Some(max_tokens);
        self
    }

    /// 获取有效优先级（默认 0）
    pub fn effective_priority(&self) -> u8 {
        self.priority.unwrap_or(0)
    }

    /// 检查是否有依赖
    pub fn has_dependencies(&self) -> bool {
        self.dependencies
            .as_ref()
            .map(|d| !d.is_empty())
            .unwrap_or(false)
    }

    /// 获取依赖列表
    pub fn get_dependencies(&self) -> Vec<String> {
        self.dependencies.clone().unwrap_or_default()
    }
}

/// SubAgent 执行结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubAgentResult {
    /// 任务 ID
    pub task_id: String,
    /// 是否成功
    pub success: bool,
    /// 完整输出
    pub output: Option<String>,
    /// 摘要输出（用于返回给父 Agent）
    pub summary: Option<String>,
    /// 错误信息
    pub error: Option<String>,
    /// 执行时长
    pub duration: Duration,
    /// 重试次数
    pub retries: usize,
    /// 开始时间
    pub started_at: DateTime<Utc>,
    /// 完成时间
    pub completed_at: DateTime<Utc>,
    /// Token 使用量
    pub token_usage: Option<TokenUsage>,
    /// 元数据
    pub metadata: HashMap<String, Value>,
}

/// Token 使用统计
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    /// 输入 token 数
    pub input_tokens: usize,
    /// 输出 token 数
    pub output_tokens: usize,
    /// 总 token 数
    pub total_tokens: usize,
}

/// 任务执行信息（内部跟踪）
#[derive(Debug, Clone)]
pub struct TaskExecutionInfo {
    /// 任务定义
    pub task: SubAgentTask,
    /// 当前状态
    pub status: SubAgentTaskStatus,
    /// 重试次数
    pub retries: usize,
    /// 最后错误
    pub last_error: Option<String>,
    /// 开始时间
    pub started_at: Option<DateTime<Utc>>,
    /// 完成时间
    pub completed_at: Option<DateTime<Utc>>,
    /// 结果
    pub result: Option<SubAgentResult>,
    /// 上下文 ID
    pub context_id: Option<String>,
}

impl TaskExecutionInfo {
    /// 创建新的执行信息
    pub fn new(task: SubAgentTask) -> Self {
        Self {
            task,
            status: SubAgentTaskStatus::Pending,
            retries: 0,
            last_error: None,
            started_at: None,
            completed_at: None,
            result: None,
            context_id: None,
        }
    }
}

/// 执行进度信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerProgress {
    /// 总任务数
    pub total: usize,
    /// 已完成数
    pub completed: usize,
    /// 失败数
    pub failed: usize,
    /// 运行中数
    pub running: usize,
    /// 等待中数
    pub pending: usize,
    /// 已跳过数
    pub skipped: usize,
    /// 是否已取消
    pub cancelled: bool,
    /// 当前运行的任务 ID
    pub current_tasks: Vec<String>,
    /// 进度百分比
    pub percentage: f64,
}

impl Default for SchedulerProgress {
    fn default() -> Self {
        Self {
            total: 0,
            completed: 0,
            failed: 0,
            running: 0,
            pending: 0,
            skipped: 0,
            cancelled: false,
            current_tasks: Vec::new(),
            percentage: 0.0,
        }
    }
}

/// 调度执行结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerExecutionResult {
    /// 是否全部成功
    pub success: bool,
    /// 各任务结果
    pub results: Vec<SubAgentResult>,
    /// 总执行时长
    pub total_duration: Duration,
    /// 成功任务数
    pub successful_count: usize,
    /// 失败任务数
    pub failed_count: usize,
    /// 跳过任务数
    pub skipped_count: usize,
    /// 合并后的摘要
    pub merged_summary: Option<String>,
    /// Token 使用统计
    pub total_token_usage: TokenUsage,
}

/// 调度事件（用于进度回调）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "type")]
pub enum SchedulerEvent {
    /// 调度开始
    Started { total_tasks: usize },
    /// 调度因队列容量被拒绝
    QueueRejected { requested: usize, limit: usize },
    /// 任务开始
    TaskStarted { task_id: String, task_type: String },
    /// 任务完成
    TaskCompleted { task_id: String, duration_ms: u64 },
    /// 任务超时
    TaskTimedOut { task_id: String, timeout_ms: u64 },
    /// 任务失败
    TaskFailed { task_id: String, error: String },
    /// 任务重试
    TaskRetry { task_id: String, retry_count: usize },
    /// 任务跳过
    TaskSkipped { task_id: String, reason: String },
    /// 进度更新
    Progress(SchedulerProgress),
    /// 调度完成
    Completed { success: bool, duration_ms: u64 },
    /// 调度取消
    Cancelled,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_subagent_task_new() {
        let task = SubAgentTask::new("task-1", "explore", "分析项目结构");
        assert_eq!(task.id, "task-1");
        assert_eq!(task.task_type, "explore");
        assert_eq!(task.prompt, "分析项目结构");
        assert!(task.return_summary);
    }

    #[test]
    fn test_subagent_task_with_dependencies() {
        let task =
            SubAgentTask::new("task-2", "code", "实现功能").with_dependencies(vec!["task-1"]);

        assert!(task.has_dependencies());
        assert_eq!(task.get_dependencies(), vec!["task-1"]);
    }

    #[test]
    fn test_subagent_task_priority() {
        let task1 = SubAgentTask::new("task-1", "explore", "任务1");
        let task2 = SubAgentTask::new("task-2", "explore", "任务2").with_priority(10);

        assert_eq!(task1.effective_priority(), 0);
        assert_eq!(task2.effective_priority(), 10);
    }

    #[test]
    fn test_task_execution_info_new() {
        let task = SubAgentTask::new("task-1", "explore", "测试");
        let info = TaskExecutionInfo::new(task);

        assert_eq!(info.status, SubAgentTaskStatus::Pending);
        assert_eq!(info.retries, 0);
        assert!(info.started_at.is_none());
    }

    #[test]
    fn test_scheduler_progress_default() {
        let progress = SchedulerProgress::default();
        assert_eq!(progress.total, 0);
        assert_eq!(progress.percentage, 0.0);
        assert!(!progress.cancelled);
    }
}
