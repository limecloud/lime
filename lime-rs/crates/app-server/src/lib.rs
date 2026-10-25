mod account;
mod agent_identity_store;
mod agent_mailbox_store;
mod agent_ui_event_schema;
mod agent_ui_sequence_verifier;
mod approval_server_request;
mod automation_execution;
mod capability;
#[cfg(test)]
mod client_context_tests;
#[cfg(test)]
mod client_context_transport_tests;
mod command_exec;
mod current_time;
#[cfg(test)]
mod current_time_tests;
mod dynamic_tool_server_request;
mod execution_process;
mod external_backend;
mod file_checkpoint;
mod file_checkpoint_snapshot;
mod fs;
mod fuzzy_file_search;
mod gateway_tunnel;
mod initialization;
mod local_data_source;
mod mcp_elicitation;
mod media_runtime_contract;
mod media_task;
mod media_task_payload;
mod media_task_worker;
mod memory_store;
mod message;
mod model_route_assembly;
mod model_route_execution;
mod model_task_contract;
mod otel_trace;
mod permission_profile;
mod permission_server_request;
mod plugin_remote;
mod process;
mod processor;
mod runtime;
mod runtime_backend;
mod runtime_factory;
mod scheduled_task_notifications;
mod scheduled_task_worker;
mod server_request;
mod skill_registry;
mod skills_watcher;
mod thread_listener;
#[cfg(test)]
mod thread_listener_tests;
mod thread_state;
mod trace_context;

pub use app_server_protocol::error_codes;
pub use app_server_protocol::protocol::v2::{
    MediaReadParams, MediaReadResponse, METHOD_MEDIA_READ,
};
use app_server_protocol::AgentEvent;
pub use app_server_protocol::AgentInput;
pub use app_server_protocol::AgentSession;
pub use app_server_protocol::AgentSessionActionRespondParams;
pub use app_server_protocol::AgentSessionActionRespondResponse;
pub use app_server_protocol::AgentSessionActionScope;
pub use app_server_protocol::AgentSessionActionType;
pub use app_server_protocol::AgentSessionAnalysisHandoffExportParams;
pub use app_server_protocol::AgentSessionAnalysisHandoffExportResponse;
pub use app_server_protocol::AgentSessionApprovalDecision;
pub use app_server_protocol::AgentSessionHandoffArtifact;
pub use app_server_protocol::AgentSessionHandoffBundleExportParams;
pub use app_server_protocol::AgentSessionHandoffBundleExportResponse;
pub use app_server_protocol::AgentSessionReplayCaseExportParams;
pub use app_server_protocol::AgentSessionReplayCaseExportResponse;
pub use app_server_protocol::AgentSessionReviewDecision;
pub use app_server_protocol::AgentSessionReviewDecisionSaveParams;
pub use app_server_protocol::AgentSessionReviewDecisionTemplateExportParams;
pub use app_server_protocol::AgentSessionReviewDecisionTemplateExportResponse;
pub use app_server_protocol::AgentSessionStartParams;
pub use app_server_protocol::AgentSessionStatus;
pub use app_server_protocol::AgentSessionTurnStartParams;
pub use app_server_protocol::AgentTurn;
pub use app_server_protocol::AgentTurnStatus;
pub use app_server_protocol::ArtifactContentStatus;
pub use app_server_protocol::ArtifactReadParams;
pub use app_server_protocol::ArtifactReadResponse;
pub use app_server_protocol::ArtifactSummary;
pub use app_server_protocol::CapabilityDescriptor;
pub use app_server_protocol::CapabilityListParams;
pub use app_server_protocol::CapabilityListResponse;
use app_server_protocol::InitializeParams;
use app_server_protocol::JsonRpcError;
pub use app_server_protocol::JsonRpcMessage;
pub use app_server_protocol::JsonRpcNotification;
pub use app_server_protocol::JsonRpcRequest;
pub use app_server_protocol::RequestId;
pub use app_server_protocol::RuntimeOptions;
pub use app_server_protocol::WorkflowReadParams;
pub use app_server_protocol::WorkflowReadResponse;
pub use app_server_protocol::METHOD_AGENT_SESSION_ACTION_RESPOND;
pub use app_server_protocol::METHOD_AGENT_SESSION_ANALYSIS_HANDOFF_EXPORT;
pub use app_server_protocol::METHOD_AGENT_SESSION_EVENT;
pub use app_server_protocol::METHOD_AGENT_SESSION_HANDOFF_BUNDLE_EXPORT;
pub use app_server_protocol::METHOD_AGENT_SESSION_REPLAY_CASE_EXPORT;
pub use app_server_protocol::METHOD_AGENT_SESSION_REVIEW_DECISION_SAVE;
pub use app_server_protocol::METHOD_AGENT_SESSION_REVIEW_DECISION_TEMPLATE_EXPORT;
pub use app_server_protocol::METHOD_ARTIFACT_READ;
pub use app_server_protocol::METHOD_CAPABILITY_LIST;
pub use app_server_protocol::METHOD_INITIALIZE;
pub use app_server_protocol::METHOD_INITIALIZED;
pub use app_server_protocol::METHOD_THREAD_READ;
pub use app_server_protocol::METHOD_THREAD_START;
pub use app_server_protocol::METHOD_TURN_INTERRUPT;
pub use app_server_protocol::METHOD_TURN_START;
pub use app_server_protocol::METHOD_WORKFLOW_READ;
use app_server_transport::acquire_app_server_startup_lock;
use app_server_transport::app_server_startup_lock_path;
#[cfg(test)]
use app_server_transport::decode_message;
#[cfg(test)]
use app_server_transport::encode_message;
use app_server_transport::start_control_socket_acceptor;
use app_server_transport::start_stdio_connection;
use app_server_transport::start_websocket_acceptor;
use app_server_transport::AppServerTransport;
use app_server_transport::ConnectionId;
use app_server_transport::OutgoingMessage;
use app_server_transport::QueuedOutgoingMessage;
use app_server_transport::TransportError;
use app_server_transport::TransportEvent;
use app_server_transport::APP_SERVER_CONTROL_SOCKET_DIR_NAME;
pub use capability::capability_source_from_app_policy_json;
pub use capability::AppPolicyCapability;
pub use capability::AppPolicyLoadError;
pub use capability::AppPolicyManifest;
pub use capability::AppPolicyManifestError;
pub use capability::CapabilityInventoryRecord;
pub use capability::CapabilityInventorySource;
pub use capability::CapabilityListContext;
pub use capability::CapabilitySource;
pub use current_time::CurrentTimeReadError;
pub use external_backend::ExternalBackend;
pub use external_backend::ExternalBackendConfig;
pub use external_backend::DEFAULT_EXTERNAL_BACKEND_TIMEOUT_MS;
pub use local_data_source::LocalAppDataSource;
pub use memory_store::LocalMemoryBackend;
pub use memory_store::MemoryBackend;
pub use memory_store::RolloutSummaryWriteParams;
pub use memory_store::{
    MemoryAgent, MemoryAgentError, MemoryAgentRequest, MemorySourcePolicy, MemoryStageOneProvider,
    MemoryStageOneProviderRequest, MemoryStageOneRoute, MemoryStageOneRunResult,
    MemoryStageOneVersion,
};
pub use otel_trace::init_app_server_otel_from_env;
pub use otel_trace::AppServerOtelGuard;
use processor::RequestProcessor;
pub(crate) use runtime::export_trace_events_from_store_to_path;
pub(crate) use runtime::summarize_trace_event_store;
pub use runtime::ActionRespondRequest;
pub use runtime::AppDataSource;
pub use runtime::ArtifactContentProvider;
pub use runtime::ArtifactContentRequest;
pub use runtime::AutomationManagementAppDataSource;
pub use runtime::AutomationOverviewAppDataSource;
pub use runtime::CancelExecutionRequest;
pub use runtime::ConnectAppDataSource;
pub use runtime::DiagnosticsAppDataSource;
pub use runtime::DynamicToolRespondRequest;
pub use runtime::EventLogRecord;
pub use runtime::EventLogWriter;
pub use runtime::ExecutionBackend;
pub use runtime::ExecutionRequest;
pub use runtime::FileCheckpointSnapshotReadRequest;
pub use runtime::FileCheckpointSnapshotRecord;
pub use runtime::FileCheckpointSnapshotSaveRequest;
pub use runtime::FileCheckpointSnapshotStore;
pub use runtime::FilesystemArtifactContentProvider;
pub use runtime::FilesystemFileCheckpointSnapshotStore;
pub use runtime::FilesystemOutputSnapshotStore;
pub use runtime::GatewayAppDataSource;
pub use runtime::InlineArtifactContentProvider;
pub use runtime::McpAppDataSource;
pub use runtime::MediaAppDataSource;
pub use runtime::MemoryAppDataSource;
pub use runtime::MockBackend;
pub use runtime::ModelCatalogQuery;
pub use runtime::ModelProviderAppDataSource;
pub use runtime::NoopAppDataSource;
pub use runtime::NoopFileCheckpointSnapshotStore;
pub use runtime::NoopOutputSnapshotStore;
pub use runtime::OutputSnapshotReadRequest;
pub use runtime::OutputSnapshotRecord;
pub use runtime::OutputSnapshotSaveRequest;
pub use runtime::OutputSnapshotStore;
pub use runtime::PermissionRespondRequest;
pub use runtime::PluginDataSource;
pub use runtime::ProjectionRepair;
pub use runtime::ProjectionStore;
pub use runtime::ProviderModelCatalog;
#[doc(hidden)]
pub use runtime::ProviderTurnHistory;
pub use runtime::RightSurfaceAppDataSource;
pub use runtime::RuntimeCore;
pub use runtime::RuntimeCoreError;
pub use runtime::RuntimeCoreEventAppender;
pub use runtime::RuntimeCoreOutput;
pub use runtime::RuntimeEvent;
pub use runtime::RuntimeEventHub;
pub use runtime::RuntimeEventSink;
pub use runtime::RuntimeHostContext;
pub use runtime::SessionAppDataSource;
pub use runtime::SidecarRef;
pub use runtime::SidecarStore;
pub use runtime::SidecarWriteRequest;
pub use runtime::SkillAppDataSource;
pub use runtime::StorageRoots;
pub use runtime::ToolInventoryReadRequest;
pub use runtime::TraceEventWriter;
pub use runtime::UnavailableBackend;
pub use runtime::VoiceAppDataSource;
pub use runtime::WorkspaceAppDataSource;
pub use runtime::WorkspaceArtifactContentProvider;
pub use runtime::WorkspaceSkillBindingAppDataSource;
pub(crate) use runtime::TRACE_EVENT_MAX_FILES_PER_SESSION;
pub use runtime_backend::RuntimeBackend;
pub use runtime_factory::AppServerBackendMode;
pub use runtime_factory::AppServerRuntimeFactory;
pub use runtime_factory::UnsupportedBackendMode;
pub use scheduled_task_worker::spawn_scheduled_task_worker;
pub use server_request::ServerRequestError;
use std::collections::HashMap;
use std::collections::HashSet;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Duration;
use thiserror::Error;
use tokio::io;
use tokio::io::AsyncRead;
use tokio::io::AsyncWrite;
use tokio::sync::broadcast;
use tokio::sync::mpsc;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

