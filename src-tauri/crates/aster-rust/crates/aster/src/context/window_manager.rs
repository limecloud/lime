//! Context Window Manager Module
//!
//! Provides dynamic context window management for different LLM models.
//!
//! # Context Window Strategy
//!
//! - For models with context window ≤50k tokens: reserve 20% for output
//! - For models with context window >50k tokens: reserve fixed 50k tokens for output
//!
//! # Features
//!
//! - Model-specific context window sizes
//! - Token usage tracking (input, output, cache)
//! - Usage percentage calculation
//! - Near-limit detection

use crate::context::types::{CacheStats, ContextWindowStats, TokenUsage};
use std::collections::HashMap;
use std::sync::LazyLock;

/// Threshold for small context windows (50k tokens)
const SMALL_CONTEXT_THRESHOLD: usize = 50_000;

/// Output reservation percentage for small context windows
const SMALL_CONTEXT_OUTPUT_RESERVE_PERCENT: f64 = 0.20;

/// Fixed output reservation for large context windows
const LARGE_CONTEXT_OUTPUT_RESERVE: usize = 50_000;

/// Model context window sizes mapping.
///
/// Maps model IDs to their maximum context window sizes in tokens.
pub static MODEL_CONTEXT_WINDOWS: LazyLock<HashMap<&'static str, usize>> = LazyLock::new(|| {
    let mut m = HashMap::new();
    // Claude models
    m.insert("claude-3-5-sonnet-20241022", 200_000);
    m.insert("claude-3-7-sonnet-20250219", 200_000);
    m.insert("claude-4-0-sonnet-20250514", 200_000);
    m.insert("claude-3-opus-20240229", 200_000);
    m.insert("claude-3-sonnet-20240229", 200_000);
    m.insert("claude-3-haiku-20240307", 200_000);
    // OpenAI models
    m.insert("gpt-4o", 128_000);
    m.insert("gpt-4o-mini", 128_000);
    m.insert("gpt-4-turbo", 128_000);
    m.insert("gpt-4", 8_192);
    m.insert("gpt-3.5-turbo", 16_385);
    // Default fallback
    m.insert("default", 200_000);
    m
});

/// Context Window Manager for tracking and managing token usage.
///
/// Tracks cumulative token usage across API calls and provides
/// utilities for calculating available context space.
#[derive(Debug, Clone)]
pub struct ContextWindowManager {
    /// Size of the context window for the current model
    context_window_size: usize,
    /// Total input tokens consumed across all calls
    total_input_tokens: usize,
    /// Total output tokens generated across all calls
    total_output_tokens: usize,
    /// Total tokens written to cache
    total_cache_creation_tokens: usize,
    /// Total tokens read from cache
    total_cache_read_tokens: usize,
    /// Current API call usage (most recent)
    current_usage: Option<TokenUsage>,
    /// Current model ID
    model_id: String,
}

impl Default for ContextWindowManager {
    fn default() -> Self {
        Self::new("default")
    }
}

impl ContextWindowManager {
    /// Create a new ContextWindowManager for the specified model.
    ///
    /// # Arguments
    ///
    /// * `model_id` - The model identifier (e.g., "claude-3-5-sonnet-20241022")
    ///
    /// # Example
    ///
    /// ```
    /// use aster::context::window_manager::ContextWindowManager;
    ///
    /// let manager = ContextWindowManager::new("claude-3-5-sonnet-20241022");
    /// assert_eq!(manager.get_context_window_size(), 200_000);
    /// ```
    pub fn new(model_id: &str) -> Self {
        let context_window_size = Self::get_model_context_window(model_id);
        Self {
            context_window_size,
            total_input_tokens: 0,
            total_output_tokens: 0,
            total_cache_creation_tokens: 0,
            total_cache_read_tokens: 0,
            current_usage: None,
            model_id: model_id.to_string(),
        }
    }

    /// Get the context window size for a model.
    ///
    /// Returns the known context window size for the model, or the default
    /// if the model is not recognized.
    ///
    /// # Arguments
    ///
    /// * `model_id` - The model identifier
    ///
    /// # Returns
    ///
    /// Context window size in tokens
    pub fn get_model_context_window(model_id: &str) -> usize {
        MODEL_CONTEXT_WINDOWS
            .get(model_id)
            .copied()
            .unwrap_or_else(|| {
                // Try to find a partial match
                for (key, value) in MODEL_CONTEXT_WINDOWS.iter() {
                    if model_id.contains(key) || key.contains(model_id) {
                        return *value;
                    }
                }
                // Fall back to default
                *MODEL_CONTEXT_WINDOWS.get("default").unwrap_or(&200_000)
            })
    }

