mod responses;
mod tool_output;
pub(super) use responses::responses_message;
use tool_output::{anthropic_tool_content, tool_media_observations};

use super::{
    REQUEST_KIND_METADATA_KEY, SESSION_ID_METADATA_KEY, THREAD_ID_METADATA_KEY,
    TURN_ID_METADATA_KEY, X_CODEX_TURN_METADATA_KEY,
};
use crate::provider_capabilities::ProviderCapabilities;
use crate::provider_stream::RuntimeReplyProviderRequestWireShape;
use crate::runtime_provider::RuntimeProviderConfig;
use agent_protocol::ImageDetail;
use runtime_core::{
    CanonicalRequest, CanonicalRole, CanonicalToolDefinition, ContentPart, ToolResultValue,
};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;

pub(super) fn chat_completions_request(
    config: &RuntimeProviderConfig,
    request: &CanonicalRequest,
    wire_shape: &RuntimeReplyProviderRequestWireShape,
    media_payloads: &BTreeMap<String, String>,
) -> Result<Value, super::CurrentProviderError> {
    ensure_no_custom_history(request, "Chat Completions")?;
    let mut messages = Vec::new();
    let system = text_from_parts(&request.system);
    if !system.is_empty() {
        messages.push(json!({ "role": "system", "content": system }));
    }
    let mut observations = Vec::new();
    for message in &request.messages {
        if message.role != CanonicalRole::Tool && !observations.is_empty() {
            messages.push(json!({"role":"user","content":std::mem::take(&mut observations)}));
        }
        messages.extend(chat_message(message, media_payloads));
        if message.role == CanonicalRole::Tool {
            observations.extend(tool_media_observations(&message.content, media_payloads));
        }
    }
    if !observations.is_empty() {
        messages.push(json!({"role":"user","content":observations}));
    }
    let mut object = Map::from_iter([
        ("model".to_string(), json!(config.model_name)),
        ("messages".to_string(), Value::Array(messages)),
        ("stream".to_string(), Value::Bool(true)),
        (
            "stream_options".to_string(),
            json!({ "include_usage": true }),
        ),
    ]);
    if !request.tools.is_empty() {
        object.insert(
            "tools".to_string(),
            Value::Array(
                request
                    .tools
                    .iter()
                    .map(chat_tool)
                    .collect::<Result<Vec<_>, _>>()?,
            ),
        );
        if let Some(parallel_tool_calls) = wire_shape.parallel_tool_calls {
            object.insert(
                "parallel_tool_calls".to_string(),
                json!(parallel_tool_calls),
            );
        }
    }
    apply_generation_options(&mut object, request, "max_tokens", false);
    apply_chat_reasoning_effort(&mut object, config);
    apply_service_tier(&mut object, config);
    apply_chat_structured_output(&mut object, request)?;
    if let Some(enable_thinking) = request
        .provider_options
        .get("enable_thinking")
        .and_then(Value::as_bool)
    {
        object.insert(
            "chat_template_kwargs".to_string(),
            json!({ "enable_thinking": enable_thinking }),
        );
    }
    Ok(Value::Object(object))
}

