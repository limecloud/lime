use super::*;
use crate::exec::event_processor::EventProcessor;
use serde_json::{json, Value};

fn notification(method: &str, params: Value) -> ServerNotification {
    serde_json::from_value(json!({"method":method,"params":params})).unwrap()
}

fn item_notification(method: &str, item: Value) -> ServerNotification {
    notification(
        method,
        json!({"threadId":"thread","turnId":"turn","item":item,"startedAtMs":0,"completedAtMs":1}),
    )
}

fn terminal(status: &str, items: Vec<Value>, error: Value) -> ServerNotification {
    notification(
        "turn/completed",
        json!({"threadId":"thread","turn":{"id":"turn","status":status,"items":items,"error":error}}),
    )
}

fn command(status: &str, text: &str) -> Value {
    json!({"type":"commandExecution","id":"canonical-command","command":"pwd","cwd":"/tmp","status":status,"aggregatedOutput":text,"exitCode":0,"durationMs":42})
}

fn events(bytes: &[u8]) -> Vec<Value> {
    let schema = serde_json::to_value(schema()).unwrap();
    let validator = jsonschema::validator_for(&schema).unwrap();
    std::str::from_utf8(bytes)
        .unwrap()
        .lines()
        .map(|line| {
            let value: Value = serde_json::from_str(line).unwrap();
            assert!(validator.is_valid(&value), "{value}");
            value
        })
        .collect()
}

#[test]
fn command_lifecycle_uses_one_display_id_and_snapshot_repairs_without_reopening() {
    let mut processor = EventProcessor::new_json("thread".into(), "turn".into());
    let mut output = Vec::new();
    processor.start_turn(&mut output).unwrap();
    processor.start_turn(&mut output).unwrap();
    for _ in 0..2 {
        processor
            .process(
                item_notification("item/started", command("inProgress", "")),
                &mut output,
            )
            .unwrap();
    }
    for _ in 0..2 {
        processor
            .process(
                item_notification("item/completed", command("completed", "first")),
                &mut output,
            )
            .unwrap();
    }
    processor
        .process(
            item_notification("item/started", command("inProgress", "late")),
            &mut output,
        )
        .unwrap();
    processor
        .process(
            terminal(
                "completed",
                vec![command("completed", "canonical")],
                Value::Null,
            ),
            &mut output,
        )
        .unwrap();
    let events = events(&output);
    assert_eq!(
        events
            .iter()
            .map(|e| e["type"].as_str().unwrap())
            .collect::<Vec<_>>(),
        [
            "turn.started",
            "item.started",
            "item.completed",
            "item.updated",
            "turn.completed"
        ]
    );
    for event in &events[1..4] {
        assert_eq!(event["item"]["id"], "item_0");
    }
    assert_eq!(events[3]["item"]["aggregated_output"], "canonical");
    assert!(!String::from_utf8(output)
        .unwrap()
        .contains("canonical-command"));
}

#[test]
fn terminal_backfills_missing_items_and_reasoning_only_contains_summary() {
    let mut processor = EventProcessor::new_json("thread".into(), "turn".into());
    let mut output = Vec::new();
    let reasoning = json!({"type":"reasoning","id":"reason","summary":["Summary one","Summary two"],"content":["RAW secret"]});
    let answer =
        json!({"type":"agentMessage","id":"answer","text":"Final answer","phase":"final_answer"});
    for item in [&reasoning, &answer] {
        processor
            .process(item_notification("item/started", item.clone()), &mut output)
            .unwrap();
    }
    assert!(output.is_empty());
    let result = processor
        .process(
            terminal(
                "completed",
                vec![reasoning, answer, command("completed", "output")],
                Value::Null,
            ),
            &mut output,
        )
        .unwrap()
        .unwrap();
    assert_eq!(result.output, "Final answer");
    let events = events(&output);
    assert_eq!(events[0]["item"]["text"], "Summary one\nSummary two");
    assert_eq!(events[1]["item"]["text"], "Final answer");
    assert_eq!(events[2]["item"]["id"], "item_2");
    assert_eq!(events.len(), 4);
    let text = String::from_utf8(output).unwrap();
    assert!(!text.contains("RAW") && !text.contains("lime\n") && !text.contains("tokens used"));
}

