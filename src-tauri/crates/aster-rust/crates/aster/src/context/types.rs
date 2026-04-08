//! Core type definitions for the context management module.
//!
//! This module defines the fundamental types used throughout the context
//! management system, including token usage tracking, configuration,
//! conversation turns, and error handling.

use crate::conversation::message::Message;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use thiserror::Error;

// ============================================================================
// Token Estimation Constants
// ============================================================================

/// Characters per token for default English text
pub const CHARS_PER_TOKEN_DEFAULT: f64 = 3.5;

/// Characters per token for Asian characters (Chinese, Japanese, Korean)
pub const CHARS_PER_TOKEN_ASIAN: f64 = 2.0;

/// Characters per token for code content
pub const CHARS_PER_TOKEN_CODE: f64 = 3.0;

// ============================================================================
// Compression Constants
// ============================================================================

/// Maximum lines for code blocks before compression
pub const CODE_BLOCK_MAX_LINES: usize = 50;

/// Maximum characters for tool output before compression
pub const TOOL_OUTPUT_MAX_CHARS: usize = 2000;

/// Maximum characters for file content before compression
pub const FILE_CONTENT_MAX_CHARS: usize = 1500;

// ============================================================================
// Error Types
// ============================================================================

/// Errors that can occur during context management operations.
#[derive(Debug, Error)]
pub enum ContextError {
    /// IO error during file operations
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    /// Serialization/deserialization error
    #[error("Serialization error: {0}")]
    Serialization(String),

    /// File not found error
    #[error("File not found: {0}")]
    FileNotFound(PathBuf),

    /// Summarization failed
    #[error("Summarization failed: {0}")]
    SummarizationFailed(String),

    /// Invalid configuration
    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),

    /// Token limit exceeded
    #[error("Token limit exceeded: {0}")]
    TokenLimitExceeded(String),
}

impl From<serde_json::Error> for ContextError {
    fn from(err: serde_json::Error) -> Self {
        ContextError::Serialization(err.to_string())
    }
}

// ============================================================================
// Token Usage Types
// ============================================================================

/// Token usage statistics from an API call.
///
/// Tracks input tokens, output tokens, and cache-related metrics.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct TokenUsage {
    /// Number of input tokens consumed
    pub input_tokens: usize,

    /// Number of output tokens generated
    pub output_tokens: usize,

    /// Number of tokens written to cache (if caching enabled)
    pub cache_creation_tokens: Option<usize>,

    /// Number of tokens read from cache (if caching enabled)
    pub cache_read_tokens: Option<usize>,

    /// Number of tokens used for thinking/reasoning (if extended thinking enabled)
    pub thinking_tokens: Option<usize>,
}

impl TokenUsage {
    /// Create a new TokenUsage with the given input and output tokens.
    pub fn new(input_tokens: usize, output_tokens: usize) -> Self {
        Self {
            input_tokens,
            output_tokens,
            cache_creation_tokens: None,
            cache_read_tokens: None,
            thinking_tokens: None,
        }
    }

    /// Create a TokenUsage with cache statistics.
    pub fn with_cache(
        input_tokens: usize,
        output_tokens: usize,
        cache_creation: usize,
        cache_read: usize,
    ) -> Self {
        Self {
            input_tokens,
            output_tokens,
            cache_creation_tokens: Some(cache_creation),
            cache_read_tokens: Some(cache_read),
            thinking_tokens: None,
        }
    }

    /// Get total tokens (input + output)
    pub fn total(&self) -> usize {
        self.input_tokens + self.output_tokens
    }

    /// Add another TokenUsage to this one
    pub fn add(&mut self, other: &TokenUsage) {
        self.input_tokens += other.input_tokens;
        self.output_tokens += other.output_tokens;

        if let Some(cache_creation) = other.cache_creation_tokens {
            *self.cache_creation_tokens.get_or_insert(0) += cache_creation;
        }

        if let Some(cache_read) = other.cache_read_tokens {
            *self.cache_read_tokens.get_or_insert(0) += cache_read;
        }

        if let Some(thinking) = other.thinking_tokens {
            *self.thinking_tokens.get_or_insert(0) += thinking;
        }
    }
}

