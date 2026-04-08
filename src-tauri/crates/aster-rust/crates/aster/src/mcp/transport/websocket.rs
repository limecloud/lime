//! WebSocket Transport Implementation
//!
//! This module implements the WebSocket transport for MCP communication.
//! It provides full-duplex communication over WebSocket connections.
//!
//! # Message Format
//!
//! Messages are sent as JSON-RPC 2.0 format over WebSocket text frames.
//! Each message is a single JSON object.

use async_trait::async_trait;
use futures::stream::{SplitSink, SplitStream};
use futures::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::sync::{mpsc, oneshot, Mutex, RwLock};
use tokio_tungstenite::tungstenite::http::Request;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

use crate::mcp::error::{McpError, McpResult};
use crate::mcp::transport::{
    McpMessage, McpNotification, McpRequest, McpResponse, Transport, TransportConfig,
    TransportEvent, TransportState,
};
use crate::mcp::types::{ConnectionOptions, TransportType};

/// WebSocket-specific configuration
#[derive(Debug, Clone)]
pub struct WebSocketConfig {
    /// Server URL (ws:// or wss://)
    pub url: String,
    /// HTTP headers for upgrade request
    pub headers: HashMap<String, String>,
}

/// Pending request waiting for response
struct PendingRequest {
    /// Channel to send the response
    tx: oneshot::Sender<McpResult<McpResponse>>,
}

type WsWriter = SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, Message>;
type WsReader = SplitStream<WebSocketStream<MaybeTlsStream<TcpStream>>>;

/// WebSocket transport for MCP communication
///
/// This transport provides full-duplex communication over WebSocket connections.
/// Messages are sent as JSON-RPC 2.0 format over WebSocket text frames.
pub struct WebSocketTransport {
    /// Transport configuration
    config: WebSocketConfig,
    /// Connection options
    options: ConnectionOptions,
    /// Current transport state
    state: Arc<RwLock<TransportState>>,
    /// WebSocket writer
    writer: Arc<Mutex<Option<WsWriter>>>,
    /// Message sender channel
    message_tx: Arc<Mutex<Option<mpsc::Sender<String>>>>,
    /// Pending requests waiting for responses
    pending_requests: Arc<Mutex<HashMap<String, PendingRequest>>>,
    /// Event channel sender
    event_tx: Arc<Mutex<Option<mpsc::Sender<TransportEvent>>>>,
    /// Request ID counter
    request_counter: AtomicU64,
    /// Shutdown signal
    shutdown_tx: Arc<Mutex<Option<mpsc::Sender<()>>>>,
}

impl WebSocketTransport {
    /// Create a new WebSocket transport
    pub fn new(config: WebSocketConfig, options: ConnectionOptions) -> Self {
        Self {
            config,
            options,
            state: Arc::new(RwLock::new(TransportState::Disconnected)),
            writer: Arc::new(Mutex::new(None)),
            message_tx: Arc::new(Mutex::new(None)),
            pending_requests: Arc::new(Mutex::new(HashMap::new())),
            event_tx: Arc::new(Mutex::new(None)),
            request_counter: AtomicU64::new(1),
            shutdown_tx: Arc::new(Mutex::new(None)),
        }
    }

    /// Create from transport config
    pub fn from_config(config: TransportConfig, options: ConnectionOptions) -> McpResult<Self> {
        match config {
            TransportConfig::WebSocket { url, headers } => {
                Ok(Self::new(WebSocketConfig { url, headers }, options))
            }
            _ => Err(McpError::config(
                "Expected WebSocket transport configuration",
            )),
        }
    }

    /// Generate a unique request ID
    pub fn next_request_id(&self) -> String {
        let id = self.request_counter.fetch_add(1, Ordering::SeqCst);
        format!("ws-req-{}", id)
    }

    /// Set the transport state
    async fn set_state(&self, state: TransportState) {
        let mut current = self.state.write().await;
        *current = state;
    }

