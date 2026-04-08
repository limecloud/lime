//! Hook 类型定义
//!

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Hook 事件类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum HookEvent {
    /// 工具执行前
    PreToolUse,
    /// 工具执行后
    PostToolUse,
    /// 工具执行失败后
    PostToolUseFailure,
    /// 通知事件
    Notification,
    /// 用户提交提示
    UserPromptSubmit,
    /// 会话开始
    SessionStart,
    /// 会话结束
    SessionEnd,
    /// 停止事件
    Stop,
    /// 子代理开始
    SubagentStart,
    /// 子代理停止
    SubagentStop,
    /// 压缩前
    PreCompact,
    /// 权限请求
    PermissionRequest,
    // CLI 级别事件
    /// 设置前
    BeforeSetup,
    /// 设置后
    AfterSetup,
    /// 命令加载完成
    CommandsLoaded,
    /// 工具加载完成
    ToolsLoaded,
    /// MCP 配置加载完成
    McpConfigsLoaded,
    /// 插件初始化后
    PluginsInitialized,
    /// Hooks 执行后
    AfterHooks,
}

impl std::fmt::Display for HookEvent {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HookEvent::PreToolUse => write!(f, "PreToolUse"),
            HookEvent::PostToolUse => write!(f, "PostToolUse"),
            HookEvent::PostToolUseFailure => write!(f, "PostToolUseFailure"),
            HookEvent::Notification => write!(f, "Notification"),
            HookEvent::UserPromptSubmit => write!(f, "UserPromptSubmit"),
            HookEvent::SessionStart => write!(f, "SessionStart"),
            HookEvent::SessionEnd => write!(f, "SessionEnd"),
            HookEvent::Stop => write!(f, "Stop"),
            HookEvent::SubagentStart => write!(f, "SubagentStart"),
            HookEvent::SubagentStop => write!(f, "SubagentStop"),
            HookEvent::PreCompact => write!(f, "PreCompact"),
            HookEvent::PermissionRequest => write!(f, "PermissionRequest"),
            HookEvent::BeforeSetup => write!(f, "BeforeSetup"),
            HookEvent::AfterSetup => write!(f, "AfterSetup"),
            HookEvent::CommandsLoaded => write!(f, "CommandsLoaded"),
            HookEvent::ToolsLoaded => write!(f, "ToolsLoaded"),
            HookEvent::McpConfigsLoaded => write!(f, "McpConfigsLoaded"),
            HookEvent::PluginsInitialized => write!(f, "PluginsInitialized"),
            HookEvent::AfterHooks => write!(f, "AfterHooks"),
        }
    }
}

/// Hook 类型
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HookType {
    /// 执行 shell 命令
    Command,
    /// 调用 MCP 服务器工具
    Mcp,
    /// LLM 提示评估
    Prompt,
    /// 代理验证器
    Agent,
    /// HTTP 回调
    Url,
}

/// 默认超时时间（毫秒）
pub const DEFAULT_HOOK_TIMEOUT: u64 = 30000;

/// Command Hook 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandHookConfig {
    /// 执行的命令
    pub command: String,
    /// 命令参数
    #[serde(default)]
    pub args: Vec<String>,
    /// 环境变量
    #[serde(default)]
    pub env: HashMap<String, String>,
    /// 超时时间（毫秒）
    #[serde(default = "default_timeout")]
    pub timeout: u64,
    /// 是否阻塞
    #[serde(default = "default_blocking")]
    pub blocking: bool,
    /// 匹配条件
    #[serde(default)]
    pub matcher: Option<String>,
}

/// Prompt Hook 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptHookConfig {
    /// LLM 提示模板
    pub prompt: String,
    /// 使用的模型
    #[serde(default)]
    pub model: Option<String>,
    /// 超时时间（毫秒）
    #[serde(default = "default_timeout")]
    pub timeout: u64,
    /// 是否阻塞
    #[serde(default = "default_blocking")]
    pub blocking: bool,
    /// 匹配条件
    #[serde(default)]
    pub matcher: Option<String>,
}