const OUTBOUND_MESSAGE_CAPACITY: usize = 1024;
const DEFAULT_THREAD_UNLOADING_DELAY: Duration = Duration::from_secs(30 * 60);
const THREAD_UNLOAD_ACTIVITY_POLL_INTERVAL: Duration = Duration::from_millis(250);
type TransportWriter = mpsc::Sender<QueuedOutgoingMessage>;
type TransportWriters = Arc<Mutex<HashMap<ConnectionId, TransportWriter>>>;
type TransportDisconnects = Arc<Mutex<HashMap<ConnectionId, CancellationToken>>>;
type TransportInitialized = Arc<Mutex<HashSet<ConnectionId>>>;
type TransportExperimentalApi = Arc<Mutex<HashSet<ConnectionId>>>;
type TransportNotificationOptOut = Arc<Mutex<HashMap<ConnectionId, HashSet<String>>>>;
type StreamedTransportMessage = Result<(ConnectionId, JsonRpcMessage), AppServerError>;

struct ServerRequestClient {
    connection_id: ConnectionId,
    writer: TransportWriter,
    disconnect_sender: Option<CancellationToken>,
}

#[derive(Debug, Error)]
pub enum AppServerError {
    #[error(transparent)]
    Transport(#[from] TransportError),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("app-server transport connection {connection_id} is not open")]
    ConnectionUnavailable { connection_id: ConnectionId },
    #[error("app-server transport connection {connection_id} writer is closed")]
    ConnectionWriterClosed { connection_id: ConnectionId },
    #[error(transparent)]
    ServerRequest(#[from] ServerRequestError),
    #[error("app-server thread listener failed: {0}")]
    ThreadListener(String),
    #[error(transparent)]
    Runtime(#[from] RuntimeCoreError),
    #[error(
        "app-server transport is disabled; select stdio://, unix://PATH, or ws://127.0.0.1:PORT"
    )]
    TransportDisabled,
}

#[derive(Clone)]
pub struct AppServer {
    processor: RequestProcessor,
    thread_states: thread_state::ThreadStateManager,
    runtime_event_receiver: Arc<Mutex<Option<mpsc::UnboundedReceiver<AgentEvent>>>>,
    runtime_event_pump_started: Arc<AtomicBool>,
    outbound_messages: broadcast::Sender<JsonRpcMessage>,
    transport_writers: TransportWriters,
    transport_disconnects: TransportDisconnects,
    transport_initialized: TransportInitialized,
    transport_experimental_api: TransportExperimentalApi,
    transport_notification_opt_out: TransportNotificationOptOut,
    thread_unloading_delay: Duration,
    server_requests: server_request::ServerRequestRouter,
    current_time_requests: current_time::CurrentTimeRequestRouter,
    mcp_elicitation_requests: mcp_elicitation::ElicitationRequestSource,
}

#[derive(Clone)]
pub struct AppServerEventBridge {
    pub(crate) runtime: RuntimeCore,
    runtime_events: RuntimeCoreEventAppender,
    thread_states: thread_state::ThreadStateManager,
    server_requests: server_request::ServerRequestRouter,
    outbound_messages: broadcast::Sender<JsonRpcMessage>,
    transport_writers: TransportWriters,
    transport_disconnects: TransportDisconnects,
    transport_initialized: TransportInitialized,
    transport_experimental_api: TransportExperimentalApi,
    transport_notification_opt_out: TransportNotificationOptOut,
}

impl AppServer {
    pub fn with_mcp_elicitation_router(
        mut self,
        router: lime_mcp::ElicitationRequestRouter,
    ) -> Result<Self, lime_mcp::ElicitationRouterError> {
        self.mcp_elicitation_requests =
            mcp_elicitation::ElicitationRequestSource::subscribe(router)?;
        Ok(self)
    }

    pub fn with_thread_unloading_delay(mut self, delay: Duration) -> Self {
        self.thread_unloading_delay = delay;
        self
    }

    pub fn subscribe_outbound_messages(&self) -> broadcast::Receiver<JsonRpcMessage> {
        self.outbound_messages.subscribe()
    }

    fn ensure_runtime_event_pump(&self) {
        if self.runtime_event_pump_started.swap(true, Ordering::AcqRel) {
            return;
        }
        let receiver = self
            .runtime_event_receiver
            .lock()
            .expect("app-server runtime event receiver mutex poisoned")
            .take();
        let Some(mut receiver) = receiver else {
            return;
        };
        let bridge = self.event_bridge();
        let server = self.clone();
        tokio::spawn(async move {
            while let Some(event) = receiver.recv().await {
                let Some(thread_id) = event
                    .thread_id
                    .as_deref()
                    .map(str::trim)
                    .filter(|thread_id| !thread_id.is_empty())
                    .map(agent_protocol::ThreadId::new)
                else {
                    tracing::error!(
                        event_id = %event.event_id,
                        event_type = %event.event_type,
                        "dropping background runtime event without canonical thread id"
                    );
                    continue;
                };
                let reverse_request_event = matches!(
                    event.event_type.as_str(),
                    "action.required" | "dynamic_tool.requested"
                )
                .then(|| event.clone());
                let (completion_tx, completion_rx) = if reverse_request_event.is_some() {
                    let (sender, receiver) = oneshot::channel();
                    (Some(sender), Some(receiver))
                } else {
                    (None, None)
                };
                if let Err(error) = bridge
                    .send_thread_command(
                        thread_id,
                        thread_state::ThreadListenerCommand::PublishRuntimeEvent {
                            event,
                            completion_tx,
                        },
                    )
                    .await
                {
                    tracing::error!(%error, "failed to enqueue background runtime event");
                    continue;
                }
                if let (Some(event), Some(completion_rx)) = (reverse_request_event, completion_rx) {
                    match completion_rx.await {
                        Ok(Ok(_)) => {}
                        Ok(Err(error)) => {
                            tracing::warn!(%error, "reverse-request projection failed");
                            continue;
                        }
                        Err(error) => {
                            tracing::warn!(%error, "reverse-request projection did not complete");
                            continue;
                        }
                    }
                    let server = server.clone();
                    tokio::spawn(async move {
                        if server
                            .handle_dynamic_tool_server_request(event.clone())
                            .await
                        {
                            return;
                        }
                        if server.handle_permission_server_request(event.clone()).await {
                            return;
                        }
                        server.handle_command_approval_request(event).await;
                    });
                }
            }
        });
    }