    /// Emit a transport event
    async fn emit_event(&self, event: TransportEvent) {
        if let Some(tx) = self.event_tx.lock().await.as_ref() {
            let _ = tx.send(event).await;
        }
    }

    /// Handle incoming message from WebSocket
    async fn handle_message(
        message: &str,
        pending_requests: &Arc<Mutex<HashMap<String, PendingRequest>>>,
        event_tx: &Arc<Mutex<Option<mpsc::Sender<TransportEvent>>>>,
    ) {
        // Try to parse as a response first
        if let Ok(response) = serde_json::from_str::<McpResponse>(message) {
            let id_str = match &response.id {
                serde_json::Value::String(s) => s.clone(),
                serde_json::Value::Number(n) => n.to_string(),
                _ => return,
            };

            let mut pending = pending_requests.lock().await;
            if let Some(req) = pending.remove(&id_str) {
                let _ = req.tx.send(Ok(response));
            }
            return;
        }

        // Try to parse as a notification
        if let Ok(notification) = serde_json::from_str::<McpNotification>(message) {
            if let Some(tx) = event_tx.lock().await.as_ref() {
                let _ = tx
                    .send(TransportEvent::MessageReceived(Box::new(
                        McpMessage::Notification(notification),
                    )))
                    .await;
            }
            return;
        }

        // Try to parse as a request (server-initiated)
        if let Ok(request) = serde_json::from_str::<McpRequest>(message) {
            if let Some(tx) = event_tx.lock().await.as_ref() {
                let _ = tx
                    .send(TransportEvent::MessageReceived(Box::new(
                        McpMessage::Request(request),
                    )))
                    .await;
            }
        }
    }

    /// Start the reader task for WebSocket
    fn start_reader_task(&self, mut reader: WsReader, mut shutdown_rx: mpsc::Receiver<()>) {
        let pending_requests = self.pending_requests.clone();
        let event_tx = self.event_tx.clone();
        let state = self.state.clone();

        tokio::spawn(async move {
            loop {
                tokio::select! {
                    msg = reader.next() => {
                        match msg {
                            Some(Ok(Message::Text(text))) => {
                                Self::handle_message(&text, &pending_requests, &event_tx).await;
                            }
                            Some(Ok(Message::Close(_))) => {
                                let mut s = state.write().await;
                                *s = TransportState::Disconnected;
                                if let Some(tx) = event_tx.lock().await.as_ref() {
                                    let _ = tx.send(TransportEvent::Disconnected {
                                        reason: Some("WebSocket closed by server".to_string()),
                                    }).await;
                                }
                                break;
                            }
                            Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => {
                                // Ignore ping/pong frames
                            }
                            Some(Ok(Message::Binary(_))) => {
                                // Ignore binary frames for now
                            }
                            Some(Ok(Message::Frame(_))) => {
                                // Ignore raw frames
                            }
                            Some(Err(e)) => {
                                let mut s = state.write().await;
                                *s = TransportState::Error;
                                if let Some(tx) = event_tx.lock().await.as_ref() {
                                    let _ = tx.send(TransportEvent::Error {
                                        error: e.to_string(),
                                    }).await;
                                }
                                break;
                            }
                            None => {
                                let mut s = state.write().await;
                                *s = TransportState::Disconnected;
                                if let Some(tx) = event_tx.lock().await.as_ref() {
                                    let _ = tx.send(TransportEvent::Disconnected {
                                        reason: Some("WebSocket stream ended".to_string()),
                                    }).await;
                                }
                                break;
                            }
                        }
                    }
                    _ = shutdown_rx.recv() => {
                        break;
                    }
                }
            }
        });
    }

    /// Start the writer task for WebSocket
    fn start_writer_task(&self, mut writer: WsWriter, mut message_rx: mpsc::Receiver<String>) {
        let state = self.state.clone();
        let event_tx = self.event_tx.clone();

        tokio::spawn(async move {
            while let Some(message) = message_rx.recv().await {
                if let Err(e) = writer.send(Message::Text(message.into())).await {
                    let mut s = state.write().await;
                    *s = TransportState::Error;
                    if let Some(tx) = event_tx.lock().await.as_ref() {
                        let _ = tx
                            .send(TransportEvent::Error {
                                error: e.to_string(),
                            })
                            .await;
                    }
                    break;
                }
            }
        });
    }
}

