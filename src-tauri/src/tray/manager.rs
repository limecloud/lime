//! 托盘管理器模块
//!
//! 提供托盘图标和菜单的管理功能
//!
//! # Requirements
//! - 1.1: 账号可用时显示正常状态图标
//! - 1.4: 应用启动时显示初始状态图标
//! - 7.1, 7.2: 状态变化时更新托盘

use super::events::handle_tray_icon_event;
use super::menu::build_tray_menu;
use super::menu_handler::handle_menu_event;
use super::state::{TrayIconStatus, TrayStateSnapshot};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{
    image::Image,
    tray::{TrayIcon, TrayIconBuilder},
    AppHandle, Manager, Runtime,
};
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

/// 托盘初始化错误
#[derive(Debug, thiserror::Error)]
pub enum TrayError {
    #[error("无法加载托盘图标: {0}")]
    IconLoadError(String),

    #[error("无法创建托盘菜单: {0}")]
    MenuBuildError(String),

    #[error("无法创建托盘图标: {0}")]
    TrayBuildError(String),

    #[error("状态更新失败: {0}")]
    StateUpdateError(String),

    #[error("Tauri 错误: {0}")]
    TauriError(String),
}

impl From<tauri::Error> for TrayError {
    fn from(e: tauri::Error) -> Self {
        TrayError::TauriError(e.to_string())
    }
}

/// 托盘图标资源
///
/// 存储不同状态对应的图标
pub struct TrayIcons {
    /// 正常运行状态图标（绿色）
    pub running: Option<Image<'static>>,
    /// 警告状态图标（黄色）
    pub warning: Option<Image<'static>>,
    /// 错误状态图标（红色）
    pub error: Option<Image<'static>>,
    /// 停止状态图标（灰色）
    pub stopped: Option<Image<'static>>,
    /// 默认图标（后备）
    pub default: Image<'static>,
}

impl TrayIcons {
    /// 加载托盘图标资源
    ///
    /// 尝试从 `src-tauri/icons/tray/` 目录加载状态图标，
    /// 如果加载失败则使用默认应用图标作为后备
    pub fn load<R: Runtime>(app: &AppHandle<R>) -> Self {
        let resource_path = app
            .path()
            .resource_dir()
            .unwrap_or_else(|_| PathBuf::from("."));

        // 加载默认图标（必须成功）
        let default = Self::load_default_icon(app);

        // 尝试加载各状态图标
        // 为了保持一致性，所有状态都使用应用主图标
        let tray_icons_dir = resource_path.join("icons").join("tray");
        info!("托盘图标目录: {:?}", tray_icons_dir);

        // 检查是否有自定义托盘图标，如果没有则使用默认图标
        let running = Self::load_png_file(&tray_icons_dir.join("tray-running.png"))
            .or_else(|| Some(default.clone()));
        let warning = Self::load_png_file(&tray_icons_dir.join("tray-warning.png"))
            .or_else(|| Some(default.clone()));
        let error = Self::load_png_file(&tray_icons_dir.join("tray-error.png"))
            .or_else(|| Some(default.clone()));
        let stopped = Self::load_png_file(&tray_icons_dir.join("tray-stopped.png"))
            .or_else(|| Some(default.clone()));

        // 如果所有托盘图标都加载失败，使用内嵌资源
        if running.is_none() && warning.is_none() && error.is_none() && stopped.is_none() {
            warn!("所有托盘图标加载失败，将使用内嵌资源");
            return Self::load_embedded();
        }

        Self {
            running,
            warning,
            error,
            stopped,
            default,
        }
    }

    /// 从内嵌资源加载图标
    fn load_embedded() -> Self {
        info!("从内嵌资源加载托盘图标");

        // 使用应用主图标作为默认托盘图标
        let default = Image::from_bytes(include_bytes!("../../icons/32x32.png"))
            .expect("内嵌默认图标加载失败");

        // 所有状态都使用应用主图标，保持一致性
        // macOS 托盘图标建议使用单色 Template 图标，但为了跨平台一致性，使用应用图标
        let running = Image::from_bytes(include_bytes!("../../icons/32x32.png")).ok();
        let warning = Image::from_bytes(include_bytes!("../../icons/32x32.png")).ok();
        let error = Image::from_bytes(include_bytes!("../../icons/32x32.png")).ok();
        let stopped = Image::from_bytes(include_bytes!("../../icons/32x32.png")).ok();

        Self {
            running,
            warning,
            error,
            stopped,
            default,
        }
    }

    /// 加载默认应用图标
    fn load_default_icon<R: Runtime>(app: &AppHandle<R>) -> Image<'static> {
        // 尝试从资源目录加载
        let resource_path = app
            .path()
            .resource_dir()
            .unwrap_or_else(|_| PathBuf::from("."));

