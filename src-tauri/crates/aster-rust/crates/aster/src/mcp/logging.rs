//! MCP Logging Module
//!
//! This module provides logging functionality for MCP servers, including:
//! - Log forwarding from server notifications to application logger (Requirements 8.4)
//! - Configurable log levels per server (Requirements 8.5)
//! - Structured log entries with server context
//!
//! # Example
//!
//! ```rust,ignore
//! use aster::mcp::logging::{McpLogger, McpLogEntry};
//! use aster::mcp::types::McpLogLevel;
//!
//! let logger = McpLogger::new();
//! logger.set_server_log_level("my-server", McpLogLevel::Debug);
//!
//! // Log a message from a server
//! logger.log(McpLogEntry {
//!     server_name: "my-server".to_string(),
//!     level: McpLogLevel::Info,
//!     message: "Server started".to_string(),
//!     data: None,
//! });
//! ```

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::mcp::types::McpLogLevel;

/// A log entry from an MCP server
///
/// This struct represents a log message received from an MCP server
/// via the logging/message notification.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpLogEntry {
    /// Name of the server that generated the log
    pub server_name: String,
    /// Log level
    pub level: McpLogLevel,
    /// Log message
    pub message: String,
    /// Optional structured data
    pub data: Option<serde_json::Value>,
    /// Optional logger name from the server
    pub logger: Option<String>,
}

impl McpLogEntry {
    /// Create a new log entry
    pub fn new(
        server_name: impl Into<String>,
        level: McpLogLevel,
        message: impl Into<String>,
    ) -> Self {
        Self {
            server_name: server_name.into(),
            level,
            message: message.into(),
            data: None,
            logger: None,
        }
    }

    /// Add structured data to the log entry
    pub fn with_data(mut self, data: serde_json::Value) -> Self {
        self.data = Some(data);
        self
    }

    /// Add logger name to the log entry
    pub fn with_logger(mut self, logger: impl Into<String>) -> Self {
        self.logger = Some(logger.into());
        self
    }
}

/// Callback type for log entry handlers
pub type LogCallback = Arc<dyn Fn(&McpLogEntry) + Send + Sync>;

/// MCP Logger for handling server log notifications
///
/// This logger manages log levels per server and forwards log messages
/// to the application's logging system (tracing).
///
/// # Requirements Coverage
/// - 8.4: Forward server log notifications to application logger
/// - 8.5: Support configurable log levels per MCP server
pub struct McpLogger {
    /// Log levels per server
    server_levels: Arc<RwLock<HashMap<String, McpLogLevel>>>,
    /// Default log level for servers without specific configuration
    default_level: Arc<RwLock<McpLogLevel>>,
    /// Custom log callbacks
    callbacks: Arc<RwLock<Vec<LogCallback>>>,
    /// Whether logging is enabled
    enabled: Arc<RwLock<bool>>,
}

impl McpLogger {
    /// Create a new MCP logger with default settings
    pub fn new() -> Self {
        Self {
            server_levels: Arc::new(RwLock::new(HashMap::new())),
            default_level: Arc::new(RwLock::new(McpLogLevel::Info)),
            callbacks: Arc::new(RwLock::new(Vec::new())),
            enabled: Arc::new(RwLock::new(true)),
        }
    }

    /// Create a new MCP logger with a specific default level
    pub fn with_default_level(level: McpLogLevel) -> Self {
        Self {
            server_levels: Arc::new(RwLock::new(HashMap::new())),
            default_level: Arc::new(RwLock::new(level)),
            callbacks: Arc::new(RwLock::new(Vec::new())),
            enabled: Arc::new(RwLock::new(true)),
        }
    }

    /// Set the log level for a specific server
    ///
    /// # Requirements: 8.5
    pub async fn set_server_log_level(&self, server_name: &str, level: McpLogLevel) {
        let mut levels = self.server_levels.write().await;
        levels.insert(server_name.to_string(), level);
    }

    /// Get the log level for a specific server
    pub async fn get_server_log_level(&self, server_name: &str) -> McpLogLevel {
        let levels = self.server_levels.read().await;
        levels
            .get(server_name)
            .copied()
            .unwrap_or(*self.default_level.read().await)
    }

    /// Remove the log level configuration for a server (falls back to default)
    pub async fn remove_server_log_level(&self, server_name: &str) {
        let mut levels = self.server_levels.write().await;
        levels.remove(server_name);
    }

    /// Set the default log level for servers without specific configuration
    pub async fn set_default_level(&self, level: McpLogLevel) {
        let mut default = self.default_level.write().await;
        *default = level;
    }

    /// Get the default log level
    pub async fn get_default_level(&self) -> McpLogLevel {
        *self.default_level.read().await
    }

    /// Enable or disable logging
    pub async fn set_enabled(&self, enabled: bool) {
        let mut e = self.enabled.write().await;
        *e = enabled;
    }

