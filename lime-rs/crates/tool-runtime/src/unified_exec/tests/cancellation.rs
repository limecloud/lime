use super::*;

#[tokio::test]
async fn session_shutdown_closes_all_turns_and_preserves_other_threads() {
    let gateway = Arc::new(FixtureGateway::default());
    let sink = Arc::new(RecordingOutputSink::default());
    let scopes = [
        ("shutdown-thread", "completed-turn-one", "shutdown-call-one"),
        ("shutdown-thread", "completed-turn-two", "shutdown-call-two"),
        (
            "shutdown-other-thread",
            "completed-turn-one",
            "shutdown-other-call",
        ),
    ];
    let params = json!({"cmd": "long-running", "yield_time_ms": 250});
    for (thread_id, turn_id, call_id) in scopes {
        let mut start = request(EXEC_COMMAND_TOOL_NAME, &params, call_id);
        start.thread_id = thread_id;
        start.turn_id = turn_id.to_string();
        start.output_sink = Some(sink.clone());
        execute_runtime_unified_exec_tool(gateway.clone(), start)
            .await
            .unwrap();
    }
    terminate_all_processes(gateway.as_ref(), "shutdown-thread")
        .await
        .unwrap();
    terminate_all_processes(gateway.as_ref(), "shutdown-thread")
        .await
        .unwrap();
    let results = sink.command_results.lock().unwrap().clone();
    let terminals = results
        .iter()
        .filter(|event| event.output.as_ref().unwrap().metadata["session_id"].is_null())
        .collect::<Vec<_>>();
    assert_eq!(terminals.len(), 2);
    let starts = sink.command_starts.lock().unwrap().clone();
    for (thread_id, turn_id, call_id) in scopes {
        let original = starts
            .iter()
            .find(|event| event.call_id == call_id)
            .unwrap();
        let status = gateway.status(&original.process_id).unwrap().status;
        if thread_id == "shutdown-thread" {
            assert_eq!(status, ExecutionProcessStatus::Terminated);
            let terminal = terminals
                .iter()
                .find(|event| event.call_id == call_id)
                .unwrap();
            assert_eq!(terminal.turn_id, turn_id);
            assert_eq!(
                terminal.output.as_ref().unwrap().metadata["processId"],
                original.process_id
            );
        } else {
            assert_eq!(status, ExecutionProcessStatus::Running);
        }
    }
    terminate_all_processes(gateway.as_ref(), "shutdown-other-thread")
        .await
        .unwrap();
}

#[tokio::test]
async fn background_terminal_waits_for_final_supervisor_output() {
    let barrier = Arc::new(FixtureExitBarrier::default());
    let gateway = Arc::new(FixtureGateway {
        exit_barrier: Some(barrier.clone()),
        ..Default::default()
    });
    let sink = Arc::new(RecordingOutputSink::default());
    let params = json!({"cmd": "long-running", "yield_time_ms": 250});
    let mut start = request(EXEC_COMMAND_TOOL_NAME, &params, "call-final-output");
    start.output_sink = Some(sink.clone());
    let running = execute_runtime_unified_exec_tool(gateway.clone(), start)
        .await
        .expect("background process");
    let process_id = running.metadata["processId"].as_str().unwrap();
    gateway.write_stdin(process_id, b"finish\n").unwrap();
    tokio::time::timeout(Duration::from_secs(3), barrier.started.notified())
        .await
        .expect("watcher waits for supervisor completion");
    assert!(
        !sink
            .command_results
            .lock()
            .unwrap()
            .iter()
            .any(|event| event.output.as_ref().unwrap().metadata["session_id"].is_null())
    );
    gateway.append_output_to_only_process("final-partial");
    barrier.release.notify_one();
    tokio::time::timeout(Duration::from_secs(3), async {
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
    .expect("final Command output");
    let results = sink.command_results.lock().unwrap();
    let terminals = results
        .iter()
        .filter(|event| event.output.as_ref().unwrap().metadata["session_id"].is_null())
        .collect::<Vec<_>>();
    assert_eq!(terminals.len(), 1);
    assert_eq!(terminals[0].call_id, "call-final-output");
    assert_eq!(
        terminals[0].output.as_ref().unwrap().metadata["command_output"],
        "started\nfinished\nfinal-partial"
    );
}

#[tokio::test]
async fn forced_abort_cleanup_preserves_command_identity_and_other_scopes() {
    let gateway = Arc::new(FixtureGateway::default());
    let sink = Arc::new(RecordingOutputSink::default());
    let scopes = [
        ("cancel-thread", "cancel-turn", "cancel-call"),
        ("other-thread", "cancel-turn", "other-thread-call"),
        ("cancel-thread", "other-turn", "other-turn-call"),
    ];
    let mut tasks = Vec::new();
    for (thread_id, turn_id, call_id) in scopes {
        let gateway = gateway.clone();
        let sink = sink.clone();
        tasks.push(tokio::spawn(async move {
            let params = json!({"cmd": "long-running", "yield_time_ms": 30_000});
            let mut request = request(EXEC_COMMAND_TOOL_NAME, &params, call_id);
            request.thread_id = thread_id;
            request.turn_id = turn_id.to_string();
            request.output_sink = Some(sink);
            execute_runtime_unified_exec_tool(gateway, request).await
        }));
    }
    tokio::time::timeout(Duration::from_secs(5), async {
        while sink.command_starts.lock().unwrap().len() != scopes.len() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("all original commands have started");
    for task in tasks {
        task.abort();
        assert!(task.await.expect_err("forced task abort").is_cancelled());
    }
    let starts = sink.command_starts.lock().unwrap().clone();
    cancel_turn(gateway.as_ref(), "cancel-thread", "cancel-turn")
        .await
        .expect("owner completes forced-abort cleanup");
    cancel_turn(gateway.as_ref(), "cancel-thread", "cancel-turn")
        .await
        .expect("repeated cleanup is idempotent");
    let completed = sink.command_results.lock().unwrap().clone();
    assert_eq!(completed.len(), 1);
    assert_eq!(completed[0].call_id, "cancel-call");
    assert_eq!(completed[0].turn_id, "cancel-turn");
    let original = starts
        .iter()
        .find(|start| start.call_id == "cancel-call")
        .unwrap();
    let output = completed[0]
        .output
        .as_ref()
        .expect("terminal command output");
    assert_eq!(output.metadata["processId"], original.process_id);
    assert_eq!(
        gateway.status(&original.process_id).unwrap().status,
        ExecutionProcessStatus::Terminated
    );
    for (thread_id, turn_id, call_id) in scopes.into_iter().skip(1) {
        let original = starts
            .iter()
            .find(|start| start.call_id == call_id)
            .unwrap();
        assert_eq!(
            gateway.status(&original.process_id).unwrap().status,
            ExecutionProcessStatus::Running
        );
        cancel_turn(gateway.as_ref(), thread_id, turn_id)
            .await
            .expect("isolated fixture cleanup");
    }
}
