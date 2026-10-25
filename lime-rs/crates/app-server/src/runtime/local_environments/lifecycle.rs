//! Packaged Desktop lifecycle semantics, executed through the current command owner.

use super::{paths, read_config, save_config};
use crate::runtime::{RuntimeCore, RuntimeCoreError};
use app_server_protocol::protocol::v2::*;
use app_server_protocol::{LocalEnvironmentScriptResult, LocalEnvironmentScriptStatus};
use app_server_transport::ConnectionId;
use lime_services::project_git_service as git;
use std::collections::HashMap;
use std::path::Path;

pub(crate) async fn setup(
    runtime: &RuntimeCore,
    source_workspace: &Path,
    source_git_root: &Path,
    worktree: &Path,
    selected: Option<&str>,
    connection_id: ConnectionId,
    is_cancelled: &(impl Fn() -> bool + Send + Sync),
) -> (Option<LocalEnvironmentScriptResult>, Option<String>) {
    let selected = match selected.filter(|path| *path != "__none__") {
        Some(path) => match copy_config(path, source_git_root, worktree) {
            Ok(path) => Some(path),
            Err(error) => return (None, Some(error)),
        },
        None => None,
    };
    if let Err(error) = git::save_local_environment_config_path(worktree, selected.as_deref()).await
    {
        return (None, Some(error));
    }
    let Some(selected) = selected else {
        return (None, None);
    };
    let config = match load(&selected) {
        Ok(config) => config,
        Err(error) => return (None, Some(error)),
    };
    let relative_workspace = source_workspace
        .strip_prefix(source_git_root)
        .unwrap_or(Path::new(""));
    let environment = HashMap::from([
        (
            "LIME_SOURCE_TREE_PATH".into(),
            Some(source_workspace.to_string_lossy().into_owned()),
        ),
        (
            "LIME_WORKTREE_PATH".into(),
            Some(
                worktree
                    .join(relative_workspace)
                    .to_string_lossy()
                    .into_owned(),
            ),
        ),
    ]);
    let result = run(
        runtime,
        worktree,
        &config,
        false,
        environment,
        connection_id,
        is_cancelled,
    )
    .await;
    let error = result.as_ref().and_then(|result| result.error.clone());
    (result, error)
}

pub(crate) async fn cleanup(
    runtime: &RuntimeCore,
    worktree: &Path,
    connection_id: ConnectionId,
    is_cancelled: &(impl Fn() -> bool + Send + Sync),
) -> Result<(), RuntimeCoreError> {
    let selected = git::read_local_environment_config_path(worktree)
        .await
        .map_err(RuntimeCoreError::Backend)?;
    let Some(selected) = selected else {
        return Ok(());
    };
    let config = match load(&selected) {
        Ok(config) => config,
        Err(error) => {
            tracing::warn!(%error, "Worktree cleanup environment config is unavailable");
            return Ok(());
        }
    };
    if let Some(result) = run(
        runtime,
        worktree,
        &config,
        true,
        HashMap::new(),
        connection_id,
        is_cancelled,
    )
    .await
    {
        if let Some(error) = result.error {
            return Err(RuntimeCoreError::Backend(format!(
                "Cleanup script failed: {error}"
            )));
        }
    }
    Ok(())
}

fn load(path: &str) -> Result<LocalEnvironmentResult, String> {
    let config = read_config(LocalEnvironmentsReadConfigParams {
        config_path: path.into(),
        host_id: None,
    })
    .map_err(|error| error.message)?;
    match config.environment {
        Some(config @ LocalEnvironmentResult::Success { .. }) => Ok(config),
        Some(LocalEnvironmentResult::Error { error, .. }) => Err(error.message),
        None => Err("Environment config no longer exists".into()),
    }
}

fn copy_config(path: &str, source_git_root: &Path, worktree: &Path) -> Result<String, String> {
    let original = read_config(LocalEnvironmentsReadConfigParams {
        config_path: path.into(),
        host_id: None,
    })
    .map_err(|error| error.message)?;
    let raw = original.raw.ok_or("Environment config no longer exists")?;
    let source = Path::new(&original.config_path);
    let Ok(relative) = source.strip_prefix(source_git_root) else {
        return Ok(original.config_path);
    };
    let target = worktree.join(relative);
    // Match Desktop's fallback to the source config when its directory is not present in the checkout.
    let Ok(current) = read_config(LocalEnvironmentsReadConfigParams {
        config_path: target.to_string_lossy().into_owned(),
        host_id: None,
    }) else {
        return Ok(original.config_path);
    };
    let target = paths::config_path(&current.config_path).map_err(|error| error.message)?;
    if !target.starts_with(worktree) {
        return Err("Worktree environment config resolves outside the worktree".into());
    }
    let saved = save_config(LocalEnvironmentsSaveConfigParams {
        config_path: current.config_path,
        expected_revision: current.revision,
        raw,
        host_id: None,
    })
    .map_err(|error| error.message)?;
    if saved.status != LocalEnvironmentSaveStatus::Success {
        return Err("Worktree environment config changed while selecting it".into());
    }
    Ok(saved.config_path)
}

