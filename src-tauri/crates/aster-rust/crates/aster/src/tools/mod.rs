// =============================================================================
// Tool System Module
// =============================================================================
//
// This module provides a unified tool system for aster-rust, aligned with
// - Tool trait and base types
// - Tool registry for managing native and MCP tools
// - Core tool implementations (Bash, File, Search, etc.)
// - Permission integration
// - Audit logging

use std::collections::HashMap;
use std::sync::{Arc, Weak};

use crate::agents::ExtensionManager;
use crate::scheduler_trait::SchedulerTrait;

// Core modules
pub mod base;
pub mod context;
pub mod error;
pub mod hooks;
pub mod registry;
pub mod task;

// Tool implementations
mod agent_control;
mod analyze_image;
pub mod ask;
pub mod bash;
pub mod command_semantics;
pub mod config_tool;
pub mod cron_tools;
pub mod file;
pub mod lsp;
pub mod mcp_resource_tools;
pub mod notebook_edit_tool;
pub mod path_guard;
mod peer_address_surface;
pub mod plan_mode_tool;
pub mod powershell_tool;
pub mod remote_trigger_tool;
pub mod search;
pub mod send_user_message_tool;
pub mod sleep_tool;
pub mod task_list_tools;
pub mod task_output_tool;
pub mod task_stop_tool;
pub mod team_tools;
pub mod tool_search_tool;
pub mod web;
mod workflow_integration;
pub mod workflow_tool;
pub mod worktree_tools;

// Skills integration

// =============================================================================
// Core Type Exports
// =============================================================================

// Error types
pub use error::ToolError;

// Context and configuration types
pub use context::{ToolContext, ToolDefinition, ToolOptions, ToolResult};

// Base trait and permission types
pub use base::{PermissionBehavior, PermissionCheckResult, Tool};

// Registry types
pub use registry::{McpToolWrapper, PermissionRequestCallback, ToolRegistry};

// Hook system types
pub use hooks::{
    ErrorTrackingHook, FileOperationHook, HookContext, HookTrigger, LoggingHook, ToolHook,
    ToolHookManager,
};

// Task management types
pub use task::{
    TaskManager, TaskState, TaskStatus, DEFAULT_MAX_CONCURRENT, DEFAULT_MAX_RUNTIME_SECS,
};

// Tool implementations
pub use bash::{
    is_bash_command_concurrency_safe, preflight_bash_read_targets, BashTool, SafetyCheckResult,
    SandboxConfig, MAX_OUTPUT_LENGTH,
};
pub use command_semantics::{
    interpret_bash_command_result, interpret_powershell_command_result, CommandInterpretation,
};
pub use config_tool::ConfigTool;
pub use cron_tools::{CronCreateTool, CronDeleteTool, CronListTool};
pub use sleep_tool::SleepTool;

// File tools
pub use file::{
    compute_content_hash, create_shared_history, EditTool, FileReadHistory, FileReadRecord,
    ReadTool, SharedFileReadHistory, WriteTool,
};

// Search tools
pub use search::{
    GlobTool, GrepOutputMode, GrepTool, SearchResult, DEFAULT_MAX_CONTEXT_LINES,
    DEFAULT_MAX_RESULTS, MAX_OUTPUT_SIZE,
};

// Ask tool
pub use agent_control::{
    register_agent_control_tools, AgentControlToolConfig, SendInputCallback, SendInputRequest,
    SendInputResponse, SpawnAgentCallback, SpawnAgentRequest, SpawnAgentResponse,
};
pub use ask::{AskCallback, AskOption, AskResult, AskTool, DEFAULT_ASK_TIMEOUT_SECS};

// LSP tool
pub use lsp::{
    CompletionItem, CompletionItemKind, Diagnostic, DiagnosticSeverity, HoverInfo, Location,
    LspCallback, LspOperation, LspResult, LspTool, Position, Range,
};
pub use mcp_resource_tools::{
    register_extension_resource_tools, ListMcpResourcesTool, ReadMcpResourceTool,
};
pub use tool_search_tool::{register_tool_search_tool, ToolSearchTool};

// Skill tool
pub use crate::skills::SkillTool;

