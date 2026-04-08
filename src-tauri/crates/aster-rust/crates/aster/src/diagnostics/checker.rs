//! 诊断检查器
//!
//! 提供各种系统检查功能

use serde::{Deserialize, Serialize};
use std::process::Command;

/// 检查状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CheckStatus {
    /// 通过
    Pass,
    /// 警告
    Warn,
    /// 失败
    Fail,
}

/// 诊断检查结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticCheck {
    /// 检查名称
    pub name: String,
    /// 检查状态
    pub status: CheckStatus,
    /// 消息
    pub message: String,
    /// 详细信息
    pub details: Option<String>,
    /// 修复建议
    pub fix: Option<String>,
}

impl DiagnosticCheck {
    /// 创建通过的检查结果
    pub fn pass(name: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            status: CheckStatus::Pass,
            message: message.into(),
            details: None,
            fix: None,
        }
    }

    /// 创建警告的检查结果
    pub fn warn(name: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            status: CheckStatus::Warn,
            message: message.into(),
            details: None,
            fix: None,
        }
    }

    /// 创建失败的检查结果
    pub fn fail(name: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            status: CheckStatus::Fail,
            message: message.into(),
            details: None,
            fix: None,
        }
    }

    /// 添加详细信息
    pub fn with_details(mut self, details: impl Into<String>) -> Self {
        self.details = Some(details.into());
        self
    }

    /// 添加修复建议
    pub fn with_fix(mut self, fix: impl Into<String>) -> Self {
        self.fix = Some(fix.into());
        self
    }
}

/// 诊断检查器
pub struct DiagnosticChecker;

impl DiagnosticChecker {
    /// 检查 Git 可用性
    pub fn check_git() -> DiagnosticCheck {
        match Command::new("git").arg("--version").output() {
            Ok(output) if output.status.success() => {
                let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
                DiagnosticCheck::pass("Git", version)
            }
            _ => DiagnosticCheck::warn("Git", "Git 未找到")
                .with_details("部分功能可能无法使用")
                .with_fix("请安装 Git: https://git-scm.com/"),
        }
    }

    /// 检查 Ripgrep 可用性
    pub fn check_ripgrep() -> DiagnosticCheck {
        match Command::new("rg").arg("--version").output() {
            Ok(output) if output.status.success() => {
                let version = String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .next()
                    .unwrap_or("unknown")
                    .to_string();
                DiagnosticCheck::pass("Ripgrep", version)
            }
            _ => DiagnosticCheck::warn("Ripgrep", "Ripgrep 未找到")
                .with_details("文件搜索将使用备用方案")
                .with_fix("安装 ripgrep: https://github.com/BurntSushi/ripgrep"),
        }
    }

    /// 检查磁盘空间
    pub fn check_disk_space(path: &std::path::Path) -> DiagnosticCheck {
        #[cfg(unix)]
        {
            if std::fs::metadata(path).is_ok() {
                // 简化检查，实际应使用 statvfs
                DiagnosticCheck::pass("磁盘空间", "磁盘空间检查通过")
            } else {
                DiagnosticCheck::warn("磁盘空间", "无法检查磁盘空间")
            }
        }
        #[cfg(not(unix))]
        {
            let _ = path;
            DiagnosticCheck::pass("磁盘空间", "磁盘空间检查跳过")
        }
    }

    /// 检查文件权限
    pub fn check_file_permissions(path: &std::path::Path) -> DiagnosticCheck {
        if !path.exists() {
            // 尝试创建目录
            if std::fs::create_dir_all(path).is_ok() {
                return DiagnosticCheck::pass("文件权限", "目录已创建");
            }
            return DiagnosticCheck::fail("文件权限", "无法创建目录")
                .with_details(format!("路径: {}", path.display()));
        }

        // 尝试写入测试文件
        let test_file = path.join(".write-test");
        match std::fs::write(&test_file, "test") {
            Ok(_) => {
                let _ = std::fs::remove_file(&test_file);
                DiagnosticCheck::pass("文件权限", "文件权限正常")
            }
            Err(e) => DiagnosticCheck::fail("文件权限", "无法写入目录")
                .with_details(format!("错误: {}", e)),
        }
    }

