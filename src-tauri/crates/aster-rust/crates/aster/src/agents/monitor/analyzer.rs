//! Performance Analyzer
//!
//! Analyzes agent performance, identifies bottlenecks,
//! and provides optimization suggestions.
//!
//! This module provides:
//! - Performance scoring across multiple dimensions
//! - Bottleneck identification
//! - Optimization suggestions
//! - Performance ratings (excellent, good, fair, poor)

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::metrics::FullAgentMetrics;

/// Performance rating levels
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PerformanceRating {
    /// Excellent performance (score >= 80)
    Excellent,
    /// Good performance (score >= 60)
    Good,
    /// Fair performance (score >= 40)
    Fair,
    /// Poor performance (score < 40)
    Poor,
}

impl PerformanceRating {
    /// Get rating from score (0-100)
    pub fn from_score(score: f32) -> Self {
        if score >= 80.0 {
            Self::Excellent
        } else if score >= 60.0 {
            Self::Good
        } else if score >= 40.0 {
            Self::Fair
        } else {
            Self::Poor
        }
    }
}

impl std::fmt::Display for PerformanceRating {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Excellent => write!(f, "excellent"),
            Self::Good => write!(f, "good"),
            Self::Fair => write!(f, "fair"),
            Self::Poor => write!(f, "poor"),
        }
    }
}

/// Bottleneck category
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BottleneckCategory {
    /// High API latency
    HighLatency,
    /// Slow tool execution
    SlowTools,
    /// High error rate
    HighErrorRate,
    /// High cost
    HighCost,
    /// Low throughput
    LowThroughput,
    /// Timeout issues
    TimeoutRisk,
}

impl std::fmt::Display for BottleneckCategory {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::HighLatency => write!(f, "high_latency"),
            Self::SlowTools => write!(f, "slow_tools"),
            Self::HighErrorRate => write!(f, "high_error_rate"),
            Self::HighCost => write!(f, "high_cost"),
            Self::LowThroughput => write!(f, "low_throughput"),
            Self::TimeoutRisk => write!(f, "timeout_risk"),
        }
    }
}

/// A performance bottleneck
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bottleneck {
    /// Category of the bottleneck
    pub category: BottleneckCategory,
    /// Severity (0-100, higher is worse)
    pub severity: f32,
    /// Description of the bottleneck
    pub description: String,
    /// Affected component (e.g., tool name)
    pub affected_component: Option<String>,
    /// Current value that triggered the bottleneck
    pub current_value: Option<String>,
    /// Threshold that was exceeded
    pub threshold: Option<String>,
}

impl Bottleneck {
    /// Create a new bottleneck
    pub fn new(
        category: BottleneckCategory,
        severity: f32,
        description: impl Into<String>,
    ) -> Self {
        Self {
            category,
            severity: severity.clamp(0.0, 100.0),
            description: description.into(),
            affected_component: None,
            current_value: None,
            threshold: None,
        }
    }

    /// Set affected component
    pub fn with_component(mut self, component: impl Into<String>) -> Self {
        self.affected_component = Some(component.into());
        self
    }

    /// Set current value
    pub fn with_current_value(mut self, value: impl Into<String>) -> Self {
        self.current_value = Some(value.into());
        self
    }

    /// Set threshold
    pub fn with_threshold(mut self, threshold: impl Into<String>) -> Self {
        self.threshold = Some(threshold.into());
        self
    }
}

/// Suggestion priority
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SuggestionPriority {
    /// Low priority suggestion
    Low,
    /// Medium priority suggestion
    Medium,
    /// High priority suggestion
    High,
}

/// An optimization suggestion
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    /// Priority of the suggestion
    pub priority: SuggestionPriority,
    /// Title of the suggestion
    pub title: String,
    /// Detailed description
    pub description: String,
    /// Expected improvement
    pub expected_improvement: Option<String>,
    /// Related bottleneck category
    pub related_to: Option<BottleneckCategory>,
}

impl Suggestion {
    /// Create a new suggestion
    pub fn new(
        priority: SuggestionPriority,
        title: impl Into<String>,
        description: impl Into<String>,
    ) -> Self {
        Self {
            priority,
            title: title.into(),
            description: description.into(),
            expected_improvement: None,
            related_to: None,
        }
    }

