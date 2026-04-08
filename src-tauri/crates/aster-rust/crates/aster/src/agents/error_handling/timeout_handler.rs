//! Timeout Handler
//!
//! Provides timeout handling for agent execution.
//! Marks agents as timed out and emits timeout events.
//!
//! **Validates: Requirements 15.2**

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{broadcast, RwLock};

/// Timeout status for an agent
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TimeoutStatus {
    /// Agent is running normally
    #[default]
    Running,
    /// Agent is approaching timeout (warning)
    Warning,
    /// Agent has timed out
    TimedOut,
    /// Agent completed before timeout
    Completed,
    /// Agent was cancelled
    Cancelled,
}

impl std::fmt::Display for TimeoutStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TimeoutStatus::Running => write!(f, "running"),
            TimeoutStatus::Warning => write!(f, "warning"),
            TimeoutStatus::TimedOut => write!(f, "timed_out"),
            TimeoutStatus::Completed => write!(f, "completed"),
            TimeoutStatus::Cancelled => write!(f, "cancelled"),
        }
    }
}

/// Timeout configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeoutConfig {
    /// Maximum execution time
    pub timeout: Duration,
    /// Warning threshold (percentage of timeout, e.g., 0.8 = 80%)
    pub warning_threshold: f64,
    /// Whether to emit events
    pub emit_events: bool,
    /// Grace period after timeout before forced termination
    pub grace_period: Option<Duration>,
}

impl Default for TimeoutConfig {
    fn default() -> Self {
        Self {
            timeout: Duration::from_secs(300), // 5 minutes
            warning_threshold: 0.8,
            emit_events: true,
            grace_period: Some(Duration::from_secs(10)),
        }
    }
}

impl TimeoutConfig {
    /// Create a new timeout config
    pub fn new(timeout: Duration) -> Self {
        Self {
            timeout,
            ..Default::default()
        }
    }

    /// Set the warning threshold
    pub fn with_warning_threshold(mut self, threshold: f64) -> Self {
        self.warning_threshold = threshold.clamp(0.0, 1.0);
        self
    }

    /// Set whether to emit events
    pub fn with_emit_events(mut self, emit: bool) -> Self {
        self.emit_events = emit;
        self
    }

    /// Set the grace period
    pub fn with_grace_period(mut self, grace: Duration) -> Self {
        self.grace_period = Some(grace);
        self
    }

    /// Get the warning duration
    pub fn warning_duration(&self) -> Duration {
        Duration::from_secs_f64(self.timeout.as_secs_f64() * self.warning_threshold)
    }
}

/// Timeout event emitted when timeout status changes
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeoutEvent {
    /// Agent ID
    pub agent_id: String,
    /// Previous status
    pub previous_status: TimeoutStatus,
    /// New status
    pub new_status: TimeoutStatus,
    /// Elapsed time
    pub elapsed: Duration,
    /// Configured timeout
    pub timeout: Duration,
    /// Event timestamp
    pub timestamp: DateTime<Utc>,
    /// Additional message
    pub message: Option<String>,
}

impl TimeoutEvent {
    /// Create a new timeout event
    pub fn new(
        agent_id: impl Into<String>,
        previous_status: TimeoutStatus,
        new_status: TimeoutStatus,
        elapsed: Duration,
        timeout: Duration,
    ) -> Self {
        Self {
            agent_id: agent_id.into(),
            previous_status,
            new_status,
            elapsed,
            timeout,
            timestamp: Utc::now(),
            message: None,
        }
    }

    /// Set the message
    pub fn with_message(mut self, message: impl Into<String>) -> Self {
        self.message = Some(message.into());
        self
    }

    /// Check if this is a timeout event
    pub fn is_timeout(&self) -> bool {
        self.new_status == TimeoutStatus::TimedOut
    }

    /// Check if this is a warning event
    pub fn is_warning(&self) -> bool {
        self.new_status == TimeoutStatus::Warning
    }
}

/// Tracked agent information
#[derive(Debug, Clone)]
#[allow(dead_code)]
struct TrackedAgent {
    agent_id: String,
    config: TimeoutConfig,
    start_time: DateTime<Utc>,
    status: TimeoutStatus,
    warning_emitted: bool,
}

impl TrackedAgent {
    fn new(agent_id: impl Into<String>, config: TimeoutConfig) -> Self {
        Self {
            agent_id: agent_id.into(),
            config,
            start_time: Utc::now(),
            status: TimeoutStatus::Running,
            warning_emitted: false,
        }
    }

    fn elapsed(&self) -> Duration {
        let elapsed = Utc::now().signed_duration_since(self.start_time);
        elapsed.to_std().unwrap_or(Duration::ZERO)
    }

    fn is_timed_out(&self) -> bool {
        self.elapsed() > self.config.timeout
    }

    fn is_warning(&self) -> bool {
        let elapsed = self.elapsed();
        elapsed > self.config.warning_duration() && elapsed <= self.config.timeout
    }
}

