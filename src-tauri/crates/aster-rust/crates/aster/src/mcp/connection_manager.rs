//! MCP Connection Manager
//!
//! This module implements the connection manager for MCP servers.
//! It manages multiple connections, handles reconnection, heartbeat monitoring,
//! and provides a unified interface for sending requests to MCP servers.
//!
//! # Features
//!
//! - Multi-transport support (stdio, HTTP, SSE, WebSocket)
//! - Automatic reconnection with exponential backoff
//! - Heartbeat monitoring for connection health
//! - Request/response matching by ID
//! - Connection pooling and lifecycle management

use async_trait::async_trait;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, Mutex, RwLock};
use uuid::Uuid;

use crate::mcp::error::{McpError, McpResult};
use crate::mcp::transport::{
    BoxedTransport, McpRequest, McpResponse, TransportConfig, TransportFactory, TransportState,
};
use crate::mcp::types::{
    ConnectionOptions, ConnectionStatus, McpConnection, McpServerInfo, TransportType,
};

/// Connection event for monitoring connection state changes
#[derive(Debug, Clone)]
pub enum ConnectionEvent {
    /// Connection is being established
    Establishing(McpConnection),
    /// Connection established successfully
    Established(McpConnection),
    /// Connection closed
    Closed(McpConnection),
    /// Connection error occurred
    Error(McpConnection, String),
    /// Reconnection attempt started
    Reconnecting(McpConnection),
    /// Heartbeat failed
    HeartbeatFailed(String, String),
}

/// Internal connection state
struct ConnectionState {
    /// Connection info
    info: McpConnection,
    /// Transport instance
    transport: BoxedTransport,
    /// Server info used to create this connection (for reconnection)
    #[allow(dead_code)]
    server_info: McpServerInfo,
    /// Reconnection attempt count (for exponential backoff)
    #[allow(dead_code)]
    reconnect_attempts: u32,
    /// Last heartbeat time
    last_heartbeat: Option<chrono::DateTime<Utc>>,
    /// Heartbeat task handle
    heartbeat_handle: Option<tokio::task::JoinHandle<()>>,
}

/// Pending request info for tracking and cancellation
#[derive(Debug, Clone)]
pub struct PendingRequestInfo {
    /// Request ID
    pub request_id: String,
    /// Connection ID
    pub connection_id: String,
    /// Method name
    pub method: String,
    /// Start time
    pub start_time: chrono::DateTime<Utc>,
}

/// Connection manager trait
///
/// Defines the interface for managing MCP server connections.
#[async_trait]
pub trait ConnectionManager: Send + Sync {
    /// Connect to an MCP server
    async fn connect(&self, server: McpServerInfo) -> McpResult<McpConnection>;

    /// Disconnect from a server
    async fn disconnect(&self, connection_id: &str) -> McpResult<()>;

    /// Disconnect all connections
    async fn disconnect_all(&self) -> McpResult<()>;

    /// Send a request to a server
    async fn send(&self, connection_id: &str, request: McpRequest) -> McpResult<McpResponse>;

    /// Send a request with timeout
    async fn send_with_timeout(
        &self,
        connection_id: &str,
        request: McpRequest,
        timeout: Duration,
    ) -> McpResult<McpResponse>;

    /// Send a request with retry
    async fn send_with_retry(
        &self,
        connection_id: &str,
        request: McpRequest,
    ) -> McpResult<McpResponse>;

    /// Cancel a pending request by sending a cancellation notification
    async fn cancel_request(&self, connection_id: &str, request_id: &str) -> McpResult<()>;

    /// Get a connection by ID
    fn get_connection(&self, id: &str) -> Option<McpConnection>;

    /// Get a connection by server name
    fn get_connection_by_server(&self, server_name: &str) -> Option<McpConnection>;

    /// Get all connections
    fn get_all_connections(&self) -> Vec<McpConnection>;

    /// Subscribe to connection events
    fn subscribe(&self) -> mpsc::Receiver<ConnectionEvent>;
}

/// Default implementation of the connection manager
pub struct McpConnectionManager {
    /// Active connections
    connections: Arc<RwLock<HashMap<String, ConnectionState>>>,
    /// Server name to connection ID mapping
    server_to_connection: Arc<RwLock<HashMap<String, String>>>,
    /// Default connection options
    pub default_options: ConnectionOptions,
    /// Event channel sender
    event_tx: Arc<Mutex<Option<mpsc::Sender<ConnectionEvent>>>>,
    /// Request ID counter
    request_counter: AtomicU64,
    /// Enable heartbeat monitoring
    enable_heartbeat: bool,
    /// Enable auto-reconnect
    enable_auto_reconnect: bool,
}