pub(super) fn responses_request(
    config: &RuntimeProviderConfig,
    request: &CanonicalRequest,
    wire_shape: &RuntimeReplyProviderRequestWireShape,
    media_payloads: &BTreeMap<String, String>,
) -> Result<Value, super::CurrentProviderError> {
    if contains_custom_history(request)
        && !ProviderCapabilities::from_runtime_config(config).custom_tools
    {
        return Err(super::CurrentProviderError::invalid_request(
            "resolved Responses route does not support custom tool call history",
        ));
    }
    let mut input = Vec::new();
    for message in &request.messages {
        input.extend(responses_message(message, media_payloads));
    }
    if wire_shape.use_responses_lite {
        input
            .iter_mut()
            .for_each(strip_responses_lite_image_details);
    }

    let instructions = text_from_parts(&request.system);
    let instructions_in_input = wire_shape.instructions_location.as_deref() == Some("input_prefix")
        || (wire_shape.use_responses_lite && wire_shape.instructions_location.is_none());
    let tools_in_input = wire_shape.tools_location.as_deref() == Some("input_prefix")
        || (wire_shape.use_responses_lite && wire_shape.tools_location.is_none());
    let response_tools = request
        .tools
        .iter()
        .filter(|tool| web_search::visible(tool, wire_shape.web_search_mode))
        .map(|tool| responses_tool(config, tool, wire_shape.web_search_mode))
        .collect::<Result<Vec<_>, _>>()?;
    let mut input_prefix = Vec::new();
    if tools_in_input {
        input_prefix.push(json!({
            "type": "additional_tools",
            "role": "developer",
            "tools": response_tools,
        }));
    }
    if instructions_in_input && !instructions.is_empty() {
        input_prefix.push(json!({
            "type": "message",
            "role": "developer",
            "content": [{ "type": "input_text", "text": instructions }],
        }));
    }
    input.splice(0..0, input_prefix);

    let mut object = Map::from_iter([
        ("model".to_string(), json!(config.model_name)),
        ("input".to_string(), Value::Array(input)),
        ("stream".to_string(), Value::Bool(true)),
        ("store".to_string(), Value::Bool(false)),
        (
            "include".to_string(),
            json!(["reasoning.encrypted_content"]),
        ),
    ]);
    if !instructions_in_input && !instructions.is_empty() {
        object.insert("instructions".to_string(), json!(instructions));
    }
    if !tools_in_input && !response_tools.is_empty() {
        object.insert("tools".to_string(), Value::Array(response_tools));
    }
    if let Some(parallel_tool_calls) = wire_shape.parallel_tool_calls {
        object.insert(
            "parallel_tool_calls".to_string(),
            json!(parallel_tool_calls),
        );
    }
    apply_generation_options(&mut object, request, "max_output_tokens", false);
    apply_responses_reasoning(&mut object, config, wire_shape);
    apply_text_verbosity(&mut object, wire_shape);
    apply_responses_structured_output(&mut object, request, wire_shape)?;
    apply_service_tier(&mut object, config);
    if let Some(session_id) = responses_prompt_cache_key(config, request) {
        object.insert("prompt_cache_key".to_string(), Value::String(session_id));
    }
    if let Some(client_metadata) = responses_client_metadata(request) {
        object.insert(
            "client_metadata".to_string(),
            Value::Object(client_metadata),
        );
    }
    Ok(Value::Object(object))
}

fn responses_prompt_cache_key(
    config: &RuntimeProviderConfig,
    request: &CanonicalRequest,
) -> Option<String> {
    let provider = config
        .provider_name
        .trim()
        .to_ascii_lowercase()
        .replace(['-', ' '], "_");
    if !matches!(
        provider.as_str(),
        "openai" | "codex" | "openai_response" | "openai_responses"
    ) {
        return None;
    }
    request
        .metadata
        .get(SESSION_ID_METADATA_KEY)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn responses_client_metadata(request: &CanonicalRequest) -> Option<Map<String, Value>> {
    let session_id = request.metadata.get(SESSION_ID_METADATA_KEY)?.as_str()?;
    let thread_id = request.metadata.get(THREAD_ID_METADATA_KEY)?.as_str()?;
    let turn_id = request.metadata.get(TURN_ID_METADATA_KEY)?.as_str()?;

    let mut turn_metadata = request
        .metadata
        .iter()
        .filter_map(|(key, value)| {
            if value.is_boolean() && key == "history_ingest_requested" {
                Some((key.clone(), value.clone()))
            } else {
                value
                    .as_str()
                    .map(|value| (key.clone(), Value::String(value.to_string())))
            }
        })
        .collect::<Map<String, Value>>();
    turn_metadata.insert(
        REQUEST_KIND_METADATA_KEY.to_string(),
        Value::String("turn".to_string()),
    );
    let serialized = serde_json::to_string(&turn_metadata).ok()?;

    let client_metadata = Map::from_iter([
        (
            SESSION_ID_METADATA_KEY.to_string(),
            Value::String(session_id.to_string()),
        ),
        (
            THREAD_ID_METADATA_KEY.to_string(),
            Value::String(thread_id.to_string()),
        ),
        (
            TURN_ID_METADATA_KEY.to_string(),
            Value::String(turn_id.to_string()),
        ),
        (
            X_CODEX_TURN_METADATA_KEY.to_string(),
            Value::String(serialized),
        ),
    ]);
    Some(client_metadata)
}

pub(super) fn anthropic_request(
    config: &RuntimeProviderConfig,
    request: &CanonicalRequest,
    media_payloads: &BTreeMap<String, String>,
) -> Result<Value, super::CurrentProviderError> {
    ensure_no_custom_history(request, "Anthropic Messages")?;
    super::tool_arguments::ensure_structured_history(request, "Anthropic Messages")?;
    let messages = request
        .messages
        .iter()
        .flat_map(|message| anthropic_message(message, media_payloads))
        .collect::<Vec<_>>();
    let mut object = Map::from_iter([
        ("model".to_string(), json!(config.model_name)),
        ("messages".to_string(), Value::Array(messages)),
        ("max_tokens".to_string(), json!(4096)),
        ("stream".to_string(), Value::Bool(true)),
    ]);
    let system = text_from_parts(&request.system);
    if !system.is_empty() {
        object.insert("system".to_string(), json!(system));
    }
    if !request.tools.is_empty() {
        object.insert(
            "tools".to_string(),
            Value::Array(
                request
                    .tools
                    .iter()
                    .map(anthropic_tool)
                    .collect::<Result<Vec<_>, _>>()?,
            ),
        );
    }
    apply_generation_options(&mut object, request, "max_tokens", true);
    apply_anthropic_structured_output(&mut object, request)?;
    Ok(Value::Object(object))
}

fn normalized_output_schema(request: &CanonicalRequest) -> Option<&Value> {
    let value = request.output_schema.as_ref()?;
    if value.get("type").and_then(Value::as_str) == Some("json_schema") {
        value.get("schema").or(Some(value))
    } else {
        Some(value)
    }
}

fn output_schema_name(schema: &Value) -> String {
    schema
        .get("title")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("structured_output")
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '_' || character == '-' {
                character
            } else {
                '_'
            }
        })
        .collect()
}

