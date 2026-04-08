//! Alert Manager
//!
//! Manages alerts for agent issues including timeout,
//! cost threshold, error rate, and latency violations.
//!
//! This module provides:
//! - Alert creation for various threshold violations
//! - Alert severity levels (low, medium, high, critical)
//! - Alert lifecycle management (acknowledge, clear)

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

/// Alert severity levels
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Serialize, Deserialize,
)]
#[serde(rename_all = "lowercase")]
pub enum AlertSeverity {
    /// Low severity - informational
    Low,
    /// Medium severity - warning
    #[default]
    Medium,
    /// High severity - requires attention
    High,
    /// Critical severity - immediate action required
    Critical,
}

impl std::fmt::Display for AlertSeverity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AlertSeverity::Low => write!(f, "low"),
            AlertSeverity::Medium => write!(f, "medium"),
            AlertSeverity::High => write!(f, "high"),
            AlertSeverity::Critical => write!(f, "critical"),
        }
    }
}

/// Alert types
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlertType {
    /// Agent execution timeout
    Timeout,
    /// Cost threshold exceeded
    CostThreshold,
    /// Error rate threshold exceeded
    ErrorRate,
    /// Latency threshold exceeded
    Latency,
    /// Resource limit exceeded
    ResourceLimit,
    /// Custom alert type
    Custom(String),
}

impl std::fmt::Display for AlertType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AlertType::Timeout => write!(f, "timeout"),
            AlertType::CostThreshold => write!(f, "cost_threshold"),
            AlertType::ErrorRate => write!(f, "error_rate"),
            AlertType::Latency => write!(f, "latency"),
            AlertType::ResourceLimit => write!(f, "resource_limit"),
            AlertType::Custom(name) => write!(f, "custom:{}", name),
        }
    }
}

/// An alert representing an issue with agent execution
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Alert {
    /// Unique alert identifier
    pub id: String,
    /// Type of alert
    pub alert_type: AlertType,
    /// Severity level
    pub severity: AlertSeverity,
    /// Agent ID that triggered the alert
    pub agent_id: String,
    /// Human-readable message
    pub message: String,
    /// Timestamp when alert was created
    pub timestamp: DateTime<Utc>,
    /// Whether the alert has been acknowledged
    pub acknowledged: bool,
    /// Additional metadata
    pub metadata: Option<HashMap<String, serde_json::Value>>,
}

