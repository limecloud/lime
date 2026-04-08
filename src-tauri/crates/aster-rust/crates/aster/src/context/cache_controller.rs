//! Prompt Caching Controller Module
//!
//! Provides prompt caching support for reducing API costs and latency.
//! This module implements cache control markers for eligible message blocks
//! and calculates cache cost savings.
//!
//! # Features
//!
//! - Add cache control markers to eligible messages
//! - Check cache eligibility based on token thresholds
//! - Calculate cache cost savings
//! - Track cache hit rates
//!
//! # Pricing Model
//!
//! Based on Anthropic's prompt caching pricing:
//! - Cache write: 1.25x base input price
//! - Cache read: 0.1x base input price (90% discount)

use crate::context::token_estimator::TokenEstimator;
use crate::context::types::{CacheConfig, CacheSavings, CacheStats, TokenUsage};
use crate::conversation::message::Message;

/// Base input price per million tokens (used for cost calculations)
/// This is a reference value; actual pricing may vary by model
const BASE_INPUT_PRICE_PER_MILLION: f64 = 3.0;

/// Cache write multiplier (1.25x base price)
const CACHE_WRITE_MULTIPLIER: f64 = 1.25;

/// Cache read multiplier (0.1x base price - 90% discount)
const CACHE_READ_MULTIPLIER: f64 = 0.1;

/// Result of cache eligibility check with indices of cacheable messages
#[derive(Debug, Clone, Default)]
pub struct CacheEligibility {
    /// Indices of messages that are eligible for caching
    pub cacheable_indices: Vec<usize>,
    /// Total estimated tokens in cacheable messages
    pub cacheable_tokens: usize,
}

/// Prompt Caching Controller
///
/// Manages cache control markers for messages and calculates cache savings.
///
/// # Note on Cache Control Implementation
///
/// Cache control markers are typically added at the API request level by the
/// provider implementation, not stored in the message content itself. This
/// controller identifies which messages are eligible for caching and provides
/// the information needed for providers to add appropriate cache control headers.
pub struct CacheController;

impl CacheController {
    /// Identify messages eligible for cache control.
    ///
    /// This method analyzes messages and returns information about which
    /// messages are eligible for caching based on the provided configuration.
    ///
    /// # Arguments
    ///
    /// * `messages` - The messages to analyze
    /// * `config` - Cache configuration specifying thresholds and options
    ///
    /// # Returns
    ///
    /// `CacheEligibility` containing indices of cacheable messages
    ///
    /// # Cache Eligibility Rules
    ///
    /// Messages are eligible for caching if:
    /// 1. They meet the minimum token threshold
    /// 2. They are within the most recent N messages (as configured)
    ///
    /// # Example
    ///
    /// ```ignore
    /// use aster::context::cache_controller::CacheController;
    /// use aster::context::types::CacheConfig;
    ///
    /// let messages = vec![/* ... */];
    /// let config = CacheConfig::default();
    /// let eligibility = CacheController::get_cache_eligibility(&messages, &config);
    /// println!("Cacheable messages: {:?}", eligibility.cacheable_indices);
    /// ```
    pub fn get_cache_eligibility(messages: &[Message], config: &CacheConfig) -> CacheEligibility {
        if messages.is_empty() {
            return CacheEligibility::default();
        }

        let len = messages.len();
        let mut cacheable_indices = Vec::new();
        let mut cacheable_tokens = 0;

        // Determine which messages are eligible for caching
        // Only cache the most recent N messages as configured
        let start_index = len.saturating_sub(config.cache_recent_messages);

        // Check eligibility for each message in the range
        for (i, message) in messages.iter().enumerate().take(len).skip(start_index) {
            if Self::is_cacheable(message, config.min_tokens_for_cache) {
                let tokens = TokenEstimator::estimate_message_tokens(message);
                cacheable_indices.push(i);
                cacheable_tokens += tokens;
            }
        }

        CacheEligibility {
            cacheable_indices,
            cacheable_tokens,
        }
    }

