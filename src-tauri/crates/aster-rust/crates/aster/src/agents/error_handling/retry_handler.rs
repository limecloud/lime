//! Retry Handler
//!
//! Provides configurable retry behavior for transient failures.
//! Supports multiple retry strategies and backoff algorithms.
//!
//! **Validates: Requirements 15.4**

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;

/// Retry strategy types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum RetryStrategy {
    /// Fixed delay between retries
    Fixed,
    /// Linear backoff (delay * attempt)
    Linear,
    /// Exponential backoff (delay * 2^attempt)
    #[default]
    Exponential,
    /// Exponential backoff with jitter
    ExponentialWithJitter,
}

impl std::fmt::Display for RetryStrategy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RetryStrategy::Fixed => write!(f, "fixed"),
            RetryStrategy::Linear => write!(f, "linear"),
            RetryStrategy::Exponential => write!(f, "exponential"),
            RetryStrategy::ExponentialWithJitter => write!(f, "exponential_with_jitter"),
        }
    }
}

/// Retry configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryConfig {
    /// Maximum number of retry attempts
    pub max_retries: u32,
    /// Base delay between retries
    pub base_delay: Duration,
    /// Maximum delay between retries
    pub max_delay: Duration,
    /// Retry strategy
    pub strategy: RetryStrategy,
    /// Jitter factor for exponential with jitter (0.0 - 1.0)
    pub jitter_factor: f64,
    /// Whether to retry on timeout errors
    pub retry_on_timeout: bool,
    /// Error types that should be retried
    pub retryable_errors: Vec<String>,
}

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            max_retries: 3,
            base_delay: Duration::from_millis(1000),
            max_delay: Duration::from_secs(30),
            strategy: RetryStrategy::Exponential,
            jitter_factor: 0.1,
            retry_on_timeout: true,
            retryable_errors: vec![
                "network".to_string(),
                "timeout".to_string(),
                "rate_limit".to_string(),
                "temporary".to_string(),
            ],
        }
    }
}

impl RetryConfig {
    /// Create a new retry config
    pub fn new(max_retries: u32, base_delay: Duration) -> Self {
        Self {
            max_retries,
            base_delay,
            ..Default::default()
        }
    }

    /// Set the strategy
    pub fn with_strategy(mut self, strategy: RetryStrategy) -> Self {
        self.strategy = strategy;
        self
    }

    /// Set the maximum delay
    pub fn with_max_delay(mut self, max_delay: Duration) -> Self {
        self.max_delay = max_delay;
        self
    }

    /// Set the jitter factor
    pub fn with_jitter_factor(mut self, factor: f64) -> Self {
        self.jitter_factor = factor.clamp(0.0, 1.0);
        self
    }

    /// Set whether to retry on timeout
    pub fn with_retry_on_timeout(mut self, retry: bool) -> Self {
        self.retry_on_timeout = retry;
        self
    }

    /// Add a retryable error type
    pub fn with_retryable_error(mut self, error_type: impl Into<String>) -> Self {
        self.retryable_errors.push(error_type.into());
        self
    }

    /// Calculate delay for a given attempt
    pub fn calculate_delay(&self, attempt: u32) -> Duration {
        let base_ms = self.base_delay.as_millis() as f64;
        let max_ms = self.max_delay.as_millis() as f64;

        let delay_ms = match self.strategy {
            RetryStrategy::Fixed => base_ms,
            RetryStrategy::Linear => base_ms * (attempt as f64 + 1.0),
            RetryStrategy::Exponential => base_ms * 2.0_f64.powi(attempt as i32),
            RetryStrategy::ExponentialWithJitter => {
                let exp_delay = base_ms * 2.0_f64.powi(attempt as i32);
                let jitter = exp_delay * self.jitter_factor * rand_jitter();
                exp_delay + jitter
            }
        };

        Duration::from_millis(delay_ms.min(max_ms) as u64)
    }

    /// Check if an error type is retryable
    pub fn is_retryable(&self, error_type: &str) -> bool {
        self.retryable_errors
            .iter()
            .any(|e| error_type.to_lowercase().contains(&e.to_lowercase()))
    }

    /// Validate the configuration
    pub fn validate(&self) -> Result<(), String> {
        if self.max_retries == 0 {
            return Err("max_retries must be greater than 0".to_string());
        }
        if self.base_delay.is_zero() {
            return Err("base_delay must be greater than 0".to_string());
        }
        if self.max_delay < self.base_delay {
            return Err("max_delay must be >= base_delay".to_string());
        }
        Ok(())
    }
}

