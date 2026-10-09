use super::*;
use serde_json::json;

#[test]
fn published_schema_matches_the_rust_event_contract() {
    let schema = serde_json::to_value(schema()).unwrap();
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/cli/exec-events.schema.json");
    if std::env::var_os("UPDATE_EXEC_EVENTS_SCHEMA").is_some() {
        std::fs::write(
            &path,
            format!("{}\n", serde_json::to_string_pretty(&schema).unwrap()),
        )
        .unwrap();
    }
    let published: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    assert_eq!(
        published, schema,
        "regenerate with UPDATE_EXEC_EVENTS_SCHEMA=1"
    );
}

#[test]
fn event_examples_round_trip_and_validate_against_the_schema() {
    let schema = serde_json::to_value(schema()).unwrap();
    let validator = jsonschema::validator_for(&schema).unwrap();
    let mut examples = vec![
        json!({"type":"thread.started", "thread_id":"canonical-thread"}),
        json!({"type":"turn.started"}),
        json!({"type":"turn.completed", "usage":{"input_tokens":10,"cached_input_tokens":2,"cache_write_input_tokens":3,"output_tokens":4,"reasoning_output_tokens":1}}),
        json!({"type":"turn.failed", "error":{"message":"failed"}}),
        json!({"type":"error", "message":"disconnected"}),
    ];
    let items = [
        json!({"type":"agent_message", "text":"answer"}),
        json!({"type":"reasoning", "text":"summary"}),
        json!({"type":"command_execution", "command":"pwd", "aggregated_output":"", "exit_code":null, "status":"in_progress"}),
        json!({"type":"file_change", "changes":[{"path":"file.rs","kind":"update"}],"status":"completed"}),
        json!({"type":"mcp_tool_call", "server":"docs","tool":"read","arguments":{},"result":{"content":[{"type":"text","text":"read"}],"_meta":{"trace":1},"structured_content":null},"error":null,"status":"completed"}),
        json!({"type":"collab_tool_call", "tool":"spawn_agent","sender_thread_id":"thread","receiver_thread_ids":["child"],"prompt":null,"agents_states":{"child":{"status":"running","message":null}},"status":"in_progress"}),
        json!({"type":"web_search", "query":"docs","action":{"type":"search","queries":["docs"]}}),
        json!({"type":"todo_list", "items":[{"text":"verify","completed":false}]}),
        json!({"type":"error", "message":"warning"}),
    ];
    for mut item in items {
        item["id"] = json!("item_0");
        for kind in ["item.started", "item.updated", "item.completed"] {
            examples.push(json!({"type":kind, "item":item}));
        }
    }
    for example in examples {
        let event: ThreadEvent = serde_json::from_value(example.clone()).unwrap();
        let actual = serde_json::to_value(event).unwrap();
        assert_eq!(actual, example);
        assert!(validator.is_valid(&actual), "{actual}");
    }
    assert!(!validator.is_valid(&json!({"ok":true,"result":{"output":"old"}})));
    assert!(!validator.is_valid(&json!({"type":"item.completed","item":{"id":"item_0","type":"command_execution","command":"pwd","aggregated_output":"","status":"inProgress"}})));
}

#[test]
fn optional_mcp_meta_and_search_results_do_not_create_duplicate_item_ids() {
    let event = ThreadEvent::ItemCompleted(ItemCompletedEvent {
        item: ThreadItem {
            id: "item_0".into(),
            details: ThreadItemDetails::WebSearch(WebSearchItem {
                query: "docs".into(),
                action: WebSearchAction::Other,
                results: None,
            }),
        },
    });
    let encoded = serde_json::to_string(&event).unwrap();
    assert_eq!(encoded.matches("\"id\"").count(), 1);
    assert!(!encoded.contains("results"));
    let result = McpToolCallItemResult {
        content: vec![],
        meta: None,
        structured_content: None,
    };
    assert_eq!(
        serde_json::to_value(result).unwrap(),
        json!({"content":[], "structured_content":null})
    );
}