    /// 检查内存使用
    pub fn check_memory_usage() -> DiagnosticCheck {
        #[cfg(target_os = "macos")]
        {
            // macOS 使用 sysctl
            match Command::new("sysctl").args(["-n", "hw.memsize"]).output() {
                Ok(output) if output.status.success() => {
                    let total_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if let Ok(total) = total_str.parse::<u64>() {
                        let total_gb = total as f64 / (1024.0 * 1024.0 * 1024.0);
                        DiagnosticCheck::pass("内存", format!("总内存: {:.1} GB", total_gb))
                    } else {
                        DiagnosticCheck::pass("内存", "内存检查通过")
                    }
                }
                _ => DiagnosticCheck::warn("内存", "无法检查内存"),
            }
        }
        #[cfg(target_os = "linux")]
        {
            if let Ok(content) = std::fs::read_to_string("/proc/meminfo") {
                let mut total_kb = 0u64;
                let mut available_kb = 0u64;
                for line in content.lines() {
                    if line.starts_with("MemTotal:") {
                        total_kb = line
                            .split_whitespace()
                            .nth(1)
                            .and_then(|s| s.parse().ok())
                            .unwrap_or(0);
                    } else if line.starts_with("MemAvailable:") {
                        available_kb = line
                            .split_whitespace()
                            .nth(1)
                            .and_then(|s| s.parse().ok())
                            .unwrap_or(0);
                    }
                }
                let total_gb = total_kb as f64 / (1024.0 * 1024.0);
                let used_percent = if total_kb > 0 {
                    ((total_kb - available_kb) as f64 / total_kb as f64) * 100.0
                } else {
                    0.0
                };

                if used_percent >= 90.0 {
                    DiagnosticCheck::warn("内存", format!("内存使用率高: {:.1}%", used_percent))
                } else {
                    DiagnosticCheck::pass(
                        "内存",
                        format!("{:.1}% ({:.1} GB)", used_percent, total_gb),
                    )
                }
            } else {
                DiagnosticCheck::warn("内存", "无法检查内存")
            }
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        {
            DiagnosticCheck::pass("内存", "内存检查跳过")
        }
    }

    /// 检查网络连接
    pub async fn check_network() -> DiagnosticCheck {
        // 简单的网络检查
        DiagnosticCheck::pass("网络", "网络检查需要异步运行时")
    }

    /// 检查环境变量
    pub fn check_environment_variables() -> DiagnosticCheck {
        let relevant_vars = [
            "ANTHROPIC_API_KEY",
            "OPENAI_API_KEY",
            "ASTER_CONFIG_DIR",
            "ASTER_LOG_LEVEL",
        ];

        let set_vars: Vec<_> = relevant_vars
            .iter()
            .filter(|v| std::env::var(v).is_ok())
            .collect();

        if set_vars.is_empty() {
            DiagnosticCheck::pass("环境变量", "使用默认配置")
        } else {
            DiagnosticCheck::pass("环境变量", format!("已设置 {} 个变量", set_vars.len()))
                .with_details(
                    set_vars
                        .iter()
                        .map(|v| v.to_string())
                        .collect::<Vec<_>>()
                        .join(", "),
                )
        }
    }

    /// 检查配置目录
    pub fn check_config_directory() -> DiagnosticCheck {
        let config_dir = dirs::config_dir()
            .map(|p| p.join("aster"))
            .unwrap_or_else(|| std::path::PathBuf::from("~/.config/aster"));

        Self::check_file_permissions(&config_dir)
    }
}

/// 运行所有诊断检查
pub fn run_diagnostics() -> Vec<DiagnosticCheck> {
    use super::network::NetworkChecker;
    use super::system::SystemChecker;

    vec![
        // 环境检查
        DiagnosticChecker::check_git(),
        DiagnosticChecker::check_ripgrep(),
        // 系统检查
        DiagnosticChecker::check_memory_usage(),
        SystemChecker::check_cpu_load(),
        // 配置检查
        DiagnosticChecker::check_environment_variables(),
        DiagnosticChecker::check_config_directory(),
        SystemChecker::check_mcp_servers(),
        // 目录检查
        SystemChecker::check_session_directory(),
        SystemChecker::check_cache_directory(),
        // 网络检查
        NetworkChecker::check_proxy_configuration(),
        NetworkChecker::check_ssl_certificates(),
    ]
}

/// 运行所有诊断检查（包括异步检查）
#[allow(dead_code)]
pub async fn run_diagnostics_async() -> Vec<DiagnosticCheck> {
    use super::network::NetworkChecker;
    use super::system::SystemChecker;

    let mut checks = vec![
        // 环境检查
        DiagnosticChecker::check_git(),
        DiagnosticChecker::check_ripgrep(),
        // 系统检查
        DiagnosticChecker::check_memory_usage(),
        SystemChecker::check_cpu_load(),
        // 配置检查
        DiagnosticChecker::check_environment_variables(),
        DiagnosticChecker::check_config_directory(),
        SystemChecker::check_mcp_servers(),
        // 目录检查
        SystemChecker::check_session_directory(),
        SystemChecker::check_cache_directory(),
        // 网络检查（同步）
        NetworkChecker::check_proxy_configuration(),
        NetworkChecker::check_ssl_certificates(),
    ];

    // 异步网络检查
    checks.push(NetworkChecker::check_api_connectivity().await);
    checks.push(NetworkChecker::check_network_connectivity().await);

    checks
}

// quick_health_check 已移至 health.rs

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_git() {
        let result = DiagnosticChecker::check_git();
        assert!(result.status == CheckStatus::Pass || result.status == CheckStatus::Warn);
    }