impl Alert {
    /// Create a new alert
    pub fn new(
        alert_type: AlertType,
        severity: AlertSeverity,
        agent_id: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            alert_type,
            severity,
            agent_id: agent_id.into(),
            message: message.into(),
            timestamp: Utc::now(),
            acknowledged: false,
            metadata: None,
        }
    }

    /// Create a timeout alert
    pub fn timeout(agent_id: impl Into<String>, duration: Duration, timeout: Duration) -> Self {
        let agent_id = agent_id.into();
        let severity = if duration > timeout * 2 {
            AlertSeverity::Critical
        } else {
            AlertSeverity::High
        };

        let mut alert = Self::new(
            AlertType::Timeout,
            severity,
            agent_id.clone(),
            format!(
                "Agent {} exceeded timeout: {:?} > {:?}",
                agent_id, duration, timeout
            ),
        );

        let mut metadata = HashMap::new();
        metadata.insert(
            "duration_ms".to_string(),
            serde_json::json!(duration.as_millis()),
        );
        metadata.insert(
            "timeout_ms".to_string(),
            serde_json::json!(timeout.as_millis()),
        );
        alert.metadata = Some(metadata);

        alert
    }

    /// Create a cost threshold alert
    pub fn cost_threshold(agent_id: impl Into<String>, cost: f64, threshold: f64) -> Self {
        let agent_id = agent_id.into();
        let ratio = cost / threshold;
        let severity = if ratio >= 2.0 {
            AlertSeverity::Critical
        } else if ratio >= 1.5 {
            AlertSeverity::High
        } else {
            AlertSeverity::Medium
        };

        let mut alert = Self::new(
            AlertType::CostThreshold,
            severity,
            agent_id.clone(),
            format!(
                "Agent {} exceeded cost threshold: ${:.4} > ${:.4}",
                agent_id, cost, threshold
            ),
        );

        let mut metadata = HashMap::new();
        metadata.insert("cost".to_string(), serde_json::json!(cost));
        metadata.insert("threshold".to_string(), serde_json::json!(threshold));
        metadata.insert("ratio".to_string(), serde_json::json!(ratio));
        alert.metadata = Some(metadata);

        alert
    }

    /// Create an error rate alert
    pub fn error_rate(agent_id: impl Into<String>, error_rate: f32, threshold: f32) -> Self {
        let agent_id = agent_id.into();
        let severity = if error_rate >= 0.75 {
            AlertSeverity::Critical
        } else if error_rate >= 0.5 {
            AlertSeverity::High
        } else if error_rate >= threshold {
            AlertSeverity::Medium
        } else {
            AlertSeverity::Low
        };

        let mut alert = Self::new(
            AlertType::ErrorRate,
            severity,
            agent_id.clone(),
            format!(
                "Agent {} exceeded error rate threshold: {:.1}% > {:.1}%",
                agent_id,
                error_rate * 100.0,
                threshold * 100.0
            ),
        );

        let mut metadata = HashMap::new();
        metadata.insert("error_rate".to_string(), serde_json::json!(error_rate));
        metadata.insert("threshold".to_string(), serde_json::json!(threshold));
        alert.metadata = Some(metadata);

        alert
    }

    /// Create a latency alert
    pub fn latency(agent_id: impl Into<String>, latency: Duration, threshold: Duration) -> Self {
        let agent_id = agent_id.into();
        let ratio = latency.as_millis() as f64 / threshold.as_millis() as f64;
        let severity = if ratio >= 3.0 {
            AlertSeverity::Critical
        } else if ratio >= 2.0 {
            AlertSeverity::High
        } else {
            AlertSeverity::Medium
        };

        let mut alert = Self::new(
            AlertType::Latency,
            severity,
            agent_id.clone(),
            format!(
                "Agent {} exceeded latency threshold: {:?} > {:?}",
                agent_id, latency, threshold
            ),
        );

        let mut metadata = HashMap::new();
        metadata.insert(
            "latency_ms".to_string(),
            serde_json::json!(latency.as_millis()),
        );
        metadata.insert(
            "threshold_ms".to_string(),
            serde_json::json!(threshold.as_millis()),
        );
        alert.metadata = Some(metadata);

        alert
    }

    /// Add metadata to the alert
    pub fn with_metadata(mut self, key: impl Into<String>, value: serde_json::Value) -> Self {
        let metadata = self.metadata.get_or_insert_with(HashMap::new);
        metadata.insert(key.into(), value);
        self
    }

    /// Acknowledge the alert
    pub fn acknowledge(&mut self) {
        self.acknowledged = true;
    }

    /// Check if the alert is active (not acknowledged)
    pub fn is_active(&self) -> bool {
        !self.acknowledged
    }
}

impl PartialEq for Alert {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}

impl Eq for Alert {}

impl std::hash::Hash for Alert {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.id.hash(state);
    }
}

/// Agent execution status for metrics
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentExecutionStatus {
    /// Agent is currently running
    #[default]
    Running,
    /// Agent completed successfully
    Completed,
    /// Agent failed with an error
    Failed,
    /// Agent was cancelled
    Cancelled,
    /// Agent timed out
    TimedOut,
}

/// Token usage tracking
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    /// Input tokens used
    pub input: usize,
    /// Output tokens used
    pub output: usize,
    /// Total tokens used
    pub total: usize,
}