#[async_trait]
impl Transport for WebSocketTransport {
    fn transport_type(&self) -> TransportType {
        TransportType::WebSocket
    }

    fn state(&self) -> TransportState {
        self.state
            .try_read()
            .map(|s| *s)
            .unwrap_or(TransportState::Disconnected)
    }

    async fn connect(&mut self) -> McpResult<()> {
        self.set_state(TransportState::Connecting).await;
        self.emit_event(TransportEvent::Connecting).await;

        // Build the WebSocket request with headers
        let mut request = Request::builder().uri(&self.config.url);

        for (key, value) in &self.config.headers {
            request = request.header(key, value);
        }

        let request = request.body(()).map_err(|e| {
            McpError::transport(format!("Failed to build WebSocket request: {}", e))
        })?;

        // Connect to WebSocket server
        let (ws_stream, _response) = connect_async(request).await.map_err(|e| {
            McpError::transport_with_source(
                format!("Failed to connect to WebSocket server: {}", self.config.url),
                e,
            )
        })?;

        // Split the stream into reader and writer
        let (writer, reader) = ws_stream.split();

        // Create channels
        let (message_tx, message_rx) = mpsc::channel::<String>(self.options.queue_max_size);
        let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>(1);
        let (event_tx, _event_rx) = mpsc::channel::<TransportEvent>(100);

        // Store handles
        *self.writer.lock().await = Some(writer);
        *self.message_tx.lock().await = Some(message_tx);
        *self.shutdown_tx.lock().await = Some(shutdown_tx);
        *self.event_tx.lock().await = Some(event_tx);

        // Start reader and writer tasks
        self.start_reader_task(reader, shutdown_rx);
        self.start_writer_task(self.writer.lock().await.take().unwrap(), message_rx);

        self.set_state(TransportState::Connected).await;
        self.emit_event(TransportEvent::Connected).await;

        Ok(())
    }

    async fn disconnect(&mut self) -> McpResult<()> {
        self.set_state(TransportState::Closing).await;

        // Send shutdown signal
        if let Some(tx) = self.shutdown_tx.lock().await.take() {
            let _ = tx.send(()).await;
        }

        // Close message channel
        *self.message_tx.lock().await = None;

        // Clear pending requests
        let mut pending = self.pending_requests.lock().await;
        for (_, req) in pending.drain() {
            let _ = req.tx.send(Err(McpError::cancelled(
                "Transport disconnected",
                Some("disconnect".to_string()),
            )));
        }

        self.set_state(TransportState::Disconnected).await;
        self.emit_event(TransportEvent::Disconnected {
            reason: Some("Disconnected by user".to_string()),
        })
        .await;

        Ok(())
    }

    async fn send(&mut self, message: McpMessage) -> McpResult<()> {
        let state = *self.state.read().await;
        if state != TransportState::Connected {
            return Err(McpError::transport("Transport is not connected"));
        }

        let json = serde_json::to_string(&message)?;

        if let Some(tx) = self.message_tx.lock().await.as_ref() {
            tx.send(json)
                .await
                .map_err(|e| McpError::transport(format!("Failed to send message: {}", e)))?;
        } else {
            return Err(McpError::transport("Message channel not available"));
        }

        Ok(())
    }

    async fn send_request(&mut self, request: McpRequest) -> McpResult<McpResponse> {
        self.send_request_with_timeout(request, self.options.timeout)
            .await
    }

