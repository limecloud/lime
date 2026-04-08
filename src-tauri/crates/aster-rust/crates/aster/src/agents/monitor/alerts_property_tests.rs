//! Property-based tests for Alert Manager
//!
//! These tests verify the correctness properties defined in the design document
//! for the alert management system.

use proptest::prelude::*;
use std::time::Duration;

#[allow(unused_imports)]
use super::alerts::{
    AgentExecutionStatus, AgentMetrics, Alert, AlertManager, AlertSeverity, AlertThresholds,
    AlertType,
};

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

/// Strategy for generating timeout scenarios
/// Returns (duration_secs, timeout_secs) where duration > timeout
fn timeout_exceeded_strategy() -> impl Strategy<Value = (u64, u64)> {
    (1u64..100, 1u64..50).prop_filter_map("duration must exceed timeout", |(dur, timeout)| {
        if dur > timeout {
            Some((dur, timeout))
        } else {
            Some((timeout + dur, timeout))
        }
    })
}

/// Strategy for generating timeout scenarios where timeout is NOT exceeded
fn timeout_not_exceeded_strategy() -> impl Strategy<Value = (u64, u64)> {
    (1u64..50, 50u64..200).prop_map(|(dur, timeout)| (dur, timeout))
}

/// Strategy for generating cost scenarios where threshold is exceeded
fn cost_exceeded_strategy() -> impl Strategy<Value = (f64, f64)> {
    (0.01f64..10.0, 0.01f64..5.0).prop_filter_map(
        "cost must exceed threshold",
        |(cost, threshold)| {
            if cost > threshold {
                Some((cost, threshold))
            } else {
                Some((threshold + cost, threshold))
            }
        },
    )
}

/// Strategy for generating cost scenarios where threshold is NOT exceeded
fn cost_not_exceeded_strategy() -> impl Strategy<Value = (f64, f64)> {
    (0.01f64..5.0, 5.0f64..20.0).prop_map(|(cost, threshold)| (cost, threshold))
}

/// Strategy for generating error rate scenarios where threshold is exceeded
/// Returns (total_calls, successful_calls, threshold) where error_rate > threshold
fn error_rate_exceeded_strategy() -> impl Strategy<Value = (usize, usize, f32)> {
    (10usize..100, 0usize..100, 0.01f32..0.5).prop_filter_map(
        "error rate must exceed threshold",
        |(total, successful, threshold)| {
            let successful = successful.min(total);
            let error_rate = (total - successful) as f32 / total as f32;
            if error_rate > threshold {
                Some((total, successful, threshold))
            } else {
                // Adjust to ensure error rate exceeds threshold
                let max_successful = ((1.0 - threshold - 0.01) * total as f32) as usize;
                if max_successful < total {
                    Some((total, max_successful, threshold))
                } else {
                    None
                }
            }
        },
    )
}

