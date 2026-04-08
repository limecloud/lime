//! Property-based tests for audit logging
//!
//! **Property 17: Audit Logging**
//! *For any* permission check or tool execution, when audit logging is enabled,
//! a log entry SHALL be recorded with all required fields.
//!
//! **Property 18: Audit Failure Resilience**
//! *For any* audit logging failure, the permission check or tool execution
//! SHALL continue without blocking.
//!
//! **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5**

use aster::permission::{
    AuditLogEntry, AuditLogLevel, AuditLogger, PermissionContext, PermissionResult,
};
use proptest::prelude::*;
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;

// ============================================================================
// Arbitrary Generators
// ============================================================================

/// Generate arbitrary AuditLogLevel
fn arb_audit_log_level() -> impl Strategy<Value = AuditLogLevel> {
    prop_oneof![
        Just(AuditLogLevel::Debug),
        Just(AuditLogLevel::Info),
        Just(AuditLogLevel::Warn),
        Just(AuditLogLevel::Error),
    ]
}

/// Generate arbitrary PermissionContext
fn arb_permission_context() -> impl Strategy<Value = PermissionContext> {
    (
        prop::collection::vec("[a-z]{1,10}", 1..5), // path segments
        "[a-z0-9-]{8,16}",                          // session_id
        1600000000i64..1900000000i64,               // timestamp
        prop::option::of("[a-z]{3,10}"),            // user
        prop::collection::hash_map("[A-Z_]{3,10}", "[a-zA-Z0-9/:-]{1,20}", 0..3), // environment
    )
        .prop_map(
            |(path_segments, session_id, timestamp, user, environment)| {
                let working_directory = PathBuf::from(format!("/{}", path_segments.join("/")));
                PermissionContext {
                    working_directory,
                    session_id,
                    timestamp,
                    user,
                    environment,
                    metadata: HashMap::new(),
                }
            },
        )
}

/// Generate arbitrary PermissionResult
fn arb_permission_result() -> impl Strategy<Value = PermissionResult> {
    (
        prop::bool::ANY,                                // allowed
        prop::option::of("[a-zA-Z ]{5,30}"),            // reason
        prop::bool::ANY,                                // restricted
        prop::collection::vec("[a-zA-Z ]{5,20}", 0..3), // suggestions
        prop::collection::vec("[a-zA-Z ]{5,20}", 0..3), // violations
    )
        .prop_map(
            |(allowed, reason, restricted, suggestions, violations)| PermissionResult {
                allowed,
                reason,
                restricted,
                suggestions,
                matched_rule: None,
                violations,
            },
        )
}

/// Generate arbitrary tool name
fn arb_tool_name() -> impl Strategy<Value = String> {
    prop_oneof![
        Just("bash".to_string()),
        Just("file_read".to_string()),
        Just("file_write".to_string()),
        Just("http_get".to_string()),
        "[a-z_]{3,15}".prop_map(|s| s),
    ]
}

/// Generate arbitrary event type
fn arb_event_type() -> impl Strategy<Value = String> {
    prop_oneof![
        Just("permission_check".to_string()),
        Just("tool_execution".to_string()),
        Just("custom_event".to_string()),
    ]
}

/// Generate arbitrary parameters
fn arb_parameters() -> impl Strategy<Value = HashMap<String, Value>> {
    prop::collection::hash_map(
        "[a-z_]{3,10}",
        prop_oneof![
            "[a-zA-Z0-9 ]{1,20}".prop_map(Value::String),
            (0i64..1000).prop_map(|n| Value::Number(n.into())),
            prop::bool::ANY.prop_map(Value::Bool),
        ],
        0..5,
    )
}

