//! Aster Agent 命令模块
//!
//! 提供基于 Aster 框架的 Tauri 命令
//! 这是新的对话系统实现，与 native_agent_cmd.rs 并行存在
//! 支持从 ProxyCast 凭证池自动选择凭证

use crate::agent::aster_state::{ProviderConfig, SessionConfigBuilder};
use crate::agent::{
    AsterAgentState, AsterAgentWrapper, HeartbeatServiceAdapter, ProxyCastScheduler, SessionDetail,
    SessionInfo, SubAgentRole, TauriAgentEvent,
};
use crate::commands::api_key_provider_cmd::ApiKeyProviderServiceState;
use crate::commands::webview_cmd::{
    browser_execute_action_global, BrowserActionRequest, BrowserBackendType,
};
use crate::config::{GlobalConfigManager, GlobalConfigManagerState};
use crate::database::dao::agent::AgentDao;
use crate::database::DbConnection;
use crate::mcp::{McpManagerState, McpServerConfig};
use crate::services::execution_tracker_service::{ExecutionTracker, RunFinalizeOptions, RunSource};
use crate::services::heartbeat_service::HeartbeatServiceState;
use crate::services::memory_profile_prompt_service::{
    merge_system_prompt_with_memory_profile, merge_system_prompt_with_memory_sources,
};
use crate::services::web_search_prompt_service::merge_system_prompt_with_web_search;
use crate::services::web_search_runtime_service::apply_web_search_runtime_env;
use crate::services::workspace_health_service::ensure_workspace_ready_with_auto_relocate;
use crate::workspace::WorkspaceManager;
use crate::LogState;
use aster::agents::extension::{Envs, ExtensionConfig};
use aster::agents::subagent_scheduler::{SchedulerExecutionResult, SubAgentTask};
use aster::agents::{Agent, AgentEvent};
use aster::chrome_mcp::get_chrome_mcp_tools;
use aster::conversation::message::{Message, MessageContent};
use aster::permission::{
    ParameterRestriction, PermissionScope, RestrictionType, ToolPermission, ToolPermissionManager,
};
use aster::permission::{Permission, PermissionConfirmation, PrincipalType};
use aster::sandbox::{
    detect_best_sandbox, execute_in_sandbox, ResourceLimits, SandboxConfig as ProcessSandboxConfig,
};
use aster::tools::task_output_tool::TaskOutputInput;
use aster::tools::{
    BashTool, KillShellTool, PermissionBehavior, PermissionCheckResult, TaskManager,
    TaskOutputTool, TaskTool, Tool, ToolContext, ToolError, ToolOptions, ToolResult,
    MAX_OUTPUT_LENGTH,
};
use async_trait::async_trait;
use futures::StreamExt;
#[cfg(test)]
use proxycast_agent::request_tool_policy::REQUEST_TOOL_POLICY_MARKER;
use proxycast_agent::request_tool_policy::{
    merge_system_prompt_with_request_tool_policy, resolve_request_tool_policy,
    stream_reply_with_policy, ReplyAttemptError, RequestToolPolicy,
};
use proxycast_agent::{
    durable_memory_permission_pattern, is_virtual_memory_path, resolve_virtual_memory_path,
    virtual_memory_relative_path, DURABLE_MEMORY_VIRTUAL_ROOT,
};
use proxycast_services::api_key_provider_service::ApiKeyProviderService;
use proxycast_services::mcp_service::McpService;
use proxycast_services::video_generation_service::{
    CreateVideoGenerationRequest, VideoGenerationService,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio_util::sync::CancellationToken;

const DEFAULT_BASH_TIMEOUT_SECS: u64 = 300;
const MAX_BASH_TIMEOUT_SECS: u64 = 1800;
const CODE_EXECUTION_EXTENSION_NAME: &str = "code_execution";
const WORKSPACE_SANDBOX_ENABLED_ENV: &str = "PROXYCAST_WORKSPACE_SANDBOX_ENABLED";
const WORKSPACE_SANDBOX_STRICT_ENV: &str = "PROXYCAST_WORKSPACE_SANDBOX_STRICT";
const WORKSPACE_SANDBOX_NOTIFY_ENV: &str = "PROXYCAST_WORKSPACE_SANDBOX_NOTIFY_ON_FALLBACK";
const WORKSPACE_SANDBOX_FALLBACK_WARNING_CODE: &str = "workspace_sandbox_fallback";
const WORKSPACE_PATH_AUTO_CREATED_WARNING_CODE: &str = "workspace_path_auto_created";
const SOCIAL_IMAGE_TOOL_NAME: &str = "social_generate_cover_image";
const SOCIAL_IMAGE_DEFAULT_MODEL: &str = "gemini-3-pro-image-preview";
const SOCIAL_IMAGE_DEFAULT_SIZE: &str = "1024x1024";
const SOCIAL_IMAGE_DEFAULT_RESPONSE_FORMAT: &str = "url";
const PROXYCAST_CREATE_VIDEO_TASK_TOOL_NAME: &str = "proxycast_create_video_generation_task";
const PROXYCAST_CREATE_BROADCAST_TASK_TOOL_NAME: &str =
    "proxycast_create_broadcast_generation_task";
const PROXYCAST_CREATE_COVER_TASK_TOOL_NAME: &str = "proxycast_create_cover_generation_task";
const PROXYCAST_CREATE_RESOURCE_SEARCH_TASK_TOOL_NAME: &str =
    "proxycast_create_modal_resource_search_task";
const PROXYCAST_CREATE_IMAGE_TASK_TOOL_NAME: &str = "proxycast_create_image_generation_task";
const PROXYCAST_CREATE_URL_PARSE_TASK_TOOL_NAME: &str = "proxycast_create_url_parse_task";
const PROXYCAST_CREATE_TYPESETTING_TASK_TOOL_NAME: &str = "proxycast_create_typesetting_task";
const AUTO_CONTINUE_PROMPT_MARKER: &str = "【自动续写策略】";
const PROXYCAST_TOOL_METADATA_BEGIN: &str = "[ProxyCast 工具元数据开始]";
const PROXYCAST_TOOL_METADATA_END: &str = "[ProxyCast 工具元数据结束]";

static SHARED_TASK_MANAGER: OnceLock<Arc<TaskManager>> = OnceLock::new();

fn shared_task_manager() -> Arc<TaskManager> {
    SHARED_TASK_MANAGER
        .get_or_init(|| Arc::new(TaskManager::new()))
        .clone()
}

#[derive(Debug, Clone, Copy)]
struct WorkspaceSandboxPolicy {
    enabled: bool,
    strict: bool,
    notify_on_fallback: bool,
}

#[derive(Debug)]
enum WorkspaceSandboxApplyOutcome {
    Applied {
        sandbox_type: String,
    },
    DisabledByConfig,
    UnavailableFallback {
        warning_message: String,
        notify_user: bool,
    },
}

fn parse_bool_env(name: &str) -> Option<bool> {
    let raw = std::env::var(name).ok()?;
    match raw.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Some(true),
        "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

fn resolve_workspace_sandbox_policy(
    config_manager: &GlobalConfigManagerState,
) -> WorkspaceSandboxPolicy {
    let config = config_manager.config();
    let mut policy = WorkspaceSandboxPolicy {
        enabled: config.agent.workspace_sandbox.enabled,
        strict: config.agent.workspace_sandbox.strict,
        notify_on_fallback: config.agent.workspace_sandbox.notify_on_fallback,
    };

    if let Some(enabled) = parse_bool_env(WORKSPACE_SANDBOX_ENABLED_ENV) {
        policy.enabled = enabled;
    }
    if let Some(strict) = parse_bool_env(WORKSPACE_SANDBOX_STRICT_ENV) {
        policy.strict = strict;
    }
    if let Some(notify) = parse_bool_env(WORKSPACE_SANDBOX_NOTIFY_ENV) {
        policy.notify_on_fallback = notify;
    }

    policy
}

fn workspace_sandbox_platform_hint() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "Windows 当前未检测到可用本地 sandbox 执行器，建议关闭该选项或使用非严格模式。"
    }
    #[cfg(target_os = "macos")]
    {
        "macOS 需提供 sandbox-exec。"
    }
    #[cfg(target_os = "linux")]
    {
        "Linux 需安装 bwrap 或 firejail。"
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        "当前平台暂未集成本地 sandbox 执行器，建议关闭该选项。"
    }
}

fn build_workspace_sandbox_warning_message(reason: &str) -> String {
    format!("已启用 workspace 本地 sandbox，但当前环境不可用，已自动降级为普通执行。原因: {reason}")
}

/// Aster Agent 状态信息
#[derive(Debug, Serialize)]
pub struct AsterAgentStatus {
    pub initialized: bool,
    pub provider_configured: bool,
    pub provider_name: Option<String>,
    pub model_name: Option<String>,
    /// 凭证 UUID（来自凭证池）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credential_uuid: Option<String>,
}

/// Provider 配置请求
#[derive(Debug, Deserialize)]
pub struct ConfigureProviderRequest {
    #[serde(default)]
    pub provider_id: Option<String>,
    pub provider_name: String,
    pub model_name: String,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
}

/// 从凭证池配置 Provider 的请求
#[derive(Debug, Deserialize)]
pub struct ConfigureFromPoolRequest {
    /// Provider 类型 (openai, anthropic, kiro, gemini 等)
    pub provider_type: String,
    /// 模型名称
    pub model_name: String,
}

/// 初始化 Aster Agent
#[tauri::command]
pub async fn aster_agent_init(
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
) -> Result<AsterAgentStatus, String> {
    tracing::info!("[AsterAgent] 初始化 Agent");

    state.init_agent_with_db(&db).await?;
    ensure_browser_mcp_tools_registered(state.inner()).await?;
    ensure_tool_search_tool_registered(state.inner()).await?;

    let provider_config = state.get_provider_config().await;

    tracing::info!("[AsterAgent] Agent 初始化成功");

    Ok(AsterAgentStatus {
        initialized: true,
        provider_configured: provider_config.is_some(),
        provider_name: provider_config.as_ref().map(|c| c.provider_name.clone()),
        model_name: provider_config.as_ref().map(|c| c.model_name.clone()),
        credential_uuid: provider_config.and_then(|c| c.credential_uuid),
    })
}

/// 配置 Aster Agent 的 Provider
#[tauri::command]
pub async fn aster_agent_configure_provider(
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    request: ConfigureProviderRequest,
    session_id: String,
) -> Result<AsterAgentStatus, String> {
    tracing::info!(
        "[AsterAgent] 配置 Provider: {} / {}",
        request.provider_name,
        request.model_name
    );

    let config = ProviderConfig {
        provider_name: request.provider_name,
        model_name: request.model_name,
        api_key: request.api_key,
        base_url: request.base_url,
        credential_uuid: None,
    };

    state
        .configure_provider(config.clone(), &session_id, &db)
        .await?;

    Ok(AsterAgentStatus {
        initialized: true,
        provider_configured: true,
        provider_name: Some(config.provider_name),
        model_name: Some(config.model_name),
        credential_uuid: None,
    })
}

/// 从凭证池配置 Aster Agent 的 Provider
///
/// 自动从 ProxyCast 凭证池选择可用凭证并配置 Aster Provider
#[tauri::command]
pub async fn aster_agent_configure_from_pool(
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    request: ConfigureFromPoolRequest,
    session_id: String,
) -> Result<AsterAgentStatus, String> {
    tracing::info!(
        "[AsterAgent] 从凭证池配置 Provider: {} / {}",
        request.provider_type,
        request.model_name
    );

    let aster_config = state
        .configure_provider_from_pool(
            &db,
            &request.provider_type,
            &request.model_name,
            &session_id,
        )
        .await?;

    Ok(AsterAgentStatus {
        initialized: true,
        provider_configured: true,
        provider_name: Some(aster_config.provider_name),
        model_name: Some(aster_config.model_name),
        credential_uuid: Some(aster_config.credential_uuid),
    })
}

/// 获取 Aster Agent 状态
#[tauri::command]
pub async fn aster_agent_status(
    state: State<'_, AsterAgentState>,
) -> Result<AsterAgentStatus, String> {
    let provider_config = state.get_provider_config().await;
    Ok(AsterAgentStatus {
        initialized: state.is_initialized().await,
        provider_configured: provider_config.is_some(),
        provider_name: provider_config.as_ref().map(|c| c.provider_name.clone()),
        model_name: provider_config.as_ref().map(|c| c.model_name.clone()),
        credential_uuid: provider_config.and_then(|c| c.credential_uuid),
    })
}

/// 重置 Aster Agent
///
/// 清除当前 Provider 配置，下次对话时会重新从凭证池选择凭证。
/// 用于切换凭证后无需重启应用即可生效。
#[tauri::command]
pub async fn aster_agent_reset(
    state: State<'_, AsterAgentState>,
) -> Result<AsterAgentStatus, String> {
    tracing::info!("[AsterAgent] 重置 Agent Provider 配置");

    // 清除当前 Provider 配置
    state.clear_provider_config().await;

    Ok(AsterAgentStatus {
        initialized: state.is_initialized().await,
        provider_configured: false,
        provider_name: None,
        model_name: None,
        credential_uuid: None,
    })
}

/// 发送消息请求参数
#[derive(Debug, Deserialize)]
pub struct AsterChatRequest {
    pub message: String,
    #[serde(alias = "sessionId")]
    pub session_id: String,
    #[serde(alias = "eventName")]
    pub event_name: String,
    #[serde(default)]
    #[allow(dead_code)]
    pub images: Option<Vec<ImageInput>>,
    /// Provider 配置（可选，如果未配置则使用当前配置）
    #[serde(default, alias = "providerConfig")]
    pub provider_config: Option<ConfigureProviderRequest>,
    /// 项目 ID（可选，用于注入项目上下文到 System Prompt）
    #[serde(default, alias = "projectId")]
    pub project_id: Option<String>,
    /// Workspace ID（必填，用于校验会话与工作区一致性）
    #[serde(alias = "workspaceId")]
    pub workspace_id: String,
    /// 是否强制开启联网搜索工具策略
    #[serde(default, alias = "webSearch")]
    pub web_search: Option<bool>,
    /// 执行策略（react / code_orchestrated / auto）
    #[serde(default, alias = "executionStrategy")]
    pub execution_strategy: Option<AsterExecutionStrategy>,
    /// 自动续写策略（用于文稿续写等场景）
    #[serde(default, alias = "autoContinue")]
    pub auto_continue: Option<AutoContinuePayload>,
    /// 前端传入的 System Prompt（可选，优先级低于项目上下文）
    #[serde(default, alias = "systemPrompt")]
    pub system_prompt: Option<String>,
}

/// 自动续写参数
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AutoContinuePayload {
    /// 主开关
    pub enabled: bool,
    /// 快速模式
    #[serde(default, alias = "fastModeEnabled")]
    pub fast_mode_enabled: bool,
    /// 续写长度：0=短、1=中、2=长
    #[serde(default, alias = "continuationLength")]
    pub continuation_length: u8,
    /// 灵敏度：0-100
    #[serde(default)]
    pub sensitivity: u8,
    /// 来源标识
    #[serde(default)]
    pub source: Option<String>,
}

impl AutoContinuePayload {
    fn normalized(mut self) -> Self {
        self.continuation_length = self.continuation_length.min(2);
        self.sensitivity = self.sensitivity.min(100);
        self.source = self
            .source
            .as_ref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        self
    }

    fn length_instruction(&self) -> &'static str {
        match self.continuation_length.min(2) {
            0 => "短（补全 1-2 段，聚焦核心信息）",
            1 => "中（补全 3-5 段，兼顾结构与细节）",
            _ => "长（扩展为可发布草稿，结构完整）",
        }
    }

    fn sensitivity_instruction(&self) -> &'static str {
        match self.sensitivity.min(100) {
            0..=33 => "低：优先稳健延续原文表达",
            34..=66 => "中：保持一致性并适度优化表达",
            _ => "高：在不偏题前提下积极补充观点亮点",
        }
    }
}

fn build_auto_continue_system_prompt(config: &AutoContinuePayload) -> String {
    let mode_instruction = if config.fast_mode_enabled {
        "快速模式：优先产出可用结果，减少解释与冗余。"
    } else {
        "标准模式：兼顾可读性、完整性与发布可用性。"
    };
    let source = config
        .source
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("document_canvas");

    format!(
        "{AUTO_CONTINUE_PROMPT_MARKER}\n\
执行来源：{source}\n\
执行要求：\n\
1. 本轮任务是“基于已有文稿的续写”，不得重复已有内容。\n\
2. 从现有结尾自然衔接，保持原文语气、受众和主题方向。\n\
3. 续写长度：{}。\n\
4. 灵敏度（{}%）：{}。\n\
5. {}\n\
6. 输出正文时不要显式提及你看到了该策略配置。",
        config.length_instruction(),
        config.sensitivity,
        config.sensitivity_instruction(),
        mode_instruction,
    )
}

fn merge_system_prompt_with_auto_continue(
    base_prompt: Option<String>,
    auto_continue: Option<&AutoContinuePayload>,
) -> Option<String> {
    let Some(config) = auto_continue else {
        return base_prompt;
    };
    if !config.enabled {
        return base_prompt;
    }

    let auto_continue_prompt = build_auto_continue_system_prompt(config);

    match base_prompt {
        Some(base) => {
            if base.contains(AUTO_CONTINUE_PROMPT_MARKER) {
                Some(base)
            } else if base.trim().is_empty() {
                Some(auto_continue_prompt)
            } else {
                Some(format!("{base}\n\n{auto_continue_prompt}"))
            }
        }
        None => Some(auto_continue_prompt),
    }
}

/// Agent 执行策略
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum AsterExecutionStrategy {
    React,
    CodeOrchestrated,
    #[default]
    Auto,
}

impl AsterExecutionStrategy {
    fn as_db_value(self) -> &'static str {
        match self {
            Self::React => "react",
            Self::CodeOrchestrated => "code_orchestrated",
            Self::Auto => "auto",
        }
    }

    fn from_db_value(value: Option<&str>) -> Self {
        match value {
            Some("code_orchestrated") => Self::CodeOrchestrated,
            Some("auto") => Self::Auto,
            _ => Self::Auto,
        }
    }

    fn effective_for_message(self, message: &str) -> Self {
        if should_force_react_for_message(message) {
            return Self::React;
        }

        match self {
            Self::Auto if should_use_code_orchestrated_for_message(message) => {
                Self::CodeOrchestrated
            }
            Self::Auto => Self::React,
            _ => self,
        }
    }
}

fn should_force_react_for_message(message: &str) -> bool {
    let lowered = message.to_lowercase();
    let default_hints = [
        "tool_search",
        "调用 tool_search",
        "调用tool_search",
        "use tool_search",
        "call tool_search",
        "websearch",
        "web search",
        "web_search",
        "webfetch",
        "web fetch",
        "web_fetch",
    ];
    resolve_intent_hints("PROXYCAST_FORCE_REACT_HINTS", &default_hints)
        .iter()
        .any(|kw| lowered.contains(kw))
}

fn should_use_code_orchestrated_for_message(message: &str) -> bool {
    let lowered = message.to_lowercase();
    // 默认不做消息关键词硬编码推断，Auto 模式优先走 ReAct。
    // 如需启用自动切换，可通过环境变量 PROXYCAST_CODE_ORCHESTRATED_HINTS 显式配置。
    resolve_intent_hints("PROXYCAST_CODE_ORCHESTRATED_HINTS", &[])
        .iter()
        .any(|kw| lowered.contains(kw))
}

fn resolve_intent_hints(env_key: &str, defaults: &[&str]) -> Vec<String> {
    if let Ok(raw) = std::env::var(env_key) {
        let parsed = raw
            .split(',')
            .map(|item| item.trim().to_lowercase())
            .filter(|item| !item.is_empty())
            .collect::<Vec<_>>();
        if !parsed.is_empty() {
            return parsed;
        }
    }

    defaults.iter().map(|item| item.to_string()).collect()
}

fn should_fallback_to_react_from_code_orchestrated(error: &ReplyAttemptError) -> bool {
    if !error.emitted_any {
        return true;
    }

    let lowered = error.message.to_lowercase();
    let recoverable_hints = ["unknown subscript", "tool_search_analysis", "web_scraping"];

    recoverable_hints.iter().any(|hint| lowered.contains(hint))
}

async fn ensure_code_execution_extension_enabled(agent: &Agent) -> Result<bool, String> {
    let extension_configs = agent.get_extension_configs().await;
    if extension_configs
        .iter()
        .any(|cfg| cfg.name() == CODE_EXECUTION_EXTENSION_NAME)
    {
        return Ok(false);
    }

    let extension = ExtensionConfig::Platform {
        name: CODE_EXECUTION_EXTENSION_NAME.to_string(),
        description: "Execute JavaScript code in a sandboxed environment".to_string(),
        bundled: Some(true),
        available_tools: vec![],
        deferred_loading: false,
        always_expose_tools: Vec::new(),
        allowed_caller: None,
    };

    agent
        .add_extension(extension)
        .await
        .map_err(|e| format!("启用 code_execution 扩展失败: {e}"))?;

    Ok(true)
}

