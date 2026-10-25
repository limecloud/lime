mod completed_history;

use super::*;

#[derive(Debug, Default)]
struct ResponsesStreamState {
    response_id: Option<String>,
    item_ids: HashMap<u64, String>,
    completed_items: HashSet<String>,
    calls: HashMap<String, ToolCallAccumulator>,
    custom_calls: HashMap<String, CustomToolCallAccumulator>,
    call_identity: ResponseCallIdentity,
    emitted_calls: HashSet<String>,
    hosted_tools: HostedToolState,
    emitted_tool_call: bool,
    usage: Option<Usage>,
    text_ids: HashSet<String>,
    reasoning_ids: HashSet<String>,
    active_reasoning_id: Option<String>,
    server_model: Option<String>,
    emitted_verifications: HashSet<ModelVerification>,
    allow_openai_response_metadata: bool,
}

pub(in crate::current_client) struct ResponsesEventBatch {
    pub events: Vec<LlmEvent>,
    pub terminal: bool,
}

#[derive(Debug, Default)]
pub(in crate::current_client) struct ResponsesEventReducer {
    state: ResponsesStreamState,
}

impl ResponsesEventReducer {
    pub(in crate::current_client) fn new(
        server_model: Option<String>,
        allow_openai_response_metadata: bool,
    ) -> Self {
        Self {
            state: ResponsesStreamState {
                server_model,
                allow_openai_response_metadata,
                ..ResponsesStreamState::default()
            },
        }
    }

