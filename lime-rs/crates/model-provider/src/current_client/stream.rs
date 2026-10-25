use super::{CurrentProviderCustomToolCall, CurrentProviderError, CurrentProviderToolCall};
use agent_protocol::{anthropic, openai};
use async_stream::try_stream;
use futures::{Stream, StreamExt};
use reqwest::Response;
use runtime_core::{
    CanonicalLlmEvent as LlmEvent, FailureClassification, FinishReason, ModelVerification, Usage,
};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::time::Duration;

mod anthropic_stream;
mod call_identity;

pub(super) use anthropic_stream::anthropic_sse;
mod hosted_tools;
mod responses;

#[cfg(test)]
pub(super) use responses::response_item_tool_call;
pub(super) use responses::{responses_sse, ResponsesEventReducer};

use call_identity::ResponseCallIdentity;
use hosted_tools::{hosted_tool_events, HostedToolState};

pub(super) const DEFAULT_STREAM_IDLE_TIMEOUT: Duration = Duration::from_secs(300);
const OPENAI_FINISH_TRAILER_TIMEOUT: Duration = Duration::from_secs(1);

#[derive(Debug, Default)]
struct ToolCallAccumulator {
    id: Option<String>,
    name: Option<String>,
    arguments: String,
    emitted: bool,
    started: bool,
}

impl ToolCallAccumulator {
    fn call_id(&self, fallback: &str) -> String {
        self.id.clone().unwrap_or_else(|| fallback.to_string())
    }

    fn into_call(&mut self, fallback: &str) -> Option<CurrentProviderToolCall> {
        if self.emitted {
            return None;
        }
        let call = CurrentProviderToolCall::from_raw(
            self.call_id(fallback),
            self.name.clone().unwrap_or_default(),
            self.arguments.clone(),
        );
        self.emitted = true;
        Some(call)
    }

    fn begin_input_if_ready(&mut self, fallback: &str) -> Option<(String, String, String)> {
        if self.started || self.arguments.is_empty() {
            return None;
        }
        let name = self.name.as_deref()?;
        if name.trim().is_empty() {
            return None;
        }
        self.started = true;
        Some((
            self.call_id(fallback),
            name.to_string(),
            self.arguments.clone(),
        ))
    }
}

#[derive(Debug, Default)]
struct CustomToolCallAccumulator {
    id: Option<String>,
    name: Option<String>,
    namespace: Option<String>,
    input: String,
    emitted: bool,
    started: bool,
}

impl CustomToolCallAccumulator {
    fn call_id(&self, fallback: &str) -> String {
        self.id.clone().unwrap_or_else(|| fallback.to_string())
    }

    fn into_call(&mut self, fallback: &str) -> Option<CurrentProviderCustomToolCall> {
        if self.emitted {
            return None;
        }
        let call = CurrentProviderCustomToolCall {
            id: self.call_id(fallback),
            name: self.name.clone().unwrap_or_default(),
            input: self.input.clone(),
            namespace: self.namespace.clone(),
            provider_metadata: Default::default(),
        };
        self.emitted = true;
        Some(call)
    }

    fn begin_input_if_ready(&mut self, fallback: &str) -> Option<(String, String, String)> {
        if self.started || self.input.is_empty() {
            return None;
        }
        let name = self.name.as_deref()?;
        if name.trim().is_empty() {
            return None;
        }
        self.started = true;
        Some((self.call_id(fallback), name.to_string(), self.input.clone()))
    }
}

#[derive(Debug, Default)]
struct OpenAiStreamState {
    response_id: Option<String>,
    calls: BTreeMap<u32, ToolCallAccumulator>,
    emitted_tool_call: bool,
    usage: Option<Usage>,
    text_ids: HashSet<String>,
    reasoning_ids: HashSet<String>,
    finish_reason: Option<FinishReason>,
}

