//! Agent Monitor
//!
//! Tracks agent execution metrics including duration,
//! tokens, API calls, tool calls, cost, and errors.
//!
//! This module provides:
//! - Agent execution tracking with start/stop lifecycle
//! - Token usage recording
//! - API call tracking with latency
//! - Tool call metrics with input/output sizes
//! - Cost tracking
//! - Error recording with context
//! - Metrics persistence to disk
//! - Aggregated statistics across all agents

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use super::alerts::{AgentExecutionStatus, ErrorRecord, TokenUsage};

/// Tool call metric for tracking individual tool executions
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallMetric {
    /// Unique identifier for this tool call
    pub id: String,
    /// Name of the tool
    pub tool_name: String,
    /// Start time of the tool call
    pub start_time: DateTime<Utc>,
    /// End time of the tool call (if completed)
    pub end_time: Option<DateTime<Utc>>,
    /// Duration of the tool call (if completed)
    pub duration: Option<Duration>,
    /// Whether the tool call succeeded
    pub success: bool,
    /// Error message if failed
    pub error: Option<String>,
    /// Input size in bytes
    pub input_size: Option<usize>,
    /// Output size in bytes
    pub output_size: Option<usize>,
}

impl ToolCallMetric {
    /// Create a new tool call metric
    pub fn new(tool_name: impl Into<String>) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            tool_name: tool_name.into(),
            start_time: Utc::now(),
            end_time: None,
            duration: None,
            success: false,
            error: None,
            input_size: None,
            output_size: None,
        }
    }

    /// Set input size
    pub fn with_input_size(mut self, size: usize) -> Self {
        self.input_size = Some(size);
        self
    }

    /// Complete the tool call
    pub fn complete(&mut self, success: bool, error: Option<String>) {
        self.end_time = Some(Utc::now());
        self.success = success;
        self.error = error;
        if let Some(end) = self.end_time {
            let elapsed = end.signed_duration_since(self.start_time);
            self.duration = elapsed.to_std().ok();
        }
    }

    /// Set output size
    pub fn set_output_size(&mut self, size: usize) {
        self.output_size = Some(size);
    }
}

/// Performance metrics for an agent
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceMetrics {
    /// Average API call latency
    pub avg_api_latency: Option<Duration>,
    /// Average tool call duration
    pub avg_tool_duration: Option<Duration>,
    /// Tokens per second
    pub tokens_per_second: Option<f64>,
    /// API calls per minute
    pub api_calls_per_minute: Option<f64>,
}

/// Full agent metrics for monitoring
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FullAgentMetrics {
    /// Agent ID
    pub agent_id: String,
    /// Agent type
    pub agent_type: String,
    /// Optional description
    pub description: Option<String>,
    /// Start time
    pub start_time: DateTime<Utc>,
    /// End time (if completed)
    pub end_time: Option<DateTime<Utc>>,
    /// Duration (if completed)
    #[serde(with = "optional_duration_serde")]
    pub duration: Option<Duration>,
    /// Execution status
    pub status: AgentExecutionStatus,
    /// Token usage
    pub tokens_used: TokenUsage,
    /// Number of API calls
    pub api_calls: usize,
    /// Number of successful API calls
    pub api_calls_successful: usize,
    /// Tool call metrics
    pub tool_calls: Vec<ToolCallMetric>,
    /// Total cost
    pub cost: f64,
    /// Errors encountered
    pub errors: Vec<ErrorRecord>,
    /// Performance metrics
    pub performance: PerformanceMetrics,
    /// Configured timeout
    #[serde(with = "optional_duration_serde")]
    pub timeout: Option<Duration>,
    /// API call latencies for calculating averages
    #[serde(skip)]
    api_latencies: Vec<Duration>,
}

/// Custom serialization for Option<Duration>
mod optional_duration_serde {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};
    use std::time::Duration;

    #[derive(Serialize, Deserialize)]
    struct DurationMs(u64);

    pub fn serialize<S>(duration: &Option<Duration>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match duration {
            Some(d) => serializer.serialize_some(&DurationMs(d.as_millis() as u64)),
            None => serializer.serialize_none(),
        }
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Option<Duration>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let opt: Option<DurationMs> = Option::deserialize(deserializer)?;
        Ok(opt.map(|d| Duration::from_millis(d.0)))
    }
}

