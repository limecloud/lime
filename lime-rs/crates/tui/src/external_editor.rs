use std::env;
use std::fs;
use std::path::Path;
use std::process::Stdio;

use anyhow::{bail, Context, Result};
use thiserror::Error;
use tokio::process::Command;

#[derive(Debug, Error, PartialEq, Eq)]
pub(crate) enum EditorError {
    #[error("neither VISUAL nor EDITOR is set")]
    MissingEditor,
    #[cfg(not(windows))]
    #[error("failed to parse editor command")]
    ParseFailed,
    #[error("editor command is empty")]
    EmptyCommand,
}

/// Resolve the editor command, preferring VISUAL over EDITOR.
pub(crate) fn resolve_editor_command() -> std::result::Result<Vec<String>, EditorError> {
    let visual = env::var("VISUAL").ok();
    let editor = env::var("EDITOR").ok();
    resolve_editor_command_from(visual.as_deref(), editor.as_deref())
}

fn resolve_editor_command_from(
    visual: Option<&str>,
    editor: Option<&str>,
) -> std::result::Result<Vec<String>, EditorError> {
    let raw = visual.or(editor).ok_or(EditorError::MissingEditor)?;
    let parts = {
        #[cfg(windows)]
        {
            winsplit::split(raw)
        }
        #[cfg(not(windows))]
        {
            shlex::split(raw).ok_or(EditorError::ParseFailed)?
        }
    };
    if parts.is_empty() {
        return Err(EditorError::EmptyCommand);
    }
    Ok(parts)
}

/// Resolve Windows PATH/PATHEXT shims such as code.cmd.
#[cfg(windows)]
fn resolve_windows_program(program: &str) -> std::path::PathBuf {
    which::which(program).unwrap_or_else(|_| std::path::PathBuf::from(program))
}

/// Write the seed, launch the editor with inherited stdio, and return its complete contents.
pub(crate) async fn run_editor(seed: &str, editor_cmd: &[String], cwd: &Path) -> Result<String> {
    let executable = editor_cmd.first().ok_or(EditorError::EmptyCommand)?;
    let temp_path = tempfile::Builder::new()
        .prefix("editor-")
        .suffix(".md")
        .tempfile_in(cwd)
        .or_else(|_| {
            tempfile::Builder::new()
                .prefix("editor-")
                .suffix(".md")
                .tempfile()
        })?
        .into_temp_path();
    // Close the temporary file before launching the editor so Windows shims can open it.
    fs::write(&temp_path, seed).context("failed to write external editor draft")?;
    let mut cmd = {
        #[cfg(windows)]
        {
            Command::new(resolve_windows_program(executable))
        }
        #[cfg(not(windows))]
        {
            Command::new(executable)
        }
    };
    let status = cmd
        .args(&editor_cmd[1..])
        .arg(&temp_path)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .await
        .with_context(|| format!("failed to start external editor {executable:?}"))?;
    if !status.success() {
        bail!("external editor exited with status {status}");
    }
    fs::read_to_string(&temp_path).context("failed to read external editor draft")
}

#[cfg(test)]
#[path = "external_editor_tests.rs"]
mod tests;