    pub fn event_bridge(&self) -> AppServerEventBridge {
        AppServerEventBridge {
            runtime: self.processor.runtime().clone(),
            runtime_events: self.processor.runtime().event_appender(),
            thread_states: self.thread_states.clone(),
            server_requests: self.server_requests.clone(),
            outbound_messages: self.outbound_messages.clone(),
            transport_writers: self.transport_writers.clone(),
            transport_disconnects: self.transport_disconnects.clone(),
            transport_initialized: self.transport_initialized.clone(),
            transport_experimental_api: self.transport_experimental_api.clone(),
            transport_notification_opt_out: self.transport_notification_opt_out.clone(),
        }
    }

    fn schedule_thread_unload(&self, thread_id: agent_protocol::ThreadId) {
        let server = self.clone();
        tokio::spawn(async move {
            let Some(generation) = server
                .thread_states
                .schedule_unload_if_idle(&thread_id)
                .await
            else {
                return;
            };
            let poll_interval = server
                .thread_unloading_delay
                .min(THREAD_UNLOAD_ACTIVITY_POLL_INTERVAL)
                .max(Duration::from_millis(1));
            let mut idle_since = None;

            loop {
                if !server
                    .thread_states
                    .unload_ticket_is_current(&thread_id, generation)
                    .await
                {
                    return;
                }
                match server
                    .processor
                    .runtime()
                    .loaded_thread_is_active(thread_id.as_str())
                {
                    None => {
                        server.thread_states.remove_thread(&thread_id).await;
                        return;
                    }
                    Some(true) => idle_since = None,
                    Some(false) => {
                        let since = idle_since.get_or_insert_with(tokio::time::Instant::now);
                        if since.elapsed() >= server.thread_unloading_delay {
                            break;
                        }
                    }
                }
                tokio::time::sleep(poll_interval).await;
            }

            if !server
                .thread_states
                .begin_unload(&thread_id, generation)
                .await
            {
                return;
            }
            match server
                .processor
                .runtime()
                .unload_thread_if_idle(thread_id.as_str())
                .await
            {
                Ok(runtime::ThreadUnloadResult::Unloaded) => {
                    let bridge = server.event_bridge();
                    server
                        .server_requests
                        .abort_for_threads(&bridge, &[thread_id.to_string()], "thread closed")
                        .await;
                    server
                        .processor
                        .close_mcp_event_streams_for_thread(thread_id.as_str())
                        .await;
                    server.thread_states.remove_thread(&thread_id).await;
                    let status: JsonRpcNotification =
                        app_server_protocol::protocol::v2::ServerNotification::ThreadStatusChanged(
                            app_server_protocol::protocol::v2::ThreadStatusChangedNotification {
                                thread_id: thread_id.to_string(),
                                status: app_server_protocol::protocol::v2::ThreadStatus::NotLoaded,
                            },
                        )
                        .into();
                    bridge
                        .broadcast_message(JsonRpcMessage::Notification(status))
                        .await;
                    let closed: JsonRpcNotification =
                        app_server_protocol::protocol::v2::ServerNotification::ThreadClosed(
                            app_server_protocol::protocol::v2::ThreadClosedNotification {
                                thread_id: thread_id.to_string(),
                            },
                        )
                        .into();
                    bridge
                        .broadcast_message(JsonRpcMessage::Notification(closed))
                        .await;
                }
                Ok(runtime::ThreadUnloadResult::NotLoaded) => {
                    server
                        .processor
                        .close_mcp_event_streams_for_thread(thread_id.as_str())
                        .await;
                    server.thread_states.remove_thread(&thread_id).await;
                }
                Ok(runtime::ThreadUnloadResult::Active) => {
                    server
                        .thread_states
                        .cancel_unload(&thread_id, generation)
                        .await;
                    server.schedule_thread_unload(thread_id);
                }
                Err(error) => {
                    server
                        .thread_states
                        .cancel_unload(&thread_id, generation)
                        .await;
                    tracing::warn!(%thread_id, %error, "failed to unload idle thread");
                }
            }
        });
    }

    #[cfg(test)]
    fn runtime(&self) -> &RuntimeCore {
        self.processor.runtime()
    }

    pub async fn append_external_runtime_events(
        &self,
        session_id: &str,
        turn_id: Option<&str>,
        runtime_events: Vec<RuntimeEvent>,
    ) -> Result<Vec<JsonRpcMessage>, JsonRpcError> {
        self.event_bridge()
            .append_external_runtime_events(session_id, turn_id, runtime_events)
            .await
    }

    fn register_transport_writer(
        &self,
        connection_id: ConnectionId,
        writer: TransportWriter,
        disconnect_sender: Option<CancellationToken>,
    ) {
        self.transport_writers
            .lock()
            .expect("app-server transport writer mutex poisoned")
            .insert(connection_id, writer);
        let mut disconnects = self
            .transport_disconnects
            .lock()
            .expect("app-server transport disconnect mutex poisoned");
        if let Some(disconnect_sender) = disconnect_sender {
            disconnects.insert(connection_id, disconnect_sender);
        } else {
            disconnects.remove(&connection_id);
        }
    }

    fn unregister_transport_writer(&self, connection_id: ConnectionId) {
        self.processor.close_client_connection(connection_id);
        self.transport_writers
            .lock()
            .expect("app-server transport writer mutex poisoned")
            .remove(&connection_id);
        self.transport_disconnects
            .lock()
            .expect("app-server transport disconnect mutex poisoned")
            .remove(&connection_id);
        self.transport_initialized
            .lock()
            .expect("app-server transport initialization mutex poisoned")
            .remove(&connection_id);
        self.transport_experimental_api
            .lock()
            .expect("app-server transport experimental capability mutex poisoned")
            .remove(&connection_id);
        self.transport_notification_opt_out
            .lock()
            .expect("app-server transport notification opt-out mutex poisoned")
            .remove(&connection_id);
    }

    async fn clear_transport_writers(&self) {
        self.processor.clear_client_connections();
        let connection_ids = self
            .transport_writers
            .lock()
            .expect("app-server transport writer mutex poisoned")
            .keys()
            .copied()
            .collect::<Vec<_>>();
        self.transport_writers
            .lock()
            .expect("app-server transport writer mutex poisoned")
            .clear();
        self.transport_disconnects
            .lock()
            .expect("app-server transport disconnect mutex poisoned")
            .clear();
        self.transport_initialized
            .lock()
            .expect("app-server transport initialization mutex poisoned")
            .clear();
        self.transport_experimental_api
            .lock()
            .expect("app-server transport experimental capability mutex poisoned")
            .clear();
        self.transport_notification_opt_out
            .lock()
            .expect("app-server transport notification opt-out mutex poisoned")
            .clear();
        for connection_id in connection_ids {
            self.processor.close_process_connection(connection_id).await;
            self.processor
                .close_command_exec_connection(connection_id)
                .await;
            self.processor.close_fs_connection(connection_id).await;
            self.processor.close_mcp_event_streams(connection_id).await;
            self.thread_states
                .disconnect_connection(connection_id)
                .await;
        }
    }

    fn transport_writer(&self, connection_id: ConnectionId) -> Option<TransportWriter> {
        self.transport_writers
            .lock()
            .expect("app-server transport writer mutex poisoned")
            .get(&connection_id)
            .cloned()
    }

    fn transport_disconnect_sender(
        &self,
        connection_id: ConnectionId,
    ) -> Option<CancellationToken> {
        self.transport_disconnects
            .lock()
            .expect("app-server transport disconnect mutex poisoned")
            .get(&connection_id)
            .cloned()
    }

    fn mark_transport_initialized(&self, connection_id: ConnectionId) {
        self.transport_initialized
            .lock()
            .expect("app-server transport initialization mutex poisoned")
            .insert(connection_id);
    }

    fn set_transport_notification_opt_out(
        &self,
        connection_id: ConnectionId,
        methods: Option<Vec<String>>,
    ) {
        let methods = methods
            .unwrap_or_default()
            .into_iter()
            .map(|method| method.trim().to_string())
            .filter(|method| !method.is_empty())
            .collect();
        self.transport_notification_opt_out
            .lock()
            .expect("app-server transport notification opt-out mutex poisoned")
            .insert(connection_id, methods);
    }

