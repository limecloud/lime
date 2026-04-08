//! 结果投递模块
//!
//! 本模块定义结果投递的 trait 和实现，包括：
//! - `DeliveryChannel`: 投递渠道 trait
//! - `DeliveryRouter`: 投递路由器
//! - `DeliveryResult`: 投递结果
//!
//! ## 需求映射
//!
//! - **Requirement 5.5**: 投递渠道 trait 定义
//! - **Requirement 5.6**: 投递路由器实现
//! - **Requirement 5.7**: best_effort 模式支持

use anyhow::Result;
use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::Arc;

use super::executor::ExecutionResult;
use super::types::DeliveryConfig;

// ============================================================================
// DeliveryResult 结构体
// ============================================================================

/// 投递结果
///
/// 记录投递操作的结果信息。
#[derive(Clone, Debug)]
pub struct DeliveryResult {
    /// 是否成功
    pub success: bool,

    /// 投递渠道
    pub channel: String,

    /// 投递目标
    pub to: String,

    /// 错误信息（如果失败）
    pub error: Option<String>,
}

impl DeliveryResult {
    /// 创建成功的投递结果
    pub fn success(channel: impl Into<String>, to: impl Into<String>) -> Self {
        Self {
            success: true,
            channel: channel.into(),
            to: to.into(),
            error: None,
        }
    }

    /// 创建失败的投递结果
    pub fn failure(
        channel: impl Into<String>,
        to: impl Into<String>,
        error: impl Into<String>,
    ) -> Self {
        Self {
            success: false,
            channel: channel.into(),
            to: to.into(),
            error: Some(error.into()),
        }
    }
}

// ============================================================================
// DeliveryChannel Trait (Task 8.1)
// ============================================================================

/// 投递渠道 trait
///
/// 定义结果投递的标准接口，支持不同的投递渠道（Slack、Telegram、Email 等）。
///
/// # 需求映射
///
/// - **Requirement 5.5**: 投递渠道 trait 定义
///
/// # 实现者
///
/// 各种投递渠道实现，如：
/// - `SlackChannel`: Slack 投递
/// - `TelegramChannel`: Telegram 投递
/// - `EmailChannel`: 邮件投递
#[async_trait]
pub trait DeliveryChannel: Send + Sync {
    /// 获取渠道 ID
    fn channel_id(&self) -> &str;

    /// 发送消息
    ///
    /// # 参数
    /// - `to`: 投递目标
    /// - `message`: 消息内容
    ///
    /// # 返回值
    /// - `Ok(())`: 发送成功
    /// - `Err`: 发送失败
    async fn send(&self, to: &str, message: &str) -> Result<()>;

    /// 检查渠道是否可用
    async fn is_available(&self) -> bool {
        true
    }
}

// ============================================================================
// DeliveryRouter (Task 8.1)
// ============================================================================

/// 投递路由器
///
/// 管理多个投递渠道，根据配置将结果投递到指定渠道。
///
/// # 需求映射
///
/// - **Requirement 5.6**: 投递路由器实现
/// - **Requirement 5.7**: best_effort 模式支持
pub struct DeliveryRouter {
    /// 注册的投递渠道
    channels: HashMap<String, Arc<dyn DeliveryChannel>>,

    /// 默认渠道 ID
    default_channel: Option<String>,
}

impl DeliveryRouter {
    /// 创建新的投递路由器
    pub fn new() -> Self {
        Self {
            channels: HashMap::new(),
            default_channel: None,
        }
    }

    /// 注册投递渠道
    ///
    /// # 参数
    /// - `channel`: 投递渠道实例
    pub fn register(&mut self, channel: Arc<dyn DeliveryChannel>) {
        let id = channel.channel_id().to_string();
        self.channels.insert(id, channel);
    }

    /// 设置默认渠道
    ///
    /// # 参数
    /// - `channel_id`: 默认渠道 ID
    pub fn set_default(&mut self, channel_id: impl Into<String>) {
        self.default_channel = Some(channel_id.into());
    }

    /// 获取渠道
    ///
    /// # 参数
    /// - `channel_id`: 渠道 ID（如果为 None，使用默认渠道）
    pub fn get_channel(&self, channel_id: Option<&str>) -> Option<&Arc<dyn DeliveryChannel>> {
        let id = channel_id.or(self.default_channel.as_deref())?;
        self.channels.get(id)
    }

    /// 列出所有注册的渠道
    pub fn list_channels(&self) -> Vec<&str> {
        self.channels.keys().map(|s| s.as_str()).collect()
    }

