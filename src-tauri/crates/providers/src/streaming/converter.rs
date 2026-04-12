//! 流式格式转换器
//!
//! 在不同流式格式之间转换，支持 AWS Event Stream、Anthropic SSE 和 OpenAI SSE。
//!
//! # 需求覆盖

#![allow(dead_code)]
//!
//! - 需求 3.1: AWS Event Stream 到 Anthropic SSE 转换
//! - 需求 3.2: AWS Event Stream 到 OpenAI SSE 转换
//! - 需求 3.3: Anthropic SSE 到 OpenAI SSE 转换
//! - 需求 3.5: 处理工具调用参数中的部分 JSON

use crate::streaming::aws_parser::{AwsEvent, AwsEventStreamParser};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

/// 流式格式类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum StreamFormat {
    /// AWS Event Stream (Kiro/CodeWhisperer)
    AwsEventStream,
    /// Anthropic SSE 格式
    AnthropicSse,
    /// OpenAI SSE 格式
    OpenAiSse,
}

/// 转换器状态
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum ConverterState {
    /// 初始状态
    #[default]
    Idle,
    /// 正在转换
    Converting,
    /// 已完成
    Completed,
    /// 错误状态
    Error(String),
}

/// 工具调用累积器
///
/// 用于跟踪正在进行的工具调用，累积部分 JSON 输入
#[derive(Debug, Clone, Default)]
struct ToolCallAccumulator {
    /// 工具调用 ID
    id: String,
    /// 工具名称
    name: String,
    /// 累积的输入 JSON（部分）
    input: String,
    /// 是否已发送开始事件
    started: bool,
    /// 内容块索引（用于 Anthropic 格式）
    index: u32,
}

/// Anthropic 流式 usage 状态
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct AnthropicUsageState {
    /// 输入 token
    input_tokens: u64,
    /// 输出 token
    output_tokens: u64,
    /// Cache read token
    cache_read_input_tokens: u64,
    /// Cache creation token
    cache_creation_input_tokens: u64,
}

impl AnthropicUsageState {
    fn apply_usage_object(&mut self, usage: &serde_json::Value) {
        if let Some(input_tokens) = usage.get("input_tokens").and_then(|v| v.as_u64()) {
            self.input_tokens = input_tokens;
        }
        if let Some(output_tokens) = usage.get("output_tokens").and_then(|v| v.as_u64()) {
            self.output_tokens = output_tokens;
        }
        if let Some(cache_read_input_tokens) = usage
            .get("cache_read_input_tokens")
            .and_then(|v| v.as_u64())
        {
            self.cache_read_input_tokens = cache_read_input_tokens;
        }
        if let Some(cache_creation_input_tokens) = usage
            .get("cache_creation_input_tokens")
            .and_then(|v| v.as_u64())
        {
            self.cache_creation_input_tokens = cache_creation_input_tokens;
        }
    }

    fn prompt_tokens(&self) -> u64 {
        self.input_tokens + self.cache_read_input_tokens + self.cache_creation_input_tokens
    }

    fn total_tokens(&self) -> u64 {
        self.prompt_tokens() + self.output_tokens
    }
}

/// 部分 JSON 累积器
///
/// 用于处理工具调用参数中的部分 JSON
/// 对应需求 3.5
#[derive(Debug, Clone, Default)]
pub struct PartialJsonAccumulator {
    /// 累积的 JSON 字符串
    buffer: String,
    /// 括号深度（用于检测 JSON 完整性）
    brace_depth: i32,
    /// 是否在字符串内
    in_string: bool,
    /// 是否转义下一个字符
    escape_next: bool,
}

impl PartialJsonAccumulator {
    /// 创建新的累积器
    pub fn new() -> Self {
        Self::default()
    }

    /// 追加部分 JSON
    ///
    /// 返回 true 如果 JSON 已完整
    pub fn append(&mut self, partial: &str) -> bool {
        for ch in partial.chars() {
            self.buffer.push(ch);

            if self.escape_next {
                self.escape_next = false;
                continue;
            }

            match ch {
                '\\' if self.in_string => self.escape_next = true,
                '"' => self.in_string = !self.in_string,
                '{' | '[' if !self.in_string => self.brace_depth += 1,
                '}' | ']' if !self.in_string => self.brace_depth -= 1,
                _ => {}
            }
        }

        self.is_complete()
    }

    /// 检查 JSON 是否完整
    pub fn is_complete(&self) -> bool {
        !self.buffer.is_empty() && self.brace_depth == 0 && !self.in_string
    }

    /// 获取累积的 JSON
    pub fn get_json(&self) -> &str {
        &self.buffer
    }

    /// 重置累积器
    pub fn reset(&mut self) {
        self.buffer.clear();
        self.brace_depth = 0;
        self.in_string = false;
        self.escape_next = false;
    }

    /// 获取缓冲区长度
    pub fn len(&self) -> usize {
        self.buffer.len()
    }

    /// 检查缓冲区是否为空
    pub fn is_empty(&self) -> bool {
        self.buffer.is_empty()
    }
}

/// 流式格式转换器
///
/// 支持在不同流式格式之间转换。
#[derive(Debug)]
pub struct StreamConverter {
    /// 源格式
    source_format: StreamFormat,
    /// 目标格式
    target_format: StreamFormat,
    /// AWS 解析器（如果源是 AWS Event Stream）
    aws_parser: Option<AwsEventStreamParser>,
    /// 状态
    state: ConverterState,
    /// 响应 ID
    response_id: String,
    /// 模型名称
    model: String,
    /// 工具调用累积器
    tool_accumulators: HashMap<String, ToolCallAccumulator>,
    /// 下一个内容块索引（用于 Anthropic 格式）
    next_content_block_index: u32,
    /// 是否已发送 message_start（用于 Anthropic 格式）
    message_started: bool,
    /// 累积的内容（用于重建完整响应）
    accumulated_content: String,
    /// Anthropic 流式 usage 状态
    anthropic_usage: Option<AnthropicUsageState>,
    /// Anthropic stop_reason 映射后的 OpenAI finish_reason
    anthropic_finish_reason: Option<String>,
    /// 是否已输出终止事件，避免 finish() 重复输出
    terminal_event_emitted: bool,
}