impl McpConnectionManager {
    /// Create a new connection manager with default options
    pub fn new() -> Self {
        Self::with_options(ConnectionOptions::default())
    }

    /// Create a new connection manager with custom options
    pub fn with_options(options: ConnectionOptions) -> Self {
        Self {
            connections: Arc::new(RwLock::new(HashMap::new())),
            server_to_connection: Arc::new(RwLock::new(HashMap::new())),
            default_options: options,
            event_tx: Arc::new(Mutex::new(None)),
            request_counter: AtomicU64::new(1),
            enable_heartbeat: true,
            enable_auto_reconnect: true,
        }
    }

    /// Enable or disable heartbeat monitoring
    pub fn set_heartbeat_enabled(&mut self, enabled: bool) {
        self.enable_heartbeat = enabled;
    }

    /// Enable or disable auto-reconnect
    pub fn set_auto_reconnect_enabled(&mut self, enabled: bool) {
        self.enable_auto_reconnect = enabled;
    }

    /// Generate a unique connection ID
    pub fn generate_connection_id() -> String {
        Uuid::new_v4().to_string()
    }

    /// Generate a unique request ID
    pub fn next_request_id(&self) -> String {
        let id = self.request_counter.fetch_add(1, Ordering::SeqCst);
        format!("mcp-req-{}", id)
    }

    /// Emit a connection event
    async fn emit_event(&self, event: ConnectionEvent) {
        if let Some(tx) = self.event_tx.lock().await.as_ref() {
            let _ = tx.send(event).await;
        }
    }

    /// Create transport config from server info
    pub fn create_transport_config(server: &McpServerInfo) -> McpResult<TransportConfig> {
        match server.transport_type {
            TransportType::Stdio => {
                let command = server
                    .command
                    .clone()
                    .ok_or_else(|| McpError::config("Stdio transport requires a command"))?;
                Ok(TransportConfig::Stdio {
                    command,
                    args: server.args.clone().unwrap_or_default(),
                    env: server.env.clone().unwrap_or_default(),
                    cwd: None,
                })
            }
            TransportType::Http => {
                let url = server
                    .url
                    .clone()
                    .ok_or_else(|| McpError::config("HTTP transport requires a URL"))?;
                Ok(TransportConfig::Http {
                    url,
                    headers: server.headers.clone().unwrap_or_default(),
                })
            }
            TransportType::Sse => {
                let url = server
                    .url
                    .clone()
                    .ok_or_else(|| McpError::config("SSE transport requires a URL"))?;
                Ok(TransportConfig::Sse {
                    url,
                    headers: server.headers.clone().unwrap_or_default(),
                })
            }
            TransportType::WebSocket => {
                let url = server
                    .url
                    .clone()
                    .ok_or_else(|| McpError::config("WebSocket transport requires a URL"))?;
                Ok(TransportConfig::WebSocket {
                    url,
                    headers: server.headers.clone().unwrap_or_default(),
                })
            }
        }
    }

    /// Perform MCP protocol handshake
    async fn perform_handshake(
        transport: &mut BoxedTransport,
        connection: &mut McpConnection,
    ) -> McpResult<()> {
        // Send initialize request
        let init_request = McpRequest::with_params(
            serde_json::json!("init-1"),
            "initialize",
            serde_json::json!({
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "roots": { "listChanged": true },
                    "sampling": {}
                },
                "clientInfo": {
                    "name": "aster",
                    "version": env!("CARGO_PKG_VERSION")
                }
            }),
        );

        let response = transport.send_request(init_request).await?;

        // Parse server capabilities from response
        if let Some(result) = response.result {
            if let Some(protocol_version) = result.get("protocolVersion").and_then(|v| v.as_str()) {
                connection.protocol_version = Some(protocol_version.to_string());
            }

            // Parse capabilities if available
            if let Some(capabilities) = result.get("capabilities") {
                if let Ok(caps) = serde_json::from_value(capabilities.clone()) {
                    connection.capabilities = Some(caps);
                }
            }
        }

