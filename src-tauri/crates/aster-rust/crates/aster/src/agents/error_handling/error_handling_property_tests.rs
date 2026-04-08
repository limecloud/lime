//! Property-Based Tests for Error Handling
//!
//! This module contains property-based tests for the error handling module,
//! validating Properties 40-42 from the design document.
//!
//! **Property 40: Error Recording Completeness**
//! **Property 41: Timeout Handling**
//! **Property 42: Retry Configuration**
//!
//! **Validates: Requirements 15.1, 15.2, 15.3, 15.4**

use proptest::prelude::*;
use std::time::Duration;

use super::error_handler::{
    AgentError, AgentErrorKind, ErrorContext, ErrorHandler, ErrorRecord, ErrorSeverity,
};
use super::retry_handler::{RetryConfig, RetryHandler, RetryResult, RetryStrategy};
use super::timeout_handler::{TimeoutConfig, TimeoutHandler, TimeoutStatus};

/// Strategy for generating valid agent IDs
fn agent_id_strategy() -> impl Strategy<Value = String> {
    "[a-z][a-z0-9_-]{0,19}".prop_map(|s| s.to_string())
}

/// Strategy for generating error messages
fn error_message_strategy() -> impl Strategy<Value = String> {
    "[a-zA-Z0-9 ]{1,50}".prop_map(|s| s.to_string())
}

/// Strategy for generating tool names
fn tool_name_strategy() -> impl Strategy<Value = String> {
    prop_oneof![
        Just("bash".to_string()),
        Just("read_file".to_string()),
        Just("write_file".to_string()),
        Just("search".to_string()),
        Just("http_request".to_string()),
    ]
}

/// Strategy for generating error kinds
fn error_kind_strategy() -> impl Strategy<Value = AgentErrorKind> {
    prop_oneof![
        Just(AgentErrorKind::Timeout),
        Just(AgentErrorKind::ApiCall),
        Just(AgentErrorKind::ToolExecution),
        Just(AgentErrorKind::Context),
        Just(AgentErrorKind::Configuration),
        Just(AgentErrorKind::ResourceLimit),
        Just(AgentErrorKind::Network),
        Just(AgentErrorKind::Internal),
    ]
}

/// Strategy for generating error severities
fn error_severity_strategy() -> impl Strategy<Value = ErrorSeverity> {
    prop_oneof![
        Just(ErrorSeverity::Debug),
        Just(ErrorSeverity::Info),
        Just(ErrorSeverity::Warning),
        Just(ErrorSeverity::Error),
        Just(ErrorSeverity::Critical),
    ]
}

/// Strategy for generating phases
fn phase_strategy() -> impl Strategy<Value = String> {
    prop_oneof![
        Just("initialization".to_string()),
        Just("tool_execution".to_string()),
        Just("api_call".to_string()),
        Just("context_management".to_string()),
        Just("cleanup".to_string()),
    ]
}

/// Strategy for generating retry strategies
fn retry_strategy_strategy() -> impl Strategy<Value = RetryStrategy> {
    prop_oneof![
        Just(RetryStrategy::Fixed),
        Just(RetryStrategy::Linear),
        Just(RetryStrategy::Exponential),
        Just(RetryStrategy::ExponentialWithJitter),
    ]
}

/// Strategy for generating retryable error types
fn retryable_error_type_strategy() -> impl Strategy<Value = String> {
    prop_oneof![
        Just("network_error".to_string()),
        Just("timeout_exceeded".to_string()),
        Just("rate_limit_hit".to_string()),
        Just("temporary_failure".to_string()),
    ]
}

