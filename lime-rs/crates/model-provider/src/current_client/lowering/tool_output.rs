use super::*;

pub(super) fn anthropic_tool_content(
    result: &ToolResultValue,
    error: Option<&str>,
    payloads: &BTreeMap<String, String>,
) -> Value {
    let ToolResultValue::Content { value } = result else {
        return Value::String(tool_result_text(result, error));
    };
    let mut content = value
        .iter()
        .filter_map(|part| match part {
            ContentPart::Text { text, .. } => Some(json!({"type":"text","text":text})),
            ContentPart::Media {
                uri, media_type, ..
            } => Some(json!({
                "type":"image",
                "source":anthropic_media_source(provider_media_uri(uri, payloads), media_type),
            })),
            _ => None,
        })
        .collect::<Vec<_>>();
    if let Some(error) = error.filter(|error| !error.is_empty()) {
        if !value
            .iter()
            .any(|part| matches!(part, ContentPart::Text { text, .. } if text.contains(error)))
        {
            content.push(json!({"type":"text","text":error}));
        }
    }
    Value::Array(content)
}

pub(super) fn tool_media_observations(
    content: &[ContentPart],
    payloads: &BTreeMap<String, String>,
) -> Vec<Value> {
    let mut observations = Vec::new();
    for part in content {
        let ContentPart::ToolResult {
            id,
            name,
            result: ToolResultValue::Content { value },
            ..
        } = part
        else {
            continue;
        };
        let media = value
            .iter()
            .filter(|part| matches!(part, ContentPart::Media { .. }))
            .cloned()
            .collect::<Vec<_>>();
        if media.is_empty() {
            continue;
        }
        // Chat Completions only accepts text in tool messages. Keep all tool replies
        // adjacent, then attach their typed observations as a user media message.
        observations.push(
            json!({"type":"text","text":format!("Media returned by tool {name}, call_id {id}:")}),
        );
        if let Value::Array(parts) = chat_content(&media, payloads) {
            observations.extend(parts);
        }
    }
    observations
}