        // Send initialized notification
        let initialized_notification =
            crate::mcp::transport::McpNotification::new("notifications/initialized");
        transport
            .send(crate::mcp::transport::McpMessage::Notification(
                initialized_notification,
            ))
            .await?;

        Ok(())
    }

    /// Start heartbeat monitoring for a connection
    fn start_heartbeat(&self, connection_id: String, interval: Duration) {
        let connections = self.connections.clone();
        let event_tx = self.event_tx.clone();
        let enable_auto_reconnect = self.enable_auto_reconnect;

        tokio::spawn(async move {
            let mut interval_timer = tokio::time::interval(interval);

            loop {
                interval_timer.tick().await;

                let mut conns = connections.write().await;
                if let Some(state) = conns.get_mut(&connection_id) {
                    // Check if transport is still connected
                    if state.transport.state() != TransportState::Connected {
                        // Emit heartbeat failed event
                        if let Some(tx) = event_tx.lock().await.as_ref() {
                            let _ = tx
                                .send(ConnectionEvent::HeartbeatFailed(
                                    connection_id.clone(),
                                    "Transport disconnected".to_string(),
                                ))
                                .await;
                        }

                        // Attempt reconnection if enabled
                        if enable_auto_reconnect {
                            state.info.status = ConnectionStatus::Reconnecting;
                            // Reconnection will be handled by the reconnect logic
                        }
                        break;
                    }

                    // Send ping request to check connection health
                    let ping_request = McpRequest::new(
                        serde_json::json!(format!("ping-{}", Uuid::new_v4())),
                        "ping",
                    );

                    match state.transport.send_request(ping_request).await {
                        Ok(_) => {
                            state.last_heartbeat = Some(Utc::now());
                            state.info.last_activity = Utc::now();
                        }
                        Err(e) => {
                            // Emit heartbeat failed event
                            if let Some(tx) = event_tx.lock().await.as_ref() {
                                let _ = tx
                                    .send(ConnectionEvent::HeartbeatFailed(
                                        connection_id.clone(),
                                        e.to_string(),
                                    ))
                                    .await;
                            }

                            if enable_auto_reconnect {
                                state.info.status = ConnectionStatus::Reconnecting;
                            }
                            break;
                        }
                    }
                } else {
                    // Connection no longer exists
                    break;
                }
            }
        });
    }

    /// Calculate reconnection delay with exponential backoff
    pub fn calculate_reconnect_delay(&self, attempt: u32) -> Duration {
        let base = self.default_options.reconnect_delay_base.as_millis() as u64;
        let max = self.default_options.reconnect_delay_max.as_millis() as u64;

        // Exponential backoff: base * 2^attempt
        let delay_ms = base.saturating_mul(1u64 << attempt.min(10));
        Duration::from_millis(delay_ms.min(max))
    }

    /// Attempt to reconnect a disconnected connection
    ///
    /// This method implements automatic reconnection with exponential backoff.
    /// It will retry up to `max_retries` times before giving up.
    pub async fn reconnect(&self, connection_id: &str) -> McpResult<McpConnection> {
        let (server_info, max_retries) = {
            let conns = self.connections.read().await;
            if let Some(state) = conns.get(connection_id) {
                (state.server_info.clone(), self.default_options.max_retries)
            } else {
                return Err(McpError::connection(format!(
                    "Connection not found: {}",
                    connection_id
                )));
            }
        };

        // Update status to reconnecting
        {
            let mut conns = self.connections.write().await;
            if let Some(state) = conns.get_mut(connection_id) {
                state.info.status = ConnectionStatus::Reconnecting;
                self.emit_event(ConnectionEvent::Reconnecting(state.info.clone()))
                    .await;
            }
        }

        let mut last_error = None;

        for attempt in 0..=max_retries {
            if attempt > 0 {
                let delay = self.calculate_reconnect_delay(attempt - 1);
                tokio::time::sleep(delay).await;
            }

            // Try to reconnect
            match self.try_reconnect(connection_id, &server_info).await {
                Ok(connection) => {
                    // Reset reconnect attempts on success
                    {
                        let mut conns = self.connections.write().await;
                        if let Some(state) = conns.get_mut(connection_id) {
                            state.reconnect_attempts = 0;
                        }
                    }
                    return Ok(connection);
                }
                Err(e) => {
                    last_error = Some(e);
                    // Update reconnect attempts
                    {
                        let mut conns = self.connections.write().await;
                        if let Some(state) = conns.get_mut(connection_id) {
                            state.reconnect_attempts = attempt + 1;
                        }
                    }
                }
            }
        }

        // All retries failed
        {
            let mut conns = self.connections.write().await;
            if let Some(state) = conns.get_mut(connection_id) {
                state.info.status = ConnectionStatus::Error;
                self.emit_event(ConnectionEvent::Error(
                    state.info.clone(),
                    last_error
                        .as_ref()
                        .map(|e| e.to_string())
                        .unwrap_or_else(|| "Unknown error".to_string()),
                ))
                .await;
            }
        }

        Err(last_error.unwrap_or_else(|| McpError::connection("Reconnection failed after retries")))
    }

    /// Internal method to attempt a single reconnection
    async fn try_reconnect(
        &self,
        connection_id: &str,
        server_info: &McpServerInfo,
    ) -> McpResult<McpConnection> {
        // Create new transport
        let transport_config = Self::create_transport_config(server_info)?;
        let mut transport =
            TransportFactory::create(transport_config, server_info.options.clone())?;

        // Connect transport
        transport.connect().await?;

        // Create new connection info
        let mut connection = McpConnection::new(
            connection_id.to_string(),
            server_info.name.clone(),
            server_info.transport_type,
        );

        // Perform handshake
        Self::perform_handshake(&mut transport, &mut connection).await?;

        // Update connection status
        connection.status = ConnectionStatus::Connected;
        connection.touch();

        // Update stored connection
        {
            let mut conns = self.connections.write().await;
            if let Some(state) = conns.get_mut(connection_id) {
                state.info = connection.clone();
                state.transport = transport;
                state.last_heartbeat = Some(Utc::now());
            }
        }

        // Emit established event
        self.emit_event(ConnectionEvent::Established(connection.clone()))
            .await;

        Ok(connection)
    }
}