/// Generate a random jitter value between -1.0 and 1.0
fn rand_jitter() -> f64 {
    use std::time::SystemTime;
    let nanos = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    // Simple pseudo-random based on nanoseconds
    ((nanos % 2000) as f64 / 1000.0) - 1.0
}

/// Result of a retry operation
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RetryResult {
    /// Operation succeeded
    Success,
    /// Operation should be retried
    Retry,
    /// Maximum retries exceeded
    MaxRetriesExceeded,
    /// Error is not retryable
    NotRetryable,
    /// Retry was skipped (no config)
    Skipped,
}

impl std::fmt::Display for RetryResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RetryResult::Success => write!(f, "success"),
            RetryResult::Retry => write!(f, "retry"),
            RetryResult::MaxRetriesExceeded => write!(f, "max_retries_exceeded"),
            RetryResult::NotRetryable => write!(f, "not_retryable"),
            RetryResult::Skipped => write!(f, "skipped"),
        }
    }
}

/// Retry state for tracking retry attempts
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryState {
    /// Operation ID
    pub operation_id: String,
    /// Current attempt number (0-based)
    pub attempt: u32,
    /// Configuration used
    pub config: RetryConfig,
    /// Start time of first attempt
    pub started_at: DateTime<Utc>,
    /// Last attempt time
    pub last_attempt_at: Option<DateTime<Utc>>,
    /// Last error message
    pub last_error: Option<String>,
    /// Total delay accumulated
    pub total_delay: Duration,
    /// Whether the operation succeeded
    pub succeeded: bool,
}

impl RetryState {
    /// Create a new retry state
    pub fn new(operation_id: impl Into<String>, config: RetryConfig) -> Self {
        Self {
            operation_id: operation_id.into(),
            attempt: 0,
            config,
            started_at: Utc::now(),
            last_attempt_at: None,
            last_error: None,
            total_delay: Duration::ZERO,
            succeeded: false,
        }
    }

    /// Check if more retries are available
    pub fn can_retry(&self) -> bool {
        self.attempt < self.config.max_retries
    }

    /// Get the next delay
    pub fn next_delay(&self) -> Duration {
        self.config.calculate_delay(self.attempt)
    }

    /// Record an attempt
    pub fn record_attempt(&mut self, error: Option<String>) {
        self.attempt += 1;
        self.last_attempt_at = Some(Utc::now());
        self.last_error = error;
    }

    /// Record success
    pub fn record_success(&mut self) {
        self.succeeded = true;
        self.last_attempt_at = Some(Utc::now());
    }

    /// Add delay to total
    pub fn add_delay(&mut self, delay: Duration) {
        self.total_delay += delay;
    }

    /// Get total elapsed time
    pub fn elapsed(&self) -> Duration {
        let elapsed = Utc::now().signed_duration_since(self.started_at);
        elapsed.to_std().unwrap_or(Duration::ZERO)
    }
}

/// Retry handler for managing retry operations
#[derive(Debug)]
pub struct RetryHandler {
    /// Active retry states indexed by operation ID
    states: HashMap<String, RetryState>,
    /// Default configuration
    default_config: RetryConfig,
}

impl Default for RetryHandler {
    fn default() -> Self {
        Self::new()
    }
}

impl RetryHandler {
    /// Create a new retry handler
    pub fn new() -> Self {
        Self {
            states: HashMap::new(),
            default_config: RetryConfig::default(),
        }
    }

    /// Create with custom default configuration
    pub fn with_default_config(config: RetryConfig) -> Self {
        Self {
            states: HashMap::new(),
            default_config: config,
        }
    }

    /// Start tracking a retry operation with default config
    pub fn start(&mut self, operation_id: &str) -> &RetryState {
        self.start_with_config(operation_id, self.default_config.clone())
    }

    /// Start tracking a retry operation with custom config
    pub fn start_with_config(&mut self, operation_id: &str, config: RetryConfig) -> &RetryState {
        let state = RetryState::new(operation_id, config);
        self.states.insert(operation_id.to_string(), state);
        self.states.get(operation_id).unwrap()
    }

    /// Handle a failure and determine if retry should occur
    pub fn handle_failure(
        &mut self,
        operation_id: &str,
        error_type: &str,
        error_message: &str,
    ) -> RetryResult {
        let state = match self.states.get_mut(operation_id) {
            Some(s) => s,
            None => return RetryResult::Skipped,
        };

        // Check if error is retryable
        if !state.config.is_retryable(error_type) {
            return RetryResult::NotRetryable;
        }

        // Check if we have retries left
        if !state.can_retry() {
            return RetryResult::MaxRetriesExceeded;
        }

        // Record the attempt
        state.record_attempt(Some(error_message.to_string()));

        RetryResult::Retry
    }

