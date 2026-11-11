use super::forward_incoming_message;
use super::next_connection_id;
use super::ConnectionOrigin;
use super::TransportEvent;
use crate::serialize_outgoing_message;
use crate::QueuedOutgoingMessage;
use crate::CHANNEL_CAPACITY;
use crate::websocket_auth::{authorize_upgrade, is_unauthenticated_non_loopback_listener, WebsocketAuthPolicy};
use axum::body::Body;
use axum::extract::ws::Message as AxumWebSocketMessage;
use axum::extract::ws::WebSocketUpgrade;
use axum::extract::ConnectInfo;
use axum::extract::State;
use axum::http::header::ORIGIN;
use axum::http::HeaderMap;
use axum::http::Request;
use axum::http::StatusCode;
use axum::middleware;
use axum::middleware::Next;
use axum::response::IntoResponse;
use axum::response::Response;
use axum::routing::any;
use axum::routing::get;
use futures::SinkExt;
use futures::StreamExt;
use std::io::Result as IoResult;
use std::net::SocketAddr;
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::Message as TungsteniteWebSocketMessage;
use tokio_util::sync::CancellationToken;
use tracing::error;
use tracing::info;
use tracing::warn;

/// WebSocket clients may briefly lag behind turn output bursts.
const WEBSOCKET_OUTBOUND_CHANNEL_CAPACITY: usize = 32 * 1024;
const _: () = assert!(WEBSOCKET_OUTBOUND_CHANNEL_CAPACITY > CHANNEL_CAPACITY);

#[derive(Clone)]
struct WebSocketListenerState {
    transport_event_tx: mpsc::Sender<TransportEvent>,
    auth_policy: WebsocketAuthPolicy,
}

async fn health_check_handler() -> StatusCode {
    StatusCode::OK
}

async fn reject_requests_with_origin_header(
    request: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    if request.headers().contains_key(ORIGIN) {
        warn!(
            method = %request.method(),
            uri = %request.uri(),
            "rejecting app-server websocket request with Origin header"
        );
        Err(StatusCode::FORBIDDEN)
    } else {
        Ok(next.run(request).await)
    }
}

async fn websocket_upgrade_handler(
    websocket: WebSocketUpgrade,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    State(state): State<WebSocketListenerState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(error) = authorize_upgrade(&headers, &state.auth_policy) {
        return error.status_code().into_response();
    }
    info!(%peer_addr, "app-server websocket client connected");
    websocket
        .on_upgrade(move |stream| async move {
            let (websocket_writer, websocket_reader) = stream.split();
            run_websocket_connection(websocket_writer, websocket_reader, state.transport_event_tx)
                .await;
        })
        .into_response()
}

pub async fn start_websocket_acceptor(
    bind_address: SocketAddr,
    transport_event_tx: mpsc::Sender<TransportEvent>,
    shutdown_token: CancellationToken,
    auth_policy: WebsocketAuthPolicy,
) -> IoResult<(SocketAddr, JoinHandle<()>)> {
    if is_unauthenticated_non_loopback_listener(bind_address, &auth_policy) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!(
                "refusing to start unauthenticated websocket listener {bind_address}; configure --ws-auth or use loopback"
            ),
        ));
    }

    let listener = TcpListener::bind(bind_address).await?;
    let local_addr = listener.local_addr()?;
    info!(%local_addr, "app-server websocket listening");

    let router = axum::Router::new()
        .route("/readyz", get(health_check_handler))
        .route("/healthz", get(health_check_handler))
        .fallback(any(websocket_upgrade_handler))
        .layer(middleware::from_fn(reject_requests_with_origin_header))
        .with_state(WebSocketListenerState { transport_event_tx, auth_policy });
    let server = axum::serve(
        listener,
        router.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(async move {
        shutdown_token.cancelled().await;
    });

    Ok((
        local_addr,
        tokio::spawn(async move {
            if let Err(err) = server.await {
                error!(%err, "app-server websocket acceptor failed");
            }
            info!("app-server websocket acceptor stopped");
        }),
    ))
}

