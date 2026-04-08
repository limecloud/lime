//! 网络请求重试策略
//!
//! 支持指数退避和抖动

use rand::Rng;
use serde::{Deserialize, Serialize};
use std::future::Future;
use std::time::Duration;
use tokio::time::sleep;

/// 重试配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetryConfig {
    /// 最大重试次数
    #[serde(default = "default_max_retries")]
    pub max_retries: u32,
    /// 基础延迟（毫秒）
    #[serde(default = "default_base_delay")]
    pub base_delay: u64,
    /// 最大延迟（毫秒）
    #[serde(default = "default_max_delay")]
    pub max_delay: u64,
    /// 是否使用指数退避
    #[serde(default = "default_exponential_backoff")]
    pub exponential_backoff: bool,
    /// 抖动因子 (0.0-1.0)
    #[serde(default = "default_jitter")]
    pub jitter: f64,
    /// 可重试的错误类型
    #[serde(default = "default_retryable_errors")]
    pub retryable_errors: Vec<String>,
    /// 可重试的状态码
    #[serde(default = "default_retryable_status_codes")]
    pub retryable_status_codes: Vec<u16>,
}

fn default_max_retries() -> u32 {
    4
}
fn default_base_delay() -> u64 {
    1000
}
fn default_max_delay() -> u64 {
    30000
}
fn default_exponential_backoff() -> bool {
    true
}
fn default_jitter() -> f64 {
    0.1
}

fn default_retryable_errors() -> Vec<String> {
    vec![
        "ECONNRESET".to_string(),
        "ETIMEDOUT".to_string(),
        "ENOTFOUND".to_string(),
        "ECONNREFUSED".to_string(),
        "ENETUNREACH".to_string(),
        "overloaded_error".to_string(),
        "rate_limit_error".to_string(),
        "api_error".to_string(),
        "timeout".to_string(),
    ]
}

fn default_retryable_status_codes() -> Vec<u16> {
    vec![408, 429, 500, 502, 503, 504]
}

impl Default for RetryConfig {
    fn default() -> Self {
        DEFAULT_RETRY_CONFIG.clone()
    }
}

/// 默认重试配置
pub const DEFAULT_RETRY_CONFIG: RetryConfig = RetryConfig {
    max_retries: 4,
    base_delay: 1000,
    max_delay: 30000,
    exponential_backoff: true,
    jitter: 0.1,
    retryable_errors: Vec::new(), // 使用 default_retryable_errors()
    retryable_status_codes: Vec::new(), // 使用 default_retryable_status_codes()
};

/// 计算重试延迟
pub fn calculate_retry_delay(attempt: u32, config: &RetryConfig) -> u64 {
    let mut delay = config.base_delay;

    if config.exponential_backoff {
        delay = config.base_delay * 2u64.pow(attempt);
    }

    // 应用抖动（避免惊群效应）
    if config.jitter > 0.0 {
        let jitter_amount = (delay as f64 * config.jitter) as i64;
        let random_jitter = rand::thread_rng().gen_range(-jitter_amount..=jitter_amount);
        delay = (delay as i64 + random_jitter).max(0) as u64;
    }

    // 限制最大延迟
    delay.min(config.max_delay)
}

/// 判断错误是否可重试
pub fn is_retryable_error(error: &str, status_code: Option<u16>, config: &RetryConfig) -> bool {
    let retryable_errors = if config.retryable_errors.is_empty() {
        default_retryable_errors()
    } else {
        config.retryable_errors.clone()
    };

    let retryable_status_codes = if config.retryable_status_codes.is_empty() {
        default_retryable_status_codes()
    } else {
        config.retryable_status_codes.clone()
    };

    // 检查错误消息
    for code in &retryable_errors {
        if error.contains(code) {
            return true;
        }
    }

    // 检查 HTTP 状态码
    if let Some(status) = status_code {
        if retryable_status_codes.contains(&status) {
            return true;
        }
    }

    false
}

/// 重试错误信息
#[derive(Debug, Clone)]
pub struct RetryError<E> {
    /// 最后一次错误
    pub last_error: E,
    /// 重试次数
    pub attempts: u32,
}

impl<E: std::fmt::Display> std::fmt::Display for RetryError<E> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Failed after {} attempts: {}",
            self.attempts, self.last_error
        )
    }
}

impl<E: std::error::Error + 'static> std::error::Error for RetryError<E> {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.last_error)
    }
}

/// 执行带重试的操作
pub async fn with_retry<T, E, F, Fut>(
    operation: F,
    config: &RetryConfig,
    is_retryable: impl Fn(&E) -> bool,
    on_retry: Option<impl Fn(u32, &E, u64)>,
) -> Result<T, RetryError<E>>
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<T, E>>,
{
    let mut last_error: Option<E> = None;

    for attempt in 0..=config.max_retries {
        match operation().await {
            Ok(result) => return Ok(result),
            Err(error) => {
                // 最后一次尝试失败
                if attempt == config.max_retries {
                    return Err(RetryError {
                        last_error: error,
                        attempts: attempt + 1,
                    });
                }

                // 检查是否可重试
                if !is_retryable(&error) {
                    return Err(RetryError {
                        last_error: error,
                        attempts: attempt + 1,
                    });
                }

                // 计算延迟
                let delay = calculate_retry_delay(attempt, config);

                // 调用回调
                if let Some(ref callback) = on_retry {
                    callback(attempt + 1, &error, delay);
                }

                last_error = Some(error);

                // 等待后重试
                sleep(Duration::from_millis(delay)).await;
            }
        }
    }

    Err(RetryError {
        last_error: last_error.unwrap(),
        attempts: config.max_retries + 1,
    })
}

/// 简化的重试函数
pub async fn retry<T, E, F, Fut>(operation: F, config: &RetryConfig) -> Result<T, RetryError<E>>
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<T, E>>,
    E: std::fmt::Display,
{
    with_retry(
        operation,
        config,
        |e| is_retryable_error(&e.to_string(), None, config),
        None::<fn(u32, &E, u64)>,
    )
    .await
}
