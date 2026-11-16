use crate::sandbox::{SandboxBackend, WindowsSandboxExecutionMode};
use app_server_protocol::protocol::v2::GrantedPermissionProfile;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::io;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{Mutex, broadcast, mpsc, oneshot, watch};
use tokio::task::JoinHandle;

mod environment;
mod exec_server_bridge;
pub mod live;
mod output_buffer;
#[cfg(target_os = "windows")]
mod windows;
// The ACL plan is pure path computation; only Windows applies it.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
mod windows_acl_plan;

/// Runs the Windows sandbox-account command runner sidecar.
///
/// The executable is packaged beside App Server, while all protocol and child
/// execution semantics remain owned by this module.
#[cfg(target_os = "windows")]
pub fn run_windows_sandbox_runner() -> io::Result<()> {
    windows::run_windows_sandbox_runner()
}

#[cfg(not(target_os = "windows"))]
pub fn run_windows_sandbox_runner() -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "Windows sandbox runner is only available on Windows",
    ))
}

/// Checks that the current process can create the restricted-token backend.
///
/// This is the Codex unelevated setup preflight. It intentionally does not
/// provision sandbox accounts or claim elevated setup artifacts.
#[cfg(target_os = "windows")]
pub fn verify_windows_restricted_token_backend() -> io::Result<()> {
    windows::verify_windows_restricted_token_backend()
}

#[cfg(not(target_os = "windows"))]
pub fn verify_windows_restricted_token_backend() -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "Windows restricted-token preflight is only available on Windows",
    ))
}

#[cfg(target_os = "windows")]
pub fn windows_restricted_token_backend_available() -> bool {
    verify_windows_restricted_token_backend().is_ok()
}

#[cfg(not(target_os = "windows"))]
pub fn windows_restricted_token_backend_available() -> bool {
    false
}

/// Bounded Windows ACL audit result used by the App Server setup warning.
///
/// The audit is intentionally a diagnostic only. It never changes ACLs and it
/// must not be used as proof that the restricted-token backend is enforced.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsWorldWritableAudit {
    pub sample_paths: Vec<String>,
    pub extra_count: usize,
    pub failed_scan: bool,
}

impl WindowsWorldWritableAudit {
    pub fn clean() -> Self {
        Self {
            sample_paths: Vec::new(),
            extra_count: 0,
            failed_scan: false,
        }
    }
}

/// Audits the current Windows workspace for paths with an Everyone write ACE.
///
/// Non-Windows builds return a clean result and do not execute any platform
/// command. The Windows implementation is bounded and skips reparse points.
#[cfg(target_os = "windows")]
pub fn audit_windows_world_writable(
    cwd: &std::path::Path,
    environment: &std::collections::HashMap<String, String>,
) -> WindowsWorldWritableAudit {
    windows::audit_world_writable(cwd, environment)
}

#[cfg(not(target_os = "windows"))]
pub fn audit_windows_world_writable(
    _cwd: &std::path::Path,
    _environment: &std::collections::HashMap<String, String>,
) -> WindowsWorldWritableAudit {
    WindowsWorldWritableAudit::clean()
}

use environment::resolve_child_environment;
pub use output_buffer::{BoundedProcessOutput, BoundedProcessOutputSnapshot, ProcessOutputFramers};

pub const DEFAULT_OUTPUT_RETAIN_BYTES: usize = 1024 * 1024;
const PROCESS_OUTPUT_CHUNK_BYTES: usize = 8 * 1024;
const PROCESS_OUTPUT_CHANNEL_CAPACITY: usize = 64;
pub(crate) const TRAILING_OUTPUT_GRACE: Duration = Duration::from_millis(100);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionProcessStatus {
    Starting,
    Running,
    Exited,
    Interrupted,
    Terminated,
    Failed,
}

