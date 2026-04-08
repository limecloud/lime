//! 桌面通知
//!
//! 提供跨平台桌面通知和声音功能

use super::types::{Notification, NotificationType};
use std::process::Command;

/// 发送桌面通知
pub fn send_desktop_notification(notification: &Notification) -> anyhow::Result<()> {
    #[cfg(target_os = "macos")]
    {
        let script = format!(
            r#"display notification "{}" with title "{}""#,
            notification.message.replace('"', r#"\""#),
            notification.title.replace('"', r#"\""#)
        );
        Command::new("osascript").args(["-e", &script]).output()?;
    }

    #[cfg(target_os = "linux")]
    {
        let urgency = match notification.notification_type {
            NotificationType::Error => "critical",
            NotificationType::Warning => "normal",
            _ => "low",
        };
        Command::new("notify-send")
            .args(["-u", urgency, &notification.title, &notification.message])
            .output()?;
    }

    #[cfg(target_os = "windows")]
    {
        // Windows PowerShell 通知
        let ps = format!(
            r#"[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null; $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); $textNodes = $template.GetElementsByTagName("text"); $textNodes.Item(0).AppendChild($template.CreateTextNode("{}")); $textNodes.Item(1).AppendChild($template.CreateTextNode("{}")); $toast = [Windows.UI.Notifications.ToastNotification]::new($template); [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Aster").Show($toast)"#,
            notification.title.replace('"', r#"\""#),
            notification.message.replace('"', r#"\""#)
        );
        Command::new("powershell")
            .args(["-command", &ps])
            .output()?;
    }

    Ok(())
}

/// 播放通知声音
#[allow(unused_variables)]
pub fn play_sound(notification_type: NotificationType) -> anyhow::Result<()> {
    #[cfg(target_os = "macos")]
    {
        let sound = match notification_type {
            NotificationType::Error => "Basso",
            NotificationType::Warning => "Sosumi",
            _ => "Pop",
        };
        Command::new("afplay")
            .arg(format!("/System/Library/Sounds/{}.aiff", sound))
            .output()?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("paplay")
            .arg("/usr/share/sounds/freedesktop/stereo/complete.oga")
            .output()?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("powershell")
            .args([
                "-c",
                r#"(New-Object Media.SoundPlayer "C:\Windows\Media\notify.wav").PlaySync()"#,
            ])
            .output()?;
    }

    Ok(())
}

/// 终端响铃
pub fn bell() {
    print!("\x07");
}

/// 终端通知（内联）
pub fn terminal_notify(message: &str, notification_type: NotificationType) {
    let prefix = match notification_type {
        NotificationType::Info => "ℹ ",
        NotificationType::Success => "✓ ",
        NotificationType::Warning => "⚠ ",
        NotificationType::Error => "✗ ",
    };
    println!("{}{}", prefix, message);
}