    /// Set expected improvement
    pub fn with_improvement(mut self, improvement: impl Into<String>) -> Self {
        self.expected_improvement = Some(improvement.into());
        self
    }

    /// Set related bottleneck
    pub fn with_related_to(mut self, category: BottleneckCategory) -> Self {
        self.related_to = Some(category);
        self
    }
}

/// Performance scores across dimensions
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceScores {
    /// Latency score (0-100)
    pub latency_score: f32,
    /// Throughput score (0-100)
    pub throughput_score: f32,
    /// Error rate score (0-100)
    pub error_rate_score: f32,
    /// Cost efficiency score (0-100)
    pub cost_efficiency_score: f32,
    /// Tool efficiency score (0-100)
    pub tool_efficiency_score: f32,
}

impl PerformanceScores {
    /// Calculate overall score as weighted average
    pub fn overall(&self) -> f32 {
        let weights = [0.25, 0.20, 0.25, 0.15, 0.15];
        let scores = [
            self.latency_score,
            self.throughput_score,
            self.error_rate_score,
            self.cost_efficiency_score,
            self.tool_efficiency_score,
        ];

        let weighted_sum: f32 = scores.iter().zip(weights.iter()).map(|(s, w)| s * w).sum();
        weighted_sum.clamp(0.0, 100.0)
    }
}

/// Performance report for an agent
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceReport {
    /// Agent ID
    pub agent_id: String,
    /// Overall performance score (0-100)
    pub overall_score: f32,
    /// Performance rating
    pub rating: PerformanceRating,
    /// Detailed scores
    pub scores: PerformanceScores,
    /// Identified bottlenecks
    pub bottlenecks: Vec<Bottleneck>,
    /// Optimization suggestions
    pub suggestions: Vec<Suggestion>,
    /// Report timestamp
    pub timestamp: DateTime<Utc>,
}

impl PerformanceReport {
    /// Create a new performance report
    pub fn new(agent_id: impl Into<String>, scores: PerformanceScores) -> Self {
        let overall_score = scores.overall();
        Self {
            agent_id: agent_id.into(),
            overall_score,
            rating: PerformanceRating::from_score(overall_score),
            scores,
            bottlenecks: Vec::new(),
            suggestions: Vec::new(),
            timestamp: Utc::now(),
        }
    }

    /// Add a bottleneck
    pub fn add_bottleneck(&mut self, bottleneck: Bottleneck) {
        self.bottlenecks.push(bottleneck);
    }

    /// Add a suggestion
    pub fn add_suggestion(&mut self, suggestion: Suggestion) {
        self.suggestions.push(suggestion);
    }
}

/// Thresholds for performance analysis
#[derive(Debug, Clone)]
pub struct AnalysisThresholds {
    /// Good API latency threshold (ms)
    pub good_latency_ms: u64,
    /// Poor API latency threshold (ms)
    pub poor_latency_ms: u64,
    /// Good tool duration threshold (ms)
    pub good_tool_duration_ms: u64,
    /// Poor tool duration threshold (ms)
    pub poor_tool_duration_ms: u64,
    /// Good error rate threshold
    pub good_error_rate: f32,
    /// Poor error rate threshold
    pub poor_error_rate: f32,
    /// Good tokens per second
    pub good_tokens_per_second: f64,
    /// Poor tokens per second
    pub poor_tokens_per_second: f64,
    /// Cost per 1000 tokens (good)
    pub good_cost_per_1k_tokens: f64,
    /// Cost per 1000 tokens (poor)
    pub poor_cost_per_1k_tokens: f64,
}

impl Default for AnalysisThresholds {
    fn default() -> Self {
        Self {
            good_latency_ms: 500,
            poor_latency_ms: 2000,
            good_tool_duration_ms: 1000,
            poor_tool_duration_ms: 5000,
            good_error_rate: 0.05,
            poor_error_rate: 0.20,
            good_tokens_per_second: 50.0,
            poor_tokens_per_second: 10.0,
            good_cost_per_1k_tokens: 0.01,
            poor_cost_per_1k_tokens: 0.05,
        }
    }
}