pub(crate) async fn run_websocket_connection<M, SinkError, StreamError>(
    websocket_writer: impl futures::sink::Sink<M, Error = SinkError> + Send + 'static,
    websocket_reader: impl futures::stream::Stream<Item = Result<M, StreamError>> + Send + 'static,
    transport_event_tx: mpsc::Sender<TransportEvent>,
) where
    M: AppServerWebSocketMessage + Send + 'static,
    SinkError: Send + 'static,
    StreamError: std::fmt::Display + Send + 'static,
{
    let connection_id = next_connection_id();
    let (writer_tx, writer_rx) =
        mpsc::channel::<QueuedOutgoingMessage>(WEBSOCKET_OUTBOUND_CHANNEL_CAPACITY);
    let writer_tx_for_reader = writer_tx.clone();
    let disconnect_token = CancellationToken::new();
    if transport_event_tx
        .send(TransportEvent::ConnectionOpened {
            connection_id,
            origin: ConnectionOrigin::WebSocket,
            writer: writer_tx,
            disconnect_sender: Some(disconnect_token.clone()),
        })
        .await
        .is_err()
    {
        return;
    }

    let (writer_control_tx, writer_control_rx) = mpsc::channel::<M>(CHANNEL_CAPACITY);
    let mut outbound_task = tokio::spawn(run_websocket_outbound_loop(
        websocket_writer,
        writer_rx,
        writer_control_rx,
        disconnect_token.clone(),
    ));
    let mut inbound_task = tokio::spawn(run_websocket_inbound_loop(
        websocket_reader,
        transport_event_tx.clone(),
        writer_tx_for_reader,
        writer_control_tx,
        connection_id,
        disconnect_token.clone(),
    ));

    tokio::select! {
        _ = &mut outbound_task => {
            disconnect_token.cancel();
            inbound_task.abort();
        }
        _ = &mut inbound_task => {
            disconnect_token.cancel();
            outbound_task.abort();
        }
    }

    let _ = transport_event_tx
        .send(TransportEvent::ConnectionClosed { connection_id })
        .await;
}

pub(crate) enum IncomingWebSocketMessage {
    Text(String),
    Binary,
    Ping(Vec<u8>),
    Pong,
    Close,
}

pub(crate) trait AppServerWebSocketMessage: Sized {
    fn text(text: String) -> Self;
    fn pong(payload: Vec<u8>) -> Self;
    fn into_incoming(self) -> Option<IncomingWebSocketMessage>;
}

impl AppServerWebSocketMessage for AxumWebSocketMessage {
    fn text(text: String) -> Self {
        Self::Text(text.into())
    }

    fn pong(payload: Vec<u8>) -> Self {
        Self::Pong(payload)
    }

    fn into_incoming(self) -> Option<IncomingWebSocketMessage> {
        Some(match self {
            Self::Text(text) => IncomingWebSocketMessage::Text(text.to_string()),
            Self::Binary(_) => IncomingWebSocketMessage::Binary,
            Self::Ping(payload) => IncomingWebSocketMessage::Ping(payload.to_vec()),
            Self::Pong(_) => IncomingWebSocketMessage::Pong,
            Self::Close(_) => IncomingWebSocketMessage::Close,
        })
    }
}

impl AppServerWebSocketMessage for TungsteniteWebSocketMessage {
    fn text(text: String) -> Self {
        Self::Text(text.into())
    }

    fn pong(payload: Vec<u8>) -> Self {
        Self::Pong(payload.into())
    }

    fn into_incoming(self) -> Option<IncomingWebSocketMessage> {
        Some(match self {
            Self::Text(text) => IncomingWebSocketMessage::Text(text.to_string()),
            Self::Binary(_) => IncomingWebSocketMessage::Binary,
            Self::Ping(payload) => IncomingWebSocketMessage::Ping(payload.to_vec()),
            Self::Pong(_) => IncomingWebSocketMessage::Pong,
            Self::Close(_) => IncomingWebSocketMessage::Close,
            Self::Frame(_) => return None,
        })
    }
}

