//! MCP Transport Base Types
//!
//! This module defines the Transport trait and related types for MCP communication.
//! It supports multiple transport types: stdio, HTTP, SSE, and WebSocket.
//!
//! # Architecture
//!
//! The transport layer provides an abstraction over different communication mechanisms:
//!
//! - **Stdio**: Subprocess communication via stdin/stdout
//! - **HTTP**: HTTP POST requests for request/response
//! - **SSE**: Server-Sent Events for streaming
//! - **WebSocket**: Full-duplex WebSocket connections
//!
//! Each transport implements the `Transport` trait which provides async send/receive
//! capabilities with proper error handling.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;

use crate::mcp::error::{McpError, McpResult};
use crate::mcp::types::{ConnectionOptions, TransportType};

/// JSON-RPC request ID type
pub type RequestId = serde_json::Value;

/// MCP JSON-RPC Request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpRequest {
    /// JSON-RPC version (always "2.0")
    pub jsonrpc: String,
    /// Request ID for matching responses
    pub id: RequestId,
    /// Method name
    pub method: String,
    /// Optional parameters
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
}

impl McpRequest {
    /// Create a new MCP request
    pub fn new(id: impl Into<RequestId>, method: impl Into<String>) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id: id.into(),
            method: method.into(),
            params: None,
        }
    }

    /// Create a new MCP request with parameters
    pub fn with_params(
        id: impl Into<RequestId>,
        method: impl Into<String>,
        params: serde_json::Value,
    ) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id: id.into(),
            method: method.into(),
            params: Some(params),
        }
    }
}

/// MCP JSON-RPC Response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpResponse {
    /// JSON-RPC version (always "2.0")
    pub jsonrpc: String,
    /// Request ID matching the request
    pub id: RequestId,
    /// Result on success
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    /// Error on failure
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<McpErrorData>,
}

impl McpResponse {
    /// Create a success response
    pub fn success(id: RequestId, result: serde_json::Value) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            result: Some(result),
            error: None,
        }
    }

    /// Create an error response
    pub fn error(id: RequestId, error: McpErrorData) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            result: None,
            error: Some(error),
        }
    }

    /// Check if the response is an error
    pub fn is_error(&self) -> bool {
        self.error.is_some()
    }

    /// Convert to Result
    pub fn into_result(self) -> McpResult<serde_json::Value> {
        if let Some(error) = self.error {
            Err(McpError::server(error.code, error.message, error.data))
        } else {
            self.result
                .ok_or_else(|| McpError::protocol("Response contains neither result nor error"))
        }
    }
}

/// MCP JSON-RPC Error Data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpErrorData {
    /// Error code
    pub code: i32,
    /// Error message
    pub message: String,
    /// Optional additional data
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

impl McpErrorData {
    /// Create a new error data
    pub fn new(code: i32, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            data: None,
        }
    }

    /// Create a new error data with additional data
    pub fn with_data(code: i32, message: impl Into<String>, data: serde_json::Value) -> Self {
        Self {
            code,
            message: message.into(),
            data: Some(data),
        }
    }
}

/// MCP JSON-RPC Notification (no response expected)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpNotification {
    /// JSON-RPC version (always "2.0")
    pub jsonrpc: String,
    /// Method name
    pub method: String,
    /// Optional parameters
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
}

impl McpNotification {
    /// Create a new notification
    pub fn new(method: impl Into<String>) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            method: method.into(),
            params: None,
        }
    }

    /// Create a new notification with parameters
    pub fn with_params(method: impl Into<String>, params: serde_json::Value) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            method: method.into(),
            params: Some(params),
        }
    }
}

/// Message that can be sent/received over transport
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum McpMessage {
    /// A request expecting a response
    Request(McpRequest),
    /// A response to a request
    Response(McpResponse),
    /// A notification (no response expected)
    Notification(McpNotification),
}

impl McpMessage {
    /// Get the request ID if this is a request or response
    pub fn id(&self) -> Option<&RequestId> {
        match self {
            McpMessage::Request(req) => Some(&req.id),
            McpMessage::Response(resp) => Some(&resp.id),
            McpMessage::Notification(_) => None,
        }
    }

    /// Get the method name if this is a request or notification
    pub fn method(&self) -> Option<&str> {
        match self {
            McpMessage::Request(req) => Some(&req.method),
            McpMessage::Response(_) => None,
            McpMessage::Notification(notif) => Some(&notif.method),
        }
    }
}

