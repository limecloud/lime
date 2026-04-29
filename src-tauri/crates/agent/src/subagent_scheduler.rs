//! SubAgent 调度器集成
//!
//! 将 aster-rust 的 SubAgent 调度器与 Lime API Key Provider 集成。
//! 纯逻辑位于此 crate，事件发送通过注入回调实现。

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use aster::agents::context::AgentContext;
use aster::agents::subagent_scheduler::{
    SchedulerConfig, SchedulerError, SchedulerExecutionResult, SchedulerProgress, SchedulerResult,
    SubAgentExecutor, SubAgentResult, SubAgentScheduler, SubAgentTask,
    TokenUsage as SchedulerTokenUsage,
};
use aster::conversation::message::Message;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

use crate::credential_bridge::{create_aster_provider, AsterProviderConfig, CredentialBridge};
use lime_core::database::DbConnection;

/// 调度器事件发射器
pub type SchedulerEventEmitter = Arc<dyn Fn(&serde_json::Value) + Send + Sync>;

// ---------------------------------------------------------------------------
// SubAgentRole
// ---------------------------------------------------------------------------

/// SubAgent 角色，决定可用的工具集
///
/// 遵循最小权限原则：默认 Explorer（只读），需要写入时显式升级。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SubAgentRole {
    /// 只读探索：Read, Grep, Glob, LSP 查询
    Explorer,
    /// 规划分析：Read + 输出计划文档
    Planner,
    /// 全能执行：所有工具（不限制）
    Executor,
}

impl SubAgentRole {
    /// 返回该角色允许使用的工具名称列表
    ///
    /// 空列表表示不限制（Executor 角色）
    pub fn allowed_tools(&self) -> Vec<&'static str> {
        match self {
            Self::Explorer => vec!["read_file", "grep", "glob", "list_directory", "lsp_query"],
            Self::Planner => vec!["read_file", "grep", "glob", "list_directory", "write_file"],
            Self::Executor => vec![], // 空表示不限制
        }
    }

    /// 返回该角色的最大对话轮次
    pub fn max_turns(&self) -> usize {
        match self {
            Self::Explorer => 15,
            Self::Planner => 10,
            Self::Executor => 30,
        }
    }

    /// 返回该角色的结果最大长度（字符数）
    /// 0 表示不限制
    pub fn max_result_length(&self) -> usize {
        match self {
            Self::Explorer => 2000,
            Self::Planner => 4000,
            Self::Executor => 0, // 不限制
        }
    }

    /// 该角色是否允许使用指定工具
    pub fn is_tool_allowed(&self, tool_name: &str) -> bool {
        let allowed = self.allowed_tools();
        allowed.is_empty() || allowed.contains(&tool_name)
    }

    /// 将角色的工具限制应用到 SubAgentTask 上
    ///
    /// 如果任务已经设置了 allowed_tools，取交集；否则直接设置。
    /// Executor 角色不做任何修改。
    pub fn apply_to_task(&self, mut task: SubAgentTask) -> SubAgentTask {
        let role_tools = self.allowed_tools();
        if role_tools.is_empty() {
            // Executor: 不限制
            return task;
        }

        let role_set: std::collections::HashSet<&str> = role_tools.into_iter().collect();

        if let Some(ref existing) = task.allowed_tools {
            // 取交集：任务自身限制 ∩ 角色限制
            let filtered: Vec<String> = existing
                .iter()
                .filter(|t| role_set.contains(t.as_str()))
                .cloned()
                .collect();
            task.allowed_tools = Some(filtered);
        } else {
            task.allowed_tools = Some(role_set.into_iter().map(String::from).collect());
        }

        task
    }
}

impl Default for SubAgentRole {
    fn default() -> Self {
        Self::Explorer // 默认最小权限
    }
}

impl std::fmt::Display for SubAgentRole {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Explorer => write!(f, "explorer"),
            Self::Planner => write!(f, "planner"),
            Self::Executor => write!(f, "executor"),
        }
    }
}

// ---------------------------------------------------------------------------
// LimeSubAgentExecutor
// ---------------------------------------------------------------------------

