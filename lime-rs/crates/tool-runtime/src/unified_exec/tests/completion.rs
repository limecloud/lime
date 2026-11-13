use super::*;

async fn background_completion(
    gateway: Arc<FixtureGateway>,
    thread_id: &'static str,
) -> (i32, Arc<tokio::sync::Mutex<session::UnifiedExecSession>>) {
    let params = json!({"cmd":"long-running","login":false,"yield_time_ms":250});
    let mut exec = request(EXEC_COMMAND_TOOL_NAME, &params, "background-completion");
    exec.thread_id = thread_id;
    let result = execute_runtime_unified_exec_tool(gateway.clone(), exec)
        .await
        .unwrap();
    let id = result.structured_content.unwrap()["session_id"]
        .as_i64()
        .unwrap() as i32;
    let session = session::find_session(id).unwrap();
    gateway.append_output_to_only_process("final output\n");
    {
        let mut state = gateway.state.lock().unwrap();
        let process = state.values_mut().next().unwrap();
        process.snapshot.status = ExecutionProcessStatus::Exited;
        process.snapshot.exit_code = Some(0);
    }
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while !session.lock().await.completed {
            tokio::task::yield_now().await;
        }
        // Observe the watcher after it has released the same interaction lock
        // used by write_stdin, rather than racing the terminal publication.
        let interaction = session.lock().await.interaction_lock.clone();
        let _guard = interaction.lock().await;
    })
    .await
    .expect("background watcher must publish the process exit");
    (id, session)
}

#[tokio::test]
async fn background_exit_remains_pollable_until_terminal_output_is_collected() {
    let gateway = Arc::new(FixtureGateway::default());
    let thread_id = "thread-completion-poll";
    let (id, _) = background_completion(gateway.clone(), thread_id).await;
    let params = json!({"session_id":id,"chars":"","yield_time_ms":250});
    let mut poll = request(WRITE_STDIN_TOOL_NAME, &params, "collect-background-exit");
    poll.thread_id = thread_id;
    let result = execute_runtime_unified_exec_tool(gateway, poll)
        .await
        .expect("a background exit must retain its final model-visible result");
    let output = result.structured_content.unwrap();
    assert_eq!(output["exit_code"], 0);
    assert_eq!(output["output"], "final output\n");
    assert_eq!(output["observation"]["kind"], "terminal");
    assert!(session::find_session(id).is_err());
}

#[tokio::test]
async fn thread_shutdown_removes_uncollected_background_exits() {
    let gateway = Arc::new(FixtureGateway::default());
    let thread_id = "thread-completion-shutdown";
    let (id, _) = background_completion(gateway.clone(), thread_id).await;
    terminate_all_processes(gateway.as_ref(), thread_id)
        .await
        .unwrap();
    assert!(session::find_session(id).is_err());
}