pub(super) fn openai_chat_sse(
    response: Response,
) -> impl Stream<Item = Result<LlmEvent, CurrentProviderError>> + Send {
    try_stream! {
        let mut state = OpenAiStreamState::default();
        let mut frames = Box::pin(sse_frames(response));
        while let Some(frame) = frames.next().await {
            let frame = frame?;
            if frame.data.trim() == "[DONE]" {
                drop(frames);
                for event in finish_openai_stream(&mut state)? {
                    yield event;
                }
                return;
            }
            let chunk = serde_json::from_str::<openai::ChatCompletionChunk>(&frame.data)
                .map_err(|error| CurrentProviderError::new(format!("解析 OpenAI SSE chunk 失败: {error}")))?;
            if let Some(response_id) = chunk.id.filter(|value| !value.trim().is_empty()) {
                state.response_id = Some(response_id);
            }
            if let Some(usage) = chunk.usage {
                let usage = openai_usage(usage);
                yield LlmEvent::Usage { usage: usage.clone() };
                state.usage = Some(usage);
            }
            for choice in chunk.choices {
                let text_id = format!("text-{}", choice.index);
                if let Some(text) = choice.delta.content.filter(|value| !value.is_empty()) {
                    if state.text_ids.insert(text_id.clone()) {
                        yield LlmEvent::TextStart { id: text_id.clone() };
                    }
                    yield LlmEvent::TextDelta { id: text_id, text };
                }
                let reasoning_id = format!("reasoning-{}", choice.index);
                if let Some(reasoning) = choice.delta.reasoning_content.filter(|value| !value.is_empty()) {
                    if state.reasoning_ids.insert(reasoning_id.clone()) {
                        yield LlmEvent::ReasoningStart { id: reasoning_id.clone() };
                    }
                    yield LlmEvent::ReasoningContentDelta {
                        id: reasoning_id,
                        text: reasoning,
                        content_index: 0,
                    };
                }
                for delta in choice.delta.tool_calls.unwrap_or_default() {
                    let index = delta.index;
                    let id = delta.id.filter(|value| !value.trim().is_empty());
                    let name = delta
                        .function
                        .name
                        .filter(|value| !value.trim().is_empty());
                    let arguments = delta
                        .function
                        .arguments
                        .filter(|value| !value.is_empty());
                    if id.is_none() && name.is_none() && arguments.is_none() {
                        continue;
                    }
                    let call = state.calls.entry(index).or_default();
                    if id.is_some() { call.id = id; }
                    if name.is_some() { call.name = name; }
                    if let Some(arguments) = arguments.as_ref() {
                        call.arguments.push_str(&arguments);
                    }
                    if let Some((call_id, name, buffered_arguments)) =
                        call.begin_input_if_ready(&format!("call_{index}"))
                    {
                        yield LlmEvent::ToolInputStart { id: call_id.clone(), name: name.clone() };
                        yield LlmEvent::ToolInputDelta {
                            id: call_id,
                            name,
                            text: buffered_arguments,
                        };
                    } else if call.started {
                        if let (Some(name), Some(arguments)) = (call.name.clone(), arguments) {
                            yield LlmEvent::ToolInputDelta {
                                id: call.call_id(&format!("call_{index}")),
                                name,
                                text: arguments,
                            };
                        }
                    }
                }
                if choice.finish_reason.as_deref() == Some("tool_calls") {
                    for event in take_openai_calls(&mut state)? {
                        yield event;
                    }
                }
                if let Some(reason) = choice.finish_reason.as_deref() {
                    state.finish_reason = Some(openai_finish_reason(reason));
                }
            }
            if state.finish_reason.is_some() {
                if let Ok(Some(Ok(frame))) = tokio::time::timeout(
                    OPENAI_FINISH_TRAILER_TIMEOUT,
                    frames.next(),
                )
                .await
                {
                    absorb_openai_usage_frame(&mut state, &frame.data);
                }
                drop(frames);
                for event in finish_openai_stream(&mut state)? {
                    yield event;
                }
                return;
            }
        }
        for id in state.text_ids.drain() { yield LlmEvent::TextEnd { id }; }
        for id in state.reasoning_ids.drain() { yield LlmEvent::ReasoningEnd { id }; }
        yield truncated_stream_error("OpenAI Chat Completions");
    }
}

fn openai_finish_reason(reason: &str) -> FinishReason {
    match reason {
        "stop" => FinishReason::Stop,
        "tool_calls" | "function_call" => FinishReason::ToolCall,
        "length" => FinishReason::Length,
        "content_filter" => FinishReason::ContentFilter,
        _ => FinishReason::Unknown,
    }
}