    /// Get the delay before next retry
    pub fn get_retry_delay(&self, operation_id: &str) -> Option<Duration> {
        self.states.get(operation_id).map(|s| s.next_delay())
    }

    /// Record that a delay was applied
    pub fn record_delay(&mut self, operation_id: &str, delay: Duration) {
        if let Some(state) = self.states.get_mut(operation_id) {
            state.add_delay(delay);
        }
    }

    /// Record success for an operation
    pub fn record_success(&mut self, operation_id: &str) {
        if let Some(state) = self.states.get_mut(operation_id) {
            state.record_success();
        }
    }

    /// Get the current state for an operation
    pub fn get_state(&self, operation_id: &str) -> Option<&RetryState> {
        self.states.get(operation_id)
    }

    /// Get the current attempt number
    pub fn get_attempt(&self, operation_id: &str) -> Option<u32> {
        self.states.get(operation_id).map(|s| s.attempt)
    }

    /// Check if an operation can retry
    pub fn can_retry(&self, operation_id: &str) -> bool {
        self.states
            .get(operation_id)
            .map(|s| s.can_retry())
            .unwrap_or(false)
    }

    /// Remove a completed operation
    pub fn complete(&mut self, operation_id: &str) -> Option<RetryState> {
        self.states.remove(operation_id)
    }

    /// Clear all states
    pub fn clear(&mut self) {
        self.states.clear();
    }

    /// Get the number of active operations
    pub fn active_count(&self) -> usize {
        self.states.len()
    }

    /// Set default configuration
    pub fn set_default_config(&mut self, config: RetryConfig) {
        self.default_config = config;
    }

    /// Get default configuration
    pub fn default_config(&self) -> &RetryConfig {
        &self.default_config
    }

    /// Execute an async operation with retry
    pub async fn execute_with_retry<F, Fut, T, E>(
        &mut self,
        operation_id: &str,
        mut operation: F,
    ) -> Result<T, E>
    where
        F: FnMut() -> Fut,
        Fut: std::future::Future<Output = Result<T, E>>,
        E: std::fmt::Display,
    {
        self.start(operation_id);

        loop {
            match operation().await {
                Ok(result) => {
                    self.record_success(operation_id);
                    return Ok(result);
                }
                Err(e) => {
                    let error_msg = e.to_string();
                    let result = self.handle_failure(operation_id, "general", &error_msg);

                    match result {
                        RetryResult::Retry => {
                            if let Some(delay) = self.get_retry_delay(operation_id) {
                                tokio::time::sleep(delay).await;
                                self.record_delay(operation_id, delay);
                            }
                        }
                        _ => return Err(e),
                    }
                }
            }
        }
    }
}

/// Thread-safe retry handler wrapper
#[allow(dead_code)]
pub type SharedRetryHandler = Arc<RwLock<RetryHandler>>;

