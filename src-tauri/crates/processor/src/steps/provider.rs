//! Provider 调用步骤
//!
//! 集成重试、故障转移和超时控制

#![allow(dead_code)]

use super::traits::{PipelineStep, StepError};
use async_trait::async_trait;
use lime_core::processor::RequestContext;
use lime_core::ProviderType;
use lime_infra::resilience::{FailoverManager, TimeoutError};
use lime_infra::{
    Failover, FailoverConfig, Retrier, RetryConfig, TimeoutConfig, TimeoutController,
};
use std::future::Future;
use std::sync::Arc;

/// Provider 调用结果
#[derive(Debug, Clone)]
pub struct ProviderCallResult {
    pub response: serde_json::Value,
    pub status_code: u16,
    pub latency_ms: u64,
    pub credential_id: Option<String>,
}

/// Provider 调用错误
#[derive(Debug, Clone)]
pub struct ProviderCallError {
    pub message: String,
    pub status_code: Option<u16>,
    pub retryable: bool,
    pub should_failover: bool,
}

impl ProviderCallError {
    pub fn retryable(message: impl Into<String>, status_code: Option<u16>) -> Self {
        Self {
            message: message.into(),
            status_code,
            retryable: true,
            should_failover: false,
        }
    }

    pub fn failover(message: impl Into<String>, status_code: Option<u16>) -> Self {
        Self {
            message: message.into(),
            status_code,
            retryable: false,
            should_failover: true,
        }
    }

    pub fn fatal(message: impl Into<String>, status_code: Option<u16>) -> Self {
        Self {
            message: message.into(),
            status_code,
            retryable: false,
            should_failover: false,
        }
    }

    pub fn is_quota_exceeded(&self) -> bool {
        Failover::is_quota_exceeded(self.status_code, &self.message)
    }
}

/// Provider 调用步骤
pub struct ProviderStep {
    retrier: Arc<Retrier>,
    failover: Arc<Failover>,
    timeout: Arc<TimeoutController>,
}

impl ProviderStep {
    pub fn new(
        retrier: Arc<Retrier>,
        failover: Arc<Failover>,
        timeout: Arc<TimeoutController>,
    ) -> Self {
        Self {
            retrier,
            failover,
            timeout,
        }
    }

    pub fn with_defaults() -> Self {
        Self {
            retrier: Arc::new(Retrier::with_defaults()),
            failover: Arc::new(Failover::new(FailoverConfig::default())),
            timeout: Arc::new(TimeoutController::with_defaults()),
        }
    }

    pub fn with_config(
        retry_config: RetryConfig,
        failover_config: FailoverConfig,
        timeout_config: TimeoutConfig,
    ) -> Self {
        Self {
            retrier: Arc::new(Retrier::new(retry_config)),
            failover: Arc::new(Failover::new(failover_config)),
            timeout: Arc::new(TimeoutController::new(timeout_config)),
        }
    }

    pub fn retrier(&self) -> &Retrier {
        &self.retrier
    }
    pub fn failover(&self) -> &Failover {
        &self.failover
    }
    pub fn timeout(&self) -> &TimeoutController {
        &self.timeout
    }

    /// 带重试执行 Provider 调用
    pub async fn execute_with_retry<F, Fut>(
        &self,
        ctx: &mut RequestContext,
        mut operation: F,
    ) -> Result<ProviderCallResult, ProviderCallError>
    where
        F: FnMut() -> Fut,
        Fut: Future<Output = Result<ProviderCallResult, ProviderCallError>>,
    {
        let max_retries = self.retrier.config().max_retries;
        let mut attempts = 0u32;

        loop {
            attempts += 1;
            match operation().await {
                Ok(result) => return Ok(result),
                Err(err) => {
                    ctx.increment_retry();
                    tracing::warn!(
                        "[RETRY] request_id={} attempt={}/{} error={} status={:?} retryable={}",
                        ctx.request_id,
                        attempts,
                        max_retries + 1,
                        err.message,
                        err.status_code,
                        err.retryable
                    );
                    if !err.retryable {
                        return Err(err);
                    }
                    let should_retry = err
                        .status_code
                        .is_none_or(|code| self.retrier.config().is_retryable(code));
                    let should_failover = err.should_failover || err.is_quota_exceeded();
                    if !should_retry || attempts > max_retries {
                        return Err(ProviderCallError {
                            message: err.message,
                            status_code: err.status_code,
                            retryable: false,
                            should_failover,
                        });
                    }
                    let delay = self.retrier.backoff_delay(attempts - 1);
                    tokio::time::sleep(delay).await;
                }
            }
        }
    }