impl StreamConverter {
    /// 创建新的转换器
    pub fn new(source: StreamFormat, target: StreamFormat) -> Self {
        let aws_parser = if source == StreamFormat::AwsEventStream {
            Some(AwsEventStreamParser::new())
        } else {
            None
        };

        Self {
            source_format: source,
            target_format: target,
            aws_parser,
            state: ConverterState::Idle,
            response_id: format!("chatcmpl-{}", Uuid::new_v4()),
            model: String::new(),
            tool_accumulators: HashMap::new(),
            next_content_block_index: 0,
            message_started: false,
            accumulated_content: String::new(),
            anthropic_usage: None,
            anthropic_finish_reason: None,
            terminal_event_emitted: false,
        }
    }

    /// 创建带模型名称的转换器
    pub fn with_model(source: StreamFormat, target: StreamFormat, model: &str) -> Self {
        let mut converter = Self::new(source, target);
        converter.model = model.to_string();
        converter
    }

    /// 获取当前状态
    pub fn state(&self) -> &ConverterState {
        &self.state
    }

    /// 获取响应 ID
    pub fn response_id(&self) -> &str {
        &self.response_id
    }

    /// 获取累积的内容
    pub fn accumulated_content(&self) -> &str {
        &self.accumulated_content
    }

    /// 重置转换器
    pub fn reset(&mut self) {
        if let Some(parser) = &mut self.aws_parser {
            parser.reset();
        }
        self.state = ConverterState::Idle;
        self.response_id = format!("chatcmpl-{}", Uuid::new_v4());
        self.tool_accumulators.clear();
        self.next_content_block_index = 0;
        self.message_started = false;
        self.accumulated_content.clear();
        self.anthropic_usage = None;
        self.anthropic_finish_reason = None;
        self.terminal_event_emitted = false;
    }

    /// 转换 chunk
    ///
    /// 将源格式的 chunk 转换为目标格式的 SSE 事件列表。
    ///
    /// # 参数
    ///
    /// * `chunk` - 源格式的字节数据
    ///
    /// # 返回
    ///
    /// 目标格式的 SSE 事件字符串列表
    pub fn convert(&mut self, chunk: &[u8]) -> Vec<String> {
        if self.state == ConverterState::Idle {
            self.state = ConverterState::Converting;
        }

        match self.source_format {
            StreamFormat::AwsEventStream => self.convert_aws_event_stream(chunk),
            StreamFormat::AnthropicSse => self.convert_anthropic_sse(chunk),
            StreamFormat::OpenAiSse => self.convert_openai_sse(chunk),
        }
    }

    /// 完成转换
    ///
    /// 处理剩余数据并生成结束事件。
    pub fn finish(&mut self) -> Vec<String> {
        let mut events = Vec::new();

        // 处理 AWS 解析器中的剩余数据
        if let Some(parser) = &mut self.aws_parser {
            let aws_events = parser.finish();
            for aws_event in aws_events {
                events.extend(self.convert_aws_event(&aws_event));
            }
        }

        // 生成结束事件
        events.extend(self.generate_end_events());

        self.state = ConverterState::Completed;
        events
    }

    /// 转换 AWS Event Stream
    fn convert_aws_event_stream(&mut self, chunk: &[u8]) -> Vec<String> {
        let parser = self.aws_parser.as_mut().expect("AWS parser should exist");
        let aws_events = parser.process(chunk);

        let mut sse_events = Vec::new();
        for aws_event in aws_events {
            sse_events.extend(self.convert_aws_event(&aws_event));
        }
        sse_events
    }

    /// 转换单个 AWS 事件
    fn convert_aws_event(&mut self, event: &AwsEvent) -> Vec<String> {
        match self.target_format {
            StreamFormat::AnthropicSse => self.aws_to_anthropic(event),
            StreamFormat::OpenAiSse => self.aws_to_openai(event),
            StreamFormat::AwsEventStream => {
                // 源和目标相同，直接序列化
                if let Some(json) = crate::streaming::aws_parser::serialize_event(event) {
                    vec![json]
                } else {
                    vec![]
                }
            }
        }
    }

    /// AWS Event Stream 到 Anthropic SSE 转换
    ///
    /// 对应需求 3.1
    fn aws_to_anthropic(&mut self, event: &AwsEvent) -> Vec<String> {
        let mut sse_events = Vec::new();

        // 确保发送 message_start
        if !self.message_started {
            sse_events.push(self.create_anthropic_message_start());
            self.message_started = true;
        }

        match event {
            AwsEvent::Content { text } => {
                // 累积内容
                self.accumulated_content.push_str(text);

                // 如果是第一个内容块，发送 content_block_start
                if self.next_content_block_index == 0 {
                    sse_events.push(self.create_anthropic_content_block_start_text(0));
                    self.next_content_block_index = 1;
                }

                // 发送 content_block_delta
                sse_events.push(self.create_anthropic_text_delta(0, text));
            }
            AwsEvent::ToolUseStart { id, name } => {
                // 如果有文本内容块，先关闭它
                if self.next_content_block_index > 0 && self.accumulated_content.is_empty() {
                    // 没有文本内容，不需要关闭
                } else if self.next_content_block_index > 0 {
                    sse_events.push(self.create_anthropic_content_block_stop(0));
                }

                let index = self.next_content_block_index;
                self.next_content_block_index += 1;

                // 创建工具调用累积器
                self.tool_accumulators.insert(
                    id.clone(),
                    ToolCallAccumulator {
                        id: id.clone(),
                        name: name.clone(),
                        input: String::new(),
                        started: true,
                        index,
                    },
                );

                // 发送 content_block_start (tool_use)
                sse_events.push(self.create_anthropic_content_block_start_tool(index, id, name));
            }
            AwsEvent::ToolUseInput { id, input } => {
                if let Some(acc) = self.tool_accumulators.get_mut(id) {
                    acc.input.push_str(input);
                }
                // 发送 input_json_delta
                if let Some(acc) = self.tool_accumulators.get(id) {
                    sse_events.push(self.create_anthropic_input_json_delta(acc.index, input));
                }
            }
            AwsEvent::ToolUseStop { id } => {
                if let Some(acc) = self.tool_accumulators.remove(id) {
                    // 发送 content_block_stop
                    sse_events.push(self.create_anthropic_content_block_stop(acc.index));
                }
            }
            AwsEvent::Stop => {
                // 关闭所有未关闭的内容块
                if self.next_content_block_index > 0 && !self.accumulated_content.is_empty() {
                    sse_events.push(self.create_anthropic_content_block_stop(0));
                }
                // message_delta 和 message_stop 在 finish() 中处理
            }
            AwsEvent::Usage {
                credits,
                context_percentage,
            } => {
                // Usage 信息在 message_delta 中发送
                // 这里暂时忽略，在 finish() 中处理
                let _ = (credits, context_percentage);
            }
            AwsEvent::FollowupPrompt { .. } | AwsEvent::ParseError { .. } => {
                // 忽略这些事件
            }
        }

        sse_events
    }

