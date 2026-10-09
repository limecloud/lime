use super::super::event_processor::EventProcessor;
use super::*;
use serde_json::json;

fn notification(method: &str, params: Value) -> ServerNotification {
    serde_json::from_value(json!({ "method": method, "params": params })).unwrap()
}

fn item_notification(method: &str, item: Value) -> ServerNotification {
    notification(
        method,
        json!({ "threadId": "thread", "turnId": "turn", "item": item, "startedAtMs": 0, "completedAtMs": 1 }),
    )
}

fn terminal(status: &str, items: Vec<Value>, error: Value) -> ServerNotification {
    notification(
        "turn/completed",
        json!({ "threadId": "thread", "turn": {
        "id": "turn", "status": status, "items": items, "error": error
    } }),
    )
}

fn command(status: &str, output: Value, exit_code: Value) -> Value {
    json!({ "type": "commandExecution", "id": "command", "command": "printf check", "cwd": "/tmp/project",
        "status": status, "aggregatedOutput": output, "exitCode": exit_code, "durationMs": 42 })
}

fn human(locale: Locale, ansi: bool) -> EventProcessor {
    EventProcessor::new(
        "thread".into(),
        "turn".into(),
        EventProcessorWithHumanOutput::create_with_ansi(ansi, ReasoningPolicy::default(), locale),
    )
}

#[test]
fn command_start_result_and_output_are_visible_once_across_notifications_and_snapshot() {
    let mut processor = human(Locale::EnUs, false);
    let mut stderr = Vec::new();
    let started = command("inProgress", Value::Null, Value::Null);
    let completed = command("completed", json!("command output\n"), json!(0));
    for _ in 0..2 {
        processor
            .process(
                item_notification("item/started", started.clone()),
                &mut stderr,
            )
            .unwrap();
        processor
            .process(
                item_notification("item/completed", completed.clone()),
                &mut stderr,
            )
            .unwrap();
    }
    processor
        .process(
            terminal("completed", vec![completed], Value::Null),
            &mut stderr,
        )
        .unwrap();
    assert_eq!(
        String::from_utf8(stderr).unwrap(),
        "exec\nprintf check in /tmp/project\n succeeded in 42ms:\ncommand output\n\n"
    );
}

#[test]
fn snapshot_only_command_keeps_identity_and_all_result_statuses() {
    for (status, exit, expected) in [
        ("completed", Value::Null, " succeeded in 42ms:"),
        ("failed", json!(7), " exited 7 in 42ms:"),
        ("failed", Value::Null, " exited 1 in 42ms:"),
        ("declined", Value::Null, " declined in 42ms:"),
        ("inProgress", Value::Null, " in progress in 42ms:"),
    ] {
        let mut processor = human(Locale::EnUs, false);
        let mut stderr = Vec::new();
        processor
            .process(
                terminal(
                    "completed",
                    vec![command(status, json!("result"), exit)],
                    Value::Null,
                ),
                &mut stderr,
            )
            .unwrap();
        assert_eq!(
            String::from_utf8(stderr).unwrap(),
            format!("exec\nprintf check in /tmp/project\n{expected}\nresult\n")
        );
    }
}

#[test]
fn patch_mcp_search_compaction_and_collab_use_typed_current_items() {
    let items = vec![
        json!({ "type": "fileChange", "id": "patch", "status": "completed", "changes": [{ "path": "src/main.rs", "kind": { "type": "update" }, "diff": "diff" }] }),
        json!({ "type": "mcpToolCall", "id": "mcp", "server": "docs", "tool": "read", "status": "failed", "arguments": {}, "result": null, "error": { "message": "offline" } }),
        json!({ "type": "webSearch", "id": "search", "query": "canonical query", "action": null }),
        json!({ "type": "contextCompaction", "id": "compact" }),
        json!({ "type": "collabAgentToolCall", "id": "collab", "tool": "spawnAgent", "status": "inProgress", "senderThreadId": "thread", "receiverThreadIds": [] }),
    ];
    let mut processor = human(Locale::EnUs, false);
    let mut stderr = Vec::new();
    for item in &items {
        processor
            .process(item_notification("item/started", item.clone()), &mut stderr)
            .unwrap();
        processor
            .process(
                item_notification("item/completed", item.clone()),
                &mut stderr,
            )
            .unwrap();
    }
    processor
        .process(terminal("completed", items, Value::Null), &mut stderr)
        .unwrap();
    assert_eq!(String::from_utf8(stderr).unwrap(), "apply patch\npatch: completed\nsrc/main.rs\nmcp: docs/read started\nmcp: docs/read (failed)\noffline\nweb search: canonical query\nweb search: canonical query\ncontext compacted\ncollab: SpawnAgent\n");
}

