use agent_protocol::ThreadId;
use serde_json::Value;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::server_request::{ServerRequestOwner, ServerRequestRouter};
use crate::{
    AppServerError, JsonRpcMessage, OutgoingMessage, QueuedOutgoingMessage, TransportDisconnects,
    TransportWriters,
};

/// A narrow transport router without a RuntimeCore reference.
#[derive(Clone)]
pub(crate) struct HostRequestRouter {
    thread_states: crate::thread_state::ThreadStateManager,
    transport_writers: TransportWriters,
    transport_disconnects: TransportDisconnects,
    server_requests: ServerRequestRouter,
}

impl std::fmt::Debug for HostRequestRouter {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HostRequestRouter").finish_non_exhaustive()
    }
}

pub(crate) struct HostConnection {
    connection_id: app_server_transport::ConnectionId,
    writer: mpsc::Sender<QueuedOutgoingMessage>,
    pub(crate) disconnect: Option<CancellationToken>,
    server_requests: ServerRequestRouter,
    transport_writers: TransportWriters,
}

impl HostRequestRouter {
    pub(crate) fn new(
        thread_states: crate::thread_state::ThreadStateManager,
        transport_writers: TransportWriters,
        transport_disconnects: TransportDisconnects,
        server_requests: ServerRequestRouter,
    ) -> Self {
        Self {
            thread_states,
            transport_writers,
            transport_disconnects,
            server_requests,
        }
    }

    pub(crate) async fn request(
        &self,
        thread_id: &str,
        method: &str,
        params: Value,
    ) -> Result<Value, AppServerError> {
        self.connection(thread_id)
            .await?
            .request(method, params)
            .await
    }

    pub(crate) async fn connection(
        &self,
        thread_id: &str,
    ) -> Result<HostConnection, AppServerError> {
        let thread_id = ThreadId::new(thread_id);
        self.thread_states
            .wait_for_thread_subscriber(&thread_id)
            .await;
        let ids = self
            .thread_states
            .subscribed_connection_ids(&thread_id)
            .await;
        let connection_id = match ids.as_slice() {
            [id] => *id,
            [] => return Err(crate::ServerRequestError::ClientUnavailable.into()),
            _ => {
                return Err(crate::ServerRequestError::ClientAmbiguous {
                    client_count: ids.len(),
                }
                .into())
            }
        };
        let writer = self
            .transport_writers
            .lock()
            .expect("app-server transport writer mutex poisoned")
            .get(&connection_id)
            .cloned()
            .ok_or(AppServerError::ConnectionUnavailable { connection_id })?;
        let disconnect = self
            .transport_disconnects
            .lock()
            .expect("app-server transport disconnect mutex poisoned")
            .get(&connection_id)
            .cloned();
        Ok(HostConnection {
            connection_id,
            writer,
            disconnect,
            server_requests: self.server_requests.clone(),
            transport_writers: self.transport_writers.clone(),
        })
    }
}

impl HostConnection {
    pub(crate) fn is_available(&self) -> bool {
        !self.writer.is_closed()
            && !self
                .disconnect
                .as_ref()
                .is_some_and(CancellationToken::is_cancelled)
            && self
                .transport_writers
                .lock()
                .expect("app-server transport writer mutex poisoned")
                .contains_key(&self.connection_id)
    }

    pub(crate) async fn closed(&self) {
        loop {
            if !self.is_available() {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    }

    pub(crate) async fn request(
        &self,
        method: &str,
        params: Value,
    ) -> Result<Value, AppServerError> {
        let connection_id = self.connection_id;
        if !self.is_available() {
            return Err(AppServerError::ConnectionUnavailable { connection_id });
        }
        let pending = self.server_requests.register_for_owner(
            ServerRequestOwner::Transport(connection_id),
            method,
            Some(params),
        );
        let queued = QueuedOutgoingMessage::new(OutgoingMessage::from(JsonRpcMessage::Request(
            pending.request().clone(),
        )));
        if let Some(disconnect) = &self.disconnect {
            if disconnect.is_cancelled() {
                return Err(AppServerError::ConnectionUnavailable { connection_id });
            }
            match self.writer.try_send(queued) {
                Ok(()) => {}
                Err(mpsc::error::TrySendError::Full(_)) => disconnect.cancel(),
                Err(mpsc::error::TrySendError::Closed(_)) => {
                    disconnect.cancel();
                    return Err(AppServerError::ConnectionWriterClosed { connection_id });
                }
            }
        } else {
            self.writer
                .send(queued)
                .await
                .map_err(|_| AppServerError::ConnectionWriterClosed { connection_id })?;
        }
        pending.wait().await.map_err(AppServerError::from)
    }
}
