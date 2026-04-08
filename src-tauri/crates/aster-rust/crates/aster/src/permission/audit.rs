//! Audit Logging Module for Tool Permission System
//!
//! This module provides structured audit logging for permission checks and tool executions.
//! It uses the `tracing` crate for structured logging with configurable log levels.
//!
//! Features:
//! - Configurable log levels (Debug, Info, Warn, Error)
//! - Structured logging with JSON-compatible fields
//! - Failure resilience - logging failures don't block main operations
//! - Enable/disable toggle for audit logging
//!
//! Requirements: 10.1, 10.2, 10.3, 10.4, 10.5

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::types::{PermissionContext, PermissionResult};

/// Audit log level
///
/// Defines the severity level for audit log entries.
/// Each level includes messages of higher severity levels.
///
/// Requirements: 10.3
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum AuditLogLevel {
    /// Debug level - most verbose, includes all messages
    Debug,
    /// Info level - standard operational messages
    #[default]
    Info,
    /// Warn level - warning messages and above
    Warn,
    /// Error level - only error messages
    Error,
}

impl AuditLogLevel {
    /// Check if a message at the given level should be logged
    /// based on the current configured level
    pub fn should_log(&self, message_level: AuditLogLevel) -> bool {
        let self_priority = self.priority();
        let message_priority = message_level.priority();
        message_priority >= self_priority
    }

    /// Get the numeric priority of the log level (higher = more severe)
    fn priority(&self) -> u8 {
        match self {
            AuditLogLevel::Debug => 0,
            AuditLogLevel::Info => 1,
            AuditLogLevel::Warn => 2,
            AuditLogLevel::Error => 3,
        }
    }
}

/// Audit log entry
///
/// Contains all information about a permission check or tool execution event.
///
/// Requirements: 10.1, 10.2, 10.4
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditLogEntry {
    /// Unix timestamp of the event
    pub timestamp: i64,
    /// Log level for this entry
    pub level: AuditLogLevel,
    /// Type of event (e.g., "permission_check", "tool_execution")
    pub event_type: String,
    /// Name of the tool being checked/executed
    pub tool_name: String,
    /// Parameters passed to the tool
    pub parameters: HashMap<String, serde_json::Value>,
    /// Permission context at the time of the event
    pub context: PermissionContext,
    /// Result of the permission check (if applicable)
    pub result: Option<PermissionResult>,
    /// Duration of the operation in milliseconds (for tool execution)
    pub duration_ms: Option<u64>,
    /// Additional metadata
    pub metadata: HashMap<String, serde_json::Value>,
}

impl Default for AuditLogEntry {
    fn default() -> Self {
        Self {
            timestamp: 0,
            level: AuditLogLevel::Info,
            event_type: String::new(),
            tool_name: String::new(),
            parameters: HashMap::new(),
            context: PermissionContext::default(),
            result: None,
            duration_ms: None,
            metadata: HashMap::new(),
        }
    }
}

impl AuditLogEntry {
    /// Create a new audit log entry with the current timestamp
    pub fn new(event_type: impl Into<String>, tool_name: impl Into<String>) -> Self {
        Self {
            timestamp: chrono::Utc::now().timestamp(),
            event_type: event_type.into(),
            tool_name: tool_name.into(),
            ..Default::default()
        }
    }

    /// Set the log level
    pub fn with_level(mut self, level: AuditLogLevel) -> Self {
        self.level = level;
        self
    }

    /// Set the parameters
    pub fn with_parameters(mut self, parameters: HashMap<String, serde_json::Value>) -> Self {
        self.parameters = parameters;
        self
    }

    /// Set the context
    pub fn with_context(mut self, context: PermissionContext) -> Self {
        self.context = context;
        self
    }

    /// Set the result
    pub fn with_result(mut self, result: PermissionResult) -> Self {
        self.result = Some(result);
        self
    }

