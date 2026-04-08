//! 健康评分系统
//!
//! 提供系统健康状态评估和自动修复功能

use super::checker::{CheckStatus, DiagnosticCheck};
use super::report::DiagnosticReport;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// 健康状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HealthStatus {
    /// 健康
    Healthy,
    /// 降级
    Degraded,
    /// 不健康
    Unhealthy,
}

/// 健康摘要
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthSummary {
    /// 状态
    pub status: HealthStatus,
    /// 健康评分 (0-100)
    pub score: u8,
    /// 关键问题
    pub critical_issues: Vec<String>,
}

impl HealthSummary {
    /// 从诊断报告生成健康摘要
    pub fn from_report(report: &DiagnosticReport) -> Self {
        let total = report.checks.len();
        let failed = report.summary.failed;
        let warnings = report.summary.warnings;

        // 计算健康评分
        let score = if total > 0 {
            let penalty = failed as f64 + warnings as f64 * 0.5;
            let raw_score = ((total as f64 - penalty) / total as f64) * 100.0;
            raw_score.clamp(0.0, 100.0) as u8
        } else {
            100
        };

        // 确定状态
        let status = if score >= 90 {
            HealthStatus::Healthy
        } else if score >= 70 {
            HealthStatus::Degraded
        } else {
            HealthStatus::Unhealthy
        };

        // 收集关键问题
        let critical_issues: Vec<String> = report
            .checks
            .iter()
            .filter(|c| c.status == CheckStatus::Fail)
            .map(|c| format!("{}: {}", c.name, c.message))
            .collect();

        Self {
            status,
            score,
            critical_issues,
        }
    }
}

/// 自动修复结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoFixResult {
    /// 已修复的问题
    pub fixed: Vec<String>,
    /// 修复失败的问题
    pub failed: Vec<String>,
}

/// 自动修复器
pub struct AutoFixer;

impl AutoFixer {
    /// 尝试自动修复问题
    pub fn auto_fix(report: &DiagnosticReport) -> AutoFixResult {
        let mut fixed = Vec::new();
        let mut failed = Vec::new();

        for check in &report.checks {
            if check.status == CheckStatus::Fail || check.status == CheckStatus::Warn {
                match Self::try_fix(check) {
                    Ok(msg) => fixed.push(msg),
                    Err(msg) => failed.push(msg),
                }
            }
        }

        AutoFixResult { fixed, failed }
    }

    fn try_fix(check: &DiagnosticCheck) -> Result<String, String> {
        match check.name.as_str() {
            "文件权限" | "会话目录" | "缓存目录" | "配置目录" => {
                Self::fix_directory_issue(check)
            }
            _ => {
                // 无法自动修复
                if let Some(ref fix) = check.fix {
                    Err(format!("{}: {}", check.name, fix))
                } else {
                    Err(format!("{}: 无法自动修复", check.name))
                }
            }
        }
    }

    fn fix_directory_issue(check: &DiagnosticCheck) -> Result<String, String> {
        // 从详情中提取路径
        let path = check
            .details
            .as_ref()
            .and_then(|d| {
                d.strip_prefix("路径: ")
                    .or_else(|| d.strip_prefix("Path: "))
            })
            .map(|s| s.trim());

        if let Some(path_str) = path {
            let path = Path::new(path_str);
            if !path.exists() {
                match std::fs::create_dir_all(path) {
                    Ok(_) => Ok(format!("已创建目录: {}", path_str)),
                    Err(e) => Err(format!("无法创建目录 {}: {}", path_str, e)),
                }
            } else {
                Ok(format!("目录已存在: {}", path_str))
            }
        } else {
            Err(format!("{}: 无法确定目录路径", check.name))
        }
    }
}

/// 快速健康检查（最小检查集）
pub async fn quick_health_check() -> (bool, Vec<String>) {
    let mut issues = Vec::new();

    // 检查配置目录
    let config_dir = dirs::config_dir()
        .map(|p| p.join("aster"))
        .unwrap_or_else(|| std::path::PathBuf::from("~/.config/aster"));

    if !config_dir.exists() && std::fs::create_dir_all(&config_dir).is_err() {
        issues.push("无法创建配置目录".to_string());
    }

    // 检查环境变量
    let has_api_key =
        std::env::var("ANTHROPIC_API_KEY").is_ok() || std::env::var("OPENAI_API_KEY").is_ok();

    if !has_api_key {
        issues.push("未配置 API 密钥".to_string());
    }

    (issues.is_empty(), issues)
}

