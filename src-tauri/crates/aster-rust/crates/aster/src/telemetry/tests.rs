//! Telemetry 模块测试

use super::*;

#[test]
fn test_telemetry_config_default() {
    let config = TelemetryConfig::default();
    assert!(config.performance_tracking);
    assert!(!config.error_reporting);
    assert!(!config.batch_upload);
}

#[test]
fn test_token_usage_default() {
    let usage = TokenUsage::default();
    assert_eq!(usage.input, 0);
    assert_eq!(usage.output, 0);
    assert_eq!(usage.total, 0);
}

#[test]
fn test_session_metrics_default() {
    let metrics = SessionMetrics::default();
    assert_eq!(metrics.message_count, 0);
    assert_eq!(metrics.errors, 0);
    assert!(metrics.tool_calls.is_empty());
}

#[test]
fn test_aggregate_metrics_default() {
    let metrics = AggregateMetrics::default();
    assert_eq!(metrics.total_sessions, 0);
    assert_eq!(metrics.total_messages, 0);
    assert_eq!(metrics.total_cost, 0.0);
}

#[test]
fn test_sanitize_string() {
    let input = "Contact: user@example.com";
    let result = sanitize_string(input);
    assert!(result.contains("[REDACTED]"));
    assert!(!result.contains("user@example.com"));
}

#[test]
fn test_sanitize_api_key() {
    let input = "Key: sk-abcdefghijklmnopqrstuvwxyz123456";
    let result = sanitize_string(input);
    assert!(result.contains("[REDACTED]"));
}

#[test]
fn test_sanitize_home_path() {
    let input = "Path: /Users/username/documents";
    let result = sanitize_string(input);
    assert!(result.contains("[REDACTED]"));
}

#[test]
fn test_telemetry_event_serialization() {
    let event = TelemetryEvent {
        event_type: "test".to_string(),
        timestamp: 1234567890,
        session_id: "session-123".to_string(),
        anonymous_id: "anon-123".to_string(),
        data: std::collections::HashMap::new(),
        version: Some("1.0.0".to_string()),
        platform: Some("linux".to_string()),
    };

    let json = serde_json::to_string(&event).unwrap();
    let parsed: TelemetryEvent = serde_json::from_str(&json).unwrap();

    assert_eq!(parsed.event_type, "test");
    assert_eq!(parsed.timestamp, 1234567890);
}

#[test]
fn test_performance_metric_serialization() {
    let metric = PerformanceMetric {
        operation: "test_op".to_string(),
        duration: 100,
        timestamp: 1234567890,
        success: true,
        metadata: None,
    };

    let json = serde_json::to_string(&metric).unwrap();
    let parsed: PerformanceMetric = serde_json::from_str(&json).unwrap();

    assert_eq!(parsed.operation, "test_op");
    assert_eq!(parsed.duration, 100);
    assert!(parsed.success);
}

#[test]
fn test_error_report_serialization() {
    let report = ErrorReport {
        error_type: "TestError".to_string(),
        error_message: "Test message".to_string(),
        stack: None,
        context: std::collections::HashMap::new(),
        timestamp: 1234567890,
        session_id: "session-123".to_string(),
        anonymous_id: "anon-123".to_string(),
    };

    let json = serde_json::to_string(&report).unwrap();
    let parsed: ErrorReport = serde_json::from_str(&json).unwrap();

    assert_eq!(parsed.error_type, "TestError");
    assert_eq!(parsed.error_message, "Test message");
}
