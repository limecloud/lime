//! Error Handler
//!
//! Provides unified error recording and management for agent execution.
//! Records errors with timestamps, context, and optional stack traces.
//!
//! **Validates: Requirements 15.1, 15.3**

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Error severity levels
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Default,
)]
#[serde(rename_all = "lowercase")]
pub enum ErrorSeverity {
    /// Debug level - for development
    Debug,
    /// Info level - informational
    Info,
    /// Warning level - potential issues
    Warning,
    /// Error level - recoverable errors
    #[default]
    Error,
    /// Critical level - unrecoverable errors
    Critical,
}

impl std::fmt::Display for ErrorSeverity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ErrorSeverity::Debug => write!(f, "debug"),
            ErrorSeverity::Info => write!(f, "info"),
            ErrorSeverity::Warning => write!(f, "warning"),
            ErrorSeverity::Error => write!(f, "error"),
            ErrorSeverity::Critical => write!(f, "critical"),
        }
    }
}

/// Error kinds for categorization
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentErrorKind {
    /// Timeout error
    Timeout,
    /// API call error
    ApiCall,
    /// Tool execution error
    ToolExecution,
    /// Context error
    Context,
    /// Configuration error
    Configuration,
    /// Resource limit error
    ResourceLimit,
    /// Network error
    Network,
    /// Serialization error
    Serialization,
    /// Internal error
    Internal,
    /// Custom error type
    Custom(String),
}

impl std::fmt::Display for AgentErrorKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AgentErrorKind::Timeout => write!(f, "timeout"),
            AgentErrorKind::ApiCall => write!(f, "api_call"),
            AgentErrorKind::ToolExecution => write!(f, "tool_execution"),
            AgentErrorKind::Context => write!(f, "context"),
            AgentErrorKind::Configuration => write!(f, "configuration"),
            AgentErrorKind::ResourceLimit => write!(f, "resource_limit"),
            AgentErrorKind::Network => write!(f, "network"),
            AgentErrorKind::Serialization => write!(f, "serialization"),
            AgentErrorKind::Internal => write!(f, "internal"),
            AgentErrorKind::Custom(name) => write!(f, "custom:{}", name),
        }
    }
}

/// Context information for an error
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorContext {
    /// Agent ID that encountered the error
    pub agent_id: Option<String>,
    /// Phase of execution (e.g., "tool_call", "api_call", "initialization")
    pub phase: Option<String>,
    /// Tool name if error occurred during tool execution
    pub tool_name: Option<String>,
    /// Tool call ID if applicable
    pub tool_call_id: Option<String>,
    /// Additional context data
    pub metadata: HashMap<String, serde_json::Value>,
}

impl ErrorContext {
    /// Create a new empty error context
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the agent ID
    pub fn with_agent_id(mut self, agent_id: impl Into<String>) -> Self {
        self.agent_id = Some(agent_id.into());
        self
    }

    /// Set the phase
    pub fn with_phase(mut self, phase: impl Into<String>) -> Self {
        self.phase = Some(phase.into());
        self
    }

    /// Set the tool name
    pub fn with_tool_name(mut self, tool_name: impl Into<String>) -> Self {
        self.tool_name = Some(tool_name.into());
        self
    }

    /// Set the tool call ID
    pub fn with_tool_call_id(mut self, tool_call_id: impl Into<String>) -> Self {
        self.tool_call_id = Some(tool_call_id.into());
        self
    }

    /// Add metadata
    pub fn with_metadata(mut self, key: impl Into<String>, value: serde_json::Value) -> Self {
        self.metadata.insert(key.into(), value);
        self
    }

    /// Check if context has any information
    pub fn is_empty(&self) -> bool {
        self.agent_id.is_none()
            && self.phase.is_none()
            && self.tool_name.is_none()
            && self.tool_call_id.is_none()
            && self.metadata.is_empty()
    }
}

/// Unified error record with full context
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorRecord {
    /// Unique error ID
    pub id: String,
    /// Error kind
    pub kind: AgentErrorKind,
    /// Error severity
    pub severity: ErrorSeverity,
    /// Error message
    pub message: String,
    /// Error timestamp
    pub timestamp: DateTime<Utc>,
    /// Error context
    pub context: ErrorContext,
    /// Stack trace if available
    pub stack_trace: Option<String>,
    /// Whether the error is recoverable
    pub recoverable: bool,
    /// Number of retry attempts made
    pub retry_count: u32,
}