/// Lime SubAgent 执行器
///
/// 实现 aster-rust 的 SubAgentExecutor trait，
/// 集成 Lime API Key Provider 进行 LLM 调用。
pub struct LimeSubAgentExecutor {
    /// 凭证桥接器
    credential_bridge: CredentialBridge,
    /// 数据库连接
    db: DbConnection,
    /// 默认模型
    default_model: String,
    /// 默认 Provider 类型
    default_provider: String,
    /// SubAgent 角色
    role: SubAgentRole,
}

impl LimeSubAgentExecutor {
    /// 创建新的执行器
    pub fn new(db: DbConnection) -> Self {
        Self {
            credential_bridge: CredentialBridge::new(),
            db,
            default_model: "claude-sonnet-4-20250514".to_string(),
            default_provider: "anthropic".to_string(),
            role: SubAgentRole::default(),
        }
    }

    /// 设置默认模型
    pub fn with_default_model(mut self, model: impl Into<String>) -> Self {
        self.default_model = model.into();
        self
    }

    /// 设置默认 Provider
    pub fn with_default_provider(mut self, provider: impl Into<String>) -> Self {
        self.default_provider = provider.into();
        self
    }

    /// 设置 SubAgent 角色
    pub fn with_role(mut self, role: SubAgentRole) -> Self {
        self.role = role;
        self
    }

    /// 获取当前角色
    pub fn role(&self) -> SubAgentRole {
        self.role
    }

    /// 从 API Key Provider 选择凭证
    async fn select_credential(&self, task: &SubAgentTask) -> SchedulerResult<AsterProviderConfig> {
        let model = task.model.as_deref().unwrap_or(&self.default_model);
        let provider_type = &self.default_provider;

        let config = self
            .credential_bridge
            .select_and_configure(&self.db, provider_type, model)
            .await
            .map_err(|e| SchedulerError::ProviderError(e.to_string()))?;

        Ok(config)
    }

    /// 生成摘要
    fn generate_summary(&self, output: &str, task: &SubAgentTask) -> String {
        let max_len = 500;
        if output.chars().count() <= max_len {
            format!("任务 {} 完成:\n{}", task.id, output)
        } else {
            let truncated: String = output.chars().take(max_len - 3).collect();
            format!("任务 {} 完成:\n{}...", task.id, truncated)
        }
    }
}

#[async_trait::async_trait]
impl SubAgentExecutor for LimeSubAgentExecutor {
    async fn execute_task(
        &self,
        task: &SubAgentTask,
        context: &AgentContext,
    ) -> SchedulerResult<SubAgentResult> {
        let start_time = Utc::now();
        info!("执行 SubAgent 任务: {} (角色: {})", task.id, self.role);

        let provider_config = self.select_credential(task).await?;
        debug!("使用凭证: {}", provider_config.credential_uuid);

        let provider = create_aster_provider(&provider_config)
            .await
            .map_err(|e| SchedulerError::ProviderError(e.to_string()))?;

        let system_prompt = context.system_prompt.clone().unwrap_or_default();
        let user_message = Message::user().with_text(&task.prompt);

        let (response_msg, usage) = provider
            .complete(&system_prompt, &[user_message], &[])
            .await
            .map_err(|e| SchedulerError::ProviderError(e.to_string()))?;

        let response = response_msg.as_concat_text();

        // 按角色限制结果长度
        let max_len = self.role.max_result_length();
        let response = if max_len > 0 && response.chars().count() > max_len {
            let original_len = response.len();
            let truncated: String = response.chars().take(max_len).collect();
            format!("{}\n\n[结果已截断，原始 {} 字符]", truncated, original_len)
        } else {
            response
        };

        let end_time = Utc::now();
        let duration = (end_time - start_time).to_std().unwrap_or(Duration::ZERO);

        let summary = if task.return_summary {
            Some(self.generate_summary(&response, task))
        } else {
            None
        };

        let token_usage = Some(SchedulerTokenUsage {
            input_tokens: usage.usage.input_tokens.unwrap_or(0) as usize,
            output_tokens: usage.usage.output_tokens.unwrap_or(0) as usize,
            total_tokens: usage.usage.total_tokens.unwrap_or(0) as usize,
        });

        Ok(SubAgentResult {
            task_id: task.id.clone(),
            success: true,
            output: Some(response),
            summary,
            error: None,
            duration,
            retries: 0,
            started_at: start_time,
            completed_at: end_time,
            token_usage,
            metadata: HashMap::new(),
        })
    }
}

