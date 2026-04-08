//! 重试策略
//!
//! 指数退避重试和错误判断

use std::future::Future;
use std::time::Duration;

/// 重试策略配置
#[derive(Debug, Clone)]
pub struct RetryPolicy {
    /// 最大重试次数
    pub max_retries: u32,
    /// 基础延迟（毫秒）
    pub base_delay_ms: u64,
    /// 最大延迟（毫秒）
    pub max_delay_ms: u64,
    /// 指数基数
    pub exponential_base: f64,
    /// 是否添加抖动
    pub jitter: bool,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_retries: 3,
            base_delay_ms: 1000,
            max_delay_ms: 60_000,
            exponential_base: 2.0,
            jitter: true,
        }
    }
}

/// 计算重试延迟
fn calculate_delay(policy: &RetryPolicy, attempt: u32) -> Duration {
    let mut delay = policy.base_delay_ms as f64 * policy.exponential_base.powi(attempt as i32);

    // 添加抖动
    if policy.jitter {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        delay *= 0.5 + rng.gen::<f64>();
    }

    // 限制最大延迟
    let delay_ms = (delay as u64).min(policy.max_delay_ms);
    Duration::from_millis(delay_ms)
}

/// 带指数退避的重试
pub async fn retry_with_backoff<T, E, F, Fut>(mut f: F, policy: RetryPolicy) -> Result<T, E>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, E>>,
    E: std::fmt::Debug,
{
    let mut last_error: Option<E> = None;

    for attempt in 0..=policy.max_retries {
        match f().await {
            Ok(result) => return Ok(result),
            Err(err) => {
                last_error = Some(err);

                if attempt < policy.max_retries {
                    let delay = calculate_delay(&policy, attempt);
                    tokio::time::sleep(delay).await;
                }
            }
        }
    }

    Err(last_error.unwrap())
}

/// 默认可重试状态码
const DEFAULT_RETRYABLE_STATUS_CODES: &[u16] = &[429, 500, 502, 503, 504];

/// 检查错误是否可重试
pub fn is_retryable_error(error: &str, status_codes: Option<&[u16]>) -> bool {
    let codes = status_codes.unwrap_or(DEFAULT_RETRYABLE_STATUS_CODES);

    // 检查网络错误
    let network_errors = [
        "ECONNREFUSED",
        "ETIMEDOUT",
        "ENOTFOUND",
        "connection refused",
        "timeout",
        "network error",
    ];

    for net_err in network_errors {
        if error.to_lowercase().contains(&net_err.to_lowercase()) {
            return true;
        }
    }

    // 检查限流
    if error.contains("rate limit") || error.contains("429") {
        return true;
    }

    // 检查状态码
    for code in codes {
        if error.contains(&code.to_string()) {
            return true;
        }
    }

    false
}

/// 解析 Retry-After 头
pub fn parse_retry_after(header: &str) -> Option<u64> {
    // 尝试解析为秒数
    if let Ok(seconds) = header.parse::<u64>() {
        return Some(seconds);
    }

    // 尝试解析为 HTTP 日期
    if let Ok(date) = chrono::DateTime::parse_from_rfc2822(header) {
        let now = chrono::Utc::now();
        let diff = date.signed_duration_since(now);
        if diff.num_seconds() > 0 {
            return Some(diff.num_seconds() as u64);
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_retryable_error() {
        assert!(is_retryable_error("rate limit exceeded", None));
        assert!(is_retryable_error("status code 429", None));
        assert!(is_retryable_error("connection refused", None));
        assert!(is_retryable_error("ETIMEDOUT", None));
        assert!(!is_retryable_error("invalid request", None));
    }

    #[test]
    fn test_parse_retry_after_seconds() {
        assert_eq!(parse_retry_after("60"), Some(60));
        assert_eq!(parse_retry_after("0"), Some(0));
    }

    #[test]
    fn test_calculate_delay() {
        let policy = RetryPolicy {
            jitter: false,
            ..Default::default()
        };

        let delay0 = calculate_delay(&policy, 0);
        let delay1 = calculate_delay(&policy, 1);
        let delay2 = calculate_delay(&policy, 2);

        assert_eq!(delay0.as_millis(), 1000);
        assert_eq!(delay1.as_millis(), 2000);
        assert_eq!(delay2.as_millis(), 4000);
    }
}
