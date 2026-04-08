//! Tool Context and Configuration Types
//!
//! This module defines the core types for tool execution context and configuration:
//! - `ToolContext`: Execution environment information
//! - `ToolOptions`: Tool configuration options
//! - `ToolDefinition`: Tool definition for LLM consumption
//! - `ToolResult`: Tool execution result
//!
//! Requirements: 1.3, 1.4

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

use crate::providers::base::Provider;

/// Tool execution context
///
/// Contains environment information available during tool execution.
/// This is passed to every tool's execute method.
#[derive(Clone)]
pub struct ToolContext {
    /// Current working directory for the tool execution
    pub working_directory: PathBuf,

    /// Session identifier for tracking
    pub session_id: String,

    /// Optional user identifier
    pub user: Option<String>,

    /// Environment variables available to the tool
    pub environment: HashMap<String, String>,

    /// Cancellation token for cooperative cancellation
    pub cancellation_token: Option<CancellationToken>,

    /// Optional model provider associated with the current session
    pub provider: Option<Arc<dyn Provider>>,
}

impl std::fmt::Debug for ToolContext {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let provider_name = self.provider.as_ref().map(|provider| provider.get_name());
        let has_cancellation_token = self.cancellation_token.is_some();

        f.debug_struct("ToolContext")
            .field("working_directory", &self.working_directory)
            .field("session_id", &self.session_id)
            .field("user", &self.user)
            .field("environment", &self.environment)
            .field("has_cancellation_token", &has_cancellation_token)
            .field("provider", &provider_name)
            .finish()
    }
}

impl Default for ToolContext {
    fn default() -> Self {
        Self {
            working_directory: std::env::current_dir().unwrap_or_default(),
            session_id: String::new(),
            user: None,
            environment: HashMap::new(),
            cancellation_token: None,
            provider: None,
        }
    }
}

impl ToolContext {
    /// Create a new ToolContext with the given working directory
    pub fn new(working_directory: PathBuf) -> Self {
        Self {
            working_directory,
            ..Default::default()
        }
    }

    /// Set the session ID
    pub fn with_session_id(mut self, session_id: impl Into<String>) -> Self {
        self.session_id = session_id.into();
        self
    }

    /// Set the user
    pub fn with_user(mut self, user: impl Into<String>) -> Self {
        self.user = Some(user.into());
        self
    }

    /// Set environment variables
    pub fn with_environment(mut self, environment: HashMap<String, String>) -> Self {
        self.environment = environment;
        self
    }

    /// Add a single environment variable
    pub fn with_env_var(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.environment.insert(key.into(), value.into());
        self
    }

    /// Set the cancellation token
    pub fn with_cancellation_token(mut self, token: CancellationToken) -> Self {
        self.cancellation_token = Some(token);
        self
    }

    /// Set the provider associated with the current session
    pub fn with_provider(mut self, provider: Arc<dyn Provider>) -> Self {
        self.provider = Some(provider);
        self
    }

    /// Check if cancellation has been requested
    pub fn is_cancelled(&self) -> bool {
        self.cancellation_token
            .as_ref()
            .is_some_and(|t| t.is_cancelled())
    }
}

/// Tool configuration options
///
/// Configurable options for tool execution behavior.
/// Requirements: 1.3
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolOptions {
    /// Maximum number of retry attempts for transient failures
    pub max_retries: u32,

    /// Base timeout duration for tool execution
    #[serde(with = "duration_serde")]
    pub base_timeout: Duration,

    /// Whether to enable dynamic timeout adjustment
    pub enable_dynamic_timeout: bool,

    /// List of error patterns that are considered retryable
    pub retryable_errors: Vec<String>,
}

impl Default for ToolOptions {
    fn default() -> Self {
        Self {
            max_retries: 3,
            base_timeout: Duration::from_secs(30),
            enable_dynamic_timeout: true,
            retryable_errors: vec![
                "timeout".to_string(),
                "connection refused".to_string(),
                "temporary failure".to_string(),
            ],
        }
    }
}

impl ToolOptions {
    /// Create new ToolOptions with default values
    pub fn new() -> Self {
        Self::default()
    }

    /// Set maximum retries
    pub fn with_max_retries(mut self, max_retries: u32) -> Self {
        self.max_retries = max_retries;
        self
    }

    /// Set base timeout
    pub fn with_base_timeout(mut self, timeout: Duration) -> Self {
        self.base_timeout = timeout;
        self
    }