    /// Set the duration
    pub fn with_duration_ms(mut self, duration_ms: u64) -> Self {
        self.duration_ms = Some(duration_ms);
        self
    }

    /// Set the metadata
    pub fn with_metadata(mut self, metadata: HashMap<String, serde_json::Value>) -> Self {
        self.metadata = metadata;
        self
    }

    /// Add a single metadata entry
    pub fn add_metadata(mut self, key: impl Into<String>, value: serde_json::Value) -> Self {
        self.metadata.insert(key.into(), value);
        self
    }
}

/// Audit logger
///
/// Provides structured audit logging for permission checks and tool executions.
/// Uses the `tracing` crate for output with configurable log levels.
///
/// Requirements: 10.3, 10.5
#[derive(Debug, Clone)]
pub struct AuditLogger {
    /// Current log level threshold
    level: AuditLogLevel,
    /// Whether audit logging is enabled
    enabled: bool,
}

impl Default for AuditLogger {
    fn default() -> Self {
        Self {
            level: AuditLogLevel::Info,
            enabled: true,
        }
    }
}

impl AuditLogger {
    /// Create a new audit logger with the specified log level
    ///
    /// # Arguments
    /// * `level` - The minimum log level to record
    ///
    /// Requirements: 10.3
    pub fn new(level: AuditLogLevel) -> Self {
        Self {
            level,
            enabled: true,
        }
    }

    /// Get the current log level
    pub fn level(&self) -> AuditLogLevel {
        self.level
    }

    /// Check if the logger is enabled
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    /// Set the log level
    ///
    /// # Arguments
    /// * `level` - The new minimum log level to record
    ///
    /// Requirements: 10.3
    pub fn set_level(&mut self, level: AuditLogLevel) {
        self.level = level;
    }

    /// Enable audit logging
    ///
    /// Requirements: 10.3
    pub fn enable(&mut self) {
        self.enabled = true;
    }

    /// Disable audit logging
    ///
    /// Requirements: 10.3
    pub fn disable(&mut self) {
        self.enabled = false;
    }

    /// Log a permission check event
    ///
    /// Records when a permission check is performed, including the tool name,
    /// parameters, context, and result.
    ///
    /// # Arguments
    /// * `entry` - The audit log entry to record
    ///
    /// # Behavior
    /// - If logging is disabled, returns immediately
    /// - If the entry's level is below the configured threshold, returns immediately
    /// - Logging failures are caught and do not propagate (Requirement 10.5)
    ///
    /// Requirements: 10.1, 10.4, 10.5
    pub fn log_permission_check(&self, entry: AuditLogEntry) {
        // Requirement 10.5: Ensure logging failures don't block main flow
        let _ = self.try_log_permission_check(entry);
    }

    /// Internal method that can fail - wrapped by log_permission_check for resilience
    fn try_log_permission_check(&self, entry: AuditLogEntry) -> Result<(), ()> {
        if !self.enabled {
            return Ok(());
        }

        if !self.level.should_log(entry.level) {
            return Ok(());
        }

        // Serialize entry to JSON for structured logging
        let entry_json = serde_json::to_string(&entry).map_err(|_| ())?;

        match entry.level {
            AuditLogLevel::Debug => {
                tracing::debug!(
                    event_type = %entry.event_type,
                    tool_name = %entry.tool_name,
                    allowed = ?entry.result.as_ref().map(|r| r.allowed),
                    session_id = %entry.context.session_id,
                    audit_entry = %entry_json,
                    "Permission check"
                );
            }
            AuditLogLevel::Info => {
                tracing::info!(
                    event_type = %entry.event_type,
                    tool_name = %entry.tool_name,
                    allowed = ?entry.result.as_ref().map(|r| r.allowed),
                    session_id = %entry.context.session_id,
                    audit_entry = %entry_json,
                    "Permission check"
                );
            }
            AuditLogLevel::Warn => {
                tracing::warn!(
                    event_type = %entry.event_type,
                    tool_name = %entry.tool_name,
                    allowed = ?entry.result.as_ref().map(|r| r.allowed),
                    session_id = %entry.context.session_id,
                    audit_entry = %entry_json,
                    "Permission check"
                );
            }
            AuditLogLevel::Error => {
                tracing::error!(
                    event_type = %entry.event_type,
                    tool_name = %entry.tool_name,
                    allowed = ?entry.result.as_ref().map(|r| r.allowed),
                    session_id = %entry.context.session_id,
                    audit_entry = %entry_json,
                    "Permission check"
                );
            }
        }

        Ok(())
    }

