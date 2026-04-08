//! HTTP Transport Implementation
//!
//! This module implements the HTTP transport for MCP communication.
//! It uses HTTP POST requests for request/response communication.
//!
//! # Message Format
//!
//! Messages are sent as JSON-RPC 2.0 format in HTTP POST request bodies.
//! Responses are received as JSON-RPC 2.0 format in HTTP response bodies.

use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, Mutex, RwLock};

use crate::mcp::error::{McpError, McpResult};
use crate::mcp::transport::{
    McpMessage, McpRequest, McpResponse, Transport, TransportConfig, TransportEvent, TransportState,
};
use crate::mcp::types::{ConnectionOptions, TransportType};

/// HTTP-specific configuration
#[derive(Debug, Clone)]
pub struct HttpConfig {
    /// Server URL
    pub url: String,
    /// HTTP headers
    pub headers: HashMap<String, String>,
}

/// HTTP transport for MCP communication
///
/// This transport uses HTTP POST requests for request/response communication.
/// Each request is sent as a separate HTTP POST request and the response
/// is received in the HTTP response body.
pub struct HttpTransport {
    /// Transport configuration
    config: HttpConfig,
    /// Connection options
    options: ConnectionOptions,
    /// Current transport state
    state: Arc<RwLock<TransportState>>,
    /// HTTP client
    client: Option<reqwest::Client>,
    /// Event channel sender
    event_tx: Arc<Mutex<Option<mpsc::Sender<TransportEvent>>>>,
    /// Request ID counter
    request_counter: AtomicU64,
}

impl HttpTransport {
    /// Create a new HTTP transport
    pub fn new(config: HttpConfig, options: ConnectionOptions) -> Self {
        Self {
            config,
            options,
            state: Arc::new(RwLock::new(TransportState::Disconnected)),
            client: None,
            event_tx: Arc::new(Mutex::new(None)),
            request_counter: AtomicU64::new(1),
        }
    }

    /// Create from transport config
    pub fn from_config(config: TransportConfig, options: ConnectionOptions) -> McpResult<Self> {
        match config {
            TransportConfig::Http { url, headers } | TransportConfig::Sse { url, headers } => {
                Ok(Self::new(HttpConfig { url, headers }, options))
            }
            _ => Err(McpError::config("Expected HTTP transport configuration")),
        }
    }

    /// Generate a unique request ID
    pub fn next_request_id(&self) -> String {
        let id = self.request_counter.fetch_add(1, Ordering::SeqCst);
        format!("http-req-{}", id)
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
}

#[async_trait]
impl Transport for HttpTransport {
    fn transport_type(&self) -> TransportType {
        TransportType::Http
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

        // Build HTTP client with headers
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            reqwest::header::CONTENT_TYPE,
            reqwest::header::HeaderValue::from_static("application/json"),
        );

        for (key, value) in &self.config.headers {
            if let (Ok(name), Ok(val)) = (
                reqwest::header::HeaderName::from_bytes(key.as_bytes()),
                reqwest::header::HeaderValue::from_str(value),
            ) {
                headers.insert(name, val);
            }
        }

        let client = reqwest::Client::builder()
            .default_headers(headers)
            .timeout(self.options.timeout)
            .build()
            .map_err(|e| McpError::transport_with_source("Failed to create HTTP client", e))?;

        self.client = Some(client);
        self.set_state(TransportState::Connected).await;
        self.emit_event(TransportEvent::Connected).await;

        Ok(())
    }