/// Strategy for generating error rate scenarios where threshold is NOT exceeded
fn error_rate_not_exceeded_strategy() -> impl Strategy<Value = (usize, usize, f32)> {
    (10usize..100, 0usize..100, 0.5f32..0.99).prop_filter_map(
        "error rate must not exceed threshold",
        |(total, successful, threshold)| {
            let successful = successful.min(total);
            let error_rate = (total - successful) as f32 / total as f32;
            if error_rate <= threshold {
                Some((total, successful, threshold))
            } else {
                // Adjust to ensure error rate does not exceed threshold
                let min_successful = ((1.0 - threshold + 0.01) * total as f32).ceil() as usize;
                let min_successful = min_successful.min(total);
                Some((total, min_successful, threshold))
            }
        },
    )
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(50))]

    // **Property 28: Alert Threshold Triggering**
    //
    // *For any* agent exceeding configured thresholds (timeout, cost, error rate, latency),
    // an alert with appropriate severity SHALL be created.
    //
    // **Validates: Requirements 9.1, 9.2, 9.5**

    #[test]
    fn property_28_timeout_alert_triggered_when_exceeded(
        agent_id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
        (duration_secs, timeout_secs) in timeout_exceeded_strategy(),
    ) {
        let mut manager = AlertManager::new();

        let mut metrics = AgentMetrics::new(&agent_id, &agent_type);
        metrics.timeout = Some(Duration::from_secs(timeout_secs));
        metrics.duration = Some(Duration::from_secs(duration_secs));

        let alert = manager.check_timeout(&metrics);

        // Alert MUST be created when timeout is exceeded
        prop_assert!(alert.is_some(),
            "Alert should be created when duration ({:?}) exceeds timeout ({:?})",
            Duration::from_secs(duration_secs), Duration::from_secs(timeout_secs));

        let alert = alert.unwrap();

        // Alert type must be Timeout
        prop_assert_eq!(alert.alert_type, AlertType::Timeout,
            "Alert type should be Timeout");

        // Alert must reference the correct agent
        prop_assert_eq!(&alert.agent_id, &agent_id,
            "Alert agent_id should match");

        // Alert must have appropriate severity (High or Critical)
        prop_assert!(alert.severity >= AlertSeverity::High,
            "Timeout alert severity should be at least High, got {:?}", alert.severity);

        // Alert must be stored in manager
        prop_assert_eq!(manager.alert_count(), 1,
            "Alert should be stored in manager");
    }

    #[test]
    fn property_28_timeout_alert_not_triggered_when_not_exceeded(
        agent_id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
        (duration_secs, timeout_secs) in timeout_not_exceeded_strategy(),
    ) {
        let mut manager = AlertManager::new();

        let mut metrics = AgentMetrics::new(&agent_id, &agent_type);
        metrics.timeout = Some(Duration::from_secs(timeout_secs));
        metrics.duration = Some(Duration::from_secs(duration_secs));

        let alert = manager.check_timeout(&metrics);

        // Alert MUST NOT be created when timeout is not exceeded
        prop_assert!(alert.is_none(),
            "Alert should NOT be created when duration ({:?}) does not exceed timeout ({:?})",
            Duration::from_secs(duration_secs), Duration::from_secs(timeout_secs));

        prop_assert_eq!(manager.alert_count(), 0,
            "No alert should be stored in manager");
    }

    #[test]
    fn property_28_cost_alert_triggered_when_exceeded(
        agent_id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
        (cost, threshold) in cost_exceeded_strategy(),
    ) {
        let mut manager = AlertManager::new();

        let mut metrics = AgentMetrics::new(&agent_id, &agent_type);
        metrics.cost = cost;

        let alert = manager.check_cost(&metrics, threshold);

        // Alert MUST be created when cost exceeds threshold
        prop_assert!(alert.is_some(),
            "Alert should be created when cost ({}) exceeds threshold ({})",
            cost, threshold);

        let alert = alert.unwrap();

        // Alert type must be CostThreshold
        prop_assert_eq!(alert.alert_type, AlertType::CostThreshold,
            "Alert type should be CostThreshold");

        // Alert must reference the correct agent
        prop_assert_eq!(&alert.agent_id, &agent_id,
            "Alert agent_id should match");

        // Alert severity should scale with how much threshold is exceeded
        let ratio = cost / threshold;
        if ratio >= 2.0 {
            prop_assert_eq!(alert.severity, AlertSeverity::Critical,
                "Cost ratio >= 2.0 should be Critical");
        } else if ratio >= 1.5 {
            prop_assert_eq!(alert.severity, AlertSeverity::High,
                "Cost ratio >= 1.5 should be High");
        } else {
            prop_assert_eq!(alert.severity, AlertSeverity::Medium,
                "Cost ratio < 1.5 should be Medium");
        }

        // Alert must be stored in manager
        prop_assert_eq!(manager.alert_count(), 1,
            "Alert should be stored in manager");
    }

    #[test]
    fn property_28_cost_alert_not_triggered_when_not_exceeded(
        agent_id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
        (cost, threshold) in cost_not_exceeded_strategy(),
    ) {
        let mut manager = AlertManager::new();

        let mut metrics = AgentMetrics::new(&agent_id, &agent_type);
        metrics.cost = cost;

        let alert = manager.check_cost(&metrics, threshold);

        // Alert MUST NOT be created when cost does not exceed threshold
        prop_assert!(alert.is_none(),
            "Alert should NOT be created when cost ({}) does not exceed threshold ({})",
            cost, threshold);

        prop_assert_eq!(manager.alert_count(), 0,
            "No alert should be stored in manager");
    }

    #[test]
    fn property_28_error_rate_alert_triggered_when_exceeded(
        agent_id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
        (total_calls, successful_calls, threshold) in error_rate_exceeded_strategy(),
    ) {
        let mut manager = AlertManager::new();

        let mut metrics = AgentMetrics::new(&agent_id, &agent_type);
        metrics.api_calls = total_calls;
        metrics.api_calls_successful = successful_calls;

        let error_rate = metrics.error_rate();
        let alert = manager.check_errors(&metrics, threshold);

        // Alert MUST be created when error rate exceeds threshold
        prop_assert!(alert.is_some(),
            "Alert should be created when error rate ({}) exceeds threshold ({})",
            error_rate, threshold);

        let alert = alert.unwrap();

        // Alert type must be ErrorRate
        prop_assert_eq!(alert.alert_type, AlertType::ErrorRate,
            "Alert type should be ErrorRate");

        // Alert must reference the correct agent
        prop_assert_eq!(&alert.agent_id, &agent_id,
            "Alert agent_id should match");

        // Alert severity should scale with error rate
        if error_rate >= 0.75 {
            prop_assert_eq!(alert.severity, AlertSeverity::Critical,
                "Error rate >= 75% should be Critical");
        } else if error_rate >= 0.5 {
            prop_assert_eq!(alert.severity, AlertSeverity::High,
                "Error rate >= 50% should be High");
        } else if error_rate >= threshold {
            prop_assert!(alert.severity >= AlertSeverity::Medium,
                "Error rate >= threshold should be at least Medium");
        }

        // Alert must be stored in manager
        prop_assert_eq!(manager.alert_count(), 1,
            "Alert should be stored in manager");
    }

    #[test]
    fn property_28_error_rate_alert_not_triggered_when_not_exceeded(
        agent_id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
        (total_calls, successful_calls, threshold) in error_rate_not_exceeded_strategy(),
    ) {
        let mut manager = AlertManager::new();

        let mut metrics = AgentMetrics::new(&agent_id, &agent_type);
        metrics.api_calls = total_calls;
        metrics.api_calls_successful = successful_calls;

        let error_rate = metrics.error_rate();
        let alert = manager.check_errors(&metrics, threshold);

        // Alert MUST NOT be created when error rate does not exceed threshold
        prop_assert!(alert.is_none(),
            "Alert should NOT be created when error rate ({}) does not exceed threshold ({})",
            error_rate, threshold);

        prop_assert_eq!(manager.alert_count(), 0,
            "No alert should be stored in manager");
    }

    #[test]
    fn property_28_timeout_severity_scales_with_excess(
        agent_id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
        timeout_secs in 10u64..60,
        multiplier in 2.2f64..5.0,  // Use > 2.1 to ensure duration > 2x timeout after truncation
    ) {
        let mut manager = AlertManager::new();

        let duration_secs = (timeout_secs as f64 * multiplier) as u64;
        let mut metrics = AgentMetrics::new(&agent_id, &agent_type);
        metrics.timeout = Some(Duration::from_secs(timeout_secs));
        metrics.duration = Some(Duration::from_secs(duration_secs));

        let alert = manager.check_timeout(&metrics).unwrap();

        // Severity should be Critical if duration > 2x timeout
        // Note: We use multiplier > 2.1 to account for integer truncation
        if duration_secs > timeout_secs * 2 {
            prop_assert_eq!(alert.severity, AlertSeverity::Critical,
                "Duration ({}) > 2x timeout ({}) should be Critical severity",
                duration_secs, timeout_secs);
        } else {
            prop_assert_eq!(alert.severity, AlertSeverity::High,
                "Duration ({}) <= 2x timeout ({}) should be High severity",
                duration_secs, timeout_secs);
        }
    }

    #[test]
    fn property_28_check_all_creates_multiple_alerts(
        agent_id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
    ) {
        // Create metrics that exceed all thresholds
        let thresholds = AlertThresholds {
            cost_threshold: Some(1.0),
            error_rate_threshold: Some(0.1),
            latency_threshold: Some(Duration::from_secs(30)),
        };

        let mut manager = AlertManager::with_thresholds(thresholds);

        let mut metrics = AgentMetrics::new(&agent_id, &agent_type);
        metrics.timeout = Some(Duration::from_secs(10));
        metrics.duration = Some(Duration::from_secs(30)); // Exceeds timeout
        metrics.cost = 5.0; // Exceeds cost threshold
        metrics.api_calls = 10;
        metrics.api_calls_successful = 5; // 50% error rate, exceeds 10% threshold

        let alerts = manager.check_all(&metrics);

        // Should create alerts for timeout, cost, and error rate
        prop_assert!(alerts.len() >= 2,
            "Should create multiple alerts when multiple thresholds exceeded, got {}",
            alerts.len());

        // Verify alert types
        let alert_types: Vec<_> = alerts.iter().map(|a| &a.alert_type).collect();
        prop_assert!(alert_types.contains(&&AlertType::Timeout),
            "Should have timeout alert");
        prop_assert!(alert_types.contains(&&AlertType::CostThreshold),
            "Should have cost threshold alert");
        prop_assert!(alert_types.contains(&&AlertType::ErrorRate),
            "Should have error rate alert");

        // All alerts should be stored
        prop_assert_eq!(manager.alert_count(), alerts.len(),
            "All alerts should be stored in manager");
    }

    #[test]
    fn property_28_alert_metadata_contains_threshold_info(
        agent_id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
        (cost, threshold) in cost_exceeded_strategy(),
    ) {
        let mut manager = AlertManager::new();

        let mut metrics = AgentMetrics::new(&agent_id, &agent_type);
        metrics.cost = cost;

        let alert = manager.check_cost(&metrics, threshold).unwrap();

        // Alert metadata should contain cost and threshold info
        prop_assert!(alert.metadata.is_some(),
            "Alert should have metadata");

        let metadata = alert.metadata.as_ref().unwrap();
        prop_assert!(metadata.contains_key("cost"),
            "Metadata should contain cost");
        prop_assert!(metadata.contains_key("threshold"),
            "Metadata should contain threshold");
        prop_assert!(metadata.contains_key("ratio"),
            "Metadata should contain ratio");

        // Verify metadata values
        let meta_cost = metadata.get("cost").and_then(|v| v.as_f64()).unwrap();
        let meta_threshold = metadata.get("threshold").and_then(|v| v.as_f64()).unwrap();

        prop_assert!((meta_cost - cost).abs() < 0.0001,
            "Metadata cost should match actual cost");
        prop_assert!((meta_threshold - threshold).abs() < 0.0001,
            "Metadata threshold should match actual threshold");
    }
}

