//! Property-based tests for Performance Analyzer
//!
//! These tests verify the correctness properties defined in the design document
//! for the performance analysis system.
//!
//! **Property 30: Performance Scoring Consistency**
//! **Property 31: Bottleneck Detection**
//! **Validates: Requirements 10.1, 10.2, 10.3, 10.4**

use proptest::prelude::*;
use std::time::Duration;

use super::analyzer::{
    BottleneckCategory, PerformanceAnalyzer, PerformanceRating, PerformanceScores,
};
#[allow(unused_imports)]
use super::metrics::{FullAgentMetrics, PerformanceMetrics, ToolCallMetric};
#[allow(unused_imports)]
use crate::agents::monitor::alerts::AgentExecutionStatus;

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

/// Strategy for generating performance scores (0-100)
fn score_strategy() -> impl Strategy<Value = f32> {
    0.0f32..=100.0f32
}

/// Strategy for generating API latency in milliseconds
fn latency_ms_strategy() -> impl Strategy<Value = u64> {
    0u64..5000u64
}

/// Strategy for generating tool duration in milliseconds
fn tool_duration_ms_strategy() -> impl Strategy<Value = u64> {
    0u64..10000u64
}

/// Strategy for generating error rates (0.0 - 1.0)
fn error_rate_strategy() -> impl Strategy<Value = f32> {
    0.0f32..1.0f32
}

/// Strategy for generating tokens per second
fn tokens_per_second_strategy() -> impl Strategy<Value = f64> {
    0.0f64..200.0f64
}

/// Strategy for generating cost per 1k tokens
fn cost_per_1k_strategy() -> impl Strategy<Value = f64> {
    0.0f64..0.2f64
}

