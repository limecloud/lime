//! Unified Error Handling Module
//!
//! This module provides comprehensive error handling for agent execution,
//! including error recording with context, timeout handling, retry mechanisms,
//! and context overflow handling.
//!
//! # Features
//!
//! - **Error Recording**: Record errors with timestamps, context, and stack traces
//! - **Timeout Handling**: Mark agents as timed out and emit timeout events
//! - **Retry Mechanism**: Configurable retry behavior for transient failures
//! - **Overflow Handling**: Automatic compaction and retry on context overflow
//!
//! # Requirements Coverage
//!
//! - Requirement 15.1: Error recording with context
//! - Requirement 15.2: Timeout handling with events
//! - Requirement 15.3: Tool call failure recording
//! - Requirement 15.4: Configurable retry behavior

mod error_handler;
mod overflow_handler;
mod retry_handler;
mod timeout_handler;

#[cfg(test)]
mod error_handling_property_tests;

pub use error_handler::{
    AgentError, AgentErrorKind, ErrorContext, ErrorHandler, ErrorRecord as UnifiedErrorRecord,
};
pub use overflow_handler::OverflowHandler;
pub use retry_handler::{
    RetryConfig as UnifiedRetryConfig, RetryHandler, RetryResult, RetryStrategy,
};
pub use timeout_handler::{TimeoutConfig, TimeoutEvent, TimeoutHandler, TimeoutStatus};
