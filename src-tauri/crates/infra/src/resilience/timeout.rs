//! 超时控制实现
//!
//! 提供请求超时和流式响应空闲超时功能

use serde::{Deserialize, Serialize};
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Notify;

/// 超时配置
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TimeoutConfig {
    /// 全局请求超时（毫秒），0 表示无超时
    pub request_timeout_ms: u64,
    /// 流式响应空闲超时（毫秒），0 表示无超时
    /// 当流式响应中两个 chunk 之间的间隔超过此值时触发超时
    pub stream_idle_timeout_ms: u64,
}

impl Default for TimeoutConfig {
    fn default() -> Self {
        Self {
            request_timeout_ms: 120_000,     // 2 分钟
            stream_idle_timeout_ms: 120_000, // 2 分钟，兼容推理模型长时间思考
        }
    }
}

impl TimeoutConfig {
    /// 创建新的超时配置
    pub fn new(request_timeout_ms: u64, stream_idle_timeout_ms: u64) -> Self {
        Self {
            request_timeout_ms,
            stream_idle_timeout_ms,
        }
    }

    /// 创建无超时的配置
    pub fn no_timeout() -> Self {
        Self {
            request_timeout_ms: 0,
            stream_idle_timeout_ms: 0,
        }
    }

    /// 获取请求超时 Duration
    pub fn request_timeout(&self) -> Option<Duration> {
        if self.request_timeout_ms > 0 {
            Some(Duration::from_millis(self.request_timeout_ms))
        } else {
            None
        }
    }

    /// 获取流式空闲超时 Duration
    pub fn stream_idle_timeout(&self) -> Option<Duration> {
        if self.stream_idle_timeout_ms > 0 {
            Some(Duration::from_millis(self.stream_idle_timeout_ms))
        } else {
            None
        }
    }

    /// 检查是否启用请求超时
    pub fn has_request_timeout(&self) -> bool {
        self.request_timeout_ms > 0
    }

    /// 检查是否启用流式空闲超时
    pub fn has_stream_idle_timeout(&self) -> bool {
        self.stream_idle_timeout_ms > 0
    }
}

/// 超时错误
#[derive(Debug, Clone, PartialEq)]
pub enum TimeoutError {
    /// 请求超时
    RequestTimeout { timeout_ms: u64, elapsed_ms: u64 },
    /// 流式响应空闲超时
    StreamIdleTimeout { timeout_ms: u64, idle_ms: u64 },
    /// 操作被取消
    Cancelled,
}

impl std::fmt::Display for TimeoutError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TimeoutError::RequestTimeout {
                timeout_ms,
                elapsed_ms,
            } => {
                write!(f, "请求超时: 配置 {timeout_ms}ms, 已耗时 {elapsed_ms}ms")
            }
            TimeoutError::StreamIdleTimeout {
                timeout_ms,
                idle_ms,
            } => {
                write!(f, "流式响应空闲超时: 配置 {timeout_ms}ms, 空闲 {idle_ms}ms")
            }
            TimeoutError::Cancelled => {
                write!(f, "操作已取消")
            }
        }
    }
}

impl std::error::Error for TimeoutError {}

/// 取消令牌
///
/// 用于取消正在进行的请求
#[derive(Debug, Clone)]
pub struct CancellationToken {
    cancelled: Arc<AtomicBool>,
    notify: Arc<Notify>,
}

impl Default for CancellationToken {
    fn default() -> Self {
        Self::new()
    }
}

impl CancellationToken {
    /// 创建新的取消令牌
    pub fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
            notify: Arc::new(Notify::new()),
        }
    }

    /// 取消操作
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        self.notify.notify_waiters();
    }

    /// 检查是否已取消
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    /// 等待取消信号
    pub async fn cancelled(&self) {
        // 如果已经取消，立即返回
        if self.is_cancelled() {
            return;
        }
        // 否则等待通知
        self.notify.notified().await;
    }

    /// 重置取消状态
    pub fn reset(&self) {
        self.cancelled.store(false, Ordering::SeqCst);
    }
}

/// 超时控制器
#[derive(Debug, Clone)]
pub struct TimeoutController {
    config: TimeoutConfig,
}

impl TimeoutController {
    /// 创建新的超时控制器
    pub fn new(config: TimeoutConfig) -> Self {
        Self { config }
    }

    /// 使用默认配置创建
    pub fn with_defaults() -> Self {
        Self::new(TimeoutConfig::default())
    }