/// Create metrics with specific performance characteristics
#[allow(clippy::too_many_arguments)]
fn create_metrics_with_performance(
    agent_id: &str,
    agent_type: &str,
    avg_latency_ms: Option<u64>,
    avg_tool_duration_ms: Option<u64>,
    tokens_per_second: Option<f64>,
    error_rate: f32,
    cost_per_1k: f64,
    total_tokens: usize,
) -> FullAgentMetrics {
    let mut metrics = FullAgentMetrics::new(agent_id, agent_type);

    // Set performance metrics
    metrics.performance = PerformanceMetrics {
        avg_api_latency: avg_latency_ms.map(Duration::from_millis),
        avg_tool_duration: avg_tool_duration_ms.map(Duration::from_millis),
        tokens_per_second,
        api_calls_per_minute: None,
    };

    // Set token usage
    metrics.tokens_used.total = total_tokens;
    metrics.tokens_used.input = total_tokens / 2;
    metrics.tokens_used.output = total_tokens - (total_tokens / 2);

    // Set cost based on cost_per_1k
    if total_tokens > 0 {
        metrics.cost = (cost_per_1k * total_tokens as f64) / 1000.0;
    }

    // Set API calls to achieve the error rate
    if error_rate > 0.0 {
        let total_calls = 100usize;
        let successful = ((1.0 - error_rate) * total_calls as f32) as usize;
        metrics.api_calls = total_calls;
        metrics.api_calls_successful = successful;
    } else {
        metrics.api_calls = 10;
        metrics.api_calls_successful = 10;
    }

    metrics
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    // **Property 30: Performance Scoring Consistency**
    //
    // *For any* agent metrics, performance analysis SHALL produce scores in valid ranges (0-100)
    // with ratings (excellent, good, fair, poor) matching score thresholds.
    //
    // **Validates: Requirements 10.1, 10.4**

    #[test]
    fn property_30_scores_in_valid_range(
        agent_id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
        latency_ms in proptest::option::of(latency_ms_strategy()),
        tool_duration_ms in proptest::option::of(tool_duration_ms_strategy()),
        tokens_per_sec in proptest::option::of(tokens_per_second_strategy()),
        error_rate in error_rate_strategy(),
        cost_per_1k in cost_per_1k_strategy(),
        total_tokens in 100usize..10000usize,
    ) {
        let metrics = create_metrics_with_performance(
            &agent_id,
            &agent_type,
            latency_ms,
            tool_duration_ms,
            tokens_per_sec,
            error_rate,
            cost_per_1k,
            total_tokens,
        );

        let analyzer = PerformanceAnalyzer::new();
        let report = analyzer.analyze_agent(&metrics);

        // All scores should be in valid range [0, 100]
        prop_assert!(
            report.overall_score >= 0.0 && report.overall_score <= 100.0,
            "Overall score {} out of range [0, 100]",
            report.overall_score
        );
        prop_assert!(
            report.scores.latency_score >= 0.0 && report.scores.latency_score <= 100.0,
            "Latency score {} out of range",
            report.scores.latency_score
        );
        prop_assert!(
            report.scores.throughput_score >= 0.0 && report.scores.throughput_score <= 100.0,
            "Throughput score {} out of range",
            report.scores.throughput_score
        );
        prop_assert!(
            report.scores.error_rate_score >= 0.0 && report.scores.error_rate_score <= 100.0,
            "Error rate score {} out of range",
            report.scores.error_rate_score
        );
        prop_assert!(
            report.scores.cost_efficiency_score >= 0.0 && report.scores.cost_efficiency_score <= 100.0,
            "Cost efficiency score {} out of range",
            report.scores.cost_efficiency_score
        );
        prop_assert!(
            report.scores.tool_efficiency_score >= 0.0 && report.scores.tool_efficiency_score <= 100.0,
            "Tool efficiency score {} out of range",
            report.scores.tool_efficiency_score
        );
    }

    #[test]
    fn property_30_rating_matches_score_thresholds(
        latency_score in score_strategy(),
        throughput_score in score_strategy(),
        error_rate_score in score_strategy(),
        cost_efficiency_score in score_strategy(),
        tool_efficiency_score in score_strategy(),
    ) {
        let scores = PerformanceScores {
            latency_score,
            throughput_score,
            error_rate_score,
            cost_efficiency_score,
            tool_efficiency_score,
        };

        let overall = scores.overall();
        let rating = PerformanceRating::from_score(overall);

        // Verify rating matches score thresholds
        match rating {
            PerformanceRating::Excellent => {
                prop_assert!(
                    overall >= 80.0,
                    "Excellent rating requires score >= 80, got {}",
                    overall
                );
            }
            PerformanceRating::Good => {
                prop_assert!(
                    (60.0..80.0).contains(&overall),
                    "Good rating requires 60 <= score < 80, got {}",
                    overall
                );
            }
            PerformanceRating::Fair => {
                prop_assert!(
                    (40.0..60.0).contains(&overall),
                    "Fair rating requires 40 <= score < 60, got {}",
                    overall
                );
            }
            PerformanceRating::Poor => {
                prop_assert!(
                    overall < 40.0,
                    "Poor rating requires score < 40, got {}",
                    overall
                );
            }
        }
    }

    #[test]
    fn property_30_overall_score_is_weighted_average(
        latency_score in score_strategy(),
        throughput_score in score_strategy(),
        error_rate_score in score_strategy(),
        cost_efficiency_score in score_strategy(),
        tool_efficiency_score in score_strategy(),
    ) {
        let scores = PerformanceScores {
            latency_score,
            throughput_score,
            error_rate_score,
            cost_efficiency_score,
            tool_efficiency_score,
        };

        let overall = scores.overall();

        // Calculate expected weighted average
        // Weights: latency=0.25, throughput=0.20, error_rate=0.25, cost=0.15, tool=0.15
        let expected = latency_score * 0.25
            + throughput_score * 0.20
            + error_rate_score * 0.25
            + cost_efficiency_score * 0.15
            + tool_efficiency_score * 0.15;

        let expected_clamped = expected.clamp(0.0, 100.0);

        prop_assert!(
            (overall - expected_clamped).abs() < 0.01,
            "Overall score {} doesn't match expected weighted average {}",
            overall,
            expected_clamped
        );
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    // **Property 31: Bottleneck Detection**
    //
    // *For any* agent with performance issues (high latency, slow tools, high error rate),
    // bottleneck detection SHALL identify the issues and provide suggestions.
    //
    // **Validates: Requirements 10.2, 10.3**

    #[test]
    fn property_31_high_latency_detected(
        agent_id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
        // Generate latency above poor threshold (2000ms)
        latency_ms in 2001u64..10000u64,
    ) {
        let metrics = create_metrics_with_performance(
            &agent_id,
            &agent_type,
            Some(latency_ms),
            None,
            Some(50.0),
            0.0,
            0.01,
            1000,
        );

        let analyzer = PerformanceAnalyzer::new();
        let bottlenecks = analyzer.identify_bottlenecks(&metrics);

        // Should detect high latency bottleneck
        let has_latency_bottleneck = bottlenecks
            .iter()
            .any(|b| b.category == BottleneckCategory::HighLatency);

        prop_assert!(
            has_latency_bottleneck,
            "High latency ({}ms) should be detected as bottleneck",
            latency_ms
        );
    }

    #[test]
    fn property_31_slow_tools_detected(
        agent_id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
        // Generate tool duration above poor threshold (5000ms)
        tool_duration_ms in 5001u64..20000u64,
    ) {
        let metrics = create_metrics_with_performance(
            &agent_id,
            &agent_type,
            Some(500),
            Some(tool_duration_ms),
            Some(50.0),
            0.0,
            0.01,
            1000,
        );

        let analyzer = PerformanceAnalyzer::new();
        let bottlenecks = analyzer.identify_bottlenecks(&metrics);

        // Should detect slow tools bottleneck
        let has_slow_tools_bottleneck = bottlenecks
            .iter()
            .any(|b| b.category == BottleneckCategory::SlowTools);

        prop_assert!(
            has_slow_tools_bottleneck,
            "Slow tools ({}ms) should be detected as bottleneck",
            tool_duration_ms
        );
    }

    #[test]
    fn property_31_high_error_rate_detected(
        agent_id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
        // Generate error rate above poor threshold (0.20)
        error_rate in 0.21f32..1.0f32,
    ) {
        let metrics = create_metrics_with_performance(
            &agent_id,
            &agent_type,
            Some(500),
            Some(1000),
            Some(50.0),
            error_rate,
            0.01,
            1000,
        );

        let analyzer = PerformanceAnalyzer::new();
        let bottlenecks = analyzer.identify_bottlenecks(&metrics);

        // Should detect high error rate bottleneck
        let has_error_rate_bottleneck = bottlenecks
            .iter()
            .any(|b| b.category == BottleneckCategory::HighErrorRate);

        prop_assert!(
            has_error_rate_bottleneck,
            "High error rate ({:.1}%) should be detected as bottleneck",
            error_rate * 100.0
        );
    }

    #[test]
    fn property_31_high_cost_detected(
        agent_id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
        // Generate cost per 1k above poor threshold (0.05)
        cost_per_1k in 0.051f64..1.0f64,
    ) {
        let metrics = create_metrics_with_performance(
            &agent_id,
            &agent_type,
            Some(500),
            Some(1000),
            Some(50.0),
            0.0,
            cost_per_1k,
            1000,
        );

        let analyzer = PerformanceAnalyzer::new();
        let bottlenecks = analyzer.identify_bottlenecks(&metrics);

        // Should detect high cost bottleneck
        let has_cost_bottleneck = bottlenecks
            .iter()
            .any(|b| b.category == BottleneckCategory::HighCost);

        prop_assert!(
            has_cost_bottleneck,
            "High cost (${:.4}/1k tokens) should be detected as bottleneck",
            cost_per_1k
        );
    }

    #[test]
    fn property_31_low_throughput_detected(
        agent_id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
        // Generate throughput below poor threshold (10 tokens/sec) but > 0
        tokens_per_sec in 0.1f64..9.9f64,
    ) {
        let metrics = create_metrics_with_performance(
            &agent_id,
            &agent_type,
            Some(500),
            Some(1000),
            Some(tokens_per_sec),
            0.0,
            0.01,
            1000,
        );

        let analyzer = PerformanceAnalyzer::new();
        let bottlenecks = analyzer.identify_bottlenecks(&metrics);

        // Should detect low throughput bottleneck
        let has_throughput_bottleneck = bottlenecks
            .iter()
            .any(|b| b.category == BottleneckCategory::LowThroughput);

        prop_assert!(
            has_throughput_bottleneck,
            "Low throughput ({:.1} tokens/sec) should be detected as bottleneck",
            tokens_per_sec
        );
    }

    #[test]
    fn property_31_no_false_positives_for_good_performance(
        agent_id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
    ) {
        // Create metrics with good performance (below all thresholds)
        let metrics = create_metrics_with_performance(
            &agent_id,
            &agent_type,
            Some(300),   // Good latency (< 500ms)
            Some(500),   // Good tool duration (< 1000ms)
            Some(100.0), // Good throughput (> 50 tokens/sec)
            0.02,        // Good error rate (< 5%)
            0.005,       // Good cost (< 0.01 per 1k)
            1000,
        );

        let analyzer = PerformanceAnalyzer::new();
        let bottlenecks = analyzer.identify_bottlenecks(&metrics);

        // Should not detect any bottlenecks for good performance
        prop_assert!(
            bottlenecks.is_empty(),
            "Good performance should not trigger bottlenecks, but found: {:?}",
            bottlenecks.iter().map(|b| &b.category).collect::<Vec<_>>()
        );
    }

    #[test]
    fn property_31_suggestions_provided_for_bottlenecks(
        agent_id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
        // Generate at least one poor metric
        latency_ms in 2001u64..5000u64,
    ) {
        let metrics = create_metrics_with_performance(
            &agent_id,
            &agent_type,
            Some(latency_ms),
            None,
            Some(50.0),
            0.0,
            0.01,
            1000,
        );

        let analyzer = PerformanceAnalyzer::new();
        let report = analyzer.analyze_agent(&metrics);

        // If there are bottlenecks, there should be suggestions
        if !report.bottlenecks.is_empty() {
            prop_assert!(
                !report.suggestions.is_empty(),
                "Bottlenecks detected but no suggestions provided"
            );
        }
    }

    #[test]
    fn property_31_bottleneck_severity_in_valid_range(
        agent_id in agent_id_strategy(),
        agent_type in agent_type_strategy(),
        latency_ms in 0u64..10000u64,
        tool_duration_ms in 0u64..20000u64,
        error_rate in 0.0f32..1.0f32,
        cost_per_1k in 0.0f64..1.0f64,
        tokens_per_sec in 0.1f64..200.0f64,
    ) {
        let metrics = create_metrics_with_performance(
            &agent_id,
            &agent_type,
            Some(latency_ms),
            Some(tool_duration_ms),
            Some(tokens_per_sec),
            error_rate,
            cost_per_1k,
            1000,
        );

        let analyzer = PerformanceAnalyzer::new();
        let bottlenecks = analyzer.identify_bottlenecks(&metrics);

        // All bottleneck severities should be in valid range [0, 100]
        for bottleneck in &bottlenecks {
            prop_assert!(
                bottleneck.severity >= 0.0 && bottleneck.severity <= 100.0,
                "Bottleneck severity {} out of range [0, 100] for {:?}",
                bottleneck.severity,
                bottleneck.category
            );
        }
    }
}

// Additional tests for edge cases and consistency
#[cfg(test)]
mod additional_tests {
    use super::*;

    #[test]
    fn test_analyze_empty_metrics() {
        let analyzer = PerformanceAnalyzer::new();
        let metrics = FullAgentMetrics::new("agent-1", "test");

        let report = analyzer.analyze_agent(&metrics);

        // Should produce valid report even with empty metrics
        assert!(report.overall_score >= 0.0 && report.overall_score <= 100.0);
    }

    #[test]
    fn test_analyze_multiple_bottlenecks() {
        let mut metrics = FullAgentMetrics::new("agent-1", "test");

        // Set multiple poor metrics
        metrics.performance.avg_api_latency = Some(Duration::from_millis(3000));
        metrics.performance.avg_tool_duration = Some(Duration::from_millis(8000));
        metrics.api_calls = 100;
        metrics.api_calls_successful = 50; // 50% error rate
        metrics.tokens_used.total = 1000;
        metrics.cost = 0.1; // $0.10 per 1k tokens

        let analyzer = PerformanceAnalyzer::new();
        let bottlenecks = analyzer.identify_bottlenecks(&metrics);

        // Should detect multiple bottlenecks
        assert!(bottlenecks.len() >= 3, "Expected at least 3 bottlenecks");

        // Verify different categories are detected
        let categories: Vec<_> = bottlenecks.iter().map(|b| &b.category).collect();
        assert!(categories.contains(&&BottleneckCategory::HighLatency));
        assert!(categories.contains(&&BottleneckCategory::SlowTools));
        assert!(categories.contains(&&BottleneckCategory::HighErrorRate));
    }

    #[test]
    fn test_bottlenecks_sorted_by_severity() {
        let mut metrics = FullAgentMetrics::new("agent-1", "test");

        // Set multiple poor metrics with different severities
        metrics.performance.avg_api_latency = Some(Duration::from_millis(5000)); // Very high
        metrics.api_calls = 100;
        metrics.api_calls_successful = 80; // 20% error rate (just above threshold)
        metrics.tokens_used.total = 1000;
        metrics.cost = 0.06; // Just above threshold

        let analyzer = PerformanceAnalyzer::new();
        let bottlenecks = analyzer.identify_bottlenecks(&metrics);

        // Verify bottlenecks are sorted by severity (highest first)
        for i in 1..bottlenecks.len() {
            assert!(
                bottlenecks[i - 1].severity >= bottlenecks[i].severity,
                "Bottlenecks not sorted by severity"
            );
        }
    }

    #[test]
    fn test_suggestions_sorted_by_priority() {
        let mut metrics = FullAgentMetrics::new("agent-1", "test");

        // Set multiple poor metrics
        metrics.performance.avg_api_latency = Some(Duration::from_millis(3000));
        metrics.api_calls = 100;
        metrics.api_calls_successful = 50;

        let analyzer = PerformanceAnalyzer::new();
        let suggestions = analyzer.suggest_optimizations(&metrics);

        // Verify suggestions are sorted by priority (highest first)
        for i in 1..suggestions.len() {
            assert!(
                suggestions[i - 1].priority >= suggestions[i].priority,
                "Suggestions not sorted by priority"
            );
        }
    }

    #[test]
    fn test_timeout_risk_detection() {
        let mut metrics = FullAgentMetrics::new("agent-1", "test");
        metrics.timeout = Some(Duration::from_secs(10));
        metrics.duration = Some(Duration::from_secs(9)); // 90% of timeout

        let analyzer = PerformanceAnalyzer::new();
        let bottlenecks = analyzer.identify_bottlenecks(&metrics);

        let has_timeout_risk = bottlenecks
            .iter()
            .any(|b| b.category == BottleneckCategory::TimeoutRisk);

        assert!(has_timeout_risk, "Should detect timeout risk at 90% usage");
    }

    #[test]
    fn test_no_timeout_risk_below_threshold() {
        let mut metrics = FullAgentMetrics::new("agent-1", "test");
        metrics.timeout = Some(Duration::from_secs(10));
        metrics.duration = Some(Duration::from_secs(7)); // 70% of timeout

        let analyzer = PerformanceAnalyzer::new();
        let bottlenecks = analyzer.identify_bottlenecks(&metrics);

        let has_timeout_risk = bottlenecks
            .iter()
            .any(|b| b.category == BottleneckCategory::TimeoutRisk);

        assert!(
            !has_timeout_risk,
            "Should not detect timeout risk at 70% usage"
        );
    }

    #[test]
    fn test_rating_boundary_values() {
        // Test exact boundary values
        assert_eq!(
            PerformanceRating::from_score(80.0),
            PerformanceRating::Excellent
        );
        assert_eq!(
            PerformanceRating::from_score(79.99),
            PerformanceRating::Good
        );
        assert_eq!(PerformanceRating::from_score(60.0), PerformanceRating::Good);
        assert_eq!(
            PerformanceRating::from_score(59.99),
            PerformanceRating::Fair
        );
        assert_eq!(PerformanceRating::from_score(40.0), PerformanceRating::Fair);
        assert_eq!(
            PerformanceRating::from_score(39.99),
            PerformanceRating::Poor
        );
    }
}
