//! Connection-local handshake, client identity and cancellation state.

use super::{parse_params, serialize_result, RequestProcessor};
use crate::RuntimeHostContext;
use app_server_protocol::{
    error_codes, ClientInfo, ClientNotification, InitializeParams, InitializeResponse,
    JsonRpcError, JsonRpcNotification, PlatformInfo, RequestId, ServerCapabilities, ServerInfo,
    METHOD_CANCEL_REQUEST, PROTOCOL_VERSION, SERVER_NAME,
};
use app_server_transport::ConnectionId;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
pub(super) struct ClientContext {
    state: Arc<Mutex<ClientState>>,
}

#[derive(Default)]
struct ClientState {
    initialize_accepted: bool,
    initialized: bool,
    experimental_api: bool,
    client_info: Option<ClientInfo>,
    canceled_request_ids: HashSet<RequestId>,
}

impl ClientContext {
    fn client_info(&self) -> Option<ClientInfo> {
        self.state
            .lock()
            .expect("app-server client state mutex poisoned")
            .client_info
            .clone()
    }
}

impl RequestProcessor {
    pub(super) fn for_connection(&self, connection_id: ConnectionId, initialize: bool) -> Self {
        let mut contexts = self
            .connection_contexts
            .lock()
            .expect("app-server client contexts mutex poisoned");
        let client_context = if initialize {
            contexts.entry(connection_id).or_default().clone()
        } else {
            contexts.get(&connection_id).cloned().unwrap_or_default()
        };
        drop(contexts);
        Self {
            client_context,
            ..self.clone()
        }
    }

    pub(crate) fn close_client_connection(&self, connection_id: ConnectionId) {
        self.connection_contexts
            .lock()
            .expect("app-server client contexts mutex poisoned")
            .remove(&connection_id);
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            let processor = self.clone();
            handle.spawn(async move {
                processor.request_worktree_cleanup().await;
            });
        }
    }

    pub(crate) fn clear_client_connections(&self) {
        self.connection_contexts
            .lock()
            .expect("app-server client contexts mutex poisoned")
            .clear();
    }

    pub(crate) fn connection_host_context(
        &self,
        connection_id: ConnectionId,
    ) -> RuntimeHostContext {
        let context = self
            .connection_contexts
            .lock()
            .expect("app-server client contexts mutex poisoned")
            .get(&connection_id)
            .cloned();
        RuntimeHostContext::from(context.and_then(|context| context.client_info()))
    }

    pub(crate) fn handle_transport_notification(
        &self,
        connection_id: ConnectionId,
        notification: JsonRpcNotification,
    ) {
        self.for_connection(connection_id, false)
            .handle_notification(notification);
    }

    pub fn handle_notification(&self, notification: JsonRpcNotification) {
        if notification.method == METHOD_CANCEL_REQUEST {
            if let Some(request_id) = read_cancel_request_id(notification.params.as_ref()) {
                self.client_context
                    .state
                    .lock()
                    .expect("app-server client state mutex poisoned")
                    .canceled_request_ids
                    .insert(request_id);
            }
            return;
        }
        if ClientNotification::try_from(notification) != Ok(ClientNotification::Initialized) {
            return;
        }
        let mut state = self
            .client_context
            .state
            .lock()
            .expect("app-server client state mutex poisoned");
        if state.initialize_accepted {
            state.initialized = true;
        }
    }

    pub(super) fn is_request_canceled(&self, request_id: &RequestId) -> bool {
        self.client_context
            .state
            .lock()
            .expect("app-server client state mutex poisoned")
            .canceled_request_ids
            .contains(request_id)
    }

    pub(super) fn clear_request_cancel_state(&self, request_id: &RequestId) {
        self.client_context
            .state
            .lock()
            .expect("app-server client state mutex poisoned")
            .canceled_request_ids
            .remove(request_id);
    }

    pub(super) fn initialize(
        &self,
        params: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, JsonRpcError> {
        reject_unsupported_initialize_capabilities(params.as_ref())?;
        let params: InitializeParams = parse_params(params)?;
        crate::agent_ui_event_schema::warm_validators().map_err(|error| {
            JsonRpcError::new(
                error_codes::RUNTIME_ERROR,
                format!("failed to initialize Agent UI event schemas: {error}"),
            )
        })?;
        let mut state = self
            .client_context
            .state
            .lock()
            .expect("app-server client state mutex poisoned");
        if state.initialize_accepted {
            return Err(JsonRpcError::new(
                error_codes::ALREADY_INITIALIZED,
                "initialize has already been accepted",
            ));
        }
        state.initialize_accepted = true;
        state.experimental_api = params.capabilities.experimental_api;
        state.client_info = Some(params.client_info);
        serialize_result(InitializeResponse {
            server_info: ServerInfo {
                name: SERVER_NAME.to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
                protocol_version: PROTOCOL_VERSION.to_string(),
            },
            platform: PlatformInfo {
                family: "desktop".to_string(),
                os: std::env::consts::OS.to_string(),
            },
            capabilities: ServerCapabilities {
                agent_session: true,
                capability_discovery: true,
                artifact: true,
                workspace: false,
            },
        })
    }

    pub(super) fn ensure_initialized(&self) -> Result<(), JsonRpcError> {
        if !self
            .client_context
            .state
            .lock()
            .expect("app-server client state mutex poisoned")
            .initialized
        {
            return Err(JsonRpcError::new(
                error_codes::NOT_INITIALIZED,
                "initialize and initialized must complete before business methods",
            ));
        }
        Ok(())
    }

    pub(super) fn client_info(&self) -> Option<ClientInfo> {
        self.client_context.client_info()
    }

    pub(super) fn ensure_experimental_api(&self, method: &str) -> Result<(), JsonRpcError> {
        if !self
            .client_context
            .state
            .lock()
            .expect("app-server client state mutex poisoned")
            .experimental_api
        {
            return Err(JsonRpcError::new(
                error_codes::INVALID_REQUEST,
                format!("{method} requires experimentalApi capability"),
            ));
        }
        Ok(())
    }

    pub(crate) fn runtime_host_context(&self) -> RuntimeHostContext {
        RuntimeHostContext::from(self.client_info())
    }
}

fn read_cancel_request_id(params: Option<&serde_json::Value>) -> Option<RequestId> {
    match params?.get("id")? {
        serde_json::Value::Number(value) => value.as_i64().map(RequestId::Integer),
        serde_json::Value::String(value) => Some(RequestId::String(value.clone())),
        _ => None,
    }
}

fn reject_unsupported_initialize_capabilities(
    params: Option<&serde_json::Value>,
) -> Result<(), JsonRpcError> {
    let Some(capabilities) = params
        .and_then(serde_json::Value::as_object)
        .and_then(|params| params.get("capabilities"))
        .and_then(serde_json::Value::as_object)
    else {
        return Ok(());
    };
    let Some(request_attestation) = capabilities.get("requestAttestation") else {
        return Ok(());
    };
    let Some(request_attestation) = request_attestation.as_bool() else {
        return Err(JsonRpcError::new(
            error_codes::INVALID_PARAMS,
            "capabilities.requestAttestation must be a boolean",
        ));
    };
    if request_attestation {
        return Err(JsonRpcError::new(
            error_codes::INVALID_PARAMS,
            "capabilities.requestAttestation is unsupported: Lime has no Codex Desktop Host attestation producer",
        ));
    }
    Ok(())
}
