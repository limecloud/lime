pub fn process_id_for_tool(tool_id: &str) -> String {
    format!("process-{tool_id}")
}

pub fn shell_command_text_from_argv(command: &[String]) -> String {
    if let Some(script) = shell_script_from_argv(command) {
        return script.to_owned();
    }
    command
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn is_shell_tool_name(tool_name: &str) -> bool {
    normalized_tool_name(tool_name) == "execcommand"
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum ShellKind {
    Posix,
    PowerShell,
    Cmd,
}

pub(crate) fn shell_kind(executable: &str) -> Option<ShellKind> {
    let basename = executable
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(executable)
        .to_ascii_lowercase();
    match crate::shell_detect::detect_shell_type(&basename) {
        Some(crate::shell_detect::ShellType::Bash)
        | Some(crate::shell_detect::ShellType::Zsh)
        | Some(crate::shell_detect::ShellType::Sh) => Some(ShellKind::Posix),
        Some(crate::shell_detect::ShellType::PowerShell) => Some(ShellKind::PowerShell),
        Some(crate::shell_detect::ShellType::Cmd) => Some(ShellKind::Cmd),
        None => {
            // Upstream shell detection only lists shells its runtime launches;
            // Lime also accepts these POSIX-compatible shells.
            match basename.strip_suffix(".exe").unwrap_or(&basename) {
                "dash" | "ksh" => Some(ShellKind::Posix),
                _ => None,
            }
        }
    }
}

pub(crate) fn shell_script_from_argv(command: &[String]) -> Option<&str> {
    let kind = shell_kind(command.first()?)?;
    for (index, flag) in command.iter().enumerate().skip(1) {
        let lower = flag.to_ascii_lowercase();
        let script_flag = match kind {
            ShellKind::Posix => matches!(flag.as_str(), "-c" | "-lc" | "-cl"),
            ShellKind::PowerShell => matches!(lower.as_str(), "-command" | "-c"),
            ShellKind::Cmd => lower == "/c",
        };
        if script_flag {
            return command.get(index + 1).map(String::as_str);
        }
        let startup_flag = match kind {
            ShellKind::Posix => {
                matches!(flag.as_str(), "-l" | "--login" | "--noprofile" | "--norc")
            }
            ShellKind::PowerShell => {
                matches!(lower.as_str(), "-noprofile" | "-noninteractive" | "-nologo")
            }
            ShellKind::Cmd => matches!(lower.as_str(), "/d" | "/s"),
        };
        if !startup_flag {
            return None;
        }
    }
    None
}

fn normalized_tool_name(tool_name: &str) -> String {
    tool_name
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .map(|character| character.to_ascii_lowercase())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_command_text_should_strip_known_wrappers() {
        assert_eq!(
            shell_command_text_from_argv(&[
                "powershell.exe".to_string(),
                "-NoProfile".to_string(),
                "-NonInteractive".to_string(),
                "-Command".to_string(),
                "cargo test".to_string(),
            ]),
            "cargo test"
        );
        assert_eq!(
            shell_command_text_from_argv(&["sh".to_string(), "-c".to_string(), "pwd".to_string()]),
            "pwd"
        );
    }

    #[test]
    fn only_exec_command_is_a_current_shell_tool() {
        assert!(is_shell_tool_name("exec_command"));
        assert!(!is_shell_tool_name("Bash"));
        assert!(!is_shell_tool_name("PowerShell"));
    }

    #[test]
    fn shell_text_preserves_script_boundaries_and_absolute_paths() {
        for (argv, script) in [
            (
                vec!["/bin/zsh", "-lc", "printf shutdown", "ignored argument"],
                "printf shutdown",
            ),
            (
                vec![
                    "C:\\Program Files\\PowerShell\\7\\PWSH.EXE",
                    "-noprofile",
                    "-command",
                    "Write-Output ok",
                ],
                "Write-Output ok",
            ),
            (vec!["sh", "-c", "sh"], "sh"),
        ] {
            let argv = argv.into_iter().map(String::from).collect::<Vec<_>>();
            assert_eq!(shell_command_text_from_argv(&argv), script);
        }
        assert_eq!(
            shell_script_from_argv(&[
                "sh".into(),
                "--rcfile".into(),
                "-c".into(),
                "ignored".into()
            ]),
            None
        );
    }
}
