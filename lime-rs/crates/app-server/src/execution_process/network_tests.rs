use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

struct NetworkProcessRunner {
    server: ExecutionProcessServer,
    process_id: String,
    url: String,
    cwd: PathBuf,
}

impl RuntimeToolAttemptRunner for NetworkProcessRunner {
    fn run<'a>(&'a self, attempt: RuntimeToolExecutionAttempt) -> RuntimeToolAttemptFuture<'a> {
        Box::pin(async move {
            RuntimeLiveExecutionGateway::start_process(
                &self.server,
                "network-thread",
                "local HTTP probe",
                LiveExecutionRequest {
                    process_id: self.process_id.clone(),
                    tool_id: attempt.identity().call_id().into(),
                    tool_name: "exec_command".into(),
                    environment_id: "local".into(),
                    command: vec![
                        "/usr/bin/curl".into(),
                        "--noproxy".into(),
                        "*".into(),
                        "--fail".into(),
                        "--silent".into(),
                        "--show-error".into(),
                        "--max-time".into(),
                        "1".into(),
                        self.url.clone(),
                    ],
                    working_directory: self.cwd.clone(),
                    tty: false,
                    approval_policy: Some("never".into()),
                    sandbox_policy: Some("workspace-write".into()),
                    runtime_metadata: Some(
                        json!({"workspaceSandbox":{"enabled":false,"strict":false}}),
                    ),
                    env: HashMap::new(),
                    attempt: Some(attempt),
                },
            )
            .await?;
            let snapshot = wait_for_terminal_snapshot(&self.server, &self.process_id).await;
            Ok(RuntimeToolExecutionResult::new(
                snapshot.exit_code == Some(0),
                format!("{:?}", snapshot.exit_code),
                None,
                HashMap::new(),
            ))
        })
    }
}

#[tokio::test]
async fn workspace_network_default_reaches_real_seatbelt_process_with_legacy_switches_disabled() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/", listener.local_addr().unwrap());
    let connections = Arc::new(AtomicUsize::new(0));
    let seen = connections.clone();
    let server_task = tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            seen.fetch_add(1, Ordering::SeqCst);
            let mut buffer = [0u8; 2048];
            let _ = socket.read(&mut buffer).await;
            let _ = socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
                .await;
        }
    });
    let workspace = tempfile::tempdir().unwrap();
    for enabled in [false, true] {
        let runner = NetworkProcessRunner {
            server: ExecutionProcessServer::default(),
            process_id: format!("network-{enabled}"),
            url: url.clone(),
            cwd: workspace.path().into(),
        };
        let mut input = process_orchestration_input(
            RuntimeToolInitialApproval::NotRequired,
            RuntimeToolSandboxPolicy::WorkspaceWrite,
            None,
            false,
        );
        input.approval_policy = RuntimeToolApprovalPolicy::Never;
        input.sandbox_network_access = enabled;
        let approvals = RecordingProcessApprovals::default();
        let result = orchestrate_runtime_tool_execution(input, &approvals, &runner)
            .await
            .unwrap();
        assert_eq!(
            result.success, enabled,
            "network={enabled}, exit={}",
            result.output
        );
        assert_eq!(connections.load(Ordering::SeqCst), usize::from(enabled));
        assert_eq!(approvals.calls.load(Ordering::SeqCst), 0);
    }
    server_task.abort();
}
