use super::*;
use model_fixture::Capture;

const COMMAND: &str = "printf 'CMD-READY\\n'; IFS= read -r first; printf 'CMD-FIRST:%s\\n' \"$first\"; IFS= read -r second; printf 'CMD-SECOND:%s\\n' \"$second\"";
const MAX_COMMAND_INVOCATIONS: usize = 16;

fn session_id(value: &Value) -> Option<i64> {
    match value {
        Value::Object(object) => object
            .get("session_id")
            .and_then(Value::as_i64)
            .or_else(|| object.values().find_map(session_id)),
        Value::Array(values) => values.iter().find_map(session_id),
        Value::String(text) => serde_json::from_str::<Value>(text)
            .ok()
            .as_ref()
            .and_then(session_id),
        _ => None,
    }
}

fn script(wire: Wire) -> impl FnMut(&Capture) -> Option<(String, String, Value)> + Send {
    let mut step = 0;
    move |capture| {
        let invocation = match step {
            0 => Some((
                "command-exec".to_string(),
                "exec_command",
                json!({
                    "cmd": COMMAND, "shell":"/bin/sh", "login":false,
                    "yield_time_ms":250, "max_output_tokens":2048,
                }),
            )),
            1 | 2 => {
                let id = session_id(capture.history()).unwrap_or_else(|| {
                    panic!(
                        "real exec_command must return an interactive session: {}",
                        capture.history()
                    )
                });
                Some((
                    if step == 1 {
                        "command-write-1"
                    } else {
                        "command-write-2"
                    }
                    .to_string(),
                    "write_stdin",
                    json!({
                        "session_id":id, "chars":if step == 1 {"first-value\n"} else {"second-value\n"},
                        "yield_time_ms":250, "max_output_tokens":2048,
                    }),
                ))
            }
            _ => {
                let entries = invocations(capture, wire);
                let result = serde_json::from_str::<Value>(
                    entries.last().expect("command result")["output"]
                        .as_str()
                        .expect("structured command result"),
                )
                .expect("command result JSON");
                if !result["exit_code"].is_null() {
                    assert_eq!(result["exit_code"], 0, "command failed: {result}");
                    return None;
                }
                assert!(
                    step < MAX_COMMAND_INVOCATIONS,
                    "command did not exit within the fixture call budget: {result}"
                );
                let id = session_id(capture.history()).expect("live command session");
                // A yield need not finish the process. Drain it without resending input.
                Some((
                    format!("command-poll-{step}"),
                    "write_stdin",
                    json!({
                        "session_id":id, "chars":"",
                        "yield_time_ms":250, "max_output_tokens":2048,
                    }),
                ))
            }
        };
        step += 1;
        invocation.map(|(id, name, args)| (id.to_string(), name.to_string(), args))
    }
}

// Compare canonical invocation semantics across native wire shapes. Gemini's wire
// may omit call ids, so identity assertions belong at the durable runtime boundary.
fn invocations(capture: &Capture, wire: Wire) -> Vec<Value> {
    let body = capture.body.to_string();
    for internal in [
        "history_token_limit",
        "outputTokenLimits",
        "provider.model_history",
    ] {
        assert!(
            !body.contains(internal),
            "host history metadata leaked to provider wire"
        );
    }
    let mut entries = Vec::new();
    for message in capture.history().as_array().expect("wire history array") {
        match wire {
            Wire::Chat => {
                if let Some(calls) = message.get("tool_calls").and_then(Value::as_array) {
                    for call in calls {
                        entries.push(json!({"kind":"call", "name":call["function"]["name"],
                            "arguments":serde_json::from_str::<Value>(call["function"]["arguments"].as_str().unwrap()).unwrap()}));
                    }
                }
                if message["role"] == "tool" {
                    entries.push(json!({"kind":"result", "output":message["content"]}));
                }
            }
            Wire::Responses => match message["type"].as_str() {
                Some("function_call") => entries.push(json!({"kind":"call", "name":message["name"],
                    "arguments":serde_json::from_str::<Value>(message["arguments"].as_str().unwrap()).unwrap()})),
                Some("function_call_output") => entries.push(json!({"kind":"result", "output":message["output"]})),
                _ => {}
            },
            Wire::Anthropic => {
                for part in message.get("content").and_then(Value::as_array).into_iter().flatten() {
                    match part["type"].as_str() {
                        Some("tool_use") => entries.push(json!({"kind":"call", "name":part["name"], "arguments":part["input"]})),
                        Some("tool_result") => entries.push(json!({"kind":"result", "output":part["content"]})),
                        _ => {}
                    }
                }
            }
            Wire::Gemini => {
                for part in message.get("parts").and_then(Value::as_array).into_iter().flatten() {
                    if let Some(call) = part.get("functionCall") {
                        entries.push(json!({"kind":"call", "name":call["name"], "arguments":call["args"]}));
                    }
                    if let Some(result) = part.get("functionResponse") {
                        entries.push(json!({"kind":"result", "output":result["response"]["content"]}));
                    }
                }
            }
        }
    }
    entries
}