// Task tools
pub use notebook_edit_tool::{NotebookCell, NotebookContent, NotebookEditInput, NotebookEditTool};
pub use plan_mode_tool::{EnterPlanModeTool, ExitPlanModeTool, PlanModeState, SavedPlan};
pub use powershell_tool::{
    is_powershell_command_concurrency_safe, preflight_powershell_read_targets, PowerShellTool,
};
pub use remote_trigger_tool::{RemoteTriggerTool, REMOTE_TRIGGER_GATE_ENV};
pub use send_user_message_tool::{SendUserMessageTool, SEND_USER_MESSAGE_TOOL_NAME};
pub use task_list_tools::{
    TaskCreateInput, TaskCreateTool, TaskGetInput, TaskGetTool, TaskListInput, TaskListStorage,
    TaskListTool, TaskUpdateInput, TaskUpdateStatus, TaskUpdateTool,
};
pub use task_output_tool::TaskOutputTool;
pub use task_stop_tool::TaskStopTool;
pub use team_tools::{ListPeersTool, TeamCreateTool, TeamDeleteTool};

// Web tools
pub use web::{clear_web_caches, get_web_cache_stats, WebCache, WebFetchTool, WebSearchTool};
pub use workflow_tool::WorkflowTool;
pub use worktree_tools::{EnterWorktreeTool, ExitWorktreeTool};

pub(crate) const CURRENT_SURFACE_POWERSHELL_ENV: &str = "ASTER_USE_POWERSHELL_TOOL";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CurrentSurfaceToolGates {
    pub config: bool,
    pub sleep: bool,
    pub cron: bool,
    pub remote_trigger: bool,
    pub workflow: bool,
    pub powershell: bool,
}

fn env_truthy(value: Option<&String>) -> bool {
    value.is_some_and(|raw| {
        matches!(
            raw.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        )
    })
}

fn env_defined_falsy(value: Option<&String>) -> bool {
    value.is_some_and(|raw| {
        matches!(
            raw.trim().to_ascii_lowercase().as_str(),
            "0" | "false" | "no" | "off"
        )
    })
}

pub(crate) fn current_surface_tool_gates() -> CurrentSurfaceToolGates {
    let env = std::env::vars().collect::<HashMap<_, _>>();
    current_surface_tool_gates_from_env_map(&env, cfg!(target_os = "windows"))
}

pub(crate) fn current_surface_tool_gates_from_env_map(
    env: &HashMap<String, String>,
    is_windows: bool,
) -> CurrentSurfaceToolGates {
    let is_internal_user = env
        .get("USER_TYPE")
        .is_some_and(|value| value.eq_ignore_ascii_case("ant"));
    let powershell_env = env.get(CURRENT_SURFACE_POWERSHELL_ENV);

    CurrentSurfaceToolGates {
        config: is_internal_user,
        sleep: env_truthy(env.get("PROACTIVE")) || env_truthy(env.get("KAIROS")),
        cron: env_truthy(env.get("AGENT_TRIGGERS")),
        remote_trigger: env_truthy(env.get(REMOTE_TRIGGER_GATE_ENV)),
        workflow: env_truthy(env.get("WORKFLOW_SCRIPTS")),
        powershell: is_windows
            && if is_internal_user {
                !env_defined_falsy(powershell_env)
            } else {
                env_truthy(powershell_env)
            },
    }
}

pub(crate) fn should_register_current_surface_tool(
    name: &str,
    tool_gates: CurrentSurfaceToolGates,
) -> bool {
    match name {
        "Config" => tool_gates.config,
        "Sleep" => tool_gates.sleep,
        "Cron" => tool_gates.cron,
        "RemoteTrigger" => tool_gates.remote_trigger,
        "Workflow" => tool_gates.workflow,
        "PowerShell" => tool_gates.powershell,
        _ => true,
    }
}

// =============================================================================
// Tool Registration (Requirements: 11.3)
// =============================================================================

/// Configuration for tool registration
#[derive(Default)]
pub struct ToolRegistrationConfig {
    /// Callback for AskUserQuestion user interaction
    pub ask_callback: Option<AskCallback>,
    /// Callback for LSPTool operations
    pub lsp_callback: Option<LspCallback>,
    /// Whether to enable PDF reading in ReadTool
    pub pdf_enabled: bool,
    /// Whether to enable hook system
    pub hooks_enabled: bool,
    /// Optional extension manager for current MCP resource / tool search surface
    pub extension_manager: Option<Weak<ExtensionManager>>,
    /// Optional modern delegation / agent runtime tools
    pub agent_control_tools: Option<AgentControlToolConfig>,
    /// Optional scheduler for current cron tools
    pub scheduler: Option<Arc<dyn SchedulerTrait>>,
}

