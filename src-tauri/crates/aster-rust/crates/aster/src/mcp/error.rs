//! MCP Error types
//!
//! This module defines structured error types for MCP operations,
//! ensuring all errors contain a code and message as per Requirements 8.1.

use std::time::Duration;
use thiserror::Error;

/// MCP error codes following the JSON-RPC 2.0 specification
/// and MCP protocol extensions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpErrorCode {
    // Standard JSON-RPC errors
    /// Invalid JSON was received
    ParseError = -32700,
    /// The JSON sent is not a valid Request object
    InvalidRequest = -32600,
    /// The method does not exist / is not available
    MethodNotFound = -32601,
    /// Invalid method parameter(s)
    InvalidParams = -32602,
    /// Internal JSON-RPC error
    InternalError = -32603,

    // MCP-specific errors (-32000 to -32099)
    /// Connection-related errors
    ConnectionError = -32000,
    /// Transport layer errors
    TransportError = -32001,
    /// Protocol negotiation or handshake errors
    ProtocolError = -32002,
    /// Request timeout
    TimeoutError = -32003,
    /// Operation was cancelled
    CancelledError = -32004,
    /// Configuration validation errors
    ValidationError = -32005,
    /// Configuration loading/saving errors
    ConfigError = -32006,
    /// Server lifecycle errors
    LifecycleError = -32007,
    /// Tool execution errors
    ToolError = -32008,
    /// Resource access errors
    ResourceError = -32009,
    /// Permission denied errors
    PermissionDenied = -32010,
}

impl McpErrorCode {
    /// Returns the numeric code value
    pub fn code(&self) -> i32 {
        *self as i32
    }

    /// Returns a human-readable description of the error code
    pub fn description(&self) -> &'static str {
        match self {
            Self::ParseError => "Parse error",
            Self::InvalidRequest => "Invalid request",
            Self::MethodNotFound => "Method not found",
            Self::InvalidParams => "Invalid params",
            Self::InternalError => "Internal error",
            Self::ConnectionError => "Connection error",
            Self::TransportError => "Transport error",
            Self::ProtocolError => "Protocol error",
            Self::TimeoutError => "Timeout error",
            Self::CancelledError => "Cancelled",
            Self::ValidationError => "Validation error",
            Self::ConfigError => "Configuration error",
            Self::LifecycleError => "Lifecycle error",
            Self::ToolError => "Tool error",
            Self::ResourceError => "Resource error",
            Self::PermissionDenied => "Permission denied",
        }
    }
}

/// MCP Error type with structured code and message.
///
/// All MCP operation failures return this error type, which contains:
/// - A numeric error code (following JSON-RPC 2.0 conventions)
/// - A human-readable error message
/// - Optional additional data
///
/// This satisfies Requirement 8.1: "WHEN an MCP operation fails THEN the System
/// SHALL return a structured error with code and message"
#[derive(Debug, Error)]
pub enum McpError {
    /// Connection-related errors (establishing, maintaining connections)
    #[error("Connection error: {message}")]
    Connection {
        /// Error code
        code: i32,
        /// Human-readable error message
        message: String,
        /// Optional source error
        #[source]
        source: Option<Box<dyn std::error::Error + Send + Sync>>,
    },

    /// Transport layer errors (stdio, HTTP, WebSocket communication)
    #[error("Transport error: {message}")]
    Transport {
        /// Error code
        code: i32,
        /// Human-readable error message
        message: String,
        /// Optional source error
        #[source]
        source: Option<Box<dyn std::error::Error + Send + Sync>>,
    },

    /// Protocol errors (handshake, version negotiation, message format)
    #[error("Protocol error: {message}")]
    Protocol {
        /// Error code
        code: i32,
        /// Human-readable error message
        message: String,
    },

    /// Request timeout
    #[error("Timeout after {duration:?}: {message}")]
    Timeout {
        /// Error code
        code: i32,
        /// Human-readable error message
        message: String,
        /// Duration before timeout occurred
        duration: Duration,
    },

    /// Operation was cancelled
    #[error("Cancelled: {message}")]
    Cancelled {
        /// Error code
        code: i32,
        /// Human-readable error message
        message: String,
        /// Optional reason for cancellation
        reason: Option<String>,
    },

    /// Server returned an error
    #[error("Server error: code={code}, message={message}")]
    Server {
        /// Error code from server
        code: i32,
        /// Error message from server
        message: String,
        /// Optional additional data from server
        data: Option<serde_json::Value>,
    },

    /// Validation errors (config, arguments, schema)
    #[error("Validation error: {message}")]
    Validation {
        /// Error code
        code: i32,
        /// Human-readable error message
        message: String,
        /// Validation error details
        errors: Vec<String>,
    },