async fn stream_reply_once(
    agent: &Agent,
    app: &AppHandle,
    event_name: &str,
    message_text: &str,
    working_directory: Option<&Path>,
    session_config: aster::agents::SessionConfig,
    cancel_token: CancellationToken,
    request_tool_policy: &RequestToolPolicy,
) -> Result<(), ReplyAttemptError> {
    stream_reply_with_policy(
        agent,
        message_text,
        working_directory,
        session_config,
        Some(cancel_token),
        request_tool_policy,
        |event| {
            if let Err(error) = app.emit(event_name, event) {
                tracing::error!("[AsterAgent] 发送事件失败: {}", error);
            }
        },
    )
    .await
    .map(|_| ())
}

/// 基于 aster::sandbox 的本地 bash 强隔离工具
#[derive(Debug)]
struct WorkspaceSandboxedBashTool {
    delegate: BashTool,
    sandbox_type_name: String,
    base_sandbox_config: ProcessSandboxConfig,
    auto_approve_warnings: bool,
}

impl WorkspaceSandboxedBashTool {
    fn new(workspace_root: &str, auto_approve_warnings: bool) -> Result<Self, String> {
        let workspace_root = workspace_root.trim();
        if workspace_root.is_empty() {
            return Err("workspace 根目录为空".to_string());
        }

        let sandbox_type = detect_best_sandbox();
        let sandbox_type_name = format!("{sandbox_type:?}");
        if sandbox_type_name == "None" {
            return Err(format!(
                "未检测到可用本地 sandbox 执行器。{}",
                workspace_sandbox_platform_hint()
            ));
        }

        let workspace_path = PathBuf::from(workspace_root);
        let mut read_only_paths = vec![
            PathBuf::from("/usr"),
            PathBuf::from("/bin"),
            PathBuf::from("/sbin"),
            PathBuf::from("/etc"),
            PathBuf::from("/System"),
            PathBuf::from("/Library"),
            workspace_path.clone(),
        ];
        read_only_paths.sort();
        read_only_paths.dedup();

        let mut writable_paths = vec![workspace_path.clone(), PathBuf::from("/tmp")];
        if cfg!(target_os = "macos") {
            writable_paths.push(PathBuf::from("/private/tmp"));
        }
        writable_paths.sort();
        writable_paths.dedup();

        let base_sandbox_config = ProcessSandboxConfig {
            enabled: true,
            sandbox_type,
            allowed_paths: vec![workspace_path],
            denied_paths: Vec::new(),
            network_access: false,
            environment_variables: HashMap::new(),
            read_only_paths,
            writable_paths,
            allow_dev_access: false,
            allow_proc_access: false,
            allow_sys_access: false,
            env_whitelist: Vec::new(),
            tmpfs_size: "64M".to_string(),
            unshare_all: true,
            die_with_parent: true,
            new_session: true,
            docker: None,
            custom_args: Vec::new(),
            audit_logging: None,
            resource_limits: None,
        };

        Ok(Self {
            delegate: BashTool::new(),
            sandbox_type_name,
            base_sandbox_config,
            auto_approve_warnings,
        })
    }

    fn sandbox_type(&self) -> &str {
        &self.sandbox_type_name
    }

    fn build_sandbox_config(
        &self,
        context: &ToolContext,
        timeout_secs: u64,
    ) -> ProcessSandboxConfig {
        let mut config = self.base_sandbox_config.clone();

        let mut environment_variables = HashMap::new();
        environment_variables.insert("ASTER_TERMINAL".to_string(), "1".to_string());
        for (key, value) in &context.environment {
            environment_variables.insert(key.clone(), value.clone());
        }
        if let Ok(path_env) = std::env::var("PATH") {
            environment_variables
                .entry("PATH".to_string())
                .or_insert(path_env);
        }

        config.environment_variables = environment_variables;
        config.resource_limits = Some(ResourceLimits {
            max_memory: Some(1024 * 1024 * 1024),
            max_cpu: Some(70),
            max_processes: Some(32),
            max_file_size: Some(50 * 1024 * 1024),
            max_execution_time: Some(timeout_secs.saturating_mul(1000)),
            max_file_descriptors: Some(256),
        });
        config
    }

    fn quote_shell(value: &str) -> String {
        format!("'{}'", value.replace('\'', "'\"'\"'"))
    }

    fn build_shell_command(&self, command: &str, context: &ToolContext) -> (String, Vec<String>) {
        #[cfg(target_os = "windows")]
        {
            return (
                "powershell".to_string(),
                vec![
                    "-NoProfile".to_string(),
                    "-NonInteractive".to_string(),
                    "-Command".to_string(),
                    command.to_string(),
                ],
            );
        }

        #[cfg(not(target_os = "windows"))]
        {
            let working_dir = context.working_directory.to_string_lossy().to_string();
            let wrapped_command = format!("cd {} && {}", Self::quote_shell(&working_dir), command);
            ("sh".to_string(), vec!["-lc".to_string(), wrapped_command])
        }
    }

    fn format_output(stdout: &str, stderr: &str, exit_code: i32) -> String {
        let mut output = String::new();

        if !stdout.is_empty() {
            output.push_str(stdout);
        }

        if !stderr.is_empty() {
            if !output.is_empty() && !output.ends_with('\n') {
                output.push('\n');
            }
            if !stdout.is_empty() {
                output.push_str("--- stderr ---\n");
            }
            output.push_str(stderr);
        }

        if exit_code != 0 && output.is_empty() {
            output = format!("Command exited with code {exit_code}");
        }

        if output.len() <= MAX_OUTPUT_LENGTH {
            return output;
        }

        let bytes = output.as_bytes();
        let truncated = String::from_utf8_lossy(&bytes[..MAX_OUTPUT_LENGTH]).to_string();
        format!(
            "{}\n\n[output truncated: {} bytes total]",
            truncated,
            output.len()
        )
    }
}

fn normalize_shell_command_params(params: &serde_json::Value) -> serde_json::Value {
    let mut normalized = params.clone();
    if let Some(object) = normalized.as_object_mut() {
        let has_command = object
            .get("command")
            .and_then(|value| value.as_str())
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false);

        if !has_command {
            if let Some(cmd_value) = object.get("cmd").cloned() {
                if cmd_value
                    .as_str()
                    .map(|value| !value.trim().is_empty())
                    .unwrap_or(false)
                {
                    object.insert("command".to_string(), cmd_value);
                }
            }
        }
    }
    normalized
}

fn normalize_workspace_tool_permission_behavior(
    permission: PermissionCheckResult,
    auto_approve_warnings: bool,
) -> PermissionCheckResult {
    if permission.behavior != PermissionBehavior::Ask {
        return permission;
    }

    let warning = permission
        .message
        .unwrap_or_else(|| "命令包含潜在风险操作".to_string());

    if auto_approve_warnings {
        tracing::warn!("[AsterAgent] Auto 模式自动通过 bash 风险提示: {}", warning);
        return PermissionCheckResult {
            behavior: PermissionBehavior::Allow,
            message: None,
            updated_params: permission.updated_params,
        };
    }

    PermissionCheckResult {
        behavior: PermissionBehavior::Deny,
        message: Some(format!(
            "{warning}。当前模式不支持交互确认，请切换到 Auto 模式或调整命令。"
        )),
        updated_params: permission.updated_params,
    }
}

fn append_workspace_bash_summary(
    mut output: String,
    exit_code: i32,
    stdout_length: usize,
    stderr_length: usize,
    sandboxed: bool,
    sandbox_type: &str,
) -> String {
    if !output.is_empty() && !output.ends_with('\n') {
        output.push('\n');
    }

    let output_truncated = output.contains("[output truncated:");
    output.push_str("\n[ProxyCast 执行摘要]\n");
    output.push_str(&format!("exit_code: {exit_code}\n"));
    output.push_str(&format!("stdout_length: {stdout_length}\n"));
    output.push_str(&format!("stderr_length: {stderr_length}\n"));
    output.push_str(&format!("sandboxed: {sandboxed}\n"));
    output.push_str(&format!("sandbox_type: {sandbox_type}\n"));
    output.push_str(&format!("output_truncated: {output_truncated}"));
    output
}

fn output_contains_proxycast_metadata_block(output: &str) -> bool {
    output.contains(PROXYCAST_TOOL_METADATA_BEGIN) && output.contains(PROXYCAST_TOOL_METADATA_END)
}

fn append_proxycast_tool_metadata_block(
    mut content: String,
    metadata: &serde_json::Map<String, serde_json::Value>,
) -> String {
    if output_contains_proxycast_metadata_block(&content) {
        return content;
    }

    if !content.is_empty() && !content.ends_with('\n') {
        content.push('\n');
    }
    if !content.is_empty() {
        content.push('\n');
    }

    let metadata_json = serde_json::to_string(metadata).unwrap_or_else(|_| "{}".to_string());
    content.push_str(PROXYCAST_TOOL_METADATA_BEGIN);
    content.push('\n');
    content.push_str(&metadata_json);
    content.push('\n');
    content.push_str(PROXYCAST_TOOL_METADATA_END);
    content
}

fn encode_tool_result_for_harness_observability(result: ToolResult) -> ToolResult {
    let mut metadata = result.metadata.clone();
    let base_content = if result.success {
        result.output.unwrap_or_default()
    } else {
        metadata
            .entry("reported_success".to_string())
            .or_insert_with(|| serde_json::json!(false));
        result
            .error
            .unwrap_or_else(|| "工具执行失败，但未返回错误详情".to_string())
    };

    if result.success && metadata.is_empty() {
        return ToolResult::success(base_content);
    }

    let encoded_output =
        if metadata.is_empty() || output_contains_proxycast_metadata_block(&base_content) {
            base_content
        } else {
            let metadata_object = metadata
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect::<serde_json::Map<String, serde_json::Value>>();
            append_proxycast_tool_metadata_block(base_content, &metadata_object)
        };

    ToolResult::success(encoded_output).with_metadata_map(metadata)
}

fn remap_virtual_memory_path_param(
    params: &mut serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Result<bool, ToolError> {
    let Some(raw_path) = params.get(key).and_then(|value| value.as_str()) else {
        return Ok(false);
    };

    let Some(mapped_path) =
        resolve_virtual_memory_path(raw_path).map_err(ToolError::invalid_params)?
    else {
        return Ok(false);
    };

    params.insert(
        key.to_string(),
        serde_json::Value::String(mapped_path.to_string_lossy().to_string()),
    );
    Ok(true)
}

fn remap_virtual_memory_glob_pattern(
    params: &mut serde_json::Map<String, serde_json::Value>,
) -> Result<bool, ToolError> {
    let Some(pattern) = params.get("pattern").and_then(|value| value.as_str()) else {
        return Ok(false);
    };
    if !is_virtual_memory_path(pattern) {
        return Ok(false);
    }

    let relative_pattern = virtual_memory_relative_path(pattern).unwrap_or_default();
    if relative_pattern.split('/').any(|segment| segment == "..") {
        return Err(ToolError::invalid_params(
            "glob.pattern 中的 `/memories/` 路径不允许包含 `..`".to_string(),
        ));
    }

    let root_path = resolve_virtual_memory_path(DURABLE_MEMORY_VIRTUAL_ROOT)
        .map_err(ToolError::invalid_params)?
        .ok_or_else(|| ToolError::invalid_params("无法解析 durable memory 根目录".to_string()))?;

    let normalized_pattern = relative_pattern.trim_start_matches('/');
    let normalized_pattern = if normalized_pattern.is_empty() {
        "**/*".to_string()
    } else {
        normalized_pattern.to_string()
    };

    params.insert(
        "path".to_string(),
        serde_json::Value::String(root_path.to_string_lossy().to_string()),
    );
    params.insert(
        "pattern".to_string(),
        serde_json::Value::String(normalized_pattern),
    );
    Ok(true)
}

fn normalize_params_for_durable_memory_support(
    tool_name: &str,
    params: &serde_json::Value,
) -> Result<serde_json::Value, ToolError> {
    let Some(map) = params.as_object() else {
        return Ok(params.clone());
    };

    let mut normalized = map.clone();
    let mut changed = false;

    match tool_name {
        "read" | "write" | "edit" | "grep" => {
            changed |= remap_virtual_memory_path_param(&mut normalized, "path")?;
        }
        "glob" => {
            changed |= remap_virtual_memory_path_param(&mut normalized, "path")?;
            changed |= remap_virtual_memory_glob_pattern(&mut normalized)?;
        }
        _ => {}
    }

    if changed {
        Ok(serde_json::Value::Object(normalized))
    } else {
        Ok(params.clone())
    }
}

struct DurableMemoryMappedTool {
    delegate: Box<dyn Tool>,
}

impl DurableMemoryMappedTool {
    fn new(delegate: Box<dyn Tool>) -> Self {
        Self { delegate }
    }
}

#[async_trait]
impl Tool for DurableMemoryMappedTool {
    fn name(&self) -> &str {
        self.delegate.name()
    }

    fn description(&self) -> &str {
        self.delegate.description()
    }

    fn dynamic_description(&self) -> Option<String> {
        self.delegate.dynamic_description()
    }

    fn input_schema(&self) -> serde_json::Value {
        self.delegate.input_schema()
    }

    fn options(&self) -> ToolOptions {
        self.delegate.options()
    }

    async fn check_permissions(
        &self,
        params: &serde_json::Value,
        context: &ToolContext,
    ) -> PermissionCheckResult {
        let normalized_params =
            match normalize_params_for_durable_memory_support(self.name(), params) {
                Ok(value) => value,
                Err(error) => {
                    return PermissionCheckResult::deny(format!(
                        "durable memory 参数无效: {error}"
                    ));
                }
            };

        let mut result = self
            .delegate
            .check_permissions(&normalized_params, context)
            .await;

        if result.updated_params.is_none() && normalized_params != *params {
            result.updated_params = Some(normalized_params);
        }
        result
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let normalized_params = normalize_params_for_durable_memory_support(self.name(), &params)?;
        self.delegate.execute(normalized_params, context).await
    }
}

struct HarnessObservedTool {
    delegate: Box<dyn Tool>,
}

impl HarnessObservedTool {
    fn new(delegate: Box<dyn Tool>) -> Self {
        Self { delegate }
    }
}

#[async_trait]
impl Tool for HarnessObservedTool {
    fn name(&self) -> &str {
        self.delegate.name()
    }

    fn description(&self) -> &str {
        self.delegate.description()
    }

    fn dynamic_description(&self) -> Option<String> {
        self.delegate.dynamic_description()
    }

    fn input_schema(&self) -> serde_json::Value {
        self.delegate.input_schema()
    }

    fn options(&self) -> ToolOptions {
        self.delegate.options()
    }

    async fn check_permissions(
        &self,
        params: &serde_json::Value,
        context: &ToolContext,
    ) -> PermissionCheckResult {
        self.delegate.check_permissions(params, context).await
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        self.delegate
            .execute(params, context)
            .await
            .map(encode_tool_result_for_harness_observability)
    }
}

fn wrap_registry_native_tools_for_harness_observability(registry: &mut aster::tools::ToolRegistry) {
    let tool_names = registry
        .native_tool_names()
        .into_iter()
        .map(|name| name.to_string())
        .collect::<Vec<_>>();

    for tool_name in tool_names {
        let Some(tool) = registry.unregister(&tool_name) else {
            continue;
        };
        registry.register(Box::new(HarnessObservedTool::new(tool)));
    }
}

fn wrap_registry_native_tools_for_durable_memory_fs(registry: &mut aster::tools::ToolRegistry) {
    for tool_name in ["read", "write", "edit", "glob", "grep"] {
        let Some(tool) = registry.unregister(tool_name) else {
            continue;
        };
        registry.register(Box::new(DurableMemoryMappedTool::new(tool)));
    }
}

#[async_trait]
impl Tool for WorkspaceSandboxedBashTool {
    fn name(&self) -> &str {
        self.delegate.name()
    }

    fn description(&self) -> &str {
        self.delegate.description()
    }

    fn input_schema(&self) -> serde_json::Value {
        self.delegate.input_schema()
    }

    fn options(&self) -> ToolOptions {
        self.delegate.options()
    }

    async fn check_permissions(
        &self,
        params: &serde_json::Value,
        context: &ToolContext,
    ) -> PermissionCheckResult {
        let normalized_params = normalize_shell_command_params(params);
        let permission = self
            .delegate
            .check_permissions(&normalized_params, context)
            .await;
        normalize_workspace_tool_permission_behavior(permission, self.auto_approve_warnings)
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let normalized_params = normalize_shell_command_params(&params);

        if context.is_cancelled() {
            return Err(ToolError::Cancelled);
        }

        let permission = self.check_permissions(&normalized_params, context).await;
        match permission.behavior {
            PermissionBehavior::Allow => {}
            PermissionBehavior::Deny => {
                let message = permission
                    .message
                    .unwrap_or_else(|| "命令被安全策略拒绝".to_string());
                return Err(ToolError::permission_denied(message));
            }
            PermissionBehavior::Ask => {
                let message = permission
                    .message
                    .unwrap_or_else(|| "命令需要人工确认".to_string());
                return Err(ToolError::permission_denied(message));
            }
        }

        let command = normalized_params
            .get("command")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::invalid_params("Missing required parameter: command"))?;

        let background = normalized_params
            .get("background")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if background {
            return Err(ToolError::invalid_params(
                "本地 sandbox 模式不支持 background=true",
            ));
        }

        let timeout_secs = normalized_params
            .get("timeout")
            .and_then(|v| v.as_u64())
            .unwrap_or(DEFAULT_BASH_TIMEOUT_SECS)
            .min(MAX_BASH_TIMEOUT_SECS);

        let sandbox_config = self.build_sandbox_config(context, timeout_secs);
        let (entry, args) = self.build_shell_command(command, context);

        let execution = tokio::time::timeout(
            Duration::from_secs(timeout_secs),
            execute_in_sandbox(&entry, &args, &sandbox_config),
        )
        .await
        .map_err(|_| ToolError::timeout(Duration::from_secs(timeout_secs)))?
        .map_err(|e| ToolError::execution_failed(format!("sandbox 执行失败: {e}")))?;

        let output = append_workspace_bash_summary(
            Self::format_output(&execution.stdout, &execution.stderr, execution.exit_code),
            execution.exit_code,
            execution.stdout.len(),
            execution.stderr.len(),
            execution.sandboxed,
            &format!("{:?}", execution.sandbox_type),
        );
        if execution.exit_code == 0 {
            Ok(ToolResult::success(output)
                .with_metadata("exit_code", serde_json::json!(execution.exit_code))
                .with_metadata("stdout_length", serde_json::json!(execution.stdout.len()))
                .with_metadata("stderr_length", serde_json::json!(execution.stderr.len()))
                .with_metadata("sandboxed", serde_json::json!(execution.sandboxed))
                .with_metadata(
                    "sandbox_type",
                    serde_json::json!(format!("{:?}", execution.sandbox_type)),
                ))
        } else {
            Ok(ToolResult::success(output)
                .with_metadata("exit_code", serde_json::json!(execution.exit_code))
                .with_metadata("stdout_length", serde_json::json!(execution.stdout.len()))
                .with_metadata("stderr_length", serde_json::json!(execution.stderr.len()))
                .with_metadata("sandboxed", serde_json::json!(execution.sandboxed))
                .with_metadata(
                    "sandbox_type",
                    serde_json::json!(format!("{:?}", execution.sandbox_type)),
                )
                .with_metadata("reported_success", serde_json::json!(false)))
        }
    }
}

/// 统一处理 Task 工具的 Ask 权限，避免缺少回调导致流程中断
struct WorkspaceTaskTool {
    delegate: TaskTool,
    auto_approve_warnings: bool,
}

impl WorkspaceTaskTool {
    fn new(auto_approve_warnings: bool, task_manager: Arc<TaskManager>) -> Self {
        Self {
            delegate: TaskTool::with_manager(task_manager),
            auto_approve_warnings,
        }
    }
}

#[async_trait]
impl Tool for WorkspaceTaskTool {
    fn name(&self) -> &str {
        self.delegate.name()
    }

    fn description(&self) -> &str {
        self.delegate.description()
    }

    fn input_schema(&self) -> serde_json::Value {
        self.delegate.input_schema()
    }

    fn options(&self) -> ToolOptions {
        self.delegate.options()
    }

    async fn check_permissions(
        &self,
        params: &serde_json::Value,
        context: &ToolContext,
    ) -> PermissionCheckResult {
        let normalized_params = normalize_shell_command_params(params);
        let permission = self
            .delegate
            .check_permissions(&normalized_params, context)
            .await;
        normalize_workspace_tool_permission_behavior(permission, self.auto_approve_warnings)
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let normalized_params = normalize_shell_command_params(&params);
        self.delegate.execute(normalized_params, context).await
    }
}

