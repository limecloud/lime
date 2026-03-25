//! 全局快捷键管理
//!
//! 提供截图对话功能的全局快捷键注册、注销和更新功能

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tracing::{debug, error, info, warn};

use super::capture;
use super::window;

/// 快捷键错误类型
#[derive(Debug, thiserror::Error)]
pub enum ShortcutError {
    #[error("快捷键格式无效: {0}")]
    InvalidFormat(String),
    #[error("快捷键注册失败: {0}")]
    RegisterFailed(String),
    #[error("快捷键注销失败: {0}")]
    UnregisterFailed(String),
    #[error("快捷键已被占用: {0}")]
    AlreadyInUse(String),
    #[error("快捷键解析失败: {0}")]
    ParseFailed(String),
}

/// 当前注册的快捷键（用于更新时注销旧快捷键）
static CURRENT_SHORTCUT: OnceLock<parking_lot::RwLock<Option<String>>> = OnceLock::new();

/// 快捷键是否已注册
static IS_REGISTERED: AtomicBool = AtomicBool::new(false);

fn get_current_shortcut() -> &'static parking_lot::RwLock<Option<String>> {
    CURRENT_SHORTCUT.get_or_init(|| parking_lot::RwLock::new(None))
}

/// 验证快捷键格式
///
/// 检查快捷键字符串是否符合 Tauri 快捷键格式要求
///
/// # 参数
/// - `shortcut`: 快捷键字符串，如 "CommandOrControl+Shift+S"
///
/// # 返回
/// 如果格式有效返回 Ok(()), 否则返回错误
///
/// # 有效格式示例
/// - "CommandOrControl+Shift+S"
/// - "Alt+F4"
/// - "Super+Space"
/// - "Ctrl+Alt+Delete"
pub fn validate(shortcut: &str) -> Result<(), ShortcutError> {
    if shortcut.is_empty() {
        return Err(ShortcutError::InvalidFormat("快捷键不能为空".to_string()));
    }

    // 尝试解析快捷键以验证格式
    shortcut
        .parse::<Shortcut>()
        .map_err(|e| ShortcutError::InvalidFormat(format!("无法解析快捷键 '{shortcut}': {e}")))?;

    debug!("快捷键格式验证通过: {}", shortcut);
    Ok(())
}

/// 注册全局快捷键
///
/// 注册截图对话功能的全局快捷键
///
/// # 参数
/// - `app`: Tauri 应用句柄
/// - `shortcut_str`: 快捷键字符串
///
/// # 返回
/// 成功返回 Ok(()), 失败返回错误
pub fn register(app: &AppHandle, shortcut_str: &str) -> Result<(), ShortcutError> {
    info!("注册全局快捷键: {}", shortcut_str);

    // 验证快捷键格式
    validate(shortcut_str)?;

    // 解析快捷键
    let shortcut: Shortcut = shortcut_str
        .parse()
        .map_err(|e| ShortcutError::ParseFailed(format!("{e}")))?;

    // 获取全局快捷键管理器
    let global_shortcut = app.global_shortcut();

    // 检查快捷键是否已被注册
    let is_already_registered = global_shortcut.is_registered(shortcut);
    info!(
        "快捷键 {} 是否已注册: {}",
        shortcut_str, is_already_registered
    );

    if is_already_registered {
        warn!("快捷键已被注册: {}", shortcut_str);
        // 如果是我们自己注册的，先注销
        if IS_REGISTERED.load(Ordering::SeqCst) {
            info!("尝试注销已有的快捷键");
            if let Err(e) = global_shortcut.unregister(shortcut) {
                error!("注销已有快捷键失败: {}", e);
            }
        } else {
            return Err(ShortcutError::AlreadyInUse(shortcut_str.to_string()));
        }
    }

    // 克隆 app handle 用于回调
    let app_clone = app.clone();

    // 注册快捷键
    info!("开始注册快捷键回调...");
    global_shortcut
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                info!("截图快捷键被触发");
                handle_shortcut_triggered(&app_clone);
            }
        })
        .map_err(|e| {
            error!("注册快捷键失败: {}", e);
            ShortcutError::RegisterFailed(format!("{e}"))
        })?;

    // 更新状态
    IS_REGISTERED.store(true, Ordering::SeqCst);
    *get_current_shortcut().write() = Some(shortcut_str.to_string());

    info!("全局快捷键注册成功: {}", shortcut_str);
    Ok(())
}

/// 注销全局快捷键
///
/// 注销当前注册的截图对话快捷键
///
/// # 参数
/// - `app`: Tauri 应用句柄
///
/// # 返回
/// 成功返回 Ok(()), 失败返回错误
pub fn unregister(app: &AppHandle) -> Result<(), ShortcutError> {
    let current = get_current_shortcut().read().clone();

    if let Some(shortcut_str) = current {
        info!("注销全局快捷键: {}", shortcut_str);

        let shortcut: Shortcut = shortcut_str
            .parse()
            .map_err(|e| ShortcutError::ParseFailed(format!("{e}")))?;

        let global_shortcut = app.global_shortcut();

        if global_shortcut.is_registered(shortcut) {
            global_shortcut
                .unregister(shortcut)
                .map_err(|e| ShortcutError::UnregisterFailed(format!("{e}")))?;
        }

        // 更新状态
        IS_REGISTERED.store(false, Ordering::SeqCst);
        *get_current_shortcut().write() = None;

        info!("全局快捷键注销成功");
    } else {
        debug!("没有已注册的快捷键需要注销");
    }

    Ok(())
}