    async fn disconnect(&mut self) -> McpResult<()> {
        self.set_state(TransportState::Closing).await;
        self.client = None;
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

        let client = self
            .client
            .as_ref()
            .ok_or_else(|| McpError::transport("HTTP client not initialized"))?;

        let json = serde_json::to_string(&message)?;

        client
            .post(&self.config.url)
            .body(json)
            .send()
            .await
            .map_err(|e| McpError::transport_with_source("Failed to send HTTP request", e))?;

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

        let client = self
            .client
            .as_ref()
            .ok_or_else(|| McpError::transport("HTTP client not initialized"))?;

        let json = serde_json::to_string(&request)?;

        let response =
            tokio::time::timeout(timeout, client.post(&self.config.url).body(json).send())
                .await
                .map_err(|_| McpError::timeout("HTTP request timed out", timeout))?
                .map_err(|e| McpError::transport_with_source("Failed to send HTTP request", e))?;

        // Check HTTP status
        let status = response.status();
        if !status.is_success() {
            return Err(McpError::transport(format!(
                "HTTP request failed with status: {}",
                status
            )));
        }

        let body = response
            .text()
            .await
            .map_err(|e| McpError::transport_with_source("Failed to read response body", e))?;

        let mcp_response: McpResponse = serde_json::from_str(&body)?;

        Ok(mcp_response)
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
    fn test_http_config() {
        let config = HttpConfig {
            url: "http://localhost:8080".to_string(),
            headers: HashMap::new(),
        };
        assert_eq!(config.url, "http://localhost:8080");
    }

    #[test]
    fn test_http_transport_new() {
        let config = HttpConfig {
            url: "http://localhost:8080".to_string(),
            headers: HashMap::new(),
        };
        let transport = HttpTransport::new(config, ConnectionOptions::default());
        assert_eq!(transport.transport_type(), TransportType::Http);
        assert_eq!(transport.state(), TransportState::Disconnected);
    }

    #[test]
    fn test_from_config() {
        let config = TransportConfig::Http {
            url: "http://localhost:8080".to_string(),
            headers: HashMap::new(),
        };
        let transport = HttpTransport::from_config(config, ConnectionOptions::default());
        assert!(transport.is_ok());
    }

    #[test]
    fn test_from_config_sse() {
        let config = TransportConfig::Sse {
            url: "http://localhost:8080/sse".to_string(),
            headers: HashMap::new(),
        };
        let transport = HttpTransport::from_config(config, ConnectionOptions::default());
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
        let transport = HttpTransport::from_config(config, ConnectionOptions::default());
        assert!(transport.is_err());
    }

    #[test]
    fn test_next_request_id() {
        let config = HttpConfig {
            url: "http://localhost:8080".to_string(),
            headers: HashMap::new(),
        };
        let transport = HttpTransport::new(config, ConnectionOptions::default());

        let id1 = transport.next_request_id();
        let id2 = transport.next_request_id();

        assert_ne!(id1, id2);
        assert!(id1.starts_with("http-req-"));
        assert!(id2.starts_with("http-req-"));
    }

    #[tokio::test]
    async fn test_connect_creates_client() {
        let config = HttpConfig {
            url: "http://localhost:8080".to_string(),
            headers: HashMap::new(),
        };
        let mut transport = HttpTransport::new(config, ConnectionOptions::default());

        let result = transport.connect().await;
        assert!(result.is_ok());
        assert_eq!(transport.state(), TransportState::Connected);
        assert!(transport.client.is_some());
    }

    #[tokio::test]
    async fn test_disconnect() {
        let config = HttpConfig {
            url: "http://localhost:8080".to_string(),
            headers: HashMap::new(),
        };
        let mut transport = HttpTransport::new(config, ConnectionOptions::default());

        transport.connect().await.unwrap();
        let result = transport.disconnect().await;

        assert!(result.is_ok());
        assert_eq!(transport.state(), TransportState::Disconnected);
        assert!(transport.client.is_none());
    }

    #[tokio::test]
    async fn test_send_not_connected() {
        let config = HttpConfig {
            url: "http://localhost:8080".to_string(),
            headers: HashMap::new(),
        };
        let mut transport = HttpTransport::new(config, ConnectionOptions::default());

        let request = McpRequest::new(serde_json::json!(1), "test/method");
        let result = transport.send(McpMessage::Request(request)).await;
        assert!(result.is_err());
    }
}
