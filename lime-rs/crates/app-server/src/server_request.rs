use app_server_protocol::error_codes;
use app_server_protocol::protocol::v2::{ServerNotification, ServerRequestResolvedNotification};
use app_server_protocol::JsonRpcError;
use app_server_protocol::JsonRpcRequest;
use app_server_protocol::RequestId;
use app_server_transport::ConnectionId;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::AtomicU64;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::sync::Mutex;
use thiserror::Error;
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::AppServer;
use crate::AppServerError;
use crate::JsonRpcMessage;

mod resolution;
pub(crate) use resolution::ResolvedServerRequest;

const SERVER_REQUEST_ID_PREFIX: &str = "app-server-request";

pub(crate) type ServerRequestResult = Result<Value, JsonRpcError>;

struct ServerRequestResolution {
    pub(crate) owner: Option<ServerRequestOwner>,
    pub(crate) result: ServerRequestResult,
    pub(crate) resolved_in_listener: bool,
    pub(crate) turn_transition: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ServerRequestOwner {
    #[cfg(test)]
    Subscriber,
    Transport(ConnectionId),
}

struct PendingRoute {
    owners: Vec<ServerRequestOwner>,
    request: JsonRpcRequest,
    thread_id: Option<String>,
    turn_id: Option<String>,
    request_order: u64,
    sender: oneshot::Sender<ServerRequestResolution>,
}

impl PendingRoute {
    fn follows_thread_subscribers(&self) -> bool {
        self.thread_id.is_some()
            && !matches!(
                self.request.method.as_str(),
                app_server_protocol::protocol::v2::METHOD_ITEM_TOOL_CALL
                    | app_server_protocol::protocol::v2::METHOD_CURRENT_TIME_READ
                    | app_server_protocol::protocol::v2::METHOD_ACCOUNT_AUTHORIZE
                    | app_server_protocol::protocol::v2::METHOD_CONNECTION_AUTHORIZE
            )
    }

    fn current_owner(&self) -> Option<ServerRequestOwner> {
        self.owners.last().copied()
    }

    fn has_owner(&self, owner: ServerRequestOwner) -> bool {
        self.owners.contains(&owner)
    }

    fn add_owner(&mut self, owner: ServerRequestOwner) -> bool {
        if self.has_owner(owner) {
            return false;
        }
        self.owners.push(owner);
        true
    }

    fn remove_owner(&mut self, owner: ServerRequestOwner) {
        self.owners.retain(|candidate| *candidate != owner);
    }
}

#[derive(Clone, Default)]
pub(crate) struct ServerRequestRouter {
    inner: Arc<ServerRequestRouterInner>,
}

struct ServerRequestRouterInner {
    boot_nonce: Uuid,
    next_request_id: AtomicU64,
    pending: Mutex<HashMap<RequestId, PendingRoute>>,
}

pub(crate) struct PendingServerRequest {
    id: RequestId,
    request: JsonRpcRequest,
    receiver: oneshot::Receiver<ServerRequestResolution>,
    router: ServerRequestRouter,
}

pub(crate) struct ServerRequestTerminal {
    pub(crate) owner: Option<ServerRequestOwner>,
    pub(crate) resolved_in_listener: bool,
    pub(crate) turn_transition: bool,
    pub(crate) result: Result<Value, ServerRequestError>,
}

#[derive(Debug, Error)]
pub enum ServerRequestError {
    #[error("no App Server client is available for server request")]
    ClientUnavailable,
    #[error("server request has {client_count} possible App Server clients")]
    ClientAmbiguous { client_count: usize },
    #[error("server request response came from the wrong App Server client: {id}")]
    ClientMismatch { id: RequestId },
    #[error("App Server client rejected server request {id}: {error:?}")]
    ClientRejected { id: RequestId, error: JsonRpcError },
    #[error("server request response channel closed for {id}")]
    ResponseChannelClosed { id: RequestId },
    #[error("server request response does not match a pending request: {id}")]
    RequestNotFound { id: RequestId },
}

impl Default for ServerRequestRouterInner {
    fn default() -> Self {
        Self {
            boot_nonce: Uuid::new_v4(),
            next_request_id: AtomicU64::new(0),
            pending: Mutex::new(HashMap::new()),
        }
    }
}

impl ServerRequestRouter {
    #[cfg(test)]
    pub(crate) fn register(
        &self,
        method: impl Into<String>,
        params: Option<Value>,
    ) -> PendingServerRequest {
        self.register_for_owner(ServerRequestOwner::Subscriber, method, params)
    }

