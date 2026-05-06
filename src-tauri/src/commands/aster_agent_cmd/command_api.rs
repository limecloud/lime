use super::*;
use crate::commands::aster_agent_cmd::session_runtime::{
    create_runtime_session_internal_with_runtime, list_runtime_sessions_internal,
    rename_runtime_session_internal, update_runtime_session_execution_strategy_internal,
};
use crate::commands::aster_agent_cmd::subagent_runtime::{
    agent_runtime_close_subagent_internal, agent_runtime_resume_subagent_internal,
    agent_runtime_send_subagent_input_internal, agent_runtime_spawn_subagent_internal,
    agent_runtime_wait_subagents_internal, SubagentControlRuntime,
};
use crate::commands::aster_agent_cmd::tool_runtime::ensure_runtime_support_tools_registered;

#[path = "command_api/provider_api.rs"]
pub(crate) mod provider_api;
#[path = "command_api/runtime_api.rs"]
pub(crate) mod runtime_api;
#[path = "command_api/session_api.rs"]
pub(crate) mod session_api;
#[path = "command_api/subagent_api.rs"]
pub(crate) mod subagent_api;

fn build_runtime_command_context(
    app: AppHandle,
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    api_key_provider_service: State<'_, ApiKeyProviderServiceState>,
    logs: State<'_, LogState>,
    config_manager: State<'_, GlobalConfigManagerState>,
    mcp_manager: State<'_, McpManagerState>,
    automation_state: State<'_, AutomationServiceState>,
) -> RuntimeCommandContext {
    RuntimeCommandContext::new(
        app,
        state.inner(),
        db.inner(),
        api_key_provider_service.inner(),
        logs.inner(),
        config_manager.inner(),
        mcp_manager.inner(),
        automation_state.inner(),
    )
}

fn build_subagent_control_runtime(
    app: AppHandle,
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    api_key_provider_service: State<'_, ApiKeyProviderServiceState>,
    logs: State<'_, LogState>,
    config_manager: State<'_, GlobalConfigManagerState>,
    mcp_manager: State<'_, McpManagerState>,
    automation_state: State<'_, AutomationServiceState>,
) -> SubagentControlRuntime {
    SubagentControlRuntime::new(
        app,
        state.inner(),
        db.inner(),
        api_key_provider_service.inner(),
        logs.inner(),
        config_manager.inner(),
        mcp_manager.inner(),
        automation_state.inner(),
    )
}

pub(crate) use provider_api::{
    aster_agent_configure_provider, aster_agent_init, aster_agent_reset, aster_agent_status,
};
pub(crate) use runtime_api::{
    agent_runtime_compact_session, agent_runtime_diff_file_checkpoint,
    agent_runtime_export_analysis_handoff, agent_runtime_export_evidence_pack,
    agent_runtime_export_handoff_bundle, agent_runtime_export_replay_case,
    agent_runtime_get_file_checkpoint, agent_runtime_get_session, agent_runtime_get_thread_read,
    agent_runtime_get_tool_inventory, agent_runtime_interrupt_turn,
    agent_runtime_list_file_checkpoints, agent_runtime_list_workspace_skill_bindings,
    agent_runtime_promote_queued_turn, agent_runtime_remove_queued_turn,
    agent_runtime_replay_request, agent_runtime_resume_thread, agent_runtime_save_review_decision,
    agent_runtime_submit_turn,
};
pub(crate) use session_api::{
    agent_runtime_create_session, agent_runtime_list_sessions, agent_runtime_update_session,
};
pub(crate) use subagent_api::{
    agent_runtime_close_subagent, agent_runtime_resume_subagent, agent_runtime_send_subagent_input,
    agent_runtime_spawn_subagent, agent_runtime_wait_subagents,
};