impl std::fmt::Debug for ToolRegistrationConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ToolRegistrationConfig")
            .field(
                "ask_callback",
                &self.ask_callback.as_ref().map(|_| "<callback>"),
            )
            .field(
                "lsp_callback",
                &self.lsp_callback.as_ref().map(|_| "<callback>"),
            )
            .field("pdf_enabled", &self.pdf_enabled)
            .field("hooks_enabled", &self.hooks_enabled)
            .field(
                "extension_manager",
                &self.extension_manager.as_ref().map(|_| "<manager>"),
            )
            .field(
                "agent_control_tools",
                &self.agent_control_tools.as_ref().map(|_| "<callbacks>"),
            )
            .field("scheduler", &self.scheduler.as_ref().map(|_| "<scheduler>"))
            .finish()
    }
}

impl Clone for ToolRegistrationConfig {
    fn clone(&self) -> Self {
        Self {
            ask_callback: self.ask_callback.clone(),
            lsp_callback: self.lsp_callback.clone(),
            pdf_enabled: self.pdf_enabled,
            hooks_enabled: self.hooks_enabled,
            extension_manager: self.extension_manager.clone(),
            agent_control_tools: self.agent_control_tools.clone(),
            scheduler: self.scheduler.clone(),
        }
    }
}

impl ToolRegistrationConfig {
    /// Create a new configuration with default settings
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the AskUserQuestion callback
    pub fn with_ask_callback(mut self, callback: AskCallback) -> Self {
        self.ask_callback = Some(callback);
        self
    }

    /// Set the LSPTool callback
    pub fn with_lsp_callback(mut self, callback: LspCallback) -> Self {
        self.lsp_callback = Some(callback);
        self
    }

    /// Enable PDF reading
    pub fn with_pdf_enabled(mut self, enabled: bool) -> Self {
        self.pdf_enabled = enabled;
        self
    }

    /// Enable hook system
    pub fn with_hooks_enabled(mut self, enabled: bool) -> Self {
        self.hooks_enabled = enabled;
        self
    }

    /// Attach the extension manager so current MCP resource and ToolSearch surfaces
    /// are registered from the same tool entrypoint as the rest of the tool pool.
    pub fn with_extension_manager(mut self, extension_manager: Weak<ExtensionManager>) -> Self {
        self.extension_manager = Some(extension_manager);
        self
    }

    /// Register modern delegation / agent runtime tools using callbacks
    pub fn with_agent_control_tools(mut self, config: AgentControlToolConfig) -> Self {
        self.agent_control_tools = Some(config);
        self
    }

    /// Attach a scheduler so current cron tools are registered from the same
    /// tool entrypoint as the rest of the native tool pool.
    pub fn with_scheduler(mut self, scheduler: Arc<dyn SchedulerTrait>) -> Self {
        self.scheduler = Some(scheduler);
        self
    }
}