impl Default for McpConnectionManager {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl ConnectionManager for McpConnectionManager {
    async fn connect(&self, server: McpServerInfo) -> McpResult<McpConnection> {
        // Check if already connected to this server
        {
            let server_map = self.server_to_connection.read().await;
            if let Some(conn_id) = server_map.get(&server.name) {
                let conns = self.connections.read().await;
                if let Some(state) = conns.get(conn_id) {
                    if state.info.status == ConnectionStatus::Connected {
                        return Ok(state.info.clone());
                    }
                }
            }
        }

        // Create connection ID and info
        let connection_id = Self::generate_connection_id();
        let mut connection = McpConnection::new(
            connection_id.clone(),
            server.name.clone(),
            server.transport_type,
        );

        // Emit establishing event
        self.emit_event(ConnectionEvent::Establishing(connection.clone()))
            .await;

        // Create transport config
        let transport_config = Self::create_transport_config(&server)?;

        // Create and connect transport
        let options = server.options.clone();
        let mut transport = TransportFactory::create(transport_config, options.clone())?;

        transport.connect().await?;

        // Perform MCP handshake
        Self::perform_handshake(&mut transport, &mut connection).await?;

        // Update connection status
        connection.status = ConnectionStatus::Connected;
        connection.touch();

        // Store connection
        {
            let mut conns = self.connections.write().await;
            conns.insert(
                connection_id.clone(),
                ConnectionState {
                    info: connection.clone(),
                    transport,
                    server_info: server.clone(),
                    reconnect_attempts: 0,
                    last_heartbeat: Some(Utc::now()),
                    heartbeat_handle: None,
                },
            );
        }

        // Update server mapping
        {
            let mut server_map = self.server_to_connection.write().await;
            server_map.insert(server.name.clone(), connection_id.clone());
        }

        // Start heartbeat if enabled
        if self.enable_heartbeat {
            self.start_heartbeat(connection_id, options.heartbeat_interval);
        }

        // Emit established event
        self.emit_event(ConnectionEvent::Established(connection.clone()))
            .await;

        Ok(connection)
    }

