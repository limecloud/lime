//! 后台任务模块
//!
//! 提供任务队列、Shell 管理、超时处理和状态持久化功能
//!
//! # 模块结构
//! - `types` - 共享类型定义
//! - `task_queue` - 简单任务队列实现
//! - `shell_manager` - 后台 Shell 管理器
//! - `timeout` - 超时处理
//! - `persistence` - 状态持久化

pub mod persistence;
pub mod shell_manager;
pub mod task_queue;
pub mod timeout;
pub mod types;

// Re-exports
pub use persistence::*;
pub use shell_manager::*;
pub use task_queue::*;
pub use timeout::*;
pub use types::*;