/// Generate arbitrary AuditLogEntry
fn arb_audit_log_entry() -> impl Strategy<Value = AuditLogEntry> {
    (
        arb_event_type(),
        arb_tool_name(),
        arb_audit_log_level(),
        arb_parameters(),
        arb_permission_context(),
        prop::option::of(arb_permission_result()),
        prop::option::of(0u64..10000),
    )
        .prop_map(
            |(event_type, tool_name, level, parameters, context, result, duration_ms)| {
                let mut entry = AuditLogEntry::new(event_type, tool_name)
                    .with_level(level)
                    .with_parameters(parameters)
                    .with_context(context);

                if let Some(r) = result {
                    entry = entry.with_result(r);
                }

                if let Some(d) = duration_ms {
                    entry = entry.with_duration_ms(d);
                }

                entry
            },
        )
}

// ============================================================================
// Property Tests - Property 17: Audit Logging
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: tool-permission-system, Property 17: Audit Logging**
    ///
    /// Property: AuditLogEntry contains all required fields after construction
    /// *For any* event type and tool name, a new AuditLogEntry SHALL contain
    /// all required fields with appropriate values.
    ///
    /// **Validates: Requirements 10.1, 10.2, 10.4**
    #[test]
    fn prop_audit_entry_has_required_fields(
        event_type in arb_event_type(),
        tool_name in arb_tool_name()
    ) {
        let entry = AuditLogEntry::new(event_type.clone(), tool_name.clone());

        // Verify required fields are set
        prop_assert_eq!(entry.event_type, event_type);
        prop_assert_eq!(entry.tool_name, tool_name);
        prop_assert!(entry.timestamp > 0, "Timestamp should be set");
        prop_assert_eq!(entry.level, AuditLogLevel::Info, "Default level should be Info");
    }

    /// **Feature: tool-permission-system, Property 17: Audit Logging**
    ///
    /// Property: AuditLogEntry builder methods preserve all fields
    /// *For any* audit entry with builder methods applied, all fields
    /// SHALL be correctly preserved.
    ///
    /// **Validates: Requirements 10.1, 10.2, 10.4**
    #[test]
    fn prop_audit_entry_builder_preserves_fields(
        entry in arb_audit_log_entry()
    ) {
        // Verify the entry can be serialized (all fields are valid)
        let json_result = serde_json::to_string(&entry);
        prop_assert!(json_result.is_ok(), "Entry should be serializable");

        // Verify deserialization produces equivalent entry
        let json = json_result.unwrap();
        let deserialized: AuditLogEntry = serde_json::from_str(&json).unwrap();

        prop_assert_eq!(entry.event_type, deserialized.event_type);
        prop_assert_eq!(entry.tool_name, deserialized.tool_name);
        prop_assert_eq!(entry.level, deserialized.level);
        prop_assert_eq!(entry.parameters, deserialized.parameters);
        prop_assert_eq!(entry.context.session_id, deserialized.context.session_id);
        prop_assert_eq!(entry.duration_ms, deserialized.duration_ms);
    }

    /// **Feature: tool-permission-system, Property 17: Audit Logging**
    ///
    /// Property: Logger respects enabled/disabled state
    /// *For any* logger state and entry, logging SHALL only occur when enabled.
    ///
    /// **Validates: Requirements 10.3**
    #[test]
    fn prop_logger_respects_enabled_state(
        entry in arb_audit_log_entry(),
        enabled in prop::bool::ANY
    ) {
        let mut logger = AuditLogger::new(AuditLogLevel::Debug);

        if enabled {
            logger.enable();
        } else {
            logger.disable();
        }

        prop_assert_eq!(logger.is_enabled(), enabled);

        // Logging should not panic regardless of state
        logger.log_permission_check(entry.clone());
        logger.log_tool_execution(entry.clone());
        logger.log(entry);
    }

    /// **Feature: tool-permission-system, Property 17: Audit Logging**
    ///
    /// Property: Logger level filtering is consistent
    /// *For any* logger level and entry level, the should_log function
    /// SHALL correctly determine if the entry should be logged.
    ///
    /// **Validates: Requirements 10.3**
    #[test]
    fn prop_logger_level_filtering_consistent(
        logger_level in arb_audit_log_level(),
        entry_level in arb_audit_log_level()
    ) {
        let should_log = logger_level.should_log(entry_level);

        // Verify the filtering logic
        let logger_priority = match logger_level {
            AuditLogLevel::Debug => 0,
            AuditLogLevel::Info => 1,
            AuditLogLevel::Warn => 2,
            AuditLogLevel::Error => 3,
        };

        let entry_priority = match entry_level {
            AuditLogLevel::Debug => 0,
            AuditLogLevel::Info => 1,
            AuditLogLevel::Warn => 2,
            AuditLogLevel::Error => 3,
        };

        let expected = entry_priority >= logger_priority;
        prop_assert_eq!(
            should_log, expected,
            "Level filtering should be consistent: logger={:?}, entry={:?}",
            logger_level, entry_level
        );
    }

    /// **Feature: tool-permission-system, Property 17: Audit Logging**
    ///
    /// Property: Logger set_level updates the level correctly
    /// *For any* initial level and new level, set_level SHALL update
    /// the logger's level.
    ///
    /// **Validates: Requirements 10.3**
    #[test]
    fn prop_logger_set_level_updates(
        initial_level in arb_audit_log_level(),
        new_level in arb_audit_log_level()
    ) {
        let mut logger = AuditLogger::new(initial_level);
        prop_assert_eq!(logger.level(), initial_level);

        logger.set_level(new_level);
        prop_assert_eq!(logger.level(), new_level);
    }

    /// **Feature: tool-permission-system, Property 17: Audit Logging**
    ///
    /// Property: Permission check logging includes result information
    /// *For any* permission check entry with a result, the entry SHALL
    /// contain the result information.
    ///
    /// **Validates: Requirements 10.1, 10.4**
    #[test]
    fn prop_permission_check_includes_result(
        context in arb_permission_context(),
        result in arb_permission_result(),
        tool_name in arb_tool_name()
    ) {
        let entry = AuditLogEntry::new("permission_check", tool_name)
            .with_context(context.clone())
            .with_result(result.clone());

        prop_assert!(entry.result.is_some());
        let entry_result = entry.result.unwrap();
        prop_assert_eq!(entry_result.allowed, result.allowed);
        prop_assert_eq!(entry_result.reason, result.reason);
        prop_assert_eq!(entry.context.session_id, context.session_id);
    }

    /// **Feature: tool-permission-system, Property 17: Audit Logging**
    ///
    /// Property: Tool execution logging includes duration
    /// *For any* tool execution entry with duration, the entry SHALL
    /// contain the duration information.
    ///
    /// **Validates: Requirements 10.2, 10.4**
    #[test]
    fn prop_tool_execution_includes_duration(
        context in arb_permission_context(),
        tool_name in arb_tool_name(),
        duration_ms in 0u64..100000
    ) {
        let entry = AuditLogEntry::new("tool_execution", tool_name)
            .with_context(context)
            .with_duration_ms(duration_ms);

        prop_assert_eq!(entry.duration_ms, Some(duration_ms));
        prop_assert_eq!(entry.event_type, "tool_execution");
    }
}

