//! Lime - AI API 代理服务
//!
//! 这是一个 Tauri 应用，提供 AI API 的代理和管理功能。
//!
//! ## Workspace 结构（渐进式拆分）
//!
//! - ✅ lime-core crate（models, data, logger, errors, backends, config, connect,
//!   middleware, orchestrator, plugin, session 部分, session_files）
//! - ✅ lime-infra crate（proxy, resilience, injection, telemetry）
//! - ✅ lime-providers crate（providers, converter, streaming, translator, stream, session 部分）

#![allow(clippy::all)]
//! - 主 crate 保留 Tauri 相关业务逻辑

// 抑制 objc crate 宏内部的 unexpected_cfgs 警告
// 该警告来自 cocoa/objc 依赖的 msg_send! 宏，是已知的 issue
#![allow(unexpected_cfgs)]

#[cfg(target_os = "linux")]
compile_error!("Lime 已暂停 Linux 桌面端支持，请使用 macOS 或 Windows 构建。");

// 从 providers crate 重新导出（保持 crate::xxx 路径兼容）
pub use lime_providers::providers;

// 从 core crate 重新导出（保持 crate::xxx 路径兼容）
pub use lime_core::connect;
pub use lime_core::content;
pub use lime_core::credential;
pub use lime_core::database;
pub use lime_core::memory;
pub use lime_core::session_files;
pub use lime_core::workspace;

// 从 infra crate 重新导出（保持 crate::xxx 路径兼容）
pub use lime_infra::{injection, resilience, telemetry};

// MCP 模块（从 lime-mcp crate 重新导出）
pub use lime_mcp as mcp;

// 核心模块（Tauri 相关业务逻辑）
pub mod agent;
pub mod agent_tools;
pub mod app;
pub mod plugin;
pub mod sceneapp;
pub mod screenshot;
pub mod services;
pub mod skills;
pub mod terminal;
pub mod tray;
pub mod voice;

// 内部模块
mod commands;
mod config;
mod crash_reporting;
mod data;
#[cfg(debug_assertions)]
#[allow(dead_code)]
mod dev_bridge;
mod logger;
mod profiling;
mod theme;
mod workspace_support;
use lime_core::models;

// 测试模块
#[cfg(test)]
mod tests;

// 重新导出核心类型以保持向后兼容
pub use app::{AppState, LogState, ProviderType, TokenCacheServiceState, TrayManagerState};
pub use lime_services::provider_pool_service::ProviderPoolService;

// 重新导出 run 函数（main.rs 入口）
pub use app::run;