    /// 带超时执行 Provider 调用
    pub async fn execute_with_timeout<F>(
        &self,
        ctx: &RequestContext,
        operation: F,
    ) -> Result<ProviderCallResult, ProviderCallError>
    where
        F: Future<Output = Result<ProviderCallResult, ProviderCallError>>,
    {
        let timeout_result = self.timeout.execute_with_timeout(operation).await;
        match timeout_result {
            Ok(call_result) => call_result,
            Err(timeout_err) => {
                let timeout_ms = match &timeout_err {
                    TimeoutError::RequestTimeout { timeout_ms, .. } => *timeout_ms,
                    TimeoutError::StreamIdleTimeout { timeout_ms, .. } => *timeout_ms,
                    TimeoutError::Cancelled => 0,
                };
                tracing::warn!(
                    "[TIMEOUT] request_id={} error={} timeout_ms={}",
                    ctx.request_id,
                    timeout_err,
                    timeout_ms
                );
                Err(ProviderCallError {
                    message: timeout_err.to_string(),
                    status_code: Some(408),
                    retryable: true,
                    should_failover: false,
                })
            }
        }
    }

    /// 带故障转移处理 Provider 失败
    pub fn handle_failover(
        &self,
        ctx: &RequestContext,
        error: &ProviderCallError,
        available_providers: &[ProviderType],
    ) -> Option<ProviderType> {
        let current_provider = ctx.provider?;
        let result = self.failover.handle_failure(
            current_provider,
            error.status_code,
            &error.message,
            available_providers,
        );
        if result.switched {
            tracing::info!(
                "[FAILOVER] request_id={} from={} to={:?} reason={:?}",
                ctx.request_id,
                current_provider,
                result.new_provider,
                result.failure_type
            );
            result.new_provider
        } else {
            tracing::warn!(
                "[FAILOVER] request_id={} provider={} no_switch reason={}",
                ctx.request_id,
                current_provider,
                result.message
            );
            None
        }
    }

    /// 带重试、超时和故障转移执行完整的 Provider 调用
    pub async fn execute_with_resilience<F, Fut>(
        &self,
        ctx: &mut RequestContext,
        mut operation_factory: F,
        available_providers: &[ProviderType],
    ) -> Result<ProviderCallResult, StepError>
    where
        F: FnMut(ProviderType) -> Fut,
        Fut: Future<Output = Result<ProviderCallResult, ProviderCallError>>,
    {
        let mut failover_manager = FailoverManager::new(self.failover.config().clone());
        let mut current_provider = ctx.provider.unwrap_or(ProviderType::Kiro);
        let max_failover_attempts = available_providers.len();
        let mut failover_attempts = 0;
        let max_retries = self.retrier.config().max_retries;

        'failover: loop {
            ctx.set_provider(current_provider);
            ctx.retry_count = 0;

            tracing::info!(
                "[PROVIDER] request_id={} provider={} model={} failover_attempt={}",
                ctx.request_id,
                current_provider,
                ctx.resolved_model,
                failover_attempts
            );

            let mut retry_attempts = 0u32;
            let result: Result<ProviderCallResult, ProviderCallError> =
                loop {
                    retry_attempts += 1;
                    let call_result = self
                        .execute_with_timeout(ctx, operation_factory(current_provider))
                        .await;
                    match call_result {
                        Ok(result) => break Ok(result),
                        Err(err) => {
                            ctx.increment_retry();
                            tracing::warn!(
                            "[RETRY] request_id={} attempt={}/{} error={} status={:?} retryable={}",
                            ctx.request_id, retry_attempts, max_retries + 1,
                            err.message, err.status_code, err.retryable
                        );
                            if !err.retryable {
                                break Err(err);
                            }
                            let should_retry = err
                                .status_code
                                .is_none_or(|code| self.retrier.config().is_retryable(code));
                            let should_failover = err.should_failover || err.is_quota_exceeded();
                            if !should_retry || retry_attempts > max_retries {
                                break Err(ProviderCallError {
                                    message: err.message,
                                    status_code: err.status_code,
                                    retryable: false,
                                    should_failover,
                                });
                            }
                            let delay = self.retrier.backoff_delay(retry_attempts - 1);
                            tokio::time::sleep(delay).await;
                        }
                    }
                };

            match result {
                Ok(call_result) => return Ok(call_result),
                Err(err) => {
                    if err.should_failover || err.is_quota_exceeded() {
                        failover_attempts += 1;
                        if failover_attempts >= max_failover_attempts {
                            tracing::error!(
                                "[PROVIDER] request_id={} all_providers_failed attempts={}",
                                ctx.request_id,
                                failover_attempts
                            );
                            return Err(StepError::Provider(format!(
                                "所有 Provider 都失败: {}",
                                err.message
                            )));
                        }
                        let failover_result = failover_manager.handle_failure_and_switch(
                            current_provider,
                            err.status_code,
                            &err.message,
                            available_providers,
                        );
                        if let Some(new_provider) = failover_result.new_provider {
                            tracing::info!(
                                "[FAILOVER] request_id={} from={} to={} reason={:?}",
                                ctx.request_id,
                                current_provider,
                                new_provider,
                                failover_result.failure_type
                            );
                            current_provider = new_provider;
                            continue 'failover;
                        }
                    }
                    return Err(StepError::Provider(err.message));
                }
            }
        }
    }

    pub fn is_quota_exceeded_error(&self, error: &ProviderCallError) -> bool {
        error.is_quota_exceeded()
    }

    pub fn is_retryable_status(&self, status_code: u16) -> bool {
        self.retrier.config().is_retryable(status_code)
    }
}

