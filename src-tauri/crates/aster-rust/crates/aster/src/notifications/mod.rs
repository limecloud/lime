//! 通知系统模块
//!
//! 提供桌面通知和终端通知功能

mod desktop;
mod manager;
mod types;

pub use desktop::{bell, play_sound, send_desktop_notification};
pub use manager::NotificationManager;
pub use types::{
    Notification, NotificationAction, NotificationConfig, NotificationKind, NotificationType,
};
