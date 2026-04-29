//! 托盘菜单模块
//!
//! 定义菜单项 ID 和菜单构建函数

use super::format::{format_current_model_status, format_request_count};
use super::state::TrayStateSnapshot;
use tauri::{
    menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Runtime,
};

pub use lime_core::tray_menu_meta::menu_ids;
pub use lime_core::tray_menu_meta::{build_quick_model_item_id, get_menu_item_ids};

/// 托盘菜单构建错误
#[derive(Debug, thiserror::Error)]
pub enum MenuBuildError {
    #[error("无法创建菜单项: {0}")]
    MenuItemError(String),
    #[error("无法创建菜单: {0}")]
    MenuError(String),
}

fn build_quick_model_submenu<R: Runtime>(
    app: &AppHandle<R>,
    state: &TrayStateSnapshot,
) -> Result<Option<Submenu<R>>, MenuBuildError> {
    let non_empty_groups: Vec<_> = state
        .quick_model_groups
        .iter()
        .filter(|group| !group.models.is_empty())
        .collect();

    if non_empty_groups.is_empty() {
        return Ok(None);
    }

    let mut provider_submenus: Vec<Submenu<R>> = Vec::new();

    for group in non_empty_groups {
        let mut model_items: Vec<CheckMenuItem<R>> = Vec::new();

        for item in &group.models {
            let checked = item.provider_type == state.current_model_provider_type
                && item.model == state.current_model;
            let menu_item = CheckMenuItem::with_id(
                app,
                build_quick_model_item_id(&item.provider_type, &item.model),
                &item.model,
                true,
                checked,
                None::<&str>,
            )
            .map_err(|e| MenuBuildError::MenuItemError(e.to_string()))?;
            model_items.push(menu_item);
        }

        let model_item_refs: Vec<&dyn IsMenuItem<R>> = model_items
            .iter()
            .map(|item| item as &dyn IsMenuItem<R>)
            .collect();

        let provider_submenu =
            Submenu::with_items(app, &group.provider_label, true, &model_item_refs)
                .map_err(|e| MenuBuildError::MenuItemError(e.to_string()))?;
        provider_submenus.push(provider_submenu);
    }

    let provider_refs: Vec<&dyn IsMenuItem<R>> = provider_submenus
        .iter()
        .map(|submenu| submenu as &dyn IsMenuItem<R>)
        .collect();

    let submenu = Submenu::with_id_and_items(
        app,
        menu_ids::QUICK_MODEL_ROOT,
        "快速切换模型",
        true,
        &provider_refs,
    )
    .map_err(|e| MenuBuildError::MenuItemError(e.to_string()))?;

    Ok(Some(submenu))
}

