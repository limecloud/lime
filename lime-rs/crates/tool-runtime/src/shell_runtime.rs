#[cfg(any(target_os = "windows", test))]
use std::ffi::OsString;
use std::path::PathBuf;

use tokio::process::Command;

#[cfg(target_os = "windows")]
use crate::subprocess::{
    configure_command_for_gui, wrap_cmd_command_for_utf8, wrap_powershell_command_for_utf8,
};

pub fn build_platform_shell_command(command: &str) -> Command {
    #[cfg(target_os = "windows")]
    {
        if let Some(executable_path) = detect_powershell_executable() {
            let command = strip_windows_powershell_command_wrapper(command)
                .unwrap_or_else(|| command.to_string());
            return build_powershell_command(executable_path, &command);
        }

        return build_cmd_command(detect_cmd_executable(), command);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = Command::new("sh");
        cmd.args(["-c", command]);
        cmd
    }
}

pub fn platform_shell_argv(command: &str) -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        if let Some(executable_path) = detect_powershell_executable() {
            return vec![
                executable_path.to_string_lossy().to_string(),
                "-NoProfile".to_string(),
                "-NonInteractive".to_string(),
                "-Command".to_string(),
                wrap_powershell_command_for_utf8(command),
            ];
        }
        return vec![
            detect_cmd_executable().to_string_lossy().to_string(),
            "/D".to_string(),
            "/S".to_string(),
            "/C".to_string(),
            wrap_cmd_command_for_utf8(command),
        ];
    }

    #[cfg(not(target_os = "windows"))]
    {
        let shell = crate::shell_detect::default_user_shell()
            .shell_path
            .to_string_lossy()
            .into_owned();
        vec![shell, "-lc".to_string(), command.to_string()]
    }
}

pub fn detect_powershell_executable() -> Option<PathBuf> {
    let from_path = which::which("pwsh")
        .ok()
        .or_else(|| which::which("powershell").ok())
        .or_else(|| which::which("powershell.exe").ok());
    if from_path.is_some() {
        return from_path;
    }

    #[cfg(target_os = "windows")]
    {
        detect_known_windows_powershell_executable()
    }

    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

#[cfg(target_os = "windows")]
fn detect_known_windows_powershell_executable() -> Option<PathBuf> {
    windows_powershell_candidates_from_env(|key| std::env::var_os(key))
        .into_iter()
        .find(|path| path.exists())
}

#[cfg(target_os = "windows")]
fn detect_cmd_executable() -> PathBuf {
    if let Some(comspec) = std::env::var_os("COMSPEC") {
        let path = PathBuf::from(comspec);
        if path.exists() {
            return path;
        }
    }

    for key in ["SystemRoot", "WINDIR"] {
        let Some(root) = std::env::var_os(key) else {
            continue;
        };
        let path = PathBuf::from(root).join("System32").join("cmd.exe");
        if path.exists() {
            return path;
        }
    }

    PathBuf::from("cmd.exe")
}

#[cfg(target_os = "windows")]
fn build_powershell_command(executable_path: PathBuf, command: &str) -> Command {
    let command = wrap_powershell_command_for_utf8(command);
    let mut cmd = Command::new(executable_path);
    configure_command_for_gui(&mut cmd);
    cmd.args([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        command.as_str(),
    ]);
    cmd
}

#[cfg(target_os = "windows")]
fn build_cmd_command(executable_path: PathBuf, command: &str) -> Command {
    let command = wrap_cmd_command_for_utf8(command);
    let mut cmd = Command::new(executable_path);
    configure_command_for_gui(&mut cmd);
    cmd.args(["/D", "/S", "/C", command.as_str()]);
    cmd
}

#[cfg(any(target_os = "windows", test))]
fn strip_windows_powershell_command_wrapper(command: &str) -> Option<String> {
    let input = command.trim_start();
    let (executable, _, mut index) = parse_shell_token(input, 0)?;
    if !is_powershell_executable_token(&executable) {
        return None;
    }

    while index < input.len() {
        index = skip_ascii_whitespace(input, index);
        if index >= input.len() {
            return None;
        }

        let (token, _, token_end) = parse_shell_token(input, index)?;
        index = token_end;
        if token.eq_ignore_ascii_case("-command") || token.eq_ignore_ascii_case("-c") {
            let inner_start = skip_ascii_whitespace(input, index);
            let inner = input.get(inner_start..)?.trim();
            if inner.is_empty() {
                return None;
            }
            return Some(strip_matching_outer_quotes(inner).to_string());
        }
    }

    None
}

#[cfg(any(target_os = "windows", test))]
fn parse_shell_token(input: &str, start: usize) -> Option<(String, usize, usize)> {
    let start = skip_ascii_whitespace(input, start);
    let mut chars = input.get(start..)?.char_indices();
    let (_, first) = chars.next()?;
    if first == '"' || first == '\'' {
        let token_start = start + first.len_utf8();
        for (offset, ch) in chars {
            if ch == first {
                let token_end = start + offset;
                let next_index = token_end + ch.len_utf8();
                return Some((input[token_start..token_end].to_string(), start, next_index));
            }
        }
        return None;
    }

    for (offset, ch) in input[start..].char_indices() {
        if ch.is_ascii_whitespace() {
            let token_end = start + offset;
            return Some((input[start..token_end].to_string(), start, token_end));
        }
    }

    Some((input[start..].to_string(), start, input.len()))
}

#[cfg(any(target_os = "windows", test))]
fn skip_ascii_whitespace(input: &str, mut index: usize) -> usize {
    while index < input.len() {
        let Some(ch) = input[index..].chars().next() else {
            break;
        };
        if !ch.is_ascii_whitespace() {
            break;
        }
        index += ch.len_utf8();
    }
    index
}

#[cfg(any(target_os = "windows", test))]
fn is_powershell_executable_token(token: &str) -> bool {
    let normalized = token.replace('\\', "/").to_ascii_lowercase();
    matches!(
        normalized.as_str(),
        "powershell" | "powershell.exe" | "pwsh" | "pwsh.exe"
    ) || normalized.ends_with("/powershell.exe")
        || normalized.ends_with("/pwsh.exe")
}

#[cfg(any(target_os = "windows", test))]
fn strip_matching_outer_quotes(input: &str) -> &str {
    let mut chars = input.chars();
    let Some(first) = chars.next() else {
        return input;
    };
    if first != '"' && first != '\'' {
        return input;
    }
    if !input.ends_with(first) {
        return input;
    }

    let start = first.len_utf8();
    let end = input.len().saturating_sub(first.len_utf8());
    input.get(start..end).unwrap_or(input)
}

#[cfg(any(target_os = "windows", test))]
fn windows_powershell_candidates_from_env(env: impl Fn(&str) -> Option<OsString>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    for key in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"] {
        let Some(root) = env(key) else {
            continue;
        };
        push_unique_path(
            &mut candidates,
            PathBuf::from(root)
                .join("PowerShell")
                .join("7")
                .join("pwsh.exe"),
        );
    }

    for key in ["SystemRoot", "WINDIR"] {
        let Some(root) = env(key) else {
            continue;
        };
        let root = PathBuf::from(root);
        push_unique_path(
            &mut candidates,
            root.join("System32")
                .join("WindowsPowerShell")
                .join("v1.0")
                .join("powershell.exe"),
        );
        push_unique_path(
            &mut candidates,
            root.join("Sysnative")
                .join("WindowsPowerShell")
                .join("v1.0")
                .join("powershell.exe"),
        );
    }

    candidates
}