// ============================================================================
// Context Configuration
// ============================================================================

/// Configuration for the context manager.
///
/// Controls token limits, compression thresholds, and feature flags.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextConfig {
    /// Maximum tokens allowed in context
    pub max_tokens: usize,

    /// Tokens to reserve for output generation
    pub reserve_tokens: usize,

    /// Threshold (0.0-1.0) at which to trigger summarization
    pub summarize_threshold: f64,

    /// Number of recent messages to keep uncompressed
    pub keep_recent_messages: usize,

    /// Whether to use AI for summarization
    pub enable_ai_summary: bool,

    /// Maximum lines for code blocks before compression
    pub code_block_max_lines: usize,

    /// Maximum characters for tool output before compression
    pub tool_output_max_chars: usize,

    /// Whether to enable incremental compression on message addition
    pub enable_incremental_compression: bool,
}

impl Default for ContextConfig {
    fn default() -> Self {
        Self {
            max_tokens: 180000,
            reserve_tokens: 32000,
            summarize_threshold: 0.7,
            keep_recent_messages: 10,
            enable_ai_summary: false,
            code_block_max_lines: CODE_BLOCK_MAX_LINES,
            tool_output_max_chars: TOOL_OUTPUT_MAX_CHARS,
            enable_incremental_compression: true,
        }
    }
}

impl ContextConfig {
    /// Create a new ContextConfig with custom max_tokens
    pub fn with_max_tokens(max_tokens: usize) -> Self {
        Self {
            max_tokens,
            ..Default::default()
        }
    }

    /// Calculate available tokens (max - reserve)
    pub fn available_tokens(&self) -> usize {
        self.max_tokens.saturating_sub(self.reserve_tokens)
    }

    /// Calculate the token threshold for triggering summarization
    pub fn summarize_token_threshold(&self) -> usize {
        ((self.max_tokens as f64) * self.summarize_threshold) as usize
    }
}

// ============================================================================
// Conversation Turn
// ============================================================================

/// A single turn in a conversation, containing user input and assistant response.
///
/// Tracks token estimates, compression state, and API usage for the turn.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationTurn {
    /// The user's message
    pub user: Message,

    /// The assistant's response
    pub assistant: Message,

    /// Unix timestamp when this turn occurred
    pub timestamp: i64,

    /// Estimated token count for this turn (after any compression)
    pub token_estimate: usize,

    /// Original token count before compression
    pub original_tokens: usize,

    /// Whether this turn has been summarized
    pub summarized: bool,

    /// Summary text if summarized
    pub summary: Option<String>,

    /// Whether this turn has been compressed
    pub compressed: bool,

    /// API usage statistics for this turn
    pub api_usage: Option<TokenUsage>,
}

impl ConversationTurn {
    /// Create a new conversation turn
    pub fn new(user: Message, assistant: Message, token_estimate: usize) -> Self {
        Self {
            user,
            assistant,
            timestamp: chrono::Utc::now().timestamp(),
            token_estimate,
            original_tokens: token_estimate,
            summarized: false,
            summary: None,
            compressed: false,
            api_usage: None,
        }
    }

    /// Create a turn with API usage statistics
    pub fn with_api_usage(mut self, usage: TokenUsage) -> Self {
        self.api_usage = Some(usage);
        self
    }

    /// Mark this turn as summarized with the given summary
    pub fn mark_summarized(&mut self, summary: String, new_token_estimate: usize) {
        self.summarized = true;
        self.summary = Some(summary);
        self.token_estimate = new_token_estimate;
    }

    /// Mark this turn as compressed
    pub fn mark_compressed(&mut self, new_token_estimate: usize) {
        self.compressed = true;
        self.token_estimate = new_token_estimate;
    }

    /// Get the compression ratio (current / original)
    pub fn compression_ratio(&self) -> f64 {
        if self.original_tokens == 0 {
            1.0
        } else {
            self.token_estimate as f64 / self.original_tokens as f64
        }
    }

    /// Get tokens saved by compression
    pub fn tokens_saved(&self) -> usize {
        self.original_tokens.saturating_sub(self.token_estimate)
    }
}

