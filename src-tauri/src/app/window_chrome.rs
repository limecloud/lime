//! 主窗口系统 chrome 收口。

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum WindowRevealAction {
    Unminimize,
    Maximize,
    Show,
    Focus,
}

const WINDOW_REVEAL_ACTIONS: [WindowRevealAction; 4] = [
    WindowRevealAction::Unminimize,
    WindowRevealAction::Maximize,
    WindowRevealAction::Show,
    WindowRevealAction::Focus,
];

#[cfg(any(target_os = "macos", test))]
const LIME_MACOS_APP_ICON_BYTES: &[u8] = include_bytes!("../../../public/logo.png");
#[cfg(any(target_os = "macos", test))]
const LIME_MACOS_ABOUT_COPYRIGHT: &str = "Copyright © 2026 Lime";

impl WindowRevealAction {
    fn label(self) -> &'static str {
        match self {
            Self::Unminimize => "取消最小化",
            Self::Maximize => "最大化",
            Self::Show => "显示",
            Self::Focus => "聚焦",
        }
    }
}

/// 应用主窗口的 macOS 标题栏样式，避免启动配置被 headless/dev 链路绕过。
pub fn apply_main_window_chrome(window: &tauri::WebviewWindow) {
    apply_macos_titlebar_overlay(window);
    apply_macos_application_icon();
}

/// 最大化、显示并聚焦主窗口，保持启动和托盘打开时的铺满体验。
pub fn reveal_main_window<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>, source: &str) {
    for action in WINDOW_REVEAL_ACTIONS {
        let result = match action {
            WindowRevealAction::Unminimize => window.unminimize(),
            WindowRevealAction::Maximize => window.maximize(),
            WindowRevealAction::Show => window.show(),
            WindowRevealAction::Focus => window.set_focus(),
        };

        if let Err(error) = result {
            tracing::warn!("[{}] 主窗口{}失败: {}", source, action.label(), error);
        }
    }
}

#[cfg(target_os = "macos")]
pub fn build_lime_app_menu<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::image::Image;
    use tauri::menu::{
        AboutMetadata, Menu, PredefinedMenuItem, Submenu, HELP_SUBMENU_ID, WINDOW_SUBMENU_ID,
    };

    let package_info = app_handle.package_info();
    let version = package_info.version.to_string();
    let icon = Image::from_bytes(LIME_MACOS_APP_ICON_BYTES)?;
    let about_metadata = AboutMetadata {
        name: Some(package_info.name.clone()),
        version: Some(version.clone()),
        short_version: Some(version),
        copyright: Some(LIME_MACOS_ABOUT_COPYRIGHT.to_string()),
        icon: Some(icon),
        ..Default::default()
    };

    let window_menu = Submenu::with_id_and_items(
        app_handle,
        WINDOW_SUBMENU_ID,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app_handle, None)?,
            &PredefinedMenuItem::maximize(app_handle, None)?,
            &PredefinedMenuItem::separator(app_handle)?,
            &PredefinedMenuItem::close_window(app_handle, None)?,
        ],
    )?;

    let help_menu = Submenu::with_id_and_items(app_handle, HELP_SUBMENU_ID, "Help", true, &[])?;

    Menu::with_items(
        app_handle,
        &[
            &Submenu::with_items(
                app_handle,
                package_info.name.clone(),
                true,
                &[
                    &PredefinedMenuItem::about(app_handle, None, Some(about_metadata))?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::services(app_handle, None)?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::hide(app_handle, None)?,
                    &PredefinedMenuItem::hide_others(app_handle, None)?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::quit(app_handle, None)?,
                ],
            )?,
            &Submenu::with_items(
                app_handle,
                "File",
                true,
                &[&PredefinedMenuItem::close_window(app_handle, None)?],
            )?,
            &Submenu::with_items(
                app_handle,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app_handle, None)?,
                    &PredefinedMenuItem::redo(app_handle, None)?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::cut(app_handle, None)?,
                    &PredefinedMenuItem::copy(app_handle, None)?,
                    &PredefinedMenuItem::paste(app_handle, None)?,
                    &PredefinedMenuItem::select_all(app_handle, None)?,
                ],
            )?,
            &Submenu::with_items(
                app_handle,
                "View",
                true,
                &[&PredefinedMenuItem::fullscreen(app_handle, None)?],
            )?,
            &window_menu,
            &help_menu,
        ],
    )
}

#[cfg(not(target_os = "macos"))]
fn apply_macos_titlebar_overlay(_window: &tauri::WebviewWindow) {}

#[cfg(not(target_os = "macos"))]
fn apply_macos_application_icon() {}

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

                show_standard_window_buttons(ns_window);
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
fn apply_macos_application_icon() {
    use cocoa::appkit::{NSApp, NSApplication, NSImage};
    use cocoa::base::{id, nil};
    use cocoa::foundation::{NSData, NSUInteger};
    use std::ffi::c_void;

    unsafe {
        let data = <id as NSData>::dataWithBytes_length_(
            nil,
            LIME_MACOS_APP_ICON_BYTES.as_ptr() as *const c_void,
            LIME_MACOS_APP_ICON_BYTES.len() as NSUInteger,
        );
        if data == nil {
            tracing::warn!("[窗口] 创建 Lime logo 数据失败，无法设置 macOS About 图标");
            return;
        }

        let image = <id as NSImage>::initWithData_(NSImage::alloc(nil), data);
        if image == nil {
            tracing::warn!("[窗口] 解析 Lime logo 图片失败，无法设置 macOS About 图标");
            return;
        }

        NSApp().setApplicationIconImage_(image);
    }
}

#[cfg(target_os = "macos")]
#[allow(deprecated)]
unsafe fn show_standard_window_buttons(ns_window: cocoa::base::id) {
    use cocoa::appkit::{NSWindow, NSWindowButton};
    use cocoa::base::{nil, NO};
    use objc::{msg_send, sel, sel_impl};

    for button_kind in [
        NSWindowButton::NSWindowCloseButton,
        NSWindowButton::NSWindowMiniaturizeButton,
        NSWindowButton::NSWindowZoomButton,
    ] {
        let button = ns_window.standardWindowButton_(button_kind);
        if button != nil {
            let _: () = msg_send![button, setHidden: NO];
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        WindowRevealAction, LIME_MACOS_ABOUT_COPYRIGHT, LIME_MACOS_APP_ICON_BYTES,
        WINDOW_REVEAL_ACTIONS,
    };

    #[test]
    fn reveal_actions_should_keep_maximized_startup_order() {
        assert_eq!(
            WINDOW_REVEAL_ACTIONS,
            [
                WindowRevealAction::Unminimize,
                WindowRevealAction::Maximize,
                WindowRevealAction::Show,
                WindowRevealAction::Focus,
            ],
        );
    }

    #[test]
    fn macos_about_icon_should_use_lime_logo_png() {
        assert!(LIME_MACOS_APP_ICON_BYTES.starts_with(b"\x89PNG\r\n\x1a\n"));
        assert!(
            LIME_MACOS_APP_ICON_BYTES.len() > 1024,
            "Lime logo 图标资源不应为空或退回占位图"
        );
        assert!(
            tauri::image::Image::from_bytes(LIME_MACOS_APP_ICON_BYTES).is_ok(),
            "macOS About 菜单必须能把 Lime logo 解码成原生菜单图标"
        );
    }

    #[test]
    fn macos_about_metadata_should_stay_minimal() {
        assert_eq!(LIME_MACOS_ABOUT_COPYRIGHT, "Copyright © 2026 Lime");
    }
}
