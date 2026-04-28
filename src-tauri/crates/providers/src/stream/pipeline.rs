//! 统一流处理管道
//!
//! 封装完整的流式处理流程：后端字节流 → 解析 → 转换 → 前端 SSE
//!
//! # 使用示例
//!
//! ```ignore
//! use lime::stream::pipeline::{StreamPipeline, PipelineConfig};
//!
//! let config = PipelineConfig::aws_event_stream_to_anthropic("claude-sonnet-4-5".to_string());
//! let pipeline = StreamPipeline::new(config);
//!
//! // 处理字节流
//! let sse_stream = pipeline.process_stream(byte_stream);
//! ```

use crate::stream::events::StreamEvent;
use crate::stream::generators::{AnthropicSseGenerator, OpenAiSseGenerator};
use crate::stream::parsers::AwsEventStreamParser;
use bytes::Bytes;
use futures::{Stream, StreamExt};

/// 后端类型
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackendType {
    /// AWS Event Stream
    AwsEventStream,
    /// OpenAI (SSE)
    OpenAi,
    /// Anthropic (SSE)
    Anthropic,
}

/// 前端类型
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrontendType {
    /// OpenAI SSE 格式
    OpenAi,
    /// Anthropic SSE 格式
    Anthropic,
}

/// 流处理管道配置
#[derive(Debug, Clone)]
pub struct PipelineConfig {
    /// 后端类型
    pub backend: BackendType,
    /// 前端类型
    pub frontend: FrontendType,
    /// 模型名称
    pub model: String,
    /// 消息 ID（可选）
    pub message_id: Option<String>,
}

impl PipelineConfig {
    /// 创建 AWS Event Stream → Anthropic 配置
    pub fn aws_event_stream_to_anthropic(model: String) -> Self {
        Self {
            backend: BackendType::AwsEventStream,
            frontend: FrontendType::Anthropic,
            model,
            message_id: None,
        }
    }

    /// 创建 AWS Event Stream → OpenAI 配置
    pub fn aws_event_stream_to_openai(model: String) -> Self {
        Self {
            backend: BackendType::AwsEventStream,
            frontend: FrontendType::OpenAi,
            model,
            message_id: None,
        }
    }

    /// 设置消息 ID
    pub fn with_message_id(mut self, id: String) -> Self {
        self.message_id = Some(id);
        self
    }
}

/// SSE 生成器封装
enum SseGenerator {
    Anthropic(AnthropicSseGenerator),
    OpenAi(OpenAiSseGenerator),
}

impl SseGenerator {
    fn generate(&mut self, event: &StreamEvent) -> Vec<String> {
        match self {
            SseGenerator::Anthropic(g) => g.generate(event),
            SseGenerator::OpenAi(g) => g.generate(event).into_iter().collect(),
        }
    }
}

/// 统一流处理管道
///
/// 将后端字节流转换为前端 SSE 字符串流
pub struct StreamPipeline {
    /// 配置
    config: PipelineConfig,
    /// AWS Event Stream 解析器
    aws_parser: Option<AwsEventStreamParser>,
    /// SSE 生成器
    generator: SseGenerator,
}

impl StreamPipeline {
    /// 创建新的管道
    pub fn new(config: PipelineConfig) -> Self {
        let aws_parser = match config.backend {
            BackendType::AwsEventStream => {
                Some(AwsEventStreamParser::with_model(config.model.clone()))
            }
            _ => None,
        };

        let generator = match config.frontend {
            FrontendType::Anthropic => {
                if let Some(id) = &config.message_id {
                    SseGenerator::Anthropic(AnthropicSseGenerator::with_id(
                        id.clone(),
                        config.model.clone(),
                    ))
                } else {
                    SseGenerator::Anthropic(AnthropicSseGenerator::new(config.model.clone()))
                }
            }
            FrontendType::OpenAi => {
                if let Some(id) = &config.message_id {
                    SseGenerator::OpenAi(OpenAiSseGenerator::with_id(
                        id.clone(),
                        config.model.clone(),
                    ))
                } else {
                    SseGenerator::OpenAi(OpenAiSseGenerator::new(config.model.clone()))
                }
            }
        };

        Self {
            config,
            aws_parser,
            generator,
        }
    }

    /// 处理单个字节块
    ///
    /// # 返回
    ///
    /// 生成的 SSE 字符串列表
    pub fn process_chunk(&mut self, bytes: &[u8]) -> Vec<String> {
        let events = self.parse_bytes(bytes);
        self.generate_sse(&events)
    }

    /// 完成处理
    ///
    /// # 返回
    ///
    /// 最终的 SSE 字符串列表
    pub fn finish(&mut self) -> Vec<String> {
        let events = self.finish_parsing();
        self.generate_sse(&events)
    }

    /// 解析字节为 StreamEvent
    fn parse_bytes(&mut self, bytes: &[u8]) -> Vec<StreamEvent> {
        match &mut self.aws_parser {
            Some(parser) => parser.process(bytes),
            None => Vec::new(), // TODO: 支持其他后端格式的解析
        }
    }