    /// Configuration errors (loading, saving, parsing)
    #[error("Configuration error: {message}")]
    Config {
        /// Error code
        code: i32,
        /// Human-readable error message
        message: String,
        /// Optional source error
        #[source]
        source: Option<Box<dyn std::error::Error + Send + Sync>>,
    },

    /// IO errors
    #[error("IO error: {message}")]
    Io {
        /// Error code
        code: i32,
        /// Human-readable error message
        message: String,
        /// Source IO error
        #[source]
        source: std::io::Error,
    },

    /// Serialization/deserialization errors
    #[error("Serialization error: {message}")]
    Serialization {
        /// Error code
        code: i32,
        /// Human-readable error message
        message: String,
        /// Source error
        #[source]
        source: serde_json::Error,
    },

    /// Lifecycle management errors
    #[error("Lifecycle error: {message}")]
    Lifecycle {
        /// Error code
        code: i32,
        /// Human-readable error message
        message: String,
        /// Server name if applicable
        server_name: Option<String>,
    },

    /// Tool execution errors
    #[error("Tool error: {message}")]
    Tool {
        /// Error code
        code: i32,
        /// Human-readable error message
        message: String,
        /// Tool name
        tool_name: Option<String>,
    },

    /// Permission denied errors
    #[error("Permission denied: {message}")]
    PermissionDenied {
        /// Error code
        code: i32,
        /// Human-readable error message
        message: String,
        /// Tool name if applicable
        tool_name: Option<String>,
    },
}

impl McpError {
    /// Returns the error code
    pub fn code(&self) -> i32 {
        match self {
            Self::Connection { code, .. } => *code,
            Self::Transport { code, .. } => *code,
            Self::Protocol { code, .. } => *code,
            Self::Timeout { code, .. } => *code,
            Self::Cancelled { code, .. } => *code,
            Self::Server { code, .. } => *code,
            Self::Validation { code, .. } => *code,
            Self::Config { code, .. } => *code,
            Self::Io { code, .. } => *code,
            Self::Serialization { code, .. } => *code,
            Self::Lifecycle { code, .. } => *code,
            Self::Tool { code, .. } => *code,
            Self::PermissionDenied { code, .. } => *code,
        }
    }

    /// Returns the error message
    pub fn message(&self) -> &str {
        match self {
            Self::Connection { message, .. } => message,
            Self::Transport { message, .. } => message,
            Self::Protocol { message, .. } => message,
            Self::Timeout { message, .. } => message,
            Self::Cancelled { message, .. } => message,
            Self::Server { message, .. } => message,
            Self::Validation { message, .. } => message,
            Self::Config { message, .. } => message,
            Self::Io { message, .. } => message,
            Self::Serialization { message, .. } => message,
            Self::Lifecycle { message, .. } => message,
            Self::Tool { message, .. } => message,
            Self::PermissionDenied { message, .. } => message,
        }
    }

    // Constructor helpers

    /// Create a connection error
    pub fn connection(message: impl Into<String>) -> Self {
        Self::Connection {
            code: McpErrorCode::ConnectionError.code(),
            message: message.into(),
            source: None,
        }
    }

    /// Create a connection error with source
    pub fn connection_with_source(
        message: impl Into<String>,
        source: impl std::error::Error + Send + Sync + 'static,
    ) -> Self {
        Self::Connection {
            code: McpErrorCode::ConnectionError.code(),
            message: message.into(),
            source: Some(Box::new(source)),
        }
    }

    /// Create a transport error
    pub fn transport(message: impl Into<String>) -> Self {
        Self::Transport {
            code: McpErrorCode::TransportError.code(),
            message: message.into(),
            source: None,
        }
    }

    /// Create a transport error with source
    pub fn transport_with_source(
        message: impl Into<String>,
        source: impl std::error::Error + Send + Sync + 'static,
    ) -> Self {
        Self::Transport {
            code: McpErrorCode::TransportError.code(),
            message: message.into(),
            source: Some(Box::new(source)),
        }
    }

    /// Create a protocol error
    pub fn protocol(message: impl Into<String>) -> Self {
        Self::Protocol {
            code: McpErrorCode::ProtocolError.code(),
            message: message.into(),
        }
    }

    /// Create a timeout error
    pub fn timeout(message: impl Into<String>, duration: Duration) -> Self {
        Self::Timeout {
            code: McpErrorCode::TimeoutError.code(),
            message: message.into(),
            duration,
        }
    }

    /// Create a cancelled error
    pub fn cancelled(message: impl Into<String>, reason: Option<String>) -> Self {
        Self::Cancelled {
            code: McpErrorCode::CancelledError.code(),
            message: message.into(),
            reason,
        }
    }

    /// Create a server error
    pub fn server(code: i32, message: impl Into<String>, data: Option<serde_json::Value>) -> Self {
        Self::Server {
            code,
            message: message.into(),
            data,
        }
    }