// ============================================================================
// Context Statistics
// ============================================================================

/// Statistics about the current context state.
#[derive(Debug, Clone, Default)]
pub struct ContextStats {
    /// Total number of messages in context
    pub total_messages: usize,

    /// Estimated total tokens in context
    pub estimated_tokens: usize,

    /// Number of messages that have been summarized
    pub summarized_messages: usize,

    /// Overall compression ratio
    pub compression_ratio: f64,

    /// Total tokens saved through compression
    pub saved_tokens: usize,

    /// Number of compression operations performed
    pub compression_count: usize,
}

/// Current context usage information.
#[derive(Debug, Clone, Default)]
pub struct ContextUsage {
    /// Tokens currently used
    pub used: usize,

    /// Tokens available (max - used)
    pub available: usize,

    /// Total token capacity
    pub total: usize,

    /// Usage percentage (0-100)
    pub percentage: f64,
}

impl ContextUsage {
    /// Create a new ContextUsage
    pub fn new(used: usize, total: usize) -> Self {
        let available = total.saturating_sub(used);
        let percentage = if total > 0 {
            (used as f64 / total as f64) * 100.0
        } else {
            0.0
        };

        Self {
            used,
            available,
            total,
            percentage,
        }
    }

    /// Check if usage is above the given threshold percentage
    pub fn is_above_threshold(&self, threshold: f64) -> bool {
        self.percentage > threshold
    }
}

// ============================================================================
// Context Export/Import
// ============================================================================

/// Serializable format for exporting context state.
///
/// Used for persisting context to disk or transferring between sessions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextExport {
    /// The system prompt
    pub system_prompt: String,

    /// All conversation turns
    pub turns: Vec<ConversationTurn>,

    /// Configuration used
    pub config: ContextConfig,

    /// Number of compression operations performed
    pub compression_count: usize,

    /// Total tokens saved through compression
    pub saved_tokens: usize,
}

impl ContextExport {
    /// Create a new ContextExport
    pub fn new(
        system_prompt: String,
        turns: Vec<ConversationTurn>,
        config: ContextConfig,
        compression_count: usize,
        saved_tokens: usize,
    ) -> Self {
        Self {
            system_prompt,
            turns,
            config,
            compression_count,
            saved_tokens,
        }
    }
}

// ============================================================================
// Compression Types
// ============================================================================

/// Result of a compression operation.
#[derive(Debug, Clone)]
pub struct CompressionResult {
    /// Original token count
    pub original_tokens: usize,

    /// Compressed token count
    pub compressed_tokens: usize,

    /// Compression ratio (compressed / original)
    pub ratio: f64,

    /// Method used for compression
    pub method: String,
}

impl CompressionResult {
    /// Create a new CompressionResult
    pub fn new(
        original_tokens: usize,
        compressed_tokens: usize,
        method: impl Into<String>,
    ) -> Self {
        let ratio = if original_tokens > 0 {
            compressed_tokens as f64 / original_tokens as f64
        } else {
            1.0
        };

        Self {
            original_tokens,
            compressed_tokens,
            ratio,
            method: method.into(),
        }
    }

    /// Get tokens saved
    pub fn tokens_saved(&self) -> usize {
        self.original_tokens.saturating_sub(self.compressed_tokens)
    }
}

/// Detailed compression information.
#[derive(Debug, Clone, Default)]
pub struct CompressionDetails {
    /// Total number of turns
    pub total_turns: usize,

    /// Number of summarized turns
    pub summarized_turns: usize,

    /// Number of compressed turns
    pub compressed_turns: usize,

    /// Number of recent (uncompressed) turns
    pub recent_turns: usize,

    /// Overall compression ratio
    pub compression_ratio: f64,

    /// Total tokens saved
    pub saved_tokens: usize,
}

// ============================================================================
// Compression Configuration
// ============================================================================

/// Configuration for message compression.
#[derive(Debug, Clone)]
pub struct CompressionConfig {
    /// Maximum lines for code blocks
    pub code_block_max_lines: usize,

    /// Maximum characters for tool output
    pub tool_output_max_chars: usize,

