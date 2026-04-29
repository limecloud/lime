//! 菜单文本格式化模块（桥接层）
//!
//! 纯逻辑已迁移到 `lime-core` crate，
//! 本模块保留兼容导出。

pub use lime_core::tray_format::{format_current_model_status, format_request_count};
