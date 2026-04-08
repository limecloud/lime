//! 核心模块
//!
//! 提供后台任务、重试逻辑、组件监督者等核心功能

mod background_tasks;
mod retry_logic;
pub mod supervisor;

pub use background_tasks::*;
pub use retry_logic::*;
pub use supervisor::{spawn_component_supervisor, RestartPolicy, SupervisorConfig};

#[cfg(test)]
mod tests;
