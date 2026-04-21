//! Hook 类型定义
//!

use futures::future::BoxFuture;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

/// Hook 事件类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum HookEvent {
    /// 任务创建
    TaskCreated,
    /// 任务完成
    TaskCompleted,
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
            HookEvent::TaskCreated => write!(f, "TaskCreated"),
            HookEvent::TaskCompleted => write!(f, "TaskCompleted"),
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
    /// 代理类型或名称（兼容旧配置；current 事实源优先看 prompt/model）
    #[serde(default = "default_agent_type")]
    pub agent_type: String,
    /// 直接描述验证目标的 prompt（current 事实源）
    #[serde(default)]
    pub prompt: Option<String>,
    /// 使用的模型（current 事实源）
    #[serde(default)]
    pub model: Option<String>,
    /// 代理配置（兼容旧配置；可回退解析 prompt/model/max_turns）
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

/// Skill / agent frontmatter hooks 配置
///
/// 对齐参考运行时的 `event -> matcher[] -> hooks[]` 结构，
/// 但最终仍会收口到 Lime 当前的 `HookConfig` 执行边界。
pub type FrontmatterHooks = HashMap<HookEvent, Vec<FrontmatterHookMatcher>>;

/// frontmatter hook matcher
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FrontmatterHookMatcher {
    /// 可选的外层 matcher
    #[serde(default)]
    pub matcher: Option<String>,
    /// 命中的 hook 列表
    #[serde(default)]
    pub hooks: Vec<FrontmatterHookCommand>,
}

/// frontmatter hook 注册结果
#[derive(Debug, Clone)]
pub struct FrontmatterHookRegistration {
    pub config: HookConfig,
    pub once: bool,
}

/// frontmatter command hook 配置
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FrontmatterCommandHookConfig {
    pub command: String,
    #[serde(default)]
    pub timeout: Option<u64>,
    #[serde(default)]
    pub once: bool,
    #[serde(default)]
    pub shell: Option<String>,
    #[serde(default, rename = "if")]
    pub if_condition: Option<String>,
    #[serde(default, rename = "statusMessage")]
    pub status_message: Option<String>,
    #[serde(default, rename = "async")]
    pub async_mode: bool,
    #[serde(default, rename = "asyncRewake")]
    pub async_rewake: bool,
}

/// frontmatter prompt hook 配置
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FrontmatterPromptHookConfig {
    pub prompt: String,
    #[serde(default)]
    pub timeout: Option<u64>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub once: bool,
    #[serde(default, rename = "if")]
    pub if_condition: Option<String>,
    #[serde(default, rename = "statusMessage")]
    pub status_message: Option<String>,
}

/// frontmatter agent hook 配置
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FrontmatterAgentHookConfig {
    pub prompt: String,
    #[serde(default)]
    pub timeout: Option<u64>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub once: bool,
    #[serde(default, rename = "if")]
    pub if_condition: Option<String>,
    #[serde(default, rename = "statusMessage")]
    pub status_message: Option<String>,
}

/// frontmatter http hook 配置
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FrontmatterHttpHookConfig {
    pub url: String,
    #[serde(default)]
    pub timeout: Option<u64>,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub once: bool,
    #[serde(default, rename = "if")]
    pub if_condition: Option<String>,
    #[serde(default, rename = "statusMessage")]
    pub status_message: Option<String>,
    #[serde(default, rename = "allowedEnvVars")]
    pub allowed_env_vars: Option<Vec<String>>,
}

/// frontmatter hook 命令
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum FrontmatterHookCommand {
    Command(FrontmatterCommandHookConfig),
    Prompt(FrontmatterPromptHookConfig),
    Agent(FrontmatterAgentHookConfig),
    #[serde(alias = "url")]
    Http(FrontmatterHttpHookConfig),
}

