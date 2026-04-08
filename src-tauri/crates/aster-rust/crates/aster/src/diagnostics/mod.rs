//! 诊断和健康检查系统
//!
//! 提供系统健康检查、故障排除功能
//!
//! ## 功能
//! - 环境检查（Git, Ripgrep 等）
//! - 系统资源检查（CPU, 内存, 磁盘）
//! - 网络检查（API 连通性, 代理配置）
//! - 配置检查（MCP, 会话目录, 缓存）
//! - 健康评分和自动修复

mod checker;
mod health;
mod network;
mod report;
mod system;

pub use checker::{run_diagnostics, CheckStatus, DiagnosticCheck, DiagnosticChecker};
pub use health::{
    get_system_health_summary, quick_health_check, AutoFixResult, AutoFixer, HealthStatus,
    HealthSummary,
};
pub use network::NetworkChecker;
pub use report::{format_diagnostic_report, DiagnosticOptions, DiagnosticReport, SystemInfo};
pub use system::SystemChecker;
