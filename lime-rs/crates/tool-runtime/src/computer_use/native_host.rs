//! Bounded JSON-lines client for the existing platform helper, independent of Electron.

use super::native_resources::NativeResource;
use super::{denied, ComputerUseError, ComputerUseOwner, ComputerUseResult};
use serde_json::{json, Value};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

const MAX_FRAME_BYTES: usize = 32 * 1024 * 1024;

#[derive(Clone)]
pub(super) struct NativeHost {
    resource: Option<NativeResource>,
    state: Arc<Mutex<State>>,
}

#[derive(Default)]
struct State {
    generation: u64,
    next_id: u64,
    session: Option<Session>,
}

struct Session {
    _child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl Session {
    async fn request(
        &mut self,
        id: &str,
        method: &str,
        params: Value,
        cancel: CancellationToken,
        timeout: Duration,
    ) -> ComputerUseResult<Value> {
        let mut bytes = serde_json::to_vec(&json!({"id":id,"method":method,"params":params}))
            .map_err(|e| denied(e.to_string()))?;
        if bytes.len() > MAX_FRAME_BYTES {
            return Err(denied("Native helper request is too large"));
        }
        bytes.push(b'\n');
        tokio::time::timeout(Duration::from_secs(5), async {
            self.stdin.write_all(&bytes).await?;
            self.stdin.flush().await
        })
        .await
        .map_err(|_| denied("Native helper write timed out"))?
        .map_err(|e| denied(e.to_string()))?;
        let response = Self::read_response(&mut self.stdout, id, method);
        tokio::pin!(response);
        let canceled = tokio::select! {
            biased;
            _ = cancel.cancelled() => true,
            _ = tokio::time::sleep(timeout) => false,
            result = &mut response => return result,
        };
        if method == "computerUse.execute" {
            // The helper's input loop handles this outside its main action queue.
            // Let bounded actions release pressed buttons before killing/reaping it.
            let cancel_frame =
                b"{\"id\":\"cancel\",\"method\":\"computerUse.cancel\",\"params\":{}}\n";
            let _ = tokio::time::timeout(
                Duration::from_millis(200),
                self.stdin.write_all(cancel_frame),
            )
            .await;
            let _ = tokio::time::timeout(Duration::from_secs(3), &mut response).await;
        }
        Err(denied(if canceled {
            "Native helper request canceled; action outcome may be unknown"
        } else {
            "Native helper request timed out; action outcome may be unknown"
        }))
    }

    async fn read_response(
        stdout: &mut BufReader<ChildStdout>,
        id: &str,
        method: &str,
    ) -> ComputerUseResult<Value> {
        // Events are bounded too; a broken helper cannot keep the request alive forever.
        for _ in 0..64 {
            let mut frame = Vec::new();
            (&mut *stdout)
                .take((MAX_FRAME_BYTES + 1) as u64)
                .read_until(b'\n', &mut frame)
                .await
                .map_err(|e| denied(e.to_string()))?;
            if frame.is_empty() || frame.len() > MAX_FRAME_BYTES || frame.last() != Some(&b'\n') {
                return Err(denied(
                    "Native helper returned EOF or an invalid frame length",
                ));
            }
            let value: Value = serde_json::from_slice(&frame).map_err(|e| denied(e.to_string()))?;
            if value.get("event").and_then(Value::as_str).is_some() {
                continue;
            }
            if value.get("id").and_then(Value::as_str) != Some(id) {
                return Err(denied("Native helper response identity mismatch"));
            }
            return match value.get("ok").and_then(Value::as_bool) {
                Some(true) => value
                    .get("result")
                    .cloned()
                    .ok_or_else(|| denied("Missing native result")),
                Some(false) => {
                    let code = value.pointer("/error/code").and_then(Value::as_str);
                    let message = format!(
                        "Native helper rejected {method}: {} ({})",
                        code.unwrap_or("operation_failed"),
                        value
                            .pointer("/error/message")
                            .and_then(Value::as_str)
                            .unwrap_or("Native operation failed")
                            .chars()
                            .take(512)
                            .collect::<String>()
                    );
                    Err(
                        if method == "computerUse.execute"
                            && matches!(
                                code,
                                Some(
                                    "user_intervened"
                                        | "input_monitor_unavailable"
                                        | "desktop_locked"
                                )
                            )
                        {
                            ComputerUseError::interrupted(message)
                        } else {
                            denied(message)
                        },
                    )
                }
                None => Err(denied("Invalid native helper response")),
            };
        }
        Err(denied("Too many native helper events before response"))
    }
}

impl NativeHost {
    pub(super) fn new() -> Self {
        Self {
            resource: None,
            state: Arc::new(Mutex::new(State::default())),
        }
    }

