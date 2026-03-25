//! 全局快捷键管理
//!
//! 注册和处理语音输入的全局快捷键

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tracing::{debug, error, info, warn};

/// 当前注册的快捷键
static CURRENT_SHORTCUT: OnceLock<parking_lot::RwLock<Option<String>>> = OnceLock::new();

/// 当前注册的翻译快捷键
static TRANSLATE_SHORTCUT: OnceLock<parking_lot::RwLock<Option<String>>> = OnceLock::new();

/// 快捷键是否已注册
static IS_REGISTERED: AtomicBool = AtomicBool::new(false);

/// 翻译快捷键是否已注册
static IS_TRANSLATE_REGISTERED: AtomicBool = AtomicBool::new(false);

fn get_current_shortcut() -> &'static parking_lot::RwLock<Option<String>> {
    CURRENT_SHORTCUT.get_or_init(|| parking_lot::RwLock::new(None))
}

fn get_translate_shortcut() -> &'static parking_lot::RwLock<Option<String>> {
    TRANSLATE_SHORTCUT.get_or_init(|| parking_lot::RwLock::new(None))
}

/// 注册全局快捷键
pub fn register(app: &AppHandle, shortcut_str: &str) -> Result<(), String> {
    info!("[语音输入] 注册全局快捷键: {}", shortcut_str);

    // 解析快捷键
    let shortcut: Shortcut = shortcut_str
        .parse()
        .map_err(|e| format!("无效的快捷键: {e}"))?;

    // 获取全局快捷键管理器
    let global_shortcut = app.global_shortcut();

    // 检查快捷键是否已被注册
    let is_already_registered = global_shortcut.is_registered(shortcut);
    debug!(
        "[语音输入] 快捷键 {} 是否已注册: {}",
        shortcut_str, is_already_registered
    );

    if is_already_registered {
        warn!("[语音输入] 快捷键已被注册: {}", shortcut_str);
        // 如果是我们自己注册的，先注销
        if IS_REGISTERED.load(Ordering::SeqCst) {
            info!("[语音输入] 尝试注销已有的快捷键");
            if let Err(e) = global_shortcut.unregister(shortcut) {
                error!("[语音输入] 注销已有快捷键失败: {}", e);
            }
        } else {
            return Err(format!("快捷键已被占用: {shortcut_str}"));
        }
    }

    // 克隆 app handle 用于回调
    let app_clone = app.clone();

    // 注册快捷键
    info!("[语音输入] 开始注册快捷键回调...");
    global_shortcut
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                info!("[语音输入] 快捷键按下");
                // 打开截图输入框（语音模式）
                if let Err(e) =
                    crate::screenshot::window::open_floating_window_with_voice(&app_clone)
                {
                    error!("[语音输入] 打开窗口失败: {}", e);
                }
            } else {
                info!("[语音输入] 快捷键释放，发送停止录音事件");
                // 发送停止录音事件到前端
                if let Err(e) = crate::screenshot::window::send_voice_stop_event(&app_clone) {
                    error!("[语音输入] 发送停止录音事件失败: {}", e);
                }
            }
        })
        .map_err(|e| {
            error!("[语音输入] 注册快捷键失败: {}", e);
            format!("注册快捷键失败: {e}")
        })?;

    // 更新状态
    IS_REGISTERED.store(true, Ordering::SeqCst);
    *get_current_shortcut().write() = Some(shortcut_str.to_string());

    info!("[语音输入] 快捷键已注册: {}", shortcut_str);
    Ok(())
}

/// 注销全局快捷键
pub fn unregister(app: &AppHandle) -> Result<(), String> {
    let current = get_current_shortcut().read().clone();

    if let Some(shortcut_str) = current {
        info!("[语音输入] 注销全局快捷键: {}", shortcut_str);

        let shortcut: Shortcut = shortcut_str
            .parse()
            .map_err(|e| format!("解析快捷键失败: {e}"))?;

        let global_shortcut = app.global_shortcut();

        if global_shortcut.is_registered(shortcut) {
            global_shortcut
                .unregister(shortcut)
                .map_err(|e| format!("注销快捷键失败: {e}"))?;
        }

        // 更新状态
        IS_REGISTERED.store(false, Ordering::SeqCst);
        *get_current_shortcut().write() = None;

        info!("[语音输入] 快捷键已注销");
    } else {
        debug!("[语音输入] 没有已注册的快捷键需要注销");
    }

    Ok(())
}