fn apply_chat_structured_output(
    object: &mut Map<String, Value>,
    request: &CanonicalRequest,
) -> Result<(), super::CurrentProviderError> {
    let Some(schema) = normalized_output_schema(request) else {
        return Ok(());
    };
    object.insert(
        "response_format".to_string(),
        json!({
            "type": "json_schema",
            "json_schema": {
                "name": output_schema_name(schema),
                "strict": request.output_schema_strict,
                "schema": schema,
            }
        }),
    );
    Ok(())
}

fn apply_responses_structured_output(
    object: &mut Map<String, Value>,
    request: &CanonicalRequest,
    wire_shape: &RuntimeReplyProviderRequestWireShape,
) -> Result<(), super::CurrentProviderError> {
    let Some(schema) = normalized_output_schema(request) else {
        return Ok(());
    };
    let mut text = object
        .remove("text")
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    text.insert(
        "format".to_string(),
        json!({
            "type": "json_schema",
            "name": output_schema_name(schema),
            "strict": request.output_schema_strict,
            "schema": schema,
        }),
    );
    if let Some(verbosity) = wire_shape
        .text_verbosity
        .as_deref()
        .filter(|verbosity| matches!(*verbosity, "low" | "medium" | "high"))
    {
        text.insert("verbosity".to_string(), json!(verbosity));
    }
    object.insert("text".to_string(), Value::Object(text));
    Ok(())
}

fn apply_anthropic_structured_output(
    object: &mut Map<String, Value>,
    request: &CanonicalRequest,
) -> Result<(), super::CurrentProviderError> {
    let Some(schema) = normalized_output_schema(request) else {
        return Ok(());
    };
    object.insert(
        "output_config".to_string(),
        json!({
            "format": {
                "type": "json_schema",
                "schema": schema,
            }
        }),
    );
    Ok(())
}

fn apply_generation_options(
    object: &mut Map<String, Value>,
    request: &CanonicalRequest,
    max_tokens_key: &str,
    supports_top_k: bool,
) {
    if let Some(max_tokens) = request.generation.max_tokens {
        object.insert(max_tokens_key.to_string(), json!(max_tokens));
    }
    if let Some(temperature) = request.generation.temperature {
        object.insert("temperature".to_string(), json!(temperature));
    }
    if let Some(top_p) = request.generation.top_p {
        object.insert("top_p".to_string(), json!(top_p));
    }
    if supports_top_k {
        if let Some(top_k) = request.generation.top_k {
            object.insert("top_k".to_string(), json!(top_k));
        }
    }
}

fn apply_chat_reasoning_effort(object: &mut Map<String, Value>, config: &RuntimeProviderConfig) {
    let Some(effort) = config
        .reasoning_effort
        .as_deref()
        .filter(|effort| !effort.trim().is_empty())
    else {
        return;
    };

    object.insert("reasoning_effort".to_string(), json!(effort));
}