struct WorkspaceTaskOutputTool {
    delegate: TaskOutputTool,
    task_manager: Arc<TaskManager>,
}

impl WorkspaceTaskOutputTool {
    fn new(task_manager: Arc<TaskManager>) -> Self {
        Self {
            delegate: TaskOutputTool::with_manager(task_manager.clone()),
            task_manager,
        }
    }
}

#[async_trait]
impl Tool for WorkspaceTaskOutputTool {
    fn name(&self) -> &str {
        self.delegate.name()
    }

    fn description(&self) -> &str {
        self.delegate.description()
    }

    fn input_schema(&self) -> serde_json::Value {
        self.delegate.input_schema()
    }

    fn options(&self) -> ToolOptions {
        self.delegate.options()
    }

    async fn check_permissions(
        &self,
        params: &serde_json::Value,
        context: &ToolContext,
    ) -> PermissionCheckResult {
        self.delegate.check_permissions(params, context).await
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input = serde_json::from_value::<TaskOutputInput>(params.clone()).ok();
        let mut result = self.delegate.execute(params, context).await?;

        let Some(task_id) = input.map(|value| value.task_id) else {
            return Ok(result);
        };

        let Some(state) = self.task_manager.get_status(&task_id).await else {
            return Ok(result);
        };

        result = result
            .with_metadata(
                "output_file",
                serde_json::json!(state.output_file.to_string_lossy().to_string()),
            )
            .with_metadata(
                "working_directory",
                serde_json::json!(state.working_directory.to_string_lossy().to_string()),
            )
            .with_metadata("session_id", serde_json::json!(state.session_id))
            .with_metadata("status", serde_json::json!(state.status.to_string()));

        if let Some(exit_code) = state.exit_code {
            result = result.with_metadata("exit_code", serde_json::json!(exit_code));
        }

        Ok(result)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubAgentTaskToolInput {
    prompt: String,
    task_type: Option<String>,
    description: Option<String>,
    role: Option<String>,
    timeout_secs: Option<u64>,
    model: Option<String>,
    return_summary: Option<bool>,
    allowed_tools: Option<Vec<String>>,
    denied_tools: Option<Vec<String>>,
    max_tokens: Option<usize>,
}

fn parse_subagent_role(raw: Option<&str>) -> Result<SubAgentRole, ToolError> {
    let normalized = raw
        .map(|value| value.trim().to_ascii_lowercase())
        .unwrap_or_else(|| "executor".to_string());

    match normalized.as_str() {
        "" | "executor" | "execute" | "code" => Ok(SubAgentRole::Executor),
        "planner" | "plan" => Ok(SubAgentRole::Planner),
        "explorer" | "explore" | "research" => Ok(SubAgentRole::Explorer),
        _ => Err(ToolError::invalid_params(format!(
            "未知 SubAgent 角色: {}，支持 explorer/planner/executor",
            normalized
        ))),
    }
}

fn default_subagent_task_type(role: SubAgentRole) -> &'static str {
    match role {
        SubAgentRole::Explorer => "explore",
        SubAgentRole::Planner => "plan",
        SubAgentRole::Executor => "code",
    }
}

fn build_subagent_task_definition(
    input: &SubAgentTaskToolInput,
    role: SubAgentRole,
) -> Result<SubAgentTask, ToolError> {
    let prompt = input.prompt.trim();
    if prompt.is_empty() {
        return Err(ToolError::invalid_params(
            "SubAgentTask.prompt 不能为空".to_string(),
        ));
    }

    let task_type = input
        .task_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(default_subagent_task_type(role));

    let mut task = SubAgentTask::new(uuid::Uuid::new_v4().to_string(), task_type, prompt);

    if let Some(description) = input
        .description
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        task = task.with_description(description.to_string());
    }

    if let Some(timeout_secs) = input.timeout_secs.filter(|value| *value > 0) {
        task = task.with_timeout(Duration::from_secs(timeout_secs));
    }

    if let Some(model) = input
        .model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        task = task.with_model(model.to_string());
    }

    if let Some(return_summary) = input.return_summary {
        task = task.with_summary(return_summary);
    }

    if let Some(allowed_tools) = input
        .allowed_tools
        .as_ref()
        .filter(|items| !items.is_empty())
    {
        task = task.with_allowed_tools(allowed_tools.clone());
    }

    if let Some(denied_tools) = input
        .denied_tools
        .as_ref()
        .filter(|items| !items.is_empty())
    {
        task = task.with_denied_tools(denied_tools.clone());
    }

    if let Some(max_tokens) = input.max_tokens.filter(|value| *value > 0) {
        task = task.with_max_tokens(max_tokens);
    }

    Ok(task)
}

fn summarize_subagent_execution(
    role: SubAgentRole,
    execution: &SchedulerExecutionResult,
) -> String {
    let merged_summary = execution
        .merged_summary
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            execution.results.iter().find_map(|result| {
                result
                    .summary
                    .as_deref()
                    .or(result.output.as_deref())
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToString::to_string)
            })
        })
        .unwrap_or_else(|| "未返回摘要".to_string());

    format!(
        "SubAgent({}) 完成：成功 {}，失败 {}，跳过 {}。{}",
        role,
        execution.successful_count,
        execution.failed_count,
        execution.skipped_count,
        merged_summary
    )
}

#[derive(Debug, Clone)]
struct SubAgentTaskTool {
    db: DbConnection,
    app_handle: AppHandle,
}

impl SubAgentTaskTool {
    fn new(db: DbConnection, app_handle: AppHandle) -> Self {
        Self { db, app_handle }
    }
}

#[async_trait]
impl Tool for SubAgentTaskTool {
    fn name(&self) -> &str {
        "SubAgentTask"
    }

    fn description(&self) -> &str {
        "将独立子问题委派给隔离上下文的子代理执行，并返回摘要结果"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "子代理要执行的任务说明"
                },
                "taskType": {
                    "type": "string",
                    "description": "任务类型，例如 explore、plan、code、review"
                },
                "description": {
                    "type": "string",
                    "description": "展示给用户的任务标题"
                },
                "role": {
                    "type": "string",
                    "description": "子代理角色：explorer、planner、executor"
                },
                "timeoutSecs": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "单个子任务超时时间（秒）"
                },
                "model": {
                    "type": "string",
                    "description": "可选模型名"
                },
                "returnSummary": {
                    "type": "boolean",
                    "description": "是否优先返回摘要"
                },
                "allowedTools": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "显式允许的工具列表"
                },
                "deniedTools": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "显式拒绝的工具列表"
                },
                "maxTokens": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "子代理最大 token 限制"
                }
            },
            "required": ["prompt"],
            "additionalProperties": false
        })
    }

    fn options(&self) -> ToolOptions {
        ToolOptions::new()
            .with_max_retries(0)
            .with_base_timeout(Duration::from_secs(900))
            .with_dynamic_timeout(false)
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input: SubAgentTaskToolInput = serde_json::from_value(params)
            .map_err(|err| ToolError::invalid_params(format!("SubAgentTask 参数无效: {err}")))?;
        let role = parse_subagent_role(input.role.as_deref())?;
        let task = build_subagent_task_definition(&input, role)?;
        let task_id = task.id.clone();

        let mut scheduler =
            ProxyCastScheduler::new(self.db.clone()).with_app_handle(self.app_handle.clone());
        if !context.session_id.trim().is_empty() {
            scheduler = scheduler.with_event_session_id(context.session_id.clone());
        }
        scheduler.init(None).await;

        let execution = scheduler
            .execute_with_role(vec![task], None, role)
            .await
            .map_err(|err| ToolError::execution_failed(format!("SubAgentTask 执行失败: {err}")))?;

        let summary = summarize_subagent_execution(role, &execution);
        let metadata = serde_json::json!({
            "task_id": task_id,
            "role": role.to_string(),
            "success": execution.success,
            "successful_count": execution.successful_count,
            "failed_count": execution.failed_count,
            "skipped_count": execution.skipped_count,
            "merged_summary": execution.merged_summary,
            "results": execution.results,
            "total_token_usage": execution.total_token_usage,
        });

        if execution.success {
            Ok(ToolResult::success(summary)
                .with_metadata("subagent", metadata)
                .with_metadata("role", serde_json::json!(role.to_string())))
        } else {
            Ok(ToolResult::error(summary)
                .with_metadata("subagent", metadata)
                .with_metadata("role", serde_json::json!(role.to_string())))
        }
    }
}

#[derive(Debug, Clone)]
struct ProxycastBrowserMcpTool {
    tool_name: String,
    action_name: String,
    description: String,
    input_schema: serde_json::Value,
}

impl ProxycastBrowserMcpTool {
    fn new(
        tool_name: String,
        action_name: String,
        description: String,
        input_schema: serde_json::Value,
    ) -> Self {
        Self {
            tool_name,
            action_name,
            description,
            input_schema,
        }
    }

    fn parse_backend(params: &serde_json::Value) -> Option<BrowserBackendType> {
        let raw = params.get("backend")?.as_str()?.trim().to_ascii_lowercase();
        match raw.as_str() {
            "aster_compat" => Some(BrowserBackendType::AsterCompat),
            "proxycast_extension_bridge" => Some(BrowserBackendType::ProxycastExtensionBridge),
            "cdp_direct" => Some(BrowserBackendType::CdpDirect),
            _ => None,
        }
    }

    fn extract_profile_key(params: &serde_json::Value, context: &ToolContext) -> Option<String> {
        if let Some(value) = params.get("profile_key").and_then(|v| v.as_str()) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
        context
            .environment
            .get("PROXYCAST_BROWSER_PROFILE_KEY")
            .cloned()
    }
}

#[async_trait]
impl Tool for ProxycastBrowserMcpTool {
    fn name(&self) -> &str {
        &self.tool_name
    }

    fn description(&self) -> &str {
        &self.description
    }

    fn input_schema(&self) -> serde_json::Value {
        self.input_schema.clone()
    }

    fn options(&self) -> ToolOptions {
        ToolOptions::new()
            .with_max_retries(1)
            .with_base_timeout(Duration::from_secs(90))
            .with_dynamic_timeout(false)
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let backend = Self::parse_backend(&params);
        let profile_key = Self::extract_profile_key(&params, _context);
        let timeout_ms = params.get("timeout_ms").and_then(|v| v.as_u64());
        let request = BrowserActionRequest {
            profile_key,
            backend,
            action: self.action_name.clone(),
            args: params,
            timeout_ms,
        };

        let result = browser_execute_action_global(request)
            .await
            .map_err(|e| ToolError::execution_failed(format!("浏览器动作执行失败: {e}")))?;

        let payload = serde_json::to_string_pretty(&result)
            .unwrap_or_else(|_| format!("{{\"success\": {}}}", result.success));

        if result.success {
            Ok(ToolResult::success(payload)
                .with_metadata("action", serde_json::json!(self.action_name))
                .with_metadata("selected_backend", serde_json::json!(result.backend))
                .with_metadata("attempt_count", serde_json::json!(result.attempts.len())))
        } else {
            Ok(ToolResult::error(
                result
                    .error
                    .clone()
                    .unwrap_or_else(|| "浏览器动作执行失败".to_string()),
            )
            .with_metadata("action", serde_json::json!(self.action_name))
            .with_metadata("selected_backend", serde_json::json!(result.backend))
            .with_metadata("attempts", serde_json::json!(result.attempts))
            .with_metadata("result", serde_json::json!(result)))
        }
    }
}

#[derive(Clone)]
struct SocialGenerateCoverImageTool {
    config_manager: Arc<GlobalConfigManager>,
    client: reqwest::Client,
}

impl SocialGenerateCoverImageTool {
    fn new(config_manager: Arc<GlobalConfigManager>) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(180))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            config_manager,
            client,
        }
    }

    fn normalize_server_host(host: &str) -> String {
        let trimmed = host.trim();
        if trimmed.is_empty() || trimmed == "0.0.0.0" || trimmed == "::" {
            return "127.0.0.1".to_string();
        }
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            return trimmed.to_string();
        }
        if trimmed.contains(':') {
            return format!("[{trimmed}]");
        }
        trimmed.to_string()
    }

    fn parse_non_empty_string(
        params: &serde_json::Value,
        key: &str,
        default: Option<&str>,
    ) -> Option<String> {
        if let Some(value) = params.get(key).and_then(|v| v.as_str()) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
        default.map(ToString::to_string)
    }

    fn extract_first_image_payload(
        response_body: &serde_json::Value,
    ) -> Result<(Option<String>, Option<String>, Option<String>), String> {
        let data = response_body
            .get("data")
            .and_then(|v| v.as_array())
            .ok_or_else(|| "图像接口返回缺少 data 字段".to_string())?;

        let first = data
            .first()
            .ok_or_else(|| "图像接口返回 data 为空".to_string())?;

        let image_url = first
            .get("url")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let image_b64 = first
            .get("b64_json")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let revised_prompt = first
            .get("revised_prompt")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        Ok((image_url, image_b64, revised_prompt))
    }
}

#[async_trait]
impl Tool for SocialGenerateCoverImageTool {
    fn name(&self) -> &str {
        SOCIAL_IMAGE_TOOL_NAME
    }

    fn description(&self) -> &str {
        "为社媒文章生成封面图，内部复用 ProxyCast 的 /v1/images/generations 能力。"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "图片描述词，建议包含主体、风格、氛围、构图。"
                },
                "model": {
                    "type": "string",
                    "description": "可选模型名；不传则使用默认图像模型。"
                },
                "size": {
                    "type": "string",
                    "description": "图片尺寸，例如 1024x1024、1024x1792。"
                },
                "response_format": {
                    "type": "string",
                    "enum": ["url", "b64_json"],
                    "description": "返回格式，默认 url。"
                }
            },
            "required": ["prompt"],
            "additionalProperties": false,
            "x-proxycast": {
                "always_visible": true,
                "tags": ["image", "social-media", "cover"],
                "allowed_callers": ["assistant", "skill"],
                "input_examples": [
                    {
                        "prompt": "科技感蓝紫渐变背景，一位年轻创作者在笔记本前沉思，暖色轮廓光，简洁社媒封面风格",
                        "size": "1024x1024"
                    }
                ]
            }
        })
    }

    fn options(&self) -> ToolOptions {
        ToolOptions::new()
            .with_max_retries(1)
            .with_base_timeout(Duration::from_secs(180))
            .with_dynamic_timeout(false)
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let prompt = Self::parse_non_empty_string(&params, "prompt", None).ok_or_else(|| {
            ToolError::invalid_params("参数 prompt 必填，且不能为空字符串".to_string())
        })?;

        let runtime_config = self.config_manager.config();
        let model =
            Self::parse_non_empty_string(&params, "model", Some(SOCIAL_IMAGE_DEFAULT_MODEL))
                .unwrap_or_else(|| SOCIAL_IMAGE_DEFAULT_MODEL.to_string());
        let size = Self::parse_non_empty_string(
            &params,
            "size",
            runtime_config.image_gen.default_size.as_deref(),
        )
        .unwrap_or_else(|| SOCIAL_IMAGE_DEFAULT_SIZE.to_string());
        let response_format = Self::parse_non_empty_string(
            &params,
            "response_format",
            Some(SOCIAL_IMAGE_DEFAULT_RESPONSE_FORMAT),
        )
        .unwrap_or_else(|| SOCIAL_IMAGE_DEFAULT_RESPONSE_FORMAT.to_string());

        if response_format != "url" && response_format != "b64_json" {
            return Err(ToolError::invalid_params(
                "response_format 仅支持 url 或 b64_json".to_string(),
            ));
        }

        let server_host = Self::normalize_server_host(&runtime_config.server.host);
        let endpoint = format!(
            "http://{}:{}/v1/images/generations",
            server_host, runtime_config.server.port
        );
        let request_body = serde_json::json!({
            "prompt": prompt,
            "model": model,
            "n": 1,
            "size": size,
            "response_format": response_format
        });

        let response = self
            .client
            .post(&endpoint)
            .header(
                "Authorization",
                format!("Bearer {}", runtime_config.server.api_key),
            )
            .json(&request_body)
            .send()
            .await
            .map_err(|e| ToolError::execution_failed(format!("调用图像接口失败: {e}")))?;

        let status = response.status();
        let response_body: serde_json::Value = response
            .json()
            .await
            .map_err(|e| ToolError::execution_failed(format!("图像接口响应解析失败: {e}")))?;

        if !status.is_success() {
            let error_message = response_body
                .get("error")
                .and_then(|v| v.get("message"))
                .and_then(|v| v.as_str())
                .unwrap_or("图像生成失败")
                .to_string();
            let error_code = response_body
                .get("error")
                .and_then(|v| v.get("code"))
                .and_then(|v| v.as_str())
                .unwrap_or("image_generation_failed")
                .to_string();
            let result_payload = serde_json::json!({
                "success": false,
                "error_code": error_code,
                "error_message": error_message,
                "status": status.as_u16(),
                "retryable": status.is_server_error() || status.as_u16() == 429
            });
            return Ok(ToolResult::error(result_payload.to_string())
                .with_metadata("result", result_payload));
        }

        let (image_url, image_b64, revised_prompt) =
            Self::extract_first_image_payload(&response_body)
                .map_err(ToolError::execution_failed)?;

        if image_url.is_none() && image_b64.is_none() {
            return Err(ToolError::execution_failed(
                "图像接口返回中未找到 url 或 b64_json".to_string(),
            ));
        }

        let result_payload = serde_json::json!({
            "success": true,
            "image_url": image_url,
            "b64_json": image_b64,
            "revised_prompt": revised_prompt,
            "model": request_body.get("model").cloned(),
            "size": request_body.get("size").cloned(),
            "response_format": request_body.get("response_format").cloned()
        });
        let output = serde_json::to_string_pretty(&result_payload)
            .unwrap_or_else(|_| result_payload.to_string());
        Ok(ToolResult::success(output).with_metadata("result", result_payload))
    }
}

fn is_safe_relative_path(path: &Path) -> bool {
    if path.is_absolute() {
        return false;
    }
    !path.components().any(|component| {
        matches!(
            component,
            std::path::Component::ParentDir
                | std::path::Component::RootDir
                | std::path::Component::Prefix(_)
        )
    })
}

fn resolve_output_relative_path(
    task_type: &str,
    output_path: Option<&str>,
) -> Result<PathBuf, ToolError> {
    if let Some(raw) = output_path {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Err(ToolError::invalid_params(
                "outputPath 不能为空字符串".to_string(),
            ));
        }
        let candidate = PathBuf::from(trimmed);
        if !is_safe_relative_path(&candidate) {
            return Err(ToolError::invalid_params(
                "outputPath 必须是安全的相对路径，且不能包含 '..'".to_string(),
            ));
        }
        return Ok(candidate);
    }

    let timestamp = chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let suffix = uuid::Uuid::new_v4().simple().to_string();
    Ok(PathBuf::from(".proxycast")
        .join("tasks")
        .join(task_type)
        .join(format!("{timestamp}-{suffix}.json")))
}

