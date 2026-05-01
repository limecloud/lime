//! Lime Agent Crate
//!
//! 包含 Agent 模块中不依赖主 crate 内部模块的纯逻辑部分。
//! 深耦合部分（aster_state、aster_agent 流式桥接）留在主 crate。

#![allow(clippy::explicit_counter_loop)]
#![allow(clippy::unnecessary_map_or)]
#![allow(clippy::to_string_in_format_args)]
#![allow(clippy::match_like_matches_macro)]
#![allow(clippy::derivable_impls)]
#![allow(clippy::borrowed_box)]

pub mod agent_tools;
pub mod artifact_protocol;
pub mod ask_bridge;
pub mod aster_runtime_support;
pub mod aster_state;
pub mod aster_state_support;
pub mod credential_bridge;
pub mod durable_memory_fs;
pub mod event_converter;
pub mod filesystem_event_protocol;
pub mod hooks;
pub mod lsp_bridge;
pub mod mcp_bridge;
pub mod prompt;
pub mod protocol;
pub mod protocol_projection;
pub mod provider_continuation_state;
pub mod provider_runtime_governor;
mod provider_safety;
pub mod queued_turn;
pub mod request_tool_policy;
pub mod runtime_projection_snapshot;
pub mod runtime_queue;
mod session_execution_runtime;
mod session_query;
pub mod session_state_snapshot;
mod session_store;
mod session_update;
pub mod skill_execution;
pub mod subagent_control;
pub mod subagent_profiles;
pub mod subagent_scheduler;
pub mod team_runtime_governor;
mod text_normalization;
pub mod tool_io_offload;
pub mod tools;
pub mod turn_input_envelope;
pub mod turn_state;
mod write_artifact_events;

