use super::*;

pub(in crate::current_client) fn responses_message(
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
                    "type": "function_call_output",
                    "call_id": id,
                    "output": tool_output(result, error.as_deref(), media_payloads, false),
                })),
                ContentPart::CustomToolResult {
                    id, result, error, ..
                } => Some(json!({
                    "type": "custom_tool_call_output",
                    "call_id": id,
                    "output": tool_output(result, error.as_deref(), media_payloads, true),
                })),
                _ => None,
            })
            .collect(),
        CanonicalRole::Assistant => {
            let mut items = Vec::new();
            let mut text = String::new();
            for part in &message.content {
                if let ContentPart::Text { text: delta, .. } = part {
                    text.push_str(delta);
                    continue;
                }
                if !text.is_empty() {
                    items.push(assistant_text(std::mem::take(&mut text)));
                }
                match part {
                    ContentPart::ToolCall {
                        id,
                        name,
                        input,
                        raw_arguments,
                        ..
                    } => items.push(json!({
                        "type": "function_call",
                        "call_id": id,
                        "name": name,
                        "arguments": raw_arguments.clone().unwrap_or_else(|| input.to_string()),
                    })),
                    ContentPart::CustomToolCall {
                        id,
                        name,
                        input,
                        namespace,
                        ..
                    } => {
                        let mut item = json!({
                            "type": "custom_tool_call",
                            "call_id": id,
                            "name": name,
                            "input": input,
                        });
                        if let Some(namespace) = namespace {
                            item["namespace"] = json!(namespace);
                        }
                        items.push(item);
                    }
                    ContentPart::RawResponseItem { item } => items.push(request_item(item)),
                    _ => {}
                }
            }
            if !text.is_empty() {
                items.push(assistant_text(text));
            }
            items
        }
        CanonicalRole::User | CanonicalRole::System | CanonicalRole::Developer => vec![json!({
            "type": "message",
            "role": wire_role(message.role),
            "content": responses_input_content(&message.content, media_payloads),
        })],
    }
}

fn tool_output(
    result: &ToolResultValue,
    error: Option<&str>,
    media_payloads: &BTreeMap<String, String>,
    custom: bool,
) -> Value {
    let ToolResultValue::Content { value } = result else {
        return Value::String(if custom {
            custom_tool_result_text(result, error)
        } else {
            tool_result_text(result, error)
        });
    };
    // A failed script can still have useful image output from its completed actions.
    let mut content = responses_input_content(value, media_payloads);
    if let Some(error) = error.filter(|error| !error.trim().is_empty()) {
        if !value
            .iter()
            .any(|part| matches!(part, ContentPart::Text { text, .. } if text.contains(error)))
        {
            content.push(json!({ "type": "input_text", "text": error }));
        }
    }
    Value::Array(content)
}

// Codex prepares a copy for requests; persisted producer identities stay intact.
fn request_item(original: &Value) -> Value {
    let mut item = original.clone();
    if item.get("id").and_then(Value::as_str).is_some_and(|id| {
        !id.split_once('_')
            .is_some_and(|(prefix, suffix)| !prefix.is_empty() && !suffix.is_empty())
    }) {
        if let Some(object) = item.as_object_mut() {
            object.remove("id");
        }
    }
    item
}