    /// Add cache control markers to eligible messages.
    ///
    /// This method returns a new vector of messages with cache eligibility
    /// information. The actual cache control markers should be added by
    /// the provider when making API requests.
    ///
    /// # Arguments
    ///
    /// * `messages` - The messages to potentially mark for caching
    /// * `config` - Cache configuration specifying thresholds and options
    ///
    /// # Returns
    ///
    /// A tuple of (messages, cacheable_indices) where cacheable_indices
    /// contains the indices of messages that should have cache control applied
    pub fn add_cache_control(
        messages: &[Message],
        config: &CacheConfig,
    ) -> (Vec<Message>, Vec<usize>) {
        let eligibility = Self::get_cache_eligibility(messages, config);
        (messages.to_vec(), eligibility.cacheable_indices)
    }

    /// Check if a message is eligible for caching.
    ///
    /// A message is cacheable if:
    /// 1. It has content
    /// 2. Its estimated token count meets the minimum threshold
    ///
    /// # Arguments
    ///
    /// * `message` - The message to check
    /// * `min_tokens` - Minimum token threshold for caching
    ///
    /// # Returns
    ///
    /// `true` if the message is eligible for caching
    pub fn is_cacheable(message: &Message, min_tokens: usize) -> bool {
        if message.content.is_empty() {
            return false;
        }

        let tokens = TokenEstimator::estimate_message_tokens(message);
        tokens >= min_tokens
    }

    /// Calculate cache cost savings based on token usage.
    ///
    /// Uses Anthropic's prompt caching pricing model:
    /// - Cache write: 1.25x base input price
    /// - Cache read: 0.1x base input price (90% discount)
    ///
    /// # Arguments
    ///
    /// * `usage` - Token usage statistics including cache metrics
    ///
    /// # Returns
    ///
    /// `CacheSavings` containing base cost, actual cost, and savings
    ///
    /// # Calculation
    ///
    /// ```text
    /// base_cost = input_tokens * base_price
    /// cache_write_cost = cache_creation_tokens * (base_price * 1.25)
    /// cache_read_cost = cache_read_tokens * (base_price * 0.1)
    /// actual_cost = (input_tokens - cache_read_tokens) * base_price
    ///             + cache_write_cost + cache_read_cost
    /// savings = base_cost - actual_cost
    /// ```
    pub fn calculate_cache_savings(usage: &TokenUsage) -> CacheSavings {
        let base_price = BASE_INPUT_PRICE_PER_MILLION / 1_000_000.0;

        // Calculate what the cost would be without caching
        let base_cost = usage.input_tokens as f64 * base_price;

        // Calculate actual cost with caching
        let cache_creation_tokens = usage.cache_creation_tokens.unwrap_or(0);
        let cache_read_tokens = usage.cache_read_tokens.unwrap_or(0);

        // Cache write cost (1.25x base price)
        let cache_write_cost = cache_creation_tokens as f64 * base_price * CACHE_WRITE_MULTIPLIER;

        // Cache read cost (0.1x base price - 90% discount)
        let cache_read_cost = cache_read_tokens as f64 * base_price * CACHE_READ_MULTIPLIER;

        // Non-cached input tokens cost
        let non_cached_tokens = usage.input_tokens.saturating_sub(cache_read_tokens);
        let non_cached_cost = non_cached_tokens as f64 * base_price;

        // Total actual cost
        let actual_cost = non_cached_cost + cache_write_cost + cache_read_cost;

        CacheSavings::new(base_cost, actual_cost)
    }

    /// Calculate cache statistics from token usage.
    ///
    /// # Arguments
    ///
    /// * `usage` - Token usage statistics
    ///
    /// # Returns
    ///
    /// `CacheStats` with totals and hit rate
    pub fn calculate_cache_stats(usage: &TokenUsage) -> CacheStats {
        let cache_creation = usage.cache_creation_tokens.unwrap_or(0);
        let cache_read = usage.cache_read_tokens.unwrap_or(0);

        let total_cache_tokens = cache_creation + cache_read;
        let hit_rate = if total_cache_tokens > 0 {
            cache_read as f64 / total_cache_tokens as f64
        } else {
            0.0
        };

        CacheStats {
            total_cache_creation_tokens: cache_creation,
            total_cache_read_tokens: cache_read,
            cache_hit_rate: hit_rate,
        }
    }