/// 更新全局快捷键
///
/// 原子性地更新快捷键：先注销旧快捷键，再注册新快捷键
///
/// # 参数
/// - `app`: Tauri 应用句柄
/// - `new_shortcut`: 新的快捷键字符串
///
/// # 返回
/// 成功返回 Ok(()), 失败返回错误
///
/// # 注意
/// 此操作是原子性的：如果新快捷键注册失败，会尝试恢复旧快捷键
pub fn update(app: &AppHandle, new_shortcut: &str) -> Result<(), ShortcutError> {
    info!("更新全局快捷键: {}", new_shortcut);

    // 验证新快捷键格式
    validate(new_shortcut)?;

    // 保存旧快捷键以便恢复
    let old_shortcut = get_current_shortcut().read().clone();

    // 注销旧快捷键
    if let Err(e) = unregister(app) {
        warn!("注销旧快捷键失败: {}", e);
        // 继续尝试注册新快捷键
    }

    // 注册新快捷键
    match register(app, new_shortcut) {
        Ok(()) => {
            info!("快捷键更新成功: {}", new_shortcut);
            Ok(())
        }
        Err(e) => {
            error!("注册新快捷键失败: {}", e);

            // 尝试恢复旧快捷键
            if let Some(old) = old_shortcut {
                warn!("尝试恢复旧快捷键: {}", old);
                if let Err(restore_err) = register(app, &old) {
                    error!("恢复旧快捷键失败: {}", restore_err);
                }
            }

            Err(e)
        }
    }
}

/// 检查快捷键是否已注册
pub fn is_registered() -> bool {
    IS_REGISTERED.load(Ordering::SeqCst)
}

/// 获取当前注册的快捷键
pub fn get_current() -> Option<String> {
    get_current_shortcut().read().clone()
}

/// 处理快捷键触发事件
///
/// 当用户按下截图快捷键时调用此函数
fn handle_shortcut_triggered(app: &AppHandle) {
    info!("处理截图快捷键触发");

    // 在后台线程中执行截图操作
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        // 截图前最小化主窗口（而非隐藏），避免视觉干扰但保持可恢复
        let main_window = app_clone.get_webview_window("main");
        if let Some(win) = main_window.as_ref() {
            debug!("最小化主窗口");
            let _ = win.minimize();
        }

        // 短暂延迟，确保窗口完全最小化
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        match capture::start_capture().await {
            Ok(image_path) => {
                info!("截图成功: {:?}", image_path);
                // 打开悬浮窗口
                if let Err(e) = window::open_floating_window(&app_clone, &image_path) {
                    error!("打开悬浮窗口失败: {}", e);
                    // 如果悬浮窗口打开失败，恢复主窗口
                    if let Some(win) = main_window.as_ref() {
                        let _ = win.unminimize();
                        let _ = win.set_focus();
                    }
                }
            }
            Err(capture::CaptureError::Cancelled) => {
                info!("用户取消了截图");
                // 用户取消截图，恢复主窗口显示
                if let Some(win) = main_window.as_ref() {
                    debug!("恢复主窗口显示");
                    let _ = win.unminimize();
                    let _ = win.set_focus();
                }
            }
            Err(e) => {
                error!("截图失败: {}", e);
                // 截图失败，恢复主窗口显示
                if let Some(win) = main_window.as_ref() {
                    let _ = win.unminimize();
                    let _ = win.set_focus();
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reset_runtime_state() {
        IS_REGISTERED.store(false, Ordering::SeqCst);
        *get_current_shortcut().write() = None;
    }

    #[test]
    fn test_validate_valid_shortcuts() {
        // 有效的快捷键格式
        assert!(validate("CommandOrControl+Shift+S").is_ok());
        assert!(validate("Alt+F4").is_ok());
        assert!(validate("Ctrl+C").is_ok());
        assert!(validate("Super+Space").is_ok());
        assert!(validate("Shift+A").is_ok());
    }

    #[test]
    fn test_validate_empty_shortcut() {
        let result = validate("");
        assert!(result.is_err());
        match result {
            Err(ShortcutError::InvalidFormat(msg)) => {
                assert!(msg.contains("不能为空"));
            }
            _ => panic!("Expected InvalidFormat error"),
        }
    }

    #[test]
    fn test_validate_invalid_shortcuts() {
        // 无效的快捷键格式
        assert!(validate("InvalidKey").is_err());
        assert!(validate("+++").is_err());
        assert!(validate("Ctrl++").is_err());
    }

    #[test]
    fn test_runtime_status_accessors_reflect_state() {
        reset_runtime_state();

        assert!(!is_registered());
        assert_eq!(get_current(), None);

        IS_REGISTERED.store(true, Ordering::SeqCst);
        *get_current_shortcut().write() = Some("CommandOrControl+Shift+4".to_string());

        assert!(is_registered());
        assert_eq!(get_current().as_deref(), Some("CommandOrControl+Shift+4"));

        reset_runtime_state();
    }
}