    async fn send_to_transport_connection(
        &self,
        connection_id: ConnectionId,
        message: JsonRpcMessage,
    ) -> Result<(), AppServerError> {
        let writer = self
            .transport_writer(connection_id)
            .ok_or(AppServerError::ConnectionUnavailable { connection_id })?;
        let queued = QueuedOutgoingMessage::new(OutgoingMessage::from(message));
        if let Some(disconnect_sender) = self.transport_disconnect_sender(connection_id) {
            match writer.try_send(queued) {
                Ok(()) => Ok(()),
                Err(mpsc::error::TrySendError::Full(_)) => {
                    disconnect_sender.cancel();
                    Ok(())
                }
                Err(mpsc::error::TrySendError::Closed(_)) => {
                    disconnect_sender.cancel();
                    Err(AppServerError::ConnectionWriterClosed { connection_id })
                }
            }
        } else {
            writer
                .send(queued)
                .await
                .map_err(|_| AppServerError::ConnectionWriterClosed { connection_id })
        }
    }

    pub async fn send_server_request(
        &self,
        method: impl Into<String>,
        params: impl serde::Serialize,
    ) -> Result<serde_json::Value, AppServerError> {
        self.begin_server_request(method, params)
            .await?
            .wait()
            .await
            .map_err(AppServerError::from)
    }

    fn server_request_client(&self) -> Result<ServerRequestClient, AppServerError> {
        let writers = self
            .transport_writers
            .lock()
            .expect("app-server transport writer mutex poisoned")
            .iter()
            .map(|(connection_id, writer)| (*connection_id, writer.clone()))
            .collect::<Vec<_>>();
        let client_count = writers.len();
        if client_count == 0 {
            return Err(ServerRequestError::ClientUnavailable.into());
        }
        if client_count != 1 {
            return Err(ServerRequestError::ClientAmbiguous { client_count }.into());
        }

        let (connection_id, writer) = writers
            .into_iter()
            .next()
            .expect("one transport writer was counted");
        Ok(ServerRequestClient {
            connection_id,
            writer,
            disconnect_sender: self.transport_disconnect_sender(connection_id),
        })
    }

    async fn send_to_server_request_client(
        &self,
        client: ServerRequestClient,
        message: JsonRpcMessage,
    ) -> Result<(), AppServerError> {
        let queued = QueuedOutgoingMessage::new(OutgoingMessage::from(message));
        if let Some(disconnect_sender) = client.disconnect_sender {
            match client.writer.try_send(queued) {
                Ok(()) => Ok(()),
                Err(mpsc::error::TrySendError::Full(_)) => {
                    disconnect_sender.cancel();
                    Ok(())
                }
                Err(mpsc::error::TrySendError::Closed(_)) => {
                    disconnect_sender.cancel();
                    Err(AppServerError::ConnectionWriterClosed {
                        connection_id: client.connection_id,
                    })
                }
            }
        } else {
            client
                .writer
                .send(queued)
                .await
                .map_err(|_| AppServerError::ConnectionWriterClosed {
                    connection_id: client.connection_id,
                })
        }
    }

    fn cancel_pending_server_requests(&self, reason: &str) {
        self.server_requests.cancel_all(reason);
    }

    #[cfg(test)]
    fn resolve_test_server_request_response(&self, id: RequestId, result: serde_json::Value) {
        let request_id = id.clone();
        if let Err(error) = self.server_requests.resolve_response(id, result) {
            tracing::warn!(%request_id, %error, "dropping unmatched App Server test response");
        }
    }

    #[cfg(test)]
    fn resolve_test_server_request_error(&self, id: RequestId, response: JsonRpcError) {
        let request_id = id.clone();
        if let Err(error) = self.server_requests.resolve_error(id, response) {
            tracing::warn!(%request_id, %error, "dropping unmatched App Server test error");
        }
    }
}

pub fn spawn_media_task_worker_scheduler(
    db: lime_core::database::DbConnection,
    sidecar_store: Option<Arc<SidecarStore>>,
) -> tokio::task::JoinHandle<()> {
    media_task_worker::spawn_media_task_worker_scheduler(
        media_task_worker::MediaTaskWorkerContext::new(db).with_sidecar_store(sidecar_store),
    )
}

impl AppServerEventBridge {
    pub async fn publish_server_notification(
        &self,
        notification: app_server_protocol::protocol::v2::ServerNotification,
    ) {
        self.broadcast_message(JsonRpcMessage::Notification(notification.into()))
            .await;
    }

    async fn broadcast_message(&self, message: JsonRpcMessage) {
        let _ = self.outbound_messages.send(message.clone());
        let connection_ids = self
            .transport_writers
            .lock()
            .expect("app-server transport writer mutex poisoned")
            .keys()
            .copied()
            .collect::<Vec<_>>();
        for connection_id in connection_ids {
            if let Err(error) = self
                .send_messages_to_connection(connection_id, std::slice::from_ref(&message))
                .await
            {
                tracing::warn!(
                    %connection_id,
                    %error,
                    "failed to broadcast App Server message"
                );
            }
        }
    }

