//! Bridge from `exec_server::LocalProcess` events to Lime's process handle.

use std::collections::HashMap;
use std::io;
use std::time::Instant;

use exec_server::ExecBackend;
use exec_server::ExecParams;
use exec_server::ExecProcessEvent;
use exec_server::ExecServerRuntimeOptions;
use exec_server::LocalProcess;
use exec_server::ProcessId;
use lime_utils_path_uri::PathUri;
use tokio::sync::{broadcast, mpsc, oneshot, watch};

use super::ExecutionOutputDelta;
use super::ExecutionOutputKind;
use super::ExecutionProcessSnapshot;
use super::ExecutionProcessStatus;
use super::LocalExecutionControl;
use super::LocalExecutionControlSender;
use super::LocalExecutionProcessHandle;
use super::LocalExecutionRequest;
use super::PROCESS_OUTPUT_CHANNEL_CAPACITY;

pub(super) fn start(request: LocalExecutionRequest) -> io::Result<LocalExecutionProcessHandle> {
    if request
        .sandbox
        .as_ref()
        .is_some_and(|sandbox| sandbox.backend == super::SandboxBackend::RestrictedToken)
        && !cfg!(target_os = "windows")
    {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "restricted token sandbox is only available on Windows",
        ));
    }
    let runtime_paths = ExecServerRuntimeOptions::new(std::env::current_exe()?, None)?;
    let process_id = request.process_id.clone();
    let initial = snapshot(
        &request,
        ExecutionProcessStatus::Running,
        None,
        &super::output_buffer::BoundedProcessOutput::default().snapshot(),
    );
    let (output_tx, output_rx) = broadcast::channel(PROCESS_OUTPUT_CHANNEL_CAPACITY);
    let (state_tx, state_rx) = watch::channel(initial);
    let (final_tx, final_rx) = oneshot::channel();
    let (control_tx, control_rx) = mpsc::unbounded_channel();

    std::thread::Builder::new()
        .name(format!("exec-server-{process_id}"))
        .spawn(move || {
            let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            else {
                return;
            };
            runtime.block_on(run(
                request,
                runtime_paths,
                control_rx,
                output_tx,
                state_tx,
                final_tx,
            ));
        })?;

    Ok(LocalExecutionProcessHandle {
        process_id,
        control_tx: LocalExecutionControlSender::Async(control_tx),
        output_rx,
        state_rx,
        final_rx: Some(final_rx),
        final_snapshot: None,
    })
}

async fn run(
    request: LocalExecutionRequest,
    runtime_paths: ExecServerRuntimeOptions,
    mut control_rx: mpsc::UnboundedReceiver<LocalExecutionControl>,
    output_tx: broadcast::Sender<ExecutionOutputDelta>,
    state_tx: watch::Sender<ExecutionProcessSnapshot>,
    final_tx: oneshot::Sender<ExecutionProcessSnapshot>,
) {
    let start = Instant::now();
    let cwd = request
        .cwd
        .clone()
        .or_else(|| std::env::current_dir().ok())
        .and_then(|path| PathUri::from_host_native_path(path).ok());
    let Some(cwd) = cwd else {
        let failed = snapshot(
            &request,
            ExecutionProcessStatus::Failed,
            None,
            &super::output_buffer::BoundedProcessOutput::default().snapshot(),
        );
        let _ = state_tx.send(failed.clone());
        let _ = final_tx.send(failed);
        return;
    };
    let sandbox = request.sandbox.as_ref().map(|sandbox| {
        let policy = protocol_sandbox_policy(&sandbox.policy);
        let profile = protocol::models::PermissionProfile::from_legacy_sandbox_policy_for_cwd(
            &policy,
            &cwd.to_path_buf(),
        );
        file_system::FileSystemSandboxContext::from_permission_profile(profile, cwd.clone())
    });
    let params = ExecParams {
        metadata: Some(exec_server::ExecMetadata {
            thread_id: None,
            tool_call_id: Some(request.tool_id.clone()),
        }),
        process_id: ProcessId::from(request.process_id.clone()),
        argv: request.command.clone(),
        cwd,
        env_policy: None,
        shell_snapshot: None,
        env: request.env.clone(),
        tty: request.tty,
        pipe_stdin: request.stdin,
        arg0: None,
        sandbox,
        enforce_managed_network: false,
        managed_network: None,
        network_proxy: None,
    };
    let backend = LocalProcess::with_local_runtime_paths(runtime_paths);
    let started = match backend.start(params).await {
        Ok(started) => started,
        Err(error) => {
            let failed = snapshot(
                &request,
                ExecutionProcessStatus::Failed,
                None,
                &super::output_buffer::BoundedProcessOutput::default().snapshot(),
            );
            let mut failed = failed;
            failed.failure = Some(error.to_string());
            let _ = state_tx.send(failed.clone());
            let _ = final_tx.send(failed);
            return;
        }
    };
    let process = started.process;
    let mut events = process.subscribe_events();
    let mut sequence = 0u64;
    let mut output = super::output_buffer::BoundedProcessOutput::default();
    let mut exit_code = None;
    let mut status = ExecutionProcessStatus::Running;
    let mut finished = false;

    loop {
        tokio::select! {
            control = control_rx.recv() => {
                match control {
                    Some(LocalExecutionControl::WriteStdin(bytes)) => {
                        let _ = process.write(bytes).await;
                    }
                    Some(LocalExecutionControl::Terminate) => {
                        let _ = process.terminate().await;
                        status = ExecutionProcessStatus::Terminated;
                    }
                    Some(LocalExecutionControl::Interrupt) => {
                        let _ = process.signal(exec_server::ProcessSignal::Interrupt).await;
                        status = ExecutionProcessStatus::Interrupted;
                    }
                    Some(LocalExecutionControl::CloseStdin) => {
                        let _ = process.close_stdin().await;
                    }
                    Some(LocalExecutionControl::Resize { .. })
                    | None => {}
                }
            }
            event = events.recv() => {
                match event {
                    Ok(ExecProcessEvent::Output(chunk)) => {
                        let raw = chunk.chunk.as_ref().clone();
                        output.push(&raw);
                        let text = String::from_utf8_lossy(&raw).into_owned();
                        sequence += 1;
                        let kind = match chunk.stream {
                            exec_server::ExecOutputStream::Stdout => ExecutionOutputKind::Stdout,
                            exec_server::ExecOutputStream::Stderr => ExecutionOutputKind::Stderr,
                            exec_server::ExecOutputStream::Pty => ExecutionOutputKind::Combined,
                        };
                        let delta = ExecutionOutputDelta {
                            process_id: request.process_id.clone(),
                            tool_id: request.tool_id.clone(),
                            sequence,
                            kind,
                            delta: text,
                            bytes: raw.len() as u64,
                            omitted_bytes: 0,
                            truncated: false,
                            raw_bytes: raw.to_vec(),
                        };
                        let _ = output_tx.send(delta);
                    }
                    Ok(ExecProcessEvent::Exited { exit_code: code, .. }) => {
                        exit_code = Some(code);
                        if !matches!(
                            status,
                            ExecutionProcessStatus::Terminated | ExecutionProcessStatus::Interrupted
                        ) {
                            status = ExecutionProcessStatus::Exited;
                        }
                    }
                    Ok(ExecProcessEvent::Failed(message)) => {
                        status = ExecutionProcessStatus::Failed;
                        let mut failed = snapshot(&request, status, exit_code, &output.snapshot());
                        failed.failure = Some(message);
                        let _ = state_tx.send(failed.clone());
                        let _ = final_tx.send(failed);
                        return;
                    }
                    Ok(ExecProcessEvent::Closed { .. }) | Err(_) => {
                        finished = true;
                    }
                }
            }
        }

        if finished {
            break;
        }

        let current = snapshot(&request, status, exit_code, &output.snapshot());
        let _ = state_tx.send(current);
    }

    let final_snapshot = snapshot(&request, status, exit_code, &output.snapshot());
    let _ = state_tx.send(final_snapshot.clone());
    let _ = final_tx.send(final_snapshot);
    let _ = start.elapsed();
}

