use super::*;
use model_provider::current_client::{CurrentProviderCustomToolCall, CurrentProviderToolCall};
use serde_json::{json, Value};

fn raw(item: Value) -> CurrentProviderMessage {
    CurrentProviderMessage::raw_response_item(item)
}

fn parts(messages: &[CurrentProviderMessage]) -> Vec<&CurrentProviderContent> {
    messages
        .iter()
        .flat_map(|message| &message.content)
        .collect()
}

#[test]
fn incomplete_canonical_calls_are_kept_with_prompt_only_aborted_outputs() {
    let original = vec![CurrentProviderMessage::assistant(vec![
        CurrentProviderContent::Text("before call".to_string()),
        CurrentProviderContent::ToolCall(CurrentProviderToolCall::new("f", "read_file", json!({}))),
        CurrentProviderContent::Text("between calls".to_string()),
        CurrentProviderContent::CustomToolCall(CurrentProviderCustomToolCall::new(
            "c", "run", "code",
        )),
    ])];
    let snapshot = original.clone();
    let normalized = normalize_tool_history(&original, None);
    let flattened = parts(&normalized);
    assert_eq!(flattened.len(), 6);
    assert!(matches!(flattened[0], CurrentProviderContent::Text(text) if text == "before call"));
    assert!(matches!(flattened[1], CurrentProviderContent::ToolCall(call) if call.id == "f"));
    assert!(
        matches!(flattened[2], CurrentProviderContent::ToolResult(result)
        if result.call_id == "f" && !result.success && result.output == "aborted")
    );
    assert!(matches!(flattened[3], CurrentProviderContent::Text(text) if text == "between calls"));
    assert!(matches!(flattened[4], CurrentProviderContent::CustomToolCall(call) if call.id == "c"));
    assert!(
        matches!(flattened[5], CurrentProviderContent::CustomToolResult(result)
        if result.call_id == "c" && !result.success && result.output == "aborted")
    );
    assert_eq!(normalize_tool_history(&normalized, None), normalized);
    assert_eq!(
        original, snapshot,
        "canonical history must remain unchanged"
    );
}

#[test]
fn existing_results_and_media_are_preserved_across_mixed_representations() {
    let original = vec![
        CurrentProviderMessage::assistant(vec![CurrentProviderContent::ToolCall(
            CurrentProviderToolCall::new("f", "read_file", json!({"path":"file"})),
        )]),
        raw(
            json!({"type":"function_call_output","call_id":"f","output":[
            {"type":"input_image","image_url":"data:image/png;base64,AA=="},
            {"type":"input_text","text":"keep structured output"}],
            "provider_extension":{"opaque":"preserve-exactly"}}),
        ),
        raw(
            json!({"type":"custom_tool_call","id":"custom-1","call_id":"c",
            "name":"run","input":"code"}),
        ),
        CurrentProviderMessage::tool(vec![CurrentProviderContent::CustomToolResult(
            CurrentProviderToolResult {
                content_items: Vec::new(),
                history_token_limit: None,
                call_id: "c".to_string(),
                name: "run".to_string(),
                success: true,
                output: "existing".to_string(),
                error: None,
            },
        )]),
    ];
    assert_eq!(normalize_tool_history(&original, None), original);
}

#[test]
fn orphan_outputs_are_removed_by_family_without_losing_text_or_external_search() {
    let original = vec![
        CurrentProviderMessage::tool(vec![
            CurrentProviderContent::Text("keep text".to_string()),
            CurrentProviderContent::ToolResult(CurrentProviderToolResult {
                content_items: Vec::new(),
                history_token_limit: None,
                call_id: "orphan".to_string(),
                name: "read_file".to_string(),
                success: true,
                output: "remove orphan".to_string(),
                error: None,
            }),
        ]),
        raw(json!({"type":"function_call_output","call_id":"missing-f","output":"remove"})),
        raw(json!({"type":"custom_tool_call_output","call_id":"missing-c","output":"remove"})),
        raw(
            json!({"type":"tool_search_output","call_id":"missing-s","execution":"client",
            "status":"completed","tools":[]}),
        ),
        raw(
            json!({"type":"tool_search_output","call_id":"external","execution":"server",
            "status":"completed","tools":[{"name":"server-tool"}]}),
        ),
        raw(
            json!({"type":"function_call_output","name":"external-event","output":"keep named event"}),
        ),
    ];
    let normalized = normalize_tool_history(&original, None);
    assert_eq!(normalized.len(), 3);
    assert_eq!(
        normalized[0].content,
        vec![CurrentProviderContent::Text("keep text".to_string())]
    );
    assert_eq!(normalized[1..], original[4..]);

    let same_id_different_family = vec![
        raw(json!({"type":"function_call","call_id":"same","name":"run","arguments":"{}"})),
        raw(json!({"type":"custom_tool_call_output","call_id":"same","output":"wrong family"})),
    ];
    let normalized = normalize_tool_history(&same_id_different_family, None);
    assert_eq!(normalized.len(), 2);
    assert!(
        matches!(&normalized[1].content[0], CurrentProviderContent::RawResponseItem(item)
        if item["type"] == "function_call_output" && item["output"] == "aborted")
    );
}

#[test]
fn raw_outputs_have_stable_codex_ids_and_matching_wire_families() {
    for (call_type, output_type, prefix, suffix) in [
        (
            "function_call",
            "function_call_output",
            "fco",
            "45933e0f-2a6a-53e2-9e75-c50fdd98fab1",
        ),
        (
            "local_shell_call",
            "function_call_output",
            "fco",
            "45933e0f-2a6a-53e2-9e75-c50fdd98fab1",
        ),
        (
            "custom_tool_call",
            "custom_tool_call_output",
            "ctco",
            "19c0acea-b34b-5d4f-a41a-d1d60f7f9d31",
        ),
        (
            "tool_search_call",
            "tool_search_output",
            "tso",
            "23b1c1ef-ce88-57d4-b944-2f776077f671",
        ),
    ] {
        let original = vec![raw(
            json!({"type":call_type,"id":"item-original","call_id":"call-original"}),
        )];
        let normalized = normalize_tool_history(&original, None);
        assert_eq!(normalized.len(), 2);
        let CurrentProviderContent::RawResponseItem(output) = &normalized[1].content[0] else {
            panic!("raw calls must retain a raw output");
        };
        assert_eq!(output["type"], output_type);
        assert_eq!(output["call_id"], "call-original");
        assert_eq!(output["id"], format!("{prefix}_{suffix}"));
        if call_type == "tool_search_call" {
            assert_eq!(output["execution"], "client");
            assert_eq!(output["status"], "completed");
            assert_eq!(output["tools"], json!([]));
        } else {
            assert_eq!(output["output"], "aborted");
        }
        assert_eq!(normalize_tool_history(&normalized, None), normalized);
    }
}

#[test]
fn a_missing_source_item_id_does_not_invent_a_random_output_id() {
    for id in [Value::Null, json!("")] {
        let normalized = normalize_tool_history(
            &[raw(json!({
                "type":"function_call","id":id,"call_id":"f","name":"read_file","arguments":"{}"
            }))],
            None,
        );
        let CurrentProviderContent::RawResponseItem(output) = &normalized[1].content[0] else {
            panic!("missing raw output");
        };
        assert!(output.get("id").is_none());
    }
}