    /// 获取配置
    pub fn config(&self) -> &TimeoutConfig {
        &self.config
    }

    /// 带超时执行异步操作
    ///
    /// # Arguments
    /// * `operation` - 要执行的异步操作
    ///
    /// # Returns
    /// 操作结果或超时错误
    pub async fn execute_with_timeout<F, T>(&self, operation: F) -> Result<T, TimeoutError>
    where
        F: Future<Output = T>,
    {
        let start = Instant::now();

        match self.config.request_timeout() {
            Some(timeout) => match tokio::time::timeout(timeout, operation).await {
                Ok(result) => Ok(result),
                Err(_) => Err(TimeoutError::RequestTimeout {
                    timeout_ms: self.config.request_timeout_ms,
                    elapsed_ms: start.elapsed().as_millis() as u64,
                }),
            },
            None => Ok(operation.await),
        }
    }

    /// 带超时和取消执行异步操作
    ///
    /// # Arguments
    /// * `operation` - 要执行的异步操作
    /// * `cancel_token` - 取消令牌
    ///
    /// # Returns
    /// 操作结果或超时/取消错误
    pub async fn execute_with_timeout_and_cancel<F, T>(
        &self,
        operation: F,
        cancel_token: &CancellationToken,
    ) -> Result<T, TimeoutError>
    where
        F: Future<Output = T>,
    {
        let start = Instant::now();

        // 检查是否已取消
        if cancel_token.is_cancelled() {
            return Err(TimeoutError::Cancelled);
        }

        match self.config.request_timeout() {
            Some(timeout) => {
                tokio::select! {
                    result = tokio::time::timeout(timeout, operation) => {
                        match result {
                            Ok(value) => Ok(value),
                            Err(_) => Err(TimeoutError::RequestTimeout {
                                timeout_ms: self.config.request_timeout_ms,
                                elapsed_ms: start.elapsed().as_millis() as u64,
                            }),
                        }
                    }
                    _ = cancel_token.cancelled() => {
                        Err(TimeoutError::Cancelled)
                    }
                }
            }
            None => {
                tokio::select! {
                    result = operation => Ok(result),
                    _ = cancel_token.cancelled() => Err(TimeoutError::Cancelled),
                }
            }
        }
    }
}

impl Default for TimeoutController {
    fn default() -> Self {
        Self::with_defaults()
    }
}

/// 流式响应空闲检测器
///
/// 用于检测流式响应中的空闲超时
#[derive(Debug)]
pub struct StreamIdleDetector {
    config: TimeoutConfig,
    last_activity: Arc<std::sync::Mutex<Instant>>,
    cancelled: Arc<AtomicBool>,
}