    #[cfg(test)]
    pub(super) fn with_resource(resource: NativeResource) -> Self {
        Self {
            resource: Some(resource),
            state: Arc::new(Mutex::new(State::default())),
        }
    }

    pub(super) fn finish_turn(
        &self,
        owner: &ComputerUseOwner,
        session: u64,
    ) -> Option<tokio::task::JoinHandle<()>> {
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            // Shutdown outside a runtime cannot leave a persistent overlay.
            if let Ok(mut state) = self.state.try_lock() {
                if state.generation == session {
                    state.session.take();
                }
            }
            return None;
        };
        let host = self.clone();
        let params = json!({"owner": owner});
        Some(runtime.spawn(async move {
            // Cleanup never discovers/spawns a helper or crosses a restart.
            // The helper also scopes presentation to this exact turn owner.
            let _ = host
                .invoke_cancel(
                    "computerUse.finishTurn",
                    params,
                    CancellationToken::new(),
                    Some(session),
                )
                .await;
        }))
    }

    pub(super) async fn invoke(
        &self,
        method: &str,
        params: Value,
    ) -> ComputerUseResult<Option<(u64, Value)>> {
        self.invoke_cancel(method, params, CancellationToken::new(), None)
            .await
    }

    pub(super) async fn invoke_cancel(
        &self,
        method: &str,
        params: Value,
        cancel: CancellationToken,
        expected_session: Option<u64>,
    ) -> ComputerUseResult<Option<(u64, Value)>> {
        let mut state = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(denied("Native helper request canceled")),
            state = self.state.lock() => state,
        };
        if cancel.is_cancelled() {
            return Err(denied("Native helper request canceled"));
        }
        if expected_session
            .is_some_and(|generation| generation != state.generation || state.session.is_none())
        {
            return Err(denied("Native helper session is no longer active"));
        }
        // Take ownership while awaiting IO. Cancellation drops the child (kill_on_drop),
        // so a late setup/action response cannot authorize a replacement helper session.
        let mut session = match state.session.take() {
            Some(session) => session,
            None => {
                // Manifest verification reads and hashes the complete host and
                // helper. Keep this blocking work off the runtime's IO workers.
                let configured = self.resource.clone();
                let discovery = tokio::task::spawn_blocking(
                    move || -> ComputerUseResult<Option<NativeResource>> {
                        let resource = match configured {
                            Some(resource) => Some(resource),
                            None => NativeResource::discover()?,
                        };
                        if let Some(resource) = &resource {
                            resource.verify()?;
                        }
                        Ok(resource)
                    },
                );
                let resource = tokio::select! {
                    biased;
                    _ = cancel.cancelled() => return Err(denied("Native helper request canceled")),
                    result = discovery => result.map_err(|e| denied(format!("Native resource verification failed: {e}")))??,
                };
                let Some(resource) = resource else {
                    return Ok(None);
                };
                let mut command = Command::new(&resource.path);
                command
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::null())
                    .kill_on_drop(true);
                #[cfg(windows)]
                command.creation_flags(0x08000000);
                let mut child = command.spawn().map_err(|e| denied(e.to_string()))?;
                let stdin = child
                    .stdin
                    .take()
                    .ok_or_else(|| denied("Missing native stdin"))?;
                let stdout = child
                    .stdout
                    .take()
                    .ok_or_else(|| denied("Missing native stdout"))?;
                state.generation = state
                    .generation
                    .checked_add(1)
                    .ok_or_else(|| denied("Native session exhausted"))?;
                Session {
                    _child: child,
                    stdin,
                    stdout: BufReader::new(stdout),
                }
            }
        };
        state.next_id = state
            .next_id
            .checked_add(1)
            .ok_or_else(|| denied("Native request id exhausted"))?;
        let id = state.next_id.to_string();
        let timeout = match method {
            "computerUse.setup" => Duration::from_secs(120),
            "computerUse.finishTurn" => Duration::from_secs(3),
            _ => Duration::from_secs(15),
        };
        let result = session.request(&id, method, params, cancel, timeout).await;
        let result = match result {
            Ok(result) => result,
            Err(error) => {
                // Wait for child death before releasing the caller's OS control lease.
                // A timeout/cancellation is never evidence that input was not applied.
                let _ = session._child.kill().await;
                let _ = session._child.wait().await;
                return Err(error);
            }
        };
        state.session = Some(session);
        Ok(Some((state.generation, result)))
    }
}

#[cfg(all(test, unix))]
#[path = "native_host_tests.rs"]
mod tests;