    async fn send_messages_to_connection(
        &self,
        connection_id: ConnectionId,
        messages: &[JsonRpcMessage],
    ) -> Result<(), String> {
        let writer = self
            .transport_writers
            .lock()
            .expect("app-server transport writer mutex poisoned")
            .get(&connection_id)
            .cloned()
            .ok_or_else(|| format!("transport connection {connection_id} is not open"))?;
        if !self
            .transport_initialized
            .lock()
            .expect("app-server transport initialization mutex poisoned")
            .contains(&connection_id)
        {
            return Err(format!(
                "transport connection {connection_id} is not initialized"
            ));
        }
        let disconnect_sender = self
            .transport_disconnects
            .lock()
            .expect("app-server transport disconnect mutex poisoned")
            .get(&connection_id)
            .cloned();

        for message in messages {
            if notification_requires_experimental_api(message)
                && !transport_experimental_api_enabled(
                    &self.transport_experimental_api,
                    connection_id,
                )
            {
                continue;
            }
            if notification_is_opted_out(
                &self.transport_notification_opt_out,
                connection_id,
                message,
            ) {
                continue;
            }
            let queued = QueuedOutgoingMessage::new(OutgoingMessage::from(message.clone()));
            if let Some(disconnect_sender) = disconnect_sender.as_ref() {
                match writer.try_send(queued) {
                    Ok(()) => {}
                    Err(mpsc::error::TrySendError::Full(_)) => {
                        disconnect_sender.cancel();
                        return Err(format!(
                            "transport connection {connection_id} outbound queue is full"
                        ));
                    }
                    Err(mpsc::error::TrySendError::Closed(_)) => {
                        disconnect_sender.cancel();
                        return Err(format!(
                            "transport connection {connection_id} writer is closed"
                        ));
                    }
                }
            } else {
                writer.send(queued).await.map_err(|_| {
                    format!("transport connection {connection_id} writer is closed")
                })?;
            }
        }
        Ok(())
    }
}

pub async fn run_stdio(server: AppServer) -> Result<(), AppServerError> {
    run_json_lines(server, io::stdin(), io::stdout()).await
}

fn startup_lock_path_for_socket(socket_path: &Path) -> std::path::PathBuf {
    let socket_parent = socket_path.parent().unwrap_or_else(|| Path::new("."));
    let base_dir = if socket_parent.file_name()
        == Some(std::ffi::OsStr::new(APP_SERVER_CONTROL_SOCKET_DIR_NAME))
    {
        socket_parent.parent().unwrap_or(socket_parent)
    } else {
        socket_parent
    };
    app_server_startup_lock_path(base_dir)
}

/// Runs the App Server over the selected Codex-compatible transport.
///
/// Network transports share the same JSON-RPC event loop as stdio. This keeps
/// connection lifecycle, reverse requests, streaming responses, and backpressure
/// in one owner instead of maintaining a second server implementation.
pub async fn run_transport(
    server: AppServer,
    transport: AppServerTransport,
) -> Result<(), AppServerError> {
    let (transport_event_tx, transport_event_rx) = mpsc::channel(OUTBOUND_MESSAGE_CAPACITY);
    let shutdown_token = CancellationToken::new();
    let mut accept_handles = Vec::<JoinHandle<()>>::new();
    let single_client_mode = matches!(transport, AppServerTransport::Stdio);
    let _unix_socket_startup_lock = match &transport {
        AppServerTransport::UnixSocket { socket_path } => {
            Some(acquire_app_server_startup_lock(startup_lock_path_for_socket(socket_path)).await?)
        }
        _ => None,
    };

    match transport {
        AppServerTransport::Stdio => {
            accept_handles.extend(
                start_stdio_connection(transport_event_tx.clone(), io::stdin(), io::stdout())
                    .await?,
            );
        }
        AppServerTransport::UnixSocket { socket_path } => {
            accept_handles.push(
                start_control_socket_acceptor(
                    socket_path,
                    transport_event_tx.clone(),
                    shutdown_token.clone(),
                )
                .await?,
            );
        }
        AppServerTransport::WebSocket { bind_address } => {
            let (_, acceptor) = start_websocket_acceptor(
                bind_address,
                transport_event_tx.clone(),
                shutdown_token.clone(),
            )
            .await?;
            accept_handles.push(acceptor);
        }
        AppServerTransport::Off => return Err(AppServerError::TransportDisabled),
    }
    drop(_unix_socket_startup_lock);
    drop(transport_event_tx);

    let result = run_transport_events(
        server,
        transport_event_rx,
        single_client_mode,
        shutdown_token.clone(),
    )
    .await;
    shutdown_token.cancel();
    for handle in accept_handles {
        let _ = handle.await;
    }
    result
}

pub async fn run_json_lines<R, W>(
    server: AppServer,
    reader: R,
    writer: W,
) -> Result<(), AppServerError>
where
    R: AsyncRead + Unpin + Send + 'static,
    W: AsyncWrite + Unpin + Send + 'static,
{
    let (transport_event_tx, transport_event_rx) = mpsc::channel(OUTBOUND_MESSAGE_CAPACITY);
    let _stdio_handles = start_stdio_connection(transport_event_tx, reader, writer).await?;
    run_transport_events(server, transport_event_rx, true, CancellationToken::new()).await
}

async fn run_transport_events(
    server: AppServer,
    mut transport_event_rx: mpsc::Receiver<TransportEvent>,
    single_client_mode: bool,
    shutdown_token: CancellationToken,
) -> Result<(), AppServerError> {
    let (streamed_tx, mut streamed_rx) = mpsc::unbounded_channel::<StreamedTransportMessage>();
    let mcp_elicitation_shutdown = CancellationToken::new();
    let mcp_elicitation_pump = tokio::spawn(mcp_elicitation::run_request_pump(
        server.clone(),
        server.mcp_elicitation_requests.clone(),
        mcp_elicitation_shutdown.clone(),
    ));

    let transport_result = async {
        loop {
            tokio::select! {
                event = transport_event_rx.recv() => {
                    let Some(event) = event else {
                        break;
                    };
                    match event {
                        TransportEvent::ConnectionOpened {
                            connection_id,
                            writer,
                            disconnect_sender,
                            ..
                        } => {
                            server.register_transport_writer(
                                connection_id,
                                writer,
                                disconnect_sender,
                            );
                        }
                        TransportEvent::StdioClientInitialized { .. } => {}
                        TransportEvent::ConnectionClosed { connection_id } => {
                            server.processor.close_process_connection(connection_id).await;
                            server
                                .processor
                                .close_command_exec_connection(connection_id)
                                .await;
                            server.processor.close_fs_connection(connection_id).await;
                            server
                                .processor
                                .close_mcp_event_streams(connection_id)
                                .await;
                            let idle_thread_ids = server
                                .thread_states
                                .disconnect_connection(connection_id)
                                .await;
                            for thread_id in idle_thread_ids {
                                server.schedule_thread_unload(thread_id);
                            }
                            server.unregister_transport_writer(connection_id);
                            server.server_requests.cancel_owner(
                                server_request::ServerRequestOwner::Transport(connection_id),
                                "App Server transport disconnected",
                            );
                            if single_client_mode {
                                break;
                            }
                        }
                        TransportEvent::IncomingMessage {
                            connection_id,
                            message,
                        } => {
                            let is_initialize = matches!(
                                &message,
                                JsonRpcMessage::Request(request)
                                    if request.method == METHOD_INITIALIZE
                            );
                            let connection_initialized = transport_is_initialized(
                                &server.transport_initialized,
                                connection_id,
                            );
                            if is_initialize && connection_initialized {
                                let JsonRpcMessage::Request(request) = &message else {
                                    unreachable!("initialize must be a JSON-RPC request");
                                };
                                server
                                    .send_to_transport_connection(
                                        connection_id,
                                        JsonRpcMessage::Error(
                                            app_server_protocol::JsonRpcErrorResponse {
                                                id: request.id.clone(),
                                                error: JsonRpcError::new(
                                                    error_codes::ALREADY_INITIALIZED,
                                                    "initialize has already been accepted for this connection",
                                                ),
                                            },
                                        ),
                                    )
                                    .await?;
                                continue;
                            }
                            if !is_initialize && !connection_initialized {
                                if let JsonRpcMessage::Request(request) = &message {
                                    server
                                        .send_to_transport_connection(
                                            connection_id,
                                            JsonRpcMessage::Error(
                                                app_server_protocol::JsonRpcErrorResponse {
                                                    id: request.id.clone(),
                                                    error: JsonRpcError::new(
                                                        error_codes::NOT_INITIALIZED,
                                                        "initialize must complete for this connection before business methods",
                                                    ),
                                                },
                                            ),
                                        )
                                        .await?;
                                }
                                continue;
                            }
                            let notification_opt_out = if is_initialize {
                                initialize_notification_opt_out(&message)
                            } else {
                                None
                            };
                            if let JsonRpcMessage::Request(request) = &message {
                                if !transport_experimental_api_enabled(
                                    &server.transport_experimental_api,
                                    connection_id,
                                ) {
                                    if let Some(reason) = experimental_api_field_reason(request) {
                                        server
                                            .send_to_transport_connection(
                                                connection_id,
                                                JsonRpcMessage::Error(
                                                    app_server_protocol::JsonRpcErrorResponse {
                                                        id: request.id.clone(),
                                                        error: JsonRpcError::new(
                                                            error_codes::INVALID_REQUEST,
                                                            format!(
                                                                "{reason} requires experimentalApi capability"
                                                            ),
                                                        ),
                                                    },
                                                ),
                                            )
                                            .await?;
                                        continue;
                                    }
                                    if is_experimental_api_method(&request.method) {
                                        server
                                            .send_to_transport_connection(
                                                connection_id,
                                                JsonRpcMessage::Error(
                                                    app_server_protocol::JsonRpcErrorResponse {
                                                        id: request.id.clone(),
                                                        error: JsonRpcError::new(
                                                            error_codes::INVALID_REQUEST,
                                                            experimental_api_required_message(
                                                                &request.method,
                                                            ),
                                                        ),
                                                    },
                                                ),
                                            )
                                            .await?;
                                        continue;
                                    }
                                }
                            }
                            if should_spawn_transport_request(&message) {
                                let prepared_resume = if transport_is_initialized(
                                    &server.transport_initialized,
                                    connection_id,
                                ) {
                                    if let Some((thread_id, request_id)) =
                                        thread_resume_request_context(&message)
                                    {
                                        let barrier = thread_state::ThreadResumeBarrier::new(
                                            connection_id,
                                            request_id,
                                        );
                                        server
                                            .event_bridge()
                                            .prepare_thread_resume(
                                                agent_protocol::ThreadId::new(thread_id.clone()),
                                                barrier.clone(),
                                            )
                                            .await
                                            .map_err(AppServerError::ThreadListener)?;
                                        Some((thread_id, barrier))
                                    } else {
                                        None
                                    }
                                } else {
                                    None
                                };
                                spawn_transport_request(
                                    server.clone(),
                                    connection_id,
                                    message,
                                    streamed_tx.clone(),
                                    prepared_resume,
                                );
                                continue;
                            }
                            let initialize_experimental =
                                is_initialize && initialize_experimental_api(&message);
                            let responses = server
                                .handle_transport_message(connection_id, message)
                                .await?;
                            let initialize_succeeded = is_initialize
                                && responses
                                    .iter()
                                    .any(|response| matches!(response, JsonRpcMessage::Response(_)));
                            for response in responses {
                                server
                                    .send_to_transport_connection(connection_id, response)
                                    .await?;
                            }
                            if initialize_succeeded {
                                if initialize_experimental {
                                    server
                                        .transport_experimental_api
                                        .lock()
                                        .expect("app-server transport experimental capability mutex poisoned")
                                        .insert(connection_id);
                                }
                                server.set_transport_notification_opt_out(
                                    connection_id,
                                    notification_opt_out,
                                );
                                server.mark_transport_initialized(connection_id);
                                server
                                    .thread_states
                                    .connection_initialized(connection_id)
                                    .await;
                            }
                        }
                    }
                }
                streamed = streamed_rx.recv() => {
                    let Some(streamed) = streamed else {
                        break;
                    };
                    let (connection_id, message) = streamed?;
                    server
                        .send_to_transport_connection(connection_id, message)
                        .await?;
                }
                _ = shutdown_token.cancelled() => {
                    break;
                }
            }
        }
        Ok(())
    }
    .await;

    finish_json_lines(
        &server,
        mcp_elicitation_shutdown,
        mcp_elicitation_pump,
        transport_result,
    )
    .await
}

async fn finish_json_lines(
    server: &AppServer,
    mcp_elicitation_shutdown: tokio_util::sync::CancellationToken,
    mcp_elicitation_pump: tokio::task::JoinHandle<()>,
    transport_result: Result<(), AppServerError>,
) -> Result<(), AppServerError> {
    server.cancel_pending_server_requests("App Server transport stopped");
    mcp_elicitation_shutdown.cancel();
    let _ = mcp_elicitation_pump.await;
    server.thread_states.clear_all_listeners().await;
    let shutdown_result = server.processor.runtime().shutdown().await;
    server.clear_transport_writers().await;
    transport_result?;
    shutdown_result.map_err(AppServerError::from)
}

fn response_thread_id(messages: &[JsonRpcMessage]) -> Option<String> {
    messages.iter().find_map(|message| {
        let JsonRpcMessage::Response(response) = message else {
            return None;
        };
        response
            .result
            .get("thread")
            .and_then(|thread| thread.get("id"))
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned)
    })
}

