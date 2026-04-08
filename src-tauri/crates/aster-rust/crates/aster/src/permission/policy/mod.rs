//! Tool Policy 系统模块
//!
//! 本模块实现了 OpenClaw 风格的 Tool Policy 系统，提供：
//! - Profile 预设配置（minimal, coding, messaging, full, custom）
//! - Tool Groups 工具分组（group:fs, group:runtime, group:memory, group:web, group:session）
//! - 多层策略合并（Profile → Global → Agent → Session）
//!
//! # 模块结构
//!
//! - `types`: 核心类型定义（ToolProfile, PolicyLayer, ToolPolicy, PolicyDecision, PolicyError）
//! - `groups`: 工具分组注册表（ToolGroups）
//! - `profile`: Profile 预设配置管理（ProfileManager）
//! - `policy_merger`: 多层策略合并器（PolicyMerger）
//! - `manager`: 主管理器（ToolPolicyManager）
//!
//! # 使用示例
//!
//! ```rust,ignore
//! use aster::permission::policy::{ToolProfile, ToolPolicyManager, PolicyLayer};
//!
//! // 创建管理器
//! let mut manager = ToolPolicyManager::new(None);
//!
//! // 设置 Profile
//! manager.set_profile(ToolProfile::Coding)?;
//!
//! // 检查工具权限
//! let result = manager.is_allowed("bash", &params, &context);
//! ```
//!
//! # Requirements
//!
//! - 1.1: Profile 预设配置
//! - 2.1: Tool Groups 工具分组
//! - 3.1: 多层策略合并

// =============================================================================
// 子模块声明
// =============================================================================

pub mod groups;
pub mod manager;
pub mod migration;
pub mod policy_merger;
pub mod profile;
pub mod types;

#[cfg(test)]
mod property_tests;

// =============================================================================
// 公共导出
// =============================================================================

// 核心类型导出 (Requirements: 1.1, 3.1)
pub use types::{MergedPolicy, PolicyDecision, PolicyError, PolicyLayer, ToolPolicy, ToolProfile};

// 工具分组导出 (Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7)
pub use groups::ToolGroups;

// Profile 管理导出 (Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8)
pub use profile::{ProfileConfig, ProfileManager};

// 策略合并器导出 (Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7)
pub use policy_merger::PolicyMerger;

// 主管理器导出 (Requirements: 5.1, 5.3, 5.5, 6.1, 6.2, 6.3, 6.4)
pub use manager::ToolPolicyManager;

// 迁移工具导出 (Requirements: 5.2, 5.4)
pub use migration::PolicyMigration;