impl FrontmatterHookCommand {
    pub fn to_registration(
        &self,
        matcher: Option<&str>,
    ) -> Result<FrontmatterHookRegistration, String> {
        match self {
            FrontmatterHookCommand::Command(config) => {
                if config.async_rewake {
                    return Err(
                        "暂不支持 skill frontmatter command hook.asyncRewake；当前 runtime 还没有对应唤醒语义"
                            .to_string(),
                    );
                }

                if let Some(shell) = normalize_optional_text(config.shell.as_deref()) {
                    if !shell.eq_ignore_ascii_case("bash") {
                        return Err(format!(
                            "暂不支持 skill frontmatter command hook.shell='{}'；当前 runtime 只支持默认 shell 执行",
                            shell
                        ));
                    }
                }

                let resolved_matcher =
                    resolve_frontmatter_matcher(matcher, config.if_condition.as_deref())?;

                Ok(FrontmatterHookRegistration {
                    config: HookConfig::Command(CommandHookConfig {
                        command: config.command.clone(),
                        args: Vec::new(),
                        env: HashMap::new(),
                        timeout: timeout_secs_to_millis(config.timeout, default_timeout()),
                        blocking: !config.async_mode,
                        matcher: resolved_matcher,
                    }),
                    once: config.once,
                })
            }
            FrontmatterHookCommand::Prompt(config) => Ok(FrontmatterHookRegistration {
                config: HookConfig::Prompt(PromptHookConfig {
                    prompt: config.prompt.clone(),
                    model: normalize_optional_text(config.model.as_deref()),
                    timeout: timeout_secs_to_millis(config.timeout, default_timeout()),
                    blocking: true,
                    matcher: resolve_frontmatter_matcher(matcher, config.if_condition.as_deref())?,
                }),
                once: config.once,
            }),
            FrontmatterHookCommand::Agent(config) => Ok(FrontmatterHookRegistration {
                config: HookConfig::Agent(AgentHookConfig {
                    agent_type: default_agent_type(),
                    prompt: Some(config.prompt.clone()),
                    model: normalize_optional_text(config.model.as_deref()),
                    agent_config: None,
                    timeout: timeout_secs_to_millis(config.timeout, default_agent_timeout()),
                    blocking: true,
                    matcher: resolve_frontmatter_matcher(matcher, config.if_condition.as_deref())?,
                }),
                once: config.once,
            }),
            FrontmatterHookCommand::Http(config) => {
                if config
                    .allowed_env_vars
                    .as_ref()
                    .is_some_and(|items| !items.is_empty())
                {
                    return Err(
                        "暂不支持 skill frontmatter http hook.allowedEnvVars；当前 runtime 还没有 header env 白名单插值语义"
                            .to_string(),
                    );
                }

                Ok(FrontmatterHookRegistration {
                    config: HookConfig::Url(UrlHookConfig {
                        url: config.url.clone(),
                        method: HttpMethod::Post,
                        headers: config.headers.clone(),
                        timeout: timeout_secs_to_millis(config.timeout, default_url_timeout()),
                        blocking: true,
                        matcher: resolve_frontmatter_matcher(
                            matcher,
                            config.if_condition.as_deref(),
                        )?,
                    }),
                    once: config.once,
                })
            }
        }
    }
}

fn normalize_optional_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn resolve_frontmatter_matcher(
    matcher: Option<&str>,
    if_condition: Option<&str>,
) -> Result<Option<String>, String> {
    if let Some(condition) = normalize_optional_text(if_condition) {
        return Err(format!(
            "暂不支持 skill frontmatter hook.if='{}'；当前 runtime 还没有 permission-rule 过滤器",
            condition
        ));
    }

    Ok(normalize_optional_text(matcher))
}

fn timeout_secs_to_millis(timeout_secs: Option<u64>, default_millis: u64) -> u64 {
    timeout_secs
        .map(|seconds| seconds.saturating_mul(1000))
        .unwrap_or(default_millis)
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
    /// 任务 ID
    #[serde(default)]
    pub task_id: Option<String>,
    /// 任务标题
    #[serde(default)]
    pub task_subject: Option<String>,
    /// 任务描述
    #[serde(default)]
    pub task_description: Option<String>,
    /// 触发任务事件的 teammate 名称
    #[serde(default)]
    pub teammate_name: Option<String>,
    /// 关联 team 名称
    #[serde(default)]
    pub team_name: Option<String>,
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
    /// Stop hook 是否已在上层激活
    #[serde(default)]
    pub stop_hook_active: Option<bool>,
    /// Stop 前最后一条 assistant 文本
    #[serde(default)]
    pub last_assistant_message: Option<String>,
    /// 会话 ID
    #[serde(default)]
    pub session_id: Option<String>,
    /// 权限模式
    #[serde(default)]
    pub permission_mode: Option<String>,
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

pub type McpHookExecutor =
    Arc<dyn Fn(McpHookConfig, HookInput) -> BoxFuture<'static, HookResult> + Send + Sync>;

#[derive(Clone, Default)]
pub struct HookRuntimeContext {
    mcp_executor: Option<McpHookExecutor>,
}

impl HookRuntimeContext {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_mcp_executor(mut self, executor: McpHookExecutor) -> Self {
        self.mcp_executor = Some(executor);
        self
    }

    pub fn mcp_executor(&self) -> Option<&McpHookExecutor> {
        self.mcp_executor.as_ref()
    }
}

// 默认值函数
fn default_timeout() -> u64 {
    DEFAULT_HOOK_TIMEOUT
}

fn default_agent_timeout() -> u64 {
    60000
}

fn default_agent_type() -> String {
    "verifier".to_string()
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