impl FullAgentMetrics {
    /// Create new agent metrics
    pub fn new(agent_id: impl Into<String>, agent_type: impl Into<String>) -> Self {
        Self {
            agent_id: agent_id.into(),
            agent_type: agent_type.into(),
            description: None,
            start_time: Utc::now(),
            end_time: None,
            duration: None,
            status: AgentExecutionStatus::Running,
            tokens_used: TokenUsage::default(),
            api_calls: 0,
            api_calls_successful: 0,
            tool_calls: Vec::new(),
            cost: 0.0,
            errors: Vec::new(),
            performance: PerformanceMetrics::default(),
            timeout: None,
            api_latencies: Vec::new(),
        }
    }

    /// Set description
    pub fn with_description(mut self, description: impl Into<String>) -> Self {
        self.description = Some(description.into());
        self
    }

    /// Set timeout
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = Some(timeout);
        self
    }

    /// Record token usage
    pub fn record_tokens(&mut self, input: usize, output: usize) {
        self.tokens_used.input += input;
        self.tokens_used.output += output;
        self.tokens_used.total = self.tokens_used.input + self.tokens_used.output;
    }

    /// Record an API call
    pub fn record_api_call(&mut self, success: bool, latency: Option<Duration>) {
        self.api_calls += 1;
        if success {
            self.api_calls_successful += 1;
        }
        if let Some(lat) = latency {
            self.api_latencies.push(lat);
        }
    }

    /// Record cost
    pub fn record_cost(&mut self, cost: f64) {
        self.cost += cost;
    }

    /// Record an error
    pub fn record_error(&mut self, message: impl Into<String>, phase: Option<&str>) {
        let mut error = ErrorRecord::new(message);
        if let Some(p) = phase {
            error = error.with_phase(p);
        }
        self.errors.push(error);
    }

    /// Add a tool call metric
    pub fn add_tool_call(&mut self, metric: ToolCallMetric) {
        self.tool_calls.push(metric);
    }

    /// Complete the metrics tracking
    pub fn complete(&mut self, status: AgentExecutionStatus) {
        self.end_time = Some(Utc::now());
        self.status = status;
        if let Some(end) = self.end_time {
            let elapsed = end.signed_duration_since(self.start_time);
            self.duration = elapsed.to_std().ok();
        }
        self.calculate_performance();
    }

    /// Calculate performance metrics
    fn calculate_performance(&mut self) {
        // Average API latency
        if !self.api_latencies.is_empty() {
            let total: Duration = self.api_latencies.iter().sum();
            self.performance.avg_api_latency = Some(total / self.api_latencies.len() as u32);
        }

        // Average tool duration
        let completed_tools: Vec<_> = self.tool_calls.iter().filter_map(|t| t.duration).collect();
        if !completed_tools.is_empty() {
            let total: Duration = completed_tools.iter().sum();
            self.performance.avg_tool_duration = Some(total / completed_tools.len() as u32);
        }

        // Tokens per second
        if let Some(duration) = self.duration {
            let secs = duration.as_secs_f64();
            if secs > 0.0 {
                self.performance.tokens_per_second = Some(self.tokens_used.total as f64 / secs);
            }
        }

        // API calls per minute
        if let Some(duration) = self.duration {
            let mins = duration.as_secs_f64() / 60.0;
            if mins > 0.0 {
                self.performance.api_calls_per_minute = Some(self.api_calls as f64 / mins);
            }
        }
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
            let elapsed = Utc::now().signed_duration_since(self.start_time);
            if let Ok(elapsed_std) = elapsed.to_std() {
                return elapsed_std > timeout;
            }
        }
        false
    }
}

/// Monitor configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorConfig {
    /// Whether to track tool calls
    pub track_tool_calls: bool,
    /// Whether to track API latencies
    pub track_api_latencies: bool,
    /// Whether to persist metrics automatically
    pub auto_persist: bool,
    /// Maximum number of metrics to keep in memory
    pub max_metrics_in_memory: usize,
    /// Directory for persisting metrics
    pub metrics_dir: Option<PathBuf>,
}