fn take_openai_calls(state: &mut OpenAiStreamState) -> Result<Vec<LlmEvent>, CurrentProviderError> {
    let mut events = Vec::new();
    for (index, call) in &mut state.calls {
        if let Some((id, name, arguments)) = call.begin_input_if_ready(&format!("call_{index}")) {
            events.push(LlmEvent::ToolInputStart {
                id: id.clone(),
                name: name.clone(),
            });
            events.push(LlmEvent::ToolInputDelta {
                id,
                name,
                text: arguments,
            });
        }
        let Some(tool_call) = call.into_call(&format!("call_{index}")) else {
            continue;
        };
        state.emitted_tool_call = true;
        events.push(LlmEvent::ToolInputEnd {
            id: tool_call.id.clone(),
            name: tool_call.name.clone(),
        });
        events.push(LlmEvent::ToolCall {
            id: tool_call.id,
            name: tool_call.name,
            input: tool_call.arguments,
            raw_arguments: Some(tool_call.raw_arguments),
            provider_executed: None,
            provider_metadata: Default::default(),
        });
    }
    Ok(events)
}

fn finish_openai_stream(
    state: &mut OpenAiStreamState,
) -> Result<Vec<LlmEvent>, CurrentProviderError> {
    let mut events = Vec::new();
    events.extend(state.text_ids.drain().map(|id| LlmEvent::TextEnd { id }));
    events.extend(
        state
            .reasoning_ids
            .drain()
            .map(|id| LlmEvent::ReasoningEnd { id }),
    );
    events.extend(take_openai_calls(state)?);
    events.push(LlmEvent::Finish {
        reason: state.finish_reason.unwrap_or_else(|| {
            if state.emitted_tool_call {
                FinishReason::ToolCall
            } else {
                FinishReason::Stop
            }
        }),
        usage: state.usage.take(),
        needs_follow_up: false,
        response_id: state.response_id.clone(),
    });
    Ok(events)
}

fn absorb_openai_usage_frame(state: &mut OpenAiStreamState, data: &str) {
    if data.trim() == "[DONE]" {
        return;
    }

    let Ok(chunk) = serde_json::from_str::<openai::ChatCompletionChunk>(data) else {
        return;
    };
    if let Some(usage) = chunk.usage {
        state.usage = Some(openai_usage(usage));
    }
}

fn openai_usage(usage: openai::StreamUsage) -> Usage {
    Usage {
        input_tokens: Some(usage.prompt_tokens as u64),
        output_tokens: Some(usage.completion_tokens as u64),
        cache_read_input_tokens: usage
            .prompt_tokens_details
            .and_then(|details| details.cached_tokens)
            .map(u64::from),
        total_tokens: Some(usage.total_tokens as u64),
        ..Usage::default()
    }
}

fn anthropic_finish_reason(reason: &str) -> FinishReason {
    match reason {
        "end_turn" | "stop_sequence" => FinishReason::Stop,
        "tool_use" => FinishReason::ToolCall,
        "max_tokens" => FinishReason::Length,
        "refusal" => FinishReason::ContentFilter,
        _ => FinishReason::Unknown,
    }
}

fn truncated_stream_error(protocol: &str) -> LlmEvent {
    LlmEvent::ProviderError {
        message: format!("{protocol} stream ended before its terminal event"),
        classification: Some(FailureClassification::Transport),
        retryable: Some(true),
    }
}

fn anthropic_usage(usage: anthropic::AnthropicUsage) -> Usage {
    Usage {
        input_tokens: Some(usage.input_tokens as u64),
        output_tokens: Some(usage.output_tokens as u64),
        cache_read_input_tokens: usage.cache_read_input_tokens.map(u64::from),
        cache_write_input_tokens: usage.cache_creation_input_tokens.map(u64::from),
        ..Usage::default()
    }
}

#[derive(Debug)]
pub(super) struct SseFrame {
    pub(super) data: String,
}

fn sse_frames(
    response: Response,
) -> impl Stream<Item = Result<SseFrame, CurrentProviderError>> + Send {
    sse_frames_with_idle_timeout(response, DEFAULT_STREAM_IDLE_TIMEOUT)
}