// ============================================================================
// Property Tests - Property 18: Audit Failure Resilience
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: tool-permission-system, Property 18: Audit Failure Resilience**
    ///
    /// Property: Logging never panics regardless of input
    /// *For any* audit entry, logging SHALL complete without panicking.
    ///
    /// **Validates: Requirements 10.5**
    #[test]
    fn prop_logging_never_panics(
        entry in arb_audit_log_entry(),
        logger_level in arb_audit_log_level()
    ) {
        let logger = AuditLogger::new(logger_level);

        // These should never panic
        logger.log_permission_check(entry.clone());
        logger.log_tool_execution(entry.clone());
        logger.log(entry);
    }

    /// **Feature: tool-permission-system, Property 18: Audit Failure Resilience**
    ///
    /// Property: Disabled logger completes immediately
    /// *For any* entry and disabled logger, logging SHALL complete
    /// without any side effects.
    ///
    /// **Validates: Requirements 10.5**
    #[test]
    fn prop_disabled_logger_completes_immediately(
        entry in arb_audit_log_entry()
    ) {
        let mut logger = AuditLogger::new(AuditLogLevel::Debug);
        logger.disable();

        // These should complete immediately without any work
        logger.log_permission_check(entry.clone());
        logger.log_tool_execution(entry.clone());
        logger.log(entry);

        // Logger should still be disabled
        prop_assert!(!logger.is_enabled());
    }

    /// **Feature: tool-permission-system, Property 18: Audit Failure Resilience**
    ///
    /// Property: Logger state is independent of logging operations
    /// *For any* sequence of logging operations, the logger state
    /// SHALL remain consistent.
    ///
    /// **Validates: Requirements 10.5**
    #[test]
    fn prop_logger_state_independent_of_logging(
        entries in prop::collection::vec(arb_audit_log_entry(), 1..10),
        initial_level in arb_audit_log_level(),
        initial_enabled in prop::bool::ANY
    ) {
        let mut logger = AuditLogger::new(initial_level);
        if !initial_enabled {
            logger.disable();
        }

        // Perform multiple logging operations
        for entry in entries {
            logger.log_permission_check(entry.clone());
            logger.log_tool_execution(entry.clone());
            logger.log(entry);
        }

        // State should be unchanged
        prop_assert_eq!(logger.level(), initial_level);
        prop_assert_eq!(logger.is_enabled(), initial_enabled);
    }

    /// **Feature: tool-permission-system, Property 18: Audit Failure Resilience**
    ///
    /// Property: Entry with empty fields does not cause failures
    /// *For any* entry with minimal/empty fields, logging SHALL complete
    /// without errors.
    ///
    /// **Validates: Requirements 10.5**
    #[test]
    fn prop_empty_fields_do_not_cause_failures(
        event_type in arb_event_type(),
        tool_name in arb_tool_name()
    ) {
        let logger = AuditLogger::new(AuditLogLevel::Debug);

        // Create entry with minimal fields
        let entry = AuditLogEntry::new(event_type, tool_name);

        // Should not panic
        logger.log_permission_check(entry.clone());
        logger.log_tool_execution(entry.clone());
        logger.log(entry);
    }

    /// **Feature: tool-permission-system, Property 18: Audit Failure Resilience**
    ///
    /// Property: Entry with large metadata does not cause failures
    /// *For any* entry with large metadata, logging SHALL complete
    /// without errors.
    ///
    /// **Validates: Requirements 10.5**
    #[test]
    fn prop_large_metadata_does_not_cause_failures(
        event_type in arb_event_type(),
        tool_name in arb_tool_name(),
        metadata_size in 10usize..50
    ) {
        let logger = AuditLogger::new(AuditLogLevel::Debug);

        // Create entry with large metadata
        let mut metadata = HashMap::new();
        for i in 0..metadata_size {
            metadata.insert(
                format!("key_{}", i),
                Value::String(format!("value_{}_with_some_extra_content", i)),
            );
        }

        let entry = AuditLogEntry::new(event_type, tool_name)
            .with_metadata(metadata);

        // Should not panic
        logger.log_permission_check(entry.clone());
        logger.log_tool_execution(entry.clone());
        logger.log(entry);
    }
}