    /// Calculate available context space for input.
    ///
    /// Applies the reservation strategy:
    /// - For context ≤50k: reserve 20% for output
    /// - For context >50k: reserve fixed 50k for output
    ///
    /// # Arguments
    ///
    /// * `model_id` - The model identifier
    ///
    /// # Returns
    ///
    /// Available tokens for input
    pub fn calculate_available_context(model_id: &str) -> usize {
        let window_size = Self::get_model_context_window(model_id);
        Self::calculate_available_from_window(window_size)
    }

    /// Calculate available context from a given window size.
    fn calculate_available_from_window(window_size: usize) -> usize {
        if window_size <= SMALL_CONTEXT_THRESHOLD {
            // Reserve 20% for output
            ((window_size as f64) * (1.0 - SMALL_CONTEXT_OUTPUT_RESERVE_PERCENT)) as usize
        } else {
            // Reserve fixed 50k for output
            window_size.saturating_sub(LARGE_CONTEXT_OUTPUT_RESERVE)
        }
    }

    /// Calculate output space reservation for a model.
    ///
    /// # Arguments
    ///
    /// * `model_id` - The model identifier
    ///
    /// # Returns
    ///
    /// Tokens reserved for output
    pub fn calculate_output_space(model_id: &str) -> usize {
        let window_size = Self::get_model_context_window(model_id);
        Self::calculate_output_from_window(window_size)
    }

    /// Calculate output space from a given window size.
    fn calculate_output_from_window(window_size: usize) -> usize {
        if window_size <= SMALL_CONTEXT_THRESHOLD {
            // Reserve 20% for output
            ((window_size as f64) * SMALL_CONTEXT_OUTPUT_RESERVE_PERCENT) as usize
        } else {
            // Reserve fixed 50k for output
            LARGE_CONTEXT_OUTPUT_RESERVE
        }
    }

    /// Update the model and recalculate context window size.
    ///
    /// # Arguments
    ///
    /// * `model_id` - The new model identifier
    pub fn update_model(&mut self, model_id: &str) {
        self.model_id = model_id.to_string();
        self.context_window_size = Self::get_model_context_window(model_id);
    }

    /// Record token usage from an API call.
    ///
    /// Updates cumulative totals and stores the current usage.
    ///
    /// # Arguments
    ///
    /// * `usage` - Token usage from the API call
    pub fn record_usage(&mut self, usage: TokenUsage) {
        self.total_input_tokens += usage.input_tokens;
        self.total_output_tokens += usage.output_tokens;

        if let Some(cache_creation) = usage.cache_creation_tokens {
            self.total_cache_creation_tokens += cache_creation;
        }

        if let Some(cache_read) = usage.cache_read_tokens {
            self.total_cache_read_tokens += cache_read;
        }

        self.current_usage = Some(usage);
    }

    /// Get the current context usage percentage.
    ///
    /// Calculates usage based on total input tokens relative to context window.
    ///
    /// # Returns
    ///
    /// Usage percentage (0.0 - 100.0)
    pub fn get_usage_percentage(&self) -> f64 {
        if self.context_window_size == 0 {
            return 0.0;
        }
        (self.total_input_tokens as f64 / self.context_window_size as f64) * 100.0
    }

    /// Check if context usage is near the limit.
    ///
    /// # Arguments
    ///
    /// * `threshold` - Percentage threshold (0.0 - 100.0)
    ///
    /// # Returns
    ///
    /// `true` if usage exceeds the threshold
    pub fn is_near_limit(&self, threshold: f64) -> bool {
        self.get_usage_percentage() >= threshold
    }

    /// Get the context window size.
    pub fn get_context_window_size(&self) -> usize {
        self.context_window_size
    }

    /// Get total input tokens consumed.
    pub fn get_total_input_tokens(&self) -> usize {
        self.total_input_tokens
    }

    /// Get total output tokens generated.
    pub fn get_total_output_tokens(&self) -> usize {
        self.total_output_tokens
    }

    /// Get available context space for the current model.
    pub fn get_available_context(&self) -> usize {
        Self::calculate_available_from_window(self.context_window_size)
    }

    /// Get output space reservation for the current model.
    pub fn get_output_space(&self) -> usize {
        Self::calculate_output_from_window(self.context_window_size)
    }

    /// Get the current model ID.
    pub fn get_model_id(&self) -> &str {
        &self.model_id
    }

    /// Get the most recent API call usage.
    pub fn get_current_usage(&self) -> Option<&TokenUsage> {
        self.current_usage.as_ref()
    }