fn apply_responses_reasoning(
    object: &mut Map<String, Value>,
    config: &RuntimeProviderConfig,
    wire_shape: &RuntimeReplyProviderRequestWireShape,
) {
    let mut reasoning = Map::new();
    if let Some(effort) = config
        .reasoning_effort
        .as_deref()
        .map(str::trim)
        .filter(|effort| !effort.is_empty())
    {
        reasoning.insert("effort".to_string(), json!(effort));
    }
    if let Some(summary) = wire_shape
        .reasoning_summary
        .as_deref()
        .map(str::trim)
        .filter(|summary| !summary.is_empty() && *summary != "none")
    {
        reasoning.insert("summary".to_string(), json!(summary));
    }
    if let Some(context) = wire_shape
        .reasoning_context
        .as_deref()
        .map(str::trim)
        .filter(|context| matches!(*context, "all_turns" | "current_turn" | "auto"))
    {
        reasoning.insert("context".to_string(), json!(context));
    }
    if !reasoning.is_empty() {
        object.insert("reasoning".to_string(), Value::Object(reasoning));
    }
}

fn apply_text_verbosity(
    object: &mut Map<String, Value>,
    wire_shape: &RuntimeReplyProviderRequestWireShape,
) {
    let Some(verbosity) = wire_shape
        .text_verbosity
        .as_deref()
        .map(str::trim)
        .filter(|verbosity| matches!(*verbosity, "low" | "medium" | "high"))
    else {
        return;
    };
    object.insert("text".to_string(), json!({ "verbosity": verbosity }));
}

fn apply_service_tier(object: &mut Map<String, Value>, config: &RuntimeProviderConfig) {
    let Some(service_tier) = config
        .service_tier
        .as_deref()
        .map(str::trim)
        .filter(|service_tier| !service_tier.is_empty())
    else {
        return;
    };
    object.insert("service_tier".to_string(), json!(service_tier));
}

fn chat_message(
    message: &runtime_core::CanonicalMessage,
    media_payloads: &BTreeMap<String, String>,
) -> Vec<Value> {
    match message.role {
        CanonicalRole::Tool => message
            .content
            .iter()
            .filter_map(|content| match content {
                ContentPart::ToolResult {
                    id, result, error, ..
                } => Some(json!({
                    "role": "tool",
                    "tool_call_id": id,
                    "content": tool_result_text(result, error.as_deref()),
                })),
                _ => None,
            })
            .collect(),
        CanonicalRole::Assistant => {
            let text = text_from_parts(&message.content);
            let reasoning = reasoning_from_parts(&message.content);
            let tool_calls = message
                .content
                .iter()
                .filter_map(|content| match content {
                    ContentPart::ToolCall {
                        id, name, input, raw_arguments, ..
                    } => Some(json!({
                        "id": id,
                        "type": "function",
                        "function": { "name": name, "arguments": raw_arguments.clone().unwrap_or_else(|| input.to_string()) },
                    })),
                    _ => None,
                })
                .collect::<Vec<_>>();
            let mut value = json!({ "role": "assistant", "content": text });
            if !reasoning.is_empty() {
                value["reasoning_content"] = json!(reasoning);
            }
            if !tool_calls.is_empty() {
                value["tool_calls"] = Value::Array(tool_calls);
            }
            vec![value]
        }
        CanonicalRole::User | CanonicalRole::System | CanonicalRole::Developer => vec![json!({
            "role": wire_role(message.role),
            "content": chat_content(&message.content, media_payloads),
        })],
    }
}

fn ensure_no_custom_history(
    request: &CanonicalRequest,
    protocol: &str,
) -> Result<(), super::CurrentProviderError> {
    if contains_custom_history(request) {
        return Err(super::CurrentProviderError::invalid_request(format!(
            "{protocol} cannot lower custom tool call history"
        )));
    }
    Ok(())
}

fn contains_custom_history(request: &CanonicalRequest) -> bool {
    request.messages.iter().any(|message| {
        message.content.iter().any(|part| {
            matches!(
                part,
                ContentPart::CustomToolCall { .. } | ContentPart::CustomToolResult { .. }
            )
        })
    })
}

fn wire_role(role: CanonicalRole) -> &'static str {
    match role {
        CanonicalRole::System => "system",
        CanonicalRole::Developer => "developer",
        CanonicalRole::User => "user",
        CanonicalRole::Assistant => "assistant",
        CanonicalRole::Tool => "tool",
    }
}

