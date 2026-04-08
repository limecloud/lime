//! MCP Core Types
//!
//! This module defines the core types used across MCP components including
//! connection management, configuration, lifecycle, and tool management.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

// Re-export commonly used types from rmcp
pub use rmcp::model::{JsonObject, ServerCapabilities};

/// Log level for MCP server logging
///
/// This enum defines the log levels that can be configured per MCP server.
/// It follows standard logging conventions and is used for:
/// - Configuring the minimum log level for each server (Requirements 8.5)
/// - Filtering log messages from server notifications (Requirements 8.4)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum McpLogLevel {
    /// Debug level - most verbose, includes all messages
    Debug,
    /// Info level - general information messages
    #[default]
    Info,
    /// Warning level - potential issues
    Warn,
    /// Error level - error conditions
    Error,
}

impl McpLogLevel {
    /// Check if a message at the given level should be logged
    /// based on the current configured level
    pub fn should_log(&self, message_level: McpLogLevel) -> bool {
        let self_priority = self.priority();
        let message_priority = message_level.priority();
        message_priority >= self_priority
    }

    /// Get the priority of this log level (higher = more severe)
    fn priority(&self) -> u8 {
        match self {
            McpLogLevel::Debug => 0,
            McpLogLevel::Info => 1,
            McpLogLevel::Warn => 2,
            McpLogLevel::Error => 3,
        }
    }

    /// Convert from string representation
    pub fn parse(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "debug" => Some(McpLogLevel::Debug),
            "info" => Some(McpLogLevel::Info),
            "warn" | "warning" => Some(McpLogLevel::Warn),
            "error" => Some(McpLogLevel::Error),
            _ => None,
        }
    }
}

impl std::fmt::Display for McpLogLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Debug => write!(f, "debug"),
            Self::Info => write!(f, "info"),
            Self::Warn => write!(f, "warn"),
            Self::Error => write!(f, "error"),
        }
    }
}

/// Unique identifier for requests
pub type RequestId = String;

/// Transport type for MCP connections
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum TransportType {
    /// Standard input/output transport (subprocess)
    #[default]
    Stdio,
    /// HTTP transport
    Http,
    /// Server-Sent Events transport
    Sse,
    /// WebSocket transport
    WebSocket,
}

impl std::fmt::Display for TransportType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Stdio => write!(f, "stdio"),
            Self::Http => write!(f, "http"),
            Self::Sse => write!(f, "sse"),
            Self::WebSocket => write!(f, "websocket"),
        }
    }
}

/// Connection status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionStatus {
    /// Connection is being established
    Connecting,
    /// Connection is active and ready
    Connected,
    /// Connection has been closed
    #[default]
    Disconnected,
    /// Connection is in error state
    Error,
    /// Connection is reconnecting
    Reconnecting,
}

/// Connection options configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionOptions {
    /// Request timeout duration
    #[serde(with = "humantime_serde", default = "default_timeout")]
    pub timeout: Duration,
    /// Maximum retry attempts
    #[serde(default = "default_max_retries")]
    pub max_retries: u32,
    /// Heartbeat interval
    #[serde(with = "humantime_serde", default = "default_heartbeat_interval")]
    pub heartbeat_interval: Duration,
    /// Base delay for reconnection (exponential backoff)
    #[serde(with = "humantime_serde", default = "default_reconnect_delay_base")]
    pub reconnect_delay_base: Duration,
    /// Maximum reconnection delay
    #[serde(with = "humantime_serde", default = "default_reconnect_delay_max")]
    pub reconnect_delay_max: Duration,
    /// Message queue maximum size
    #[serde(default = "default_queue_max_size")]
    pub queue_max_size: usize,
}

fn default_timeout() -> Duration {
    Duration::from_secs(30)
}

fn default_max_retries() -> u32 {
    3
}

fn default_heartbeat_interval() -> Duration {
    Duration::from_secs(30)
}

fn default_reconnect_delay_base() -> Duration {
    Duration::from_millis(1000)
}

fn default_reconnect_delay_max() -> Duration {
    Duration::from_secs(60)
}

fn default_queue_max_size() -> usize {
    100
}

impl Default for ConnectionOptions {
    fn default() -> Self {
        Self {
            timeout: default_timeout(),
            max_retries: default_max_retries(),
            heartbeat_interval: default_heartbeat_interval(),
            reconnect_delay_base: default_reconnect_delay_base(),
            reconnect_delay_max: default_reconnect_delay_max(),
            queue_max_size: default_queue_max_size(),
        }
    }
}