fn thread_unsubscribe_succeeded(messages: &[JsonRpcMessage]) -> bool {
    messages.iter().any(|message| {
        let JsonRpcMessage::Response(response) = message else {
            return false;
        };
        response
            .result
            .get("status")
            .and_then(serde_json::Value::as_str)
            == Some("unsubscribed")
    })
}

fn thread_token_usage_notification(
    thread_id: &str,
    snapshot: runtime::thread_usage::ThreadTokenUsageSnapshot,
) -> JsonRpcNotification {
    let breakdown = |usage: runtime::thread_usage::TokenUsageSnapshot| {
        app_server_protocol::protocol::v2::TokenUsageBreakdown {
            total_tokens: usage.total_tokens,
            input_tokens: usage.input_tokens,
            cached_input_tokens: usage.cached_input_tokens,
            cache_write_input_tokens: usage.cache_write_input_tokens,
            output_tokens: usage.output_tokens,
            reasoning_output_tokens: usage.reasoning_output_tokens,
        }
    };
    let notification =
        app_server_protocol::protocol::v2::ServerNotification::ThreadTokenUsageUpdated(
            app_server_protocol::protocol::v2::ThreadTokenUsageUpdatedNotification {
                thread_id: thread_id.to_string(),
                turn_id: snapshot.turn_id,
                token_usage: app_server_protocol::protocol::v2::ThreadTokenUsage {
                    total: breakdown(snapshot.total_token_usage),
                    last: breakdown(snapshot.last_token_usage),
                    model_context_window: snapshot.model_context_window,
                },
            },
        );
    notification.into()
}

fn transport_is_initialized(
    initialized: &TransportInitialized,
    connection_id: ConnectionId,
) -> bool {
    initialized
        .lock()
        .expect("app-server transport initialization mutex poisoned")
        .contains(&connection_id)
}

fn initialize_experimental_api(message: &JsonRpcMessage) -> bool {
    let JsonRpcMessage::Request(request) = message else {
        return false;
    };
    if request.method != METHOD_INITIALIZE {
        return false;
    }
    request
        .params
        .as_ref()
        .and_then(|params| serde_json::from_value::<InitializeParams>(params.clone()).ok())
        .is_some_and(|params| params.capabilities.experimental_api)
}

fn transport_experimental_api_enabled(
    enabled: &TransportExperimentalApi,
    connection_id: ConnectionId,
) -> bool {
    enabled
        .lock()
        .expect("app-server transport experimental capability mutex poisoned")
        .contains(&connection_id)
}

fn is_experimental_api_method(method: &str) -> bool {
    matches!(
        method,
        app_server_protocol::protocol::v2::METHOD_THREAD_INCREMENT_ELICITATION
            | app_server_protocol::protocol::v2::METHOD_THREAD_DECREMENT_ELICITATION
            | app_server_protocol::protocol::v2::METHOD_THREAD_TURNS_LIST
            | app_server_protocol::protocol::v2::METHOD_THREAD_ITEMS_LIST
            | app_server_protocol::protocol::v2::METHOD_THREAD_SEARCH
            | app_server_protocol::protocol::v2::METHOD_THREAD_SEARCH_OCCURRENCES
            | app_server_protocol::protocol::v2::METHOD_THREAD_REVERT
            | app_server_protocol::protocol::v2::METHOD_THREAD_SETTINGS_UPDATE
            | app_server_protocol::protocol::v2::METHOD_THREAD_MEMORY_MODE_SET
            | app_server_protocol::protocol::v2::METHOD_MEMORY_RESET
            | app_server_protocol::protocol::v2::METHOD_THREAD_BACKGROUND_TERMINALS_CLEAN
            | app_server_protocol::protocol::v2::METHOD_THREAD_BACKGROUND_TERMINALS_LIST
            | app_server_protocol::protocol::v2::METHOD_THREAD_BACKGROUND_TERMINALS_TERMINATE
            | app_server_protocol::protocol::v2::METHOD_PLUGIN_SEARCH
            | app_server_protocol::protocol::v2::METHOD_COLLABORATION_MODE_LIST
            | app_server_protocol::protocol::v2::METHOD_MCP_SERVER_EVENT_STREAM_START
            | app_server_protocol::protocol::v2::METHOD_MCP_SERVER_EVENT_STREAM_STOP
            | app_server_protocol::protocol::v2::METHOD_ENVIRONMENT_ADD
            | app_server_protocol::protocol::v2::METHOD_ENVIRONMENT_INFO
            | app_server_protocol::protocol::v2::METHOD_ENVIRONMENT_STATUS
            | app_server_protocol::protocol::v2::METHOD_THREAD_QUEUE_ADD
            | app_server_protocol::protocol::v2::METHOD_THREAD_QUEUE_LIST
            | app_server_protocol::protocol::v2::METHOD_THREAD_QUEUE_UPDATE
            | app_server_protocol::protocol::v2::METHOD_THREAD_QUEUE_DELETE
            | app_server_protocol::protocol::v2::METHOD_THREAD_QUEUE_REORDER
            | app_server_protocol::protocol::v2::METHOD_THREAD_QUEUE_START
            | app_server_protocol::protocol::v2::METHOD_PROJECT_LIST
            | app_server_protocol::protocol::v2::METHOD_PROJECT_READ
            | app_server_protocol::protocol::v2::METHOD_PROJECT_CREATE
            | app_server_protocol::protocol::v2::METHOD_PROJECT_IMPORT
            | app_server_protocol::protocol::v2::METHOD_PROJECT_UPDATE
            | app_server_protocol::protocol::v2::METHOD_PROJECT_MOVE
            | app_server_protocol::protocol::v2::METHOD_PROJECT_DELETE
            | app_server_protocol::protocol::v2::METHOD_PROCESS_SPAWN
            | app_server_protocol::protocol::v2::METHOD_PROCESS_WRITE_STDIN
            | app_server_protocol::protocol::v2::METHOD_PROCESS_RESIZE_PTY
            | app_server_protocol::protocol::v2::METHOD_PROCESS_KILL
    )
}

fn experimental_api_field_reason(request: &JsonRpcRequest) -> Option<&'static str> {
    let params = request.params.as_ref()?.as_object()?;
    match request.method.as_str() {
        app_server_protocol::protocol::v2::METHOD_THREAD_START
            if params
                .get("projectId")
                .is_some_and(|value| !value.is_null()) =>
        {
            Some("thread/start.projectId")
        }
        app_server_protocol::protocol::v2::METHOD_THREAD_METADATA_UPDATE
            if params
                .get("projectId")
                .is_some_and(|value| !value.is_null()) =>
        {
            Some("thread/metadata/update.projectId")
        }
        app_server_protocol::protocol::v2::METHOD_THREAD_LIST
            if params.contains_key("projectId") =>
        {
            Some("thread/list.projectId")
        }
        _ => None,
    }
}

fn experimental_api_required_message(method: &str) -> &'static str {
    if method.starts_with("environment/") {
        "environment methods require initialize capabilities.experimentalApi"
    } else if method.starts_with("thread/queue/") {
        "thread queue methods require initialize capabilities.experimentalApi"
    } else if method.starts_with("mcpServer/event/stream/") {
        "MCP event stream methods require initialize capabilities.experimentalApi"
    } else if method.starts_with("process/") {
        "process methods require initialize capabilities.experimentalApi"
    } else {
        "experimental method requires initialize capabilities.experimentalApi"
    }
}