        let icon_path = resource_path.join("icons").join("32x32.png");

        if let Some(icon) = Self::load_png_file(&icon_path) {
            return icon;
        }

        // 使用内嵌的默认图标（PNG 格式）
        info!("使用内嵌默认图标");
        Image::from_bytes(include_bytes!("../../icons/32x32.png")).expect("内嵌默认图标加载失败")
    }

    /// 从 PNG 文件加载图标
    fn load_png_file(path: &PathBuf) -> Option<Image<'static>> {
        if !path.is_file() {
            debug!("图标文件不存在，跳过加载: {:?}", path);
            return None;
        }

        match Image::from_path(path) {
            Ok(image) => {
                info!("成功加载图标: {:?}", path);
                Some(image)
            }
            Err(e) => {
                warn!("无法加载图标文件 {:?}: {}", path, e);
                None
            }
        }
    }

    /// 根据状态获取对应的图标
    pub fn get_icon_for_status(&self, status: TrayIconStatus) -> &Image<'static> {
        match status {
            TrayIconStatus::Running => self.running.as_ref().unwrap_or(&self.default),
            TrayIconStatus::Warning => self.warning.as_ref().unwrap_or(&self.default),
            TrayIconStatus::Error => self.error.as_ref().unwrap_or(&self.default),
            TrayIconStatus::Stopped => self.stopped.as_ref().unwrap_or(&self.default),
        }
    }
}

/// 托盘管理器
///
/// 管理系统托盘图标和菜单的生命周期
///
/// # Requirements
/// - 1.1, 1.4: 托盘图标状态管理
/// - 7.1, 7.2: 状态同步和更新
pub struct TrayManager<R: Runtime> {
    /// Tauri 托盘图标句柄
    tray: TrayIcon<R>,
    /// 当前状态
    state: Arc<RwLock<TrayStateSnapshot>>,
    /// 图标资源
    icons: TrayIcons,
    /// AppHandle 引用
    app: AppHandle<R>,
}

impl<R: Runtime> TrayManager<R> {
    /// 创建托盘管理器
    ///
    /// 初始化托盘图标，设置初始状态为 Stopped
    ///
    /// # Requirements
    /// - 1.4: 应用启动时显示初始状态图标
    pub fn new(app: &AppHandle<R>) -> Result<Self, TrayError> {
        info!("初始化托盘管理器...");

        // 加载图标资源
        let icons = TrayIcons::load(app);

        // 创建初始状态
        let initial_state = TrayStateSnapshot::default();

        // 构建初始菜单
        let menu = build_tray_menu(app, &initial_state)
            .map_err(|e| TrayError::MenuBuildError(e.to_string()))?;

        // 获取初始图标
        let initial_icon = icons.get_icon_for_status(TrayIconStatus::Stopped);

        // 创建托盘图标
        // Requirements 6.1, 6.2: 注册托盘图标点击事件处理器
        // Requirements 3.1-3.4, 4.1-4.4, 5.1-5.2: 注册菜单事件处理器
        let tray = TrayIconBuilder::with_id("main-tray")
            .icon(initial_icon.clone())
            .menu(&menu)
            .show_menu_on_left_click(false)
            .tooltip("Lime | 青柠一下，灵感即来")
            .on_tray_icon_event(|tray, event| {
                let app = tray.app_handle();
                handle_tray_icon_event(app, event);
            })
            .on_menu_event(|app, event| {
                handle_menu_event(app, event.id().as_ref());
            })
            .build(app)
            .map_err(|e| TrayError::TrayBuildError(e.to_string()))?;

        info!("托盘管理器初始化完成");

        Ok(Self {
            tray,
            state: Arc::new(RwLock::new(initial_state)),
            icons,
            app: app.clone(),
        })
    }

    /// 获取当前状态快照
    pub async fn get_state(&self) -> TrayStateSnapshot {
        self.state.read().await.clone()
    }

    /// 获取当前图标状态
    pub async fn get_icon_status(&self) -> TrayIconStatus {
        self.state.read().await.icon_status
    }

    /// 更新托盘状态
    ///
    /// 更新内部状态并刷新图标和菜单
    ///
    /// # Requirements
    /// - 7.1: 账号状态变化时更新托盘图标
    /// - 7.2: 托盘菜单信息变化时更新菜单
    pub async fn update_state(&self, snapshot: TrayStateSnapshot) -> Result<(), TrayError> {
        let old_status = {
            let state = self.state.read().await;
            state.icon_status
        };

        // 更新内部状态
        {
            let mut state = self.state.write().await;
            *state = snapshot.clone();
        }

        // 如果图标状态变化，更新图标
        if old_status != snapshot.icon_status {
            self.set_icon(snapshot.icon_status)?;
            info!(
                "托盘图标状态更新: {:?} -> {:?}",
                old_status, snapshot.icon_status
            );
        }

        // 刷新菜单
        self.refresh_menu().await?;

        Ok(())
    }

