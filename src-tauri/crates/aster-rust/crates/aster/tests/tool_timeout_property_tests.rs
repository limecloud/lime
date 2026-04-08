//! Property-based tests for Tool Timeout Enforcement
//!
//! **Property 7: Timeout Enforcement**
//! *For any* tool execution that exceeds the configured timeout duration,
//! the Tool SHALL return a timeout error with details.
//!
//! **Validates: Requirements 1.6**

use aster::tools::{Tool, ToolContext, ToolError, ToolOptions, ToolResult};
use async_trait::async_trait;
use proptest::prelude::*;
use std::path::PathBuf;
use std::time::Duration;
use tokio::time::timeout;

// ============================================================================
// Test Tool Implementation with Configurable Delay
// ============================================================================

/// A test tool that simulates execution with configurable delay
struct DelayedTool {
    name: String,
    delay_ms: u64,
    timeout_ms: u64,
}

impl DelayedTool {
    fn new(name: &str, delay_ms: u64, timeout_ms: u64) -> Self {
        Self {
            name: name.to_string(),
            delay_ms,
            timeout_ms,
        }
    }
}

#[async_trait]
impl Tool for DelayedTool {
    fn name(&self) -> &str {
        &self.name
    }

    fn description(&self) -> &str {
        "A test tool with configurable delay for timeout testing"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "input": { "type": "string" }
            }
        })
    }

    async fn execute(
        &self,
        _params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        // Check for cancellation before starting
        if context.is_cancelled() {
            return Err(ToolError::Cancelled);
        }

        // Simulate work with the configured delay
        tokio::time::sleep(Duration::from_millis(self.delay_ms)).await;

        // Check for cancellation after work
        if context.is_cancelled() {
            return Err(ToolError::Cancelled);
        }

        Ok(ToolResult::success(format!(
            "Completed after {}ms",
            self.delay_ms
        )))
    }

    fn options(&self) -> ToolOptions {
        ToolOptions::default().with_base_timeout(Duration::from_millis(self.timeout_ms))
    }
}

/// Execute a tool with timeout enforcement
async fn execute_with_timeout(
    tool: &dyn Tool,
    params: serde_json::Value,
    context: &ToolContext,
) -> Result<ToolResult, ToolError> {
    let timeout_duration = tool.options().base_timeout;

    match timeout(timeout_duration, tool.execute(params, context)).await {
        Ok(result) => result,
        Err(_) => Err(ToolError::timeout(timeout_duration)),
    }
}

// ============================================================================
// Arbitrary Generators
// ============================================================================

/// Generate arbitrary tool names
fn arb_tool_name() -> impl Strategy<Value = String> {
    prop_oneof![
        Just("test_tool".to_string()),
        Just("delayed_tool".to_string()),
        "[a-z_]{3,15}".prop_map(|s| s),
    ]
}

/// Generate arbitrary timeout durations (in milliseconds)
fn arb_timeout_ms() -> impl Strategy<Value = u64> {
    10u64..100
}

/// Generate arbitrary working directory paths
fn arb_working_directory() -> impl Strategy<Value = PathBuf> {
    prop::collection::vec("[a-z]{1,8}", 1..4)
        .prop_map(|segments| PathBuf::from(format!("/{}", segments.join("/"))))
}

/// Generate arbitrary session IDs
fn arb_session_id() -> impl Strategy<Value = String> {
    "[a-z0-9-]{8,16}".prop_map(|s| s)
}

/// Generate arbitrary ToolContext
fn arb_tool_context() -> impl Strategy<Value = ToolContext> {
    (arb_working_directory(), arb_session_id()).prop_map(|(working_directory, session_id)| {
        ToolContext::new(working_directory).with_session_id(session_id)
    })
}