/// Timeout handler for managing agent timeouts
#[derive(Debug)]
pub struct TimeoutHandler {
    /// Tracked agents
    agents: HashMap<String, TrackedAgent>,
    /// Event sender
    event_sender: broadcast::Sender<TimeoutEvent>,
    /// Default configuration
    default_config: TimeoutConfig,
}

impl Default for TimeoutHandler {
    fn default() -> Self {
        Self::new()
    }
}

impl TimeoutHandler {
    /// Create a new timeout handler
    pub fn new() -> Self {
        let (event_sender, _) = broadcast::channel(100);
        Self {
            agents: HashMap::new(),
            event_sender,
            default_config: TimeoutConfig::default(),
        }
    }

    /// Create with custom default configuration
    pub fn with_default_config(config: TimeoutConfig) -> Self {
        let (event_sender, _) = broadcast::channel(100);
        Self {
            agents: HashMap::new(),
            event_sender,
            default_config: config,
        }
    }

    /// Start tracking an agent with default config
    pub fn start_tracking(&mut self, agent_id: &str) {
        self.start_tracking_with_config(agent_id, self.default_config.clone());
    }

    /// Start tracking an agent with custom config
    pub fn start_tracking_with_config(&mut self, agent_id: &str, config: TimeoutConfig) {
        let agent = TrackedAgent::new(agent_id, config);
        self.agents.insert(agent_id.to_string(), agent);
    }

    /// Stop tracking an agent
    pub fn stop_tracking(&mut self, agent_id: &str, completed: bool) -> Option<TimeoutEvent> {
        if let Some(agent) = self.agents.remove(agent_id) {
            let previous_status = agent.status;
            let new_status = if completed {
                TimeoutStatus::Completed
            } else {
                TimeoutStatus::Cancelled
            };

            if agent.config.emit_events && previous_status != new_status {
                let event = TimeoutEvent::new(
                    agent_id,
                    previous_status,
                    new_status,
                    agent.elapsed(),
                    agent.config.timeout,
                );
                let _ = self.event_sender.send(event.clone());
                return Some(event);
            }
        }
        None
    }

    /// Check timeout status for an agent
    pub fn check_status(&mut self, agent_id: &str) -> Option<TimeoutStatus> {
        let agent = self.agents.get_mut(agent_id)?;

        let previous_status = agent.status;

        if agent.is_timed_out() {
            agent.status = TimeoutStatus::TimedOut;
        } else if agent.is_warning() && !agent.warning_emitted {
            agent.status = TimeoutStatus::Warning;
            agent.warning_emitted = true;
        }

        // Emit event if status changed
        if agent.config.emit_events && agent.status != previous_status {
            let event = TimeoutEvent::new(
                agent_id,
                previous_status,
                agent.status,
                agent.elapsed(),
                agent.config.timeout,
            );
            let _ = self.event_sender.send(event);
        }

        Some(agent.status)
    }

    /// Check all agents and return timed out ones
    pub fn check_all(&mut self) -> Vec<TimeoutEvent> {
        let mut events = Vec::new();
        let agent_ids: Vec<_> = self.agents.keys().cloned().collect();

        for agent_id in agent_ids {
            if let Some(agent) = self.agents.get_mut(&agent_id) {
                let previous_status = agent.status;

                if agent.is_timed_out() && agent.status != TimeoutStatus::TimedOut {
                    agent.status = TimeoutStatus::TimedOut;

                    if agent.config.emit_events {
                        let event = TimeoutEvent::new(
                            &agent_id,
                            previous_status,
                            TimeoutStatus::TimedOut,
                            agent.elapsed(),
                            agent.config.timeout,
                        )
                        .with_message(format!(
                            "Agent {} timed out after {:?}",
                            agent_id,
                            agent.elapsed()
                        ));
                        let _ = self.event_sender.send(event.clone());
                        events.push(event);
                    }
                } else if agent.is_warning()
                    && !agent.warning_emitted
                    && agent.status == TimeoutStatus::Running
                {
                    agent.status = TimeoutStatus::Warning;
                    agent.warning_emitted = true;

                    if agent.config.emit_events {
                        let event = TimeoutEvent::new(
                            &agent_id,
                            previous_status,
                            TimeoutStatus::Warning,
                            agent.elapsed(),
                            agent.config.timeout,
                        )
                        .with_message(format!(
                            "Agent {} approaching timeout ({:?} / {:?})",
                            agent_id,
                            agent.elapsed(),
                            agent.config.timeout
                        ));
                        let _ = self.event_sender.send(event.clone());
                        events.push(event);
                    }
                }
            }
        }

        events
    }

    /// Mark an agent as timed out
    pub fn mark_timed_out(&mut self, agent_id: &str) -> Option<TimeoutEvent> {
        let agent = self.agents.get_mut(agent_id)?;

        if agent.status == TimeoutStatus::TimedOut {
            return None;
        }

        let previous_status = agent.status;
        agent.status = TimeoutStatus::TimedOut;

        if agent.config.emit_events {
            let event = TimeoutEvent::new(
                agent_id,
                previous_status,
                TimeoutStatus::TimedOut,
                agent.elapsed(),
                agent.config.timeout,
            )
            .with_message(format!("Agent {} manually marked as timed out", agent_id));
            let _ = self.event_sender.send(event.clone());
            return Some(event);
        }

        None
    }

