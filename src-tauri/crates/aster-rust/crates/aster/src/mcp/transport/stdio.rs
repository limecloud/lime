//! Stdio Transport Implementation
//!
//! This module implements the stdio transport for MCP communication.
//! It spawns a subprocess and communicates via stdin/stdout using JSON-RPC messages.
//!
//! # Message Format
//!
//! Messages are sent as JSON-RPC 2.0 format with newline delimiters.
//! Each message is a single line of JSON followed by a newline character.

use async_trait::async_trait;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader as TokioBufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, Mutex, RwLock};

use crate::mcp::error::{McpError, McpResult};
use crate::mcp::transport::{
    McpMessage, McpNotification, McpRequest, McpResponse, Transport, TransportConfig,
    TransportEvent, TransportState,
};
use crate::mcp::types::{ConnectionOptions, TransportType};

/// Pending request waiting for response
struct PendingRequest {
    /// Channel to send the response
    tx: oneshot::Sender<McpResult<McpResponse>>,
}

/// Stdio transport for MCP communication
///
/// This transport spawns a subprocess and communicates via stdin/stdout.
/// Messages are JSON-RPC 2.0 format with newline delimiters.
pub struct StdioTransport {
    /// Transport configuration
    config: StdioConfig,
    /// Connection options
    options: ConnectionOptions,
    /// Current transport state
    state: Arc<RwLock<TransportState>>,
    /// Child process handle
    child: Arc<Mutex<Option<Child>>>,
    /// Stdin writer
    stdin_tx: Arc<Mutex<Option<mpsc::Sender<String>>>>,
    /// Pending requests waiting for responses
    pending_requests: Arc<Mutex<HashMap<String, PendingRequest>>>,
    /// Event subscribers
    event_tx: Arc<Mutex<Option<mpsc::Sender<TransportEvent>>>>,
    /// Request ID counter
    request_counter: AtomicU64,
    /// Shutdown signal
    shutdown_tx: Arc<Mutex<Option<mpsc::Sender<()>>>>,
}

/// Stdio-specific configuration
#[derive(Debug, Clone)]
pub struct StdioConfig {
    /// Command to execute
    pub command: String,
    /// Command arguments
    pub args: Vec<String>,
    /// Environment variables
    pub env: HashMap<String, String>,
    /// Working directory
    pub cwd: Option<String>,
}

impl StdioTransport {
    /// Create a new stdio transport
    pub fn new(config: StdioConfig, options: ConnectionOptions) -> Self {
        Self {
            config,
            options,
            state: Arc::new(RwLock::new(TransportState::Disconnected)),
            child: Arc::new(Mutex::new(None)),
            stdin_tx: Arc::new(Mutex::new(None)),
            pending_requests: Arc::new(Mutex::new(HashMap::new())),
            event_tx: Arc::new(Mutex::new(None)),
            request_counter: AtomicU64::new(1),
            shutdown_tx: Arc::new(Mutex::new(None)),
        }
    }

    /// Create from transport config
    pub fn from_config(config: TransportConfig, options: ConnectionOptions) -> McpResult<Self> {
        match config {
            TransportConfig::Stdio {
                command,
                args,
                env,
                cwd,
            } => Ok(Self::new(
                StdioConfig {
                    command,
                    args,
                    env,
                    cwd,
                },
                options,
            )),
            _ => Err(McpError::config("Expected Stdio transport configuration")),
        }
    }

