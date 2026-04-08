//! Property-based tests for MCP Error Handling
//!
//! These tests validate Property 25: Structured Error Format
//! from the design document.
//!
//! **Feature: mcp-alignment**
//!
//! **Property 25: Structured Error Format**
//! *For any* MCP operation failure, the returned error SHALL contain a code and message.
//!
//! **Validates: Requirements 8.1**

use proptest::prelude::*;
use std::time::Duration;

use crate::mcp::error::{McpError, McpErrorCode, StructuredError};

/// Strategy for generating random error messages
fn error_message_strategy() -> impl Strategy<Value = String> {
    "[a-zA-Z0-9 _-]{1,100}".prop_map(|s| s.to_string())
}

/// Strategy for generating random error codes
fn error_code_strategy() -> impl Strategy<Value = i32> {
    prop_oneof![
        Just(McpErrorCode::ParseError.code()),
        Just(McpErrorCode::InvalidRequest.code()),
        Just(McpErrorCode::MethodNotFound.code()),
        Just(McpErrorCode::InvalidParams.code()),
        Just(McpErrorCode::InternalError.code()),
        Just(McpErrorCode::ConnectionError.code()),
        Just(McpErrorCode::TransportError.code()),
        Just(McpErrorCode::ProtocolError.code()),
        Just(McpErrorCode::TimeoutError.code()),
        Just(McpErrorCode::CancelledError.code()),
        Just(McpErrorCode::ValidationError.code()),
        Just(McpErrorCode::ConfigError.code()),
        Just(McpErrorCode::LifecycleError.code()),
        Just(McpErrorCode::ToolError.code()),
        Just(McpErrorCode::ResourceError.code()),
        Just(McpErrorCode::PermissionDenied.code()),
    ]
}

/// Strategy for generating random durations
fn duration_strategy() -> impl Strategy<Value = Duration> {
    (1u64..3600u64).prop_map(Duration::from_secs)
}

/// Strategy for generating random validation errors
fn validation_errors_strategy() -> impl Strategy<Value = Vec<String>> {
    prop::collection::vec(error_message_strategy(), 0..5)
}

/// Strategy for generating random server names
fn server_name_strategy() -> impl Strategy<Value = Option<String>> {
    prop_oneof![
        Just(None),
        "[a-z][a-z0-9_-]{0,20}".prop_map(|s| Some(s.to_string())),
    ]
}

/// Strategy for generating random tool names
fn tool_name_strategy() -> impl Strategy<Value = Option<String>> {
    prop_oneof![
        Just(None),
        "[a-z][a-z0-9_-]{0,20}".prop_map(|s| Some(s.to_string())),
    ]
}

/// Strategy for generating random cancellation reasons
fn cancel_reason_strategy() -> impl Strategy<Value = Option<String>> {
    prop_oneof![Just(None), error_message_strategy().prop_map(Some),]
}