fn submit_creation_task_record(
    app_handle: &AppHandle,
    context: &ToolContext,
    task_type: &str,
    title: Option<String>,
    payload: serde_json::Value,
    output_path: Option<&str>,
) -> Result<ToolResult, ToolError> {
    let output_rel_path = resolve_output_relative_path(task_type, output_path)?;
    let output_abs_path = context.working_directory.join(&output_rel_path);

    let parent = output_abs_path
        .parent()
        .ok_or_else(|| ToolError::execution_failed("无法解析任务文件父目录".to_string()))?;
    std::fs::create_dir_all(parent)
        .map_err(|error| ToolError::execution_failed(format!("创建任务目录失败: {error}")))?;

    let task_id = uuid::Uuid::new_v4().to_string();
    let task_record = serde_json::json!({
        "task_id": task_id,
        "task_type": task_type,
        "title": title,
        "payload": payload,
        "status": "pending_submit",
        "created_at": chrono::Utc::now().to_rfc3339()
    });
    let task_content =
        serde_json::to_string_pretty(&task_record).unwrap_or_else(|_| task_record.to_string());

    std::fs::write(&output_abs_path, task_content.as_bytes())
        .map_err(|error| ToolError::execution_failed(format!("写入任务文件失败: {error}")))?;

    let emitted_payload = serde_json::json!({
        "task_id": task_id,
        "task_type": task_type,
        "path": output_rel_path.to_string_lossy().to_string(),
        "absolute_path": output_abs_path.to_string_lossy().to_string()
    });
    if let Err(error) = app_handle.emit("proxycast://creation_task_submitted", &emitted_payload) {
        tracing::warn!(
            "[AsterAgent] creation_task_submitted 事件发送失败: {}",
            error
        );
    }

    let output_payload = serde_json::json!({
        "success": true,
        "task_id": task_id,
        "task_type": task_type,
        "path": output_rel_path.to_string_lossy().to_string(),
        "absolute_path": output_abs_path.to_string_lossy().to_string(),
        "record": task_record
    });
    let output = serde_json::to_string_pretty(&output_payload)
        .unwrap_or_else(|_| output_payload.to_string());
    Ok(ToolResult::success(output)
        .with_metadata("task_id", serde_json::json!(task_id))
        .with_metadata("task_type", serde_json::json!(task_type))
        .with_metadata("path", serde_json::json!(output_abs_path.to_string_lossy())))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BroadcastTaskInput {
    content: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    audience: Option<String>,
    #[serde(default)]
    tone: Option<String>,
    #[serde(default)]
    duration_hint_minutes: Option<u32>,
    #[serde(default)]
    output_path: Option<String>,
}

#[derive(Clone)]
struct ProxycastCreateBroadcastTaskTool {
    app_handle: AppHandle,
}

impl ProxycastCreateBroadcastTaskTool {
    fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

#[async_trait]
impl Tool for ProxycastCreateBroadcastTaskTool {
    fn name(&self) -> &str {
        PROXYCAST_CREATE_BROADCAST_TASK_TOOL_NAME
    }

    fn description(&self) -> &str {
        "创建播客内容整理任务（broadcast_generate）。"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "content": { "type": "string", "description": "可播报正文内容。" },
                "title": { "type": "string", "description": "任务标题（可选）。" },
                "audience": { "type": "string", "description": "目标听众（可选）。" },
                "tone": { "type": "string", "description": "语气风格（可选）。" },
                "durationHintMinutes": { "type": "integer", "minimum": 1, "maximum": 180, "description": "建议时长（分钟，可选）。" },
                "outputPath": { "type": "string", "description": "可选输出路径（相对工作目录）。" }
            },
            "required": ["content"],
            "additionalProperties": false,
            "x-proxycast": {
                "always_visible": true,
                "tags": ["broadcast", "task", "creation"],
                "allowed_callers": ["assistant", "skill"]
            }
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input: BroadcastTaskInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("参数解析失败: {error}")))?;
        if input.content.trim().is_empty() {
            return Err(ToolError::invalid_params(
                "content 不能为空字符串".to_string(),
            ));
        }
        let payload = serde_json::json!({
            "content": input.content,
            "audience": input.audience,
            "tone": input.tone,
            "durationHintMinutes": input.duration_hint_minutes
        });
        submit_creation_task_record(
            &self.app_handle,
            context,
            "broadcast_generate",
            input.title,
            payload,
            input.output_path.as_deref(),
        )
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoverTaskInput {
    prompt: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    platform: Option<String>,
    #[serde(default)]
    size: Option<String>,
    #[serde(default)]
    image_url: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    remark: Option<String>,
    #[serde(default)]
    output_path: Option<String>,
}

#[derive(Clone)]
struct ProxycastCreateCoverTaskTool {
    app_handle: AppHandle,
}

impl ProxycastCreateCoverTaskTool {
    fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

#[async_trait]
impl Tool for ProxycastCreateCoverTaskTool {
    fn name(&self) -> &str {
        PROXYCAST_CREATE_COVER_TASK_TOOL_NAME
    }

    fn description(&self) -> &str {
        "创建封面生成任务记录（cover_generate）。"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "prompt": { "type": "string", "description": "封面提示词。" },
                "title": { "type": "string", "description": "任务标题（可选）。" },
                "platform": { "type": "string", "description": "目标平台（可选）。" },
                "size": { "type": "string", "description": "尺寸（可选）。" },
                "imageUrl": { "type": "string", "description": "生成后的封面 URL（可选）。" },
                "status": { "type": "string", "description": "状态（成功/失败，可选）。" },
                "remark": { "type": "string", "description": "备注（可选）。" },
                "outputPath": { "type": "string", "description": "可选输出路径（相对工作目录）。" }
            },
            "required": ["prompt"],
            "additionalProperties": false,
            "x-proxycast": {
                "always_visible": true,
                "tags": ["cover", "image", "task"],
                "allowed_callers": ["assistant", "skill"]
            }
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input: CoverTaskInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("参数解析失败: {error}")))?;
        if input.prompt.trim().is_empty() {
            return Err(ToolError::invalid_params(
                "prompt 不能为空字符串".to_string(),
            ));
        }
        let payload = serde_json::json!({
            "prompt": input.prompt,
            "platform": input.platform,
            "size": input.size,
            "imageUrl": input.image_url,
            "status": input.status,
            "remark": input.remark
        });
        submit_creation_task_record(
            &self.app_handle,
            context,
            "cover_generate",
            input.title,
            payload,
            input.output_path.as_deref(),
        )
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResourceSearchTaskInput {
    resource_type: String,
    query: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    usage: Option<String>,
    #[serde(default)]
    count: Option<u32>,
    #[serde(default)]
    filters: Option<serde_json::Value>,
    #[serde(default)]
    output_path: Option<String>,
}

#[derive(Clone)]
struct ProxycastCreateResourceSearchTaskTool {
    app_handle: AppHandle,
}

impl ProxycastCreateResourceSearchTaskTool {
    fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

#[async_trait]
impl Tool for ProxycastCreateResourceSearchTaskTool {
    fn name(&self) -> &str {
        PROXYCAST_CREATE_RESOURCE_SEARCH_TASK_TOOL_NAME
    }

    fn description(&self) -> &str {
        "创建资源检索任务（modal_resource_search）。"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "resourceType": { "type": "string", "description": "资源类型，例如 image/bgm/sfx。" },
                "query": { "type": "string", "description": "检索关键词。" },
                "title": { "type": "string", "description": "任务标题（可选）。" },
                "usage": { "type": "string", "description": "用途说明（可选）。" },
                "count": { "type": "integer", "minimum": 1, "maximum": 50, "description": "候选数量（可选）。" },
                "filters": { "type": "object", "description": "过滤条件（可选）。" },
                "outputPath": { "type": "string", "description": "可选输出路径（相对工作目录）。" }
            },
            "required": ["resourceType", "query"],
            "additionalProperties": false,
            "x-proxycast": {
                "always_visible": true,
                "tags": ["resource", "search", "task"],
                "allowed_callers": ["assistant", "skill"]
            }
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input: ResourceSearchTaskInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("参数解析失败: {error}")))?;
        if input.resource_type.trim().is_empty() || input.query.trim().is_empty() {
            return Err(ToolError::invalid_params(
                "resourceType/query 不能为空字符串".to_string(),
            ));
        }
        let payload = serde_json::json!({
            "resourceType": input.resource_type,
            "query": input.query,
            "usage": input.usage,
            "count": input.count,
            "filters": input.filters
        });
        submit_creation_task_record(
            &self.app_handle,
            context,
            "modal_resource_search",
            input.title,
            payload,
            input.output_path.as_deref(),
        )
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImageTaskInput {
    prompt: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    style: Option<String>,
    #[serde(default)]
    size: Option<String>,
    #[serde(default)]
    count: Option<u32>,
    #[serde(default)]
    usage: Option<String>,
    #[serde(default)]
    output_path: Option<String>,
}

#[derive(Clone)]
struct ProxycastCreateImageTaskTool {
    app_handle: AppHandle,
}

impl ProxycastCreateImageTaskTool {
    fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

#[async_trait]
impl Tool for ProxycastCreateImageTaskTool {
    fn name(&self) -> &str {
        PROXYCAST_CREATE_IMAGE_TASK_TOOL_NAME
    }

    fn description(&self) -> &str {
        "创建图片生成任务（image_generate）。"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "prompt": { "type": "string", "description": "图像提示词。" },
                "title": { "type": "string", "description": "任务标题（可选）。" },
                "style": { "type": "string", "description": "风格（可选）。" },
                "size": { "type": "string", "description": "尺寸（可选）。" },
                "count": { "type": "integer", "minimum": 1, "maximum": 20, "description": "生成数量（可选）。" },
                "usage": { "type": "string", "description": "用途（可选）。" },
                "outputPath": { "type": "string", "description": "可选输出路径（相对工作目录）。" }
            },
            "required": ["prompt"],
            "additionalProperties": false,
            "x-proxycast": {
                "always_visible": true,
                "tags": ["image", "task", "generation"],
                "allowed_callers": ["assistant", "skill"]
            }
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input: ImageTaskInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("参数解析失败: {error}")))?;
        if input.prompt.trim().is_empty() {
            return Err(ToolError::invalid_params(
                "prompt 不能为空字符串".to_string(),
            ));
        }
        let payload = serde_json::json!({
            "prompt": input.prompt,
            "style": input.style,
            "size": input.size,
            "count": input.count,
            "usage": input.usage
        });
        submit_creation_task_record(
            &self.app_handle,
            context,
            "image_generate",
            input.title,
            payload,
            input.output_path.as_deref(),
        )
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UrlParseTaskInput {
    url: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    summary: Option<String>,
    #[serde(default)]
    key_points: Option<Vec<String>>,
    #[serde(default)]
    extract_status: Option<String>,
    #[serde(default)]
    output_path: Option<String>,
}

#[derive(Clone)]
struct ProxycastCreateUrlParseTaskTool {
    app_handle: AppHandle,
}

impl ProxycastCreateUrlParseTaskTool {
    fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

#[async_trait]
impl Tool for ProxycastCreateUrlParseTaskTool {
    fn name(&self) -> &str {
        PROXYCAST_CREATE_URL_PARSE_TASK_TOOL_NAME
    }

    fn description(&self) -> &str {
        "创建链接解析任务（url_parse）。"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "url": { "type": "string", "description": "目标 URL。" },
                "title": { "type": "string", "description": "任务标题（可选）。" },
                "summary": { "type": "string", "description": "摘要（可选）。" },
                "keyPoints": { "type": "array", "items": { "type": "string" }, "description": "关键要点（可选）。" },
                "extractStatus": { "type": "string", "description": "提取状态（可选）。" },
                "outputPath": { "type": "string", "description": "可选输出路径（相对工作目录）。" }
            },
            "required": ["url"],
            "additionalProperties": false,
            "x-proxycast": {
                "always_visible": true,
                "tags": ["url", "parse", "task"],
                "allowed_callers": ["assistant", "skill"]
            }
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input: UrlParseTaskInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("参数解析失败: {error}")))?;
        if input.url.trim().is_empty() {
            return Err(ToolError::invalid_params("url 不能为空字符串".to_string()));
        }
        let payload = serde_json::json!({
            "url": input.url,
            "summary": input.summary,
            "keyPoints": input.key_points,
            "extractStatus": input.extract_status
        });
        submit_creation_task_record(
            &self.app_handle,
            context,
            "url_parse",
            input.title,
            payload,
            input.output_path.as_deref(),
        )
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TypesettingTaskInput {
    content: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    target_platform: Option<String>,
    #[serde(default)]
    rules: Option<serde_json::Value>,
    #[serde(default)]
    output_path: Option<String>,
}

#[derive(Clone)]
struct ProxycastCreateTypesettingTaskTool {
    app_handle: AppHandle,
}

impl ProxycastCreateTypesettingTaskTool {
    fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

#[async_trait]
impl Tool for ProxycastCreateTypesettingTaskTool {
    fn name(&self) -> &str {
        PROXYCAST_CREATE_TYPESETTING_TASK_TOOL_NAME
    }

    fn description(&self) -> &str {
        "创建排版优化任务（typesetting）。"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "content": { "type": "string", "description": "待排版内容。" },
                "title": { "type": "string", "description": "任务标题（可选）。" },
                "targetPlatform": { "type": "string", "description": "目标平台（可选）。" },
                "rules": { "type": "object", "description": "排版规则（可选）。" },
                "outputPath": { "type": "string", "description": "可选输出路径（相对工作目录）。" }
            },
            "required": ["content"],
            "additionalProperties": false,
            "x-proxycast": {
                "always_visible": true,
                "tags": ["typesetting", "task", "text"],
                "allowed_callers": ["assistant", "skill"]
            }
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input: TypesettingTaskInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("参数解析失败: {error}")))?;
        if input.content.trim().is_empty() {
            return Err(ToolError::invalid_params(
                "content 不能为空字符串".to_string(),
            ));
        }
        let payload = serde_json::json!({
            "content": input.content,
            "targetPlatform": input.target_platform,
            "rules": input.rules
        });
        submit_creation_task_record(
            &self.app_handle,
            context,
            "typesetting",
            input.title,
            payload,
            input.output_path.as_deref(),
        )
    }
}

#[derive(Clone)]
struct ProxycastCreateVideoGenerationTaskTool {
    db: DbConnection,
    api_key_provider_service: Arc<ApiKeyProviderService>,
}

impl ProxycastCreateVideoGenerationTaskTool {
    fn new(db: DbConnection, api_key_provider_service: Arc<ApiKeyProviderService>) -> Self {
        Self {
            db,
            api_key_provider_service,
        }
    }
}

#[async_trait]
impl Tool for ProxycastCreateVideoGenerationTaskTool {
    fn name(&self) -> &str {
        PROXYCAST_CREATE_VIDEO_TASK_TOOL_NAME
    }

    fn description(&self) -> &str {
        "调用 ProxyCast 视频任务服务，创建真实的视频生成任务。"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "projectId": { "type": "string", "description": "项目 ID。" },
                "providerId": { "type": "string", "description": "视频服务 Provider ID。" },
                "model": { "type": "string", "description": "模型名。" },
                "prompt": { "type": "string", "description": "视频生成提示词。" },
                "aspectRatio": { "type": "string", "description": "画幅比例，例如 16:9、9:16。" },
                "resolution": { "type": "string", "description": "分辨率，例如 720p。" },
                "duration": { "type": "integer", "description": "时长（秒）。" },
                "imageUrl": { "type": "string", "description": "首帧图 URL（可选）。" },
                "endImageUrl": { "type": "string", "description": "末帧图 URL（可选）。" },
                "seed": { "type": "integer", "description": "随机种子（可选）。" },
                "generateAudio": { "type": "boolean", "description": "是否生成音频（可选）。" },
                "cameraFixed": { "type": "boolean", "description": "是否固定镜头（可选）。" }
            },
            "required": ["projectId", "providerId", "model", "prompt"],
            "additionalProperties": false,
            "x-proxycast": {
                "always_visible": true,
                "tags": ["video", "task", "generation"],
                "allowed_callers": ["assistant", "skill"],
                "input_examples": [
                    {
                        "projectId": "project-demo",
                        "providerId": "volcengine",
                        "model": "doubao-seedance-1-0-pro-250528",
                        "prompt": "未来城市清晨，镜头缓慢推进，电影感",
                        "aspectRatio": "16:9",
                        "duration": 5
                    }
                ]
            }
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let request: CreateVideoGenerationRequest = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("参数解析失败: {error}")))?;
        if request.project_id.trim().is_empty()
            || request.provider_id.trim().is_empty()
            || request.model.trim().is_empty()
            || request.prompt.trim().is_empty()
        {
            return Err(ToolError::invalid_params(
                "projectId/providerId/model/prompt 均不能为空".to_string(),
            ));
        }

        let service = VideoGenerationService::new();
        let created = service
            .create_task(&self.db, self.api_key_provider_service.as_ref(), request)
            .await
            .map_err(|error| ToolError::execution_failed(format!("创建视频任务失败: {error}")))?;

        let payload = serde_json::json!({
            "success": true,
            "task": created
        });
        let output = serde_json::to_string_pretty(&payload).unwrap_or_else(|_| payload.to_string());
        Ok(ToolResult::success(output))
    }
}

struct ToolSearchBridgeTool {
    registry: Arc<tokio::sync::RwLock<aster::tools::ToolRegistry>>,
}

impl ToolSearchBridgeTool {
    fn new(registry: Arc<tokio::sync::RwLock<aster::tools::ToolRegistry>>) -> Self {
        Self { registry }
    }

    fn with_input_examples_in_schema(
        schema: &serde_json::Value,
        input_examples: &[serde_json::Value],
    ) -> serde_json::Value {
        if input_examples.is_empty() {
            return schema.clone();
        }

        let mut enriched = schema.clone();
        let Some(root) = enriched.as_object_mut() else {
            return schema.clone();
        };
        let extension = root
            .entry("x-proxycast".to_string())
            .or_insert_with(|| serde_json::json!({}));
        let Some(extension_obj) = extension.as_object_mut() else {
            return schema.clone();
        };
        if extension_obj.get("input_examples").is_none()
            && extension_obj.get("inputExamples").is_none()
        {
            extension_obj.insert(
                "input_examples".to_string(),
                serde_json::Value::Array(input_examples.to_vec()),
            );
        }
        enriched
    }