    pub(crate) fn register_for_owner(
        &self,
        owner: ServerRequestOwner,
        method: impl Into<String>,
        params: Option<Value>,
    ) -> PendingServerRequest {
        self.register_for_owners(vec![owner], method, params)
    }

    pub(crate) fn register_for_owners(
        &self,
        owners: Vec<ServerRequestOwner>,
        method: impl Into<String>,
        params: Option<Value>,
    ) -> PendingServerRequest {
        let request_order = self.inner.next_request_id.fetch_add(1, Ordering::Relaxed);
        let id = RequestId::String(format!(
            "{SERVER_REQUEST_ID_PREFIX}:{}:{}",
            self.inner.boot_nonce, request_order
        ));
        let request = JsonRpcRequest::new(id.clone(), method, params);
        let thread_id = request_scope_id(&request, "threadId");
        let turn_id = request_scope_id(&request, "turnId");
        let (sender, receiver) = oneshot::channel();
        let replaced = self
            .inner
            .pending
            .lock()
            .expect("server request router mutex poisoned")
            .insert(
                id.clone(),
                PendingRoute {
                    owners,
                    request: request.clone(),
                    thread_id,
                    turn_id,
                    request_order,
                    sender,
                },
            );
        debug_assert!(replaced.is_none(), "generated server request id collided");
        PendingServerRequest {
            id,
            request,
            receiver,
            router: self.clone(),
        }
    }

    #[cfg(test)]
    fn with_boot_nonce(boot_nonce: Uuid) -> Self {
        Self {
            inner: Arc::new(ServerRequestRouterInner {
                boot_nonce,
                next_request_id: AtomicU64::new(0),
                pending: Mutex::new(HashMap::new()),
            }),
        }
    }

    #[cfg(test)]
    pub(crate) fn resolve_response(
        &self,
        id: RequestId,
        result: Value,
    ) -> Result<(), ServerRequestError> {
        self.resolve(ServerRequestOwner::Subscriber, id, Ok(result))
    }

    #[cfg(test)]
    pub(crate) fn resolve_transport_response(
        &self,
        connection_id: ConnectionId,
        id: RequestId,
        result: Value,
    ) -> Result<(), ServerRequestError> {
        self.resolve(ServerRequestOwner::Transport(connection_id), id, Ok(result))
    }

    #[cfg(test)]
    pub(crate) fn resolve_error(
        &self,
        id: RequestId,
        error: JsonRpcError,
    ) -> Result<(), ServerRequestError> {
        self.resolve(ServerRequestOwner::Subscriber, id, Err(error))
    }

    pub(crate) fn cancel_all(&self, reason: impl Into<String>) -> usize {
        let error = JsonRpcError::new(error_codes::REQUEST_CANCELLED, reason);
        let pending = self
            .inner
            .pending
            .lock()
            .expect("server request router mutex poisoned")
            .drain()
            .collect::<Vec<_>>();
        let count = pending.len();
        for (_, route) in pending {
            let owner = route.current_owner();
            let _ = route.sender.send(ServerRequestResolution {
                owner,
                result: Err(error.clone()),
                resolved_in_listener: false,
                turn_transition: true,
            });
        }
        count
    }

