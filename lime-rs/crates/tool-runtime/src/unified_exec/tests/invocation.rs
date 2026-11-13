use super::*;

#[tokio::test]
async fn prepared_invocation_is_shared_by_execution_start_output_and_terminal_result() {
    let workspace = tempfile::tempdir().unwrap();
    let working_dir = workspace.path().join("work dir");
    std::fs::create_dir(&working_dir).unwrap();
    let script = "cat 'guide one.md'";
    let params = json!({
        "cmd": script,
        "shell": "sh",
        "login": false,
        "workdir": "work dir",
        "yield_time_ms": 250
    });
    let gateway = Arc::new(FixtureGateway::default());
    let sink = Arc::new(RecordingOutputSink::default());
    let mut invocation = request(EXEC_COMMAND_TOOL_NAME, &params, "call-facts");
    invocation.working_directory = workspace.path().to_owned();
    invocation.output_sink = Some(sink.clone());
    let result = execute_runtime_unified_exec_tool(gateway.clone(), invocation)
        .await
        .unwrap();
    let started = gateway.starts.lock().unwrap()[0].clone();
    let expected_argv = json!(started.command);
    let expected_cwd = json!(started.working_directory.to_string_lossy());
    assert_eq!(result.metadata.get("commandArgv"), Some(&expected_argv));
    assert_eq!(result.metadata.get("cwd"), Some(&expected_cwd));
    assert_eq!(result.metadata.get("command"), Some(&json!(script)));
    assert_eq!(
        sink.command_starts.lock().unwrap().as_slice(),
        &[CommandStartEvent {
            turn_id: "turn-1".to_owned(),
            call_id: "call-facts".to_owned(),
            command: script.to_owned(),
            argv: started.command,
            cwd: started.working_directory,
            process_id: started.process_id,
        }]
    );
    for event in sink.events() {
        assert_eq!(event.metadata.get("commandArgv"), Some(&expected_argv));
        assert_eq!(event.metadata.get("cwd"), Some(&expected_cwd));
    }
}

#[tokio::test]
async fn polls_and_write_stdin_keep_original_invocation_and_publish_one_execution_start() {
    let workspace = tempfile::tempdir().unwrap();
    let params =
        json!({"cmd": "long-running", "shell": "sh", "login": false, "yield_time_ms": 250});
    let gateway = Arc::new(FixtureGateway::default());
    let sink = Arc::new(RecordingOutputSink::default());
    let mut invocation = request(EXEC_COMMAND_TOOL_NAME, &params, "call-original");
    invocation.working_directory = workspace.path().to_owned();
    invocation.output_sink = Some(sink.clone());
    let running = execute_runtime_unified_exec_tool(gateway.clone(), invocation)
        .await
        .unwrap();
    let session_id = running.structured_content.as_ref().unwrap()["session_id"]
        .as_i64()
        .unwrap();
    let started = gateway.starts.lock().unwrap()[0].clone();
    let expected_argv = json!(started.command);
    let expected_cwd = json!(started.working_directory.to_string_lossy());
    let poll = json!({"session_id": session_id, "yield_time_ms": 250});
    let mut poll_request = request(WRITE_STDIN_TOOL_NAME, &poll, "poll-call");
    poll_request.working_directory = PathBuf::from("/unrelated-context");
    poll_request.turn_id = "different-turn".to_owned();
    let observed = execute_runtime_unified_exec_tool(gateway.clone(), poll_request)
        .await
        .unwrap();
    let write = json!({"session_id": session_id, "chars": "continue\n", "yield_time_ms": 250});
    let mut write_request = request(WRITE_STDIN_TOOL_NAME, &write, "write-call");
    write_request.working_directory = PathBuf::from("/unrelated-context");
    write_request.turn_id = "different-turn".to_owned();
    write_request.output_sink = Some(sink.clone());
    let completed = execute_runtime_unified_exec_tool(gateway.clone(), write_request)
        .await
        .unwrap();
    assert_eq!(
        completed.metadata["terminalInteractions"],
        json!([
            {"processId": started.process_id, "stdin": "(poll)"},
            {"processId": started.process_id, "stdin": "sent 9 chars"},
        ])
    );
    assert!(!completed.metadata.contains_key("terminal_interaction"));
    for result in [running, observed, completed] {
        assert_eq!(result.metadata.get("commandArgv"), Some(&expected_argv));
        assert_eq!(result.metadata.get("cwd"), Some(&expected_cwd));
        assert_eq!(
            result.metadata.get("exec_command_call_id"),
            Some(&json!("call-original"))
        );
    }
    assert_eq!(gateway.starts.lock().unwrap().len(), 1);
    assert_eq!(sink.command_starts.lock().unwrap().len(), 1);
    assert!(sink
        .events()
        .iter()
        .all(|event| event.turn_id == "turn-1" && event.call_id == "call-original"));
    let results = sink.command_results.lock().unwrap();
    assert!(results
        .iter()
        .all(|event| event.turn_id == "turn-1" && event.call_id == "call-original"));
    let terminal = results
        .iter()
        .filter(|event| event.output.as_ref().unwrap().metadata["session_id"].is_null())
        .collect::<Vec<_>>();
    assert_eq!(terminal.len(), 1);
    assert_eq!(
        terminal[0].output.as_ref().unwrap().metadata["command_output"],
        json!("started\nfinished\n")
    );
}