pub use ask_bridge::{create_ask_callback, extract_response as extract_ask_response};
pub use aster_runtime_support::{initialize_aster_runtime, restore_aster_runtime_queued_turns};
pub use aster_state::{AsterAgentState, ProviderConfig, QueuedTurnTask, RuntimeInterruptMarker};
pub use aster_state_support::{
    build_project_system_prompt, create_lime_identity, create_lime_tool_config, message_helpers,
    reload_lime_skills, SessionConfigBuilder,
};
pub use credential_bridge::{
    create_aster_provider, AsterProviderConfig, CredentialBridge, CredentialBridgeError,
};
pub use durable_memory_fs::{
    durable_memory_permission_pattern, is_virtual_memory_path, resolve_durable_memory_root,
    resolve_virtual_memory_path, to_virtual_memory_path, virtual_memory_relative_path,
    DURABLE_MEMORY_VIRTUAL_ROOT, LEGACY_DURABLE_MEMORY_ROOT_ENV, LIME_DURABLE_MEMORY_ROOT_ENV,
};
pub use lime_mcp as mcp;
pub use lsp_bridge::create_lsp_callback;
pub use prompt::SystemPromptBuilder;
pub use prompt::{
    build_runtime_agents_prompt, merge_system_prompt_with_runtime_agents,
    RUNTIME_AGENTS_PROMPT_MARKER,
};
pub use protocol::{
    AgentActionRequiredScope, AgentArtifactSignal, AgentEvent, AgentImageAttachment, AgentMessage,
    AgentMessageContent, AgentOp, AgentRuntimeStatus, AgentTokenUsage, AgentToolImage,
    AgentToolResult, AgentUserInputOp, AgentUserPreferences,
};
pub use protocol_projection::{project_item_runtime, project_runtime_event, project_turn_runtime};
pub use provider_continuation_state::{
    ProviderContinuationCapability, ProviderContinuationCapable, ProviderContinuationState,
};
pub use provider_runtime_governor::{
    acquire_provider_runtime_permit, preview_provider_runtime_wait_snapshot,
    release_provider_runtime_permit, resolve_provider_runtime_parallel_budget,
    snapshot_provider_runtime_lease, ProviderRuntimeGovernorSnapshot, ProviderRuntimePermit,
};
pub use queued_turn::QueuedTurnSnapshot;
pub use request_tool_policy::{
    execute_web_search_preflight_if_needed, merge_system_prompt_with_request_tool_policy,
    merge_system_prompt_with_web_search_preflight_context, message_suggests_news_expansion,
    resolve_request_tool_policy, resolve_request_tool_policy_with_mode, stream_reply_with_policy,
    ReplyAttemptError, RequestToolPolicy, RequestToolPolicyMode, StreamReplyExecution,
    WebSearchExecutionTracker, WebSearchPreflightRequest, REQUEST_TOOL_POLICY_MARKER,
};
pub use runtime_projection_snapshot::RuntimeProjectionSnapshot;
pub use runtime_queue::{
    clear_runtime_queue, list_runtime_queue_snapshots, promote_runtime_queued_turn,
    remove_runtime_queued_turn, resume_persisted_runtime_queues_on_startup,
    resume_runtime_queue_if_needed, submit_runtime_turn, RuntimeQueueEventEmitter,
    RuntimeQueueExecutor,
};
pub use session_execution_runtime::{
    apply_usage_to_cost_state, build_session_execution_runtime, detect_runtime_limit_event,
    extract_recent_content_id_from_runtime_snapshot, persist_session_recent_access_mode,
    persist_session_recent_preferences, persist_session_recent_team_selection,
    SessionExecutionRuntime, SessionExecutionRuntimeAccessMode, SessionExecutionRuntimeCostState,
    SessionExecutionRuntimeLimitEvent, SessionExecutionRuntimeLimitState,
    SessionExecutionRuntimeOemPolicy, SessionExecutionRuntimePreferences,
    SessionExecutionRuntimeRecentTeamRole, SessionExecutionRuntimeRecentTeamSelection,
    SessionExecutionRuntimeRoutingDecision, SessionExecutionRuntimeSource,
    SessionExecutionRuntimeSummary, SessionExecutionRuntimeTaskProfile,
};
pub use session_query::{
    collect_subagent_cascade_session_ids, list_child_subagent_sessions,
    list_subagent_cascade_session_ids, list_subagent_status_scope_session_ids, read_session,
};
pub use session_state_snapshot::SessionStateSnapshot;
pub use session_store::{
    count_session_messages_sync, create_session_sync, delete_session,
    get_persisted_session_metadata_sync, get_runtime_session_detail,
    get_runtime_session_detail_with_history_limit, get_runtime_session_detail_with_history_page,
    get_runtime_session_detail_with_history_window, get_session_sync, list_sessions_sync,
    list_title_preview_messages_sync, rename_session_sync, update_session_archived_state_sync,
    update_session_execution_strategy_sync, update_session_provider_config_sync,
    update_session_working_dir_sync, ChildSubagentRuntimeStatus, ChildSubagentSession,
    PersistedSessionMetadata, SessionDetail, SessionInfo, SessionTitlePreviewMessage,
    SessionTodoItem, SessionTodoStatus, SubagentParentContext,
};
pub use session_update::{
    create_subagent_session, persist_compaction_session_metrics_update,
    persist_session_extension_data, replace_session_conversation, CompactionSessionMetricsUpdate,
};
pub use skill_execution::{
    execute_skill_prompt, execute_skill_workflow, SkillEventEmitter, SkillExecutionError,
    SkillExecutionResult, SkillInputImage, SkillPromptExecution, SkillWorkflowExecution,
    StepResult,
};
pub use subagent_control::{
    derive_subagent_runtime_status_kind, load_subagent_runtime_status, read_subagent_control_state,
    write_subagent_control_state, SubagentControlState, SubagentRuntimeStatus,
    SubagentRuntimeStatusInput, SubagentRuntimeStatusKind,
};
pub use subagent_profiles::{
    build_subagent_customization_prompt, builtin_profile_descriptor_by_id,
    builtin_profile_name_by_id, builtin_skill_descriptor_by_id,
    builtin_team_preset_descriptor_by_id, builtin_team_preset_label_by_id,
    summarize_builtin_profile, summarize_builtin_skill, summarize_builtin_team_preset,
    BuiltinProfileDescriptor, BuiltinSkillDescriptor, BuiltinTeamPresetDescriptor,
    SubagentCustomizationState, SubagentProfileSummary, SubagentSkillPromptBlock,
    SubagentSkillSummary, TeamPresetSummary,
};
pub use subagent_scheduler::{
    LimeScheduler, LimeSubAgentExecutor, SchedulerEventEmitter, SubAgentProgressEvent, SubAgentRole,
};
pub use team_runtime_governor::{
    acquire_team_runtime_permit, default_team_runtime_parallel_budget,
    normalize_team_runtime_provider_group, preview_team_runtime_wait_snapshot,
    release_team_runtime_permit, resolve_team_runtime_provider_parallel_budget,
    snapshot_team_runtime_session, TeamRuntimeGovernorSnapshot, TeamRuntimePermit,
};
pub use tools::{BrowserAction, BrowserTool, BrowserToolError, BrowserToolResult};
pub use turn_input_envelope::{
    TurnDiagnosticsSnapshot, TurnExecutionProfile, TurnInputEnvelope, TurnInputEnvelopeBuilder,
    TurnMessageHistorySource, TurnPromptAugmentationStage, TurnPromptAugmentationStageKind,
    TurnProviderRoutingSnapshot, TurnRequestToolPolicySnapshot, TurnSystemPromptSource,
};
pub use turn_state::TurnState;
pub use write_artifact_events::{build_write_tool_artifact_events, WriteArtifactEventEmitter};
