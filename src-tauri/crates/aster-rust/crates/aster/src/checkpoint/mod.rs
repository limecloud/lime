//! 文件检查点系统
//!
//! 在编辑会话期间保存和恢复文件状态
//!
//! # 功能
//! - 自动和手动检查点创建
//! - 增量 diff 存储
//! - Git 集成
//! - 检查点浏览和搜索
//! - 多文件恢复
//! - 压缩和存储优化

pub mod diff;
pub mod session;
pub mod storage;
pub mod types;

#[cfg(test)]
mod tests;

// Re-exports
pub use diff::*;
pub use session::*;
pub use storage::*;
pub use types::*;
