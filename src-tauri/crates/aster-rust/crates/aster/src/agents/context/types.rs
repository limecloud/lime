//! Agent Context Types
//!
//! This module defines the core types for agent context management,
//! including AgentContext, ContextMetadata, FileContext, and ToolExecutionResult.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use thiserror::Error;

use crate::conversation::message::Message;

/// Result type alias for agent context operations
pub type AgentContextResult<T> = Result<T, AgentContextError>;

/// Error types for agent context operations
#[derive(Debug, Error)]
pub enum AgentContextError {
    /// Context not found
    #[error("Context not found: {0}")]
    NotFound(String),

    /// Context already exists
    #[error("Context already exists: {0}")]
    AlreadyExists(String),

    /// Invalid context configuration
    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),

    /// Context persistence error
    #[error("Persistence error: {0}")]
    PersistenceError(String),

    /// Context compression error
    #[error("Compression error: {0}")]
    CompressionError(String),

    /// Context inheritance error
    #[error("Inheritance error: {0}")]
    InheritanceError(String),

    /// Sandbox resource limit exceeded
    #[error("Resource limit exceeded: {0}")]
    ResourceLimitExceeded(String),

    /// Tool not allowed in sandbox
    #[error("Tool not allowed: {0}")]
    ToolNotAllowed(String),

    /// Invalid sandbox state transition
    #[error("Invalid state transition: {0}")]
    InvalidStateTransition(String),

    /// Serialization/deserialization error
    #[error("Serialization error: {0}")]
    SerializationError(String),

    /// I/O error
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

/// Metadata associated with an agent context
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContextMetadata {
    /// Creation timestamp
    pub created_at: DateTime<Utc>,

    /// Last update timestamp
    pub updated_at: DateTime<Utc>,

    /// Token count for the context
    pub token_count: usize,

    /// Whether the context has been compressed
    pub is_compressed: bool,

    /// Compression ratio if compressed (original_size / compressed_size)
    pub compression_ratio: Option<f64>,

    /// Tags for categorization
    pub tags: Vec<String>,

    /// Custom metadata fields
    pub custom: HashMap<String, serde_json::Value>,
}

impl ContextMetadata {
    /// Create new metadata with current timestamp
    pub fn new() -> Self {
        let now = Utc::now();
        Self {
            created_at: now,
            updated_at: now,
            token_count: 0,
            is_compressed: false,
            compression_ratio: None,
            tags: Vec::new(),
            custom: HashMap::new(),
        }
    }

    /// Update the timestamp
    pub fn touch(&mut self) {
        self.updated_at = Utc::now();
    }

    /// Add a tag
    pub fn add_tag(&mut self, tag: impl Into<String>) {
        let tag = tag.into();
        if !self.tags.contains(&tag) {
            self.tags.push(tag);
        }
    }

    /// Set a custom field
    pub fn set_custom(&mut self, key: impl Into<String>, value: serde_json::Value) {
        self.custom.insert(key.into(), value);
    }
}

/// File context information
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileContext {
    /// File path
    pub path: PathBuf,

    /// File content (may be truncated or summarized)
    pub content: String,

    /// Original file size in bytes
    pub original_size: usize,

    /// Whether the content is truncated
    pub is_truncated: bool,

    /// File language/type if detected
    pub language: Option<String>,

    /// Line range if partial content
    pub line_range: Option<(usize, usize)>,

    /// Last modified timestamp
    pub last_modified: Option<DateTime<Utc>>,
}

impl FileContext {
    /// Create a new file context
    pub fn new(path: impl Into<PathBuf>, content: impl Into<String>) -> Self {
        let content = content.into();
        let original_size = content.len();
        Self {
            path: path.into(),
            content,
            original_size,
            is_truncated: false,
            language: None,
            line_range: None,
            last_modified: None,
        }
    }

    /// Create a truncated file context
    pub fn truncated(
        path: impl Into<PathBuf>,
        content: impl Into<String>,
        original_size: usize,
    ) -> Self {
        Self {
            path: path.into(),
            content: content.into(),
            original_size,
            is_truncated: true,
            language: None,
            line_range: None,
            last_modified: None,
        }
    }

    /// Set the language
    pub fn with_language(mut self, language: impl Into<String>) -> Self {
        self.language = Some(language.into());
        self
    }

    /// Set the line range
    pub fn with_line_range(mut self, start: usize, end: usize) -> Self {
        self.line_range = Some((start, end));
        self
    }
}

