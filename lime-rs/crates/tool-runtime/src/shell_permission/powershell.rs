use std::path::Path;

use base64::{Engine, engine::general_purpose::STANDARD};

use crate::path_guard::PathMutationKind;
use crate::shell_analysis::{
    collect_powershell_invocation_path_candidates, detect_high_risk_powershell_invocation_reason,
    detect_mutating_powershell_invocation_warning,
};

use super::{
    ShellPermissionDecision, powershell_literal::try_parse_powershell_commands,
    validate_command_paths,
};

const MAX_WRAPPER_DEPTH: usize = 8;

pub(super) fn check_permission(script: &str, cwd: &Path) -> ShellPermissionDecision {
    check_script(script, cwd, 0)
}

pub(super) fn check_command_args(args: &[String], cwd: &Path) -> ShellPermissionDecision {
    check_command_args_at_depth(args, cwd, 0)
}

pub(super) fn check_command_args_at_depth(
    args: &[String],
    cwd: &Path,
    depth: usize,
) -> ShellPermissionDecision {
    check_powershell_wrapper(args, cwd, depth)
}

fn confirmation(reason: &str) -> ShellPermissionDecision {
    ShellPermissionDecision::RequiresConfirmation(reason.to_owned())
}

fn check_script(script: &str, cwd: &Path, depth: usize) -> ShellPermissionDecision {
    if depth > MAX_WRAPPER_DEPTH {
        return ShellPermissionDecision::Deny(
            "PowerShell wrapper nesting exceeds the policy limit".into(),
        );
    }
    let Some(commands) = try_parse_powershell_commands(script) else {
        return confirmation("PowerShell syntax or dynamic execution cannot be validated safely");
    };
    let mut decision = ShellPermissionDecision::Allow;
    for words in commands {
        let next = check_invocation(&words, cwd, depth);
        if matches!(next, ShellPermissionDecision::Deny(_)) {
            return next;
        }
        if decision == ShellPermissionDecision::Allow {
            decision = next;
        }
    }
    decision
}

fn check_invocation(words: &[String], cwd: &Path, depth: usize) -> ShellPermissionDecision {
    let name = words[0]
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(&words[0])
        .to_ascii_lowercase();
    let name = name.strip_suffix(".exe").unwrap_or(&name);
    let args = &words[1..];
    if matches!(
        name,
        "format-volume" | "clear-disk" | "diskpart" | "stop-computer" | "restart-computer"
    ) {
        return ShellPermissionDecision::Deny(format!(
            "Command invokes dangerous PowerShell operation: '{name}'"
        ));
    }
    if matches!(name, "invoke-expression" | "iex") {
        return match args {
            [script] => check_script(script, cwd, depth + 1),
            _ => confirmation("Evaluated PowerShell input cannot be validated statically"),
        };
    }
    if matches!(name, "powershell" | "pwsh") {
        return check_powershell_wrapper(args, cwd, depth);
    }
    if crate::shell::shell_kind(&words[0]) == Some(crate::shell::ShellKind::Posix) {
        return super::bash::check_invocation_values(words, cwd, depth + 1);
    }
    if matches!(
        name,
        "cmd" | "invoke-command" | "start-process" | "saps" | "start" | "invoke-item" | "ii"
    ) {
        return confirmation("Nested process or script execution requires confirmation");
    }
    let values = std::iter::once(name.to_owned())
        .chain(args.iter().cloned())
        .collect::<Vec<_>>();
    if let Some(reason) = detect_high_risk_powershell_invocation_reason(&values) {
        return ShellPermissionDecision::Deny(reason);
    }
    let candidates = collect_powershell_invocation_path_candidates(&values);
    if candidates
        .iter()
        .any(|path| path.kind == PathMutationKind::Remove && is_root_target(&path.raw_path))
    {
        return ShellPermissionDecision::Deny(
            "Command removes a filesystem or workspace root".into(),
        );
    }
    if matches!(name, "start-sleep" | "sleep")
        && sleep_seconds(args).is_some_and(|seconds| seconds >= 2.0)
    {
        return ShellPermissionDecision::Deny(
            "Blocked: long Start-Sleep commands should use the Sleep tool or run_in_background."
                .into(),
        );
    }
    if let Some(decision) = validate_command_paths(&candidates, cwd, "PowerShell ") {
        return decision;
    }
    if matches!(
        name,
        "stop-process" | "kill" | "spps" | "set-executionpolicy"
    ) {
        return confirmation(
            "PowerShell command may terminate processes or change execution policy",
        );
    }
    if let Some(warning) = detect_mutating_powershell_invocation_warning(&values) {
        return confirmation(&warning);
    }
    ShellPermissionDecision::Allow
}

fn is_root_target(arg: &str) -> bool {
    let arg = arg.replace('\\', "/");
    let target = arg.trim_end_matches('/');
    matches!(
        arg.as_str(),
        "/" | "/*" | "." | "./" | "./*" | ".." | "../" | "../*" | "~" | "~/*"
    ) || (target.len() == 2 && target.as_bytes()[0].is_ascii_alphabetic() && target.ends_with(':'))
        || (target.len() == 4
            && target.as_bytes()[0].is_ascii_alphabetic()
            && target.ends_with(":/*"))
}

fn sleep_seconds(args: &[String]) -> Option<f64> {
    match args {
        [seconds] => seconds.parse().ok(),
        [flag, seconds]
            if flag.eq_ignore_ascii_case("-seconds") || flag.eq_ignore_ascii_case("-s") =>
        {
            seconds.parse().ok()
        }
        _ => None,
    }
}

fn check_powershell_wrapper(args: &[String], cwd: &Path, depth: usize) -> ShellPermissionDecision {
    let mut index = 0;
    while let Some(arg) = args.get(index) {
        let flag = arg.to_ascii_lowercase();
        if matches!(flag.as_str(), "-command" | "-c") {
            return match &args[index + 1..] {
                [script] => check_script(script, cwd, depth + 1),
                _ => confirmation("PowerShell command arguments cannot be validated statically"),
            };
        }
        if matches!(flag.as_str(), "-encodedcommand" | "-enc" | "-e") {
            return match &args[index + 1..] {
                [encoded] => match decode_script(encoded) {
                    Some(script) => check_script(&script, cwd, depth + 1),
                    None => confirmation("Encoded PowerShell input cannot be validated statically"),
                },
                _ => confirmation("Encoded PowerShell arguments cannot be validated statically"),
            };
        }
        if !matches!(flag.as_str(), "-noprofile" | "-noninteractive" | "-nologo") {
            return confirmation("PowerShell wrapper option requires confirmation");
        }
        index += 1;
    }
    confirmation("PowerShell script input cannot be validated statically")
}

fn decode_script(encoded: &str) -> Option<String> {
    let bytes = STANDARD.decode(encoded).ok()?;
    if bytes.len() % 2 != 0 {
        return None;
    }
    let units = bytes
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .collect::<Vec<_>>();
    String::from_utf16(&units).ok()
}