    /// Check if logging is enabled
    pub async fn is_enabled(&self) -> bool {
        *self.enabled.read().await
    }

    /// Register a callback for log entries
    ///
    /// Returns a function that can be called to unregister the callback.
    pub async fn on_log(&self, callback: LogCallback) {
        let mut callbacks = self.callbacks.write().await;
        callbacks.push(callback);
    }

    /// Log an entry from an MCP server
    ///
    /// This method checks the configured log level for the server and
    /// forwards the message to the application logger if appropriate.
    ///
    /// # Requirements: 8.4
    pub async fn log(&self, entry: McpLogEntry) {
        // Check if logging is enabled
        if !*self.enabled.read().await {
            return;
        }

        // Check if this message should be logged based on server's configured level
        let server_level = self.get_server_log_level(&entry.server_name).await;
        if !server_level.should_log(entry.level) {
            return;
        }

        // Forward to tracing
        self.forward_to_tracing(&entry);

        // Call registered callbacks
        let callbacks = self.callbacks.read().await;
        for callback in callbacks.iter() {
            callback(&entry);
        }
    }

    /// Forward a log entry to the tracing system
    fn forward_to_tracing(&self, entry: &McpLogEntry) {
        let server = &entry.server_name;
        let message = &entry.message;
        let logger = entry.logger.as_deref().unwrap_or("mcp");

        match entry.level {
            McpLogLevel::Debug => {
                if let Some(ref data) = entry.data {
                    tracing::debug!(
                        target: "mcp",
                        server = %server,
                        logger = %logger,
                        data = %data,
                        "{}", message
                    );
                } else {
                    tracing::debug!(
                        target: "mcp",
                        server = %server,
                        logger = %logger,
                        "{}", message
                    );
                }
            }
            McpLogLevel::Info => {
                if let Some(ref data) = entry.data {
                    tracing::info!(
                        target: "mcp",
                        server = %server,
                        logger = %logger,
                        data = %data,
                        "{}", message
                    );
                } else {
                    tracing::info!(
                        target: "mcp",
                        server = %server,
                        logger = %logger,
                        "{}", message
                    );
                }
            }
            McpLogLevel::Warn => {
                if let Some(ref data) = entry.data {
                    tracing::warn!(
                        target: "mcp",
                        server = %server,
                        logger = %logger,
                        data = %data,
                        "{}", message
                    );
                } else {
                    tracing::warn!(
                        target: "mcp",
                        server = %server,
                        logger = %logger,
                        "{}", message
                    );
                }
            }
            McpLogLevel::Error => {
                if let Some(ref data) = entry.data {
                    tracing::error!(
                        target: "mcp",
                        server = %server,
                        logger = %logger,
                        data = %data,
                        "{}", message
                    );
                } else {
                    tracing::error!(
                        target: "mcp",
                        server = %server,
                        logger = %logger,
                        "{}", message
                    );
                }
            }
        }
    }

    /// Process a logging notification from an MCP server
    ///
    /// This method parses the notification params and logs the message.
    /// The notification format follows the MCP logging/message specification.
    ///
    /// # Requirements: 8.4
    pub async fn process_notification(&self, server_name: &str, params: &serde_json::Value) {
        // Parse the notification params
        let level = params
            .get("level")
            .and_then(|v| v.as_str())
            .and_then(McpLogLevel::parse)
            .unwrap_or(McpLogLevel::Info);

        let message = params
            .get("data")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let logger = params
            .get("logger")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let entry = McpLogEntry {
            server_name: server_name.to_string(),
            level,
            message,
            data: params.get("data").cloned(),
            logger,
        };

        self.log(entry).await;
    }
}

impl Default for McpLogger {
    fn default() -> Self {
        Self::new()
    }
}