impl StreamIdleDetector {
    /// 创建新的空闲检测器
    pub fn new(config: TimeoutConfig) -> Self {
        Self {
            config,
            last_activity: Arc::new(std::sync::Mutex::new(Instant::now())),
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    /// 使用默认配置创建
    pub fn with_defaults() -> Self {
        Self::new(TimeoutConfig::default())
    }

    /// 记录活动（收到 chunk 时调用）
    pub fn record_activity(&self) {
        if let Ok(mut last) = self.last_activity.lock() {
            *last = Instant::now();
        }
    }

    /// 获取自上次活动以来的空闲时间
    pub fn idle_duration(&self) -> Duration {
        self.last_activity
            .lock()
            .map(|last| last.elapsed())
            .unwrap_or(Duration::ZERO)
    }

    /// 检查是否空闲超时
    pub fn is_idle_timeout(&self) -> bool {
        if let Some(timeout) = self.config.stream_idle_timeout() {
            self.idle_duration() > timeout
        } else {
            false
        }
    }

    /// 取消检测
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    /// 检查是否已取消
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    /// 重置检测器状态
    pub fn reset(&self) {
        self.record_activity();
        self.cancelled.store(false, Ordering::SeqCst);
    }

    /// 等待空闲超时或取消
    ///
    /// 返回 `Ok(())` 如果正常完成（被取消），
    /// 返回 `Err(TimeoutError::StreamIdleTimeout)` 如果空闲超时
    pub async fn wait_for_timeout(&self) -> Result<(), TimeoutError> {
        let timeout = match self.config.stream_idle_timeout() {
            Some(t) => t,
            None => {
                // 无超时配置，永远等待直到取消
                loop {
                    if self.is_cancelled() {
                        return Ok(());
                    }
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            }
        };

        loop {
            if self.is_cancelled() {
                return Ok(());
            }

            let idle = self.idle_duration();
            if idle > timeout {
                return Err(TimeoutError::StreamIdleTimeout {
                    timeout_ms: self.config.stream_idle_timeout_ms,
                    idle_ms: idle.as_millis() as u64,
                });
            }

            // 计算下次检查的时间
            let remaining = timeout.saturating_sub(idle);
            let check_interval = remaining.min(Duration::from_millis(100));

            tokio::time::sleep(check_interval).await;
        }
    }

    /// 获取配置
    pub fn config(&self) -> &TimeoutConfig {
        &self.config
    }
}

/// 带空闲超时的流式处理包装器
///
/// 用于包装流式响应处理，自动检测空闲超时
pub struct StreamWithIdleTimeout<S> {
    stream: S,
    detector: Arc<StreamIdleDetector>,
}

impl<S> StreamWithIdleTimeout<S> {
    /// 创建新的带空闲超时的流
    pub fn new(stream: S, config: TimeoutConfig) -> Self {
        Self {
            stream,
            detector: Arc::new(StreamIdleDetector::new(config)),
        }
    }

    /// 获取内部流的引用
    pub fn inner(&self) -> &S {
        &self.stream
    }

    /// 获取内部流的可变引用
    pub fn inner_mut(&mut self) -> &mut S {
        &mut self.stream
    }

    /// 获取检测器
    pub fn detector(&self) -> &Arc<StreamIdleDetector> {
        &self.detector
    }

    /// 记录活动
    pub fn record_activity(&self) {
        self.detector.record_activity();
    }

    /// 取消流处理
    pub fn cancel(&self) {
        self.detector.cancel();
    }

    /// 检查是否空闲超时
    pub fn is_idle_timeout(&self) -> bool {
        self.detector.is_idle_timeout()
    }

    /// 消费包装器，返回内部流
    pub fn into_inner(self) -> S {
        self.stream
    }
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn test_timeout_config_default() {
        let config = TimeoutConfig::default();
        assert_eq!(config.request_timeout_ms, 120_000);
        assert_eq!(config.stream_idle_timeout_ms, 120_000);
        assert!(config.has_request_timeout());
        assert!(config.has_stream_idle_timeout());
    }

    #[test]
    fn test_timeout_config_no_timeout() {
        let config = TimeoutConfig::no_timeout();
        assert_eq!(config.request_timeout_ms, 0);
        assert_eq!(config.stream_idle_timeout_ms, 0);
        assert!(!config.has_request_timeout());
        assert!(!config.has_stream_idle_timeout());
        assert!(config.request_timeout().is_none());
        assert!(config.stream_idle_timeout().is_none());
    }

    #[test]
    fn test_timeout_config_durations() {
        let config = TimeoutConfig::new(5000, 1000);
        assert_eq!(config.request_timeout(), Some(Duration::from_millis(5000)));
        assert_eq!(
            config.stream_idle_timeout(),
            Some(Duration::from_millis(1000))
        );
    }

    #[test]
    fn test_cancellation_token() {
        let token = CancellationToken::new();
        assert!(!token.is_cancelled());

        token.cancel();
        assert!(token.is_cancelled());

        token.reset();
        assert!(!token.is_cancelled());
    }

    #[test]
    fn test_timeout_error_display() {
        let err = TimeoutError::RequestTimeout {
            timeout_ms: 5000,
            elapsed_ms: 5100,
        };
        assert!(err.to_string().contains("5000"));
        assert!(err.to_string().contains("5100"));

        let err = TimeoutError::StreamIdleTimeout {
            timeout_ms: 1000,
            idle_ms: 1200,
        };
        assert!(err.to_string().contains("1000"));
        assert!(err.to_string().contains("1200"));

        let err = TimeoutError::Cancelled;
        assert!(err.to_string().contains("取消"));
    }

    #[tokio::test]
    async fn test_execute_with_timeout_success() {
        let controller = TimeoutController::new(TimeoutConfig::new(1000, 0));

        let result = controller.execute_with_timeout(async { 42 }).await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 42);
    }

    #[tokio::test]
    async fn test_execute_with_timeout_timeout() {
        let controller = TimeoutController::new(TimeoutConfig::new(50, 0));

        let result: Result<(), TimeoutError> = controller
            .execute_with_timeout(async {
                tokio::time::sleep(Duration::from_millis(200)).await;
            })
            .await;

        assert!(result.is_err());
        match result.unwrap_err() {
            TimeoutError::RequestTimeout { timeout_ms, .. } => {
                assert_eq!(timeout_ms, 50);
            }
            _ => panic!("Expected RequestTimeout error"),
        }
    }

    #[tokio::test]
    async fn test_execute_with_no_timeout() {
        let controller = TimeoutController::new(TimeoutConfig::no_timeout());

        let result = controller
            .execute_with_timeout(async {
                tokio::time::sleep(Duration::from_millis(10)).await;
                42
            })
            .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 42);
    }

    #[tokio::test]
    async fn test_execute_with_cancel() {
        let controller = TimeoutController::new(TimeoutConfig::new(5000, 0));
        let token = CancellationToken::new();

        // 在另一个任务中取消
        let token_clone = token.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            token_clone.cancel();
        });