fn assistant_text(text: String) -> Value {
    json!({"type":"message","role":"assistant","content":[{"type":"output_text","text":text}]})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typed_tool_media_keeps_call_identity_order_and_partial_failure() {
        let payloads = BTreeMap::from([(
            "sidecar://tool-image".to_string(),
            "data:image/png;base64,aGVsbG8=".to_string(),
        )]);
        for custom in [false, true] {
            let result = ToolResultValue::Content {
                value: vec![
                    ContentPart::text("before"),
                    ContentPart::media_with_detail(
                        "sidecar://tool-image",
                        "image/png",
                        Some(ImageDetail::High),
                    )
                    .unwrap(),
                    ContentPart::text("after"),
                ],
            };
            let part = if custom {
                ContentPart::CustomToolResult {
                    id: "call_image".to_string(),
                    name: "exec".to_string(),
                    result,
                    error: Some("window disappeared".to_string()),
                    metadata: Default::default(),
                }
            } else {
                ContentPart::ToolResult {
                    id: "call_image".to_string(),
                    name: "computer_use".to_string(),
                    result,
                    error: Some("window disappeared".to_string()),
                    provider_executed: Some(false),
                    metadata: Default::default(),
                }
            };
            let message = runtime_core::CanonicalMessage {
                id: None,
                role: CanonicalRole::Tool,
                content: vec![part],
                metadata: Default::default(),
            };
            let wire = responses_message(&message, &payloads);
            assert_eq!(wire.len(), 1);
            assert_eq!(wire[0]["call_id"], "call_image");
            assert_eq!(
                wire[0]["type"],
                if custom {
                    "custom_tool_call_output"
                } else {
                    "function_call_output"
                }
            );
            assert_eq!(
                wire[0]["output"],
                json!([
                    {"type":"input_text","text":"before"},
                    {"type":"input_image","image_url":"data:image/png;base64,aGVsbG8=","detail":"high"},
                    {"type":"input_text","text":"after"},
                    {"type":"input_text","text":"window disappeared"},
                ])
            );
            assert!(!text_from_parts(match &message.content[0] {
                ContentPart::ToolResult {
                    result: ToolResultValue::Content { value },
                    ..
                }
                | ContentPart::CustomToolResult {
                    result: ToolResultValue::Content { value },
                    ..
                } => value,
                _ => unreachable!(),
            })
            .contains("base64"));
        }
    }

    #[test]
    fn text_output_preserves_wire_string_and_script_error_is_not_duplicated() {
        let result = ToolResultValue::Error {
            value: json!({"output":"partial output\nScript error: failed","error":"failed"}),
        };
        assert_eq!(
            tool_output(&result, Some("failed"), &BTreeMap::new(), true),
            "partial output\nScript error: failed"
        );
        let typed = ToolResultValue::Content {
            value: vec![ContentPart::text("Script error: failed")],
        };
        assert_eq!(
            tool_output(&typed, Some("failed"), &BTreeMap::new(), true),
            json!([{"type":"input_text","text":"Script error: failed"}])
        );
    }

    #[test]
    fn request_copy_removes_only_non_prefixed_ids() {
        for (id, keep) in [
            ("old", false),
            ("_suffix", false),
            ("prefix_", false),
            ("rs_native", true),
        ] {
            let original =
                json!({"type":"reasoning","id":id,"summary":[],"encrypted_content":"fixture-only"});
            let request = request_item(&original);
            assert_eq!(request.get("id").is_some(), keep, "{id}");
            assert_eq!(
                original["id"], id,
                "persisted history must not be rewritten"
            );
            assert_eq!(request["encrypted_content"], original["encrypted_content"]);
        }
    }

    #[test]
    fn native_items_and_text_keep_their_original_interleaving() {
        let raw = json!({"type":"reasoning","id":"rs_order","summary":[],
            "encrypted_content":"fixture-only"});
        let message = runtime_core::CanonicalMessage {
            id: None,
            role: CanonicalRole::Assistant,
            metadata: Default::default(),
            content: vec![
                ContentPart::text("before"),
                ContentPart::RawResponseItem { item: raw.clone() },
                ContentPart::ToolCall {
                    id: "call_order".to_string(),
                    name: "Read".to_string(),
                    input: json!({}),
                    raw_arguments: Some("{  }".to_string()),
                    provider_executed: None,
                    metadata: Default::default(),
                },
                ContentPart::text("after"),
            ],
        };
        let actual = responses_message(&message, &BTreeMap::new());
        assert_eq!(
            actual,
            vec![
                assistant_text("before".to_string()),
                raw,
                json!({"type":"function_call","call_id":"call_order","name":"Read","arguments":"{  }"}),
                assistant_text("after".to_string())
            ]
        );
    }
}
