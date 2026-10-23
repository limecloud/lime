use super::*;
use crate::execution_process::ExecutionProcessServer;
use crate::runtime::MockBackend;
use app_server_protocol::AgentSessionStartParams;
use tool_runtime::execution_process::{start_local_execution_process, LocalExecutionRequest};

#[cfg(unix)]
#[tokio::test]
async fn terminal_shell_waits_for_collector_and_drains_every_output_batch() {
    let workspace = tempfile::tempdir().expect("shell output workspace");
    let core = RuntimeCore::with_backend(Arc::new(MockBackend));
    core.start_session(AgentSessionStartParams {
        session_id: Some("shell-output-session".to_string()),
        thread_id: Some("shell-output-thread".to_string()),
        app_id: "agent-chat".to_string(),
        workspace_id: None,
        business_object_ref: None,
        locale: None,
    })
    .expect("shell output session");
    let server = ExecutionProcessServer::default();
    let mut handle = start_local_execution_process(LocalExecutionRequest {
        process_id: "shell-output-process".to_string(),
        tool_id: "shell-output-item".to_string(),
        tool_name: "exec_command".to_string(),
        command: vec![
            "/bin/sh".to_string(),
            "-c".to_string(),
            "read token; printf '%0129d' 0".to_string(),
        ],
        cwd: Some(workspace.path().to_path_buf()),
        env: HashMap::new(),
        tty: false,
        stdin: true,
        env_clear: false,
        pty_size: None,
        sandbox: None,
    })
    .expect("real shell process");
    let control = handle.control_handle();
    server
        .register_process_handle(control.clone(), handle.status())
        .expect("register producer before completion");
    control.write_stdin(b"release\n").expect("release child");
    let mut deltas = Vec::new();
    while let Some(delta) = handle.recv_output().await {
        deltas.push(delta);
    }
    let final_snapshot = handle.wait().await.expect("real child completion");
    assert!(server
        .status("shell-output-process")
        .unwrap()
        .status
        .is_terminal());

    core.append_and_publish_shell_events(
        "shell-output-session",
        "shell-output-thread",
        "shell-output-turn",
        vec![
            RuntimeEvent::new("turn.accepted", json!({"source": "thread/shellCommand"})),
            RuntimeEvent::new("turn.started", json!({"source": "thread/shellCommand"})),
            RuntimeEvent::new(
                "command.started",
                shell_event_payload(
                    "shell-output-item",
                    "shell-output-process",
                    "printf output",
                    workspace.path(),
                    None,
                ),
            ),
        ],
    )
    .expect("canonical command lifecycle precedes output");

    let polling = core.poll_shell_process(
        "shell-output-session",
        "shell-output-thread",
        "shell-output-turn",
        "shell-output-item",
        "shell-output-process",
        "printf output",
        workspace.path(),
        server.clone(),
        CancellationToken::new(),
    );
    tokio::pin!(polling);
    assert!(futures::poll!(polling.as_mut()).is_pending());

    let output = deltas
        .iter()
        .map(|delta| delta.delta.as_str())
        .collect::<String>();
    assert_eq!(output.len(), usize::from(OUTPUT_DRAIN_LIMIT) + 1);
    let template = deltas.first().expect("real stdout delta");
    for (index, value) in output.chars().enumerate() {
        let mut delta = template.clone();
        delta.sequence = index as u64 + 1;
        delta.delta = value.to_string();
        delta.raw_bytes = delta.delta.as_bytes().to_vec();
        delta.bytes = 1;
        server
            .record_process_output(delta)
            .expect("collector appends output");
    }
    server
        .finish_process(final_snapshot)
        .expect("collector finishes");
    let outcome = tokio::time::timeout(Duration::from_secs(3), polling)
        .await
        .expect("output completion deadline")
        .expect("shell outcome");
    assert_eq!(outcome.output, output);
    assert!(matches!(outcome.terminal, ShellTerminal::Completed));
    let events = core
        .events_for_session("shell-output-session")
        .expect("output events");
    let published = events
        .iter()
        .filter(|event| event.event_type == "command.output")
        .collect::<Vec<_>>();
    assert_eq!(published.len(), usize::from(OUTPUT_DRAIN_LIMIT) + 1);
    assert_eq!(
        published
            .iter()
            .map(|event| event.payload["delta"].as_str().unwrap())
            .collect::<String>(),
        output,
    );
}
