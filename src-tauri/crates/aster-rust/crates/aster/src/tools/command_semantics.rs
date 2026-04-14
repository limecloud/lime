//! Command-specific exit code semantics for shell tools.
//!
//! Some commands use non-zero exit codes to report state rather than failure.
//! We keep the real exit code for observability, but avoid misclassifying
//! expected outcomes such as "no matches found" as execution errors.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandInterpretation {
    pub is_error: bool,
    pub message: Option<String>,
}

impl CommandInterpretation {
    fn success(message: Option<&str>) -> Self {
        Self {
            is_error: false,
            message: message.map(str::to_owned),
        }
    }

    fn error() -> Self {
        Self {
            is_error: true,
            message: None,
        }
    }
}

pub fn interpret_bash_command_result(
    command: &str,
    exit_code: i32,
    _stdout: &str,
    _stderr: &str,
) -> CommandInterpretation {
    let base_command = heuristically_extract_bash_base_command(command);
    match base_command.as_str() {
        "grep" | "rg" => {
            if exit_code >= 2 {
                CommandInterpretation::error()
            } else if exit_code == 1 {
                CommandInterpretation::success(Some("No matches found"))
            } else {
                CommandInterpretation::success(None)
            }
        }
        "find" => {
            if exit_code >= 2 {
                CommandInterpretation::error()
            } else if exit_code == 1 {
                CommandInterpretation::success(Some("Some directories were inaccessible"))
            } else {
                CommandInterpretation::success(None)
            }
        }
        "diff" => {
            if exit_code >= 2 {
                CommandInterpretation::error()
            } else if exit_code == 1 {
                CommandInterpretation::success(Some("Files differ"))
            } else {
                CommandInterpretation::success(None)
            }
        }
        "test" | "[" => {
            if exit_code >= 2 {
                CommandInterpretation::error()
            } else if exit_code == 1 {
                CommandInterpretation::success(Some("Condition is false"))
            } else {
                CommandInterpretation::success(None)
            }
        }
        _ => default_interpretation(exit_code),
    }
}

pub fn interpret_powershell_command_result(
    command: &str,
    exit_code: i32,
    _stdout: &str,
    _stderr: &str,
) -> CommandInterpretation {
    let base_command = heuristically_extract_powershell_base_command(command);
    match base_command.as_str() {
        "grep" | "rg" | "findstr" => {
            if exit_code >= 2 {
                CommandInterpretation::error()
            } else if exit_code == 1 {
                CommandInterpretation::success(Some("No matches found"))
            } else {
                CommandInterpretation::success(None)
            }
        }
        "robocopy" => {
            if exit_code >= 8 {
                CommandInterpretation::error()
            } else if exit_code == 0 {
                CommandInterpretation::success(Some("No files copied (already in sync)"))
            } else if exit_code & 1 == 1 {
                CommandInterpretation::success(Some("Files copied successfully"))
            } else {
                CommandInterpretation::success(Some("Robocopy completed (no errors)"))
            }
        }
        _ => default_interpretation(exit_code),
    }
}

fn default_interpretation(exit_code: i32) -> CommandInterpretation {
    if exit_code == 0 {
        CommandInterpretation::success(None)
    } else {
        CommandInterpretation::error()
    }
}

fn heuristically_extract_bash_base_command(command: &str) -> String {
    let last_segment = command
        .split(['\n', '\r', ';'])
        .flat_map(|segment| segment.split("&&"))
        .flat_map(|segment| segment.split("||"))
        .flat_map(|segment| segment.split('|'))
        .filter_map(|segment| {
            let trimmed = segment.trim();
            (!trimmed.is_empty()).then_some(trimmed)
        })
        .last()
        .unwrap_or(command.trim());

    extract_base_command(last_segment)
}

fn heuristically_extract_powershell_base_command(command: &str) -> String {
    let last_segment = command
        .split([';', '|', '\n', '\r'])
        .filter_map(|segment| {
            let trimmed = segment.trim();
            (!trimmed.is_empty()).then_some(trimmed)
        })
        .last()
        .unwrap_or(command.trim());

    extract_base_command(
        last_segment
            .trim_start_matches('&')
            .trim_start_matches('.')
            .trim(),
    )
}

fn extract_base_command(segment: &str) -> String {
    let first_token = segment.split_whitespace().next().unwrap_or_default();
    let unquoted = first_token.trim_matches(|ch| ch == '"' || ch == '\'');
    let basename = unquoted
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(unquoted)
        .trim();
    basename
        .to_ascii_lowercase()
        .trim_end_matches(".exe")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        interpret_bash_command_result, interpret_powershell_command_result, CommandInterpretation,
    };

    #[test]
    fn bash_rg_no_match_is_not_error() {
        assert_eq!(
            interpret_bash_command_result("cat README.md | rg todo", 1, "", ""),
            CommandInterpretation {
                is_error: false,
                message: Some("No matches found".to_string()),
            }
        );
    }

    #[test]
    fn bash_diff_exit_one_reports_difference() {
        assert_eq!(
            interpret_bash_command_result("diff old.txt new.txt", 1, "", ""),
            CommandInterpretation {
                is_error: false,
                message: Some("Files differ".to_string()),
            }
        );
    }

    #[test]
    fn bash_test_false_is_not_error() {
        assert_eq!(
            interpret_bash_command_result("[ -f missing.txt ]", 1, "", ""),
            CommandInterpretation {
                is_error: false,
                message: Some("Condition is false".to_string()),
            }
        );
    }

    #[test]
    fn bash_default_non_zero_still_errors() {
        assert_eq!(
            interpret_bash_command_result("exit 1", 1, "", ""),
            CommandInterpretation {
                is_error: true,
                message: None,
            }
        );
    }

    #[test]
    fn powershell_grep_exe_no_match_is_not_error() {
        assert_eq!(
            interpret_powershell_command_result(
                "& \"C:\\Tools\\grep.exe\" foo file.txt",
                1,
                "",
                "",
            ),
            CommandInterpretation {
                is_error: false,
                message: Some("No matches found".to_string()),
            }
        );
    }

    #[test]
    fn powershell_robocopy_success_range_is_not_error() {
        assert_eq!(
            interpret_powershell_command_result("robocopy src dst /E", 3, "", ""),
            CommandInterpretation {
                is_error: false,
                message: Some("Files copied successfully".to_string()),
            }
        );
    }

    #[test]
    fn powershell_robocopy_already_synced_has_message() {
        assert_eq!(
            interpret_powershell_command_result("robocopy src dst /E", 0, "", ""),
            CommandInterpretation {
                is_error: false,
                message: Some("No files copied (already in sync)".to_string()),
            }
        );
    }

    #[test]
    fn powershell_default_non_zero_still_errors() {
        assert_eq!(
            interpret_powershell_command_result("Write-Error 'boom'; exit 1", 1, "", ""),
            CommandInterpretation {
                is_error: true,
                message: None,
            }
        );
    }
}