    async fn disconnect(&self, connection_id: &str) -> McpResult<()> {
        let mut conns = self.connections.write().await;

        if let Some(mut state) = conns.remove(connection_id) {
            // Cancel heartbeat task
            if let Some(handle) = state.heartbeat_handle.take() {
                handle.abort();
            }

            // Disconnect transport
            state.transport.disconnect().await?;

            // Update status
            state.info.status = ConnectionStatus::Disconnected;

            // Remove from server mapping
            {
                let mut server_map = self.server_to_connection.write().await;
                server_map.remove(&state.info.server_name);
            }

            // Emit closed event
            self.emit_event(ConnectionEvent::Closed(state.info)).await;

            Ok(())
        } else {
            Err(McpError::connection(format!(
                "Connection not found: {}",
                connection_id
            )))
        }
    }

    async fn disconnect_all(&self) -> McpResult<()> {
        let connection_ids: Vec<String> = {
            let conns = self.connections.read().await;
            conns.keys().cloned().collect()
        };

        for id in connection_ids {
            if let Err(e) = self.disconnect(&id).await {
                tracing::warn!("Failed to disconnect {}: {}", id, e);
            }
        }

        Ok(())
    }

    async fn send(&self, connection_id: &str, request: McpRequest) -> McpResult<McpResponse> {
        let mut conns = self.connections.write().await;

        if let Some(state) = conns.get_mut(connection_id) {
            if state.info.status != ConnectionStatus::Connected {
                return Err(McpError::connection("Connection is not active"));
            }

            let response = state.transport.send_request(request).await?;
            state.info.touch();

            Ok(response)
        } else {
            Err(McpError::connection(format!(
                "Connection not found: {}",
                connection_id
            )))
        }
    }

    async fn send_with_timeout(
        &self,
        connection_id: &str,
        request: McpRequest,
        timeout: Duration,
    ) -> McpResult<McpResponse> {
        let mut conns = self.connections.write().await;

        if let Some(state) = conns.get_mut(connection_id) {
            if state.info.status != ConnectionStatus::Connected {
                return Err(McpError::connection("Connection is not active"));
            }

            let response = state
                .transport
                .send_request_with_timeout(request, timeout)
                .await?;
            state.info.touch();

            Ok(response)
        } else {
            Err(McpError::connection(format!(
                "Connection not found: {}",
                connection_id
            )))
        }
    }

    async fn send_with_retry(
        &self,
        connection_id: &str,
        request: McpRequest,
    ) -> McpResult<McpResponse> {
        let max_retries = self.default_options.max_retries;
        let mut last_error = None;

        for attempt in 0..=max_retries {
            match self.send(connection_id, request.clone()).await {
                Ok(response) => return Ok(response),
                Err(e) => {
                    last_error = Some(e);
                    if attempt < max_retries {
                        let delay = self.calculate_reconnect_delay(attempt);
                        tokio::time::sleep(delay).await;
                    }
                }
            }
        }

        Err(last_error.unwrap_or_else(|| McpError::connection("Request failed after retries")))
    }

    async fn cancel_request(&self, connection_id: &str, request_id: &str) -> McpResult<()> {
        let mut conns = self.connections.write().await;

        if let Some(state) = conns.get_mut(connection_id) {
            if state.info.status != ConnectionStatus::Connected {
                return Err(McpError::connection("Connection is not active"));
            }

            // Send cancellation notification per MCP protocol
            let cancel_notification = crate::mcp::transport::McpNotification::with_params(
                "notifications/cancelled",
                serde_json::json!({
                    "requestId": request_id,
                    "reason": "Cancelled by client"
                }),
            );

            state
                .transport
                .send(crate::mcp::transport::McpMessage::Notification(
                    cancel_notification,
                ))
                .await?;

            Ok(())
        } else {
            Err(McpError::connection(format!(
                "Connection not found: {}",
                connection_id
            )))
        }
    }

    fn get_connection(&self, id: &str) -> Option<McpConnection> {
        // Use try_read to avoid blocking
        self.connections
            .try_read()
            .ok()
            .and_then(|conns| conns.get(id).map(|s| s.info.clone()))
    }

    fn get_connection_by_server(&self, server_name: &str) -> Option<McpConnection> {
        let server_map = self.server_to_connection.try_read().ok()?;
        let conn_id = server_map.get(server_name)?;
        self.get_connection(conn_id)
    }

    fn get_all_connections(&self) -> Vec<McpConnection> {
        self.connections
            .try_read()
            .map(|conns| conns.values().map(|s| s.info.clone()).collect())
            .unwrap_or_default()
    }

