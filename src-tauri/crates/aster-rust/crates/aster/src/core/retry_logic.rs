//! 上下文溢出自动恢复逻辑
//!
//! 解析上下文溢出错误，动态调整 max_tokens，自动重试

use regex::Regex;
use std::future::Future;
use thiserror::Error;

/// 最小输出 tokens
const MIN_OUTPUT_TOKENS: u64 = 3000;

/// 保留空间
const RESERVE_BUFFER: u64 = 1000;

/// 上下文溢出错误信息
#[derive(Debug, Clone)]
pub struct ContextOverflowError {
    /// 输入 tokens
    pub input_tokens: u64,
    /// 最大 tokens
    pub max_tokens: u64,
    /// 上下文限制
    pub context_limit: u64,
}

/// 溢出恢复错误
#[derive(Debug, Error)]
pub enum OverflowRecoveryError {
    #[error("Not a context overflow error")]
    NotOverflowError,
    #[error("Cannot recover: input={input_tokens}, limit={context_limit}")]
    CannotRecover {
        input_tokens: u64,
        context_limit: u64,
    },
    #[error("Max retries exceeded after {attempts} attempts")]
    MaxRetriesExceeded { attempts: u32 },
    #[error("Request failed: {0}")]
    RequestFailed(String),
}

/// 解析上下文溢出错误
///
/// 错误格式示例：
/// "input length and `max_tokens` exceed context limit: 195000 + 8192 > 200000"
pub fn parse_context_overflow_error(status: u16, message: &str) -> Option<ContextOverflowError> {
    // 检查是否为 400 错误
    if status != 400 {
        return None;
    }

    // 匹配错误消息模式
    let pattern =
        Regex::new(r"input length and `max_tokens` exceed context limit: (\d+) \+ (\d+) > (\d+)")
            .ok()?;

    let captures = pattern.captures(message)?;

    let input_tokens: u64 = captures.get(1)?.as_str().parse().ok()?;
    let max_tokens: u64 = captures.get(2)?.as_str().parse().ok()?;
    let context_limit: u64 = captures.get(3)?.as_str().parse().ok()?;

    Some(ContextOverflowError {
        input_tokens,
        max_tokens,
        context_limit,
    })
}

/// 计算调整后的 max_tokens
///
/// 策略：
/// 1. 计算可用空间 = contextLimit - inputTokens - reserve
/// 2. 如果可用空间 < MIN_OUTPUT_TOKENS，无法恢复
/// 3. 否则，返回 max(MIN_OUTPUT_TOKENS, available, thinkingTokens + 1)
pub fn calculate_adjusted_max_tokens(
    overflow: &ContextOverflowError,
    max_thinking_tokens: u64,
) -> Option<u64> {
    let available = overflow
        .context_limit
        .saturating_sub(overflow.input_tokens)
        .saturating_sub(RESERVE_BUFFER);

    // 如果可用空间不足最小要求，无法恢复
    if available < MIN_OUTPUT_TOKENS {
        return None;
    }

    // 计算调整后的值
    let thinking = max_thinking_tokens + 1;
    let adjusted = available.max(MIN_OUTPUT_TOKENS).max(thinking);

    Some(adjusted)
}

/// 处理上下文溢出错误
///
/// 返回调整后的 max_tokens，如果无法恢复则返回错误
pub fn handle_context_overflow(
    status: u16,
    message: &str,
    max_thinking_tokens: u64,
) -> Result<u64, OverflowRecoveryError> {
    let overflow = parse_context_overflow_error(status, message)
        .ok_or(OverflowRecoveryError::NotOverflowError)?;

    let adjusted = calculate_adjusted_max_tokens(&overflow, max_thinking_tokens).ok_or(
        OverflowRecoveryError::CannotRecover {
            input_tokens: overflow.input_tokens,
            context_limit: overflow.context_limit,
        },
    )?;

    tracing::warn!(
        "Context overflow detected. Adjusting max_tokens from {} to {}",
        overflow.max_tokens,
        adjusted
    );
    tracing::warn!(
        "  Input: {}, Limit: {}, Available: {}",
        overflow.input_tokens,
        overflow.context_limit,
        adjusted
    );

    Ok(adjusted)
}

