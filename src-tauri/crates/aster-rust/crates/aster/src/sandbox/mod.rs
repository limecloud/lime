//! 沙箱模块
//!
//! 提供进程隔离、文件系统沙箱、网络沙箱等功能

mod config;
mod executor;
mod filesystem;
mod resource_limits;

pub use config::{
    ResourceLimits, SandboxConfig, SandboxConfigManager, SandboxPreset, SANDBOX_PRESETS,
};
pub use executor::{
    detect_best_sandbox, execute_in_sandbox, get_sandbox_capabilities, ExecutorOptions,
    ExecutorResult, SandboxExecutor,
};
pub use filesystem::{FilesystemPolicy, FilesystemSandbox, PathRule};
pub use resource_limits::{ResourceLimiter, ResourceUsage};
