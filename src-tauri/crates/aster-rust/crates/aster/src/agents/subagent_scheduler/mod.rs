//! SubAgent 调度器模块
//!
//! 基于 Anthropic 最佳实践实现的 SubAgent 调度系统，提供：
//! - Orchestrator-Worker 模式的任务分发
//! - 上下文继承、压缩和隔离
//! - 并行执行和依赖管理
//! - 结果聚合和摘要生成
//!
//! # 架构设计
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────┐
//! │                    主 Agent (Orchestrator)                   │
//! │  - 全局规划和任务分解                                          │
//! │  - 维护全局状态和上下文摘要                                     │
//! │  - 协调子 Agent 执行顺序                                       │
//! └─────────────────────────────────────────────────────────────┘
//!                               │
//!               ┌───────────────┼───────────────┐
//!               ▼               ▼               ▼
//! ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
//! │   SubAgent A    │ │   SubAgent B    │ │   SubAgent C    │
//! │  独立上下文窗口  │ │  独立上下文窗口  │ │  独立上下文窗口  │
//! │  专注单一任务    │ │  专注单一任务    │ │  专注单一任务    │
//! └─────────────────┘ └─────────────────┘ └─────────────────┘
//!          │                   │                   │
//!          └───────────────────┼───────────────────┘
//!                              ▼
//!                     精炼摘要返回主 Agent
//!                    (1,000-2,000 tokens)
//! ```
//!
//! # 使用示例
//!
//! ```rust,ignore
//! use aster::agents::subagent_scheduler::{
//!     SubAgentScheduler, SchedulerConfig, SubAgentTask, SchedulingStrategy,
//! };
//!
//! // 创建调度器
//! let config = SchedulerConfig::default();
//! let mut scheduler = SubAgentScheduler::new(config);
//!
//! // 定义任务
//! let tasks = vec![
//!     SubAgentTask::new("task-1", "explore", "分析项目结构"),
//!     SubAgentTask::new("task-2", "code", "实现功能 A"),
//!     SubAgentTask::new("task-3", "test", "编写测试").with_dependencies(vec!["task-2"]),
//! ];
//!
//! // 执行任务
//! let result = scheduler.execute(tasks, parent_context).await?;
//! ```

mod config;
mod executor;
mod strategy;
mod summary;
mod types;

#[cfg(test)]
mod tests;

pub use config::*;
pub use executor::*;
pub use strategy::*;
pub use summary::*;
pub use types::*;