// ============================================================================
// Property Tests - Property 7: Timeout Enforcement
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: tool-alignment, Property 7: Timeout Enforcement**
    ///
    /// Property: Tool execution that exceeds timeout returns timeout error
    /// *For any* tool with delay > timeout, execution SHALL return a timeout error.
    ///
    /// **Validates: Requirements 1.6**
    #[test]
    fn prop_timeout_returns_error_when_exceeded(
        tool_name in arb_tool_name(),
        timeout_ms in 10u64..30,
        context in arb_tool_context()
    ) {
        // Delay is always greater than timeout to ensure timeout occurs
        let delay_ms = timeout_ms + 20;

        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let tool = DelayedTool::new(&tool_name, delay_ms, timeout_ms);
            let params = serde_json::json!({"input": "test"});

            let result = execute_with_timeout(&tool, params, &context).await;

            prop_assert!(result.is_err(), "Should return error when timeout exceeded");

            match result.unwrap_err() {
                ToolError::Timeout(duration) => {
                    prop_assert_eq!(
                        duration.as_millis() as u64,
                        timeout_ms,
                        "Timeout duration should match configured timeout"
                    );
                }
                other => {
                    prop_assert!(false, "Expected Timeout error, got: {:?}", other);
                }
            }

            Ok(())
        })?;
    }

    /// **Feature: tool-alignment, Property 7: Timeout Enforcement**
    ///
    /// Property: Tool execution that completes within timeout succeeds
    /// *For any* tool with delay < timeout, execution SHALL complete successfully.
    ///
    /// **Validates: Requirements 1.6**
    #[test]
    fn prop_execution_succeeds_within_timeout(
        tool_name in arb_tool_name(),
        delay_ms in 1u64..20,
        context in arb_tool_context()
    ) {
        // Timeout is always greater than delay to ensure completion
        let timeout_ms = delay_ms + 50;

        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let tool = DelayedTool::new(&tool_name, delay_ms, timeout_ms);
            let params = serde_json::json!({"input": "test"});

            let result = execute_with_timeout(&tool, params, &context).await;

            prop_assert!(result.is_ok(), "Should succeed when within timeout");

            let tool_result = result.unwrap();
            prop_assert!(tool_result.is_success(), "Result should indicate success");
            prop_assert!(
                tool_result.output.is_some(),
                "Should have output on success"
            );

            Ok(())
        })?;
    }

    /// **Feature: tool-alignment, Property 7: Timeout Enforcement**
    ///
    /// Property: Timeout error contains the configured duration
    /// *For any* timeout configuration, the error SHALL contain the exact duration.
    ///
    /// **Validates: Requirements 1.6**
    #[test]
    fn prop_timeout_error_contains_duration(
        timeout_ms in arb_timeout_ms()
    ) {
        let duration = Duration::from_millis(timeout_ms);
        let error = ToolError::timeout(duration);

        match error {
            ToolError::Timeout(d) => {
                prop_assert_eq!(
                    d.as_millis() as u64,
                    timeout_ms,
                    "Timeout error should contain exact duration"
                );
            }
            _ => {
                prop_assert!(false, "Should be Timeout variant");
            }
        }
    }

    /// **Feature: tool-alignment, Property 7: Timeout Enforcement**
    ///
    /// Property: Tool options correctly configure timeout
    /// *For any* timeout value, ToolOptions SHALL preserve the configured timeout.
    ///
    /// **Validates: Requirements 1.6**
    #[test]
    fn prop_tool_options_preserve_timeout(
        timeout_ms in arb_timeout_ms()
    ) {
        let timeout = Duration::from_millis(timeout_ms);
        let options = ToolOptions::default().with_base_timeout(timeout);

        prop_assert_eq!(
            options.base_timeout.as_millis() as u64,
            timeout_ms,
            "ToolOptions should preserve configured timeout"
        );
    }

    /// **Feature: tool-alignment, Property 7: Timeout Enforcement**
    ///
    /// Property: Timeout is retryable error
    /// *For any* timeout error, it SHALL be classified as retryable.
    ///
    /// **Validates: Requirements 1.6**
    #[test]
    fn prop_timeout_is_retryable(
        timeout_ms in arb_timeout_ms()
    ) {
        let duration = Duration::from_millis(timeout_ms);
        let error = ToolError::timeout(duration);

        prop_assert!(
            error.is_retryable(),
            "Timeout errors should be retryable"
        );
    }

    /// **Feature: tool-alignment, Property 7: Timeout Enforcement**
    ///
    /// Property: Timeout error message contains duration information
    /// *For any* timeout duration, the error message SHALL include duration details.
    ///
    /// **Validates: Requirements 1.6**
    #[test]
    fn prop_timeout_error_message_contains_duration(
        timeout_ms in arb_timeout_ms()
    ) {
        let duration = Duration::from_millis(timeout_ms);
        let error = ToolError::timeout(duration);
        let message = error.to_string();

        prop_assert!(
            message.contains("Timeout"),
            "Error message should mention timeout: {}",
            message
        );
    }
}