    /// AWS Event Stream 到 OpenAI SSE 转换
    ///
    /// 对应需求 3.2
    fn aws_to_openai(&mut self, event: &AwsEvent) -> Vec<String> {
        let mut sse_events = Vec::new();

        match event {
            AwsEvent::Content { text } => {
                // 累积内容
                self.accumulated_content.push_str(text);
                // 发送 chunk
                sse_events.push(self.create_openai_content_chunk(text, false));
            }
            AwsEvent::ToolUseStart { id, name } => {
                let index = self.tool_accumulators.len() as u32;
                self.tool_accumulators.insert(
                    id.clone(),
                    ToolCallAccumulator {
                        id: id.clone(),
                        name: name.clone(),
                        input: String::new(),
                        started: true,
                        index,
                    },
                );
                // 发送工具调用开始 chunk
                sse_events.push(self.create_openai_tool_call_chunk(index, id, name, "", true));
            }
            AwsEvent::ToolUseInput { id, input } => {
                let (index, tool_id, tool_name) =
                    if let Some(acc) = self.tool_accumulators.get_mut(id) {
                        acc.input.push_str(input);
                        (acc.index, acc.id.clone(), acc.name.clone())
                    } else {
                        return sse_events;
                    };
                // 发送工具调用参数增量
                sse_events.push(
                    self.create_openai_tool_call_chunk(index, &tool_id, &tool_name, input, false),
                );
            }
            AwsEvent::ToolUseStop { id } => {
                // OpenAI 格式不需要显式的工具调用结束事件
                self.tool_accumulators.remove(id);
            }
            AwsEvent::Stop => {
                // 结束事件在 finish() 中处理
            }
            AwsEvent::Usage { .. }
            | AwsEvent::FollowupPrompt { .. }
            | AwsEvent::ParseError { .. } => {
                // 忽略这些事件
            }
        }

        sse_events
    }

    /// 转换 Anthropic SSE（直通或转换为 OpenAI）
    fn convert_anthropic_sse(&mut self, chunk: &[u8]) -> Vec<String> {
        // 解析 SSE 数据
        let data = match String::from_utf8(chunk.to_vec()) {
            Ok(s) => s,
            Err(_) => return vec![],
        };

        match self.target_format {
            StreamFormat::AnthropicSse => {
                // 直通
                vec![data]
            }
            StreamFormat::OpenAiSse => {
                // 转换为 OpenAI 格式
                self.anthropic_to_openai(&data)
            }
            StreamFormat::AwsEventStream => {
                // 不支持反向转换
                vec![]
            }
        }
    }

    /// Anthropic SSE 到 OpenAI SSE 转换
    ///
    /// 对应需求 3.3
    fn anthropic_to_openai(&mut self, data: &str) -> Vec<String> {
        let mut sse_events = Vec::new();

        // 解析 SSE 事件
        for line in data.lines() {
            if let Some(json_str) = line.strip_prefix("data: ") {
                if json_str == "[DONE]" {
                    self.terminal_event_emitted = true;
                    sse_events.push("data: [DONE]\n\n".to_string());
                    continue;
                }

                if let Ok(event) = serde_json::from_str::<serde_json::Value>(json_str) {
                    if let Some(event_type) = event.get("type").and_then(|t| t.as_str()) {
                        match event_type {
                            "message_start" => {
                                self.capture_anthropic_message_start_usage(&event);
                            }
                            "message_delta" => {
                                self.capture_anthropic_message_delta_state(&event);
                            }
                            "content_block_delta" => {
                                if let Some(delta) = event.get("delta") {
                                    if let Some(text) = delta.get("text").and_then(|t| t.as_str()) {
                                        self.accumulated_content.push_str(text);
                                        sse_events
                                            .push(self.create_openai_content_chunk(text, false));
                                    } else if let Some(partial_json) =
                                        delta.get("partial_json").and_then(|t| t.as_str())
                                    {
                                        // 工具调用参数增量
                                        let index = event
                                            .get("index")
                                            .and_then(|i| i.as_u64())
                                            .unwrap_or(0)
                                            as u32;
                                        let tool_info = self
                                            .tool_accumulators
                                            .values_mut()
                                            .find(|a| a.index == index)
                                            .map(|acc| {
                                                acc.input.push_str(partial_json);
                                                (acc.index, acc.id.clone(), acc.name.clone())
                                            });
                                        if let Some((idx, tool_id, tool_name)) = tool_info {
                                            sse_events.push(self.create_openai_tool_call_chunk(
                                                idx,
                                                &tool_id,
                                                &tool_name,
                                                partial_json,
                                                false,
                                            ));
                                        }
                                    }
                                }
                            }
                            "content_block_start" => {
                                if let Some(content_block) = event.get("content_block") {
                                    if content_block.get("type").and_then(|t| t.as_str())
                                        == Some("tool_use")
                                    {
                                        let id = content_block
                                            .get("id")
                                            .and_then(|i| i.as_str())
                                            .unwrap_or("");
                                        let name = content_block
                                            .get("name")
                                            .and_then(|n| n.as_str())
                                            .unwrap_or("");
                                        let index = event
                                            .get("index")
                                            .and_then(|i| i.as_u64())
                                            .unwrap_or(0)
                                            as u32;
                                        self.tool_accumulators.insert(
                                            id.to_string(),
                                            ToolCallAccumulator {
                                                id: id.to_string(),
                                                name: name.to_string(),
                                                input: String::new(),
                                                started: true,
                                                index,
                                            },
                                        );
                                        sse_events.push(self.create_openai_tool_call_chunk(
                                            index, id, name, "", true,
                                        ));
                                    }
                                }
                            }
                            "message_stop" => {
                                let finish_reason =
                                    self.anthropic_finish_reason.as_deref().unwrap_or("stop");
                                sse_events.push(self.create_openai_finish_chunk(
                                    finish_reason,
                                    self.anthropic_openai_usage_json(),
                                ));
                                sse_events.push("data: [DONE]\n\n".to_string());
                                self.terminal_event_emitted = true;
                            }
                            _ => {}
                        }
                    }
                }
            }
        }

        sse_events
    }

    /// 转换 OpenAI SSE（直通）
    fn convert_openai_sse(&mut self, chunk: &[u8]) -> Vec<String> {
        match String::from_utf8(chunk.to_vec()) {
            Ok(s) => vec![s],
            Err(_) => vec![],
        }
    }

