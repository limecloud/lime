//! 网络超时和取消控制
//!
//! 支持超时配置和取消令牌

use serde::{Deserialize, Serialize};
use std::future::Future;
use std::time::Duration;
use thiserror::Error;
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;

/// 超时配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeoutConfig {
    /// 连接超时（毫秒）
    #[serde(default = "default_connect_timeout")]
    pub connect: u64,
    /// 请求超时（毫秒）
    #[serde(default = "default_request_timeout")]
    pub request: u64,
    /// 响应超时（毫秒）
    #[serde(default = "default_response_timeout")]
    pub response: u64,
    /// Socket 空闲超时（毫秒）
    #[serde(default = "default_idle_timeout")]
    pub idle: u64,
}

fn default_connect_timeout() -> u64 {
    30000
}
fn default_request_timeout() -> u64 {
    120000
}
fn default_response_timeout() -> u64 {
    120000
}
fn default_idle_timeout() -> u64 {
    60000
}

impl Default for TimeoutConfig {
    fn default() -> Self {
        DEFAULT_TIMEOUTS
    }
}

/// 默认超时配置
pub const DEFAULT_TIMEOUTS: TimeoutConfig = TimeoutConfig {
    connect: 30000,   // 30秒
    request: 120000,  // 2分钟
    response: 120000, // 2分钟
    idle: 60000,      // 1分钟
};

/// 超时错误
#[derive(Debug, Error)]
#[error("Operation timed out after {timeout_ms}ms")]
pub struct TimeoutError {
    /// 超时时间（毫秒）
    pub timeout_ms: u64,
}

/// 取消错误
#[derive(Debug, Error)]
#[error("Operation aborted")]
pub struct AbortError;

/// 检查错误是否为超时错误
pub fn is_timeout_error(error: &dyn std::error::Error) -> bool {
    error.to_string().contains("timed out") || error.to_string().contains("timeout")
}

/// 检查错误是否为取消错误
pub fn is_abort_error(error: &dyn std::error::Error) -> bool {
    error.to_string().contains("abort") || error.to_string().contains("cancel")
}

/// 带超时执行异步操作
pub async fn with_timeout<T, F>(future: F, timeout_ms: u64) -> Result<T, TimeoutError>
where
    F: Future<Output = T>,
{
    match timeout(Duration::from_millis(timeout_ms), future).await {
        Ok(result) => Ok(result),
        Err(_) => Err(TimeoutError { timeout_ms }),
    }
}

/// 带超时和取消执行异步操作
pub async fn with_timeout_and_cancel<T, F>(
    future: F,
    timeout_ms: u64,
    cancel_token: &CancellationToken,
) -> Result<T, TimeoutOrAbortError>
where
    F: Future<Output = T>,
{
    tokio::select! {
        result = timeout(Duration::from_millis(timeout_ms), future) => {
            match result {
                Ok(value) => Ok(value),
                Err(_) => Err(TimeoutOrAbortError::Timeout(TimeoutError { timeout_ms })),
            }
        }
        _ = cancel_token.cancelled() => {
            Err(TimeoutOrAbortError::Abort(AbortError))
        }
    }
}

/// 超时或取消错误
#[derive(Debug, Error)]
pub enum TimeoutOrAbortError {
    #[error("{0}")]
    Timeout(#[from] TimeoutError),
    #[error("{0}")]
    Abort(#[from] AbortError),
}

/// 可取消的延迟
pub async fn cancelable_delay(
    ms: u64,
    cancel_token: Option<&CancellationToken>,
) -> Result<(), AbortError> {
    let delay = tokio::time::sleep(Duration::from_millis(ms));

    match cancel_token {
        Some(token) => {
            tokio::select! {
                _ = delay => Ok(()),
                _ = token.cancelled() => Err(AbortError),
            }
        }
        None => {
            delay.await;
            Ok(())
        }
    }
}

/// 创建超时 Duration
pub fn timeout_duration(config: &TimeoutConfig) -> Duration {
    Duration::from_millis(config.request)
}

/// 创建连接超时 Duration
pub fn connect_timeout_duration(config: &TimeoutConfig) -> Duration {
    Duration::from_millis(config.connect)
}
