//! 托盘事件处理模块
//!
//! 处理托盘图标的点击事件
//!
//! # Requirements
//! - 6.1: 单击托盘图标切换主窗口可见性
//! - 6.2: 双击托盘图标显示并聚焦主窗口
//! - 7.3: 托盘菜单打开时获取并显示最新信息

use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime,
};
use tracing::{debug, info};

/// 托盘菜单即将打开的事件名称
pub const TRAY_MENU_WILL_OPEN_EVENT: &str = "tray-menu-will-open";

/// 处理托盘图标事件
///
/// # Requirements
/// - 6.1: 单击切换主窗口可见性
/// - 6.2: 双击显示并聚焦主窗口
/// - 7.3: 右键点击时触发菜单刷新
pub fn handle_tray_icon_event<R: Runtime>(app: &AppHandle<R>, event: TrayIconEvent) {
    match event {
        // 单击事件 - 切换主窗口可见性
        // Requirements 6.1: WHEN 用户单击托盘图标 THEN 系统托盘 SHALL 切换主应用程序窗口的可见性
        TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        } => {
            debug!("托盘图标单击事件");
            toggle_main_window_visibility(app);
        }

        // 右键点击事件 - 菜单即将打开，触发数据刷新
        // Requirements 7.3: WHEN 托盘菜单被打开时 THEN 系统托盘 SHALL 获取并显示最新的统计信息和状态信息
        TrayIconEvent::Click {
            button: MouseButton::Right,
            button_state: MouseButtonState::Up,
            ..
        } => {
            debug!("托盘图标右键点击事件 - 菜单即将打开");
            // 发送事件通知前端刷新托盘数据
            if let Err(e) = app.emit(TRAY_MENU_WILL_OPEN_EVENT, ()) {
                tracing::error!("发送托盘菜单打开事件失败: {}", e);
            }
        }

        // 双击事件 - 显示并聚焦主窗口
        // Requirements 6.2: WHEN 用户双击托盘图标 THEN 系统托盘 SHALL 显示并聚焦主应用程序窗口
        TrayIconEvent::DoubleClick {
            button: MouseButton::Left,
            ..
        } => {
            debug!("托盘图标双击事件");
            show_and_focus_main_window(app);
        }

        // 其他事件忽略
        _ => {}
    }
}

/// 切换主窗口可见性
///
/// 如果窗口可见则隐藏，如果隐藏则显示并聚焦
///
/// # Requirements
/// - 6.1: 单击托盘图标切换主窗口可见性
fn toggle_main_window_visibility<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        match window.is_visible() {
            Ok(true) => {
                // 窗口可见，隐藏它
                if let Err(e) = window.hide() {
                    tracing::error!("隐藏主窗口失败: {}", e);
                } else {
                    info!("主窗口已隐藏");
                }
            }
            Ok(false) => {
                // 窗口隐藏，显示并聚焦
                show_and_focus_window(&window);
            }
            Err(e) => {
                tracing::error!("获取窗口可见性失败: {}", e);
                // 尝试显示窗口
                show_and_focus_window(&window);
            }
        }
    } else {
        tracing::warn!("未找到主窗口");
    }
}

/// 显示并聚焦主窗口
///
/// # Requirements
/// - 6.2: 双击托盘图标显示并聚焦主窗口
fn show_and_focus_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        show_and_focus_window(&window);
    } else {
        tracing::warn!("未找到主窗口");
    }
}

/// 显示并聚焦窗口的辅助函数
fn show_and_focus_window<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    crate::app::window_chrome::reveal_main_window(window, "托盘");
    info!("主窗口已显示");
}

#[cfg(test)]
mod tests {
    // 由于这些函数依赖 Tauri 运行时，单元测试需要模拟环境
    // 这里只测试基本的模块结构

    #[test]
    fn test_module_compiles() {
        // 确保模块可以编译
        assert!(true);
    }
}