impl Default for MonitorConfig {
    fn default() -> Self {
        Self {
            track_tool_calls: true,
            track_api_latencies: true,
            auto_persist: false,
            max_metrics_in_memory: 1000,
            metrics_dir: None,
        }
    }
}

/// Aggregated statistics across all agents
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AggregatedStats {
    /// Total number of agents tracked
    pub total_agents: usize,
    /// Number of completed agents
    pub completed_agents: usize,
    /// Number of failed agents
    pub failed_agents: usize,
    /// Number of running agents
    pub running_agents: usize,
    /// Total tokens used
    pub total_tokens: usize,
    /// Total API calls
    pub total_api_calls: usize,
    /// Total tool calls
    pub total_tool_calls: usize,
    /// Total cost
    pub total_cost: f64,
    /// Total errors
    pub total_errors: usize,
    /// Average duration (for completed agents)
    pub avg_duration: Option<Duration>,
    /// Average tokens per agent
    pub avg_tokens_per_agent: f64,
    /// Overall error rate
    pub overall_error_rate: f32,
}

/// Agent Monitor for tracking agent execution metrics
#[derive(Debug)]
pub struct AgentMonitor {
    /// Configuration
    config: MonitorConfig,
    /// Metrics indexed by agent ID
    metrics: HashMap<String, FullAgentMetrics>,
    /// Active tool calls indexed by tool call ID
    active_tool_calls: HashMap<String, (String, ToolCallMetric)>, // (agent_id, metric)
    /// Directory for persisting metrics
    metrics_dir: PathBuf,
}

impl Default for AgentMonitor {
    fn default() -> Self {
        Self::new(None)
    }
}

impl AgentMonitor {
    /// Create a new AgentMonitor
    pub fn new(config: Option<MonitorConfig>) -> Self {
        let config = config.unwrap_or_default();
        let metrics_dir = config
            .metrics_dir
            .clone()
            .unwrap_or_else(|| PathBuf::from(".aster/metrics"));

        Self {
            config,
            metrics: HashMap::new(),
            active_tool_calls: HashMap::new(),
            metrics_dir,
        }
    }

    /// Start tracking an agent
    pub fn start_tracking(&mut self, agent_id: &str, agent_type: &str, description: Option<&str>) {
        let mut metrics = FullAgentMetrics::new(agent_id, agent_type);
        if let Some(desc) = description {
            metrics = metrics.with_description(desc);
        }
        self.metrics.insert(agent_id.to_string(), metrics);
    }

    /// Start tracking an agent with timeout
    pub fn start_tracking_with_timeout(
        &mut self,
        agent_id: &str,
        agent_type: &str,
        description: Option<&str>,
        timeout: Duration,
    ) {
        let mut metrics = FullAgentMetrics::new(agent_id, agent_type).with_timeout(timeout);
        if let Some(desc) = description {
            metrics = metrics.with_description(desc);
        }
        self.metrics.insert(agent_id.to_string(), metrics);
    }

    /// Start a tool call and return its ID
    pub fn start_tool_call(
        &mut self,
        agent_id: &str,
        tool_name: &str,
        input_size: Option<usize>,
    ) -> String {
        if !self.config.track_tool_calls {
            return String::new();
        }

        let mut metric = ToolCallMetric::new(tool_name);
        if let Some(size) = input_size {
            metric = metric.with_input_size(size);
        }
        let id = metric.id.clone();
        self.active_tool_calls
            .insert(id.clone(), (agent_id.to_string(), metric));
        id
    }

    /// End a tool call
    pub fn end_tool_call(
        &mut self,
        agent_id: &str,
        tool_call_id: &str,
        success: bool,
        error: Option<&str>,
        output_size: Option<usize>,
    ) {
        if !self.config.track_tool_calls {
            return;
        }

        if let Some((stored_agent_id, mut metric)) = self.active_tool_calls.remove(tool_call_id) {
            if stored_agent_id != agent_id {
                // Mismatch, put it back
                self.active_tool_calls
                    .insert(tool_call_id.to_string(), (stored_agent_id, metric));
                return;
            }

            metric.complete(success, error.map(String::from));
            if let Some(size) = output_size {
                metric.set_output_size(size);
            }

            if let Some(agent_metrics) = self.metrics.get_mut(agent_id) {
                agent_metrics.add_tool_call(metric);
            }
        }
    }

