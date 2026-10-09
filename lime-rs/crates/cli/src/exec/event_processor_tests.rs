use super::*;
use crate::exec::event_processor_with_human_output::ReasoningPolicy;
use crate::exec::locale::Locale;
use serde_json::{json, Value};

fn notification(method: &str, params: Value) -> ServerNotification {
    serde_json::from_value(json!({ "method": method, "params": params })).unwrap()
}

fn item_completed(item: Value) -> ServerNotification {
    notification(
        "item/completed",
        json!({ "threadId": "thread", "turnId": "turn", "item": item, "completedAtMs": 0 }),
    )
}

fn terminal(status: &str, items: Vec<Value>) -> ServerNotification {
    notification(
        "turn/completed",
        json!({ "threadId": "thread", "turn": { "id": "turn", "status": status, "items": items } }),
    )
}

fn reasoning() -> Value {
    json!({ "type": "reasoning", "id": "reasoning", "summary": ["Summary one", "Summary two"], "content": ["RAW one", "RAW two"] })
}
fn message(id: &str, text: &str, phase: Option<&str>) -> Value {
    json!({ "type": "agentMessage", "id": id, "text": text, "phase": phase })
}
fn processor(config: Value) -> EventProcessor {
    EventProcessor::new(
        "thread".into(),
        "turn".into(),
        EventProcessorWithHumanOutput::create_with_ansi(
            false,
            ReasoningPolicy::from_config(config).unwrap(),
            Locale::EnUs,
        ),
    )
}

#[test]
fn completed_reasoning_matrix_keeps_human_output_out_of_final_answer() {
    for (config, expected) in [
        (json!({}), "Summary one\nSummary two\n"),
        (
            json!({"show_raw_agent_reasoning": true}),
            "RAW one\nRAW two\n",
        ),
        (json!({"hide_agent_reasoning": true}), ""),
        (
            json!({"hide_agent_reasoning": true, "show_raw_agent_reasoning": true}),
            "",
        ),
    ] {
        let mut processor = processor(config.clone());
        let mut stderr = Vec::new();
        processor
            .process(item_completed(reasoning()), &mut stderr)
            .unwrap();
        processor
            .process(item_completed(reasoning()), &mut stderr)
            .unwrap();
        let result = processor
            .process(
                terminal(
                    "completed",
                    vec![
                        reasoning(),
                        message("final", "Answer", Some("final_answer")),
                    ],
                ),
                &mut stderr,
            )
            .unwrap()
            .unwrap();
        assert_eq!(
            String::from_utf8(stderr).unwrap(),
            format!("{expected}lime\nAnswer\n"),
            "config={config}"
        );
        assert_eq!(
            result,
            ExecResult {
                status: TurnStatus::Completed,
                output: "Answer".into()
            }
        );
    }
}

#[test]
fn raw_enabled_with_no_content_falls_back_to_summary() {
    let item =
        json!({"type": "reasoning", "id": "reasoning", "summary": ["Summary"], "content": []});
    let mut processor = processor(json!({"show_raw_agent_reasoning": true}));
    let mut stderr = Vec::new();
    let result = processor
        .process(
            terminal(
                "completed",
                vec![item.clone(), message("final", "Answer", None)],
            ),
            &mut stderr,
        )
        .unwrap()
        .unwrap();
    assert_eq!(
        String::from_utf8(stderr).unwrap(),
        "Summary\nlime\nAnswer\n"
    );
    assert_eq!(result.output, "Answer");
}

#[test]
fn terminal_snapshot_repairs_stream_and_late_delta_cannot_reopen_completed_item() {
    let mut processor = processor(json!({}));
    let mut stderr = Vec::new();
    let delta = |text| {
        notification(
            "item/agentMessage/delta",
            json!({"threadId": "thread", "turnId": "turn", "itemId": "final", "delta": text}),
        )
    };
    processor.process(delta("partial"), &mut stderr).unwrap();
    processor
        .process(
            item_completed(message("final", "Completed answer", Some("final_answer"))),
            &mut stderr,
        )
        .unwrap();
    processor.process(delta(" late"), &mut stderr).unwrap();
    assert_eq!(
        processor
            .process(
                terminal(
                    "completed",
                    vec![message("final", "Canonical answer", Some("final_answer"))]
                ),
                &mut stderr
            )
            .unwrap()
            .unwrap()
            .output,
        "Canonical answer"
    );
}