#[async_trait]
impl PipelineStep for ProviderStep {
    async fn execute(
        &self,
        ctx: &mut RequestContext,
        _payload: &mut serde_json::Value,
    ) -> Result<(), StepError> {
        tracing::info!(
            "[PROVIDER] request_id={} provider={:?} model={} retry_count={}",
            ctx.request_id,
            ctx.provider,
            ctx.resolved_model,
            ctx.retry_count
        );
        Ok(())
    }

    fn name(&self) -> &str {
        "provider"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn test_provider_step_new() {
        let step = ProviderStep::with_defaults();
        assert_eq!(step.name(), "provider");
        assert!(step.is_enabled());
    }

    #[tokio::test]
    async fn test_provider_step_execute() {
        let step = ProviderStep::with_defaults();
        let mut ctx = RequestContext::new("claude-sonnet-4-5".to_string());
        let mut payload = serde_json::json!({"model": "claude-sonnet-4-5"});
        assert!(step.execute(&mut ctx, &mut payload).await.is_ok());
    }
    #[tokio::test]
    async fn test_provider_step_with_config() {
        let retry_config = RetryConfig::new(5, 500, 10000);
        let failover_config = FailoverConfig::new(true, true);
        let timeout_config = TimeoutConfig::new(60000, 15000);

        let step = ProviderStep::with_config(
            retry_config.clone(),
            failover_config.clone(),
            timeout_config.clone(),
        );

        assert_eq!(step.retrier().config().max_retries, 5);
        assert_eq!(step.retrier().config().base_delay_ms, 500);
        assert!(step.failover().config().auto_switch);
        assert_eq!(step.timeout().config().request_timeout_ms, 60000);
    }

    #[test]
    fn test_provider_call_error_retryable() {
        let err = ProviderCallError::retryable("Connection timeout", Some(408));
        assert!(err.retryable);
        assert!(!err.should_failover);
        assert_eq!(err.status_code, Some(408));
    }

    #[test]
    fn test_provider_call_error_failover() {
        let err = ProviderCallError::failover("Rate limit exceeded", Some(429));
        assert!(!err.retryable);
        assert!(err.should_failover);
        assert!(err.is_quota_exceeded());
    }

    #[test]
    fn test_provider_call_error_fatal() {
        let err = ProviderCallError::fatal("Invalid API key", Some(401));
        assert!(!err.retryable);
        assert!(!err.should_failover);
    }

    #[test]
    fn test_is_quota_exceeded_by_status() {
        let err = ProviderCallError::retryable("Error", Some(429));
        assert!(err.is_quota_exceeded());
    }

    #[test]
    fn test_is_quota_exceeded_by_message() {
        let err = ProviderCallError::retryable("Rate limit exceeded", Some(400));
        assert!(err.is_quota_exceeded());

        let err2 = ProviderCallError::retryable("Quota exceeded for this API", Some(400));
        assert!(err2.is_quota_exceeded());
    }

    #[test]
    fn test_is_retryable_status() {
        let step = ProviderStep::with_defaults();

        assert!(step.is_retryable_status(408));
        assert!(step.is_retryable_status(429));
        assert!(step.is_retryable_status(500));
        assert!(step.is_retryable_status(502));
        assert!(step.is_retryable_status(503));
        assert!(step.is_retryable_status(504));

        assert!(!step.is_retryable_status(200));
        assert!(!step.is_retryable_status(400));
        assert!(!step.is_retryable_status(401));
        assert!(!step.is_retryable_status(403));
        assert!(!step.is_retryable_status(404));
    }

    #[tokio::test]
    async fn test_execute_with_retry_success() {
        let step = ProviderStep::with_defaults();
        let mut ctx = RequestContext::new("test-model".to_string());

        let result = step
            .execute_with_retry(&mut ctx, || async {
                Ok(ProviderCallResult {
                    response: serde_json::json!({"content": "Hello"}),
                    status_code: 200,
                    latency_ms: 100,
                    credential_id: Some("cred-1".to_string()),
                })
            })
            .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap().status_code, 200);
    }