/// Performance Analyzer
#[derive(Debug, Clone)]
pub struct PerformanceAnalyzer {
    /// Analysis thresholds
    thresholds: AnalysisThresholds,
}

impl Default for PerformanceAnalyzer {
    fn default() -> Self {
        Self::new()
    }
}

impl PerformanceAnalyzer {
    /// Create a new PerformanceAnalyzer
    pub fn new() -> Self {
        Self {
            thresholds: AnalysisThresholds::default(),
        }
    }

    /// Create with custom thresholds
    pub fn with_thresholds(thresholds: AnalysisThresholds) -> Self {
        Self { thresholds }
    }

    /// Analyze multiple agents
    pub fn analyze(&self, metrics: &[FullAgentMetrics]) -> Vec<PerformanceReport> {
        metrics.iter().map(|m| self.analyze_agent(m)).collect()
    }

    /// Analyze a single agent
    pub fn analyze_agent(&self, metrics: &FullAgentMetrics) -> PerformanceReport {
        let scores = self.calculate_scores(metrics);
        let mut report = PerformanceReport::new(&metrics.agent_id, scores);

        // Identify bottlenecks
        let bottlenecks = self.identify_bottlenecks(metrics);
        for bottleneck in bottlenecks {
            report.add_bottleneck(bottleneck);
        }

        // Generate suggestions
        let suggestions = self.suggest_optimizations(metrics);
        for suggestion in suggestions {
            report.add_suggestion(suggestion);
        }

        report
    }

    /// Calculate performance scores
    fn calculate_scores(&self, metrics: &FullAgentMetrics) -> PerformanceScores {
        PerformanceScores {
            latency_score: self.calculate_latency_score(metrics),
            throughput_score: self.calculate_throughput_score(metrics),
            error_rate_score: self.calculate_error_rate_score(metrics),
            cost_efficiency_score: self.calculate_cost_efficiency_score(metrics),
            tool_efficiency_score: self.calculate_tool_efficiency_score(metrics),
        }
    }

    /// Calculate latency score (0-100)
    fn calculate_latency_score(&self, metrics: &FullAgentMetrics) -> f32 {
        let avg_latency_ms = metrics
            .performance
            .avg_api_latency
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        if avg_latency_ms == 0 {
            return 100.0; // No latency data, assume good
        }

        self.score_from_range(
            avg_latency_ms as f64,
            self.thresholds.good_latency_ms as f64,
            self.thresholds.poor_latency_ms as f64,
            true, // Lower is better
        )
    }

    /// Calculate throughput score (0-100)
    fn calculate_throughput_score(&self, metrics: &FullAgentMetrics) -> f32 {
        let tokens_per_second = metrics.performance.tokens_per_second.unwrap_or(0.0);

        if tokens_per_second == 0.0 {
            return 50.0; // No data, neutral score
        }

        self.score_from_range(
            tokens_per_second,
            self.thresholds.poor_tokens_per_second,
            self.thresholds.good_tokens_per_second,
            false, // Higher is better
        )
    }

    /// Calculate error rate score (0-100)
    fn calculate_error_rate_score(&self, metrics: &FullAgentMetrics) -> f32 {
        let error_rate = metrics.error_rate();

        self.score_from_range(
            error_rate as f64,
            self.thresholds.good_error_rate as f64,
            self.thresholds.poor_error_rate as f64,
            true, // Lower is better
        )
    }

    /// Calculate cost efficiency score (0-100)
    fn calculate_cost_efficiency_score(&self, metrics: &FullAgentMetrics) -> f32 {
        let total_tokens = metrics.tokens_used.total;
        if total_tokens == 0 {
            return 100.0; // No tokens used, no cost
        }

        let cost_per_1k = (metrics.cost / total_tokens as f64) * 1000.0;

        self.score_from_range(
            cost_per_1k,
            self.thresholds.good_cost_per_1k_tokens,
            self.thresholds.poor_cost_per_1k_tokens,
            true, // Lower is better
        )
    }

