//! Context Management Module
//!
//! This module provides comprehensive context management functionality aligned with
//!
//! - Token estimation for different content types
//! - Dynamic context window management
//! - Intelligent message summarization
//! - Message compression
//! - Prompt caching support
//! - Message priority sorting
//! - File mention resolution
//! - AGENTS.md parsing
//!
//! # Architecture
//!
//! The module is organized into the following components:
//!
//! - `types`: Core type definitions (TokenUsage, ContextConfig, ConversationTurn, etc.)
//! - `token_estimator`: Token estimation for different content types
//! - `window_manager`: Dynamic context window management
//! - `summarizer`: Intelligent message summarization
//! - `compressor`: Message compression
//! - `cache_controller`: Prompt caching support
//! - `priority_sorter`: Message priority sorting
//! - `file_mention`: File mention resolution
//! - `agents_md_parser`: AGENTS.md parsing
//! - `manager`: Enhanced context manager
//!
//! # Quick Start
//!
//! ```rust,ignore
//! use aster::context::{EnhancedContextManager, ContextConfig, TokenEstimator};
//!
//! // Create a context manager with default configuration
//! let mut manager = EnhancedContextManager::new(ContextConfig::default());
//! manager.set_system_prompt("You are a helpful assistant.");
//!
//! // Add conversation turns
//! manager.add_turn(user_message, assistant_message, Some(usage));
//!
//! // Get messages for API call
//! let messages = manager.get_messages();
//!
//! // Check context usage
//! let usage = manager.get_context_usage();
//! println!("Context usage: {:.1}%", usage.percentage);
//! ```
//!
//! # Token Estimation
//!
//! ```rust,ignore
//! use aster::context::TokenEstimator;
//!
//! let tokens = TokenEstimator::estimate_tokens("Hello, world!");
//! let message_tokens = TokenEstimator::estimate_message_tokens(&message);
//! ```
//!
//! # Message Compression
//!
//! ```rust,ignore
//! use aster::context::{MessageCompressor, CompressionConfig};
//!
//! let compressed = MessageCompressor::compress_code_block(&code, 50);
//! let compressed_msg = MessageCompressor::compress_message(&message, &config);
//! ```

// ============================================================================
// Module Declarations
// ============================================================================

pub mod agents_md_parser;
pub mod cache_controller;
pub mod compressor;
pub mod context_service;
pub mod context_uri;
pub mod file_mention;
pub mod manager;
pub mod priority_sorter;
pub mod pruner;
pub mod summarizer;
pub mod token_estimator;
pub mod tool_io;
pub mod types;
pub mod window_manager;

#[cfg(test)]
mod token_estimator_property_tests;

#[cfg(test)]
mod compressor_property_tests;

#[cfg(test)]
mod summarizer_property_tests;

// ============================================================================
// Re-exports: Core Components
// ============================================================================

/// Token estimation for different content types (Asian, code, English text)
pub use token_estimator::TokenEstimator;

/// Tool I/O payload analysis and model-aware eviction policy helpers
pub use tool_io::{
    analyze_tool_io_text_payload, analyze_tool_io_value_payload,
    build_tool_io_history_eviction_plan, build_tool_io_notice_text, build_tool_io_payload_envelope,
    build_tool_io_preview, estimate_tool_io_tokens, resolve_model_context_max_input_tokens,
    resolve_tool_io_eviction_policy, resolve_tool_io_offload_decision, ToolIoEvictionConfig,
    ToolIoEvictionPolicy, ToolIoHistoryEvictionCandidate, ToolIoHistoryEvictionPlan,
    ToolIoHistoryEvictionSelection, ToolIoHistoryMessageAnalysis, ToolIoOffloadDecision,
    ToolIoOffloadThresholds, ToolIoOffloadTrigger, ToolIoPayloadStats, ToolIoPreviewConfig,
    DEFAULT_CONTEXT_WINDOW_KEEP_RECENT_MESSAGES, DEFAULT_CONTEXT_WINDOW_MAX_INPUT_TOKENS,
    DEFAULT_CONTEXT_WINDOW_TRIGGER_RATIO, DEFAULT_TOOL_IO_PREVIEW_MAX_CHARS,
    DEFAULT_TOOL_IO_PREVIEW_MAX_LINES, DEFAULT_TOOL_TOKEN_LIMIT_BEFORE_EVICT,
};

/// Dynamic context window management for different LLM models
pub use window_manager::{ContextWindowManager, MODEL_CONTEXT_WINDOWS};

/// Message compression (code blocks, tool output, file content)
pub use compressor::{
    MessageCompressor,
    // Compression constants
    DEFAULT_CODE_BLOCK_MAX_LINES,
    DEFAULT_FILE_CONTENT_MAX_CHARS,
    DEFAULT_TOOL_OUTPUT_MAX_CHARS,
};

/// Progressive pruning for Tool output management
pub use pruner::ProgressivePruner;

/// Intelligent message summarization (AI-powered and simple)
pub use summarizer::{
    Summarizer,
    SummarizerClient,
    SummarizerResponse,
    // Summarizer constants
    DEFAULT_SUMMARY_BUDGET,
    MAX_SUMMARY_LENGTH,
    SUMMARY_SYSTEM_PROMPT,
};

/// Prompt caching support for reducing API costs
pub use cache_controller::{CacheController, CacheEligibility};
pub use context_service::{
    ContextDocument, ContextLayer, ContextNamespaceStatus, ContextReadResult, ContextService,
    ContextServiceStatus, ContextTraceStep,
};
pub use context_uri::{ContextNamespace, ContextUri};

/// Message priority sorting for intelligent compression decisions
pub use priority_sorter::PrioritySorter;

/// File mention resolution (@filename syntax)
pub use file_mention::{FileMentionResolver, COMMON_EXTENSIONS};

/// AGENTS.md parsing for project-specific instructions
pub use agents_md_parser::AgentsMdParser;

/// Enhanced context manager with compression, summarization, and statistics
pub use manager::EnhancedContextManager;

// ============================================================================
// Re-exports: Types
// ============================================================================

pub use types::{
    // File mention types
    AgentsMdConfig,
    // Cache types
    CacheConfig,
    CacheControl,
    CacheSavings,
    CacheStats,
    CacheType,
    // Compression types
    CodeBlock,
    CompressionConfig,
    CompressionDetails,
    CompressionResult,
    // Core types
    ContextConfig,
    ContextError,
    ContextExport,
    ContextStats,
    ContextUsage,
    // Window types
    ContextWindowStats,
    ConversationTurn,
    FileMentionResult,
    // Priority types
    MessagePriority,
    PrioritizedMessage,
    // Progressive pruning types
    PruningConfig,
    PruningLevel,
    ResolvedFile,
    TokenUsage,
    // Constants from types module
    CHARS_PER_TOKEN_ASIAN,
    CHARS_PER_TOKEN_CODE,
    CHARS_PER_TOKEN_DEFAULT,
    CODE_BLOCK_MAX_LINES,
    FILE_CONTENT_MAX_CHARS,
    TOOL_OUTPUT_MAX_CHARS,
};

// ============================================================================
// Convenience Type Aliases
// ============================================================================

/// Result type for context operations
pub type ContextResult<T> = std::result::Result<T, ContextError>;
