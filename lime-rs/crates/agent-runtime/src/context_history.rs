//! 在采样边界按 Codex 语义修复工具调用配对；不修改持久化历史或执行工具。

mod output;
mod raw;

use agent_protocol::truncation::TruncationPolicy;
use model_provider::current_client::{
    CurrentProviderContent, CurrentProviderMessage, CurrentProviderToolResult,
};
use std::collections::HashSet;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum Family {
    Function,
    Custom,
    Search,
}

type Key<'a> = (Family, &'a str);

pub(crate) fn normalize_tool_history(
    messages: &[CurrentProviderMessage],
    truncation: Option<TruncationPolicy>,
) -> Vec<CurrentProviderMessage> {
    let policy = truncation
        .unwrap_or_default()
        .with_serialization_allowance();
    let contents = || messages.iter().flat_map(|message| &message.content);
    let calls = contents().filter_map(call_key).collect::<HashSet<_>>();
    let outputs = contents().filter_map(output_key).collect::<HashSet<_>>();
    let mut normalized = Vec::with_capacity(messages.len());

    for message in messages {
        let mut content = Vec::with_capacity(message.content.len());
        for part in &message.content {
            if output_key(part).is_some_and(|key| !calls.contains(&key))
                && !raw::is_server_search_output(part)
            {
                continue;
            }
            content.push(output::for_prompt(part, policy));
            if call_key(part).is_some_and(|key| !outputs.contains(&key)) {
                normalized.push(CurrentProviderMessage {
                    role: message.role.clone(),
                    producer: message.producer.clone(),
                    content: std::mem::take(&mut content),
                });
                normalized.push(aborted_output(part));
            }
        }
        if !content.is_empty() || message.content.is_empty() {
            normalized.push(CurrentProviderMessage {
                role: message.role.clone(),
                producer: message.producer.clone(),
                content,
            });
        }
    }
    normalized
}

fn call_key(content: &CurrentProviderContent) -> Option<Key<'_>> {
    match content {
        CurrentProviderContent::ToolCall(call) => Some((Family::Function, &call.id)),
        CurrentProviderContent::CustomToolCall(call) => Some((Family::Custom, &call.id)),
        CurrentProviderContent::RawResponseItem(item) => raw::call_key(item),
        _ => None,
    }
}

fn output_key(content: &CurrentProviderContent) -> Option<Key<'_>> {
    match content {
        CurrentProviderContent::ToolResult(result) => Some((Family::Function, &result.call_id)),
        CurrentProviderContent::CustomToolResult(result) => Some((Family::Custom, &result.call_id)),
        CurrentProviderContent::RawResponseItem(item) => raw::output_key(item),
        _ => None,
    }
}

fn aborted_output(content: &CurrentProviderContent) -> CurrentProviderMessage {
    let result = |id: &str, name: &str| CurrentProviderToolResult {
        content_items: Vec::new(),
        history_token_limit: None,
        call_id: id.to_string(),
        name: name.to_string(),
        success: false,
        output: "aborted".to_string(),
        error: Some("aborted".to_string()),
    };
    match content {
        CurrentProviderContent::ToolCall(call) => {
            CurrentProviderMessage::tool(vec![CurrentProviderContent::ToolResult(result(
                &call.id, &call.name,
            ))])
        }
        CurrentProviderContent::CustomToolCall(call) => {
            CurrentProviderMessage::tool(vec![CurrentProviderContent::CustomToolResult(result(
                &call.id, &call.name,
            ))])
        }
        CurrentProviderContent::RawResponseItem(item) => {
            CurrentProviderMessage::raw_response_item(raw::aborted_output(item))
        }
        _ => unreachable!("only a tool call requires an aborted output"),
    }
}

#[cfg(test)]
mod tests;