    pub(crate) fn cancel_owner(
        &self,
        owner: ServerRequestOwner,
        reason: impl Into<String>,
    ) -> usize {
        let error = JsonRpcError::new(error_codes::REQUEST_CANCELLED, reason);
        let mut pending = self
            .inner
            .pending
            .lock()
            .expect("server request router mutex poisoned");
        let request_ids = pending
            .iter()
            .filter_map(|(request_id, route)| {
                (route.has_owner(owner) && !route.follows_thread_subscribers())
                    .then_some(request_id.clone())
            })
            .collect::<Vec<_>>();
        for route in pending.values_mut() {
            if route.follows_thread_subscribers() {
                route.remove_owner(owner);
            }
        }
        let routes = request_ids
            .iter()
            .filter_map(|request_id| pending.remove(request_id))
            .collect::<Vec<_>>();
        drop(pending);
        let count = routes.len();
        for route in routes {
            let owner = route.current_owner();
            let _ = route.sender.send(ServerRequestResolution {
                owner,
                result: Err(error.clone()),
                resolved_in_listener: false,
                turn_transition: false,
            });
        }
        count
    }

    pub(crate) async fn abort_for_thread_turn(
        &self,
        bridge: &crate::AppServerEventBridge,
        thread_id: &str,
        turn_id: &str,
        reason: impl Into<String>,
    ) -> usize {
        let error = JsonRpcError::new(error_codes::REQUEST_CANCELLED, reason);
        let routes = self.take_matching_routes(|route| {
            route.thread_id.as_deref() == Some(thread_id)
                && route.turn_id.as_deref() == Some(turn_id)
        });

        let count = routes.len();
        for route in routes {
            let owner = route.current_owner();
            if let Err(error) =
                publish_server_request_resolved(bridge, thread_id, route.request.id.clone(), owner)
                    .await
            {
                tracing::warn!(
                    %thread_id,
                    %turn_id,
                    request_id = %route.request.id,
                    %error,
                    "failed to publish server-request resolution before turn transition"
                );
            }
            let _ = route.sender.send(ServerRequestResolution {
                owner,
                result: Err(error.clone()),
                resolved_in_listener: true,
                turn_transition: true,
            });
        }
        count
    }

    pub(crate) async fn abort_for_threads(
        &self,
        bridge: &crate::AppServerEventBridge,
        thread_ids: &[String],
        reason: impl Into<String>,
    ) -> usize {
        let error = JsonRpcError::new(error_codes::REQUEST_CANCELLED, reason);
        let routes = self.take_matching_routes(|route| {
            route
                .thread_id
                .as_ref()
                .is_some_and(|thread_id| thread_ids.contains(thread_id))
        });

        let count = routes.len();
        for route in routes {
            let owner = route.current_owner();
            let thread_id = route
                .thread_id
                .as_deref()
                .expect("thread delete route must have a thread id");
            if let Err(error) =
                publish_server_request_resolved(bridge, thread_id, route.request.id.clone(), owner)
                    .await
            {
                tracing::warn!(
                    %thread_id,
                    request_id = %route.request.id,
                    %error,
                    "failed to publish server-request resolution before thread delete"
                );
            }
            let _ = route.sender.send(ServerRequestResolution {
                owner,
                result: Err(error.clone()),
                resolved_in_listener: true,
                turn_transition: true,
            });
        }
        count
    }

    pub(crate) fn claim_owner_thread(
        &self,
        owner: ServerRequestOwner,
        thread_id: &str,
    ) -> Vec<JsonRpcRequest> {
        let mut pending = self
            .inner
            .pending
            .lock()
            .expect("server request router mutex poisoned");
        let mut requests = pending
            .values_mut()
            .filter_map(|route| {
                (route.follows_thread_subscribers()
                    && route.thread_id.as_deref() == Some(thread_id)
                    && route.add_owner(owner))
                .then(|| (route.request_order, route.request.clone()))
            })
            .collect::<Vec<_>>();
        drop(pending);
        requests.sort_by_key(|(request_order, _)| *request_order);
        requests.into_iter().map(|(_, request)| request).collect()
    }

    pub(crate) fn remove_request_owner(&self, id: &RequestId, owner: ServerRequestOwner) {
        if let Some(route) = self
            .inner
            .pending
            .lock()
            .expect("server request router mutex poisoned")
            .get_mut(id)
        {
            route.remove_owner(owner);
        }
    }