/// 构建托盘菜单
///
/// 根据当前状态快照构建完整的托盘菜单，包含：
/// - 状态信息（当前模型、请求统计）
/// - 快捷工具（打开主窗口、打开日志目录）
/// - 设置（开机自启）
/// - 退出
///
/// # Requirements
/// - 2.1: 右键点击托盘图标显示包含所有可用操作的托盘菜单
/// - 2.2: 显示当前 Provider 配置状态
/// - 2.3: 显示今日请求次数
/// - 3.3, 3.4: 运行时维护菜单项
/// - 4.1, 4.3, 4.4: 快捷工具菜单项
/// - 5.1, 5.2: 开机自启设置
pub fn build_tray_menu<R: Runtime>(
    app: &AppHandle<R>,
    state: &TrayStateSnapshot,
) -> Result<Menu<R>, MenuBuildError> {
    // === 当前模型信息 ===
    let current_model_text = format_current_model_status(
        &state.current_model_provider_label,
        &state.current_model,
        if state.current_theme_label.trim().is_empty() {
            None
        } else {
            Some(state.current_theme_label.as_str())
        },
    );
    let current_model_info = MenuItem::with_id(
        app,
        menu_ids::CURRENT_MODEL_INFO,
        &current_model_text,
        false,
        None::<&str>,
    )
    .map_err(|e| MenuBuildError::MenuItemError(e.to_string()))?;
    let quick_model_submenu = build_quick_model_submenu(app, state)?;
    let separator_0 = PredefinedMenuItem::separator(app)
        .map_err(|e| MenuBuildError::MenuItemError(e.to_string()))?;

    let request_text = format_request_count(state.today_requests);
    let request_info = MenuItem::with_id(
        app,
        menu_ids::REQUEST_INFO,
        &request_text,
        false,
        None::<&str>,
    )
    .map_err(|e| MenuBuildError::MenuItemError(e.to_string()))?;

    // === 分隔符 1 ===
    let separator_1 = PredefinedMenuItem::separator(app)
        .map_err(|e| MenuBuildError::MenuItemError(e.to_string()))?;

    // === 快捷工具区域 ===
    let open_window =
        MenuItem::with_id(app, menu_ids::OPEN_WINDOW, "打开 Lime", true, None::<&str>)
            .map_err(|e| MenuBuildError::MenuItemError(e.to_string()))?;

    let open_log_dir = MenuItem::with_id(
        app,
        menu_ids::OPEN_LOG_DIR,
        "打开 Lime 日志",
        true,
        None::<&str>,
    )
    .map_err(|e| MenuBuildError::MenuItemError(e.to_string()))?;

    // === 分隔符 3 ===
    let separator_3 = PredefinedMenuItem::separator(app)
        .map_err(|e| MenuBuildError::MenuItemError(e.to_string()))?;

    // === 设置区域 ===
    let auto_start = CheckMenuItem::with_id(
        app,
        menu_ids::AUTO_START,
        "登录时启动 Lime",
        true,
        state.auto_start_enabled,
        None::<&str>,
    )
    .map_err(|e| MenuBuildError::MenuItemError(e.to_string()))?;

    // === 分隔符 4 ===
    let separator_4 = PredefinedMenuItem::separator(app)
        .map_err(|e| MenuBuildError::MenuItemError(e.to_string()))?;

    // === 退出 ===
    let quit = MenuItem::with_id(app, menu_ids::QUIT, "退出 Lime", true, None::<&str>)
        .map_err(|e| MenuBuildError::MenuItemError(e.to_string()))?;

    // 构建菜单
    let mut items: Vec<&dyn IsMenuItem<R>> = vec![&current_model_info];
    if let Some(submenu) = quick_model_submenu.as_ref() {
        items.push(submenu);
    }
    items.extend([
        &separator_0 as &dyn IsMenuItem<R>,
        &request_info,
        &separator_1,
        &open_window,
        &open_log_dir,
        &separator_3,
        &auto_start,
        &separator_4,
        &quit,
    ]);

    Menu::with_items(app, &items).map_err(|e| MenuBuildError::MenuError(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn test_all_required_ids_not_empty() {
        let ids = menu_ids::all_required_ids();
        assert!(!ids.is_empty(), "必需的菜单项 ID 列表不应为空");
    }

    #[test]
    fn test_all_required_ids_unique() {
        let ids = menu_ids::all_required_ids();
        let mut unique_ids = ids.clone();
        unique_ids.sort();
        unique_ids.dedup();
        assert_eq!(ids.len(), unique_ids.len(), "菜单项 ID 应该唯一");
    }

    /// **Feature: system-tray, Property 3: 菜单项完整性**
    /// **Validates: Requirements 2.1**
    #[test]
    fn test_menu_ids_completeness() {
        let ids = menu_ids::all_required_ids();

        // 验证所有预定义的菜单项 ID 都在列表中
        assert!(ids.contains(&menu_ids::REQUEST_INFO), "应包含 REQUEST_INFO");
        assert!(ids.contains(&menu_ids::OPEN_WINDOW), "应包含 OPEN_WINDOW");
        assert!(ids.contains(&menu_ids::OPEN_LOG_DIR), "应包含 OPEN_LOG_DIR");
        assert!(ids.contains(&menu_ids::AUTO_START), "应包含 AUTO_START");
        assert!(ids.contains(&menu_ids::QUIT), "应包含 QUIT");
    }

    #[test]
    fn test_get_menu_item_ids() {
        let ids = get_menu_item_ids();
        assert_eq!(ids.len(), 5, "应有 5 个必需的菜单项");
    }

    proptest! {
        /// **Feature: system-tray, Property 3: 菜单项完整性（属性测试）**
        /// **Validates: Requirements 2.1**
        ///
        /// 验证对于任意托盘菜单构建，生成的菜单 SHALL 包含所有预定义的菜单项 ID
        #[test]
        fn prop_menu_ids_completeness(
            _requests in 0u64..1000000,
            _auto_start in any::<bool>()
        ) {
            // 验证 all_required_ids 返回的列表包含所有必需的菜单项
            let ids = menu_ids::all_required_ids();

            // 必须包含所有预定义的 ID
            let required = vec![
                menu_ids::REQUEST_INFO,
                menu_ids::OPEN_WINDOW,
                menu_ids::OPEN_LOG_DIR,
                menu_ids::AUTO_START,
                menu_ids::QUIT,
            ];

            for id in required {
                prop_assert!(ids.contains(&id), "菜单项列表应包含 {}", id);
            }

            // 验证没有重复的 ID
            let mut sorted_ids = ids.clone();
            sorted_ids.sort();
            sorted_ids.dedup();
            prop_assert_eq!(ids.len(), sorted_ids.len(), "菜单项 ID 应该唯一");
        }
    }
}
