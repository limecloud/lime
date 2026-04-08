//! 通知类型定义
//!
//! 定义通知相关的数据结构

use serde::{Deserialize, Serialize};

/// 通知类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NotificationType {
    #[default]
    Info,
    Success,
    Warning,
    Error,
}

/// 通知种类
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationKind {
    TaskComplete,
    Error,
    PermissionRequired,
    UpdateAvailable,
    Message,
    #[default]
    Custom,
}

/// 通知动作
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationAction {
    /// 标签
    pub label: String,
    /// 动作标识
    pub action: String,
    /// 是否为主要动作
    pub primary: bool,
}

/// 通知
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notification {
    /// 通知 ID
    pub id: String,
    /// 通知类型
    pub notification_type: NotificationType,
    /// 通知种类
    pub kind: NotificationKind,
    /// 标题
    pub title: String,
    /// 消息内容
    pub message: String,
    /// 时间戳（毫秒）
    pub timestamp: u64,
    /// 是否已读
    pub read: bool,
    /// 可用动作
    pub actions: Vec<NotificationAction>,
}

/// 通知配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationConfig {
    /// 是否启用
    pub enabled: bool,
    /// 是否启用桌面通知
    pub desktop_notifications: bool,
    /// 是否启用声音
    pub sound_enabled: bool,
    /// 静音时段开始（小时 0-23）
    pub quiet_hours_start: Option<u8>,
    /// 静音时段结束（小时 0-23）
    pub quiet_hours_end: Option<u8>,
    /// 最低优先级
    pub min_priority: Option<NotificationType>,
}

impl Default for NotificationConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            desktop_notifications: true,
            sound_enabled: false,
            quiet_hours_start: None,
            quiet_hours_end: None,
            min_priority: None,
        }
    }
}