impl TokenUsage {
    /// Create new token usage
    pub fn new(input: usize, output: usize) -> Self {
        Self {
            input,
            output,
            total: input + output,
        }
    }
}

/// Error record for tracking agent errors
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorRecord {
    /// Error message
    pub message: String,
    /// Error timestamp
    pub timestamp: DateTime<Utc>,
    /// Error phase (e.g., "tool_call", "api_call")
    pub phase: Option<String>,
    /// Stack trace if available
    pub stack_trace: Option<String>,
}

impl ErrorRecord {
    /// Create a new error record
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            timestamp: Utc::now(),
            phase: None,
            stack_trace: None,
        }
    }

    /// Set the phase
    pub fn with_phase(mut self, phase: impl Into<String>) -> Self {
        self.phase = Some(phase.into());
        self
    }
}

/// Agent metrics for monitoring
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMetrics {
    /// Agent ID
    pub agent_id: String,
    /// Agent type
    pub agent_type: String,
    /// Start time
    pub start_time: DateTime<Utc>,
    /// End time (if completed)
    pub end_time: Option<DateTime<Utc>>,
    /// Duration (if completed)
    pub duration: Option<Duration>,
    /// Execution status
    pub status: AgentExecutionStatus,
    /// Token usage
    pub tokens_used: TokenUsage,
    /// Number of API calls
    pub api_calls: usize,
    /// Number of successful API calls
    pub api_calls_successful: usize,
    /// Number of tool calls
    pub tool_calls_count: usize,
    /// Total cost
    pub cost: f64,
    /// Errors encountered
    pub errors: Vec<ErrorRecord>,
    /// Configured timeout
    pub timeout: Option<Duration>,
}

impl AgentMetrics {
    /// Create new agent metrics
    pub fn new(agent_id: impl Into<String>, agent_type: impl Into<String>) -> Self {
        Self {
            agent_id: agent_id.into(),
            agent_type: agent_type.into(),
            start_time: Utc::now(),
            end_time: None,
            duration: None,
            status: AgentExecutionStatus::Running,
            tokens_used: TokenUsage::default(),
            api_calls: 0,
            api_calls_successful: 0,
            tool_calls_count: 0,
            cost: 0.0,
            errors: Vec::new(),
            timeout: None,
        }
    }

    /// Set the timeout
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = Some(timeout);
        self
    }

    /// Calculate error rate
    pub fn error_rate(&self) -> f32 {
        if self.api_calls == 0 {
            0.0
        } else {
            (self.api_calls - self.api_calls_successful) as f32 / self.api_calls as f32
        }
    }

    /// Check if the agent has timed out
    pub fn is_timed_out(&self) -> bool {
        if let Some(timeout) = self.timeout {
            if let Some(duration) = self.duration {
                return duration > timeout;
            }
            // Check if currently running and exceeded timeout
            let elapsed = Utc::now().signed_duration_since(self.start_time);
            if let Ok(elapsed_std) = elapsed.to_std() {
                return elapsed_std > timeout;
            }
        }
        false
    }
}

/// Alert thresholds configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertThresholds {
    /// Cost threshold for alerts
    pub cost_threshold: Option<f64>,
    /// Error rate threshold (0.0 - 1.0)
    pub error_rate_threshold: Option<f32>,
    /// Latency threshold
    pub latency_threshold: Option<Duration>,
}

impl Default for AlertThresholds {
    fn default() -> Self {
        Self {
            cost_threshold: Some(1.0),                        // $1.00 default
            error_rate_threshold: Some(0.1),                  // 10% error rate
            latency_threshold: Some(Duration::from_secs(30)), // 30 seconds
        }
    }
}

/// Alert Manager for managing agent alerts
#[derive(Debug)]
pub struct AlertManager {
    /// All alerts indexed by ID
    alerts: HashMap<String, Alert>,
    /// Alert thresholds
    thresholds: AlertThresholds,
}