pub(super) fn sse_frames_with_idle_timeout(
    response: Response,
    idle_timeout: Duration,
) -> impl Stream<Item = Result<SseFrame, CurrentProviderError>> + Send {
    try_stream! {
        let mut pending = Vec::new();
        let mut bytes = response.bytes_stream();
        loop {
            let next = tokio::time::timeout(idle_timeout, bytes.next())
                .await
                .map_err(|_| CurrentProviderError::new(format!(
                    "读取 provider SSE 超时: {} ms 内未收到数据",
                    idle_timeout.as_millis()
                )))?;
            let Some(next) = next else { break; };
            let next = next.map_err(|error| CurrentProviderError::new(format!(
                "读取 provider SSE 失败: {}",
                super::transport::error_chain(&error)
            )))?;
            pending.extend_from_slice(&next);
            for frame in drain_sse_frames(&mut pending)? { yield frame; }
        }
        let pending = std::str::from_utf8(&pending).map_err(|error| CurrentProviderError::new(format!("解析 provider SSE UTF-8 失败: {error}")))?;
        if let Some(frame) = parse_sse_frame(pending) { yield frame; }
    }
}

pub(super) fn drain_sse_frames(
    pending: &mut Vec<u8>,
) -> Result<Vec<SseFrame>, CurrentProviderError> {
    let mut frames = Vec::new();
    while let Some(frame_end) = find_sse_frame_end(pending) {
        let frame = std::str::from_utf8(&pending[..frame_end])
            .map_err(|error| {
                CurrentProviderError::new(format!("解析 provider SSE UTF-8 失败: {error}"))
            })?
            .to_string();
        let next_start = skip_sse_frame_end(pending, frame_end);
        pending.drain(..next_start);
        if let Some(frame) = parse_sse_frame(&frame) {
            frames.push(frame);
        }
    }
    Ok(frames)
}

fn find_sse_frame_end(value: &[u8]) -> Option<usize> {
    value
        .windows(2)
        .position(|window| window == b"\n\n")
        .or_else(|| value.windows(4).position(|window| window == b"\r\n\r\n"))
}

fn skip_sse_frame_end(value: &[u8], frame_end: usize) -> usize {
    if value[frame_end..].starts_with(b"\r\n\r\n") {
        frame_end + 4
    } else {
        frame_end + 2
    }
}

pub(super) fn parse_sse_frame(frame: &str) -> Option<SseFrame> {
    let data = frame
        .lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .map(str::trim_start)
        .collect::<Vec<_>>()
        .join("\n");
    (!data.is_empty()).then_some(SseFrame { data })
}

#[cfg(test)]
mod tests {
    use super::responses::responses_usage;
    use super::*;

    #[test]
    fn finish_reason_mapping_preserves_terminal_semantics() {
        assert_eq!(openai_finish_reason("tool_calls"), FinishReason::ToolCall);
        assert_eq!(openai_finish_reason("length"), FinishReason::Length);
        assert_eq!(anthropic_finish_reason("max_tokens"), FinishReason::Length);
        assert_eq!(
            anthropic_finish_reason("refusal"),
            FinishReason::ContentFilter
        );
    }

    #[test]
    fn responses_usage_maps_provider_budget_extension() {
        let usage = responses_usage(&json!({
            "input_tokens": 21,
            "output_tokens": 8,
            "total_tokens": 29,
            "codex_rollout_budget_units": 12.75
        }));

        assert_eq!(
            usage.lime_rollout_budget_units,
            json!(12.75).as_number().cloned()
        );
    }

    #[test]
    fn truncated_stream_is_retryable_transport_failure() {
        assert!(matches!(
            truncated_stream_error("OpenAI Responses"),
            LlmEvent::ProviderError {
                classification: Some(FailureClassification::Transport),
                retryable: Some(true),
                ..
            }
        ));
    }

