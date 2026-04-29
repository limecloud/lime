//! 统一的 Provider 错误类型
//!
//! 提供统一的错误处理机制，区分可重试和不可重试错误，
//! 并提供用户友好的中文错误信息。

use std::error::Error;
use std::fmt;

/// Provider 统一错误类型
///
/// 根据 Requirements 8.3, 8.4 设计，区分临时错误和永久错误
#[derive(Debug, Clone)]
pub enum ProviderError {
    /// 网络错误（可重试）
    /// 包括连接超时、DNS 解析失败等
    NetworkError(String),

    /// 认证错误（需要重新配置认证信息）
    AuthenticationError(String),

    /// 配置错误（需要检查配置）
    /// 凭证文件格式错误、缺少必要字段等
    ConfigurationError(String),

    /// 限流错误（需要等待）
    /// API 调用频率超限
    RateLimitError(String),

    /// 服务器错误（临时问题，可重试）
    /// 5xx 错误
    ServerError(String),

    /// 请求错误（不可重试）
    /// 4xx 错误（除认证和限流外）
    RequestError(String),

    /// 解析错误（不可重试）
    /// JSON 解析失败、响应格式不符合预期
    ParseError(String),

    /// 未知错误
    Unknown(String),
}

impl ProviderError {
    /// 判断错误是否可重试
    ///
    /// 根据 Requirements 8.4，区分临时错误和永久错误
    pub fn is_retryable(&self) -> bool {
        matches!(
            self,
            ProviderError::NetworkError(_)
                | ProviderError::ServerError(_)
                | ProviderError::RateLimitError(_)
        )
    }

    /// 获取用户友好的中文错误信息
    ///
    /// 根据 Requirements 1.4, 8.3 提供清晰的错误提示
    pub fn user_friendly_message(&self) -> String {
        match self {
            ProviderError::NetworkError(msg) => {
                format!("网络连接失败，请检查网络设置后重试。详情：{msg}")
            }
            ProviderError::AuthenticationError(msg) => format!("认证失败，请检查配置。详情：{msg}"),
            ProviderError::ConfigurationError(msg) => {
                format!("配置错误，请检查凭证设置。详情：{msg}")
            }
            ProviderError::RateLimitError(msg) => {
                format!("请求过于频繁，请稍后重试。详情：{msg}")
            }
            ProviderError::ServerError(msg) => {
                format!("服务器暂时不可用，请稍后重试。详情：{msg}")
            }
            ProviderError::RequestError(msg) => {
                format!("请求失败。详情：{msg}")
            }
            ProviderError::ParseError(msg) => {
                format!("数据解析失败。详情：{msg}")
            }
            ProviderError::Unknown(msg) => {
                format!("发生未知错误。详情：{msg}")
            }
        }
    }

    /// 获取简短的错误描述
    pub fn short_message(&self) -> &str {
        match self {
            ProviderError::NetworkError(_) => "网络连接失败",
            ProviderError::AuthenticationError(_) => "认证失败",
            ProviderError::ConfigurationError(_) => "配置错误",
            ProviderError::RateLimitError(_) => "请求过于频繁",
            ProviderError::ServerError(_) => "服务器错误",
            ProviderError::RequestError(_) => "请求失败",
            ProviderError::ParseError(_) => "数据解析失败",
            ProviderError::Unknown(_) => "未知错误",
        }
    }

    /// 获取错误类型名称
    pub fn error_type(&self) -> &str {
        match self {
            ProviderError::NetworkError(_) => "NetworkError",
            ProviderError::AuthenticationError(_) => "AuthenticationError",
            ProviderError::ConfigurationError(_) => "ConfigurationError",
            ProviderError::RateLimitError(_) => "RateLimitError",
            ProviderError::ServerError(_) => "ServerError",
            ProviderError::RequestError(_) => "RequestError",
            ProviderError::ParseError(_) => "ParseError",
            ProviderError::Unknown(_) => "Unknown",
        }
    }

    /// 从 HTTP 状态码创建错误
    pub fn from_http_status(status: u16, body: &str) -> Self {
        match status {
            401 | 403 => ProviderError::AuthenticationError(format!(
                "HTTP {} - {}",
                status,
                truncate_message(body, 200)
            )),
            429 => ProviderError::RateLimitError(format!(
                "HTTP {} - {}",
                status,
                truncate_message(body, 200)
            )),
            400 | 404 | 405 | 422 => ProviderError::RequestError(format!(
                "HTTP {} - {}",
                status,
                truncate_message(body, 200)
            )),
            500..=599 => ProviderError::ServerError(format!(
                "HTTP {} - {}",
                status,
                truncate_message(body, 200)
            )),
            _ => {
                ProviderError::Unknown(format!("HTTP {} - {}", status, truncate_message(body, 200)))
            }
        }
    }

    /// 从 reqwest 错误创建
    pub fn from_reqwest_error(err: &reqwest::Error) -> Self {
        if err.is_timeout() {
            ProviderError::NetworkError("请求超时".to_string())
        } else if err.is_connect() {
            ProviderError::NetworkError("无法连接到服务器".to_string())
        } else if err.is_decode() {
            ProviderError::ParseError("响应解码失败".to_string())
        } else if let Some(status) = err.status() {
            ProviderError::from_http_status(status.as_u16(), &err.to_string())
        } else {
            ProviderError::NetworkError(err.to_string())
        }
    }
}