/// Transport configuration for different transport types
#[derive(Debug, Clone)]
pub enum TransportConfig {
    /// Stdio transport configuration
    Stdio {
        /// Command to execute
        command: String,
        /// Command arguments
        args: Vec<String>,
        /// Environment variables
        env: HashMap<String, String>,
        /// Working directory
        cwd: Option<String>,
    },
    /// HTTP transport configuration
    Http {
        /// Server URL
        url: String,
        /// HTTP headers
        headers: HashMap<String, String>,
    },
    /// SSE transport configuration
    Sse {
        /// Server URL
        url: String,
        /// HTTP headers
        headers: HashMap<String, String>,
    },
    /// WebSocket transport configuration
    WebSocket {
        /// Server URL
        url: String,
        /// HTTP headers for upgrade request
        headers: HashMap<String, String>,
    },
}

impl TransportConfig {
    /// Get the transport type
    pub fn transport_type(&self) -> TransportType {
        match self {
            TransportConfig::Stdio { .. } => TransportType::Stdio,
            TransportConfig::Http { .. } => TransportType::Http,
            TransportConfig::Sse { .. } => TransportType::Sse,
            TransportConfig::WebSocket { .. } => TransportType::WebSocket,
        }
    }
}

/// Transport state
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TransportState {
    /// Transport is disconnected
    #[default]
    Disconnected,
    /// Transport is connecting
    Connecting,
    /// Transport is connected and ready
    Connected,
    /// Transport is closing
    Closing,
    /// Transport encountered an error
    Error,
}

/// Transport event for monitoring transport state changes
#[derive(Debug, Clone)]
pub enum TransportEvent {
    /// Transport is connecting
    Connecting,
    /// Transport connected successfully
    Connected,
    /// Transport disconnected
    Disconnected { reason: Option<String> },
    /// Transport encountered an error
    Error { error: String },
    /// Message received from transport
    MessageReceived(Box<McpMessage>),
}

/// Transport trait for MCP communication
///
/// This trait defines the interface for different transport implementations.
/// All transports must be Send + Sync for use in async contexts.
#[async_trait]
pub trait Transport: Send + Sync {
    /// Get the transport type
    fn transport_type(&self) -> TransportType;

    /// Get the current transport state
    fn state(&self) -> TransportState;

    /// Connect the transport
    ///
    /// This establishes the underlying connection (spawns process, opens socket, etc.)
    async fn connect(&mut self) -> McpResult<()>;

    /// Disconnect the transport
    ///
    /// This closes the underlying connection gracefully.
    async fn disconnect(&mut self) -> McpResult<()>;

    /// Send a message over the transport
    ///
    /// For request messages, use `send_request` instead to get the response.
    async fn send(&mut self, message: McpMessage) -> McpResult<()>;

    /// Send a request and wait for response
    ///
    /// This sends a request message and waits for the matching response.
    async fn send_request(&mut self, request: McpRequest) -> McpResult<McpResponse>;

    /// Send a request with timeout
    ///
    /// This sends a request and waits for response with a timeout.
    async fn send_request_with_timeout(
        &mut self,
        request: McpRequest,
        timeout: Duration,
    ) -> McpResult<McpResponse>;

    /// Subscribe to transport events
    ///
    /// Returns a receiver for transport events (state changes, incoming messages).
    fn subscribe(&self) -> mpsc::Receiver<TransportEvent>;

    /// Check if the transport is connected
    fn is_connected(&self) -> bool {
        self.state() == TransportState::Connected
    }
}

/// Boxed transport type for dynamic dispatch
pub type BoxedTransport = Box<dyn Transport>;

/// Arc-wrapped transport for shared ownership
pub type SharedTransport = Arc<tokio::sync::Mutex<BoxedTransport>>;

/// Transport factory for creating transports from configuration
pub struct TransportFactory;

