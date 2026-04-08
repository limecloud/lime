//! Tool Error Types
//!
//! This module defines the error types for the tool system.
//! All tool operations return `Result<T, ToolError>` for consistent error handling.

use std::time::Duration;
use thiserror::Error;

/// Tool execution error types
///
/// Represents all possible errors that can occur during tool operations.
#[derive(Debug, Error)]
pub enum ToolError {
    /// Tool not found in registry
    #[error("Tool not found: {0}")]
    NotFound(String),

    /// Permission denied for tool execution
    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    /// Tool execution failed
    #[error("Execution failed: {0}")]
    ExecutionFailed(String),

    /// Tool execution timed out
    #[error("Timeout after {0:?}")]
    Timeout(Duration),

    /// Safety check failed (e.g., dangerous command detected)
    #[error("Safety check failed: {0}")]
    SafetyCheckFailed(String),

    /// Invalid parameters provided to tool
    #[error("Invalid parameters: {0}")]
    InvalidParams(String),

    /// I/O error during tool execution
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    /// Tool execution was cancelled
    #[error("Cancelled")]
    Cancelled,
}

impl ToolError {
    /// Create a NotFound error
    pub fn not_found(name: impl Into<String>) -> Self {
        Self::NotFound(name.into())
    }

    /// Create a PermissionDenied error
    pub fn permission_denied(reason: impl Into<String>) -> Self {
        Self::PermissionDenied(reason.into())
    }

    /// Create an ExecutionFailed error
    pub fn execution_failed(reason: impl Into<String>) -> Self {
        Self::ExecutionFailed(reason.into())
    }

    /// Create a Timeout error
    pub fn timeout(duration: Duration) -> Self {
        Self::Timeout(duration)
    }

    /// Create a SafetyCheckFailed error
    pub fn safety_check_failed(reason: impl Into<String>) -> Self {
        Self::SafetyCheckFailed(reason.into())
    }

    /// Create an InvalidParams error
    pub fn invalid_params(reason: impl Into<String>) -> Self {
        Self::InvalidParams(reason.into())
    }

    /// Check if this error is retryable
    pub fn is_retryable(&self) -> bool {
        matches!(self, Self::Timeout(_) | Self::Io(_))
    }

    /// Check if this error is a permission error
    pub fn is_permission_error(&self) -> bool {
        matches!(self, Self::PermissionDenied(_))
    }

    /// Check if this error is a safety error
    pub fn is_safety_error(&self) -> bool {
        matches!(self, Self::SafetyCheckFailed(_))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_not_found_error() {
        let err = ToolError::not_found("bash");
        assert!(matches!(err, ToolError::NotFound(_)));
        assert_eq!(err.to_string(), "Tool not found: bash");
    }

    #[test]
    fn test_permission_denied_error() {
        let err = ToolError::permission_denied("Access denied to file system");
        assert!(matches!(err, ToolError::PermissionDenied(_)));
        assert_eq!(
            err.to_string(),
            "Permission denied: Access denied to file system"
        );
    }

    #[test]
    fn test_execution_failed_error() {
        let err = ToolError::execution_failed("Command returned non-zero exit code");
        assert!(matches!(err, ToolError::ExecutionFailed(_)));
        assert_eq!(
            err.to_string(),
            "Execution failed: Command returned non-zero exit code"
        );
    }

    #[test]
    fn test_timeout_error() {
        let err = ToolError::timeout(Duration::from_secs(30));
        assert!(matches!(err, ToolError::Timeout(_)));
        assert_eq!(err.to_string(), "Timeout after 30s");
    }

    #[test]
    fn test_safety_check_failed_error() {
        let err = ToolError::safety_check_failed("Dangerous command detected: rm -rf /");
        assert!(matches!(err, ToolError::SafetyCheckFailed(_)));
        assert_eq!(
            err.to_string(),
            "Safety check failed: Dangerous command detected: rm -rf /"
        );
    }

    #[test]
    fn test_invalid_params_error() {
        let err = ToolError::invalid_params("Missing required parameter: path");
        assert!(matches!(err, ToolError::InvalidParams(_)));
        assert_eq!(
            err.to_string(),
            "Invalid parameters: Missing required parameter: path"
        );
    }

    #[test]
    fn test_io_error_conversion() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file not found");
        let err: ToolError = io_err.into();
        assert!(matches!(err, ToolError::Io(_)));
    }

    #[test]
    fn test_cancelled_error() {
        let err = ToolError::Cancelled;
        assert_eq!(err.to_string(), "Cancelled");
    }

    #[test]
    fn test_is_retryable() {
        assert!(ToolError::timeout(Duration::from_secs(1)).is_retryable());
        assert!(ToolError::Io(std::io::Error::other("test")).is_retryable());
        assert!(!ToolError::not_found("test").is_retryable());
        assert!(!ToolError::permission_denied("test").is_retryable());
        assert!(!ToolError::safety_check_failed("test").is_retryable());
        assert!(!ToolError::Cancelled.is_retryable());
    }

    #[test]
    fn test_is_permission_error() {
        assert!(ToolError::permission_denied("test").is_permission_error());
        assert!(!ToolError::not_found("test").is_permission_error());
        assert!(!ToolError::Cancelled.is_permission_error());
    }

    #[test]
    fn test_is_safety_error() {
        assert!(ToolError::safety_check_failed("test").is_safety_error());
        assert!(!ToolError::not_found("test").is_safety_error());
        assert!(!ToolError::permission_denied("test").is_safety_error());
    }
}