fn result_capture(wire: Wire, result: Value) -> Capture {
    let output = result.to_string();
    let body = match wire {
        Wire::Chat => json!({"messages":[{"role":"tool","content":output}]}),
        Wire::Responses => json!({"input":[{"type":"function_call_output","output":output}]}),
        Wire::Anthropic => {
            json!({"messages":[{"role":"user","content":[{"type":"tool_result","content":output}]}]})
        }
        Wire::Gemini => {
            json!({"contents":[{"role":"user","parts":[{"functionResponse":{"response":{"content":output}}}]}]})
        }
    };
    Capture {
        path: String::new(),
        headers: String::new(),
        body,
    }
}

#[test]
fn command_script_polls_running_waiting_and_output_until_successful_exit() {
    for wire in [Wire::Chat, Wire::Responses, Wire::Anthropic, Wire::Gemini] {
        let running = result_capture(
            wire,
            json!({"session_id":1000,"output":"CMD-READY\n","process_status":"running"}),
        );
        let mut script = script(wire);
        let mut calls = vec![script(&running).unwrap()];
        for chars in ["first-value\n", "second-value\n"] {
            let call = script(&running).unwrap();
            assert_eq!(call.1, "write_stdin");
            assert_eq!(call.2["chars"], chars);
            calls.push(call);
        }
        for result in [
            json!({"session_id":1000,"output":"","process_status":"running"}),
            json!({"session_id":1000,"output":"","observation":{"kind":"waiting","process_active":true}}),
            json!({"session_id":1000,"output":"CMD-SECOND:second-value\n","observation":{"kind":"output","process_active":true}}),
            json!({"session_id":1000,"output":""}),
        ] {
            let call = script(&result_capture(wire, result)).expect("must drain the live command");
            assert_eq!(call.1, "write_stdin");
            assert_eq!(
                call.2,
                json!({"session_id":1000,"chars":"","yield_time_ms":250,"max_output_tokens":2048})
            );
            calls.push(call);
        }
        assert!(script(&result_capture(wire, json!({"exit_code":0,"output":""}))).is_none());
        assert_eq!(
            calls
                .iter()
                .map(|call| &call.0)
                .collect::<std::collections::HashSet<_>>()
                .len(),
            calls.len(),
            "every poll needs a distinct invocation identity"
        );
    }
}

#[test]
fn command_script_rejects_unsuccessful_exit() {
    for exit_code in [-1, 1] {
        let running = result_capture(Wire::Anthropic, json!({"session_id":1000,"output":""}));
        let mut script = script(Wire::Anthropic);
        for _ in 0..3 {
            assert!(script(&running).is_some());
        }
        let failed = result_capture(Wire::Anthropic, json!({"exit_code":exit_code,"output":""}));
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| script(&failed))).is_err()
        );
    }
}

#[test]
fn command_script_bounds_unfinished_process_polling() {
    let running = result_capture(Wire::Anthropic, json!({"session_id":1000,"output":""}));
    let mut script = script(Wire::Anthropic);
    for _ in 0..MAX_COMMAND_INVOCATIONS {
        assert!(script(&running).is_some());
    }
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| script(&running))).is_err());
}