    /// Maximum characters for file content
    pub file_content_max_chars: usize,

    /// Whether to enable incremental compression
    pub enable_incremental: bool,
}

impl Default for CompressionConfig {
    fn default() -> Self {
        Self {
            code_block_max_lines: CODE_BLOCK_MAX_LINES,
            tool_output_max_chars: TOOL_OUTPUT_MAX_CHARS,
            file_content_max_chars: FILE_CONTENT_MAX_CHARS,
            enable_incremental: true,
        }
    }
}

// ============================================================================
// Cache Types
// ============================================================================

/// Cache control marker for prompt caching.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CacheControl {
    /// Type of cache control
    #[serde(rename = "type")]
    pub cache_type: CacheType,
}

/// Type of cache control.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum CacheType {
    /// Ephemeral cache (cleared after session)
    Ephemeral,
}

impl Default for CacheControl {
    fn default() -> Self {
        Self {
            cache_type: CacheType::Ephemeral,
        }
    }
}

/// Configuration for prompt caching.
#[derive(Debug, Clone)]
pub struct CacheConfig {
    /// Minimum tokens required for caching
    pub min_tokens_for_cache: usize,

    /// Whether to cache the system prompt
    pub cache_system_prompt: bool,

    /// Whether to cache tool definitions
    pub cache_tool_definitions: bool,

    /// Number of recent messages to cache
    pub cache_recent_messages: usize,
}

impl Default for CacheConfig {
    fn default() -> Self {
        Self {
            min_tokens_for_cache: 1024,
            cache_system_prompt: true,
            cache_tool_definitions: true,
            cache_recent_messages: 3,
        }
    }
}

/// Cache cost savings calculation result.
#[derive(Debug, Clone, Default)]
pub struct CacheSavings {
    /// Base cost without caching
    pub base_cost: f64,

    /// Actual cost with caching
    pub cache_cost: f64,

    /// Amount saved
    pub savings: f64,
}

impl CacheSavings {
    /// Create a new CacheSavings
    pub fn new(base_cost: f64, cache_cost: f64) -> Self {
        Self {
            base_cost,
            cache_cost,
            savings: base_cost - cache_cost,
        }
    }

    /// Get savings percentage
    pub fn savings_percentage(&self) -> f64 {
        if self.base_cost > 0.0 {
            (self.savings / self.base_cost) * 100.0
        } else {
            0.0
        }
    }
}

/// Cache statistics.
#[derive(Debug, Clone, Default)]
pub struct CacheStats {
    /// Total tokens written to cache
    pub total_cache_creation_tokens: usize,

    /// Total tokens read from cache
    pub total_cache_read_tokens: usize,

    /// Cache hit rate (0.0-1.0)
    pub cache_hit_rate: f64,
}

// ============================================================================
// Priority Types
// ============================================================================

/// Message priority levels for sorting and compression decisions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub enum MessagePriority {
    /// Lowest priority - can be removed first
    Minimal = 1,
    /// Low priority
    Low = 2,
    /// Medium priority
    #[default]
    Medium = 3,
    /// High priority - recent messages, tool calls
    High = 4,
    /// Critical - system messages, summaries
    Critical = 5,
}

/// A message with associated priority information.
#[derive(Debug, Clone)]
pub struct PrioritizedMessage {
    /// The message
    pub message: Message,

    /// Assigned priority
    pub priority: MessagePriority,

    /// Timestamp for ordering within same priority
    pub timestamp: i64,

    /// Estimated token count
    pub tokens: usize,
}

impl PrioritizedMessage {
    /// Create a new PrioritizedMessage
    pub fn new(message: Message, priority: MessagePriority, timestamp: i64, tokens: usize) -> Self {
        Self {
            message,
            priority,
            timestamp,
            tokens,
        }
    }
}

// ============================================================================
// File Mention Types
// ============================================================================

/// A resolved file from a mention.
#[derive(Debug, Clone)]
pub struct ResolvedFile {
    /// Path to the file
    pub path: PathBuf,

    /// Content of the file
    pub content: String,
}