fn chat_content(content: &[ContentPart], media_payloads: &BTreeMap<String, String>) -> Value {
    let has_media = content
        .iter()
        .any(|part| matches!(part, ContentPart::Media { .. }));
    if !has_media {
        return json!(text_from_parts(content));
    }
    Value::Array(
        content
            .iter()
            .filter_map(|part| match part {
                ContentPart::Text { text, .. } => Some(json!({ "type": "text", "text": text })),
                ContentPart::Media { uri, detail, .. } => {
                    let mut image_url = Map::from_iter([(
                        "url".to_string(),
                        json!(provider_media_uri(uri, media_payloads)),
                    )]);
                    if let Some(detail) = detail.map(openai_image_detail) {
                        image_url.insert("detail".to_string(), json!(detail));
                    }
                    Some(json!({
                        "type": "image_url",
                        "image_url": Value::Object(image_url),
                    }))
                }
                _ => None,
            })
            .collect(),
    )
}

fn chat_tool(tool: &CanonicalToolDefinition) -> Result<Value, super::CurrentProviderError> {
    let CanonicalToolDefinition::Function {
        name,
        description,
        input_schema,
        ..
    } = tool
    else {
        return Err(super::CurrentProviderError::invalid_request(
            "custom tools require a Responses provider route",
        ));
    };
    Ok(json!({
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": input_schema,
            "strict": false,
        }
    }))
}

fn responses_tool(
    config: &RuntimeProviderConfig,
    tool: &CanonicalToolDefinition,
    web_search_mode: Option<agent_protocol::WebSearchMode>,
) -> Result<Value, super::CurrentProviderError> {
    let CanonicalToolDefinition::Function {
        name,
        description,
        input_schema,
        ..
    } = tool
    else {
        let CanonicalToolDefinition::Custom {
            name,
            description,
            format,
            ..
        } = tool
        else {
            unreachable!();
        };
        if !ProviderCapabilities::from_runtime_config(config).custom_tools {
            return Err(super::CurrentProviderError::invalid_request(
                "resolved Responses route does not support custom tools",
            ));
        }
        return Ok(json!({
            "type": "custom",
            "name": name,
            "description": description,
            "format": {
                "type": format.r#type,
                "syntax": format.syntax,
                "definition": format.definition,
            },
        }));
    };
    let capabilities = ProviderCapabilities::from_runtime_config(config);
    if capabilities.web_search && is_web_search_tool_name(name) {
        return Ok(web_search::hosted_definition(
            web_search_mode.unwrap_or_default(),
        ));
    }
    if capabilities.image_generation && is_image_generation_tool_name(name) {
        return Ok(json!({ "type": "image_generation" }));
    }
    Ok(json!({
        "type": "function",
        "name": name,
        "description": description,
        "parameters": input_schema,
        "strict": false,
    }))
}

fn anthropic_tool(tool: &CanonicalToolDefinition) -> Result<Value, super::CurrentProviderError> {
    let CanonicalToolDefinition::Function {
        name,
        description,
        input_schema,
        ..
    } = tool
    else {
        return Err(super::CurrentProviderError::invalid_request(
            "custom tools require a Responses provider route",
        ));
    };
    Ok(json!({
        "name": name,
        "description": description,
        "input_schema": input_schema,
    }))
}

fn is_web_search_tool_name(name: &str) -> bool {
    name == "WebSearch"
}

fn is_image_generation_tool_name(name: &str) -> bool {
    name == "ImageGeneration"
}

fn strip_responses_lite_image_details(value: &mut Value) {
    match value {
        Value::Object(object) => {
            if object.get("type").and_then(Value::as_str) == Some("input_image") {
                object.remove("detail");
            }
            object
                .values_mut()
                .for_each(strip_responses_lite_image_details);
        }
        Value::Array(values) => values
            .iter_mut()
            .for_each(strip_responses_lite_image_details),
        _ => {}
    }
}

fn responses_input_content(
    content: &[ContentPart],
    media_payloads: &BTreeMap<String, String>,
) -> Vec<Value> {
    content
        .iter()
        .filter_map(|part| match part {
            ContentPart::Text { text, .. } => Some(json!({ "type": "input_text", "text": text })),
            ContentPart::Media {
                uri, media_type, ..
            } if media_type.starts_with("audio/") => Some(
                json!({"type":"input_audio","audio_url":provider_media_uri(uri, media_payloads)}),
            ),
            ContentPart::Media { uri, detail, .. } => {
                let mut image = Map::from_iter([
                    ("type".to_string(), json!("input_image")),
                    (
                        "image_url".to_string(),
                        json!(provider_media_uri(uri, media_payloads)),
                    ),
                ]);
                if let Some(detail) = detail.map(openai_image_detail) {
                    image.insert("detail".to_string(), json!(detail));
                }
                Some(Value::Object(image))
            }
            _ => None,
        })
        .collect()
}