    /// Log a tool execution event
    ///
    /// Records when a tool execution completes, including the tool name,
    /// parameters, result, and duration.
    ///
    /// # Arguments
    /// * `entry` - The audit log entry to record
    ///
    /// # Behavior
    /// - If logging is disabled, returns immediately
    /// - If the entry's level is below the configured threshold, returns immediately
    /// - Logging failures are caught and do not propagate (Requirement 10.5)
    ///
    /// Requirements: 10.2, 10.4, 10.5
    pub fn log_tool_execution(&self, entry: AuditLogEntry) {
        // Requirement 10.5: Ensure logging failures don't block main flow
        let _ = self.try_log_tool_execution(entry);
    }

    /// Internal method that can fail - wrapped by log_tool_execution for resilience
    fn try_log_tool_execution(&self, entry: AuditLogEntry) -> Result<(), ()> {
        if !self.enabled {
            return Ok(());
        }

        if !self.level.should_log(entry.level) {
            return Ok(());
        }

        // Serialize entry to JSON for structured logging
        let entry_json = serde_json::to_string(&entry).map_err(|_| ())?;

        match entry.level {
            AuditLogLevel::Debug => {
                tracing::debug!(
                    event_type = %entry.event_type,
                    tool_name = %entry.tool_name,
                    duration_ms = ?entry.duration_ms,
                    session_id = %entry.context.session_id,
                    audit_entry = %entry_json,
                    "Tool execution"
                );
            }
            AuditLogLevel::Info => {
                tracing::info!(
                    event_type = %entry.event_type,
                    tool_name = %entry.tool_name,
                    duration_ms = ?entry.duration_ms,
                    session_id = %entry.context.session_id,
                    audit_entry = %entry_json,
                    "Tool execution"
                );
            }
            AuditLogLevel::Warn => {
                tracing::warn!(
                    event_type = %entry.event_type,
                    tool_name = %entry.tool_name,
                    duration_ms = ?entry.duration_ms,
                    session_id = %entry.context.session_id,
                    audit_entry = %entry_json,
                    "Tool execution"
                );
            }
            AuditLogLevel::Error => {
                tracing::error!(
                    event_type = %entry.event_type,
                    tool_name = %entry.tool_name,
                    duration_ms = ?entry.duration_ms,
                    session_id = %entry.context.session_id,
                    audit_entry = %entry_json,
                    "Tool execution"
                );
            }
        }

        Ok(())
    }

    /// Log a generic audit event
    ///
    /// A general-purpose logging method for custom audit events.
    ///
    /// # Arguments
    /// * `entry` - The audit log entry to record
    ///
    /// Requirements: 10.4, 10.5
    pub fn log(&self, entry: AuditLogEntry) {
        // Requirement 10.5: Ensure logging failures don't block main flow
        let _ = self.try_log(entry);
    }

