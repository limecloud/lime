use std::path::Path;

use crate::path_guard::{
    PathGuardFinding, PathMutationCandidate, evaluate_path_mutations, summarize_paths,
    summarize_raw_paths,
};
use crate::shell::{ShellKind, shell_kind, shell_script_from_argv};
use shell_command::is_dangerous_command::DangerousCommandMatch;
use shell_command::is_dangerous_command::dangerous_command_match;

mod bash;
mod powershell;
mod powershell_literal;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShellPermissionDecision {
    Allow,
    Deny(String),
    RequiresConfirmation(String),
}

impl ShellPermissionDecision {
    pub fn into_result_without_confirmation(self) -> Result<(), String> {
        match self {
            Self::Allow => Ok(()),
            Self::Deny(reason) | Self::RequiresConfirmation(reason) => Err(reason),
        }
    }
}

pub fn check_shell_command_permission(
    command: &[String],
    working_directory: &Path,
) -> ShellPermissionDecision {
    let Some(executable) = command.first() else {
        return ShellPermissionDecision::Deny("Missing command parameter".into());
    };
    if let Some(matched) = dangerous_command_match(command) {
        return ShellPermissionDecision::Deny(dangerous_command_reason(matched));
    }
    match shell_kind(executable) {
        Some(ShellKind::PowerShell) => {
            powershell::check_command_args(&command[1..], working_directory)
        }
        Some(ShellKind::Posix) => match shell_script_from_argv(command) {
            Some(script) => check_bash_command_permission(script, working_directory),
            None => ShellPermissionDecision::RequiresConfirmation(
                "Shell script input cannot be validated statically".into(),
            ),
        },
        Some(ShellKind::Cmd) => {
            ShellPermissionDecision::RequiresConfirmation("CMD syntax requires confirmation".into())
        }
        None => match shlex::try_join(command.iter().map(String::as_str)) {
            Ok(invocation) => check_bash_command_permission(&invocation, working_directory),
            Err(_) => ShellPermissionDecision::RequiresConfirmation(
                "Process argv cannot be validated statically".into(),
            ),
        },
    }
}

pub fn check_bash_command_permission(
    command: &str,
    working_directory: &Path,
) -> ShellPermissionDecision {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return ShellPermissionDecision::Deny("Missing command parameter".to_string());
    }
    if let Some(matched) =
        dangerous_command_match(&["bash".to_string(), "-c".to_string(), trimmed.to_string()])
    {
        return ShellPermissionDecision::Deny(dangerous_command_reason(matched));
    }
    bash::check_permission(trimmed, working_directory)
}

pub fn check_powershell_command_permission(
    command: &str,
    working_directory: &Path,
) -> ShellPermissionDecision {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return ShellPermissionDecision::Deny("Command cannot be empty".to_string());
    }
    if let Some(matched) =
        dangerous_command_match(&["pwsh".to_string(), "-c".to_string(), trimmed.to_string()])
    {
        return ShellPermissionDecision::Deny(dangerous_command_reason(matched));
    }
    powershell::check_permission(trimmed, working_directory)
}

fn dangerous_command_reason(matched: DangerousCommandMatch) -> String {
    match matched {
        DangerousCommandMatch::ForcedRm => {
            "dangerous command blocked: rm -f style commands are not permitted. Use a safer approach"
                .to_string()
        }
        DangerousCommandMatch::Other => "dangerous command blocked by policy".to_string(),
    }
}

fn validate_command_paths(
    candidates: &[PathMutationCandidate],
    cwd: &Path,
    prefix: &str,
) -> Option<ShellPermissionDecision> {
    match evaluate_path_mutations(candidates, cwd)? {
        PathGuardFinding::ProtectedPaths(paths) => Some(ShellPermissionDecision::Deny(format!(
            "Blocked: {prefix}command targets protected path(s): {}",
            summarize_paths(&paths)
        ))),
        PathGuardFinding::OutsideWorkspace(paths) => {
            Some(ShellPermissionDecision::RequiresConfirmation(format!(
                "{prefix}command modifies path(s) outside the current working directory: {}. Do you want to proceed?",
                summarize_paths(&paths)
            )))
        }
        PathGuardFinding::DynamicPaths(paths) => {
            Some(ShellPermissionDecision::RequiresConfirmation(format!(
                "{prefix}command uses path expression(s) that cannot be validated safely: {}. Do you want to proceed?",
                summarize_raw_paths(&paths)
            )))
        }
    }
}

#[cfg(test)]
mod tests;