    /// 生成结束事件
    fn generate_end_events(&mut self) -> Vec<String> {
        if self.terminal_event_emitted {
            return vec![];
        }

        match self.target_format {
            StreamFormat::AnthropicSse => {
                vec![
                    self.create_anthropic_message_delta(),
                    self.create_anthropic_message_stop(),
                ]
            }
            StreamFormat::OpenAiSse => {
                let finish_reason = if self.tool_accumulators.is_empty() {
                    "stop"
                } else {
                    "tool_calls"
                };
                vec![
                    self.create_openai_finish_chunk(finish_reason, None),
                    "data: [DONE]\n\n".to_string(),
                ]
            }
            StreamFormat::AwsEventStream => {
                vec![]
            }
        }
    }

    // ========================================================================
    // Anthropic SSE 事件创建辅助方法
    // ========================================================================

    fn create_anthropic_message_start(&self) -> String {
        let event = serde_json::json!({
            "type": "message_start",
            "message": {
                "id": self.response_id,
                "type": "message",
                "role": "assistant",
                "model": self.model,
                "content": [],
                "stop_reason": null,
                "stop_sequence": null,
                "usage": {
                    "input_tokens": 0,
                    "output_tokens": 0
                }
            }
        });
        format!("event: message_start\ndata: {event}\n\n")
    }

    fn create_anthropic_content_block_start_text(&self, index: u32) -> String {
        let event = serde_json::json!({
            "type": "content_block_start",
            "index": index,
            "content_block": {
                "type": "text",
                "text": ""
            }
        });
        format!("event: content_block_start\ndata: {event}\n\n")
    }

    fn create_anthropic_content_block_start_tool(
        &self,
        index: u32,
        id: &str,
        name: &str,
    ) -> String {
        let event = serde_json::json!({
            "type": "content_block_start",
            "index": index,
            "content_block": {
                "type": "tool_use",
                "id": id,
                "name": name,
                "input": {}
            }
        });
        format!("event: content_block_start\ndata: {event}\n\n")
    }

    fn create_anthropic_text_delta(&self, index: u32, text: &str) -> String {
        let event = serde_json::json!({
            "type": "content_block_delta",
            "index": index,
            "delta": {
                "type": "text_delta",
                "text": text
            }
        });
        format!("event: content_block_delta\ndata: {event}\n\n")
    }

    fn create_anthropic_input_json_delta(&self, index: u32, partial_json: &str) -> String {
        let event = serde_json::json!({
            "type": "content_block_delta",
            "index": index,
            "delta": {
                "type": "input_json_delta",
                "partial_json": partial_json
            }
        });
        format!("event: content_block_delta\ndata: {event}\n\n")
    }

    fn create_anthropic_content_block_stop(&self, index: u32) -> String {
        let event = serde_json::json!({
            "type": "content_block_stop",
            "index": index
        });
        format!("event: content_block_stop\ndata: {event}\n\n")
    }

    fn create_anthropic_message_delta(&self) -> String {
        let event = serde_json::json!({
            "type": "message_delta",
            "delta": {
                "stop_reason": "end_turn",
                "stop_sequence": null
            },
            "usage": {
                "output_tokens": 0
            }
        });
        format!("event: message_delta\ndata: {event}\n\n")
    }

    fn create_anthropic_message_stop(&self) -> String {
        let event = serde_json::json!({
            "type": "message_stop"
        });
        format!("event: message_stop\ndata: {event}\n\n")
    }

    // ========================================================================
    // OpenAI SSE 事件创建辅助方法
    // ========================================================================

    fn get_created_timestamp(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    }

    fn create_openai_content_chunk(&self, content: &str, is_first: bool) -> String {
        let chunk = serde_json::json!({
            "id": self.response_id,
            "object": "chat.completion.chunk",
            "created": self.get_created_timestamp(),
            "model": self.model,
            "choices": [{
                "index": 0,
                "delta": {
                    "role": if is_first { Some("assistant") } else { None::<&str> },
                    "content": content
                },
                "finish_reason": null
            }]
        });
        format!("data: {chunk}\n\n")
    }

    fn create_openai_tool_call_chunk(
        &self,
        index: u32,
        id: &str,
        name: &str,
        arguments: &str,
        is_first: bool,
    ) -> String {
        let tool_call = if is_first {
            serde_json::json!({
                "index": index,
                "id": id,
                "type": "function",
                "function": {
                    "name": name,
                    "arguments": arguments
                }
            })
        } else {
            serde_json::json!({
                "index": index,
                "function": {
                    "arguments": arguments
                }
            })
        };

        let chunk = serde_json::json!({
            "id": self.response_id,
            "object": "chat.completion.chunk",
            "created": self.get_created_timestamp(),
            "model": self.model,
            "choices": [{
                "index": 0,
                "delta": {
                    "tool_calls": [tool_call]
                },
                "finish_reason": null
            }]
        });
        format!("data: {chunk}\n\n")
    }

    fn create_openai_finish_chunk(
        &self,
        finish_reason: &str,
        usage: Option<serde_json::Value>,
    ) -> String {
        let mut chunk = serde_json::json!({
            "id": self.response_id,
            "object": "chat.completion.chunk",
            "created": self.get_created_timestamp(),
            "model": self.model,
            "choices": [{
                "index": 0,
                "delta": {},
                "finish_reason": finish_reason
            }]
        });
        if let Some(usage) = usage {
            chunk["usage"] = usage;
        }
        format!("data: {chunk}\n\n")
    }

    fn capture_anthropic_message_start_usage(&mut self, event: &serde_json::Value) {
        let Some(usage) = event
            .get("message")
            .and_then(|message| message.get("usage"))
        else {
            return;
        };

        self.anthropic_usage
            .get_or_insert_with(AnthropicUsageState::default)
            .apply_usage_object(usage);
    }

    fn capture_anthropic_message_delta_state(&mut self, event: &serde_json::Value) {
        if let Some(usage) = event.get("usage") {
            self.anthropic_usage
                .get_or_insert_with(AnthropicUsageState::default)
                .apply_usage_object(usage);
        }

        if let Some(stop_reason) = event
            .get("delta")
            .and_then(|delta| delta.get("stop_reason"))
            .and_then(|stop_reason| stop_reason.as_str())
        {
            self.anthropic_finish_reason = Some(map_anthropic_stop_reason(stop_reason).to_string());
        }
    }

