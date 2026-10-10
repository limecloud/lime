//! MCP form elicitation request routing.
//!
//! Adapted from Codex `codex-rs/codex-mcp/src/elicitation.rs`
//! at `5c19155cbd93bfa099016e7487259f61669823ff` (Apache-2.0).

use crate::McpRuntimeOwner;
use rmcp::model::{CreateElicitationRequestParam, ElicitationSchema, PrimitiveSchema};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::fmt;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use thiserror::Error;
use tokio::sync::{mpsc, oneshot, OwnedMutexGuard};
use tokio_util::sync::CancellationToken;
use tool_runtime::mcp_connection::McpCallScope;

const REQUEST_BUFFER_CAPACITY: usize = 64;
const MCP_PROGRESS_TOKEN_META_KEY: &str = "progressToken";
static NEXT_PUBLIC_REQUEST_ID: AtomicU64 = AtomicU64::new(0);

/// Opaque request identity exposed outside the RMCP connection.
///
/// Raw RMCP request ids are deliberately absent from this type and from
/// [`ElicitationRequest`].
#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(transparent)]
pub struct ElicitationRequestId(String);

impl ElicitationRequestId {
    fn next() -> Self {
        Self(format!(
            "mcp-elicitation-{}",
            NEXT_PUBLIC_REQUEST_ID.fetch_add(1, Ordering::Relaxed)
        ))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for ElicitationRequestId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

/// Form request emitted to the future App Server reverse-request bridge.
#[derive(Clone, Debug)]
pub struct ElicitationRequest {
    pub id: ElicitationRequestId,
    pub server_name: String,
    pub thread_id: String,
    pub turn_id: Option<String>,
    /// Internal MCP connection provenance; never crosses the App Server wire.
    pub(crate) environment_id: Option<String>,
    pub(crate) snapshot_generation: Option<u64>,
    pub(crate) auth_scopes: Option<Vec<String>>,
    pub meta: Option<Value>,
    pub message: String,
    pub requested_schema: ElicitationSchema,
    closed: CancellationToken,
}

#[derive(Clone, Default)]
pub(crate) struct ElicitationOwnerGate {
    lease: Arc<tokio::sync::Mutex<()>>,
    owner: Arc<Mutex<Option<McpCallScope>>>,
}

impl ElicitationOwnerGate {
    pub(crate) async fn enter(&self, owner: Option<McpCallScope>) -> ElicitationOwnerGuard {
        let lease = Arc::clone(&self.lease).lock_owned().await;
        *self
            .owner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = owner;
        ElicitationOwnerGuard {
            _lease: lease,
            owner: Arc::clone(&self.owner),
        }
    }

    pub(crate) fn resolve_request_meta(
        &self,
        mut meta: rmcp::model::Meta,
    ) -> (Option<McpCallScope>, Option<Value>) {
        // Standard progressToken belongs to RMCP and must not escape into
        // product metadata. Request ownership comes from the serialized call
        // lease, not from server-propagated metadata.
        meta.remove(MCP_PROGRESS_TOKEN_META_KEY);
        let owner = self
            .owner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        (owner, public_meta(meta))
    }
}

fn public_meta(meta: rmcp::model::Meta) -> Option<Value> {
    (!meta.is_empty()).then(|| Value::Object(meta.0))
}

pub(crate) struct ElicitationOwnerGuard {
    _lease: OwnedMutexGuard<()>,
    owner: Arc<Mutex<Option<McpCallScope>>>,
}

impl Drop for ElicitationOwnerGuard {
    fn drop(&mut self) {
        *self
            .owner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
    }
}

impl ElicitationRequest {
    pub fn closed(&self) -> CancellationToken {
        self.closed.clone()
    }

    pub fn snapshot_generation(&self) -> Option<u64> {
        self.snapshot_generation
    }

    pub fn auth_scopes(&self) -> Option<&[String]> {
        self.auth_scopes.as_deref()
    }

    pub fn environment_id(&self) -> Option<&str> {
        self.environment_id.as_deref()
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ElicitationAction {
    Accept,
    Decline,
    Cancel,
}

/// A validated elicitation response, including optional result-level metadata.
#[derive(Clone, Debug, PartialEq)]
pub struct ElicitationResponse {
    action: ElicitationAction,
    content: Option<Map<String, Value>>,
    meta: Option<Map<String, Value>>,
}

impl ElicitationResponse {
    #[allow(non_upper_case_globals)]
    pub const Decline: Self = Self {
        action: ElicitationAction::Decline,
        content: None,
        meta: None,
    };

    #[allow(non_upper_case_globals)]
    pub const Cancel: Self = Self {
        action: ElicitationAction::Cancel,
        content: None,
        meta: None,
    };

    pub fn try_from_parts(
        action: ElicitationAction,
        content: Option<Value>,
    ) -> Result<Self, ElicitationRouterError> {
        Self::try_from_parts_with_meta(action, content, None)
    }

    pub fn try_from_parts_with_meta(
        action: ElicitationAction,
        content: Option<Value>,
        meta: Option<Value>,
    ) -> Result<Self, ElicitationRouterError> {
        let content = match (action, content) {
            (ElicitationAction::Accept, Some(Value::Object(content))) => Some(content),
            (ElicitationAction::Accept, _) => {
                return Err(ElicitationRouterError::AcceptContentRequired);
            }
            (ElicitationAction::Decline | ElicitationAction::Cancel, None) => None,
            (ElicitationAction::Decline | ElicitationAction::Cancel, Some(_)) => {
                return Err(ElicitationRouterError::ContentForbidden);
            }
        };
        let meta = match meta {
            Some(Value::Object(meta)) => Some(meta),
            Some(_) => return Err(ElicitationRouterError::MetaMustBeObject),
            None => None,
        };
        Ok(Self {
            action,
            content,
            meta,
        })
    }

    pub(crate) fn into_wire_parts(
        self,
    ) -> (rmcp::model::ElicitationAction, Option<Value>, Option<Value>) {
        let action = match self.action {
            ElicitationAction::Accept => rmcp::model::ElicitationAction::Accept,
            ElicitationAction::Decline => rmcp::model::ElicitationAction::Decline,
            ElicitationAction::Cancel => rmcp::model::ElicitationAction::Cancel,
        };
        (
            action,
            self.content.map(Value::Object),
            self.meta.map(Value::Object),
        )
    }

    pub fn action(&self) -> ElicitationAction {
        self.action
    }

    pub fn content_keys(&self) -> Vec<String> {
        let mut keys = self
            .content
            .as_ref()
            .map(|content| content.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        keys.sort();
        keys.dedup();
        keys
    }
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum ElicitationRouterError {
    #[error("accepted MCP elicitation requires object content")]
    AcceptContentRequired,
    #[error("declined or canceled MCP elicitation must not include content")]
    ContentForbidden,
    #[error("MCP elicitation response content is invalid: {0}")]
    InvalidContent(String),
    #[error("MCP elicitation response _meta must be an object")]
    MetaMustBeObject,
    #[error("no MCP elicitation request consumer is attached")]
    NoRequestConsumer,
    #[error("an MCP elicitation request consumer is already attached")]
    RequestConsumerAlreadyAttached,
    #[error("no MCP elicitation request router is configured")]
    NoRequestRouter,
    #[error("MCP elicitation request was canceled: {0}")]
    RequestCanceled(ElicitationRequestId),
    #[error("MCP elicitation response receiver is closed: {0}")]
    ResponseReceiverClosed(ElicitationRequestId),
    #[error("MCP elicitation request is unknown or already resolved: {0}")]
    UnknownRequest(ElicitationRequestId),
}

type Responder = oneshot::Sender<ElicitationResponse>;

/// An exact responder claimed by the sole terminal winner.
///
/// The App Server adapter publishes its outer terminal notification before
/// calling [`Self::consume`]. If that sequence cannot complete, drop sends
/// Cancel so the RMCP waiter cannot observe an accepted response without its
/// matching terminal notification.
pub struct ClaimedElicitationResolution {
    request_id: ElicitationRequestId,
    responder: Option<Responder>,
    response: ElicitationResponse,
    closed: CancellationToken,
}

impl ClaimedElicitationResolution {
    pub fn response(&self) -> &ElicitationResponse {
        &self.response
    }

    pub fn consume(mut self) -> Result<(), ElicitationRouterError> {
        self.closed.cancel();
        self.responder
            .take()
            .expect("claimed elicitation responder may only be consumed once")
            .send(self.response.clone())
            .map_err(|_| ElicitationRouterError::ResponseReceiverClosed(self.request_id.clone()))
    }
}

impl Drop for ClaimedElicitationResolution {
    fn drop(&mut self) {
        let Some(responder) = self.responder.take() else {
            return;
        };
        self.closed.cancel();
        let _ = responder.send(ElicitationResponse::Cancel);
    }
}

struct PendingRequest {
    session_id: String,
    requested_schema: ElicitationSchema,
    responder: Responder,
    closed: CancellationToken,
    forwarded: bool,
}

struct RouterState {
    pending: Mutex<HashMap<ElicitationRequestId, PendingRequest>>,
    requests: Mutex<Option<mpsc::Sender<ElicitationRequest>>>,
    deferred_cancellation: AtomicBool,
}

/// Routes opaque public ids to the exact waiter owned by an RMCP request future.
///
/// A manager shares one router across every replacement connection. An old
/// connection therefore keeps its own future while a new connection can add
/// requests without reusing or shadowing the old public id.
#[derive(Clone)]
pub struct ElicitationRequestRouter {
    state: Arc<RouterState>,
}

impl Default for ElicitationRequestRouter {
    fn default() -> Self {
        Self {
            state: Arc::new(RouterState {
                pending: Mutex::new(HashMap::new()),
                requests: Mutex::new(None),
                deferred_cancellation: AtomicBool::new(false),
            }),
        }
    }
}

impl ElicitationRequestRouter {
    pub fn subscribe(&self) -> Result<mpsc::Receiver<ElicitationRequest>, ElicitationRouterError> {
        let mut requests = lock_request_sender(&self.state);
        if requests.as_ref().is_some_and(|sender| !sender.is_closed()) {
            return Err(ElicitationRouterError::RequestConsumerAlreadyAttached);
        }
        let (sender, receiver) = mpsc::channel(REQUEST_BUFFER_CAPACITY);
        *requests = Some(sender);
        Ok(receiver)
    }

    /// Makes the single subscribed consumer responsible for closing terminal
    /// state before the RMCP responder is released. This is used by the App
    /// Server adapter; direct router consumers retain the immediate-cancel
    /// behavior used by isolated MCP tests.
    pub fn defer_cancellation_to_consumer(&self) {
        self.state
            .deferred_cancellation
            .store(true, Ordering::Release);
    }

    pub async fn resolve(
        &self,
        request_id: &ElicitationRequestId,
        response: ElicitationResponse,
    ) -> Result<(), ElicitationRouterError> {
        self.claim(request_id, response)?.consume()
    }

    pub fn claim(
        &self,
        request_id: &ElicitationRequestId,
        response: ElicitationResponse,
    ) -> Result<ClaimedElicitationResolution, ElicitationRouterError> {
        let pending = {
            let mut pending = lock_pending(&self.state);
            let request = pending
                .get(request_id)
                .ok_or_else(|| ElicitationRouterError::UnknownRequest(request_id.clone()))?;
            validate_response_content(&request.requested_schema, &response)?;
            pending
                .remove(request_id)
                .expect("validated pending elicitation must still exist")
        };

        Ok(ClaimedElicitationResolution {
            request_id: request_id.clone(),
            responder: Some(pending.responder),
            response,
            closed: pending.closed,
        })
    }

    pub fn cancel_all(&self) -> usize {
        if self.defers_cancellation_to_consumer() {
            return self.cancel_all_deferred();
        }
        let pending = {
            let mut pending = lock_pending(&self.state);
            pending.drain().collect::<Vec<_>>()
        };
        let count = pending.len();
        for (_, request) in pending {
            request.closed.cancel();
            let _ = request.responder.send(ElicitationResponse::Cancel);
        }
        count
    }

    pub fn cancel_session(&self, session_id: &str) -> usize {
        let (queued, forwarded) = {
            let mut pending = lock_pending(&self.state);
            let request_ids = pending
                .iter()
                .filter(|(_, request)| request.session_id == session_id)
                .map(|(request_id, _)| request_id.clone())
                .collect::<Vec<_>>();
            let mut queued = Vec::new();
            let mut forwarded = Vec::new();
            for request_id in request_ids {
                let request = pending
                    .get(&request_id)
                    .expect("session-owned elicitation request disappeared while locked");
                if request.forwarded {
                    forwarded.push(request.closed.clone());
                } else {
                    queued.push(
                        pending
                            .remove(&request_id)
                            .expect("queued session-owned elicitation request disappeared"),
                    );
                }
            }
            (queued, forwarded)
        };
        let count = queued.len() + forwarded.len();
        for request in queued {
            request.closed.cancel();
            let _ = request.responder.send(ElicitationResponse::Cancel);
        }
        for closed in forwarded {
            closed.cancel();
        }
        count
    }

    /// Transfers a queued request to the App Server adapter. Once forwarded,
    /// cancellation must wait for the adapter to publish the outer terminal
    /// notification before the RMCP responder is released.
    pub fn mark_forwarded(&self, request_id: &ElicitationRequestId) -> bool {
        let mut pending = lock_pending(&self.state);
        let Some(request) = pending.get_mut(request_id) else {
            return false;
        };
        request.forwarded = true;
        true
    }

    pub(crate) async fn request_with_scope(
        &self,
        server_name: String,
        runtime_owner: McpRuntimeOwner,
        scope: McpCallScope,
        params: CreateElicitationRequestParam,
        meta: Option<Value>,
        cancellation: CancellationToken,
    ) -> Result<ElicitationResponse, ElicitationRouterError> {
        let request_sender = lock_request_sender(&self.state)
            .clone()
            .ok_or(ElicitationRouterError::NoRequestConsumer)?;
        let request_id = ElicitationRequestId::next();
        let (responder, receiver) = oneshot::channel();
        let closed = CancellationToken::new();
        {
            lock_pending(&self.state).insert(
                request_id.clone(),
                PendingRequest {
                    session_id: runtime_owner.session_id.clone(),
                    requested_schema: params.requested_schema.clone(),
                    responder,
                    closed: closed.clone(),
                    forwarded: false,
                },
            );
        }
        let registration = PendingRegistration::new(&self.state, request_id.clone());
        let request = ElicitationRequest {
            id: request_id.clone(),
            server_name,
            thread_id: runtime_owner.thread_id,
            turn_id: scope.turn_id().map(ToOwned::to_owned),
            environment_id: scope.environment_id().map(ToOwned::to_owned),
            snapshot_generation: scope.snapshot_generation(),
            auth_scopes: scope.auth_scopes().map(ToOwned::to_owned),
            meta,
            message: params.message,
            requested_schema: params.requested_schema,
            closed,
        };

        tokio::select! {
            biased;
            _ = cancellation.cancelled() => {
                self.remove_unpublished_request(&request_id);
                return Err(ElicitationRouterError::RequestCanceled(request_id));
            }
            result = request_sender.send(request) => {
                if result.is_err() {
                    self.remove_unpublished_request(&request_id);
                    return Err(ElicitationRouterError::NoRequestConsumer);
                }
            }
        }

        let mut receiver = receiver;
        let result = tokio::select! {
            biased;
            response = &mut receiver => response.map_err(|_| {
                ElicitationRouterError::ResponseReceiverClosed(request_id.clone())
            }),
            _ = cancellation.cancelled() => {
                self.settle_cancellation_owned_by_consumer(
                    &request_id,
                    &mut receiver,
                    ElicitationRouterError::RequestCanceled(request_id.clone()),
                ).await
            },
            _ = request_sender.closed() => {
                self.settle_cancellation_owned_by_consumer(
                    &request_id,
                    &mut receiver,
                    ElicitationRouterError::NoRequestConsumer,
                ).await
            }
        };
        drop(registration);
        result
    }

    #[cfg(test)]
    async fn request_for_test(
        &self,
        server_name: String,
        scope: McpCallScope,
        params: CreateElicitationRequestParam,
        meta: Option<Value>,
        cancellation: CancellationToken,
    ) -> Result<ElicitationResponse, ElicitationRouterError> {
        self.request_with_scope(
            server_name,
            McpRuntimeOwner {
                session_id: "test-session".to_string(),
                thread_id: "test-thread".to_string(),
            },
            scope,
            params,
            meta,
            cancellation,
        )
        .await
    }

    #[cfg(test)]
    fn pending_count(&self) -> usize {
        lock_pending(&self.state).len()
    }

    async fn settle_cancellation_owned_by_consumer(
        &self,
        request_id: &ElicitationRequestId,
        receiver: &mut oneshot::Receiver<ElicitationResponse>,
        local_error: ElicitationRouterError,
    ) -> Result<ElicitationResponse, ElicitationRouterError> {
        if !self.defers_cancellation_to_consumer() {
            return settle_local_termination(&self.state, request_id, receiver, local_error).await;
        }
        let forwarded = {
            let mut pending = lock_pending(&self.state);
            match pending.get(request_id) {
                Some(request) if request.forwarded => {
                    request.closed.cancel();
                    true
                }
                Some(_) => {
                    let request = pending
                        .remove(request_id)
                        .expect("unforwarded elicitation request must still exist");
                    request.closed.cancel();
                    false
                }
                None => false,
            }
        };
        if !forwarded {
            return Err(local_error);
        }
        receiver
            .await
            .map_err(|_| ElicitationRouterError::ResponseReceiverClosed(request_id.clone()))?;
        Err(local_error)
    }

    fn defers_cancellation_to_consumer(&self) -> bool {
        self.state.deferred_cancellation.load(Ordering::Acquire)
    }

    fn remove_unpublished_request(&self, request_id: &ElicitationRequestId) {
        if let Some(request) = lock_pending(&self.state).remove(request_id) {
            request.closed.cancel();
        }
    }

    fn cancel_all_deferred(&self) -> usize {
        let (queued, forwarded) = {
            let mut pending = lock_pending(&self.state);
            let request_ids = pending.keys().cloned().collect::<Vec<_>>();
            let mut queued = Vec::new();
            let mut forwarded = Vec::new();
            for request_id in request_ids {
                let request = pending
                    .get(&request_id)
                    .expect("pending elicitation request disappeared while locked");
                if request.forwarded {
                    forwarded.push(request.closed.clone());
                } else {
                    queued.push(
                        pending
                            .remove(&request_id)
                            .expect("unforwarded elicitation request disappeared while locked"),
                    );
                }
            }
            (queued, forwarded)
        };
        let count = queued.len() + forwarded.len();
        for request in queued {
            request.closed.cancel();
            let _ = request.responder.send(ElicitationResponse::Cancel);
        }
        for closed in forwarded {
            closed.cancel();
        }
        count
    }
}

struct PendingRegistration {
    state: Weak<RouterState>,
    request_id: ElicitationRequestId,
}

impl PendingRegistration {
    fn new(state: &Arc<RouterState>, request_id: ElicitationRequestId) -> Self {
        Self {
            state: Arc::downgrade(state),
            request_id,
        }
    }
}

impl Drop for PendingRegistration {
    fn drop(&mut self) {
        let Some(state) = self.state.upgrade() else {
            return;
        };
        if state.deferred_cancellation.load(Ordering::Acquire) {
            let request = {
                let mut pending = lock_pending(&state);
                match pending.get(&self.request_id) {
                    Some(request) if request.forwarded => {
                        request.closed.cancel();
                        None
                    }
                    Some(_) => pending.remove(&self.request_id),
                    None => None,
                }
            };
            if let Some(request) = request {
                request.closed.cancel();
            }
            return;
        }
        if let Some(request) = lock_pending(&state).remove(&self.request_id) {
            request.closed.cancel();
        };
    }
}

fn lock_pending(
    state: &RouterState,
) -> MutexGuard<'_, HashMap<ElicitationRequestId, PendingRequest>> {
    state
        .pending
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn lock_request_sender(
    state: &RouterState,
) -> MutexGuard<'_, Option<mpsc::Sender<ElicitationRequest>>> {
    state
        .requests
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

async fn settle_local_termination(
    state: &RouterState,
    request_id: &ElicitationRequestId,
    receiver: &mut oneshot::Receiver<ElicitationResponse>,
    local_error: ElicitationRouterError,
) -> Result<ElicitationResponse, ElicitationRouterError> {
    if let Some(request) = lock_pending(state).remove(request_id) {
        request.closed.cancel();
        return Err(local_error);
    }
    receiver
        .await
        .map_err(|_| ElicitationRouterError::ResponseReceiverClosed(request_id.clone()))
}

fn validate_response_content(
    schema: &ElicitationSchema,
    response: &ElicitationResponse,
) -> Result<(), ElicitationRouterError> {
    let Some(content) = response.content.as_ref() else {
        return Ok(());
    };

    for required in schema.required.as_deref().unwrap_or_default() {
        if !content.contains_key(required) {
            return Err(ElicitationRouterError::InvalidContent(format!(
                "required field `{required}` is missing"
            )));
        }
    }

    for (name, value) in content {
        let Some(property) = schema.properties.get(name) else {
            return Err(ElicitationRouterError::InvalidContent(format!(
                "field `{name}` is not declared by the requested schema"
            )));
        };
        validate_primitive(name, property, value)?;
    }
    Ok(())
}

fn validate_primitive(
    name: &str,
    schema: &PrimitiveSchema,
    value: &Value,
) -> Result<(), ElicitationRouterError> {
    let valid = match schema {
        PrimitiveSchema::String(schema) => value.as_str().is_some_and(|value| {
            let length = value.chars().count() as u32;
            schema.min_length.is_none_or(|minimum| length >= minimum)
                && schema.max_length.is_none_or(|maximum| length <= maximum)
                && schema
                    .format
                    .is_none_or(|format| validate_string_format(format, value))
        }),
        PrimitiveSchema::Number(schema) => value.as_f64().is_some_and(|value| {
            schema.minimum.is_none_or(|minimum| value >= minimum)
                && schema.maximum.is_none_or(|maximum| value <= maximum)
        }),
        PrimitiveSchema::Integer(schema) => value.as_i64().is_some_and(|value| {
            schema.minimum.is_none_or(|minimum| value >= minimum)
                && schema.maximum.is_none_or(|maximum| value <= maximum)
        }),
        PrimitiveSchema::Boolean(_) => value.is_boolean(),
        PrimitiveSchema::Enum(schema) => value
            .as_str()
            .is_some_and(|value| schema.enum_values.iter().any(|allowed| allowed == value)),
    };

    if valid {
        Ok(())
    } else {
        Err(ElicitationRouterError::InvalidContent(format!(
            "field `{name}` does not match its requested primitive schema"
        )))
    }
}

fn validate_string_format(format: rmcp::model::StringFormat, value: &str) -> bool {
    match format {
        rmcp::model::StringFormat::Email => value.parse::<email_address::EmailAddress>().is_ok(),
        rmcp::model::StringFormat::Uri => url::Url::parse(value).is_ok(),
        rmcp::model::StringFormat::Date => {
            chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok()
        }
        rmcp::model::StringFormat::DateTime => chrono::DateTime::parse_from_rfc3339(value).is_ok(),
    }
}

#[cfg(test)]
#[path = "elicitation_tests.rs"]
mod tests;
