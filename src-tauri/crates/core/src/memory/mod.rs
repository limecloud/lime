//! Memory 模块
//!
//! 提供项目记忆系统管理功能（角色、世界观、大纲）。

pub mod manager;
pub mod types;

pub use manager::MemoryManager;
pub use types::*;