/// Agent Hook 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentHookConfig {
    /// 代理类型或名称
    pub agent_type: String,
    /// 代理配置
    #[serde(default)]
    pub agent_config: Option<serde_json::Value>,
    /// 超时时间（毫秒）
    #[serde(default = "default_agent_timeout")]
    pub timeout: u64,
    /// 是否阻塞
    #[serde(default = "default_blocking")]
    pub blocking: bool,
    /// 匹配条件
    #[serde(default)]
    pub matcher: Option<String>,
}

/// MCP Hook 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpHookConfig {
    /// MCP 服务器名称
    pub server: String,
    /// 要调用的工具名称
    pub tool: String,
    /// 工具参数
    #[serde(default)]
    pub tool_args: Option<serde_json::Value>,
    /// 超时时间（毫秒）
    #[serde(default = "default_timeout")]
    pub timeout: u64,
    /// 是否阻塞
    #[serde(default = "default_blocking")]
    pub blocking: bool,
    /// 匹配条件
    #[serde(default)]
    pub matcher: Option<String>,
}

/// URL Hook 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UrlHookConfig {
    /// 回调 URL
    pub url: String,
    /// HTTP 方法
    #[serde(default = "default_method")]
    pub method: HttpMethod,
    /// 请求头
    #[serde(default)]
    pub headers: HashMap<String, String>,
    /// 超时时间（毫秒）
    #[serde(default = "default_url_timeout")]
    pub timeout: u64,
    /// 是否阻塞
    #[serde(default)]
    pub blocking: bool,
    /// 匹配条件
    #[serde(default)]
    pub matcher: Option<String>,
}

/// HTTP 方法
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "UPPERCASE")]
pub enum HttpMethod {
    Get,
    #[default]
    Post,
    Put,
    Patch,
}

/// Hook 配置（联合类型）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum HookConfig {
    Command(CommandHookConfig),
    Mcp(McpHookConfig),
    Prompt(PromptHookConfig),
    Agent(AgentHookConfig),
    Url(UrlHookConfig),
}

impl HookConfig {
    /// 获取 matcher
    pub fn matcher(&self) -> Option<&str> {
        match self {
            HookConfig::Command(c) => c.matcher.as_deref(),
            HookConfig::Mcp(c) => c.matcher.as_deref(),
            HookConfig::Prompt(c) => c.matcher.as_deref(),
            HookConfig::Agent(c) => c.matcher.as_deref(),
            HookConfig::Url(c) => c.matcher.as_deref(),
        }
    }

    /// 是否阻塞
    pub fn is_blocking(&self) -> bool {
        match self {
            HookConfig::Command(c) => c.blocking,
            HookConfig::Mcp(c) => c.blocking,
            HookConfig::Prompt(c) => c.blocking,
            HookConfig::Agent(c) => c.blocking,
            HookConfig::Url(c) => c.blocking,
        }
    }
}

/// 错误类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HookErrorType {
    PermissionDenied,
    ExecutionFailed,
    Timeout,
    InvalidInput,
}

/// 通知类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationType {
    PermissionPrompt,
    IdlePrompt,
    AuthSuccess,
    ElicitationDialog,
}

/// 会话启动来源
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionSource {
    Startup,
    Resume,
    Clear,
    Compact,
}

/// 会话结束原因
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionEndReason {
    Clear,
    Logout,
    PromptInputExit,
    Other,
}

/// 压缩触发方式
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CompactTrigger {
    Manual,
    Auto,
}

