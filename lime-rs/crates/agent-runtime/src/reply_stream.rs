//! Reply stream 的 current envelope contract。
//!
//! 该类型只描述 runtime reply stream 如何携带 current event 或边界诊断，
//! 不绑定 Agent `AgentEvent`，也不反向依赖 lime-agent 的协议实现。

use crate::runtime_timeline::{
    project_runtime_timeline_item, RuntimeTimelineItemPayloadSource, RuntimeTimelineItemProjection,
    RuntimeTimelineItemSource, RuntimeTimelineItemStatusSource,
};
use futures::stream::{BoxStream, StreamExt};
use model_provider::provider_stream::RuntimeReplyProviderStreamEvent;
pub use model_provider::provider_stream::{
    RuntimeReplyResponseEvent, RuntimeReplyResponseItem, RuntimeReplyResponseItemPayload,
};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::time::Duration;

pub const MIN_PROVIDER_STREAM_FIRST_EVENT_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Debug, PartialEq)]
pub enum RuntimeReplyStreamEvent<E> {
    Event(E),
    ResponseEvent(RuntimeReplyResponseEvent),
    ProviderStreamEvent(RuntimeReplyProviderStreamEvent),
    SuppressedInlineProviderError(String),
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RuntimeReplyResponseEventHints {
    pub item_id: Option<String>,
}

impl RuntimeReplyResponseEventHints {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_item_id(mut self, item_id: impl Into<String>) -> Self {
        self.item_id = Some(item_id.into());
        self
    }
}

pub trait RuntimeReplyResponseEventMapper<E> {
    fn map_response_event(
        &mut self,
        event: &E,
        hints: &RuntimeReplyResponseEventHints,
    ) -> Option<RuntimeReplyResponseEvent>;
}

pub fn project_runtime_event_as_response_event<E, M>(
    mapper: &mut M,
    event: E,
    hints: &RuntimeReplyResponseEventHints,
) -> RuntimeReplyStreamEvent<E>
where
    M: RuntimeReplyResponseEventMapper<E>,
{
    mapper
        .map_response_event(&event, hints)
        .map(RuntimeReplyStreamEvent::response_event)
        .unwrap_or_else(|| RuntimeReplyStreamEvent::event(event))
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RuntimeReplyResponseContext {
    pub thread_id: String,
    pub turn_id: String,
    pub timestamp: String,
    pub first_sequence: i64,
}

impl RuntimeReplyResponseContext {
    pub fn new(
        thread_id: impl Into<String>,
        turn_id: impl Into<String>,
        timestamp: impl Into<String>,
    ) -> Self {
        Self {
            thread_id: thread_id.into(),
            turn_id: turn_id.into(),
            timestamp: timestamp.into(),
            first_sequence: 0,
        }
    }

    pub fn with_first_sequence(mut self, first_sequence: i64) -> Self {
        self.first_sequence = first_sequence;
        self
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum RuntimeReplyResponseProjection {
    TextDelta {
        text: String,
    },
    ReasoningSummaryDelta {
        text: String,
        summary_index: i64,
    },
    ReasoningSummaryPartAdded {
        summary_index: i64,
    },
    ReasoningContentDelta {
        text: String,
        content_index: i64,
    },
    ToolInputDelta {
        tool_id: String,
        tool_name: Option<String>,
        delta: String,
        accumulated_arguments: Option<String>,
        provider: Option<String>,
    },
    ItemStarted {
        item: RuntimeTimelineItemProjection,
    },
    ItemUpdated {
        item: RuntimeTimelineItemProjection,
    },
    ItemCompleted {
        item: RuntimeTimelineItemProjection,
    },
    Done {
        response_id: Option<String>,
        end_turn: Option<bool>,
        token_usage: Option<Value>,
    },
    RateLimits {
        payload: Value,
    },
}

#[derive(Debug)]
pub struct RuntimeReplyResponseMaterializer {
    context: RuntimeReplyResponseContext,
    next_sequence: i64,
    item_sequences: HashMap<String, i64>,
    tool_names: HashMap<String, String>,
    tool_arguments: HashMap<String, String>,
    reasoning_summary: HashMap<String, BTreeMap<i64, String>>,
    reasoning_content: HashMap<String, BTreeMap<i64, String>>,
}

impl RuntimeReplyResponseMaterializer {
    pub fn new(context: RuntimeReplyResponseContext) -> Self {
        Self {
            next_sequence: context.first_sequence,
            context,
            item_sequences: HashMap::new(),
            tool_names: HashMap::new(),
            tool_arguments: HashMap::new(),
            reasoning_summary: HashMap::new(),
            reasoning_content: HashMap::new(),
        }
    }

    pub fn project_event(
        &mut self,
        event: RuntimeReplyResponseEvent,
    ) -> Vec<RuntimeReplyResponseProjection> {
        match event {
            RuntimeReplyResponseEvent::OutputItemAdded { item } => self
                .project_response_item(item, RuntimeTimelineItemStatusSource::InProgress)
                .map(|item| vec![RuntimeReplyResponseProjection::ItemStarted { item }])
                .unwrap_or_default(),
            RuntimeReplyResponseEvent::OutputItemDone { item } => self
                .project_response_item(item, RuntimeTimelineItemStatusSource::Completed)
                .map(|item| vec![RuntimeReplyResponseProjection::ItemCompleted { item }])
                .unwrap_or_default(),
            RuntimeReplyResponseEvent::TextDelta { text } => {
                vec![RuntimeReplyResponseProjection::TextDelta { text }]
            }
            RuntimeReplyResponseEvent::ToolCallInputDelta {
                call_id,
                tool_name,
                delta,
                accumulated_arguments,
                provider,
            } => {
                let accumulated_arguments = accumulated_arguments.or_else(|| {
                    let arguments = self.tool_arguments.entry(call_id.clone()).or_default();
                    arguments.push_str(&delta);
                    Some(arguments.clone())
                });
                let item_update = self.project_tool_call_input_item_update(
                    call_id.clone(),
                    tool_name.clone(),
                    accumulated_arguments.clone(),
                );
                let mut projections = vec![RuntimeReplyResponseProjection::ToolInputDelta {
                    tool_id: call_id,
                    tool_name,
                    delta,
                    accumulated_arguments,
                    provider,
                }];
                if let Some(item) = item_update {
                    projections.push(RuntimeReplyResponseProjection::ItemUpdated { item });
                }
                projections
            }
            RuntimeReplyResponseEvent::ReasoningSummaryDelta {
                item_id,
                delta,
                summary_index,
            } => {
                self.reasoning_summary
                    .entry(item_id.clone())
                    .or_default()
                    .entry(summary_index)
                    .or_default()
                    .push_str(&delta);
                let item = self.project_reasoning_item(item_id);
                vec![
                    RuntimeReplyResponseProjection::ReasoningSummaryDelta {
                        text: delta,
                        summary_index,
                    },
                    RuntimeReplyResponseProjection::ItemUpdated { item },
                ]
            }
            RuntimeReplyResponseEvent::ReasoningSummaryPartAdded {
                item_id,
                summary_index,
            } => {
                self.reasoning_summary
                    .entry(item_id.clone())
                    .or_default()
                    .entry(summary_index)
                    .or_default();
                let item = self.project_reasoning_item(item_id);
                vec![
                    RuntimeReplyResponseProjection::ReasoningSummaryPartAdded { summary_index },
                    RuntimeReplyResponseProjection::ItemUpdated { item },
                ]
            }
            RuntimeReplyResponseEvent::ReasoningContentDelta {
                item_id,
                delta,
                content_index,
            } => {
                self.reasoning_content
                    .entry(item_id.clone())
                    .or_default()
                    .entry(content_index)
                    .or_default()
                    .push_str(&delta);
                let item = self.project_reasoning_item(item_id);
                vec![
                    RuntimeReplyResponseProjection::ReasoningContentDelta {
                        text: delta,
                        content_index,
                    },
                    RuntimeReplyResponseProjection::ItemUpdated { item },
                ]
            }
            RuntimeReplyResponseEvent::Completed {
                response_id,
                end_turn,
                token_usage,
            } => vec![RuntimeReplyResponseProjection::Done {
                response_id,
                end_turn,
                token_usage,
            }],
            RuntimeReplyResponseEvent::RateLimits { payload } => {
                vec![RuntimeReplyResponseProjection::RateLimits { payload }]
            }
        }
    }

    fn project_reasoning_item(&mut self, item_id: String) -> RuntimeTimelineItemProjection {
        let summary = self.reasoning_summary.get(&item_id).map(indexed_parts);
        let text = self
            .reasoning_content
            .get(&item_id)
            .map(indexed_parts)
            .filter(|parts| !parts.is_empty())
            .or_else(|| summary.clone())
            .map(|parts| parts.concat())
            .unwrap_or_default();
        self.project_timeline_item(
            item_id,
            RuntimeTimelineItemStatusSource::InProgress,
            RuntimeTimelineItemPayloadSource::Reasoning {
                text,
                summary: summary.filter(|parts| !parts.is_empty()),
                metadata: None,
            },
        )
    }

    fn project_response_item(
        &mut self,
        item: RuntimeReplyResponseItem,
        status: RuntimeTimelineItemStatusSource,
    ) -> Option<RuntimeTimelineItemProjection> {
        let payload = match item.payload {
            RuntimeReplyResponseItemPayload::AgentMessage { text, phase: _ } => {
                RuntimeTimelineItemPayloadSource::AgentMessage { text }
            }
            RuntimeReplyResponseItemPayload::Reasoning {
                text,
                summary,
                metadata,
            } => RuntimeTimelineItemPayloadSource::Reasoning {
                text,
                summary,
                metadata,
            },
            RuntimeReplyResponseItemPayload::ToolCall {
                tool_name,
                arguments,
                output,
                success,
                error,
                metadata,
            } => {
                self.tool_names
                    .insert(item.item_id.clone(), tool_name.clone());
                RuntimeTimelineItemPayloadSource::ToolCall {
                    tool_name,
                    arguments,
                    output_text: output,
                    success,
                    error,
                    metadata,
                }
            }
            RuntimeReplyResponseItemPayload::Unknown { .. } => return None,
        };

        Some(self.project_timeline_item(item.item_id, status, payload))
    }

    fn project_tool_call_input_item_update(
        &mut self,
        call_id: String,
        tool_name: Option<String>,
        accumulated_arguments: Option<String>,
    ) -> Option<RuntimeTimelineItemProjection> {
        if let Some(tool_name) = tool_name
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
        {
            self.tool_names
                .insert(call_id.clone(), tool_name.to_string());
        }

        let tool_name = self.tool_names.get(&call_id).cloned()?;
        let arguments = accumulated_arguments
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(parse_response_tool_arguments);

        Some(self.project_timeline_item(
            call_id,
            RuntimeTimelineItemStatusSource::InProgress,
            RuntimeTimelineItemPayloadSource::ToolCall {
                tool_name,
                arguments,
                output_text: None,
                success: None,
                error: None,
                metadata: None,
            },
        ))
    }

    fn project_timeline_item(
        &mut self,
        item_id: String,
        status: RuntimeTimelineItemStatusSource,
        payload: RuntimeTimelineItemPayloadSource,
    ) -> RuntimeTimelineItemProjection {
        let sequence = self.sequence_for_item(&item_id);
        let completed_at = matches!(
            status,
            RuntimeTimelineItemStatusSource::Completed | RuntimeTimelineItemStatusSource::Failed
        )
        .then(|| self.context.timestamp.clone());

        project_runtime_timeline_item(RuntimeTimelineItemSource {
            id: item_id,
            thread_id: self.context.thread_id.clone(),
            turn_id: self.context.turn_id.clone(),
            sequence,
            status,
            started_at: self.context.timestamp.clone(),
            completed_at,
            updated_at: self.context.timestamp.clone(),
            payload,
        })
        .expect("response item payload should be projectable")
    }

    fn sequence_for_item(&mut self, item_id: &str) -> i64 {
        if let Some(sequence) = self.item_sequences.get(item_id) {
            return *sequence;
        }

        let sequence = self.next_sequence;
        self.next_sequence += 1;
        self.item_sequences.insert(item_id.to_string(), sequence);
        sequence
    }
}

fn indexed_parts(parts: &BTreeMap<i64, String>) -> Vec<String> {
    parts
        .values()
        .filter(|part| !part.is_empty())
        .cloned()
        .collect()
}

fn parse_response_tool_arguments(arguments: &str) -> Value {
    serde_json::from_str(arguments).unwrap_or_else(|_| Value::String(arguments.to_string()))
}

impl<E> RuntimeReplyStreamEvent<E> {
    pub fn event(event: E) -> Self {
        Self::Event(event)
    }

    pub fn response_event(event: RuntimeReplyResponseEvent) -> Self {
        Self::ResponseEvent(event)
    }

    pub fn provider_stream_event(event: RuntimeReplyProviderStreamEvent) -> Self {
        Self::ProviderStreamEvent(event)
    }

    pub fn suppressed_inline_provider_error(message: impl Into<String>) -> Self {
        Self::SuppressedInlineProviderError(message.into())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RuntimeReplyInlineProviderError {
    pub message: String,
}

impl RuntimeReplyInlineProviderError {
    const ERROR_PREFIX: &'static str = "Ran into this error:";
    const RETRY_SUFFIX: &'static str =
        "Please retry if you think this is a transient or recoverable error.";
    const RETRY_SEPARATOR: &'static str =
        "\n\nPlease retry if you think this is a transient or recoverable error.";

    pub fn from_text(text: &str) -> Option<Self> {
        let text = text.trim();
        if text.is_empty() {
            return None;
        }
        if !text.contains(Self::ERROR_PREFIX) || !text.contains(Self::RETRY_SUFFIX) {
            return None;
        }

        let after_prefix = text.split_once(Self::ERROR_PREFIX)?.1;
        let detail = after_prefix
            .split_once(Self::RETRY_SEPARATOR)
            .map(|(left, _)| left.trim())
            .unwrap_or_else(|| after_prefix.trim())
            .trim_end_matches('.');

        if detail.is_empty() {
            return Some(Self {
                message: "Agent provider execution failed".to_string(),
            });
        }

        Some(Self {
            message: format!("Agent provider execution failed: {detail}"),
        })
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct RuntimeReplyStreamProjection<E> {
    provider_stream_event: Option<RuntimeReplyProviderStreamEvent>,
    inline_provider_error: Option<RuntimeReplyInlineProviderError>,
    events: Vec<E>,
}

impl<E> RuntimeReplyStreamProjection<E> {
    pub fn from_parts(
        provider_stream_event: Option<RuntimeReplyProviderStreamEvent>,
        inline_provider_error: Option<RuntimeReplyInlineProviderError>,
        events: Vec<E>,
    ) -> Self {
        Self {
            provider_stream_event,
            inline_provider_error,
            events,
        }
    }

    pub fn events(events: Vec<E>) -> Self {
        Self::from_parts(None, None, events)
    }

    pub fn into_events(self) -> Vec<RuntimeReplyStreamEvent<E>> {
        if let Some(event) = self.provider_stream_event {
            return vec![RuntimeReplyStreamEvent::provider_stream_event(event)];
        }

        if let Some(error) = self.inline_provider_error {
            return vec![RuntimeReplyStreamEvent::suppressed_inline_provider_error(
                error.message,
            )];
        }

        self.events
            .into_iter()
            .map(RuntimeReplyStreamEvent::event)
            .collect()
    }
}

pub trait RuntimeReplyStreamProjector<SourceEvent, RuntimeEvent> {
    fn project_reply_stream_event(
        &mut self,
        event: SourceEvent,
    ) -> Vec<RuntimeReplyStreamEvent<RuntimeEvent>>;
}

struct RuntimeReplyStreamProjectionState<'a, SourceEvent, RuntimeEvent, Projector> {
    stream: BoxStream<'a, anyhow::Result<SourceEvent>>,
    projector: Projector,
    pending: VecDeque<RuntimeReplyStreamEvent<RuntimeEvent>>,
}

pub fn project_reply_stream<'a, SourceEvent, RuntimeEvent, Projector>(
    stream: BoxStream<'a, anyhow::Result<SourceEvent>>,
    projector: Projector,
) -> BoxStream<'a, anyhow::Result<RuntimeReplyStreamEvent<RuntimeEvent>>>
where
    SourceEvent: 'a,
    RuntimeEvent: Send + 'a,
    Projector: RuntimeReplyStreamProjector<SourceEvent, RuntimeEvent> + Send + 'a,
{
    let state = RuntimeReplyStreamProjectionState {
        stream,
        projector,
        pending: VecDeque::new(),
    };

    Box::pin(futures::stream::try_unfold(state, |mut state| async move {
        loop {
            if let Some(event) = state.pending.pop_front() {
                return Ok(Some((event, state)));
            }

            let Some(source_event) = state.stream.next().await else {
                return Ok(None);
            };
            state.pending = state
                .projector
                .project_reply_stream_event(source_event?)
                .into();
        }
    }))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RuntimeReplyStreamIdleTimeout {
    pub timeout: Duration,
}

impl RuntimeReplyStreamIdleTimeout {
    pub fn new(timeout: Duration) -> Self {
        Self { timeout }
    }

    pub fn message(&self) -> String {
        format!(
            "Agent provider execution failed: stream idle timeout after {}ms without provider event",
            self.timeout.as_millis()
        )
    }
}

#[derive(Debug, Default)]
pub struct RuntimeReplyStreamState {
    stream_event_seen: bool,
    inline_provider_error: Option<String>,
}

impl RuntimeReplyStreamState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn mark_stream_event_seen(&mut self) {
        self.stream_event_seen = true;
    }

    pub fn stream_event_seen(&self) -> bool {
        self.stream_event_seen
    }

    pub fn next_timeout(&self, stream_idle_timeout: Option<Duration>) -> Option<Duration> {
        stream_idle_timeout.map(|timeout| {
            if self.stream_event_seen {
                timeout
            } else {
                timeout.max(MIN_PROVIDER_STREAM_FIRST_EVENT_TIMEOUT)
            }
        })
    }

    pub fn capture_inline_provider_error(&mut self, message: impl Into<String>) {
        if self.inline_provider_error.is_none() {
            self.inline_provider_error = Some(message.into());
        }
    }

    pub fn take_inline_provider_error(&mut self) -> Option<String> {
        self.inline_provider_error.take()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reply_stream_event_wraps_current_event_without_backend_type() {
        let event = RuntimeReplyStreamEvent::event("text_delta");

        assert_eq!(event, RuntimeReplyStreamEvent::Event("text_delta"));
    }

    #[test]
    fn reply_stream_event_carries_provider_stream_event() {
        use model_provider::safety::{
            ProviderSafetyBufferingRetryModelSource, ProviderSafetyBufferingRuntimeEventPayload,
            SAFETY_BUFFERING_RUNTIME_EVENT_KIND,
        };

        let event = RuntimeReplyStreamEvent::<()>::provider_stream_event(
            RuntimeReplyProviderStreamEvent::SafetyBuffering(
                ProviderSafetyBufferingRuntimeEventPayload {
                    kind: SAFETY_BUFFERING_RUNTIME_EVENT_KIND,
                    provider: Some("openai".to_string()),
                    model: Some("gpt-5-codex".to_string()),
                    use_cases: vec!["policy".to_string()],
                    reasons: vec!["buffering".to_string()],
                    show_buffering_ui: true,
                    retry_model: Some("gpt-5-mini".to_string()),
                    fallback_header_model: None,
                    source: ProviderSafetyBufferingRetryModelSource::PayloadRetryModel,
                },
            ),
        );

        assert!(matches!(
            event,
            RuntimeReplyStreamEvent::ProviderStreamEvent(
                RuntimeReplyProviderStreamEvent::SafetyBuffering(_)
            )
        ));
    }

    #[test]
    fn reply_stream_event_carries_response_event() {
        let event =
            RuntimeReplyStreamEvent::<()>::response_event(RuntimeReplyResponseEvent::TextDelta {
                text: "hello".to_string(),
            });

        assert_eq!(
            event,
            RuntimeReplyStreamEvent::ResponseEvent(RuntimeReplyResponseEvent::TextDelta {
                text: "hello".to_string(),
            })
        );
    }

    #[test]
    fn response_event_mapper_promotes_only_supported_runtime_events() {
        #[derive(Clone, Debug, PartialEq)]
        enum TestEvent {
            Text(String),
            Other,
        }

        struct TestMapper;

        impl RuntimeReplyResponseEventMapper<TestEvent> for TestMapper {
            fn map_response_event(
                &mut self,
                event: &TestEvent,
                _hints: &RuntimeReplyResponseEventHints,
            ) -> Option<RuntimeReplyResponseEvent> {
                match event {
                    TestEvent::Text(text) => {
                        Some(RuntimeReplyResponseEvent::TextDelta { text: text.clone() })
                    }
                    TestEvent::Other => None,
                }
            }
        }

        let mut mapper = TestMapper;
        let hints = RuntimeReplyResponseEventHints::new();
        let promoted = project_runtime_event_as_response_event(
            &mut mapper,
            TestEvent::Text("hello".to_string()),
            &hints,
        );
        let preserved =
            project_runtime_event_as_response_event(&mut mapper, TestEvent::Other, &hints);

        assert_eq!(
            promoted,
            RuntimeReplyStreamEvent::ResponseEvent(RuntimeReplyResponseEvent::TextDelta {
                text: "hello".to_string(),
            })
        );
        assert_eq!(preserved, RuntimeReplyStreamEvent::Event(TestEvent::Other));
    }

    #[test]
    fn response_materializer_projects_tool_item_lifecycle() {
        let mut materializer =
            RuntimeReplyResponseMaterializer::new(RuntimeReplyResponseContext::new(
                "thread-response",
                "turn-response",
                "2026-07-09T00:00:00Z",
            ));
        let item = RuntimeReplyResponseItem::new(
            "call-1",
            "function_call",
            RuntimeReplyResponseItemPayload::ToolCall {
                tool_name: "apply_patch".to_string(),
                arguments: Some(serde_json::json!({ "patch": "*** Begin Patch" })),
                output: None,
                success: None,
                error: None,
                metadata: Some(serde_json::json!({ "source": "response_event" })),
            },
        );

        let started = materializer
            .project_event(RuntimeReplyResponseEvent::OutputItemAdded { item: item.clone() });
        let completed =
            materializer.project_event(RuntimeReplyResponseEvent::OutputItemDone { item });

        let [RuntimeReplyResponseProjection::ItemStarted { item: started_item }] =
            started.as_slice()
        else {
            panic!("expected item started projection");
        };
        let [RuntimeReplyResponseProjection::ItemCompleted {
            item: completed_item,
        }] = completed.as_slice()
        else {
            panic!("expected item completed projection");
        };
        assert_eq!(started_item.id, "call-1");
        assert_eq!(started_item.sequence, completed_item.sequence);
        assert!(completed_item.completed_at.is_some());
        match &completed_item.payload {
            crate::runtime_timeline::RuntimeTimelineItemPayload::ToolCall {
                tool_name,
                arguments,
                ..
            } => {
                assert_eq!(tool_name, "apply_patch");
                assert_eq!(
                    arguments.as_ref().and_then(|value| value.get("patch")),
                    Some(&serde_json::json!("*** Begin Patch"))
                );
            }
            other => panic!("expected tool call payload, got {other:?}"),
        }
    }

    #[test]
    fn response_materializer_keeps_reasoning_summary_separate_from_raw_content() {
        let mut materializer =
            RuntimeReplyResponseMaterializer::new(RuntimeReplyResponseContext::new(
                "thread-response",
                "turn-response",
                "2026-07-09T00:00:00Z",
            ));

        let first = materializer.project_event(RuntimeReplyResponseEvent::ReasoningSummaryDelta {
            item_id: "reasoning-1".to_string(),
            delta: "摘要".to_string(),
            summary_index: 0,
        });
        let second = materializer.project_event(RuntimeReplyResponseEvent::ReasoningContentDelta {
            item_id: "reasoning-1".to_string(),
            delta: "原始推理".to_string(),
            content_index: 0,
        });

        assert!(matches!(
            &first[0],
            RuntimeReplyResponseProjection::ReasoningSummaryDelta { text, summary_index }
                if text == "摘要" && *summary_index == 0
        ));
        assert!(matches!(
            &second[0],
            RuntimeReplyResponseProjection::ReasoningContentDelta { text, content_index }
                if text == "原始推理" && *content_index == 0
        ));
        let RuntimeReplyResponseProjection::ItemUpdated { item } = &second[1] else {
            panic!("expected reasoning item update");
        };
        match &item.payload {
            crate::runtime_timeline::RuntimeTimelineItemPayload::Reasoning {
                text,
                summary,
                ..
            } => {
                assert_eq!(text, "原始推理");
                assert_eq!(summary.as_ref(), Some(&vec!["摘要".to_string()]));
            }
            other => panic!("expected reasoning payload, got {other:?}"),
        }
    }

    #[test]
    fn response_materializer_orders_reasoning_parts_by_provider_index() {
        let mut materializer =
            RuntimeReplyResponseMaterializer::new(RuntimeReplyResponseContext::new(
                "thread-response",
                "turn-response",
                "2026-07-09T00:00:00Z",
            ));

        let boundary =
            materializer.project_event(RuntimeReplyResponseEvent::ReasoningSummaryPartAdded {
                item_id: "reasoning-1".to_string(),
                summary_index: 1,
            });
        materializer.project_event(RuntimeReplyResponseEvent::ReasoningSummaryDelta {
            item_id: "reasoning-1".to_string(),
            delta: "第二段".to_string(),
            summary_index: 1,
        });
        let ordered =
            materializer.project_event(RuntimeReplyResponseEvent::ReasoningSummaryDelta {
                item_id: "reasoning-1".to_string(),
                delta: "第一段".to_string(),
                summary_index: 0,
            });

        assert!(matches!(
            boundary.first(),
            Some(RuntimeReplyResponseProjection::ReasoningSummaryPartAdded { summary_index: 1 })
        ));
        let RuntimeReplyResponseProjection::ItemUpdated { item } = &ordered[1] else {
            panic!("expected reasoning item update");
        };
        match &item.payload {
            crate::runtime_timeline::RuntimeTimelineItemPayload::Reasoning { summary, .. } => {
                assert_eq!(
                    summary.as_ref(),
                    Some(&vec!["第一段".to_string(), "第二段".to_string()])
                );
            }
            other => panic!("expected reasoning payload, got {other:?}"),
        }
    }

    #[test]
    fn response_materializer_accumulates_tool_call_input_delta() {
        let mut materializer =
            RuntimeReplyResponseMaterializer::new(RuntimeReplyResponseContext::new(
                "thread-response",
                "turn-response",
                "2026-07-09T00:00:00Z",
            ));

        materializer.project_event(RuntimeReplyResponseEvent::ToolCallInputDelta {
            call_id: "call-1".to_string(),
            tool_name: Some("apply_patch".to_string()),
            delta: "{\"cmd\"".to_string(),
            accumulated_arguments: None,
            provider: Some("openai".to_string()),
        });
        let events = materializer.project_event(RuntimeReplyResponseEvent::ToolCallInputDelta {
            call_id: "call-1".to_string(),
            tool_name: Some("apply_patch".to_string()),
            delta: ":\"ls\"}".to_string(),
            accumulated_arguments: None,
            provider: Some("openai".to_string()),
        });

        let [RuntimeReplyResponseProjection::ToolInputDelta {
            tool_id,
            tool_name,
            delta,
            accumulated_arguments,
            provider,
        }, RuntimeReplyResponseProjection::ItemUpdated { item }] = events.as_slice()
        else {
            panic!("expected tool input delta and item update projections");
        };
        assert_eq!(tool_id, "call-1");
        assert_eq!(tool_name.as_deref(), Some("apply_patch"));
        assert_eq!(delta, ":\"ls\"}");
        assert_eq!(accumulated_arguments.as_deref(), Some("{\"cmd\":\"ls\"}"));
        assert_eq!(provider.as_deref(), Some("openai"));
        assert_eq!(item.id, "call-1");
        match &item.payload {
            crate::runtime_timeline::RuntimeTimelineItemPayload::ToolCall {
                tool_name,
                arguments,
                ..
            } => {
                assert_eq!(tool_name, "apply_patch");
                assert_eq!(
                    arguments.as_ref().and_then(|value| value.get("cmd")),
                    Some(&serde_json::json!("ls"))
                );
            }
            other => panic!("expected tool call payload, got {other:?}"),
        }
    }

    #[test]
    fn response_materializer_uses_output_item_tool_name_for_input_delta_item_update() {
        let mut materializer =
            RuntimeReplyResponseMaterializer::new(RuntimeReplyResponseContext::new(
                "thread-response",
                "turn-response",
                "2026-07-09T00:00:00Z",
            ));

        materializer.project_event(RuntimeReplyResponseEvent::OutputItemAdded {
            item: RuntimeReplyResponseItem::new(
                "call-1",
                "function_call",
                RuntimeReplyResponseItemPayload::ToolCall {
                    tool_name: "web_search".to_string(),
                    arguments: None,
                    output: None,
                    success: None,
                    error: None,
                    metadata: None,
                },
            ),
        });
        let events = materializer.project_event(RuntimeReplyResponseEvent::ToolCallInputDelta {
            call_id: "call-1".to_string(),
            tool_name: None,
            delta: "{\"query\":\"lime\"}".to_string(),
            accumulated_arguments: None,
            provider: Some("openai".to_string()),
        });

        let [RuntimeReplyResponseProjection::ToolInputDelta { .. }, RuntimeReplyResponseProjection::ItemUpdated { item }] =
            events.as_slice()
        else {
            panic!("expected tool input delta and item update projections");
        };
        match &item.payload {
            crate::runtime_timeline::RuntimeTimelineItemPayload::ToolCall {
                tool_name,
                arguments,
                ..
            } => {
                assert_eq!(tool_name, "web_search");
                assert_eq!(
                    arguments.as_ref().and_then(|value| value.get("query")),
                    Some(&serde_json::json!("lime"))
                );
            }
            other => panic!("expected tool call payload, got {other:?}"),
        }
    }

    #[test]
    fn response_materializer_keeps_tool_input_delta_without_item_update_when_tool_name_unknown() {
        let mut materializer =
            RuntimeReplyResponseMaterializer::new(RuntimeReplyResponseContext::new(
                "thread-response",
                "turn-response",
                "2026-07-09T00:00:00Z",
            ));

        let events = materializer.project_event(RuntimeReplyResponseEvent::ToolCallInputDelta {
            call_id: "call-unknown".to_string(),
            tool_name: None,
            delta: "{\"cmd\"".to_string(),
            accumulated_arguments: None,
            provider: Some("openai".to_string()),
        });

        let [RuntimeReplyResponseProjection::ToolInputDelta {
            tool_id,
            tool_name,
            delta,
            accumulated_arguments,
            provider,
        }] = events.as_slice()
        else {
            panic!("expected tool input delta projection");
        };
        assert_eq!(tool_id, "call-unknown");
        assert_eq!(tool_name.as_deref(), None);
        assert_eq!(delta, "{\"cmd\"");
        assert_eq!(accumulated_arguments.as_deref(), Some("{\"cmd\""));
        assert_eq!(provider.as_deref(), Some("openai"));
    }

    #[test]
    fn response_materializer_preserves_provider_accumulated_tool_input_delta() {
        let mut materializer =
            RuntimeReplyResponseMaterializer::new(RuntimeReplyResponseContext::new(
                "thread-response",
                "turn-response",
                "2026-07-09T00:00:00Z",
            ));

        let events = materializer.project_event(RuntimeReplyResponseEvent::ToolCallInputDelta {
            call_id: "call-1".to_string(),
            tool_name: Some("apply_patch".to_string()),
            delta: "\"}".to_string(),
            accumulated_arguments: Some("{\"cmd\":\"ls\"}".to_string()),
            provider: Some("openai".to_string()),
        });

        let [RuntimeReplyResponseProjection::ToolInputDelta {
            tool_id,
            tool_name,
            delta,
            accumulated_arguments,
            provider,
        }, RuntimeReplyResponseProjection::ItemUpdated { item }] = events.as_slice()
        else {
            panic!("expected tool input delta and item update projections");
        };
        assert_eq!(tool_id, "call-1");
        assert_eq!(tool_name.as_deref(), Some("apply_patch"));
        assert_eq!(delta, "\"}");
        assert_eq!(accumulated_arguments.as_deref(), Some("{\"cmd\":\"ls\"}"));
        assert_eq!(provider.as_deref(), Some("openai"));
        match &item.payload {
            crate::runtime_timeline::RuntimeTimelineItemPayload::ToolCall { arguments, .. } => {
                assert_eq!(
                    arguments.as_ref().and_then(|value| value.get("cmd")),
                    Some(&serde_json::json!("ls"))
                )
            }
            other => panic!("expected tool call payload, got {other:?}"),
        }
    }

    #[test]
    fn response_materializer_projects_partial_tool_input_item_update_as_string_argument() {
        let mut materializer =
            RuntimeReplyResponseMaterializer::new(RuntimeReplyResponseContext::new(
                "thread-response",
                "turn-response",
                "2026-07-09T00:00:00Z",
            ));

        let events = materializer.project_event(RuntimeReplyResponseEvent::ToolCallInputDelta {
            call_id: "call-1".to_string(),
            tool_name: Some("apply_patch".to_string()),
            delta: "{\"patch\"".to_string(),
            accumulated_arguments: None,
            provider: Some("openai".to_string()),
        });

        let [RuntimeReplyResponseProjection::ToolInputDelta { .. }, RuntimeReplyResponseProjection::ItemUpdated { item }] =
            events.as_slice()
        else {
            panic!("expected tool input delta and item update projections");
        };
        match &item.payload {
            crate::runtime_timeline::RuntimeTimelineItemPayload::ToolCall { arguments, .. } => {
                assert_eq!(arguments, &Some(serde_json::json!("{\"patch\"")))
            }
            other => panic!("expected tool call payload, got {other:?}"),
        }
    }

    #[test]
    fn response_materializer_does_not_project_tool_item_update_when_tool_name_unknown() {
        let mut materializer =
            RuntimeReplyResponseMaterializer::new(RuntimeReplyResponseContext::new(
                "thread-response",
                "turn-response",
                "2026-07-09T00:00:00Z",
            ));

        let events = materializer.project_event(RuntimeReplyResponseEvent::ToolCallInputDelta {
            call_id: "call-1".to_string(),
            tool_name: None,
            delta: "\"}".to_string(),
            accumulated_arguments: Some("{\"cmd\":\"ls\"}".to_string()),
            provider: Some("openai".to_string()),
        });

        let [RuntimeReplyResponseProjection::ToolInputDelta {
            tool_id,
            tool_name,
            delta,
            accumulated_arguments,
            provider,
        }] = events.as_slice()
        else {
            panic!("expected tool input delta projection");
        };
        assert_eq!(tool_id, "call-1");
        assert_eq!(tool_name.as_deref(), None);
        assert_eq!(delta, "\"}");
        assert_eq!(accumulated_arguments.as_deref(), Some("{\"cmd\":\"ls\"}"));
        assert_eq!(provider.as_deref(), Some("openai"));
    }

    #[test]
    fn response_materializer_projects_completed_and_rate_limits() {
        let mut materializer =
            RuntimeReplyResponseMaterializer::new(RuntimeReplyResponseContext::new(
                "thread-response",
                "turn-response",
                "2026-07-09T00:00:00Z",
            ));

        let done = materializer.project_event(RuntimeReplyResponseEvent::Completed {
            response_id: Some("resp-1".to_string()),
            end_turn: Some(true),
            token_usage: Some(serde_json::json!({ "input_tokens": 12, "output_tokens": 3 })),
        });
        let rate_limits = materializer.project_event(RuntimeReplyResponseEvent::RateLimits {
            payload: serde_json::json!({ "remaining": 10 }),
        });

        assert!(matches!(
            &done[0],
            RuntimeReplyResponseProjection::Done {
                response_id: Some(response_id),
                end_turn: Some(true),
                ..
            } if response_id == "resp-1"
        ));
        assert!(matches!(
            &rate_limits[0],
            RuntimeReplyResponseProjection::RateLimits { payload }
                if payload["remaining"] == serde_json::json!(10)
        ));
    }

    #[test]
    fn reply_stream_event_carries_suppressed_provider_error() {
        let event =
            RuntimeReplyStreamEvent::<()>::suppressed_inline_provider_error("provider failed");

        assert_eq!(
            event,
            RuntimeReplyStreamEvent::SuppressedInlineProviderError("provider failed".to_string(),)
        );
    }

    #[test]
    fn inline_provider_error_projects_provider_failure_text() {
        let error = RuntimeReplyInlineProviderError::from_text(
            "Ran into this error: provider overloaded.\n\nPlease retry if you think this is a transient or recoverable error.",
        )
        .expect("inline provider error");

        assert_eq!(
            error.message,
            "Agent provider execution failed: provider overloaded"
        );
    }

    #[test]
    fn inline_provider_error_uses_generic_message_for_empty_detail() {
        let error = RuntimeReplyInlineProviderError::from_text(
            "Ran into this error:\n\nPlease retry if you think this is a transient or recoverable error.",
        )
        .expect("inline provider error");

        assert_eq!(error.message, "Agent provider execution failed");
    }

    #[test]
    fn inline_provider_error_ignores_regular_text() {
        assert!(RuntimeReplyInlineProviderError::from_text("normal assistant reply").is_none());
    }

    fn safety_buffering_event() -> RuntimeReplyProviderStreamEvent {
        use model_provider::safety::{
            ProviderSafetyBufferingRetryModelSource, ProviderSafetyBufferingRuntimeEventPayload,
            SAFETY_BUFFERING_RUNTIME_EVENT_KIND,
        };

        RuntimeReplyProviderStreamEvent::SafetyBuffering(
            ProviderSafetyBufferingRuntimeEventPayload {
                kind: SAFETY_BUFFERING_RUNTIME_EVENT_KIND,
                provider: Some("openai".to_string()),
                model: Some("gpt-5-codex".to_string()),
                use_cases: vec!["policy".to_string()],
                reasons: vec!["buffering".to_string()],
                show_buffering_ui: true,
                retry_model: Some("gpt-5-mini".to_string()),
                fallback_header_model: None,
                source: ProviderSafetyBufferingRetryModelSource::PayloadRetryModel,
            },
        )
    }

    #[test]
    fn reply_stream_projection_prefers_provider_event_over_inline_error_and_events() {
        let projection = RuntimeReplyStreamProjection::from_parts(
            Some(safety_buffering_event()),
            Some(RuntimeReplyInlineProviderError {
                message: "Agent provider execution failed: ignored".to_string(),
            }),
            vec!["runtime.event"],
        );

        assert!(matches!(
            projection.into_events().as_slice(),
            [RuntimeReplyStreamEvent::ProviderStreamEvent(_)]
        ));
    }

    #[test]
    fn reply_stream_projection_prefers_inline_error_over_regular_events() {
        let projection = RuntimeReplyStreamProjection::from_parts(
            None,
            Some(RuntimeReplyInlineProviderError {
                message: "Agent provider execution failed: provider failed".to_string(),
            }),
            vec!["runtime.event"],
        );

        assert_eq!(
            projection.into_events(),
            vec![RuntimeReplyStreamEvent::SuppressedInlineProviderError(
                "Agent provider execution failed: provider failed".to_string()
            )]
        );
    }

    #[test]
    fn reply_stream_projection_wraps_regular_events() {
        let projection = RuntimeReplyStreamProjection::events(vec!["runtime.event"]);

        assert_eq!(
            projection.into_events(),
            vec![RuntimeReplyStreamEvent::Event("runtime.event")]
        );
    }

    struct TextReplyStreamProjector;

    impl RuntimeReplyStreamProjector<&str, String> for TextReplyStreamProjector {
        fn project_reply_stream_event(
            &mut self,
            event: &str,
        ) -> Vec<RuntimeReplyStreamEvent<String>> {
            vec![RuntimeReplyStreamEvent::event(event.trim().to_string())]
        }
    }

    #[test]
    fn reply_stream_projector_contract_is_source_agnostic() {
        let mut projector = TextReplyStreamProjector;

        assert_eq!(
            projector.project_reply_stream_event("  turn.item  "),
            vec![RuntimeReplyStreamEvent::Event("turn.item".to_string())]
        );
    }

    #[test]
    fn project_reply_stream_maps_source_stream_without_backend_type() {
        use futures::{stream, StreamExt};

        let source_stream = stream::iter(vec![Ok("  first  "), Ok("second")]).boxed();

        let events = futures::executor::block_on(
            project_reply_stream(source_stream, TextReplyStreamProjector).collect::<Vec<_>>(),
        );

        let events = events
            .into_iter()
            .collect::<anyhow::Result<Vec<_>>>()
            .expect("projected stream");
        assert_eq!(
            events,
            vec![
                RuntimeReplyStreamEvent::Event("first".to_string()),
                RuntimeReplyStreamEvent::Event("second".to_string())
            ]
        );
    }

    #[test]
    fn project_reply_stream_preserves_source_error() {
        use futures::{stream, StreamExt};

        let source_stream =
            stream::iter(vec![Ok("first"), Err(anyhow::anyhow!("source failed"))]).boxed();

        let events = futures::executor::block_on(
            project_reply_stream(source_stream, TextReplyStreamProjector).collect::<Vec<_>>(),
        );

        assert!(matches!(
            events.as_slice(),
            [Ok(RuntimeReplyStreamEvent::Event(_)), Err(_)]
        ));
        assert_eq!(events[1].as_ref().unwrap_err().to_string(), "source failed");
    }

    #[test]
    fn reply_stream_idle_timeout_builds_current_error_message() {
        let timeout = RuntimeReplyStreamIdleTimeout::new(Duration::from_millis(250));

        assert_eq!(
            timeout.message(),
            "Agent provider execution failed: stream idle timeout after 250ms without provider event"
        );
    }

    #[test]
    fn reply_stream_state_extends_first_event_timeout_only_until_first_event() {
        let mut state = RuntimeReplyStreamState::new();
        let timeout = Duration::from_millis(200);

        assert_eq!(
            state.next_timeout(Some(timeout)),
            Some(MIN_PROVIDER_STREAM_FIRST_EVENT_TIMEOUT)
        );

        state.mark_stream_event_seen();

        assert!(state.stream_event_seen());
        assert_eq!(state.next_timeout(Some(timeout)), Some(timeout));
    }

    #[test]
    fn reply_stream_state_preserves_first_inline_provider_error() {
        let mut state = RuntimeReplyStreamState::new();

        state.capture_inline_provider_error("first provider error");
        state.capture_inline_provider_error("second provider error");

        assert_eq!(
            state.take_inline_provider_error(),
            Some("first provider error".to_string())
        );
        assert_eq!(state.take_inline_provider_error(), None);
    }
}