// Additional unit tests for edge cases
#[cfg(test)]
mod additional_tests {
    use super::*;

    #[test]
    fn test_no_timeout_configured() {
        let mut manager = AlertManager::new();

        let metrics = AgentMetrics::new("agent-1", "test");
        // No timeout configured

        let alert = manager.check_timeout(&metrics);
        assert!(alert.is_none(), "No alert when timeout not configured");
    }

    #[test]
    fn test_zero_api_calls_error_rate() {
        let mut manager = AlertManager::new();

        let metrics = AgentMetrics::new("agent-1", "test");
        // Zero API calls

        let alert = manager.check_errors(&metrics, 0.1);
        assert!(alert.is_none(), "No alert when zero API calls");
    }

    #[test]
    fn test_latency_alert() {
        let alert = Alert::latency("agent-1", Duration::from_secs(100), Duration::from_secs(30));

        assert_eq!(alert.alert_type, AlertType::Latency);
        assert_eq!(alert.severity, AlertSeverity::Critical); // 100/30 > 3.0
        assert!(alert.metadata.is_some());

        let metadata = alert.metadata.unwrap();
        assert!(metadata.contains_key("latency_ms"));
        assert!(metadata.contains_key("threshold_ms"));
    }

    #[test]
    fn test_latency_severity_scaling() {
        // Ratio < 2.0 -> Medium
        let alert1 = Alert::latency(
            "agent-1",
            Duration::from_millis(150),
            Duration::from_millis(100),
        );
        assert_eq!(alert1.severity, AlertSeverity::Medium);

        // Ratio >= 2.0 and < 3.0 -> High
        let alert2 = Alert::latency(
            "agent-1",
            Duration::from_millis(250),
            Duration::from_millis(100),
        );
        assert_eq!(alert2.severity, AlertSeverity::High);

        // Ratio >= 3.0 -> Critical
        let alert3 = Alert::latency(
            "agent-1",
            Duration::from_millis(350),
            Duration::from_millis(100),
        );
        assert_eq!(alert3.severity, AlertSeverity::Critical);
    }