fn protocol_sandbox_policy(
    policy: &app_server_protocol::protocol::v2::SandboxPolicy,
) -> protocol::protocol::SandboxPolicy {
    match policy {
        app_server_protocol::protocol::v2::SandboxPolicy::DangerFullAccess => {
            protocol::protocol::SandboxPolicy::DangerFullAccess
        }
        app_server_protocol::protocol::v2::SandboxPolicy::ReadOnly { network_access } => {
            protocol::protocol::SandboxPolicy::ReadOnly {
                network_access: *network_access,
            }
        }
        app_server_protocol::protocol::v2::SandboxPolicy::ExternalSandbox { network_access } => {
            protocol::protocol::SandboxPolicy::ExternalSandbox {
                network_access: match network_access {
                    app_server_protocol::protocol::v2::NetworkAccess::Restricted => {
                        protocol::protocol::NetworkAccess::Restricted
                    }
                    app_server_protocol::protocol::v2::NetworkAccess::Enabled => {
                        protocol::protocol::NetworkAccess::Enabled
                    }
                },
            }
        }
        app_server_protocol::protocol::v2::SandboxPolicy::WorkspaceWrite {
            writable_roots,
            network_access,
            exclude_tmpdir_env_var,
            exclude_slash_tmp,
        } => protocol::protocol::SandboxPolicy::WorkspaceWrite {
            writable_roots: writable_roots
                .iter()
                .filter_map(|root| {
                    lime_utils_absolute_path::AbsolutePathBuf::try_from(std::path::PathBuf::from(
                        root.clone(),
                    ))
                    .ok()
                })
                .collect(),
            network_access: *network_access,
            exclude_tmpdir_env_var: *exclude_tmpdir_env_var,
            exclude_slash_tmp: *exclude_slash_tmp,
        },
    }
}

fn snapshot(
    request: &LocalExecutionRequest,
    status: ExecutionProcessStatus,
    exit_code: Option<i32>,
    output: &super::output_buffer::BoundedProcessOutputSnapshot,
) -> ExecutionProcessSnapshot {
    ExecutionProcessSnapshot {
        process_id: request.process_id.clone(),
        tool_id: request.tool_id.clone(),
        tool_name: request.tool_name.clone(),
        status,
        exit_code,
        elapsed_ms: 0,
        output_bytes: output.bytes,
        output_omitted_bytes: output.omitted_bytes,
        output_truncated: output.truncated,
        retained_output: output.text.clone(),
        failure: None,
    }
}
