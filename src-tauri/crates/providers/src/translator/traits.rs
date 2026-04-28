//! 协议转换器 Trait 定义
//!
//! 定义请求和响应转换器的核心接口，用于在不同协议之间进行转换。
//!
//! # 设计原则
//!
//! - `RequestTranslator`: 将前端协议请求转换为后端协议请求
//! - `ResponseTranslator`: 将后端响应/事件转换为前端格式
//! - 使用 `StreamEvent` 作为流式响应的中间表示

use crate::stream::StreamEvent;

/// 请求转换器 Trait
///
/// 将前端协议的请求转换为后端协议的请求格式。
///
/// # 类型参数
///
/// - `Input`: 前端请求类型（如 OpenAI ChatCompletionRequest）
/// - `Output`: 后端请求类型
/// - `Error`: 转换错误类型
pub trait RequestTranslator {
    /// 前端请求类型
    type Input;
    /// 后端请求类型
    type Output;
    /// 转换错误类型
    type Error: std::error::Error + Send + Sync + 'static;

    /// 转换请求
    ///
    /// # 参数
    ///
    /// - `request`: 前端协议请求
    ///
    /// # 返回
    ///
    /// 转换后的后端协议请求
    fn translate_request(&self, request: Self::Input) -> Result<Self::Output, Self::Error>;
}

/// 响应转换器 Trait
///
/// 将 `StreamEvent` 转换为目标前端协议的响应格式。
///
/// # 类型参数
///
/// - `Output`: 目标响应类型或 SSE 字符串
pub trait ResponseTranslator {
    /// 目标响应类型
    type Output;

    /// 转换单个流事件
    ///
    /// # 参数
    ///
    /// - `event`: 统一的流事件
    ///
    /// # 返回
    ///
    /// - `Some(output)`: 生成的响应数据
    /// - `None`: 该事件不需要生成输出
    fn translate_event(&mut self, event: &StreamEvent) -> Option<Self::Output>;

    /// 完成转换
    ///
    /// 用于生成流结束时的最终事件（如果需要）
    fn finalize(&mut self) -> Vec<Self::Output> {
        Vec::new()
    }

    /// 重置转换器状态
    fn reset(&mut self);
}

/// SSE 响应转换器 Trait
///
/// 专门用于将 `StreamEvent` 转换为 SSE 字符串格式。
/// 这是 `ResponseTranslator` 的一个常见特化。
pub trait SseResponseTranslator {
    /// 将流事件转换为 SSE 字符串
    ///
    /// # 返回
    ///
    /// SSE 格式的字符串列表，每个字符串都是完整的 SSE 事件
    fn translate_to_sse(&mut self, event: &StreamEvent) -> Vec<String>;

    /// 生成结束 SSE 事件
    fn finalize_sse(&mut self) -> Vec<String> {
        Vec::new()
    }

    /// 重置状态
    fn reset(&mut self);
}

/// 转换错误类型
#[derive(Debug, Clone)]
pub struct TranslateError {
    /// 错误类型
    pub kind: TranslateErrorKind,
    /// 错误消息
    pub message: String,
    /// 原始数据（用于调试）
    pub source_data: Option<String>,
}

impl std::fmt::Display for TranslateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.kind, self.message)
    }
}

impl std::error::Error for TranslateError {}

/// 转换错误类型枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TranslateErrorKind {
    /// 无效的请求格式
    InvalidRequest,
    /// 不支持的功能
    UnsupportedFeature,
    /// 缺少必要字段
    MissingField,
    /// 数据验证失败
    ValidationFailed,
    /// 序列化/反序列化错误
    SerializationError,
    /// 其他错误
    Other,
}

impl std::fmt::Display for TranslateErrorKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidRequest => write!(f, "InvalidRequest"),
            Self::UnsupportedFeature => write!(f, "UnsupportedFeature"),
            Self::MissingField => write!(f, "MissingField"),
            Self::ValidationFailed => write!(f, "ValidationFailed"),
            Self::SerializationError => write!(f, "SerializationError"),
            Self::Other => write!(f, "Other"),
        }
    }
}

impl TranslateError {
    /// 创建新的转换错误
    pub fn new(kind: TranslateErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            source_data: None,
        }
    }

    /// 带原始数据创建错误
    pub fn with_source(
        kind: TranslateErrorKind,
        message: impl Into<String>,
        source: impl Into<String>,
    ) -> Self {
        Self {
            kind,
            message: message.into(),
            source_data: Some(source.into()),
        }
    }

    /// 创建无效请求错误
    pub fn invalid_request(message: impl Into<String>) -> Self {
        Self::new(TranslateErrorKind::InvalidRequest, message)
    }

    /// 创建不支持功能错误
    pub fn unsupported(message: impl Into<String>) -> Self {
        Self::new(TranslateErrorKind::UnsupportedFeature, message)
    }

    /// 创建缺少字段错误
    pub fn missing_field(field: &str) -> Self {
        Self::new(
            TranslateErrorKind::MissingField,
            format!("Missing required field: {field}"),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_translate_error_display() {
        let err = TranslateError::new(TranslateErrorKind::InvalidRequest, "test error");
        assert_eq!(format!("{err}"), "InvalidRequest: test error");
    }

    #[test]
    fn test_translate_error_with_source() {
        let err = TranslateError::with_source(
            TranslateErrorKind::SerializationError,
            "failed to parse",
            "{invalid json}",
        );
        assert!(err.source_data.is_some());
        assert_eq!(err.source_data.unwrap(), "{invalid json}");
    }

    #[test]
    fn test_missing_field_error() {
        let err = TranslateError::missing_field("model");
        assert_eq!(err.kind, TranslateErrorKind::MissingField);
        assert!(err.message.contains("model"));
    }
}