/// Register all native tools with the registry
///
/// This function registers all built-in tools:
/// - BashTool: Shell command execution
/// - ReadTool: File reading (text, images, PDF, notebooks)
/// - WriteTool: File writing with validation
/// - EditTool: Smart file editing
/// - GlobTool: File search with glob patterns
/// - GrepTool: Content search with regex
/// - AskUserQuestion: User interaction (if callback provided)
/// - LSPTool: Code intelligence (if callback provided)
/// - SkillTool: Skill execution and management
///
/// # Arguments
/// * `registry` - The ToolRegistry to register tools with
/// * `config` - Configuration for tool registration
///
/// # Returns
/// A tuple containing (shared file read history, hook manager)
///
/// Requirements: 11.3
pub fn register_all_tools(
    registry: &mut ToolRegistry,
    config: ToolRegistrationConfig,
) -> (SharedFileReadHistory, Option<ToolHookManager>) {
    let tool_gates = current_surface_tool_gates();

    // Create shared file read history for file tools
    let shared_history = create_shared_history();

    // Initialize hook manager if enabled
    let hook_manager = if config.hooks_enabled {
        let manager = ToolHookManager::new(true);
        // Register default hooks in a blocking context
        tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(async {
                manager.register_default_hooks().await;
            })
        });
        Some(manager)
    } else {
        None
    };

    let shared_task_manager = Arc::new(TaskManager::new());
    let shared_task_list_storage = Arc::new(TaskListStorage::new());

    // Register BashTool
    registry.register(Box::new(BashTool::with_task_manager(
        shared_task_manager.clone(),
    )));

    // Register file tools with shared history
    let read_tool = ReadTool::new(shared_history.clone()).with_pdf_enabled(config.pdf_enabled);
    registry.register(Box::new(read_tool));

    let write_tool = WriteTool::new(shared_history.clone());
    registry.register(Box::new(write_tool));

    let edit_tool = EditTool::new(shared_history.clone());
    registry.register(Box::new(edit_tool));

    // Register search tools
    registry.register(Box::new(GlobTool::new()));
    registry.register(Box::new(GrepTool::new()));
    if should_register_current_surface_tool("Config", tool_gates) {
        registry.register(Box::new(ConfigTool::new()));
    }
    registry.register(Box::new(SendUserMessageTool::new()));
    if should_register_current_surface_tool("Sleep", tool_gates) {
        registry.register(Box::new(SleepTool::new()));
    }
    let powershell_tool = PowerShellTool::with_task_manager(shared_task_manager.clone());
    if should_register_current_surface_tool("PowerShell", tool_gates)
        && powershell_tool.is_available()
    {
        registry.register(Box::new(powershell_tool));
    }

    // Register AskUserQuestion if callback is provided
    if let Some(callback) = config.ask_callback {
        let ask_tool = AskTool::new().with_callback(callback);
        registry.register(Box::new(ask_tool));
    }

    // Register LSPTool if callback is provided
    if let Some(callback) = config.lsp_callback {
        let lsp_tool = LspTool::new().with_callback(callback);
        registry.register(Box::new(lsp_tool));
    }

    // Register SkillTool
    registry.register(Box::new(SkillTool::new()));
    if should_register_current_surface_tool("Workflow", tool_gates) {
        registry.register(Box::new(WorkflowTool::new()));
    }

    // Register background execution and structured task board tools
    registry.register(Box::new(TaskCreateTool::with_storage(
        shared_task_list_storage.clone(),
    )));
    registry.register(Box::new(TaskListTool::with_storage(
        shared_task_list_storage.clone(),
    )));
    registry.register(Box::new(TaskGetTool::with_storage(
        shared_task_list_storage.clone(),
    )));
    registry.register(Box::new(TaskUpdateTool::with_storage(
        shared_task_list_storage,
    )));
    registry.register(Box::new(TaskOutputTool::with_manager(
        shared_task_manager.clone(),
    )));
    registry.register(Box::new(TaskStopTool::with_task_manager(
        shared_task_manager,
    )));
    registry.register(Box::new(NotebookEditTool::new()));
    if should_register_current_surface_tool("Cron", tool_gates) {
        if let Some(scheduler) = config.scheduler.as_ref() {
            registry.register(Box::new(CronCreateTool::new(scheduler.clone())));
            registry.register(Box::new(CronListTool::new(scheduler.clone())));
            registry.register(Box::new(CronDeleteTool::new(scheduler.clone())));
        }
    }
    if should_register_current_surface_tool("RemoteTrigger", tool_gates) {
        registry.register(Box::new(RemoteTriggerTool::new()));
    }
    registry.register(Box::new(EnterWorktreeTool::new()));
    registry.register(Box::new(ExitWorktreeTool::new()));

    // Register Plan Mode tools
    registry.register(Box::new(EnterPlanModeTool::new()));
    let mut exit_plan_mode_tool = ExitPlanModeTool::new();
    if let Some(send_input_callback) = config
        .agent_control_tools
        .as_ref()
        .and_then(|agent_control_tools| agent_control_tools.send_input.clone())
    {
        exit_plan_mode_tool = exit_plan_mode_tool.with_send_input_callback(send_input_callback);
    }
    registry.register(Box::new(exit_plan_mode_tool));

    if let Some(agent_control_tools) = config.agent_control_tools.as_ref() {
        register_agent_control_tools(registry, agent_control_tools);
        if agent_control_tools.spawn_agent.is_some() && agent_control_tools.send_input.is_some() {
            registry.register(Box::new(TeamCreateTool::new()));
            registry.register(Box::new(TeamDeleteTool::new()));
            registry.register(Box::new(ListPeersTool::new()));
        }
    }

    if let Some(extension_manager) = config.extension_manager {
        register_extension_resource_tools(registry, extension_manager.clone());
        register_tool_search_tool(registry, extension_manager);
    }

    // Register Web tools
    registry.register(Box::new(WebFetchTool::new()));
    registry.register(Box::new(WebSearchTool::new()));

    (shared_history, hook_manager)
}