impl ErrorRecord {
    /// Create a new error record
    pub fn new(kind: AgentErrorKind, message: impl Into<String>) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            kind,
            severity: ErrorSeverity::Error,
            message: message.into(),
            timestamp: Utc::now(),
            context: ErrorContext::new(),
            stack_trace: None,
            recoverable: true,
            retry_count: 0,
        }
    }

    /// Set the severity
    pub fn with_severity(mut self, severity: ErrorSeverity) -> Self {
        self.severity = severity;
        self
    }

    /// Set the context
    pub fn with_context(mut self, context: ErrorContext) -> Self {
        self.context = context;
        self
    }

    /// Set the stack trace
    pub fn with_stack_trace(mut self, stack_trace: impl Into<String>) -> Self {
        self.stack_trace = Some(stack_trace.into());
        self
    }

    /// Set whether the error is recoverable
    pub fn with_recoverable(mut self, recoverable: bool) -> Self {
        self.recoverable = recoverable;
        self
    }

    /// Set the retry count
    pub fn with_retry_count(mut self, count: u32) -> Self {
        self.retry_count = count;
        self
    }

    /// Create a timeout error
    pub fn timeout(message: impl Into<String>) -> Self {
        Self::new(AgentErrorKind::Timeout, message)
            .with_severity(ErrorSeverity::Error)
            .with_recoverable(false)
    }

    /// Create an API call error
    pub fn api_call(message: impl Into<String>) -> Self {
        Self::new(AgentErrorKind::ApiCall, message).with_severity(ErrorSeverity::Error)
    }

    /// Create a tool execution error
    pub fn tool_execution(tool_name: impl Into<String>, message: impl Into<String>) -> Self {
        let tool_name = tool_name.into();
        Self::new(AgentErrorKind::ToolExecution, message)
            .with_context(ErrorContext::new().with_tool_name(&tool_name))
    }

    /// Check if this error has context
    pub fn has_context(&self) -> bool {
        !self.context.is_empty()
    }

    /// Check if this error has a stack trace
    pub fn has_stack_trace(&self) -> bool {
        self.stack_trace.is_some()
    }
}

/// Agent error type for Result handling
#[derive(Debug, Clone)]
pub struct AgentError {
    /// The error record
    pub record: ErrorRecord,
    /// Source error message if wrapped
    pub source: Option<String>,
}

impl AgentError {
    /// Create a new agent error
    pub fn new(kind: AgentErrorKind, message: impl Into<String>) -> Self {
        Self {
            record: ErrorRecord::new(kind, message),
            source: None,
        }
    }

    /// Create from an error record
    pub fn from_record(record: ErrorRecord) -> Self {
        Self {
            record,
            source: None,
        }
    }

    /// Set the source error
    pub fn with_source(mut self, source: impl Into<String>) -> Self {
        self.source = Some(source.into());
        self
    }

    /// Set the context
    pub fn with_context(mut self, context: ErrorContext) -> Self {
        self.record = self.record.with_context(context);
        self
    }

    /// Get the error kind
    pub fn kind(&self) -> &AgentErrorKind {
        &self.record.kind
    }

    /// Get the error message
    pub fn message(&self) -> &str {
        &self.record.message
    }

    /// Check if the error is recoverable
    pub fn is_recoverable(&self) -> bool {
        self.record.recoverable
    }
}

impl std::fmt::Display for AgentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.record.kind, self.record.message)?;
        if let Some(source) = &self.source {
            write!(f, " (caused by: {})", source)?;
        }
        Ok(())
    }
}

impl std::error::Error for AgentError {}

/// Error handler for recording and managing errors
#[derive(Debug)]
pub struct ErrorHandler {
    /// All recorded errors indexed by ID
    errors: HashMap<String, ErrorRecord>,
    /// Errors indexed by agent ID
    errors_by_agent: HashMap<String, Vec<String>>,
    /// Maximum number of errors to keep
    max_errors: usize,
    /// Whether to capture stack traces
    capture_stack_traces: bool,
}

impl Default for ErrorHandler {
    fn default() -> Self {
        Self::new()
    }
}

impl ErrorHandler {
    /// Create a new error handler
    pub fn new() -> Self {
        Self {
            errors: HashMap::new(),
            errors_by_agent: HashMap::new(),
            max_errors: 10000,
            capture_stack_traces: false,
        }
    }

    /// Create with configuration
    pub fn with_config(max_errors: usize, capture_stack_traces: bool) -> Self {
        Self {
            errors: HashMap::new(),
            errors_by_agent: HashMap::new(),
            max_errors,
            capture_stack_traces,
        }
    }

    /// Record an error
    pub fn record(&mut self, mut error: ErrorRecord) -> String {
        // Capture stack trace if enabled and not already present
        if self.capture_stack_traces && error.stack_trace.is_none() {
            error.stack_trace = Some(Self::capture_backtrace());
        }

        let id = error.id.clone();

        // Track by agent ID if present
        if let Some(agent_id) = &error.context.agent_id {
            self.errors_by_agent
                .entry(agent_id.clone())
                .or_default()
                .push(id.clone());
        }

        // Enforce max errors limit
        if self.errors.len() >= self.max_errors {
            self.remove_oldest();
        }

        self.errors.insert(id.clone(), error);
        id
    }