        let result: Result<(), TimeoutError> = controller
            .execute_with_timeout_and_cancel(
                async {
                    tokio::time::sleep(Duration::from_millis(5000)).await;
                },
                &token,
            )
            .await;

        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), TimeoutError::Cancelled);
    }

    #[tokio::test]
    async fn test_execute_already_cancelled() {
        let controller = TimeoutController::new(TimeoutConfig::new(5000, 0));
        let token = CancellationToken::new();
        token.cancel();

        let result: Result<i32, TimeoutError> = controller
            .execute_with_timeout_and_cancel(async { 42 }, &token)
            .await;

        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), TimeoutError::Cancelled);
    }

    #[test]
    fn test_stream_idle_detector_activity() {
        let detector = StreamIdleDetector::new(TimeoutConfig::new(0, 1000));

        // 刚创建时空闲时间应该很短
        assert!(detector.idle_duration() < Duration::from_millis(100));

        // 记录活动后空闲时间应该重置
        std::thread::sleep(Duration::from_millis(50));
        detector.record_activity();
        assert!(detector.idle_duration() < Duration::from_millis(50));
    }

    #[test]
    fn test_stream_idle_detector_timeout_check() {
        let detector = StreamIdleDetector::new(TimeoutConfig::new(0, 50));

        // 刚开始不应该超时
        assert!(!detector.is_idle_timeout());

        // 等待超过超时时间
        std::thread::sleep(Duration::from_millis(100));
        assert!(detector.is_idle_timeout());

        // 记录活动后不应该超时
        detector.record_activity();
        assert!(!detector.is_idle_timeout());
    }

    #[test]
    fn test_stream_idle_detector_no_timeout() {
        let detector = StreamIdleDetector::new(TimeoutConfig::no_timeout());

        // 无超时配置时永远不会超时
        std::thread::sleep(Duration::from_millis(50));
        assert!(!detector.is_idle_timeout());
    }

    #[test]
    fn test_stream_idle_detector_cancel() {
        let detector = StreamIdleDetector::new(TimeoutConfig::new(0, 1000));

        assert!(!detector.is_cancelled());
        detector.cancel();
        assert!(detector.is_cancelled());

        detector.reset();
        assert!(!detector.is_cancelled());
    }

    #[tokio::test]
    async fn test_stream_idle_detector_wait_cancelled() {
        let detector = StreamIdleDetector::new(TimeoutConfig::new(0, 5000));

        // 直接取消并验证等待返回 Ok
        detector.cancel();
        let result = detector.wait_for_timeout().await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_stream_idle_detector_wait_timeout() {
        let detector = StreamIdleDetector::new(TimeoutConfig::new(0, 50));

        let result = detector.wait_for_timeout().await;

        assert!(result.is_err());
        match result.unwrap_err() {
            TimeoutError::StreamIdleTimeout { timeout_ms, .. } => {
                assert_eq!(timeout_ms, 50);
            }
            _ => panic!("Expected StreamIdleTimeout error"),
        }
    }

    #[test]
    fn test_stream_with_idle_timeout() {
        let stream = vec![1, 2, 3];
        let wrapper = StreamWithIdleTimeout::new(stream, TimeoutConfig::new(0, 1000));

        assert_eq!(wrapper.inner(), &vec![1, 2, 3]);
        assert!(!wrapper.is_idle_timeout());

        wrapper.record_activity();
        assert!(!wrapper.is_idle_timeout());

        wrapper.cancel();
        assert!(wrapper.detector().is_cancelled());

        let inner = wrapper.into_inner();
        assert_eq!(inner, vec![1, 2, 3]);
    }
}