impl ResolvedFile {
    /// Create a new ResolvedFile
    pub fn new(path: PathBuf, content: String) -> Self {
        Self { path, content }
    }
}

/// Result of resolving file mentions in text.
#[derive(Debug, Clone, Default)]
pub struct FileMentionResult {
    /// Processed text with file contents inserted
    pub processed_text: String,

    /// List of resolved files
    pub files: Vec<ResolvedFile>,
}

impl FileMentionResult {
    /// Create a new FileMentionResult
    pub fn new(processed_text: String, files: Vec<ResolvedFile>) -> Self {
        Self {
            processed_text,
            files,
        }
    }
}

// ============================================================================
// AGENTS.md Types
// ============================================================================

/// Parsed AGENTS.md configuration.
#[derive(Debug, Clone, Default)]
pub struct AgentsMdConfig {
    /// Content of the AGENTS.md file
    pub content: String,

    /// Referenced files found in the markdown
    pub files: Vec<PathBuf>,
}

impl AgentsMdConfig {
    /// Create a new AgentsMdConfig
    pub fn new(content: String, files: Vec<PathBuf>) -> Self {
        Self { content, files }
    }
}

// ============================================================================
// Context Window Types
// ============================================================================

/// Statistics about context window usage.
#[derive(Debug, Clone, Default)]
pub struct ContextWindowStats {
    /// Total input tokens consumed
    pub total_input_tokens: usize,

    /// Total output tokens generated
    pub total_output_tokens: usize,

    /// Size of the context window
    pub context_window_size: usize,

    /// Current API call usage
    pub current_usage: Option<TokenUsage>,
}

// ============================================================================
// Code Block Types
// ============================================================================

// ============================================================================
// Progressive Pruning Types
// ============================================================================

/// Progressive pruning configuration for Tool output management.
///
/// This configuration controls how Tool outputs are progressively pruned
/// based on context usage ratio. Pruning happens in two stages:
/// - **Soft trim**: Preserves head and tail of content, replacing middle with "..."
/// - **Hard clear**: Completely replaces content with a placeholder
///
/// # Example
///
/// ```rust,ignore
/// use aster::context::PruningConfig;
///
/// let config = PruningConfig::default();
/// // Soft trim triggers at 30% context usage
/// // Hard clear triggers at 50% context usage
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PruningConfig {
    /// Soft trim trigger threshold (context usage ratio, 0.0-1.0)
    /// When context usage exceeds this ratio, soft trimming is applied.
    /// Default: 0.3 (30%)
    pub soft_trim_ratio: f64,

    /// Hard clear trigger threshold (context usage ratio, 0.0-1.0)
    /// When context usage exceeds this ratio, hard clearing is applied.
    /// Default: 0.5 (50%)
    pub hard_clear_ratio: f64,

    /// Number of recent assistant messages to keep unpruned.
    /// These messages are protected from pruning to maintain conversation coherence.
    /// Default: 3
    pub keep_last_assistants: usize,

    /// Characters to preserve from the head during soft trim.
    /// Default: 500
    pub soft_trim_head_chars: usize,

    /// Characters to preserve from the tail during soft trim.
    /// Default: 300
    pub soft_trim_tail_chars: usize,

    /// Placeholder text for hard-cleared content.
    /// Default: "[content cleared]"
    pub hard_clear_placeholder: String,

    /// Tool names that are allowed to be pruned (supports glob patterns).
    /// If empty, all tools are allowed unless in denied_tools.
    /// Example: ["read_*", "grep", "glob"]
    pub allowed_tools: Vec<String>,

    /// Tool names that are never pruned.
    /// Takes precedence over allowed_tools.
    /// Example: ["write", "edit"]
    pub denied_tools: Vec<String>,
}

impl Default for PruningConfig {
    fn default() -> Self {
        Self {
            soft_trim_ratio: 0.3,
            hard_clear_ratio: 0.5,
            keep_last_assistants: 3,
            soft_trim_head_chars: 500,
            soft_trim_tail_chars: 300,
            hard_clear_placeholder: "[content cleared]".to_string(),
            allowed_tools: vec![],
            denied_tools: vec![],
        }
    }
}

