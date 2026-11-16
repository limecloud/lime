use std::collections::HashMap;

use exec_server::ExecBackend;
use exec_server::ExecParams;
use exec_server::LocalProcess;
use exec_server::ProcessId;
use lime_utils_path_uri::PathUri;

#[tokio::test]
async fn local_process_starts_and_returns_output() {
    let cwd = PathUri::from_host_native_path(std::env::current_dir().expect("cwd")).expect("cwd");
    let backend = LocalProcess::local();
    let started = backend
        .start(ExecParams {
            metadata: None,
            process_id: ProcessId::from("public-local-process"),
            argv: vec![
                "/bin/sh".to_string(),
                "-c".to_string(),
                "printf lime-public".to_string(),
            ],
            cwd,
            env_policy: None,
            shell_snapshot: None,
            env: HashMap::new(),
            tty: false,
            pipe_stdin: false,
            arg0: None,
            sandbox: None,
            enforce_managed_network: false,
            managed_network: None,
            network_proxy: None,
        })
        .await
        .expect("start local process");

    let response = started
        .process
        .read(None, None, Some(5_000))
        .await
        .expect("read output");
    let output = response
        .chunks
        .iter()
        .flat_map(|chunk| chunk.chunk.as_ref().iter().copied())
        .collect::<Vec<_>>();
    let text = String::from_utf8_lossy(&output);
    assert!(text.contains("lime-public"), "unexpected output: {text}");
    started.process.terminate().await.expect("terminate");
}

fn params(process_id: &str, argv: Vec<String>, tty: bool, pipe_stdin: bool) -> ExecParams {
    ExecParams {
        metadata: None,
        process_id: ProcessId::from(process_id),
        argv,
        cwd: PathUri::from_host_native_path(std::env::current_dir().expect("cwd")).expect("cwd"),
        env_policy: None,
        shell_snapshot: None,
        env: HashMap::new(),
        tty,
        pipe_stdin,
        arg0: None,
        sandbox: None,
        enforce_managed_network: false,
        managed_network: None,
        network_proxy: None,
    }
}

async fn read_until(process: &dyn exec_server::ExecProcess, needle: &str) -> String {
    let mut text = String::new();
    for _ in 0..50 {
        let response = process
            .read(None, None, Some(2_000))
            .await
            .expect("read output");
        for chunk in response.chunks {
            text.push_str(&String::from_utf8_lossy(chunk.chunk.as_ref()));
        }
        if text.contains(needle) {
            return text;
        }
    }
    panic!("did not observe {needle:?} in {text:?}");
}

#[tokio::test]
async fn local_process_pipe_stdin_round_trip() {
    let backend = LocalProcess::local();
    let started = backend
        .start(params(
            "public-pipe-stdin",
            vec!["/bin/cat".to_string()],
            false,
            true,
        ))
        .await
        .expect("start");
    started
        .process
        .write(b"lime-pipe\n".to_vec())
        .await
        .expect("write stdin");
    let text = read_until(started.process.as_ref(), "lime-pipe").await;
    assert!(text.contains("lime-pipe"), "unexpected output: {text}");
    started.process.terminate().await.expect("terminate");
}

#[tokio::test]
async fn local_process_pty_round_trip() {
    let backend = LocalProcess::local();
    let started = backend
        .start(params(
            "public-pty",
            vec!["/bin/cat".to_string()],
            true,
            false,
        ))
        .await
        .expect("start pty");
    started
        .process
        .write(b"lime-pty\n".to_vec())
        .await
        .expect("write pty");
    let text = read_until(started.process.as_ref(), "lime-pty").await;
    assert!(text.contains("lime-pty"), "unexpected output: {text}");
    started.process.terminate().await.expect("terminate");
}