    pub fn push(&mut self, payload: &Value) -> Result<ResponsesEventBatch, CurrentProviderError> {
        let mut events = Vec::new();
        let mut terminal = false;
        let event_type = payload
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if let Some(model) = response_server_model(payload) {
            if self.state.server_model.as_deref() != Some(model.as_str()) {
                self.state.server_model = Some(model.clone());
                events.push(LlmEvent::ServerModel { model });
            }
        }
        match event_type {
            "response.metadata" if self.state.allow_openai_response_metadata => {
                let verifications = response_model_verifications(payload)
                    .into_iter()
                    .filter(|verification| self.state.emitted_verifications.insert(*verification))
                    .collect::<Vec<_>>();
                if !verifications.is_empty() {
                    events.push(LlmEvent::ModelVerification { verifications });
                }
                if let Some(metadata) = response_turn_moderation_metadata(payload) {
                    events.push(LlmEvent::TurnModerationMetadata { metadata });
                }
            }
            "response.output_text.delta" => {
                let id = completed_history::source_id(payload, "text", &self.state);
                if let Some(delta) = payload
                    .get("delta")
                    .and_then(Value::as_str)
                    .filter(|value| !value.is_empty())
                {
                    if self.state.text_ids.insert(id.clone()) {
                        events.push(LlmEvent::TextStart { id: id.clone() });
                    }
                    events.push(LlmEvent::TextDelta {
                        id,
                        text: delta.to_string(),
                    });
                }
            }
            "response.reasoning_summary_text.delta" => {
                let id = response_reasoning_id(payload, &self.state);
                if let (Some(delta), Some(summary_index)) = (
                    payload
                        .get("delta")
                        .and_then(Value::as_str)
                        .filter(|value| !value.is_empty()),
                    payload.get("summary_index").and_then(Value::as_i64),
                ) {
                    if self.state.reasoning_ids.insert(id.clone()) {
                        events.push(LlmEvent::ReasoningStart { id: id.clone() });
                    }
                    events.push(LlmEvent::ReasoningSummaryDelta {
                        id,
                        text: delta.to_string(),
                        summary_index,
                    });
                }
            }
            "response.reasoning_summary_part.added" => {
                let id = response_reasoning_id(payload, &self.state);
                if let Some(summary_index) = payload.get("summary_index").and_then(Value::as_i64) {
                    if self.state.reasoning_ids.insert(id.clone()) {
                        events.push(LlmEvent::ReasoningStart { id: id.clone() });
                    }
                    events.push(LlmEvent::ReasoningSummaryPartAdded { id, summary_index });
                }
            }
            "response.reasoning_text.delta" => {
                let id = response_reasoning_id(payload, &self.state);
                if let (Some(delta), Some(content_index)) = (
                    payload
                        .get("delta")
                        .and_then(Value::as_str)
                        .filter(|value| !value.is_empty()),
                    payload.get("content_index").and_then(Value::as_i64),
                ) {
                    if self.state.reasoning_ids.insert(id.clone()) {
                        events.push(LlmEvent::ReasoningStart { id: id.clone() });
                    }
                    events.push(LlmEvent::ReasoningContentDelta {
                        id,
                        text: delta.to_string(),
                        content_index,
                    });
                }
            }
            "response.output_item.added" => {
                if let Some(item) = payload.get("item") {
                    let item = completed_history::identified_item(payload, item, &mut self.state);
                    let item = &item;
                    self.state.call_identity.observe_item(payload);
                    observe_active_responses_reasoning_item(item, &mut self.state);
                    absorb_responses_call(item, &mut self.state);
                    absorb_responses_custom_call(item, &mut self.state);
                    events.extend(hosted_tool_events(
                        item,
                        &mut self.state.hosted_tools,
                        false,
                    )?);
                }
            }
            "response.function_call_arguments.delta" => {
                let key = self.state.call_identity.resolve(payload);
                let call = self.state.calls.entry(key.clone()).or_default();
                if let Some(call_id) = payload.get("call_id").and_then(Value::as_str) {
                    call.id = Some(call_id.to_string());
                }
                if let Some(name) = payload.get("name").and_then(Value::as_str) {
                    call.name = Some(name.to_string());
                }
                if let Some(delta) = payload.get("delta").and_then(Value::as_str) {
                    call.arguments.push_str(delta);
                    if let Some((id, name, arguments)) = call.begin_input_if_ready(&key) {
                        events.push(LlmEvent::ToolInputStart {
                            id: id.clone(),
                            name: name.clone(),
                        });
                        events.push(LlmEvent::ToolInputDelta {
                            id,
                            name,
                            text: arguments,
                        });
                    } else if call.started {
                        if let Some(name) = call.name.clone() {
                            events.push(LlmEvent::ToolInputDelta {
                                id: call.call_id(&key),
                                name,
                                text: delta.to_string(),
                            });
                        }
                    }
                }
            }
            "response.function_call_arguments.done" => {
                let key = self.state.call_identity.resolve(payload);
                let call = self.state.calls.entry(key.clone()).or_default();
                if let Some(call_id) = payload.get("call_id").and_then(Value::as_str) {
                    call.id = Some(call_id.to_string());
                }
                if let Some(name) = payload.get("name").and_then(Value::as_str) {
                    call.name = Some(name.to_string());
                }
                if let Some(arguments) = payload.get("arguments").and_then(Value::as_str) {
                    call.arguments = arguments.to_string();
                }
            }
            "response.custom_tool_call_input.delta" => {
                let key = self.state.call_identity.resolve(payload);
                let call = self.state.custom_calls.entry(key.clone()).or_default();
                if let Some(call_id) = payload.get("call_id").and_then(Value::as_str) {
                    call.id = Some(call_id.to_string());
                }
                if let Some(name) = payload.get("name").and_then(Value::as_str) {
                    call.name = Some(name.to_string());
                }
                if let Some(namespace) = payload.get("namespace").and_then(Value::as_str) {
                    call.namespace = Some(namespace.to_string());
                }
                if let Some(delta) = payload.get("delta").and_then(Value::as_str) {
                    call.input.push_str(delta);
                    if let Some((id, name, input)) = call.begin_input_if_ready(&key) {
                        events.push(LlmEvent::ToolInputStart {
                            id: id.clone(),
                            name: name.clone(),
                        });
                        events.push(LlmEvent::ToolInputDelta {
                            id,
                            name,
                            text: input,
                        });
                    } else if call.started {
                        if let Some(name) = call.name.clone() {
                            events.push(LlmEvent::ToolInputDelta {
                                id: call.call_id(&key),
                                name,
                                text: delta.to_string(),
                            });
                        }
                    }
                }
            }
            "response.custom_tool_call_input.done" => {
                let key = self.state.call_identity.resolve(payload);
                let call = self.state.custom_calls.entry(key.clone()).or_default();
                if let Some(call_id) = payload.get("call_id").and_then(Value::as_str) {
                    call.id = Some(call_id.to_string());
                }
                if let Some(name) = payload.get("name").and_then(Value::as_str) {
                    call.name = Some(name.to_string());
                }
                if let Some(input) = payload.get("input").and_then(Value::as_str) {
                    call.input = input.to_string();
                }
            }
            "response.output_item.done" => {
                if let Some(item) = payload.get("item") {
                    let item = completed_history::identified_item(payload, item, &mut self.state);
                    let item = &item;
                    events.extend(completed_history::completed(item, &mut self.state));
                    self.state.call_identity.observe_item(payload);
                    clear_active_responses_reasoning_item(item, &mut self.state);
                    absorb_responses_call(item, &mut self.state);
                    absorb_responses_custom_call(item, &mut self.state);
                    events.extend(hosted_tool_events(
                        item,
                        &mut self.state.hosted_tools,
                        true,
                    )?);
                    if item.get("type").and_then(Value::as_str) == Some("function_call") {
                        let key = self.state.call_identity.resolve(item);
                        events.extend(take_responses_call(&mut self.state, &key)?);
                    }
                    if item.get("type").and_then(Value::as_str) == Some("custom_tool_call") {
                        let key = self.state.call_identity.resolve(item);
                        events.extend(take_responses_custom_call(&mut self.state, &key)?);
                    }
                }
            }
            "response.completed" | "response.incomplete"
                if event_type == "response.completed"
                    || payload
                        .pointer("/response/incomplete_details/reason")
                        .and_then(Value::as_str)
                        == Some("interrupted") =>
            {
                let response = payload.get("response").unwrap_or(payload);
                self.state.response_id = response
                    .get("id")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned);
                if let Some(usage) = response.get("usage") {
                    let usage = responses_usage(usage);
                    events.push(LlmEvent::Usage {
                        usage: usage.clone(),
                    });
                    self.state.usage = Some(usage);
                }
                if event_type == "response.completed" {
                    for item in response
                        .get("output")
                        .and_then(Value::as_array)
                        .into_iter()
                        .flatten()
                    {
                        absorb_responses_call(item, &mut self.state);
                        absorb_responses_custom_call(item, &mut self.state);
                        events.extend(hosted_tool_events(
                            item,
                            &mut self.state.hosted_tools,
                            true,
                        )?);
                    }
                    events.extend(take_responses_calls(&mut self.state)?);
                    events.extend(take_responses_custom_calls(&mut self.state)?);
                }
                events.extend(
                    self.state
                        .text_ids
                        .drain()
                        .map(|id| LlmEvent::TextEnd { id }),
                );
                events.extend(
                    self.state
                        .reasoning_ids
                        .drain()
                        .map(|id| LlmEvent::ReasoningEnd { id }),
                );
                events.push(LlmEvent::Finish {
                    reason: if self.state.emitted_tool_call {
                        FinishReason::ToolCall
                    } else {
                        FinishReason::Stop
                    },
                    usage: self.state.usage.take(),
                    needs_follow_up: event_type == "response.incomplete"
                        || response.get("end_turn").and_then(Value::as_bool) == Some(false),
                    response_id: self.state.response_id.clone(),
                });
                terminal = true;
            }
            "error" | "response.failed" => {
                let message = payload
                    .pointer("/error/message")
                    .or_else(|| payload.get("message"))
                    .and_then(Value::as_str)
                    .unwrap_or("Responses provider stream failed");
                events.push(LlmEvent::ProviderError {
                    message: message.to_string(),
                    classification: Some(FailureClassification::ProviderInternal),
                    retryable: Some(false),
                });
                terminal = true;
            }
            _ => {}
        }
        Ok(ResponsesEventBatch { events, terminal })
    }

    pub fn finish_incomplete(mut self) -> Vec<LlmEvent> {
        let mut events = Vec::new();
        events.extend(
            self.state
                .text_ids
                .drain()
                .map(|id| LlmEvent::TextEnd { id }),
        );
        events.extend(
            self.state
                .reasoning_ids
                .drain()
                .map(|id| LlmEvent::ReasoningEnd { id }),
        );
        events.push(LlmEvent::ProviderError {
            message: "stream closed before response.completed".to_string(),
            classification: Some(FailureClassification::Transport),
            retryable: Some(true),
        });
        events
    }
}