    /// Create a validation error
    pub fn validation(message: impl Into<String>, errors: Vec<String>) -> Self {
        Self::Validation {
            code: McpErrorCode::ValidationError.code(),
            message: message.into(),
            errors,
        }
    }

    /// Create a config error
    pub fn config(message: impl Into<String>) -> Self {
        Self::Config {
            code: McpErrorCode::ConfigError.code(),
            message: message.into(),
            source: None,
        }
    }

    /// Create a config error with source
    pub fn config_with_source(
        message: impl Into<String>,
        source: impl std::error::Error + Send + Sync + 'static,
    ) -> Self {
        Self::Config {
            code: McpErrorCode::ConfigError.code(),
            message: message.into(),
            source: Some(Box::new(source)),
        }
    }

    /// Create a lifecycle error
    pub fn lifecycle(message: impl Into<String>, server_name: Option<String>) -> Self {
        Self::Lifecycle {
            code: McpErrorCode::LifecycleError.code(),
            message: message.into(),
            server_name,
        }
    }

    /// Create a tool error
    pub fn tool(message: impl Into<String>, tool_name: Option<String>) -> Self {
        Self::Tool {
            code: McpErrorCode::ToolError.code(),
            message: message.into(),
            tool_name,
        }
    }

    /// Create a permission denied error
    pub fn permission_denied(message: impl Into<String>) -> Self {
        Self::PermissionDenied {
            code: McpErrorCode::PermissionDenied.code(),
            message: message.into(),
            tool_name: None,
        }
    }

    /// Create a permission denied error with tool name
    pub fn permission_denied_for_tool(
        message: impl Into<String>,
        tool_name: impl Into<String>,
    ) -> Self {
        Self::PermissionDenied {
            code: McpErrorCode::PermissionDenied.code(),
            message: message.into(),
            tool_name: Some(tool_name.into()),
        }
    }
}

impl From<std::io::Error> for McpError {
    fn from(err: std::io::Error) -> Self {
        Self::Io {
            code: McpErrorCode::InternalError.code(),
            message: err.to_string(),
            source: err,
        }
    }
}

impl From<serde_json::Error> for McpError {
    fn from(err: serde_json::Error) -> Self {
        Self::Serialization {
            code: McpErrorCode::ParseError.code(),
            message: err.to_string(),
            source: err,
        }
    }
}

/// Convert from rmcp::ErrorData to McpError
impl From<rmcp::ErrorData> for McpError {
    fn from(err: rmcp::ErrorData) -> Self {
        Self::Server {
            code: err.code.0,
            message: err.message.to_string(),
            data: err.data,
        }
    }
}

/// Result type alias for MCP operations
pub type McpResult<T> = Result<T, McpError>;

/// Structured error representation for serialization
///
/// This struct provides a JSON-serializable representation of MCP errors
/// that always includes code and message fields as required by Requirements 8.1.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StructuredError {
    /// Error code (following JSON-RPC 2.0 conventions)
    pub code: i32,
    /// Human-readable error message
    pub message: String,
    /// Optional additional data
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

impl StructuredError {
    /// Create a new structured error
    pub fn new(code: i32, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            data: None,
        }
    }

    /// Create a structured error with additional data
    pub fn with_data(code: i32, message: impl Into<String>, data: serde_json::Value) -> Self {
        Self {
            code,
            message: message.into(),
            data: Some(data),
        }
    }
}

impl From<&McpError> for StructuredError {
    fn from(err: &McpError) -> Self {
        let data = match err {
            McpError::Validation { errors, .. } => Some(serde_json::json!({ "errors": errors })),
            McpError::Server { data, .. } => data.clone(),
            McpError::Timeout { duration, .. } => {
                Some(serde_json::json!({ "duration_ms": duration.as_millis() }))
            }
            McpError::Cancelled { reason, .. } => {
                reason.as_ref().map(|r| serde_json::json!({ "reason": r }))
            }
            McpError::Lifecycle { server_name, .. } => server_name
                .as_ref()
                .map(|n| serde_json::json!({ "server_name": n })),
            McpError::Tool { tool_name, .. } => tool_name
                .as_ref()
                .map(|n| serde_json::json!({ "tool_name": n })),
            McpError::PermissionDenied { tool_name, .. } => tool_name
                .as_ref()
                .map(|n| serde_json::json!({ "tool_name": n })),
            _ => None,
        };

        Self {
            code: err.code(),
            message: err.message().to_string(),
            data,
        }
    }
}

impl From<McpError> for StructuredError {
    fn from(err: McpError) -> Self {
        StructuredError::from(&err)
    }
}

