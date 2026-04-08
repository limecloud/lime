//! Skills System
//!
//! Provides skill discovery, loading, and execution functionality.
//! Skills are reusable prompts/workflows stored in SKILL.md files.
//!
//! # 模块结构
//!
//! - `types` - 类型定义（SkillDefinition, SkillExecutionMode, WorkflowStep 等）
//! - `loader` - 文件加载（从 SKILL.md 文件加载 Skill）
//! - `registry` - 注册表（Skill 发现和管理）
//! - `tool` - MCP Tool 集成
//! - `executor` - 执行引擎（LlmProvider, ExecutionCallback, SkillExecutor）
//! - `workflow` - 工作流处理（变量插值, 拓扑排序）
//! - `error` - 错误类型（SkillError）
//!
//! # 目录结构
//!
//! - `~/.claude/skills/` - User-level skills
//! - `.claude/skills/` - Project-level skills
//! - Plugin cache - Plugin-provided skills
//!
//! # 示例
//!
//! ```rust,ignore
//! use aster::skills::{
//!     SkillDefinition, SkillExecutionMode, SkillExecutionResult,
//!     SkillExecutor, LlmProvider, ExecutionCallback, NoopCallback,
//!     SkillError, interpolate_variables, topological_sort,
//! };
//! ```

pub mod error;
pub mod executor;
mod loader;
mod registry;
pub mod tool;
mod types;
pub mod workflow;

// 重新导出 loader, registry, tool, types 模块的所有公开项
pub use loader::*;
pub use registry::*;
pub use tool::*;
pub use types::*;

// 重新导出 error 模块的关键类型
pub use error::SkillError;

// 重新导出 executor 模块的关键类型
pub use executor::{ExecutionCallback, LlmProvider, NoopCallback, SkillExecutor};

// 重新导出 workflow 模块的关键函数
pub use workflow::{interpolate_variables, topological_sort};
