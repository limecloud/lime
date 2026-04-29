//! 托盘状态模块
//!
//! 定义托盘图标状态和状态快照结构

use serde::{Deserialize, Serialize};

/// 托盘图标状态枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum TrayIconStatus {
    /// 正常运行（绿色）- 托盘状态已同步
    Running,
    /// 警告状态（黄色）- 主路径存在可恢复告警
    Warning,
    /// 错误状态（红色）- 主路径存在错误
    Error,
    /// 停止状态（灰色）- 托盘状态尚未同步
    #[default]
    Stopped,
}

/// 托盘快速切换模型项
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TrayQuickModelItem {
    /// Provider 类型
    pub provider_type: String,
    /// Provider 显示名称
    pub provider_label: String,
    /// 模型 ID
    pub model: String,
}

/// 托盘快速切换模型分组
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TrayQuickModelGroup {
    /// Provider 类型
    pub provider_type: String,
    /// Provider 显示名称
    pub provider_label: String,
    /// 当前 Provider 可快速切换的模型列表
    pub models: Vec<TrayQuickModelItem>,
}

/// 托盘状态快照
#[derive(Debug, Clone, Serialize)]
pub struct TrayStateSnapshot {
    /// 图标状态
    pub icon_status: TrayIconStatus,
    /// 今日请求数
    pub today_requests: u64,
    /// 是否开机自启
    pub auto_start_enabled: bool,
    /// 当前选中的 Provider 类型
    pub current_model_provider_type: String,
    /// 当前选中的 Provider 显示名称
    pub current_model_provider_label: String,
    /// 当前选中的模型 ID
    pub current_model: String,
    /// 当前主题显示名称
    pub current_theme_label: String,
    /// 托盘中的快速模型切换候选
    pub quick_model_groups: Vec<TrayQuickModelGroup>,
}

impl Default for TrayStateSnapshot {
    fn default() -> Self {
        Self {
            icon_status: TrayIconStatus::Stopped,
            today_requests: 0,
            auto_start_enabled: false,
            current_model_provider_type: String::new(),
            current_model_provider_label: String::new(),
            current_model: String::new(),
            current_theme_label: String::new(),
            quick_model_groups: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_tray_state_has_no_credential_pool_status() {
        let state = TrayStateSnapshot::default();
        assert_eq!(state.icon_status, TrayIconStatus::Stopped);
        assert!(state.current_model.is_empty());
        assert!(state.quick_model_groups.is_empty());
    }
}