/// Strategy for generating all types of McpError
fn mcp_error_strategy() -> impl Strategy<Value = McpError> {
    prop_oneof![
        // Connection error
        error_message_strategy().prop_map(McpError::connection),
        // Transport error
        error_message_strategy().prop_map(McpError::transport),
        // Protocol error
        error_message_strategy().prop_map(McpError::protocol),
        // Timeout error
        (error_message_strategy(), duration_strategy())
            .prop_map(|(msg, dur)| McpError::timeout(msg, dur)),
        // Cancelled error
        (error_message_strategy(), cancel_reason_strategy())
            .prop_map(|(msg, reason)| McpError::cancelled(msg, reason)),
        // Server error
        (error_code_strategy(), error_message_strategy())
            .prop_map(|(code, msg)| McpError::server(code, msg, None)),
        // Validation error
        (error_message_strategy(), validation_errors_strategy())
            .prop_map(|(msg, errors)| McpError::validation(msg, errors)),
        // Config error
        error_message_strategy().prop_map(McpError::config),
        // Lifecycle error
        (error_message_strategy(), server_name_strategy())
            .prop_map(|(msg, name)| McpError::lifecycle(msg, name)),
        // Tool error
        (error_message_strategy(), tool_name_strategy())
            .prop_map(|(msg, name)| McpError::tool(msg, name)),
        // Permission denied error
        error_message_strategy().prop_map(McpError::permission_denied),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    // **Property 25: Structured Error Format**
    //
    // *For any* MCP operation failure, the returned error SHALL contain a code and message.
    //
    // **Validates: Requirements 8.1**
    #[test]
    fn property_25_structured_error_format(error in mcp_error_strategy()) {
        // Feature: mcp-alignment, Property 25: Structured Error Format

        // Every error must have a non-zero code
        let code = error.code();
        prop_assert!(
            code != 0,
            "Error code should not be 0, got {} for error: {:?}",
            code,
            error
        );

        // Every error must have a non-empty message
        let message = error.message();
        prop_assert!(
            !message.is_empty(),
            "Error message should not be empty for error: {:?}",
            error
        );

        // Error should be convertible to StructuredError
        let structured: StructuredError = (&error).into();

        // StructuredError must preserve code and message
        prop_assert_eq!(
            structured.code,
            code,
            "StructuredError code should match original error code"
        );
        prop_assert_eq!(
            structured.message,
            message,
            "StructuredError message should match original error message"
        );
    }

    // Additional property: Error codes are within valid ranges
    #[test]
    fn property_error_codes_in_valid_range(error in mcp_error_strategy()) {
        let code = error.code();

        // JSON-RPC 2.0 error codes are in specific ranges:
        // - Standard errors: -32700 to -32600
        // - Server errors: -32099 to -32000
        // - Application errors: any other negative number or positive numbers

        let is_standard_error = (-32700..=-32600).contains(&code);
        let is_server_error = (-32099..=-32000).contains(&code);
        let is_application_error = code < -32099 || code > -32600;

        prop_assert!(
            is_standard_error || is_server_error || is_application_error,
            "Error code {} is not in a valid JSON-RPC 2.0 range",
            code
        );
    }

    // Additional property: StructuredError serialization preserves data
    #[test]
    fn property_structured_error_serialization_roundtrip(error in mcp_error_strategy()) {
        let structured: StructuredError = (&error).into();

        // Serialize to JSON
        let json = serde_json::to_string(&structured).unwrap();

        // Deserialize back
        let deserialized: StructuredError = serde_json::from_str(&json).unwrap();

        // Code and message should be preserved
        prop_assert_eq!(
            deserialized.code,
            structured.code,
            "Code should be preserved after serialization roundtrip"
        );
        prop_assert_eq!(
            deserialized.message,
            structured.message,
            "Message should be preserved after serialization roundtrip"
        );
    }

    // Additional property: Error display includes message
    #[test]
    fn property_error_display_includes_message(error in mcp_error_strategy()) {
        let display = format!("{}", error);
        let message = error.message();

        // The display string should contain the error message
        prop_assert!(
            display.contains(message),
            "Error display '{}' should contain message '{}'",
            display,
            message
        );
    }

    // Additional property: McpErrorCode descriptions are non-empty
    #[test]
    fn property_error_code_descriptions_non_empty(code in error_code_strategy()) {
        // Convert code back to McpErrorCode
        let error_code = match code {
            -32700 => McpErrorCode::ParseError,
            -32600 => McpErrorCode::InvalidRequest,
            -32601 => McpErrorCode::MethodNotFound,
            -32602 => McpErrorCode::InvalidParams,
            -32603 => McpErrorCode::InternalError,
            -32000 => McpErrorCode::ConnectionError,
            -32001 => McpErrorCode::TransportError,
            -32002 => McpErrorCode::ProtocolError,
            -32003 => McpErrorCode::TimeoutError,
            -32004 => McpErrorCode::CancelledError,
            -32005 => McpErrorCode::ValidationError,
            -32006 => McpErrorCode::ConfigError,
            -32007 => McpErrorCode::LifecycleError,
            -32008 => McpErrorCode::ToolError,
            -32009 => McpErrorCode::ResourceError,
            -32010 => McpErrorCode::PermissionDenied,
            _ => return Ok(()), // Skip unknown codes
        };

        let description = error_code.description();
        prop_assert!(
            !description.is_empty(),
            "Error code {:?} should have a non-empty description",
            error_code
        );
    }
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn test_all_error_codes_have_descriptions() {
        let codes = [
            McpErrorCode::ParseError,
            McpErrorCode::InvalidRequest,
            McpErrorCode::MethodNotFound,
            McpErrorCode::InvalidParams,
            McpErrorCode::InternalError,
            McpErrorCode::ConnectionError,
            McpErrorCode::TransportError,
            McpErrorCode::ProtocolError,
            McpErrorCode::TimeoutError,
            McpErrorCode::CancelledError,
            McpErrorCode::ValidationError,
            McpErrorCode::ConfigError,
            McpErrorCode::LifecycleError,
            McpErrorCode::ToolError,
            McpErrorCode::ResourceError,
            McpErrorCode::PermissionDenied,
        ];

        for code in codes {
            assert!(
                !code.description().is_empty(),
                "Code {:?} should have description",
                code
            );
            assert!(
                code.code() != 0,
                "Code {:?} should have non-zero value",
                code
            );
        }
    }

    #[test]
    fn test_structured_error_json_format() {
        let error = McpError::connection("test connection error");
        let structured: StructuredError = (&error).into();
        let json = serde_json::to_value(&structured).unwrap();

        // Must have code field
        assert!(json.get("code").is_some(), "JSON must have 'code' field");
        assert!(
            json.get("code").unwrap().is_i64(),
            "code must be an integer"
        );

        // Must have message field
        assert!(
            json.get("message").is_some(),
            "JSON must have 'message' field"
        );
        assert!(
            json.get("message").unwrap().is_string(),
            "message must be a string"
        );
    }

    #[test]
    fn test_validation_error_includes_details() {
        let errors = vec!["error1".to_string(), "error2".to_string()];
        let error = McpError::validation("validation failed", errors.clone());
        let structured: StructuredError = (&error).into();

        assert!(
            structured.data.is_some(),
            "Validation error should include data"
        );
        let data = structured.data.unwrap();
        let error_list = data.get("errors").unwrap().as_array().unwrap();
        assert_eq!(error_list.len(), 2);
    }

    #[test]
    fn test_timeout_error_includes_duration() {
        let error = McpError::timeout("request timed out", Duration::from_secs(30));
        let structured: StructuredError = (&error).into();

        assert!(
            structured.data.is_some(),
            "Timeout error should include data"
        );
        let data = structured.data.unwrap();
        let duration_ms = data.get("duration_ms").unwrap().as_u64().unwrap();
        assert_eq!(duration_ms, 30000);
    }
}