    #[tokio::test]
    async fn test_execute_with_retry_non_retryable_error() {
        let step = ProviderStep::with_defaults();
        let mut ctx = RequestContext::new("test-model".to_string());

        let result = step
            .execute_with_retry(&mut ctx, || async {
                Err(ProviderCallError::fatal("Invalid API key", Some(401)))
            })
            .await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.status_code, Some(401));
        assert!(!err.retryable);
    }

    #[tokio::test]
    async fn test_handle_failover() {
        let step = ProviderStep::with_defaults();
        let mut ctx = RequestContext::new("test-model".to_string());
        ctx.set_provider(ProviderType::Kiro);

        let error = ProviderCallError::failover("Rate limit exceeded", Some(429));
        let available = vec![
            ProviderType::Kiro,
            ProviderType::Gemini,
            ProviderType::OpenAI,
        ];

        let new_provider = step.handle_failover(&ctx, &error, &available);
        assert!(new_provider.is_some());
        assert_eq!(new_provider.unwrap(), ProviderType::Gemini);
    }

    #[tokio::test]
    async fn test_handle_failover_no_alternative() {
        let step = ProviderStep::with_defaults();
        let mut ctx = RequestContext::new("test-model".to_string());
        ctx.set_provider(ProviderType::Kiro);

        let error = ProviderCallError::failover("Rate limit exceeded", Some(429));
        let available = vec![ProviderType::Kiro];

        let new_provider = step.handle_failover(&ctx, &error, &available);
        assert!(new_provider.is_none());
    }

    #[tokio::test]
    async fn test_execute_with_timeout_success() {
        let timeout_config = TimeoutConfig::new(5000, 1000);
        let step = ProviderStep::with_config(
            RetryConfig::default(),
            FailoverConfig::default(),
            timeout_config,
        );
        let ctx = RequestContext::new("test-model".to_string());

        let result = step
            .execute_with_timeout(&ctx, async {
                Ok(ProviderCallResult {
                    response: serde_json::json!({"content": "Hello"}),
                    status_code: 200,
                    latency_ms: 50,
                    credential_id: None,
                })
            })
            .await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_execute_with_timeout_timeout() {
        let timeout_config = TimeoutConfig::new(50, 0);
        let step = ProviderStep::with_config(
            RetryConfig::default(),
            FailoverConfig::default(),
            timeout_config,
        );
        let ctx = RequestContext::new("test-model".to_string());

        let result = step
            .execute_with_timeout(&ctx, async {
                tokio::time::sleep(Duration::from_millis(200)).await;
                Ok(ProviderCallResult {
                    response: serde_json::json!({}),
                    status_code: 200,
                    latency_ms: 200,
                    credential_id: None,
                })
            })
            .await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.status_code, Some(408));
        assert!(err.retryable);
    }
}
