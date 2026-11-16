use super::unified_exec_error;
use crate::tool_executor::RuntimeToolExecutionError;
use std::path::{Path, PathBuf};

pub(super) fn build_shell_command(command: &str, shell: Option<&str>, login: bool) -> Vec<String> {
    let shell = shell
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(default_shell);
    match crate::shell::shell_kind(&shell) {
        Some(crate::shell::ShellKind::PowerShell) => {
            let mut argv = vec![shell];
            if !login {
                argv.push("-NoProfile".into());
            }
            argv.extend(["-NonInteractive".into(), "-Command".into(), command.into()]);
            argv
        }
        Some(crate::shell::ShellKind::Cmd) => {
            vec![shell, "/D".into(), "/S".into(), "/C".into(), command.into()]
        }
        _ => vec![
            shell,
            if login { "-lc" } else { "-c" }.into(),
            command.into(),
        ],
    }
}

fn default_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        "powershell.exe".into()
    }
    #[cfg(not(target_os = "windows"))]
    {
        shell_command::shell_detect::default_user_shell()
            .shell_path
            .to_string_lossy()
            .into_owned()
    }
}

pub(super) fn resolve_working_directory(
    turn_cwd: &Path,
    requested: Option<&str>,
    environment_id: &str,
) -> Result<PathBuf, RuntimeToolExecutionError> {
    let requested = requested.map(str::trim).filter(|value| !value.is_empty());
    let candidate = match requested {
        Some(value) if Path::new(value).is_absolute() => PathBuf::from(value),
        Some(value) => turn_cwd.join(value),
        None => turn_cwd.to_path_buf(),
    };
    if environment_id != "local" {
        if candidate.as_os_str().is_empty() {
            return Err(unified_exec_error(
                "exec_command remote workdir must not be empty".to_string(),
            ));
        }
        return Ok(candidate);
    }
    let canonical = std::fs::canonicalize(&candidate).map_err(|error| {
        unified_exec_error(format!(
            "exec_command workdir '{}' is unavailable: {error}",
            candidate.display()
        ))
    })?;
    if !canonical.is_dir() {
        return Err(unified_exec_error(format!(
            "exec_command workdir '{}' is not a directory",
            canonical.display()
        )));
    }
    Ok(canonical)
}