/// Result of a tool execution
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolExecutionResult {
    /// Tool name
    pub tool_name: String,

    /// Tool call ID
    pub call_id: String,

    /// Whether the execution was successful
    pub success: bool,

    /// Result content (may be truncated)
    pub content: String,

    /// Error message if failed
    pub error: Option<String>,

    /// Execution duration in milliseconds
    pub duration_ms: u64,

    /// Timestamp of execution
    pub executed_at: DateTime<Utc>,

    /// Input parameters (may be redacted)
    pub input: Option<serde_json::Value>,

    /// Whether the content is truncated
    pub is_truncated: bool,
}

impl ToolExecutionResult {
    /// Create a successful tool result
    pub fn success(
        tool_name: impl Into<String>,
        call_id: impl Into<String>,
        content: impl Into<String>,
        duration_ms: u64,
    ) -> Self {
        Self {
            tool_name: tool_name.into(),
            call_id: call_id.into(),
            success: true,
            content: content.into(),
            error: None,
            duration_ms,
            executed_at: Utc::now(),
            input: None,
            is_truncated: false,
        }
    }

    /// Create a failed tool result
    pub fn failure(
        tool_name: impl Into<String>,
        call_id: impl Into<String>,
        error: impl Into<String>,
        duration_ms: u64,
    ) -> Self {
        Self {
            tool_name: tool_name.into(),
            call_id: call_id.into(),
            success: false,
            content: String::new(),
            error: Some(error.into()),
            duration_ms,
            executed_at: Utc::now(),
            input: None,
            is_truncated: false,
        }
    }

    /// Set the input parameters
    pub fn with_input(mut self, input: serde_json::Value) -> Self {
        self.input = Some(input);
        self
    }
}

/// Type of context inheritance
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum ContextInheritanceType {
    /// Full inheritance - copy all data
    #[default]
    Full,

    /// Shallow inheritance - copy references only
    Shallow,

    /// Selective inheritance - copy based on configuration
    Selective,

    /// No inheritance - start fresh
    None,
}

/// Configuration for context inheritance
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContextInheritanceConfig {
    /// Whether to inherit conversation history
    pub inherit_conversation: bool,

    /// Whether to inherit file context
    pub inherit_files: bool,

    /// Whether to inherit tool results
    pub inherit_tool_results: bool,

    /// Whether to inherit environment variables
    pub inherit_environment: bool,

    /// Maximum number of history messages to inherit
    pub max_history_length: Option<usize>,

    /// Maximum number of file contexts to inherit
    pub max_file_contexts: Option<usize>,

    /// Maximum number of tool results to inherit
    pub max_tool_results: Option<usize>,

    /// Whether to filter sensitive data
    pub filter_sensitive: bool,

    /// Whether to compress context if too large
    pub compress_context: bool,

    /// Target token count for compression
    pub target_tokens: Option<usize>,

    /// Type of inheritance
    pub inheritance_type: ContextInheritanceType,
}

impl Default for ContextInheritanceConfig {
    fn default() -> Self {
        Self {
            inherit_conversation: true,
            inherit_files: true,
            inherit_tool_results: true,
            inherit_environment: true,
            max_history_length: None,
            max_file_contexts: None,
            max_tool_results: None,
            filter_sensitive: true,
            compress_context: false,
            target_tokens: None,
            inheritance_type: ContextInheritanceType::Full,
        }
    }
}

impl ContextInheritanceConfig {
    /// Create a minimal inheritance config (conversation only)
    pub fn minimal() -> Self {
        Self {
            inherit_conversation: true,
            inherit_files: false,
            inherit_tool_results: false,
            inherit_environment: false,
            max_history_length: Some(10),
            ..Default::default()
        }
    }

    /// Create a config that inherits nothing
    pub fn none() -> Self {
        Self {
            inherit_conversation: false,
            inherit_files: false,
            inherit_tool_results: false,
            inherit_environment: false,
            inheritance_type: ContextInheritanceType::None,
            ..Default::default()
        }
    }
}

/// Agent context containing all execution state
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentContext {
    /// Unique context identifier
    pub context_id: String,

    /// Associated agent ID (if any)
    pub agent_id: Option<String>,

    /// Parent context ID (for inheritance)
    pub parent_context_id: Option<String>,

    /// Conversation history
    pub conversation_history: Vec<Message>,

    /// Summarized conversation (for compression)
    pub conversation_summary: Option<String>,

    /// File contexts
    pub file_context: Vec<FileContext>,

    /// Tool execution results
    pub tool_results: Vec<ToolExecutionResult>,

    /// System prompt
    pub system_prompt: Option<String>,

    /// Working directory
    pub working_directory: PathBuf,

    /// Environment variables
    pub environment: HashMap<String, String>,

    /// Context metadata
    pub metadata: ContextMetadata,
}