fn anthropic_message(
    message: &runtime_core::CanonicalMessage,
    media_payloads: &BTreeMap<String, String>,
) -> Vec<Value> {
    let role = match message.role {
        CanonicalRole::Assistant => "assistant",
        _ => "user",
    };
    let mut content = message
        .content
        .iter()
        .filter_map(|part| match part {
            ContentPart::Text { text, .. } => Some(json!({ "type": "text", "text": text })),
            ContentPart::Reasoning { text, .. } => {
                Some(json!({ "type": "thinking", "thinking": text }))
            }
            ContentPart::Media {
                uri, media_type, ..
            } => Some(json!({
                "type": "image",
                "source": anthropic_media_source(
                    provider_media_uri(uri, media_payloads),
                    media_type,
                ),
            })),
            ContentPart::ToolCall {
                id, name, input, ..
            } => Some(json!({
                "type": "tool_use",
                "id": id,
                "name": name,
                "input": input,
            })),
            ContentPart::ToolResult {
                id, result, error, ..
            } => Some(json!({
                "type": "tool_result",
                "tool_use_id": id,
                "content": anthropic_tool_content(result, error.as_deref(), media_payloads),
                "is_error": error.is_some() || matches!(result, ToolResultValue::Error { .. }),
            })),
            ContentPart::CustomToolCall { .. } | ContentPart::CustomToolResult { .. } => None,
            ContentPart::RawResponseItem { .. } => None,
        })
        .collect::<Vec<_>>();
    for part in &message.content {
        if let ContentPart::RawResponseItem { item } = part {
            // The network boundary validates the producer and protocol first.
            if let Ok(parts) = super::native_history::parts(item, "anthropic") {
                content.extend_from_slice(parts);
            }
        }
    }
    vec![json!({ "role": role, "content": content })]
}

fn provider_media_uri<'a>(uri: &'a str, media_payloads: &'a BTreeMap<String, String>) -> &'a str {
    media_payloads.get(uri).map(String::as_str).unwrap_or(uri)
}

fn openai_image_detail(detail: ImageDetail) -> &'static str {
    match detail {
        ImageDetail::Auto => "auto",
        ImageDetail::Low => "low",
        ImageDetail::High => "high",
        ImageDetail::Original => "original",
    }
}

fn anthropic_media_source(uri: &str, media_type: &str) -> Value {
    if let Some(encoded) = uri
        .strip_prefix("data:")
        .and_then(|value| value.split_once(','))
        .filter(|(metadata, _)| {
            metadata
                .split(';')
                .any(|part| part.eq_ignore_ascii_case("base64"))
        })
        .map(|(_, encoded)| encoded)
    {
        return json!({
            "type": "base64",
            "media_type": media_type,
            "data": encoded,
        });
    }
    json!({ "type": "url", "url": uri })
}

fn text_from_parts(parts: &[ContentPart]) -> String {
    parts
        .iter()
        .filter_map(|part| match part {
            ContentPart::Text { text, .. } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("")
}

fn reasoning_from_parts(parts: &[ContentPart]) -> String {
    parts
        .iter()
        .filter_map(|part| match part {
            ContentPart::Reasoning { text, .. } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("")
}

fn tool_result_text(result: &ToolResultValue, error: Option<&str>) -> String {
    if let Some(error) = error.filter(|value| !value.trim().is_empty()) {
        return error.to_string();
    }
    match result {
        ToolResultValue::Text { value } => value.clone(),
        ToolResultValue::Json { value } | ToolResultValue::Error { value } => value.to_string(),
        ToolResultValue::Content { value } => text_from_parts(value),
    }
}

fn custom_tool_result_text(result: &ToolResultValue, error: Option<&str>) -> String {
    if let ToolResultValue::Error { value } = result {
        if let Some(output) = value.get("output").and_then(Value::as_str) {
            if !output.is_empty() {
                return output.to_string();
            }
        }
    }
    tool_result_text(result, error)
}

#[cfg(test)]
mod tests;
mod web_search;