    async fn send_request_with_timeout(
        &mut self,
        request: McpRequest,
        timeout: Duration,
    ) -> McpResult<McpResponse> {
        let state = *self.state.read().await;
        if state != TransportState::Connected {
            return Err(McpError::transport("Transport is not connected"));
        }

        // Get the request ID as string
        let id_str = match &request.id {
            serde_json::Value::String(s) => s.clone(),
            serde_json::Value::Number(n) => n.to_string(),
            _ => return Err(McpError::protocol("Invalid request ID type")),
        };

        // Create response channel
        let (tx, rx) = oneshot::channel();

        // Register pending request
        {
            let mut pending = self.pending_requests.lock().await;
            pending.insert(id_str.clone(), PendingRequest { tx });
        }

        // Send the request
        let json = serde_json::to_string(&request)?;
        if let Some(message_tx) = self.message_tx.lock().await.as_ref() {
            message_tx
                .send(json)
                .await
                .map_err(|e| McpError::transport(format!("Failed to send request: {}", e)))?;
        } else {
            // Remove pending request on failure
            self.pending_requests.lock().await.remove(&id_str);
            return Err(McpError::transport("Message channel not available"));
        }

        // Wait for response with timeout
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => {
                // Channel closed
                self.pending_requests.lock().await.remove(&id_str);
                Err(McpError::transport("Response channel closed"))
            }
            Err(_) => {
                // Timeout
                self.pending_requests.lock().await.remove(&id_str);
                Err(McpError::timeout("Request timed out", timeout))
            }
        }
    }

    fn subscribe(&self) -> mpsc::Receiver<TransportEvent> {
        let (tx, rx) = mpsc::channel(100);
        let event_tx = self.event_tx.clone();
        tokio::spawn(async move {
            *event_tx.lock().await = Some(tx);
        });
        rx
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_websocket_config() {
        let config = WebSocketConfig {
            url: "ws://localhost:8080".to_string(),
            headers: HashMap::new(),
        };
        assert_eq!(config.url, "ws://localhost:8080");
    }

    #[test]
    fn test_websocket_transport_new() {
        let config = WebSocketConfig {
            url: "ws://localhost:8080".to_string(),
            headers: HashMap::new(),
        };
        let transport = WebSocketTransport::new(config, ConnectionOptions::default());
        assert_eq!(transport.transport_type(), TransportType::WebSocket);
        assert_eq!(transport.state(), TransportState::Disconnected);
    }

    #[test]
    fn test_from_config() {
        let config = TransportConfig::WebSocket {
            url: "ws://localhost:8080".to_string(),
            headers: HashMap::new(),
        };
        let transport = WebSocketTransport::from_config(config, ConnectionOptions::default());
        assert!(transport.is_ok());
    }

    #[test]
    fn test_from_config_wrong_type() {
        let config = TransportConfig::Stdio {
            command: "node".to_string(),
            args: vec![],
            env: HashMap::new(),
            cwd: None,
        };
        let transport = WebSocketTransport::from_config(config, ConnectionOptions::default());
        assert!(transport.is_err());
    }

    #[test]
    fn test_next_request_id() {
        let config = WebSocketConfig {
            url: "ws://localhost:8080".to_string(),
            headers: HashMap::new(),
        };
        let transport = WebSocketTransport::new(config, ConnectionOptions::default());

        let id1 = transport.next_request_id();
        let id2 = transport.next_request_id();

        assert_ne!(id1, id2);
        assert!(id1.starts_with("ws-req-"));
        assert!(id2.starts_with("ws-req-"));
    }

    #[tokio::test]
    async fn test_send_not_connected() {
        let config = WebSocketConfig {
            url: "ws://localhost:8080".to_string(),
            headers: HashMap::new(),
        };
        let mut transport = WebSocketTransport::new(config, ConnectionOptions::default());

        let request = McpRequest::new(serde_json::json!(1), "test/method");
        let result = transport.send(McpMessage::Request(request)).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_connect_invalid_url() {
        let config = WebSocketConfig {
            url: "ws://localhost:99999/invalid".to_string(),
            headers: HashMap::new(),
        };
        let mut transport = WebSocketTransport::new(config, ConnectionOptions::default());

        let result = transport.connect().await;
        assert!(result.is_err());
    }
}