/// Create a new shared retry handler
#[allow(dead_code)]
pub fn new_shared_retry_handler() -> SharedRetryHandler {
    Arc::new(RwLock::new(RetryHandler::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_retry_config_default() {
        let config = RetryConfig::default();
        assert_eq!(config.max_retries, 3);
        assert_eq!(config.base_delay, Duration::from_millis(1000));
        assert_eq!(config.strategy, RetryStrategy::Exponential);
    }

    #[test]
    fn test_retry_config_calculate_delay_fixed() {
        let config =
            RetryConfig::new(3, Duration::from_millis(100)).with_strategy(RetryStrategy::Fixed);

        assert_eq!(config.calculate_delay(0), Duration::from_millis(100));
        assert_eq!(config.calculate_delay(1), Duration::from_millis(100));
        assert_eq!(config.calculate_delay(2), Duration::from_millis(100));
    }

    #[test]
    fn test_retry_config_calculate_delay_linear() {
        let config =
            RetryConfig::new(3, Duration::from_millis(100)).with_strategy(RetryStrategy::Linear);

        assert_eq!(config.calculate_delay(0), Duration::from_millis(100));
        assert_eq!(config.calculate_delay(1), Duration::from_millis(200));
        assert_eq!(config.calculate_delay(2), Duration::from_millis(300));
    }

    #[test]
    fn test_retry_config_calculate_delay_exponential() {
        let config = RetryConfig::new(3, Duration::from_millis(100))
            .with_strategy(RetryStrategy::Exponential);

        assert_eq!(config.calculate_delay(0), Duration::from_millis(100));
        assert_eq!(config.calculate_delay(1), Duration::from_millis(200));
        assert_eq!(config.calculate_delay(2), Duration::from_millis(400));
    }

    #[test]
    fn test_retry_config_max_delay() {
        let config = RetryConfig::new(10, Duration::from_millis(100))
            .with_strategy(RetryStrategy::Exponential)
            .with_max_delay(Duration::from_millis(500));

        // 100 * 2^5 = 3200, but should be capped at 500
        assert_eq!(config.calculate_delay(5), Duration::from_millis(500));
    }

    #[test]
    fn test_retry_config_is_retryable() {
        let config = RetryConfig::default();

        assert!(config.is_retryable("network_error"));
        assert!(config.is_retryable("timeout"));
        assert!(config.is_retryable("rate_limit_exceeded"));
        assert!(!config.is_retryable("invalid_input"));
    }

    #[test]
    fn test_retry_config_validate() {
        let valid = RetryConfig::default();
        assert!(valid.validate().is_ok());

        let invalid_retries = RetryConfig {
            max_retries: 0,
            ..Default::default()
        };
        assert!(invalid_retries.validate().is_err());

        let invalid_delay = RetryConfig {
            base_delay: Duration::ZERO,
            ..Default::default()
        };
        assert!(invalid_delay.validate().is_err());
    }

    #[test]
    fn test_retry_state_creation() {
        let config = RetryConfig::default();
        let state = RetryState::new("op-1", config);

        assert_eq!(state.operation_id, "op-1");
        assert_eq!(state.attempt, 0);
        assert!(!state.succeeded);
        assert!(state.can_retry());
    }

    #[test]
    fn test_retry_state_record_attempt() {
        let config = RetryConfig::new(3, Duration::from_millis(100));
        let mut state = RetryState::new("op-1", config);

        state.record_attempt(Some("Error 1".to_string()));
        assert_eq!(state.attempt, 1);
        assert_eq!(state.last_error, Some("Error 1".to_string()));
        assert!(state.can_retry());

        state.record_attempt(Some("Error 2".to_string()));
        state.record_attempt(Some("Error 3".to_string()));
        assert_eq!(state.attempt, 3);
        assert!(!state.can_retry());
    }

    #[test]
    fn test_retry_handler_start() {
        let mut handler = RetryHandler::new();
        handler.start("op-1");

        assert_eq!(handler.active_count(), 1);
        assert!(handler.get_state("op-1").is_some());
    }

    #[test]
    fn test_retry_handler_handle_failure() {
        let mut handler = RetryHandler::new();
        handler.start("op-1");

        let result = handler.handle_failure("op-1", "network", "Connection failed");
        assert_eq!(result, RetryResult::Retry);
        assert_eq!(handler.get_attempt("op-1"), Some(1));
    }

    #[test]
    fn test_retry_handler_handle_failure_not_retryable() {
        let mut handler = RetryHandler::new();
        handler.start("op-1");

        let result = handler.handle_failure("op-1", "invalid_input", "Bad request");
        assert_eq!(result, RetryResult::NotRetryable);
    }

    #[test]
    fn test_retry_handler_handle_failure_max_exceeded() {
        let config = RetryConfig::new(2, Duration::from_millis(100));
        let mut handler = RetryHandler::with_default_config(config);
        handler.start("op-1");

        handler.handle_failure("op-1", "network", "Error 1");
        handler.handle_failure("op-1", "network", "Error 2");
        let result = handler.handle_failure("op-1", "network", "Error 3");

        assert_eq!(result, RetryResult::MaxRetriesExceeded);
    }

    #[test]
    fn test_retry_handler_record_success() {
        let mut handler = RetryHandler::new();
        handler.start("op-1");
        handler.record_success("op-1");

        let state = handler.get_state("op-1").unwrap();
        assert!(state.succeeded);
    }

    #[test]
    fn test_retry_handler_complete() {
        let mut handler = RetryHandler::new();
        handler.start("op-1");

        let state = handler.complete("op-1");
        assert!(state.is_some());
        assert_eq!(handler.active_count(), 0);
    }

    #[test]
    fn test_retry_result_display() {
        assert_eq!(format!("{}", RetryResult::Success), "success");
        assert_eq!(format!("{}", RetryResult::Retry), "retry");
        assert_eq!(
            format!("{}", RetryResult::MaxRetriesExceeded),
            "max_retries_exceeded"
        );
    }
}
