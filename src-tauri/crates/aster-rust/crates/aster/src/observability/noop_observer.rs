use async_trait::async_trait;

use super::traits::{Observer, ObserverEvent};

/// 空实现的 Observer，所有方法都是 no-op
pub struct NoopObserver;

#[async_trait]
impl Observer for NoopObserver {
    async fn record_event(&self, _event: &ObserverEvent) {}

    async fn flush(&self) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn noop_observer_handles_all_event_types() {
        let observer = NoopObserver;

        observer
            .record_event(&ObserverEvent::ProviderCall {
                provider: "test".to_string(),
                model: "model".to_string(),
                duration_ms: 100,
                tokens_used: Some(50),
            })
            .await;

        observer
            .record_event(&ObserverEvent::ToolCall {
                tool: "bash".to_string(),
                duration_ms: 10,
                success: true,
            })
            .await;

        observer
            .record_event(&ObserverEvent::Error {
                component: "test".to_string(),
                message: "err".to_string(),
            })
            .await;

        observer
            .record_event(&ObserverEvent::Custom {
                name: "custom".to_string(),
                data: serde_json::json!(null),
            })
            .await;

        observer.flush().await;
        // NoopObserver 不应 panic
    }
}