// ---------------------------------------------------------------------------
// LimeScheduler
// ---------------------------------------------------------------------------

/// Lime SubAgent 调度器
pub struct LimeScheduler {
    /// 内部调度器
    scheduler: Arc<RwLock<Option<SubAgentScheduler<LimeSubAgentExecutor>>>>,
    /// 数据库连接
    db: DbConnection,
    /// 默认角色
    default_role: SubAgentRole,
}

impl LimeScheduler {
    /// 创建新的调度器
    pub fn new(db: DbConnection) -> Self {
        Self {
            scheduler: Arc::new(RwLock::new(None)),
            db,
            default_role: SubAgentRole::default(),
        }
    }

    /// 设置默认角色
    pub fn with_default_role(mut self, role: SubAgentRole) -> Self {
        self.default_role = role;
        self
    }

    /// 初始化调度器（不附带事件回调）
    pub async fn init(&self, config: Option<SchedulerConfig>) {
        self.init_with_event_emitter(config, None).await;
    }

    /// 初始化调度器（可附带事件回调）
    pub async fn init_with_event_emitter(
        &self,
        config: Option<SchedulerConfig>,
        event_emitter: Option<SchedulerEventEmitter>,
    ) {
        let executor = LimeSubAgentExecutor::new(self.db.clone()).with_role(self.default_role);
        let config = config.unwrap_or_default();

        let scheduler = if let Some(emitter) = event_emitter {
            SubAgentScheduler::new(config, executor).with_event_callback(move |event| {
                match serde_json::to_value(&event) {
                    Ok(payload) => emitter(&payload),
                    Err(err) => warn!("序列化调度事件失败: {}", err),
                }
            })
        } else {
            SubAgentScheduler::new(config, executor)
        };

        *self.scheduler.write().await = Some(scheduler);
        info!(
            "Lime SubAgent 调度器初始化完成 (默认角色: {})",
            self.default_role
        );
    }

    /// 执行任务
    ///
    /// 根据调度器的默认角色自动对每个任务应用工具限制。
    pub async fn execute(
        &self,
        tasks: Vec<SubAgentTask>,
        parent_context: Option<&AgentContext>,
    ) -> SchedulerResult<SchedulerExecutionResult> {
        self.execute_with_role(tasks, parent_context, self.default_role)
            .await
    }

    /// 使用指定角色执行任务
    ///
    /// 角色的工具限制会应用到每个任务上（与任务自身的 allowed_tools 取交集）。
    pub async fn execute_with_role(
        &self,
        tasks: Vec<SubAgentTask>,
        parent_context: Option<&AgentContext>,
        role: SubAgentRole,
    ) -> SchedulerResult<SchedulerExecutionResult> {
        let scheduler = self.scheduler.read().await;
        let scheduler = scheduler
            .as_ref()
            .ok_or_else(|| SchedulerError::ContextError("调度器未初始化".to_string()))?;

        // 应用角色工具限制
        let tasks: Vec<SubAgentTask> = tasks.into_iter().map(|t| role.apply_to_task(t)).collect();

        scheduler.execute(tasks, parent_context).await
    }

    /// 取消执行
    pub async fn cancel(&self) {
        if let Some(scheduler) = self.scheduler.read().await.as_ref() {
            scheduler.cancel().await;
        }
    }
}

// ---------------------------------------------------------------------------
// SubAgentProgressEvent
// ---------------------------------------------------------------------------

/// Tauri 事件：SubAgent 进度
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubAgentProgressEvent {
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
    /// 进度百分比
    pub percentage: f64,
    /// 当前任务
    pub current_tasks: Vec<String>,
    /// SubAgent 角色
    pub role: Option<String>,
}

impl From<SchedulerProgress> for SubAgentProgressEvent {
    fn from(progress: SchedulerProgress) -> Self {
        Self {
            total: progress.total,
            completed: progress.completed,
            failed: progress.failed,
            running: progress.running,
            pending: progress.pending,
            skipped: progress.skipped,
            cancelled: progress.cancelled,
            percentage: progress.percentage,
            current_tasks: progress.current_tasks,
            role: None,
        }
    }
}