/// MCP server information for connection
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerInfo {
    /// Server name (unique identifier)
    pub name: String,
    /// Transport type
    pub transport_type: TransportType,
    /// Command to execute (for stdio transport)
    pub command: Option<String>,
    /// Command arguments (for stdio transport)
    pub args: Option<Vec<String>>,
    /// Environment variables
    pub env: Option<HashMap<String, String>>,
    /// URL for HTTP/SSE/WebSocket transports
    pub url: Option<String>,
    /// HTTP headers
    pub headers: Option<HashMap<String, String>>,
    /// Connection options
    #[serde(default)]
    pub options: ConnectionOptions,
}

/// MCP connection information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpConnection {
    /// Unique connection ID
    pub id: String,
    /// Server name
    pub server_name: String,
    /// Transport type
    pub transport_type: TransportType,
    /// Current connection status
    pub status: ConnectionStatus,
    /// Connection creation time
    pub created_at: DateTime<Utc>,
    /// Last activity time
    pub last_activity: DateTime<Utc>,
    /// Server capabilities (after handshake)
    pub capabilities: Option<ServerCapabilities>,
    /// Protocol version
    pub protocol_version: Option<String>,
}

impl McpConnection {
    /// Create a new connection info
    pub fn new(id: String, server_name: String, transport_type: TransportType) -> Self {
        let now = Utc::now();
        Self {
            id,
            server_name,
            transport_type,
            status: ConnectionStatus::Connecting,
            created_at: now,
            last_activity: now,
            capabilities: None,
            protocol_version: None,
        }
    }

    /// Update the last activity timestamp
    pub fn touch(&mut self) {
        self.last_activity = Utc::now();
    }
}

/// Server state for lifecycle management
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ServerState {
    /// Server is stopped
    #[default]
    Stopped,
    /// Server is starting
    Starting,
    /// Server is running
    Running,
    /// Server is stopping
    Stopping,
    /// Server is in error state
    Error,
    /// Server has crashed
    Crashed,
}

/// Server process information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerProcess {
    /// Server name
    pub name: String,
    /// Process ID (if running)
    pub pid: Option<u32>,
    /// Current state
    pub state: ServerState,
    /// Start time
    pub started_at: Option<DateTime<Utc>>,
    /// Stop time
    pub stopped_at: Option<DateTime<Utc>>,
    /// Number of restarts
    pub restart_count: u32,
    /// Last error message
    pub last_error: Option<String>,
    /// Consecutive failure count
    pub consecutive_failures: u32,
}

impl ServerProcess {
    /// Create a new server process info
    pub fn new(name: String) -> Self {
        Self {
            name,
            pid: None,
            state: ServerState::Stopped,
            started_at: None,
            stopped_at: None,
            restart_count: 0,
            last_error: None,
            consecutive_failures: 0,
        }
    }
}

/// Lifecycle management options
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LifecycleOptions {
    /// Startup timeout
    #[serde(with = "humantime_serde", default = "default_startup_timeout")]
    pub startup_timeout: Duration,
    /// Shutdown timeout
    #[serde(with = "humantime_serde", default = "default_shutdown_timeout")]
    pub shutdown_timeout: Duration,
    /// Maximum restart attempts
    #[serde(default = "default_max_restarts")]
    pub max_restarts: u32,
    /// Delay between restarts
    #[serde(with = "humantime_serde", default = "default_restart_delay")]
    pub restart_delay: Duration,
    /// Health check interval
    #[serde(with = "humantime_serde", default = "default_health_check_interval")]
    pub health_check_interval: Duration,
    /// Maximum consecutive failures before marking as crashed
    #[serde(default = "default_max_consecutive_failures")]
    pub max_consecutive_failures: u32,
}

fn default_startup_timeout() -> Duration {
    Duration::from_secs(30)
}

fn default_shutdown_timeout() -> Duration {
    Duration::from_secs(10)
}

fn default_max_restarts() -> u32 {
    3
}

fn default_restart_delay() -> Duration {
    Duration::from_secs(1)
}

fn default_health_check_interval() -> Duration {
    Duration::from_secs(30)
}

fn default_max_consecutive_failures() -> u32 {
    3
}

impl Default for LifecycleOptions {
    fn default() -> Self {
        Self {
            startup_timeout: default_startup_timeout(),
            shutdown_timeout: default_shutdown_timeout(),
            max_restarts: default_max_restarts(),
            restart_delay: default_restart_delay(),
            health_check_interval: default_health_check_interval(),
            max_consecutive_failures: default_max_consecutive_failures(),
        }
    }
}

