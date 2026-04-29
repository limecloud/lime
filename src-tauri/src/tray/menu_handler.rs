//! 托盘菜单事件处理模块
//!
//! 处理托盘菜单项的点击事件
//!
//! # Requirements
//! - 3.3, 3.4: 运行时维护事件处理
//! - 4.1, 4.3, 4.4: 快捷工具事件处理
//! - 5.1, 5.2: 设置切换事件处理

use super::menu::menu_ids;
use lime_core::tray_menu_meta::parse_quick_model_item_id;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_autostart::ManagerExt;
use tracing::{debug, error, info, warn};

/// 菜单事件类型
///
/// 用于前端监听的事件名称
pub mod menu_events {
    /// 自启动状态变更事件
    pub const AUTO_START_CHANGED: &str = "tray-auto-start-changed";
    /// 托盘快速切换模型事件
    pub const MODEL_SELECTED: &str = "tray-model-selected";
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrayModelSelectedPayload {
    provider_type: String,
    model: String,
}

/// 处理菜单事件
///
/// 根据菜单项 ID 执行相应的操作
///
/// # Requirements
/// - 3.3, 3.4: 运行时维护
/// - 4.1, 4.3, 4.4: 快捷工具
/// - 5.1, 5.2: 设置切换
pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, menu_id: &str) {
    debug!("处理托盘菜单事件: {}", menu_id);

    if let Some((provider_type, model)) = parse_quick_model_item_id(menu_id) {
        handle_model_selected(app, provider_type, model);
        return;
    }

    match menu_id {
        // === 快捷工具 ===
        menu_ids::OPEN_WINDOW => handle_open_window(app),
        menu_ids::OPEN_LOG_DIR => handle_open_log_dir(app),
        menu_ids::QUIT => handle_quit(app),

        // === 设置 ===
        menu_ids::AUTO_START => handle_auto_start_toggle(app),

        // 忽略信息类菜单项和分隔符
        menu_ids::CURRENT_MODEL_INFO | menu_ids::REQUEST_INFO => {
            debug!("忽略信息类菜单项: {}", menu_id);
        }

        _ => {
            warn!("未知的菜单项 ID: {}", menu_id);
        }
    }
}

fn handle_model_selected<R: Runtime>(app: &AppHandle<R>, provider_type: String, model: String) {
    info!(
        "[托盘] 用户请求切换模型: provider_type={}, model={}",
        provider_type, model
    );

    let payload = TrayModelSelectedPayload {
        provider_type,
        model,
    };

    if let Err(e) = app.emit(menu_events::MODEL_SELECTED, payload) {
        error!("[托盘] 发送模型切换事件失败: {}", e);
    }
}

/// 处理打开主窗口事件
///
/// # Requirements
/// - 4.1: WHEN 用户点击托盘菜单中的"打开主窗口"
///   THEN 系统托盘 SHALL 显示并聚焦主应用程序窗口
fn handle_open_window<R: Runtime>(app: &AppHandle<R>) {
    info!("[托盘] 用户请求打开主窗口");

    if let Some(window) = app.get_webview_window("main") {
        crate::app::window_chrome::reveal_main_window(&window, "托盘");
        info!("[托盘] 主窗口已显示并聚焦");
    } else {
        warn!("[托盘] 未找到主窗口");
    }
}

/// 处理打开日志目录事件
///
/// # Requirements
/// - 4.3: WHEN 用户点击托盘菜单中的"打开日志目录"
///   THEN 系统托盘 SHALL 在系统文件管理器中打开应用程序日志目录
fn handle_open_log_dir<R: Runtime>(app: &AppHandle<R>) {
    info!("[托盘] 用户请求打开日志目录");

    // 获取日志目录路径
    let _ = app;
    let log_dir = match lime_core::app_paths::resolve_logs_dir() {
        Ok(dir) => dir,
        Err(error) => {
            error!("[托盘] 无法确定日志目录路径: {}", error);
            return;
        }
    };

    // 确保目录存在
    if !log_dir.exists() {
        if let Err(e) = std::fs::create_dir_all(&log_dir) {
            error!("[托盘] 创建日志目录失败: {}", e);
            return;
        }
    }

    // 使用 open crate 打开目录
    if let Err(e) = open::that(&log_dir) {
        error!("[托盘] 打开日志目录失败: {}", e);
    } else {
        info!("[托盘] 已打开日志目录: {}", log_dir.display());
    }
}

/// 处理退出事件
///
/// # Requirements
/// - 4.4: WHEN 用户点击托盘菜单中的"退出"
///   THEN 系统托盘 SHALL 终止应用程序
fn handle_quit<R: Runtime>(app: &AppHandle<R>) {
    info!("[托盘] 用户请求退出应用");

    // 退出应用
    app.exit(0);
}

/// 处理自启动切换事件
///
/// # Requirements
/// - 5.1: WHEN 用户在托盘菜单中切换"开机自启"
///   THEN 系统托盘 SHALL 启用或禁用应用程序的登录时启动设置
/// - 5.2: WHEN 托盘菜单显示时
///   THEN 系统托盘 SHALL 使用勾选标记显示"开机自启"切换的当前状态
fn handle_auto_start_toggle<R: Runtime>(app: &AppHandle<R>) {
    info!("[托盘] 用户请求切换开机自启状态");

    let autostart_manager = app.autolaunch();

    // 获取当前状态并切换
    match autostart_manager.is_enabled() {
        Ok(is_enabled) => {
            let new_state = !is_enabled;
            let result = if new_state {
                autostart_manager.enable()
            } else {
                autostart_manager.disable()
            };

            match result {
                Ok(_) => {
                    info!(
                        "[托盘] 开机自启已{}",
                        if new_state { "启用" } else { "禁用" }
                    );

                    // 发送状态变更事件到前端
                    if let Err(e) = app.emit(menu_events::AUTO_START_CHANGED, new_state) {
                        error!("[托盘] 发送自启动状态变更事件失败: {}", e);
                    }
                }
                Err(e) => {
                    error!("[托盘] 切换开机自启失败: {}", e);
                }
            }
        }
        Err(e) => {
            error!("[托盘] 获取开机自启状态失败: {}", e);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_menu_events_constants() {
        // 验证事件常量不为空
        assert!(!menu_events::AUTO_START_CHANGED.is_empty());
    }

    #[test]
    fn test_menu_events_unique() {
        // 验证事件常量唯一
        let events = vec![menu_events::AUTO_START_CHANGED, menu_events::MODEL_SELECTED];

        let mut unique_events = events.clone();
        unique_events.sort();
        unique_events.dedup();

        assert_eq!(events.len(), unique_events.len(), "事件常量应该唯一");
    }
}