    #[test]
    fn test_alert_with_custom_metadata() {
        let alert = Alert::new(
            AlertType::Custom("test".to_string()),
            AlertSeverity::Medium,
            "agent-1",
            "Test",
        )
        .with_metadata("key1", serde_json::json!("value1"))
        .with_metadata("key2", serde_json::json!(42));

        let metadata = alert.metadata.unwrap();
        assert_eq!(metadata.get("key1").unwrap(), &serde_json::json!("value1"));
        assert_eq!(metadata.get("key2").unwrap(), &serde_json::json!(42));
    }

    #[test]
    fn test_check_all_with_no_thresholds_exceeded() {
        let thresholds = AlertThresholds {
            cost_threshold: Some(100.0),
            error_rate_threshold: Some(0.9),
            latency_threshold: Some(Duration::from_secs(300)),
        };

        let mut manager = AlertManager::with_thresholds(thresholds);

        let mut metrics = AgentMetrics::new("agent-1", "test");
        metrics.cost = 0.5;
        metrics.api_calls = 10;
        metrics.api_calls_successful = 10; // 0% error rate

        let alerts = manager.check_all(&metrics);
        assert!(alerts.is_empty(), "No alerts when no thresholds exceeded");
    }

    #[test]
    fn test_check_all_with_none_thresholds() {
        let thresholds = AlertThresholds {
            cost_threshold: None,
            error_rate_threshold: None,
            latency_threshold: None,
        };

        let mut manager = AlertManager::with_thresholds(thresholds);

        let mut metrics = AgentMetrics::new("agent-1", "test");
        metrics.cost = 1000.0;
        metrics.api_calls = 10;
        metrics.api_calls_successful = 0; // 100% error rate

        let alerts = manager.check_all(&metrics);
        // Only timeout alert possible (if configured in metrics)
        assert!(
            alerts.is_empty() || alerts.iter().all(|a| a.alert_type == AlertType::Timeout),
            "Only timeout alerts when other thresholds are None"
        );
    }
}

