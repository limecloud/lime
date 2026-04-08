//! 通知管理器
//!
//! 管理通知的发送、存储和状态

use super::desktop::{play_sound, send_desktop_notification};
use super::types::*;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

/// 通知管理器
pub struct NotificationManager {
    /// 配置
    config: NotificationConfig,
    /// 通知列表
    notifications: Arc<RwLock<Vec<Notification>>>,
    /// 最大通知数
    max_notifications: usize,
}

impl NotificationManager {
    /// 创建新的通知管理器
    pub fn new(config: NotificationConfig) -> Self {
        Self {
            config,
            notifications: Arc::new(RwLock::new(Vec::new())),
            max_notifications: 100,
        }
    }

    /// 检查是否启用
    pub fn is_enabled(&self) -> bool {
        if !self.config.enabled {
            return false;
        }

        // 检查静音时段
        if let (Some(start), Some(end)) =
            (self.config.quiet_hours_start, self.config.quiet_hours_end)
        {
            use chrono::Timelike;
            let now = chrono::Local::now().hour() as u8;
            if start <= end {
                if now >= start && now < end {
                    return false;
                }
            } else {
                // 跨夜（如 22-06）
                if now >= start || now < end {
                    return false;
                }
            }
        }

        true
    }

    /// 检查优先级
    fn meets_priority(&self, notification_type: NotificationType) -> bool {
        let Some(min_priority) = self.config.min_priority else {
            return true;
        };

        let priority_order = [
            NotificationType::Info,
            NotificationType::Success,
            NotificationType::Warning,
            NotificationType::Error,
        ];

        let type_index = priority_order
            .iter()
            .position(|&t| t == notification_type)
            .unwrap_or(0);
        let min_index = priority_order
            .iter()
            .position(|&t| t == min_priority)
            .unwrap_or(0);

        type_index >= min_index
    }

    /// 发送通知
    pub fn notify(
        &self,
        title: &str,
        message: &str,
        notification_type: NotificationType,
        kind: NotificationKind,
    ) -> Option<Notification> {
        if !self.is_enabled() || !self.meets_priority(notification_type) {
            return None;
        }

        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        let notification = Notification {
            id: format!("notif_{}_{}", timestamp, rand::random::<u32>()),
            notification_type,
            kind,
            title: title.to_string(),
            message: message.to_string(),
            timestamp,
            read: false,
            actions: Vec::new(),
        };

        // 添加到列表
        if let Ok(mut notifications) = self.notifications.write() {
            notifications.insert(0, notification.clone());
            if notifications.len() > self.max_notifications {
                notifications.truncate(self.max_notifications);
            }
        }

        // 发送桌面通知
        if self.config.desktop_notifications {
            let _ = send_desktop_notification(&notification);
        }

        // 播放声音
        if self.config.sound_enabled {
            let _ = play_sound(notification_type);
        }

        Some(notification)
    }

    /// 获取所有通知
    pub fn get_all(&self) -> Vec<Notification> {
        self.notifications
            .read()
            .map(|n| n.clone())
            .unwrap_or_default()
    }

    /// 获取未读通知
    pub fn get_unread(&self) -> Vec<Notification> {
        self.notifications
            .read()
            .map(|n| n.iter().filter(|n| !n.read).cloned().collect())
            .unwrap_or_default()
    }

    /// 获取未读数量
    pub fn get_unread_count(&self) -> usize {
        self.notifications
            .read()
            .map(|n| n.iter().filter(|n| !n.read).count())
            .unwrap_or(0)
    }

    /// 标记为已读
    pub fn mark_as_read(&self, id: &str) -> bool {
        if let Ok(mut notifications) = self.notifications.write() {
            if let Some(n) = notifications.iter_mut().find(|n| n.id == id) {
                n.read = true;
                return true;
            }
        }
        false
    }

    /// 标记全部已读
    pub fn mark_all_as_read(&self) {
        if let Ok(mut notifications) = self.notifications.write() {
            for n in notifications.iter_mut() {
                n.read = true;
            }
        }
    }

    /// 清空所有通知
    pub fn clear(&self) {
        if let Ok(mut notifications) = self.notifications.write() {
            notifications.clear();
        }
    }

    /// 便捷方法：发送信息通知
    pub fn info(&self, title: &str, message: &str) -> Option<Notification> {
        self.notify(
            title,
            message,
            NotificationType::Info,
            NotificationKind::Custom,
        )
    }

    /// 便捷方法：发送成功通知
    pub fn success(&self, title: &str, message: &str) -> Option<Notification> {
        self.notify(
            title,
            message,
            NotificationType::Success,
            NotificationKind::TaskComplete,
        )
    }

    /// 便捷方法：发送警告通知
    pub fn warn(&self, title: &str, message: &str) -> Option<Notification> {
        self.notify(
            title,
            message,
            NotificationType::Warning,
            NotificationKind::Custom,
        )
    }

    /// 便捷方法：发送错误通知
    pub fn error(&self, title: &str, message: &str) -> Option<Notification> {
        self.notify(
            title,
            message,
            NotificationType::Error,
            NotificationKind::Error,
        )
    }
}

impl Default for NotificationManager {
    fn default() -> Self {
        Self::new(NotificationConfig::default())
    }
}