    /// 投递执行结果
    ///
    /// # 参数
    /// - `config`: 投递配置
    /// - `result`: 执行结果
    ///
    /// # 返回值
    /// - `Ok(DeliveryResult)`: 投递结果
    /// - `Err`: 投递失败（仅当 best_effort 为 false 时）
    ///
    /// # 行为说明
    ///
    /// - 如果 `config.enabled` 为 false，直接返回成功
    /// - 如果 `config.best_effort` 为 true，投递失败时记录警告但不返回错误
    /// - 如果 `config.best_effort` 为 false，投递失败时返回错误
    pub async fn deliver(
        &self,
        config: &DeliveryConfig,
        result: &ExecutionResult,
    ) -> Result<DeliveryResult> {
        // 检查是否启用投递
        if !config.enabled {
            return Ok(DeliveryResult::success("none", "none"));
        }

        // 获取渠道和目标
        let channel_id = config.channel.as_deref().unwrap_or("default");
        let to = config.to.as_deref().unwrap_or("default");

        // 获取渠道
        let channel = match self.get_channel(Some(channel_id)) {
            Some(ch) => ch,
            None => {
                let err_msg = format!("渠道未找到: {}", channel_id);
                if config.best_effort {
                    tracing::warn!("投递失败 (best effort): {}", err_msg);
                    return Ok(DeliveryResult::failure(channel_id, to, err_msg));
                }
                return Err(anyhow::anyhow!(err_msg));
            }
        };

        // 构建消息
        let message = result.output.as_deref().unwrap_or("任务执行完成");

        // 发送消息
        match channel.send(to, message).await {
            Ok(()) => {
                tracing::info!("投递成功: {} -> {}", channel_id, to);
                Ok(DeliveryResult::success(channel_id, to))
            }
            Err(e) => {
                let err_msg = e.to_string();
                if config.best_effort {
                    tracing::warn!("投递失败 (best effort): {}", err_msg);
                    Ok(DeliveryResult::failure(channel_id, to, err_msg))
                } else {
                    Err(e)
                }
            }
        }
    }
}

impl Default for DeliveryRouter {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// 示例渠道实现
// ============================================================================

/// 日志渠道（用于测试和调试）
///
/// 将消息输出到日志，不实际发送。
pub struct LogChannel {
    id: String,
}

impl LogChannel {
    /// 创建新的日志渠道
    pub fn new(id: impl Into<String>) -> Self {
        Self { id: id.into() }
    }
}

#[async_trait]
impl DeliveryChannel for LogChannel {
    fn channel_id(&self) -> &str {
        &self.id
    }

    async fn send(&self, to: &str, message: &str) -> Result<()> {
        tracing::info!("[LogChannel:{}] 发送到 {}: {}", self.id, to, message);
        Ok(())
    }
}

/// 模拟渠道（用于测试）
///
/// 可配置成功或失败的模拟渠道。
#[cfg(test)]
pub struct MockChannel {
    id: String,
    should_fail: bool,
    fail_message: String,
}

#[cfg(test)]
impl MockChannel {
    /// 创建成功的模拟渠道
    pub fn success(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            should_fail: false,
            fail_message: String::new(),
        }
    }

    /// 创建失败的模拟渠道
    pub fn failure(id: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            should_fail: true,
            fail_message: message.into(),
        }
    }
}

#[cfg(test)]
#[async_trait]
impl DeliveryChannel for MockChannel {
    fn channel_id(&self) -> &str {
        &self.id
    }

    async fn send(&self, _to: &str, _message: &str) -> Result<()> {
        if self.should_fail {
            Err(anyhow::anyhow!("{}", self.fail_message))
        } else {
            Ok(())
        }
    }
}