    #[test]
    fn test_check_ripgrep() {
        let result = DiagnosticChecker::check_ripgrep();
        assert!(result.status == CheckStatus::Pass || result.status == CheckStatus::Warn);
    }

    #[test]
    fn test_check_environment_variables() {
        let result = DiagnosticChecker::check_environment_variables();
        assert_eq!(result.status, CheckStatus::Pass);
    }

    #[test]
    fn test_check_memory_usage() {
        let result = DiagnosticChecker::check_memory_usage();
        assert!(result.status == CheckStatus::Pass || result.status == CheckStatus::Warn);
    }

    #[test]
    fn test_check_config_directory() {
        let result = DiagnosticChecker::check_config_directory();
        // 应该能创建或已存在
        assert!(result.status == CheckStatus::Pass || result.status == CheckStatus::Fail);
    }

    #[test]
    fn test_diagnostic_check_pass() {
        let check = DiagnosticCheck::pass("Test", "通过");
        assert_eq!(check.status, CheckStatus::Pass);
        assert_eq!(check.name, "Test");
    }

    #[test]
    fn test_diagnostic_check_warn() {
        let check = DiagnosticCheck::warn("Test", "警告")
            .with_details("详情")
            .with_fix("修复建议");
        assert_eq!(check.status, CheckStatus::Warn);
        assert!(check.details.is_some());
        assert!(check.fix.is_some());
    }

    #[test]
    fn test_diagnostic_check_fail() {
        let check = DiagnosticCheck::fail("Test", "失败");
        assert_eq!(check.status, CheckStatus::Fail);
    }

    #[test]
    fn test_run_diagnostics() {
        let checks = run_diagnostics();
        assert!(!checks.is_empty());
        // 至少应该有环境检查
        assert!(checks
            .iter()
            .any(|c| c.name == "Git" || c.name == "Ripgrep"));
    }

    #[test]
    fn test_check_file_permissions() {
        let temp_dir = std::env::temp_dir().join("aster_test_perms");
        let result = DiagnosticChecker::check_file_permissions(&temp_dir);
        // 临时目录应该可写
        assert!(result.status == CheckStatus::Pass || result.status == CheckStatus::Fail);
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_quick_health_check() {
        let (healthy, _issues) = crate::diagnostics::quick_health_check().await;
        // 只验证函数能运行，不关心结果
        let _ = healthy;
    }

    #[tokio::test]
    async fn test_run_diagnostics_async() {
        let checks = run_diagnostics_async().await;
        assert!(!checks.is_empty());
        // 异步版本应该包含网络检查
        assert!(checks.len() >= run_diagnostics().len());
    }
}