    /// Generate a unique request ID
    pub fn next_request_id(&self) -> String {
        let id = self.request_counter.fetch_add(1, Ordering::SeqCst);
        format!("req-{}", id)
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

    /// Handle incoming message from stdout
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

    /// Start the reader task for stdout
    fn start_reader_task(
        &self,
        mut stdout: tokio::process::ChildStdout,
        mut shutdown_rx: mpsc::Receiver<()>,
    ) {
        let pending_requests = self.pending_requests.clone();
        let event_tx = self.event_tx.clone();
        let state = self.state.clone();

        tokio::spawn(async move {
            let mut reader = TokioBufReader::new(&mut stdout);
            let mut line = String::new();

            loop {
                line.clear();
                tokio::select! {
                    result = reader.read_line(&mut line) => {
                        match result {
                            Ok(0) => {
                                // EOF - process exited
                                let mut s = state.write().await;
                                *s = TransportState::Disconnected;
                                if let Some(tx) = event_tx.lock().await.as_ref() {
                                    let _ = tx.send(TransportEvent::Disconnected {
                                        reason: Some("Process exited".to_string()),
                                    }).await;
                                }
                                break;
                            }
                            Ok(_) => {
                                let trimmed = line.trim();
                                if !trimmed.is_empty() {
                                    Self::handle_message(trimmed, &pending_requests, &event_tx).await;
                                }
                            }
                            Err(e) => {
                                let mut s = state.write().await;
                                *s = TransportState::Error;
                                if let Some(tx) = event_tx.lock().await.as_ref() {
                                    let _ = tx.send(TransportEvent::Error {
                                        error: e.to_string(),
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

    /// Start the writer task for stdin
    fn start_writer_task(
        &self,
        mut stdin: tokio::process::ChildStdin,
        mut message_rx: mpsc::Receiver<String>,
    ) {
        let state = self.state.clone();
        let event_tx = self.event_tx.clone();

        tokio::spawn(async move {
            while let Some(message) = message_rx.recv().await {
                let data = format!("{}\n", message);
                if let Err(e) = stdin.write_all(data.as_bytes()).await {
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
                if let Err(e) = stdin.flush().await {
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
impl Transport for StdioTransport {
    fn transport_type(&self) -> TransportType {
        TransportType::Stdio
    }

    fn state(&self) -> TransportState {
        // Use try_read to avoid blocking, fall back to Disconnected
        self.state
            .try_read()
            .map(|s| *s)
            .unwrap_or(TransportState::Disconnected)
    }

    async fn connect(&mut self) -> McpResult<()> {
        self.set_state(TransportState::Connecting).await;
        self.emit_event(TransportEvent::Connecting).await;

        // Build the command
        let mut cmd = Command::new(&self.config.command);
        cmd.args(&self.config.args);
        cmd.envs(&self.config.env);
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        if let Some(cwd) = &self.config.cwd {
            cmd.current_dir(cwd);
        }

        // Spawn the process
        let mut child = cmd.spawn().map_err(|e| {
            McpError::transport_with_source(
                format!("Failed to spawn process '{}': {}", self.config.command, e),
                e,
            )
        })?;

        // Take stdin and stdout
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| McpError::transport("Failed to capture stdin of child process"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| McpError::transport("Failed to capture stdout of child process"))?;

        // Create channels
        let (message_tx, message_rx) = mpsc::channel::<String>(self.options.queue_max_size);
        let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>(1);
        let (event_tx, _event_rx) = mpsc::channel::<TransportEvent>(100);

        // Store handles
        *self.child.lock().await = Some(child);
        *self.stdin_tx.lock().await = Some(message_tx);
        *self.shutdown_tx.lock().await = Some(shutdown_tx);
        *self.event_tx.lock().await = Some(event_tx);

        // Start reader and writer tasks
        self.start_reader_task(stdout, shutdown_rx);
        self.start_writer_task(stdin, message_rx);

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

        // Close stdin channel
        *self.stdin_tx.lock().await = None;

        // Kill the child process if still running
        if let Some(mut child) = self.child.lock().await.take() {
            let _ = child.kill().await;
        }

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

        if let Some(tx) = self.stdin_tx.lock().await.as_ref() {
            tx.send(json)
                .await
                .map_err(|e| McpError::transport(format!("Failed to send message: {}", e)))?;
        } else {
            return Err(McpError::transport("Stdin channel not available"));
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
        if let Some(stdin_tx) = self.stdin_tx.lock().await.as_ref() {
            stdin_tx
                .send(json)
                .await
                .map_err(|e| McpError::transport(format!("Failed to send request: {}", e)))?;
        } else {
            // Remove pending request on failure
            self.pending_requests.lock().await.remove(&id_str);
            return Err(McpError::transport("Stdin channel not available"));
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
        // Note: In a real implementation, we'd need to handle multiple subscribers
        // For now, we just create a new channel
        let event_tx = self.event_tx.clone();
        tokio::spawn(async move {
            *event_tx.lock().await = Some(tx);
        });
        rx
    }
}

impl Drop for StdioTransport {
    fn drop(&mut self) {
        // Attempt to clean up the child process
        // Note: This is best-effort since we can't await in drop
        if let Ok(mut child_guard) = self.child.try_lock() {
            if let Some(ref mut child) = *child_guard {
                // Try to kill the process
                let _ = child.start_kill();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stdio_config() {
        let config = StdioConfig {
            command: "node".to_string(),
            args: vec!["server.js".to_string()],
            env: HashMap::new(),
            cwd: None,
        };
        assert_eq!(config.command, "node");
        assert_eq!(config.args, vec!["server.js"]);
    }

    #[test]
    fn test_stdio_transport_new() {
        let config = StdioConfig {
            command: "echo".to_string(),
            args: vec![],
            env: HashMap::new(),
            cwd: None,
        };
        let transport = StdioTransport::new(config, ConnectionOptions::default());
        assert_eq!(transport.transport_type(), TransportType::Stdio);
        assert_eq!(transport.state(), TransportState::Disconnected);
    }

    #[test]
    fn test_next_request_id() {
        let config = StdioConfig {
            command: "echo".to_string(),
            args: vec![],
            env: HashMap::new(),
            cwd: None,
        };
        let transport = StdioTransport::new(config, ConnectionOptions::default());

        let id1 = transport.next_request_id();
        let id2 = transport.next_request_id();

        assert_ne!(id1, id2);
        assert!(id1.starts_with("req-"));
        assert!(id2.starts_with("req-"));
    }

    #[test]
    fn test_from_config() {
        let config = TransportConfig::Stdio {
            command: "node".to_string(),
            args: vec!["server.js".to_string()],
            env: HashMap::new(),
            cwd: None,
        };
        let transport = StdioTransport::from_config(config, ConnectionOptions::default());
        assert!(transport.is_ok());
    }

    #[test]
    fn test_from_config_wrong_type() {
        let config = TransportConfig::Http {
            url: "http://localhost:8080".to_string(),
            headers: HashMap::new(),
        };
        let transport = StdioTransport::from_config(config, ConnectionOptions::default());
        assert!(transport.is_err());
    }

    #[tokio::test]
    async fn test_connect_invalid_command() {
        let config = StdioConfig {
            command: "nonexistent_command_12345".to_string(),
            args: vec![],
            env: HashMap::new(),
            cwd: None,
        };
        let mut transport = StdioTransport::new(config, ConnectionOptions::default());
        let result = transport.connect().await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_send_not_connected() {
        let config = StdioConfig {
            command: "echo".to_string(),
            args: vec![],
            env: HashMap::new(),
            cwd: None,
        };
        let mut transport = StdioTransport::new(config, ConnectionOptions::default());

        let request = McpRequest::new(serde_json::json!(1), "test/method");
        let result = transport.send(McpMessage::Request(request)).await;
        assert!(result.is_err());
    }
}
