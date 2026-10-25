mod account;
mod agent_session;
mod app;
mod artifact;
mod automation;
mod background_terminal;
mod client_context;
mod collaboration_mode;
mod command_exec;
mod computer_use;
mod config;
mod config_warning;
mod connect;
mod diagnostics;
mod dictation_history;
mod dispatch;
pub(crate) mod environment;
pub(crate) mod environment_exec;
mod experimental_feature;
mod fs;
mod fuzzy_file_search;
mod gateway;
mod hook;
mod instructions;
mod local_environments;
mod log;
mod mcp;
mod media;
mod memory_store;
mod model;
mod notifications;
mod permission_profile;
mod plugin;
mod plugin_share;
mod primary_runtime;
mod process;
mod project;
mod project_git;
mod prompt_history;
mod request_serialization;
mod request_trace;
mod review;
mod right_surface;
mod rollout;
mod session_operations;
mod skill;
mod storage;
mod thread;
mod thread_fork;
mod thread_goal;
mod thread_queue;
mod thread_sections;
mod turn;
mod turn_environment;
pub(crate) mod v2_notifications;
mod voice;
mod wechat;
mod windows_sandbox;
mod workflow;
mod workspace;
mod worktree_cleanup;

use crate::command_exec::CommandExecServer;
use crate::fs::FsServer;
use crate::fuzzy_file_search::FuzzyFileSearchServer;
use crate::process::ProcessServer;
use crate::runtime::PromptHistoryStore;
use crate::thread_state::ThreadStateManager;
use crate::AppServerError;
use crate::RuntimeCore;
use crate::RuntimeCoreError;
use app_server_protocol::error_codes;
use app_server_protocol::AgentEvent;
use app_server_protocol::AgentSessionActionRespondParams;
use app_server_protocol::AgentSessionAnalysisHandoffExportParams;
use app_server_protocol::AgentSessionEventParams;
use app_server_protocol::AgentSessionHandoffBundleExportParams;
use app_server_protocol::AgentSessionReplayCaseExportParams;
use app_server_protocol::AgentSessionReviewDecisionSaveParams;
use app_server_protocol::AgentSessionReviewDecisionTemplateExportParams;
use app_server_protocol::ArtifactReadParams;
use app_server_protocol::CapabilityListParams;
use app_server_protocol::ChannelProbeParams;
use app_server_protocol::JsonRpcError;
use app_server_protocol::JsonRpcMessage;
use app_server_protocol::JsonRpcNotification;
use app_server_protocol::JsonRpcRequest;
use app_server_protocol::RequestId;
use client_context::ClientContext;
use config_warning::ConfigWarningProvider;
use environment::EnvironmentRegistry;
use mcp::McpEventStreamTask;
pub(crate) use notifications::{ConnectionServerNotificationHook, ServerNotificationHook};
// ProjectGit* 类型已移至 processor/project_git.rs
use app_server_protocol::ServerNotification;
use app_server_transport::ConnectionId;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::sync::Mutex;
use tracing::Instrument;

use request_serialization::{resolve_request_serialization_scope, RequestSerializationQueues};

pub(crate) type TurnInterruptHook =
    Arc<dyn Fn(String, String) -> futures::future::BoxFuture<'static, ()> + Send + Sync>;