/// Health check result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthCheckResult {
    /// Whether the server is healthy
    pub healthy: bool,
    /// Response latency
    pub latency: Option<Duration>,
    /// Time of the check
    pub last_check: DateTime<Utc>,
    /// Error message if unhealthy
    pub error: Option<String>,
}

/// MCP server configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    /// Transport type
    #[serde(default)]
    pub transport_type: TransportType,
    /// Command to execute (for stdio transport)
    pub command: Option<String>,
    /// Command arguments
    pub args: Option<Vec<String>>,
    /// Environment variables
    pub env: Option<HashMap<String, String>>,
    /// URL for HTTP/SSE/WebSocket transports
    pub url: Option<String>,
    /// HTTP headers
    pub headers: Option<HashMap<String, String>>,
    /// Whether the server is enabled
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    /// Request timeout
    #[serde(with = "humantime_serde", default = "default_timeout")]
    pub timeout: Duration,
    /// Maximum retries
    #[serde(default = "default_max_retries")]
    pub retries: u32,
    /// Auto-approve tool list
    #[serde(default)]
    pub auto_approve: Vec<String>,
    /// Log level for this server (Requirements 8.5)
    #[serde(default)]
    pub log_level: McpLogLevel,
}

fn default_enabled() -> bool {
    true
}

impl Default for McpServerConfig {
    fn default() -> Self {
        Self {
            transport_type: TransportType::default(),
            command: None,
            args: None,
            env: None,
            url: None,
            headers: None,
            enabled: default_enabled(),
            timeout: default_timeout(),
            retries: default_max_retries(),
            auto_approve: Vec::new(),
            log_level: McpLogLevel::default(),
        }
    }
}

/// Configuration validation result
#[derive(Debug, Clone, Default)]
pub struct ValidationResult {
    /// Whether the configuration is valid
    pub valid: bool,
    /// Validation errors
    pub errors: Vec<String>,
    /// Validation warnings
    pub warnings: Vec<String>,
}

impl ValidationResult {
    /// Create a valid result
    pub fn valid() -> Self {
        Self {
            valid: true,
            errors: Vec::new(),
            warnings: Vec::new(),
        }
    }

    /// Create an invalid result with errors
    pub fn invalid(errors: Vec<String>) -> Self {
        Self {
            valid: false,
            errors,
            warnings: Vec::new(),
        }
    }

    /// Add an error
    pub fn add_error(&mut self, error: impl Into<String>) {
        self.valid = false;
        self.errors.push(error.into());
    }

    /// Add a warning
    pub fn add_warning(&mut self, warning: impl Into<String>) {
        self.warnings.push(warning.into());
    }
}

/// Server validation result
#[derive(Debug, Clone)]
pub struct ServerValidationResult {
    /// Server name
    pub server_name: String,
    /// Whether the configuration is valid
    pub valid: bool,
    /// Whether the command exists (for stdio servers)
    pub command_exists: Option<bool>,
    /// Validation errors
    pub errors: Vec<String>,
    /// Validation warnings
    pub warnings: Vec<String>,
}

/// Configuration scope
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigScope {
    /// Global configuration (~/.aster/settings.yaml)
    Global,
    /// Project-level configuration (.aster/settings.yaml)
    Project,
}

/// Configuration manager options
#[derive(Debug, Clone)]
pub struct ConfigManagerOptions {
    /// Path to global configuration
    pub global_config_path: Option<PathBuf>,
    /// Path to project configuration
    pub project_config_path: Option<PathBuf>,
    /// Whether to auto-save changes
    pub auto_save: bool,
    /// Whether to validate commands exist
    pub validate_commands: bool,
}

impl Default for ConfigManagerOptions {
    fn default() -> Self {
        Self {
            global_config_path: None,
            project_config_path: None,
            auto_save: true,
            validate_commands: true,
        }
    }
}

/// Serde helper module for Duration serialization
mod humantime_serde {
    use serde::{Deserialize, Deserializer, Serializer};
    use std::time::Duration;