#[cfg(any(target_os = "windows", test))]
fn push_unique_path(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if paths.iter().any(|existing| existing == &path) {
        return;
    }
    paths.push(path);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_powershell_candidates_include_system32_and_program_files() {
        let candidates = windows_powershell_candidates_from_env(|key| match key {
            "ProgramFiles" => Some(OsString::from(r"C:\Program Files")),
            "SystemRoot" => Some(OsString::from(r"C:\Windows")),
            _ => None,
        });

        assert!(candidates.contains(
            &PathBuf::from(r"C:\Program Files")
                .join("PowerShell")
                .join("7")
                .join("pwsh.exe")
        ));
        assert!(candidates.contains(
            &PathBuf::from(r"C:\Windows")
                .join("System32")
                .join("WindowsPowerShell")
                .join("v1.0")
                .join("powershell.exe")
        ));
    }

    #[test]
    fn windows_powershell_candidates_are_deduplicated() {
        let candidates = windows_powershell_candidates_from_env(|key| match key {
            "SystemRoot" | "WINDIR" => Some(OsString::from(r"C:\Windows")),
            _ => None,
        });

        let system32 = PathBuf::from(r"C:\Windows")
            .join("System32")
            .join("WindowsPowerShell")
            .join("v1.0")
            .join("powershell.exe");
        assert_eq!(
            candidates
                .iter()
                .filter(|candidate| candidate == &&system32)
                .count(),
            1
        );
    }

    #[test]
    fn strips_nested_powershell_command_wrapper() {
        assert_eq!(
            strip_windows_powershell_command_wrapper(
                r#"powershell -Command "Invoke-WebRequest -Uri 'https://example.com'""#
            )
            .as_deref(),
            Some("Invoke-WebRequest -Uri 'https://example.com'")
        );
    }

    #[test]
    fn strips_nested_pwsh_wrapper_with_common_flags() {
        assert_eq!(
            strip_windows_powershell_command_wrapper(
                "pwsh -NoProfile -NonInteractive -Command Write-Output test",
            )
            .as_deref(),
            Some("Write-Output test")
        );
    }

    #[test]
    fn strips_absolute_powershell_command_wrapper() {
        assert_eq!(
            strip_windows_powershell_command_wrapper(
                r#""C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -Command "echo test""#,
            )
            .as_deref(),
            Some("echo test")
        );
    }

    #[test]
    fn keeps_non_command_powershell_invocations() {
        assert_eq!(
            strip_windows_powershell_command_wrapper("powershell -EncodedCommand abc"),
            None
        );
    }
}
