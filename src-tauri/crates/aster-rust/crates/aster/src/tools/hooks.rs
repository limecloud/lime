//! 工具钩子系统
//!
//! 为工具执行提供钩子支持，允许在工具执行前后触发自定义逻辑

use anyhow::Result;
use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use super::context::{ToolContext, ToolResult};

/// 钩子触发时机
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum HookTrigger {
    /// 工具执行前
    PreExecution,
    /// 工具执行后
    PostExecution,
    /// 工具执行失败时
    OnError,
}

/// 钩子执行上下文
#[derive(Debug, Clone)]
pub struct HookContext {
    /// 工具名称
    pub tool_name: String,
    /// 工具参数
    pub tool_params: serde_json::Value,
    /// 工具执行结果（仅在 PostExecution 时有效）
    pub tool_result: Option<ToolResult>,
    /// 错误信息（仅在 OnError 时有效）
    pub error_message: Option<String>,
    /// 工具执行上下文
    pub tool_context: ToolContext,
    /// 额外元数据
    pub metadata: HashMap<String, String>,
}

impl HookContext {
    pub fn new(
        tool_name: String,
        tool_params: serde_json::Value,
        tool_context: ToolContext,
    ) -> Self {
        Self {
            tool_name,
            tool_params,
            tool_result: None,
            error_message: None,
            tool_context,
            metadata: HashMap::new(),
        }
    }

    pub fn with_result(mut self, result: ToolResult) -> Self {
        self.tool_result = Some(result);
        self
    }

    pub fn with_error(mut self, error: String) -> Self {
        self.error_message = Some(error);
        self
    }

    pub fn with_metadata(mut self, key: String, value: String) -> Self {
        self.metadata.insert(key, value);
        self
    }
}

/// 工具钩子特征
#[async_trait]
pub trait ToolHook: Send + Sync {
    /// 钩子名称
    fn name(&self) -> &str;

    /// 钩子描述
    fn description(&self) -> &str;

    /// 执行钩子
    async fn execute(&self, context: &HookContext) -> Result<()>;

    /// 检查是否应该执行此钩子
    fn should_execute(&self, _context: &HookContext) -> bool {
        true // 默认总是执行
    }

    /// 钩子优先级（数字越小优先级越高）
    fn priority(&self) -> u32 {
        100
    }
}

/// 日志钩子 - 记录工具执行日志
pub struct LoggingHook {
    name: String,
    log_level: tracing::Level,
}

impl LoggingHook {
    pub fn new(name: String, log_level: tracing::Level) -> Self {
        Self { name, log_level }
    }
}

#[async_trait]
impl ToolHook for LoggingHook {
    fn name(&self) -> &str {
        &self.name
    }

    fn description(&self) -> &str {
        "记录工具执行日志"
    }

    async fn execute(&self, context: &HookContext) -> Result<()> {
        match self.log_level {
            tracing::Level::ERROR => {
                tracing::error!(
                    tool = %context.tool_name,
                    params = %context.tool_params,
                    "工具执行"
                );
            }
            tracing::Level::WARN => {
                tracing::warn!(
                    tool = %context.tool_name,
                    params = %context.tool_params,
                    "工具执行"
                );
            }
            tracing::Level::INFO => {
                tracing::info!(
                    tool = %context.tool_name,
                    params = %context.tool_params,
                    "工具执行"
                );
            }
            tracing::Level::DEBUG => {
                tracing::debug!(
                    tool = %context.tool_name,
                    params = %context.tool_params,
                    "工具执行"
                );
            }
            tracing::Level::TRACE => {
                tracing::trace!(
                    tool = %context.tool_name,
                    params = %context.tool_params,
                    "工具执行"
                );
            }
        }
        Ok(())
    }

    fn priority(&self) -> u32 {
        10 // 高优先级，确保日志记录
    }
}

/// 文件操作钩子 - 在文件操作前后执行特定逻辑
pub struct FileOperationHook {
    name: String,
    target_tools: Vec<String>,
}

impl FileOperationHook {
    pub fn new(name: String, target_tools: Vec<String>) -> Self {
        Self { name, target_tools }
    }
}

#[async_trait]
impl ToolHook for FileOperationHook {
    fn name(&self) -> &str {
        &self.name
    }