impl AgentContext {
    /// Create a new agent context with a unique ID
    pub fn new() -> Self {
        Self {
            context_id: uuid::Uuid::new_v4().to_string(),
            agent_id: None,
            parent_context_id: None,
            conversation_history: Vec::new(),
            conversation_summary: None,
            file_context: Vec::new(),
            tool_results: Vec::new(),
            system_prompt: None,
            working_directory: PathBuf::from("."),
            environment: HashMap::new(),
            metadata: ContextMetadata::new(),
        }
    }

    /// Create a context with a specific ID
    pub fn with_id(id: impl Into<String>) -> Self {
        let mut ctx = Self::new();
        ctx.context_id = id.into();
        ctx
    }

    /// Set the agent ID
    pub fn with_agent_id(mut self, agent_id: impl Into<String>) -> Self {
        self.agent_id = Some(agent_id.into());
        self
    }

    /// Set the parent context ID
    pub fn with_parent(mut self, parent_id: impl Into<String>) -> Self {
        self.parent_context_id = Some(parent_id.into());
        self
    }

    /// Set the system prompt
    pub fn with_system_prompt(mut self, prompt: impl Into<String>) -> Self {
        self.system_prompt = Some(prompt.into());
        self
    }

    /// Set the working directory
    pub fn with_working_directory(mut self, dir: impl Into<PathBuf>) -> Self {
        self.working_directory = dir.into();
        self
    }

    /// Add a message to conversation history
    pub fn add_message(&mut self, message: Message) {
        self.conversation_history.push(message);
        self.metadata.touch();
    }

    /// Add a file context
    pub fn add_file_context(&mut self, file: FileContext) {
        self.file_context.push(file);
        self.metadata.touch();
    }

    /// Add a tool result
    pub fn add_tool_result(&mut self, result: ToolExecutionResult) {
        self.tool_results.push(result);
        self.metadata.touch();
    }

    /// Set an environment variable
    pub fn set_env(&mut self, key: impl Into<String>, value: impl Into<String>) {
        self.environment.insert(key.into(), value.into());
        self.metadata.touch();
    }

    /// Get an environment variable
    pub fn get_env(&self, key: &str) -> Option<&String> {
        self.environment.get(key)
    }

    /// Check if context is empty
    pub fn is_empty(&self) -> bool {
        self.conversation_history.is_empty()
            && self.file_context.is_empty()
            && self.tool_results.is_empty()
    }
}

impl Default for AgentContext {
    fn default() -> Self {
        Self::new()
    }
}

/// Filter configuration for context data
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ContextFilter {
    /// Patterns to filter from text content
    pub sensitive_patterns: Vec<String>,

    /// Environment variable keys to exclude
    pub excluded_env_keys: Vec<String>,

    /// Tool names to exclude results from
    pub excluded_tools: Vec<String>,

    /// File path patterns to exclude
    pub excluded_file_patterns: Vec<String>,
}

impl ContextFilter {
    /// Create a filter with default sensitive patterns
    pub fn with_defaults() -> Self {
        Self {
            sensitive_patterns: vec![
                r"(?i)api[_-]?key".to_string(),
                r"(?i)password".to_string(),
                r"(?i)secret".to_string(),
                r"(?i)token".to_string(),
                r"(?i)bearer\s+\S+".to_string(),
                r"(?i)authorization:\s*\S+".to_string(),
            ],
            excluded_env_keys: vec![
                "API_KEY".to_string(),
                "SECRET".to_string(),
                "PASSWORD".to_string(),
                "TOKEN".to_string(),
                "PRIVATE_KEY".to_string(),
            ],
            excluded_tools: Vec::new(),
            excluded_file_patterns: vec![
                "*.pem".to_string(),
                "*.key".to_string(),
                ".env*".to_string(),
            ],
        }
    }
}

/// Result of context compression
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressionResult {
    /// Original token count
    pub original_tokens: usize,

    /// Compressed token count
    pub compressed_tokens: usize,

    /// Compression ratio
    pub ratio: f64,

    /// Number of messages summarized
    pub messages_summarized: usize,

    /// Number of files removed
    pub files_removed: usize,

    /// Number of tool results removed
    pub tool_results_removed: usize,
}