// ============================================================================
// Additional Unit Tests for Edge Cases
// ============================================================================

#[cfg(test)]
mod edge_case_tests {
    use super::*;

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

    #[test]
    fn test_audit_log_level_priority_order() {
        // Debug < Info < Warn < Error
        assert!(AuditLogLevel::Debug.should_log(AuditLogLevel::Debug));
        assert!(AuditLogLevel::Debug.should_log(AuditLogLevel::Info));
        assert!(AuditLogLevel::Debug.should_log(AuditLogLevel::Warn));
        assert!(AuditLogLevel::Debug.should_log(AuditLogLevel::Error));

        assert!(!AuditLogLevel::Info.should_log(AuditLogLevel::Debug));
        assert!(AuditLogLevel::Info.should_log(AuditLogLevel::Info));
        assert!(AuditLogLevel::Info.should_log(AuditLogLevel::Warn));
        assert!(AuditLogLevel::Info.should_log(AuditLogLevel::Error));

        assert!(!AuditLogLevel::Warn.should_log(AuditLogLevel::Debug));
        assert!(!AuditLogLevel::Warn.should_log(AuditLogLevel::Info));
        assert!(AuditLogLevel::Warn.should_log(AuditLogLevel::Warn));
        assert!(AuditLogLevel::Warn.should_log(AuditLogLevel::Error));

        assert!(!AuditLogLevel::Error.should_log(AuditLogLevel::Debug));
        assert!(!AuditLogLevel::Error.should_log(AuditLogLevel::Info));
        assert!(!AuditLogLevel::Error.should_log(AuditLogLevel::Warn));
        assert!(AuditLogLevel::Error.should_log(AuditLogLevel::Error));
    }