async fn run_websocket_outbound_loop<M, SinkError>(
    websocket_writer: impl futures::sink::Sink<M, Error = SinkError> + Send + 'static,
    mut writer_rx: mpsc::Receiver<QueuedOutgoingMessage>,
    mut writer_control_rx: mpsc::Receiver<M>,
    disconnect_token: CancellationToken,
) where
    M: AppServerWebSocketMessage + Send + 'static,
    SinkError: Send + 'static,
{
    tokio::pin!(websocket_writer);
    loop {
        tokio::select! {
            _ = disconnect_token.cancelled() => break,
            message = writer_control_rx.recv() => {
                let Some(message) = message else { break; };
                if websocket_writer.send(message).await.is_err() { break; }
            }
            queued_message = writer_rx.recv() => {
                let Some(queued_message) = queued_message else { break; };
                let Some(json) = serialize_outgoing_message(queued_message.message) else { continue; };
                if websocket_writer.send(M::text(json)).await.is_err() { break; }
                if let Some(write_complete_tx) = queued_message.write_complete_tx {
                    let _ = write_complete_tx.send(());
                }
            }
        }
    }
}

async fn run_websocket_inbound_loop<M, StreamError>(
    websocket_reader: impl futures::stream::Stream<Item = Result<M, StreamError>> + Send + 'static,
    transport_event_tx: mpsc::Sender<TransportEvent>,
    writer_tx_for_reader: mpsc::Sender<QueuedOutgoingMessage>,
    writer_control_tx: mpsc::Sender<M>,
    connection_id: crate::ConnectionId,
    disconnect_token: CancellationToken,
) where
    M: AppServerWebSocketMessage + Send + 'static,
    StreamError: std::fmt::Display + Send + 'static,
{
    tokio::pin!(websocket_reader);
    loop {
        tokio::select! {
            _ = disconnect_token.cancelled() => break,
            incoming_message = websocket_reader.next() => {
                match incoming_message {
                    Some(Ok(message)) => match message.into_incoming() {
                        Some(IncomingWebSocketMessage::Text(text))
                            if !forward_incoming_message(
                                &transport_event_tx,
                                &writer_tx_for_reader,
                                connection_id,
                                &text,
                            ).await => break,
                        Some(IncomingWebSocketMessage::Text(_)) => {}
                        Some(IncomingWebSocketMessage::Ping(payload)) => {
                            match writer_control_tx.try_send(M::pong(payload)) {
                                Ok(()) => {}
                                Err(mpsc::error::TrySendError::Closed(_)) => break,
                                Err(mpsc::error::TrySendError::Full(_)) => {
                                    warn!(%connection_id, "websocket control queue full while replying to ping");
                                    break;
                                }
                            }
                        }
                        Some(IncomingWebSocketMessage::Pong) => {}
                        Some(IncomingWebSocketMessage::Close) => break,
                        Some(IncomingWebSocketMessage::Binary) => {
                            warn!(%connection_id, "dropping unsupported binary websocket message");
                        }
                        None => {}
                    },
                    None => break,
                    Some(Err(err)) => {
                        warn!(%connection_id, "websocket receive error: {err}");
                        break;
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use app_server_protocol::JsonRpcMessage;
    use app_server_protocol::JsonRpcNotification;
    use app_server_protocol::JsonRpcRequest;
    use app_server_protocol::RequestId;
    use app_server_protocol::METHOD_INITIALIZE;
    use futures::SinkExt;
    use futures::StreamExt;
    use serde_json::json;
    use std::time::Duration;
    use tokio::time::timeout;
    use tokio_tungstenite::connect_async;
    use tokio_tungstenite::tungstenite::Message;

    #[tokio::test]
    async fn websocket_acceptor_forwards_messages_and_pings() {
        let (transport_event_tx, mut transport_event_rx) =
            mpsc::channel::<TransportEvent>(CHANNEL_CAPACITY);
        let shutdown_token = CancellationToken::new();
        let (bind_address, accept_handle) = start_websocket_acceptor(
            "127.0.0.1:0".parse().unwrap(),
            transport_event_tx,
            shutdown_token.clone(),
            WebsocketAuthPolicy::default(),
        )
        .await
        .expect("websocket acceptor should start");
        let (mut websocket, response) = connect_async(format!("ws://{bind_address}"))
            .await
            .expect("websocket client should connect");
        assert_eq!(response.status().as_u16(), 101);

        let connection_id = match timeout(Duration::from_secs(1), transport_event_rx.recv())
            .await
            .expect("connection opened event should arrive")
            .expect("connection opened event")
        {
            TransportEvent::ConnectionOpened {
                connection_id,
                origin,
                disconnect_sender,
                ..
            } => {
                assert_eq!(origin, ConnectionOrigin::WebSocket);
                assert!(disconnect_sender.is_some());
                connection_id
            }
            other => panic!("expected connection opened event, got {other:?}"),
        };

        let initialize = JsonRpcMessage::Request(JsonRpcRequest::new(
            RequestId::Integer(1),
            METHOD_INITIALIZE,
            Some(json!({
                "clientInfo": { "name": "transport-test" },
                "capabilities": {}
            })),
        ));
        websocket
            .send(Message::Text(
                serde_json::to_string(&initialize)
                    .expect("initialize should serialize")
                    .into(),
            ))
            .await
            .expect("initialize should send");
        let initialized_request = timeout(Duration::from_secs(1), transport_event_rx.recv())
            .await
            .expect("initialize event should arrive")
            .expect("initialize event");
        assert!(matches!(
            initialized_request,
            TransportEvent::IncomingMessage {
                connection_id: incoming_connection_id,
                message,
            } if incoming_connection_id == connection_id && message == initialize
        ));

        let notification =
            JsonRpcMessage::Notification(JsonRpcNotification::new("initialized", None));
        websocket
            .send(Message::Text(
                serde_json::to_string(&notification)
                    .expect("notification should serialize")
                    .into(),
            ))
            .await
            .expect("notification should send");
        let incoming = timeout(Duration::from_secs(1), transport_event_rx.recv())
            .await
            .expect("incoming message event should arrive")
            .expect("incoming message event");
        assert!(matches!(
            incoming,
            TransportEvent::IncomingMessage {
                connection_id: incoming_connection_id,
                message,
            } if incoming_connection_id == connection_id && message == notification
        ));

        websocket
            .send(Message::Ping(b"check".to_vec()))
            .await
            .expect("ping should send");
        let pong = timeout(Duration::from_secs(1), websocket.next())
            .await
            .expect("pong should arrive")
            .expect("pong frame")
            .expect("pong should be valid");
        assert_eq!(pong, Message::Pong(b"check".to_vec()));

        websocket.close(None).await.expect("close should send");
        let closed = timeout(Duration::from_secs(1), transport_event_rx.recv())
            .await
            .expect("connection closed event should arrive")
            .expect("connection closed event");
        assert!(matches!(
            closed,
            TransportEvent::ConnectionClosed { connection_id: closed_id }
                if closed_id == connection_id
        ));

        let (mut reconnect, response) = connect_async(format!("ws://{bind_address}"))
            .await
            .expect("websocket client should reconnect");
        assert_eq!(response.status().as_u16(), 101);
        let reconnect_id = match timeout(Duration::from_secs(1), transport_event_rx.recv())
            .await
            .expect("reconnect opened event should arrive")
            .expect("reconnect opened event")
        {
            TransportEvent::ConnectionOpened { connection_id, .. } => connection_id,
            other => panic!("expected reconnect opened event, got {other:?}"),
        };
        assert_ne!(reconnect_id, connection_id);
        reconnect
            .send(Message::Text(
                serde_json::to_string(&notification)
                    .expect("notification should serialize")
                    .into(),
            ))
            .await
            .expect("reconnect notification should send");
        let reconnect_message = timeout(Duration::from_secs(1), transport_event_rx.recv())
            .await
            .expect("reconnect message event should arrive")
            .expect("reconnect message event");
        assert!(matches!(
            reconnect_message,
            TransportEvent::IncomingMessage {
                connection_id: incoming_connection_id,
                message,
            } if incoming_connection_id == reconnect_id && message == notification
        ));
        reconnect
            .close(None)
            .await
            .expect("reconnect close should send");
        let reconnect_closed = timeout(Duration::from_secs(1), transport_event_rx.recv())
            .await
            .expect("reconnect closed event should arrive")
            .expect("reconnect closed event");
        assert!(matches!(
            reconnect_closed,
            TransportEvent::ConnectionClosed { connection_id: closed_id }
                if closed_id == reconnect_id
        ));

        shutdown_token.cancel();
        accept_handle.await.expect("acceptor should join");
    }

    #[tokio::test]
    async fn websocket_auth_rejects_before_opening_runtime_connection() {
        use crate::websocket_auth::{policy_from_settings, WebsocketAuthArgs, WebsocketAuthCliMode};
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;
        let directory = tempfile::tempdir().unwrap();
        let token_file = directory.path().join("token");
        std::fs::write(&token_file, "test-session-credential\n").unwrap();
        let settings = WebsocketAuthArgs {
            ws_auth: Some(WebsocketAuthCliMode::CapabilityToken),
            ws_token_file: Some(token_file),
            ..Default::default()
        }.try_into_settings().unwrap();
        let (tx, mut rx) = mpsc::channel(CHANNEL_CAPACITY);
        let shutdown = CancellationToken::new();
        let (address, handle) = start_websocket_acceptor(
            "127.0.0.1:0".parse().unwrap(), tx, shutdown.clone(), policy_from_settings(&settings).unwrap(),
        ).await.unwrap();
        for token in [None, Some("Bearer wrong"), Some("Basic test-session-credential")] {
            let mut request = format!("ws://{address}").into_client_request().unwrap();
            if let Some(token) = token {
                request.headers_mut().insert("authorization", token.parse().unwrap());
            }
            let error = connect_async(request).await.unwrap_err();
            assert!(matches!(error, tokio_tungstenite::tungstenite::Error::Http(response) if response.status() == 401));
            assert!(rx.try_recv().is_err(), "rejected upgrades must not enter the runtime");
        }
        let mut request = format!("ws://{address}").into_client_request().unwrap();
        request.headers_mut().insert("authorization", "Bearer test-session-credential".parse().unwrap());
        // Authentication does not weaken the existing browser Origin boundary.
        request.headers_mut().insert("origin", "https://attacker.test".parse().unwrap());
        let error = connect_async(request.clone()).await.unwrap_err();
        assert!(matches!(error, tokio_tungstenite::tungstenite::Error::Http(response) if response.status() == 403));
        request.headers_mut().remove("origin");
        let (mut socket, _) = connect_async(request).await.unwrap();
        assert!(matches!(timeout(Duration::from_secs(1), rx.recv()).await.unwrap(), Some(TransportEvent::ConnectionOpened { .. })));
        socket.close(None).await.unwrap();
        timeout(Duration::from_secs(1), rx.recv()).await.unwrap();
        shutdown.cancel();
        handle.await.unwrap();
    }

    #[tokio::test]
    async fn websocket_acceptor_rejects_non_loopback_listener() {
        let (transport_event_tx, _transport_event_rx) = mpsc::channel(CHANNEL_CAPACITY);
        let error = start_websocket_acceptor(
            "0.0.0.0:0".parse().expect("address"),
            transport_event_tx,
            CancellationToken::new(),
            WebsocketAuthPolicy::default(),
        )
        .await
        .expect_err("unauthenticated non-loopback listener must fail closed");
        assert_eq!(error.kind(), std::io::ErrorKind::InvalidInput);
    }
}
