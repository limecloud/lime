//! Property-based tests for Agent Monitor
//!
//! These tests verify the correctness properties defined in the design document
//! for the agent monitoring system.

use proptest::prelude::*;
use std::time::Duration;

use super::alerts::AgentExecutionStatus;
#[allow(unused_imports)]
use super::metrics::{AgentMonitor, FullAgentMetrics, MonitorConfig, ToolCallMetric};

/// Strategy for generating valid agent IDs
fn agent_id_strategy() -> impl Strategy<Value = String> {
    "[a-z][a-z0-9_-]{0,19}".prop_map(|s| s.to_string())
}

/// Strategy for generating valid agent types
fn agent_type_strategy() -> impl Strategy<Value = String> {
    prop_oneof![
        Just("explore".to_string()),
        Just("plan".to_string()),
        Just("code".to_string()),
        Just("test".to_string()),
        Just("review".to_string()),
    ]
}

/// Strategy for generating valid tool names
fn tool_name_strategy() -> impl Strategy<Value = String> {
    prop_oneof![
        Just("read_file".to_string()),
        Just("write_file".to_string()),
        Just("execute_bash".to_string()),
        Just("search_code".to_string()),
        Just("list_directory".to_string()),
    ]
}

/// Strategy for generating token counts
fn token_count_strategy() -> impl Strategy<Value = (usize, usize)> {
    (0usize..10000, 0usize..5000)
}

/// Strategy for generating cost values
fn cost_strategy() -> impl Strategy<Value = f64> {
    (0.0f64..10.0).prop_map(|c| (c * 10000.0).round() / 10000.0)
}