pub(crate) use crate::command_exec::CommandExecNotificationHook;
pub(crate) use crate::fs::FsNotificationHook;
pub(crate) use crate::process::ProcessNotificationHook;
#[derive(Clone)]
pub struct RequestProcessor {
    client_context: ClientContext,
    connection_contexts: Arc<Mutex<HashMap<ConnectionId, ClientContext>>>,
    runtime: Arc<RuntimeCore>,
    thread_states: ThreadStateManager,
    skills_watcher: Option<Arc<crate::skills_watcher::SkillsWatcher>>,
    plugin_skill_watch: Arc<tokio::sync::Mutex<Option<crate::skills_watcher::WatchRegistration>>>,
    process: ProcessServer,
    command_exec: CommandExecServer,
    fs: FsServer,
    fuzzy_file_search: FuzzyFileSearchServer,
    config_warning_provider: ConfigWarningProvider,
    request_serialization_queues: RequestSerializationQueues,
    turn_interrupt_hook: Option<TurnInterruptHook>,
    server_notification_hook: Option<ServerNotificationHook>,
    connection_server_notification_hook: Option<ConnectionServerNotificationHook>,
    mcp_event_streams: Arc<Mutex<HashMap<(ConnectionId, String), McpEventStreamTask>>>,
    pub(crate) environment_registry: Arc<EnvironmentRegistry>,
    environment_execution_lowering: bool,
    selected_environment_threads: Arc<Mutex<HashMap<String, HashSet<String>>>>,
    prompt_history: Arc<PromptHistoryStore>,
    worktree_cleanup: Arc<worktree_cleanup::CleanupQueue>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ConnectionRequestId {
    pub(crate) connection_id: ConnectionId,
    pub(crate) request_id: RequestId,
}

impl ConnectionRequestId {
    fn new(connection_id: ConnectionId, request_id: RequestId) -> Self {
        Self {
            connection_id,
            request_id,
        }
    }
}

impl RequestProcessor {
    #[cfg(test)]
    pub fn new(runtime: RuntimeCore) -> Self {
        Self::new_with_thread_states(runtime, ThreadStateManager::new())
    }

    #[cfg(test)]
    pub(crate) fn new_with_thread_states(
        runtime: RuntimeCore,
        thread_states: ThreadStateManager,
    ) -> Self {
        Self::new_with_thread_states_and_environment_storage(runtime, thread_states, None)
    }

    pub(crate) fn new_with_thread_states_and_environment_storage(
        mut runtime: RuntimeCore,
        thread_states: ThreadStateManager,
        environment_storage_path: Option<std::path::PathBuf>,
    ) -> Self {
        let environment_registry = Arc::new(match environment_storage_path {
            Some(path) => EnvironmentRegistry::new_with_storage(path),
            None => EnvironmentRegistry::new(),
        });
        if let Some(execution_process) = runtime.execution_process_server() {
            execution_process.attach_environment_registry(Arc::clone(&environment_registry));
        }
        let filesystem_gateway: Arc<
            dyn tool_runtime::filesystem_gateway::RuntimeFileSystemGateway,
        > = environment_registry.clone();
        let environment_execution_lowering =
            runtime.set_filesystem_gateway(filesystem_gateway).is_ok();
        let prompt_history = runtime.prompt_history_store().unwrap_or_else(|| {
            Arc::new(PromptHistoryStore::new(
                runtime
                    .environment_registry_path()
                    .with_file_name("prompt_history.jsonl"),
            ))
        });
        let execution_process_server = runtime.execution_process_server().unwrap_or_default();
        if let Some(service) = runtime.primary_runtime_service() {
            execution_process_server
                .attach_primary_runtime(service, runtime.app_config_path().to_owned());
        }
        let command_exec =
            CommandExecServer::default().with_process_server(execution_process_server);
        runtime.command_exec = command_exec.clone();
        Self {
            client_context: ClientContext::default(),
            connection_contexts: Arc::new(Mutex::new(HashMap::new())),
            runtime: Arc::new(runtime),
            thread_states,
            skills_watcher: None,
            plugin_skill_watch: Arc::new(tokio::sync::Mutex::new(None)),
            process: ProcessServer::default(),
            command_exec,
            fs: FsServer::default(),
            fuzzy_file_search: FuzzyFileSearchServer::default(),
            config_warning_provider: config_warning::default_config_warning_provider(),
            request_serialization_queues: RequestSerializationQueues::default(),
            turn_interrupt_hook: None,
            server_notification_hook: None,
            connection_server_notification_hook: None,
            mcp_event_streams: Arc::new(Mutex::new(HashMap::new())),
            environment_registry,
            environment_execution_lowering,
            selected_environment_threads: Arc::new(Mutex::new(HashMap::new())),
            prompt_history,
            worktree_cleanup: Arc::new(worktree_cleanup::CleanupQueue::default()),
        }
    }

    pub(crate) fn with_turn_interrupt_hook(mut self, hook: TurnInterruptHook) -> Self {
        self.turn_interrupt_hook = Some(hook);
        self
    }

    pub(super) async fn abort_server_requests_for_turn(&self, thread_id: String, turn_id: String) {
        if let Some(hook) = self.turn_interrupt_hook.as_ref() {
            hook(thread_id, turn_id).await;
        }
    }