    fn description(&self) -> &str {
        "文件操作钩子"
    }

    async fn execute(&self, context: &HookContext) -> Result<()> {
        // 检查是否是文件操作工具
        if self
            .target_tools
            .iter()
            .any(|tool| context.tool_name.contains(tool))
        {
            tracing::info!("文件操作检测: 工具 {} 正在操作文件", context.tool_name);

            // 可以在这里添加文件备份、权限检查等逻辑
            if let Some(path) = context.tool_params.get("path").and_then(|p| p.as_str()) {
                tracing::debug!("操作文件路径: {}", path);
            }
        }
        Ok(())
    }

    fn should_execute(&self, context: &HookContext) -> bool {
        self.target_tools
            .iter()
            .any(|tool| context.tool_name.contains(tool))
    }
}

/// 错误跟踪钩子 - 跟踪和学习错误模式
pub struct ErrorTrackingHook {
    name: String,
    error_history: Arc<RwLock<HashMap<String, Vec<String>>>>,
}

impl ErrorTrackingHook {
    pub fn new(name: String) -> Self {
        Self {
            name,
            error_history: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// 获取工具的错误历史
    pub async fn get_error_history(&self, tool_name: &str) -> Vec<String> {
        let history = self.error_history.read().await;
        history.get(tool_name).cloned().unwrap_or_default()
    }

    /// 检查是否是重复错误
    pub async fn is_repeated_error(&self, tool_name: &str, error: &str) -> bool {
        let history = self.error_history.read().await;
        if let Some(errors) = history.get(tool_name) {
            errors
                .iter()
                .any(|e| e.contains(error) || error.contains(e))
        } else {
            false
        }
    }
}

#[async_trait]
impl ToolHook for ErrorTrackingHook {
    fn name(&self) -> &str {
        &self.name
    }

    fn description(&self) -> &str {
        "跟踪工具执行错误"
    }

    async fn execute(&self, context: &HookContext) -> Result<()> {
        if let Some(error_msg) = &context.error_message {
            let mut history = self.error_history.write().await;
            let tool_errors = history
                .entry(context.tool_name.clone())
                .or_insert_with(Vec::new);

            // 避免重复记录相同错误
            if !tool_errors.iter().any(|e| e == error_msg) {
                tool_errors.push(error_msg.clone());

                // 限制历史记录数量
                if tool_errors.len() > 10 {
                    tool_errors.remove(0);
                }

                tracing::warn!(
                    tool = %context.tool_name,
                    error = %error_msg,
                    "记录工具错误"
                );
            }
        }
        Ok(())
    }

    fn should_execute(&self, context: &HookContext) -> bool {
        context.error_message.is_some()
    }
}

/// 钩子集合类型别名
type HookCollection = HashMap<HookTrigger, Vec<Box<dyn ToolHook>>>;

/// 工具钩子管理器
pub struct ToolHookManager {
    hooks: Arc<RwLock<HookCollection>>,
    enabled: bool,
}

impl ToolHookManager {
    /// 创建新的钩子管理器
    pub fn new(enabled: bool) -> Self {
        Self {
            hooks: Arc::new(RwLock::new(HashMap::new())),
            enabled,
        }
    }

    /// 注册钩子
    pub async fn register_hook(&self, trigger: HookTrigger, hook: Box<dyn ToolHook>) {
        if !self.enabled {
            return;
        }

        let mut hooks = self.hooks.write().await;
        let hook_list = hooks.entry(trigger).or_insert_with(Vec::new);
        hook_list.push(hook);

        // 按优先级排序
        hook_list.sort_by_key(|h| h.priority());
    }

    /// 触发钩子
    pub async fn trigger_hooks(&self, trigger: HookTrigger, context: &HookContext) -> Result<()> {
        if !self.enabled {
            return Ok(());
        }

        let hooks = self.hooks.read().await;
        if let Some(hook_list) = hooks.get(&trigger) {
            for hook in hook_list {
                if hook.should_execute(context) {
                    if let Err(e) = hook.execute(context).await {
                        tracing::warn!("钩子 '{}' 执行失败: {}", hook.name(), e);
                    }
                }
            }
        }

        Ok(())
    }

    /// 获取已注册的钩子数量
    pub async fn hook_count(&self, trigger: HookTrigger) -> usize {
        let hooks = self.hooks.read().await;
        hooks.get(&trigger).map(|list| list.len()).unwrap_or(0)
    }

    /// 检查是否启用
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    /// 启用/禁用钩子系统
    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    /// 注册默认钩子
    pub async fn register_default_hooks(&self) {
        // 注册日志钩子
        self.register_hook(
            HookTrigger::PreExecution,
            Box::new(LoggingHook::new(
                "pre_execution_log".to_string(),
                tracing::Level::DEBUG,
            )),
        )
        .await;

        self.register_hook(
            HookTrigger::PostExecution,
            Box::new(LoggingHook::new(
                "post_execution_log".to_string(),
                tracing::Level::DEBUG,
            )),
        )
        .await;

        // 注册文件操作钩子
        self.register_hook(
            HookTrigger::PreExecution,
            Box::new(FileOperationHook::new(
                "file_operation_check".to_string(),
                vec!["Write".to_string(), "Edit".to_string(), "Read".to_string()],
            )),
        )
        .await;

        // 注册错误跟踪钩子
        self.register_hook(
            HookTrigger::OnError,
            Box::new(ErrorTrackingHook::new("error_tracker".to_string())),
        )
        .await;
    }
}

impl Default for ToolHookManager {
    fn default() -> Self {
        Self::new(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct TestHook {
        name: String,
        executed: Arc<RwLock<bool>>,
    }

    impl TestHook {
        fn new(name: String) -> (Self, Arc<RwLock<bool>>) {
            let executed = Arc::new(RwLock::new(false));
            let hook = Self {
                name,
                executed: executed.clone(),
            };
            (hook, executed)
        }
    }

    #[async_trait]
    impl ToolHook for TestHook {
        fn name(&self) -> &str {
            &self.name
        }

        fn description(&self) -> &str {
            "测试钩子"
        }

        async fn execute(&self, _context: &HookContext) -> Result<()> {
            let mut executed = self.executed.write().await;
            *executed = true;
            Ok(())
        }
    }

    fn create_test_context() -> HookContext {
        let tool_context = ToolContext::new(PathBuf::from("/tmp"))
            .with_session_id("test-session")
            .with_user("test-user");

        HookContext::new(
            "TestTool".to_string(),
            serde_json::json!({"test": "value"}),
            tool_context,
        )
    }

    #[tokio::test]
    async fn test_hook_manager_creation() {
        let manager = ToolHookManager::new(true);
        assert!(manager.is_enabled());

        let manager_disabled = ToolHookManager::new(false);
        assert!(!manager_disabled.is_enabled());
    }

    #[tokio::test]
    async fn test_hook_registration_and_execution() {
        let manager = ToolHookManager::new(true);
        let (hook, executed) = TestHook::new("test_hook".to_string());

        manager
            .register_hook(HookTrigger::PreExecution, Box::new(hook))
            .await;

        assert_eq!(manager.hook_count(HookTrigger::PreExecution).await, 1);

        let context = create_test_context();
        manager
            .trigger_hooks(HookTrigger::PreExecution, &context)
            .await
            .unwrap();

        let was_executed = *executed.read().await;
        assert!(was_executed);
    }

    #[tokio::test]
    async fn test_error_tracking_hook() {
        let hook = ErrorTrackingHook::new("error_tracker".to_string());

        let context = create_test_context().with_error("Test error message".to_string());

        hook.execute(&context).await.unwrap();

        let history = hook.get_error_history("TestTool").await;
        assert_eq!(history.len(), 1);
        assert_eq!(history[0], "Test error message");

        let is_repeated = hook.is_repeated_error("TestTool", "Test error").await;
        assert!(is_repeated);
    }

    #[tokio::test]
    async fn test_file_operation_hook() {
        let hook = FileOperationHook::new("file_hook".to_string(), vec!["Write".to_string()]);

        let context = create_test_context();
        assert!(!hook.should_execute(&context)); // TestTool 不包含 "Write"，应该不匹配

        let write_context = HookContext::new(
            "WriteTool".to_string(),
            serde_json::json!({"path": "/test/file.txt"}),
            ToolContext::new(PathBuf::from("/tmp")),
        );
        assert!(hook.should_execute(&write_context)); // WriteTool 包含 "Write"，应该匹配
    }
}