impl Default for AlertManager {
    fn default() -> Self {
        Self::new()
    }
}

impl AlertManager {
    /// Create a new AlertManager
    pub fn new() -> Self {
        Self {
            alerts: HashMap::new(),
            thresholds: AlertThresholds::default(),
        }
    }

    /// Create an AlertManager with custom thresholds
    pub fn with_thresholds(thresholds: AlertThresholds) -> Self {
        Self {
            alerts: HashMap::new(),
            thresholds,
        }
    }

    /// Add an alert
    pub fn add_alert(&mut self, alert: Alert) -> String {
        let id = alert.id.clone();
        self.alerts.insert(id.clone(), alert);
        id
    }

    /// Check for timeout and create alert if exceeded
    pub fn check_timeout(&mut self, metrics: &AgentMetrics) -> Option<Alert> {
        if let Some(timeout) = metrics.timeout {
            let duration = metrics.duration.unwrap_or_else(|| {
                let elapsed = Utc::now().signed_duration_since(metrics.start_time);
                elapsed.to_std().unwrap_or(Duration::ZERO)
            });

            if duration > timeout {
                let alert = Alert::timeout(&metrics.agent_id, duration, timeout);
                let id = alert.id.clone();
                self.alerts.insert(id, alert.clone());
                return Some(alert);
            }
        }
        None
    }

    /// Check for cost threshold and create alert if exceeded
    pub fn check_cost(&mut self, metrics: &AgentMetrics, threshold: f64) -> Option<Alert> {
        if metrics.cost > threshold {
            let alert = Alert::cost_threshold(&metrics.agent_id, metrics.cost, threshold);
            let id = alert.id.clone();
            self.alerts.insert(id, alert.clone());
            return Some(alert);
        }
        None
    }

    /// Check for error rate threshold and create alert if exceeded
    pub fn check_errors(&mut self, metrics: &AgentMetrics, threshold: f32) -> Option<Alert> {
        let error_rate = metrics.error_rate();
        if error_rate > threshold {
            let alert = Alert::error_rate(&metrics.agent_id, error_rate, threshold);
            let id = alert.id.clone();
            self.alerts.insert(id, alert.clone());
            return Some(alert);
        }
        None
    }

    /// Check all thresholds and create alerts as needed
    pub fn check_all(&mut self, metrics: &AgentMetrics) -> Vec<Alert> {
        let mut alerts = Vec::new();

        if let Some(alert) = self.check_timeout(metrics) {
            alerts.push(alert);
        }

        if let Some(threshold) = self.thresholds.cost_threshold {
            if let Some(alert) = self.check_cost(metrics, threshold) {
                alerts.push(alert);
            }
        }

        if let Some(threshold) = self.thresholds.error_rate_threshold {
            if let Some(alert) = self.check_errors(metrics, threshold) {
                alerts.push(alert);
            }
        }

        alerts
    }

    /// Get an alert by ID
    pub fn get_alert(&self, alert_id: &str) -> Option<&Alert> {
        self.alerts.get(alert_id)
    }

    /// Get a mutable reference to an alert by ID
    pub fn get_alert_mut(&mut self, alert_id: &str) -> Option<&mut Alert> {
        self.alerts.get_mut(alert_id)
    }

    /// Get all active (unacknowledged) alerts
    pub fn get_active_alerts(&self) -> Vec<&Alert> {
        self.alerts.values().filter(|a| a.is_active()).collect()
    }

    /// Get all alerts
    pub fn get_all_alerts(&self) -> Vec<&Alert> {
        self.alerts.values().collect()
    }

    /// Get alerts by agent ID
    pub fn get_alerts_by_agent(&self, agent_id: &str) -> Vec<&Alert> {
        self.alerts
            .values()
            .filter(|a| a.agent_id == agent_id)
            .collect()
    }

