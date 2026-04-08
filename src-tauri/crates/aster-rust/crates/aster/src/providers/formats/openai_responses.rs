use crate::conversation::message::{Message, MessageContent};
use crate::model::ModelConfig;
use crate::providers::base::{ProviderUsage, Usage};
use crate::providers::formats::tool_description_with_examples;
use anyhow::{anyhow, Error};
use async_stream::try_stream;
use chrono;
use futures::Stream;
use rmcp::model::{object, CallToolRequestParam, RawContent, Role, Tool};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::ops::Deref;

fn convert_image_to_input_image(mime_type: &str, data: &str) -> Value {
    json!({
        "type": "input_image",
        "image_url": format!("data:{mime_type};base64,{data}")
    })
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ResponsesRequestOptions {
    pub previous_response_id: Option<String>,
    pub store: bool,
    pub output_schema: Option<Value>,
}

impl ResponsesRequestOptions {
    pub fn with_previous_response_id(previous_response_id: impl Into<String>) -> Self {
        Self {
            previous_response_id: Some(previous_response_id.into()),
            store: true,
            output_schema: None,
        }
    }
}

fn create_json_schema_text_format(output_schema: &Value) -> Value {
    json!({
        "format": {
            "type": "json_schema",
            "name": "aster_structured_output",
            "strict": true,
            "schema": output_schema,
        }
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ResponsesApiResponse {
    pub id: String,
    pub object: String,
    pub created_at: i64,
    pub status: String,
    pub model: String,
    pub output: Vec<ResponseOutputItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<ResponseReasoningInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<ResponseUsage>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
#[serde(rename_all = "snake_case")]
pub enum ResponseOutputItem {
    Reasoning {
        id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        summary: Option<Vec<String>>,
    },
    Message {
        id: String,
        status: String,
        role: String,
        content: Vec<ResponseContentBlock>,
    },
    FunctionCall {
        id: String,
        status: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        call_id: Option<String>,
        name: String,
        arguments: String,
    },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
#[serde(rename_all = "snake_case")]
pub enum ResponseContentBlock {
    OutputText {
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        annotations: Option<Vec<Value>>,
    },
    ToolCall {
        id: String,
        name: String,
        input: Value,
    },
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ResponseReasoningInfo {
    pub effort: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ResponseUsage {
    pub input_tokens: i32,
    pub output_tokens: i32,
    pub total_tokens: i32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
#[serde(rename_all = "snake_case")]
pub enum ResponsesStreamEvent {
    #[serde(rename = "response.created")]
    ResponseCreated {
        sequence_number: i32,
        response: ResponseMetadata,
    },
    #[serde(rename = "response.in_progress")]
    ResponseInProgress {
        sequence_number: i32,
        response: ResponseMetadata,
    },
    #[serde(rename = "response.output_item.added")]
    OutputItemAdded {
        sequence_number: i32,
        output_index: i32,
        item: ResponseOutputItemInfo,
    },
    #[serde(rename = "response.content_part.added")]
    ContentPartAdded {
        sequence_number: i32,
        item_id: String,
        output_index: i32,
        content_index: i32,
        part: ContentPart,
    },
    #[serde(rename = "response.output_text.delta")]
    OutputTextDelta {
        sequence_number: i32,
        item_id: String,
        output_index: i32,
        content_index: i32,
        delta: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        logprobs: Option<Vec<Value>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        obfuscation: Option<String>,
    },
    #[serde(rename = "response.output_item.done")]
    OutputItemDone {
        sequence_number: i32,
        output_index: i32,
        item: ResponseOutputItemInfo,
    },
    #[serde(rename = "response.content_part.done")]
    ContentPartDone {
        sequence_number: i32,
        item_id: String,
        output_index: i32,
        content_index: i32,
        part: ContentPart,
    },
    #[serde(rename = "response.output_text.done")]
    OutputTextDone {
        sequence_number: i32,
        item_id: String,
        output_index: i32,
        content_index: i32,
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        logprobs: Option<Vec<Value>>,
    },
    #[serde(rename = "response.completed")]
    ResponseCompleted {
        sequence_number: i32,
        response: ResponseMetadata,
    },
    #[serde(rename = "response.failed")]
    ResponseFailed { sequence_number: i32, error: Value },
    #[serde(rename = "response.function_call_arguments.delta")]
    FunctionCallArgumentsDelta {
        sequence_number: i32,
        item_id: String,
        output_index: i32,
        delta: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        obfuscation: Option<String>,
    },
    #[serde(rename = "response.function_call_arguments.done")]
    FunctionCallArgumentsDone {
        sequence_number: i32,
        item_id: String,
        output_index: i32,
        arguments: String,
    },
    #[serde(rename = "error")]
    Error { error: Value },
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ResponseMetadata {
    pub id: String,
    pub object: String,
    pub created_at: i64,
    pub status: String,
    pub model: String,
    pub output: Vec<ResponseOutputItemInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<ResponseUsage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<ResponseReasoningInfo>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type")]
#[serde(rename_all = "snake_case")]
pub enum ResponseOutputItemInfo {
    Reasoning {
        id: String,
        summary: Vec<String>,
    },
    Message {
        id: String,
        status: String,
        role: String,
        content: Vec<ContentPart>,
    },
    FunctionCall {
        id: String,
        status: String,
        call_id: String,
        name: String,
        arguments: String,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type")]
#[serde(rename_all = "snake_case")]
pub enum ContentPart {
    OutputText {
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        annotations: Option<Vec<Value>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        logprobs: Option<Vec<Value>>,
    },
    ToolCall {
        id: String,
        name: String,
        arguments: String,
    },
}

fn add_conversation_history(input_items: &mut Vec<Value>, messages: &[Message]) {
    for message in messages.iter().filter(|m| m.is_agent_visible()) {
        let has_only_tool_content = message.content.iter().all(|c| {
            matches!(
                c,
                MessageContent::ToolRequest(_) | MessageContent::ToolResponse(_)
            )
        });

        if has_only_tool_content {
            continue;
        }

        if message.role != Role::User && message.role != Role::Assistant {
            continue;
        }

        let role = match message.role {
            Role::User => "user",
            Role::Assistant => "assistant",
        };

        let mut content_items = Vec::new();
        for content in &message.content {
            match content {
                MessageContent::Text(text) => {
                    if !text.text.is_empty() {
                        let content_type = if message.role == Role::Assistant {
                            "output_text"
                        } else {
                            "input_text"
                        };
                        content_items.push(json!({
                            "type": content_type,
                            "text": text.text
                        }));
                    }
                }
                MessageContent::Image(image) => {
                    if message.role == Role::User
                        && !image.mime_type.is_empty()
                        && !image.data.is_empty()
                    {
                        content_items
                            .push(convert_image_to_input_image(&image.mime_type, &image.data));
                    }
                }
                _ => {}
            }
        }

        if !content_items.is_empty() {
            input_items.push(json!({
                "role": role,
                "content": content_items
            }));
        }
    }
}

fn add_function_calls(input_items: &mut Vec<Value>, messages: &[Message]) {
    for message in messages.iter().filter(|m| m.is_agent_visible()) {
        if message.role == Role::Assistant {
            for content in &message.content {
                if let MessageContent::ToolRequest(request) = content {
                    if let Ok(tool_call) = &request.tool_call {
                        let arguments_str = tool_call
                            .arguments
                            .as_ref()
                            .map(|args| {
                                serde_json::to_string(args).unwrap_or_else(|_| "{}".to_string())
                            })
                            .unwrap_or_else(|| "{}".to_string());

                        tracing::debug!(
                            "Replaying function_call with call_id: {}, name: {}",
                            request.id,
                            tool_call.name
                        );
                        input_items.push(json!({
                            "type": "function_call",
                            "call_id": request.id,
                            "name": tool_call.name,
                            "arguments": arguments_str
                        }));
                    }
                }
            }
        }
    }
}

fn add_function_call_outputs(input_items: &mut Vec<Value>, messages: &[Message]) {
    for message in messages.iter().filter(|m| m.is_agent_visible()) {
        for content in &message.content {
            if let MessageContent::ToolResponse(response) = content {
                match &response.tool_result {
                    Ok(contents) => {
                        let text_content: Vec<String> = contents
                            .content
                            .iter()
                            .filter_map(|c| {
                                if let RawContent::Text(t) = c.deref() {
                                    Some(t.text.clone())
                                } else {
                                    None
                                }
                            })
                            .collect();

                        if !text_content.is_empty() {
                            tracing::debug!(
                                "Sending function_call_output with call_id: {}",
                                response.id
                            );
                            input_items.push(json!({
                                "type": "function_call_output",
                                "call_id": response.id,
                                "output": text_content.join("\n")
                            }));
                        }
                    }
                    Err(error_data) => {
                        // Handle error responses - must send them back to the API
                        // to avoid "No tool output found" errors
                        tracing::debug!(
                            "Sending function_call_output error with call_id: {}",
                            response.id
                        );
                        input_items.push(json!({
                            "type": "function_call_output",
                            "call_id": response.id,
                            "output": format!("Error: {}", error_data.message)
                        }));
                    }
                }
            }
        }
    }
}

pub fn create_responses_request(
    model_config: &ModelConfig,
    system: &str,
    messages: &[Message],
    tools: &[Tool],
    options: &ResponsesRequestOptions,
) -> anyhow::Result<Value, Error> {
    let mut input_items = Vec::new();

    if !system.is_empty() {
        input_items.push(json!({
            "role": "system",
            "content": [{
                "type": "input_text",
                "text": system
            }]
        }));
    }

    add_conversation_history(&mut input_items, messages);
    add_function_calls(&mut input_items, messages);
    add_function_call_outputs(&mut input_items, messages);

    let mut payload = json!({
        "model": model_config.model_name,
        "input": input_items,
        "store": options.store,
    });

    if let Some(previous_response_id) = options.previous_response_id.as_ref() {
        payload.as_object_mut().unwrap().insert(
            "previous_response_id".to_string(),
            json!(previous_response_id),
        );
    }

    if let Some(output_schema) = options.output_schema.as_ref() {
        payload.as_object_mut().unwrap().insert(
            "text".to_string(),
            create_json_schema_text_format(output_schema),
        );
    }

    if !tools.is_empty() {
        let tools_spec: Vec<Value> = tools
            .iter()
            .map(|tool| {
                json!({
                    "type": "function",
                    "name": tool.name,
                    "description": tool_description_with_examples(tool),
                    "parameters": tool.input_schema,
                })
            })
            .collect();

        payload
            .as_object_mut()
            .unwrap()
            .insert("tools".to_string(), json!(tools_spec));
    }

    if let Some(temp) = model_config.temperature {
        payload
            .as_object_mut()
            .unwrap()
            .insert("temperature".to_string(), json!(temp));
    }

    if let Some(tokens) = model_config.max_tokens {
        payload
            .as_object_mut()
            .unwrap()
            .insert("max_output_tokens".to_string(), json!(tokens));
    }

    Ok(payload)
}

pub fn responses_api_to_message(response: &ResponsesApiResponse) -> anyhow::Result<Message> {
    let mut content = Vec::new();

    for item in &response.output {
        match item {
            ResponseOutputItem::Reasoning { .. } => {
                continue;
            }
            ResponseOutputItem::Message {
                content: msg_content,
                ..
            } => {
                for block in msg_content {
                    match block {
                        ResponseContentBlock::OutputText { text, .. } => {
                            if !text.is_empty() {
                                content.push(MessageContent::text(text));
                            }
                        }
                        ResponseContentBlock::ToolCall { id, name, input } => {
                            content.push(MessageContent::tool_request(
                                id.clone(),
                                Ok(CallToolRequestParam {
                                    name: name.clone().into(),
                                    arguments: Some(object(input.clone())),
                                }),
                            ));
                        }
                    }
                }
            }
            ResponseOutputItem::FunctionCall {
                id,
                name,
                arguments,
                ..
            } => {
                tracing::debug!("Received FunctionCall with id: {}, name: {}", id, name);
                let parsed_args = if arguments.is_empty() {
                    json!({})
                } else {
                    serde_json::from_str(arguments).unwrap_or_else(|_| json!({}))
                };

                content.push(MessageContent::tool_request(
                    id.clone(),
                    Ok(CallToolRequestParam {
                        name: name.clone().into(),
                        arguments: Some(object(parsed_args)),
                    }),
                ));
            }
        }
    }

    let mut message = Message::new(Role::Assistant, chrono::Utc::now().timestamp(), content);

    message = message.with_id(response.id.clone());

    Ok(message)
}

pub fn get_responses_usage(response: &ResponsesApiResponse) -> Usage {
    response.usage.as_ref().map_or_else(Usage::default, |u| {
        Usage::new(
            Some(u.input_tokens),
            Some(u.output_tokens),
            Some(u.total_tokens),
        )
    })
}

fn process_streaming_output_items(
    output_items: Vec<ResponseOutputItemInfo>,
    is_text_response: bool,
) -> Vec<MessageContent> {
    let mut content = Vec::new();

    for item in output_items {
        match item {
            ResponseOutputItemInfo::Reasoning { .. } => {
                // Skip reasoning items
            }
            ResponseOutputItemInfo::Message { content: parts, .. } => {
                for part in parts {
                    match part {
                        ContentPart::OutputText { text, .. } => {
                            if !text.is_empty() && !is_text_response {
                                content.push(MessageContent::text(&text));
                            }
                        }
                        ContentPart::ToolCall {
                            id,
                            name,
                            arguments,
                        } => {
                            let parsed_args = if arguments.is_empty() {
                                json!({})
                            } else {
                                serde_json::from_str(&arguments).unwrap_or_else(|_| json!({}))
                            };

                            content.push(MessageContent::tool_request(
                                id,
                                Ok(CallToolRequestParam {
                                    name: name.into(),
                                    arguments: Some(object(parsed_args)),
                                }),
                            ));
                        }
                    }
                }
            }
            ResponseOutputItemInfo::FunctionCall {
                call_id,
                name,
                arguments,
                ..
            } => {
                let parsed_args = if arguments.is_empty() {
                    json!({})
                } else {
                    serde_json::from_str(&arguments).unwrap_or_else(|_| json!({}))
                };

                content.push(MessageContent::tool_request(
                    call_id,
                    Ok(CallToolRequestParam {
                        name: name.into(),
                        arguments: Some(object(parsed_args)),
                    }),
                ));
            }
        }
    }

    content
}

pub fn responses_api_to_streaming_message<S>(
    mut stream: S,
) -> impl Stream<Item = anyhow::Result<(Option<Message>, Option<ProviderUsage>)>> + 'static
where
    S: Stream<Item = anyhow::Result<String>> + Unpin + Send + 'static,
{
    try_stream! {
        use futures::StreamExt;

        let mut accumulated_text = String::new();
        let mut response_id: Option<String> = None;
        let mut model_name: Option<String> = None;
        let mut final_usage: Option<ProviderUsage> = None;
        let mut output_items: Vec<ResponseOutputItemInfo> = Vec::new();
        let mut is_text_response = false;

        'outer: while let Some(response) = stream.next().await {
            let response_str = response?;

            // Skip empty lines
            if response_str.trim().is_empty() {
                continue;
            }

            // Parse SSE format: "event: <type>\ndata: <json>"
            // For now, we only care about the data line
            let data_line = if response_str.starts_with("data: ") {
                response_str.strip_prefix("data: ").unwrap()
            } else if response_str.starts_with("event: ") {
                // Skip event type lines
                continue;
            } else {
                // Try to parse as-is in case there's no prefix
                &response_str
            };

            if data_line == "[DONE]" {
                break 'outer;
            }

            let event: ResponsesStreamEvent = serde_json::from_str(data_line)
                .map_err(|e| anyhow!("Failed to parse Responses stream event: {}: {:?}", e, data_line))?;

            match event {
                ResponsesStreamEvent::ResponseCreated { response, .. } |
                ResponsesStreamEvent::ResponseInProgress { response, .. } => {
                    response_id = Some(response.id);
                    model_name = Some(response.model);
                }

                ResponsesStreamEvent::OutputTextDelta { delta, .. } => {
                    is_text_response = true;
                    accumulated_text.push_str(&delta);

                    // Yield incremental text updates for true streaming
                    let mut content = Vec::new();
                    if !delta.is_empty() {
                        content.push(MessageContent::text(&delta));
                    }
                    let mut msg = Message::new(Role::Assistant, chrono::Utc::now().timestamp(), content);

                    // Add ID so desktop client knows these deltas are part of the same message
                    if let Some(id) = &response_id {
                        msg = msg.with_id(id.clone());
                    }

                    yield (Some(msg), None);
                }

                ResponsesStreamEvent::OutputItemDone { item, .. } => {
                    output_items.push(item);
                }

                ResponsesStreamEvent::OutputTextDone { .. } => {
                    // Text is already complete from deltas, this is just a summary event
                }

                ResponsesStreamEvent::ResponseCompleted { response, .. } => {
                    let model = model_name.as_ref().unwrap_or(&response.model);
                    let usage = response.usage.as_ref().map_or_else(
                        Usage::default,
                        |u| Usage::new(
                            Some(u.input_tokens),
                            Some(u.output_tokens),
                            Some(u.total_tokens),
                        ),
                    );
                    final_usage = Some(ProviderUsage {
                        usage,
                        model: model.clone(),
                    });

                    // For complete output, use the response output items
                    if !response.output.is_empty() {
                        output_items = response.output;
                    }

                    break 'outer;
                }

                ResponsesStreamEvent::FunctionCallArgumentsDelta { .. } => {
                    // Function call arguments are being streamed, but we'll get the complete
                    // arguments in the OutputItemDone event, so we can ignore deltas for now
                }

                ResponsesStreamEvent::FunctionCallArgumentsDone { .. } => {
                    // Arguments are complete, will be in the OutputItemDone event
                }

                ResponsesStreamEvent::ResponseFailed { error, .. } => {
                    Err(anyhow!("Responses API failed: {:?}", error))?;
                }

                ResponsesStreamEvent::Error { error } => {
                    Err(anyhow!("Responses API error: {:?}", error))?;
                }

                _ => {
                    // Ignore other event types (OutputItemAdded, ContentPartAdded, ContentPartDone)
                }
            }
        }

        // Process final output items and yield usage data
        let content = process_streaming_output_items(output_items, is_text_response);

        if !content.is_empty() {
            let mut message = Message::new(Role::Assistant, chrono::Utc::now().timestamp(), content);
            if let Some(id) = response_id {
                message = message.with_id(id);
            }
            yield (Some(message), final_usage);
        } else if let Some(usage) = final_usage {
            yield (None, Some(usage));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rmcp::object;

    #[test]
    fn test_create_responses_request_with_input_examples_in_description() {
        let mut tool = Tool::new(
            "create_ticket",
            "Create ticket",
            object!({
                "type": "object",
                "properties": {
                    "title": { "type": "string" }
                },
                "required": ["title"]
            }),
        );
        tool.meta = Some(rmcp::model::Meta(object!({
            "input_examples": [
                {
                    "description": "Critical",
                    "input": {
                        "title": "service down"
                    }
                }
            ]
        })));

        let model_config = ModelConfig::new("gpt-4.1").unwrap();
        let payload = create_responses_request(
            &model_config,
            "",
            &[],
            &[tool],
            &ResponsesRequestOptions::default(),
        )
        .unwrap();
        let description = payload["tools"][0]["description"].as_str().unwrap_or("");
        assert!(description.contains("Input examples:"));
        assert!(description.contains("Critical"));
    }

    #[test]
    fn test_create_responses_request_preserves_user_images() {
        let model_config = ModelConfig::new("gpt-5.4").unwrap();
        let message = Message::user()
            .with_text("请识别这张图")
            .with_image("aGVsbG8=", "image/png");

        let payload = create_responses_request(
            &model_config,
            "",
            &[message],
            &[],
            &ResponsesRequestOptions::default(),
        )
        .unwrap();
        let content = payload["input"][0]["content"].as_array().unwrap();

        assert_eq!(content.len(), 2);
        assert_eq!(content[0]["type"], "input_text");
        assert_eq!(content[1]["type"], "input_image");
        assert_eq!(content[1]["image_url"], "data:image/png;base64,aGVsbG8=");
    }

    #[test]
    fn test_create_responses_request_preserves_multiple_user_images() {
        let model_config = ModelConfig::new("gpt-5.4").unwrap();
        let message = Message::user()
            .with_text("请对比两张图")
            .with_image("Zmlyc3Q=", "image/png")
            .with_image("c2Vjb25k", "image/jpeg");

        let payload = create_responses_request(
            &model_config,
            "",
            &[message],
            &[],
            &ResponsesRequestOptions::default(),
        )
        .unwrap();
        let content = payload["input"][0]["content"].as_array().unwrap();

        assert_eq!(content.len(), 3);
        assert_eq!(content[1]["type"], "input_image");
        assert_eq!(content[1]["image_url"], "data:image/png;base64,Zmlyc3Q=");
        assert_eq!(content[2]["type"], "input_image");
        assert_eq!(content[2]["image_url"], "data:image/jpeg;base64,c2Vjb25k");
    }

    #[test]
    fn test_create_responses_request_supports_previous_response_id() {
        let model_config = ModelConfig::new("o3").unwrap();
        let payload = create_responses_request(
            &model_config,
            "system",
            &[Message::user().with_text("继续")],
            &[],
            &ResponsesRequestOptions::with_previous_response_id("resp-1"),
        )
        .unwrap();

        assert_eq!(payload["store"], serde_json::json!(true));
        assert_eq!(payload["previous_response_id"], "resp-1");
        assert_eq!(payload["input"][0]["role"], "system");
        assert_eq!(payload["input"][1]["role"], "user");
    }

    #[test]
    fn test_create_responses_request_supports_native_output_schema() {
        let model_config = ModelConfig::new("gpt-5.3-codex").unwrap();
        let payload = create_responses_request(
            &model_config,
            "system",
            &[Message::user().with_text("请返回结构化结果")],
            &[],
            &ResponsesRequestOptions {
                output_schema: Some(json!({
                    "type": "object",
                    "properties": {
                        "answer": { "type": "string" }
                    },
                    "required": ["answer"]
                })),
                ..ResponsesRequestOptions::default()
            },
        )
        .unwrap();

        assert_eq!(payload["text"]["format"]["type"], "json_schema");
        assert_eq!(payload["text"]["format"]["name"], "aster_structured_output");
        assert_eq!(payload["text"]["format"]["strict"], true);
        assert_eq!(payload["text"]["format"]["schema"]["type"], "object");
        assert_eq!(
            payload["text"]["format"]["schema"]["properties"]["answer"]["type"],
            "string"
        );
    }
}