fn platform_script(lifecycle: &LocalEnvironmentLifecycle) -> &str {
    let platform = if cfg!(target_os = "windows") {
        &lifecycle.win32
    } else if cfg!(target_os = "macos") {
        &lifecycle.darwin
    } else {
        &lifecycle.linux
    };
    platform
        .as_ref()
        .map(|value| value.script.as_str())
        .filter(|script| !script.is_empty())
        .unwrap_or(&lifecycle.script)
}

async fn run(
    runtime: &RuntimeCore,
    worktree: &Path,
    config: &LocalEnvironmentResult,
    cleanup: bool,
    mut env: HashMap<String, Option<String>>,
    connection_id: ConnectionId,
    is_cancelled: &(impl Fn() -> bool + Send + Sync),
) -> Option<LocalEnvironmentScriptResult> {
    let LocalEnvironmentResult::Success {
        config_path,
        cwd_relative_to_git_root,
        environment,
    } = config
    else {
        return None;
    };
    let lifecycle = if cleanup {
        environment.cleanup.as_ref()?
    } else {
        &environment.setup
    };
    let script = platform_script(lifecycle);
    if script.is_empty() {
        if !cleanup && !is_cancelled() {
            store_shell_environment(worktree, None).await;
        }
        return None;
    }
    let cwd = worktree.join(cwd_relative_to_git_root);
    let mut result = LocalEnvironmentScriptResult {
        script_path: config_path.clone(),
        cwd: cwd.to_string_lossy().into_owned(),
        status: LocalEnvironmentScriptStatus::Failed,
        started_at: chrono::Utc::now().timestamp_millis(),
        finished_at: 0,
        error: None,
        log: String::new(),
    };
    let execute = async {
        let directory = tempfile::Builder::new()
            .prefix("local-environment-")
            .tempdir()
            .map_err(|error| error.to_string())?;
        let (command, script_path) = write_script(directory.path(), script)?;
        result.script_path = script_path.to_string_lossy().into_owned();
        for (key, value) in [
            ("COLORTERM", "truecolor"),
            ("FORCE_COLOR", "1"),
            ("TERM", "xterm-256color"),
        ] {
            env.insert(key.into(), Some(value.into()));
        }
        let mut params = CommandExecParams {
            command,
            process_id: Some(format!("local-environment-{}", uuid::Uuid::new_v4())),
            tty: false,
            stream_stdin: false,
            stream_stdout_stderr: false,
            output_bytes_cap: None,
            disable_output_cap: false,
            disable_timeout: true,
            timeout_ms: None,
            cwd: Some(cwd.clone()),
            env: Some(env),
            size: None,
            sandbox_policy: None,
            permission_profile: None,
        };
        let policy = runtime
            .current_permission_profile_policy(cwd.to_str())
            .map_err(|error| error.to_string())?;
        let grants = crate::command_exec::resolve_permission_profile(&policy, &mut params)
            .map_err(|error| error.message)?;
        runtime
            .enforce_command_requirements(&mut params)
            .map_err(|error| error.to_string())?;
        let response = match runtime
            .command_exec
            .exec_cancellable(
                connection_id,
                params,
                grants,
                crate::command_exec::CommandExecEnvironment::Host,
                is_cancelled,
            )
            .await
        {
            Ok(response) => response,
            Err(error) => {
                if let Some(output) = error.data {
                    result.log = ["stdout", "stderr"]
                        .into_iter()
                        .filter_map(|key| output.get(key).and_then(serde_json::Value::as_str))
                        .filter(|value| !value.is_empty())
                        .collect::<Vec<_>>()
                        .join("\n");
                }
                return Err(error.message);
            }
        };
        result.log = [response.stdout, response.stderr]
            .into_iter()
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        if response.exit_code != 0 {
            return Err(format!(
                "{} script exited with code {}",
                if cleanup { "Cleanup" } else { "Setup" },
                response.exit_code
            ));
        }
        if !cleanup && !is_cancelled() {
            let captured = std::fs::read_to_string(directory.path().join("before_env.txt"))
                .and_then(|before| {
                    std::fs::read_to_string(directory.path().join("captured_env.txt"))
                        .map(|after| git::WorktreeShellEnvironment::from_captures(&before, &after))
                });
            if captured.is_err() {
                tracing::warn!("Failed to capture setup shell environment");
            }
            if !is_cancelled() {
                store_shell_environment(worktree, captured.ok().flatten()).await;
            }
        }
        Ok::<(), String>(())
    }
    .await;
    match execute {
        Ok(()) => result.status = LocalEnvironmentScriptStatus::Succeeded,
        Err(error) => result.error = Some(error),
    }
    result.finished_at = chrono::Utc::now().timestamp_millis();
    Some(result)
}