    fn parse_schema_metadata(
        tool_name: &str,
        schema: &serde_json::Value,
    ) -> (
        bool,                   // deferred_loading
        bool,                   // always_visible
        Vec<String>,            // allowed_callers
        Vec<String>,            // tags
        Vec<serde_json::Value>, // input_examples
    ) {
        let extension = schema
            .get("x-proxycast")
            .or_else(|| schema.get("x_proxycast"))
            .unwrap_or(schema);

        let deferred_loading = extension
            .get("deferred_loading")
            .or_else(|| extension.get("deferredLoading"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let always_visible = extension
            .get("always_visible")
            .or_else(|| extension.get("alwaysVisible"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let allowed_callers = extension
            .get("allowed_callers")
            .or_else(|| extension.get("allowedCallers"))
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .map(|v| v.trim().to_ascii_lowercase())
                    .filter(|v| !v.is_empty())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let tags = extension
            .get("tags")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .map(|v| v.trim().to_ascii_lowercase())
                    .filter(|v| !v.is_empty())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let input_examples =
            proxycast_core::tool_calling::resolve_tool_input_examples(tool_name, schema);

        (
            deferred_loading,
            always_visible,
            allowed_callers,
            tags,
            input_examples,
        )
    }

    fn score_match(name: &str, description: &str, tags: &[String], query: &str) -> i32 {
        if query.is_empty() {
            return 1;
        }
        let name_lc = name.to_ascii_lowercase();
        let description_lc = description.to_ascii_lowercase();

        let mut score = 0;
        if name_lc == query {
            score += 120;
        } else if name_lc.starts_with(query) {
            score += 90;
        } else if name_lc.contains(query) {
            score += 70;
        }
        if description_lc.contains(query) {
            score += 40;
        }
        for tag in tags {
            if tag == query {
                score += 35;
            } else if tag.contains(query) {
                score += 20;
            }
        }
        score
    }
}

#[async_trait]
impl Tool for ToolSearchBridgeTool {
    fn name(&self) -> &str {
        "tool_search"
    }

    fn description(&self) -> &str {
        "搜索当前会话可用工具；默认会过滤 deferred_loading 工具，并按调用方做 allowed_callers 约束。"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "query": { "type": "string", "description": "工具名称/描述关键词" },
                "caller": { "type": "string", "description": "调用方，例如 assistant/code_execution" },
                "limit": { "type": "integer", "minimum": 1, "maximum": 100 },
                "include_deferred": { "type": "boolean", "description": "是否包含延迟加载工具" },
                "include_schema": { "type": "boolean", "description": "是否返回完整输入 schema" }
            },
            "required": []
        })
    }

    fn options(&self) -> ToolOptions {
        ToolOptions::new()
            .with_max_retries(1)
            .with_base_timeout(Duration::from_secs(15))
            .with_dynamic_timeout(false)
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let query = params
            .get("query")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        let caller = params
            .get("caller")
            .and_then(|v| v.as_str())
            .unwrap_or("assistant")
            .trim()
            .to_ascii_lowercase();
        let include_deferred = params
            .get("include_deferred")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let include_schema = params
            .get("include_schema")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let limit = params
            .get("limit")
            .and_then(|v| v.as_u64())
            .map(|v| v.clamp(1, 100) as usize)
            .unwrap_or(10);

        let registry = self.registry.read().await;
        let definitions = registry.get_definitions();

        let mut scored = definitions
            .into_iter()
            .filter(|d| d.name != self.name())
            .filter_map(|definition| {
                let (deferred_loading, always_visible, allowed_callers, tags, input_examples) =
                    Self::parse_schema_metadata(&definition.name, &definition.input_schema);
                if deferred_loading && !always_visible && !include_deferred {
                    return None;
                }
                if !allowed_callers.is_empty() && !allowed_callers.contains(&caller) {
                    return None;
                }

                let score =
                    Self::score_match(&definition.name, &definition.description, &tags, &query);
                if score <= 0 {
                    return None;
                }

                let item = if include_schema {
                    let enriched_schema = Self::with_input_examples_in_schema(
                        &definition.input_schema,
                        &input_examples,
                    );
                    serde_json::json!({
                        "name": definition.name,
                        "description": definition.description,
                        "input_schema": enriched_schema,
                        "deferred_loading": deferred_loading,
                        "always_visible": always_visible,
                        "allowed_callers": allowed_callers,
                        "input_examples": input_examples,
                        "tags": tags
                    })
                } else {
                    serde_json::json!({
                        "name": definition.name,
                        "description": definition.description,
                        "deferred_loading": deferred_loading,
                        "always_visible": always_visible,
                        "allowed_callers": allowed_callers,
                        "input_examples": input_examples,
                        "tags": tags
                    })
                };
                Some((score, item))
            })
            .collect::<Vec<_>>();

        scored.sort_by(|(a_score, a_item), (b_score, b_item)| {
            b_score.cmp(a_score).then_with(|| {
                a_item["name"]
                    .as_str()
                    .unwrap_or_default()
                    .cmp(b_item["name"].as_str().unwrap_or_default())
            })
        });

        let result = scored
            .into_iter()
            .take(limit)
            .map(|(_, item)| item)
            .collect::<Vec<_>>();
        let text = serde_json::to_string_pretty(&serde_json::json!({
            "query": query,
            "caller": caller,
            "count": result.len(),
            "tools": result
        }))
        .map_err(|e| ToolError::execution_failed(format!("tool_search 序列化失败: {e}")))?;

        Ok(ToolResult::success(text))
    }
}

fn browser_mcp_tool_names() -> Vec<String> {
    let mut names = Vec::new();
    for tool in get_chrome_mcp_tools() {
        names.push(format!("mcp__proxycast-browser__{}", tool.name));
    }
    names
}

fn register_browser_mcp_tools_to_registry(registry: &mut aster::tools::ToolRegistry) {
    let tool_defs = get_chrome_mcp_tools();
    for tool_def in tool_defs {
        for prefix in ["mcp__proxycast-browser__"] {
            let full_name = format!("{prefix}{}", tool_def.name);
            if registry.contains(&full_name) {
                continue;
            }
            let tool = ProxycastBrowserMcpTool::new(
                full_name,
                tool_def.name.clone(),
                tool_def.description.clone(),
                tool_def.input_schema.clone(),
            );
            registry.register(Box::new(tool));
        }
    }
}

fn register_social_image_tool_to_registry(
    registry: &mut aster::tools::ToolRegistry,
    config_manager: Arc<GlobalConfigManager>,
) {
    if registry.contains(SOCIAL_IMAGE_TOOL_NAME) {
        return;
    }
    registry.register(Box::new(SocialGenerateCoverImageTool::new(config_manager)));
}

fn register_creation_task_tools_to_registry(
    registry: &mut aster::tools::ToolRegistry,
    db: DbConnection,
    api_key_provider_service: Arc<ApiKeyProviderService>,
    app_handle: AppHandle,
) {
    if !registry.contains(PROXYCAST_CREATE_VIDEO_TASK_TOOL_NAME) {
        registry.register(Box::new(ProxycastCreateVideoGenerationTaskTool::new(
            db.clone(),
            api_key_provider_service.clone(),
        )));
    }
    if !registry.contains(PROXYCAST_CREATE_BROADCAST_TASK_TOOL_NAME) {
        registry.register(Box::new(ProxycastCreateBroadcastTaskTool::new(
            app_handle.clone(),
        )));
    }
    if !registry.contains(PROXYCAST_CREATE_COVER_TASK_TOOL_NAME) {
        registry.register(Box::new(ProxycastCreateCoverTaskTool::new(
            app_handle.clone(),
        )));
    }
    if !registry.contains(PROXYCAST_CREATE_RESOURCE_SEARCH_TASK_TOOL_NAME) {
        registry.register(Box::new(ProxycastCreateResourceSearchTaskTool::new(
            app_handle.clone(),
        )));
    }
    if !registry.contains(PROXYCAST_CREATE_IMAGE_TASK_TOOL_NAME) {
        registry.register(Box::new(ProxycastCreateImageTaskTool::new(
            app_handle.clone(),
        )));
    }
    if !registry.contains(PROXYCAST_CREATE_URL_PARSE_TASK_TOOL_NAME) {
        registry.register(Box::new(ProxycastCreateUrlParseTaskTool::new(
            app_handle.clone(),
        )));
    }
    if !registry.contains(PROXYCAST_CREATE_TYPESETTING_TASK_TOOL_NAME) {
        registry.register(Box::new(ProxycastCreateTypesettingTaskTool::new(
            app_handle,
        )));
    }
}

fn register_tool_search_tool_to_registry(
    registry: &mut aster::tools::ToolRegistry,
    registry_arc: Arc<tokio::sync::RwLock<aster::tools::ToolRegistry>>,
) {
    if registry.contains("tool_search") {
        return;
    }
    registry.register(Box::new(ToolSearchBridgeTool::new(registry_arc)));
}

pub async fn ensure_browser_mcp_tools_registered(state: &AsterAgentState) -> Result<(), String> {
    let agent_arc = state.get_agent_arc();
    let guard = agent_arc.read().await;
    let agent = guard
        .as_ref()
        .ok_or_else(|| "Agent not initialized".to_string())?;
    let registry_arc = agent.tool_registry().clone();
    drop(guard);

    let mut registry = registry_arc.write().await;
    register_browser_mcp_tools_to_registry(&mut registry);
    register_tool_search_tool_to_registry(&mut registry, registry_arc.clone());
    Ok(())
}

pub async fn ensure_social_image_tool_registered(
    state: &AsterAgentState,
    config_manager: &GlobalConfigManagerState,
) -> Result<(), String> {
    let agent_arc = state.get_agent_arc();
    let guard = agent_arc.read().await;
    let agent = guard
        .as_ref()
        .ok_or_else(|| "Agent not initialized".to_string())?;
    let registry_arc = agent.tool_registry().clone();
    drop(guard);

    let mut registry = registry_arc.write().await;
    register_social_image_tool_to_registry(&mut registry, config_manager.0.clone());
    Ok(())
}

pub async fn ensure_creation_task_tools_registered(
    state: &AsterAgentState,
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderServiceState,
    app_handle: &AppHandle,
) -> Result<(), String> {
    let agent_arc = state.get_agent_arc();
    let guard = agent_arc.read().await;
    let agent = guard
        .as_ref()
        .ok_or_else(|| "Agent not initialized".to_string())?;
    let registry_arc = agent.tool_registry().clone();
    drop(guard);

    let mut registry = registry_arc.write().await;
    register_creation_task_tools_to_registry(
        &mut registry,
        db.clone(),
        api_key_provider_service.0.clone(),
        app_handle.clone(),
    );
    Ok(())
}

pub async fn ensure_tool_search_tool_registered(state: &AsterAgentState) -> Result<(), String> {
    let agent_arc = state.get_agent_arc();
    let guard = agent_arc.read().await;
    let agent = guard
        .as_ref()
        .ok_or_else(|| "Agent not initialized".to_string())?;
    let registry_arc = agent.tool_registry().clone();
    drop(guard);

    let mut registry = registry_arc.write().await;
    register_tool_search_tool_to_registry(&mut registry, registry_arc.clone());
    Ok(())
}

fn build_workspace_shell_allow_pattern(
    escaped_root: &str,
    allow_extended_shell_commands: bool,
) -> String {
    if allow_extended_shell_commands {
        // Auto 模式放宽命令白名单，交由本地 sandbox 与 BashTool 安全检查兜底。
        // 这里使用 DOTALL 支持 heredoc 等多行命令（例如 python <<'EOF' ...）。
        return String::from(r"(?s)^\s*\S.*$");
    }

    format!(
        r"^\s*(?:cd\s+({escaped_root}|\.|\./|\.\./)|pwd|ls(?:\s+[^;&|]+)?|find\s+({escaped_root}|\.|\./|\.\./)[^;&|]*|rg\b[^;&|]*|grep\b[^;&|]*|cat\s+({escaped_root}|\.|\./|\.\./)[^;&|]*)\s*$"
    )
}

/// 为指定工作区生成本地 sandbox 权限模板
async fn apply_workspace_sandbox_permissions(
    state: &AsterAgentState,
    config_manager: &GlobalConfigManagerState,
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderServiceState,
    heartbeat_state: &HeartbeatServiceState,
    app_handle: &AppHandle,
    workspace_root: &str,
    execution_strategy: AsterExecutionStrategy,
) -> Result<WorkspaceSandboxApplyOutcome, String> {
    let workspace_root = workspace_root.trim();
    if workspace_root.is_empty() {
        return Err("workspace 根目录为空".to_string());
    }

    let sandbox_policy = resolve_workspace_sandbox_policy(config_manager);
    let auto_mode = execution_strategy == AsterExecutionStrategy::Auto;
    let mut sandboxed_bash_tool: Option<WorkspaceSandboxedBashTool> = None;
    let apply_outcome = if !sandbox_policy.enabled {
        WorkspaceSandboxApplyOutcome::DisabledByConfig
    } else {
        match WorkspaceSandboxedBashTool::new(workspace_root, auto_mode) {
            Ok(tool) => {
                let sandbox_type = tool.sandbox_type().to_string();
                sandboxed_bash_tool = Some(tool);
                WorkspaceSandboxApplyOutcome::Applied { sandbox_type }
            }
            Err(reason) => {
                if sandbox_policy.strict {
                    return Err(format!(
                        "workspace 本地 sandbox 严格模式已启用，初始化失败: {reason}"
                    ));
                }
                WorkspaceSandboxApplyOutcome::UnavailableFallback {
                    warning_message: build_workspace_sandbox_warning_message(&reason),
                    notify_user: sandbox_policy.notify_on_fallback,
                }
            }
        }
    };

    let escaped_root = regex::escape(workspace_root);
    let virtual_memory_path_pattern = durable_memory_permission_pattern();
    let workspace_path_pattern =
        format!(r"^(?:({escaped_root}|\.|\./|\.\./).*$|{virtual_memory_path_pattern})");
    let workspace_abs_path_pattern = format!(r"^({escaped_root}).*$");
    let analyze_image_path_pattern = format!(
        r"^(base64:[A-Za-z0-9+/=]+|file://({escaped_root}).*|({escaped_root}|\.|\./|\.\./).*)$"
    );
    let safe_https_url_pattern = String::from(r"^https://[^\s]+$");
    let mut permissions = vec![
        ToolPermission {
            tool: "read".to_string(),
            allowed: true,
            priority: 100,
            conditions: Vec::new(),
            parameter_restrictions: if auto_mode {
                Vec::new()
            } else {
                vec![ParameterRestriction {
                    parameter: "path".to_string(),
                    restriction_type: RestrictionType::Pattern,
                    values: None,
                    pattern: Some(workspace_path_pattern.clone()),
                    validator: None,
                    min: None,
                    max: None,
                    required: true,
                    description: Some(
                        "read.path 必须在 workspace、相对路径或 `/memories/...` 内".to_string(),
                    ),
                }]
            },
            scope: PermissionScope::Session,
            reason: Some(if auto_mode {
                "Auto 模式：允许读取任意路径".to_string()
            } else {
                "仅允许读取当前 workspace 或 `/memories/` 内容".to_string()
            }),
            expires_at: None,
            metadata: HashMap::new(),
        },
        ToolPermission {
            tool: "write".to_string(),
            allowed: true,
            priority: 100,
            conditions: Vec::new(),
            parameter_restrictions: if auto_mode {
                Vec::new()
            } else {
                vec![ParameterRestriction {
                    parameter: "path".to_string(),
                    restriction_type: RestrictionType::Pattern,
                    values: None,
                    pattern: Some(workspace_path_pattern.clone()),
                    validator: None,
                    min: None,
                    max: None,
                    required: true,
                    description: Some(
                        "write.path 必须在 workspace、相对路径或 `/memories/...` 内".to_string(),
                    ),
                }]
            },
            scope: PermissionScope::Session,
            reason: Some(if auto_mode {
                "Auto 模式：允许写入任意路径".to_string()
            } else {
                "仅允许写入当前 workspace 或 `/memories/` 内容".to_string()
            }),
            expires_at: None,
            metadata: HashMap::new(),
        },
        ToolPermission {
            tool: "edit".to_string(),
            allowed: true,
            priority: 100,
            conditions: Vec::new(),
            parameter_restrictions: if auto_mode {
                Vec::new()
            } else {
                vec![ParameterRestriction {
                    parameter: "path".to_string(),
                    restriction_type: RestrictionType::Pattern,
                    values: None,
                    pattern: Some(workspace_path_pattern.clone()),
                    validator: None,
                    min: None,
                    max: None,
                    required: true,
                    description: Some(
                        "edit.path 必须在 workspace、相对路径或 `/memories/...` 内".to_string(),
                    ),
                }]
            },
            scope: PermissionScope::Session,
            reason: Some(if auto_mode {
                "Auto 模式：允许编辑任意路径".to_string()
            } else {
                "仅允许编辑当前 workspace 或 `/memories/` 内容".to_string()
            }),
            expires_at: None,
            metadata: HashMap::new(),
        },
        ToolPermission {
            tool: "glob".to_string(),
            allowed: true,
            priority: 100,
            conditions: Vec::new(),
            parameter_restrictions: if auto_mode {
                Vec::new()
            } else {
                vec![ParameterRestriction {
                    parameter: "path".to_string(),
                    restriction_type: RestrictionType::Pattern,
                    values: None,
                    pattern: Some(workspace_path_pattern.clone()),
                    validator: None,
                    min: None,
                    max: None,
                    required: false,
                    description: Some(
                        "glob.path 必须在 workspace、相对路径或 `/memories/...` 内".to_string(),
                    ),
                }]
            },
            scope: PermissionScope::Session,
            reason: Some(if auto_mode {
                "Auto 模式：允许任意路径搜索文件".to_string()
            } else {
                "仅允许在当前 workspace 或 `/memories/` 搜索文件".to_string()
            }),
            expires_at: None,
            metadata: HashMap::new(),
        },
        ToolPermission {
            tool: "grep".to_string(),
            allowed: true,
            priority: 100,
            conditions: Vec::new(),
            parameter_restrictions: if auto_mode {
                Vec::new()
            } else {
                vec![ParameterRestriction {
                    parameter: "path".to_string(),
                    restriction_type: RestrictionType::Pattern,
                    values: None,
                    pattern: Some(workspace_path_pattern.clone()),
                    validator: None,
                    min: None,
                    max: None,
                    required: false,
                    description: Some(
                        "grep.path 必须在 workspace、相对路径或 `/memories/...` 内".to_string(),
                    ),
                }]
            },
            scope: PermissionScope::Session,
            reason: Some(if auto_mode {
                "Auto 模式：允许任意路径搜索内容".to_string()
            } else {
                "仅允许在当前 workspace 或 `/memories/` 搜索内容".to_string()
            }),
            expires_at: None,
            metadata: HashMap::new(),
        },
    ];

    let allow_shell_pattern = build_workspace_shell_allow_pattern(&escaped_root, auto_mode);
    let shell_permission_description = if auto_mode {
        "Auto 模式：允许任意 bash.command"
    } else {
        "bash.command 仅允许 workspace 内安全读操作"
    };
    let shell_permission_reason = if auto_mode {
        "workspace 安全策略：Auto 模式允许任意命令（由本地 sandbox 兜底）"
    } else {
        "workspace 安全策略：bash 仅允许 workspace 内安全命令"
    };

    permissions.push(ToolPermission {
        tool: "bash".to_string(),
        allowed: true,
        priority: 90,
        conditions: Vec::new(),
        parameter_restrictions: if auto_mode {
            Vec::new()
        } else {
            vec![
                ParameterRestriction {
                    parameter: "command".to_string(),
                    restriction_type: RestrictionType::Pattern,
                    values: None,
                    pattern: Some(allow_shell_pattern.clone()),
                    validator: None,
                    min: None,
                    max: None,
                    required: false,
                    description: Some(shell_permission_description.to_string()),
                },
                ParameterRestriction {
                    parameter: "cmd".to_string(),
                    restriction_type: RestrictionType::Pattern,
                    values: None,
                    pattern: Some(allow_shell_pattern.clone()),
                    validator: None,
                    min: None,
                    max: None,
                    required: false,
                    description: Some("bash.cmd 兼容参数名，规则与 command 一致".to_string()),
                },
            ]
        },
        scope: PermissionScope::Session,
        reason: Some(shell_permission_reason.to_string()),
        expires_at: None,
        metadata: HashMap::new(),
    });

    let task_permission_description = if auto_mode {
        "Auto 模式：允许任意 Task.command"
    } else {
        "Task.command 仅允许 workspace 内安全命令"
    };
    let task_permission_reason = if auto_mode {
        "workspace 安全策略：Auto 模式允许 Task 执行任意命令"
    } else {
        "workspace 安全策略：Task 仅允许 workspace 内安全命令"
    };

    permissions.push(ToolPermission {
        tool: "Task".to_string(),
        allowed: true,
        priority: 88,
        conditions: Vec::new(),
        parameter_restrictions: if auto_mode {
            Vec::new()
        } else {
            vec![
                ParameterRestriction {
                    parameter: "command".to_string(),
                    restriction_type: RestrictionType::Pattern,
                    values: None,
                    pattern: Some(allow_shell_pattern.clone()),
                    validator: None,
                    min: None,
                    max: None,
                    required: false,
                    description: Some(task_permission_description.to_string()),
                },
                ParameterRestriction {
                    parameter: "cmd".to_string(),
                    restriction_type: RestrictionType::Pattern,
                    values: None,
                    pattern: Some(allow_shell_pattern.clone()),
                    validator: None,
                    min: None,
                    max: None,
                    required: false,
                    description: Some("Task.cmd 兼容参数名，规则与 command 一致".to_string()),
                },
            ]
        },
        scope: PermissionScope::Session,
        reason: Some(task_permission_reason.to_string()),
        expires_at: None,
        metadata: HashMap::new(),
    });

    permissions.push(ToolPermission {
        tool: "lsp".to_string(),
        allowed: true,
        priority: 88,
        conditions: Vec::new(),
        parameter_restrictions: if auto_mode {
            Vec::new()
        } else {
            vec![ParameterRestriction {
                parameter: "path".to_string(),
                restriction_type: RestrictionType::Pattern,
                values: None,
                pattern: Some(workspace_path_pattern.clone()),
                validator: None,
                min: None,
                max: None,
                required: true,
                description: Some("lsp.path 必须在 workspace 内或相对路径".to_string()),
            }]
        },
        scope: PermissionScope::Session,
        reason: Some(if auto_mode {
            "Auto 模式：允许任意 LSP 路径".to_string()
        } else {
            "允许在 workspace 内使用 LSP".to_string()
        }),
        expires_at: None,
        metadata: HashMap::new(),
    });

    permissions.push(ToolPermission {
        tool: "NotebookEdit".to_string(),
        allowed: true,
        priority: 88,
        conditions: Vec::new(),
        parameter_restrictions: if auto_mode {
            Vec::new()
        } else {
            vec![ParameterRestriction {
                parameter: "notebook_path".to_string(),
                restriction_type: RestrictionType::Pattern,
                values: None,
                pattern: Some(workspace_abs_path_pattern.clone()),
                validator: None,
                min: None,
                max: None,
                required: true,
                description: Some(
                    "NotebookEdit.notebook_path 必须是 workspace 内绝对路径".to_string(),
                ),
            }]
        },
        scope: PermissionScope::Session,
        reason: Some(if auto_mode {
            "Auto 模式：允许编辑任意 Notebook 路径".to_string()
        } else {
            "允许编辑 workspace 内 Notebook".to_string()
        }),
        expires_at: None,
        metadata: HashMap::new(),
    });

    permissions.push(ToolPermission {
        tool: "analyze_image".to_string(),
        allowed: true,
        priority: 88,
        conditions: Vec::new(),
        parameter_restrictions: if auto_mode {
            Vec::new()
        } else {
            vec![ParameterRestriction {
                parameter: "file_path".to_string(),
                restriction_type: RestrictionType::Pattern,
                values: None,
                pattern: Some(analyze_image_path_pattern),
                validator: None,
                min: None,
                max: None,
                required: true,
                description: Some(
                    "analyze_image.file_path 仅允许 base64、workspace 内绝对路径或相对路径"
                        .to_string(),
                ),
            }]
        },
        scope: PermissionScope::Session,
        reason: Some(if auto_mode {
            "Auto 模式：允许分析任意图片路径或 base64".to_string()
        } else {
            "允许分析 workspace 内图片或 base64 数据".to_string()
        }),
        expires_at: None,
        metadata: HashMap::new(),
    });

    permissions.push(ToolPermission {
        tool: "WebFetch".to_string(),
        allowed: true,
        priority: 88,
        conditions: Vec::new(),
        parameter_restrictions: if auto_mode {
            Vec::new()
        } else {
            vec![ParameterRestriction {
                parameter: "url".to_string(),
                restriction_type: RestrictionType::Pattern,
                values: None,
                pattern: Some(safe_https_url_pattern),
                validator: None,
                min: None,
                max: None,
                required: true,
                description: Some("WebFetch.url 仅允许 https 且禁止内网/本机地址".to_string()),
            }]
        },
        scope: PermissionScope::Session,
        reason: Some(if auto_mode {
            "Auto 模式：允许任意 WebFetch URL".to_string()
        } else {
            "允许安全的 WebFetch 请求".to_string()
        }),
        expires_at: None,
        metadata: HashMap::new(),
    });

    if auto_mode {
        permissions.push(ToolPermission {
            tool: "*".to_string(),
            allowed: true,
            priority: 1000,
            conditions: Vec::new(),
            parameter_restrictions: Vec::new(),
            scope: PermissionScope::Session,
            reason: Some("Auto 模式：允许所有工具与参数".to_string()),
            expires_at: None,
            metadata: HashMap::new(),
        });
    }

    for tool_name in [
        "Skill",
        "SubAgentTask",
        "TaskOutput",
        "KillShell",
        "TodoWrite",
        "EnterPlanMode",
        "ExitPlanMode",
        "WebSearch",
        "ask",
        "tool_search",
        "three_stage_workflow",
        "heartbeat",
        SOCIAL_IMAGE_TOOL_NAME,
        PROXYCAST_CREATE_VIDEO_TASK_TOOL_NAME,
        PROXYCAST_CREATE_BROADCAST_TASK_TOOL_NAME,
        PROXYCAST_CREATE_COVER_TASK_TOOL_NAME,
        PROXYCAST_CREATE_RESOURCE_SEARCH_TASK_TOOL_NAME,
        PROXYCAST_CREATE_IMAGE_TASK_TOOL_NAME,
        PROXYCAST_CREATE_URL_PARSE_TASK_TOOL_NAME,
        PROXYCAST_CREATE_TYPESETTING_TASK_TOOL_NAME,
    ] {
        permissions.push(ToolPermission {
            tool: tool_name.to_string(),
            allowed: true,
            priority: 88,
            conditions: Vec::new(),
            parameter_restrictions: Vec::new(),
            scope: PermissionScope::Session,
            reason: Some(format!("允许默认工具: {tool_name}")),
            expires_at: None,
            metadata: HashMap::new(),
        });
    }

    for tool_name in browser_mcp_tool_names() {
        permissions.push(ToolPermission {
            tool: tool_name,
            allowed: true,
            priority: 88,
            conditions: Vec::new(),
            parameter_restrictions: Vec::new(),
            scope: PermissionScope::Session,
            reason: Some("允许浏览器 MCP 兼容工具".to_string()),
            expires_at: None,
            metadata: HashMap::new(),
        });
    }

    permissions.push(ToolPermission {
        tool: "*".to_string(),
        allowed: false,
        priority: 10,
        conditions: Vec::new(),
        parameter_restrictions: Vec::new(),
        scope: PermissionScope::Session,
        reason: Some("workspace 安全策略：未显式授权的工具默认拒绝".to_string()),
        expires_at: None,
        metadata: HashMap::new(),
    });

    let agent_arc = state.get_agent_arc();
    let guard = agent_arc.read().await;
    let agent = guard
        .as_ref()
        .ok_or_else(|| "Agent not initialized".to_string())?;
    let registry_arc = agent.tool_registry().clone();
    drop(guard);

    let mut registry = registry_arc.write().await;
    let mut permission_manager = ToolPermissionManager::new(None);
    if let Some(existing_manager) = registry.permission_manager() {
        for permission in existing_manager.get_permissions(None) {
            let scope = permission.scope;
            permission_manager.add_permission(permission, scope);
        }
    }

    for permission in permissions {
        permission_manager.add_permission(permission, PermissionScope::Session);
    }
    registry.set_permission_manager(Arc::new(permission_manager));

    let task_manager = shared_task_manager();
    registry.register(Box::new(WorkspaceTaskTool::new(
        auto_mode,
        task_manager.clone(),
    )));
    registry.register(Box::new(SubAgentTaskTool::new(
        db.clone(),
        app_handle.clone(),
    )));
    registry.register(Box::new(WorkspaceTaskOutputTool::new(task_manager.clone())));
    registry.register(Box::new(KillShellTool::with_task_manager(task_manager)));

    if let Some(workspace_bash_tool) = sandboxed_bash_tool {
        registry.register(Box::new(workspace_bash_tool));
    }

    // 注册心跳工具
    let heartbeat_adapter =
        HeartbeatServiceAdapter::new(heartbeat_state.clone(), app_handle.clone());
    let heartbeat_tool = proxycast_agent::tools::HeartbeatTool::new(Arc::new(heartbeat_adapter));
    registry.register(Box::new(heartbeat_tool));

    register_social_image_tool_to_registry(&mut registry, config_manager.0.clone());
    register_creation_task_tools_to_registry(
        &mut registry,
        db.clone(),
        api_key_provider_service.0.clone(),
        app_handle.clone(),
    );

    // 注册浏览器 MCP 工具
    register_browser_mcp_tools_to_registry(&mut registry);
    wrap_registry_native_tools_for_durable_memory_fs(&mut registry);
    wrap_registry_native_tools_for_harness_observability(&mut registry);

    Ok(apply_outcome)
}

/// 图片输入
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct ImageInput {
    pub data: String,
    pub media_type: String,
}

/// 发送消息并获取流式响应
#[tauri::command]
pub async fn aster_agent_chat_stream(
    app: AppHandle,
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    api_key_provider_service: State<'_, ApiKeyProviderServiceState>,
    logs: State<'_, LogState>,
    config_manager: State<'_, GlobalConfigManagerState>,
    mcp_manager: State<'_, McpManagerState>,
    heartbeat_state: State<'_, HeartbeatServiceState>,
    request: AsterChatRequest,
) -> Result<(), String> {
    tracing::info!(
        "[AsterAgent] 发送流式消息: session={}, event={}",
        request.session_id,
        request.event_name
    );

    // 确保 Agent 已初始化（使用带数据库的版本，注入 SessionStore）
    let is_init = state.is_initialized().await;
    tracing::warn!("[AsterAgent] Agent 初始化状态: {}", is_init);
    if !is_init {
        tracing::warn!("[AsterAgent] Agent 未初始化，开始初始化...");
        state.init_agent_with_db(&db).await?;
        tracing::warn!("[AsterAgent] Agent 初始化完成");
    } else {
        tracing::warn!("[AsterAgent] Agent 已初始化，检查 session_store...");
        // 检查 session_store 是否存在
        let agent_arc = state.get_agent_arc();
        let guard = agent_arc.read().await;
        if let Some(agent) = guard.as_ref() {
            let has_store = agent.session_store().is_some();
            tracing::warn!("[AsterAgent] session_store 存在: {}", has_store);
        }
    }
    ensure_social_image_tool_registered(state.inner(), config_manager.inner()).await?;

    // 直接使用前端传递的 session_id
    // ProxyCastSessionStore 会在 add_message 时自动创建不存在的 session
    // 同时 get_session 也会自动创建不存在的 session
    let session_id = &request.session_id;

    let workspace_id = request.workspace_id.trim().to_string();
    if workspace_id.is_empty() {
        let message = "workspace_id 必填，请先选择项目工作区".to_string();
        logs.write()
            .await
            .add("error", &format!("[AsterAgent] {}", message));
        return Err(message);
    }

    let manager = WorkspaceManager::new(db.inner().clone());
    let workspace = match manager.get(&workspace_id) {
        Ok(Some(workspace)) => workspace,
        Ok(None) => {
            let message = format!("Workspace 不存在: {workspace_id}");
            logs.write()
                .await
                .add("error", &format!("[AsterAgent] {}", message));
            return Err(message);
        }
        Err(error) => {
            let message = format!("读取 workspace 失败: {error}");
            logs.write()
                .await
                .add("error", &format!("[AsterAgent] {}", message));
            return Err(message);
        }
    };
    let ensured = match ensure_workspace_ready_with_auto_relocate(&manager, &workspace) {
        Ok(result) => result,
        Err(message) => {
            logs.write()
                .await
                .add("error", &format!("[AsterAgent] {}", message));
            return Err(message);
        }
    };
    let workspace_root = ensured.root_path.to_string_lossy().to_string();
    let runtime_config = config_manager.config();
    apply_web_search_runtime_env(&runtime_config);
    let auto_continue_config = request
        .auto_continue
        .clone()
        .map(AutoContinuePayload::normalized);
    let auto_continue_enabled = auto_continue_config
        .as_ref()
        .map(|config| config.enabled)
        .unwrap_or(false);
    if let Some(config) = auto_continue_config
        .as_ref()
        .filter(|config| config.enabled)
    {
        tracing::info!(
            "[AsterAgent] 自动续写策略已启用: source={:?}, fast_mode={}, continuation_length={}, sensitivity={}",
            config.source,
            config.fast_mode_enabled,
            config.continuation_length,
            config.sensitivity
        );
    }

    if ensured.repaired {
        let warning_message = ensured.warning.unwrap_or_else(|| {
            format!(
                "检测到工作区目录缺失，已自动创建并继续执行: {}",
                workspace_root
            )
        });
        logs.write()
            .await
            .add("warn", &format!("[AsterAgent] {}", warning_message));
        let warning_event = TauriAgentEvent::Warning {
            code: Some(WORKSPACE_PATH_AUTO_CREATED_WARNING_CODE.to_string()),
            message: warning_message,
        };
        if let Err(error) = app.emit(&request.event_name, &warning_event) {
            tracing::error!("[AsterAgent] 发送工作区自动恢复提醒失败: {}", error);
        }
    }

    {
        let db_conn = db.lock().map_err(|e| format!("获取数据库连接失败: {e}"))?;
        if let Some(session) = AgentDao::get_session(&db_conn, session_id)
            .map_err(|e| format!("读取 session 失败: {e}"))?
        {
            let session_dir = session.working_dir.unwrap_or_default();
            if !session_dir.is_empty() && session_dir != workspace_root {
                tracing::info!(
                    "[AsterAgent] workspace 变更，自动更新 session working_dir: {} -> {}",
                    session_dir,
                    workspace_root
                );
                db_conn
                    .execute(
                        "UPDATE agent_sessions SET working_dir = ?1 WHERE id = ?2",
                        rusqlite::params![&workspace_root, session_id],
                    )
                    .map_err(|e| format!("更新 session working_dir 失败: {e}"))?;
            }
        }
    }

    // 启动并注入 MCP extensions 到 Aster Agent
    let (_start_ok, start_fail) = ensure_proxycast_mcp_servers_running(&db, &mcp_manager).await;
    if start_fail > 0 {
        tracing::warn!(
            "[AsterAgent] 部分 MCP server 自动启动失败 ({} 失败)，后续可用工具可能不完整",
            start_fail
        );
    }

    let (_mcp_ok, mcp_fail) = inject_mcp_extensions(&state, &mcp_manager).await;
    if mcp_fail > 0 {
        tracing::warn!(
            "[AsterAgent] 部分 MCP extension 注入失败 ({} 失败)，Agent 可能无法使用某些 MCP 工具",
            mcp_fail
        );
    }

    // 构建请求级工具策略：effective_web_search = request.web_search ?? mode_default(false)
    let request_tool_policy = resolve_request_tool_policy(request.web_search, false);
    tracing::info!(
        "[AsterAgent][WebSearchGuard] session={}, request_web_search={:?}, mode_default_web_search=false, effective_web_search={}",
        session_id,
        request.web_search,
        request_tool_policy.effective_web_search
    );

    // 构建 system_prompt：优先使用项目上下文，其次使用 session 的 system_prompt
    // 同时读取会话已持久化的 execution_strategy
    let (system_prompt, persisted_strategy) = {
        let db_conn = db.lock().map_err(|e| format!("获取数据库连接失败: {e}"))?;
        let session = AgentDao::get_session(&db_conn, session_id)
            .map_err(|e| format!("读取 session 失败: {e}"))?;
        let persisted = session
            .as_ref()
            .map(|s| AsterExecutionStrategy::from_db_value(s.execution_strategy.as_deref()))
            .unwrap_or_default();

        // 1. 如果提供了 project_id，构建项目上下文
        let project_prompt = if let Some(ref project_id) = request.project_id {
            match AsterAgentState::build_project_system_prompt(&db, project_id) {
                Ok(prompt) => {
                    tracing::info!(
                        "[AsterAgent] 已加载项目上下文: project_id={}, prompt_len={}",
                        project_id,
                        prompt.len()
                    );
                    Some(prompt)
                }
                Err(e) => {
                    tracing::warn!(
                        "[AsterAgent] 加载项目上下文失败: {}, 继续使用 session prompt",
                        e
                    );
                    None
                }
            }
        } else {
            None
        };

        // 2. 如果没有项目上下文，尝试从 session 读取
        // 3. 如果 session 也没有，使用前端传入的 system_prompt
        let resolved_prompt = if project_prompt.is_some() {
            project_prompt
        } else {
            let session_prompt = match session {
                Some(session) => {
                    tracing::debug!(
                        "[AsterAgent] 找到 session，system_prompt: {:?}",
                        session.system_prompt.as_ref().map(|s| s.len())
                    );
                    session.system_prompt
                }
                None => {
                    tracing::debug!(
                        "[AsterAgent] ProxyCast 数据库中未找到 session: {}",
                        session_id
                    );
                    None
                }
            };
            // fallback 到前端传入的 system_prompt
            if session_prompt.is_some() {
                session_prompt
            } else if let Some(ref frontend_prompt) = request.system_prompt {
                if !frontend_prompt.trim().is_empty() {
                    tracing::info!(
                        "[AsterAgent] 使用前端传入的 system_prompt, len={}",
                        frontend_prompt.len()
                    );
                    Some(frontend_prompt.clone())
                } else {
                    None
                }
            } else {
                None
            }
        };

        let prompt_with_memory = merge_system_prompt_with_memory_sources(
            merge_system_prompt_with_memory_profile(resolved_prompt, &runtime_config),
            &runtime_config,
            Path::new(&workspace_root),
            None,
        );
        let merged_prompt = merge_system_prompt_with_auto_continue(
            merge_system_prompt_with_request_tool_policy(
                merge_system_prompt_with_web_search(prompt_with_memory, &runtime_config),
                &request_tool_policy,
            ),
            auto_continue_config.as_ref(),
        );

        (merged_prompt, persisted)
    };

    let requested_strategy = request.execution_strategy.unwrap_or(persisted_strategy);
    let effective_strategy = requested_strategy.effective_for_message(&request.message);

    if let Some(explicit_strategy) = request.execution_strategy {
        let db_conn = db.lock().map_err(|e| format!("获取数据库连接失败: {e}"))?;
        if AgentDao::session_exists(&db_conn, session_id).unwrap_or(false) {
            if let Err(e) = AgentDao::update_execution_strategy(
                &db_conn,
                session_id,
                explicit_strategy.as_db_value(),
            ) {
                tracing::warn!(
                    "[AsterAgent] 更新会话执行策略失败: session={}, strategy={}, error={}",
                    session_id,
                    explicit_strategy.as_db_value(),
                    e
                );
            }
        }
    }

    tracing::info!(
        "[AsterAgent] 执行策略: requested={:?}, effective={:?}",
        requested_strategy,
        effective_strategy
    );

    // 如果提供了 Provider 配置，则配置 Provider
    if let Some(provider_config) = &request.provider_config {
        tracing::info!(
            "[AsterAgent] 收到 provider_config: provider_id={:?}, provider_name={}, model_name={}, has_api_key={}, base_url={:?}",
            provider_config.provider_id,
            provider_config.provider_name,
            provider_config.model_name,
            provider_config.api_key.is_some(),
            provider_config.base_url
        );
        let config = ProviderConfig {
            provider_name: provider_config.provider_name.clone(),
            model_name: provider_config.model_name.clone(),
            api_key: provider_config.api_key.clone(),
            base_url: provider_config.base_url.clone(),
            credential_uuid: None,
        };
        // 如果前端提供了 api_key，直接使用；否则从凭证池选择凭证
        if provider_config.api_key.is_some() {
            state.configure_provider(config, session_id, &db).await?;
        } else {
            // 没有 api_key，使用凭证池（优先 provider_id，其次 provider_name）
            let provider_selector = provider_config
                .provider_id
                .as_deref()
                .unwrap_or(&provider_config.provider_name);
            state
                .configure_provider_from_pool(
                    &db,
                    provider_selector,
                    &provider_config.model_name,
                    session_id,
                )
                .await?;
        }
    }

    // 检查 Provider 是否已配置
    if !state.is_provider_configured().await {
        return Err("Provider 未配置，请先调用 aster_agent_configure_provider".to_string());
    }

    let sandbox_outcome = apply_workspace_sandbox_permissions(
        &state,
        config_manager.inner(),
        db.inner(),
        api_key_provider_service.inner(),
        heartbeat_state.inner(),
        &app,
        &workspace_root,
        requested_strategy,
    )
    .await
    .map_err(|e| format!("注入 workspace 安全策略失败: {e}"))?;

    match sandbox_outcome {
        WorkspaceSandboxApplyOutcome::Applied { sandbox_type } => {
            tracing::info!(
                "[AsterAgent] 已启用 workspace 本地 sandbox: root={}, type={}",
                workspace_root,
                sandbox_type
            );
        }
        WorkspaceSandboxApplyOutcome::DisabledByConfig => {
            tracing::info!(
                "[AsterAgent] workspace 本地 sandbox 已关闭，继续使用普通执行模式: root={}",
                workspace_root
            );
        }
        WorkspaceSandboxApplyOutcome::UnavailableFallback {
            warning_message,
            notify_user,
        } => {
            tracing::warn!(
                "[AsterAgent] workspace 本地 sandbox 不可用，已降级为普通执行: root={}, warning={}",
                workspace_root,
                warning_message
            );
            if notify_user {
                let warning_event = TauriAgentEvent::Warning {
                    code: Some(WORKSPACE_SANDBOX_FALLBACK_WARNING_CODE.to_string()),
                    message: warning_message,
                };
                if let Err(e) = app.emit(&request.event_name, &warning_event) {
                    tracing::error!("[AsterAgent] 发送 sandbox 降级提醒失败: {}", e);
                }
            }
        }
    }

    let tracker = ExecutionTracker::new(db.inner().clone());
    let cancel_token = state.create_cancel_token(session_id).await;
    let auto_continue_metadata = auto_continue_config.clone();

    // 获取 Agent Arc 并保持 guard 在整个流处理期间存活
    let agent_arc = state.get_agent_arc();
    let guard = agent_arc.read().await;
    let agent = guard.as_ref().ok_or("Agent not initialized")?;

    let include_context_trace = runtime_config.memory.enabled;

    let build_session_config = || {
        let mut session_config_builder = SessionConfigBuilder::new(session_id);
        if let Some(prompt) = system_prompt.clone() {
            session_config_builder = session_config_builder.system_prompt(prompt);
        }
        session_config_builder =
            session_config_builder.include_context_trace(include_context_trace);
        session_config_builder.build()
    };

    let final_result = tracker
        .with_run(
            RunSource::Chat,
            Some("aster_agent_chat_stream".to_string()),
            Some(session_id.to_string()),
            Some(serde_json::json!({
                "workspace_id": workspace_id.clone(),
                "project_id": request.project_id.clone(),
                "event_name": request.event_name.clone(),
                "execution_strategy": format!("{:?}", effective_strategy).to_lowercase(),
                "message_length": request.message.chars().count(),
                "web_search_enabled": request_tool_policy.effective_web_search,
                "auto_continue_enabled": auto_continue_enabled,
                "auto_continue": auto_continue_metadata,
            })),
            RunFinalizeOptions {
                success_metadata: Some(serde_json::json!({
                    "execution_strategy": format!("{:?}", effective_strategy).to_lowercase(),
                    "workspace_id": workspace_id.clone(),
                    "web_search_enabled": request_tool_policy.effective_web_search,
                    "auto_continue_enabled": auto_continue_enabled,
                })),
                error_code: Some("chat_stream_failed".to_string()),
                error_metadata: Some(serde_json::json!({
                    "execution_strategy": format!("{:?}", effective_strategy).to_lowercase(),
                    "workspace_id": workspace_id.clone(),
                    "web_search_enabled": request_tool_policy.effective_web_search,
                    "auto_continue_enabled": auto_continue_enabled,
                })),
            },
            async {
                let mut added_code_execution = false;
                if effective_strategy == AsterExecutionStrategy::CodeOrchestrated {
                    added_code_execution = ensure_code_execution_extension_enabled(agent).await?;
                }

                let primary_result = stream_reply_once(
                    agent,
                    &app,
                    &request.event_name,
                    &request.message,
                    Some(Path::new(&workspace_root)),
                    build_session_config(),
                    cancel_token.clone(),
                    &request_tool_policy,
                )
                .await;

                let run_result: Result<(), String> = match primary_result {
                    Ok(()) => Ok(()),
                    Err(primary_error)
                        if effective_strategy == AsterExecutionStrategy::CodeOrchestrated
                            && should_fallback_to_react_from_code_orchestrated(&primary_error) =>
                    {
                        tracing::warn!(
                            "[AsterAgent] 编排模式执行失败，自动降级到 ReAct: {}",
                            primary_error.message
                        );
                        if added_code_execution {
                            if let Err(e) =
                                agent.remove_extension(CODE_EXECUTION_EXTENSION_NAME).await
                            {
                                tracing::warn!(
                                    "[AsterAgent] 降级前移除 code_execution 扩展失败: {}",
                                    e
                                );
                            }
                            added_code_execution = false;
                        }
                        stream_reply_once(
                            agent,
                            &app,
                            &request.event_name,
                            &request.message,
                            Some(Path::new(&workspace_root)),
                            build_session_config(),
                            cancel_token.clone(),
                            &request_tool_policy,
                        )
                        .await
                        .map_err(|fallback_err| fallback_err.message)
                    }
                    Err(primary_error) => Err(primary_error.message),
                };

                if added_code_execution {
                    if let Err(e) = agent.remove_extension(CODE_EXECUTION_EXTENSION_NAME).await {
                        tracing::warn!(
                            "[AsterAgent] 移除 code_execution 扩展失败，后续会话可能继续保留编排模式: {}",
                            e
                        );
                    }
                }

                run_result
            },
        )
        .await;

    match final_result {
        Ok(()) => {
            let done_event = TauriAgentEvent::FinalDone { usage: None };
            if let Err(e) = app.emit(&request.event_name, &done_event) {
                tracing::error!("[AsterAgent] 发送完成事件失败: {}", e);
            }
        }
        Err(e) => {
            let error_event = TauriAgentEvent::Error { message: e.clone() };
            if let Err(emit_err) = app.emit(&request.event_name, &error_event) {
                tracing::error!("[AsterAgent] 发送错误事件失败: {}", emit_err);
            }
            state.remove_cancel_token(session_id).await;
            return Err(e);
        }
    }

    // 清理取消令牌
    state.remove_cancel_token(session_id).await;

    Ok(())
}

/// 停止当前会话
#[tauri::command]
pub async fn aster_agent_stop(
    state: State<'_, AsterAgentState>,
    session_id: String,
) -> Result<bool, String> {
    tracing::info!("[AsterAgent] 停止会话: {}", session_id);
    Ok(state.cancel_session(&session_id).await)
}

/// 创建新会话
#[tauri::command]
pub async fn aster_session_create(
    db: State<'_, DbConnection>,
    working_dir: Option<String>,
    workspace_id: String,
    name: Option<String>,
    execution_strategy: Option<AsterExecutionStrategy>,
) -> Result<String, String> {
    tracing::info!("[AsterAgent] 创建会话: name={:?}", name);

    let workspace_id = workspace_id.trim().to_string();
    if workspace_id.is_empty() {
        return Err("workspace_id 必填，请先选择项目工作区".to_string());
    }

    let manager = WorkspaceManager::new(db.inner().clone());
    let workspace = manager
        .get(&workspace_id)
        .map_err(|e| format!("读取 workspace 失败: {e}"))?
        .ok_or_else(|| format!("Workspace 不存在: {workspace_id}"))?;
    let ensured = ensure_workspace_ready_with_auto_relocate(&manager, &workspace)?;
    let workspace_root = ensured.root_path.to_string_lossy().to_string();

    if ensured.repaired {
        tracing::warn!(
            "[AsterAgent] 会话创建阶段检测到 workspace 目录异常并已修复: {}{}",
            workspace_root,
            if ensured.relocated {
                "（已迁移）"
            } else {
                ""
            }
        );
    }

    let resolved_working_dir = working_dir
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| Some(workspace_root.clone()));