fn notification_requires_experimental_api(message: &JsonRpcMessage) -> bool {
    let JsonRpcMessage::Notification(notification) = message else {
        return false;
    };
    matches!(
        notification.method.as_str(),
        app_server_protocol::protocol::v2::METHOD_THREAD_QUEUE_CHANGED
            | app_server_protocol::protocol::v2::METHOD_PROJECT_CHANGED
            | app_server_protocol::protocol::v2::METHOD_THREAD_PROJECT_UPDATED
            | app_server_protocol::protocol::v2::METHOD_THREAD_ENVIRONMENT_CONNECTED
            | app_server_protocol::protocol::v2::METHOD_THREAD_ENVIRONMENT_DISCONNECTED
            | app_server_protocol::protocol::v2::METHOD_THREAD_SETTINGS_UPDATED
            | app_server_protocol::protocol::v2::METHOD_STRICT_REVIEW_REQUIRED
            | app_server_protocol::protocol::v2::METHOD_PROCESS_OUTPUT_DELTA
            | app_server_protocol::protocol::v2::METHOD_PROCESS_EXITED
            | app_server_protocol::protocol::v2::METHOD_MCP_SERVER_EVENT_STREAM_NOTIFICATION
            | app_server_protocol::protocol::v2::METHOD_TURN_MODERATION_METADATA
    )
}

fn thread_resume_request_context(message: &JsonRpcMessage) -> Option<(String, RequestId)> {
    let JsonRpcMessage::Request(request) = message else {
        return None;
    };
    if request.method != app_server_protocol::protocol::v2::METHOD_THREAD_RESUME {
        return None;
    }
    let params = serde_json::from_value::<app_server_protocol::protocol::v2::ThreadResumeParams>(
        request.params.as_ref()?.clone(),
    )
    .ok()?;
    let thread_id = params.thread_id.trim();
    if thread_id.is_empty() {
        return None;
    }
    Some((thread_id.to_string(), request.id.clone()))
}

fn thread_goal_mutation_thread_id(message: &JsonRpcMessage) -> Option<String> {
    let JsonRpcMessage::Request(request) = message else {
        return None;
    };
    if request.method != app_server_protocol::protocol::v2::METHOD_THREAD_GOAL_SET
        && request.method != app_server_protocol::protocol::v2::METHOD_THREAD_GOAL_CLEAR
    {
        return None;
    }
    request
        .params
        .as_ref()?
        .get("threadId")?
        .as_str()
        .map(str::trim)
        .filter(|thread_id| !thread_id.is_empty())
        .map(str::to_string)
}

fn take_thread_goal_notification(
    messages: &mut Vec<JsonRpcMessage>,
    thread_id: &str,
) -> Option<JsonRpcNotification> {
    let index = messages.iter().position(|message| {
        let JsonRpcMessage::Notification(notification) = message else {
            return false;
        };
        let is_goal_notification = notification.method
            == app_server_protocol::protocol::v2::METHOD_THREAD_GOAL_UPDATED
            || notification.method == app_server_protocol::protocol::v2::METHOD_THREAD_GOAL_CLEARED;
        is_goal_notification
            && notification
                .params
                .as_ref()
                .and_then(|params| params.get("threadId"))
                .and_then(serde_json::Value::as_str)
                == Some(thread_id)
    })?;
    let JsonRpcMessage::Notification(notification) = messages.remove(index) else {
        unreachable!("goal notification position must contain a notification");
    };
    Some(notification)
}

fn take_thread_deleted_notifications(
    messages: &mut Vec<JsonRpcMessage>,
) -> Vec<(String, JsonRpcNotification)> {
    let mut retained = Vec::with_capacity(messages.len());
    let mut deleted = Vec::new();
    for message in std::mem::take(messages) {
        let JsonRpcMessage::Notification(notification) = &message else {
            retained.push(message);
            continue;
        };
        let Ok(app_server_protocol::protocol::v2::ServerNotification::ThreadDeleted(params)) =
            app_server_protocol::protocol::v2::ServerNotification::try_from(notification.clone())
        else {
            retained.push(message);
            continue;
        };
        deleted.push((params.thread_id, notification.clone()));
    }
    *messages = retained;
    deleted
}

async fn publish_thread_delete_transport_result(
    server: &AppServer,
    origin_connection_id: ConnectionId,
    messages: &mut Vec<JsonRpcMessage>,
) -> bool {
    let deleted = take_thread_deleted_notifications(messages);
    if deleted.is_empty() {
        return false;
    }

    let bridge = server.event_bridge();
    if let Err(error) = bridge
        .send_messages_to_connection(origin_connection_id, messages)
        .await
    {
        tracing::warn!(
            %origin_connection_id,
            %error,
            "failed to send thread/delete response"
        );
    }

    let deleted_thread_ids = deleted
        .iter()
        .map(|(thread_id, _)| thread_id.clone())
        .collect::<Vec<_>>();
    server
        .server_requests
        .abort_for_threads(&bridge, &deleted_thread_ids, "thread deleted")
        .await;

    for (thread_id, notification) in deleted {
        let canonical_thread_id = agent_protocol::ThreadId::new(&thread_id);
        let (completion_tx, completion_rx) = oneshot::channel();
        let publish_result = match bridge
            .send_thread_command(
                canonical_thread_id.clone(),
                thread_state::ThreadListenerCommand::PublishNotification {
                    notification,
                    origin_connection_id: Some(origin_connection_id),
                    completion_tx: Some(completion_tx),
                },
            )
            .await
        {
            Ok(()) => completion_rx
                .await
                .map_err(|error| error.to_string())
                .and_then(|result| result),
            Err(error) => Err(error),
        };
        if let Err(error) = publish_result {
            tracing::warn!(
                %origin_connection_id,
                %thread_id,
                %error,
                "failed to publish thread/deleted notification"
            );
        }
        server
            .thread_states
            .remove_thread(&canonical_thread_id)
            .await;
        server
            .processor
            .close_mcp_event_streams_for_thread(canonical_thread_id.as_str())
            .await;
    }
    true
}

