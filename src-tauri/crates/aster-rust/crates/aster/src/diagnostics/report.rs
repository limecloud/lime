//! 诊断报告
//!
//! 生成和格式化诊断报告

use super::checker::{run_diagnostics, CheckStatus, DiagnosticCheck};
use serde::{Deserialize, Serialize};

/// 诊断选项
#[derive(Debug, Clone, Default)]
pub struct DiagnosticOptions {
    /// 详细模式
    pub verbose: bool,
    /// JSON 输出
    pub json: bool,
    /// 自动修复
    pub fix: bool,
}

/// 系统信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInfo {
    /// 内存信息
    pub memory: MemoryInfo,
    /// CPU 信息
    pub cpu: CpuInfo,
}

/// 内存信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryInfo {
    pub total: String,
    pub free: String,
    pub used: String,
    pub percent_used: f64,
}

/// CPU 信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpuInfo {
    pub model: String,
    pub cores: usize,
    pub load_average: Vec<f64>,
}

/// 诊断报告
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticReport {
    /// 时间戳
    pub timestamp: i64,
    /// 版本
    pub version: String,
    /// 平台
    pub platform: String,
    /// 检查结果
    pub checks: Vec<DiagnosticCheck>,
    /// 摘要
    pub summary: ReportSummary,
    /// 系统信息（详细模式）
    pub system_info: Option<SystemInfo>,
}

/// 报告摘要
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportSummary {
    pub passed: usize,
    pub warnings: usize,
    pub failed: usize,
}

impl DiagnosticReport {
    /// 生成诊断报告
    pub fn generate(options: &DiagnosticOptions) -> Self {
        let checks = run_diagnostics();

        let summary = ReportSummary {
            passed: checks
                .iter()
                .filter(|c| c.status == CheckStatus::Pass)
                .count(),
            warnings: checks
                .iter()
                .filter(|c| c.status == CheckStatus::Warn)
                .count(),
            failed: checks
                .iter()
                .filter(|c| c.status == CheckStatus::Fail)
                .count(),
        };

        let system_info = if options.verbose {
            Some(Self::collect_system_info())
        } else {
            None
        };

        Self {
            timestamp: chrono::Utc::now().timestamp(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            platform: format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
            checks,
            summary,
            system_info,
        }
    }

    fn collect_system_info() -> SystemInfo {
        SystemInfo {
            memory: MemoryInfo {
                total: "未知".to_string(),
                free: "未知".to_string(),
                used: "未知".to_string(),
                percent_used: 0.0,
            },
            cpu: CpuInfo {
                model: "未知".to_string(),
                cores: std::thread::available_parallelism()
                    .map(|n| n.get())
                    .unwrap_or(1),
                load_average: vec![0.0, 0.0, 0.0],
            },
        }
    }
}

/// 格式化诊断报告
pub fn format_diagnostic_report(report: &DiagnosticReport, options: &DiagnosticOptions) -> String {
    if options.json {
        return serde_json::to_string_pretty(report).unwrap_or_default();
    }

    let mut lines = Vec::new();

    lines.push("╭─────────────────────────────────────────────╮".to_string());
    lines.push("│           Aster 诊断报告                    │".to_string());
    lines.push("╰─────────────────────────────────────────────╯".to_string());
    lines.push(String::new());
    lines.push(format!("  版本:   {}", report.version));
    lines.push(format!("  平台:   {}", report.platform));

    if let Some(ref sys_info) = report.system_info {
        lines.push(String::new());
        lines.push("  系统信息:".to_string());
        lines.push(format!("    CPU 核心: {}", sys_info.cpu.cores));
    }

    lines.push(String::new());
    lines.push("─────────────────────────────────────────────".to_string());
    lines.push(String::new());

    for check in &report.checks {
        let icon = match check.status {
            CheckStatus::Pass => "✓",
            CheckStatus::Warn => "⚠",
            CheckStatus::Fail => "✗",
        };
        lines.push(format!("  {} {}: {}", icon, check.name, check.message));

        if options.verbose {
            if let Some(ref details) = check.details {
                lines.push(format!("    └─ {}", details));
            }
            if let Some(ref fix) = check.fix {
                lines.push(format!("    💡 修复: {}", fix));
            }
        }
    }

    lines.push(String::new());
    lines.push("─────────────────────────────────────────────".to_string());
    lines.push(String::new());
    lines.push(format!(
        "  摘要: {} 通过, {} 警告, {} 失败",
        report.summary.passed, report.summary.warnings, report.summary.failed
    ));
    lines.push(String::new());

    lines.join("\n")
}