async fn store_shell_environment(
    worktree: &Path,
    environment: Option<git::WorktreeShellEnvironment>,
) {
    let result = match environment {
        Some(environment) => git::write_worktree_shell_environment(worktree, &environment).await,
        None => git::remove_worktree_shell_environment(worktree).await,
    };
    if result.is_err() {
        tracing::warn!("Failed to store worktree shell environment");
    }
}

fn write_script(
    directory: &Path,
    script: &str,
) -> Result<(Vec<String>, std::path::PathBuf), String> {
    let script = script.replace("\r\n", "\n");
    #[cfg(not(target_os = "windows"))]
    let (path, wrapper, command) = {
        let path = directory.join("setup_script.sh");
        let wrapper = directory.join("setup_wrapper.sh");
        let quoted = path.to_string_lossy().replace('\'', "'\\''");
        let before = directory
            .join("before_env.txt")
            .to_string_lossy()
            .replace('\'', "'\\''");
        let after = directory
            .join("captured_env.txt")
            .to_string_lossy()
            .replace('\'', "'\\''");
        (
            path,
            format!("set -xeo pipefail\ncapture_path='{after}'\nbefore_capture_path='{before}'\nenv > \"$before_capture_path\"\ntrap 'code=$?; if [ \"$code\" -eq 0 ]; then env > \"$capture_path\"; fi' EXIT\n. '{quoted}'\n"),
            vec!["bash".into(), wrapper.to_string_lossy().into_owned()],
        )
    };
    #[cfg(target_os = "windows")]
    let (path, wrapper, command) = {
        if let Some(shell) = tool_runtime::shell_runtime::detect_powershell_executable() {
            let path = directory.join("setup_script.ps1");
            let wrapper = powershell_wrapper(&path, directory);
            (
                path,
                wrapper,
                vec![
                    shell.to_string_lossy().into_owned(),
                    "-File".into(),
                    directory
                        .join("setup_wrapper.ps1")
                        .to_string_lossy()
                        .into_owned(),
                ],
            )
        } else {
            let path = directory.join("setup_script.cmd");
            let wrapper = cmd_wrapper(&path, directory);
            (
                path,
                wrapper,
                vec![
                    std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into()),
                    "/c".into(),
                    directory
                        .join("setup_wrapper.cmd")
                        .to_string_lossy()
                        .into_owned(),
                ],
            )
        }
    };
    std::fs::write(&path, script).map_err(|error| error.to_string())?;
    std::fs::write(command.last().expect("wrapper path"), wrapper)
        .map_err(|error| error.to_string())?;
    Ok((command, path))
}

#[cfg(any(target_os = "windows", test))]
fn powershell_wrapper(script: &Path, directory: &Path) -> String {
    let quoted = script.to_string_lossy().replace('\'', "''");
    let capture = |name: &str| {
        let path = directory.join(name).to_string_lossy().replace('\'', "''");
        format!("Get-ChildItem Env: | Sort-Object Name | ForEach-Object {{ '{{0}}={{1}}' -f $_.Name, $_.Value }} | Set-Content -LiteralPath '{path}' -Encoding utf8")
    };
    format!("$ErrorActionPreference = 'Stop'\n$PSNativeCommandUseErrorActionPreference = $true\n$exitCode = 0\n{}\ntry {{\n  & '{quoted}'\n}} finally {{\n  $exitCode = if ($null -eq $LASTEXITCODE) {{\n    if ($?) {{ 0 }} else {{ 1 }}\n  }} else {{\n    [int]$LASTEXITCODE\n  }}\n  if ($exitCode -eq 0) {{\n    {}\n  }}\n}}\nexit $exitCode\n", capture("before_env.txt"), capture("captured_env.txt"))
}

#[cfg(any(target_os = "windows", test))]
fn cmd_wrapper(script: &Path, directory: &Path) -> String {
    let quote = |path: &Path| format!("\"{}\"", path.to_string_lossy().replace('"', "\"\""));
    format!(
        "@echo off\r\nset > {}\r\ncall {}\r\nset LIME_SETUP_EXIT_CODE=%ERRORLEVEL%\r\nif \"%LIME_SETUP_EXIT_CODE%\"==\"0\" set > {}\r\nexit /b %LIME_SETUP_EXIT_CODE%\r\n",
        quote(&directory.join("before_env.txt")), quote(script), quote(&directory.join("captured_env.txt"))
    )
}

#[cfg(test)]
mod tests;