    fn subscribe(&self) -> mpsc::Receiver<ConnectionEvent> {
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
    fn test_connection_manager_new() {
        let manager = McpConnectionManager::new();
        assert!(manager.get_all_connections().is_empty());
    }

    #[test]
    fn test_connection_manager_with_options() {
        let options = ConnectionOptions {
            timeout: Duration::from_secs(60),
            max_retries: 5,
            ..Default::default()
        };
        let manager = McpConnectionManager::with_options(options);
        assert_eq!(manager.default_options.timeout, Duration::from_secs(60));
        assert_eq!(manager.default_options.max_retries, 5);
    }

    #[test]
    fn test_generate_connection_id() {
        let id1 = McpConnectionManager::generate_connection_id();
        let id2 = McpConnectionManager::generate_connection_id();
        assert_ne!(id1, id2);
        // Should be valid UUID format
        assert!(Uuid::parse_str(&id1).is_ok());
    }

    #[test]
    fn test_next_request_id() {
        let manager = McpConnectionManager::new();
        let id1 = manager.next_request_id();
        let id2 = manager.next_request_id();
        assert_ne!(id1, id2);
        assert!(id1.starts_with("mcp-req-"));
    }

    #[test]
    fn test_calculate_reconnect_delay() {
        let manager = McpConnectionManager::new();

        let delay0 = manager.calculate_reconnect_delay(0);
        let delay1 = manager.calculate_reconnect_delay(1);
        let delay2 = manager.calculate_reconnect_delay(2);

        // Each delay should be roughly double the previous
        assert!(delay1 > delay0);
        assert!(delay2 > delay1);

        // Should not exceed max
        let delay_max = manager.calculate_reconnect_delay(100);
        assert!(delay_max <= manager.default_options.reconnect_delay_max);
    }

    #[test]
    fn test_create_transport_config_stdio() {
        let server = McpServerInfo {
            name: "test".to_string(),
            transport_type: TransportType::Stdio,
            command: Some("node".to_string()),
            args: Some(vec!["server.js".to_string()]),
            env: None,
            url: None,
            headers: None,
            options: ConnectionOptions::default(),
        };

        let config = McpConnectionManager::create_transport_config(&server);
        assert!(config.is_ok());
        assert_eq!(config.unwrap().transport_type(), TransportType::Stdio);
    }

    #[test]
    fn test_create_transport_config_http() {
        let server = McpServerInfo {
            name: "test".to_string(),
            transport_type: TransportType::Http,
            command: None,
            args: None,
            env: None,
            url: Some("http://localhost:8080".to_string()),
            headers: None,
            options: ConnectionOptions::default(),
        };

        let config = McpConnectionManager::create_transport_config(&server);
        assert!(config.is_ok());
        assert_eq!(config.unwrap().transport_type(), TransportType::Http);
    }

    #[test]
    fn test_create_transport_config_missing_command() {
        let server = McpServerInfo {
            name: "test".to_string(),
            transport_type: TransportType::Stdio,
            command: None, // Missing required command
            args: None,
            env: None,
            url: None,
            headers: None,
            options: ConnectionOptions::default(),
        };

        let config = McpConnectionManager::create_transport_config(&server);
        assert!(config.is_err());
    }

    #[test]
    fn test_create_transport_config_missing_url() {
        let server = McpServerInfo {
            name: "test".to_string(),
            transport_type: TransportType::Http,
            command: None,
            args: None,
            env: None,
            url: None, // Missing required URL
            headers: None,
            options: ConnectionOptions::default(),
        };

        let config = McpConnectionManager::create_transport_config(&server);
        assert!(config.is_err());
    }

    #[tokio::test]
    async fn test_get_connection_not_found() {
        let manager = McpConnectionManager::new();
        let conn = manager.get_connection("nonexistent");
        assert!(conn.is_none());
    }

    #[tokio::test]
    async fn test_get_connection_by_server_not_found() {
        let manager = McpConnectionManager::new();
        let conn = manager.get_connection_by_server("nonexistent");
        assert!(conn.is_none());
    }

    #[tokio::test]
    async fn test_disconnect_not_found() {
        let manager = McpConnectionManager::new();
        let result = manager.disconnect("nonexistent").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_send_not_found() {
        let manager = McpConnectionManager::new();
        let request = McpRequest::new(serde_json::json!(1), "test");
        let result = manager.send("nonexistent", request).await;
        assert!(result.is_err());
    }
}
