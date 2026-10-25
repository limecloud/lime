use super::*;
#[cfg(unix)]
use crate::execution_process::ExecutionProcessServer;
#[cfg(unix)]
use app_server_protocol::protocol::v2::CommandExecTerminalSize;
#[cfg(unix)]
use tokio::sync::mpsc;
#[cfg(unix)]
use tool_runtime::execution_process::live::LiveExecutionOutputQuery;

#[cfg(unix)]
fn server_with_notifications() -> (
    CommandExecServer,
    mpsc::UnboundedReceiver<(ConnectionId, JsonRpcNotification)>,
) {
    let (tx, rx) = mpsc::unbounded_channel();
    let hook: CommandExecNotificationHook = Arc::new(move |connection_id, notification| {
        let tx = tx.clone();
        Box::pin(async move {
            let _ = tx.send((connection_id, notification));
        })
    });
    (
        CommandExecServer::default().with_notification_hook(hook),
        rx,
    )
}

#[cfg(unix)]
fn exec_params(process_id: Option<&str>, script: &str) -> CommandExecParams {
    CommandExecParams {
        command: vec!["/bin/sh".to_string(), "-c".to_string(), script.to_string()],
        process_id: process_id.map(str::to_string),
        tty: false,
        stream_stdin: false,
        stream_stdout_stderr: false,
        output_bytes_cap: Some(1024),
        disable_output_cap: false,
        disable_timeout: false,
        timeout_ms: Some(2_000),
        cwd: Some(std::env::current_dir().expect("current directory")),
        env: None,
        size: None,
        sandbox_policy: None,
        permission_profile: None,
    }
}

#[cfg(unix)]
#[tokio::test]
async fn explicit_environment_removal_is_not_reintroduced_by_process_inheritance() {
    let mut params = exec_params(None, "");
    params.command = vec!["/usr/bin/env".into()];
    params.env = Some(HashMap::from([("PATH".into(), None)]));
    params.output_bytes_cap = None;
    params.disable_output_cap = true;
    let response = CommandExecServer::default()
        .exec(ConnectionId(81), params, None)
        .await
        .unwrap();
    assert_eq!(response.exit_code, 0, "{response:?}");
    assert!(!response
        .stdout
        .lines()
        .any(|line| line.starts_with("PATH=")));
}

#[cfg(unix)]
#[tokio::test]
async fn worktree_environment_is_applied_before_explicit_command_overrides() {
    use lime_services::project_git_service as git;
    let temporary = tempfile::tempdir().unwrap();
    let cwd = std::fs::canonicalize(temporary.path()).unwrap();
    let output = std::process::Command::new("git")
        .arg("init")
        .arg("--template=")
        .arg(&cwd)
        .output()
        .unwrap();
    assert!(output.status.success());
    let diff =
        git::WorktreeShellEnvironment::from_captures("HOME=old\n", "LIME_SETUP_TEST=from-setup\n")
            .unwrap();
    git::write_worktree_shell_environment(&cwd, &diff)
        .await
        .unwrap();
    let server = CommandExecServer::default();
    let mut params = exec_params(
        None,
        "printf '%s|%s' \"${LIME_SETUP_TEST-missing}\" \"${HOME-missing}\"",
    );
    params.cwd = Some(cwd);
    let inherited = server
        .exec(ConnectionId(82), params.clone(), None)
        .await
        .unwrap();
    assert_eq!(inherited.stdout, "from-setup|missing");
    params.env = Some(HashMap::from([
        ("LIME_SETUP_TEST".into(), Some("explicit".into())),
        ("HOME".into(), Some("explicit-home".into())),
    ]));
    let explicit = server
        .exec(ConnectionId(83), params.clone(), None)
        .await
        .unwrap();
    assert_eq!(explicit.stdout, "explicit|explicit-home");
    params.env = None;
    let host = server
        .exec_cancellable(
            ConnectionId(84),
            params,
            None,
            CommandExecEnvironment::Host,
            || false,
        )
        .await
        .unwrap();
    assert!(
        host.stdout.starts_with("missing|"),
        "Host setup must not reuse the previous worktree diff"
    );
}

#[cfg(windows)]
fn windows_exec_params(script: &str) -> CommandExecParams {
    CommandExecParams {
        command: vec![
            "powershell.exe".to_string(),
            "-NoProfile".to_string(),
            "-NonInteractive".to_string(),
            "-Command".to_string(),
            script.to_string(),
        ],
        process_id: None,
        tty: false,
        stream_stdin: false,
        stream_stdout_stderr: false,
        output_bytes_cap: Some(1024),
        disable_output_cap: false,
        disable_timeout: false,
        timeout_ms: Some(20),
        cwd: Some(std::env::current_dir().expect("current directory")),
        env: None,
        size: None,
        sandbox_policy: None,
        permission_profile: None,
    }
}