/// 溢出恢复选项
#[derive(Debug, Clone)]
pub struct OverflowRecoveryOptions {
    /// 初始 max_tokens
    pub max_tokens: Option<u64>,
    /// 最大思考 tokens
    pub max_thinking_tokens: u64,
    /// 最大重试次数
    pub max_retries: u32,
}

impl Default for OverflowRecoveryOptions {
    fn default() -> Self {
        Self {
            max_tokens: None,
            max_thinking_tokens: 0,
            max_retries: 3,
        }
    }
}

/// 请求错误信息
pub struct RequestError {
    pub status: u16,
    pub message: String,
}

/// 执行带溢出恢复的请求
pub async fn execute_with_overflow_recovery<T, E, F, Fut>(
    execute_request: F,
    options: OverflowRecoveryOptions,
    mut on_retry: Option<impl FnMut(u32, u64)>,
) -> Result<T, OverflowRecoveryError>
where
    F: Fn(Option<u64>) -> Fut,
    Fut: Future<Output = Result<T, E>>,
    E: Into<RequestError>,
{
    let mut current_max_tokens = options.max_tokens;

    for attempt in 1..=options.max_retries {
        match execute_request(current_max_tokens).await {
            Ok(result) => return Ok(result),
            Err(error) => {
                let req_error: RequestError = error.into();

                let overflow =
                    match parse_context_overflow_error(req_error.status, &req_error.message) {
                        Some(o) => o,
                        None => {
                            return Err(OverflowRecoveryError::RequestFailed(req_error.message));
                        }
                    };

                if attempt >= options.max_retries {
                    tracing::error!(
                        "Context overflow recovery failed after {} attempts",
                        options.max_retries
                    );
                    return Err(OverflowRecoveryError::MaxRetriesExceeded { attempts: attempt });
                }

                let adjusted =
                    match calculate_adjusted_max_tokens(&overflow, options.max_thinking_tokens) {
                        Some(a) => a,
                        None => {
                            return Err(OverflowRecoveryError::CannotRecover {
                                input_tokens: overflow.input_tokens,
                                context_limit: overflow.context_limit,
                            });
                        }
                    };

                tracing::warn!(
                    "[Retry {}/{}] Context overflow detected. Adjusting max_tokens from {:?} to {}",
                    attempt,
                    options.max_retries,
                    current_max_tokens,
                    adjusted
                );

                current_max_tokens = Some(adjusted);

                if let Some(ref mut callback) = on_retry {
                    callback(attempt, adjusted);
                }
            }
        }
    }

    Err(OverflowRecoveryError::MaxRetriesExceeded {
        attempts: options.max_retries,
    })
}

// ============================================================================
// HTTP 错误分类与智能重试
// ============================================================================

/// HTTP 错误分类
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCategory {
    /// 可重试错误（429, 408, 5xx, 网络错误）
    Retryable,
    /// 不可重试错误（4xx 除 429/408）
    NonRetryable,
    /// 致命错误（认证失败等）
    Fatal,
}

/// 根据 HTTP 状态码分类错误
pub fn categorize_http_error(status: u16) -> ErrorCategory {
    match status {
        // 认证/授权失败 - 致命
        401 | 403 => ErrorCategory::Fatal,
        // 速率限制和超时 - 可重试
        408 | 429 => ErrorCategory::Retryable,
        // 其他 4xx - 不可重试
        400..=499 => ErrorCategory::NonRetryable,
        // 5xx 服务器错误 - 可重试
        500..=599 => ErrorCategory::Retryable,
        // 其他 - 不可重试
        _ => ErrorCategory::NonRetryable,
    }
}

/// 判断 HTTP 状态码是否为可重试错误
pub fn is_retryable_error(status: u16) -> bool {
    categorize_http_error(status) == ErrorCategory::Retryable
}