impl TransportFactory {
    /// Create a transport from configuration
    ///
    /// This creates the appropriate transport implementation based on the config.
    pub fn create(
        config: TransportConfig,
        options: ConnectionOptions,
    ) -> McpResult<BoxedTransport> {
        match config {
            TransportConfig::Stdio {
                command,
                args,
                env,
                cwd,
            } => {
                use super::stdio::{StdioConfig, StdioTransport};
                Ok(Box::new(StdioTransport::new(
                    StdioConfig {
                        command,
                        args,
                        env,
                        cwd,
                    },
                    options,
                )))
            }
            TransportConfig::Http { url, headers } => {
                use super::http::{HttpConfig, HttpTransport};
                Ok(Box::new(HttpTransport::new(
                    HttpConfig { url, headers },
                    options,
                )))
            }
            TransportConfig::Sse { url, headers } => {
                // SSE uses HTTP transport with streaming
                use super::http::{HttpConfig, HttpTransport};
                Ok(Box::new(HttpTransport::new(
                    HttpConfig { url, headers },
                    options,
                )))
            }
            TransportConfig::WebSocket { url, headers } => {
                use super::websocket::{WebSocketConfig, WebSocketTransport};
                Ok(Box::new(WebSocketTransport::new(
                    WebSocketConfig { url, headers },
                    options,
                )))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mcp_request_new() {
        let req = McpRequest::new(serde_json::json!(1), "test/method");
        assert_eq!(req.jsonrpc, "2.0");
        assert_eq!(req.id, serde_json::json!(1));
        assert_eq!(req.method, "test/method");
        assert!(req.params.is_none());
    }

    #[test]
    fn test_mcp_request_with_params() {
        let params = serde_json::json!({"key": "value"});
        let req =
            McpRequest::with_params(serde_json::json!("req-1"), "test/method", params.clone());
        assert_eq!(req.params, Some(params));
    }

    #[test]
    fn test_mcp_response_success() {
        let result = serde_json::json!({"status": "ok"});
        let resp = McpResponse::success(serde_json::json!(1), result.clone());
        assert!(!resp.is_error());
        assert_eq!(resp.result, Some(result));
    }

    #[test]
    fn test_mcp_response_error() {
        let error = McpErrorData::new(-32600, "Invalid Request");
        let resp = McpResponse::error(serde_json::json!(1), error);
        assert!(resp.is_error());
        assert!(resp.result.is_none());
    }

    #[test]
    fn test_mcp_response_into_result() {
        let result = serde_json::json!({"data": 42});
        let resp = McpResponse::success(serde_json::json!(1), result.clone());
        let res = resp.into_result();
        assert!(res.is_ok());
        assert_eq!(res.unwrap(), result);
    }

    #[test]
    fn test_mcp_response_into_result_error() {
        let error = McpErrorData::new(-32600, "Invalid Request");
        let resp = McpResponse::error(serde_json::json!(1), error);
        let res = resp.into_result();
        assert!(res.is_err());
    }

    #[test]
    fn test_mcp_notification() {
        let notif = McpNotification::new("notifications/test");
        assert_eq!(notif.jsonrpc, "2.0");
        assert_eq!(notif.method, "notifications/test");
        assert!(notif.params.is_none());
    }

    #[test]
    fn test_mcp_notification_with_params() {
        let params = serde_json::json!({"event": "update"});
        let notif = McpNotification::with_params("notifications/test", params.clone());
        assert_eq!(notif.params, Some(params));
    }

    #[test]
    fn test_transport_config_type() {
        let stdio = TransportConfig::Stdio {
            command: "node".to_string(),
            args: vec![],
            env: HashMap::new(),
            cwd: None,
        };
        assert_eq!(stdio.transport_type(), TransportType::Stdio);

        let http = TransportConfig::Http {
            url: "http://localhost:8080".to_string(),
            headers: HashMap::new(),
        };
        assert_eq!(http.transport_type(), TransportType::Http);

        let ws = TransportConfig::WebSocket {
            url: "ws://localhost:8080".to_string(),
            headers: HashMap::new(),
        };
        assert_eq!(ws.transport_type(), TransportType::WebSocket);
    }

    #[test]
    fn test_transport_state_default() {
        let state = TransportState::default();
        assert_eq!(state, TransportState::Disconnected);
    }

    #[test]
    fn test_mcp_message_id() {
        let req = McpRequest::new(serde_json::json!(1), "test");
        let msg = McpMessage::Request(req);
        assert_eq!(msg.id(), Some(&serde_json::json!(1)));

        let notif = McpNotification::new("test");
        let msg = McpMessage::Notification(notif);
        assert!(msg.id().is_none());
    }

    #[test]
    fn test_mcp_message_method() {
        let req = McpRequest::new(serde_json::json!(1), "test/method");
        let msg = McpMessage::Request(req);
        assert_eq!(msg.method(), Some("test/method"));

        let resp = McpResponse::success(serde_json::json!(1), serde_json::json!({}));
        let msg = McpMessage::Response(resp);
        assert!(msg.method().is_none());
    }

    #[test]
    fn test_mcp_error_data() {
        let error = McpErrorData::new(-32600, "Invalid Request");
        assert_eq!(error.code, -32600);
        assert_eq!(error.message, "Invalid Request");
        assert!(error.data.is_none());

        let error_with_data = McpErrorData::with_data(
            -32602,
            "Invalid params",
            serde_json::json!({"field": "name"}),
        );
        assert!(error_with_data.data.is_some());
    }
}