    AsterAgentWrapper::create_session_sync(
        &db,
        name,
        resolved_working_dir,
        workspace_id,
        Some(
            execution_strategy
                .unwrap_or(AsterExecutionStrategy::React)
                .as_db_value()
                .to_string(),
        ),
    )
}

/// 设置会话执行策略
#[tauri::command]
pub async fn aster_session_set_execution_strategy(
    db: State<'_, DbConnection>,
    session_id: String,
    execution_strategy: AsterExecutionStrategy,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    AgentDao::update_execution_strategy(&conn, &session_id, execution_strategy.as_db_value())
        .map_err(|e| format!("更新会话执行策略失败: {e}"))?;
    Ok(())
}

/// 列出所有会话
#[tauri::command]
pub async fn aster_session_list(db: State<'_, DbConnection>) -> Result<Vec<SessionInfo>, String> {
    tracing::info!("[AsterAgent] 列出会话");
    AsterAgentWrapper::list_sessions_sync(&db)
}

/// 获取会话详情
#[tauri::command]
pub async fn aster_session_get(
    db: State<'_, DbConnection>,
    session_id: String,
) -> Result<SessionDetail, String> {
    tracing::info!("[AsterAgent] 获取会话: {}", session_id);
    AsterAgentWrapper::get_session_sync(&db, &session_id)
}

