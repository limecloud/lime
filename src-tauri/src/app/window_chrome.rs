//! 主窗口系统 chrome 收口。

/// 应用主窗口的 macOS 标题栏样式，避免启动配置被 headless/dev 链路绕过。
pub fn apply_main_window_chrome(window: &tauri::WebviewWindow) {
    apply_macos_titlebar_overlay(window);
}

#[cfg(not(target_os = "macos"))]
fn apply_macos_titlebar_overlay(_window: &tauri::WebviewWindow) {}

#[cfg(target_os = "macos")]
#[allow(deprecated)]
fn apply_macos_titlebar_overlay(window: &tauri::WebviewWindow) {
    if let Err(error) = window.set_title_bar_style(tauri::TitleBarStyle::Overlay) {
        tracing::warn!("[窗口] 设置主窗口 overlay 标题栏失败: {}", error);
    }

    match window.ns_window() {
        Ok(ns_window) => {
            use cocoa::appkit::{NSWindow, NSWindowStyleMask, NSWindowTitleVisibility};
            use cocoa::base::{id, YES};

            #[allow(deprecated, unexpected_cfgs)]
            unsafe {
                let ns_window = ns_window as id;
                ns_window.setTitleVisibility_(NSWindowTitleVisibility::NSWindowTitleHidden);
                ns_window.setTitlebarAppearsTransparent_(YES);

                let style_mask =
                    ns_window.styleMask() | NSWindowStyleMask::NSFullSizeContentViewWindowMask;
                ns_window.setStyleMask_(style_mask);

                hide_standard_window_buttons(ns_window);
            }
        }
        Err(error) => {
            tracing::warn!(
                "[窗口] 获取主窗口 NSWindow 失败，无法兜底隐藏标题栏: {}",
                error
            );
        }
    }
}

#[cfg(target_os = "macos")]
#[allow(deprecated)]
unsafe fn hide_standard_window_buttons(ns_window: cocoa::base::id) {
    use cocoa::appkit::{NSWindow, NSWindowButton};
    use cocoa::base::{nil, YES};
    use objc::{msg_send, sel, sel_impl};

    for button_kind in [
        NSWindowButton::NSWindowCloseButton,
        NSWindowButton::NSWindowMiniaturizeButton,
        NSWindowButton::NSWindowZoomButton,
    ] {
        let button = ns_window.standardWindowButton_(button_kind);
        if button != nil {
            let _: () = msg_send![button, setHidden: YES];
        }
    }
}