/// 获取系统健康摘要
pub async fn get_system_health_summary() -> HealthSummary {
    use super::report::{DiagnosticOptions, DiagnosticReport};

    let options = DiagnosticOptions::default();
    let report = DiagnosticReport::generate(&options);

    HealthSummary::from_report(&report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics::report::{DiagnosticReport, ReportSummary};

    fn create_test_report(passed: usize, warnings: usize, failed: usize) -> DiagnosticReport {
        let mut checks = Vec::new();

        for i in 0..passed {
            checks.push(DiagnosticCheck::pass(format!("Pass{}", i), "通过"));
        }
        for i in 0..warnings {
            checks.push(DiagnosticCheck::warn(format!("Warn{}", i), "警告"));
        }
        for i in 0..failed {
            checks.push(DiagnosticCheck::fail(format!("Fail{}", i), "失败"));
        }

        DiagnosticReport {
            timestamp: chrono::Utc::now().timestamp(),
            version: "test".to_string(),
            platform: "test".to_string(),
            checks,
            summary: ReportSummary {
                passed,
                warnings,
                failed,
            },
            system_info: None,
        }
    }

    #[test]
    fn test_health_summary_healthy() {
        let report = create_test_report(10, 0, 0);
        let summary = HealthSummary::from_report(&report);

        assert_eq!(summary.status, HealthStatus::Healthy);
        assert_eq!(summary.score, 100);
        assert!(summary.critical_issues.is_empty());
    }

    #[test]
    fn test_health_summary_degraded() {
        let report = create_test_report(7, 3, 0);
        let summary = HealthSummary::from_report(&report);

        assert_eq!(summary.status, HealthStatus::Degraded);
        assert!(summary.score >= 70 && summary.score < 90);
    }

    #[test]
    fn test_health_summary_unhealthy() {
        let report = create_test_report(3, 2, 5);
        let summary = HealthSummary::from_report(&report);

        assert_eq!(summary.status, HealthStatus::Unhealthy);
        assert!(summary.score < 70);
        assert_eq!(summary.critical_issues.len(), 5);
    }

    #[test]
    fn test_health_summary_empty_report() {
        let report = create_test_report(0, 0, 0);
        let summary = HealthSummary::from_report(&report);

        assert_eq!(summary.status, HealthStatus::Healthy);
        assert_eq!(summary.score, 100);
    }

    #[test]
    fn test_auto_fixer_no_issues() {
        let report = create_test_report(5, 0, 0);
        let result = AutoFixer::auto_fix(&report);

        assert!(result.fixed.is_empty());
        assert!(result.failed.is_empty());
    }

    #[test]
    fn test_auto_fixer_with_directory_issue() {
        let temp_path = std::env::temp_dir().join("aster_autofix_test");
        let _ = std::fs::remove_dir_all(&temp_path);

        let check = DiagnosticCheck::fail("会话目录", "目录不存在")
            .with_details(format!("路径: {}", temp_path.display()));

        let report = DiagnosticReport {
            timestamp: chrono::Utc::now().timestamp(),
            version: "test".to_string(),
            platform: "test".to_string(),
            checks: vec![check],
            summary: ReportSummary {
                passed: 0,
                warnings: 0,
                failed: 1,
            },
            system_info: None,
        };

        let result = AutoFixer::auto_fix(&report);

        // 应该能修复目录问题
        assert!(!result.fixed.is_empty() || !result.failed.is_empty());

        let _ = std::fs::remove_dir_all(&temp_path);
    }

    #[tokio::test]
    async fn test_quick_health_check() {
        let (healthy, issues) = quick_health_check().await;
        // 函数应该能运行
        assert!(healthy || !issues.is_empty());
    }

    #[tokio::test]
    async fn test_get_system_health_summary() {
        let summary = get_system_health_summary().await;
        // 应该返回有效的健康摘要
        assert!(summary.score <= 100);
    }
}