fn usage(input: i64, cached: i64, output: i64) -> Value {
    let total = json!({ "totalTokens": input.saturating_add(output), "inputTokens": input,
        "cachedInputTokens": cached, "outputTokens": output, "reasoningOutputTokens": 2 });
    json!({ "threadId": "thread", "turnId": "turn", "tokenUsage": {
        "total": total, "last": total, "modelContextWindow": 128000
    } })
}

#[test]
fn plan_diff_warning_errors_and_latest_usage_do_not_become_final_stdout() {
    let mut processor = human(Locale::EnUs, false);
    let mut stderr = Vec::new();
    for (method, params) in [
        (
            "turn/plan/updated",
            json!({ "threadId": "thread", "turnId": "turn", "explanation": "Canonical plan", "plan": [
            { "step": "Done", "status": "completed" }, { "step": "Active", "status": "inProgress" }, { "step": "Later", "status": "pending" }
        ] }),
        ),
        (
            "turn/diff/updated",
            json!({ "threadId": "thread", "turnId": "turn", "diff": "@@ -1 +1 @@\n-old\n+new" }),
        ),
        (
            "configWarning",
            json!({ "summary": "Config note", "details": "Details" }),
        ),
        (
            "warning",
            json!({ "threadId": "thread", "message": "Runtime note" }),
        ),
        (
            "error",
            json!({ "threadId": "thread", "turnId": "turn", "error": { "message": "Retrying" }, "willRetry": true }),
        ),
        ("thread/tokenUsage/updated", usage(100, 20, 10)),
        ("thread/tokenUsage/updated", usage(155000, 130000, 6000)),
    ] {
        processor
            .process(notification(method, params), &mut stderr)
            .unwrap();
    }
    let result = processor.process(terminal("completed", vec![json!({ "type": "agentMessage", "id": "answer", "text": "Final answer", "phase": "final_answer" })], Value::Null), &mut stderr).unwrap().unwrap();
    assert_eq!(result.output, "Final answer");
    assert_eq!(String::from_utf8(stderr).unwrap(), "Canonical plan\n  ✓ Done\n  → Active\n  • Later\n@@ -1 +1 @@\n-old\n+new\nwarning: Config note (Details)\nwarning: Runtime note\nERROR: Retrying\nlime\nFinal answer\ntokens used\n31,000\n");
}

#[test]
fn every_scoped_output_ignores_foreign_thread_and_foreign_turn() {
    let mut processor = human(Locale::EnUs, false);
    let mut stderr = Vec::new();
    for (thread, turn) in [("other", "turn"), ("thread", "other")] {
        for (method, mut params) in [
            (
                "item/started",
                json!({ "item": command("inProgress", Value::Null, Value::Null) }),
            ),
            (
                "item/completed",
                json!({ "item": command("failed", json!("secret"), json!(1)) }),
            ),
            (
                "error",
                json!({ "error": { "message": "foreign error" }, "willRetry": false }),
            ),
            (
                "turn/plan/updated",
                json!({ "explanation": "foreign plan", "plan": [] }),
            ),
            ("turn/diff/updated", json!({ "diff": "foreign diff" })),
            ("thread/tokenUsage/updated", usage(999, 0, 0)),
        ] {
            params["threadId"] = json!(thread);
            params["turnId"] = json!(turn);
            if method.starts_with("item/") {
                params["startedAtMs"] = json!(0);
                params["completedAtMs"] = json!(1);
            }
            assert!(processor
                .process(notification(method, params), &mut stderr)
                .unwrap()
                .is_none());
        }
    }
    processor
        .process(
            notification(
                "warning",
                json!({ "threadId": "other", "message": "foreign warning" }),
            ),
            &mut stderr,
        )
        .unwrap();
    processor
        .process(terminal("completed", vec![], Value::Null), &mut stderr)
        .unwrap();
    assert!(stderr.is_empty());
}