    pub fn runtime(&self) -> &RuntimeCore {
        self.runtime.as_ref()
    }

    pub fn runtime_arc(&self) -> Arc<RuntimeCore> {
        self.runtime.clone()
    }

    pub async fn handle_request(
        &self,
        request: JsonRpcRequest,
    ) -> Result<Vec<JsonRpcMessage>, AppServerError> {
        self.handle_request_with_context(request, None).await
    }

    pub(crate) async fn handle_transport_request(
        &self,
        connection_id: ConnectionId,
        request: JsonRpcRequest,
    ) -> Result<Vec<JsonRpcMessage>, AppServerError> {
        let request_id = request.id.clone();
        self.for_connection(
            connection_id,
            request.method == app_server_protocol::METHOD_INITIALIZE,
        )
        .handle_request_with_context(
            request,
            Some(ConnectionRequestId::new(connection_id, request_id)),
        )
        .await
    }

    async fn handle_request_with_context(
        &self,
        request: JsonRpcRequest,
        connection_request_id: Option<ConnectionRequestId>,
    ) -> Result<Vec<JsonRpcMessage>, AppServerError> {
        let client_info = self.client_info();
        let span = request_trace::request_span(&request, client_info.as_ref());
        let scope = match resolve_request_serialization_scope(&self.runtime, &request).await {
            Ok(scope) => scope,
            Err(message) => return Ok(vec![message]),
        };
        self.request_serialization_queues
            .run(
                scope,
                self.handle_request_inner(request, connection_request_id, None)
                    .instrument(span),
            )
            .await
    }

    pub async fn handle_request_streaming(
        &self,
        request: JsonRpcRequest,
        event_callback: &mut (dyn FnMut(JsonRpcMessage) + Send),
    ) -> Result<Vec<JsonRpcMessage>, AppServerError> {
        self.handle_request_streaming_with_context(request, None, event_callback)
            .await
    }

    async fn handle_request_streaming_with_context(
        &self,
        request: JsonRpcRequest,
        connection_request_id: Option<ConnectionRequestId>,
        event_callback: &mut (dyn FnMut(JsonRpcMessage) + Send),
    ) -> Result<Vec<JsonRpcMessage>, AppServerError> {
        let client_info = self.client_info();
        let span = request_trace::request_span(&request, client_info.as_ref());
        let scope = match resolve_request_serialization_scope(&self.runtime, &request).await {
            Ok(scope) => scope,
            Err(message) => return Ok(vec![message]),
        };
        self.request_serialization_queues
            .run(
                scope,
                self.handle_request_inner(request, connection_request_id, Some(event_callback))
                    .instrument(span),
            )
            .await
    }

    fn handle_capability_list(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: CapabilityListParams = parse_params(params)?;
        let response = self
            .runtime
            .list_capabilities(params)
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }
    // agent_session handlers 已提取到 processor/agent_session.rs
    // workspace + session_file handlers 已提取到 processor/workspace.rs
    // skill handlers 已提取到 processor/skill.rs

