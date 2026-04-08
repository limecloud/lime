//! 速率限制器
//!
//! 管理 API 请求速率限制

use parking_lot::RwLock;
use std::collections::VecDeque;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

/// 速率限制配置
#[derive(Debug, Clone)]
pub struct RateLimitConfig {
    /// 每分钟最大请求数
    pub max_requests_per_minute: u32,
    /// 每分钟最大 Token 数
    pub max_tokens_per_minute: u32,
    /// 最大重试次数
    pub max_retries: u32,
    /// 基础重试延迟（毫秒）
    pub base_retry_delay_ms: u64,
    /// 最大重试延迟（毫秒）
    pub max_retry_delay_ms: u64,
    /// 可重试的状态码
    pub retryable_status_codes: Vec<u16>,
}

impl Default for RateLimitConfig {
    fn default() -> Self {
        Self {
            max_requests_per_minute: 50,
            max_tokens_per_minute: 100_000,
            max_retries: 3,
            base_retry_delay_ms: 1000,
            max_retry_delay_ms: 60_000,
            retryable_status_codes: vec![429, 500, 502, 503, 504],
        }
    }
}

/// 速率限制状态
#[derive(Debug, Clone)]
pub struct RateLimitState {
    /// 本分钟请求数
    pub requests_this_minute: u32,
    /// 本分钟 Token 数
    pub tokens_this_minute: u32,
    /// 上次重置时间
    pub last_reset_time: Instant,
    /// 是否被限流
    pub is_rate_limited: bool,
    /// 重试等待时间（秒）
    pub retry_after: Option<u64>,
}

impl Default for RateLimitState {
    fn default() -> Self {
        Self {
            requests_this_minute: 0,
            tokens_this_minute: 0,
            last_reset_time: Instant::now(),
            is_rate_limited: false,
            retry_after: None,
        }
    }
}

/// 速率限制事件
#[derive(Debug, Clone)]
pub enum RateLimitEvent {
    /// 被限流
    RateLimited {
        reason: String,
        current: u32,
        limit: u32,
    },
    /// 限流重置
    RateLimitReset,
}

/// 速率限制器
pub struct RateLimiter {
    config: RateLimitConfig,
    state: Arc<RwLock<RateLimitState>>,
    event_tx: Option<mpsc::UnboundedSender<RateLimitEvent>>,
    queue: Arc<RwLock<VecDeque<QueuedRequest>>>,
}

struct QueuedRequest {
    id: u64,
    estimated_tokens: Option<u32>,
}

impl RateLimiter {
    /// 创建新的速率限制器
    pub fn new(config: RateLimitConfig) -> Self {
        Self {
            config,
            state: Arc::new(RwLock::new(RateLimitState::default())),
            event_tx: None,
            queue: Arc::new(RwLock::new(VecDeque::new())),
        }
    }

    /// 设置事件通道
    pub fn with_event_channel(mut self, tx: mpsc::UnboundedSender<RateLimitEvent>) -> Self {
        self.event_tx = Some(tx);
        self
    }

    /// 检查是否需要重置计数器
    fn maybe_reset(&self) {
        let mut state = self.state.write();
        let elapsed = state.last_reset_time.elapsed();

        if elapsed >= Duration::from_secs(60) {
            state.requests_this_minute = 0;
            state.tokens_this_minute = 0;
            state.last_reset_time = Instant::now();

            if state.is_rate_limited {
                state.is_rate_limited = false;
                if let Some(ref tx) = self.event_tx {
                    let _ = tx.send(RateLimitEvent::RateLimitReset);
                }
            }
        }
    }

    /// 检查是否可以发起请求
    pub fn can_make_request(&self, estimated_tokens: Option<u32>) -> bool {
        self.maybe_reset();
        let state = self.state.read();

        if state.is_rate_limited {
            return false;
        }

        if state.requests_this_minute >= self.config.max_requests_per_minute {
            return false;
        }

        if let Some(tokens) = estimated_tokens {
            if state.tokens_this_minute + tokens > self.config.max_tokens_per_minute {
                return false;
            }
        }

        true
    }