    /// Record an error with context
    pub fn record_with_context(
        &mut self,
        kind: AgentErrorKind,
        message: impl Into<String>,
        context: ErrorContext,
    ) -> String {
        let error = ErrorRecord::new(kind, message).with_context(context);
        self.record(error)
    }

    /// Record a tool execution error
    pub fn record_tool_error(
        &mut self,
        agent_id: &str,
        tool_name: &str,
        tool_call_id: Option<&str>,
        message: impl Into<String>,
    ) -> String {
        let mut context = ErrorContext::new()
            .with_agent_id(agent_id)
            .with_phase("tool_execution")
            .with_tool_name(tool_name);

        if let Some(call_id) = tool_call_id {
            context = context.with_tool_call_id(call_id);
        }

        let error = ErrorRecord::tool_execution(tool_name, message).with_context(context);
        self.record(error)
    }

    /// Get an error by ID
    pub fn get(&self, error_id: &str) -> Option<&ErrorRecord> {
        self.errors.get(error_id)
    }

    /// Get all errors for an agent
    pub fn get_by_agent(&self, agent_id: &str) -> Vec<&ErrorRecord> {
        self.errors_by_agent
            .get(agent_id)
            .map(|ids| ids.iter().filter_map(|id| self.errors.get(id)).collect())
            .unwrap_or_default()
    }

    /// Get all errors of a specific kind
    pub fn get_by_kind(&self, kind: &AgentErrorKind) -> Vec<&ErrorRecord> {
        self.errors.values().filter(|e| &e.kind == kind).collect()
    }

    /// Get all errors with severity >= threshold
    pub fn get_by_severity(&self, min_severity: ErrorSeverity) -> Vec<&ErrorRecord> {
        self.errors
            .values()
            .filter(|e| e.severity >= min_severity)
            .collect()
    }

    /// Get all errors
    pub fn get_all(&self) -> Vec<&ErrorRecord> {
        self.errors.values().collect()
    }

    /// Get error count
    pub fn count(&self) -> usize {
        self.errors.len()
    }

    /// Get error count for an agent
    pub fn count_by_agent(&self, agent_id: &str) -> usize {
        self.errors_by_agent
            .get(agent_id)
            .map(|ids| ids.len())
            .unwrap_or(0)
    }

    /// Clear all errors
    pub fn clear(&mut self) {
        self.errors.clear();
        self.errors_by_agent.clear();
    }

    /// Clear errors for an agent
    pub fn clear_by_agent(&mut self, agent_id: &str) {
        if let Some(ids) = self.errors_by_agent.remove(agent_id) {
            for id in ids {
                self.errors.remove(&id);
            }
        }
    }

    /// Remove oldest error
    fn remove_oldest(&mut self) {
        if let Some(oldest_id) = self
            .errors
            .values()
            .min_by_key(|e| e.timestamp)
            .map(|e| e.id.clone())
        {
            if let Some(error) = self.errors.remove(&oldest_id) {
                if let Some(agent_id) = &error.context.agent_id {
                    if let Some(ids) = self.errors_by_agent.get_mut(agent_id) {
                        ids.retain(|id| id != &oldest_id);
                    }
                }
            }
        }
    }

    /// Capture a backtrace
    fn capture_backtrace() -> String {
        std::backtrace::Backtrace::capture().to_string()
    }

    /// Enable or disable stack trace capture
    pub fn set_capture_stack_traces(&mut self, capture: bool) {
        self.capture_stack_traces = capture;
    }

    /// Set maximum number of errors to keep
    pub fn set_max_errors(&mut self, max: usize) {
        self.max_errors = max;
    }
}

/// Thread-safe error handler wrapper
#[allow(dead_code)]
pub type SharedErrorHandler = Arc<RwLock<ErrorHandler>>;