impl SubAgentProgressEvent {
    /// 附加角色信息
    pub fn with_role(mut self, role: SubAgentRole) -> Self {
        self.role = Some(role.to_string());
        self
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_role_default_is_explorer() {
        assert_eq!(SubAgentRole::default(), SubAgentRole::Explorer);
    }

    #[test]
    fn test_explorer_allowed_tools() {
        let role = SubAgentRole::Explorer;
        let tools = role.allowed_tools();
        assert!(tools.contains(&"read_file"));
        assert!(tools.contains(&"grep"));
        assert!(tools.contains(&"glob"));
        assert!(tools.contains(&"list_directory"));
        assert!(tools.contains(&"lsp_query"));
        assert!(!tools.contains(&"write_file"));
    }

    #[test]
    fn test_planner_allowed_tools() {
        let role = SubAgentRole::Planner;
        let tools = role.allowed_tools();
        assert!(tools.contains(&"read_file"));
        assert!(tools.contains(&"write_file"));
        assert!(!tools.contains(&"lsp_query"));
    }

    #[test]
    fn test_executor_no_restriction() {
        let role = SubAgentRole::Executor;
        assert!(role.allowed_tools().is_empty());
        assert!(role.is_tool_allowed("anything"));
    }

    #[test]
    fn test_is_tool_allowed() {
        let explorer = SubAgentRole::Explorer;
        assert!(explorer.is_tool_allowed("read_file"));
        assert!(!explorer.is_tool_allowed("write_file"));
        assert!(!explorer.is_tool_allowed("execute_command"));
    }

    #[test]
    fn test_apply_to_task_explorer() {
        let role = SubAgentRole::Explorer;
        let task = SubAgentTask::new("t1", "explore", "test prompt");
        let task = role.apply_to_task(task);

        let allowed = task.allowed_tools.unwrap();
        assert!(allowed.contains(&"read_file".to_string()));
        assert!(!allowed.contains(&"write_file".to_string()));
    }

    #[test]
    fn test_apply_to_task_executor_no_change() {
        let role = SubAgentRole::Executor;
        let task = SubAgentTask::new("t1", "code", "test prompt");
        let task = role.apply_to_task(task);

        assert!(task.allowed_tools.is_none());
    }

    #[test]
    fn test_apply_to_task_intersection() {
        let role = SubAgentRole::Explorer;
        // 任务自身只允许 read_file 和 write_file
        let task = SubAgentTask::new("t1", "explore", "test")
            .with_allowed_tools(vec!["read_file", "write_file"]);
        let task = role.apply_to_task(task);

        // Explorer 不允许 write_file，交集只剩 read_file
        let allowed = task.allowed_tools.unwrap();
        assert_eq!(allowed, vec!["read_file".to_string()]);
    }

    #[test]
    fn test_role_display() {
        assert_eq!(SubAgentRole::Explorer.to_string(), "explorer");
        assert_eq!(SubAgentRole::Planner.to_string(), "planner");
        assert_eq!(SubAgentRole::Executor.to_string(), "executor");
    }

    #[test]
    fn test_role_serde_roundtrip() {
        let role = SubAgentRole::Planner;
        let json = serde_json::to_string(&role).unwrap();
        assert_eq!(json, "\"planner\"");
        let deserialized: SubAgentRole = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, role);
    }

    #[test]
    fn test_role_max_turns() {
        assert_eq!(SubAgentRole::Explorer.max_turns(), 15);
        assert_eq!(SubAgentRole::Planner.max_turns(), 10);
        assert_eq!(SubAgentRole::Executor.max_turns(), 30);
    }

    #[test]
    fn test_role_max_result_length() {
        assert_eq!(SubAgentRole::Explorer.max_result_length(), 2000);
        assert_eq!(SubAgentRole::Planner.max_result_length(), 4000);
        assert_eq!(SubAgentRole::Executor.max_result_length(), 0);
    }

    #[test]
    fn test_progress_event_with_role() {
        let event = SubAgentProgressEvent {
            total: 3,
            completed: 1,
            failed: 0,
            running: 1,
            pending: 1,
            skipped: 0,
            cancelled: false,
            percentage: 33.3,
            current_tasks: vec!["task-1".to_string()],
            role: None,
        };
        let event = event.with_role(SubAgentRole::Explorer);
        assert_eq!(event.role, Some("explorer".to_string()));
    }
}