/// 判断 HTTP 状态码是否为不可重试错误
pub fn is_non_retryable_error(status: u16) -> bool {
    matches!(
        categorize_http_error(status),
        ErrorCategory::NonRetryable | ErrorCategory::Fatal
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- 错误分类测试 ---

    #[test]
    fn test_categorize_401_as_fatal() {
        assert_eq!(categorize_http_error(401), ErrorCategory::Fatal);
    }

    #[test]
    fn test_categorize_403_as_fatal() {
        assert_eq!(categorize_http_error(403), ErrorCategory::Fatal);
    }

    #[test]
    fn test_categorize_429_as_retryable() {
        assert_eq!(categorize_http_error(429), ErrorCategory::Retryable);
    }

    #[test]
    fn test_categorize_408_as_retryable() {
        assert_eq!(categorize_http_error(408), ErrorCategory::Retryable);
    }

    #[test]
    fn test_categorize_500_as_retryable() {
        assert_eq!(categorize_http_error(500), ErrorCategory::Retryable);
    }

    #[test]
    fn test_categorize_502_as_retryable() {
        assert_eq!(categorize_http_error(502), ErrorCategory::Retryable);
    }

    #[test]
    fn test_categorize_503_as_retryable() {
        assert_eq!(categorize_http_error(503), ErrorCategory::Retryable);
    }

    #[test]
    fn test_categorize_400_as_non_retryable() {
        assert_eq!(categorize_http_error(400), ErrorCategory::NonRetryable);
    }

    #[test]
    fn test_categorize_404_as_non_retryable() {
        assert_eq!(categorize_http_error(404), ErrorCategory::NonRetryable);
    }

    #[test]
    fn test_categorize_422_as_non_retryable() {
        assert_eq!(categorize_http_error(422), ErrorCategory::NonRetryable);
    }

    #[test]
    fn test_categorize_200_as_non_retryable() {
        assert_eq!(categorize_http_error(200), ErrorCategory::NonRetryable);
    }

    // --- 辅助函数测试 ---

    #[test]
    fn test_is_retryable_for_429() {
        assert!(is_retryable_error(429));
    }

    #[test]
    fn test_is_retryable_for_500() {
        assert!(is_retryable_error(500));
    }

    #[test]
    fn test_is_not_retryable_for_400() {
        assert!(!is_retryable_error(400));
    }

    #[test]
    fn test_is_not_retryable_for_401() {
        assert!(!is_retryable_error(401));
    }

    #[test]
    fn test_is_non_retryable_for_400() {
        assert!(is_non_retryable_error(400));
    }

    #[test]
    fn test_is_non_retryable_for_401() {
        assert!(is_non_retryable_error(401));
    }

    #[test]
    fn test_is_not_non_retryable_for_429() {
        assert!(!is_non_retryable_error(429));
    }

    #[test]
    fn test_is_not_non_retryable_for_503() {
        assert!(!is_non_retryable_error(503));
    }

    // --- 上下文溢出解析测试 ---

    #[test]
    fn test_parse_context_overflow_valid() {
        let result = parse_context_overflow_error(
            400,
            "input length and `max_tokens` exceed context limit: 195000 + 8192 > 200000",
        );
        assert!(result.is_some());
        let overflow = result.unwrap();
        assert_eq!(overflow.input_tokens, 195000);
        assert_eq!(overflow.max_tokens, 8192);
        assert_eq!(overflow.context_limit, 200000);
    }

    #[test]
    fn test_parse_context_overflow_wrong_status() {
        let result = parse_context_overflow_error(
            500,
            "input length and `max_tokens` exceed context limit: 195000 + 8192 > 200000",
        );
        assert!(result.is_none());
    }

    #[test]
    fn test_parse_context_overflow_wrong_message() {
        let result = parse_context_overflow_error(400, "some other error");
        assert!(result.is_none());
    }

    #[test]
    fn test_calculate_adjusted_max_tokens_sufficient_space() {
        let overflow = ContextOverflowError {
            input_tokens: 190000,
            max_tokens: 8192,
            context_limit: 200000,
        };
        let result = calculate_adjusted_max_tokens(&overflow, 0);
        assert!(result.is_some());
        assert!(result.unwrap() >= MIN_OUTPUT_TOKENS);
    }

    #[test]
    fn test_calculate_adjusted_max_tokens_insufficient_space() {
        let overflow = ContextOverflowError {
            input_tokens: 199000,
            max_tokens: 8192,
            context_limit: 200000,
        };
        let result = calculate_adjusted_max_tokens(&overflow, 0);
        assert!(result.is_none());
    }
}