#[tokio::test]
async fn background_exit_publishes_original_command_without_another_tool_call() {
    let thread_id = "thread-background-autonomous";
    let params = json!({"cmd": "long-running", "yield_time_ms": 250});
    let gateway = Arc::new(FixtureGateway::default());
    let sink = Arc::new(RecordingOutputSink::default());
    let mut start = request(EXEC_COMMAND_TOOL_NAME, &params, "call-autonomous");
    start.thread_id = thread_id;
    start.output_sink = Some(sink.clone());
    let running = execute_runtime_unified_exec_tool(gateway.clone(), start)
        .await
        .unwrap();
    let process_id = running.metadata["processId"].as_str().unwrap();
    let session_id = running.structured_content.as_ref().unwrap()["session_id"]
        .as_i64()
        .unwrap() as i32;
    gateway.write_stdin(process_id, b"finish\n").unwrap();
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let changed = sink.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            if sink
                .command_results
                .lock()
                .unwrap()
                .iter()
                .any(|event| event.output.as_ref().unwrap().metadata["session_id"].is_null())
            {
                break;
            }
            changed.await;
        }
    })
    .await
    .expect("watcher must observe the actual process exit");
    let results = sink.command_results.lock().unwrap();
    let terminals = results
        .iter()
        .filter(|event| event.output.as_ref().unwrap().metadata["session_id"].is_null())
        .collect::<Vec<_>>();
    assert_eq!(terminals.len(), 1);
    assert_eq!(terminals[0].turn_id, "turn-1");
    assert_eq!(terminals[0].call_id, "call-autonomous");
    assert_eq!(
        terminals[0].output.as_ref().unwrap().metadata["command_output"],
        json!("started\nfinished\n")
    );
    drop(results);
    assert!(find_session(session_id).is_ok());

    let params = json!({"session_id":session_id,"chars":"","yield_time_ms":250});
    let mut poll = request(WRITE_STDIN_TOOL_NAME, &params, "collect-autonomous");
    poll.thread_id = thread_id;
    let result = execute_runtime_unified_exec_tool(gateway, poll)
        .await
        .expect("a published exit must remain available to the model");
    assert_eq!(result.structured_content.unwrap()["exit_code"], 0);
    assert!(find_session(session_id).is_err());
    assert_eq!(
        sink.command_results
            .lock()
            .unwrap()
            .iter()
            .filter(|event| event.output.as_ref().unwrap().metadata["session_id"].is_null())
            .count(),
        1,
        "collecting the exit must not publish another terminal event"
    );
}
