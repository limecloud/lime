//! ProxyCast Agent Crate
//!
//! 包含 Agent 模块中不依赖主 crate 内部模块的纯逻辑部分。
//! 深耦合部分（aster_state、aster_agent 流式桥接）留在主 crate。

pub mod ask_bridge;
pub mod aster_state;
pub mod aster_state_support;
pub mod credential_bridge;
pub mod durable_memory_fs;
pub mod event_converter;
pub mod hooks;
pub mod lsp_bridge;
pub mod mcp_bridge;
pub mod prompt;
pub mod request_tool_policy;
pub mod session_store;
pub mod shell_security;
pub mod subagent_scheduler;
pub mod tool_io_offload;
pub mod tool_permissions;
pub mod tools;

pub use ask_bridge::{create_ask_callback, extract_response as extract_ask_response};
pub use aster_state::{AsterAgentState, ProviderConfig};
pub use aster_state_support::{
    build_project_system_prompt, create_proxycast_identity, create_proxycast_tool_config,
    create_session_config_with_project, message_helpers, reload_proxycast_skills,
    SessionConfigBuilder,
};
pub use credential_bridge::{
    create_aster_provider, AsterProviderConfig, CredentialBridge, CredentialBridgeError,
};
pub use durable_memory_fs::{
    durable_memory_permission_pattern, is_virtual_memory_path, resolve_durable_memory_root,
    resolve_virtual_memory_path, to_virtual_memory_path, virtual_memory_relative_path,
    DURABLE_MEMORY_ROOT_ENV, DURABLE_MEMORY_VIRTUAL_ROOT,
};
pub use event_converter::{convert_agent_event, convert_to_tauri_message, TauriAgentEvent};
pub use lsp_bridge::create_lsp_callback;
pub use prompt::SystemPromptBuilder;
pub use request_tool_policy::{
    execute_web_search_preflight_if_needed, merge_system_prompt_with_request_tool_policy,
    resolve_request_tool_policy, stream_reply_with_policy, ReplyAttemptError, RequestToolPolicy,
    StreamReplyExecution, WebSearchExecutionTracker, REQUEST_TOOL_POLICY_MARKER,
};
pub use session_store::{
    create_session_sync, get_session_sync, list_sessions_sync, SessionDetail, SessionInfo,
};
pub use shell_security::ShellSecurityChecker;
pub use subagent_scheduler::{
    ProxyCastScheduler, ProxyCastSubAgentExecutor, SchedulerEventEmitter, SubAgentProgressEvent,
    SubAgentRole,
};
pub use tool_permissions::{DynamicPermissionCheck, PermissionBehavior};
pub use tools::{BrowserAction, BrowserTool, BrowserToolError, BrowserToolResult};