// ============================================================================
// Additional Unit Tests for Edge Cases
// ============================================================================

#[cfg(test)]
mod edge_case_tests {
    use super::*;

    #[tokio::test]
    async fn test_zero_timeout_immediately_fails() {
        let tool = DelayedTool::new("test", 10, 0);
        let context = ToolContext::new(PathBuf::from("/tmp"));
        let params = serde_json::json!({"input": "test"});

        // Zero timeout should fail immediately
        let result = execute_with_timeout(&tool, params, &context).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::Timeout(_)));
    }

    #[tokio::test]
    async fn test_exact_timeout_boundary() {
        // Test behavior at exact timeout boundary
        // Due to timing variations, this may succeed or fail
        // The important thing is it doesn't panic
        let tool = DelayedTool::new("test", 50, 50);
        let context = ToolContext::new(PathBuf::from("/tmp"));
        let params = serde_json::json!({"input": "test"});

        let result = execute_with_timeout(&tool, params, &context).await;
        // Either success or timeout is acceptable at boundary
        assert!(result.is_ok() || matches!(result.unwrap_err(), ToolError::Timeout(_)));
    }

    #[tokio::test]
    async fn test_very_short_timeout() {
        let tool = DelayedTool::new("test", 100, 1);
        let context = ToolContext::new(PathBuf::from("/tmp"));
        let params = serde_json::json!({"input": "test"});

        let result = execute_with_timeout(&tool, params, &context).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::Timeout(_)));
    }

    #[tokio::test]
    async fn test_tool_options_default_timeout() {
        let options = ToolOptions::default();
        assert_eq!(options.base_timeout, Duration::from_secs(30));
    }

    #[tokio::test]
    async fn test_timeout_error_display() {
        let error = ToolError::timeout(Duration::from_secs(30));
        let display = format!("{}", error);
        assert!(display.contains("30"));
        assert!(display.contains("Timeout"));
    }

    #[test]
    fn test_timeout_error_is_retryable() {
        let error = ToolError::timeout(Duration::from_secs(1));
        assert!(error.is_retryable());
    }

    #[test]
    fn test_other_errors_not_retryable() {
        assert!(!ToolError::not_found("test").is_retryable());
        assert!(!ToolError::permission_denied("test").is_retryable());
        assert!(!ToolError::safety_check_failed("test").is_retryable());
        assert!(!ToolError::Cancelled.is_retryable());
    }

    #[tokio::test]
    async fn test_cancellation_respected() {
        let tool = DelayedTool::new("test", 1000, 2000);
        let token = tokio_util::sync::CancellationToken::new();
        let context =
            ToolContext::new(PathBuf::from("/tmp")).with_cancellation_token(token.clone());
        let params = serde_json::json!({"input": "test"});

        // Cancel immediately
        token.cancel();

        let result = tool.execute(params, &context).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::Cancelled));
    }

    #[test]
    fn test_tool_definition_from_delayed_tool() {
        let tool = DelayedTool::new("my_tool", 100, 1000);
        let def = tool.get_definition();

        assert_eq!(def.name, "my_tool");
        assert!(!def.description.is_empty());
        assert!(def.input_schema.is_object());
    }

    #[test]
    fn test_permission_check_default_allows() {
        let tool = DelayedTool::new("test", 100, 1000);
        let context = ToolContext::new(PathBuf::from("/tmp"));
        let params = serde_json::json!({"input": "test"});

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(tool.check_permissions(&params, &context));

        assert!(result.is_allowed());
    }
}