impl Clone for McpLogger {
    fn clone(&self) -> Self {
        Self {
            server_levels: self.server_levels.clone(),
            default_level: self.default_level.clone(),
            callbacks: self.callbacks.clone(),
            enabled: self.enabled.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[tokio::test]
    async fn test_logger_new() {
        let logger = McpLogger::new();
        assert!(logger.is_enabled().await);
        assert_eq!(logger.get_default_level().await, McpLogLevel::Info);
    }

    #[tokio::test]
    async fn test_logger_with_default_level() {
        let logger = McpLogger::with_default_level(McpLogLevel::Debug);
        assert_eq!(logger.get_default_level().await, McpLogLevel::Debug);
    }

    #[tokio::test]
    async fn test_set_server_log_level() {
        let logger = McpLogger::new();

        // Default level should be Info
        assert_eq!(
            logger.get_server_log_level("test-server").await,
            McpLogLevel::Info
        );

        // Set specific level
        logger
            .set_server_log_level("test-server", McpLogLevel::Debug)
            .await;
        assert_eq!(
            logger.get_server_log_level("test-server").await,
            McpLogLevel::Debug
        );

        // Other servers should still use default
        assert_eq!(
            logger.get_server_log_level("other-server").await,
            McpLogLevel::Info
        );
    }

    #[tokio::test]
    async fn test_remove_server_log_level() {
        let logger = McpLogger::new();

        logger
            .set_server_log_level("test-server", McpLogLevel::Debug)
            .await;
        assert_eq!(
            logger.get_server_log_level("test-server").await,
            McpLogLevel::Debug
        );

        logger.remove_server_log_level("test-server").await;
        assert_eq!(
            logger.get_server_log_level("test-server").await,
            McpLogLevel::Info
        );
    }

    #[tokio::test]
    async fn test_set_enabled() {
        let logger = McpLogger::new();

        assert!(logger.is_enabled().await);

        logger.set_enabled(false).await;
        assert!(!logger.is_enabled().await);

        logger.set_enabled(true).await;
        assert!(logger.is_enabled().await);
    }

    #[tokio::test]
    async fn test_log_callback() {
        let logger = McpLogger::new();
        let call_count = Arc::new(AtomicUsize::new(0));
        let call_count_clone = call_count.clone();

        logger
            .on_log(Arc::new(move |_entry| {
                call_count_clone.fetch_add(1, Ordering::SeqCst);
            }))
            .await;

        let entry = McpLogEntry::new("test-server", McpLogLevel::Info, "Test message");
        logger.log(entry).await;

        assert_eq!(call_count.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn test_log_level_filtering() {
        let logger = McpLogger::new();
        let call_count = Arc::new(AtomicUsize::new(0));
        let call_count_clone = call_count.clone();

        logger
            .on_log(Arc::new(move |_entry| {
                call_count_clone.fetch_add(1, Ordering::SeqCst);
            }))
            .await;

        // Set server level to Warn
        logger
            .set_server_log_level("test-server", McpLogLevel::Warn)
            .await;

        // Debug message should be filtered
        let debug_entry = McpLogEntry::new("test-server", McpLogLevel::Debug, "Debug message");
        logger.log(debug_entry).await;
        assert_eq!(call_count.load(Ordering::SeqCst), 0);

        // Info message should be filtered
        let info_entry = McpLogEntry::new("test-server", McpLogLevel::Info, "Info message");
        logger.log(info_entry).await;
        assert_eq!(call_count.load(Ordering::SeqCst), 0);

        // Warn message should pass
        let warn_entry = McpLogEntry::new("test-server", McpLogLevel::Warn, "Warn message");
        logger.log(warn_entry).await;
        assert_eq!(call_count.load(Ordering::SeqCst), 1);

        // Error message should pass
        let error_entry = McpLogEntry::new("test-server", McpLogLevel::Error, "Error message");
        logger.log(error_entry).await;
        assert_eq!(call_count.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn test_log_disabled() {
        let logger = McpLogger::new();
        let call_count = Arc::new(AtomicUsize::new(0));
        let call_count_clone = call_count.clone();

        logger
            .on_log(Arc::new(move |_entry| {
                call_count_clone.fetch_add(1, Ordering::SeqCst);
            }))
            .await;

        // Disable logging
        logger.set_enabled(false).await;

        let entry = McpLogEntry::new("test-server", McpLogLevel::Info, "Test message");
        logger.log(entry).await;

        // Callback should not be called
        assert_eq!(call_count.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn test_process_notification() {
        let logger = McpLogger::new();
        let call_count = Arc::new(AtomicUsize::new(0));
        let received_message = Arc::new(RwLock::new(String::new()));
        let call_count_clone = call_count.clone();
        let received_message_clone = received_message.clone();

        logger
            .on_log(Arc::new(move |entry| {
                call_count_clone.fetch_add(1, Ordering::SeqCst);
                let msg = entry.message.clone();
                let rm = received_message_clone.clone();
                tokio::spawn(async move {
                    let mut m = rm.write().await;
                    *m = msg;
                });
            }))
            .await;

        let params = serde_json::json!({
            "level": "info",
            "data": "Test notification message",
            "logger": "test-logger"
        });

        logger.process_notification("test-server", &params).await;

        assert_eq!(call_count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn test_log_entry_new() {
        let entry = McpLogEntry::new("server", McpLogLevel::Info, "message");
        assert_eq!(entry.server_name, "server");
        assert_eq!(entry.level, McpLogLevel::Info);
        assert_eq!(entry.message, "message");
        assert!(entry.data.is_none());
        assert!(entry.logger.is_none());
    }

    #[test]
    fn test_log_entry_with_data() {
        let entry = McpLogEntry::new("server", McpLogLevel::Info, "message")
            .with_data(serde_json::json!({"key": "value"}));
        assert!(entry.data.is_some());
    }

    #[test]
    fn test_log_entry_with_logger() {
        let entry =
            McpLogEntry::new("server", McpLogLevel::Info, "message").with_logger("custom-logger");
        assert_eq!(entry.logger, Some("custom-logger".to_string()));
    }
}
