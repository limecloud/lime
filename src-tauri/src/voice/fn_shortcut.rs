//! macOS Fn 按住录音监听。
//!
//! Fn 不走 `tauri_plugin_global_shortcut` 的字符串解析路径；macOS 下通过
//! NSEvent 的 FlagsChanged 事件做一个窄桥接，其他平台明确报告不支持。

#[derive(Debug, Clone)]
pub struct FnShortcutRuntimeStatus {
    pub supported: bool,
    pub registered: bool,
    pub note: String,
}

#[cfg(target_os = "macos")]
#[allow(deprecated, unexpected_cfgs)]
mod platform {
    use super::FnShortcutRuntimeStatus;
    use block::{ConcreteBlock, RcBlock};
    use cocoa::appkit::{NSEvent, NSEventMask, NSEventModifierFlags};
    use cocoa::base::{id, nil};
    use objc::{class, msg_send, sel, sel_impl};
    use parking_lot::Mutex;
    use std::os::raw::c_uchar;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::OnceLock;
    use tauri::AppHandle;
    use tracing::{debug, error, info, warn};

    type GlobalEventBlock = RcBlock<(id,), ()>;
    type LocalEventBlock = RcBlock<(id,), id>;

    static REGISTRATION: OnceLock<Mutex<Option<FnShortcutRegistration>>> = OnceLock::new();
    static IS_REGISTERED: AtomicBool = AtomicBool::new(false);
    static FN_IS_DOWN: AtomicBool = AtomicBool::new(false);
    static LAST_ERROR: OnceLock<Mutex<Option<String>>> = OnceLock::new();

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> c_uchar;
    }

    struct ObjcMonitor(id);

    // AppKit monitor token 和 Block 都只在 register/unregister 边界持有；
    // 回调由 AppKit 调度，Rust 侧不跨线程解引用这些裸指针。
    unsafe impl Send for ObjcMonitor {}

    struct GlobalBlock {
        _inner: GlobalEventBlock,
    }

    unsafe impl Send for GlobalBlock {}

    struct LocalBlock {
        _inner: LocalEventBlock,
    }

    unsafe impl Send for LocalBlock {}

    struct FnShortcutRegistration {
        global_monitor: Option<ObjcMonitor>,
        local_monitor: Option<ObjcMonitor>,
        _global_block: GlobalBlock,
        _local_block: LocalBlock,
    }

    fn registration() -> &'static Mutex<Option<FnShortcutRegistration>> {
        REGISTRATION.get_or_init(|| Mutex::new(None))
    }

    fn last_error() -> &'static Mutex<Option<String>> {
        LAST_ERROR.get_or_init(|| Mutex::new(None))
    }

    fn set_last_error(value: Option<String>) {
        *last_error().lock() = value;
    }

    fn accessibility_trusted() -> bool {
        // SAFETY: AXIsProcessTrusted 无参数、无副作用，返回 CoreServices Boolean。
        unsafe { AXIsProcessTrusted() != 0 }
    }

    fn handle_flags_changed_event(app: &AppHandle, event: id) {
        if event == nil {
            return;
        }

        let fn_down = unsafe {
            event
                .modifierFlags()
                .contains(NSEventModifierFlags::NSFunctionKeyMask)
        };
        let was_down = FN_IS_DOWN.swap(fn_down, Ordering::SeqCst);

        match (was_down, fn_down) {
            (false, true) => {
                info!("[语音输入] Fn 按下");
                if let Err(error) = crate::screenshot::window::open_floating_window_with_voice(app)
                {
                    error!("[语音输入] Fn 打开语音窗口失败: {}", error);
                }
            }
            (true, false) => {
                info!("[语音输入] Fn 释放，发送停止录音事件");
                if let Err(error) = crate::screenshot::window::send_voice_stop_event(app) {
                    error!("[语音输入] Fn 发送停止录音事件失败: {}", error);
                }
            }
            _ => {
                debug!("[语音输入] 忽略重复 Fn 修饰键状态: {}", fn_down);
            }
        }
    }

    unsafe fn add_global_monitor(block: &GlobalEventBlock) -> id {
        let mask = NSEventMask::NSFlagsChangedMask.bits();
        msg_send![
            class!(NSEvent),
            addGlobalMonitorForEventsMatchingMask: mask
            handler: &**block
        ]
    }

    unsafe fn add_local_monitor(block: &LocalEventBlock) -> id {
        let mask = NSEventMask::NSFlagsChangedMask.bits();
        msg_send![
            class!(NSEvent),
            addLocalMonitorForEventsMatchingMask: mask
            handler: &**block
        ]
    }

    unsafe fn remove_monitor(monitor: ObjcMonitor) {
        if monitor.0 != nil {
            let _: () = msg_send![class!(NSEvent), removeMonitor: monitor.0];
            let _: () = msg_send![monitor.0, release];
        }
    }

    unsafe fn retain_monitor(monitor: id) -> Option<ObjcMonitor> {
        if monitor == nil {
            None
        } else {
            let retained: id = msg_send![monitor, retain];
            Some(ObjcMonitor(retained))
        }
    }

    pub fn register(app: &AppHandle) -> Result<(), String> {
        if IS_REGISTERED.load(Ordering::SeqCst) {
            return Ok(());
        }

        let app_for_global = app.clone();
        let global_block = ConcreteBlock::new(move |event: id| {
            handle_flags_changed_event(&app_for_global, event);
        })
        .copy();

        let app_for_local = app.clone();
        let local_block = ConcreteBlock::new(move |event: id| -> id {
            handle_flags_changed_event(&app_for_local, event);
            event
        })
        .copy();

        let global_monitor = unsafe { add_global_monitor(&global_block) };
        let local_monitor = unsafe { add_local_monitor(&local_block) };

        if global_monitor == nil && local_monitor == nil {
            let error = "macOS Fn 事件监听注册失败，NSEvent 未返回 monitor token".to_string();
            set_last_error(Some(error.clone()));
            return Err(error);
        }

        *registration().lock() = Some(FnShortcutRegistration {
            global_monitor: unsafe { retain_monitor(global_monitor) },
            local_monitor: unsafe { retain_monitor(local_monitor) },
            _global_block: GlobalBlock {
                _inner: global_block,
            },
            _local_block: LocalBlock {
                _inner: local_block,
            },
        });
        FN_IS_DOWN.store(false, Ordering::SeqCst);
        IS_REGISTERED.store(true, Ordering::SeqCst);
        set_last_error(None);

        if accessibility_trusted() {
            info!("[语音输入] Fn 按住录音监听已注册");
        } else {
            warn!("[语音输入] Fn 监听已注册；跨应用捕获可能需要 macOS 辅助功能或输入监听权限");
        }

        Ok(())
    }

    pub fn unregister() -> Result<(), String> {
        let registration = registration().lock().take();
        if let Some(registration) = registration {
            if let Some(monitor) = registration.global_monitor {
                unsafe { remove_monitor(monitor) };
            }
            if let Some(monitor) = registration.local_monitor {
                unsafe { remove_monitor(monitor) };
            }
        }

        IS_REGISTERED.store(false, Ordering::SeqCst);
        FN_IS_DOWN.store(false, Ordering::SeqCst);
        info!("[语音输入] Fn 按住录音监听已注销");
        Ok(())
    }

    pub fn is_supported() -> bool {
        true
    }

    pub fn is_registered() -> bool {
        IS_REGISTERED.load(Ordering::SeqCst)
    }

    pub fn runtime_status() -> FnShortcutRuntimeStatus {
        let registered = is_registered();
        let note = if let Some(error) = last_error().lock().clone() {
            format!("Fn 监听注册失败：{error}；已使用普通语音快捷键回退。")
        } else if registered && accessibility_trusted() {
            "macOS Fn 监听已注册：按住 Fn 开始录音，松开 Fn 停止并转写。".to_string()
        } else if registered {
            "macOS Fn 监听已注册；若跨应用按 Fn 无响应，请在系统设置中授予 Lime 辅助功能/输入监听权限，或使用普通快捷键回退。"
                .to_string()
        } else {
            "macOS 支持 Fn 监听；当前语音输入未启用或监听尚未注册，已使用普通语音快捷键回退。"
                .to_string()
        };

        FnShortcutRuntimeStatus {
            supported: true,
            registered,
            note,
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::FnShortcutRuntimeStatus;
    use tauri::AppHandle;

    pub fn register(_app: &AppHandle) -> Result<(), String> {
        Err("Fn 按住录音当前仅支持 macOS；已使用普通语音快捷键回退。".to_string())
    }

    pub fn unregister() -> Result<(), String> {
        Ok(())
    }

    pub fn is_supported() -> bool {
        false
    }

    pub fn is_registered() -> bool {
        false
    }

    pub fn runtime_status() -> FnShortcutRuntimeStatus {
        FnShortcutRuntimeStatus {
            supported: false,
            registered: false,
            note: "Fn 按住录音当前仅支持 macOS；已使用普通语音快捷键回退。".to_string(),
        }
    }
}

pub fn register(app: &tauri::AppHandle) -> Result<(), String> {
    platform::register(app)
}

pub fn unregister() -> Result<(), String> {
    platform::unregister()
}

pub fn is_supported() -> bool {
    platform::is_supported()
}

pub fn is_registered() -> bool {
    platform::is_registered()
}

pub fn runtime_status() -> FnShortcutRuntimeStatus {
    platform::runtime_status()
}