impl ExecutionProcessStatus {
    pub fn label(self) -> &'static str {
        match self {
            Self::Starting => "starting",
            Self::Running => "running",
            Self::Exited => "exited",
            Self::Interrupted => "interrupted",
            Self::Terminated => "terminated",
            Self::Failed => "failed",
        }
    }

    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Exited | Self::Interrupted | Self::Terminated | Self::Failed
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionOutputKind {
    Stdout,
    Stderr,
    Combined,
}

impl ExecutionOutputKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::Stdout => "stdout",
            Self::Stderr => "stderr",
            Self::Combined => "combined",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionOutputDelta {
    pub process_id: String,
    pub tool_id: String,
    pub sequence: u64,
    pub kind: ExecutionOutputKind,
    pub delta: String,
    pub bytes: u64,
    pub omitted_bytes: u64,
    pub truncated: bool,
    #[serde(skip)]
    pub raw_bytes: Vec<u8>,
}

impl ExecutionOutputDelta {
    pub fn metadata(&self) -> HashMap<String, Value> {
        HashMap::from([
            ("processId".to_string(), json!(self.process_id)),
            ("outputSequence".to_string(), json!(self.sequence)),
            ("outputKind".to_string(), json!(self.kind.label())),
            ("outputBytes".to_string(), json!(self.bytes)),
            ("outputOmittedBytes".to_string(), json!(self.omitted_bytes)),
            ("outputTruncated".to_string(), json!(self.truncated)),
            (
                "executionProcessStatus".to_string(),
                json!(ExecutionProcessStatus::Running.label()),
            ),
            ("stdinWritable".to_string(), json!(true)),
            ("stdin_writable".to_string(), json!(true)),
        ])
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionProcessSnapshot {
    pub process_id: String,
    pub tool_id: String,
    pub tool_name: String,
    pub status: ExecutionProcessStatus,
    pub exit_code: Option<i32>,
    pub elapsed_ms: u64,
    pub output_bytes: u64,
    pub output_omitted_bytes: u64,
    pub output_truncated: bool,
    pub retained_output: String,
    pub failure: Option<String>,
}

impl ExecutionProcessSnapshot {
    pub fn metadata(&self) -> HashMap<String, Value> {
        HashMap::from([
            ("processId".to_string(), json!(self.process_id)),
            (
                "executionProcessStatus".to_string(),
                json!(self.status.label()),
            ),
            (
                "executionProcessElapsedMs".to_string(),
                json!(self.elapsed_ms),
            ),
            ("outputBytes".to_string(), json!(self.output_bytes)),
            (
                "outputOmittedBytes".to_string(),
                json!(self.output_omitted_bytes),
            ),
            ("outputTruncated".to_string(), json!(self.output_truncated)),
            ("exitCode".to_string(), json!(self.exit_code)),
            ("exit_code".to_string(), json!(self.exit_code)),
            (
                "stdinWritable".to_string(),
                json!(!self.status.is_terminal()),
            ),
            (
                "stdin_writable".to_string(),
                json!(!self.status.is_terminal()),
            ),
        ])
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutionProcessStart {
    pub process_id: String,
    pub tool_id: String,
    pub tool_name: String,
    pub command: Option<String>,
    pub cwd: Option<String>,
}

impl ExecutionProcessStart {
    pub fn metadata(&self) -> HashMap<String, Value> {
        let mut metadata = HashMap::from([
            ("processId".to_string(), json!(self.process_id)),
            (
                "executionProcessStatus".to_string(),
                json!(ExecutionProcessStatus::Running.label()),
            ),
            ("stdinWritable".to_string(), json!(true)),
            ("stdin_writable".to_string(), json!(true)),
        ]);
        if let Some(command) = &self.command {
            metadata.insert("command".to_string(), json!(command));
        }
        if let Some(cwd) = &self.cwd {
            metadata.insert("cwd".to_string(), json!(cwd));
        }
        metadata
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutionProcess {
    process_id: String,
    tool_id: String,
    tool_name: String,
    command: Option<String>,
    cwd: Option<String>,
    status: ExecutionProcessStatus,
    exit_code: Option<i32>,
    failure: Option<String>,
    started_at: Instant,
    output: BoundedProcessOutput,
    output_framers: ProcessOutputFramers,
    sequence: u64,
}

impl ExecutionProcess {
    pub fn start(start: ExecutionProcessStart) -> Self {
        Self {
            process_id: start.process_id,
            tool_id: start.tool_id,
            tool_name: start.tool_name,
            command: start.command,
            cwd: start.cwd,
            status: ExecutionProcessStatus::Running,
            exit_code: None,
            failure: None,
            started_at: Instant::now(),
            output: BoundedProcessOutput::new(DEFAULT_OUTPUT_RETAIN_BYTES),
            output_framers: ProcessOutputFramers::default(),
            sequence: 0,
        }
    }

    pub fn process_id(&self) -> &str {
        &self.process_id
    }

    pub fn tool_id(&self) -> &str {
        &self.tool_id
    }

    pub fn status(&self) -> ExecutionProcessStatus {
        self.status
    }

    pub fn append_output(
        &mut self,
        kind: ExecutionOutputKind,
        bytes: &[u8],
    ) -> Option<ExecutionOutputDelta> {
        self.output.push(bytes);
        let frame = self.output_framers.push(kind, bytes);
        self.output_delta(kind, frame)
    }

    pub fn finish_output(&mut self, kind: ExecutionOutputKind) -> Option<ExecutionOutputDelta> {
        let frame = self.output_framers.finish(kind);
        self.output_delta(kind, frame)
    }

    pub fn finish_all_output(&mut self) -> Vec<ExecutionOutputDelta> {
        let frames = self.output_framers.finish_all();
        frames
            .into_iter()
            .filter_map(|(kind, frame)| self.output_delta(kind, frame))
            .collect()
    }

    fn output_delta(
        &mut self,
        kind: ExecutionOutputKind,
        frame: Vec<u8>,
    ) -> Option<ExecutionOutputDelta> {
        if frame.is_empty() {
            return None;
        }
        self.sequence = self.sequence.saturating_add(1);
        let snapshot = self.output.snapshot();
        Some(ExecutionOutputDelta {
            process_id: self.process_id.clone(),
            tool_id: self.tool_id.clone(),
            sequence: self.sequence,
            kind,
            delta: String::from_utf8_lossy(&frame).into_owned(),
            bytes: snapshot.bytes,
            omitted_bytes: snapshot.omitted_bytes,
            truncated: snapshot.truncated,
            raw_bytes: frame,
        })
    }

    pub fn interrupt(&mut self) {
        if !self.status.is_terminal() {
            self.status = ExecutionProcessStatus::Interrupted;
        }
    }

    pub fn terminate(&mut self) {
        if !self.status.is_terminal() {
            self.status = ExecutionProcessStatus::Terminated;
        }
    }

    pub fn fail(&mut self, message: impl Into<String>) {
        if !self.status.is_terminal() {
            self.status = ExecutionProcessStatus::Failed;
            self.failure = Some(message.into());
        }
    }

    pub fn exit(&mut self, exit_code: i32) {
        if !self.status.is_terminal() {
            self.status = ExecutionProcessStatus::Exited;
            self.exit_code = Some(exit_code);
        }
    }

    pub fn snapshot(&self) -> ExecutionProcessSnapshot {
        let output = self.output.snapshot();
        ExecutionProcessSnapshot {
            process_id: self.process_id.clone(),
            tool_id: self.tool_id.clone(),
            tool_name: self.tool_name.clone(),
            status: self.status,
            exit_code: self.exit_code,
            elapsed_ms: duration_millis(self.started_at.elapsed()),
            output_bytes: output.bytes,
            output_omitted_bytes: output.omitted_bytes,
            output_truncated: output.truncated,
            retained_output: output.text,
            failure: self.failure.clone(),
        }
    }
}

#[derive(Debug, Default)]
pub struct ExecutionProcessManager {
    processes: HashMap<String, ExecutionProcess>,
}

impl ExecutionProcessManager {
    pub fn start(&mut self, start: ExecutionProcessStart) -> ExecutionProcessSnapshot {
        let process_id = start.process_id.clone();
        let process = ExecutionProcess::start(start);
        let snapshot = process.snapshot();
        self.processes.insert(process_id, process);
        snapshot
    }

    pub fn append_output(
        &mut self,
        process_id: &str,
        kind: ExecutionOutputKind,
        bytes: &[u8],
    ) -> Option<ExecutionOutputDelta> {
        self.processes
            .get_mut(process_id)
            .and_then(|process| process.append_output(kind, bytes))
    }

    pub fn interrupt(&mut self, process_id: &str) -> Option<ExecutionProcessSnapshot> {
        let process = self.processes.get_mut(process_id)?;
        process.interrupt();
        Some(process.snapshot())
    }

    pub fn terminate(&mut self, process_id: &str) -> Option<ExecutionProcessSnapshot> {
        let process = self.processes.get_mut(process_id)?;
        process.terminate();
        Some(process.snapshot())
    }

    pub fn exit(&mut self, process_id: &str, exit_code: i32) -> Option<ExecutionProcessSnapshot> {
        let process = self.processes.get_mut(process_id)?;
        process.exit(exit_code);
        Some(process.snapshot())
    }

    pub fn fail(
        &mut self,
        process_id: &str,
        message: impl Into<String>,
    ) -> Option<ExecutionProcessSnapshot> {
        let process = self.processes.get_mut(process_id)?;
        process.fail(message);
        Some(process.snapshot())
    }

    pub fn snapshot(&self, process_id: &str) -> Option<ExecutionProcessSnapshot> {
        self.processes
            .get(process_id)
            .map(ExecutionProcess::snapshot)
    }

    pub fn remove(&mut self, process_id: &str) -> Option<ExecutionProcessSnapshot> {
        self.processes
            .remove(process_id)
            .map(|process| process.snapshot())
    }

    pub fn len(&self) -> usize {
        self.processes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.processes.is_empty()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalExecutionSandbox {
    pub backend: SandboxBackend,
    pub policy: app_server_protocol::protocol::v2::SandboxPolicy,
    pub granted_permissions: Option<GrantedPermissionProfile>,
    pub windows_mode: Option<WindowsSandboxExecutionMode>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalExecutionRequest {
    pub process_id: String,
    pub tool_id: String,
    pub tool_name: String,
    pub command: Vec<String>,
    pub cwd: Option<PathBuf>,
    pub env: HashMap<String, String>,
    pub tty: bool,
    pub stdin: bool,
    pub env_clear: bool,
    pub pty_size: Option<(u16, u16)>,
    pub sandbox: Option<LocalExecutionSandbox>,
}

impl LocalExecutionRequest {
    pub fn new(
        process_id: impl Into<String>,
        tool_id: impl Into<String>,
        tool_name: impl Into<String>,
        command: Vec<String>,
    ) -> Self {
        Self {
            process_id: process_id.into(),
            tool_id: tool_id.into(),
            tool_name: tool_name.into(),
            command,
            cwd: None,
            env: HashMap::new(),
            tty: false,
            stdin: true,
            env_clear: false,
            pty_size: None,
            sandbox: None,
        }
    }
}

pub trait LiveExecutionProcessRegistry: Send + Sync {
    fn register_live_process(
        &self,
        handle: LocalExecutionProcessControlHandle,
        snapshot: ExecutionProcessSnapshot,
    ) -> Result<(), String>;

    fn record_live_process_output(&self, delta: ExecutionOutputDelta) -> Result<(), String>;

    fn finish_live_process(&self, snapshot: ExecutionProcessSnapshot) -> Result<(), String>;
}

#[derive(Debug)]
pub struct LocalExecutionProcessHandle {
    process_id: String,
    control_tx: LocalExecutionControlSender,
    output_rx: broadcast::Receiver<ExecutionOutputDelta>,
    state_rx: watch::Receiver<ExecutionProcessSnapshot>,
    final_rx: Option<oneshot::Receiver<ExecutionProcessSnapshot>>,
    final_snapshot: Option<ExecutionProcessSnapshot>,
}

#[derive(Debug, Clone)]
pub struct LocalExecutionProcessControlHandle {
    process_id: String,
    control_tx: LocalExecutionControlSender,
    state_rx: watch::Receiver<ExecutionProcessSnapshot>,
}

#[derive(Debug)]
pub enum LocalExecutionProcessEvent {
    Output(ExecutionOutputDelta),
    Exited(ExecutionProcessSnapshot),
}

impl LocalExecutionProcessHandle {
    pub fn process_id(&self) -> &str {
        &self.process_id
    }

    pub fn control_handle(&self) -> LocalExecutionProcessControlHandle {
        LocalExecutionProcessControlHandle {
            process_id: self.process_id.clone(),
            control_tx: self.control_tx.clone(),
            state_rx: self.state_rx.clone(),
        }
    }

    pub fn status(&self) -> ExecutionProcessSnapshot {
        self.state_rx.borrow().clone()
    }

    pub async fn recv_output(&mut self) -> Option<ExecutionOutputDelta> {
        loop {
            match self.output_rx.recv().await {
                Ok(delta) => return Some(delta),
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => return None,
            }
        }
    }

    pub async fn next_event(&mut self) -> Option<LocalExecutionProcessEvent> {
        loop {
            loop {
                match self.output_rx.try_recv() {
                    Ok(delta) => return Some(LocalExecutionProcessEvent::Output(delta)),
                    Err(broadcast::error::TryRecvError::Lagged(_)) => continue,
                    Err(
                        broadcast::error::TryRecvError::Empty
                        | broadcast::error::TryRecvError::Closed,
                    ) => break,
                }
            }
            if self.final_snapshot.is_some() {
                return None;
            }
            let mut final_rx = self.final_rx.take()?;
            tokio::select! {
                biased;
                delta = self.output_rx.recv() => {
                    match delta {
                        Ok(delta) => {
                            self.final_rx = Some(final_rx);
                            return Some(LocalExecutionProcessEvent::Output(delta));
                        }
                        Err(broadcast::error::RecvError::Lagged(_)) => {
                            self.final_rx = Some(final_rx);
                            continue;
                        }
                        Err(broadcast::error::RecvError::Closed) => {
                            let snapshot = final_rx.await.ok()?;
                            self.final_snapshot = Some(snapshot.clone());
                            return Some(LocalExecutionProcessEvent::Exited(snapshot));
                        }
                    }
                }
                result = &mut final_rx => {
                    let snapshot = result.ok()?;
                    self.final_snapshot = Some(snapshot.clone());
                    return Some(LocalExecutionProcessEvent::Exited(snapshot));
                }
            }
        }
    }

    pub fn write_stdin(&self, bytes: impl Into<Vec<u8>>) -> Result<(), LocalExecutionError> {
        self.control_tx
            .send(LocalExecutionControl::WriteStdin(bytes.into()))
    }

    pub fn interrupt(&self) -> Result<(), LocalExecutionError> {
        self.control_tx.send(LocalExecutionControl::Interrupt)
    }

    pub fn terminate(&self) -> Result<(), LocalExecutionError> {
        self.control_tx.send(LocalExecutionControl::Terminate)
    }

    pub fn close_stdin(&self) -> Result<(), LocalExecutionError> {
        self.control_tx.send(LocalExecutionControl::CloseStdin)
    }

    pub fn resize(&self, rows: u16, cols: u16) -> Result<(), LocalExecutionError> {
        self.control_tx
            .send(LocalExecutionControl::Resize { rows, cols })
    }

    pub async fn wait(&mut self) -> Result<ExecutionProcessSnapshot, LocalExecutionError> {
        if let Some(snapshot) = &self.final_snapshot {
            return Ok(snapshot.clone());
        }
        let final_rx = self
            .final_rx
            .as_mut()
            .ok_or(LocalExecutionError::SupervisorClosed)?;
        let snapshot = final_rx
            .await
            .map_err(|_| LocalExecutionError::SupervisorClosed);
        self.final_rx.take();
        let snapshot = snapshot?;
        self.final_snapshot = Some(snapshot.clone());
        Ok(snapshot)
    }
}

impl LocalExecutionProcessControlHandle {
    pub fn process_id(&self) -> &str {
        &self.process_id
    }

    pub fn status(&self) -> ExecutionProcessSnapshot {
        self.state_rx.borrow().clone()
    }

    pub fn write_stdin(&self, bytes: impl Into<Vec<u8>>) -> Result<(), LocalExecutionError> {
        self.control_tx
            .send(LocalExecutionControl::WriteStdin(bytes.into()))
    }

    pub fn interrupt(&self) -> Result<(), LocalExecutionError> {
        self.control_tx.send(LocalExecutionControl::Interrupt)
    }

    pub fn terminate(&self) -> Result<(), LocalExecutionError> {
        self.control_tx.send(LocalExecutionControl::Terminate)
    }

    pub fn close_stdin(&self) -> Result<(), LocalExecutionError> {
        self.control_tx.send(LocalExecutionControl::CloseStdin)
    }

    pub fn resize(&self, rows: u16, cols: u16) -> Result<(), LocalExecutionError> {
        self.control_tx
            .send(LocalExecutionControl::Resize { rows, cols })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LocalExecutionError {
    ControlClosed,
    SupervisorClosed,
}

impl std::fmt::Display for LocalExecutionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::ControlClosed => "process control channel closed",
            Self::SupervisorClosed => "process supervisor closed",
        })
    }
}

impl std::error::Error for LocalExecutionError {}

enum LocalExecutionControl {
    WriteStdin(Vec<u8>),
    CloseStdin,
    Resize { rows: u16, cols: u16 },
    Interrupt,
    Terminate,
}

#[derive(Debug, Clone)]
enum LocalExecutionControlSender {
    Async(mpsc::UnboundedSender<LocalExecutionControl>),
    Blocking(std::sync::mpsc::Sender<LocalExecutionControl>),
}

impl LocalExecutionControlSender {
    fn send(&self, control: LocalExecutionControl) -> Result<(), LocalExecutionError> {
        match self {
            Self::Async(sender) => sender
                .send(control)
                .map_err(|_| LocalExecutionError::ControlClosed),
            Self::Blocking(sender) => sender
                .send(control)
                .map_err(|_| LocalExecutionError::ControlClosed),
        }
    }
}

pub fn start_local_execution_process(
    request: LocalExecutionRequest,
) -> io::Result<LocalExecutionProcessHandle> {
    start_local_execution_process_with_inherited_environment(request, std::env::vars())
}

fn start_local_execution_process_with_inherited_environment(
    mut request: LocalExecutionRequest,
    inherited_environment: impl IntoIterator<Item = (String, String)>,
) -> io::Result<LocalExecutionProcessHandle> {
    request.env = resolve_child_environment(request.env_clear, inherited_environment, &request.env);
    #[cfg(target_os = "windows")]
    if let Some(sandbox) = request.sandbox.clone()
        && sandbox.backend == SandboxBackend::RestrictedToken
    {
        return windows::start_windows_restricted_execution_process(request, sandbox);
    }
    exec_server_bridge::start(request)
}

fn duration_millis(duration: Duration) -> u64 {
    duration.as_millis().try_into().unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests;
