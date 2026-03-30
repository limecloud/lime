//! 系统托盘模块
//!
//! 提供系统托盘功能，包括：
//! - 托盘图标状态管理
//! - 托盘菜单构建
//! - 菜单事件处理
//! - 托盘图标点击事件处理

mod events;
mod format;
mod manager;
mod menu;
mod menu_handler;
mod state;

pub use events::*;
pub use format::*;
pub use manager::*;
pub use menu::*;
pub use menu_handler::*;
pub use state::*;