/// Hook 输入数据
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HookInput {
    /// 事件类型
    pub event: Option<HookEvent>,
    /// 工具名称
    #[serde(default)]
    pub tool_name: Option<String>,
    /// 工具输入
    #[serde(default)]
    pub tool_input: Option<serde_json::Value>,
    /// 工具输出
    #[serde(default)]
    pub tool_output: Option<String>,
    /// 消息
    #[serde(default)]
    pub message: Option<String>,
    /// 会话 ID
    #[serde(default)]
    pub session_id: Option<String>,
    /// 工具使用 ID
    #[serde(default)]
    pub tool_use_id: Option<String>,
    /// 错误信息
    #[serde(default)]
    pub error: Option<String>,
    /// 错误类型
    #[serde(default)]
    pub error_type: Option<HookErrorType>,
    /// 是否被中断
    #[serde(default)]
    pub is_interrupt: Option<bool>,
    /// 是否超时
    #[serde(default)]
    pub is_timeout: Option<bool>,
    /// 代理 ID
    #[serde(default)]
    pub agent_id: Option<String>,
    /// 代理类型
    #[serde(default)]
    pub agent_type: Option<String>,
    /// 执行结果
    #[serde(default)]
    pub result: Option<serde_json::Value>,
    /// 通知类型
    #[serde(default)]
    pub notification_type: Option<NotificationType>,
    /// 会话启动来源
    #[serde(default)]
    pub source: Option<SessionSource>,
    /// 会话结束原因
    #[serde(default)]
    pub reason: Option<SessionEndReason>,
    /// 压缩触发方式
    #[serde(default)]
    pub trigger: Option<CompactTrigger>,
    /// 当前 token 数
    #[serde(default)]
    pub current_tokens: Option<u64>,
}

/// Hook 决策
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HookDecision {
    Allow,
    Deny,
    Block,
}

/// Hook 执行结果
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HookResult {
    /// 是否成功
    pub success: bool,
    /// 输出内容
    #[serde(default)]
    pub output: Option<String>,
    /// 错误信息
    #[serde(default)]
    pub error: Option<String>,
    /// 是否被阻塞
    #[serde(default)]
    pub blocked: bool,
    /// 阻塞消息
    #[serde(default)]
    pub block_message: Option<String>,
    /// 是否异步执行
    #[serde(default)]
    pub is_async: bool,
    /// Hook 决策
    #[serde(default)]
    pub decision: Option<HookDecision>,
    /// 决策原因
    #[serde(default)]
    pub reason: Option<String>,
}

impl HookResult {
    /// 创建成功结果
    pub fn success(output: Option<String>) -> Self {
        Self {
            success: true,
            output,
            ..Default::default()
        }
    }

    /// 创建失败结果
    pub fn failure(error: String) -> Self {
        Self {
            success: false,
            error: Some(error),
            ..Default::default()
        }
    }

    /// 创建阻塞结果
    pub fn blocked(message: String) -> Self {
        Self {
            success: false,
            blocked: true,
            block_message: Some(message),
            ..Default::default()
        }
    }
}

// 默认值函数
fn default_timeout() -> u64 {
    DEFAULT_HOOK_TIMEOUT
}

fn default_agent_timeout() -> u64 {
    60000
}

fn default_url_timeout() -> u64 {
    10000
}

fn default_blocking() -> bool {
    true
}

fn default_method() -> HttpMethod {
    HttpMethod::Post
}

/// 旧版 Hook 配置（兼容性）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LegacyHookConfig {
    pub event: HookEvent,
    #[serde(default)]
    pub matcher: Option<String>,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default = "default_timeout")]
    pub timeout: u64,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default = "default_blocking")]
    pub blocking: bool,
}

impl From<LegacyHookConfig> for (HookEvent, HookConfig) {
    fn from(legacy: LegacyHookConfig) -> Self {
        (
            legacy.event,
            HookConfig::Command(CommandHookConfig {
                command: legacy.command,
                args: legacy.args,
                env: legacy.env,
                timeout: legacy.timeout,
                blocking: legacy.blocking,
                matcher: legacy.matcher,
            }),
        )
    }
}