/// Register all native tools with default configuration
///
/// This is a convenience function that registers all tools with default settings.
/// AskUserQuestion and LSPTool are not registered since they require callbacks.
///
/// # Arguments
/// * `registry` - The ToolRegistry to register tools with
///
/// # Returns
/// A tuple containing (shared file read history, hook manager)
///
/// Requirements: 11.3
pub fn register_default_tools(
    registry: &mut ToolRegistry,
) -> (SharedFileReadHistory, Option<ToolHookManager>) {
    register_all_tools(registry, ToolRegistrationConfig::default())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scheduler::{ScheduledJob, SchedulerError};
    use crate::scheduler_trait::SchedulerTrait;
    use crate::session::Session;
    use async_trait::async_trait;
    use chrono::{DateTime, Utc};
    use serial_test::serial;
    use std::path::PathBuf;

    struct TestScheduler;

    #[async_trait]
    impl SchedulerTrait for TestScheduler {
        async fn add_scheduled_job(
            &self,
            _job: ScheduledJob,
            _copy_recipe: bool,
        ) -> Result<(), SchedulerError> {
            Ok(())
        }

        async fn schedule_recipe(
            &self,
            _recipe_path: PathBuf,
            _cron_schedule: Option<String>,
        ) -> anyhow::Result<(), SchedulerError> {
            Ok(())
        }

        async fn list_scheduled_jobs(&self) -> Vec<ScheduledJob> {
            Vec::new()
        }

        async fn remove_scheduled_job(
            &self,
            _id: &str,
            _remove_recipe: bool,
        ) -> Result<(), SchedulerError> {
            Ok(())
        }

        async fn pause_schedule(&self, _id: &str) -> Result<(), SchedulerError> {
            Ok(())
        }

        async fn unpause_schedule(&self, _id: &str) -> Result<(), SchedulerError> {
            Ok(())
        }

        async fn run_now(&self, _id: &str) -> Result<String, SchedulerError> {
            Ok("scheduled-run".to_string())
        }

        async fn sessions(
            &self,
            _sched_id: &str,
            _limit: usize,
        ) -> Result<Vec<(String, Session)>, SchedulerError> {
            Ok(Vec::new())
        }

        async fn update_schedule(
            &self,
            _sched_id: &str,
            _new_cron: String,
        ) -> Result<(), SchedulerError> {
            Ok(())
        }

        async fn kill_running_job(&self, _sched_id: &str) -> Result<(), SchedulerError> {
            Ok(())
        }

        async fn get_running_job_info(
            &self,
            _sched_id: &str,
        ) -> Result<Option<(String, DateTime<Utc>)>, SchedulerError> {
            Ok(None)
        }
    }

    #[test]
    #[serial]
    fn test_register_default_tools() {
        temp_env::with_var(REMOTE_TRIGGER_GATE_ENV, None::<&str>, || {
            let mut registry = ToolRegistry::new();
            let (_history, _hook_manager) = register_default_tools(&mut registry);
            let tool_gates = current_surface_tool_gates();

            // Verify core tools are registered
            assert!(registry.contains("Bash"));
            assert!(registry.contains("BashTool"));
            assert!(registry.contains("Read"));
            assert!(registry.contains("FileReadTool"));
            assert!(registry.contains("Write"));
            assert!(registry.contains("FileWriteTool"));
            assert!(registry.contains("Edit"));
            assert!(registry.contains("FileEditTool"));
            assert!(registry.contains("Glob"));
            assert!(registry.contains("GlobTool"));
            assert!(registry.contains("Grep"));
            assert!(registry.contains("GrepTool"));
            assert_eq!(
                registry.contains("Config"),
                should_register_current_surface_tool("Config", tool_gates)
            );
            assert_eq!(
                registry.contains("ConfigTool"),
                should_register_current_surface_tool("Config", tool_gates)
            );
            assert!(registry.contains("SendUserMessage"));
            assert!(registry.contains("BriefTool"));
            assert_eq!(
                registry.contains("Sleep"),
                should_register_current_surface_tool("Sleep", tool_gates)
            );
            assert_eq!(
                registry.contains("SleepTool"),
                should_register_current_surface_tool("Sleep", tool_gates)
            );
            assert_eq!(
                registry.contains("PowerShell"),
                should_register_current_surface_tool("PowerShell", tool_gates)
                    && PowerShellTool::is_runtime_available()
            );
            assert_eq!(
                registry.contains("PowerShellTool"),
                should_register_current_surface_tool("PowerShell", tool_gates)
                    && PowerShellTool::is_runtime_available()
            );
            assert!(registry.contains("Skill"));
            assert!(registry.contains("SkillTool"));
            assert_eq!(
                registry.contains("Workflow"),
                should_register_current_surface_tool("Workflow", tool_gates)
            );
            assert!(registry.contains("TaskCreate"));
            assert!(registry.contains("TaskList"));
            assert!(registry.contains("TaskGet"));
            assert!(registry.contains("TaskUpdate"));
            assert!(registry.contains("TaskOutput"));
            assert!(registry.contains("TaskStop"));
            assert!(registry.contains("TaskCreateTool"));
            assert!(registry.contains("TaskListTool"));
            assert!(registry.contains("TaskGetTool"));
            assert!(registry.contains("TaskUpdateTool"));
            assert!(registry.contains("TaskOutputTool"));
            assert!(registry.contains("AgentOutputTool"));
            assert!(registry.contains("BashOutputTool"));
            assert!(registry.contains("TaskStopTool"));
            assert!(registry.contains("KillShell"));
            assert!(registry.contains("NotebookEdit"));
            assert!(registry.contains("NotebookEditTool"));
            assert!(!registry.contains("CronCreate"));
            assert!(!registry.contains("CronList"));
            assert!(!registry.contains("CronDelete"));
            assert!(!registry.contains("RemoteTrigger"));
            assert!(registry.contains("EnterWorktree"));
            assert!(registry.contains("EnterWorktreeTool"));
            assert!(registry.contains("ExitWorktree"));
            assert!(registry.contains("ExitWorktreeTool"));
            assert!(registry.contains("EnterPlanMode"));
            assert!(registry.contains("EnterPlanModeTool"));
            assert!(registry.contains("ExitPlanMode"));
            assert!(registry.contains("ExitPlanModeTool"));
            assert!(registry.contains("WebFetch"));
            assert!(registry.contains("WebFetchTool"));
            assert!(registry.contains("WebSearch"));
            assert!(registry.contains("WebSearchTool"));
            assert!(!registry.contains("ToolSearch"));
            assert!(!registry.contains("spawn_agent"));
            assert!(!registry.contains("Agent"));
            assert!(!registry.contains("SendMessage"));
            assert!(!registry.contains("wait_agent"));
            assert!(!registry.contains("resume_agent"));
            assert!(!registry.contains("close_agent"));
            assert!(!registry.contains("TeamCreate"));
            assert!(!registry.contains("TeamDelete"));
            assert!(!registry.contains("ListPeers"));
            // AskUserQuestion and LSPTool should not be registered without callbacks
            assert!(!registry.contains("AskUserQuestion"));
            assert!(!registry.contains("LSP"));
        });
    }

    #[test]
    #[serial]
    fn test_register_all_tools_with_config() {
        use std::future::Future;
        use std::pin::Pin;
        use std::sync::Arc;

        temp_env::with_var(REMOTE_TRIGGER_GATE_ENV, None::<&str>, || {
            let mut registry = ToolRegistry::new();

            // Create mock callbacks
            let ask_callback: AskCallback = Arc::new(|_request| {
                Box::pin(async { Some(serde_json::json!("test response")) })
                    as Pin<Box<dyn Future<Output = Option<serde_json::Value>> + Send>>
            });
            let spawn_agent_callback: SpawnAgentCallback = Arc::new(|request| {
                Box::pin(async move {
                    Ok(SpawnAgentResponse {
                        agent_id: request.parent_session_id,
                        nickname: Some("delegate".to_string()),
                        extra: std::collections::BTreeMap::new(),
                    })
                })
            });

            let lsp_callback: LspCallback = Arc::new(|_operation, _path: PathBuf, _position| {
                Box::pin(async { Ok(LspResult::Definition { locations: vec![] }) })
                    as Pin<Box<dyn Future<Output = Result<LspResult, String>> + Send>>
            });

            let config = ToolRegistrationConfig::new()
                .with_ask_callback(ask_callback)
                .with_lsp_callback(lsp_callback)
                .with_pdf_enabled(true)
                .with_agent_control_tools(
                    AgentControlToolConfig::new().with_spawn_agent_callback(spawn_agent_callback),
                );

            let (_history, _hook_manager) = register_all_tools(&mut registry, config);
            let tool_gates = current_surface_tool_gates();

            // Verify all tools are registered
            assert!(registry.contains("Bash"));
            assert!(registry.contains("BashTool"));
            assert!(registry.contains("Read"));
            assert!(registry.contains("FileReadTool"));
            assert!(registry.contains("Write"));
            assert!(registry.contains("FileWriteTool"));
            assert!(registry.contains("Edit"));
            assert!(registry.contains("FileEditTool"));
            assert!(registry.contains("Glob"));
            assert!(registry.contains("GlobTool"));
            assert!(registry.contains("Grep"));
            assert!(registry.contains("GrepTool"));
            assert_eq!(
                registry.contains("Config"),
                should_register_current_surface_tool("Config", tool_gates)
            );
            assert_eq!(
                registry.contains("ConfigTool"),
                should_register_current_surface_tool("Config", tool_gates)
            );
            assert_eq!(
                registry.contains("Sleep"),
                should_register_current_surface_tool("Sleep", tool_gates)
            );
            assert_eq!(
                registry.contains("SleepTool"),
                should_register_current_surface_tool("Sleep", tool_gates)
            );
            assert!(registry.contains("SendUserMessage"));
            assert!(registry.contains("BriefTool"));
            assert_eq!(
                registry.contains("PowerShell"),
                should_register_current_surface_tool("PowerShell", tool_gates)
                    && PowerShellTool::is_runtime_available()
            );
            assert_eq!(
                registry.contains("PowerShellTool"),
                should_register_current_surface_tool("PowerShell", tool_gates)
                    && PowerShellTool::is_runtime_available()
            );
            assert!(registry.contains("AskUserQuestion"));
            assert!(registry.contains("AskUserQuestionTool"));
            assert!(registry.contains("LSP"));
            assert!(registry.contains("LSPTool"));
            assert!(registry.contains("Skill"));
            assert!(registry.contains("SkillTool"));
            assert_eq!(
                registry.contains("Workflow"),
                should_register_current_surface_tool("Workflow", tool_gates)
            );
            assert!(registry.contains("TaskCreate"));
            assert!(registry.contains("TaskList"));
            assert!(registry.contains("TaskGet"));
            assert!(registry.contains("TaskUpdate"));
            assert!(registry.contains("TaskOutput"));
            assert!(registry.contains("TaskStop"));
            assert!(registry.contains("NotebookEdit"));
            assert!(registry.contains("NotebookEditTool"));
            assert!(!registry.contains("CronCreate"));
            assert!(!registry.contains("CronList"));
            assert!(!registry.contains("CronDelete"));
            assert!(!registry.contains("RemoteTrigger"));
            assert!(registry.contains("EnterWorktree"));
            assert!(registry.contains("EnterWorktreeTool"));
            assert!(registry.contains("ExitWorktree"));
            assert!(registry.contains("ExitWorktreeTool"));
            assert!(registry.contains("EnterPlanMode"));
            assert!(registry.contains("EnterPlanModeTool"));
            assert!(registry.contains("ExitPlanMode"));
            assert!(registry.contains("ExitPlanModeTool"));
            assert!(registry.contains("WebFetch"));
            assert!(registry.contains("WebFetchTool"));
            assert!(registry.contains("WebSearch"));
            assert!(registry.contains("WebSearchTool"));
            assert!(!registry.contains("spawn_agent"));
            assert!(registry.contains("Agent"));
            assert!(registry.contains("AgentTool"));
            assert!(!registry.contains("SendMessage"));
            assert!(!registry.contains("TeamCreate"));
            assert!(!registry.contains("TeamDelete"));
            assert!(!registry.contains("ListPeers"));
        });
    }

    #[test]
    fn test_register_all_tools_with_scheduler_registers_current_cron_tools() {
        let mut registry = ToolRegistry::new();
        let config = ToolRegistrationConfig::new().with_scheduler(Arc::new(TestScheduler));

        let (_history, _hook_manager) = register_all_tools(&mut registry, config);

        assert!(!registry.contains("CronCreate"));
        assert!(!registry.contains("CronList"));
        assert!(!registry.contains("CronDelete"));
    }

    #[test]
    #[serial]
    fn test_register_all_tools_with_scheduler_and_gate_registers_current_cron_tools() {
        let mut registry = ToolRegistry::new();
        let config = ToolRegistrationConfig::new().with_scheduler(Arc::new(TestScheduler));

        temp_env::with_var("AGENT_TRIGGERS", Some("true"), || {
            let (_history, _hook_manager) = register_all_tools(&mut registry, config);

            assert!(registry.contains("CronCreate"));
            assert!(registry.contains("CronList"));
            assert!(registry.contains("CronDelete"));
        });
    }

    #[test]
    #[serial]
    fn test_register_all_tools_with_remote_trigger_gate_registers_remote_trigger_tool() {
        let mut registry = ToolRegistry::new();

        temp_env::with_var(REMOTE_TRIGGER_GATE_ENV, Some("true"), || {
            let (_history, _hook_manager) =
                register_all_tools(&mut registry, ToolRegistrationConfig::new());

            assert!(registry.contains("RemoteTrigger"));
        });
    }

    #[test]
    fn test_current_surface_tool_gates_include_agent_triggers_gate() {
        let default_env = HashMap::new();
        let default_gates = current_surface_tool_gates_from_env_map(&default_env, false);
        assert!(!default_gates.cron);
        assert!(!default_gates.remote_trigger);

        let enabled_env = HashMap::from([("AGENT_TRIGGERS".to_string(), "true".to_string())]);
        let enabled_gates = current_surface_tool_gates_from_env_map(&enabled_env, false);
        assert!(enabled_gates.cron);

        let remote_enabled_env =
            HashMap::from([(REMOTE_TRIGGER_GATE_ENV.to_string(), "true".to_string())]);
        let remote_enabled_gates =
            current_surface_tool_gates_from_env_map(&remote_enabled_env, false);
        assert!(remote_enabled_gates.remote_trigger);
    }

    #[test]
    fn test_should_register_current_surface_tool_hides_cron_without_gate() {
        let tool_gates = current_surface_tool_gates_from_env_map(&HashMap::new(), false);

        assert!(!should_register_current_surface_tool("Cron", tool_gates));
        assert!(!should_register_current_surface_tool(
            "RemoteTrigger",
            tool_gates
        ));
        assert!(should_register_current_surface_tool("Bash", tool_gates));
    }

    #[test]
    fn test_shared_history_is_shared() {
        let mut registry = ToolRegistry::new();
        let (history, _hook_manager) = register_default_tools(&mut registry);

        // The history should be empty initially
        assert!(history.read().unwrap().is_empty());

        // We can write to it
        {
            let mut write_guard = history.write().unwrap();
            write_guard.record_read(FileReadRecord::new(
                std::path::PathBuf::from("/tmp/test.txt"),
                "hash123".to_string(),
                100,
            ));
        }

        // And read from it
        assert!(history
            .read()
            .unwrap()
            .has_read(&std::path::PathBuf::from("/tmp/test.txt")));
    }

    #[test]
    fn test_tool_registration_config_builder() {
        let config = ToolRegistrationConfig::new().with_pdf_enabled(true);

        assert!(config.pdf_enabled);
        assert!(config.ask_callback.is_none());
        assert!(config.lsp_callback.is_none());
        assert!(config.extension_manager.is_none());
        assert!(config.agent_control_tools.is_none());
        assert!(config.scheduler.is_none());
    }

    #[test]
    fn test_register_all_tools_with_extension_manager_registers_current_extension_tools() {
        let extension_manager = Arc::new(ExtensionManager::default());
        let mut registry = ToolRegistry::new();
        let config = ToolRegistrationConfig::new()
            .with_extension_manager(Arc::downgrade(&extension_manager));

        let (_history, _hook_manager) = register_all_tools(&mut registry, config);

        assert!(registry.contains("ListMcpResourcesTool"));
        assert!(registry.contains("ReadMcpResourceTool"));
        assert!(registry.contains("ToolSearch"));
    }

    #[test]
    fn test_registers_team_tools_when_spawn_and_send_callbacks_exist() {
        use std::future::Future;
        use std::pin::Pin;
        use std::sync::Arc;

        let spawn_agent_callback: SpawnAgentCallback = Arc::new(|request| {
            Box::pin(async move {
                Ok(SpawnAgentResponse {
                    agent_id: request.parent_session_id,
                    nickname: Some("delegate".to_string()),
                    extra: std::collections::BTreeMap::new(),
                })
            })
        });
        let send_input_callback: SendInputCallback = Arc::new(|request| {
            Box::pin(async move {
                Ok(SendInputResponse {
                    submission_id: request.id,
                    extra: std::collections::BTreeMap::new(),
                })
            })
                as Pin<Box<dyn Future<Output = Result<SendInputResponse, String>> + Send>>
        });

        let mut registry = ToolRegistry::new();
        let config = ToolRegistrationConfig::new().with_agent_control_tools(
            AgentControlToolConfig::new()
                .with_spawn_agent_callback(spawn_agent_callback)
                .with_send_input_callback(send_input_callback),
        );

        let (_history, _hook_manager) = register_all_tools(&mut registry, config);

        assert!(!registry.contains("spawn_agent"));
        assert!(registry.contains("Agent"));
        assert!(registry.contains("SendMessage"));
        assert!(registry.contains("TeamCreate"));
        assert!(registry.contains("TeamDelete"));
        assert!(registry.contains("ListPeers"));
        assert!(registry.contains("SendMessageTool"));
        assert!(registry.contains("SendInput"));
        assert!(registry.contains("SendInputTool"));
        assert!(registry.contains("TeamCreateTool"));
        assert!(registry.contains("TeamDeleteTool"));
        assert!(registry.contains("ListPeersTool"));
    }
}