/// 更新快捷键
pub fn update(app: &AppHandle, new_shortcut: &str) -> Result<(), String> {
    info!("[语音输入] 更新快捷键: {}", new_shortcut);

    // 保存旧快捷键以便恢复
    let old_shortcut = get_current_shortcut().read().clone();

    // 注销旧快捷键
    if let Err(e) = unregister(app) {
        warn!("[语音输入] 注销旧快捷键失败: {}", e);
    }

    // 注册新快捷键
    match register(app, new_shortcut) {
        Ok(()) => {
            info!("[语音输入] 快捷键更新成功: {}", new_shortcut);
            Ok(())
        }
        Err(e) => {
            error!("[语音输入] 注册新快捷键失败: {}", e);

            // 尝试恢复旧快捷键
            if let Some(old) = old_shortcut {
                warn!("[语音输入] 尝试恢复旧快捷键: {}", old);
                if let Err(restore_err) = register(app, &old) {
                    error!("[语音输入] 恢复旧快捷键失败: {}", restore_err);
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

/// 获取当前已注册的主语音快捷键
pub fn get_current() -> Option<String> {
    get_current_shortcut().read().clone()
}

/// 注册翻译模式快捷键
pub fn register_translate(
    app: &AppHandle,
    shortcut_str: &str,
    instruction_id: &str,
) -> Result<(), String> {
    info!(
        "[语音输入] 注册翻译快捷键: {}, 指令: {}",
        shortcut_str, instruction_id
    );

    // 解析快捷键
    let shortcut: Shortcut = shortcut_str
        .parse()
        .map_err(|e| format!("无效的快捷键: {e}"))?;

    // 获取全局快捷键管理器
    let global_shortcut = app.global_shortcut();

    // 检查快捷键是否已被注册
    let is_already_registered = global_shortcut.is_registered(shortcut);
    debug!(
        "[语音输入] 翻译快捷键 {} 是否已注册: {}",
        shortcut_str, is_already_registered
    );

    if is_already_registered {
        warn!("[语音输入] 翻译快捷键已被注册: {}", shortcut_str);
        // 如果是我们自己注册的，先注销
        if IS_TRANSLATE_REGISTERED.load(Ordering::SeqCst) {
            info!("[语音输入] 尝试注销已有的翻译快捷键");
            if let Err(e) = global_shortcut.unregister(shortcut) {
                error!("[语音输入] 注销已有翻译快捷键失败: {}", e);
            }
        } else {
            return Err(format!("快捷键已被占用: {shortcut_str}"));
        }
    }

    // 克隆 app handle 和 instruction_id 用于回调
    let app_clone = app.clone();
    let instruction_id_owned = instruction_id.to_string();

    // 注册快捷键
    info!("[语音输入] 开始注册翻译快捷键回调...");
    global_shortcut
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                info!("[语音输入] 翻译快捷键按下");
                // 打开截图输入框（翻译模式）
                if let Err(e) = crate::screenshot::window::open_floating_window_with_translate(
                    &app_clone,
                    &instruction_id_owned,
                ) {
                    error!("[语音输入] 打开翻译窗口失败: {}", e);
                }
            } else {
                info!("[语音输入] 翻译快捷键释放，发送停止录音事件");
                // 发送停止录音事件到前端
                if let Err(e) = crate::screenshot::window::send_voice_stop_event(&app_clone) {
                    error!("[语音输入] 发送停止录音事件失败: {}", e);
                }
            }
        })
        .map_err(|e| {
            error!("[语音输入] 注册翻译快捷键失败: {}", e);
            format!("注册翻译快捷键失败: {e}")
        })?;

    // 更新状态
    IS_TRANSLATE_REGISTERED.store(true, Ordering::SeqCst);
    *get_translate_shortcut().write() = Some(shortcut_str.to_string());

    info!("[语音输入] 翻译快捷键已注册: {}", shortcut_str);
    Ok(())
}

/// 注销翻译快捷键
pub fn unregister_translate(app: &AppHandle) -> Result<(), String> {
    let current = get_translate_shortcut().read().clone();

    if let Some(shortcut_str) = current {
        info!("[语音输入] 注销翻译快捷键: {}", shortcut_str);

        let shortcut: Shortcut = shortcut_str
            .parse()
            .map_err(|e| format!("解析快捷键失败: {e}"))?;

        let global_shortcut = app.global_shortcut();

        if global_shortcut.is_registered(shortcut) {
            global_shortcut
                .unregister(shortcut)
                .map_err(|e| format!("注销翻译快捷键失败: {e}"))?;
        }

        // 更新状态
        IS_TRANSLATE_REGISTERED.store(false, Ordering::SeqCst);
        *get_translate_shortcut().write() = None;

        info!("[语音输入] 翻译快捷键已注销");
    } else {
        debug!("[语音输入] 没有已注册的翻译快捷键需要注销");
    }

    Ok(())
}

/// 检查翻译快捷键是否已注册
pub fn is_translate_registered() -> bool {
    IS_TRANSLATE_REGISTERED.load(Ordering::SeqCst)
}

/// 获取当前已注册的翻译快捷键
pub fn get_current_translate() -> Option<String> {
    get_translate_shortcut().read().clone()
}

/// 更新翻译快捷键
pub fn update_translate(
    app: &AppHandle,
    new_shortcut: &str,
    instruction_id: &str,
) -> Result<(), String> {
    info!("[语音输入] 更新翻译快捷键: {}", new_shortcut);

    // 保存旧快捷键以便恢复
    let old_shortcut = get_translate_shortcut().read().clone();

    // 注销旧快捷键
    if let Err(e) = unregister_translate(app) {
        warn!("[语音输入] 注销旧翻译快捷键失败: {}", e);
    }

    // 注册新快捷键
    match register_translate(app, new_shortcut, instruction_id) {
        Ok(()) => {
            info!("[语音输入] 翻译快捷键更新成功: {}", new_shortcut);
            Ok(())
        }
        Err(e) => {
            error!("[语音输入] 注册新翻译快捷键失败: {}", e);

            // 尝试恢复旧快捷键
            if let Some(old) = old_shortcut {
                warn!("[语音输入] 尝试恢复旧翻译快捷键: {}", old);
                if let Err(restore_err) = register_translate(app, &old, instruction_id) {
                    error!("[语音输入] 恢复旧翻译快捷键失败: {}", restore_err);
                }
            }

            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reset_runtime_state() {
        IS_REGISTERED.store(false, Ordering::SeqCst);
        IS_TRANSLATE_REGISTERED.store(false, Ordering::SeqCst);
        *get_current_shortcut().write() = None;
        *get_translate_shortcut().write() = None;
    }

    #[test]
    fn test_main_shortcut_runtime_accessors_reflect_state() {
        reset_runtime_state();

        assert!(!is_registered());
        assert_eq!(get_current(), None);

        IS_REGISTERED.store(true, Ordering::SeqCst);
        *get_current_shortcut().write() = Some("CommandOrControl+Shift+V".to_string());

        assert!(is_registered());
        assert_eq!(get_current().as_deref(), Some("CommandOrControl+Shift+V"));

        reset_runtime_state();
    }

    #[test]
    fn test_translate_shortcut_runtime_accessors_reflect_state() {
        reset_runtime_state();

        assert!(!is_translate_registered());
        assert_eq!(get_current_translate(), None);

        IS_TRANSLATE_REGISTERED.store(true, Ordering::SeqCst);
        *get_translate_shortcut().write() = Some("CommandOrControl+Shift+T".to_string());

        assert!(is_translate_registered());
        assert_eq!(
            get_current_translate().as_deref(),
            Some("CommandOrControl+Shift+T")
        );

        reset_runtime_state();
    }
}