    /// Enable or disable dynamic timeout
    pub fn with_dynamic_timeout(mut self, enabled: bool) -> Self {
        self.enable_dynamic_timeout = enabled;
        self
    }

    /// Set retryable error patterns
    pub fn with_retryable_errors(mut self, errors: Vec<String>) -> Self {
        self.retryable_errors = errors;
        self
    }

    /// Check if an error message matches any retryable pattern
    pub fn is_error_retryable(&self, error_msg: &str) -> bool {
        let error_lower = error_msg.to_lowercase();
        self.retryable_errors
            .iter()
            .any(|pattern| error_lower.contains(&pattern.to_lowercase()))
    }
}

/// Tool definition for LLM consumption
///
/// Contains the information needed by an LLM to understand and use a tool.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    /// Tool name (unique identifier)
    pub name: String,

    /// Human-readable description of what the tool does
    pub description: String,

    /// JSON Schema for the tool's input parameters
    pub input_schema: serde_json::Value,
}

impl ToolDefinition {
    /// Create a new ToolDefinition
    pub fn new(
        name: impl Into<String>,
        description: impl Into<String>,
        input_schema: serde_json::Value,
    ) -> Self {
        Self {
            name: name.into(),
            description: description.into(),
            input_schema,
        }
    }
}

/// Tool execution result
///
/// Contains the outcome of a tool execution.
/// Requirements: 1.4
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    /// Whether the execution was successful
    pub success: bool,

    /// Output content (if successful)
    pub output: Option<String>,

    /// Error message (if failed)
    pub error: Option<String>,

    /// Additional metadata about the execution
    pub metadata: HashMap<String, serde_json::Value>,
}

impl Default for ToolResult {
    fn default() -> Self {
        Self {
            success: true,
            output: None,
            error: None,
            metadata: HashMap::new(),
        }
    }
}

impl ToolResult {
    /// Create a successful result with output
    pub fn success(output: impl Into<String>) -> Self {
        Self {
            success: true,
            output: Some(output.into()),
            error: None,
            metadata: HashMap::new(),
        }
    }

    /// Create a successful result without output
    pub fn success_empty() -> Self {
        Self {
            success: true,
            output: None,
            error: None,
            metadata: HashMap::new(),
        }
    }

    /// Create a failed result with error message
    pub fn error(error: impl Into<String>) -> Self {
        Self {
            success: false,
            output: None,
            error: Some(error.into()),
            metadata: HashMap::new(),
        }
    }

    /// Add metadata to the result
    pub fn with_metadata(mut self, key: impl Into<String>, value: serde_json::Value) -> Self {
        self.metadata.insert(key.into(), value);
        self
    }

    /// Add multiple metadata entries
    pub fn with_metadata_map(mut self, metadata: HashMap<String, serde_json::Value>) -> Self {
        self.metadata.extend(metadata);
        self
    }

    /// Check if the result indicates success
    pub fn is_success(&self) -> bool {
        self.success
    }

    /// Check if the result indicates failure
    pub fn is_error(&self) -> bool {
        !self.success
    }

    /// Get the output or error message
    pub fn message(&self) -> Option<&str> {
        if self.success {
            self.output.as_deref()
        } else {
            self.error.as_deref()
        }
    }

    /// Get the content (output or error message)
    pub fn content(&self) -> &str {
        self.message().unwrap_or("")
    }

    /// Create a new result with updated content
    pub fn with_content(mut self, content: impl Into<String>) -> Self {
        let content = content.into();
        if self.success {
            self.output = Some(content);
        } else {
            self.error = Some(content);
        }
        self
    }
}