/// 重命名会话
#[tauri::command]
pub async fn aster_session_rename(
    db: State<'_, DbConnection>,
    session_id: String,
    name: String,
) -> Result<(), String> {
    tracing::info!("[AsterAgent] 重命名会话: {}", session_id);
    AsterAgentWrapper::rename_session_sync(&db, &session_id, &name)
}

/// 删除会话
#[tauri::command]
pub async fn aster_session_delete(
    db: State<'_, DbConnection>,
    session_id: String,
) -> Result<(), String> {
    tracing::info!("[AsterAgent] 删除会话: {}", session_id);
    AsterAgentWrapper::delete_session_sync(&db, &session_id)
}

/// 确认权限请求
#[derive(Debug, Deserialize)]
pub struct ConfirmRequest {
    pub request_id: String,
    pub confirmed: bool,
    #[allow(dead_code)]
    pub response: Option<String>,
}

/// 确认权限请求（用于工具调用确认等）
#[tauri::command]
pub async fn aster_agent_confirm(
    state: State<'_, AsterAgentState>,
    request: ConfirmRequest,
) -> Result<(), String> {
    tracing::info!(
        "[AsterAgent] 确认请求: id={}, confirmed={}",
        request.request_id,
        request.confirmed
    );

    let permission = if request.confirmed {
        Permission::AllowOnce
    } else {
        Permission::DenyOnce
    };

    let confirmation = PermissionConfirmation {
        principal_type: PrincipalType::Tool,
        permission,
    };

    let agent_arc = state.get_agent_arc();
    let guard = agent_arc.read().await;
    let agent = guard.as_ref().ok_or("Agent not initialized")?;
    agent
        .handle_confirmation(request.request_id.clone(), confirmation)
        .await;

    Ok(())
}

/// Elicitation 回填请求
#[derive(Debug, Deserialize)]
pub struct SubmitElicitationResponseRequest {
    pub request_id: String,
    pub user_data: serde_json::Value,
}

fn validate_elicitation_submission(session_id: &str, request_id: &str) -> Result<String, String> {
    let trimmed_session_id = session_id.trim().to_string();
    if trimmed_session_id.is_empty() {
        return Err("session_id 不能为空".to_string());
    }
    if request_id.trim().is_empty() {
        return Err("request_id 不能为空".to_string());
    }
    Ok(trimmed_session_id)
}

/// 提交 elicitation 回答（用于 ask/lsp 等需要用户输入的流程）
#[tauri::command]
pub async fn aster_agent_submit_elicitation_response(
    state: State<'_, AsterAgentState>,
    session_id: String,
    request: SubmitElicitationResponseRequest,
) -> Result<(), String> {
    let session_id = validate_elicitation_submission(&session_id, &request.request_id)?;

    tracing::info!(
        "[AsterAgent] 提交 elicitation 响应: session={}, request_id={}",
        session_id,
        request.request_id
    );

    let message =
        Message::user().with_content(MessageContent::action_required_elicitation_response(
            request.request_id.clone(),
            request.user_data,
        ));

    let session_config = SessionConfigBuilder::new(&session_id)
        .include_context_trace(true)
        .build();

    let agent_arc = state.get_agent_arc();
    let guard = agent_arc.read().await;
    let agent = guard.as_ref().ok_or("Agent not initialized")?;

    let mut stream = agent
        .reply(message, session_config, None)
        .await
        .map_err(|e| format!("提交 elicitation 响应失败: {e}"))?;

    while let Some(event_result) = stream.next().await {
        match event_result {
            Ok(AgentEvent::Message(message)) => {
                let text = message.as_concat_text();
                if text.contains("Failed to submit elicitation response")
                    || text.contains("Request not found")
                {
                    return Err(format!("提交 elicitation 响应失败: {text}"));
                }
            }
            Ok(_) => {}
            Err(e) => {
                return Err(format!("提交 elicitation 响应失败: {e}"));
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use regex::Regex;
    use std::ffi::OsString;
    use std::path::{Path, PathBuf};
    use std::sync::{Mutex, OnceLock};
    use tempfile::TempDir;

    struct DummyTool {
        name: String,
        description: String,
        schema: serde_json::Value,
    }

    impl DummyTool {
        fn new(name: &str, description: &str, schema: serde_json::Value) -> Self {
            Self {
                name: name.to_string(),
                description: description.to_string(),
                schema,
            }
        }
    }

    #[async_trait]
    impl Tool for DummyTool {
        fn name(&self) -> &str {
            &self.name
        }

        fn description(&self) -> &str {
            &self.description
        }

        fn input_schema(&self) -> serde_json::Value {
            self.schema.clone()
        }

        async fn execute(
            &self,
            _params: serde_json::Value,
            _context: &ToolContext,
        ) -> Result<ToolResult, ToolError> {
            Ok(ToolResult::success("ok"))
        }
    }

    fn durable_memory_test_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    struct DurableMemoryEnvGuard {
        previous: Option<OsString>,
    }

    impl DurableMemoryEnvGuard {
        fn set(path: &Path) -> Self {
            let previous = std::env::var_os("PROXYCAST_DURABLE_MEMORY_DIR");
            std::env::set_var("PROXYCAST_DURABLE_MEMORY_DIR", path.as_os_str());
            Self { previous }
        }
    }

    impl Drop for DurableMemoryEnvGuard {
        fn drop(&mut self) {
            if let Some(value) = &self.previous {
                std::env::set_var("PROXYCAST_DURABLE_MEMORY_DIR", value);
            } else {
                std::env::remove_var("PROXYCAST_DURABLE_MEMORY_DIR");
            }
        }
    }

    #[test]
    fn test_aster_chat_request_deserialize() {
        let json = r#"{
            "message": "Hello",
            "session_id": "test-session",
            "event_name": "agent_stream",
            "workspace_id": "workspace-test"
        }"#;

        let request: AsterChatRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.message, "Hello");
        assert_eq!(request.session_id, "test-session");
        assert_eq!(request.event_name, "agent_stream");
        assert_eq!(request.workspace_id, "workspace-test");
        assert_eq!(request.execution_strategy, None);
        assert_eq!(request.auto_continue, None);
    }

    #[test]
    fn test_aster_chat_request_deserialize_with_execution_strategy() {
        let json = r#"{
            "message": "Hello",
            "session_id": "test-session",
            "event_name": "agent_stream",
            "workspace_id": "workspace-test",
            "execution_strategy": "code_orchestrated"
        }"#;

        let request: AsterChatRequest = serde_json::from_str(json).unwrap();
        assert_eq!(
            request.execution_strategy,
            Some(AsterExecutionStrategy::CodeOrchestrated)
        );
    }

    #[test]
    fn test_aster_chat_request_deserialize_with_web_search_flag() {
        let json = r#"{
            "message": "Hello",
            "session_id": "test-session",
            "event_name": "agent_stream",
            "workspace_id": "workspace-test",
            "web_search": true
        }"#;

        let request: AsterChatRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.web_search, Some(true));
    }

    #[test]
    fn test_aster_chat_request_deserialize_with_auto_continue_payload() {
        let json = r#"{
            "message": "Hello",
            "session_id": "test-session",
            "event_name": "agent_stream",
            "workspace_id": "workspace-test",
            "auto_continue": {
                "enabled": true,
                "fast_mode_enabled": true,
                "continuation_length": 2,
                "sensitivity": 88,
                "source": "document_canvas"
            }
        }"#;

        let request: AsterChatRequest = serde_json::from_str(json).unwrap();
        assert_eq!(
            request.auto_continue,
            Some(AutoContinuePayload {
                enabled: true,
                fast_mode_enabled: true,
                continuation_length: 2,
                sensitivity: 88,
                source: Some("document_canvas".to_string()),
            })
        );
    }

    #[test]
    fn test_aster_chat_request_deserialize_with_auto_continue_camel_case_aliases() {
        let json = r#"{
            "message": "Hello",
            "session_id": "test-session",
            "event_name": "agent_stream",
            "workspace_id": "workspace-test",
            "autoContinue": {
                "enabled": true,
                "fastModeEnabled": true,
                "continuationLength": 1,
                "sensitivity": 45
            }
        }"#;

        let request: AsterChatRequest = serde_json::from_str(json).unwrap();
        assert_eq!(
            request.auto_continue,
            Some(AutoContinuePayload {
                enabled: true,
                fast_mode_enabled: true,
                continuation_length: 1,
                sensitivity: 45,
                source: None,
            })
        );
    }

    #[test]
    fn test_aster_execution_strategy_default_is_auto() {
        assert_eq!(
            AsterExecutionStrategy::default(),
            AsterExecutionStrategy::Auto
        );
    }

    #[test]
    fn test_aster_execution_strategy_from_db_value_none_is_auto() {
        assert_eq!(
            AsterExecutionStrategy::from_db_value(None),
            AsterExecutionStrategy::Auto
        );
    }

    #[test]
    fn test_aster_execution_strategy_from_db_value_unknown_is_auto() {
        assert_eq!(
            AsterExecutionStrategy::from_db_value(Some("unknown")),
            AsterExecutionStrategy::Auto
        );
    }

    #[test]
    fn test_aster_execution_strategy_auto_prefers_react_when_tool_search_explicit() {
        let strategy =
            AsterExecutionStrategy::Auto.effective_for_message("请先调用 tool_search 再继续");
        assert_eq!(strategy, AsterExecutionStrategy::React);
    }

    #[test]
    fn test_aster_execution_strategy_auto_prefers_react_for_generic_web_search() {
        let strategy =
            AsterExecutionStrategy::Auto.effective_for_message("帮我联网搜索今天的 AI 新闻");
        assert_eq!(strategy, AsterExecutionStrategy::React);
    }

    #[test]
    fn test_aster_execution_strategy_auto_defaults_react_for_code_task() {
        let strategy = AsterExecutionStrategy::Auto
            .effective_for_message("请抓取这个仓库并修复 Rust 编译错误，然后给出补丁");
        assert_eq!(strategy, AsterExecutionStrategy::React);
    }

    #[test]
    fn test_aster_execution_strategy_code_orchestrated_still_prefers_react_for_web_search() {
        let strategy = AsterExecutionStrategy::CodeOrchestrated
            .effective_for_message("请使用 WebSearch 工具检索并给出来源");
        assert_eq!(strategy, AsterExecutionStrategy::React);
    }

    #[test]
    fn test_aster_execution_strategy_code_orchestrated_forces_react_for_websearch_instruction() {
        let strategy = AsterExecutionStrategy::CodeOrchestrated
            .effective_for_message("请必须使用 WebSearch 工具检索，不要用已有知识回答");
        assert_eq!(strategy, AsterExecutionStrategy::React);
    }

    #[test]
    fn test_merge_system_prompt_with_request_tool_policy_adds_policy_when_enabled() {
        let policy = resolve_request_tool_policy(Some(true), false);
        let merged =
            merge_system_prompt_with_request_tool_policy(Some("你是助手".to_string()), &policy)
                .expect("should have merged prompt");
        assert!(merged.contains(REQUEST_TOOL_POLICY_MARKER));
        assert!(merged.contains("WebSearch"));
    }

    #[test]
    fn test_merge_system_prompt_with_request_tool_policy_keeps_original_when_disabled() {
        let base = Some("你好".to_string());
        let policy = resolve_request_tool_policy(Some(false), false);
        let merged = merge_system_prompt_with_request_tool_policy(base.clone(), &policy);
        assert_eq!(merged, base);
    }

    #[test]
    fn test_merge_system_prompt_with_request_tool_policy_no_duplicate_marker() {
        let base = Some(format!("{REQUEST_TOOL_POLICY_MARKER}\n已有策略"));
        let policy = resolve_request_tool_policy(Some(true), false);
        let merged = merge_system_prompt_with_request_tool_policy(base.clone(), &policy);
        assert_eq!(merged, base);
    }

    #[test]
    fn test_merge_system_prompt_with_auto_continue_appends_prompt() {
        let config = AutoContinuePayload {
            enabled: true,
            fast_mode_enabled: false,
            continuation_length: 1,
            sensitivity: 55,
            source: Some("theme_workbench_document_auto_continue".to_string()),
        };
        let merged =
            merge_system_prompt_with_auto_continue(Some("你是助手".to_string()), Some(&config))
                .expect("should contain merged prompt");
        assert!(merged.contains(AUTO_CONTINUE_PROMPT_MARKER));
        assert!(merged.contains("续写长度"));
        assert!(merged.contains("theme_workbench_document_auto_continue"));
    }

    #[test]
    fn test_merge_system_prompt_with_auto_continue_skip_when_disabled() {
        let config = AutoContinuePayload {
            enabled: false,
            fast_mode_enabled: false,
            continuation_length: 1,
            sensitivity: 55,
            source: None,
        };
        let base = Some("你是助手".to_string());
        let merged = merge_system_prompt_with_auto_continue(base.clone(), Some(&config));
        assert_eq!(merged, base);
    }

    #[test]
    fn test_should_fallback_to_react_from_code_orchestrated_when_no_event_emitted() {
        let error = ReplyAttemptError {
            message: "Stream error: timeout".to_string(),
            emitted_any: false,
        };
        assert!(should_fallback_to_react_from_code_orchestrated(&error));
    }

    #[test]
    fn test_should_fallback_to_react_from_code_orchestrated_when_unknown_subscript() {
        let error = ReplyAttemptError {
            message: "Agent provider execution failed: Unknown subscript 'web_scraping'"
                .to_string(),
            emitted_any: true,
        };
        assert!(should_fallback_to_react_from_code_orchestrated(&error));
    }

    #[test]
    fn test_should_not_fallback_to_react_from_code_orchestrated_for_general_error() {
        let error = ReplyAttemptError {
            message: "Agent provider execution failed: quota exceeded".to_string(),
            emitted_any: true,
        };
        assert!(!should_fallback_to_react_from_code_orchestrated(&error));
    }

    #[test]
    fn test_validate_elicitation_submission_rejects_empty_session_id() {
        let result = validate_elicitation_submission("   ", "req-1");
        assert_eq!(result, Err("session_id 不能为空".to_string()));
    }

    #[test]
    fn test_validate_elicitation_submission_rejects_empty_request_id() {
        let result = validate_elicitation_submission("session-1", "   ");
        assert_eq!(result, Err("request_id 不能为空".to_string()));
    }

    #[test]
    fn test_validate_elicitation_submission_trims_session_id() {
        let result = validate_elicitation_submission("  session-1  ", "req-1");
        assert_eq!(result, Ok("session-1".to_string()));
    }

    #[test]
    fn test_normalize_workspace_tool_permission_behavior_auto_mode_allows_warning() {
        let permission = PermissionCheckResult::ask("需要确认");
        let normalized = normalize_workspace_tool_permission_behavior(permission, true);
        assert_eq!(normalized.behavior, PermissionBehavior::Allow);
        assert!(normalized.message.is_none());
    }

    #[test]
    fn test_normalize_workspace_tool_permission_behavior_non_auto_denies_warning() {
        let permission = PermissionCheckResult::ask("需要确认");
        let normalized = normalize_workspace_tool_permission_behavior(permission, false);
        assert_eq!(normalized.behavior, PermissionBehavior::Deny);
        assert!(normalized
            .message
            .as_deref()
            .unwrap_or_default()
            .contains("当前模式不支持交互确认"));
    }

    #[test]
    fn test_build_workspace_shell_allow_pattern_strict_mode_rejects_python_command() {
        let escaped_root = regex::escape("/tmp/workspace");
        let pattern = build_workspace_shell_allow_pattern(&escaped_root, false);
        let regex = Regex::new(&pattern).unwrap();

        assert!(regex.is_match("rg -n \"foo\" ."));
        assert!(!regex.is_match("python -m pip install playwright"));
    }

    #[test]
    fn test_build_workspace_shell_allow_pattern_auto_mode_allows_common_commands() {
        let escaped_root = regex::escape("/tmp/workspace");
        let pattern = build_workspace_shell_allow_pattern(&escaped_root, true);
        let regex = Regex::new(&pattern).unwrap();

        assert!(regex.is_match("python -m pip install playwright"));
        assert!(regex.is_match("npm install && npm run build"));
        assert!(regex.is_match("python3 <<'EOF'\nprint('hello')\nEOF"));
    }

    #[test]
    fn test_normalize_shell_command_params_accepts_cmd_alias() {
        let input = serde_json::json!({
            "cmd": "echo hello",
            "timeout": 10
        });

        let normalized = normalize_shell_command_params(&input);
        assert_eq!(
            normalized.get("command").and_then(|value| value.as_str()),
            Some("echo hello")
        );
    }

    #[test]
    fn test_normalize_shell_command_params_keeps_existing_command() {
        let input = serde_json::json!({
            "command": "pwd",
            "cmd": "echo should_not_override"
        });

        let normalized = normalize_shell_command_params(&input);
        assert_eq!(
            normalized.get("command").and_then(|value| value.as_str()),
            Some("pwd")
        );
    }

    #[test]
    fn test_normalize_params_for_durable_memory_support_maps_read_path() {
        let _lock = durable_memory_test_lock().lock().expect("lock env");
        let tmp = TempDir::new().expect("create temp dir");
        let _env = DurableMemoryEnvGuard::set(tmp.path());

        let input = serde_json::json!({
            "path": "/memories/preferences.md"
        });
        let normalized = normalize_params_for_durable_memory_support("read", &input)
            .expect("normalize read params");
        let expected = tmp
            .path()
            .join("preferences.md")
            .to_string_lossy()
            .to_string();

        assert_eq!(
            normalized.get("path").and_then(|value| value.as_str()),
            Some(expected.as_str())
        );
    }

    #[test]
    fn test_normalize_params_for_durable_memory_support_rewrites_glob_pattern() {
        let _lock = durable_memory_test_lock().lock().expect("lock env");
        let tmp = TempDir::new().expect("create temp dir");
        let _env = DurableMemoryEnvGuard::set(tmp.path());

        let input = serde_json::json!({
            "pattern": "/memories/**/*.md"
        });
        let normalized = normalize_params_for_durable_memory_support("glob", &input)
            .expect("normalize glob params");
        let expected_root = tmp.path().to_string_lossy().to_string();

        assert_eq!(
            normalized.get("path").and_then(|value| value.as_str()),
            Some(expected_root.as_str())
        );
        assert_eq!(
            normalized.get("pattern").and_then(|value| value.as_str()),
            Some("**/*.md")
        );
    }

    #[test]
    fn test_normalize_params_for_durable_memory_support_rejects_glob_parent_segments() {
        let _lock = durable_memory_test_lock().lock().expect("lock env");
        let tmp = TempDir::new().expect("create temp dir");
        let _env = DurableMemoryEnvGuard::set(tmp.path());

        let input = serde_json::json!({
            "pattern": "/memories/../escape.md"
        });
        let error = normalize_params_for_durable_memory_support("glob", &input)
            .expect_err("should reject parent path");

        assert!(error.to_string().contains("不允许包含 `..`"));
    }

    #[test]
    fn test_encode_tool_result_for_harness_observability_appends_metadata_block() {
        let result = ToolResult::success("任务已完成")
            .with_metadata("output_file", serde_json::json!("/tmp/task.log"))
            .with_metadata("exit_code", serde_json::json!(0));

        let encoded = encode_tool_result_for_harness_observability(result);
        assert!(encoded.success);
        assert!(encoded
            .output
            .as_deref()
            .unwrap_or_default()
            .contains(PROXYCAST_TOOL_METADATA_BEGIN));
        assert!(encoded
            .output
            .as_deref()
            .unwrap_or_default()
            .contains("\"output_file\":\"/tmp/task.log\""));
    }

    #[test]
    fn test_encode_tool_result_for_harness_observability_converts_error_to_success_output() {
        let result =
            ToolResult::error("执行失败").with_metadata("failed_count", serde_json::json!(1));

        let encoded = encode_tool_result_for_harness_observability(result);
        assert!(encoded.success);
        let output = encoded.output.as_deref().unwrap_or_default();
        assert!(output.contains("执行失败"));
        assert!(output.contains(PROXYCAST_TOOL_METADATA_BEGIN));
        assert!(output.contains("\"reported_success\":false"));
    }

    #[test]
    fn test_encode_tool_result_for_harness_observability_is_idempotent() {
        let initial = ToolResult::success(format!(
            "ok\n\n{PROXYCAST_TOOL_METADATA_BEGIN}\n{{\"reported_success\":false}}\n{PROXYCAST_TOOL_METADATA_END}"
        ))
        .with_metadata("reported_success", serde_json::json!(false));

        let encoded = encode_tool_result_for_harness_observability(initial);
        let output = encoded.output.as_deref().unwrap_or_default();
        assert_eq!(output.matches(PROXYCAST_TOOL_METADATA_BEGIN).count(), 1);
        assert_eq!(output.matches(PROXYCAST_TOOL_METADATA_END).count(), 1);
    }

    #[test]
    fn test_shared_task_manager_returns_same_instance() {
        let first = shared_task_manager();
        let second = shared_task_manager();
        assert!(Arc::ptr_eq(&first, &second));
    }

    #[test]
    fn test_parse_subagent_role_supports_aliases() {
        assert_eq!(
            parse_subagent_role(Some("explore")).unwrap(),
            SubAgentRole::Explorer
        );
        assert_eq!(
            parse_subagent_role(Some("plan")).unwrap(),
            SubAgentRole::Planner
        );
        assert_eq!(
            parse_subagent_role(Some("code")).unwrap(),
            SubAgentRole::Executor
        );
        assert_eq!(parse_subagent_role(None).unwrap(), SubAgentRole::Executor);
    }

    #[test]
    fn test_build_subagent_task_definition_uses_role_defaults() {
        let input = SubAgentTaskToolInput {
            prompt: "分析当前 harness 缺口".to_string(),
            task_type: None,
            description: None,
            role: Some("explorer".to_string()),
            timeout_secs: Some(45),
            model: None,
            return_summary: None,
            allowed_tools: None,
            denied_tools: None,
            max_tokens: None,
        };

        let task = build_subagent_task_definition(&input, SubAgentRole::Explorer).unwrap();
        assert_eq!(task.task_type, "explore");
        assert_eq!(task.timeout.map(|value| value.as_secs()), Some(45));
        assert!(task.return_summary);
    }

    #[test]
    fn test_build_subagent_task_definition_applies_optional_fields() {
        let input = SubAgentTaskToolInput {
            prompt: "实现 harness 面板".to_string(),
            task_type: Some("code".to_string()),
            description: Some("实现前端面板".to_string()),
            role: Some("executor".to_string()),
            timeout_secs: Some(120),
            model: Some("claude-sonnet-4-20250514".to_string()),
            return_summary: Some(false),
            allowed_tools: Some(vec!["read_file".to_string(), "write_file".to_string()]),
            denied_tools: Some(vec!["execute_command".to_string()]),
            max_tokens: Some(4096),
        };

        let task = build_subagent_task_definition(&input, SubAgentRole::Executor).unwrap();
        assert_eq!(task.task_type, "code");
        assert_eq!(task.description.as_deref(), Some("实现前端面板"));
        assert_eq!(task.model.as_deref(), Some("claude-sonnet-4-20250514"));
        assert!(!task.return_summary);
        assert_eq!(
            task.allowed_tools,
            Some(vec!["read_file".to_string(), "write_file".to_string()])
        );
        assert_eq!(task.denied_tools, Some(vec!["execute_command".to_string()]));
        assert_eq!(task.max_tokens, Some(4096));
    }

    #[test]
    fn test_tool_search_parse_schema_metadata() {
        let schema = serde_json::json!({
            "x-proxycast": {
                "deferred_loading": true,
                "always_visible": false,
                "allowed_callers": ["assistant", "code_execution"],
                "input_examples": [{"query":"rust"}],
                "tags": ["mcp", "filesystem"]
            }
        });
        let (deferred, always_visible, allowed_callers, tags, input_examples) =
            ToolSearchBridgeTool::parse_schema_metadata("docs_search", &schema);
        assert!(deferred);
        assert!(!always_visible);
        assert_eq!(
            allowed_callers,
            vec!["assistant".to_string(), "code_execution".to_string()]
        );
        assert_eq!(tags, vec!["mcp".to_string(), "filesystem".to_string()]);
        assert_eq!(input_examples, vec![serde_json::json!({"query":"rust"})]);
    }

    #[test]
    fn test_tool_search_parse_schema_metadata_infers_builtin_input_examples() {
        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "query": {"type":"string"}
            },
            "required": ["query"]
        });
        let (_, _, _, _, input_examples) =
            ToolSearchBridgeTool::parse_schema_metadata("WebSearch", &schema);
        assert!(!input_examples.is_empty());
        assert!(input_examples[0].get("query").is_some());
    }

    #[test]
    fn test_tool_search_score_match_prefers_exact_name() {
        let exact = ToolSearchBridgeTool::score_match(
            "web_fetch",
            "fetch webpage",
            &["web".to_string()],
            "web_fetch",
        );
        let partial = ToolSearchBridgeTool::score_match(
            "fetch_web",
            "web fetch helper",
            &["web".to_string()],
            "web_fetch",
        );
        assert!(exact > partial);
    }

    #[test]
    fn test_social_generate_cover_image_parse_non_empty_string() {
        let params = serde_json::json!({
            "prompt": "  封面图描述  ",
            "size": "   "
        });

        let prompt = SocialGenerateCoverImageTool::parse_non_empty_string(&params, "prompt", None);
        let size = SocialGenerateCoverImageTool::parse_non_empty_string(
            &params,
            "size",
            Some(SOCIAL_IMAGE_DEFAULT_SIZE),
        );

        assert_eq!(prompt, Some("封面图描述".to_string()));
        assert_eq!(size, Some(SOCIAL_IMAGE_DEFAULT_SIZE.to_string()));
    }

    #[test]
    fn test_social_generate_cover_image_extract_first_image_payload() {
        let response = serde_json::json!({
            "data": [
                {
                    "url": "https://example.com/image.png",
                    "revised_prompt": "优化后的提示词"
                }
            ]
        });

        let (image_url, image_b64, revised_prompt) =
            SocialGenerateCoverImageTool::extract_first_image_payload(&response).unwrap();
        assert_eq!(image_url, Some("https://example.com/image.png".to_string()));
        assert_eq!(image_b64, None);
        assert_eq!(revised_prompt, Some("优化后的提示词".to_string()));
    }

    #[test]
    fn test_social_generate_cover_image_extract_first_image_payload_rejects_empty_data() {
        let response = serde_json::json!({ "data": [] });
        let result = SocialGenerateCoverImageTool::extract_first_image_payload(&response);

        assert!(result.is_err());
        assert!(result
            .err()
            .unwrap_or_default()
            .contains("图像接口返回 data 为空"));
    }

    #[test]
    fn test_social_generate_cover_image_normalize_server_host() {
        assert_eq!(
            SocialGenerateCoverImageTool::normalize_server_host("0.0.0.0"),
            "127.0.0.1".to_string()
        );
        assert_eq!(
            SocialGenerateCoverImageTool::normalize_server_host("::"),
            "127.0.0.1".to_string()
        );
        assert_eq!(
            SocialGenerateCoverImageTool::normalize_server_host("  localhost "),
            "localhost".to_string()
        );
    }

    #[tokio::test]
    async fn test_tool_search_bridge_tool_end_to_end_filters_by_caller_and_deferred() {
        let registry = Arc::new(tokio::sync::RwLock::new(aster::tools::ToolRegistry::new()));
        {
            let mut guard = registry.write().await;
            guard.register(Box::new(DummyTool::new(
                "docs_search",
                "Search docs",
                serde_json::json!({
                    "type": "object",
                    "x-proxycast": {
                        "deferred_loading": true,
                        "allowed_callers": ["assistant"],
                        "tags": ["docs", "search"]
                    }
                }),
            )));
            guard.register(Box::new(DummyTool::new(
                "admin_secret",
                "Admin-only tool",
                serde_json::json!({
                    "type": "object",
                    "x-proxycast": {
                        "deferred_loading": true,
                        "allowed_callers": ["code_execution"],
                        "tags": ["admin"]
                    }
                }),
            )));
            guard.register(Box::new(DummyTool::new(
                "weather",
                "Weather by city",
                serde_json::json!({
                    "type": "object",
                    "x-proxycast": {
                        "deferred_loading": false,
                        "tags": ["weather"]
                    }
                }),
            )));
        }

        let tool = ToolSearchBridgeTool::new(registry.clone());
        let context = ToolContext::new(PathBuf::from("."));

        let hidden_result = tool
            .execute(
                serde_json::json!({
                    "query": "search",
                    "caller": "assistant",
                    "include_deferred": false,
                    "include_schema": true
                }),
                &context,
            )
            .await
            .expect("tool_search should succeed");
        let hidden_output = hidden_result.output.expect("tool_search output");
        let hidden_json: serde_json::Value =
            serde_json::from_str(&hidden_output).expect("parse tool_search output");
        assert_eq!(hidden_json["count"], serde_json::json!(0));

        let visible_result = tool
            .execute(
                serde_json::json!({
                    "query": "search",
                    "caller": "assistant",
                    "include_deferred": true,
                    "include_schema": true
                }),
                &context,
            )
            .await
            .expect("tool_search should succeed");
        let visible_output = visible_result.output.expect("tool_search output");
        let visible_json: serde_json::Value =
            serde_json::from_str(&visible_output).expect("parse tool_search output");
        let tools = visible_json["tools"]
            .as_array()
            .expect("tools should be array");

        assert_eq!(visible_json["count"], serde_json::json!(1));
        assert_eq!(tools[0]["name"], serde_json::json!("docs_search"));
        assert_eq!(tools[0]["deferred_loading"], serde_json::json!(true));
        assert!(tools[0].get("input_schema").is_some());
        assert!(tools[0]
            .get("input_examples")
            .and_then(|v| v.as_array())
            .is_some());
        assert!(tools.iter().all(|tool| tool["name"] != "admin_secret"));
    }
}