    #[test]
    fn trusted_responses_metadata_preserves_each_moderation_update_as_opaque_json() {
        let mut reducer = ResponsesEventReducer::new(None, true);
        let first = reducer
            .push(&json!({
                "type": "response.metadata",
                "metadata": {
                    "openai_chatgpt_moderation_metadata": {
                        "presentation": "inline"
                    }
                }
            }))
            .expect("first moderation metadata");
        let second = reducer
            .push(&json!({
                "type": "response.metadata",
                "metadata": {
                    "openai_chatgpt_moderation_metadata": ["updated", 2]
                }
            }))
            .expect("second moderation metadata");

        assert_eq!(
            first.events,
            vec![LlmEvent::TurnModerationMetadata {
                metadata: json!({ "presentation": "inline" }),
            }]
        );
        assert_eq!(
            second.events,
            vec![LlmEvent::TurnModerationMetadata {
                metadata: json!(["updated", 2]),
            }]
        );
    }

    #[test]
    fn untrusted_responses_metadata_does_not_emit_moderation_metadata() {
        let events = ResponsesEventReducer::new(None, false)
            .push(&json!({
                "type": "response.metadata",
                "metadata": {
                    "openai_chatgpt_moderation_metadata": {
                        "presentation": "inline"
                    }
                }
            }))
            .expect("ignored moderation metadata")
            .events;

        assert!(events.is_empty());
    }

    #[test]
    fn original_tool_call_with_blank_name_preserves_runtime_repair_input() {
        let call = CurrentProviderToolCall::from_raw(
            "call-blank-name".to_string(),
            "   ".to_string(),
            "{}".to_string(),
        );

        assert_eq!(call.name, "   ");
        assert_eq!(call.arguments, json!({}));
        assert_eq!(call.raw_arguments, "{}");
    }

    #[test]
    fn tool_call_accumulator_accepts_arguments_before_name() {
        let mut call = ToolCallAccumulator {
            id: Some("call-1".to_string()),
            arguments: "{\"query\":\"latest Rust release\"}".to_string(),
            ..Default::default()
        };

        assert!(call.begin_input_if_ready("fallback").is_none());

        call.name = Some("WebSearch".to_string());
        assert_eq!(
            call.begin_input_if_ready("fallback"),
            Some((
                "call-1".to_string(),
                "WebSearch".to_string(),
                "{\"query\":\"latest Rust release\"}".to_string(),
            ))
        );
        let call = call.into_call("fallback").expect("tool call");
        assert_eq!(call.name, "WebSearch");
        assert_eq!(call.arguments["query"], "latest Rust release");
    }

    #[test]
    fn tool_call_accumulator_preserves_terminal_arguments_without_name() {
        let mut call = ToolCallAccumulator {
            arguments: "{}".to_string(),
            ..Default::default()
        };

        let call = call
            .into_call("call-1")
            .expect("incomplete tool call must reach runtime repair");

        assert_eq!(call.id, "call-1");
        assert_eq!(call.name, "");
        assert_eq!(call.arguments, json!({}));
    }

    #[test]
    fn completed_custom_tool_call_emits_complete_input_lifecycle() {
        let events = ResponsesEventReducer::new(None, false)
            .push(&json!({
                "type": "response.completed",
                "response": {
                    "id": "response-1",
                    "output": [{
                        "type": "custom_tool_call",
                        "call_id": "custom-call-1",
                        "name": "run_code",
                        "namespace": "codemode",
                        "input": "return 42;"
                    }]
                }
            }))
            .expect("completed custom tool call")
            .events;

        assert_eq!(
            events,
            vec![
                LlmEvent::ToolInputStart {
                    id: "custom-call-1".to_string(),
                    name: "run_code".to_string(),
                },
                LlmEvent::ToolInputDelta {
                    id: "custom-call-1".to_string(),
                    name: "run_code".to_string(),
                    text: "return 42;".to_string(),
                },
                LlmEvent::ToolInputEnd {
                    id: "custom-call-1".to_string(),
                    name: "run_code".to_string(),
                },
                LlmEvent::CustomToolCall {
                    id: "custom-call-1".to_string(),
                    name: "run_code".to_string(),
                    input: "return 42;".to_string(),
                    namespace: Some("codemode".to_string()),
                    provider_metadata: Default::default(),
                },
                LlmEvent::Finish {
                    reason: FinishReason::ToolCall,
                    usage: None,
                    needs_follow_up: false,
                    response_id: Some("response-1".to_string()),
                },
            ]
        );
    }
}