    pub(crate) fn claim_request_owner(&self, id: &RequestId, owner: ServerRequestOwner) -> bool {
        self.inner
            .pending
            .lock()
            .expect("server request router mutex poisoned")
            .get_mut(id)
            .is_some_and(|route| route.add_owner(owner))
    }

    pub(crate) fn current_owner(&self, id: &RequestId) -> Option<ServerRequestOwner> {
        self.inner
            .pending
            .lock()
            .expect("server request router mutex poisoned")
            .get(id)
            .and_then(PendingRoute::current_owner)
    }

    pub(crate) fn snapshot_for_owner_thread(
        &self,
        owner: ServerRequestOwner,
        thread_id: &str,
    ) -> Vec<JsonRpcRequest> {
        let pending = self
            .inner
            .pending
            .lock()
            .expect("server request router mutex poisoned");
        let mut requests = pending
            .values()
            .filter_map(|route| {
                (route.follows_thread_subscribers()
                    && route.has_owner(owner)
                    && route.thread_id.as_deref() == Some(thread_id))
                .then_some((route.request_order, route.request.clone()))
            })
            .collect::<Vec<_>>();
        drop(pending);
        requests.sort_by_key(|(request_order, _)| *request_order);
        requests.into_iter().map(|(_, request)| request).collect()
    }

    fn resolve(
        &self,
        owner: ServerRequestOwner,
        id: RequestId,
        resolution: ServerRequestResult,
    ) -> Result<(), ServerRequestError> {
        self.take_response(owner, id, resolution)?.complete(false)
    }

    fn take_matching_routes(
        &self,
        mut matches: impl FnMut(&PendingRoute) -> bool,
    ) -> Vec<PendingRoute> {
        let mut pending = self
            .inner
            .pending
            .lock()
            .expect("server request router mutex poisoned");
        let request_ids = pending
            .iter()
            .filter_map(|(request_id, route)| matches(route).then_some(request_id.clone()))
            .collect::<Vec<_>>();
        let mut routes = request_ids
            .iter()
            .filter_map(|request_id| pending.remove(request_id))
            .collect::<Vec<_>>();
        drop(pending);
        routes.sort_by_key(|route| route.request_order);
        routes
    }

    fn cancel(&self, id: &RequestId) -> Option<ServerRequestOwner> {
        self.inner
            .pending
            .lock()
            .expect("server request router mutex poisoned")
            .remove(id)
            .and_then(|route| route.current_owner())
    }