    /// Get alerts by severity
    pub fn get_alerts_by_severity(&self, severity: AlertSeverity) -> Vec<&Alert> {
        self.alerts
            .values()
            .filter(|a| a.severity == severity)
            .collect()
    }

    /// Get alerts by type
    pub fn get_alerts_by_type(&self, alert_type: &AlertType) -> Vec<&Alert> {
        self.alerts
            .values()
            .filter(|a| &a.alert_type == alert_type)
            .collect()
    }

    /// Acknowledge an alert by ID
    pub fn acknowledge(&mut self, alert_id: &str) -> bool {
        if let Some(alert) = self.alerts.get_mut(alert_id) {
            alert.acknowledge();
            true
        } else {
            false
        }
    }

    /// Acknowledge all alerts
    pub fn acknowledge_all(&mut self) {
        for alert in self.alerts.values_mut() {
            alert.acknowledge();
        }
    }

    /// Clear all acknowledged alerts
    pub fn clear_acknowledged(&mut self) -> usize {
        let before = self.alerts.len();
        self.alerts.retain(|_, alert| !alert.acknowledged);
        before - self.alerts.len()
    }

    /// Clear all alerts
    pub fn clear_all(&mut self) {
        self.alerts.clear();
    }

    /// Get the number of alerts
    pub fn alert_count(&self) -> usize {
        self.alerts.len()
    }

    /// Get the number of active alerts
    pub fn active_alert_count(&self) -> usize {
        self.alerts.values().filter(|a| a.is_active()).count()
    }

    /// Update thresholds
    pub fn set_thresholds(&mut self, thresholds: AlertThresholds) {
        self.thresholds = thresholds;
    }