// **Property 29: Alert Lifecycle Management**
//
// *For any* alert, acknowledgment SHALL update the acknowledged flag,
// and clearing acknowledged alerts SHALL remove them from the active list.
//
// **Validates: Requirements 9.3, 9.4**

proptest! {
    #![proptest_config(ProptestConfig::with_cases(50))]

    #[test]
    fn property_29_acknowledge_updates_flag(
        agent_id in agent_id_strategy(),
        alert_type in prop_oneof![
            Just(AlertType::Timeout),
            Just(AlertType::CostThreshold),
            Just(AlertType::ErrorRate),
            Just(AlertType::Latency),
        ],
        severity in prop_oneof![
            Just(AlertSeverity::Low),
            Just(AlertSeverity::Medium),
            Just(AlertSeverity::High),
            Just(AlertSeverity::Critical),
        ],
        message in "[a-zA-Z0-9 ]{1,50}".prop_map(|s| s.to_string()),
    ) {
        let mut manager = AlertManager::new();

        let alert = Alert::new(alert_type, severity, &agent_id, &message);
        let alert_id = manager.add_alert(alert);

        // Initially alert should be active (not acknowledged)
        let alert = manager.get_alert(&alert_id).unwrap();
        prop_assert!(alert.is_active(),
            "Alert should be active initially");
        prop_assert!(!alert.acknowledged,
            "Alert should not be acknowledged initially");

        // Acknowledge the alert
        let result = manager.acknowledge(&alert_id);
        prop_assert!(result, "Acknowledge should return true for existing alert");

        // After acknowledgment, alert should not be active
        let alert = manager.get_alert(&alert_id).unwrap();
        prop_assert!(!alert.is_active(),
            "Alert should not be active after acknowledgment");
        prop_assert!(alert.acknowledged,
            "Alert acknowledged flag should be true");

        // Active alerts should not include this alert
        let active = manager.get_active_alerts();
        prop_assert!(!active.iter().any(|a| a.id == alert_id),
            "Acknowledged alert should not be in active alerts");

        // All alerts should still include this alert
        let all = manager.get_all_alerts();
        prop_assert!(all.iter().any(|a| a.id == alert_id),
            "Acknowledged alert should still be in all alerts");
    }

    #[test]
    fn property_29_acknowledge_nonexistent_returns_false(
        alert_id in "[a-z0-9-]{36}".prop_map(|s| s.to_string()),
    ) {
        let mut manager = AlertManager::new();

        // Acknowledging non-existent alert should return false
        let result = manager.acknowledge(&alert_id);
        prop_assert!(!result, "Acknowledge should return false for non-existent alert");
    }

    #[test]
    fn property_29_acknowledge_all_updates_all_flags(
        alerts_data in prop::collection::vec(
            (agent_id_strategy(),
             prop_oneof![
                 Just(AlertType::Timeout),
                 Just(AlertType::CostThreshold),
                 Just(AlertType::ErrorRate),
             ],
             prop_oneof![
                 Just(AlertSeverity::Low),
                 Just(AlertSeverity::Medium),
                 Just(AlertSeverity::High),
             ]),
            1..10
        ),
    ) {
        let mut manager = AlertManager::new();

        // Add multiple alerts
        let mut alert_ids = Vec::new();
        for (i, (agent_id, alert_type, severity)) in alerts_data.iter().enumerate() {
            let alert = Alert::new(alert_type.clone(), *severity, agent_id, format!("Alert {}", i));
            let id = manager.add_alert(alert);
            alert_ids.push(id);
        }

        // All alerts should be active initially
        prop_assert_eq!(manager.active_alert_count(), alert_ids.len(),
            "All alerts should be active initially");

        // Acknowledge all
        manager.acknowledge_all();

        // No alerts should be active after acknowledge_all
        prop_assert_eq!(manager.active_alert_count(), 0,
            "No alerts should be active after acknowledge_all");

        // All alerts should still exist
        prop_assert_eq!(manager.alert_count(), alert_ids.len(),
            "All alerts should still exist after acknowledge_all");

        // Each alert should be acknowledged
        for alert_id in &alert_ids {
            let alert = manager.get_alert(alert_id).unwrap();
            prop_assert!(alert.acknowledged,
                "Each alert should be acknowledged");
        }
    }

    #[test]
    fn property_29_clear_acknowledged_removes_only_acknowledged(
        num_alerts in 2usize..10,
        num_to_acknowledge in 1usize..10,
    ) {
        let mut manager = AlertManager::new();

        let num_to_acknowledge = num_to_acknowledge.min(num_alerts - 1); // Keep at least one unacknowledged

        // Add alerts
        let mut alert_ids = Vec::new();
        for i in 0..num_alerts {
            let alert = Alert::new(
                AlertType::Timeout,
                AlertSeverity::Medium,
                format!("agent-{}", i),
                format!("Alert {}", i),
            );
            let id = manager.add_alert(alert);
            alert_ids.push(id);
        }

        // Acknowledge some alerts
        for alert_id in alert_ids.iter().take(num_to_acknowledge) {
            manager.acknowledge(alert_id);
        }

        let acknowledged_count = num_to_acknowledge;
        let unacknowledged_count = num_alerts - num_to_acknowledge;

        // Verify counts before clearing
        prop_assert_eq!(manager.active_alert_count(), unacknowledged_count,
            "Active count should match unacknowledged count");

        // Clear acknowledged alerts
        let cleared = manager.clear_acknowledged();

        // Cleared count should match acknowledged count
        prop_assert_eq!(cleared, acknowledged_count,
            "Cleared count should match acknowledged count");

        // Remaining alerts should all be unacknowledged
        prop_assert_eq!(manager.alert_count(), unacknowledged_count,
            "Remaining count should match unacknowledged count");

        // All remaining alerts should be active
        prop_assert_eq!(manager.active_alert_count(), unacknowledged_count,
            "All remaining alerts should be active");

        // Verify acknowledged alerts are gone
        for (i, alert_id) in alert_ids.iter().enumerate().take(num_to_acknowledge) {
            prop_assert!(manager.get_alert(alert_id).is_none(),
                "Acknowledged alert {} should be removed", i);
        }

        // Verify unacknowledged alerts remain
        for (i, alert_id) in alert_ids.iter().enumerate().skip(num_to_acknowledge) {
            prop_assert!(manager.get_alert(alert_id).is_some(),
                "Unacknowledged alert {} should remain", i);
        }
    }

    #[test]
    fn property_29_get_active_alerts_excludes_acknowledged(
        num_alerts in 2usize..10,
        acknowledge_pattern in prop::collection::vec(any::<bool>(), 2..10),
    ) {
        let mut manager = AlertManager::new();

        let num_alerts = num_alerts.min(acknowledge_pattern.len());

        // Add alerts and track which ones we acknowledge
        let mut alert_ids = Vec::new();
        let mut expected_active_ids = Vec::new();

        for (i, should_acknowledge) in acknowledge_pattern.iter().enumerate().take(num_alerts) {
            let alert = Alert::new(
                AlertType::CostThreshold,
                AlertSeverity::High,
                format!("agent-{}", i),
                format!("Alert {}", i),
            );
            let id = manager.add_alert(alert);
            alert_ids.push(id.clone());

            if !should_acknowledge {
                expected_active_ids.push(id);
            }
        }

        // Acknowledge based on pattern
        for (i, should_acknowledge) in acknowledge_pattern.iter().enumerate().take(num_alerts) {
            if *should_acknowledge {
                manager.acknowledge(&alert_ids[i]);
            }
        }

        // Get active alerts
        let active = manager.get_active_alerts();

        // Active alerts count should match expected
        prop_assert_eq!(active.len(), expected_active_ids.len(),
            "Active alerts count should match expected");

        // All active alerts should be in expected list
        for alert in &active {
            prop_assert!(expected_active_ids.contains(&alert.id),
                "Active alert {} should be in expected list", alert.id);
        }

        // All expected active alerts should be in active list
        for expected_id in &expected_active_ids {
            prop_assert!(active.iter().any(|a| &a.id == expected_id),
                "Expected active alert {} should be in active list", expected_id);
        }
    }

    #[test]
    fn property_29_get_all_alerts_includes_all(
        num_alerts in 1usize..10,
        num_to_acknowledge in 0usize..10,
    ) {
        let mut manager = AlertManager::new();

        let num_to_acknowledge = num_to_acknowledge.min(num_alerts);

        // Add alerts
        let mut alert_ids = Vec::new();
        for i in 0..num_alerts {
            let alert = Alert::new(
                AlertType::ErrorRate,
                AlertSeverity::Low,
                format!("agent-{}", i),
                format!("Alert {}", i),
            );
            let id = manager.add_alert(alert);
            alert_ids.push(id);
        }

        // Acknowledge some
        for alert_id in alert_ids.iter().take(num_to_acknowledge) {
            manager.acknowledge(alert_id);
        }

        // Get all alerts
        let all = manager.get_all_alerts();

        // All alerts should be returned regardless of acknowledgment status
        prop_assert_eq!(all.len(), num_alerts,
            "get_all_alerts should return all alerts");

        // All alert IDs should be present
        for alert_id in &alert_ids {
            prop_assert!(all.iter().any(|a| &a.id == alert_id),
                "Alert {} should be in all alerts", alert_id);
        }
    }

    #[test]
    fn property_29_idempotent_acknowledge(
        agent_id in agent_id_strategy(),
    ) {
        let mut manager = AlertManager::new();

        let alert = Alert::new(AlertType::Timeout, AlertSeverity::High, &agent_id, "Test");
        let alert_id = manager.add_alert(alert);

        // First acknowledge
        let result1 = manager.acknowledge(&alert_id);
        prop_assert!(result1, "First acknowledge should succeed");

        // Second acknowledge (idempotent)
        let result2 = manager.acknowledge(&alert_id);
        prop_assert!(result2, "Second acknowledge should also succeed");

        // Alert should still be acknowledged
        let alert = manager.get_alert(&alert_id).unwrap();
        prop_assert!(alert.acknowledged, "Alert should remain acknowledged");

        // Active count should be 0
        prop_assert_eq!(manager.active_alert_count(), 0,
            "Active count should be 0 after multiple acknowledges");
    }

    #[test]
    fn property_29_clear_acknowledged_is_idempotent(
        num_alerts in 1usize..5,
    ) {
        let mut manager = AlertManager::new();

        // Add and acknowledge all alerts
        for i in 0..num_alerts {
            let alert = Alert::new(
                AlertType::Latency,
                AlertSeverity::Medium,
                format!("agent-{}", i),
                format!("Alert {}", i),
            );
            manager.add_alert(alert);
        }
        manager.acknowledge_all();

        // First clear
        let cleared1 = manager.clear_acknowledged();
        prop_assert_eq!(cleared1, num_alerts, "First clear should remove all");

        // Second clear (should be no-op)
        let cleared2 = manager.clear_acknowledged();
        prop_assert_eq!(cleared2, 0, "Second clear should remove nothing");

        // Manager should be empty
        prop_assert_eq!(manager.alert_count(), 0, "Manager should be empty");
    }
}

