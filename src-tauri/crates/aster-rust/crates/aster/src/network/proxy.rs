//! 代理配置和支持
//!
//! 支持 HTTP/HTTPS/SOCKS 代理

use serde::{Deserialize, Serialize};
use std::env;
use url::Url;

/// 代理配置
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProxyConfig {
    /// HTTP 代理 URL
    #[serde(default)]
    pub http: Option<String>,
    /// HTTPS 代理 URL
    #[serde(default)]
    pub https: Option<String>,
    /// SOCKS 代理 URL
    #[serde(default)]
    pub socks: Option<String>,
    /// 绕过代理的域名列表
    #[serde(default)]
    pub no_proxy: Vec<String>,
    /// 代理认证用户名
    #[serde(default)]
    pub username: Option<String>,
    /// 代理认证密码
    #[serde(default)]
    pub password: Option<String>,
    /// 是否使用系统代理设置
    #[serde(default = "default_use_system_proxy")]
    pub use_system_proxy: bool,
}

fn default_use_system_proxy() -> bool {
    true
}

/// 代理 Agent 选项
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProxyAgentOptions {
    /// 连接超时（毫秒）
    #[serde(default)]
    pub timeout: Option<u64>,
    /// 保持连接
    #[serde(default = "default_keep_alive")]
    pub keep_alive: bool,
    /// 最大 socket 数量
    #[serde(default)]
    pub max_sockets: Option<usize>,
    /// 最大空闲 socket 数量
    #[serde(default)]
    pub max_free_sockets: Option<usize>,
    /// SSL/TLS 验证
    #[serde(default = "default_reject_unauthorized")]
    pub reject_unauthorized: bool,
}

fn default_keep_alive() -> bool {
    true
}

fn default_reject_unauthorized() -> bool {
    true
}

/// 解析后的代理 URL
#[derive(Debug, Clone)]
pub struct ParsedProxyUrl {
    /// 代理 URL（不含认证信息）
    pub url: String,
    /// 用户名
    pub username: Option<String>,
    /// 密码
    pub password: Option<String>,
}

/// 代理信息
#[derive(Debug, Clone)]
pub struct ProxyInfo {
    /// 是否启用代理
    pub enabled: bool,
    /// 代理 URL
    pub proxy_url: Option<String>,
    /// 是否被绕过
    pub bypassed: bool,
}

/// 从环境变量读取代理配置
pub fn get_proxy_from_env() -> ProxyConfig {
    let no_proxy = env::var("NO_PROXY")
        .or_else(|_| env::var("no_proxy"))
        .map(|s| s.split(',').map(|s| s.trim().to_string()).collect())
        .unwrap_or_default();

    ProxyConfig {
        http: env::var("HTTP_PROXY")
            .or_else(|_| env::var("http_proxy"))
            .ok(),
        https: env::var("HTTPS_PROXY")
            .or_else(|_| env::var("https_proxy"))
            .ok(),
        socks: env::var("ALL_PROXY")
            .or_else(|_| env::var("all_proxy"))
            .or_else(|_| env::var("SOCKS_PROXY"))
            .or_else(|_| env::var("socks_proxy"))
            .ok(),
        no_proxy,
        username: None,
        password: None,
        use_system_proxy: true,
    }
}

/// 解析代理 URL，提取认证信息
pub fn parse_proxy_url(proxy_url: &str) -> ParsedProxyUrl {
    match Url::parse(proxy_url) {
        Ok(mut url) => {
            let username = if url.username().is_empty() {
                None
            } else {
                Some(url.username().to_string())
            };
            let password = url.password().map(|s| s.to_string());

            // 移除认证信息
            let _ = url.set_username("");
            let _ = url.set_password(None);

            ParsedProxyUrl {
                url: url.to_string(),
                username,
                password,
            }
        }
        Err(_) => ParsedProxyUrl {
            url: proxy_url.to_string(),
            username: None,
            password: None,
        },
    }
}

/// 检查 URL 是否应该绕过代理
pub fn should_bypass_proxy(target_url: &str, no_proxy: &[String]) -> bool {
    if no_proxy.is_empty() {
        return false;
    }

    let hostname = match Url::parse(target_url) {
        Ok(url) => match url.host_str() {
            Some(h) => h.to_string(),
            None => return false,
        },
        Err(_) => return false,
    };

    for pattern in no_proxy {
        if pattern.is_empty() {
            continue;
        }

        // 特殊值 "*" 表示绕过所有
        if pattern == "*" {
            return true;
        }

        // 完全匹配
        if hostname == *pattern {
            return true;
        }

        // 通配符匹配 (*.example.com)
        if let Some(domain) = pattern.strip_prefix("*.") {
            if hostname.ends_with(domain) {
                return true;
            }
        }

        // 后缀匹配 (.example.com)
        if pattern.starts_with('.') && hostname.ends_with(pattern) {
            return true;
        }
    }

    false
}

/// 获取目标 URL 的代理 URL
pub fn get_proxy_for_url(target_url: &str, config: &ProxyConfig) -> Option<String> {
    // 检查是否绕过代理
    if should_bypass_proxy(target_url, &config.no_proxy) {
        return None;
    }

    let is_https = target_url.starts_with("https://");

    // SOCKS 代理优先
    if let Some(ref socks) = config.socks {
        return Some(socks.clone());
    }

    // 根据目标协议选择代理
    if is_https {
        config.https.clone().or_else(|| config.http.clone())
    } else {
        config.http.clone().or_else(|| config.https.clone())
    }
}

/// 获取代理信息（用于调试）
pub fn get_proxy_info(target_url: &str, config: Option<&ProxyConfig>) -> ProxyInfo {
    let effective_config = match config {
        Some(c) => c.clone(),
        None => get_proxy_from_env(),
    };

    let bypassed = should_bypass_proxy(target_url, &effective_config.no_proxy);

    if bypassed {
        return ProxyInfo {
            enabled: false,
            proxy_url: None,
            bypassed: true,
        };
    }

    let proxy_url = get_proxy_for_url(target_url, &effective_config);

    ProxyInfo {
        enabled: proxy_url.is_some(),
        proxy_url,
        bypassed: false,
    }
}

/// 构建带认证的代理 URL
pub fn build_proxy_url_with_auth(
    proxy_url: &str,
    username: Option<&str>,
    password: Option<&str>,
) -> String {
    if username.is_none() || password.is_none() {
        return proxy_url.to_string();
    }

    match Url::parse(proxy_url) {
        Ok(mut url) => {
            if let Some(u) = username {
                let _ = url.set_username(u);
            }
            if let Some(p) = password {
                let _ = url.set_password(Some(p));
            }
            url.to_string()
        }
        Err(_) => proxy_url.to_string(),
    }
}

/// 获取 reqwest 代理配置
pub fn get_reqwest_proxy(config: Option<&ProxyConfig>) -> Option<reqwest::Proxy> {
    let effective_config = match config {
        Some(c) => c.clone(),
        None => get_proxy_from_env(),
    };

    // 优先使用 HTTPS 代理
    let proxy_url = effective_config
        .https
        .or(effective_config.http)
        .or(effective_config.socks)?;

    let parsed = parse_proxy_url(&proxy_url);
    let final_url = build_proxy_url_with_auth(
        &parsed.url,
        effective_config
            .username
            .as_deref()
            .or(parsed.username.as_deref()),
        effective_config
            .password
            .as_deref()
            .or(parsed.password.as_deref()),
    );

    reqwest::Proxy::all(&final_url).ok()
}
