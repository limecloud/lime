//! Native writes use the same OS process sandbox as shell execution.

use crate::execution_process::{
    LocalExecutionRequest, LocalExecutionSandbox, start_local_execution_process,
};
use crate::internal_agent::InternalAgentPolicy;
use crate::sandbox::{SandboxBackend, WindowsSandboxExecutionMode};
use app_server_protocol::protocol::v2::SandboxPolicy;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{Read, Write};
use std::path::PathBuf;
use tokio_util::sync::CancellationToken;

pub const FILESYSTEM_HELPER_ARG: &str = "--filesystem-helper";

#[derive(Serialize, Deserialize)]
struct PatchRequest {
    patch: String,
    cwd: PathBuf,
    unrestricted: bool,
}

/// Invoked before the host initializes any database, transport or runtime.
pub fn run() -> Result<(), String> {
    let mut input = String::new();
    std::io::stdin()
        .take(8 * 1024 * 1024)
        .read_to_string(&mut input)
        .map_err(|e| e.to_string())?;
    let request: PatchRequest = serde_json::from_str(&input).map_err(|e| e.to_string())?;
    let output =
        crate::apply_patch::apply_in_helper(&request.patch, &request.cwd, request.unrestricted)?;
    serde_json::to_writer(std::io::stdout().lock(), &output).map_err(|e| e.to_string())?;
    std::io::stdout().flush().map_err(|e| e.to_string())
}

pub(crate) async fn apply_patch(
    patch: &str,
    policy: &InternalAgentPolicy,
    cancellation: Option<&CancellationToken>,
) -> Result<Value, String> {
    let cancellation = cancellation
        .map(CancellationToken::child_token)
        .unwrap_or_default();
    let _cancel_on_drop = cancellation.clone().drop_guard();
    let patch = patch.to_string();
    let owned_policy = policy.clone();
    // The session owns this task even if the actor aborts the caller after its grace period.
    policy
        .filesystem_tasks
        .spawn(async move { run_patch(patch, owned_policy, cancellation).await })
        .await
        .map_err(|e| format!("native filesystem task failed: {e}"))?
}

async fn run_patch(
    patch: String,
    policy: InternalAgentPolicy,
    cancellation: CancellationToken,
) -> Result<Value, String> {
    if cancellation.is_cancelled() || policy.filesystem_shutdown.is_cancelled() {
        return Err("native filesystem execution cancelled".to_string());
    }
    let unmanaged = matches!(
        policy.sandbox(),
        SandboxPolicy::DangerFullAccess | SandboxPolicy::ExternalSandbox { .. }
    );
    let mut request = LocalExecutionRequest::new(
        uuid::Uuid::new_v4().to_string(),
        "filesystem",
        "apply_patch",
        vec![
            std::env::current_exe()
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .into_owned(),
            FILESYSTEM_HELPER_ARG.to_string(),
        ],
    );
    request.cwd = Some(policy.root().to_path_buf());
    if !unmanaged {
        let backend = match std::env::consts::OS {
            "macos" => SandboxBackend::Seatbelt,
            "linux" => SandboxBackend::LinuxSandbox,
            "windows" => SandboxBackend::RestrictedToken,
            os => return Err(format!("native filesystem sandbox unavailable on {os}")),
        };
        request.sandbox = Some(LocalExecutionSandbox {
            backend,
            policy: policy.sandbox().clone(),
            granted_permissions: None,
            windows_mode: Some(WindowsSandboxExecutionMode::Unelevated),
        });
    }
    let mut process = start_local_execution_process(request).map_err(|e| e.to_string())?;
    struct TerminateOnDrop(crate::execution_process::LocalExecutionProcessControlHandle);
    impl Drop for TerminateOnDrop {
        fn drop(&mut self) {
            let _ = self.0.terminate();
        }
    }
    let _guard = TerminateOnDrop(process.control_handle());
    let payload = serde_json::to_vec(&PatchRequest {
        patch,
        cwd: policy.root().to_path_buf(),
        unrestricted: unmanaged,
    })
    .map_err(|e| e.to_string())?;
    let result = async {
        process.write_stdin(payload).map_err(|e| e.to_string())?;
        process.close_stdin().map_err(|e| e.to_string())?;
        tokio::select! {
            result = process.wait() => result.map_err(|e| e.to_string()),
            _ = cancellation.cancelled() => Err("native filesystem execution cancelled".to_string()),
            _ = policy.filesystem_shutdown.cancelled() => Err("native filesystem session closed".to_string()),
        }
    }.await;
    if result.is_err() {
        let _ = process.terminate();
        process.wait().await.map_err(|e| e.to_string())?;
    };
    let snapshot = result?;
    if snapshot.exit_code != Some(0) || snapshot.output_truncated {
        return Err(format!(
            "native filesystem helper failed: {}",
            snapshot.retained_output
        ));
    }
    serde_json::from_str(&snapshot.retained_output)
        .map_err(|e| format!("invalid filesystem helper response: {e}"))
}