/// Strategy for generating API call results
fn api_call_strategy() -> impl Strategy<Value = (bool, Option<Duration>)> {
    (
        any::<bool>(),
        prop_oneof![
            Just(None),
            (1u64..1000).prop_map(|ms| Some(Duration::from_millis(ms))),
        ],
    )
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    // **Property 26: Metric Tracking Consistency**
    //
    // *For any* tracked agent, all recorded metrics (duration, tokens, API calls, tool calls, cost, errors)
    // SHALL be accurately reflected in the final metrics.
    //
    // **Validates: Requirements 8.1, 8.2, 8.3, 8.5, 8.6**

    #[test]
    fn property_26_token_tracking_consistency(
        agent_id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
        token_records in prop::collection::vec(token_count_strategy(), 1..10),
    ) {
        let mut monitor = AgentMonitor::new(None);
        monitor.start_tracking(&agent_id, &agent_type, None);

        let mut expected_input = 0usize;
        let mut expected_output = 0usize;

        for (input, output) in &token_records {
            monitor.record_tokens(&agent_id, *input, *output);
            expected_input += input;
            expected_output += output;
        }

        let metrics = monitor.get_metrics(&agent_id).unwrap();

        // Token counts should match exactly
        prop_assert_eq!(metrics.tokens_used.input, expected_input,
            "Input tokens mismatch: expected {}, got {}", expected_input, metrics.tokens_used.input);
        prop_assert_eq!(metrics.tokens_used.output, expected_output,
            "Output tokens mismatch: expected {}, got {}", expected_output, metrics.tokens_used.output);
        prop_assert_eq!(metrics.tokens_used.total, expected_input + expected_output,
            "Total tokens mismatch");
    }

    #[test]
    fn property_26_api_call_tracking_consistency(
        agent_id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
        api_calls in prop::collection::vec(api_call_strategy(), 1..20),
    ) {
        let mut monitor = AgentMonitor::new(None);
        monitor.start_tracking(&agent_id, &agent_type, None);

        let mut expected_total = 0usize;
        let mut expected_successful = 0usize;

        for (success, latency) in &api_calls {
            monitor.record_api_call(&agent_id, *success, *latency);
            expected_total += 1;
            if *success {
                expected_successful += 1;
            }
        }

        let metrics = monitor.get_metrics(&agent_id).unwrap();

        // API call counts should match exactly
        prop_assert_eq!(metrics.api_calls, expected_total,
            "Total API calls mismatch: expected {}, got {}", expected_total, metrics.api_calls);
        prop_assert_eq!(metrics.api_calls_successful, expected_successful,
            "Successful API calls mismatch: expected {}, got {}", expected_successful, metrics.api_calls_successful);

        // Error rate should be calculated correctly
        let expected_error_rate = if expected_total > 0 {
            (expected_total - expected_successful) as f32 / expected_total as f32
        } else {
            0.0
        };
        let actual_error_rate = metrics.error_rate();
        prop_assert!((actual_error_rate - expected_error_rate).abs() < 0.001,
            "Error rate mismatch: expected {}, got {}", expected_error_rate, actual_error_rate);
    }

    #[test]
    fn property_26_cost_tracking_consistency(
        agent_id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
        costs in prop::collection::vec(cost_strategy(), 1..10),
    ) {
        let mut monitor = AgentMonitor::new(None);
        monitor.start_tracking(&agent_id, &agent_type, None);

        let mut expected_cost = 0.0f64;

        for cost in &costs {
            monitor.record_cost(&agent_id, *cost);
            expected_cost += cost;
        }

        let metrics = monitor.get_metrics(&agent_id).unwrap();

        // Cost should match (with floating point tolerance)
        prop_assert!((metrics.cost - expected_cost).abs() < 0.0001,
            "Cost mismatch: expected {}, got {}", expected_cost, metrics.cost);
    }

    #[test]
    fn property_26_tool_call_tracking_consistency(
        agent_id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
        tool_calls in prop::collection::vec(
            (tool_name_strategy(), any::<bool>(), 0usize..1000, 0usize..2000),
            1..10
        ),
    ) {
        let mut monitor = AgentMonitor::new(None);
        monitor.start_tracking(&agent_id, &agent_type, None);

        let mut expected_count = 0usize;
        let mut expected_successful = 0usize;

        for (tool_name, success, input_size, output_size) in &tool_calls {
            let tool_call_id = monitor.start_tool_call(&agent_id, tool_name, Some(*input_size));
            monitor.end_tool_call(&agent_id, &tool_call_id, *success, None, Some(*output_size));
            expected_count += 1;
            if *success {
                expected_successful += 1;
            }
        }

        let metrics = monitor.get_metrics(&agent_id).unwrap();

        // Tool call count should match
        prop_assert_eq!(metrics.tool_calls.len(), expected_count,
            "Tool call count mismatch: expected {}, got {}", expected_count, metrics.tool_calls.len());

        // Successful tool calls should match
        let actual_successful = metrics.tool_calls.iter().filter(|t| t.success).count();
        prop_assert_eq!(actual_successful, expected_successful,
            "Successful tool calls mismatch: expected {}, got {}", expected_successful, actual_successful);
    }

    #[test]
    fn property_26_error_tracking_consistency(
        agent_id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
        errors in prop::collection::vec(
            ("[a-zA-Z ]{1,50}".prop_map(|s| s.to_string()), prop_oneof![Just(None), Just(Some("api_call")), Just(Some("tool_call"))]),
            1..10
        ),
    ) {
        let mut monitor = AgentMonitor::new(None);
        monitor.start_tracking(&agent_id, &agent_type, None);

        for (error_msg, phase) in &errors {
            monitor.record_error(&agent_id, error_msg, *phase);
        }

        let metrics = monitor.get_metrics(&agent_id).unwrap();

        // Error count should match
        prop_assert_eq!(metrics.errors.len(), errors.len(),
            "Error count mismatch: expected {}, got {}", errors.len(), metrics.errors.len());

        // Each error should have the correct message
        for (i, (expected_msg, expected_phase)) in errors.iter().enumerate() {
            prop_assert_eq!(&metrics.errors[i].message, expected_msg,
                "Error message mismatch at index {}", i);
            prop_assert_eq!(metrics.errors[i].phase.as_deref(), *expected_phase,
                "Error phase mismatch at index {}", i);
        }
    }

    #[test]
    fn property_26_aggregated_stats_consistency(
        agents in prop::collection::vec(
            (agent_id_strategy(), agent_type_strategy(), token_count_strategy(), cost_strategy()),
            1..5
        ),
    ) {
        let mut monitor = AgentMonitor::new(None);

        let mut expected_total_tokens = 0usize;
        let mut expected_total_cost = 0.0f64;
        let mut expected_completed = 0usize;
        let mut expected_failed = 0usize;

        for (i, (agent_id, agent_type, (input, output), cost)) in agents.iter().enumerate() {
            let unique_id = format!("{}_{}", agent_id, i);
            monitor.start_tracking(&unique_id, agent_type, None);
            monitor.record_tokens(&unique_id, *input, *output);
            monitor.record_cost(&unique_id, *cost);

            expected_total_tokens += input + output;
            expected_total_cost += cost;

            // Alternate between completed and failed
            if i % 2 == 0 {
                monitor.stop_tracking(&unique_id, AgentExecutionStatus::Completed);
                expected_completed += 1;
            } else {
                monitor.stop_tracking(&unique_id, AgentExecutionStatus::Failed);
                expected_failed += 1;
            }
        }

        let stats = monitor.get_aggregated_stats();

        prop_assert_eq!(stats.total_agents, agents.len(),
            "Total agents mismatch");
        prop_assert_eq!(stats.completed_agents, expected_completed,
            "Completed agents mismatch");
        prop_assert_eq!(stats.failed_agents, expected_failed,
            "Failed agents mismatch");
        prop_assert_eq!(stats.total_tokens, expected_total_tokens,
            "Total tokens mismatch");
        prop_assert!((stats.total_cost - expected_total_cost).abs() < 0.001,
            "Total cost mismatch: expected {}, got {}", expected_total_cost, stats.total_cost);
    }

    #[test]
    fn property_26_status_tracking_consistency(
        agent_id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
        final_status in prop_oneof![
            Just(AgentExecutionStatus::Completed),
            Just(AgentExecutionStatus::Failed),
            Just(AgentExecutionStatus::Cancelled),
            Just(AgentExecutionStatus::TimedOut),
        ],
    ) {
        let mut monitor = AgentMonitor::new(None);
        monitor.start_tracking(&agent_id, &agent_type, None);

        // Initially should be running
        let metrics = monitor.get_metrics(&agent_id).unwrap();
        prop_assert_eq!(metrics.status, AgentExecutionStatus::Running,
            "Initial status should be Running");

        // Stop tracking with final status
        monitor.stop_tracking(&agent_id, final_status);

        let metrics = monitor.get_metrics(&agent_id).unwrap();
        prop_assert_eq!(metrics.status, final_status,
            "Final status mismatch: expected {:?}, got {:?}", final_status, metrics.status);

        // End time should be set
        prop_assert!(metrics.end_time.is_some(),
            "End time should be set after stopping");

        // Duration should be set
        prop_assert!(metrics.duration.is_some(),
            "Duration should be set after stopping");
    }
}