    /// Record token usage for an agent
    pub fn record_tokens(&mut self, agent_id: &str, input: usize, output: usize) {
        if let Some(metrics) = self.metrics.get_mut(agent_id) {
            metrics.record_tokens(input, output);
        }
    }

    /// Record an API call for an agent
    pub fn record_api_call(&mut self, agent_id: &str, success: bool, latency: Option<Duration>) {
        if let Some(metrics) = self.metrics.get_mut(agent_id) {
            let lat = if self.config.track_api_latencies {
                latency
            } else {
                None
            };
            metrics.record_api_call(success, lat);
        }
    }

    /// Record cost for an agent
    pub fn record_cost(&mut self, agent_id: &str, cost: f64) {
        if let Some(metrics) = self.metrics.get_mut(agent_id) {
            metrics.record_cost(cost);
        }
    }

    /// Record an error for an agent
    pub fn record_error(&mut self, agent_id: &str, error: &str, phase: Option<&str>) {
        if let Some(metrics) = self.metrics.get_mut(agent_id) {
            metrics.record_error(error, phase);
        }
    }

    /// Stop tracking an agent
    pub fn stop_tracking(&mut self, agent_id: &str, status: AgentExecutionStatus) {
        if let Some(metrics) = self.metrics.get_mut(agent_id) {
            metrics.complete(status);

            if self.config.auto_persist {
                let _ = self.persist_metrics(agent_id);
            }
        }
    }

    /// Get metrics for an agent
    pub fn get_metrics(&self, agent_id: &str) -> Option<&FullAgentMetrics> {
        self.metrics.get(agent_id)
    }

    /// Get mutable metrics for an agent
    pub fn get_metrics_mut(&mut self, agent_id: &str) -> Option<&mut FullAgentMetrics> {
        self.metrics.get_mut(agent_id)
    }

    /// Get all metrics
    pub fn get_all_metrics(&self) -> Vec<&FullAgentMetrics> {
        self.metrics.values().collect()
    }

    /// Get metrics by status
    pub fn get_metrics_by_status(&self, status: AgentExecutionStatus) -> Vec<&FullAgentMetrics> {
        self.metrics
            .values()
            .filter(|m| m.status == status)
            .collect()
    }

    /// Remove metrics for an agent
    pub fn remove_metrics(&mut self, agent_id: &str) -> Option<FullAgentMetrics> {
        self.metrics.remove(agent_id)
    }

    /// Clear all metrics
    pub fn clear(&mut self) {
        self.metrics.clear();
        self.active_tool_calls.clear();
    }

    /// Get aggregated statistics
    pub fn get_aggregated_stats(&self) -> AggregatedStats {
        let mut stats = AggregatedStats {
            total_agents: self.metrics.len(),
            ..Default::default()
        };

        let mut total_duration = Duration::ZERO;
        let mut completed_count = 0usize;

        for metrics in self.metrics.values() {
            match metrics.status {
                AgentExecutionStatus::Completed => {
                    stats.completed_agents += 1;
                    if let Some(d) = metrics.duration {
                        total_duration += d;
                        completed_count += 1;
                    }
                }
                AgentExecutionStatus::Failed | AgentExecutionStatus::TimedOut => {
                    stats.failed_agents += 1;
                }
                AgentExecutionStatus::Running => {
                    stats.running_agents += 1;
                }
                AgentExecutionStatus::Cancelled => {}
            }

            stats.total_tokens += metrics.tokens_used.total;
            stats.total_api_calls += metrics.api_calls;
            stats.total_tool_calls += metrics.tool_calls.len();
            stats.total_cost += metrics.cost;
            stats.total_errors += metrics.errors.len();
        }

        if completed_count > 0 {
            stats.avg_duration = Some(total_duration / completed_count as u32);
        }

        if stats.total_agents > 0 {
            stats.avg_tokens_per_agent = stats.total_tokens as f64 / stats.total_agents as f64;
        }

        let total_successful: usize = self.metrics.values().map(|m| m.api_calls_successful).sum();
        if stats.total_api_calls > 0 {
            stats.overall_error_rate =
                (stats.total_api_calls - total_successful) as f32 / stats.total_api_calls as f32;
        }

        stats
    }