    fn anthropic_openai_usage_json(&self) -> Option<serde_json::Value> {
        let usage = self.anthropic_usage.as_ref()?;
        let prompt_tokens = usage.prompt_tokens();
        let completion_tokens = usage.output_tokens;

        let mut openai_usage = serde_json::json!({
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": usage.total_tokens()
        });

        if usage.cache_read_input_tokens > 0 {
            openai_usage["prompt_tokens_details"] = serde_json::json!({
                "cached_tokens": usage.cache_read_input_tokens
            });
        }

        Some(openai_usage)
    }
}

// ============================================================================
// 辅助函数
// ============================================================================

fn map_anthropic_stop_reason(stop_reason: &str) -> &'static str {
    match stop_reason {
        "max_tokens" => "length",
        "tool_use" => "tool_calls",
        _ => "stop",
    }
}

/// 从 SSE 事件列表中提取所有文本内容
pub fn extract_content_from_sse(events: &[String], format: StreamFormat) -> String {
    let mut content = String::new();

    for event in events {
        match format {
            StreamFormat::OpenAiSse => {
                for line in event.lines() {
                    if let Some(json_str) = line.strip_prefix("data: ") {
                        if json_str == "[DONE]" {
                            continue;
                        }
                        if let Ok(chunk) = serde_json::from_str::<serde_json::Value>(json_str) {
                            if let Some(choices) = chunk.get("choices").and_then(|c| c.as_array()) {
                                for choice in choices {
                                    if let Some(delta) = choice.get("delta") {
                                        if let Some(text) =
                                            delta.get("content").and_then(|c| c.as_str())
                                        {
                                            content.push_str(text);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            StreamFormat::AnthropicSse => {
                for line in event.lines() {
                    if let Some(json_str) = line.strip_prefix("data: ") {
                        if let Ok(evt) = serde_json::from_str::<serde_json::Value>(json_str) {
                            if evt.get("type").and_then(|t| t.as_str())
                                == Some("content_block_delta")
                            {
                                if let Some(delta) = evt.get("delta") {
                                    if let Some(text) = delta.get("text").and_then(|t| t.as_str()) {
                                        content.push_str(text);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            StreamFormat::AwsEventStream => {
                // AWS Event Stream 不是 SSE 格式
            }
        }
    }

    content
}

/// 从 SSE 事件列表中提取所有工具调用
pub fn extract_tool_calls_from_sse(
    events: &[String],
    format: StreamFormat,
) -> Vec<(String, String, String)> {
    let mut tool_calls: HashMap<String, (String, String)> = HashMap::new();

    for event in events {
        match format {
            StreamFormat::OpenAiSse => {
                for line in event.lines() {
                    if let Some(json_str) = line.strip_prefix("data: ") {
                        if json_str == "[DONE]" {
                            continue;
                        }
                        if let Ok(chunk) = serde_json::from_str::<serde_json::Value>(json_str) {
                            if let Some(choices) = chunk.get("choices").and_then(|c| c.as_array()) {
                                for choice in choices {
                                    if let Some(delta) = choice.get("delta") {
                                        if let Some(tcs) =
                                            delta.get("tool_calls").and_then(|t| t.as_array())
                                        {
                                            for tc in tcs {
                                                let id = tc
                                                    .get("id")
                                                    .and_then(|i| i.as_str())
                                                    .unwrap_or("");
                                                let name = tc
                                                    .get("function")
                                                    .and_then(|f| f.get("name"))
                                                    .and_then(|n| n.as_str())
                                                    .unwrap_or("");
                                                let args = tc
                                                    .get("function")
                                                    .and_then(|f| f.get("arguments"))
                                                    .and_then(|a| a.as_str())
                                                    .unwrap_or("");

                                                if !id.is_empty() {
                                                    tool_calls
                                                        .entry(id.to_string())
                                                        .or_insert((String::new(), String::new()))
                                                        .0 = name.to_string();
                                                }
                                                if !args.is_empty() {
                                                    if let Some(entry) =
                                                        tool_calls.values_mut().last()
                                                    {
                                                        entry.1.push_str(args);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            StreamFormat::AnthropicSse | StreamFormat::AwsEventStream => {
                // 简化处理
            }
        }
    }

    tool_calls
        .into_iter()
        .map(|(id, (name, args))| (id, name, args))
        .collect()
}

// ============================================================================
// 测试模块
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_openai_sse_payload(event: &str) -> serde_json::Value {
        let json_str = event
            .lines()
            .find_map(|line| line.strip_prefix("data: "))
            .expect("expected data line");
        serde_json::from_str(json_str).expect("expected valid SSE json payload")
    }

    #[test]
    fn test_converter_new() {
        let converter = StreamConverter::new(StreamFormat::AwsEventStream, StreamFormat::OpenAiSse);
        assert_eq!(converter.state(), &ConverterState::Idle);
        assert!(converter.aws_parser.is_some());
    }

    #[test]
    fn test_converter_with_model() {
        let converter = StreamConverter::with_model(
            StreamFormat::AwsEventStream,
            StreamFormat::OpenAiSse,
            "claude-3-opus",
        );
        assert_eq!(converter.model, "claude-3-opus");
    }

    #[test]
    fn test_converter_reset() {
        let mut converter =
            StreamConverter::new(StreamFormat::AwsEventStream, StreamFormat::OpenAiSse);
        converter.convert(b"{\"content\":\"test\"}");
        assert_eq!(converter.state(), &ConverterState::Converting);

        converter.reset();
        assert_eq!(converter.state(), &ConverterState::Idle);
        assert!(converter.accumulated_content.is_empty());
    }

    #[test]
    fn test_aws_to_openai_content() {
        let mut converter = StreamConverter::with_model(
            StreamFormat::AwsEventStream,
            StreamFormat::OpenAiSse,
            "test-model",
        );

        let events = converter.convert(b"{\"content\":\"Hello, world!\"}");
        assert!(!events.is_empty());

        let content = extract_content_from_sse(&events, StreamFormat::OpenAiSse);
        assert_eq!(content, "Hello, world!");
        assert_eq!(converter.accumulated_content(), "Hello, world!");
    }

    #[test]
    fn test_aws_to_openai_multiple_content() {
        let mut converter = StreamConverter::with_model(
            StreamFormat::AwsEventStream,
            StreamFormat::OpenAiSse,
            "test-model",
        );

        let events1 = converter.convert(b"{\"content\":\"Hello\"}");
        let events2 = converter.convert(b"{\"content\":\", world!\"}");

        let all_events: Vec<_> = events1.into_iter().chain(events2).collect();
        let content = extract_content_from_sse(&all_events, StreamFormat::OpenAiSse);
        assert_eq!(content, "Hello, world!");
    }

    #[test]
    fn test_aws_to_openai_tool_call() {
        let mut converter = StreamConverter::with_model(
            StreamFormat::AwsEventStream,
            StreamFormat::OpenAiSse,
            "test-model",
        );

        // 工具调用开始
        let events1 = converter.convert(b"{\"toolUseId\":\"tool_1\",\"name\":\"read_file\"}");
        assert!(!events1.is_empty());

        // 工具调用输入
        let events2 = converter
            .convert(b"{\"toolUseId\":\"tool_1\",\"input\":\"{\\\"path\\\":\\\"/tmp\\\"}\"}");
        assert!(!events2.is_empty());

        // 工具调用结束
        let events3 = converter.convert(b"{\"toolUseId\":\"tool_1\",\"stop\":true}");

        let all_events: Vec<_> = events1.into_iter().chain(events2).chain(events3).collect();

        // 验证工具调用存在
        let has_tool_call = all_events.iter().any(|e| e.contains("tool_calls"));
        assert!(has_tool_call);
    }

    #[test]
    fn test_aws_to_anthropic_content() {
        let mut converter = StreamConverter::with_model(
            StreamFormat::AwsEventStream,
            StreamFormat::AnthropicSse,
            "test-model",
        );

        let events = converter.convert(b"{\"content\":\"Hello!\"}");

        // 应该有 message_start, content_block_start, content_block_delta
        assert!(events.iter().any(|e| e.contains("message_start")));
        assert!(events.iter().any(|e| e.contains("content_block_start")));
        assert!(events.iter().any(|e| e.contains("content_block_delta")));

        let content = extract_content_from_sse(&events, StreamFormat::AnthropicSse);
        assert_eq!(content, "Hello!");
    }

    #[test]
    fn test_aws_to_anthropic_tool_call() {
        let mut converter = StreamConverter::with_model(
            StreamFormat::AwsEventStream,
            StreamFormat::AnthropicSse,
            "test-model",
        );

        // 工具调用开始
        let events1 = converter.convert(b"{\"toolUseId\":\"tool_1\",\"name\":\"test_tool\"}");
        assert!(events1.iter().any(|e| e.contains("tool_use")));

        // 工具调用输入
        let events2 = converter
            .convert(b"{\"toolUseId\":\"tool_1\",\"input\":\"{\\\"key\\\":\\\"value\\\"}\"}");
        assert!(events2.iter().any(|e| e.contains("input_json_delta")));

        // 工具调用结束
        let events3 = converter.convert(b"{\"toolUseId\":\"tool_1\",\"stop\":true}");
        assert!(events3.iter().any(|e| e.contains("content_block_stop")));
    }

    #[test]
    fn test_converter_finish() {
        let mut converter = StreamConverter::with_model(
            StreamFormat::AwsEventStream,
            StreamFormat::OpenAiSse,
            "test-model",
        );

        converter.convert(b"{\"content\":\"test\"}");
        let finish_events = converter.finish();

        // 应该有结束事件
        assert!(finish_events.iter().any(|e| e.contains("finish_reason")));
        assert!(finish_events.iter().any(|e| e.contains("[DONE]")));
        assert_eq!(converter.state(), &ConverterState::Completed);
    }

    #[test]
    fn test_partial_json_accumulator() {
        let mut acc = PartialJsonAccumulator::new();

        // 追加部分 JSON
        assert!(!acc.append("{\"key\":"));
        assert!(!acc.is_complete());

        assert!(acc.append("\"value\"}"));
        assert!(acc.is_complete());
        assert_eq!(acc.get_json(), "{\"key\":\"value\"}");
    }

    #[test]
    fn test_partial_json_accumulator_nested() {
        let mut acc = PartialJsonAccumulator::new();

        assert!(!acc.append("{\"outer\":{\"inner\":"));
        assert!(!acc.append("\"value\""));
        assert!(acc.append("}}"));
        assert!(acc.is_complete());
    }

    #[test]
    fn test_partial_json_accumulator_with_string_braces() {
        let mut acc = PartialJsonAccumulator::new();

        // JSON 字符串中包含括号
        assert!(acc.append("{\"text\":\"hello {world}\"}"));
        assert!(acc.is_complete());
    }

    #[test]
    fn test_partial_json_accumulator_reset() {
        let mut acc = PartialJsonAccumulator::new();
        acc.append("{\"key\":\"value\"}");

        acc.reset();
        assert!(acc.is_empty());
        assert!(!acc.is_complete());
    }

    #[test]
    fn test_extract_content_from_openai_sse() {
        let events = vec![
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\n".to_string(),
            "data: {\"choices\":[{\"delta\":{\"content\":\", world!\"}}]}\n\n".to_string(),
            "data: [DONE]\n\n".to_string(),
        ];

        let content = extract_content_from_sse(&events, StreamFormat::OpenAiSse);
        assert_eq!(content, "Hello, world!");
    }

    #[test]
    fn test_extract_content_from_anthropic_sse() {
        let events = vec![
            "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"Hello\"}}\n\n".to_string(),
            "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\", world!\"}}\n\n".to_string(),
        ];

        let content = extract_content_from_sse(&events, StreamFormat::AnthropicSse);
        assert_eq!(content, "Hello, world!");
    }

    #[test]
    fn test_incremental_conversion() {
        let mut converter = StreamConverter::with_model(
            StreamFormat::AwsEventStream,
            StreamFormat::OpenAiSse,
            "test-model",
        );

        // 分片发送 JSON
        let events1 = converter.convert(b"{\"content\":");
        assert!(events1.is_empty()); // 不完整的 JSON 不产生事件

        let events2 = converter.convert(b"\"test\"}");
        assert!(!events2.is_empty()); // 完整的 JSON 产生事件

        let content = extract_content_from_sse(&events2, StreamFormat::OpenAiSse);
        assert_eq!(content, "test");
    }

    #[test]
    fn test_anthropic_to_openai_finish_chunk_includes_cache_aware_usage() {
        let mut converter = StreamConverter::with_model(
            StreamFormat::AnthropicSse,
            StreamFormat::OpenAiSse,
            "claude-3-7-sonnet",
        );

        let start_events = converter.convert(
            br#"event: message_start
data: {"type":"message_start","message":{"id":"msg_test","type":"message","role":"assistant","model":"claude-3-7-sonnet","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":120,"output_tokens":0,"cache_read_input_tokens":80,"cache_creation_input_tokens":16}}}

"#,
        );
        assert!(start_events.is_empty());

        let delta_events = converter.convert(
            br#"event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":24}}

"#,
        );
        assert!(delta_events.is_empty());

        let stop_events = converter.convert(
            br#"event: message_stop
data: {"type":"message_stop"}

"#,
        );

        assert_eq!(stop_events.len(), 2);
        assert_eq!(stop_events[1], "data: [DONE]\n\n");

        let finish_payload = parse_openai_sse_payload(&stop_events[0]);
        assert_eq!(finish_payload["choices"][0]["finish_reason"], "stop");
        assert_eq!(finish_payload["usage"]["prompt_tokens"], 216);
        assert_eq!(finish_payload["usage"]["completion_tokens"], 24);
        assert_eq!(finish_payload["usage"]["total_tokens"], 240);
        assert_eq!(
            finish_payload["usage"]["prompt_tokens_details"]["cached_tokens"],
            80
        );

        assert!(converter.finish().is_empty());
    }

    #[test]
    fn test_anthropic_to_openai_tool_use_finish_reason_maps_to_tool_calls() {
        let mut converter = StreamConverter::with_model(
            StreamFormat::AnthropicSse,
            StreamFormat::OpenAiSse,
            "claude-3-7-sonnet",
        );

        let delta_events = converter.convert(
            br#"event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":7}}

"#,
        );
        assert!(delta_events.is_empty());

        let stop_events = converter.convert(
            br#"event: message_stop
data: {"type":"message_stop"}

"#,
        );

        let finish_payload = parse_openai_sse_payload(&stop_events[0]);
        assert_eq!(finish_payload["choices"][0]["finish_reason"], "tool_calls");
        assert_eq!(finish_payload["usage"]["completion_tokens"], 7);
    }

    #[test]
    fn test_converter_state_transitions() {
        let mut converter =
            StreamConverter::new(StreamFormat::AwsEventStream, StreamFormat::OpenAiSse);

        assert_eq!(converter.state(), &ConverterState::Idle);

        converter.convert(b"{\"content\":\"test\"}");
        assert_eq!(converter.state(), &ConverterState::Converting);

        converter.finish();
        assert_eq!(converter.state(), &ConverterState::Completed);

        converter.reset();
        assert_eq!(converter.state(), &ConverterState::Idle);
    }
}

// ============================================================================
// 属性测试（Property-Based Testing）
// ============================================================================

#[cfg(test)]
mod property_tests {
    use super::*;
    use crate::streaming::aws_parser::{extract_content, serialize_event, AwsEvent};
    use proptest::prelude::*;

    // ========================================================================
    // 生成器（Generators）
    // ========================================================================

    /// 生成有效的内容文本
    fn arb_content_text() -> impl Strategy<Value = String> {
        prop::string::string_regex("[a-zA-Z0-9\\u4e00-\\u9fff .,!?\\-_]{1,100}")
            .unwrap()
            .prop_filter("非空字符串", |s| !s.is_empty())
    }

    /// 生成有效的工具 ID
    fn arb_tool_id() -> impl Strategy<Value = String> {
        prop::string::string_regex("tool_[a-zA-Z0-9]{4,12}").unwrap()
    }

    /// 生成有效的工具名称
    fn arb_tool_name() -> impl Strategy<Value = String> {
        prop::string::string_regex("[a-z_][a-z0-9_]{2,20}").unwrap()
    }

    /// 生成有效的工具输入（简单 JSON）
    fn arb_tool_input() -> impl Strategy<Value = String> {
        prop::string::string_regex(r#"\{"[a-z]+":"[a-zA-Z0-9]+"\}"#).unwrap()
    }

    /// 生成 Content 事件
    fn arb_content_event() -> impl Strategy<Value = AwsEvent> {
        arb_content_text().prop_map(|text| AwsEvent::Content { text })
    }

    /// 生成内容事件序列
    fn arb_content_sequence() -> impl Strategy<Value = Vec<AwsEvent>> {
        prop::collection::vec(arb_content_event(), 1..10)
    }

    // ========================================================================
    // Property 2: 流式格式转换内容保留
    //
    // *对于任意*流式响应内容，从 AWS Event Stream 转换为 Anthropic SSE 或
    // OpenAI SSE 后，最终重建的内容应该与原始内容一致。
    //
    // **验证: 需求 3.1, 3.2, 3.3**
    // ========================================================================

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        /// Property 2: AWS 到 OpenAI 转换保留内容
        ///
        /// **Feature: true-streaming-support, Property 2: 流式格式转换内容保留**
        /// **Validates: Requirements 3.2**
        #[test]
        fn prop_aws_to_openai_content_preservation(events in arb_content_sequence()) {
            // 计算原始内容
            let original_content = extract_content(&events);

            // 创建转换器
            let mut converter = StreamConverter::with_model(
                StreamFormat::AwsEventStream,
                StreamFormat::OpenAiSse,
                "test-model",
            );

            // 将所有事件序列化并转换
            let mut all_sse_events = Vec::new();
            for event in &events {
                if let Some(json) = serialize_event(event) {
                    let sse_events = converter.convert(json.as_bytes());
                    all_sse_events.extend(sse_events);
                }
            }
            all_sse_events.extend(converter.finish());

            // 从 SSE 事件中提取内容
            let converted_content = extract_content_from_sse(&all_sse_events, StreamFormat::OpenAiSse);

            // 验证内容一致
            prop_assert_eq!(
                original_content,
                converted_content,
                "AWS 到 OpenAI 转换应该保留内容"
            );
        }

        /// Property 2: AWS 到 Anthropic 转换保留内容
        ///
        /// **Feature: true-streaming-support, Property 2: 流式格式转换内容保留**
        /// **Validates: Requirements 3.1**
        #[test]
        fn prop_aws_to_anthropic_content_preservation(events in arb_content_sequence()) {
            // 计算原始内容
            let original_content = extract_content(&events);

            // 创建转换器
            let mut converter = StreamConverter::with_model(
                StreamFormat::AwsEventStream,
                StreamFormat::AnthropicSse,
                "test-model",
            );

            // 将所有事件序列化并转换
            let mut all_sse_events = Vec::new();
            for event in &events {
                if let Some(json) = serialize_event(event) {
                    let sse_events = converter.convert(json.as_bytes());
                    all_sse_events.extend(sse_events);
                }
            }
            all_sse_events.extend(converter.finish());

            // 从 SSE 事件中提取内容
            let converted_content = extract_content_from_sse(&all_sse_events, StreamFormat::AnthropicSse);

            // 验证内容一致
            prop_assert_eq!(
                original_content,
                converted_content,
                "AWS 到 Anthropic 转换应该保留内容"
            );
        }

        /// Property 2: 转换器累积内容与原始内容一致
        ///
        /// **Feature: true-streaming-support, Property 2: 流式格式转换内容保留**
        /// **Validates: Requirements 3.1, 3.2**
        #[test]
        fn prop_converter_accumulated_content_matches(
            events in arb_content_sequence(),
            target in prop_oneof![Just(StreamFormat::OpenAiSse), Just(StreamFormat::AnthropicSse)]
        ) {
            // 计算原始内容
            let original_content = extract_content(&events);

            // 创建转换器
            let mut converter = StreamConverter::with_model(
                StreamFormat::AwsEventStream,
                target,
                "test-model",
            );

            // 将所有事件序列化并转换
            for event in &events {
                if let Some(json) = serialize_event(event) {
                    converter.convert(json.as_bytes());
                }
            }
            converter.finish();

            // 验证累积内容一致
            prop_assert_eq!(
                original_content,
                converter.accumulated_content(),
                "转换器累积的内容应该与原始内容一致"
            );
        }
    }

    // ========================================================================
    // Property 4: 部分 JSON 处理正确性
    //
    // *对于任意*有效的 JSON 字符串，将其分割成任意多个部分后，
    // 解析器应该能正确累积并最终产生完整的 JSON。
    //
    // **验证: 需求 3.5**
    // ========================================================================

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        /// Property 4: 部分 JSON 累积正确性
        ///
        /// **Feature: true-streaming-support, Property 4: 部分 JSON 处理正确性**
        /// **Validates: Requirements 3.5**
        #[test]
        fn prop_partial_json_accumulation(
            key in "[a-z]{1,10}",
            value in "[a-zA-Z0-9]{1,20}",
            split_points in prop::collection::vec(1usize..50, 1..5)
        ) {
            let json = format!("{{\"{key}\":\"{value}\"}}");
            let bytes = json.as_bytes();

            let mut acc = PartialJsonAccumulator::new();

            // 根据分割点将 JSON 分成多个部分
            let mut last_pos = 0;
            for &split_point in &split_points {
                let split_pos = split_point.min(bytes.len());
                if split_pos > last_pos && split_pos < bytes.len() {
                    let part = std::str::from_utf8(&bytes[last_pos..split_pos]).unwrap_or("");
                    acc.append(part);
                    last_pos = split_pos;
                }
            }

            // 追加剩余部分
            if last_pos < bytes.len() {
                let remaining = std::str::from_utf8(&bytes[last_pos..]).unwrap_or("");
                acc.append(remaining);
            }

            // 验证累积的 JSON 与原始 JSON 一致
            prop_assert_eq!(
                acc.get_json(),
                &json,
                "累积的 JSON 应该与原始 JSON 一致"
            );

            // 验证 JSON 完整性
            prop_assert!(
                acc.is_complete(),
                "累积完成后 JSON 应该是完整的"
            );
        }

        /// Property 4: 嵌套 JSON 部分累积
        ///
        /// **Feature: true-streaming-support, Property 4: 部分 JSON 处理正确性**
        /// **Validates: Requirements 3.5**
        #[test]
        fn prop_nested_json_partial_accumulation(
            outer_key in "[a-z]{1,5}",
            inner_key in "[a-z]{1,5}",
            value in "[a-zA-Z0-9]{1,10}",
            chunk_size in 1usize..10
        ) {
            let json = format!("{{\"{outer_key}\":{{\"{inner_key}\":\"{value}\"}}}}");
            let bytes = json.as_bytes();

            let mut acc = PartialJsonAccumulator::new();

            // 按固定大小分块
            for chunk in bytes.chunks(chunk_size) {
                let part = std::str::from_utf8(chunk).unwrap_or("");
                acc.append(part);
            }

            // 验证累积的 JSON 与原始 JSON 一致
            prop_assert_eq!(
                acc.get_json(),
                &json,
                "嵌套 JSON 累积应该与原始一致"
            );

            prop_assert!(
                acc.is_complete(),
                "嵌套 JSON 累积完成后应该是完整的"
            );
        }

        /// Property 4: 包含字符串括号的 JSON 部分累积
        ///
        /// **Feature: true-streaming-support, Property 4: 部分 JSON 处理正确性**
        /// **Validates: Requirements 3.5**
        #[test]
        fn prop_json_with_braces_in_string(
            key in "[a-z]{1,5}",
            prefix in "[a-zA-Z0-9]{0,5}",
            suffix in "[a-zA-Z0-9]{0,5}",
            chunk_size in 1usize..15
        ) {
            // 创建包含括号的字符串值
            let json = format!("{{\"{key}\":\"{prefix}{{}}[]{suffix}\"}}");
            let bytes = json.as_bytes();

            let mut acc = PartialJsonAccumulator::new();

            // 按固定大小分块
            for chunk in bytes.chunks(chunk_size) {
                let part = std::str::from_utf8(chunk).unwrap_or("");
                acc.append(part);
            }

            // 验证累积的 JSON 与原始 JSON 一致
            prop_assert_eq!(
                acc.get_json(),
                &json,
                "包含括号的字符串 JSON 累积应该与原始一致"
            );

            prop_assert!(
                acc.is_complete(),
                "包含括号的字符串 JSON 累积完成后应该是完整的"
            );
        }

        /// Property 4: 重置后重新累积
        ///
        /// **Feature: true-streaming-support, Property 4: 部分 JSON 处理正确性**
        /// **Validates: Requirements 3.5**
        #[test]
        fn prop_reset_and_reaccumulate(
            key1 in "[a-z]{1,5}",
            value1 in "[a-zA-Z0-9]{1,10}",
            key2 in "[a-z]{1,5}",
            value2 in "[a-zA-Z0-9]{1,10}"
        ) {
            let json1 = format!("{{\"{key1}\":\"{value1}\"}}");
            let json2 = format!("{{\"{key2}\":\"{value2}\"}}");

            let mut acc = PartialJsonAccumulator::new();

            // 累积第一个 JSON
            acc.append(&json1);
            prop_assert_eq!(acc.get_json(), &json1);
            prop_assert!(acc.is_complete());

            // 重置
            acc.reset();
            prop_assert!(acc.is_empty());
            prop_assert!(!acc.is_complete());

            // 累积第二个 JSON
            acc.append(&json2);
            prop_assert_eq!(acc.get_json(), &json2);
            prop_assert!(acc.is_complete());
        }
    }
}