// Additional unit tests for edge cases
#[cfg(test)]
mod additional_tests {
    use super::*;

    #[test]
    fn test_tool_call_with_disabled_tracking() {
        let config = MonitorConfig {
            track_tool_calls: false,
            ..Default::default()
        };
        let mut monitor = AgentMonitor::new(Some(config));
        monitor.start_tracking("agent-1", "test", None);

        let tool_call_id = monitor.start_tool_call("agent-1", "test_tool", Some(100));

        // Should return empty string when tracking is disabled
        assert!(tool_call_id.is_empty());
        assert_eq!(monitor.active_tool_call_count(), 0);
    }

    #[test]
    fn test_api_latency_with_disabled_tracking() {
        let config = MonitorConfig {
            track_api_latencies: false,
            ..Default::default()
        };
        let mut monitor = AgentMonitor::new(Some(config));
        monitor.start_tracking("agent-1", "test", None);

        monitor.record_api_call("agent-1", true, Some(Duration::from_millis(100)));
        monitor.stop_tracking("agent-1", AgentExecutionStatus::Completed);

        let metrics = monitor.get_metrics("agent-1").unwrap();

        // API call should be recorded but latency should not affect performance metrics
        assert_eq!(metrics.api_calls, 1);
    }

    #[test]
    fn test_multiple_agents_isolation() {
        let mut monitor = AgentMonitor::new(None);

        monitor.start_tracking("agent-1", "type-a", None);
        monitor.start_tracking("agent-2", "type-b", None);

        monitor.record_tokens("agent-1", 100, 50);
        monitor.record_tokens("agent-2", 200, 100);

        monitor.record_cost("agent-1", 0.5);
        monitor.record_cost("agent-2", 1.0);

        let metrics1 = monitor.get_metrics("agent-1").unwrap();
        let metrics2 = monitor.get_metrics("agent-2").unwrap();

        // Metrics should be isolated
        assert_eq!(metrics1.tokens_used.total, 150);
        assert_eq!(metrics2.tokens_used.total, 300);
        assert!((metrics1.cost - 0.5).abs() < 0.001);
        assert!((metrics2.cost - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_tool_call_agent_mismatch() {
        let mut monitor = AgentMonitor::new(None);

        monitor.start_tracking("agent-1", "test", None);
        monitor.start_tracking("agent-2", "test", None);

        let tool_call_id = monitor.start_tool_call("agent-1", "test_tool", None);

        // Try to end with wrong agent ID
        monitor.end_tool_call("agent-2", &tool_call_id, true, None, None);

        // Tool call should still be active (not ended)
        assert_eq!(monitor.active_tool_call_count(), 1);

        // End with correct agent ID
        monitor.end_tool_call("agent-1", &tool_call_id, true, None, None);
        assert_eq!(monitor.active_tool_call_count(), 0);
    }

    #[test]
    fn test_nonexistent_agent_operations() {
        let mut monitor = AgentMonitor::new(None);

        // These should not panic, just do nothing
        monitor.record_tokens("nonexistent", 100, 50);
        monitor.record_api_call("nonexistent", true, None);
        monitor.record_cost("nonexistent", 0.5);
        monitor.record_error("nonexistent", "error", None);
        monitor.stop_tracking("nonexistent", AgentExecutionStatus::Completed);

        assert_eq!(monitor.agent_count(), 0);
    }
}

// Property 27 tests for metric persistence round-trip
#[cfg(test)]
mod persistence_tests {
    use super::*;
    #[allow(unused_imports)]
    use std::path::PathBuf;
    use tempfile::TempDir;

    /// Helper to create a monitor with a temp directory
    fn create_monitor_with_temp_dir() -> (AgentMonitor, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let config = MonitorConfig {
            metrics_dir: Some(temp_dir.path().to_path_buf()),
            ..Default::default()
        };
        let monitor = AgentMonitor::new(Some(config));
        (monitor, temp_dir)
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(50))]

        // **Property 27: Metric Persistence Round-Trip**
        //
        // *For any* agent metrics, persisting to disk and loading back
        // SHALL produce equivalent metrics.
        //
        // **Validates: Requirements 8.4**

        #[test]
        fn property_27_metrics_persistence_round_trip(
            agent_id in agent_id_strategy(),
            agent_type in agent_type_strategy(),
            (input_tokens, output_tokens) in token_count_strategy(),
            cost in cost_strategy(),
            api_calls in 0usize..20,
            api_successful in 0usize..20,
        ) {
            let (mut monitor, _temp_dir) = create_monitor_with_temp_dir();

            // Create and populate metrics
            monitor.start_tracking(&agent_id, &agent_type, Some("Test description"));
            monitor.record_tokens(&agent_id, input_tokens, output_tokens);
            monitor.record_cost(&agent_id, cost);

            // Record API calls
            let actual_successful = api_successful.min(api_calls);
            for i in 0..api_calls {
                let success = i < actual_successful;
                monitor.record_api_call(&agent_id, success, Some(Duration::from_millis(100)));
            }

            monitor.stop_tracking(&agent_id, AgentExecutionStatus::Completed);

            // Persist metrics
            let persist_result = monitor.persist_metrics(&agent_id);
            prop_assert!(persist_result.is_ok(), "Failed to persist metrics: {:?}", persist_result.err());

            // Get original metrics for comparison
            let original = monitor.get_metrics(&agent_id).unwrap().clone();

            // Remove from memory
            monitor.remove_metrics(&agent_id);
            prop_assert!(monitor.get_metrics(&agent_id).is_none(), "Metrics should be removed");

            // Load back from disk
            let load_result = monitor.load_metrics(&agent_id);
            prop_assert!(load_result.is_ok(), "Failed to load metrics: {:?}", load_result.err());

            let loaded = monitor.get_metrics(&agent_id);
            prop_assert!(loaded.is_some(), "Loaded metrics should exist");

            let loaded = loaded.unwrap();

            // Verify all fields match
            prop_assert_eq!(&loaded.agent_id, &original.agent_id, "agent_id mismatch");
            prop_assert_eq!(&loaded.agent_type, &original.agent_type, "agent_type mismatch");
            prop_assert_eq!(&loaded.description, &original.description, "description mismatch");
            prop_assert_eq!(loaded.status, original.status, "status mismatch");
            prop_assert_eq!(loaded.tokens_used.input, original.tokens_used.input, "input tokens mismatch");
            prop_assert_eq!(loaded.tokens_used.output, original.tokens_used.output, "output tokens mismatch");
            prop_assert_eq!(loaded.tokens_used.total, original.tokens_used.total, "total tokens mismatch");
            prop_assert_eq!(loaded.api_calls, original.api_calls, "api_calls mismatch");
            prop_assert_eq!(loaded.api_calls_successful, original.api_calls_successful, "api_calls_successful mismatch");
            prop_assert!((loaded.cost - original.cost).abs() < 0.0001, "cost mismatch");
            prop_assert_eq!(loaded.errors.len(), original.errors.len(), "errors count mismatch");
        }

        #[test]
        fn property_27_tool_calls_persistence_round_trip(
            agent_id in agent_id_strategy(),
            agent_type in agent_type_strategy(),
            tool_calls in prop::collection::vec(
                (tool_name_strategy(), any::<bool>(), 0usize..500, 0usize..1000),
                1..5
            ),
        ) {
            let (mut monitor, _temp_dir) = create_monitor_with_temp_dir();

            monitor.start_tracking(&agent_id, &agent_type, None);

            // Record tool calls
            for (tool_name, success, input_size, output_size) in &tool_calls {
                let tool_call_id = monitor.start_tool_call(&agent_id, tool_name, Some(*input_size));
                let error = if *success { None } else { Some("Test error") };
                monitor.end_tool_call(&agent_id, &tool_call_id, *success, error, Some(*output_size));
            }

            monitor.stop_tracking(&agent_id, AgentExecutionStatus::Completed);

            // Persist
            monitor.persist_metrics(&agent_id).unwrap();

            // Get original
            let original = monitor.get_metrics(&agent_id).unwrap().clone();

            // Remove and reload
            monitor.remove_metrics(&agent_id);
            monitor.load_metrics(&agent_id).unwrap();

            let loaded = monitor.get_metrics(&agent_id).unwrap();

            // Verify tool calls
            prop_assert_eq!(loaded.tool_calls.len(), original.tool_calls.len(),
                "Tool calls count mismatch");

            for (i, (loaded_tc, original_tc)) in loaded.tool_calls.iter().zip(original.tool_calls.iter()).enumerate() {
                prop_assert_eq!(&loaded_tc.tool_name, &original_tc.tool_name,
                    "Tool name mismatch at index {}", i);
                prop_assert_eq!(loaded_tc.success, original_tc.success,
                    "Tool success mismatch at index {}", i);
                prop_assert_eq!(loaded_tc.input_size, original_tc.input_size,
                    "Tool input_size mismatch at index {}", i);
                prop_assert_eq!(loaded_tc.output_size, original_tc.output_size,
                    "Tool output_size mismatch at index {}", i);
                prop_assert_eq!(&loaded_tc.error, &original_tc.error,
                    "Tool error mismatch at index {}", i);
            }
        }

        #[test]
        fn property_27_errors_persistence_round_trip(
            agent_id in agent_id_strategy(),
            agent_type in agent_type_strategy(),
            errors in prop::collection::vec(
                ("[a-zA-Z0-9 ]{1,30}".prop_map(|s| s.to_string()),
                 prop_oneof![Just(None), Just(Some("api")), Just(Some("tool"))]),
                1..5
            ),
        ) {
            let (mut monitor, _temp_dir) = create_monitor_with_temp_dir();

            monitor.start_tracking(&agent_id, &agent_type, None);

            // Record errors
            for (error_msg, phase) in &errors {
                monitor.record_error(&agent_id, error_msg, *phase);
            }

            monitor.stop_tracking(&agent_id, AgentExecutionStatus::Failed);

            // Persist
            monitor.persist_metrics(&agent_id).unwrap();

            // Get original
            let original = monitor.get_metrics(&agent_id).unwrap().clone();

            // Remove and reload
            monitor.remove_metrics(&agent_id);
            monitor.load_metrics(&agent_id).unwrap();

            let loaded = monitor.get_metrics(&agent_id).unwrap();

            // Verify errors
            prop_assert_eq!(loaded.errors.len(), original.errors.len(),
                "Errors count mismatch");

            for (i, (loaded_err, original_err)) in loaded.errors.iter().zip(original.errors.iter()).enumerate() {
                prop_assert_eq!(&loaded_err.message, &original_err.message,
                    "Error message mismatch at index {}", i);
                prop_assert_eq!(&loaded_err.phase, &original_err.phase,
                    "Error phase mismatch at index {}", i);
            }
        }
    }

    // Additional persistence tests
    #[test]
    fn test_list_persisted_metrics() {
        let (mut monitor, _temp_dir) = create_monitor_with_temp_dir();

        // Create and persist multiple agents
        for i in 0..3 {
            let agent_id = format!("agent-{}", i);
            monitor.start_tracking(&agent_id, "test", None);
            monitor.stop_tracking(&agent_id, AgentExecutionStatus::Completed);
            monitor.persist_metrics(&agent_id).unwrap();
        }

        let persisted = monitor.list_persisted_metrics().unwrap();
        assert_eq!(persisted.len(), 3);
        assert!(persisted.contains(&"agent-0".to_string()));
        assert!(persisted.contains(&"agent-1".to_string()));
        assert!(persisted.contains(&"agent-2".to_string()));
    }

    #[test]
    fn test_delete_persisted_metrics() {
        let (mut monitor, _temp_dir) = create_monitor_with_temp_dir();

        monitor.start_tracking("agent-1", "test", None);
        monitor.stop_tracking("agent-1", AgentExecutionStatus::Completed);
        monitor.persist_metrics("agent-1").unwrap();

        // Verify it exists
        let persisted = monitor.list_persisted_metrics().unwrap();
        assert!(persisted.contains(&"agent-1".to_string()));

        // Delete it
        let deleted = monitor.delete_persisted_metrics("agent-1").unwrap();
        assert!(deleted);

        // Verify it's gone
        let persisted = monitor.list_persisted_metrics().unwrap();
        assert!(!persisted.contains(&"agent-1".to_string()));

        // Deleting again should return false
        let deleted = monitor.delete_persisted_metrics("agent-1").unwrap();
        assert!(!deleted);
    }

    #[test]
    fn test_load_nonexistent_metrics() {
        let (mut monitor, _temp_dir) = create_monitor_with_temp_dir();

        let result = monitor.load_metrics("nonexistent");
        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    #[test]
    fn test_persist_without_tracking() {
        let (monitor, _temp_dir) = create_monitor_with_temp_dir();

        // Should not fail, just do nothing
        let result = monitor.persist_metrics("nonexistent");
        assert!(result.is_ok());
    }

    #[test]
    fn test_auto_persist_on_stop() {
        let temp_dir = TempDir::new().unwrap();
        let config = MonitorConfig {
            auto_persist: true,
            metrics_dir: Some(temp_dir.path().to_path_buf()),
            ..Default::default()
        };
        let mut monitor = AgentMonitor::new(Some(config));

        monitor.start_tracking("agent-1", "test", None);
        monitor.record_tokens("agent-1", 100, 50);
        monitor.stop_tracking("agent-1", AgentExecutionStatus::Completed);

        // Should be auto-persisted
        let persisted = monitor.list_persisted_metrics().unwrap();
        assert!(persisted.contains(&"agent-1".to_string()));
    }
}