pub(in crate::current_client) fn responses_sse(
    response: Response,
    allow_openai_response_metadata: bool,
) -> impl Stream<Item = Result<LlmEvent, CurrentProviderError>> + Send {
    let server_model = response_header_model(response.headers());
    try_stream! {
        let mut reducer = ResponsesEventReducer::new(
            server_model.clone(),
            allow_openai_response_metadata,
        );
        if let Some(model) = server_model {
            yield LlmEvent::ServerModel { model };
        }
        let mut frames = Box::pin(sse_frames(response));
        while let Some(frame) = frames.next().await {
            let frame = frame?;
            let payload: Value = serde_json::from_str(&frame.data)
                .map_err(|error| CurrentProviderError::new(format!("解析 Responses SSE event 失败: {error}")))?;
            let batch = reducer.push(&payload)?;
            if batch.terminal {
                drop(frames);
                for event in batch.events {
                    yield event;
                }
                return;
            }
            for event in batch.events {
                yield event;
            }
        }
        for event in reducer.finish_incomplete() {
            yield event;
        }
    }
}

fn response_header_model(headers: &reqwest::header::HeaderMap) -> Option<String> {
    ["openai-model", "x-openai-model"]
        .into_iter()
        .find_map(|name| headers.get(name))
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn response_server_model(payload: &Value) -> Option<String> {
    payload
        .pointer("/response/headers")
        .and_then(response_model_from_json_headers)
        .or_else(|| {
            payload
                .get("headers")
                .and_then(response_model_from_json_headers)
        })
}

fn response_model_from_json_headers(headers: &Value) -> Option<String> {
    headers.as_object()?.iter().find_map(|(name, value)| {
        if !name.eq_ignore_ascii_case("openai-model")
            && !name.eq_ignore_ascii_case("x-openai-model")
        {
            return None;
        }
        json_header_string(value)
    })
}

fn json_header_string(value: &Value) -> Option<String> {
    let value = match value {
        Value::String(value) => Some(value.as_str()),
        Value::Array(values) => values.first().and_then(Value::as_str),
        _ => None,
    }?;
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn response_model_verifications(payload: &Value) -> Vec<ModelVerification> {
    payload
        .pointer("/metadata/openai_verification_recommendation")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter_map(|value| match value {
            "trusted_access_for_cyber" => Some(ModelVerification::TrustedAccessForCyber),
            _ => None,
        })
        .collect()
}

fn response_turn_moderation_metadata(payload: &Value) -> Option<Value> {
    payload
        .pointer("/metadata/openai_chatgpt_moderation_metadata")
        .cloned()
}

fn take_responses_calls(
    state: &mut ResponsesStreamState,
) -> Result<Vec<LlmEvent>, CurrentProviderError> {
    let keys = state.calls.keys().cloned().collect::<Vec<_>>();
    let mut events = Vec::new();
    for key in keys {
        events.extend(take_responses_call(state, &key)?);
    }
    Ok(events)
}

fn take_responses_custom_calls(
    state: &mut ResponsesStreamState,
) -> Result<Vec<LlmEvent>, CurrentProviderError> {
    let keys = state.custom_calls.keys().cloned().collect::<Vec<_>>();
    let mut events = Vec::new();
    for key in keys {
        events.extend(take_responses_custom_call(state, &key)?);
    }
    Ok(events)
}

fn take_responses_custom_call(
    state: &mut ResponsesStreamState,
    key: &str,
) -> Result<Vec<LlmEvent>, CurrentProviderError> {
    let call = state
        .custom_calls
        .get_mut(key)
        .expect("response custom tool call must be accumulated before emission");
    let mut events = Vec::new();
    if let Some((id, name, input)) = call.begin_input_if_ready(key) {
        events.push(LlmEvent::ToolInputStart {
            id: id.clone(),
            name: name.clone(),
        });
        events.push(LlmEvent::ToolInputDelta {
            id,
            name,
            text: input,
        });
    }
    let Some(call) = call.into_call(key) else {
        return Ok(events);
    };
    state.emitted_tool_call = true;
    events.push(LlmEvent::ToolInputEnd {
        id: call.id.clone(),
        name: call.name.clone(),
    });
    events.push(LlmEvent::CustomToolCall {
        id: call.id,
        name: call.name,
        input: call.input,
        namespace: call.namespace,
        provider_metadata: call.provider_metadata,
    });
    Ok(events)
}

fn take_responses_call(
    state: &mut ResponsesStreamState,
    key: &str,
) -> Result<Vec<LlmEvent>, CurrentProviderError> {
    let mut events = Vec::new();
    let call = state
        .calls
        .get_mut(key)
        .expect("response tool call must be accumulated before emission");
    if let Some((id, name, arguments)) = call.begin_input_if_ready(key) {
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
    let Some(call) = call.into_call(key) else {
        return Ok(events);
    };
    if state.emitted_calls.insert(call.id.clone()) {
        state.emitted_tool_call = true;
        events.push(LlmEvent::ToolInputEnd {
            id: call.id.clone(),
            name: call.name.clone(),
        });
        events.push(LlmEvent::ToolCall {
            id: call.id,
            name: call.name,
            input: call.arguments,
            raw_arguments: Some(call.raw_arguments),
            provider_executed: None,
            provider_metadata: Default::default(),
        });
    }
    Ok(events)
}

fn response_block_id(payload: &Value, prefix: &str) -> String {
    payload
        .get("item_id")
        .or_else(|| payload.get("output_index"))
        .map(|value| {
            value
                .as_str()
                .map(ToOwned::to_owned)
                .unwrap_or_else(|| value.to_string())
        })
        .map(|id| format!("{prefix}-{id}"))
        .unwrap_or_else(|| format!("{prefix}-0"))
}

fn response_reasoning_id(payload: &Value, state: &ResponsesStreamState) -> String {
    payload
        .get("item_id")
        .map(|_| completed_history::source_id(payload, "reasoning", state))
        .or_else(|| state.active_reasoning_id.clone())
        .unwrap_or_else(|| completed_history::source_id(payload, "reasoning", state))
}

fn observe_active_responses_reasoning_item(item: &Value, state: &mut ResponsesStreamState) {
    if item.get("type").and_then(Value::as_str) != Some("reasoning") {
        return;
    }
    state.active_reasoning_id = Some(response_item_id(item, "reasoning"));
}

fn clear_active_responses_reasoning_item(item: &Value, state: &mut ResponsesStreamState) {
    if item.get("type").and_then(Value::as_str) != Some("reasoning") {
        return;
    }
    let item_id = response_item_id(item, "reasoning");
    if state.active_reasoning_id.as_deref() == Some(item_id.as_str()) {
        state.active_reasoning_id = None;
    }
}

fn response_item_id(item: &Value, prefix: &str) -> String {
    item.get("id")
        .or_else(|| item.get("item_id"))
        .or_else(|| item.get("output_index"))
        .map(|value| {
            value
                .as_str()
                .map(ToOwned::to_owned)
                .unwrap_or_else(|| value.to_string())
        })
        .map(|id| format!("{prefix}-{id}"))
        .unwrap_or_else(|| format!("{prefix}-0"))
}

fn absorb_responses_call(item: &Value, state: &mut ResponsesStreamState) {
    if item.get("type").and_then(Value::as_str) != Some("function_call") {
        return;
    }
    let key = state.call_identity.resolve(item);
    let call = state.calls.entry(key).or_default();
    call.id = item
        .get("call_id")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .or(call.id.clone());
    call.name = item
        .get("name")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .or(call.name.clone());
    if let Some(arguments) = item.get("arguments").and_then(Value::as_str) {
        call.arguments = arguments.to_string();
    }
}

fn absorb_responses_custom_call(item: &Value, state: &mut ResponsesStreamState) {
    if item.get("type").and_then(Value::as_str) != Some("custom_tool_call") {
        return;
    }
    let key = state.call_identity.resolve(item);
    let call = state.custom_calls.entry(key).or_default();
    call.id = item
        .get("call_id")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .or(call.id.clone());
    call.name = item
        .get("name")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .or(call.name.clone());
    call.namespace = item
        .get("namespace")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .or(call.namespace.clone());
    if let Some(input) = item.get("input").and_then(Value::as_str) {
        call.input = input.to_string();
    }
}

#[cfg(test)]
pub(in crate::current_client) fn response_item_tool_call(
    item: &Value,
) -> Result<Option<CurrentProviderToolCall>, CurrentProviderError> {
    if item.get("type").and_then(Value::as_str) != Some("function_call") {
        return Ok(None);
    }
    let id = item
        .get("call_id")
        .and_then(Value::as_str)
        .ok_or_else(|| CurrentProviderError::new("Responses function_call omitted call_id"))?
        .to_string();
    let name = item
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| CurrentProviderError::new("Responses function_call omitted name"))?
        .to_string();
    let arguments = item
        .get("arguments")
        .and_then(Value::as_str)
        .unwrap_or("{}")
        .to_string();
    Ok(Some(CurrentProviderToolCall::from_raw(id, name, arguments)))
}

pub(super) fn responses_usage(value: &Value) -> Usage {
    let number = |key: &str| value.get(key).and_then(Value::as_u64);
    Usage {
        input_tokens: number("input_tokens"),
        output_tokens: number("output_tokens"),
        cache_read_input_tokens: value
            .pointer("/input_tokens_details/cached_tokens")
            .and_then(Value::as_u64),
        total_tokens: number("total_tokens"),
        lime_rollout_budget_units: value
            .get("codex_rollout_budget_units")
            .and_then(Value::as_number)
            .cloned(),
        ..Usage::default()
    }
}

#[cfg(test)]
#[path = "responses/completion_tests.rs"]
mod completion_tests;