/// Updates to apply to a context
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextUpdate {
    /// Messages to add
    pub add_messages: Option<Vec<Message>>,

    /// Files to add
    pub add_files: Option<Vec<FileContext>>,

    /// Tool results to add
    pub add_tool_results: Option<Vec<ToolExecutionResult>>,

    /// Environment variables to set
    pub set_environment: Option<HashMap<String, String>>,

    /// System prompt to set
    pub set_system_prompt: Option<String>,

    /// Working directory to set
    pub set_working_directory: Option<PathBuf>,

    /// Tags to add
    pub add_tags: Option<Vec<String>>,

    /// Custom metadata to set
    pub set_custom_metadata: Option<HashMap<String, serde_json::Value>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_context_new() {
        let ctx = AgentContext::new();
        assert!(!ctx.context_id.is_empty());
        assert!(ctx.agent_id.is_none());
        assert!(ctx.parent_context_id.is_none());
        assert!(ctx.is_empty());
    }

    #[test]
    fn test_agent_context_with_id() {
        let ctx = AgentContext::with_id("test-id");
        assert_eq!(ctx.context_id, "test-id");
    }

    #[test]
    fn test_context_metadata_new() {
        let meta = ContextMetadata::new();
        assert_eq!(meta.token_count, 0);
        assert!(!meta.is_compressed);
        assert!(meta.tags.is_empty());
    }

    #[test]
    fn test_context_metadata_add_tag() {
        let mut meta = ContextMetadata::new();
        meta.add_tag("test");
        meta.add_tag("test"); // Duplicate should not be added
        assert_eq!(meta.tags.len(), 1);
        assert_eq!(meta.tags[0], "test");
    }

    #[test]
    fn test_file_context_new() {
        let fc = FileContext::new("/path/to/file.rs", "fn main() {}");
        assert_eq!(fc.path, PathBuf::from("/path/to/file.rs"));
        assert_eq!(fc.content, "fn main() {}");
        assert!(!fc.is_truncated);
    }

    #[test]
    fn test_file_context_truncated() {
        let fc = FileContext::truncated("/path/to/file.rs", "fn main...", 1000);
        assert!(fc.is_truncated);
        assert_eq!(fc.original_size, 1000);
    }

    #[test]
    fn test_tool_execution_result_success() {
        let result = ToolExecutionResult::success("bash", "call-1", "output", 100);
        assert!(result.success);
        assert!(result.error.is_none());
        assert_eq!(result.duration_ms, 100);
    }

    #[test]
    fn test_tool_execution_result_failure() {
        let result = ToolExecutionResult::failure("bash", "call-1", "command failed", 50);
        assert!(!result.success);
        assert_eq!(result.error, Some("command failed".to_string()));
    }

    #[test]
    fn test_context_inheritance_config_default() {
        let config = ContextInheritanceConfig::default();
        assert!(config.inherit_conversation);
        assert!(config.inherit_files);
        assert!(config.filter_sensitive);
    }

    #[test]
    fn test_context_inheritance_config_minimal() {
        let config = ContextInheritanceConfig::minimal();
        assert!(config.inherit_conversation);
        assert!(!config.inherit_files);
        assert_eq!(config.max_history_length, Some(10));
    }

    #[test]
    fn test_context_inheritance_config_none() {
        let config = ContextInheritanceConfig::none();
        assert!(!config.inherit_conversation);
        assert!(!config.inherit_files);
        assert_eq!(config.inheritance_type, ContextInheritanceType::None);
    }

    #[test]
    fn test_context_filter_with_defaults() {
        let filter = ContextFilter::with_defaults();
        assert!(!filter.sensitive_patterns.is_empty());
        assert!(!filter.excluded_env_keys.is_empty());
    }

    #[test]
    fn test_agent_context_add_message() {
        let mut ctx = AgentContext::new();
        let msg = Message::user().with_text("Hello");
        ctx.add_message(msg);
        assert_eq!(ctx.conversation_history.len(), 1);
        assert!(!ctx.is_empty());
    }

    #[test]
    fn test_agent_context_set_env() {
        let mut ctx = AgentContext::new();
        ctx.set_env("KEY", "value");
        assert_eq!(ctx.get_env("KEY"), Some(&"value".to_string()));
        assert_eq!(ctx.get_env("NONEXISTENT"), None);
    }
}