    /// Get current thresholds
    pub fn thresholds(&self) -> &AlertThresholds {
        &self.thresholds
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_alert_severity_ordering() {
        assert!(AlertSeverity::Low < AlertSeverity::Medium);
        assert!(AlertSeverity::Medium < AlertSeverity::High);
        assert!(AlertSeverity::High < AlertSeverity::Critical);
    }

    #[test]
    fn test_alert_creation() {
        let alert = Alert::new(
            AlertType::Timeout,
            AlertSeverity::High,
            "agent-1",
            "Test alert",
        );

        assert!(!alert.id.is_empty());
        assert_eq!(alert.alert_type, AlertType::Timeout);
        assert_eq!(alert.severity, AlertSeverity::High);
        assert_eq!(alert.agent_id, "agent-1");
        assert_eq!(alert.message, "Test alert");
        assert!(!alert.acknowledged);
        assert!(alert.is_active());
    }

    #[test]
    fn test_timeout_alert() {
        let alert = Alert::timeout("agent-1", Duration::from_secs(70), Duration::from_secs(30));

        assert_eq!(alert.alert_type, AlertType::Timeout);
        assert_eq!(alert.severity, AlertSeverity::Critical); // 70s > 30s * 2
        assert!(alert.message.contains("agent-1"));
        assert!(alert.metadata.is_some());
    }

    #[test]
    fn test_cost_threshold_alert() {
        let alert = Alert::cost_threshold("agent-1", 2.5, 1.0);

        assert_eq!(alert.alert_type, AlertType::CostThreshold);
        assert_eq!(alert.severity, AlertSeverity::Critical); // 2.5 >= 2.0 * 1.0
        assert!(alert.message.contains("$2.5"));
    }

    #[test]
    fn test_error_rate_alert() {
        let alert = Alert::error_rate("agent-1", 0.6, 0.1);

        assert_eq!(alert.alert_type, AlertType::ErrorRate);
        assert_eq!(alert.severity, AlertSeverity::High); // 0.6 >= 0.5
        assert!(alert.message.contains("60.0%"));
    }

    #[test]
    fn test_alert_acknowledge() {
        let mut alert = Alert::new(AlertType::Timeout, AlertSeverity::High, "agent-1", "Test");

        assert!(alert.is_active());
        alert.acknowledge();
        assert!(!alert.is_active());
        assert!(alert.acknowledged);
    }

    #[test]
    fn test_alert_manager_basic() {
        let mut manager = AlertManager::new();

        let alert = Alert::new(AlertType::Timeout, AlertSeverity::High, "agent-1", "Test");
        let id = manager.add_alert(alert);

        assert_eq!(manager.alert_count(), 1);
        assert!(manager.get_alert(&id).is_some());
    }

    #[test]
    fn test_alert_manager_check_timeout() {
        let mut manager = AlertManager::new();

        let mut metrics = AgentMetrics::new("agent-1", "test");
        metrics.timeout = Some(Duration::from_secs(10));
        metrics.duration = Some(Duration::from_secs(20));

        let alert = manager.check_timeout(&metrics);
        assert!(alert.is_some());
        assert_eq!(manager.alert_count(), 1);
    }

    #[test]
    fn test_alert_manager_check_cost() {
        let mut manager = AlertManager::new();

        let mut metrics = AgentMetrics::new("agent-1", "test");
        metrics.cost = 2.0;

        let alert = manager.check_cost(&metrics, 1.0);
        assert!(alert.is_some());
        assert_eq!(manager.alert_count(), 1);
    }

    #[test]
    fn test_alert_manager_check_errors() {
        let mut manager = AlertManager::new();

        let mut metrics = AgentMetrics::new("agent-1", "test");
        metrics.api_calls = 10;
        metrics.api_calls_successful = 5; // 50% error rate

        let alert = manager.check_errors(&metrics, 0.1);
        assert!(alert.is_some());
        assert_eq!(manager.alert_count(), 1);
    }

    #[test]
    fn test_alert_manager_acknowledge() {
        let mut manager = AlertManager::new();

        let alert = Alert::new(AlertType::Timeout, AlertSeverity::High, "agent-1", "Test");
        let id = manager.add_alert(alert);

        assert_eq!(manager.active_alert_count(), 1);
        assert!(manager.acknowledge(&id));
        assert_eq!(manager.active_alert_count(), 0);
    }

    #[test]
    fn test_alert_manager_clear_acknowledged() {
        let mut manager = AlertManager::new();

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
        let cleared = manager.clear_acknowledged();

        assert_eq!(cleared, 1);
        assert_eq!(manager.alert_count(), 1);
    }

    #[test]
    fn test_alert_manager_get_active_alerts() {
        let mut manager = AlertManager::new();

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

        let active = manager.get_active_alerts();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].agent_id, "agent-2");
    }

    #[test]
    fn test_alert_manager_get_by_severity() {
        let mut manager = AlertManager::new();

        manager.add_alert(Alert::new(
            AlertType::Timeout,
            AlertSeverity::High,
            "agent-1",
            "Test 1",
        ));
        manager.add_alert(Alert::new(
            AlertType::CostThreshold,
            AlertSeverity::High,
            "agent-2",
            "Test 2",
        ));
        manager.add_alert(Alert::new(
            AlertType::ErrorRate,
            AlertSeverity::Medium,
            "agent-3",
            "Test 3",
        ));

        let high_alerts = manager.get_alerts_by_severity(AlertSeverity::High);
        assert_eq!(high_alerts.len(), 2);

        let medium_alerts = manager.get_alerts_by_severity(AlertSeverity::Medium);
        assert_eq!(medium_alerts.len(), 1);
    }

    #[test]
    fn test_agent_metrics_error_rate() {
        let mut metrics = AgentMetrics::new("agent-1", "test");
        metrics.api_calls = 10;
        metrics.api_calls_successful = 8;

        assert!((metrics.error_rate() - 0.2).abs() < 0.001);
    }

    #[test]
    fn test_agent_metrics_error_rate_zero_calls() {
        let metrics = AgentMetrics::new("agent-1", "test");
        assert_eq!(metrics.error_rate(), 0.0);
    }
}
