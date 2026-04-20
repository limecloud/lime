use super::{
    args_or_default, get_string_arg, parse_nested_arg, parse_optional_nested_arg,
    require_app_handle,
};
use crate::dev_bridge::DevBridgeState;
use serde::de::DeserializeOwned;
use serde_json::Value as JsonValue;
use tauri::Manager;

type DynError = Box<dyn std::error::Error>;

fn parse_request<T: DeserializeOwned>(args: Option<&JsonValue>) -> Result<T, DynError> {
    parse_nested_arg(&args_or_default(args), "request")
}

pub(super) async fn try_handle(
    state: &DevBridgeState,
    cmd: &str,
    args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, DynError> {
    if !matches!(
        cmd,
        "agent_runtime_submit_turn"
            | "agent_runtime_interrupt_turn"
            | "agent_runtime_compact_session"
            | "agent_runtime_resume_thread"
            | "agent_runtime_create_session"
            | "agent_runtime_list_sessions"
            | "agent_runtime_get_session"
            | "agent_runtime_get_thread_read"
            | "agent_runtime_list_file_checkpoints"
            | "agent_runtime_get_file_checkpoint"
            | "agent_runtime_diff_file_checkpoint"
            | "agent_runtime_get_tool_inventory"
            | "agent_runtime_replay_request"
            | "agent_runtime_update_session"
            | "agent_runtime_delete_session"
            | "agent_runtime_promote_queued_turn"
            | "agent_runtime_remove_queued_turn"
            | "agent_runtime_respond_action"
    ) {
        return Ok(None);
    }

    let app_handle = require_app_handle(state)?;
    let result = match cmd {
        "agent_runtime_submit_turn" => {
            let request = parse_request::<
                crate::commands::aster_agent_cmd::AgentRuntimeSubmitTurnRequest,
            >(args)?;
            let aster_state = app_handle.state::<crate::agent::AsterAgentState>();
            let db = app_handle.state::<crate::database::DbConnection>();
            let api_key_provider_service =
                app_handle
                    .state::<crate::commands::api_key_provider_cmd::ApiKeyProviderServiceState>();
            let logs = app_handle.state::<crate::app::LogState>();
            let config_manager = app_handle.state::<crate::config::GlobalConfigManagerState>();
            let mcp_manager = app_handle.state::<crate::mcp::McpManagerState>();
            let automation_state =
                app_handle.state::<crate::services::automation_service::AutomationServiceState>();

            crate::commands::aster_agent_cmd::agent_runtime_submit_turn(
                app_handle.clone(),
                aster_state,
                db,
                api_key_provider_service,
                logs,
                config_manager,
                mcp_manager,
                automation_state,
                request,
            )
            .await?;

            JsonValue::Null
        }
        "agent_runtime_interrupt_turn" => {
            let request = parse_request::<
                crate::commands::aster_agent_cmd::AgentRuntimeInterruptTurnRequest,
            >(args)?;
            let aster_state = app_handle.state::<crate::agent::AsterAgentState>();
            serde_json::to_value(
                crate::commands::aster_agent_cmd::agent_runtime_interrupt_turn(
                    app_handle.clone(),
                    aster_state,
                    request,
                )
                .await?,
            )?
        }
        "agent_runtime_compact_session" => {
            let request = parse_request::<
                crate::commands::aster_agent_cmd::AgentRuntimeCompactSessionRequest,
            >(args)?;
            let aster_state = app_handle.state::<crate::agent::AsterAgentState>();
            let db = app_handle.state::<crate::database::DbConnection>();
            crate::commands::aster_agent_cmd::agent_runtime_compact_session(
                app_handle.clone(),
                aster_state,
                db,
                request,
            )
            .await?;
            JsonValue::Null
        }
        "agent_runtime_resume_thread" => {
            let request = parse_request::<
                crate::commands::aster_agent_cmd::AgentRuntimeResumeThreadRequest,
            >(args)?;
            let aster_state = app_handle.state::<crate::agent::AsterAgentState>();
            let db = app_handle.state::<crate::database::DbConnection>();
            let api_key_provider_service =
                app_handle
                    .state::<crate::commands::api_key_provider_cmd::ApiKeyProviderServiceState>();
            let logs = app_handle.state::<crate::app::LogState>();
            let config_manager = app_handle.state::<crate::config::GlobalConfigManagerState>();
            let mcp_manager = app_handle.state::<crate::mcp::McpManagerState>();
            let automation_state =
                app_handle.state::<crate::services::automation_service::AutomationServiceState>();

            serde_json::to_value(
                crate::commands::aster_agent_cmd::agent_runtime_resume_thread(
                    app_handle.clone(),
                    aster_state,
                    db,
                    api_key_provider_service,
                    logs,
                    config_manager,
                    mcp_manager,
                    automation_state,
                    request,
                )
                .await?,
            )?
        }
        "agent_runtime_create_session" => {
            let args = args_or_default(args);
            let workspace_id = get_string_arg(&args, "workspaceId", "workspace_id")?;
            let name = args
                .get("name")
                .and_then(|value| value.as_str())
                .map(ToString::to_string);
            let execution_strategy = args
                .get("executionStrategy")
                .or_else(|| args.get("execution_strategy"))
                .cloned()
                .map(
                    serde_json::from_value::<
                        crate::commands::aster_agent_cmd::AsterExecutionStrategy,
                    >,
                )
                .transpose()?;
            let db = app_handle.state::<crate::database::DbConnection>();
            let aster_state = app_handle.state::<crate::agent::AsterAgentState>();
            let mcp_manager = app_handle.state::<crate::mcp::McpManagerState>();

            serde_json::to_value(
                crate::commands::aster_agent_cmd::agent_runtime_create_session(
                    aster_state,
                    db,
                    mcp_manager,
                    workspace_id,
                    name,
                    execution_strategy,
                )
                .await?,
            )?
        }
        "agent_runtime_list_sessions" => {
            let db = app_handle.state::<crate::database::DbConnection>();
            let logs = app_handle.state::<crate::app::LogState>();

            serde_json::to_value(
                crate::commands::aster_agent_cmd::agent_runtime_list_sessions(db, logs).await?,
            )?
        }
        "agent_runtime_get_session" => {
            let args = args_or_default(args);
            let session_id = get_string_arg(&args, "sessionId", "session_id")?;
            let aster_state = app_handle.state::<crate::agent::AsterAgentState>();
            let db = app_handle.state::<crate::database::DbConnection>();
            let api_key_provider_service =
                app_handle
                    .state::<crate::commands::api_key_provider_cmd::ApiKeyProviderServiceState>();
            let logs = app_handle.state::<crate::app::LogState>();
            let config_manager = app_handle.state::<crate::config::GlobalConfigManagerState>();
            let mcp_manager = app_handle.state::<crate::mcp::McpManagerState>();
            let automation_state =
                app_handle.state::<crate::services::automation_service::AutomationServiceState>();

            serde_json::to_value(
                crate::commands::aster_agent_cmd::agent_runtime_get_session(
                    app_handle.clone(),
                    aster_state,
                    db,
                    api_key_provider_service,
                    logs,
                    config_manager,
                    mcp_manager,
                    automation_state,
                    session_id,
                )
                .await?,
            )?
        }
        "agent_runtime_get_thread_read" => {
            let args = args_or_default(args);
            let session_id = get_string_arg(&args, "sessionId", "session_id")?;
            let aster_state = app_handle.state::<crate::agent::AsterAgentState>();
            let db = app_handle.state::<crate::database::DbConnection>();
            let api_key_provider_service =
                app_handle
                    .state::<crate::commands::api_key_provider_cmd::ApiKeyProviderServiceState>();
            let logs = app_handle.state::<crate::app::LogState>();
            let config_manager = app_handle.state::<crate::config::GlobalConfigManagerState>();
            let mcp_manager = app_handle.state::<crate::mcp::McpManagerState>();
            let automation_state =
                app_handle.state::<crate::services::automation_service::AutomationServiceState>();

            serde_json::to_value(
                crate::commands::aster_agent_cmd::agent_runtime_get_thread_read(
                    app_handle.clone(),
                    aster_state,
                    db,
                    api_key_provider_service,
                    logs,
                    config_manager,
                    mcp_manager,
                    automation_state,
                    session_id,
                )
                .await?,
            )?
        }
        "agent_runtime_list_file_checkpoints" => {
            let request = parse_request::<
                crate::commands::aster_agent_cmd::AgentRuntimeListFileCheckpointsRequest,
            >(args)?;
            let aster_state = app_handle.state::<crate::agent::AsterAgentState>();
            let db = app_handle.state::<crate::database::DbConnection>();
            let api_key_provider_service =
                app_handle
                    .state::<crate::commands::api_key_provider_cmd::ApiKeyProviderServiceState>();
            let logs = app_handle.state::<crate::app::LogState>();
            let config_manager = app_handle.state::<crate::config::GlobalConfigManagerState>();
            let mcp_manager = app_handle.state::<crate::mcp::McpManagerState>();
            let automation_state =
                app_handle.state::<crate::services::automation_service::AutomationServiceState>();

            serde_json::to_value(
                crate::commands::aster_agent_cmd::agent_runtime_list_file_checkpoints(
                    app_handle.clone(),
                    aster_state,
                    db,
                    api_key_provider_service,
                    logs,
                    config_manager,
                    mcp_manager,
                    automation_state,
                    request,
                )
                .await?,
            )?
        }
        "agent_runtime_get_file_checkpoint" => {
            let request = parse_request::<
                crate::commands::aster_agent_cmd::AgentRuntimeGetFileCheckpointRequest,
            >(args)?;
            let aster_state = app_handle.state::<crate::agent::AsterAgentState>();
            let db = app_handle.state::<crate::database::DbConnection>();
            let api_key_provider_service =
                app_handle
                    .state::<crate::commands::api_key_provider_cmd::ApiKeyProviderServiceState>();
            let logs = app_handle.state::<crate::app::LogState>();
            let config_manager = app_handle.state::<crate::config::GlobalConfigManagerState>();
            let mcp_manager = app_handle.state::<crate::mcp::McpManagerState>();
            let automation_state =
                app_handle.state::<crate::services::automation_service::AutomationServiceState>();

            serde_json::to_value(
                crate::commands::aster_agent_cmd::agent_runtime_get_file_checkpoint(
                    app_handle.clone(),
                    aster_state,
                    db,
                    api_key_provider_service,
                    logs,
                    config_manager,
                    mcp_manager,
                    automation_state,
                    request,
                )
                .await?,
            )?
        }
        "agent_runtime_diff_file_checkpoint" => {
            let request = parse_request::<
                crate::commands::aster_agent_cmd::AgentRuntimeDiffFileCheckpointRequest,
            >(args)?;
            let aster_state = app_handle.state::<crate::agent::AsterAgentState>();
            let db = app_handle.state::<crate::database::DbConnection>();
            let api_key_provider_service =
                app_handle
                    .state::<crate::commands::api_key_provider_cmd::ApiKeyProviderServiceState>();
            let logs = app_handle.state::<crate::app::LogState>();
            let config_manager = app_handle.state::<crate::config::GlobalConfigManagerState>();
            let mcp_manager = app_handle.state::<crate::mcp::McpManagerState>();
            let automation_state =
                app_handle.state::<crate::services::automation_service::AutomationServiceState>();

            serde_json::to_value(
                crate::commands::aster_agent_cmd::agent_runtime_diff_file_checkpoint(
                    app_handle.clone(),
                    aster_state,
                    db,
                    api_key_provider_service,
                    logs,
                    config_manager,
                    mcp_manager,
                    automation_state,
                    request,
                )
                .await?,
            )?
        }
        "agent_runtime_get_tool_inventory" => {
            let request = parse_optional_nested_arg::<
                crate::commands::aster_agent_cmd::AgentRuntimeToolInventoryRequest,
            >(&args_or_default(args), "request")?;
            let aster_state = app_handle.state::<crate::agent::AsterAgentState>();
            let config_manager = app_handle.state::<crate::config::GlobalConfigManagerState>();
            let mcp_manager = app_handle.state::<crate::mcp::McpManagerState>();

            serde_json::to_value(
                crate::commands::aster_agent_cmd::agent_runtime_get_tool_inventory(
                    aster_state,
                    config_manager,
                    mcp_manager,
                    request,
                )
                .await?,
            )?
        }
        "agent_runtime_replay_request" => {
            let request = parse_request::<
                crate::commands::aster_agent_cmd::AgentRuntimeReplayRequestRequest,
            >(args)?;
            let db = app_handle.state::<crate::database::DbConnection>();

            serde_json::to_value(
                crate::commands::aster_agent_cmd::agent_runtime_replay_request(db, request).await?,
            )?
        }
        "agent_runtime_update_session" => {
            let request = parse_request::<
                crate::commands::aster_agent_cmd::AgentRuntimeUpdateSessionRequest,
            >(args)?;
            let db = app_handle.state::<crate::database::DbConnection>();

            crate::commands::aster_agent_cmd::agent_runtime_update_session(db, request).await?;
            JsonValue::Null
        }
        "agent_runtime_delete_session" => {
            let args = args_or_default(args);
            let session_id = get_string_arg(&args, "sessionId", "session_id")?;
            let aster_state = app_handle.state::<crate::agent::AsterAgentState>();
            let db = app_handle.state::<crate::database::DbConnection>();

            crate::commands::aster_agent_cmd::action_runtime::agent_runtime_delete_session(
                app_handle.clone(),
                aster_state,
                db,
                session_id,
            )
            .await?;
            JsonValue::Null
        }
        "agent_runtime_remove_queued_turn" => {
            let request = parse_request::<
                crate::commands::aster_agent_cmd::AgentRuntimeRemoveQueuedTurnRequest,
            >(args)?;
            serde_json::to_value(
                crate::commands::aster_agent_cmd::agent_runtime_remove_queued_turn(
                    app_handle.clone(),
                    request,
                )
                .await?,
            )?
        }
        "agent_runtime_promote_queued_turn" => {
            let request = parse_request::<
                crate::commands::aster_agent_cmd::AgentRuntimePromoteQueuedTurnRequest,
            >(args)?;
            let aster_state = app_handle.state::<crate::agent::AsterAgentState>();
            let db = app_handle.state::<crate::database::DbConnection>();
            let api_key_provider_service =
                app_handle
                    .state::<crate::commands::api_key_provider_cmd::ApiKeyProviderServiceState>();
            let logs = app_handle.state::<crate::app::LogState>();
            let config_manager = app_handle.state::<crate::config::GlobalConfigManagerState>();
            let mcp_manager = app_handle.state::<crate::mcp::McpManagerState>();
            let automation_state =
                app_handle.state::<crate::services::automation_service::AutomationServiceState>();
            serde_json::to_value(
                crate::commands::aster_agent_cmd::agent_runtime_promote_queued_turn(
                    app_handle.clone(),
                    aster_state,
                    db,
                    api_key_provider_service,
                    logs,
                    config_manager,
                    mcp_manager,
                    automation_state,
                    request,
                )
                .await?,
            )?
        }
        "agent_runtime_respond_action" => {
            let request = parse_request::<
                crate::commands::aster_agent_cmd::AgentRuntimeRespondActionRequest,
            >(args)?;
            let aster_state = app_handle.state::<crate::agent::AsterAgentState>();
            let db = app_handle.state::<crate::database::DbConnection>();

            crate::commands::aster_agent_cmd::action_runtime::agent_runtime_respond_action(
                app_handle.clone(),
                aster_state,
                db,
                request,
            )
            .await?;
            JsonValue::Null
        }
        _ => unreachable!("已通过前置 matches! 过滤 agent_runtime 命令"),
    };

    Ok(Some(result))
}