    // gateway handlers 已提取到 processor/gateway.rs
    async fn handle_telegram_channel_probe(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: ChannelProbeParams = parse_params(params)?;
        let response = self
            .runtime
            .probe_telegram_channel(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    async fn handle_feishu_channel_probe(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: ChannelProbeParams = parse_params(params)?;
        let response = self
            .runtime
            .probe_feishu_channel(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    async fn handle_discord_channel_probe(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: ChannelProbeParams = parse_params(params)?;
        let response = self
            .runtime
            .probe_discord_channel(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    // wechat handlers 已提取到 processor/wechat.rs

    // media handlers 已提取到 processor/media.rs

    // log handlers 已提取到 processor/log.rs

    // diagnostics handlers 已提取到 processor/diagnostics.rs

    // connect handlers 已提取到 processor/connect.rs

    fn handle_artifact_read(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: ArtifactReadParams = parse_params(params)?;
        let response = self
            .runtime
            .read_artifacts(params)
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }
    // Exact fs handlers live in processor/fs.rs.

    // project_git handlers 已提取到 processor/project_git.rs

    async fn handle_handoff_bundle_export(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: AgentSessionHandoffBundleExportParams = parse_params(params)?;
        let response = self
            .runtime
            .export_handoff_bundle(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    async fn handle_replay_case_export(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: AgentSessionReplayCaseExportParams = parse_params(params)?;
        let response = self
            .runtime
            .export_replay_case(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    async fn handle_analysis_handoff_export(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: AgentSessionAnalysisHandoffExportParams = parse_params(params)?;
        let response = self
            .runtime
            .export_analysis_handoff(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    async fn handle_review_decision_template_export(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: AgentSessionReviewDecisionTemplateExportParams = parse_params(params)?;
        let response = self
            .runtime
            .export_review_decision_template(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    async fn handle_review_decision_save(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: AgentSessionReviewDecisionSaveParams = parse_params(params)?;
        let response = self
            .runtime
            .save_review_decision(params)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result(response)
    }

    async fn handle_action_respond(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let params: AgentSessionActionRespondParams = parse_params(params)?;
        let host = self.runtime_host_context();
        let output = self
            .runtime
            .respond_action(params, host)
            .await
            .map_err(to_jsonrpc_error)?;
        dispatch_result_with_events(output.response, output.events)
    }
}

pub(crate) fn project_event_notifications_jsonrpc(
    projector: &mut v2_notifications::V2NotificationProjector,
    event: AgentEvent,
) -> Result<Vec<JsonRpcMessage>, JsonRpcError> {
    Ok(projector
        .project(event)?
        .into_iter()
        .map(JsonRpcMessage::Notification)
        .collect())
}

pub(super) fn parse_params<T>(params: Option<serde_json::Value>) -> Result<T, JsonRpcError>
where
    T: DeserializeOwned,
{
    serde_json::from_value(params.unwrap_or_else(|| serde_json::json!({}))).map_err(|error| {
        JsonRpcError::new(
            error_codes::INVALID_PARAMS,
            format!("invalid params: {error}"),
        )
    })
}

fn serialize_result(value: impl Serialize) -> Result<serde_json::Value, JsonRpcError> {
    serde_json::to_value(value).map_err(|error| {
        JsonRpcError::new(
            error_codes::RUNTIME_ERROR,
            format!("failed to serialize response: {error}"),
        )
    })
}

pub(super) struct RpcDispatch {
    result: serde_json::Value,
    events: Vec<AgentEvent>,
    notifications: Vec<JsonRpcNotification>,
}

impl RpcDispatch {
    fn single(result: serde_json::Value) -> Self {
        Self {
            result,
            events: Vec::new(),
            notifications: Vec::new(),
        }
    }

    pub(super) fn with_notification(mut self, notification: JsonRpcNotification) -> Self {
        self.notifications.push(notification);
        self
    }

    pub(super) fn with_notifications(mut self, notifications: Vec<JsonRpcNotification>) -> Self {
        self.notifications.extend(notifications);
        self
    }
}

pub(super) fn dispatch_result(value: impl Serialize) -> Result<RpcDispatch, JsonRpcError> {
    Ok(RpcDispatch::single(serialize_result(value)?))
}

pub(super) fn dispatch_result_with_events(
    value: impl Serialize,
    events: Vec<AgentEvent>,
) -> Result<RpcDispatch, JsonRpcError> {
    Ok(RpcDispatch {
        result: serialize_result(value)?,
        events,
        notifications: Vec::new(),
    })
}

pub(super) fn workspace_right_surface_pending_changed_notification(
    params: app_server_protocol::WorkspaceRightSurfacePendingChangedParams,
) -> Result<JsonRpcNotification, JsonRpcError> {
    Ok(ServerNotification::WorkspaceRightSurfacePendingChanged(params).into())
}

fn event_notifications(
    projector: &mut v2_notifications::V2NotificationProjector,
    event: AgentEvent,
) -> Result<Vec<JsonRpcMessage>, AppServerError> {
    project_event_notifications_jsonrpc(projector, event).map_err(|error| {
        AppServerError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            error.message,
        ))
    })
}

pub(super) fn deprecated_agent_event_notification(event: AgentEvent) -> JsonRpcNotification {
    ServerNotification::AgentSessionEvent(AgentSessionEventParams { event }).into()
}

pub(super) fn to_jsonrpc_error(error: RuntimeCoreError) -> JsonRpcError {
    error.into_jsonrpc_error()
}

#[cfg(test)]
mod tests;
