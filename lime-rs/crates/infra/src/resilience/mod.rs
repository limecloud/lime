//! 容错机制模块
//!
//! 提供重试、故障转移和超时控制功能

mod failover;
mod retry;
mod timeout;

pub use failover::{
    Failover, FailoverConfig, FailoverManager, FailoverResult, FailureType,
    QUOTA_EXCEEDED_KEYWORDS, QUOTA_EXCEEDED_STATUS_CODES, SwitchEvent,
};
pub use retry::{Retrier, RetryConfig, RetryError};
pub use timeout::{
    CancellationToken, StreamIdleDetector, StreamWithIdleTimeout, TimeoutConfig, TimeoutController,
    TimeoutError,
};

#[cfg(test)]
mod tests;