use serde::{Deserialize, Serialize};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_code_values() {
        assert_eq!(McpErrorCode::ParseError.code(), -32700);
        assert_eq!(McpErrorCode::InvalidRequest.code(), -32600);
        assert_eq!(McpErrorCode::ConnectionError.code(), -32000);
    }

    #[test]
    fn test_error_has_code_and_message() {
        let err = McpError::connection("test connection error");
        assert_eq!(err.code(), McpErrorCode::ConnectionError.code());
        assert_eq!(err.message(), "test connection error");
    }

    #[test]
    fn test_timeout_error() {
        let err = McpError::timeout("request timed out", Duration::from_secs(30));
        assert_eq!(err.code(), McpErrorCode::TimeoutError.code());
        assert!(err.message().contains("request timed out"));
    }

    #[test]
    fn test_validation_error_with_details() {
        let err = McpError::validation(
            "invalid configuration",
            vec!["missing field: command".to_string()],
        );
        assert_eq!(err.code(), McpErrorCode::ValidationError.code());

        if let McpError::Validation { errors, .. } = err {
            assert_eq!(errors.len(), 1);
            assert!(errors[0].contains("missing field"));
        } else {
            panic!("Expected Validation error");
        }
    }

    #[test]
    fn test_server_error() {
        let err = McpError::server(-32001, "server unavailable", None);
        assert_eq!(err.code(), -32001);
        assert_eq!(err.message(), "server unavailable");
    }

    #[test]
    fn test_io_error_conversion() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file not found");
        let mcp_err: McpError = io_err.into();
        assert_eq!(mcp_err.code(), McpErrorCode::InternalError.code());
        assert!(mcp_err.message().contains("file not found"));
    }

    #[test]
    fn test_error_display() {
        let err = McpError::connection("failed to connect");
        let display = format!("{}", err);
        assert!(display.contains("Connection error"));
        assert!(display.contains("failed to connect"));
    }

    #[test]
    fn test_structured_error_new() {
        let err = StructuredError::new(-32000, "test error");
        assert_eq!(err.code, -32000);
        assert_eq!(err.message, "test error");
        assert!(err.data.is_none());
    }

    #[test]
    fn test_structured_error_with_data() {
        let data = serde_json::json!({"key": "value"});
        let err = StructuredError::with_data(-32000, "test error", data.clone());
        assert_eq!(err.code, -32000);
        assert_eq!(err.message, "test error");
        assert_eq!(err.data, Some(data));
    }

    #[test]
    fn test_structured_error_from_mcp_error() {
        let mcp_err = McpError::connection("connection failed");
        let structured: StructuredError = (&mcp_err).into();

        assert_eq!(structured.code, McpErrorCode::ConnectionError.code());
        assert_eq!(structured.message, "connection failed");
    }

    #[test]
    fn test_structured_error_from_validation_error() {
        let mcp_err = McpError::validation(
            "invalid config",
            vec!["missing field".to_string(), "invalid value".to_string()],
        );
        let structured: StructuredError = (&mcp_err).into();

        assert_eq!(structured.code, McpErrorCode::ValidationError.code());
        assert_eq!(structured.message, "invalid config");
        assert!(structured.data.is_some());

        let data = structured.data.unwrap();
        let errors = data.get("errors").unwrap().as_array().unwrap();
        assert_eq!(errors.len(), 2);
    }

    #[test]
    fn test_structured_error_from_timeout_error() {
        let mcp_err = McpError::timeout("request timed out", Duration::from_secs(30));
        let structured: StructuredError = (&mcp_err).into();

        assert_eq!(structured.code, McpErrorCode::TimeoutError.code());
        assert!(structured.data.is_some());

        let data = structured.data.unwrap();
        assert_eq!(data.get("duration_ms").unwrap().as_u64().unwrap(), 30000);
    }

    #[test]
    fn test_structured_error_serialization() {
        let err = StructuredError::new(-32000, "test error");
        let json = serde_json::to_string(&err).unwrap();

        assert!(json.contains("\"code\":-32000"));
        assert!(json.contains("\"message\":\"test error\""));
        // data should not be present when None
        assert!(!json.contains("\"data\""));
    }

    #[test]
    fn test_all_error_variants_have_code_and_message() {
        // Test that all error variants can be converted to structured errors
        // with valid code and message (Requirements 8.1)

        let errors: Vec<McpError> = vec![
            McpError::connection("test"),
            McpError::transport("test"),
            McpError::protocol("test"),
            McpError::timeout("test", Duration::from_secs(1)),
            McpError::cancelled("test", None),
            McpError::server(-32000, "test", None),
            McpError::validation("test", vec![]),
            McpError::config("test"),
            McpError::lifecycle("test", None),
            McpError::tool("test", None),
            McpError::permission_denied("test"),
        ];

        for err in errors {
            let structured: StructuredError = (&err).into();
            assert!(structured.code != 0, "Error code should not be 0");
            assert!(
                !structured.message.is_empty(),
                "Error message should not be empty"
            );
        }
    }
}