    /// Persist metrics for an agent to disk
    pub fn persist_metrics(&self, agent_id: &str) -> std::io::Result<()> {
        let metrics = match self.metrics.get(agent_id) {
            Some(m) => m,
            None => return Ok(()),
        };

        std::fs::create_dir_all(&self.metrics_dir)?;

        let file_path = self.metrics_dir.join(format!("{}.json", agent_id));
        let json = serde_json::to_string_pretty(metrics)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        std::fs::write(file_path, json)?;

        Ok(())
    }

    /// Load metrics for an agent from disk
    pub fn load_metrics(&mut self, agent_id: &str) -> std::io::Result<Option<FullAgentMetrics>> {
        let file_path = self.metrics_dir.join(format!("{}.json", agent_id));

        if !file_path.exists() {
            return Ok(None);
        }

        let json = std::fs::read_to_string(&file_path)?;
        let metrics: FullAgentMetrics = serde_json::from_str(&json)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;

        self.metrics.insert(agent_id.to_string(), metrics.clone());
        Ok(Some(metrics))
    }

    /// List all persisted metrics
    pub fn list_persisted_metrics(&self) -> std::io::Result<Vec<String>> {
        if !self.metrics_dir.exists() {
            return Ok(Vec::new());
        }

        let mut agent_ids = Vec::new();
        for entry in std::fs::read_dir(&self.metrics_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().is_some_and(|ext| ext == "json") {
                if let Some(stem) = path.file_stem() {
                    agent_ids.push(stem.to_string_lossy().to_string());
                }
            }
        }

        Ok(agent_ids)
    }