    /// 刷新菜单内容
    ///
    /// 根据当前状态重新构建菜单
    ///
    /// # Requirements
    /// - 7.3: 托盘菜单打开时获取并显示最新信息
    pub async fn refresh_menu(&self) -> Result<(), TrayError> {
        let state = self.state.read().await;

        let menu = build_tray_menu(&self.app, &state)
            .map_err(|e| TrayError::MenuBuildError(e.to_string()))?;

        self.tray
            .set_menu(Some(menu))
            .map_err(|e| TrayError::StateUpdateError(e.to_string()))?;

        Ok(())
    }

    /// 设置托盘图标
    ///
    /// 根据状态切换图标
    ///
    /// # Requirements
    /// - 1.1: 正常状态显示绿色图标
    /// - 1.2: 警告状态显示黄色图标
    /// - 1.3: 错误状态显示红色图标
    /// - 1.4: 停止状态显示灰色图标
    pub fn set_icon(&self, status: TrayIconStatus) -> Result<(), TrayError> {
        let icon = self.icons.get_icon_for_status(status);

        self.tray
            .set_icon(Some(icon.clone()))
            .map_err(|e| TrayError::StateUpdateError(e.to_string()))?;

        Ok(())
    }

    /// 设置托盘提示文本
    pub fn set_tooltip(&self, tooltip: &str) -> Result<(), TrayError> {
        self.tray
            .set_tooltip(Some(tooltip))
            .map_err(|e| TrayError::StateUpdateError(e.to_string()))?;
        Ok(())
    }

    /// 获取托盘图标 ID
    pub fn id(&self) -> &str {
        "main-tray"
    }

    /// 获取 Tauri TrayIcon 引用
    pub fn tray_icon(&self) -> &TrayIcon<R> {
        &self.tray
    }
}

/// 简化版托盘管理器（用于测试和无 Tauri 环境）
pub struct SimpleTrayManager {
    /// 当前状态
    state: Arc<RwLock<TrayStateSnapshot>>,
}

impl SimpleTrayManager {
    /// 创建简化版托盘管理器
    pub fn new() -> Self {
        Self {
            state: Arc::new(RwLock::new(TrayStateSnapshot::default())),
        }
    }

    /// 获取当前状态快照
    pub async fn get_state(&self) -> TrayStateSnapshot {
        self.state.read().await.clone()
    }

    /// 更新托盘状态
    pub async fn update_state(&self, snapshot: TrayStateSnapshot) {
        let mut state = self.state.write().await;
        *state = snapshot;
    }

    /// 获取当前图标状态
    pub async fn get_icon_status(&self) -> TrayIconStatus {
        self.state.read().await.icon_status
    }
}

impl Default for SimpleTrayManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_simple_tray_manager_new() {
        let manager = SimpleTrayManager::new();
        let state = manager.get_state().await;
        assert_eq!(state.icon_status, TrayIconStatus::Stopped);
        assert_eq!(state.today_requests, 0);
    }

    #[tokio::test]
    async fn test_simple_tray_manager_update_state() {
        let manager = SimpleTrayManager::new();

        let new_state = TrayStateSnapshot {
            icon_status: TrayIconStatus::Running,
            today_requests: 100,
            auto_start_enabled: true,
            ..Default::default()
        };

        manager.update_state(new_state.clone()).await;

        let state = manager.get_state().await;
        assert_eq!(state.icon_status, TrayIconStatus::Running);
        assert_eq!(state.today_requests, 100);
        assert!(state.auto_start_enabled);
    }

    #[tokio::test]
    async fn test_simple_tray_manager_get_icon_status() {
        let manager = SimpleTrayManager::new();

        // 初始状态应该是 Stopped
        assert_eq!(manager.get_icon_status().await, TrayIconStatus::Stopped);

        // 更新状态后应该反映新状态
        let new_state = TrayStateSnapshot {
            icon_status: TrayIconStatus::Warning,
            ..Default::default()
        };
        manager.update_state(new_state).await;
        assert_eq!(manager.get_icon_status().await, TrayIconStatus::Warning);
    }

    #[test]
    fn test_tray_error_display() {
        let err = TrayError::IconLoadError("test error".to_string());
        assert!(err.to_string().contains("无法加载托盘图标"));

        let err = TrayError::MenuBuildError("menu error".to_string());
        assert!(err.to_string().contains("无法创建托盘菜单"));

        let err = TrayError::TrayBuildError("tray error".to_string());
        assert!(err.to_string().contains("无法创建托盘图标"));

        let err = TrayError::StateUpdateError("state error".to_string());
        assert!(err.to_string().contains("状态更新失败"));
    }
}