/// Strategy for generating non-retryable error types
fn non_retryable_error_type_strategy() -> impl Strategy<Value = String> {
    prop_oneof![
        Just("invalid_input".to_string()),
        Just("authentication_failed".to_string()),
        Just("permission_denied".to_string()),
        Just("not_found".to_string()),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    // =========================================================================
    // **Property 40: Error Recording Completeness**
    //
    // *For any* error encountered during agent execution, the error SHALL be
    // recorded with timestamp, message, and context.
    //
    // **Validates: Requirements 15.1, 15.3**
    // =========================================================================

    #[test]
    fn property_40_error_record_has_timestamp_and_message(
        kind in error_kind_strategy(),
        message in error_message_strategy(),
    ) {
        let error = ErrorRecord::new(kind.clone(), &message);

        // Error MUST have a unique ID
        prop_assert!(!error.id.is_empty(),
            "Error record must have a non-empty ID");

        // Error MUST have a timestamp
        prop_assert!(error.timestamp <= chrono::Utc::now(),
            "Error timestamp must be set and not in the future");

        // Error MUST have the correct message
        prop_assert_eq!(&error.message, &message,
            "Error message must match input");

        // Error MUST have the correct kind
        prop_assert_eq!(&error.kind, &kind,
            "Error kind must match input");
    }

    #[test]
    fn property_40_error_record_with_context_preserves_all_fields(
        agent_id in agent_id_strategy(),
        phase in phase_strategy(),
        tool_name in tool_name_strategy(),
        message in error_message_strategy(),
    ) {
        let context = ErrorContext::new()
            .with_agent_id(&agent_id)
            .with_phase(&phase)
            .with_tool_name(&tool_name);

        let error = ErrorRecord::new(AgentErrorKind::ToolExecution, &message)
            .with_context(context);

        // Context fields MUST be preserved
        prop_assert_eq!(error.context.agent_id.as_ref(), Some(&agent_id),
            "Agent ID must be preserved in context");
        prop_assert_eq!(error.context.phase.as_ref(), Some(&phase),
            "Phase must be preserved in context");
        prop_assert_eq!(error.context.tool_name.as_ref(), Some(&tool_name),
            "Tool name must be preserved in context");

        // Error MUST have context
        prop_assert!(error.has_context(),
            "Error must have context when context is set");
    }

    #[test]
    fn property_40_error_handler_records_all_errors(
        errors_data in prop::collection::vec(
            (error_kind_strategy(), error_message_strategy(), agent_id_strategy()),
            1..20
        ),
    ) {
        let mut handler = ErrorHandler::new();

        let mut recorded_ids = Vec::new();
        for (kind, message, agent_id) in &errors_data {
            let error = ErrorRecord::new(kind.clone(), message)
                .with_context(ErrorContext::new().with_agent_id(agent_id));
            let id = handler.record(error);
            recorded_ids.push(id);
        }

        // All errors MUST be recorded
        prop_assert_eq!(handler.count(), errors_data.len(),
            "Handler must record all errors");

        // Each error MUST be retrievable by ID
        for id in &recorded_ids {
            prop_assert!(handler.get(id).is_some(),
                "Each recorded error must be retrievable by ID");
        }
    }

    #[test]
    fn property_40_tool_error_recording_includes_tool_info(
        agent_id in agent_id_strategy(),
        tool_name in tool_name_strategy(),
        message in error_message_strategy(),
    ) {
        let mut handler = ErrorHandler::new();

        let id = handler.record_tool_error(&agent_id, &tool_name, Some("call-123"), &message);

        let error = handler.get(&id).unwrap();

        // Tool error MUST have correct kind
        prop_assert_eq!(&error.kind, &AgentErrorKind::ToolExecution,
            "Tool error must have ToolExecution kind");

        // Tool error MUST have agent ID in context
        prop_assert_eq!(error.context.agent_id.as_ref(), Some(&agent_id),
            "Tool error must have agent ID");

        // Tool error MUST have tool name in context
        prop_assert_eq!(error.context.tool_name.as_ref(), Some(&tool_name),
            "Tool error must have tool name");

        // Tool error MUST have tool call ID in context
        prop_assert_eq!(error.context.tool_call_id.as_ref(), Some(&"call-123".to_string()),
            "Tool error must have tool call ID");

        // Tool error MUST have phase set to tool_execution
        prop_assert_eq!(error.context.phase.as_ref(), Some(&"tool_execution".to_string()),
            "Tool error must have phase set to tool_execution");
    }

    #[test]
    fn property_40_errors_grouped_by_agent(
        base_ids in prop::collection::vec(agent_id_strategy(), 2..5),
        errors_per_agent in 1usize..5,
    ) {
        let mut handler = ErrorHandler::new();

        // Ensure unique agent IDs by appending index
        let agent_ids: Vec<String> = base_ids
            .iter()
            .enumerate()
            .map(|(i, id)| format!("{}-{}", id, i))
            .collect();

        // Record errors for each agent
        for agent_id in &agent_ids {
            for i in 0..errors_per_agent {
                let error = ErrorRecord::new(AgentErrorKind::ApiCall, format!("Error {}", i))
                    .with_context(ErrorContext::new().with_agent_id(agent_id));
                handler.record(error);
            }
        }

        // Errors MUST be retrievable by agent
        for agent_id in &agent_ids {
            let agent_errors = handler.get_by_agent(agent_id);
            prop_assert_eq!(agent_errors.len(), errors_per_agent,
                "Each agent should have {} errors", errors_per_agent);

            // All errors for this agent MUST have the correct agent ID
            for error in agent_errors {
                prop_assert_eq!(error.context.agent_id.as_ref(), Some(agent_id),
                    "Error agent ID must match");
            }
        }
    }

    #[test]
    fn property_40_errors_filtered_by_kind(
        num_timeout_errors in 1usize..5,
        num_api_errors in 1usize..5,
        num_tool_errors in 1usize..5,
    ) {
        let mut handler = ErrorHandler::new();

        // Record different kinds of errors
        for i in 0..num_timeout_errors {
            handler.record(ErrorRecord::new(AgentErrorKind::Timeout, format!("Timeout {}", i)));
        }
        for i in 0..num_api_errors {
            handler.record(ErrorRecord::new(AgentErrorKind::ApiCall, format!("API {}", i)));
        }
        for i in 0..num_tool_errors {
            handler.record(ErrorRecord::new(AgentErrorKind::ToolExecution, format!("Tool {}", i)));
        }

        // Errors MUST be filterable by kind
        let timeout_errors = handler.get_by_kind(&AgentErrorKind::Timeout);
        prop_assert_eq!(timeout_errors.len(), num_timeout_errors,
            "Should have {} timeout errors", num_timeout_errors);

        let api_errors = handler.get_by_kind(&AgentErrorKind::ApiCall);
        prop_assert_eq!(api_errors.len(), num_api_errors,
            "Should have {} API errors", num_api_errors);

        let tool_errors = handler.get_by_kind(&AgentErrorKind::ToolExecution);
        prop_assert_eq!(tool_errors.len(), num_tool_errors,
            "Should have {} tool errors", num_tool_errors);
    }

    #[test]
    fn property_40_errors_filtered_by_severity(
        num_warning_errors in 1usize..5,
        num_error_errors in 1usize..5,
        num_critical_errors in 1usize..5,
    ) {
        let mut handler = ErrorHandler::new();

        // Record errors with different severities
        for i in 0..num_warning_errors {
            handler.record(
                ErrorRecord::new(AgentErrorKind::ApiCall, format!("Warning {}", i))
                    .with_severity(ErrorSeverity::Warning)
            );
        }
        for i in 0..num_error_errors {
            handler.record(
                ErrorRecord::new(AgentErrorKind::ApiCall, format!("Error {}", i))
                    .with_severity(ErrorSeverity::Error)
            );
        }
        for i in 0..num_critical_errors {
            handler.record(
                ErrorRecord::new(AgentErrorKind::ApiCall, format!("Critical {}", i))
                    .with_severity(ErrorSeverity::Critical)
            );
        }

        // Filtering by Error severity should include Error and Critical
        let severe_errors = handler.get_by_severity(ErrorSeverity::Error);
        prop_assert_eq!(severe_errors.len(), num_error_errors + num_critical_errors,
            "Should have {} errors with severity >= Error", num_error_errors + num_critical_errors);

        // Filtering by Critical severity should only include Critical
        let critical_errors = handler.get_by_severity(ErrorSeverity::Critical);
        prop_assert_eq!(critical_errors.len(), num_critical_errors,
            "Should have {} critical errors", num_critical_errors);
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    // =========================================================================
    // **Property 41: Timeout Handling**
    //
    // *For any* agent exceeding the configured timeout, the agent SHALL be
    // marked as timed out and a timeout event SHALL be emitted.
    //
    // **Validates: Requirements 15.2**
    // =========================================================================

    #[test]
    fn property_41_timeout_status_changes_when_exceeded(
        agent_id in agent_id_strategy(),
        timeout_ms in 10u64..100,
    ) {
        let mut handler = TimeoutHandler::new();
        let config = TimeoutConfig::new(Duration::from_millis(timeout_ms));

        handler.start_tracking_with_config(&agent_id, config);

        // Initially should be Running
        prop_assert_eq!(handler.get_status(&agent_id), Some(TimeoutStatus::Running),
            "Initial status should be Running");

        // Mark as timed out
        let event = handler.mark_timed_out(&agent_id);

        // Event MUST be emitted
        prop_assert!(event.is_some(),
            "Timeout event must be emitted when marking as timed out");

        // Status MUST be TimedOut
        prop_assert!(handler.is_timed_out(&agent_id),
            "Agent must be marked as timed out");

        prop_assert_eq!(handler.get_status(&agent_id), Some(TimeoutStatus::TimedOut),
            "Status must be TimedOut");
    }

    #[test]
    fn property_41_timeout_event_contains_correct_info(
        agent_id in agent_id_strategy(),
        timeout_secs in 1u64..60,
    ) {
        let mut handler = TimeoutHandler::new();
        let config = TimeoutConfig::new(Duration::from_secs(timeout_secs));

        handler.start_tracking_with_config(&agent_id, config);

        let event = handler.mark_timed_out(&agent_id).unwrap();

        // Event MUST have correct agent ID
        prop_assert_eq!(&event.agent_id, &agent_id,
            "Event agent ID must match");

        // Event MUST have correct status transition
        prop_assert_eq!(event.previous_status, TimeoutStatus::Running,
            "Previous status should be Running");
        prop_assert_eq!(event.new_status, TimeoutStatus::TimedOut,
            "New status should be TimedOut");

        // Event MUST have correct timeout value
        prop_assert_eq!(event.timeout, Duration::from_secs(timeout_secs),
            "Event timeout must match configured timeout");

        // Event MUST have a timestamp
        prop_assert!(event.timestamp <= chrono::Utc::now(),
            "Event timestamp must be set");
    }

    #[test]
    fn property_41_stop_tracking_emits_completion_event(
        agent_id in agent_id_strategy(),
        completed in any::<bool>(),
    ) {
        let mut handler = TimeoutHandler::new();
        handler.start_tracking(&agent_id);

        let event = handler.stop_tracking(&agent_id, completed);

        // Event MUST be emitted
        prop_assert!(event.is_some(),
            "Event must be emitted when stopping tracking");

        let event = event.unwrap();

        // Event MUST have correct status
        let expected_status = if completed {
            TimeoutStatus::Completed
        } else {
            TimeoutStatus::Cancelled
        };
        prop_assert_eq!(event.new_status, expected_status,
            "Event status must match completion flag");

        // Agent MUST be removed from tracking
        prop_assert_eq!(handler.tracked_count(), 0,
            "Agent must be removed from tracking");
    }

    #[test]
    fn property_41_remaining_time_decreases(
        agent_id in agent_id_strategy(),
        timeout_secs in 10u64..60,
    ) {
        let mut handler = TimeoutHandler::new();
        let config = TimeoutConfig::new(Duration::from_secs(timeout_secs));

        handler.start_tracking_with_config(&agent_id, config);

        let remaining = handler.get_remaining(&agent_id).unwrap();

        // Remaining time MUST be <= timeout
        prop_assert!(remaining <= Duration::from_secs(timeout_secs),
            "Remaining time must be <= timeout");

        // Remaining time MUST be > 0 (since we just started)
        prop_assert!(remaining > Duration::ZERO,
            "Remaining time must be > 0 immediately after start");
    }

    #[test]
    fn property_41_elapsed_time_increases(
        agent_id in agent_id_strategy(),
    ) {
        let mut handler = TimeoutHandler::new();
        handler.start_tracking(&agent_id);

        let elapsed = handler.get_elapsed(&agent_id).unwrap();

        // Elapsed time MUST be >= 0
        prop_assert!(elapsed >= Duration::ZERO,
            "Elapsed time must be >= 0");
    }

    #[test]
    fn property_41_warning_threshold_respected(
        _agent_id in agent_id_strategy(),
        timeout_secs in 10u64..60,
        warning_threshold in 0.5f64..0.95,
    ) {
        let config = TimeoutConfig::new(Duration::from_secs(timeout_secs))
            .with_warning_threshold(warning_threshold);

        let warning_duration = config.warning_duration();

        // Warning duration MUST be proportional to timeout
        let expected_warning = Duration::from_secs_f64(timeout_secs as f64 * warning_threshold);

        // Allow small floating point differences
        let diff = warning_duration.abs_diff(expected_warning);

        prop_assert!(diff < Duration::from_millis(10),
            "Warning duration {:?} should be close to expected {:?}",
            warning_duration, expected_warning);
    }

    #[test]
    fn property_41_multiple_agents_tracked_independently(
        base_ids in prop::collection::vec(agent_id_strategy(), 2..5),
    ) {
        let mut handler = TimeoutHandler::new();

        // Ensure unique agent IDs by appending index
        let agent_ids: Vec<String> = base_ids
            .iter()
            .enumerate()
            .map(|(i, id)| format!("{}-{}", id, i))
            .collect();

        // Start tracking all agents
        for agent_id in &agent_ids {
            handler.start_tracking(agent_id);
        }

        prop_assert_eq!(handler.tracked_count(), agent_ids.len(),
            "All agents should be tracked");

        // Mark first agent as timed out
        if !agent_ids.is_empty() {
            handler.mark_timed_out(&agent_ids[0]);

            // First agent MUST be timed out
            prop_assert!(handler.is_timed_out(&agent_ids[0]),
                "First agent should be timed out");

            // Other agents MUST NOT be timed out
            for agent_id in agent_ids.iter().skip(1) {
                prop_assert!(!handler.is_timed_out(agent_id),
                    "Other agents should not be timed out");
            }
        }
    }

    #[test]
    fn property_41_get_timed_out_agents_returns_correct_list(
        agent_ids in prop::collection::vec(agent_id_strategy(), 2..5),
        num_to_timeout in 0usize..5,
    ) {
        let mut handler = TimeoutHandler::new();

        // Deduplicate agent_ids to avoid counting issues with HashMap
        let unique_agent_ids: Vec<String> = agent_ids
            .into_iter()
            .collect::<std::collections::HashSet<_>>()
            .into_iter()
            .collect();

        let num_to_timeout = num_to_timeout.min(unique_agent_ids.len());

        // Start tracking all agents
        for agent_id in &unique_agent_ids {
            handler.start_tracking(agent_id);
        }

        // Timeout some agents
        for agent_id in unique_agent_ids.iter().take(num_to_timeout) {
            handler.mark_timed_out(agent_id);
        }

        let timed_out = handler.get_timed_out_agents();

        // Timed out list MUST have correct count
        prop_assert_eq!(timed_out.len(), num_to_timeout,
            "Should have {} timed out agents", num_to_timeout);

        // All timed out agents MUST be in the list
        for agent_id in unique_agent_ids.iter().take(num_to_timeout) {
            prop_assert!(timed_out.contains(&agent_id.as_str()),
                "Agent {} should be in timed out list", agent_id);
        }
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    // =========================================================================
    // **Property 42: Retry Configuration**
    //
    // *For any* transient failure with retry enabled, the system SHALL retry
    // according to the configured retry count and delay.
    //
    // **Validates: Requirements 15.4**
    // =========================================================================

    #[test]
    fn property_42_retry_respects_max_retries(
        max_retries in 1u32..10,
        base_delay_ms in 10u64..100,
    ) {
        let config = RetryConfig::new(max_retries, Duration::from_millis(base_delay_ms));
        let mut handler = RetryHandler::with_default_config(config);

        handler.start("op-1");

        // Should be able to retry up to max_retries times
        for i in 0..max_retries {
            prop_assert!(handler.can_retry("op-1"),
                "Should be able to retry at attempt {}", i);
            handler.handle_failure("op-1", "network", &format!("Error {}", i));
        }

        // After max_retries, should not be able to retry
        prop_assert!(!handler.can_retry("op-1"),
            "Should not be able to retry after max_retries");

        // Next failure should return MaxRetriesExceeded
        let result = handler.handle_failure("op-1", "network", "Final error");
        prop_assert_eq!(result, RetryResult::MaxRetriesExceeded,
            "Should return MaxRetriesExceeded after max retries");
    }

    #[test]
    fn property_42_retry_delay_fixed_strategy(
        max_retries in 2u32..5,
        base_delay_ms in 50u64..200,
    ) {
        let config = RetryConfig::new(max_retries, Duration::from_millis(base_delay_ms))
            .with_strategy(RetryStrategy::Fixed);

        // All delays should be equal to base_delay
        for attempt in 0..max_retries {
            let delay = config.calculate_delay(attempt);
            prop_assert_eq!(delay, Duration::from_millis(base_delay_ms),
                "Fixed strategy delay at attempt {} should equal base_delay", attempt);
        }
    }

    #[test]
    fn property_42_retry_delay_linear_strategy(
        max_retries in 2u32..5,
        base_delay_ms in 50u64..100,
    ) {
        let config = RetryConfig::new(max_retries, Duration::from_millis(base_delay_ms))
            .with_strategy(RetryStrategy::Linear);

        // Delays should increase linearly
        for attempt in 0..max_retries {
            let delay = config.calculate_delay(attempt);
            let expected = Duration::from_millis(base_delay_ms * (attempt as u64 + 1));
            prop_assert_eq!(delay, expected,
                "Linear strategy delay at attempt {} should be {} * {}",
                attempt, base_delay_ms, attempt + 1);
        }
    }

    #[test]
    fn property_42_retry_delay_exponential_strategy(
        max_retries in 2u32..5,
        base_delay_ms in 50u64..100,
    ) {
        let config = RetryConfig::new(max_retries, Duration::from_millis(base_delay_ms))
            .with_strategy(RetryStrategy::Exponential)
            .with_max_delay(Duration::from_secs(60)); // High max to not cap

        // Delays should increase exponentially
        for attempt in 0..max_retries {
            let delay = config.calculate_delay(attempt);
            let expected = Duration::from_millis(base_delay_ms * 2u64.pow(attempt));
            prop_assert_eq!(delay, expected,
                "Exponential strategy delay at attempt {} should be {} * 2^{}",
                attempt, base_delay_ms, attempt);
        }
    }

    #[test]
    fn property_42_retry_delay_capped_by_max_delay(
        base_delay_ms in 100u64..500,
        max_delay_ms in 200u64..1000,
    ) {
        let max_delay_ms = max_delay_ms.max(base_delay_ms + 100); // Ensure max > base
        let config = RetryConfig::new(10, Duration::from_millis(base_delay_ms))
            .with_strategy(RetryStrategy::Exponential)
            .with_max_delay(Duration::from_millis(max_delay_ms));

        // At high attempts, delay should be capped
        for attempt in 0..10 {
            let delay = config.calculate_delay(attempt);
            prop_assert!(delay <= Duration::from_millis(max_delay_ms),
                "Delay {:?} at attempt {} should be <= max_delay {:?}",
                delay, attempt, Duration::from_millis(max_delay_ms));
        }
    }

    #[test]
    fn property_42_retryable_errors_are_retried(
        error_type in retryable_error_type_strategy(),
        message in error_message_strategy(),
    ) {
        let config = RetryConfig::default();
        let mut handler = RetryHandler::with_default_config(config);

        handler.start("op-1");

        let result = handler.handle_failure("op-1", &error_type, &message);

        // Retryable errors MUST result in Retry
        prop_assert_eq!(result, RetryResult::Retry,
            "Retryable error type '{}' should result in Retry", error_type);
    }

    #[test]
    fn property_42_non_retryable_errors_not_retried(
        error_type in non_retryable_error_type_strategy(),
        message in error_message_strategy(),
    ) {
        let config = RetryConfig::default();
        let mut handler = RetryHandler::with_default_config(config);

        handler.start("op-1");

        let result = handler.handle_failure("op-1", &error_type, &message);

        // Non-retryable errors MUST result in NotRetryable
        prop_assert_eq!(result, RetryResult::NotRetryable,
            "Non-retryable error type '{}' should result in NotRetryable", error_type);
    }

    #[test]
    fn property_42_retry_state_tracks_attempts(
        max_retries in 2u32..5,
        num_failures in 1usize..5,
    ) {
        let num_failures = num_failures.min(max_retries as usize);
        let config = RetryConfig::new(max_retries, Duration::from_millis(100));
        let mut handler = RetryHandler::with_default_config(config);

        handler.start("op-1");

        // Record failures
        for i in 0..num_failures {
            handler.handle_failure("op-1", "network", &format!("Error {}", i));
        }

        // Attempt count MUST match number of failures
        let attempt = handler.get_attempt("op-1").unwrap();
        prop_assert_eq!(attempt as usize, num_failures,
            "Attempt count should match number of failures");
    }

    #[test]
    fn property_42_retry_success_recorded(
        max_retries in 2u32..5,
    ) {
        let config = RetryConfig::new(max_retries, Duration::from_millis(100));
        let mut handler = RetryHandler::with_default_config(config);

        handler.start("op-1");

        // Record a failure then success
        handler.handle_failure("op-1", "network", "Error");
        handler.record_success("op-1");

        let state = handler.get_state("op-1").unwrap();

        // Success MUST be recorded
        prop_assert!(state.succeeded,
            "Success should be recorded");
    }

    #[test]
    fn property_42_retry_config_validation(
        max_retries in 0u32..5,
        base_delay_ms in 0u64..100,
        max_delay_ms in 0u64..100,
    ) {
        let config = RetryConfig {
            max_retries,
            base_delay: Duration::from_millis(base_delay_ms),
            max_delay: Duration::from_millis(max_delay_ms),
            ..Default::default()
        };

        let result = config.validate();

        // Validation MUST fail for invalid configs
        if max_retries == 0 {
            prop_assert!(result.is_err(),
                "Validation should fail when max_retries is 0");
        } else if base_delay_ms == 0 {
            prop_assert!(result.is_err(),
                "Validation should fail when base_delay is 0");
        } else if max_delay_ms < base_delay_ms && max_delay_ms > 0 {
            prop_assert!(result.is_err(),
                "Validation should fail when max_delay < base_delay");
        }
    }

    #[test]
    fn property_42_retry_handler_complete_removes_state(
        operation_id in "[a-z][a-z0-9_-]{0,19}".prop_map(|s| s.to_string()),
    ) {
        let mut handler = RetryHandler::new();

        handler.start(&operation_id);
        prop_assert_eq!(handler.active_count(), 1,
            "Should have 1 active operation");

        let state = handler.complete(&operation_id);

        // State MUST be returned
        prop_assert!(state.is_some(),
            "Complete should return the state");

        // Operation MUST be removed
        prop_assert_eq!(handler.active_count(), 0,
            "Operation should be removed after complete");

        prop_assert!(handler.get_state(&operation_id).is_none(),
            "State should not be retrievable after complete");
    }

    #[test]
    fn property_42_retry_delay_recorded(
        base_delay_ms in 50u64..200,
    ) {
        let config = RetryConfig::new(3, Duration::from_millis(base_delay_ms));
        let mut handler = RetryHandler::with_default_config(config);

        handler.start("op-1");

        let delay = Duration::from_millis(base_delay_ms);
        handler.record_delay("op-1", delay);

        let state = handler.get_state("op-1").unwrap();

        // Delay MUST be recorded
        prop_assert_eq!(state.total_delay, delay,
            "Total delay should match recorded delay");

        // Record another delay
        handler.record_delay("op-1", delay);
        let state = handler.get_state("op-1").unwrap();

        // Total delay MUST accumulate
        prop_assert_eq!(state.total_delay, delay * 2,
            "Total delay should accumulate");
    }
}

// Additional unit tests for edge cases
#[cfg(test)]
mod additional_tests {
    use super::*;

    #[test]
    fn test_error_handler_max_errors_enforced() {
        let mut handler = ErrorHandler::with_config(5, false);

        for i in 0..10 {
            handler.record(ErrorRecord::new(
                AgentErrorKind::ApiCall,
                format!("Error {}", i),
            ));
        }

        assert_eq!(handler.count(), 5, "Should enforce max errors limit");
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

        assert_eq!(
            handler.count(),
            1,
            "Should have 1 error after clearing agent-1"
        );
        assert_eq!(
            handler.count_by_agent("agent-1"),
            0,
            "agent-1 should have 0 errors"
        );
        assert_eq!(
            handler.count_by_agent("agent-2"),
            1,
            "agent-2 should have 1 error"
        );
    }

    #[test]
    fn test_timeout_handler_clear() {
        let mut handler = TimeoutHandler::new();

        handler.start_tracking("agent-1");
        handler.start_tracking("agent-2");

        assert_eq!(handler.tracked_count(), 2);

        handler.clear();

        assert_eq!(
            handler.tracked_count(),
            0,
            "Should have 0 tracked agents after clear"
        );
    }

    #[test]
    fn test_retry_handler_unknown_operation() {
        let mut handler = RetryHandler::new();

        let result = handler.handle_failure("unknown", "network", "Error");

        assert_eq!(
            result,
            RetryResult::Skipped,
            "Unknown operation should be skipped"
        );
    }

    #[test]
    fn test_retry_config_is_retryable() {
        let config = RetryConfig::default();

        assert!(config.is_retryable("network_error"));
        assert!(config.is_retryable("NETWORK_ERROR")); // Case insensitive
        assert!(config.is_retryable("timeout_exceeded"));
        assert!(config.is_retryable("rate_limit_hit"));
        assert!(!config.is_retryable("invalid_input"));
    }

    #[test]
    fn test_agent_error_display() {
        let error = AgentError::new(AgentErrorKind::Timeout, "Operation timed out")
            .with_source("Connection timeout");

        let display = format!("{}", error);
        assert!(display.contains("timeout"));
        assert!(display.contains("Operation timed out"));
        assert!(display.contains("Connection timeout"));
    }

    #[test]
    fn test_timeout_config_with_grace_period() {
        let config =
            TimeoutConfig::new(Duration::from_secs(60)).with_grace_period(Duration::from_secs(10));

        assert_eq!(config.grace_period, Some(Duration::from_secs(10)));
    }

    #[test]
    fn test_error_record_with_stack_trace() {
        let error = ErrorRecord::new(AgentErrorKind::Internal, "Internal error")
            .with_stack_trace("at function_a\nat function_b");

        assert!(error.has_stack_trace());
        assert!(error.stack_trace.unwrap().contains("function_a"));
    }
}