    /// Delete persisted metrics for an agent
    pub fn delete_persisted_metrics(&self, agent_id: &str) -> std::io::Result<bool> {
        let file_path = self.metrics_dir.join(format!("{}.json", agent_id));

        if file_path.exists() {
            std::fs::remove_file(file_path)?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// Get the number of tracked agents
    pub fn agent_count(&self) -> usize {
        self.metrics.len()
    }

    /// Get the number of active tool calls
    pub fn active_tool_call_count(&self) -> usize {
        self.active_tool_calls.len()
    }

    /// Update configuration
    pub fn set_config(&mut self, config: MonitorConfig) {
        if let Some(dir) = &config.metrics_dir {
            self.metrics_dir = dir.clone();
        }
        self.config = config;
    }

    /// Get current configuration
    pub fn config(&self) -> &MonitorConfig {
        &self.config
    }

    /// Set metrics directory
    pub fn set_metrics_dir(&mut self, dir: PathBuf) {
        self.metrics_dir = dir;
    }

    /// Get metrics directory
    pub fn metrics_dir(&self) -> &PathBuf {
        &self.metrics_dir
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tool_call_metric_creation() {
        let metric = ToolCallMetric::new("test_tool");

        assert!(!metric.id.is_empty());
        assert_eq!(metric.tool_name, "test_tool");
        assert!(!metric.success);
        assert!(metric.end_time.is_none());
        assert!(metric.duration.is_none());
    }

    #[test]
    fn test_tool_call_metric_complete() {
        let mut metric = ToolCallMetric::new("test_tool");
        std::thread::sleep(std::time::Duration::from_millis(10));
        metric.complete(true, None);

        assert!(metric.success);
        assert!(metric.end_time.is_some());
        assert!(metric.duration.is_some());
        assert!(metric.error.is_none());
    }

    #[test]
    fn test_tool_call_metric_with_error() {
        let mut metric = ToolCallMetric::new("test_tool");
        metric.complete(false, Some("Test error".to_string()));

        assert!(!metric.success);
        assert_eq!(metric.error, Some("Test error".to_string()));
    }

    #[test]
    fn test_full_agent_metrics_creation() {
        let metrics = FullAgentMetrics::new("agent-1", "test_agent");

        assert_eq!(metrics.agent_id, "agent-1");
        assert_eq!(metrics.agent_type, "test_agent");
        assert_eq!(metrics.status, AgentExecutionStatus::Running);
        assert_eq!(metrics.tokens_used.total, 0);
        assert_eq!(metrics.api_calls, 0);
        assert!(metrics.tool_calls.is_empty());
        assert_eq!(metrics.cost, 0.0);
        assert!(metrics.errors.is_empty());
    }

    #[test]
    fn test_full_agent_metrics_record_tokens() {
        let mut metrics = FullAgentMetrics::new("agent-1", "test");

        metrics.record_tokens(100, 50);
        assert_eq!(metrics.tokens_used.input, 100);
        assert_eq!(metrics.tokens_used.output, 50);
        assert_eq!(metrics.tokens_used.total, 150);

        metrics.record_tokens(50, 25);
        assert_eq!(metrics.tokens_used.input, 150);
        assert_eq!(metrics.tokens_used.output, 75);
        assert_eq!(metrics.tokens_used.total, 225);
    }

    #[test]
    fn test_full_agent_metrics_record_api_call() {
        let mut metrics = FullAgentMetrics::new("agent-1", "test");

        metrics.record_api_call(true, Some(Duration::from_millis(100)));
        metrics.record_api_call(true, Some(Duration::from_millis(200)));
        metrics.record_api_call(false, None);

        assert_eq!(metrics.api_calls, 3);
        assert_eq!(metrics.api_calls_successful, 2);
    }

    #[test]
    fn test_full_agent_metrics_error_rate() {
        let mut metrics = FullAgentMetrics::new("agent-1", "test");

        metrics.api_calls = 10;
        metrics.api_calls_successful = 8;

        assert!((metrics.error_rate() - 0.2).abs() < 0.001);
    }

    #[test]
    fn test_full_agent_metrics_error_rate_zero_calls() {
        let metrics = FullAgentMetrics::new("agent-1", "test");
        assert_eq!(metrics.error_rate(), 0.0);
    }

    #[test]
    fn test_full_agent_metrics_record_error() {
        let mut metrics = FullAgentMetrics::new("agent-1", "test");

        metrics.record_error("Test error 1", None);
        metrics.record_error("Test error 2", Some("api_call"));

        assert_eq!(metrics.errors.len(), 2);
        assert_eq!(metrics.errors[0].message, "Test error 1");
        assert!(metrics.errors[0].phase.is_none());
        assert_eq!(metrics.errors[1].message, "Test error 2");
        assert_eq!(metrics.errors[1].phase, Some("api_call".to_string()));
    }

    #[test]
    fn test_full_agent_metrics_complete() {
        let mut metrics = FullAgentMetrics::new("agent-1", "test");
        std::thread::sleep(std::time::Duration::from_millis(10));
        metrics.complete(AgentExecutionStatus::Completed);

        assert_eq!(metrics.status, AgentExecutionStatus::Completed);
        assert!(metrics.end_time.is_some());
        assert!(metrics.duration.is_some());
    }

    #[test]
    fn test_agent_monitor_creation() {
        let monitor = AgentMonitor::new(None);

        assert_eq!(monitor.agent_count(), 0);
        assert_eq!(monitor.active_tool_call_count(), 0);
    }

    #[test]
    fn test_agent_monitor_start_tracking() {
        let mut monitor = AgentMonitor::new(None);

        monitor.start_tracking("agent-1", "test_agent", Some("Test description"));

        assert_eq!(monitor.agent_count(), 1);
        let metrics = monitor.get_metrics("agent-1").unwrap();
        assert_eq!(metrics.agent_id, "agent-1");
        assert_eq!(metrics.agent_type, "test_agent");
        assert_eq!(metrics.description, Some("Test description".to_string()));
    }

    #[test]
    fn test_agent_monitor_record_tokens() {
        let mut monitor = AgentMonitor::new(None);
        monitor.start_tracking("agent-1", "test", None);

        monitor.record_tokens("agent-1", 100, 50);

        let metrics = monitor.get_metrics("agent-1").unwrap();
        assert_eq!(metrics.tokens_used.total, 150);
    }

    #[test]
    fn test_agent_monitor_record_api_call() {
        let mut monitor = AgentMonitor::new(None);
        monitor.start_tracking("agent-1", "test", None);

        monitor.record_api_call("agent-1", true, Some(Duration::from_millis(100)));
        monitor.record_api_call("agent-1", false, None);

        let metrics = monitor.get_metrics("agent-1").unwrap();
        assert_eq!(metrics.api_calls, 2);
        assert_eq!(metrics.api_calls_successful, 1);
    }

    #[test]
    fn test_agent_monitor_record_cost() {
        let mut monitor = AgentMonitor::new(None);
        monitor.start_tracking("agent-1", "test", None);

        monitor.record_cost("agent-1", 0.5);
        monitor.record_cost("agent-1", 0.3);

        let metrics = monitor.get_metrics("agent-1").unwrap();
        assert!((metrics.cost - 0.8).abs() < 0.001);
    }

    #[test]
    fn test_agent_monitor_record_error() {
        let mut monitor = AgentMonitor::new(None);
        monitor.start_tracking("agent-1", "test", None);

        monitor.record_error("agent-1", "Test error", Some("tool_call"));

        let metrics = monitor.get_metrics("agent-1").unwrap();
        assert_eq!(metrics.errors.len(), 1);
        assert_eq!(metrics.errors[0].message, "Test error");
    }

    #[test]
    fn test_agent_monitor_tool_call_tracking() {
        let mut monitor = AgentMonitor::new(None);
        monitor.start_tracking("agent-1", "test", None);

        let tool_call_id = monitor.start_tool_call("agent-1", "test_tool", Some(100));
        assert!(!tool_call_id.is_empty());
        assert_eq!(monitor.active_tool_call_count(), 1);

        monitor.end_tool_call("agent-1", &tool_call_id, true, None, Some(200));
        assert_eq!(monitor.active_tool_call_count(), 0);

        let metrics = monitor.get_metrics("agent-1").unwrap();
        assert_eq!(metrics.tool_calls.len(), 1);
        assert_eq!(metrics.tool_calls[0].tool_name, "test_tool");
        assert!(metrics.tool_calls[0].success);
        assert_eq!(metrics.tool_calls[0].input_size, Some(100));
        assert_eq!(metrics.tool_calls[0].output_size, Some(200));
    }

    #[test]
    fn test_agent_monitor_stop_tracking() {
        let mut monitor = AgentMonitor::new(None);
        monitor.start_tracking("agent-1", "test", None);

        monitor.stop_tracking("agent-1", AgentExecutionStatus::Completed);

        let metrics = monitor.get_metrics("agent-1").unwrap();
        assert_eq!(metrics.status, AgentExecutionStatus::Completed);
        assert!(metrics.end_time.is_some());
    }

    #[test]
    fn test_agent_monitor_get_metrics_by_status() {
        let mut monitor = AgentMonitor::new(None);

        monitor.start_tracking("agent-1", "test", None);
        monitor.start_tracking("agent-2", "test", None);
        monitor.start_tracking("agent-3", "test", None);

        monitor.stop_tracking("agent-1", AgentExecutionStatus::Completed);
        monitor.stop_tracking("agent-2", AgentExecutionStatus::Failed);

        let running = monitor.get_metrics_by_status(AgentExecutionStatus::Running);
        assert_eq!(running.len(), 1);

        let completed = monitor.get_metrics_by_status(AgentExecutionStatus::Completed);
        assert_eq!(completed.len(), 1);

        let failed = monitor.get_metrics_by_status(AgentExecutionStatus::Failed);
        assert_eq!(failed.len(), 1);
    }

    #[test]
    fn test_agent_monitor_aggregated_stats() {
        let mut monitor = AgentMonitor::new(None);

        monitor.start_tracking("agent-1", "test", None);
        monitor.record_tokens("agent-1", 100, 50);
        monitor.record_api_call("agent-1", true, None);
        monitor.record_cost("agent-1", 0.5);
        monitor.stop_tracking("agent-1", AgentExecutionStatus::Completed);

        monitor.start_tracking("agent-2", "test", None);
        monitor.record_tokens("agent-2", 200, 100);
        monitor.record_api_call("agent-2", false, None);
        monitor.record_cost("agent-2", 0.3);
        monitor.stop_tracking("agent-2", AgentExecutionStatus::Failed);

        let stats = monitor.get_aggregated_stats();

        assert_eq!(stats.total_agents, 2);
        assert_eq!(stats.completed_agents, 1);
        assert_eq!(stats.failed_agents, 1);
        assert_eq!(stats.total_tokens, 450);
        assert_eq!(stats.total_api_calls, 2);
        assert!((stats.total_cost - 0.8).abs() < 0.001);
        assert!((stats.overall_error_rate - 0.5).abs() < 0.001);
    }

    #[test]
    fn test_agent_monitor_remove_metrics() {
        let mut monitor = AgentMonitor::new(None);
        monitor.start_tracking("agent-1", "test", None);

        assert_eq!(monitor.agent_count(), 1);

        let removed = monitor.remove_metrics("agent-1");
        assert!(removed.is_some());
        assert_eq!(monitor.agent_count(), 0);
    }

    #[test]
    fn test_agent_monitor_clear() {
        let mut monitor = AgentMonitor::new(None);
        monitor.start_tracking("agent-1", "test", None);
        monitor.start_tracking("agent-2", "test", None);
        monitor.start_tool_call("agent-1", "tool", None);

        monitor.clear();

        assert_eq!(monitor.agent_count(), 0);
        assert_eq!(monitor.active_tool_call_count(), 0);
    }

    #[test]
    fn test_monitor_config_default() {
        let config = MonitorConfig::default();

        assert!(config.track_tool_calls);
        assert!(config.track_api_latencies);
        assert!(!config.auto_persist);
        assert_eq!(config.max_metrics_in_memory, 1000);
    }

    #[test]
    fn test_agent_monitor_with_config() {
        let config = MonitorConfig {
            track_tool_calls: false,
            track_api_latencies: false,
            auto_persist: false,
            max_metrics_in_memory: 100,
            metrics_dir: Some(PathBuf::from("/tmp/test_metrics")),
        };

        let mut monitor = AgentMonitor::new(Some(config));
        monitor.start_tracking("agent-1", "test", None);

        // Tool calls should not be tracked
        let tool_call_id = monitor.start_tool_call("agent-1", "test_tool", None);
        assert!(tool_call_id.is_empty());
        assert_eq!(monitor.active_tool_call_count(), 0);
    }

    #[test]
    fn test_full_agent_metrics_is_timed_out() {
        let mut metrics =
            FullAgentMetrics::new("agent-1", "test").with_timeout(Duration::from_millis(100));

        // Not timed out yet
        assert!(!metrics.is_timed_out());

        // Simulate completion with timeout exceeded
        metrics.duration = Some(Duration::from_millis(200));
        assert!(metrics.is_timed_out());
    }

    #[test]
    fn test_performance_metrics_calculation() {
        let mut metrics = FullAgentMetrics::new("agent-1", "test");

        // Record some API calls with latencies
        metrics.record_api_call(true, Some(Duration::from_millis(100)));
        metrics.record_api_call(true, Some(Duration::from_millis(200)));

        // Add some tool calls
        let mut tool1 = ToolCallMetric::new("tool1");
        tool1.complete(true, None);
        tool1.duration = Some(Duration::from_millis(50));
        metrics.add_tool_call(tool1);

        let mut tool2 = ToolCallMetric::new("tool2");
        tool2.complete(true, None);
        tool2.duration = Some(Duration::from_millis(150));
        metrics.add_tool_call(tool2);

        // Record tokens
        metrics.record_tokens(1000, 500);

        // Complete the metrics
        metrics.duration = Some(Duration::from_secs(1));
        metrics.complete(AgentExecutionStatus::Completed);

        // Check performance metrics
        assert!(metrics.performance.avg_api_latency.is_some());
        assert!(metrics.performance.avg_tool_duration.is_some());
        assert!(metrics.performance.tokens_per_second.is_some());

        // Average API latency should be 150ms
        let avg_api = metrics.performance.avg_api_latency.unwrap();
        assert!((avg_api.as_millis() as i64 - 150).abs() < 10);

        // Average tool duration should be 100ms
        let avg_tool = metrics.performance.avg_tool_duration.unwrap();
        assert!((avg_tool.as_millis() as i64 - 100).abs() < 10);
    }
}
