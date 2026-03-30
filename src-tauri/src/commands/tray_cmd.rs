//! 托盘相关命令
//!
//! 仅保留托盘当前主链所需的 Tauri 命令。

use crate::tray::TrayQuickModelGroup;
use crate::TrayManagerState;
use tauri::State;
use tracing::debug;

/// 同步托盘中的快速模型切换菜单
///
/// 由前端在模型或 Provider 变化时调用，用于更新系统托盘中的当前模型信息与快捷切换列表。
#[tauri::command]
pub async fn sync_tray_model_shortcuts(
    tray_state: State<'_, TrayManagerState<tauri::Wry>>,
    current_model_provider_type: String,
    current_model_provider_label: String,
    current_model: String,
    current_theme_label: String,
    quick_model_groups: Vec<TrayQuickModelGroup>,
) -> Result<(), String> {
    let tray_guard = tray_state.0.read().await;
    let tray_manager = tray_guard
        .as_ref()
        .ok_or_else(|| "托盘管理器未初始化".to_string())?;

    let mut current_state = tray_manager.get_state().await;
    current_state.current_model_provider_type = current_model_provider_type;
    current_state.current_model_provider_label = current_model_provider_label;
    current_state.current_model = current_model;
    current_state.current_theme_label = current_theme_label;
    current_state.quick_model_groups = quick_model_groups;

    tray_manager
        .update_state(current_state)
        .await
        .map_err(|e| e.to_string())?;

    debug!("托盘模型快捷菜单已同步");

    Ok(())
}