    #[cfg(test)]
    pub(crate) fn pending_count(&self) -> usize {
        self.inner
            .pending
            .lock()
            .expect("server request router mutex poisoned")
            .len()
    }
}

async fn publish_server_request_resolved(
    bridge: &crate::AppServerEventBridge,
    thread_id: &str,
    request_id: RequestId,
    owner: Option<ServerRequestOwner>,
) -> Result<(), String> {
    let Some(owner) = owner else {
        return Ok(());
    };
    let origin_connection_id = match owner {
        ServerRequestOwner::Transport(connection_id) => Some(connection_id),
        #[cfg(test)]
        ServerRequestOwner::Subscriber => None,
    };
    let notification =
        ServerNotification::ServerRequestResolved(ServerRequestResolvedNotification {
            thread_id: thread_id.to_string(),
            request_id,
        });
    let (completion_tx, completion_rx) = oneshot::channel();
    bridge
        .send_thread_command(
            agent_protocol::ThreadId::new(thread_id),
            crate::thread_state::ThreadListenerCommand::PublishNotification {
                notification: notification.into(),
                origin_connection_id,
                completion_tx: Some(completion_tx),
            },
        )
        .await?;
    completion_rx
        .await
        .map_err(|error| format!("server-request resolution completion channel closed: {error}"))?
}

fn request_scope_id(request: &JsonRpcRequest, field: &str) -> Option<String> {
    request
        .params
        .as_ref()
        .and_then(|params| params.get(field))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

impl PendingServerRequest {
    pub(crate) fn id(&self) -> &RequestId {
        &self.id
    }

    pub(crate) fn request(&self) -> &JsonRpcRequest {
        &self.request
    }

    pub(crate) async fn wait(mut self) -> Result<Value, ServerRequestError> {
        self.wait_terminal().await.result
    }

    pub(crate) async fn wait_terminal(&mut self) -> ServerRequestTerminal {
        match (&mut self.receiver).await {
            Ok(resolution) => ServerRequestTerminal {
                owner: resolution.owner,
                resolved_in_listener: resolution.resolved_in_listener,
                turn_transition: resolution.turn_transition,
                result: match resolution.result {
                    Ok(result) => Ok(result),
                    Err(error) => Err(ServerRequestError::ClientRejected {
                        id: self.id.clone(),
                        error,
                    }),
                },
            },
            Err(_) => ServerRequestTerminal {
                owner: None,
                resolved_in_listener: false,
                turn_transition: false,
                result: Err(ServerRequestError::ResponseChannelClosed {
                    id: self.id.clone(),
                }),
            },
        }
    }

    pub(crate) fn cancel_with_owner(&self) -> Option<ServerRequestOwner> {
        self.router.cancel(&self.id)
    }
}

impl AppServer {
    pub(crate) async fn begin_thread_server_request(
        &self,
        thread_id: &str,
        method: impl Into<String>,
        params: impl serde::Serialize,
    ) -> Result<PendingServerRequest, AppServerError> {
        let params = serde_json::to_value(params)?;
        if thread_id.is_empty() || params.get("threadId").and_then(Value::as_str) != Some(thread_id)
        {
            return Err(AppServerError::ThreadListener(
                "server request must match its canonical threadId".to_string(),
            ));
        }
        let (completion_tx, completion_rx) = oneshot::channel();
        self.event_bridge()
            .send_thread_command(
                agent_protocol::ThreadId::new(thread_id),
                crate::thread_state::ThreadListenerCommand::BeginServerRequest {
                    method: method.into(),
                    params,
                    completion_tx,
                },
            )
            .await
            .map_err(AppServerError::ThreadListener)?;
        completion_rx
            .await
            .map_err(|error| AppServerError::ThreadListener(error.to_string()))?
            .map_err(AppServerError::from)
    }

    pub(crate) async fn begin_server_request(
        &self,
        method: impl Into<String>,
        params: impl serde::Serialize,
    ) -> Result<PendingServerRequest, AppServerError> {
        let client = self.server_request_client()?;
        let owner = ServerRequestOwner::Transport(client.connection_id);
        let pending = self.server_requests.register_for_owner(
            owner,
            method,
            Some(serde_json::to_value(params)?),
        );
        let message = JsonRpcMessage::Request(pending.request().clone());
        self.send_to_server_request_client(client, message).await?;
        Ok(pending)
    }

    #[cfg(test)]
    pub(crate) async fn begin_test_server_request(
        &self,
        method: impl Into<String>,
        params: impl serde::Serialize,
    ) -> Result<PendingServerRequest, AppServerError> {
        let pending = self.server_requests.register_for_owner(
            ServerRequestOwner::Subscriber,
            method,
            Some(serde_json::to_value(params)?),
        );
        self.outbound_messages
            .send(JsonRpcMessage::Request(pending.request().clone()))
            .map_err(|_| ServerRequestError::ClientUnavailable)?;
        Ok(pending)
    }

    pub(crate) async fn publish_server_request_resolved(
        &self,
        thread_id: &str,
        request_id: RequestId,
        owner: Option<ServerRequestOwner>,
    ) -> Result<(), String> {
        publish_server_request_resolved(&self.event_bridge(), thread_id, request_id, owner).await
    }
}

impl Drop for PendingServerRequest {
    fn drop(&mut self) {
        self.router.cancel(&self.id);
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod thread_tests;

#[cfg(test)]
mod resolution_tests;