#[cfg(test)]
mod lifecycle_additional_tests {
    use super::*;

    #[test]
    fn test_acknowledge_preserves_other_alert_data() {
        let mut manager = AlertManager::new();

        let alert = Alert::new(
            AlertType::Timeout,
            AlertSeverity::Critical,
            "agent-1",
            "Test message",
        )
        .with_metadata("key", serde_json::json!("value"));
        let alert_id = manager.add_alert(alert);

        manager.acknowledge(&alert_id);

        let alert = manager.get_alert(&alert_id).unwrap();

        // All other fields should be preserved
        assert_eq!(alert.alert_type, AlertType::Timeout);
        assert_eq!(alert.severity, AlertSeverity::Critical);
        assert_eq!(alert.agent_id, "agent-1");
        assert_eq!(alert.message, "Test message");
        assert!(alert.metadata.is_some());
        assert_eq!(
            alert.metadata.as_ref().unwrap().get("key"),
            Some(&serde_json::json!("value"))
        );
    }

    #[test]
    fn test_clear_all_removes_everything() {
        let mut manager = AlertManager::new();

        // Add mix of acknowledged and unacknowledged
        let alert1 = Alert::new(AlertType::Timeout, AlertSeverity::High, "agent-1", "Test 1");
        let alert2 = Alert::new(
            AlertType::CostThreshold,
            AlertSeverity::Medium,
            "agent-2",
            "Test 2",
        );

        let id1 = manager.add_alert(alert1);
        manager.add_alert(alert2);

        manager.acknowledge(&id1);

        assert_eq!(manager.alert_count(), 2);

        manager.clear_all();

        assert_eq!(manager.alert_count(), 0);
        assert_eq!(manager.active_alert_count(), 0);
    }

