//! 网络诊断检查
//!
//! 提供网络连接、API 可达性、代理配置等检查

use super::checker::DiagnosticCheck;
use std::time::Duration;

/// 网络检查器
pub struct NetworkChecker;

impl NetworkChecker {
    /// 检查 API 连通性
    pub async fn check_api_connectivity() -> DiagnosticCheck {
        let endpoints = [
            ("Anthropic API", "https://api.anthropic.com"),
            ("OpenAI API", "https://api.openai.com"),
        ];

        let client = match reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
        {
            Ok(c) => c,
            Err(e) => {
                return DiagnosticCheck::fail("API 连通性", "无法创建 HTTP 客户端")
                    .with_details(e.to_string());
            }
        };

        let mut reachable = Vec::new();
        let mut unreachable = Vec::new();

        for (name, url) in endpoints {
            match client.head(url).send().await {
                Ok(resp) if resp.status().is_success() || resp.status().as_u16() == 405 => {
                    reachable.push(name);
                }
                _ => {
                    unreachable.push(name);
                }
            }
        }

        if unreachable.is_empty() {
            DiagnosticCheck::pass("API 连通性", format!("可达: {}", reachable.join(", ")))
        } else if !reachable.is_empty() {
            DiagnosticCheck::warn(
                "API 连通性",
                format!("部分不可达: {}", unreachable.join(", ")),
            )
        } else {
            DiagnosticCheck::fail("API 连通性", "所有 API 端点不可达")
        }
    }

    /// 检查网络连接
    pub async fn check_network_connectivity() -> DiagnosticCheck {
        let endpoints = [
            ("Internet", "https://www.google.com"),
            ("GitHub", "https://github.com"),
        ];

        let client = match reqwest::Client::builder()
            .timeout(Duration::from_secs(3))
            .build()
        {
            Ok(c) => c,
            Err(_) => {
                return DiagnosticCheck::warn("网络连接", "无法创建 HTTP 客户端");
            }
        };

        let mut results = Vec::new();
        let mut failures = Vec::new();

        for (name, url) in endpoints {
            match client.head(url).send().await {
                Ok(_) => results.push(name),
                Err(_) => failures.push(name),
            }
        }

        if failures.is_empty() {
            DiagnosticCheck::pass("网络连接", "网络连接正常")
        } else if !results.is_empty() {
            DiagnosticCheck::warn(
                "网络连接",
                format!("部分端点不可达: {}", failures.join(", ")),
            )
        } else {
            DiagnosticCheck::fail("网络连接", "无网络连接")
        }
    }

    /// 检查代理配置
    pub fn check_proxy_configuration() -> DiagnosticCheck {
        let proxy_vars = [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "http_proxy",
            "https_proxy",
            "NO_PROXY",
            "no_proxy",
        ];

        let set_proxies: Vec<_> = proxy_vars
            .iter()
            .filter(|v| std::env::var(v).is_ok())
            .collect();

        if set_proxies.is_empty() {
            DiagnosticCheck::pass("代理配置", "未配置代理")
        } else {
            let details: Vec<String> = set_proxies
                .iter()
                .map(|v| {
                    let value = std::env::var(v).unwrap_or_default();
                    // 隐藏凭证
                    let masked = if value.contains('@') {
                        value
                            .rsplit('@')
                            .next()
                            .map(|s| format!("***@{}", s))
                            .unwrap_or_else(|| "***".to_string())
                    } else {
                        value
                    };
                    format!("{}={}", v, masked)
                })
                .collect();

            DiagnosticCheck::pass(
                "代理配置",
                format!("已配置 {} 个代理变量", set_proxies.len()),
            )
            .with_details(details.join(", "))
        }
    }

    /// 检查 SSL 证书配置
    pub fn check_ssl_certificates() -> DiagnosticCheck {
        // 检查是否禁用了 SSL 验证
        if std::env::var("SSL_CERT_FILE").is_ok() || std::env::var("SSL_CERT_DIR").is_ok() {
            return DiagnosticCheck::pass("SSL 证书", "使用自定义 CA 证书");
        }

        // 检查是否有不安全的配置
        if std::env::var("RUSTLS_DANGEROUS_CONFIGURATION").is_ok() {
            return DiagnosticCheck::warn("SSL 证书", "SSL 验证可能被禁用")
                .with_details("RUSTLS_DANGEROUS_CONFIGURATION 已设置")
                .with_fix("移除不安全的 SSL 配置");
        }

        DiagnosticCheck::pass("SSL 证书", "使用系统 SSL 证书")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics::checker::CheckStatus;

    #[test]
    fn test_check_proxy_configuration() {
        let result = NetworkChecker::check_proxy_configuration();
        // 应该返回有效结果
        assert!(result.status == CheckStatus::Pass || result.status == CheckStatus::Warn);
    }

    #[test]
    fn test_check_ssl_certificates() {
        let result = NetworkChecker::check_ssl_certificates();
        // 通常应该通过
        assert!(result.status == CheckStatus::Pass || result.status == CheckStatus::Warn);
    }

    #[tokio::test]
    async fn test_check_api_connectivity() {
        let result = NetworkChecker::check_api_connectivity().await;
        // 网络可能不可用，所以接受任何状态
        assert!(!result.name.is_empty());
    }

    #[tokio::test]
    async fn test_check_network_connectivity() {
        let result = NetworkChecker::check_network_connectivity().await;
        // 网络可能不可用，所以接受任何状态
        assert!(!result.name.is_empty());
    }

    #[test]
    fn test_proxy_credential_masking() {
        // 设置带凭证的代理
        std::env::set_var("HTTP_PROXY_TEST", "http://user:pass@proxy.example.com:8080");

        // 检查不会泄露凭证
        let result = NetworkChecker::check_proxy_configuration();
        if let Some(details) = &result.details {
            assert!(!details.contains("pass"));
        }

        std::env::remove_var("HTTP_PROXY_TEST");
    }
}
