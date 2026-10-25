use agent_protocol::truncation::TruncationPolicy;
use model_provider::current_client::CurrentProviderContent;
use serde_json::{json, Value};
use tool_runtime::tool_io::truncate_tool_output;

pub(super) fn for_prompt(
    original: &CurrentProviderContent,
    policy: TruncationPolicy,
) -> CurrentProviderContent {
    let mut content = original.clone();
    match &mut content {
        CurrentProviderContent::ToolResult(result)
        | CurrentProviderContent::CustomToolResult(result) => {
            let policy = result
                .history_token_limit
                .map(TruncationPolicy::Tokens)
                .unwrap_or(policy);
            result.output = truncate_tool_output(&result.output, policy);
            let mut remaining = policy;
            result.content_items.retain_mut(|item| {
                let agent_protocol::response_item::FunctionCallOutputContentItem::InputText {
                    text,
                } = item
                else {
                    return true;
                };
                if remaining.byte_budget() == 0 {
                    return false;
                }
                let len = text.len();
                *text = truncate_tool_output(text, remaining);
                remaining = match remaining {
                    TruncationPolicy::Bytes(limit) => {
                        TruncationPolicy::Bytes(limit.saturating_sub(len))
                    }
                    TruncationPolicy::Tokens(limit) => {
                        TruncationPolicy::Tokens(limit.saturating_sub(len.div_ceil(4)))
                    }
                };
                true
            });
        }
        CurrentProviderContent::RawResponseItem(item)
            if matches!(
                item["type"].as_str(),
                Some("function_call_output" | "custom_tool_call_output")
            ) =>
        {
            if let Some(output) = item.get_mut("output") {
                truncate_payload(output, policy);
            }
        }
        _ => {}
    }
    content
}

fn truncate_payload(output: &mut Value, policy: TruncationPolicy) {
    match output {
        Value::String(text) => *text = truncate_tool_output(text, policy),
        Value::Array(items) => {
            let mut remaining = policy;
            let mut omitted = 0;
            items.retain_mut(|item| {
                if item["type"] != "input_text" {
                    return true;
                }
                let Some(text) = item.get("text").and_then(Value::as_str) else {
                    return true;
                };
                if text.is_empty() {
                    return false;
                }
                if remaining.byte_budget() == 0 {
                    omitted += 1;
                    return false;
                }
                let len = text.len();
                let truncated = truncate_tool_output(text, remaining);
                remaining = match remaining {
                    TruncationPolicy::Bytes(limit) => {
                        TruncationPolicy::Bytes(limit.saturating_sub(len))
                    }
                    TruncationPolicy::Tokens(limit) => {
                        TruncationPolicy::Tokens(limit.saturating_sub(len.div_ceil(4)))
                    }
                };
                item["text"] = Value::String(truncated);
                true
            });
            if omitted > 0 {
                items.push(json!({"type":"input_text","text":format!("[omitted {omitted} text items ...]")}));
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests;
