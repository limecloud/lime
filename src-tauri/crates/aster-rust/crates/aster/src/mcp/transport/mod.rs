//! MCP Transport Layer
//!
//! This module provides the transport abstraction and concrete implementations
//! for MCP communication.
//!
//! # Available Transports
//!
//! - **StdioTransport**: Subprocess communication via stdin/stdout
//! - **HttpTransport**: HTTP POST requests for request/response
//! - **WebSocketTransport**: Full-duplex WebSocket connections
//!
//! # Architecture
//!
//! The transport layer provides an abstraction over different communication mechanisms.
//! Each transport implements the `Transport` trait which provides async send/receive
//! capabilities with proper error handling.

mod base;
pub mod http;
pub mod stdio;
pub mod websocket;

// Re-export base types
pub use base::{
    BoxedTransport, McpErrorData, McpMessage, McpNotification, McpRequest, McpResponse, RequestId,
    SharedTransport, Transport, TransportConfig, TransportEvent, TransportFactory, TransportState,
};

// Re-export transport implementations
pub use http::HttpTransport;
pub use stdio::StdioTransport;
pub use websocket::WebSocketTransport;