#[test]
fn failed_and_interrupted_turns_report_diagnostics_and_never_print_partial_snapshot() {
    for (status, error, expected) in [
        (
            "failed",
            json!({ "message": "Backend failed" }),
            "ERROR: Backend failed\n",
        ),
        ("interrupted", Value::Null, "turn interrupted\n"),
    ] {
        let mut processor = human(Locale::EnUs, false);
        let mut stderr = Vec::new();
        let result = processor.process(terminal(status, vec![json!({ "type": "agentMessage", "id": "partial", "text": "Partial answer" })], error), &mut stderr).unwrap().unwrap();
        assert_eq!(result.output, "");
        assert_eq!(String::from_utf8(stderr).unwrap(), expected);
    }
}

#[test]
fn five_locales_keep_user_content() {
    for (locale, exec, success, interrupted, tokens) in [
        (Locale::ZhCn, "执行", "成功", "回合已中断", "已用 token"),
        (Locale::ZhTw, "執行", "成功", "回合已中斷", "已用 token"),
        (
            Locale::EnUs,
            "exec",
            "succeeded",
            "turn interrupted",
            "tokens used",
        ),
        (Locale::JaJp, "実行", "成功", "ターン中断", "使用トークン"),
        (Locale::KoKr, "실행", "성공", "턴 중단됨", "사용 토큰"),
    ] {
        let mut processor = human(locale, false);
        let mut stderr = Vec::new();
        processor
            .process(
                notification("thread/tokenUsage/updated", usage(155000, 130000, 6000)),
                &mut stderr,
            )
            .unwrap();
        processor
            .process(
                terminal(
                    "interrupted",
                    vec![command("completed", json!("original output"), json!(0))],
                    Value::Null,
                ),
                &mut stderr,
            )
            .unwrap();
        let text = String::from_utf8(stderr).unwrap();
        assert!(text.starts_with(&format!("{exec}\n")));
        assert!(text.contains(success));
        assert!(text.contains("original output"));
        assert!(text.ends_with(&format!("{interrupted}\n{tokens}\n31,000\n")));
    }
}

#[test]
fn explicit_ansi_styles_labels_without_changing_canonical_output() {
    let mut processor = human(Locale::EnUs, true);
    let mut stderr = Vec::new();
    let result = processor
        .process(
            terminal(
                "completed",
                vec![
                    command("completed", json!("output"), json!(0)),
                    json!({ "type": "agentMessage", "id": "final", "text": "Answer" }),
                ],
                Value::Null,
            ),
            &mut stderr,
        )
        .unwrap()
        .unwrap();
    assert_eq!(result.output, "Answer");
    assert!(String::from_utf8(stderr).unwrap().contains('\u{1b}'));
}

#[test]
fn blended_tokens_exclude_cached_input_and_saturate_malformed_counters() {
    for (input, cached, output, expected) in [
        (155000, 130000, 6000, 31000),
        (10, 20, 5, 5),
        (-10, -20, -5, 0),
        (i64::MAX, 0, i64::MAX, i64::MAX),
    ] {
        let params = notification("thread/tokenUsage/updated", usage(input, cached, output));
        let ServerNotification::ThreadTokenUsageUpdated(params) = params else {
            unreachable!()
        };
        assert_eq!(blended_total(&params.token_usage), expected);
        assert!(!format_with_separators(expected).starts_with(','));
    }
    assert_eq!(format_with_separators(31000), "31,000");
    assert_eq!(
        format_with_separators(i64::MAX),
        "9,223,372,036,854,775,807"
    );
}

#[test]
fn final_answer_uses_stdout_when_either_stream_is_redirected() {
    for (stdout_tty, stderr_tty, expected) in [
        (true, true, false),
        (true, false, true),
        (false, true, true),
        (false, false, true),
    ] {
        assert_eq!(
            should_print_final_message_to_stdout("Answer", stdout_tty, stderr_tty),
            expected
        );
        assert!(!should_print_final_message_to_stdout(
            "", stdout_tty, stderr_tty
        ));
    }
}
