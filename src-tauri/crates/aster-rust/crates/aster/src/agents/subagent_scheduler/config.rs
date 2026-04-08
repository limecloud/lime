//! SubAgent 调度器配置
//!
//! 定义调度器的各种配置选项

use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::agents::context::ContextInheritanceConfig;

/// 调度器配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerConfig {
    /// 最大并发数
    pub max_concurrency: usize,
    /// 单次调度允许接收的最大任务数
    pub max_queue_size: usize,
    /// 默认任务超时时间
    pub default_timeout: Duration,
    /// 是否在失败时重试
    pub retry_on_failure: bool,
    /// 首次错误时停止
    pub stop_on_first_error: bool,
    /// 最大重试次数
    pub max_retries: usize,
    /// 重试延迟
    pub retry_delay: Duration,
    /// 上下文继承配置
    pub context_inheritance: ContextInheritanceConfig,
    /// 是否自动生成摘要
    pub auto_summarize: bool,
    /// 摘要最大 token 数
    pub summary_max_tokens: usize,
    /// 默认模型
    pub default_model: Option<String>,
    /// 是否启用进度回调
    pub enable_progress_callback: bool,
}

impl Default for SchedulerConfig {
    fn default() -> Self {
        Self {
            max_concurrency: 5,
            max_queue_size: usize::MAX,
            default_timeout: Duration::from_secs(300), // 5 分钟
            retry_on_failure: true,
            stop_on_first_error: false,
            max_retries: 3,
            retry_delay: Duration::from_secs(1),
            context_inheritance: ContextInheritanceConfig::default(),
            auto_summarize: true,
            summary_max_tokens: 2000,
            default_model: None,
            enable_progress_callback: true,
        }
    }
}

impl SchedulerConfig {
    /// 创建高并发配置（适合研究任务）
    pub fn high_concurrency() -> Self {
        Self {
            max_concurrency: 10,
            default_timeout: Duration::from_secs(600),
            ..Default::default()
        }
    }

    /// 创建低并发配置（适合编码任务）
    pub fn low_concurrency() -> Self {
        Self {
            max_concurrency: 2,
            stop_on_first_error: true,
            ..Default::default()
        }
    }

    /// 创建串行配置
    pub fn sequential() -> Self {
        Self {
            max_concurrency: 1,
            stop_on_first_error: true,
            ..Default::default()
        }
    }

    /// 设置最大并发数
    pub fn with_max_concurrency(mut self, max: usize) -> Self {
        self.max_concurrency = max;
        self
    }

    /// 设置最大队列长度
    pub fn with_max_queue_size(mut self, max: usize) -> Self {
        self.max_queue_size = max;
        self
    }

    /// 设置默认超时
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.default_timeout = timeout;
        self
    }

    /// 设置重试配置
    pub fn with_retry(mut self, enabled: bool, max_retries: usize) -> Self {
        self.retry_on_failure = enabled;
        self.max_retries = max_retries;
        self
    }

    /// 设置首次错误停止
    pub fn with_stop_on_first_error(mut self, stop: bool) -> Self {
        self.stop_on_first_error = stop;
        self
    }

    /// 设置上下文继承配置
    pub fn with_context_inheritance(mut self, config: ContextInheritanceConfig) -> Self {
        self.context_inheritance = config;
        self
    }

    /// 设置默认模型
    pub fn with_default_model(mut self, model: impl Into<String>) -> Self {
        self.default_model = Some(model.into());
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = SchedulerConfig::default();
        assert_eq!(config.max_concurrency, 5);
        assert_eq!(config.max_queue_size, usize::MAX);
        assert!(config.retry_on_failure);
        assert!(!config.stop_on_first_error);
    }

    #[test]
    fn test_high_concurrency_config() {
        let config = SchedulerConfig::high_concurrency();
        assert_eq!(config.max_concurrency, 10);
    }

    #[test]
    fn test_sequential_config() {
        let config = SchedulerConfig::sequential();
        assert_eq!(config.max_concurrency, 1);
        assert!(config.stop_on_first_error);
    }

    #[test]
    fn test_config_builder() {
        let config = SchedulerConfig::default()
            .with_max_concurrency(8)
            .with_max_queue_size(16)
            .with_stop_on_first_error(true)
            .with_default_model("sonnet");

        assert_eq!(config.max_concurrency, 8);
        assert_eq!(config.max_queue_size, 16);
        assert!(config.stop_on_first_error);
        assert_eq!(config.default_model, Some("sonnet".to_string()));
    }
}