// ============================================================================
// 单元测试 (Task 8.2)
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scheduler::types::JobStatus;

    // 创建测试用的 ExecutionResult
    fn create_test_result(output: Option<&str>) -> ExecutionResult {
        ExecutionResult {
            session_id: "test-session".to_string(),
            output: output.map(|s| s.to_string()),
            duration_ms: 100,
            status: JobStatus::Ok,
            error: None,
        }
    }

    // ------------------------------------------------------------------------
    // DeliveryResult 测试
    // ------------------------------------------------------------------------

    #[test]
    fn test_delivery_result_success() {
        let result = DeliveryResult::success("slack", "#general");

        assert!(result.success);
        assert_eq!(result.channel, "slack");
        assert_eq!(result.to, "#general");
        assert!(result.error.is_none());
    }

    #[test]
    fn test_delivery_result_failure() {
        let result = DeliveryResult::failure("email", "user@example.com", "SMTP error");

        assert!(!result.success);
        assert_eq!(result.channel, "email");
        assert_eq!(result.to, "user@example.com");
        assert_eq!(result.error, Some("SMTP error".to_string()));
    }

    // ------------------------------------------------------------------------
    // DeliveryRouter 测试
    // ------------------------------------------------------------------------

    #[test]
    fn test_router_new() {
        let router = DeliveryRouter::new();

        assert!(router.channels.is_empty());
        assert!(router.default_channel.is_none());
    }

    #[test]
    fn test_router_register() {
        let mut router = DeliveryRouter::new();
        let channel = Arc::new(MockChannel::success("test"));

        router.register(channel);

        assert_eq!(router.channels.len(), 1);
        assert!(router.channels.contains_key("test"));
    }

    #[test]
    fn test_router_set_default() {
        let mut router = DeliveryRouter::new();
        router.set_default("slack");

        assert_eq!(router.default_channel, Some("slack".to_string()));
    }

    #[test]
    fn test_router_get_channel() {
        let mut router = DeliveryRouter::new();
        let channel = Arc::new(MockChannel::success("test"));
        router.register(channel);

        assert!(router.get_channel(Some("test")).is_some());
        assert!(router.get_channel(Some("nonexistent")).is_none());
    }

    #[test]
    fn test_router_get_channel_default() {
        let mut router = DeliveryRouter::new();
        let channel = Arc::new(MockChannel::success("default"));
        router.register(channel);
        router.set_default("default");

        // 不指定渠道时使用默认渠道
        assert!(router.get_channel(None).is_some());
    }

    #[test]
    fn test_router_list_channels() {
        let mut router = DeliveryRouter::new();
        router.register(Arc::new(MockChannel::success("slack")));
        router.register(Arc::new(MockChannel::success("email")));

        let channels = router.list_channels();
        assert_eq!(channels.len(), 2);
        assert!(channels.contains(&"slack"));
        assert!(channels.contains(&"email"));
    }

    // ------------------------------------------------------------------------
    // deliver 测试
    // ------------------------------------------------------------------------

    #[tokio::test]
    async fn test_deliver_disabled() {
        let router = DeliveryRouter::new();
        let config = DeliveryConfig::default(); // enabled = false
        let result = create_test_result(Some("output"));

        let delivery_result = router.deliver(&config, &result).await.unwrap();

        assert!(delivery_result.success);
        assert_eq!(delivery_result.channel, "none");
    }

    #[tokio::test]
    async fn test_deliver_success() {
        let mut router = DeliveryRouter::new();
        router.register(Arc::new(MockChannel::success("slack")));

        let config = DeliveryConfig::enabled("slack", "#general");
        let result = create_test_result(Some("Task completed"));

        let delivery_result = router.deliver(&config, &result).await.unwrap();

        assert!(delivery_result.success);
        assert_eq!(delivery_result.channel, "slack");
        assert_eq!(delivery_result.to, "#general");
    }

    #[tokio::test]
    async fn test_deliver_channel_not_found_best_effort() {
        let router = DeliveryRouter::new();
        let config = DeliveryConfig {
            enabled: true,
            channel: Some("nonexistent".to_string()),
            to: Some("target".to_string()),
            best_effort: true,
        };
        let result = create_test_result(Some("output"));

        let delivery_result = router.deliver(&config, &result).await.unwrap();

        assert!(!delivery_result.success);
        assert!(delivery_result.error.is_some());
    }

    #[tokio::test]
    async fn test_deliver_channel_not_found_strict() {
        let router = DeliveryRouter::new();
        let config = DeliveryConfig {
            enabled: true,
            channel: Some("nonexistent".to_string()),
            to: Some("target".to_string()),
            best_effort: false,
        };
        let result = create_test_result(Some("output"));

        let delivery_result = router.deliver(&config, &result).await;

        assert!(delivery_result.is_err());
    }

    #[tokio::test]
    async fn test_deliver_send_failure_best_effort() {
        let mut router = DeliveryRouter::new();
        router.register(Arc::new(MockChannel::failure("slack", "Network error")));

        let config = DeliveryConfig {
            enabled: true,
            channel: Some("slack".to_string()),
            to: Some("#general".to_string()),
            best_effort: true,
        };
        let result = create_test_result(Some("output"));

        let delivery_result = router.deliver(&config, &result).await.unwrap();

        assert!(!delivery_result.success);
        assert!(delivery_result.error.unwrap().contains("Network error"));
    }

    #[tokio::test]
    async fn test_deliver_send_failure_strict() {
        let mut router = DeliveryRouter::new();
        router.register(Arc::new(MockChannel::failure("slack", "Network error")));

        let config = DeliveryConfig {
            enabled: true,
            channel: Some("slack".to_string()),
            to: Some("#general".to_string()),
            best_effort: false,
        };
        let result = create_test_result(Some("output"));

        let delivery_result = router.deliver(&config, &result).await;

        assert!(delivery_result.is_err());
    }

    #[tokio::test]
    async fn test_deliver_no_output() {
        let mut router = DeliveryRouter::new();
        router.register(Arc::new(MockChannel::success("slack")));

        let config = DeliveryConfig::enabled("slack", "#general");
        let result = create_test_result(None);

        let delivery_result = router.deliver(&config, &result).await.unwrap();

        // 应该使用默认消息
        assert!(delivery_result.success);
    }

    // ------------------------------------------------------------------------
    // LogChannel 测试
    // ------------------------------------------------------------------------

    #[test]
    fn test_log_channel_id() {
        let channel = LogChannel::new("test-log");
        assert_eq!(channel.channel_id(), "test-log");
    }

    #[tokio::test]
    async fn test_log_channel_send() {
        let channel = LogChannel::new("test-log");
        let result = channel.send("target", "Hello").await;
        assert!(result.is_ok());
    }
}