    /// 记录请求
    pub fn record_request(&self, tokens: Option<u32>) {
        self.maybe_reset();
        let mut state = self.state.write();

        state.requests_this_minute += 1;

        if let Some(t) = tokens {
            state.tokens_this_minute += t;
        }

        // 检查是否达到限制
        if state.requests_this_minute >= self.config.max_requests_per_minute {
            state.is_rate_limited = true;
            if let Some(ref tx) = self.event_tx {
                let _ = tx.send(RateLimitEvent::RateLimited {
                    reason: "requests".to_string(),
                    current: state.requests_this_minute,
                    limit: self.config.max_requests_per_minute,
                });
            }
        }

        if state.tokens_this_minute >= self.config.max_tokens_per_minute {
            state.is_rate_limited = true;
            if let Some(ref tx) = self.event_tx {
                let _ = tx.send(RateLimitEvent::RateLimited {
                    reason: "tokens".to_string(),
                    current: state.tokens_this_minute,
                    limit: self.config.max_tokens_per_minute,
                });
            }
        }
    }

    /// 处理 API 返回的限流响应
    pub fn handle_rate_limit_response(&self, retry_after: Option<u64>) {
        let mut state = self.state.write();
        state.is_rate_limited = true;
        state.retry_after = retry_after;

        if let Some(ref tx) = self.event_tx {
            let _ = tx.send(RateLimitEvent::RateLimited {
                reason: "api".to_string(),
                current: 0,
                limit: 0,
            });
        }
    }

    /// 获取当前状态
    pub fn get_state(&self) -> RateLimitState {
        self.maybe_reset();
        self.state.read().clone()
    }

    /// 获取距离重置的时间（毫秒）
    pub fn get_time_until_reset(&self) -> u64 {
        let state = self.state.read();
        let elapsed = state.last_reset_time.elapsed().as_millis() as u64;
        60_000u64.saturating_sub(elapsed)
    }

    /// 等待直到可以发起请求
    pub async fn wait_for_capacity(&self, estimated_tokens: Option<u32>) {
        while !self.can_make_request(estimated_tokens) {
            let wait_time = self.get_time_until_reset();
            tokio::time::sleep(Duration::from_millis(wait_time.min(1000))).await;
        }
    }

    /// 获取配置
    pub fn config(&self) -> &RateLimitConfig {
        &self.config
    }
}

impl Default for RateLimiter {
    fn default() -> Self {
        Self::new(RateLimitConfig::default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rate_limiter_default() {
        let limiter = RateLimiter::default();
        assert!(limiter.can_make_request(None));
    }

    #[test]
    fn test_record_request() {
        let limiter = RateLimiter::default();
        limiter.record_request(Some(100));

        let state = limiter.get_state();
        assert_eq!(state.requests_this_minute, 1);
        assert_eq!(state.tokens_this_minute, 100);
    }

    #[test]
    fn test_rate_limit_reached() {
        let config = RateLimitConfig {
            max_requests_per_minute: 2,
            ..Default::default()
        };
        let limiter = RateLimiter::new(config);

        assert!(limiter.can_make_request(None));
        limiter.record_request(None);
        assert!(limiter.can_make_request(None));
        limiter.record_request(None);
        assert!(!limiter.can_make_request(None));
    }

    #[test]
    fn test_token_limit() {
        let config = RateLimitConfig {
            max_tokens_per_minute: 1000,
            ..Default::default()
        };
        let limiter = RateLimiter::new(config);

        assert!(limiter.can_make_request(Some(500)));
        limiter.record_request(Some(500));
        assert!(limiter.can_make_request(Some(400)));
        assert!(!limiter.can_make_request(Some(600)));
    }
}
