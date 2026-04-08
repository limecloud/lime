//! 插件系统模块
//!
//! 提供插件加载、管理、生命周期控制等功能
//!
//! ## 功能
//! - 插件发现与加载
//! - 依赖管理（拓扑排序）
//! - 版本兼容性检查
//! - 工具/命令/技能/钩子注册

mod context;
mod manager;
mod registry;
mod types;
mod version;

pub use context::{PluginConfigAPI, PluginContext, PluginLogger};
pub use manager::{PluginEvent, PluginManager};
pub use registry::{
    PluginCommandAPI, PluginHookAPI, PluginRegistry, PluginSkillAPI, PluginToolAPI, ToolDefinition,
};
pub use types::{
    CommandDefinition, HookDefinition, Plugin, PluginConfig, PluginHookType, PluginMetadata,
    PluginState, SkillDefinition,
};
pub use version::{Version, VersionChecker};