#[cfg(unix)]
async fn wait_for_session(
    server: &CommandExecServer,
    connection_id: ConnectionId,
    process_id: &str,
) {
    tokio::time::timeout(std::time::Duration::from_secs(1), async {
        loop {
            if server
                .session(&key(connection_id, process_id))
                .await
                .is_ok()
            {
                return;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("command/exec session registration timeout");
}

#[cfg(unix)]
#[tokio::test]
async fn one_off_command_captures_stdout_stderr_and_exit_code() {
    let response = CommandExecServer::default()
        .exec(
            ConnectionId(1),
            exec_params(None, "printf stdout; printf stderr >&2; exit 7"),
            None,
        )
        .await
        .expect("execute command");

    assert_eq!(response.exit_code, 7);
    assert_eq!(response.stdout, "stdout");
    assert_eq!(response.stderr, "stderr");
}

#[cfg(unix)]
#[tokio::test]
async fn command_exec_registers_output_and_terminal_status_with_shared_owner() {
    let process_server = ExecutionProcessServer::default();
    let server = CommandExecServer::default().with_process_server(process_server.clone());
    let connection_id = ConnectionId(11);
    let public_process_id = "shared-owner";
    let response = server
        .exec(
            connection_id,
            exec_params(Some(public_process_id), "printf shared-owner-output"),
            None,
        )
        .await
        .expect("execute command");

    assert_eq!(response.exit_code, 0);
    let owner_id = owner_process_id(connection_id, public_process_id);
    let status = process_server.status(&owner_id).expect("shared status");
    assert!(status.status.is_terminal());
    assert_eq!(status.exit_code, Some(0));
    assert_eq!(status.process_id, owner_id);

    let output = process_server
        .drain_output(LiveExecutionOutputQuery {
            process_id: Some(owner_id),
            ..LiveExecutionOutputQuery::default()
        })
        .expect("shared output");
    assert!(output
        .deltas
        .iter()
        .any(|delta| delta.delta.contains("shared-owner-output")));
}

#[cfg(unix)]
#[tokio::test]
async fn completed_process_id_can_be_reused_after_terminal_cleanup() {
    let process_server = ExecutionProcessServer::default();
    let server = CommandExecServer::default().with_process_server(process_server);
    let connection_id = ConnectionId(12);

    let first = server
        .exec(
            connection_id,
            exec_params(Some("reusable"), "printf first"),
            None,
        )
        .await
        .expect("first command");
    assert_eq!(first.stdout, "first");

    let second = server
        .exec(
            connection_id,
            exec_params(Some("reusable"), "printf second"),
            None,
        )
        .await
        .expect("terminal process id should be reusable");
    assert_eq!(second.stdout, "second");
}

#[cfg(unix)]
#[tokio::test]
async fn explicit_read_only_policy_fails_closed_for_mutating_command() {
    let temp = tempfile::tempdir().expect("tempdir");
    let mut params = exec_params(None, "touch command-exec-must-not-exist");
    params.cwd = Some(temp.path().to_path_buf());
    params.sandbox_policy = Some(app_server_protocol::protocol::v2::SandboxPolicy::ReadOnly {
        network_access: false,
    });

    let result = CommandExecServer::default()
        .exec(ConnectionId(10), params, None)
        .await;

    match result {
        Ok(response) => assert_ne!(
            response.exit_code, 0,
            "read-only OS sandbox must deny writes"
        ),
        Err(error) => assert_eq!(error.code, error_codes::RUNTIME_ERROR),
    }
    assert!(!temp.path().join("command-exec-must-not-exist").exists());
}

#[cfg(target_os = "macos")]
#[tokio::test]
async fn memory_workspace_policy_reaches_the_real_process() {
    use app_server_protocol::protocol::v2::SandboxPolicy;
    let root = tempfile::tempdir().unwrap();
    let memory = root.path().join("memory root");
    let extra = root.path().join("extra \"scope\"");
    let sibling = root.path().join("sibling");
    let slash_tmp = tempfile::tempdir_in("/tmp").unwrap();
    let git = extra.join(".git");
    for dir in [&memory, &extra, &sibling] {
        std::fs::create_dir(dir).unwrap();
    }
    std::fs::create_dir(&git).unwrap();
    let policy = SandboxPolicy::WorkspaceWrite {
        writable_roots: vec![extra.clone().try_into().unwrap()],
        network_access: false,
        exclude_tmpdir_env_var: true,
        exclude_slash_tmp: true,
    };
    let server = CommandExecServer::default();
    for (index, (directory, allowed)) in [
        (memory.as_path(), true),
        (extra.as_path(), true),
        (sibling.as_path(), false),
        (slash_tmp.path(), false),
        (git.as_path(), false),
    ]
    .into_iter()
    .enumerate()
    {
        let target = directory.join("output");
        let mut params = exec_params(None, "printf scoped > \"$TARGET\"");
        params.cwd = Some(memory.clone());
        params.env = Some(HashMap::from([(
            "TARGET".to_string(),
            Some(target.to_string_lossy().into_owned()),
        )]));
        params.sandbox_policy = Some(policy.clone());
        let response = server
            .exec(ConnectionId(30 + index as u64), params, None)
            .await
            .unwrap();
        assert_eq!(response.exit_code == 0, allowed, "{response:?}");
        assert_eq!(target.exists(), allowed);
    }
    // Read-only must not retain the historical unconditional temporary write grants.
    let target = sibling.join("read-only-output");
    let mut params = exec_params(None, "printf denied > \"$TARGET\"");
    params.cwd = Some(memory);
    params.env = Some(HashMap::from([(
        "TARGET".to_string(),
        Some(target.to_string_lossy().into_owned()),
    )]));
    params.sandbox_policy = Some(SandboxPolicy::ReadOnly {
        network_access: false,
    });
    let response = server.exec(ConnectionId(34), params, None).await.unwrap();
    assert_ne!(response.exit_code, 0);
    assert!(!target.exists());
}

#[cfg(target_os = "macos")]
#[tokio::test]
async fn command_policy_network_switch_reaches_the_real_process() {
    use app_server_protocol::protocol::v2::SandboxPolicy;
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    for network_access in [false, true] {
        let mut params = exec_params(None, &format!("/usr/bin/nc -z -w 1 127.0.0.1 {port}"));
        params.sandbox_policy = Some(SandboxPolicy::ReadOnly { network_access });
        let response = CommandExecServer::default()
            .exec(ConnectionId(35), params, None)
            .await
            .unwrap();
        assert_eq!(response.exit_code == 0, network_access, "{response:?}");
    }
}

#[cfg(unix)]
#[tokio::test]
async fn streaming_command_emits_output_before_the_final_response() {
    let (server, mut notifications) = server_with_notifications();
    let connection_id = ConnectionId(2);
    let mut params = exec_params(Some("streaming"), "printf streamed");
    params.stream_stdout_stderr = true;
    let task = tokio::spawn({
        let server = server.clone();
        async move { server.exec(connection_id, params, None).await }
    });

    let (actual_connection, notification) =
        tokio::time::timeout(std::time::Duration::from_secs(2), notifications.recv())
            .await
            .expect("output timeout")
            .expect("output notification");
    assert_eq!(actual_connection, connection_id);
    let ServerNotification::CommandExecOutputDelta(delta) =
        ServerNotification::try_from(notification).expect("typed notification")
    else {
        panic!("expected command/exec/outputDelta notification");
    };
    assert_eq!(delta.process_id, "streaming");
    assert_eq!(delta.stream, CommandExecOutputStream::Stdout);
    assert_eq!(
        STANDARD.decode(delta.delta_base64).expect("base64"),
        b"streamed"
    );
    assert!(!delta.cap_reached);

    let response = task.await.expect("command task").expect("command response");
    assert_eq!(response.exit_code, 0);
    assert!(response.stdout.is_empty());
    assert!(response.stderr.is_empty());
}

#[cfg(unix)]
#[tokio::test]
async fn stdin_write_and_close_are_connection_scoped_and_fail_closed() {
    let server = CommandExecServer::default();
    let connection_id = ConnectionId(3);
    let mut params = exec_params(Some("stdin"), "cat");
    params.stream_stdin = true;
    let task = tokio::spawn({
        let server = server.clone();
        async move { server.exec(connection_id, params, None).await }
    });
    wait_for_session(&server, connection_id, "stdin").await;

    let foreign = server
        .write(
            ConnectionId(4),
            CommandExecWriteParams {
                process_id: "stdin".to_string(),
                delta_base64: Some(STANDARD.encode(b"foreign")),
                close_stdin: false,
            },
        )
        .await
        .expect_err("other connections must not access the session");
    assert_eq!(foreign.code, error_codes::INVALID_REQUEST);

    server
        .write(
            connection_id,
            CommandExecWriteParams {
                process_id: "stdin".to_string(),
                delta_base64: Some(STANDARD.encode(b"hello")),
                close_stdin: true,
            },
        )
        .await
        .expect("write and close stdin");
    let closed = server
        .write(
            connection_id,
            CommandExecWriteParams {
                process_id: "stdin".to_string(),
                delta_base64: Some(STANDARD.encode(b"late")),
                close_stdin: false,
            },
        )
        .await
        .expect_err("writes after close must fail");
    assert_eq!(closed.code, error_codes::INVALID_REQUEST);

    let response = task.await.expect("command task").expect("command response");
    assert_eq!(response.stdout, "hello");
}

#[cfg(unix)]
#[tokio::test]
async fn tty_resize_and_terminate_control_the_active_process() {
    let server = CommandExecServer::default();
    let connection_id = ConnectionId(5);
    let mut params = exec_params(Some("pty"), "sleep 10");
    params.tty = true;
    params.disable_timeout = true;
    params.timeout_ms = None;
    params.size = Some(CommandExecTerminalSize { rows: 24, cols: 80 });
    let task = tokio::spawn({
        let server = server.clone();
        async move { server.exec(connection_id, params, None).await }
    });
    wait_for_session(&server, connection_id, "pty").await;

    server
        .resize(
            connection_id,
            CommandExecResizeParams {
                process_id: "pty".to_string(),
                size: CommandExecTerminalSize {
                    rows: 40,
                    cols: 120,
                },
            },
        )
        .await
        .expect("resize pty");
    server
        .terminate(
            connection_id,
            CommandExecTerminateParams {
                process_id: "pty".to_string(),
            },
        )
        .await
        .expect("terminate pty");

    tokio::time::timeout(std::time::Duration::from_secs(2), task)
        .await
        .expect("terminated command timeout")
        .expect("command task")
        .expect("command response");
}

#[cfg(unix)]
#[tokio::test]
async fn duplicate_process_ids_fail_only_within_the_same_connection() {
    let server = CommandExecServer::default();
    let connection_id = ConnectionId(6);
    let mut first_params = exec_params(Some("shared"), "sleep 10");
    first_params.disable_timeout = true;
    first_params.timeout_ms = None;
    let first = tokio::spawn({
        let server = server.clone();
        async move { server.exec(connection_id, first_params, None).await }
    });
    wait_for_session(&server, connection_id, "shared").await;

    let duplicate = server
        .exec(
            connection_id,
            exec_params(Some("shared"), "printf duplicate"),
            None,
        )
        .await
        .expect_err("same-connection duplicate must fail");
    assert_eq!(duplicate.code, error_codes::INVALID_REQUEST);

    let other_connection = ConnectionId(7);
    let other = server
        .exec(
            other_connection,
            exec_params(Some("shared"), "printf other"),
            None,
        )
        .await
        .expect("other connection may reuse process id");
    assert_eq!(other.stdout, "other");

    server.connection_closed(connection_id).await;
    tokio::time::timeout(std::time::Duration::from_secs(2), first)
        .await
        .expect("connection cleanup timeout")
        .expect("command task")
        .expect("command response");
}

#[cfg(unix)]
#[tokio::test]
async fn output_cap_and_timeout_apply_to_one_off_commands() {
    let server = CommandExecServer::default();
    let mut capped = exec_params(None, "printf 12345");
    capped.output_bytes_cap = Some(3);
    let response = server
        .exec(ConnectionId(8), capped, None)
        .await
        .expect("capped command");
    assert_eq!(response.stdout, "123");

    let mut timed = exec_params(None, "sleep 10");
    timed.timeout_ms = Some(20);
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        server.exec(ConnectionId(8), timed, None),
    )
    .await
    .expect("timeout enforcement")
    .expect("timeout response");
    assert_eq!(response.exit_code, COMMAND_EXEC_TIMEOUT_EXIT_CODE);
}

#[cfg(windows)]
#[tokio::test]
async fn windows_timeout_returns_canonical_exit_code() {
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        CommandExecServer::default().exec(
            ConnectionId(9),
            windows_exec_params("Start-Sleep -Seconds 1"),
            None,
        ),
    )
    .await
    .expect("Windows timeout enforcement should finish")
    .expect("Windows timeout response");

    assert_eq!(response.exit_code, COMMAND_EXEC_TIMEOUT_EXIT_CODE);
}
