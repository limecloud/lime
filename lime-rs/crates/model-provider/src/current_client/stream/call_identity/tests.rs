use super::*;
use crate::current_client::stream::ResponsesEventReducer;
use model_routing_core::CanonicalLlmEvent;
use serde_json::json;

#[test]
fn responses_call_ids_correlate_without_phantom_or_duplicate_calls() {
    let original_name = " Read ";
    for custom in [false, true] {
        let mut reducer = ResponsesEventReducer::new(None, true);
        let kind = if custom {
            "custom_tool_call"
        } else {
            "function_call"
        };
        let field = if custom { "input" } else { "arguments" };
        let prefix = if custom {
            "custom_tool_call_input"
        } else {
            "function_call_arguments"
        };
        let input = if custom {
            "read source.txt"
        } else {
            "{\"path\":\"source.txt\"}"
        };
        let added =
            json!({"type":kind,"id":"fc_1","call_id":"call_1","name":original_name,field:""});
        let done =
            json!({"type":kind,"id":"fc_1","call_id":"call_1","name":original_name,field:input});
        let frames = [
            json!({"type":"response.output_item.added","output_index":0,"item":added}),
            json!({"type":format!("response.{prefix}.delta"),"item_id":"fc_1","output_index":0,"delta":input}),
            json!({"type":format!("response.{prefix}.done"),"item_id":"fc_1","output_index":0,field:input}),
            json!({"type":"response.output_item.done","output_index":0,"item":done}),
            json!({"type":"response.completed","response":{"id":"resp_1","output":[done]}}),
        ];
        let events = frames
            .iter()
            .flat_map(|frame| reducer.push(frame).unwrap().events)
            .collect::<Vec<_>>();
        let calls = events
            .iter()
            .filter_map(|event| match event {
                CanonicalLlmEvent::ToolCall {
                    id,
                    name,
                    raw_arguments,
                    ..
                } => Some((
                    id.as_str(),
                    name.as_str(),
                    raw_arguments.as_deref().unwrap(),
                )),
                CanonicalLlmEvent::CustomToolCall {
                    id, name, input, ..
                } => Some((id.as_str(), name.as_str(), input.as_str())),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(calls, [("call_1", original_name, input)], "{events:?}");
        for event in &events {
            if let CanonicalLlmEvent::ToolInputStart { id, name }
            | CanonicalLlmEvent::ToolInputEnd { id, name }
            | CanonicalLlmEvent::ToolInputDelta { id, name, .. } = event
            {
                assert_eq!((id.as_str(), name.as_str()), ("call_1", original_name));
            }
        }
    }
}

#[test]
fn response_call_identity_accepts_each_alias_and_keeps_parallel_calls_separate() {
    let mut ids = ResponseCallIdentity::default();
    for index in 0..2 {
        ids.observe_item(&json!({"output_index":index,"item":{"type":"function_call","id":format!("fc_{index}"),"call_id":format!("call_{index}")}}));
        let expected = format!("fc_{index}");
        assert_eq!(ids.resolve(&json!({"item_id":expected})), expected);
        assert_eq!(
            ids.resolve(&json!({"call_id":format!("call_{index}")})),
            expected
        );
        assert_eq!(ids.resolve(&json!({"output_index":index})), expected);
    }
}

#[test]
fn responses_dispatch_uses_the_final_item_instead_of_argument_completion() {
    for custom in [false, true] {
        let mut reducer = ResponsesEventReducer::new(None, true);
        let kind = if custom {
            "custom_tool_call"
        } else {
            "function_call"
        };
        let field = if custom { "input" } else { "arguments" };
        let prefix = if custom {
            "custom_tool_call_input"
        } else {
            "function_call_arguments"
        };
        let input = if custom {
            "final input"
        } else {
            "{\"path\":\"final.txt\"}"
        };
        let item = json!({"type":kind,"id":"item_1","call_id":"call_1","name":"Read",field:input});
        let added = json!({"type":"response.output_item.added","output_index":0,
            "item":{"type":kind,"id":"item_1","call_id":"call_1","name":"Read",field:""}});
        let arguments_done =
            json!({"type":format!("response.{prefix}.done"),"item_id":"item_1",field:"{}"});
        let is_call = |event: &CanonicalLlmEvent| {
            matches!(
                event,
                CanonicalLlmEvent::ToolCall { .. } | CanonicalLlmEvent::CustomToolCall { .. }
            )
        };
        assert!(!reducer.push(&added).unwrap().events.iter().any(is_call));
        assert!(!reducer
            .push(&arguments_done)
            .unwrap()
            .events
            .iter()
            .any(is_call));
        let events = reducer
            .push(&json!({"type":"response.output_item.done","output_index":0,"item":item}))
            .unwrap()
            .events;
        let values = events
            .iter()
            .filter_map(|event| match event {
                CanonicalLlmEvent::ToolCall { raw_arguments, .. } => raw_arguments.as_deref(),
                CanonicalLlmEvent::CustomToolCall { input, .. } => Some(input.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(values, [input]);
        let completed = reducer
            .push(&json!({"type":"response.completed","response":{"id":"resp_1","output":[item]}}))
            .unwrap();
        assert!(!completed.events.iter().any(is_call));
    }
}