#[test]
fn raw_only_reasoning_never_becomes_machine_output_and_plan_text_is_preserved() {
    let mut processor = EventProcessor::new_json("thread".into(), "turn".into());
    let mut output = Vec::new();
    processor
        .process(
            terminal(
                "completed",
                vec![
                    json!({"type":"reasoning","id":"reason","summary":[],"content":["RAW secret"]}),
                    json!({"type":"plan","id":"plan","text":"Canonical plan answer"}),
                ],
                Value::Null,
            ),
            &mut output,
        )
        .unwrap();
    let events = events(&output);
    assert_eq!(events.len(), 2);
    assert_eq!(events[0]["item"]["type"], "agent_message");
    assert_eq!(events[0]["item"]["text"], "Canonical plan answer");
}

#[test]
fn todo_updates_keep_id_and_usage_uses_latest_total_including_cache_write() {
    let mut processor = EventProcessor::new_json("thread".into(), "turn".into());
    let mut output = Vec::new();
    for (first, second) in [
        ("pending", "inProgress"),
        ("completed", "pending"),
        ("completed", "pending"),
    ] {
        processor.process(notification("turn/plan/updated", json!({"threadId":"thread","turnId":"turn","plan":[{"step":"First","status":first},{"step":"Second","status":second}]})), &mut output).unwrap();
    }
    for input in [10, 100] {
        let total = json!({"totalTokens":input+5,"inputTokens":input,"cachedInputTokens":20,"cacheWriteInputTokens":7,"outputTokens":5,"reasoningOutputTokens":2});
        let last = json!({"totalTokens":3,"inputTokens":1,"cachedInputTokens":0,"outputTokens":2,"reasoningOutputTokens":0});
        processor.process(notification("thread/tokenUsage/updated", json!({"threadId":"thread","turnId":"turn","tokenUsage":{"total":total,"last":last,"modelContextWindow":128000}})), &mut output).unwrap();
    }
    processor
        .process(terminal("completed", vec![], Value::Null), &mut output)
        .unwrap();
    let events = events(&output);
    assert_eq!(events.len(), 4);
    assert_eq!(events[0]["type"], "item.started");
    assert_eq!(events[1]["type"], "item.updated");
    assert_eq!(events[2]["type"], "item.completed");
    for e in &events[..3] {
        assert_eq!(e["item"]["id"], "item_0");
    }
    assert_eq!(events[0]["item"]["items"][1]["completed"], false);
    assert_eq!(events[2]["item"]["items"][0]["completed"], true);
    assert_eq!(
        events[3]["usage"],
        json!({"input_tokens":100,"cached_input_tokens":20,"cache_write_input_tokens":7,"output_tokens":5,"reasoning_output_tokens":2})
    );
}

#[test]
fn foreign_notifications_cannot_change_output_item_numbering_or_usage() {
    let mut processor = EventProcessor::new_json("thread".into(), "turn".into());
    let mut output = Vec::new();
    for (thread, turn) in [("other", "turn"), ("thread", "other")] {
        for (method, params) in [
            (
                "turn/started",
                json!({"threadId":thread,"turn":{"id":turn,"status":"inProgress","items":[]}}),
            ),
            (
                "item/completed",
                json!({"threadId":thread,"turnId":turn,"item":command("completed","secret"),"completedAtMs":1}),
            ),
            (
                "turn/plan/updated",
                json!({"threadId":thread,"turnId":turn,"plan":[]}),
            ),
            (
                "error",
                json!({"threadId":thread,"turnId":turn,"error":{"message":"secret"},"willRetry":false}),
            ),
            (
                "turn/completed",
                json!({"threadId":thread,"turn":{"id":turn,"status":"failed","items":[]}}),
            ),
        ] {
            assert!(processor
                .process(notification(method, params), &mut output)
                .unwrap()
                .is_none());
        }
    }
    assert!(output.is_empty());
    processor
        .process(
            terminal("completed", vec![command("completed", "ours")], Value::Null),
            &mut output,
        )
        .unwrap();
    let events = events(&output);
    assert_eq!(events[0]["item"]["id"], "item_0");
    assert_eq!(
        events[1]["usage"],
        serde_json::to_value(Usage::default()).unwrap()
    );
}