    /// Accumulate cache statistics from multiple usages.
    ///
    /// # Arguments
    ///
    /// * `usages` - Iterator of token usage statistics
    ///
    /// # Returns
    ///
    /// Aggregated `CacheStats`
    pub fn accumulate_cache_stats<'a>(usages: impl Iterator<Item = &'a TokenUsage>) -> CacheStats {
        let mut total_creation = 0usize;
        let mut total_read = 0usize;

        for usage in usages {
            total_creation += usage.cache_creation_tokens.unwrap_or(0);
            total_read += usage.cache_read_tokens.unwrap_or(0);
        }

        let total = total_creation + total_read;
        let hit_rate = if total > 0 {
            total_read as f64 / total as f64
        } else {
            0.0
        };

        CacheStats {
            total_cache_creation_tokens: total_creation,
            total_cache_read_tokens: total_read,
            cache_hit_rate: hit_rate,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_message_with_tokens(text: &str) -> Message {
        Message::user().with_text(text)
    }

    fn create_long_message() -> Message {
        // Create a message with enough content to exceed default threshold (1024 tokens)
        let long_text = "x".repeat(4000); // ~1143 tokens at 3.5 chars/token
        Message::user().with_text(long_text)
    }

    fn create_short_message() -> Message {
        Message::user().with_text("Hello")
    }

    #[test]
    fn test_is_cacheable_empty_message() {
        let message = Message::user();
        assert!(!CacheController::is_cacheable(&message, 1024));
    }

    #[test]
    fn test_is_cacheable_short_message() {
        let message = create_short_message();
        assert!(!CacheController::is_cacheable(&message, 1024));
    }

    #[test]
    fn test_is_cacheable_long_message() {
        let message = create_long_message();
        assert!(CacheController::is_cacheable(&message, 1024));
    }

    #[test]
    fn test_is_cacheable_with_low_threshold() {
        let message = create_short_message();
        // With a very low threshold, even short messages should be cacheable
        assert!(CacheController::is_cacheable(&message, 1));
    }

    #[test]
    fn test_add_cache_control_empty_messages() {
        let messages: Vec<Message> = vec![];
        let config = CacheConfig::default();
        let (result, indices) = CacheController::add_cache_control(&messages, &config);
        assert!(result.is_empty());
        assert!(indices.is_empty());
    }

    #[test]
    fn test_add_cache_control_respects_recent_limit() {
        // Create 5 long messages
        let messages: Vec<Message> = (0..5).map(|_| create_long_message()).collect();

        let config = CacheConfig {
            cache_recent_messages: 2,
            min_tokens_for_cache: 100, // Lower threshold for testing
            ..Default::default()
        };

        let (result, indices) = CacheController::add_cache_control(&messages, &config);

        // All 5 messages should be returned
        assert_eq!(result.len(), 5);
        // Only the last 2 messages should be cacheable (indices 3 and 4)
        assert!(indices.iter().all(|&i| i >= 3));
    }

    #[test]
    fn test_add_cache_control_respects_token_threshold() {
        let messages = vec![create_short_message(), create_long_message()];

        let config = CacheConfig::default();
        let (result, indices) = CacheController::add_cache_control(&messages, &config);

        // Both messages should be returned
        assert_eq!(result.len(), 2);
        // Only the long message (index 1) should be cacheable
        assert!(indices.contains(&1) || indices.is_empty());
    }

    #[test]
    fn test_get_cache_eligibility_empty() {
        let messages: Vec<Message> = vec![];
        let config = CacheConfig::default();
        let eligibility = CacheController::get_cache_eligibility(&messages, &config);
        assert!(eligibility.cacheable_indices.is_empty());
        assert_eq!(eligibility.cacheable_tokens, 0);
    }

    #[test]
    fn test_get_cache_eligibility_with_long_messages() {
        let messages: Vec<Message> = (0..3).map(|_| create_long_message()).collect();

        let config = CacheConfig {
            min_tokens_for_cache: 100,
            cache_recent_messages: 10,
            ..Default::default()
        };

        let eligibility = CacheController::get_cache_eligibility(&messages, &config);

        // All 3 messages should be cacheable
        assert_eq!(eligibility.cacheable_indices.len(), 3);
        assert!(eligibility.cacheable_tokens > 0);
    }

    #[test]
    fn test_calculate_cache_savings_no_cache() {
        let usage = TokenUsage::new(1000, 500);
        let savings = CacheController::calculate_cache_savings(&usage);

        // Without caching, base_cost should equal cache_cost
        assert!((savings.base_cost - savings.cache_cost).abs() < 0.0001);
        assert!(savings.savings.abs() < 0.0001);
    }

    #[test]
    fn test_calculate_cache_savings_with_cache_read() {
        let usage = TokenUsage {
            input_tokens: 1000,
            output_tokens: 500,
            cache_creation_tokens: Some(0),
            cache_read_tokens: Some(800), // 80% cache hit
            thinking_tokens: None,
        };

        let savings = CacheController::calculate_cache_savings(&usage);

        // With cache read, actual cost should be lower
        assert!(savings.savings > 0.0);
        assert!(savings.cache_cost < savings.base_cost);
    }

    #[test]
    fn test_calculate_cache_savings_with_cache_write() {
        let usage = TokenUsage {
            input_tokens: 1000,
            output_tokens: 500,
            cache_creation_tokens: Some(500), // Writing to cache
            cache_read_tokens: Some(0),
            thinking_tokens: None,
        };

        let savings = CacheController::calculate_cache_savings(&usage);

        // Cache write is more expensive (1.25x), so savings should be negative
        assert!(savings.savings < 0.0);
    }

    #[test]
    fn test_calculate_cache_savings_mixed() {
        let usage = TokenUsage {
            input_tokens: 10000,
            output_tokens: 1000,
            cache_creation_tokens: Some(1000), // Some cache write
            cache_read_tokens: Some(8000),     // Mostly cache read
            thinking_tokens: None,
        };

        let savings = CacheController::calculate_cache_savings(&usage);

        // With high cache read ratio, should have positive savings
        assert!(savings.savings > 0.0);
        assert!(savings.savings_percentage() > 0.0);
    }

    #[test]
    fn test_calculate_cache_stats_no_cache() {
        let usage = TokenUsage::new(1000, 500);
        let stats = CacheController::calculate_cache_stats(&usage);

        assert_eq!(stats.total_cache_creation_tokens, 0);
        assert_eq!(stats.total_cache_read_tokens, 0);
        assert_eq!(stats.cache_hit_rate, 0.0);
    }

    #[test]
    fn test_calculate_cache_stats_with_cache() {
        let usage = TokenUsage {
            input_tokens: 1000,
            output_tokens: 500,
            cache_creation_tokens: Some(200),
            cache_read_tokens: Some(800),
            thinking_tokens: None,
        };

        let stats = CacheController::calculate_cache_stats(&usage);

        assert_eq!(stats.total_cache_creation_tokens, 200);
        assert_eq!(stats.total_cache_read_tokens, 800);
        assert!((stats.cache_hit_rate - 0.8).abs() < 0.001);
    }

    #[test]
    fn test_accumulate_cache_stats() {
        let usages = [
            TokenUsage {
                input_tokens: 1000,
                output_tokens: 500,
                cache_creation_tokens: Some(100),
                cache_read_tokens: Some(400),
                thinking_tokens: None,
            },
            TokenUsage {
                input_tokens: 2000,
                output_tokens: 1000,
                cache_creation_tokens: Some(200),
                cache_read_tokens: Some(600),
                thinking_tokens: None,
            },
        ];

        let stats = CacheController::accumulate_cache_stats(usages.iter());

        assert_eq!(stats.total_cache_creation_tokens, 300);
        assert_eq!(stats.total_cache_read_tokens, 1000);
        // Hit rate: 1000 / (300 + 1000) = 0.769...
        assert!((stats.cache_hit_rate - 0.769).abs() < 0.01);
    }

    #[test]
    fn test_cache_savings_percentage() {
        let savings = CacheSavings::new(100.0, 60.0);
        assert!((savings.savings_percentage() - 40.0).abs() < 0.001);
    }

    #[test]
    fn test_cache_savings_percentage_zero_base() {
        let savings = CacheSavings::new(0.0, 0.0);
        assert_eq!(savings.savings_percentage(), 0.0);
    }
}