    /// Calculate tool efficiency score (0-100)
    fn calculate_tool_efficiency_score(&self, metrics: &FullAgentMetrics) -> f32 {
        let avg_tool_duration_ms = metrics
            .performance
            .avg_tool_duration
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        if avg_tool_duration_ms == 0 {
            return 100.0; // No tool calls or very fast
        }

        self.score_from_range(
            avg_tool_duration_ms as f64,
            self.thresholds.good_tool_duration_ms as f64,
            self.thresholds.poor_tool_duration_ms as f64,
            true, // Lower is better
        )
    }

    /// Calculate score from a range
    /// If lower_is_better is true, values <= good get 100, values >= poor get 0
    /// If lower_is_better is false, values >= good get 100, values <= poor get 0
    fn score_from_range(&self, value: f64, good: f64, poor: f64, lower_is_better: bool) -> f32 {
        if lower_is_better {
            if value <= good {
                100.0
            } else if value >= poor {
                0.0
            } else {
                let range = poor - good;
                let position = value - good;
                (100.0 * (1.0 - position / range)) as f32
            }
        } else if value >= good {
            100.0
        } else if value <= poor {
            0.0
        } else {
            let range = good - poor;
            let position = value - poor;
            (100.0 * (position / range)) as f32
        }
    }

    /// Identify performance bottlenecks
    pub fn identify_bottlenecks(&self, metrics: &FullAgentMetrics) -> Vec<Bottleneck> {
        let mut bottlenecks = Vec::new();

        // Check API latency
        if let Some(avg_latency) = metrics.performance.avg_api_latency {
            let latency_ms = avg_latency.as_millis() as u64;
            if latency_ms > self.thresholds.poor_latency_ms {
                let severity = ((latency_ms as f32 / self.thresholds.poor_latency_ms as f32)
                    * 50.0)
                    .min(100.0);
                bottlenecks.push(
                    Bottleneck::new(
                        BottleneckCategory::HighLatency,
                        severity,
                        format!("API latency is {}ms, exceeding threshold", latency_ms),
                    )
                    .with_current_value(format!("{}ms", latency_ms))
                    .with_threshold(format!("{}ms", self.thresholds.poor_latency_ms)),
                );
            }
        }

        // Check tool duration
        if let Some(avg_tool_duration) = metrics.performance.avg_tool_duration {
            let duration_ms = avg_tool_duration.as_millis() as u64;
            if duration_ms > self.thresholds.poor_tool_duration_ms {
                let severity =
                    ((duration_ms as f32 / self.thresholds.poor_tool_duration_ms as f32) * 50.0)
                        .min(100.0);

                // Find the slowest tool
                let slowest_tool = metrics
                    .tool_calls
                    .iter()
                    .filter_map(|t| t.duration.map(|d| (t.tool_name.clone(), d)))
                    .max_by_key(|(_, d)| d.as_millis());

                let mut bottleneck = Bottleneck::new(
                    BottleneckCategory::SlowTools,
                    severity,
                    format!(
                        "Average tool duration is {}ms, exceeding threshold",
                        duration_ms
                    ),
                )
                .with_current_value(format!("{}ms", duration_ms))
                .with_threshold(format!("{}ms", self.thresholds.poor_tool_duration_ms));

                if let Some((tool_name, _)) = slowest_tool {
                    bottleneck = bottleneck.with_component(tool_name);
                }

                bottlenecks.push(bottleneck);
            }
        }

        // Check error rate
        let error_rate = metrics.error_rate();
        if error_rate > self.thresholds.poor_error_rate {
            let severity = ((error_rate / self.thresholds.poor_error_rate) * 50.0).min(100.0);
            bottlenecks.push(
                Bottleneck::new(
                    BottleneckCategory::HighErrorRate,
                    severity,
                    format!(
                        "Error rate is {:.1}%, exceeding threshold",
                        error_rate * 100.0
                    ),
                )
                .with_current_value(format!("{:.1}%", error_rate * 100.0))
                .with_threshold(format!("{:.1}%", self.thresholds.poor_error_rate * 100.0)),
            );
        }

        // Check cost
        let total_tokens = metrics.tokens_used.total;
        if total_tokens > 0 {
            let cost_per_1k = (metrics.cost / total_tokens as f64) * 1000.0;
            if cost_per_1k > self.thresholds.poor_cost_per_1k_tokens {
                let severity = ((cost_per_1k / self.thresholds.poor_cost_per_1k_tokens) * 50.0)
                    .min(100.0) as f32;
                bottlenecks.push(
                    Bottleneck::new(
                        BottleneckCategory::HighCost,
                        severity,
                        format!(
                            "Cost per 1K tokens is ${:.4}, exceeding threshold",
                            cost_per_1k
                        ),
                    )
                    .with_current_value(format!("${:.4}", cost_per_1k))
                    .with_threshold(format!("${:.4}", self.thresholds.poor_cost_per_1k_tokens)),
                );
            }
        }

        // Check throughput
        if let Some(tokens_per_second) = metrics.performance.tokens_per_second {
            if tokens_per_second < self.thresholds.poor_tokens_per_second && tokens_per_second > 0.0
            {
                let severity = ((self.thresholds.poor_tokens_per_second / tokens_per_second) * 25.0)
                    .min(100.0) as f32;
                bottlenecks.push(
                    Bottleneck::new(
                        BottleneckCategory::LowThroughput,
                        severity,
                        format!(
                            "Throughput is {:.1} tokens/sec, below threshold",
                            tokens_per_second
                        ),
                    )
                    .with_current_value(format!("{:.1} tokens/sec", tokens_per_second))
                    .with_threshold(format!(
                        "{:.1} tokens/sec",
                        self.thresholds.poor_tokens_per_second
                    )),
                );
            }
        }

        // Check timeout risk
        if let (Some(timeout), Some(duration)) = (metrics.timeout, metrics.duration) {
            let usage_ratio = duration.as_millis() as f64 / timeout.as_millis() as f64;
            if usage_ratio > 0.8 {
                let severity = ((usage_ratio - 0.8) * 500.0).min(100.0) as f32;
                bottlenecks.push(
                    Bottleneck::new(
                        BottleneckCategory::TimeoutRisk,
                        severity,
                        format!(
                            "Execution used {:.0}% of timeout budget",
                            usage_ratio * 100.0
                        ),
                    )
                    .with_current_value(format!("{:.0}%", usage_ratio * 100.0))
                    .with_threshold("80%".to_string()),
                );
            }
        }

        // Sort by severity (highest first)
        bottlenecks.sort_by(|a, b| {
            b.severity
                .partial_cmp(&a.severity)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        bottlenecks
    }

    /// Generate optimization suggestions
    pub fn suggest_optimizations(&self, metrics: &FullAgentMetrics) -> Vec<Suggestion> {
        let mut suggestions = Vec::new();

        // Latency suggestions
        if let Some(avg_latency) = metrics.performance.avg_api_latency {
            let latency_ms = avg_latency.as_millis() as u64;
            if latency_ms > self.thresholds.good_latency_ms {
                let priority = if latency_ms > self.thresholds.poor_latency_ms {
                    SuggestionPriority::High
                } else {
                    SuggestionPriority::Medium
                };
                suggestions.push(
                    Suggestion::new(
                        priority,
                        "Reduce API latency",
                        "Consider batching API calls or using a faster model for simple tasks",
                    )
                    .with_improvement("Could reduce latency by 30-50%")
                    .with_related_to(BottleneckCategory::HighLatency),
                );
            }
        }

        // Tool efficiency suggestions
        if let Some(avg_tool_duration) = metrics.performance.avg_tool_duration {
            let duration_ms = avg_tool_duration.as_millis() as u64;
            if duration_ms > self.thresholds.good_tool_duration_ms {
                let priority = if duration_ms > self.thresholds.poor_tool_duration_ms {
                    SuggestionPriority::High
                } else {
                    SuggestionPriority::Medium
                };

                // Find slow tools
                let slow_tools: Vec<_> = metrics
                    .tool_calls
                    .iter()
                    .filter(|t| {
                        t.duration
                            .map(|d| d.as_millis() as u64 > self.thresholds.good_tool_duration_ms)
                            .unwrap_or(false)
                    })
                    .map(|t| t.tool_name.clone())
                    .collect();

                let description = if slow_tools.is_empty() {
                    "Optimize tool execution by caching results or parallelizing calls".to_string()
                } else {
                    format!(
                        "Optimize slow tools: {}. Consider caching or parallelization",
                        slow_tools.join(", ")
                    )
                };

                suggestions.push(
                    Suggestion::new(priority, "Optimize tool execution", description)
                        .with_improvement("Could reduce tool execution time by 20-40%")
                        .with_related_to(BottleneckCategory::SlowTools),
                );
            }
        }

        // Error rate suggestions
        let error_rate = metrics.error_rate();
        if error_rate > self.thresholds.good_error_rate {
            let priority = if error_rate > self.thresholds.poor_error_rate {
                SuggestionPriority::High
            } else {
                SuggestionPriority::Medium
            };
            suggestions.push(
                Suggestion::new(
                    priority,
                    "Reduce error rate",
                    "Implement retry logic with exponential backoff, or improve input validation",
                )
                .with_improvement("Could reduce errors by 50-70%")
                .with_related_to(BottleneckCategory::HighErrorRate),
            );
        }

        // Cost suggestions
        let total_tokens = metrics.tokens_used.total;
        if total_tokens > 0 {
            let cost_per_1k = (metrics.cost / total_tokens as f64) * 1000.0;
            if cost_per_1k > self.thresholds.good_cost_per_1k_tokens {
                let priority = if cost_per_1k > self.thresholds.poor_cost_per_1k_tokens {
                    SuggestionPriority::High
                } else {
                    SuggestionPriority::Medium
                };
                suggestions.push(
                    Suggestion::new(
                        priority,
                        "Reduce costs",
                        "Consider using a smaller model for simple tasks, or implement prompt caching",
                    )
                    .with_improvement("Could reduce costs by 30-60%")
                    .with_related_to(BottleneckCategory::HighCost),
                );
            }
        }

        // Throughput suggestions
        if let Some(tokens_per_second) = metrics.performance.tokens_per_second {
            if tokens_per_second < self.thresholds.good_tokens_per_second && tokens_per_second > 0.0
            {
                let priority = if tokens_per_second < self.thresholds.poor_tokens_per_second {
                    SuggestionPriority::High
                } else {
                    SuggestionPriority::Medium
                };
                suggestions.push(
                    Suggestion::new(
                        priority,
                        "Improve throughput",
                        "Consider streaming responses or parallel processing for independent tasks",
                    )
                    .with_improvement("Could improve throughput by 2-3x")
                    .with_related_to(BottleneckCategory::LowThroughput),
                );
            }
        }

        // Timeout risk suggestions
        if let (Some(timeout), Some(duration)) = (metrics.timeout, metrics.duration) {
            let usage_ratio = duration.as_millis() as f64 / timeout.as_millis() as f64;
            if usage_ratio > 0.8 {
                suggestions.push(
                    Suggestion::new(
                        SuggestionPriority::High,
                        "Address timeout risk",
                        "Increase timeout or optimize execution to reduce duration",
                    )
                    .with_improvement("Prevent potential timeout failures")
                    .with_related_to(BottleneckCategory::TimeoutRisk),
                );
            }
        }

        // General suggestions based on overall performance
        if metrics.tool_calls.len() > 10 {
            let failed_tools = metrics.tool_calls.iter().filter(|t| !t.success).count();
            if failed_tools > 2 {
                suggestions.push(
                    Suggestion::new(
                        SuggestionPriority::Medium,
                        "Review tool call patterns",
                        format!(
                            "{} out of {} tool calls failed. Review tool usage patterns",
                            failed_tools,
                            metrics.tool_calls.len()
                        ),
                    )
                    .with_improvement("Could improve reliability"),
                );
            }
        }

        // Sort by priority (highest first)
        suggestions.sort_by(|a, b| b.priority.cmp(&a.priority));

        suggestions
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[allow(unused_imports)]
    use crate::agents::monitor::alerts::AgentExecutionStatus;

    fn create_test_metrics(agent_id: &str) -> FullAgentMetrics {
        FullAgentMetrics::new(agent_id, "test")
    }

    #[test]
    fn test_performance_rating_from_score() {
        assert_eq!(
            PerformanceRating::from_score(100.0),
            PerformanceRating::Excellent
        );
        assert_eq!(
            PerformanceRating::from_score(80.0),
            PerformanceRating::Excellent
        );
        assert_eq!(PerformanceRating::from_score(79.9), PerformanceRating::Good);
        assert_eq!(PerformanceRating::from_score(60.0), PerformanceRating::Good);
        assert_eq!(PerformanceRating::from_score(59.9), PerformanceRating::Fair);
        assert_eq!(PerformanceRating::from_score(40.0), PerformanceRating::Fair);
        assert_eq!(PerformanceRating::from_score(39.9), PerformanceRating::Poor);
        assert_eq!(PerformanceRating::from_score(0.0), PerformanceRating::Poor);
    }

    #[test]
    fn test_bottleneck_creation() {
        let bottleneck = Bottleneck::new(
            BottleneckCategory::HighLatency,
            75.0,
            "High latency detected",
        )
        .with_component("api_call")
        .with_current_value("2500ms")
        .with_threshold("2000ms");

        assert_eq!(bottleneck.category, BottleneckCategory::HighLatency);
        assert_eq!(bottleneck.severity, 75.0);
        assert_eq!(bottleneck.affected_component, Some("api_call".to_string()));
        assert_eq!(bottleneck.current_value, Some("2500ms".to_string()));
        assert_eq!(bottleneck.threshold, Some("2000ms".to_string()));
    }

    #[test]
    fn test_suggestion_creation() {
        let suggestion = Suggestion::new(SuggestionPriority::High, "Reduce latency", "Use caching")
            .with_improvement("30% improvement")
            .with_related_to(BottleneckCategory::HighLatency);

        assert_eq!(suggestion.priority, SuggestionPriority::High);
        assert_eq!(suggestion.title, "Reduce latency");
        assert_eq!(
            suggestion.expected_improvement,
            Some("30% improvement".to_string())
        );
        assert_eq!(suggestion.related_to, Some(BottleneckCategory::HighLatency));
    }

    #[test]
    fn test_performance_scores_overall() {
        let scores = PerformanceScores {
            latency_score: 80.0,
            throughput_score: 60.0,
            error_rate_score: 100.0,
            cost_efficiency_score: 70.0,
            tool_efficiency_score: 50.0,
        };

        // Weighted: 80*0.25 + 60*0.20 + 100*0.25 + 70*0.15 + 50*0.15
        // = 20 + 12 + 25 + 10.5 + 7.5 = 75
        let overall = scores.overall();
        assert!((overall - 75.0).abs() < 0.1);
    }

    #[test]
    fn test_analyzer_creation() {
        let analyzer = PerformanceAnalyzer::new();
        assert_eq!(analyzer.thresholds.good_latency_ms, 500);
        assert_eq!(analyzer.thresholds.poor_latency_ms, 2000);
    }

    #[test]
    fn test_analyze_agent_basic() {
        let analyzer = PerformanceAnalyzer::new();
        let metrics = create_test_metrics("agent-1");

        let report = analyzer.analyze_agent(&metrics);

        assert_eq!(report.agent_id, "agent-1");
        assert!(report.overall_score >= 0.0 && report.overall_score <= 100.0);
    }

    #[test]
    fn test_analyze_multiple_agents() {
        let analyzer = PerformanceAnalyzer::new();
        let metrics = vec![
            create_test_metrics("agent-1"),
            create_test_metrics("agent-2"),
            create_test_metrics("agent-3"),
        ];

        let reports = analyzer.analyze(&metrics);

        assert_eq!(reports.len(), 3);
        assert_eq!(reports[0].agent_id, "agent-1");
        assert_eq!(reports[1].agent_id, "agent-2");
        assert_eq!(reports[2].agent_id, "agent-3");
    }

    #[test]
    fn test_identify_bottlenecks_high_error_rate() {
        let analyzer = PerformanceAnalyzer::new();
        let mut metrics = create_test_metrics("agent-1");
        metrics.api_calls = 10;
        metrics.api_calls_successful = 5; // 50% error rate

        let bottlenecks = analyzer.identify_bottlenecks(&metrics);

        assert!(!bottlenecks.is_empty());
        assert!(bottlenecks
            .iter()
            .any(|b| b.category == BottleneckCategory::HighErrorRate));
    }

    #[test]
    fn test_identify_bottlenecks_high_cost() {
        let analyzer = PerformanceAnalyzer::new();
        let mut metrics = create_test_metrics("agent-1");
        metrics.tokens_used.total = 1000;
        metrics.cost = 1.0; // $1 per 1000 tokens = very high

        let bottlenecks = analyzer.identify_bottlenecks(&metrics);

        assert!(!bottlenecks.is_empty());
        assert!(bottlenecks
            .iter()
            .any(|b| b.category == BottleneckCategory::HighCost));
    }

    #[test]
    fn test_suggest_optimizations_high_error_rate() {
        let analyzer = PerformanceAnalyzer::new();
        let mut metrics = create_test_metrics("agent-1");
        metrics.api_calls = 10;
        metrics.api_calls_successful = 5;

        let suggestions = analyzer.suggest_optimizations(&metrics);

        assert!(!suggestions.is_empty());
        assert!(suggestions.iter().any(|s| s.title.contains("error")));
    }

    #[test]
    fn test_score_from_range_lower_is_better() {
        let analyzer = PerformanceAnalyzer::new();

        // Value at good threshold = 100
        assert_eq!(analyzer.score_from_range(500.0, 500.0, 2000.0, true), 100.0);

        // Value at poor threshold = 0
        assert_eq!(analyzer.score_from_range(2000.0, 500.0, 2000.0, true), 0.0);

        // Value below good = 100
        assert_eq!(analyzer.score_from_range(100.0, 500.0, 2000.0, true), 100.0);

        // Value above poor = 0
        assert_eq!(analyzer.score_from_range(3000.0, 500.0, 2000.0, true), 0.0);

        // Value in middle
        let mid_score = analyzer.score_from_range(1250.0, 500.0, 2000.0, true);
        assert!((mid_score - 50.0).abs() < 1.0);
    }

    #[test]
    fn test_score_from_range_higher_is_better() {
        let analyzer = PerformanceAnalyzer::new();

        // For higher_is_better=false: good is the high value, poor is the low value
        // Value at good threshold (50) = 100
        assert_eq!(analyzer.score_from_range(50.0, 50.0, 10.0, false), 100.0);

        // Value at poor threshold (10) = 0
        assert_eq!(analyzer.score_from_range(10.0, 50.0, 10.0, false), 0.0);

        // Value above good = 100
        assert_eq!(analyzer.score_from_range(100.0, 50.0, 10.0, false), 100.0);

        // Value below poor = 0
        assert_eq!(analyzer.score_from_range(5.0, 50.0, 10.0, false), 0.0);

        // Value in middle (30 is halfway between 10 and 50)
        let mid_score = analyzer.score_from_range(30.0, 50.0, 10.0, false);
        assert!((mid_score - 50.0).abs() < 1.0);
    }

    #[test]
    fn test_performance_report_creation() {
        let scores = PerformanceScores {
            latency_score: 80.0,
            throughput_score: 80.0,
            error_rate_score: 80.0,
            cost_efficiency_score: 80.0,
            tool_efficiency_score: 80.0,
        };

        let report = PerformanceReport::new("agent-1", scores);

        assert_eq!(report.agent_id, "agent-1");
        assert_eq!(report.overall_score, 80.0);
        assert_eq!(report.rating, PerformanceRating::Excellent);
    }

    #[test]
    fn test_bottleneck_severity_clamping() {
        let bottleneck = Bottleneck::new(BottleneckCategory::HighLatency, 150.0, "Test");
        assert_eq!(bottleneck.severity, 100.0);

        let bottleneck = Bottleneck::new(BottleneckCategory::HighLatency, -10.0, "Test");
        assert_eq!(bottleneck.severity, 0.0);
    }
}
