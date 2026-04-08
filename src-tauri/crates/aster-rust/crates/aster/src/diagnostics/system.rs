//! 系统诊断检查
//!
//! 提供 CPU、内存、磁盘等系统资源检查

use super::checker::DiagnosticCheck;

/// 系统检查器
pub struct SystemChecker;

impl SystemChecker {
    /// 检查 CPU 负载
    #[cfg(unix)]
    pub fn check_cpu_load() -> DiagnosticCheck {
        // 获取 CPU 核心数
        let cores = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1);

        // 获取负载平均值
        #[cfg(target_os = "macos")]
        let load_result = std::process::Command::new("sysctl")
            .args(["-n", "vm.loadavg"])
            .output();

        #[cfg(target_os = "linux")]
        let load_result = std::fs::read_to_string("/proc/loadavg")
            .map(|s| std::process::Output {
                status: std::process::ExitStatus::default(),
                stdout: s.into_bytes(),
                stderr: Vec::new(),
            })
            .map_err(std::io::Error::other);

        match load_result {
            Ok(output) => {
                let load_str = String::from_utf8_lossy(&output.stdout);
                let load_1min: f64 = load_str
                    .split_whitespace()
                    .next()
                    .and_then(|s| s.trim_matches(|c| c == '{' || c == '}').parse().ok())
                    .unwrap_or(0.0);

                let load_per_core = load_1min / cores as f64;

                if load_per_core >= 2.0 {
                    DiagnosticCheck::warn(
                        "CPU 负载",
                        format!("负载较高: {:.2} ({} 核心)", load_1min, cores),
                    )
                    .with_details(format!("每核负载: {:.2}", load_per_core))
                    .with_fix("系统负载较高，性能可能受影响")
                } else {
                    DiagnosticCheck::pass(
                        "CPU 负载",
                        format!("负载: {:.2} ({} 核心)", load_1min, cores),
                    )
                }
            }
            Err(_) => DiagnosticCheck::warn("CPU 负载", "无法获取 CPU 负载"),
        }
    }

    #[cfg(not(unix))]
    pub fn check_cpu_load() -> DiagnosticCheck {
        let cores = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1);
        DiagnosticCheck::pass("CPU 负载", format!("{} 核心可用", cores))
    }

    /// 检查会话目录
    pub fn check_session_directory() -> DiagnosticCheck {
        let session_dir = dirs::data_dir()
            .map(|p| p.join("aster").join("sessions"))
            .unwrap_or_else(|| std::path::PathBuf::from("~/.aster/sessions"));

        if !session_dir.exists() {
            if std::fs::create_dir_all(&session_dir).is_ok() {
                return DiagnosticCheck::pass("会话目录", "目录已创建")
                    .with_details(format!("路径: {}", session_dir.display()));
            }
            return DiagnosticCheck::fail("会话目录", "无法创建会话目录")
                .with_fix(format!("请手动创建: {}", session_dir.display()));
        }

        // 统计会话文件
        let session_count = std::fs::read_dir(&session_dir)
            .map(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .filter(|e| {
                        e.path()
                            .extension()
                            .map(|ext| ext == "json" || ext == "jsonl")
                            .unwrap_or(false)
                    })
                    .count()
            })
            .unwrap_or(0);

        // 计算目录大小
        let total_size = Self::calculate_dir_size(&session_dir);
        let size_mb = total_size as f64 / (1024.0 * 1024.0);

        DiagnosticCheck::pass(
            "会话目录",
            format!("{} 个会话, {:.2} MB", session_count, size_mb),
        )
        .with_details(format!("路径: {}", session_dir.display()))
    }

    /// 检查缓存目录
    pub fn check_cache_directory() -> DiagnosticCheck {
        let cache_dir = dirs::cache_dir()
            .map(|p| p.join("aster"))
            .unwrap_or_else(|| std::path::PathBuf::from("~/.cache/aster"));

        if !cache_dir.exists() {
            return DiagnosticCheck::pass("缓存目录", "无缓存目录（将按需创建）");
        }

        let total_size = Self::calculate_dir_size(&cache_dir);
        let size_mb = total_size as f64 / (1024.0 * 1024.0);

        if size_mb > 500.0 {
            DiagnosticCheck::warn("缓存目录", format!("缓存较大: {:.2} MB", size_mb))
                .with_details(format!("路径: {}", cache_dir.display()))
                .with_fix(format!("考虑清理缓存: rm -rf {}", cache_dir.display()))
        } else {
            DiagnosticCheck::pass("缓存目录", format!("缓存: {:.2} MB", size_mb))
                .with_details(format!("路径: {}", cache_dir.display()))
        }
    }

    /// 计算目录大小
    fn calculate_dir_size(path: &std::path::Path) -> u64 {
        let mut size = 0u64;

        if let Ok(entries) = std::fs::read_dir(path) {
            for entry in entries.filter_map(|e| e.ok()) {
                let path = entry.path();
                if path.is_dir() {
                    size += Self::calculate_dir_size(&path);
                } else if let Ok(metadata) = path.metadata() {
                    size += metadata.len();
                }
            }
        }

        size
    }

    /// 检查 MCP 服务器配置
    pub fn check_mcp_servers() -> DiagnosticCheck {
        let mcp_config_paths = [
            dirs::config_dir()
                .map(|p| p.join("aster").join("mcp.json"))
                .unwrap_or_default(),
            std::env::current_dir()
                .map(|p| p.join(".aster").join("mcp.json"))
                .unwrap_or_default(),
        ];

        for config_path in &mcp_config_paths {
            if config_path.exists() {
                match std::fs::read_to_string(config_path) {
                    Ok(content) => match serde_json::from_str::<serde_json::Value>(&content) {
                        Ok(config) => {
                            let servers = config
                                .get("mcpServers")
                                .and_then(|s| s.as_object())
                                .map(|o| o.keys().cloned().collect::<Vec<_>>())
                                .unwrap_or_default();

                            if servers.is_empty() {
                                return DiagnosticCheck::pass("MCP 服务器", "未配置 MCP 服务器");
                            }

                            return DiagnosticCheck::pass(
                                "MCP 服务器",
                                format!("{} 个服务器: {}", servers.len(), servers.join(", ")),
                            );
                        }
                        Err(e) => {
                            return DiagnosticCheck::warn("MCP 服务器", "MCP 配置格式错误")
                                .with_details(e.to_string());
                        }
                    },
                    Err(e) => {
                        return DiagnosticCheck::warn("MCP 服务器", "无法读取 MCP 配置")
                            .with_details(e.to_string());
                    }
                }
            }
        }

        DiagnosticCheck::pass("MCP 服务器", "未配置 MCP 服务器")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics::checker::CheckStatus;

    #[test]
    fn test_check_cpu_load() {
        let result = SystemChecker::check_cpu_load();
        // 应该返回有效结果
        assert!(result.status == CheckStatus::Pass || result.status == CheckStatus::Warn);
        assert!(result.name == "CPU 负载");
    }

    #[test]
    fn test_check_session_directory() {
        let result = SystemChecker::check_session_directory();
        // 应该能创建或已存在
        assert!(result.status == CheckStatus::Pass || result.status == CheckStatus::Fail);
    }

    #[test]
    fn test_check_cache_directory() {
        let result = SystemChecker::check_cache_directory();
        // 缓存目录检查应该通过或警告
        assert!(result.status == CheckStatus::Pass || result.status == CheckStatus::Warn);
    }

    #[test]
    fn test_check_mcp_servers() {
        let result = SystemChecker::check_mcp_servers();
        // MCP 配置检查应该返回有效结果
        assert!(result.status == CheckStatus::Pass || result.status == CheckStatus::Warn);
    }

    #[test]
    fn test_calculate_dir_size() {
        let temp_dir = std::env::temp_dir();
        let size = SystemChecker::calculate_dir_size(&temp_dir);
        // 临时目录应该存在且可访问（size 是 u64，总是 >= 0）
        // 这里只验证函数能正常执行
        let _ = size;
    }

    #[test]
    fn test_calculate_dir_size_nonexistent() {
        let path = std::path::Path::new("/nonexistent/path/12345");
        let size = SystemChecker::calculate_dir_size(path);
        assert_eq!(size, 0);
    }
}