    pub fn serialize<S>(duration: &Duration, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_u64(duration.as_millis() as u64)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Duration, D::Error>
    where
        D: Deserializer<'de>,
    {
        let millis = u64::deserialize(deserializer)?;
        Ok(Duration::from_millis(millis))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_transport_type_display() {
        assert_eq!(TransportType::Stdio.to_string(), "stdio");
        assert_eq!(TransportType::Http.to_string(), "http");
        assert_eq!(TransportType::Sse.to_string(), "sse");
        assert_eq!(TransportType::WebSocket.to_string(), "websocket");
    }

    #[test]
    fn test_connection_options_default() {
        let opts = ConnectionOptions::default();
        assert_eq!(opts.timeout, Duration::from_secs(30));
        assert_eq!(opts.max_retries, 3);
        assert_eq!(opts.heartbeat_interval, Duration::from_secs(30));
    }

    #[test]
    fn test_mcp_connection_new() {
        let conn = McpConnection::new(
            "conn-1".to_string(),
            "test-server".to_string(),
            TransportType::Stdio,
        );
        assert_eq!(conn.id, "conn-1");
        assert_eq!(conn.server_name, "test-server");
        assert_eq!(conn.status, ConnectionStatus::Connecting);
    }

    #[test]
    fn test_server_process_new() {
        let proc = ServerProcess::new("test-server".to_string());
        assert_eq!(proc.name, "test-server");
        assert_eq!(proc.state, ServerState::Stopped);
        assert_eq!(proc.restart_count, 0);
    }

    #[test]
    fn test_validation_result() {
        let mut result = ValidationResult::valid();
        assert!(result.valid);

        result.add_error("missing field");
        assert!(!result.valid);
        assert_eq!(result.errors.len(), 1);

        result.add_warning("deprecated option");
        assert_eq!(result.warnings.len(), 1);
    }

    #[test]
    fn test_server_config_default() {
        let config = McpServerConfig::default();
        assert_eq!(config.transport_type, TransportType::Stdio);
        assert!(config.enabled);
        assert_eq!(config.timeout, Duration::from_secs(30));
        assert_eq!(config.log_level, McpLogLevel::Info);
    }

    #[test]
    fn test_mcp_log_level_default() {
        assert_eq!(McpLogLevel::default(), McpLogLevel::Info);
    }

    #[test]
    fn test_mcp_log_level_should_log() {
        let debug_level = McpLogLevel::Debug;
        let info_level = McpLogLevel::Info;
        let warn_level = McpLogLevel::Warn;
        let error_level = McpLogLevel::Error;

        // Debug level logs everything
        assert!(debug_level.should_log(McpLogLevel::Debug));
        assert!(debug_level.should_log(McpLogLevel::Info));
        assert!(debug_level.should_log(McpLogLevel::Warn));
        assert!(debug_level.should_log(McpLogLevel::Error));

        // Info level logs Info and above
        assert!(!info_level.should_log(McpLogLevel::Debug));
        assert!(info_level.should_log(McpLogLevel::Info));
        assert!(info_level.should_log(McpLogLevel::Warn));
        assert!(info_level.should_log(McpLogLevel::Error));

        // Warn level logs Warn and above
        assert!(!warn_level.should_log(McpLogLevel::Debug));
        assert!(!warn_level.should_log(McpLogLevel::Info));
        assert!(warn_level.should_log(McpLogLevel::Warn));
        assert!(warn_level.should_log(McpLogLevel::Error));

        // Error level logs only Error
        assert!(!error_level.should_log(McpLogLevel::Debug));
        assert!(!error_level.should_log(McpLogLevel::Info));
        assert!(!error_level.should_log(McpLogLevel::Warn));
        assert!(error_level.should_log(McpLogLevel::Error));
    }

    #[test]
    fn test_mcp_log_level_parse() {
        assert_eq!(McpLogLevel::parse("debug"), Some(McpLogLevel::Debug));
        assert_eq!(McpLogLevel::parse("DEBUG"), Some(McpLogLevel::Debug));
        assert_eq!(McpLogLevel::parse("info"), Some(McpLogLevel::Info));
        assert_eq!(McpLogLevel::parse("warn"), Some(McpLogLevel::Warn));
        assert_eq!(McpLogLevel::parse("warning"), Some(McpLogLevel::Warn));
        assert_eq!(McpLogLevel::parse("error"), Some(McpLogLevel::Error));
        assert_eq!(McpLogLevel::parse("invalid"), None);
    }

    #[test]
    fn test_mcp_log_level_display() {
        assert_eq!(McpLogLevel::Debug.to_string(), "debug");
        assert_eq!(McpLogLevel::Info.to_string(), "info");
        assert_eq!(McpLogLevel::Warn.to_string(), "warn");
        assert_eq!(McpLogLevel::Error.to_string(), "error");
    }
}