impl PruningConfig {
    /// Create a new PruningConfig with custom thresholds.
    pub fn with_thresholds(soft_trim_ratio: f64, hard_clear_ratio: f64) -> Self {
        Self {
            soft_trim_ratio,
            hard_clear_ratio,
            ..Default::default()
        }
    }

    /// Set the number of recent assistant messages to keep unpruned.
    pub fn with_keep_last_assistants(mut self, count: usize) -> Self {
        self.keep_last_assistants = count;
        self
    }

    /// Set the soft trim character limits.
    pub fn with_soft_trim_chars(mut self, head: usize, tail: usize) -> Self {
        self.soft_trim_head_chars = head;
        self.soft_trim_tail_chars = tail;
        self
    }

    /// Set the hard clear placeholder text.
    pub fn with_placeholder(mut self, placeholder: impl Into<String>) -> Self {
        self.hard_clear_placeholder = placeholder.into();
        self
    }

    /// Set allowed tools for pruning.
    pub fn with_allowed_tools(mut self, tools: Vec<String>) -> Self {
        self.allowed_tools = tools;
        self
    }

    /// Set denied tools (never pruned).
    pub fn with_denied_tools(mut self, tools: Vec<String>) -> Self {
        self.denied_tools = tools;
        self
    }

    /// Determine the pruning level based on context usage ratio.
    ///
    /// Returns:
    /// - `PruningLevel::None` if usage is below soft_trim_ratio
    /// - `PruningLevel::SoftTrim` if usage is between soft_trim_ratio and hard_clear_ratio
    /// - `PruningLevel::HardClear` if usage is above hard_clear_ratio
    pub fn get_pruning_level(&self, usage_ratio: f64) -> PruningLevel {
        if usage_ratio >= self.hard_clear_ratio {
            PruningLevel::HardClear
        } else if usage_ratio >= self.soft_trim_ratio {
            PruningLevel::SoftTrim
        } else {
            PruningLevel::None
        }
    }
}

/// Pruning level indicating the intensity of content pruning.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PruningLevel {
    /// No pruning applied
    None,
    /// Soft trim: preserve head and tail, replace middle with "..."
    SoftTrim,
    /// Hard clear: replace entire content with placeholder
    HardClear,
}

// ============================================================================
// Code Block Types
// ============================================================================

/// Information about a code block in text.
#[derive(Debug, Clone)]
pub struct CodeBlock {
    /// The code content
    pub code: String,

    /// Programming language (if specified)
    pub language: Option<String>,

    /// Start position in original text
    pub start: usize,

    /// End position in original text
    pub end: usize,
}

impl CodeBlock {
    /// Create a new CodeBlock
    pub fn new(code: String, language: Option<String>, start: usize, end: usize) -> Self {
        Self {
            code,
            language,
            start,
            end,
        }
    }

