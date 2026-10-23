use super::*;
use agent_runtime::session_loop::RuntimeSessionInputHandle;
use async_trait::async_trait;
use tokio_util::sync::CancellationToken;

#[async_trait]
pub trait ExecutionBackend: Send + Sync {
    fn requires_provider_selection(&self) -> bool {
        false
    }

    fn has_live_session_responses(&self) -> bool {
        false
    }

    fn set_app_data_source(
        &self,
        _app_data_source: Arc<dyn AppDataSource>,
    ) -> Result<(), RuntimeCoreError> {
        Ok(())
    }

    fn set_current_time_gateway(
        &self,
        _gateway: Arc<dyn tool_runtime::current_time::CurrentTimeGateway>,
    ) -> Result<(), RuntimeCoreError> {
        Ok(())
    }

    fn set_filesystem_gateway(
        &self,
        _gateway: Arc<dyn tool_runtime::filesystem_gateway::RuntimeFileSystemGateway>,
    ) -> Result<(), RuntimeCoreError> {
        Err(RuntimeCoreError::Backend(
            "runtime backend does not support filesystem gateway injection".to_string(),
        ))
    }

    fn effective_turn_runtime_options(
        &self,
        request: &ExecutionRequest,
        _first_sampling_turn: bool,
    ) -> Option<app_server_protocol::RuntimeOptions> {
        request.runtime_options.clone()
    }

    async fn preflight_turn(
        &self,
        _request: &ExecutionRequest,
        _first_sampling_turn: bool,
    ) -> Result<(), RuntimeCoreError> {
        Ok(())
    }

    async fn preflight_thread_settings(
        &self,
        _session: &AgentSession,
        _settings: &app_server_protocol::protocol::v2::ThreadSettings,
    ) -> Result<(), RuntimeCoreError> {
        Ok(())
    }

    async fn prepare_turn_runtime_options(
        &self,
        request: &ExecutionRequest,
        first_sampling_turn: bool,
    ) -> Result<Option<RuntimeOptions>, RuntimeCoreError> {
        self.preflight_turn(request, first_sampling_turn).await?;
        Ok(request.runtime_options.clone())
    }