async fn command_history(wire: Wire) {
    let temp = TempDir::new().unwrap();
    let fixture = ModelFixture::start_with_script(
        wire,
        catalog_truncation::model_catalog_with_budget(
            wire,
            agent_protocol::truncation::TruncationPolicy::Tokens(10000),
        ),
        script(wire),
    )
    .await;
    let server = AppServer::with_runtime(catalog_truncation::runtime(&temp).await);
    initialize_server(&server).await;
    let provider = catalog_truncation::provision_with_budget(
        &server,
        &fixture,
        20,
        agent_protocol::truncation::TruncationPolicy::Tokens(10000),
    )
    .await;
    let started = request(
        &server,
        2,
        METHOD_THREAD_START,
        json!({
            "model":wire.model(), "modelProvider":provider, "cwd":temp.path(),
            "approvalPolicy":"never", "sandbox":"danger-full-access",
        }),
    )
    .await;
    let thread = started["result"]["thread"]["id"].as_str().unwrap();
    let session = started["result"]["thread"]["sessionId"].as_str().unwrap();
    let mut notifications = server.subscribe_outbound_messages();
    run_turn(
        &server,
        3,
        thread,
        "run the interactive command and send both lines",
    )
    .await;
    let expected = invocations(&fixture.last_request(), wire);
    assert!(expected.len() >= 6, "three input calls must be retained");
    assert_eq!(expected.len() % 2, 0, "each call needs its result");
    let invocation_count = expected.len() / 2;
    while let Ok(notification) = notifications.try_recv() {
        assert!(
            !serde_json::to_string(&notification)
                .unwrap()
                .contains("provider.model_history"),
            "internal history cannot be broadcast to GUI"
        );
    }
    let records = EventLogWriter::new(temp.path().join("events"))
        .unwrap()
        .read_session_events(session)
        .unwrap();
    let history = records
        .iter()
        .filter(|record| {
            record.event.event_type == agent_runtime::model_history::MODEL_HISTORY_EVENT_TYPE
        })
        .map(|record| {
            serde_json::from_value::<agent_runtime::model_history::ModelHistoryRecord>(
                record.event.payload.clone(),
            )
            .unwrap()
            .into_message()
            .unwrap()
        })
        .collect::<Vec<_>>();
    assert_eq!(
        history.len(),
        expected.len(),
        "each model invocation/output must persist separately"
    );
    let call_ids = history
        .iter()
        .flat_map(|message| &message.content)
        .filter_map(|part| {
            if let model_provider::current_client::CurrentProviderContent::ToolCall(call) = part {
                Some(call.id.as_str())
            } else {
                None
            }
        })
        .collect::<std::collections::HashSet<_>>();
    assert_eq!(
        call_ids.len(),
        invocation_count,
        "each invocation needs a distinct identity"
    );
    for pair in history.chunks_exact(2) {
        use model_provider::current_client::CurrentProviderContent;
        let [CurrentProviderContent::ToolCall(call)] = pair[0].content.as_slice() else {
            panic!("each persisted invocation must start with a tool call");
        };
        let [CurrentProviderContent::ToolResult(result)] = pair[1].content.as_slice() else {
            panic!("each persisted invocation must end with a tool result");
        };
        assert_eq!(call.id, result.call_id, "call/result identity changed");
    }
    let read = request(
        &server,
        4,
        "thread/read",
        json!({"threadId":thread,"includeTurns":true}),
    )
    .await;
    let items = read["result"]["thread"]["turns"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|turn| turn["items"].as_array().unwrap())
        .collect::<Vec<_>>();
    let commands = items
        .iter()
        .filter(|item| item["type"] == "commandExecution")
        .collect::<Vec<_>>();
    assert_eq!(
        commands.len(),
        1,
        "all model invocations still project as one command"
    );
    assert_eq!(commands[0]["status"], "completed");
    assert_eq!(commands[0]["exitCode"], 0);
    let output = commands[0]["aggregatedOutput"].as_str().unwrap();
    for text in [
        "CMD-READY",
        "CMD-FIRST:first-value",
        "CMD-SECOND:second-value",
    ] {
        assert!(
            output.contains(text),
            "command projection lost output: {output}"
        );
    }
    assert_eq!(expected[0]["name"], "exec_command");
    assert_eq!(expected[2]["name"], "write_stdin");
    assert_eq!(expected[4]["name"], "write_stdin");
    let outputs = expected
        .chunks_exact(2)
        .map(|pair| {
            assert_eq!(pair[0]["kind"], "call");
            assert_eq!(pair[1]["kind"], "result");
            serde_json::from_str::<Value>(pair[1]["output"].as_str().unwrap())
                .expect("structured command result")
        })
        .collect::<Vec<_>>();
    assert_eq!(
        expected[0]["arguments"],
        json!({"cmd":COMMAND,"shell":"/bin/sh","login":false,
            "yield_time_ms":250,"max_output_tokens":2048})
    );
    for (index, pair) in expected.chunks_exact(2).enumerate().skip(1) {
        assert_eq!(pair[0]["name"], "write_stdin");
        assert_eq!(
            pair[0]["arguments"],
            json!({
                "session_id":outputs[0]["session_id"],
                "chars":match index { 1 => "first-value\n", 2 => "second-value\n", _ => "" },
                "yield_time_ms":250,"max_output_tokens":2048,
            }),
            "only empty polls may follow the original input lines"
        );
    }
    // A yield can return before stdout is ready; later writes drain the same
    // process. Poll until exit and preserve every byte without pinning chunk timing.
    let stdout = outputs
        .iter()
        .map(|result| result["output"].as_str().unwrap())
        .collect::<String>();
    assert_eq!(
        stdout, "CMD-READY\nCMD-FIRST:first-value\nCMD-SECOND:second-value\n",
        "{expected:?}"
    );
    assert_eq!(output, stdout, "projection and model history must agree");
    assert_eq!(outputs[0]["session_id"], outputs[1]["session_id"]);
    assert_eq!(outputs.last().unwrap()["exit_code"], 0);
    drop(server);

    let server = AppServer::with_runtime(catalog_truncation::runtime(&temp).await);
    initialize_server(&server).await;
    request(
        &server,
        10,
        METHOD_THREAD_RESUME,
        json!({"threadId":thread}),
    )
    .await;
    run_turn(&server, 11, thread, "continue after a cold reopen").await;
    assert_eq!(
        invocations(&fixture.last_request(), wire),
        expected,
        "cold reopen lost model invocations"
    );

    let switches = [
        catalog_truncation::default_budget_fixture(Wire::Chat).await,
        catalog_truncation::default_budget_fixture(Wire::Responses).await,
        catalog_truncation::default_budget_fixture(Wire::Anthropic).await,
        catalog_truncation::default_budget_fixture(Wire::Gemini).await,
    ];
    for (index, next) in switches.iter().enumerate() {
        let id = 30 + index as u64 * 10;
        let provider = catalog_truncation::provision_with_budget(
            &server,
            next,
            id,
            agent_protocol::truncation::TruncationPolicy::Tokens(10000),
        )
        .await;
        request(
            &server,
            id + 4,
            "thread/settings/update",
            json!({
                "threadId":thread,"model":next.wire.model(),"modelProvider":provider,
            }),
        )
        .await;
        run_turn(
            &server,
            id + 5,
            thread,
            "retain each original command invocation after model switch",
        )
        .await;
        next.last_request().assert_route(next.wire);
        assert_eq!(
            invocations(&next.last_request(), next.wire),
            expected,
            "cross-protocol replay lost command history"
        );
    }
    let final_fixture = &switches[3];
    let forked = request(&server, 12, "thread/fork", json!({"threadId":thread})).await;
    let fork = forked["result"]["thread"]["id"].as_str().unwrap();
    run_turn(
        &server,
        13,
        fork,
        "continue from the inherited command history",
    )
    .await;
    assert_eq!(
        invocations(&final_fixture.last_request(), final_fixture.wire),
        expected,
        "fork lost model invocations"
    );
    drop(server);
    let server = AppServer::with_runtime(catalog_truncation::runtime(&temp).await);
    initialize_server(&server).await;
    request(&server, 70, METHOD_THREAD_RESUME, json!({"threadId":fork})).await;
    run_turn(
        &server,
        71,
        fork,
        "resume inherited history after cold reopen",
    )
    .await;
    assert_eq!(
        invocations(&final_fixture.last_request(), final_fixture.wire),
        expected,
        "cold fork lost model invocations"
    );
    request(
        &server,
        72,
        METHOD_THREAD_RESUME,
        json!({"threadId":thread}),
    )
    .await;
    assert_eq!(
        compact(&server, 14, thread).await["params"]["turn"]["status"],
        "completed"
    );
    assert_eq!(
        invocations(&final_fixture.last_request(), final_fixture.wire),
        expected,
        "summary lost model invocations"
    );
}

#[tokio::test]
async fn command_history_chat_survives_cold_reopen_fork_and_summary() {
    command_history(Wire::Chat).await;
}

#[tokio::test]
async fn command_history_responses_survives_cold_reopen_fork_and_summary() {
    command_history(Wire::Responses).await;
}

#[tokio::test]
async fn command_history_anthropic_survives_cold_reopen_fork_and_summary() {
    command_history(Wire::Anthropic).await;
}

#[tokio::test]
async fn command_history_gemini_survives_cold_reopen_fork_and_summary() {
    command_history(Wire::Gemini).await;
}