fn spawn_transport_request(
    server: AppServer,
    connection_id: ConnectionId,
    message: JsonRpcMessage,
    streamed_tx: mpsc::UnboundedSender<StreamedTransportMessage>,
    prepared_resume: Option<(String, thread_state::ThreadResumeBarrier)>,
) {
    tokio::spawn(async move {
        let process_spawn_handle = process_spawn_handle(&message);
        let is_thread_delete = matches!(
            &message,
            JsonRpcMessage::Request(request)
                if request.method == app_server_protocol::protocol::v2::METHOD_THREAD_DELETE
        );
        let thread_unsubscribe_id = match &message {
            JsonRpcMessage::Request(request)
                if request.method
                    == app_server_protocol::protocol::v2::METHOD_THREAD_UNSUBSCRIBE =>
            {
                request
                    .params
                    .as_ref()
                    .and_then(|params| params.get("threadId"))
                    .and_then(serde_json::Value::as_str)
                    .map(agent_protocol::ThreadId::new)
            }
            _ => None,
        };
        let goal_mutation_thread_id = thread_goal_mutation_thread_id(&message);
        let subscription_method = match &message {
            JsonRpcMessage::Request(request)
                if request.method == METHOD_THREAD_START
                    || request.method == app_server_protocol::protocol::v2::METHOD_THREAD_FORK
                    || request.method
                        == app_server_protocol::protocol::v2::METHOD_THREAD_RESUME =>
            {
                Some(request.method.clone())
            }
            _ => None,
        };
        match server
            .handle_transport_message(connection_id, message)
            .await
        {
            Ok(mut messages) => {
                if let Some(process_handle) = process_spawn_handle {
                    let succeeded = messages
                        .iter()
                        .any(|message| matches!(message, JsonRpcMessage::Response(_)));
                    for message in messages {
                        if let Err(error) = server
                            .send_to_transport_connection(connection_id, message)
                            .await
                        {
                            server
                                .processor
                                .close_process_connection(connection_id)
                                .await;
                            server
                                .processor
                                .close_command_exec_connection(connection_id)
                                .await;
                            let _ = streamed_tx.send(Err(error));
                            return;
                        }
                    }
                    if succeeded {
                        server
                            .processor
                            .activate_process(connection_id, &process_handle)
                            .await;
                    }
                    return;
                }
                if is_thread_delete
                    && publish_thread_delete_transport_result(&server, connection_id, &mut messages)
                        .await
                {
                    return;
                }
                if let Some((thread_id, barrier)) = prepared_resume {
                    let successful_resume = response_thread_id(&messages)
                        .as_deref()
                        .is_some_and(|response_thread_id| response_thread_id == thread_id);
                    let bridge = server.event_bridge();
                    let mut goal_outbox_through_id = None;
                    if successful_resume {
                        if let Some(snapshot) = server
                            .processor
                            .runtime()
                            .thread_token_usage_snapshot(&thread_id)
                        {
                            messages.push(JsonRpcMessage::Notification(
                                thread_token_usage_notification(&thread_id, snapshot),
                            ));
                        }
                        match bridge
                            .runtime_events
                            .latest_thread_goal_update_outbox_id(&thread_id)
                        {
                            Ok(outbox_id) => goal_outbox_through_id = outbox_id,
                            Err(error) => tracing::warn!(
                                thread_id = %thread_id,
                                "failed to read ThreadGoal resume outbox watermark: {error}"
                            ),
                        }
                        match server
                            .processor
                            .thread_goal_snapshot_notification(&thread_id)
                        {
                            Ok(notification) => {
                                messages.push(JsonRpcMessage::Notification(notification));
                            }
                            Err(error) => {
                                tracing::warn!(
                                    thread_id = %thread_id,
                                    "failed to read ThreadGoal resume snapshot: {error}"
                                );
                            }
                        }
                    }
                    let (completion_tx, completion_rx) = oneshot::channel();
                    let command = thread_state::ThreadListenerCommand::CompleteResume {
                        barrier,
                        connection_id,
                        messages,
                        subscribe: successful_resume,
                        completion_tx,
                    };
                    let result = match bridge
                        .send_thread_command(agent_protocol::ThreadId::new(&thread_id), command)
                        .await
                    {
                        Ok(()) => completion_rx
                            .await
                            .map_err(|error| error.to_string())
                            .and_then(|result| result),
                        Err(error) => Err(error),
                    };
                    if result.is_ok() {
                        if let Some(outbox_id) = goal_outbox_through_id {
                            if let Err(error) = bridge
                                .runtime_events
                                .mark_thread_goal_snapshot_delivered(&thread_id, outbox_id)
                            {
                                tracing::warn!(
                                    thread_id = %thread_id,
                                    outbox_id,
                                    "ThreadGoal resume snapshot was sent but outbox acknowledgement failed: {error}"
                                );
                            }
                        }
                    }
                    if let Err(error) = result {
                        let _ = streamed_tx.send(Err(AppServerError::ThreadListener(error)));
                    }
                    return;
                }
                if let Some(thread_id) = goal_mutation_thread_id.as_deref() {
                    if let Some(notification) =
                        take_thread_goal_notification(&mut messages, thread_id)
                    {
                        let bridge = server.event_bridge();
                        if let Err(error) = bridge
                            .send_messages_to_connection(connection_id, &messages)
                            .await
                        {
                            tracing::warn!(
                                %connection_id,
                                %thread_id,
                                %error,
                                "failed to send ThreadGoal mutation response"
                            );
                        }
                        let (completion_tx, completion_rx) = oneshot::channel();
                        let command = thread_state::ThreadListenerCommand::PublishNotification {
                            notification,
                            origin_connection_id: Some(connection_id),
                            completion_tx: Some(completion_tx),
                        };
                        let publish_result = match bridge
                            .send_thread_command(agent_protocol::ThreadId::new(thread_id), command)
                            .await
                        {
                            Ok(()) => completion_rx
                                .await
                                .map_err(|error| error.to_string())
                                .and_then(|result| result),
                            Err(error) => Err(error),
                        };
                        if let Err(error) = publish_result {
                            tracing::warn!(
                                %connection_id,
                                %thread_id,
                                %error,
                                "failed to publish ThreadGoal notification"
                            );
                        } else if let Err(error) = server
                            .processor
                            .runtime()
                            .maybe_start_thread_goal_for_thread_if_idle(
                                thread_id,
                                server.processor.connection_host_context(connection_id),
                            )
                            .await
                        {
                            tracing::warn!(
                                %connection_id,
                                %thread_id,
                                %error,
                                "failed to start idle ThreadGoal after mutation notification"
                            );
                        }
                        return;
                    }
                }
                if subscription_method.is_some() {
                    if let Some(thread_id) = response_thread_id(&messages) {
                        let (completion_tx, completion_rx) = oneshot::channel();
                        let command = thread_state::ThreadListenerCommand::SubscribeAndSend {
                            connection_id,
                            messages,
                            completion_tx,
                        };
                        let bridge = server.event_bridge();
                        let result = match bridge
                            .send_thread_command(agent_protocol::ThreadId::new(thread_id), command)
                            .await
                        {
                            Ok(()) => completion_rx
                                .await
                                .map_err(|error| error.to_string())
                                .and_then(|result| result),
                            Err(error) => Err(error),
                        };
                        if let Err(error) = result {
                            let _ = streamed_tx.send(Err(AppServerError::ThreadListener(error)));
                        }
                        return;
                    }
                }
                let schedule_unload =
                    thread_unsubscribe_id.filter(|_| thread_unsubscribe_succeeded(&messages));
                for message in messages {
                    let _ = streamed_tx.send(Ok((connection_id, message)));
                }
                if let Some(thread_id) = schedule_unload {
                    server.schedule_thread_unload(thread_id);
                }
            }
            Err(error) => {
                if let Some((thread_id, barrier)) = prepared_resume {
                    let (completion_tx, completion_rx) = oneshot::channel();
                    let command = thread_state::ThreadListenerCommand::CompleteResume {
                        barrier,
                        connection_id,
                        messages: Vec::new(),
                        subscribe: false,
                        completion_tx,
                    };
                    let bridge = server.event_bridge();
                    let cleanup_result = match bridge
                        .send_thread_command(agent_protocol::ThreadId::new(thread_id), command)
                        .await
                    {
                        Ok(()) => completion_rx
                            .await
                            .map_err(|error| error.to_string())
                            .and_then(|result| result),
                        Err(error) => Err(error),
                    };
                    if let Err(cleanup_error) = cleanup_result {
                        tracing::warn!(
                            %cleanup_error,
                            "failed to release thread resume barrier after request error"
                        );
                    }
                }
                let _ = streamed_tx.send(Err(error));
            }
        }
    });
}

#[cfg(test)]
fn enqueue_transport_outbound_message(
    writers: &TransportWriters,
    disconnects: &TransportDisconnects,
    initialized: &TransportInitialized,
    notification_opt_out: &TransportNotificationOptOut,
    message: JsonRpcMessage,
) {
    let writers = writers
        .lock()
        .expect("app-server transport writer mutex poisoned")
        .iter()
        .map(|(connection_id, writer)| (*connection_id, writer.clone()))
        .collect::<Vec<_>>();
    for (connection_id, writer) in writers {
        if !initialized
            .lock()
            .expect("app-server transport initialization mutex poisoned")
            .contains(&connection_id)
        {
            continue;
        }
        if notification_is_opted_out(notification_opt_out, connection_id, &message) {
            continue;
        }
        let disconnect_sender = disconnects
            .lock()
            .expect("app-server transport disconnect mutex poisoned")
            .get(&connection_id)
            .cloned();
        let queued = QueuedOutgoingMessage::new(OutgoingMessage::from(message.clone()));
        if let Some(disconnect_sender) = disconnect_sender {
            match writer.try_send(queued) {
                Ok(()) => {}
                Err(mpsc::error::TrySendError::Full(_))
                | Err(mpsc::error::TrySendError::Closed(_)) => disconnect_sender.cancel(),
            }
        } else {
            tokio::spawn(async move {
                let _ = writer.send(queued).await;
            });
        }
    }
}

fn initialize_notification_opt_out(message: &JsonRpcMessage) -> Option<Vec<String>> {
    let JsonRpcMessage::Request(request) = message else {
        return None;
    };
    if request.method != METHOD_INITIALIZE {
        return None;
    }
    let params = request.params.as_ref()?.clone();
    serde_json::from_value::<InitializeParams>(params)
        .ok()
        .and_then(|params| params.capabilities.opt_out_notification_methods)
}

fn notification_is_opted_out(
    notification_opt_out: &TransportNotificationOptOut,
    connection_id: ConnectionId,
    message: &JsonRpcMessage,
) -> bool {
    let JsonRpcMessage::Notification(notification) = message else {
        return false;
    };
    notification_opt_out
        .lock()
        .expect("app-server transport notification opt-out mutex poisoned")
        .get(&connection_id)
        .is_some_and(|methods| methods.contains(&notification.method))
}

fn should_spawn_transport_request(message: &JsonRpcMessage) -> bool {
    matches!(
        message,
        JsonRpcMessage::Request(request)
            if request.method != METHOD_INITIALIZE
    )
}

fn process_spawn_handle(message: &JsonRpcMessage) -> Option<String> {
    let JsonRpcMessage::Request(request) = message else {
        return None;
    };
    if request.method != app_server_protocol::protocol::v2::METHOD_PROCESS_SPAWN {
        return None;
    }
    request
        .params
        .as_ref()
        .and_then(|params| params.get("processHandle"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

#[cfg(test)]
mod tests;