#[test]
fn failed_and_interrupted_turns_do_not_emit_success_or_partial_answers() {
    for status in ["failed", "interrupted"] {
        let mut processor = EventProcessor::new_json("thread".into(), "turn".into());
        let mut output = Vec::new();
        if status == "failed" {
            processor.process(notification("error", json!({"threadId":"thread","turnId":"turn","error":{"message":"immediate","additionalDetails":"diagnostic"},"willRetry":false})), &mut output).unwrap();
        }
        let result = processor
            .process(
                terminal(
                    status,
                    vec![json!({"type":"agentMessage","id":"partial","text":"Partial secret"})],
                    Value::Null,
                ),
                &mut output,
            )
            .unwrap()
            .unwrap();
        assert_eq!(result.output, "");
        let events = events(&output);
        if status == "failed" {
            assert_eq!(events.len(), 2);
            assert_eq!(events[0]["type"], "error");
            assert_eq!(
                events[1],
                json!({"type":"turn.failed","error":{"message":"immediate (diagnostic)"}})
            );
        } else {
            assert!(events.is_empty());
        }
    }
}

#[test]
fn typed_tool_lowering_keeps_payloads_and_closes_web_actions() {
    let mut processor = EventProcessor::new_json("thread".into(), "turn".into());
    let mut output = Vec::new();
    let items = vec![
        json!({"type":"fileChange","id":"patch","status":"declined","changes":[{"path":"file.rs","kind":{"type":"update","movePath":"new.rs"},"diff":"patch"}]}),
        json!({"type":"mcpToolCall","id":"mcp","server":"docs","tool":"read","status":"completed","arguments":{"query":"docs"},"result":{"content":[{"type":"text","text":"MCP result"}],"_meta":{"trace":1},"structuredContent":{"ok":true}},"error":null}),
        json!({"type":"collabAgentToolCall","id":"collab","tool":"resumeAgent","status":"completed","senderThreadId":"thread","receiverThreadIds":["child"],"prompt":"continue","agentsStates":{"child":{"status":"running","message":null}}}),
        json!({"type":"webSearch","id":"search","query":"docs","action":{"type":"search","queries":["docs"]}}),
        json!({"type":"webSearch","id":"unknown-search","query":null,"action":{"type":"futureAction","secret":"metadata"}}),
    ];
    processor
        .process(terminal("completed", items, Value::Null), &mut output)
        .unwrap();
    let events = events(&output);
    assert_eq!(events[0]["item"]["status"], "failed");
    assert_eq!(
        events[0]["item"]["changes"],
        json!([{"path":"file.rs","kind":"update"}])
    );
    assert_eq!(
        events[1]["item"]["result"],
        json!({"content":[{"type":"text","text":"MCP result"}],"_meta":{"trace":1},"structured_content":{"ok":true}})
    );
    assert_eq!(events[2]["item"]["tool"], "wait");
    assert_eq!(
        events[2]["item"]["agents_states"]["child"]["status"],
        "running"
    );
    assert_eq!(
        events[3]["item"]["action"],
        json!({"type":"search","queries":["docs"]})
    );
    assert_eq!(events[4]["item"]["action"], json!({"type":"other"}));
    assert!(events[4]["item"].get("results").is_none());
}

#[test]
fn every_event_flushes_and_write_failures_propagate() {
    #[derive(Default)]
    struct Sink {
        bytes: Vec<u8>,
        flushes: usize,
    }
    impl Write for Sink {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            self.bytes.extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            self.flushes += 1;
            Ok(())
        }
    }
    let mut sink = Sink::default();
    emit(
        &EventProcessorWithJsonOutput::thread_started_event("thread".into()),
        &mut sink,
    )
    .unwrap();
    let mut processor = EventProcessor::new_json("thread".into(), "turn".into());
    processor.start_turn(&mut sink).unwrap();
    processor
        .process(
            item_notification("item/started", command("inProgress", "")),
            &mut sink,
        )
        .unwrap();
    assert_eq!(sink.flushes, 3);
    assert_eq!(events(&sink.bytes).len(), 3);
    let error = emit(
        &ThreadEvent::TurnStarted(TurnStartedEvent {}),
        &mut io::Cursor::new(&mut [0u8; 1][..]),
    )
    .unwrap_err();
    assert_eq!(error.kind(), io::ErrorKind::WriteZero);
}