    /// Get the number of lines in the code block
    pub fn line_count(&self) -> usize {
        self.code.lines().count()
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_token_usage_new() {
        let usage = TokenUsage::new(100, 50);
        assert_eq!(usage.input_tokens, 100);
        assert_eq!(usage.output_tokens, 50);
        assert_eq!(usage.total(), 150);
    }

    #[test]
    fn test_token_usage_with_cache() {
        let usage = TokenUsage::with_cache(100, 50, 20, 10);
        assert_eq!(usage.cache_creation_tokens, Some(20));
        assert_eq!(usage.cache_read_tokens, Some(10));
    }

    #[test]
    fn test_token_usage_add() {
        let mut usage1 = TokenUsage::new(100, 50);
        let usage2 = TokenUsage::with_cache(50, 25, 10, 5);

        usage1.add(&usage2);

        assert_eq!(usage1.input_tokens, 150);
        assert_eq!(usage1.output_tokens, 75);
        assert_eq!(usage1.cache_creation_tokens, Some(10));
        assert_eq!(usage1.cache_read_tokens, Some(5));
    }

    #[test]
    fn test_context_config_default() {
        let config = ContextConfig::default();
        assert_eq!(config.max_tokens, 180000);
        assert_eq!(config.reserve_tokens, 32000);
        assert_eq!(config.available_tokens(), 148000);
    }

    #[test]
    fn test_context_config_summarize_threshold() {
        let config = ContextConfig::default();
        let threshold = config.summarize_token_threshold();
        // 180000 * 0.7 = 126000, but floating point may give 125999
        assert!((125999..=126000).contains(&threshold));
    }

    #[test]
    fn test_context_usage_new() {
        let usage = ContextUsage::new(50000, 200000);
        assert_eq!(usage.used, 50000);
        assert_eq!(usage.available, 150000);
        assert_eq!(usage.total, 200000);
        assert!((usage.percentage - 25.0).abs() < 0.01);
    }

    #[test]
    fn test_context_usage_threshold() {
        let usage = ContextUsage::new(80000, 100000);
        assert!(usage.is_above_threshold(70.0));
        assert!(!usage.is_above_threshold(90.0));
    }

    #[test]
    fn test_compression_result() {
        let result = CompressionResult::new(1000, 300, "code_block");
        assert_eq!(result.tokens_saved(), 700);
        assert!((result.ratio - 0.3).abs() < 0.01);
    }

    #[test]
    fn test_cache_savings() {
        let savings = CacheSavings::new(100.0, 60.0);
        assert_eq!(savings.savings, 40.0);
        assert!((savings.savings_percentage() - 40.0).abs() < 0.01);
    }

    #[test]
    fn test_message_priority_ordering() {
        assert!(MessagePriority::Critical > MessagePriority::High);
        assert!(MessagePriority::High > MessagePriority::Medium);
        assert!(MessagePriority::Medium > MessagePriority::Low);
        assert!(MessagePriority::Low > MessagePriority::Minimal);
    }

    #[test]
    fn test_code_block_line_count() {
        let block = CodeBlock::new(
            "fn main() {\n    println!(\"Hello\");\n}".to_string(),
            Some("rust".to_string()),
            0,
            100,
        );
        assert_eq!(block.line_count(), 3);
    }

    #[test]
    fn test_pruning_config_default() {
        let config = PruningConfig::default();
        assert!((config.soft_trim_ratio - 0.3).abs() < 0.01);
        assert!((config.hard_clear_ratio - 0.5).abs() < 0.01);
        assert_eq!(config.keep_last_assistants, 3);
        assert_eq!(config.soft_trim_head_chars, 500);
        assert_eq!(config.soft_trim_tail_chars, 300);
        assert_eq!(config.hard_clear_placeholder, "[content cleared]");
    }

    #[test]
    fn test_pruning_config_get_pruning_level() {
        let config = PruningConfig::default();

        // Below soft_trim_ratio (0.3)
        assert_eq!(config.get_pruning_level(0.2), PruningLevel::None);

        // Between soft_trim_ratio and hard_clear_ratio
        assert_eq!(config.get_pruning_level(0.35), PruningLevel::SoftTrim);
        assert_eq!(config.get_pruning_level(0.49), PruningLevel::SoftTrim);

        // At or above hard_clear_ratio (0.5)
        assert_eq!(config.get_pruning_level(0.5), PruningLevel::HardClear);
        assert_eq!(config.get_pruning_level(0.8), PruningLevel::HardClear);
    }

    #[test]
    fn test_pruning_config_builder() {
        let config = PruningConfig::with_thresholds(0.4, 0.6)
            .with_keep_last_assistants(5)
            .with_soft_trim_chars(1000, 500)
            .with_placeholder("[removed]")
            .with_allowed_tools(vec!["read_*".to_string()])
            .with_denied_tools(vec!["write".to_string()]);

        assert!((config.soft_trim_ratio - 0.4).abs() < 0.01);
        assert!((config.hard_clear_ratio - 0.6).abs() < 0.01);
        assert_eq!(config.keep_last_assistants, 5);
        assert_eq!(config.soft_trim_head_chars, 1000);
        assert_eq!(config.soft_trim_tail_chars, 500);
        assert_eq!(config.hard_clear_placeholder, "[removed]");
        assert_eq!(config.allowed_tools, vec!["read_*".to_string()]);
        assert_eq!(config.denied_tools, vec!["write".to_string()]);
    }
}