    /// Get context window statistics.
    ///
    /// # Returns
    ///
    /// Statistics about context window usage
    pub fn get_stats(&self) -> ContextWindowStats {
        ContextWindowStats {
            total_input_tokens: self.total_input_tokens,
            total_output_tokens: self.total_output_tokens,
            context_window_size: self.context_window_size,
            current_usage: self.current_usage.clone(),
        }
    }

    /// Get cache statistics.
    ///
    /// # Returns
    ///
    /// Statistics about cache usage
    pub fn get_cache_stats(&self) -> CacheStats {
        let total_cacheable = self.total_cache_creation_tokens + self.total_cache_read_tokens;
        let cache_hit_rate = if total_cacheable > 0 {
            self.total_cache_read_tokens as f64 / total_cacheable as f64
        } else {
            0.0
        };

        CacheStats {
            total_cache_creation_tokens: self.total_cache_creation_tokens,
            total_cache_read_tokens: self.total_cache_read_tokens,
            cache_hit_rate,
        }
    }

    /// Reset all statistics.
    ///
    /// Clears cumulative token counts and current usage.
    pub fn reset(&mut self) {
        self.total_input_tokens = 0;
        self.total_output_tokens = 0;
        self.total_cache_creation_tokens = 0;
        self.total_cache_read_tokens = 0;
        self.current_usage = None;
    }