/// Serde helper for Duration serialization
mod duration_serde {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};
    use std::time::Duration;

    pub fn serialize<S>(duration: &Duration, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        duration.as_secs().serialize(serializer)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Duration, D::Error>
    where
        D: Deserializer<'de>,
    {
        let secs = u64::deserialize(deserializer)?;
        Ok(Duration::from_secs(secs))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tool_context_default() {
        let ctx = ToolContext::default();
        assert!(ctx.session_id.is_empty());
        assert!(ctx.user.is_none());
        assert!(ctx.environment.is_empty());
        assert!(ctx.cancellation_token.is_none());
    }

    #[test]
    fn test_tool_context_builder() {
        let ctx = ToolContext::new(PathBuf::from("/tmp"))
            .with_session_id("session-123")
            .with_user("test-user")
            .with_env_var("HOME", "/home/test");

        assert_eq!(ctx.working_directory, PathBuf::from("/tmp"));
        assert_eq!(ctx.session_id, "session-123");
        assert_eq!(ctx.user, Some("test-user".to_string()));
        assert_eq!(ctx.environment.get("HOME"), Some(&"/home/test".to_string()));
    }

    #[test]
    fn test_tool_context_cancellation() {
        let token = CancellationToken::new();
        let ctx = ToolContext::default().with_cancellation_token(token.clone());

        assert!(!ctx.is_cancelled());
        token.cancel();
        assert!(ctx.is_cancelled());
    }

    #[test]
    fn test_tool_options_default() {
        let opts = ToolOptions::default();
        assert_eq!(opts.max_retries, 3);
        assert_eq!(opts.base_timeout, Duration::from_secs(30));
        assert!(opts.enable_dynamic_timeout);
        assert!(!opts.retryable_errors.is_empty());
    }

    #[test]
    fn test_tool_options_builder() {
        let opts = ToolOptions::new()
            .with_max_retries(5)
            .with_base_timeout(Duration::from_secs(60))
            .with_dynamic_timeout(false);

        assert_eq!(opts.max_retries, 5);
        assert_eq!(opts.base_timeout, Duration::from_secs(60));
        assert!(!opts.enable_dynamic_timeout);
    }

    #[test]
    fn test_tool_options_is_error_retryable() {
        let opts = ToolOptions::default();
        assert!(opts.is_error_retryable("Connection timeout occurred"));
        assert!(opts.is_error_retryable("TIMEOUT"));
        assert!(opts.is_error_retryable("connection refused by server"));
        assert!(!opts.is_error_retryable("permission denied"));
        assert!(!opts.is_error_retryable("file not found"));
    }

    #[test]
    fn test_tool_definition() {
        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "command": { "type": "string" }
            },
            "required": ["command"]
        });

        let def = ToolDefinition::new("bash", "Execute shell commands", schema.clone());

        assert_eq!(def.name, "bash");
        assert_eq!(def.description, "Execute shell commands");
        assert_eq!(def.input_schema, schema);
    }

    #[test]
    fn test_tool_result_success() {
        let result = ToolResult::success("Hello, World!");
        assert!(result.is_success());
        assert!(!result.is_error());
        assert_eq!(result.output, Some("Hello, World!".to_string()));
        assert!(result.error.is_none());
        assert_eq!(result.message(), Some("Hello, World!"));
    }

    #[test]
    fn test_tool_result_success_empty() {
        let result = ToolResult::success_empty();
        assert!(result.is_success());
        assert!(result.output.is_none());
        assert!(result.error.is_none());
    }

    #[test]
    fn test_tool_result_error() {
        let result = ToolResult::error("Something went wrong");
        assert!(!result.is_success());
        assert!(result.is_error());
        assert!(result.output.is_none());
        assert_eq!(result.error, Some("Something went wrong".to_string()));
        assert_eq!(result.message(), Some("Something went wrong"));
    }

    #[test]
    fn test_tool_result_with_metadata() {
        let result = ToolResult::success("output")
            .with_metadata("duration_ms", serde_json::json!(100))
            .with_metadata("exit_code", serde_json::json!(0));

        assert_eq!(
            result.metadata.get("duration_ms"),
            Some(&serde_json::json!(100))
        );
        assert_eq!(
            result.metadata.get("exit_code"),
            Some(&serde_json::json!(0))
        );
    }

    #[test]
    fn test_tool_options_serialization() {
        let opts = ToolOptions::default();
        let json = serde_json::to_string(&opts).unwrap();
        let deserialized: ToolOptions = serde_json::from_str(&json).unwrap();

        assert_eq!(opts.max_retries, deserialized.max_retries);
        assert_eq!(opts.base_timeout, deserialized.base_timeout);
        assert_eq!(
            opts.enable_dynamic_timeout,
            deserialized.enable_dynamic_timeout
        );
    }

    #[test]
    fn test_tool_result_serialization() {
        let result =
            ToolResult::success("test output").with_metadata("key", serde_json::json!("value"));

        let json = serde_json::to_string(&result).unwrap();
        let deserialized: ToolResult = serde_json::from_str(&json).unwrap();

        assert_eq!(result.success, deserialized.success);
        assert_eq!(result.output, deserialized.output);
        assert_eq!(result.metadata, deserialized.metadata);
    }
}