    #[test]
    fn test_get_alerts_by_agent_with_mixed_acknowledgment() {
        let mut manager = AlertManager::new();

        // Add multiple alerts for same agent
        let alert1 = Alert::new(AlertType::Timeout, AlertSeverity::High, "agent-1", "Test 1");
        let alert2 = Alert::new(
            AlertType::CostThreshold,
            AlertSeverity::Medium,
            "agent-1",
            "Test 2",
        );
        let alert3 = Alert::new(
            AlertType::ErrorRate,
            AlertSeverity::Low,
            "agent-2",
            "Test 3",
        );

        let id1 = manager.add_alert(alert1);
        manager.add_alert(alert2);
        manager.add_alert(alert3);

        manager.acknowledge(&id1);

        // get_alerts_by_agent should return all alerts for agent regardless of acknowledgment
        let agent1_alerts = manager.get_alerts_by_agent("agent-1");
        assert_eq!(agent1_alerts.len(), 2);

        let agent2_alerts = manager.get_alerts_by_agent("agent-2");
        assert_eq!(agent2_alerts.len(), 1);
    }

    #[test]
    fn test_empty_manager_operations() {
        let mut manager = AlertManager::new();

        // All operations should work on empty manager
        assert_eq!(manager.alert_count(), 0);
        assert_eq!(manager.active_alert_count(), 0);
        assert!(manager.get_active_alerts().is_empty());
        assert!(manager.get_all_alerts().is_empty());
        assert!(!manager.acknowledge("nonexistent"));
        assert_eq!(manager.clear_acknowledged(), 0);

        manager.acknowledge_all(); // Should not panic
        manager.clear_all(); // Should not panic
    }
}