    /// Get remaining available tokens.
    ///
    /// Calculates how many more input tokens can be used before
    /// reaching the available context limit.
    ///
    /// # Returns
    ///
    /// Remaining available tokens (0 if limit exceeded)
    pub fn get_remaining_tokens(&self) -> usize {
        let available = self.get_available_context();
        available.saturating_sub(self.total_input_tokens)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_with_known_model() {
        let manager = ContextWindowManager::new("claude-3-5-sonnet-20241022");
        assert_eq!(manager.get_context_window_size(), 200_000);
        assert_eq!(manager.get_model_id(), "claude-3-5-sonnet-20241022");
    }

    #[test]
    fn test_new_with_unknown_model() {
        let manager = ContextWindowManager::new("unknown-model");
        // Should fall back to default
        assert_eq!(manager.get_context_window_size(), 200_000);
    }

    #[test]
    fn test_get_model_context_window() {
        assert_eq!(
            ContextWindowManager::get_model_context_window("claude-3-5-sonnet-20241022"),
            200_000
        );
        assert_eq!(
            ContextWindowManager::get_model_context_window("gpt-4o"),
            128_000
        );
        assert_eq!(
            ContextWindowManager::get_model_context_window("gpt-4"),
            8_192
        );
    }

    #[test]
    fn test_calculate_available_context_small_window() {
        // For small context (≤50k), reserve 20%
        // gpt-4 has 8192 tokens
        let available = ContextWindowManager::calculate_available_context("gpt-4");
        // 8192 * 0.8 = 6553.6 ≈ 6553
        assert_eq!(available, 6553);
    }

    #[test]
    fn test_calculate_available_context_large_window() {
        // For large context (>50k), reserve fixed 50k
        let available =
            ContextWindowManager::calculate_available_context("claude-3-5-sonnet-20241022");
        // 200000 - 50000 = 150000
        assert_eq!(available, 150_000);
    }

    #[test]
    fn test_calculate_output_space_small_window() {
        // For small context (≤50k), reserve 20%
        let output_space = ContextWindowManager::calculate_output_space("gpt-4");
        // 8192 * 0.2 = 1638.4 ≈ 1638
        assert_eq!(output_space, 1638);
    }

    #[test]
    fn test_calculate_output_space_large_window() {
        // For large context (>50k), reserve fixed 50k
        let output_space =
            ContextWindowManager::calculate_output_space("claude-3-5-sonnet-20241022");
        assert_eq!(output_space, 50_000);
    }

    #[test]
    fn test_record_usage() {
        let mut manager = ContextWindowManager::new("claude-3-5-sonnet-20241022");

        let usage1 = TokenUsage::new(1000, 500);
        manager.record_usage(usage1);

        assert_eq!(manager.get_total_input_tokens(), 1000);
        assert_eq!(manager.get_total_output_tokens(), 500);

        let usage2 = TokenUsage::new(2000, 1000);
        manager.record_usage(usage2);

        assert_eq!(manager.get_total_input_tokens(), 3000);
        assert_eq!(manager.get_total_output_tokens(), 1500);
    }

    #[test]
    fn test_record_usage_with_cache() {
        let mut manager = ContextWindowManager::new("claude-3-5-sonnet-20241022");

        let usage = TokenUsage::with_cache(1000, 500, 200, 100);
        manager.record_usage(usage);

        let cache_stats = manager.get_cache_stats();
        assert_eq!(cache_stats.total_cache_creation_tokens, 200);
        assert_eq!(cache_stats.total_cache_read_tokens, 100);
    }

    #[test]
    fn test_get_usage_percentage() {
        let mut manager = ContextWindowManager::new("claude-3-5-sonnet-20241022");

        // 200000 context window
        let usage = TokenUsage::new(50000, 0);
        manager.record_usage(usage);

        // 50000 / 200000 = 25%
        let percentage = manager.get_usage_percentage();
        assert!((percentage - 25.0).abs() < 0.01);
    }

    #[test]
    fn test_is_near_limit() {
        let mut manager = ContextWindowManager::new("claude-3-5-sonnet-20241022");

        // Add 70% of context window
        let usage = TokenUsage::new(140000, 0);
        manager.record_usage(usage);

        assert!(manager.is_near_limit(70.0));
        assert!(!manager.is_near_limit(80.0));
    }

    #[test]
    fn test_update_model() {
        let mut manager = ContextWindowManager::new("claude-3-5-sonnet-20241022");
        assert_eq!(manager.get_context_window_size(), 200_000);

        manager.update_model("gpt-4");
        assert_eq!(manager.get_context_window_size(), 8_192);
        assert_eq!(manager.get_model_id(), "gpt-4");
    }

    #[test]
    fn test_get_stats() {
        let mut manager = ContextWindowManager::new("claude-3-5-sonnet-20241022");

        let usage = TokenUsage::new(1000, 500);
        manager.record_usage(usage.clone());

        let stats = manager.get_stats();
        assert_eq!(stats.total_input_tokens, 1000);
        assert_eq!(stats.total_output_tokens, 500);
        assert_eq!(stats.context_window_size, 200_000);
        assert!(stats.current_usage.is_some());
    }

    #[test]
    fn test_reset() {
        let mut manager = ContextWindowManager::new("claude-3-5-sonnet-20241022");

        let usage = TokenUsage::with_cache(1000, 500, 200, 100);
        manager.record_usage(usage);

        manager.reset();

        assert_eq!(manager.get_total_input_tokens(), 0);
        assert_eq!(manager.get_total_output_tokens(), 0);
        assert!(manager.get_current_usage().is_none());

        let cache_stats = manager.get_cache_stats();
        assert_eq!(cache_stats.total_cache_creation_tokens, 0);
        assert_eq!(cache_stats.total_cache_read_tokens, 0);
    }

    #[test]
    fn test_get_remaining_tokens() {
        let mut manager = ContextWindowManager::new("claude-3-5-sonnet-20241022");

        // Available = 200000 - 50000 = 150000
        assert_eq!(manager.get_remaining_tokens(), 150_000);

        let usage = TokenUsage::new(50000, 0);
        manager.record_usage(usage);

        // Remaining = 150000 - 50000 = 100000
        assert_eq!(manager.get_remaining_tokens(), 100_000);
    }

    #[test]
    fn test_cache_hit_rate() {
        let mut manager = ContextWindowManager::new("claude-3-5-sonnet-20241022");

        // First call: cache creation
        let usage1 = TokenUsage::with_cache(1000, 500, 500, 0);
        manager.record_usage(usage1);

        // Second call: cache read
        let usage2 = TokenUsage::with_cache(1000, 500, 0, 500);
        manager.record_usage(usage2);

        let cache_stats = manager.get_cache_stats();
        // Total cacheable = 500 + 500 = 1000
        // Cache read = 500
        // Hit rate = 500 / 1000 = 0.5
        assert!((cache_stats.cache_hit_rate - 0.5).abs() < 0.01);
    }

    #[test]
    fn test_default() {
        let manager = ContextWindowManager::default();
        assert_eq!(manager.get_model_id(), "default");
        assert_eq!(manager.get_context_window_size(), 200_000);
    }

    #[test]
    fn test_boundary_50k() {
        // Test exactly at 50k boundary
        // gpt-3.5-turbo has 16385 tokens (< 50k)
        let available = ContextWindowManager::calculate_available_context("gpt-3.5-turbo");
        let output = ContextWindowManager::calculate_output_space("gpt-3.5-turbo");

        // Should use percentage-based reservation
        // 16385 * 0.8 = 13108
        // 16385 * 0.2 = 3277
        assert_eq!(available, 13108);
        assert_eq!(output, 3277);
    }
}
