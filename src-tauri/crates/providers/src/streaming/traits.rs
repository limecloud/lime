//! StreamingProvider Trait 定义
//!
//! 为 Provider 定义流式 API 接口，支持真正的端到端流式传输。
//!
//! # 需求覆盖
//!
//! - 需求 1.2: ClaudeCustomProvider 流式支持
//! - 需求 1.3: OpenAICustomProvider 流式支持

#![allow(dead_code)]

use crate::providers::ProviderError;
use crate::streaming::StreamError;
use async_trait::async_trait;
use bytes::Bytes;
use futures::Stream;
use lime_core::models::openai::ChatCompletionRequest;
use std::pin::Pin;

/// 流式响应类型别名
///
/// 返回一个异步字节流，每个 Item 是一个 chunk 的字节数据或错误。
/// 使用 `Pin<Box<...>>` 以支持动态分发和异步迭代。
pub type StreamResponse = Pin<Box<dyn Stream<Item = Result<Bytes, StreamError>> + Send>>;

/// 流式 Provider Trait
///
/// 定义所有支持流式传输的 Provider 必须实现的接口。
/// 与现有的非流式 API 调用方法并存，允许 Provider 同时支持两种模式。
#[async_trait]
pub trait StreamingProvider: Send + Sync {
    /// 发起流式 API 调用
    ///
    /// 返回一个字节流，调用者可以逐 chunk 处理响应数据。
    ///
    /// # Arguments
    ///
    /// * `request` - OpenAI 格式的聊天完成请求
    ///
    /// # Returns
    ///
    /// * `Ok(StreamResponse)` - 成功时返回字节流
    /// * `Err(ProviderError)` - 失败时返回 Provider 错误
    ///
    /// # Example
    ///
    /// ```ignore
    /// use futures::StreamExt;
    ///
    /// let stream = provider.call_api_stream(&request).await?;
    /// while let Some(chunk) = stream.next().await {
    ///     match chunk {
    ///         Ok(bytes) => { /* 处理字节数据 */ }
    ///         Err(e) => { /* 处理错误 */ }
    ///     }
    /// }
    /// ```
    async fn call_api_stream(
        &self,
        request: &ChatCompletionRequest,
    ) -> Result<StreamResponse, ProviderError>;

    /// 检查是否支持流式传输
    ///
    /// 默认返回 `true`，Provider 可以覆盖此方法以指示不支持流式。
    /// 当返回 `false` 时，调用者应该回退到非流式模式。
    fn supports_streaming(&self) -> bool {
        true
    }

    /// 获取 Provider 名称
    ///
    /// 用于日志记录和错误消息。
    fn provider_name(&self) -> &'static str;

    /// 获取流式响应的格式
    ///
    /// 返回此 Provider 的原生流式格式，用于后续的格式转换。
    fn stream_format(&self) -> StreamFormat;
}

/// 流式格式枚举
///
/// 定义不同 Provider 使用的流式响应格式。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamFormat {
    /// AWS Event Stream 格式
    AwsEventStream,
    /// Anthropic SSE 格式（Claude 使用）
    AnthropicSse,
    /// OpenAI SSE 格式（OpenAI 兼容 API 使用）
    OpenAiSse,
    /// Gemini 流式格式
    GeminiStream,
}

impl StreamFormat {
    /// 获取格式的 Content-Type
    pub fn content_type(&self) -> &'static str {
        match self {
            StreamFormat::AwsEventStream => "application/vnd.amazon.eventstream",
            StreamFormat::AnthropicSse => "text/event-stream",
            StreamFormat::OpenAiSse => "text/event-stream",
            StreamFormat::GeminiStream => "text/event-stream",
        }
    }

    /// 获取格式的显示名称
    pub fn display_name(&self) -> &'static str {
        match self {
            StreamFormat::AwsEventStream => "AWS Event Stream",
            StreamFormat::AnthropicSse => "Anthropic SSE",
            StreamFormat::OpenAiSse => "OpenAI SSE",
            StreamFormat::GeminiStream => "Gemini Stream",
        }
    }
}

// ============================================================================
// 辅助函数
// ============================================================================

/// 将 reqwest 的 bytes_stream 转换为 StreamResponse
///
/// 这是一个辅助函数，用于将 reqwest 的响应流转换为统一的 StreamResponse 类型。
pub fn reqwest_stream_to_stream_response(response: reqwest::Response) -> StreamResponse {
    use futures::StreamExt;

    let stream = response
        .bytes_stream()
        .map(|result| result.map_err(StreamError::from));

    Box::pin(stream)
}

// ============================================================================
// 测试模块
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stream_format_content_type() {
        assert_eq!(
            StreamFormat::AwsEventStream.content_type(),
            "application/vnd.amazon.eventstream"
        );
        assert_eq!(
            StreamFormat::AnthropicSse.content_type(),
            "text/event-stream"
        );
        assert_eq!(StreamFormat::OpenAiSse.content_type(), "text/event-stream");
        assert_eq!(
            StreamFormat::GeminiStream.content_type(),
            "text/event-stream"
        );
    }

    #[test]
    fn test_stream_format_display_name() {
        assert_eq!(
            StreamFormat::AwsEventStream.display_name(),
            "AWS Event Stream"
        );
        assert_eq!(StreamFormat::AnthropicSse.display_name(), "Anthropic SSE");
        assert_eq!(StreamFormat::OpenAiSse.display_name(), "OpenAI SSE");
        assert_eq!(StreamFormat::GeminiStream.display_name(), "Gemini Stream");
    }

    #[test]
    fn test_stream_format_equality() {
        assert_eq!(StreamFormat::AwsEventStream, StreamFormat::AwsEventStream);
        assert_ne!(StreamFormat::AwsEventStream, StreamFormat::OpenAiSse);
    }
}