#[test]
fn other_thread_or_turn_cannot_emit_reasoning_or_finish_current_turn() {
    let mut processor = processor(json!({"show_raw_agent_reasoning": true}));
    let mut stderr = Vec::new();
    for (thread, turn) in [("other", "turn"), ("thread", "other")] {
        let foreign = notification(
            "item/completed",
            json!({"threadId": thread, "turnId": turn, "item": reasoning(), "completedAtMs": 0}),
        );
        assert!(processor.process(foreign, &mut stderr).unwrap().is_none());
        let foreign = notification(
            "turn/completed",
            json!({"threadId": thread, "turn": {"id": turn, "status": "completed", "items": [message("foreign", "foreign", None)]}}),
        );
        assert!(processor.process(foreign, &mut stderr).unwrap().is_none());
    }
    let result = processor
        .process(
            terminal("completed", vec![message("final", "ours", None)]),
            &mut stderr,
        )
        .unwrap()
        .unwrap();
    assert_eq!(String::from_utf8(stderr).unwrap(), "lime\nours\n");
    assert_eq!(result.output, "ours");
}

#[test]
fn commentary_is_not_a_final_answer_and_plan_is_a_terminal_fallback() {
    let mut processor = processor(json!({}));
    let mut stderr = Vec::new();
    let result = processor
        .process(
            terminal(
                "completed",
                vec![
                    json!({"type":"plan", "id":"plan", "text":"Plan answer"}),
                    message("comment", "Internal progress", Some("commentary")),
                ],
            ),
            &mut stderr,
        )
        .unwrap()
        .unwrap();
    assert_eq!(result.output, "Plan answer");
}

#[test]
fn canonical_item_order_wins_over_notification_arrival_order() {
    let mut processor = processor(json!({}));
    let mut stderr = Vec::new();
    processor
        .process(
            item_completed(message("second", "Second", None)),
            &mut stderr,
        )
        .unwrap();
    processor
        .process(item_completed(message("first", "First", None)), &mut stderr)
        .unwrap();
    let result = processor
        .process(
            terminal(
                "completed",
                vec![
                    message("first", "First", None),
                    message("second", "Second", None),
                ],
            ),
            &mut stderr,
        )
        .unwrap()
        .unwrap();
    assert_eq!(result.output, "Second");
}

#[test]
fn failed_and_interrupted_turns_discard_partial_answer_without_synthetic_completion() {
    for (status, expected) in [
        ("failed", TurnStatus::Failed),
        ("interrupted", TurnStatus::Interrupted),
    ] {
        let mut processor = processor(json!({}));
        let mut stderr = Vec::new();
        assert!(processor
            .process(terminal("inProgress", vec![]), &mut stderr)
            .unwrap()
            .is_none());
        let result = processor
            .process(
                terminal(status, vec![message("partial", "Partial", None)]),
                &mut stderr,
            )
            .unwrap()
            .unwrap();
        assert_eq!(result.status, expected);
        assert_eq!(result.output, "");
    }
}

#[test]
fn invalid_shared_reasoning_flags_fail_closed() {
    for key in ["show_raw_agent_reasoning", "hide_agent_reasoning"] {
        for value in [json!("true"), json!(1), Value::Null] {
            assert!(
                ReasoningPolicy::from_config(json!({key: value})).is_err(),
                "key={key}"
            );
        }
    }
}

#[test]
fn last_message_file_uses_canonical_final_answer_in_both_output_modes() {
    for machine in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("answer.txt");
        let mut processor = if machine {
            EventProcessor::new_json("thread".into(), "turn".into())
        } else {
            processor(json!({}))
        };
        processor.set_last_message_file(Some(path.clone()));
        let mut output = Vec::new();
        processor
            .process(
                item_completed(message("final", "outdated", None)),
                &mut output,
            )
            .unwrap();
        processor
            .process(
                terminal(
                    "completed",
                    vec![
                        reasoning(),
                        message("comment", "progress", Some("commentary")),
                        message("final", "canonical answer", Some("final_answer")),
                    ],
                ),
                &mut output,
            )
            .unwrap();
        assert_eq!(std::fs::read_to_string(path).unwrap(), "canonical answer");
    }
}

#[test]
fn failed_and_interrupted_turns_preserve_last_message_file_and_write_errors_propagate() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("answer.txt");
    std::fs::write(&path, "previous successful answer").unwrap();
    for status in ["failed", "interrupted"] {
        let mut processor = EventProcessor::new_json("thread".into(), "turn".into());
        processor.set_last_message_file(Some(path.clone()));
        processor
            .process(
                terminal(status, vec![message("partial", "partial secret", None)]),
                &mut Vec::new(),
            )
            .unwrap();
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "previous successful answer"
        );
    }
    let mut processor = EventProcessor::new_json("thread".into(), "turn".into());
    processor.set_last_message_file(Some(dir.path().join("missing/answer.txt")));
    assert_eq!(
        processor
            .process(terminal("completed", vec![]), &mut Vec::new())
            .unwrap_err()
            .kind(),
        std::io::ErrorKind::NotFound
    );
}
