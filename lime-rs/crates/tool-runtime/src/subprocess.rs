use std::ffi::OsStr;
use std::process::Command;
use tokio::process::Command as TokioCommand;

/// Construct a background command, suppressing console allocation on Windows.
/// Convert with `tokio::process::Command::from` for asynchronous execution.
/// Subsequent Windows `creation_flags` calls must retain `CREATE_NO_WINDOW`.
pub fn background_command(program: impl AsRef<OsStr>) -> Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        let mut command = Command::new(program);
        command.creation_flags(/*flags*/ 0x0800_0000); // CREATE_NO_WINDOW
        command
    }
    #[cfg(not(windows))]
    Command::new(program)
}

#[cfg(windows)]
const CREATE_NO_WINDOW_FLAG: u32 = 0x08000000;
const POWERSHELL_UTF8_PREAMBLE: &str = "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8;";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedProcessOutput {
    pub text: String,
    pub encoding: &'static str,
    pub used_replacement: bool,
    pub used_fallback: bool,
}

#[allow(unused_variables)]
pub fn configure_command_no_window(command: &mut TokioCommand) {
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW_FLAG);
}

pub fn configure_command_for_gui(command: &mut TokioCommand) {
    configure_command_no_window(command);
}

pub fn powershell_utf8_preamble() -> &'static str {
    POWERSHELL_UTF8_PREAMBLE
}

pub fn wrap_powershell_command_for_utf8(command: &str) -> String {
    format!("{} {}", powershell_utf8_preamble(), command)
}

pub fn wrap_cmd_command_for_utf8(command: &str) -> String {
    format!("chcp 65001 >NUL & {}", command)
}

pub fn decode_process_output(bytes: &[u8]) -> DecodedProcessOutput {
    match String::from_utf8(bytes.to_vec()) {
        Ok(text) => DecodedProcessOutput {
            text,
            encoding: "utf-8",
            used_replacement: false,
            used_fallback: false,
        },
        Err(error) => {
            let bytes = error.into_bytes();
            let (decoded, _, had_errors) = encoding_rs::GBK.decode(&bytes);
            DecodedProcessOutput {
                text: decoded.into_owned(),
                encoding: "gbk",
                used_replacement: had_errors,
                used_fallback: true,
            }
        }
    }
}

pub fn summarize_decoded_with(outputs: &[&DecodedProcessOutput]) -> &'static str {
    if outputs.iter().any(|output| output.used_replacement) {
        "lossy-fallback"
    } else if outputs.iter().any(|output| output.used_fallback) {
        "fallback"
    } else {
        "strict"
    }
}

#[cfg(test)]
mod tests {
    use super::{
        decode_process_output, summarize_decoded_with, wrap_cmd_command_for_utf8,
        wrap_powershell_command_for_utf8,
    };

    #[test]
    fn decodes_utf8_without_replacement() {
        let decoded = decode_process_output("你好 Lime".as_bytes());

        assert_eq!(decoded.text, "你好 Lime");
        assert_eq!(decoded.encoding, "utf-8");
        assert!(!decoded.used_replacement);
        assert!(!decoded.used_fallback);
    }

    #[test]
    fn falls_back_to_gbk_for_legacy_windows_output() {
        let decoded = decode_process_output(&[0xc4, 0xe3, 0xba, 0xc3]);

        assert_eq!(decoded.text, "你好");
        assert_eq!(decoded.encoding, "gbk");
        assert!(!decoded.used_replacement);
        assert!(decoded.used_fallback);
    }

    #[test]
    fn marks_legacy_decode_as_fallback_even_without_lossy_replacement() {
        let stdout = decode_process_output(&[0xc4, 0xe3, 0xba, 0xc3]);
        let stderr = decode_process_output(&[]);

        assert_eq!(summarize_decoded_with(&[&stdout, &stderr]), "fallback");
    }

    #[test]
    fn wraps_powershell_command_with_utf8_preamble() {
        let wrapped = wrap_powershell_command_for_utf8("Write-Output '你好'");

        assert!(wrapped.contains("[Console]::OutputEncoding"));
        assert!(wrapped.contains("$OutputEncoding"));
        assert!(wrapped.contains("Write-Output '你好'"));
    }

    #[test]
    fn wraps_cmd_command_with_utf8_codepage() {
        let wrapped = wrap_cmd_command_for_utf8("echo hello");

        assert!(wrapped.starts_with("chcp 65001 >NUL & "));
        assert!(wrapped.ends_with("echo hello"));
    }
}
