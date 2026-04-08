use async_trait::async_trait;

use super::traits::{Observer, ObserverEvent};

/// 基于 tracing 的 Observer 实现
pub struct LogObserver;

#[async_trait]
impl Observer for LogObserver {
    async fn record_event(&self, event: &ObserverEvent) {
        match event {
            ObserverEvent::ProviderCall {
                provider,
                model,
                duration_ms,
                tokens_used,
            } => {
                tracing::info!(
                    provider = %provider,
                    model = %model,
                    duration_ms = duration_ms,
                    tokens_used = ?tokens_used,
                    "provider call"
                );
            }
            ObserverEvent::ToolCall {
                tool,
                duration_ms,
                success,
            } => {
                if *success {
                    tracing::info!(
                        tool = %tool,
                        duration_ms = duration_ms,
                        "tool call succeeded"
                    );
                } else {
                    tracing::warn!(
                        tool = %tool,
                        duration_ms = duration_ms,
                        "tool call failed"
                    );
                }
            }
            ObserverEvent::Error { component, message } => {
                tracing::error!(
                    component = %component,
                    message = %message,
                    "error"
                );
            }
            ObserverEvent::Custom { name, data } => {
                tracing::debug!(
                    name = %name,
                    data = %data,
                    "custom event"
                );
            }
        }
    }

    async fn flush(&self) {
        // tracing 不需要手动刷新
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn log_observer_records_provider_call() {
        let observer = LogObserver;
        observer
            .record_event(&ObserverEvent::ProviderCall {
                provider: "anthropic".to_string(),
                model: "claude-3".to_string(),
                duration_ms: 1500,
                tokens_used: Some(100),
            })
            .await;
    }

    #[tokio::test]
    async fn log_observer_records_successful_tool_call() {
        let observer = LogObserver;
        observer
            .record_event(&ObserverEvent::ToolCall {
                tool: "bash".to_string(),
                duration_ms: 200,
                success: true,
            })
            .await;
    }

    #[tokio::test]
    async fn log_observer_records_failed_tool_call() {
        let observer = LogObserver;
        observer
            .record_event(&ObserverEvent::ToolCall {
                tool: "bash".to_string(),
                duration_ms: 200,
                success: false,
            })
            .await;
    }

    #[tokio::test]
    async fn log_observer_records_error() {
        let observer = LogObserver;
        observer
            .record_event(&ObserverEvent::Error {
                component: "provider".to_string(),
                message: "connection timeout".to_string(),
            })
            .await;
    }

    #[tokio::test]
    async fn log_observer_records_custom_event() {
        let observer = LogObserver;
        observer
            .record_event(&ObserverEvent::Custom {
                name: "my_event".to_string(),
                data: serde_json::json!({"key": "value"}),
            })
            .await;
    }

    #[tokio::test]
    async fn log_observer_flush_is_noop() {
        let observer = LogObserver;
        observer.flush().await;
    }
}