/// 将 ProxyCast 已运行的 MCP servers 注入到 Aster Agent 作为 extensions
///
/// 获取 McpClientManager 中所有已运行的 server 配置，
/// 转换为 Aster 的 ExtensionConfig::Stdio 并注册到 Agent。
///
/// 关键：将当前进程的 PATH 等环境变量合并到 MCP server 的 env 中，
/// 确保 Aster 启动的子进程能找到 npx/uvx 等命令。
///
/// 返回 (成功数, 失败数)
async fn inject_mcp_extensions(
    state: &AsterAgentState,
    mcp_manager: &McpManagerState,
) -> (usize, usize) {
    let manager = mcp_manager.lock().await;
    let running_servers = manager.get_running_servers().await;

    if running_servers.is_empty() {
        tracing::debug!("[AsterAgent] 没有运行中的 MCP servers，跳过注入");
        return (0, 0);
    }

    let agent_arc = state.get_agent_arc();
    let guard = agent_arc.read().await;
    let agent = match guard.as_ref() {
        Some(a) => a,
        None => {
            tracing::warn!("[AsterAgent] Agent 未初始化，无法注入 MCP extensions");
            return (0, running_servers.len());
        }
    };

    let mut success_count = 0usize;
    let mut fail_count = 0usize;

    for server_name in &running_servers {
        // 检查是否已注册（避免重复注册）
        let ext_configs = agent.get_extension_configs().await;
        if ext_configs.iter().any(|c| c.name() == *server_name) {
            tracing::debug!("[AsterAgent] MCP extension '{}' 已注册，跳过", server_name);
            success_count += 1;
            continue;
        }

        if let Some(config) = manager.get_client_config(server_name).await {
            // 合并当前进程的关键环境变量到 MCP server 的 env 中
            // 确保子进程能找到 npx/uvx/node 等命令
            let mut merged_env = config.env.clone();
            for key in &["PATH", "HOME", "USER", "SHELL", "NODE_PATH", "NVM_DIR"] {
                if !merged_env.contains_key(*key) {
                    if let Ok(val) = std::env::var(key) {
                        merged_env.insert(key.to_string(), val);
                    }
                }
            }

            tracing::info!(
                "[AsterAgent] 注入 MCP extension '{}': cmd='{}', args={:?}, env_keys={:?}",
                server_name,
                config.command,
                config.args,
                merged_env.keys().collect::<Vec<_>>()
            );

            // 增加超时时间：npx 首次下载可能需要较长时间
            let timeout = std::cmp::max(config.timeout, 60);

            let extension = ExtensionConfig::Stdio {
                name: server_name.clone(),
                description: format!("MCP Server: {server_name}"),
                cmd: config.command.clone(),
                args: config.args.clone(),
                envs: Envs::new(merged_env),
                env_keys: vec![],
                timeout: Some(timeout),
                bundled: Some(false),
                available_tools: vec![],
                deferred_loading: false,
                always_expose_tools: Vec::new(),
                allowed_caller: None,
            };

            match agent.add_extension(extension).await {
                Ok(_) => {
                    tracing::info!("[AsterAgent] 成功注入 MCP extension: {}", server_name);
                    success_count += 1;
                }
                Err(e) => {
                    tracing::error!(
                        "[AsterAgent] 注入 MCP extension '{}' 失败: {}。\
                        cmd='{}', args={:?}。请检查命令是否在 PATH 中可用。",
                        server_name,
                        e,
                        config.command,
                        config.args
                    );
                    fail_count += 1;
                }
            }
        } else {
            tracing::warn!("[AsterAgent] 无法获取 MCP server '{}' 的配置", server_name);
            fail_count += 1;
        }
    }

    if fail_count > 0 {
        tracing::warn!(
            "[AsterAgent] MCP 注入结果: {} 成功, {} 失败",
            success_count,
            fail_count
        );
    } else {
        tracing::info!(
            "[AsterAgent] MCP 注入完成: {} 个 extension 全部成功",
            success_count
        );
    }

    (success_count, fail_count)
}

/// 确保 ProxyCast 可用的 MCP servers 已启动
///
/// 启动启用了 `enabled_proxycast` 的服务器。
async fn ensure_proxycast_mcp_servers_running(
    db: &DbConnection,
    mcp_manager: &McpManagerState,
) -> (usize, usize) {
    let servers = match McpService::get_all(db) {
        Ok(items) => items,
        Err(e) => {
            tracing::warn!("[AsterAgent] 读取 MCP 配置失败，跳过自动启动: {}", e);
            return (0, 0);
        }
    };

    if servers.is_empty() {
        return (0, 0);
    }

    let candidates: Vec<&crate::models::mcp_model::McpServer> =
        servers.iter().filter(|s| s.enabled_proxycast).collect();

    if candidates.is_empty() {
        return (0, 0);
    }

    let manager = mcp_manager.lock().await;
    let mut success_count = 0usize;
    let mut fail_count = 0usize;

    for server in candidates {
        if manager.is_server_running(&server.name).await {
            continue;
        }

        let parsed = server.parse_config();
        let config = McpServerConfig {
            command: parsed.command,
            args: parsed.args,
            env: parsed.env,
            cwd: parsed.cwd,
            timeout: parsed.timeout,
        };

        match manager.start_server(&server.name, &config).await {
            Ok(_) => {
                tracing::info!("[AsterAgent] MCP server 已自动启动: {}", server.name);
                success_count += 1;
            }
            Err(e) => {
                tracing::error!(
                    "[AsterAgent] MCP server 自动启动失败: {} => {}",
                    server.name,
                    e
                );
                fail_count += 1;
            }
        }
    }

    (success_count, fail_count)
}

/// 独立封面图生成命令：供前端直接调用，复用 social_generate_cover_image 工具的 HTTP 逻辑。
/// 返回图片 URL 字符串，失败时返回错误信息。
#[tauri::command]
pub async fn social_generate_cover_image_cmd(
    config_manager: State<'_, GlobalConfigManagerState>,
    prompt: String,
    size: Option<String>,
) -> Result<String, String> {
    if prompt.trim().is_empty() {
        return Err("prompt 不能为空".to_string());
    }
    let runtime_config = config_manager.config();
    let server_host =
        SocialGenerateCoverImageTool::normalize_server_host(&runtime_config.server.host);
    let size = size
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .or(runtime_config.image_gen.default_size.as_deref())
        .unwrap_or(SOCIAL_IMAGE_DEFAULT_SIZE)
        .to_string();
    let endpoint = format!(
        "http://{}:{}/v1/images/generations",
        server_host, runtime_config.server.port
    );
    let request_body = serde_json::json!({
        "prompt": prompt.trim(),
        "model": SOCIAL_IMAGE_DEFAULT_MODEL,
        "n": 1,
        "size": size,
        "response_format": "url"
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let response = client
        .post(&endpoint)
        .header(
            "Authorization",
            format!("Bearer {}", runtime_config.server.api_key),
        )
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("调用图像接口失败: {e}"))?;

    let status = response.status();
    let response_body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("图像接口响应解析失败: {e}"))?;

    if !status.is_success() {
        let msg = response_body
            .get("error")
            .and_then(|v| v.get("message"))
            .and_then(|v| v.as_str())
            .unwrap_or("图像生成失败");
        return Err(msg.to_string());
    }

    let (image_url, _b64, _revised) =
        SocialGenerateCoverImageTool::extract_first_image_payload(&response_body)?;

    image_url.ok_or_else(|| "接口返回中未找到 image_url".to_string())
}
