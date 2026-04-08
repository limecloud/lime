use async_trait::async_trait;
use serde::Serialize;

/// 可观测性事件
#[derive(Debug, Clone, Serialize)]
pub enum ObserverEvent {
    /// Provider 调用
    ProviderCall {
        provider: String,
        model: String,
        duration_ms: u64,
        tokens_used: Option<u32>,
    },
    /// 工具调用
    ToolCall {
        tool: String,
        duration_ms: u64,
        success: bool,
    },
    /// 错误事件
    Error { component: String, message: String },
    /// 自定义事件
    Custom {
        name: String,
        data: serde_json::Value,
    },
}

/// 统一可观测性 trait
#[async_trait]
pub trait Observer: Send + Sync {
    /// 记录事件
    async fn record_event(&self, event: &ObserverEvent);

    /// 刷新缓冲
    async fn flush(&self);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn observer_event_serializes_provider_call() {
        let event = ObserverEvent::ProviderCall {
            provider: "anthropic".to_string(),
            model: "claude-3".to_string(),
            duration_ms: 1500,
            tokens_used: Some(100),
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["ProviderCall"]["provider"], "anthropic");
        assert_eq!(json["ProviderCall"]["duration_ms"], 1500);
        assert_eq!(json["ProviderCall"]["tokens_used"], 100);
    }

    #[test]
    fn observer_event_serializes_tool_call() {
        let event = ObserverEvent::ToolCall {
            tool: "bash".to_string(),
            duration_ms: 200,
            success: true,
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["ToolCall"]["tool"], "bash");
        assert_eq!(json["ToolCall"]["success"], true);
    }

    #[test]
    fn observer_event_serializes_error() {
        let event = ObserverEvent::Error {
            component: "provider".to_string(),
            message: "timeout".to_string(),
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["Error"]["component"], "provider");
        assert_eq!(json["Error"]["message"], "timeout");
    }

    #[test]
    fn observer_event_serializes_custom() {
        let event = ObserverEvent::Custom {
            name: "my_event".to_string(),
            data: serde_json::json!({"key": "value"}),
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["Custom"]["name"], "my_event");
        assert_eq!(json["Custom"]["data"]["key"], "value");
    }

    #[test]
    fn observer_event_clone() {
        let event = ObserverEvent::ProviderCall {
            provider: "test".to_string(),
            model: "model".to_string(),
            duration_ms: 0,
            tokens_used: None,
        };
        let cloned = event.clone();
        let json_orig = serde_json::to_string(&event).unwrap();
        let json_clone = serde_json::to_string(&cloned).unwrap();
        assert_eq!(json_orig, json_clone);
    }
}