    /// Get the status of an agent
    pub fn get_status(&self, agent_id: &str) -> Option<TimeoutStatus> {
        self.agents.get(agent_id).map(|a| a.status)
    }

    /// Get elapsed time for an agent
    pub fn get_elapsed(&self, agent_id: &str) -> Option<Duration> {
        self.agents.get(agent_id).map(|a| a.elapsed())
    }

    /// Get remaining time for an agent
    pub fn get_remaining(&self, agent_id: &str) -> Option<Duration> {
        self.agents.get(agent_id).map(|a| {
            let elapsed = a.elapsed();
            if elapsed >= a.config.timeout {
                Duration::ZERO
            } else {
                a.config.timeout - elapsed
            }
        })
    }

    /// Check if an agent is timed out
    pub fn is_timed_out(&self, agent_id: &str) -> bool {
        self.agents
            .get(agent_id)
            .map(|a| a.status == TimeoutStatus::TimedOut || a.is_timed_out())
            .unwrap_or(false)
    }

    /// Subscribe to timeout events
    pub fn subscribe(&self) -> broadcast::Receiver<TimeoutEvent> {
        self.event_sender.subscribe()
    }

    /// Get the number of tracked agents
    pub fn tracked_count(&self) -> usize {
        self.agents.len()
    }

    /// Get all timed out agents
    pub fn get_timed_out_agents(&self) -> Vec<&str> {
        self.agents
            .iter()
            .filter(|(_, a)| a.status == TimeoutStatus::TimedOut || a.is_timed_out())
            .map(|(id, _)| id.as_str())
            .collect()
    }

    /// Clear all tracked agents
    pub fn clear(&mut self) {
        self.agents.clear();
    }

    /// Set default configuration
    pub fn set_default_config(&mut self, config: TimeoutConfig) {
        self.default_config = config;
    }
}

/// Thread-safe timeout handler wrapper
#[allow(dead_code)]
pub type SharedTimeoutHandler = Arc<RwLock<TimeoutHandler>>;

/// Create a new shared timeout handler
#[allow(dead_code)]
pub fn new_shared_timeout_handler() -> SharedTimeoutHandler {
    Arc::new(RwLock::new(TimeoutHandler::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_timeout_config_default() {
        let config = TimeoutConfig::default();
        assert_eq!(config.timeout, Duration::from_secs(300));
        assert!((config.warning_threshold - 0.8).abs() < 0.001);
        assert!(config.emit_events);
    }

    #[test]
    fn test_timeout_config_warning_duration() {
        let config = TimeoutConfig::new(Duration::from_secs(100)).with_warning_threshold(0.8);
        assert_eq!(config.warning_duration(), Duration::from_secs(80));
    }

    #[test]
    fn test_timeout_event_creation() {
        let event = TimeoutEvent::new(
            "agent-1",
            TimeoutStatus::Running,
            TimeoutStatus::TimedOut,
            Duration::from_secs(100),
            Duration::from_secs(60),
        );

        assert_eq!(event.agent_id, "agent-1");
        assert!(event.is_timeout());
        assert!(!event.is_warning());
    }

    #[test]
    fn test_timeout_handler_start_tracking() {
        let mut handler = TimeoutHandler::new();
        handler.start_tracking("agent-1");

        assert_eq!(handler.tracked_count(), 1);
        assert_eq!(handler.get_status("agent-1"), Some(TimeoutStatus::Running));
    }

    #[test]
    fn test_timeout_handler_stop_tracking() {
        let mut handler = TimeoutHandler::new();
        handler.start_tracking("agent-1");

        let event = handler.stop_tracking("agent-1", true);
        assert!(event.is_some());
        assert_eq!(handler.tracked_count(), 0);
    }

    #[test]
    fn test_timeout_handler_mark_timed_out() {
        let mut handler = TimeoutHandler::new();
        handler.start_tracking("agent-1");

        let event = handler.mark_timed_out("agent-1");
        assert!(event.is_some());
        assert!(handler.is_timed_out("agent-1"));
    }

    #[test]
    fn test_timeout_handler_get_remaining() {
        let mut handler = TimeoutHandler::new();
        let config = TimeoutConfig::new(Duration::from_secs(100));
        handler.start_tracking_with_config("agent-1", config);

        let remaining = handler.get_remaining("agent-1");
        assert!(remaining.is_some());
        // Should be close to 100 seconds (minus small elapsed time)
        assert!(remaining.unwrap() > Duration::from_secs(99));
    }

    #[test]
    fn test_timeout_status_display() {
        assert_eq!(format!("{}", TimeoutStatus::Running), "running");
        assert_eq!(format!("{}", TimeoutStatus::TimedOut), "timed_out");
        assert_eq!(format!("{}", TimeoutStatus::Warning), "warning");
    }
}