    async fn start_turn(
        &self,
        request: ExecutionRequest,
        sink: &mut dyn RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError>;

    async fn run_memory_stage1(
        &self,
        _root: app_server_protocol::MemoryStoreRootParams,
        _version: crate::MemoryStageOneVersion,
        _route: crate::MemoryStageOneRoute,
        _data_source: Arc<dyn AppDataSource>,
        _source_policy: &dyn crate::memory_store::MemorySourcePolicy,
    ) -> Result<crate::MemoryStageOneRunResult, RuntimeCoreError> {
        Err(RuntimeCoreError::Backend(
            "runtime backend does not support memory stage-1".to_string(),
        ))
    }

    /// Resolve the current session route before a background memory sampling job.
    ///
    /// Memory must use the same provider/model/protocol/readiness decision as a normal
    /// Turn. Backends without a live provider intentionally fail closed here.
    async fn resolve_memory_stage1_route(
        &self,
        _session: &AgentSession,
    ) -> Result<crate::MemoryStageOneRoute, RuntimeCoreError> {
        Err(RuntimeCoreError::Backend(
            "runtime backend does not resolve memory stage-1 routes".to_string(),
        ))
    }

    async fn compact_context(
        &self,
        _request: ExecutionRequest,
        _history: ProviderTurnHistory,
        _cancellation: CancellationToken,
    ) -> Result<String, RuntimeCoreError> {
        Err(RuntimeCoreError::Backend(
            "runtime backend does not support model context compaction".to_string(),
        ))
    }

    async fn start_turn_with_provider_history(
        &self,
        request: ExecutionRequest,
        _provider_history: ProviderTurnHistory,
        sink: &mut dyn RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError> {
        self.start_turn(request, sink).await
    }

    async fn start_turn_with_provider_history_and_session_input(
        &self,
        request: ExecutionRequest,
        provider_history: ProviderTurnHistory,
        _pending_input: Option<RuntimeSessionInputHandle>,
        _cancellation_token: Option<CancellationToken>,
        sink: &mut dyn RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError> {
        self.start_turn_with_provider_history(request, provider_history, sink)
            .await
    }

    /// Run turn-scoped Interrupt hooks after the session actor has cancelled
    /// the active task. Implementations that own the Codex-compatible runtime
    /// may emit hook lifecycle events through the same sink used by the turn.
    async fn run_interrupt_hooks(
        &self,
        _request: ExecutionRequest,
        _sink: &mut dyn RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError> {
        Ok(())
    }

    async fn cancel_turn(
        &self,
        request: CancelExecutionRequest,
        sink: &mut dyn RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError>;

    /// Drain owned local resources before the canonical Turn terminal is published.
    async fn drain_turn(&self, _request: &CancelExecutionRequest) -> Result<(), RuntimeCoreError> {
        Ok(())
    }

    /// Release every session-owned process, including Commands from completed Turns.
    /// The caller retains the canonical event target until this drain has completed.
    async fn close_session(
        &self,
        _session_id: &str,
        _thread_id: &str,
    ) -> Result<(), RuntimeCoreError> {
        Ok(())
    }

    async fn invalidate_mcp_runtimes(&self) {}

    async fn respond_action(
        &self,
        request: ActionRespondRequest,
        sink: &mut dyn RuntimeEventSink,
    ) -> Result<(), RuntimeCoreError>;

    async fn resolve_permission_action(
        &self,
        _request: &PermissionRespondRequest,
    ) -> Result<(), RuntimeCoreError> {
        Err(RuntimeCoreError::Backend(
            "runtime backend does not support permission responses".to_string(),
        ))
    }

    async fn read_tool_inventory(
        &self,
        _request: ToolInventoryReadRequest,
    ) -> Result<serde_json::Value, RuntimeCoreError> {
        Err(RuntimeCoreError::Backend(
            "runtime backend does not expose tool inventory".to_string(),
        ))
    }

    async fn read_mcp_runtime_resource(
        &self,
        _session_id: &str,
        _thread_id: &str,
        _server: &str,
        _uri: &str,
        _meta: Option<serde_json::Value>,
    ) -> Result<app_server_protocol::protocol::v2::McpServerResourceReadResponse, RuntimeCoreError>
    {
        Err(RuntimeCoreError::Backend(
            "runtime backend does not expose MCP resources".to_string(),
        ))
    }

    async fn read_mcp_runtime_resource_for_origin(
        &self,
        _session_id: &str,
        _thread_id: &str,
        _server: &str,
        _origin: &lime_mcp::McpResourceOrigin,
    ) -> Result<app_server_protocol::protocol::v2::McpServerResourceReadResponse, RuntimeCoreError>
    {
        Err(RuntimeCoreError::Backend(
            "runtime backend does not expose origin-scoped MCP resources".to_string(),
        ))
    }

    async fn call_mcp_runtime_tool(
        &self,
        _session_id: &str,
        _thread_id: &str,
        _server: &str,
        _tool: &str,
        _arguments: serde_json::Value,
    ) -> Result<lime_mcp::McpToolResult, RuntimeCoreError> {
        Err(RuntimeCoreError::Backend(
            "runtime backend does not execute MCP tools".to_string(),
        ))
    }

    async fn subscribe_mcp_runtime_events(
        &self,
        _session_id: &str,
        _thread_id: &str,
    ) -> Result<tokio::sync::broadcast::Receiver<lime_mcp::McpServerNotification>, RuntimeCoreError>
    {
        Err(RuntimeCoreError::Backend(
            "runtime backend does not expose MCP event streams".to_string(),
        ))
    }

    async fn open_mcp_runtime_event_stream(
        &self,
        _session_id: &str,
        _thread_id: &str,
        _server: &str,
        _name: &str,
        _arguments: serde_json::Value,
        _meta: Option<serde_json::Value>,
    ) -> Result<lime_mcp::McpEventStream, RuntimeCoreError> {
        Err(RuntimeCoreError::Backend(
            "runtime backend does not open MCP event streams".to_string(),
        ))
    }

    async fn has_mcp_runtime_server(
        &self,
        _session_id: &str,
        _thread_id: &str,
        _server: &str,
    ) -> Result<bool, RuntimeCoreError> {
        Ok(false)
    }
}
