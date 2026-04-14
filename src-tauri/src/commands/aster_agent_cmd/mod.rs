//! Aster Agent 命令模块
//!
//! 提供基于 Aster 框架的 Tauri 命令
//! 这是新的对话系统实现，与 native_agent_cmd.rs 并行存在
//! 支持从 Lime 凭证池自动选择凭证

use crate::agent::aster_state::{ProviderConfig, SessionConfigBuilder};
use crate::agent::runtime_queue_service::{
    clear_runtime_queue as clear_runtime_queue_service,
    list_runtime_queue_snapshots as list_runtime_queue_snapshots_service,
    promote_runtime_queued_turn as promote_runtime_queued_turn_service,
    remove_runtime_queued_turn as remove_runtime_queued_turn_service,
    resume_persisted_runtime_queues_on_startup as resume_persisted_runtime_queues_on_startup_service,
    resume_runtime_queue_if_needed as resume_runtime_queue_if_needed_service,
    submit_runtime_turn as submit_runtime_turn_service, RuntimeQueueExecutor,
};
use crate::agent::{
    AsterAgentState, AsterAgentWrapper, QueuedTurnSnapshot, QueuedTurnTask, SessionDetail,
    SessionInfo,
};
use crate::agent_tools::catalog::{
    browser_runtime_tool_prefix, build_mcp_extension_surface, workbench_tool_names,
    WorkspaceToolSurface, LIME_CREATE_BROADCAST_TASK_TOOL_NAME, LIME_CREATE_COVER_TASK_TOOL_NAME,
    LIME_CREATE_IMAGE_TASK_TOOL_NAME, LIME_CREATE_RESOURCE_SEARCH_TASK_TOOL_NAME,
    LIME_CREATE_TRANSCRIPTION_TASK_TOOL_NAME, LIME_CREATE_TYPESETTING_TASK_TOOL_NAME,
    LIME_CREATE_URL_PARSE_TASK_TOOL_NAME, LIME_CREATE_VIDEO_TASK_TOOL_NAME,
    LIME_SITE_INFO_TOOL_NAME, LIME_SITE_LIST_TOOL_NAME, LIME_SITE_RECOMMEND_TOOL_NAME,
    LIME_SITE_RUN_TOOL_NAME, LIME_SITE_SEARCH_TOOL_NAME, LIST_MCP_RESOURCES_TOOL_NAME,
    READ_MCP_RESOURCE_TOOL_NAME, SOCIAL_IMAGE_TOOL_NAME, TOOL_SEARCH_TOOL_NAME,
};
#[cfg(test)]
use crate::agent_tools::execution::build_workspace_shell_allow_pattern;
use crate::agent_tools::execution::{
    build_workspace_execution_permissions, should_auto_approve_tool_warnings,
    ToolExecutionResolverInput, WorkspaceExecutionPermissionInput,
};
use crate::agent_tools::inventory::{
    build_tool_inventory, resolve_extension_tool_runtime_status, AgentToolInventoryBuildInput,
    ExtensionToolInventorySeed,
};
use crate::commands::api_key_provider_cmd::ApiKeyProviderServiceState;
use crate::commands::webview_cmd::{
    browser_execute_action_global, ensure_managed_chrome_profile_global, BrowserActionRequest,
    BrowserBackendType,
};
use crate::config::{GlobalConfigManager, GlobalConfigManagerState};
use crate::database::DbConnection;
use crate::mcp::{McpManagerState, McpServerConfig};
use crate::services::agent_timeline_service::AgentTimelineRecorder;
use crate::services::artifact_prompt_service::merge_system_prompt_with_artifact_context;
use crate::services::automation_service::AutomationServiceState;
use crate::services::execution_tracker_service::{ExecutionTracker, RunFinishDecision, RunSource};
use crate::services::memory_profile_prompt_service::{
    merge_system_prompt_with_memory_context, MemoryPromptContext,
};
use crate::services::web_search_prompt_service::merge_system_prompt_with_web_search;
use crate::services::web_search_runtime_service::apply_web_search_runtime_env;
use crate::services::workspace_health_service::ensure_workspace_ready_with_auto_relocate;
use crate::workspace::WorkspaceManager;
use crate::LogState;
use aster::agents::extension::ExtensionConfig;
use aster::agents::{Agent, AgentEvent};
use aster::chrome_mcp::get_chrome_mcp_tools;
use aster::conversation::message::{
    ActionRequired, ActionRequiredData, ActionRequiredScope, Message, MessageContent,
};
use aster::permission::{
    ConditionOperator, ConditionType, PermissionCondition, PermissionScope, ToolPermission,
    ToolPermissionManager,
};
use aster::permission::{Permission, PermissionConfirmation, PrincipalType};
use aster::sandbox::{
    detect_best_sandbox, execute_in_sandbox, ResourceLimits, SandboxConfig as ProcessSandboxConfig,
};
use aster::session::extension_data::{ExtensionData, ExtensionState};
use aster::session::{SessionType, SubagentSessionMetadata};
use aster::tools::task_output_tool::TaskOutputInput;
use aster::tools::{
    BashTool, PermissionBehavior, PermissionCheckResult, TaskManager, TaskOutputTool, TaskStopTool,
    Tool, ToolContext, ToolError, ToolOptions, ToolResult, MAX_OUTPUT_LENGTH,
};
use async_trait::async_trait;
use futures::{FutureExt, StreamExt};
use lime_agent::mcp_bridge::McpBridgeClient;
#[cfg(test)]
use lime_agent::request_tool_policy::REQUEST_TOOL_POLICY_MARKER;
use lime_agent::request_tool_policy::{
    merge_system_prompt_with_request_tool_policy, resolve_request_tool_policy_with_mode,
    stream_message_reply_with_policy, ReplyAttemptError, RequestToolPolicy, RequestToolPolicyMode,
    StreamReplyExecution,
};
use lime_agent::{
    acquire_provider_runtime_permit, acquire_team_runtime_permit,
    build_subagent_customization_prompt, builtin_profile_descriptor_by_id,
    builtin_team_preset_descriptor_by_id, builtin_team_preset_label_by_id, create_subagent_session,
    is_virtual_memory_path, list_child_subagent_sessions, list_subagent_cascade_session_ids,
    list_subagent_status_scope_session_ids, load_subagent_runtime_status,
    merge_system_prompt_with_runtime_agents, message_suggests_news_expansion,
    normalize_team_runtime_provider_group, persist_compaction_session_metrics_update,
    persist_session_extension_data, preview_provider_runtime_wait_snapshot,
    preview_team_runtime_wait_snapshot, read_session, read_subagent_control_state,
    release_provider_runtime_permit, release_team_runtime_permit, replace_session_conversation,
    resolve_provider_runtime_parallel_budget, resolve_virtual_memory_path,
    snapshot_provider_runtime_lease, snapshot_team_runtime_session, summarize_builtin_skill,
    virtual_memory_relative_path, write_subagent_control_state, AgentMessage, AgentMessageContent,
    AgentRuntimeStatus, CompactionSessionMetricsUpdate, ProviderContinuationCapability,
    ProviderContinuationCapable, ProviderContinuationState, ProviderRuntimeGovernorSnapshot,
    RuntimeProjectionSnapshot, SessionStateSnapshot, SubagentControlState,
    SubagentCustomizationState, SubagentRuntimeStatus, SubagentRuntimeStatusKind,
    SubagentSkillPromptBlock, SubagentSkillSummary, TeamRuntimeGovernorSnapshot,
    TurnExecutionProfile, TurnInputEnvelopeBuilder, TurnPromptAugmentationStageKind,
    TurnProviderRoutingSnapshot, TurnRequestToolPolicySnapshot, TurnState, TurnSystemPromptSource,
    DURABLE_MEMORY_VIRTUAL_ROOT,
};
use lime_services::api_key_provider_service::ApiKeyProviderService;
use lime_services::mcp_service::McpService;
use lime_services::video_generation_service::{
    CreateVideoGenerationRequest, VideoGenerationService,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

const DEFAULT_BASH_TIMEOUT_SECS: u64 = 300;
const MAX_BASH_TIMEOUT_SECS: u64 = 1800;
const CODE_EXECUTION_EXTENSION_NAME: &str = "code_execution";
const WORKSPACE_SANDBOX_ENABLED_ENV_KEYS: &[&str] = &[
    "LIME_WORKSPACE_SANDBOX_ENABLED",
    "PROXYCAST_WORKSPACE_SANDBOX_ENABLED",
];
const WORKSPACE_SANDBOX_STRICT_ENV_KEYS: &[&str] = &[
    "LIME_WORKSPACE_SANDBOX_STRICT",
    "PROXYCAST_WORKSPACE_SANDBOX_STRICT",
];
const WORKSPACE_SANDBOX_NOTIFY_ENV_KEYS: &[&str] = &[
    "LIME_WORKSPACE_SANDBOX_NOTIFY_ON_FALLBACK",
    "PROXYCAST_WORKSPACE_SANDBOX_NOTIFY_ON_FALLBACK",
];
const WORKSPACE_SANDBOX_FALLBACK_WARNING_CODE: &str = "workspace_sandbox_fallback";
const WORKSPACE_PATH_AUTO_CREATED_WARNING_CODE: &str = "workspace_path_auto_created";
const DEFAULT_TEAM_MAX_ACTIVE_SUBAGENTS: usize = 8;
const SOCIAL_IMAGE_DEFAULT_MODEL: &str = "gemini-3-pro-image-preview";
const SOCIAL_IMAGE_DEFAULT_SIZE: &str = "1024x1024";
const SOCIAL_IMAGE_DEFAULT_RESPONSE_FORMAT: &str = "url";
const AUTO_CONTINUE_PROMPT_MARKER: &str = "【自动续写策略】";
const ELICITATION_CONTEXT_PROMPT_MARKER: &str = "【已收集的补充信息】";
const SERVICE_SKILL_LAUNCH_PROMPT_MARKER: &str = "【站点技能启动】";
const SERVICE_SKILL_LAUNCH_PRELOAD_PROMPT_MARKER: &str = "【站点技能预执行结果】";
const TEAM_PREFERENCE_PROMPT_MARKER: &str = "【Team 协作偏好】";
const LIME_TOOL_METADATA_BEGIN: &str = "[Lime 工具元数据开始]";
const LIME_TOOL_METADATA_END: &str = "[Lime 工具元数据结束]";
const FORCE_REACT_HINT_ENV_KEYS: &[&str] =
    &["LIME_FORCE_REACT_HINTS", "PROXYCAST_FORCE_REACT_HINTS"];
const CODE_ORCHESTRATED_HINT_ENV_KEYS: &[&str] = &[
    "LIME_CODE_ORCHESTRATED_HINTS",
    "PROXYCAST_CODE_ORCHESTRATED_HINTS",
];

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
pub(crate) enum WorkspaceSandboxApplyOutcome {
    Applied {
        sandbox_type: String,
    },
    DisabledByConfig,
    UnavailableFallback {
        warning_message: String,
        notify_user: bool,
    },
}

fn parse_bool_env(names: &[&str]) -> Option<bool> {
    lime_core::env_compat::bool_var(names)
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

    if let Some(enabled) = parse_bool_env(WORKSPACE_SANDBOX_ENABLED_ENV_KEYS) {
        policy.enabled = enabled;
    }
    if let Some(strict) = parse_bool_env(WORKSPACE_SANDBOX_STRICT_ENV_KEYS) {
        policy.strict = strict;
    }
    if let Some(notify) = parse_bool_env(WORKSPACE_SANDBOX_NOTIFY_ENV_KEYS) {
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

fn normalize_required_text(value: &str, field_name: &str) -> Result<String, String> {
    let trimmed = value.trim().to_string();
    if trimmed.is_empty() {
        Err(format!("{field_name} 不能为空"))
    } else {
        Ok(trimmed)
    }
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    let trimmed = value?.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

pub(crate) mod action_runtime;
mod analysis_skill_launch;
mod broadcast_skill_launch;
mod browser_assist;
pub(crate) mod command_api;
mod cover_skill_launch;
mod deep_search_skill_launch;
mod dto;
mod form_skill_launch;
mod image_skill_launch;
mod mcp_bridge;
mod pdf_read_skill_launch;
mod presentation_skill_launch;
mod prompt_context;
mod provider_runtime_bootstrap;
mod provider_runtime_strategy;
mod reply_runtime;
mod report_skill_launch;
mod request_model_resolution;
mod research_skill_launch;
mod resource_search_skill_launch;
mod run_metadata;
mod runtime_turn;
mod service_skill_launch;
mod session_runtime;
mod site_search_skill_launch;
mod subagent_runtime;
mod summary_skill_launch;
pub(crate) mod tool_runtime;
mod transcription_skill_launch;
mod translation_skill_launch;
mod typesetting_skill_launch;
mod url_parse_skill_launch;
mod video_skill_launch;
mod webpage_skill_launch;
#[cfg(test)]
use self::subagent_runtime::{
    build_subagent_customization_state, build_subagent_customization_system_prompt,
    subagent_counts_toward_team_limit,
};
#[cfg(test)]
use self::tool_runtime::{
    encode_tool_result_for_harness_observability, normalize_params_for_durable_memory_support,
    normalize_shell_command_params, normalize_workspace_tool_permission_behavior,
};
#[cfg(test)]
include!("tests.rs");

#[cfg(test)]
pub(crate) use action_runtime::{
    build_action_resume_runtime_status, build_runtime_action_user_data,
    validate_elicitation_submission,
};
pub(crate) use analysis_skill_launch::{
    append_analysis_skill_launch_session_permissions,
    merge_system_prompt_with_analysis_skill_launch, prepare_analysis_skill_launch_request_metadata,
    prune_analysis_skill_launch_detour_tools_from_registry,
};
pub(crate) use broadcast_skill_launch::{
    append_broadcast_skill_launch_session_permissions,
    merge_system_prompt_with_broadcast_skill_launch,
    prepare_broadcast_skill_launch_request_metadata,
    prune_broadcast_skill_launch_detour_tools_from_registry,
};
pub(crate) use browser_assist::{
    append_browser_assist_session_permissions, apply_browser_requirement_to_request_tool_policy,
    default_web_search_enabled_for_chat_mode, extract_browser_task_requirement,
    get_browser_assist_runtime_hint, is_browser_assist_enabled, parse_browser_backend_hint,
    resolve_runtime_chat_mode, runtime_chat_mode_label, should_enable_model_skill_tool,
    sync_browser_assist_runtime_hint, BrowserAssistRuntimeHint, BrowserTaskRequirement,
    RuntimeChatMode, BROWSER_PROFILE_KEY_ENV_KEYS,
};
#[cfg(test)]
pub(crate) use browser_assist::{
    extract_browser_assist_runtime_hint, BROWSER_ASSIST_ALLOW_PATTERN,
};
#[allow(unused_imports)]
pub(crate) use command_api::{
    agent_runtime_close_subagent, agent_runtime_compact_session, agent_runtime_create_session,
    agent_runtime_export_analysis_handoff, agent_runtime_export_evidence_pack,
    agent_runtime_export_handoff_bundle, agent_runtime_export_replay_case,
    agent_runtime_get_session, agent_runtime_get_thread_read, agent_runtime_get_tool_inventory,
    agent_runtime_interrupt_turn, agent_runtime_list_sessions, agent_runtime_promote_queued_turn,
    agent_runtime_remove_queued_turn, agent_runtime_replay_request, agent_runtime_resume_subagent,
    agent_runtime_resume_thread, agent_runtime_save_review_decision,
    agent_runtime_send_subagent_input, agent_runtime_spawn_subagent, agent_runtime_submit_turn,
    agent_runtime_update_session, agent_runtime_wait_subagents, aster_agent_configure_from_pool,
    aster_agent_configure_provider, aster_agent_init, aster_agent_reset, aster_agent_status,
};
pub(crate) use cover_skill_launch::{
    append_cover_skill_launch_session_permissions, merge_system_prompt_with_cover_skill_launch,
    prune_cover_skill_launch_detour_tools_from_registry,
};
pub(crate) use deep_search_skill_launch::{
    append_deep_search_skill_launch_session_permissions,
    merge_system_prompt_with_deep_search_skill_launch,
    prepare_deep_search_skill_launch_request_metadata,
    prune_deep_search_skill_launch_detour_tools_from_registry,
};
#[allow(unused_imports)]
pub(crate) use dto::{
    build_incidents, build_last_outcome, build_pending_requests, AgentRuntimeActionType,
    AgentRuntimeCloseSubagentRequest, AgentRuntimeCloseSubagentResponse,
    AgentRuntimeCompactSessionRequest, AgentRuntimeDiagnosticPendingRequestSample,
    AgentRuntimeDiagnosticWarningSample, AgentRuntimeIncidentView,
    AgentRuntimeInterruptTurnRequest, AgentRuntimeOutcomeView,
    AgentRuntimePromoteQueuedTurnRequest, AgentRuntimeRemoveQueuedTurnRequest,
    AgentRuntimeReplayRequestRequest, AgentRuntimeReplayedActionRequiredView,
    AgentRuntimeRequestView, AgentRuntimeRespondActionRequest, AgentRuntimeResumeSubagentRequest,
    AgentRuntimeResumeSubagentResponse, AgentRuntimeResumeThreadRequest,
    AgentRuntimeSaveReviewDecisionRequest, AgentRuntimeSendSubagentInputRequest,
    AgentRuntimeSendSubagentInputResponse, AgentRuntimeSessionDetail,
    AgentRuntimeSpawnSubagentRequest, AgentRuntimeSpawnSubagentResponse,
    AgentRuntimeSubmitTurnRequest, AgentRuntimeThreadDiagnostics, AgentRuntimeThreadReadModel,
    AgentRuntimeToolInventoryRequest, AgentRuntimeUpdateSessionRequest,
    AgentRuntimeWaitSubagentsRequest, AgentRuntimeWaitSubagentsResponse, AsterAgentStatus,
    AsterChatRequest, AutoContinuePayload, ConfigureFromPoolRequest, ConfigureProviderRequest,
};
pub(crate) use form_skill_launch::{
    append_form_skill_launch_session_permissions, merge_system_prompt_with_form_skill_launch,
    prepare_form_skill_launch_request_metadata, prune_form_skill_launch_detour_tools_from_registry,
};
pub(crate) use image_skill_launch::{
    append_image_skill_launch_session_permissions, merge_system_prompt_with_image_skill_launch,
    prepare_image_skill_launch_request_metadata,
    prune_image_skill_launch_detour_tools_from_registry,
};
pub(crate) use mcp_bridge::{ensure_lime_mcp_servers_running, inject_mcp_extensions};
pub(crate) use pdf_read_skill_launch::{
    append_pdf_read_skill_launch_session_permissions,
    merge_system_prompt_with_pdf_read_skill_launch, prepare_pdf_read_skill_launch_request_metadata,
    prune_pdf_read_skill_launch_detour_tools_from_registry,
};
pub(crate) use presentation_skill_launch::{
    append_presentation_skill_launch_session_permissions,
    merge_system_prompt_with_presentation_skill_launch,
    prepare_presentation_skill_launch_request_metadata,
    prune_presentation_skill_launch_detour_tools_from_registry,
};
#[cfg(test)]
pub(crate) use prompt_context::build_team_preference_system_prompt;
pub(crate) use prompt_context::{
    merge_system_prompt_with_auto_continue, merge_system_prompt_with_elicitation_context,
    merge_system_prompt_with_service_skill_launch,
    merge_system_prompt_with_service_skill_launch_preload,
    merge_system_prompt_with_team_preference,
};
pub(crate) use provider_runtime_bootstrap::ensure_provider_runtime_ready;
pub(crate) use provider_runtime_strategy::{
    enrich_provider_config_with_runtime_tool_strategy, RuntimeToolCallStrategy,
};
#[cfg(test)]
use reply_runtime::message_suggests_live_search;
use reply_runtime::{
    build_runtime_user_message, build_turn_runtime_statuses, complete_runtime_status_projection,
    emit_runtime_status_with_projection, ensure_code_execution_extension_enabled,
    should_fallback_to_react_from_code_orchestrated, stream_reply_once,
};
pub(crate) use report_skill_launch::{
    append_report_skill_launch_session_permissions, merge_system_prompt_with_report_skill_launch,
    prepare_report_skill_launch_request_metadata,
    prune_report_skill_launch_detour_tools_from_registry,
};
use request_model_resolution::resolve_runtime_request_provider_config;
pub(crate) use research_skill_launch::{
    append_research_skill_launch_session_permissions,
    merge_system_prompt_with_research_skill_launch, prepare_research_skill_launch_request_metadata,
    prune_research_skill_launch_detour_tools_from_registry,
};
pub(crate) use resource_search_skill_launch::{
    append_resource_search_skill_launch_session_permissions,
    merge_system_prompt_with_resource_search_skill_launch,
    prepare_resource_search_skill_launch_request_metadata,
    prune_resource_search_skill_launch_detour_tools_from_registry,
};
use run_metadata::{
    build_chat_run_finish_metadata, build_chat_run_metadata_base, extract_harness_array,
    extract_harness_bool, extract_harness_nested_object, extract_harness_string,
    load_previous_provider_continuation_state, ChatRunObservation,
};
#[cfg(test)]
use run_metadata::{
    extract_artifact_path_from_tool_start, provider_routing_matches_current,
    resolve_social_run_artifact_descriptor,
};
pub(crate) use runtime_turn::{build_queued_turn_task, build_runtime_queue_executor};
#[cfg(test)]
pub(crate) use runtime_turn::{
    resolve_request_web_search_preference_from_sources, resolve_workspace_id_from_sources,
};
#[cfg(test)]
pub(crate) use service_skill_launch::build_service_skill_launch_run_request;
pub(crate) use service_skill_launch::{
    append_service_skill_launch_session_permissions, preload_service_skill_launch_execution,
    prepare_service_scene_launch_request_metadata, should_lock_service_skill_launch_to_site_tools,
    ServiceSkillLaunchPreloadExecution,
};
pub(crate) use session_runtime::{
    delete_runtime_session_internal, persist_session_provider_routing,
    resolve_recent_preference_from_sources, resolve_session_provider_selector,
    resolve_session_recent_harness_context, resolve_session_recent_preferences,
    resolve_session_recent_runtime_context, SessionRecentHarnessContext,
    SessionRecentRuntimeContext,
};
pub(crate) use site_search_skill_launch::{
    append_site_search_skill_launch_session_permissions,
    merge_system_prompt_with_site_search_skill_launch,
    prepare_site_search_skill_launch_request_metadata,
    prune_site_search_skill_launch_detour_tools_from_registry,
};
#[allow(unused_imports)]
pub(crate) use subagent_runtime::{
    agent_runtime_close_subagent_internal, agent_runtime_resume_subagent_internal,
    agent_runtime_send_subagent_input_internal, agent_runtime_spawn_subagent_internal,
    agent_runtime_wait_subagents_internal, emit_subagent_status_changed_events,
    maybe_emit_subagent_status_for_runtime_event, SubagentControlRuntime,
};
pub(crate) use summary_skill_launch::{
    append_summary_skill_launch_session_permissions, merge_system_prompt_with_summary_skill_launch,
    prepare_summary_skill_launch_request_metadata,
    prune_summary_skill_launch_detour_tools_from_registry,
};
#[allow(unused_imports)]
pub(crate) use tool_runtime::social_generate_cover_image_cmd;
pub(crate) use tool_runtime::{apply_workspace_sandbox_permissions, ImageInput};
pub(crate) use tool_runtime::{
    ensure_browser_mcp_tools_registered, ensure_creation_task_tools_registered,
    ensure_runtime_support_tools_registered, ensure_social_image_tool_registered,
};
#[cfg(test)]
#[allow(unused_imports)]
pub(crate) use tool_runtime::{
    extract_runtime_subagent_result_text, LimeBrowserMcpTool, SocialGenerateCoverImageTool,
    ToolSearchBridgeTool,
};
pub(crate) use transcription_skill_launch::{
    append_transcription_skill_launch_session_permissions,
    merge_system_prompt_with_transcription_skill_launch,
    prune_transcription_skill_launch_detour_tools_from_registry,
};
pub(crate) use translation_skill_launch::{
    append_translation_skill_launch_session_permissions,
    merge_system_prompt_with_translation_skill_launch,
    prepare_translation_skill_launch_request_metadata,
    prune_translation_skill_launch_detour_tools_from_registry,
};
pub(crate) use typesetting_skill_launch::{
    append_typesetting_skill_launch_session_permissions,
    merge_system_prompt_with_typesetting_skill_launch,
    prepare_typesetting_skill_launch_request_metadata,
    prune_typesetting_skill_launch_detour_tools_from_registry,
};
pub(crate) use url_parse_skill_launch::{
    append_url_parse_skill_launch_session_permissions,
    merge_system_prompt_with_url_parse_skill_launch,
    prune_url_parse_skill_launch_detour_tools_from_registry,
};
pub(crate) use video_skill_launch::merge_system_prompt_with_video_skill_launch;
pub(crate) use video_skill_launch::{
    append_video_skill_launch_session_permissions,
    prune_video_skill_launch_detour_tools_from_registry,
};
pub(crate) use webpage_skill_launch::{
    append_webpage_skill_launch_session_permissions, merge_system_prompt_with_webpage_skill_launch,
    prepare_webpage_skill_launch_request_metadata,
    prune_webpage_skill_launch_detour_tools_from_registry,
};

pub(crate) struct RuntimeCommandContext {
    app_handle: AppHandle,
    state: AsterAgentState,
    db: DbConnection,
    api_key_provider_service: ApiKeyProviderServiceState,
    logs: LogState,
    config_manager: GlobalConfigManagerState,
    mcp_manager: McpManagerState,
    automation_state: AutomationServiceState,
    runtime_queue_executor: RuntimeQueueExecutor,
}

impl std::fmt::Debug for RuntimeCommandContext {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RuntimeCommandContext")
            .field("app_handle", &"<tauri-app-handle>")
            .field("state", &"<aster-agent-state>")
            .field("db", &"<db-connection>")
            .field("api_key_provider_service", &"<api-key-provider-service>")
            .field("logs", &"<log-state>")
            .field("config_manager", &"<global-config-manager>")
            .field("mcp_manager", &"<mcp-manager>")
            .field("automation_state", &"<automation-state>")
            .field("runtime_queue_executor", &"<runtime-queue-executor>")
            .finish()
    }
}

impl Clone for RuntimeCommandContext {
    fn clone(&self) -> Self {
        Self {
            app_handle: self.app_handle.clone(),
            state: self.state.clone(),
            db: self.db.clone(),
            api_key_provider_service: ApiKeyProviderServiceState(
                self.api_key_provider_service.0.clone(),
            ),
            logs: self.logs.clone(),
            config_manager: GlobalConfigManagerState(self.config_manager.0.clone()),
            mcp_manager: self.mcp_manager.clone(),
            automation_state: self.automation_state.clone(),
            runtime_queue_executor: self.runtime_queue_executor.clone(),
        }
    }
}

impl RuntimeCommandContext {
    pub(crate) fn new(
        app_handle: AppHandle,
        state: &AsterAgentState,
        db: &DbConnection,
        api_key_provider_service: &ApiKeyProviderServiceState,
        logs: &LogState,
        config_manager: &GlobalConfigManagerState,
        mcp_manager: &McpManagerState,
        automation_state: &AutomationServiceState,
    ) -> Self {
        Self {
            app_handle,
            state: state.clone(),
            db: db.clone(),
            api_key_provider_service: ApiKeyProviderServiceState(
                api_key_provider_service.0.clone(),
            ),
            logs: logs.clone(),
            config_manager: GlobalConfigManagerState(config_manager.0.clone()),
            mcp_manager: mcp_manager.clone(),
            automation_state: automation_state.clone(),
            runtime_queue_executor: build_runtime_queue_executor(),
        }
    }

    pub(crate) fn state(&self) -> &AsterAgentState {
        &self.state
    }

    pub(crate) fn db(&self) -> &DbConnection {
        &self.db
    }

    pub(crate) async fn submit_runtime_turn(
        &self,
        queued_task: QueuedTurnTask<serde_json::Value>,
        queue_if_busy: bool,
    ) -> Result<(), String> {
        submit_runtime_turn_service(
            self.app_handle.clone(),
            &self.state,
            &self.db,
            &self.api_key_provider_service,
            &self.logs,
            &self.config_manager,
            &self.mcp_manager,
            &self.automation_state,
            queued_task,
            queue_if_busy,
            self.runtime_queue_executor.clone(),
        )
        .await
    }

    pub(crate) async fn resume_runtime_queue_if_needed(
        &self,
        session_id: String,
    ) -> Result<bool, String> {
        resume_runtime_queue_if_needed_service(
            self.app_handle.clone(),
            &self.state,
            &self.db,
            &self.api_key_provider_service,
            &self.logs,
            &self.config_manager,
            &self.mcp_manager,
            &self.automation_state,
            session_id,
            self.runtime_queue_executor.clone(),
        )
        .await
    }

    pub(crate) async fn resume_persisted_runtime_queues_on_startup(&self) -> Result<usize, String> {
        resume_persisted_runtime_queues_on_startup_service(
            self.app_handle.clone(),
            &self.state,
            &self.db,
            &self.api_key_provider_service,
            &self.logs,
            &self.config_manager,
            &self.mcp_manager,
            &self.automation_state,
            self.runtime_queue_executor.clone(),
        )
        .await
    }

    pub(crate) async fn clear_runtime_queue(
        &self,
        session_id: &str,
    ) -> Result<Vec<aster::session::QueuedTurnRuntime>, String> {
        clear_runtime_queue_service(&self.app_handle, session_id).await
    }
}

pub async fn resume_persisted_runtime_queues_on_startup(
    app: AppHandle,
    state: &AsterAgentState,
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderServiceState,
    logs: &LogState,
    config_manager: &GlobalConfigManagerState,
    mcp_manager: &McpManagerState,
    automation_state: &AutomationServiceState,
) -> Result<usize, String> {
    RuntimeCommandContext::new(
        app,
        state,
        db,
        api_key_provider_service,
        logs,
        config_manager,
        mcp_manager,
        automation_state,
    )
    .resume_persisted_runtime_queues_on_startup()
    .await
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
        "toolsearch",
        "调用 toolsearch",
        "调用toolsearch",
        "use toolsearch",
        "call toolsearch",
        "tool_search",
        "websearch",
        "web search",
        "web_search",
        "webfetch",
        "web fetch",
        "web_fetch",
    ];
    resolve_intent_hints(FORCE_REACT_HINT_ENV_KEYS, &default_hints)
        .iter()
        .any(|kw| lowered.contains(kw))
}

fn should_use_code_orchestrated_for_message(message: &str) -> bool {
    let lowered = message.to_lowercase();
    // 默认不做消息关键词硬编码推断，Auto 模式优先走 ReAct。
    // 如需启用自动切换，可通过环境变量 LIME_CODE_ORCHESTRATED_HINTS 显式配置。
    resolve_intent_hints(CODE_ORCHESTRATED_HINT_ENV_KEYS, &[])
        .iter()
        .any(|kw| lowered.contains(kw))
}

fn resolve_intent_hints(env_keys: &[&str], defaults: &[&str]) -> Vec<String> {
    if let Some(raw) = lime_core::env_compat::var(env_keys) {
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