    /// 完成解析
    fn finish_parsing(&mut self) -> Vec<StreamEvent> {
        match &mut self.aws_parser {
            Some(parser) => parser.finish(),
            None => Vec::new(),
        }
    }

    /// 将 StreamEvent 转换为 SSE 字符串
    fn generate_sse(&mut self, events: &[StreamEvent]) -> Vec<String> {
        let mut result = Vec::new();
        for event in events {
            let sse_strings = self.generator.generate(event);
            result.extend(sse_strings);
        }
        result
    }

    /// 获取配置
    pub fn config(&self) -> &PipelineConfig {
        &self.config
    }

    /// 重置管道状态
    pub fn reset(&mut self) {
        if let Some(ref mut parser) = self.aws_parser {
            parser.reset();
        }
        self.generator = match self.config.frontend {
            FrontendType::Anthropic => {
                SseGenerator::Anthropic(AnthropicSseGenerator::new(self.config.model.clone()))
            }
            FrontendType::OpenAi => {
                SseGenerator::OpenAi(OpenAiSseGenerator::new(self.config.model.clone()))
            }
        };
    }
}

/// 创建流式处理的异步流
///
/// 将字节流转换为 SSE 字符串流
pub fn create_sse_stream<S, E>(
    byte_stream: S,
    config: PipelineConfig,
) -> impl Stream<Item = Result<String, E>>
where
    S: Stream<Item = Result<Bytes, E>> + Send + 'static,
    E: Send + 'static,
{
    async_stream::stream! {
        let mut pipeline = StreamPipeline::new(config);
        let mut byte_stream = std::pin::pin!(byte_stream);

        while let Some(result) = byte_stream.next().await {
            match result {
                Ok(bytes) => {
                    let sse_strings = pipeline.process_chunk(&bytes);
                    for sse in sse_strings {
                        yield Ok(sse);
                    }
                }
                Err(e) => {
                    yield Err(e);
                    return;
                }
            }
        }

        // 完成处理
        let final_sse = pipeline.finish();
        for sse in final_sse {
            yield Ok(sse);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pipeline_config_aws_event_stream_to_anthropic() {
        let config = PipelineConfig::aws_event_stream_to_anthropic("claude-sonnet-4-5".to_string());
        assert_eq!(config.backend, BackendType::AwsEventStream);
        assert_eq!(config.frontend, FrontendType::Anthropic);
        assert_eq!(config.model, "claude-sonnet-4-5");
    }

    #[test]
    fn test_pipeline_config_aws_event_stream_to_openai() {
        let config = PipelineConfig::aws_event_stream_to_openai("gpt-4".to_string());
        assert_eq!(config.backend, BackendType::AwsEventStream);
        assert_eq!(config.frontend, FrontendType::OpenAi);
    }

    #[test]
    fn test_pipeline_process_content() {
        let config = PipelineConfig::aws_event_stream_to_anthropic("claude-sonnet-4-5".to_string());
        let mut pipeline = StreamPipeline::new(config);

        // 模拟 AWS Event Stream 内容事件
        let bytes = br#"{"content":"Hello"}"#;
        let sse = pipeline.process_chunk(bytes);

        // 应该生成 message_start, content_block_start, content_block_delta
        assert!(!sse.is_empty());
        assert!(sse.iter().any(|s| s.contains("message_start")));
        assert!(sse.iter().any(|s| s.contains("content_block_start")));
        assert!(sse.iter().any(|s| s.contains("Hello")));
    }

    #[test]
    fn test_pipeline_process_tool_use() {
        let config = PipelineConfig::aws_event_stream_to_anthropic("claude-sonnet-4-5".to_string());
        let mut pipeline = StreamPipeline::new(config);

        // 工具调用开始
        let bytes = br#"{"toolUseId":"tool_123","name":"read_file"}"#;
        let sse = pipeline.process_chunk(bytes);

        assert!(!sse.is_empty());
        assert!(sse.iter().any(|s| s.contains("tool_use")));
        assert!(sse.iter().any(|s| s.contains("read_file")));

        // 工具参数
        let bytes = br#"{"toolUseId":"tool_123","input":"{\"path\":"}"#;
        let sse = pipeline.process_chunk(bytes);
        assert!(sse.iter().any(|s| s.contains("input_json_delta")));

        // 工具结束
        let bytes = br#"{"toolUseId":"tool_123","stop":true}"#;
        let sse = pipeline.process_chunk(bytes);
        assert!(sse.iter().any(|s| s.contains("content_block_stop")));
    }

    #[test]
    fn test_pipeline_openai_output() {
        let config = PipelineConfig::aws_event_stream_to_openai("gpt-4".to_string());
        let mut pipeline = StreamPipeline::new(config);

        // 模拟 AWS Event Stream 内容事件
        let bytes = br#"{"content":"Hello"}"#;
        let sse = pipeline.process_chunk(bytes);

        assert!(!sse.is_empty());
        // OpenAI 格式应该包含 data: 前缀和 choices
        assert!(sse.iter().any(|s| s.starts_with("data: ")));
        assert!(sse.iter().any(|s| s.contains("\"content\":\"Hello\"")));
    }
}