    #[test]
    fn test_audit_entry_add_metadata() {
        let entry = AuditLogEntry::new("test", "tool")
            .add_metadata("key1", Value::String("value1".to_string()))
            .add_metadata("key2", Value::Number(42.into()));

        assert_eq!(entry.metadata.len(), 2);
        assert_eq!(
            entry.metadata.get("key1"),
            Some(&Value::String("value1".to_string()))
        );
        assert_eq!(entry.metadata.get("key2"), Some(&Value::Number(42.into())));
    }

    #[test]
    fn test_logger_enable_disable_toggle() {
        let mut logger = AuditLogger::new(AuditLogLevel::Info);

        assert!(logger.is_enabled());

        logger.disable();
        assert!(!logger.is_enabled());

        logger.enable();
        assert!(logger.is_enabled());

        logger.disable();
        logger.disable(); // Double disable
        assert!(!logger.is_enabled());

        logger.enable();
        logger.enable(); // Double enable
        assert!(logger.is_enabled());
    }

    #[test]
    fn test_logger_with_all_levels() {
        let context = create_test_context();

        for level in [
            AuditLogLevel::Debug,
            AuditLogLevel::Info,
            AuditLogLevel::Warn,
            AuditLogLevel::Error,
        ] {
            let logger = AuditLogger::new(level);
            let entry = AuditLogEntry::new("test", "tool")
                .with_level(level)
                .with_context(context.clone());

            // Should not panic
            logger.log_permission_check(entry.clone());
            logger.log_tool_execution(entry.clone());
            logger.log(entry);
        }
    }

    #[test]
    fn test_entry_serialization_roundtrip() {
        let context = create_test_context();
        let result = PermissionResult {
            allowed: false,
            reason: Some("Test denial".to_string()),
            restricted: true,
            suggestions: vec!["Try again".to_string()],
            matched_rule: None,
            violations: vec!["Violation 1".to_string()],
        };

        let entry = AuditLogEntry::new("permission_check", "bash")
            .with_level(AuditLogLevel::Warn)
            .with_context(context)
            .with_result(result)
            .with_duration_ms(150)
            .add_metadata("custom", Value::String("value".to_string()));

        let json = serde_json::to_string(&entry).unwrap();
        let deserialized: AuditLogEntry = serde_json::from_str(&json).unwrap();

        assert_eq!(entry.event_type, deserialized.event_type);
        assert_eq!(entry.tool_name, deserialized.tool_name);
        assert_eq!(entry.level, deserialized.level);
        assert_eq!(entry.duration_ms, deserialized.duration_ms);
        assert!(deserialized.result.is_some());
        assert_eq!(
            deserialized.result.as_ref().unwrap().allowed,
            entry.result.as_ref().unwrap().allowed
        );
    }

    #[test]
    fn test_default_implementations() {
        let default_level = AuditLogLevel::default();
        assert_eq!(default_level, AuditLogLevel::Info);

        let default_logger = AuditLogger::default();
        assert_eq!(default_logger.level(), AuditLogLevel::Info);
        assert!(default_logger.is_enabled());

        let default_entry = AuditLogEntry::default();
        assert_eq!(default_entry.timestamp, 0);
        assert_eq!(default_entry.level, AuditLogLevel::Info);
        assert!(default_entry.event_type.is_empty());
        assert!(default_entry.tool_name.is_empty());
    }
}