/// Create a new shared error handler
#[allow(dead_code)]
pub fn new_shared_error_handler() -> SharedErrorHandler {
    Arc::new(RwLock::new(ErrorHandler::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_context_builder() {
        let context = ErrorContext::new()
            .with_agent_id("agent-1")
            .with_phase("tool_execution")
            .with_tool_name("bash")
            .with_tool_call_id("call-1")
            .with_metadata("key", serde_json::json!("value"));

        assert_eq!(context.agent_id, Some("agent-1".to_string()));
        assert_eq!(context.phase, Some("tool_execution".to_string()));
        assert_eq!(context.tool_name, Some("bash".to_string()));
        assert_eq!(context.tool_call_id, Some("call-1".to_string()));
        assert!(!context.is_empty());
    }

    #[test]
    fn test_error_record_creation() {
        let error = ErrorRecord::new(AgentErrorKind::ApiCall, "API call failed");

        assert!(!error.id.is_empty());
        assert_eq!(error.kind, AgentErrorKind::ApiCall);
        assert_eq!(error.message, "API call failed");
        assert_eq!(error.severity, ErrorSeverity::Error);
        assert!(error.recoverable);
    }

    #[test]
    fn test_error_record_timeout() {
        let error = ErrorRecord::timeout("Operation timed out after 30s");

        assert_eq!(error.kind, AgentErrorKind::Timeout);
        assert!(!error.recoverable);
    }

    #[test]
    fn test_error_record_tool_execution() {
        let error = ErrorRecord::tool_execution("bash", "Command failed");

        assert_eq!(error.kind, AgentErrorKind::ToolExecution);
        assert_eq!(error.context.tool_name, Some("bash".to_string()));
    }

    #[test]
    fn test_error_handler_record() {
        let mut handler = ErrorHandler::new();

        let error = ErrorRecord::new(AgentErrorKind::ApiCall, "Test error")
            .with_context(ErrorContext::new().with_agent_id("agent-1"));

        let id = handler.record(error);

        assert_eq!(handler.count(), 1);
        assert!(handler.get(&id).is_some());
        assert_eq!(handler.count_by_agent("agent-1"), 1);
    }

    #[test]
    fn test_error_handler_record_tool_error() {
        let mut handler = ErrorHandler::new();

        let id = handler.record_tool_error("agent-1", "bash", Some("call-1"), "Command failed");

        let error = handler.get(&id).unwrap();
        assert_eq!(error.kind, AgentErrorKind::ToolExecution);
        assert_eq!(error.context.agent_id, Some("agent-1".to_string()));
        assert_eq!(error.context.tool_name, Some("bash".to_string()));
        assert_eq!(error.context.tool_call_id, Some("call-1".to_string()));
    }

    #[test]
    fn test_error_handler_get_by_kind() {
        let mut handler = ErrorHandler::new();

        handler.record(ErrorRecord::new(AgentErrorKind::ApiCall, "Error 1"));
        handler.record(ErrorRecord::new(AgentErrorKind::Timeout, "Error 2"));
        handler.record(ErrorRecord::new(AgentErrorKind::ApiCall, "Error 3"));

        let api_errors = handler.get_by_kind(&AgentErrorKind::ApiCall);
        assert_eq!(api_errors.len(), 2);
    }

    #[test]
    fn test_error_handler_get_by_severity() {
        let mut handler = ErrorHandler::new();

        handler.record(
            ErrorRecord::new(AgentErrorKind::ApiCall, "Error 1")
                .with_severity(ErrorSeverity::Warning),
        );
        handler.record(
            ErrorRecord::new(AgentErrorKind::Timeout, "Error 2")
                .with_severity(ErrorSeverity::Critical),
        );
        handler.record(
            ErrorRecord::new(AgentErrorKind::ApiCall, "Error 3")
                .with_severity(ErrorSeverity::Error),
        );

        let severe_errors = handler.get_by_severity(ErrorSeverity::Error);
        assert_eq!(severe_errors.len(), 2); // Error and Critical
    }

    #[test]
    fn test_error_handler_clear_by_agent() {
        let mut handler = ErrorHandler::new();

        handler.record(
            ErrorRecord::new(AgentErrorKind::ApiCall, "Error 1")
                .with_context(ErrorContext::new().with_agent_id("agent-1")),
        );
        handler.record(
            ErrorRecord::new(AgentErrorKind::ApiCall, "Error 2")
                .with_context(ErrorContext::new().with_agent_id("agent-2")),
        );

        handler.clear_by_agent("agent-1");

        assert_eq!(handler.count(), 1);
        assert_eq!(handler.count_by_agent("agent-1"), 0);
        assert_eq!(handler.count_by_agent("agent-2"), 1);
    }

    #[test]
    fn test_error_handler_max_errors() {
        let mut handler = ErrorHandler::with_config(3, false);

        for i in 0..5 {
            handler.record(ErrorRecord::new(
                AgentErrorKind::ApiCall,
                format!("Error {}", i),
            ));
        }

        assert_eq!(handler.count(), 3);
    }

    #[test]
    fn test_agent_error_display() {
        let error = AgentError::new(AgentErrorKind::ApiCall, "API call failed")
            .with_source("Connection refused");

        let display = format!("{}", error);
        assert!(display.contains("api_call"));
        assert!(display.contains("API call failed"));
        assert!(display.contains("Connection refused"));
    }
}