impl fmt::Display for ProviderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.user_friendly_message())
    }
}

impl Error for ProviderError {}

/// 从字符串创建 ProviderError
impl From<String> for ProviderError {
    fn from(msg: String) -> Self {
        // 尝试根据消息内容推断错误类型
        let lower = msg.to_lowercase();
        if lower.contains("network") || lower.contains("connect") || lower.contains("timeout") {
            ProviderError::NetworkError(msg)
        } else if lower.contains("auth") || lower.contains("unauthorized") || lower.contains("401")
        {
            ProviderError::AuthenticationError(msg)
        } else if lower.contains("rate") || lower.contains("limit") || lower.contains("429") {
            ProviderError::RateLimitError(msg)
        } else if lower.contains("500") || lower.contains("502") || lower.contains("503") {
            ProviderError::ServerError(msg)
        } else {
            ProviderError::Unknown(msg)
        }
    }
}

impl From<&str> for ProviderError {
    fn from(msg: &str) -> Self {
        ProviderError::from(msg.to_string())
    }
}

impl From<reqwest::Error> for ProviderError {
    fn from(err: reqwest::Error) -> Self {
        ProviderError::from_reqwest_error(&err)
    }
}

impl From<serde_json::Error> for ProviderError {
    fn from(err: serde_json::Error) -> Self {
        ProviderError::ParseError(err.to_string())
    }
}

impl From<std::io::Error> for ProviderError {
    fn from(err: std::io::Error) -> Self {
        match err.kind() {
            std::io::ErrorKind::NotFound => {
                ProviderError::ConfigurationError(format!("文件不存在: {err}"))
            }
            std::io::ErrorKind::PermissionDenied => {
                ProviderError::ConfigurationError(format!("权限不足: {err}"))
            }
            std::io::ErrorKind::ConnectionRefused
            | std::io::ErrorKind::ConnectionReset
            | std::io::ErrorKind::ConnectionAborted => ProviderError::NetworkError(err.to_string()),
            std::io::ErrorKind::TimedOut => ProviderError::NetworkError("连接超时".to_string()),
            _ => ProviderError::Unknown(err.to_string()),
        }
    }
}

/// 截断消息到指定长度
fn truncate_message(msg: &str, max_len: usize) -> String {
    if msg.len() <= max_len {
        msg.to_string()
    } else {
        format!("{}...", &msg[..max_len])
    }
}

/// 创建配置错误
pub fn create_config_error(message: &str) -> Box<dyn Error + Send + Sync> {
    Box::new(ProviderError::ConfigurationError(message.to_string()))
}

/// 创建认证错误
pub fn create_auth_error(message: &str) -> Box<dyn Error + Send + Sync> {
    Box::new(ProviderError::AuthenticationError(message.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_retryable() {
        assert!(ProviderError::NetworkError("test".to_string()).is_retryable());
        assert!(ProviderError::ServerError("test".to_string()).is_retryable());
        assert!(ProviderError::RateLimitError("test".to_string()).is_retryable());

        assert!(!ProviderError::AuthenticationError("test".to_string()).is_retryable());
        assert!(!ProviderError::ConfigurationError("test".to_string()).is_retryable());
        assert!(!ProviderError::RequestError("test".to_string()).is_retryable());
        assert!(!ProviderError::ParseError("test".to_string()).is_retryable());
    }

    #[test]
    fn test_from_http_status() {
        let err = ProviderError::from_http_status(401, "Unauthorized");
        assert!(matches!(err, ProviderError::AuthenticationError(_)));

        let err = ProviderError::from_http_status(429, "Too Many Requests");
        assert!(matches!(err, ProviderError::RateLimitError(_)));

        let err = ProviderError::from_http_status(500, "Internal Server Error");
        assert!(matches!(err, ProviderError::ServerError(_)));

        let err = ProviderError::from_http_status(400, "Bad Request");
        assert!(matches!(err, ProviderError::RequestError(_)));
    }

    #[test]
    fn test_user_friendly_message() {
        let err = ProviderError::NetworkError("connection refused".to_string());
        let msg = err.user_friendly_message();
        assert!(msg.contains("网络连接失败"));
        assert!(msg.contains("connection refused"));

        let err = ProviderError::AuthenticationError("invalid token".to_string());
        let msg = err.user_friendly_message();
        assert!(msg.contains("认证失败"));
        assert!(msg.contains("检查配置"));
    }

    #[test]
    fn test_from_string() {
        let err = ProviderError::from("network error".to_string());
        assert!(matches!(err, ProviderError::NetworkError(_)));

        let err = ProviderError::from("unauthorized access".to_string());
        assert!(matches!(err, ProviderError::AuthenticationError(_)));

        let err = ProviderError::from("rate limit exceeded".to_string());
        assert!(matches!(err, ProviderError::RateLimitError(_)));

        let err = ProviderError::from("some random error".to_string());
        assert!(matches!(err, ProviderError::Unknown(_)));
    }

    #[test]
    fn test_error_type() {
        assert_eq!(
            ProviderError::NetworkError("".to_string()).error_type(),
            "NetworkError"
        );
        assert_eq!(
            ProviderError::AuthenticationError("".to_string()).error_type(),
            "AuthenticationError"
        );
    }

    #[test]
    fn test_truncate_message() {
        assert_eq!(truncate_message("short", 10), "short");
        assert_eq!(
            truncate_message("this is a long message", 10),
            "this is a ..."
        );
    }
}