    /// Internal method that can fail - wrapped by log for resilience
    fn try_log(&self, entry: AuditLogEntry) -> Result<(), ()> {
        if !self.enabled {
            return Ok(());
        }

        if !self.level.should_log(entry.level) {
            return Ok(());
        }

        // Serialize entry to JSON for structured logging
        let entry_json = serde_json::to_string(&entry).map_err(|_| ())?;

        match entry.level {
            AuditLogLevel::Debug => {
                tracing::debug!(
                    event_type = %entry.event_type,
                    tool_name = %entry.tool_name,
                    session_id = %entry.context.session_id,
                    audit_entry = %entry_json,
                    "Audit event"
                );
            }
            AuditLogLevel::Info => {
                tracing::info!(
                    event_type = %entry.event_type,
                    tool_name = %entry.tool_name,
                    session_id = %entry.context.session_id,
                    audit_entry = %entry_json,
                    "Audit event"
                );
            }
            AuditLogLevel::Warn => {
                tracing::warn!(
                    event_type = %entry.event_type,
                    tool_name = %entry.tool_name,
                    session_id = %entry.context.session_id,
                    audit_entry = %entry_json,
                    "Audit event"
                );
            }
            AuditLogLevel::Error => {
                tracing::error!(
                    event_type = %entry.event_type,
                    tool_name = %entry.tool_name,
                    session_id = %entry.context.session_id,
                    audit_entry = %entry_json,
                    "Audit event"
                );
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn create_test_context() -> PermissionContext {
        PermissionContext {
            working_directory: PathBuf::from("/home/user/project"),
            session_id: "test-session-123".to_string(),
            timestamp: 1700000000,
            user: Some("testuser".to_string()),
            environment: HashMap::new(),
            metadata: HashMap::new(),
        }
    }

    fn create_test_result(allowed: bool) -> PermissionResult {
        PermissionResult {
            allowed,
            reason: if allowed {
                None
            } else {
                Some("Test denial".to_string())
            },
            restricted: false,
            suggestions: Vec::new(),
            matched_rule: None,
            violations: Vec::new(),
        }
    }

    #[test]
    fn test_audit_log_level_default() {
        assert_eq!(AuditLogLevel::default(), AuditLogLevel::Info);
    }

    #[test]
    fn test_audit_log_level_should_log() {
        let debug_level = AuditLogLevel::Debug;
        let info_level = AuditLogLevel::Info;
        let warn_level = AuditLogLevel::Warn;
        let error_level = AuditLogLevel::Error;

        // Debug level logs everything
        assert!(debug_level.should_log(AuditLogLevel::Debug));
        assert!(debug_level.should_log(AuditLogLevel::Info));
        assert!(debug_level.should_log(AuditLogLevel::Warn));
        assert!(debug_level.should_log(AuditLogLevel::Error));

        // Info level logs Info and above
        assert!(!info_level.should_log(AuditLogLevel::Debug));
        assert!(info_level.should_log(AuditLogLevel::Info));
        assert!(info_level.should_log(AuditLogLevel::Warn));
        assert!(info_level.should_log(AuditLogLevel::Error));

        // Warn level logs Warn and above
        assert!(!warn_level.should_log(AuditLogLevel::Debug));
        assert!(!warn_level.should_log(AuditLogLevel::Info));
        assert!(warn_level.should_log(AuditLogLevel::Warn));
        assert!(warn_level.should_log(AuditLogLevel::Error));

        // Error level logs only Error
        assert!(!error_level.should_log(AuditLogLevel::Debug));
        assert!(!error_level.should_log(AuditLogLevel::Info));
        assert!(!error_level.should_log(AuditLogLevel::Warn));
        assert!(error_level.should_log(AuditLogLevel::Error));
    }

    #[test]
    fn test_audit_log_entry_new() {
        let entry = AuditLogEntry::new("permission_check", "bash");

        assert_eq!(entry.event_type, "permission_check");
        assert_eq!(entry.tool_name, "bash");
        assert!(entry.timestamp > 0);
        assert_eq!(entry.level, AuditLogLevel::Info);
    }

    #[test]
    fn test_audit_log_entry_builder() {
        let context = create_test_context();
        let result = create_test_result(true);
        let mut params = HashMap::new();
        params.insert("command".to_string(), serde_json::json!("ls -la"));

        let entry = AuditLogEntry::new("permission_check", "bash")
            .with_level(AuditLogLevel::Debug)
            .with_parameters(params.clone())
            .with_context(context.clone())
            .with_result(result.clone())
            .with_duration_ms(100)
            .add_metadata("custom_field", serde_json::json!("custom_value"));

        assert_eq!(entry.level, AuditLogLevel::Debug);
        assert_eq!(entry.parameters, params);
        assert_eq!(entry.context.session_id, context.session_id);
        assert!(entry.result.is_some());
        assert!(entry.result.unwrap().allowed);
        assert_eq!(entry.duration_ms, Some(100));
        assert!(entry.metadata.contains_key("custom_field"));
    }

    #[test]
    fn test_audit_logger_new() {
        let logger = AuditLogger::new(AuditLogLevel::Warn);

        assert_eq!(logger.level(), AuditLogLevel::Warn);
        assert!(logger.is_enabled());
    }

    #[test]
    fn test_audit_logger_default() {
        let logger = AuditLogger::default();

        assert_eq!(logger.level(), AuditLogLevel::Info);
        assert!(logger.is_enabled());
    }

    #[test]
    fn test_audit_logger_set_level() {
        let mut logger = AuditLogger::new(AuditLogLevel::Info);

        logger.set_level(AuditLogLevel::Error);

        assert_eq!(logger.level(), AuditLogLevel::Error);
    }

    #[test]
    fn test_audit_logger_enable_disable() {
        let mut logger = AuditLogger::new(AuditLogLevel::Info);

        assert!(logger.is_enabled());

        logger.disable();
        assert!(!logger.is_enabled());

        logger.enable();
        assert!(logger.is_enabled());
    }

    #[test]
    fn test_audit_logger_log_permission_check() {
        let logger = AuditLogger::new(AuditLogLevel::Debug);
        let context = create_test_context();
        let result = create_test_result(true);

        let entry = AuditLogEntry::new("permission_check", "bash")
            .with_context(context)
            .with_result(result);

        // This should not panic even without a tracing subscriber
        logger.log_permission_check(entry);
    }

    #[test]
    fn test_audit_logger_log_tool_execution() {
        let logger = AuditLogger::new(AuditLogLevel::Debug);
        let context = create_test_context();

        let entry = AuditLogEntry::new("tool_execution", "bash")
            .with_context(context)
            .with_duration_ms(150);

        // This should not panic even without a tracing subscriber
        logger.log_tool_execution(entry);
    }

    #[test]
    fn test_audit_logger_disabled_does_not_log() {
        let mut logger = AuditLogger::new(AuditLogLevel::Debug);
        logger.disable();

        let entry = AuditLogEntry::new("permission_check", "bash");

        // This should return immediately without logging
        logger.log_permission_check(entry);
    }

    #[test]
    fn test_audit_logger_level_filtering() {
        let logger = AuditLogger::new(AuditLogLevel::Error);

        // Info level entry should not be logged when logger is at Error level
        let entry = AuditLogEntry::new("permission_check", "bash").with_level(AuditLogLevel::Info);

        // This should return immediately without logging
        logger.log_permission_check(entry);
    }

    #[test]
    fn test_audit_log_entry_serialization() {
        let context = create_test_context();
        let result = create_test_result(false);

        let entry = AuditLogEntry::new("permission_check", "bash")
            .with_context(context)
            .with_result(result);

        let json = serde_json::to_string(&entry).unwrap();
        let deserialized: AuditLogEntry = serde_json::from_str(&json).unwrap();

        assert_eq!(entry.event_type, deserialized.event_type);
        assert_eq!(entry.tool_name, deserialized.tool_name);
        assert_eq!(entry.level, deserialized.level);
    }

    #[test]
    fn test_audit_logger_failure_resilience() {
        let logger = AuditLogger::new(AuditLogLevel::Debug);

        // Even with potentially problematic data, logging should not panic
        let entry = AuditLogEntry::new("permission_check", "bash");

        // These should all complete without panicking
        logger.log_permission_check(entry.clone());
        logger.log_tool_execution(entry.clone());
        logger.log(entry);
    }
}
