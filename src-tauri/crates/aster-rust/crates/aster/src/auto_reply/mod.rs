//! Auto-Reply Mechanism Module
//!
//! 本模块实现 Aster-Rust 框架的自动回复触发机制。
//! 支持多种触发方式：@提及、关键词匹配、私聊、定时触发和 Webhook。
//!
//! # 主要组件
//!
//! - [`types`] - 触发类型和配置定义
//! - [`whitelist`] - 白名单管理器
//! - [`cooldown`] - 冷却时间追踪器
//! - [`keyword_matcher`] - 关键词匹配器
//! - [`registry`] - 触发器注册表
//! - [`message`] - 入站消息和触发结果类型
//! - [`group`] - 群组激活配置
//! - [`manager`] - 自动回复管理器
//! - [`config`] - 配置持久化
//! - [`webhook`] - Webhook 触发处理
//! - [`schedule`] - Scheduler 集成
//!
//! # 示例
//!
//! ```rust,ignore
//! use aster::auto_reply::{AutoReplyManager, IncomingMessage, TriggerResult};
//!
//! let manager = AutoReplyManager::new(config_path).await?;
//! let message = IncomingMessage { /* ... */ };
//!
//! match manager.should_reply(&message) {
//!     TriggerResult::Triggered { trigger, context } => {
//!         // 处理触发的自动回复
//!     }
//!     TriggerResult::Rejected { reason } => {
//!         // 处理拒绝原因
//!     }
//!     TriggerResult::NoMatch => {
//!         // 无匹配触发器
//!     }
//! }
//! ```

// 基础类型定义
pub mod types;

// 白名单管理器
pub mod whitelist;

// 冷却时间追踪器
pub mod cooldown;

// 关键词匹配器
pub mod keyword_matcher;

// 触发器注册表
pub mod registry;

// 消息和结果类型
pub mod message;

// 群组激活配置
pub mod group;

// 自动回复管理器
pub mod manager;

// 配置持久化
pub mod config;

// Webhook 触发处理
pub mod webhook;

// Scheduler 集成
pub mod schedule;

// Re-exports for convenience
pub use config::AutoReplyConfig;
pub use cooldown::{CooldownCheckResult, CooldownTracker};
pub use group::{GroupActivation, GroupActivationManager, GroupRejectionReason};
pub use keyword_matcher::{KeywordMatchResult, KeywordMatcher};
pub use manager::{AutoReplyManager, AutoReplyStats};
pub use message::{IncomingMessage, RejectionReason, TriggerContext, TriggerResult};
pub use registry::{AutoReplyTrigger, TriggerRegistry};
pub use schedule::{ScheduleContext, ScheduleTriggerEvent, ScheduleTriggerHandler};
pub use types::{
    KeywordTriggerConfig, ScheduleTriggerConfig, ScheduleType, TriggerConfig, TriggerType,
    WebhookTriggerConfig,
};
pub use webhook::{WebhookHandler, WebhookRequest, WebhookResult};
pub use whitelist::WhitelistManager;
