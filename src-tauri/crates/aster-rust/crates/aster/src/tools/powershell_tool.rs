//! PowerShell current surface tool
//!
//! 对齐当前工具面：
//! - PowerShell

use super::base::{PermissionCheckResult, Tool};
use super::context::{ToolContext, ToolOptions, ToolResult};
use super::error::ToolError;
use super::task::{TaskManager, TaskShell};
use async_trait::async_trait;
use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::process::Command;
use tracing::{debug, warn};

const POWERSHELL_TOOL_NAME: &str = "PowerShell";
const POWERSHELL_TOOL_DESCRIPTION: &str = "Executes a given PowerShell command with optional timeout. Working directory persists between commands; shell state (variables, functions) does not.";
const DEFAULT_TIMEOUT_MS: u64 = 300_000;
const MAX_TIMEOUT_MS: u64 = 1_800_000;
const MAX_OUTPUT_LENGTH: usize = 128 * 1024;

#[derive(Debug, Clone, Deserialize)]
struct PowerShellToolInput {
    command: String,
    #[serde(default)]
    timeout: Option<u64>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default, alias = "runInBackground")]
    run_in_background: Option<bool>,
}

#[derive(Debug)]
pub struct PowerShellTool {
    task_manager: Arc<TaskManager>,
    executable_path: Option<PathBuf>,
    dangerous_patterns: Vec<Regex>,
    warning_patterns: Vec<Regex>,
}

#[derive(Debug, Clone)]
struct SafetyCheckResult {
    safe: bool,
    reason: Option<String>,
    warning: Option<String>,
}

impl SafetyCheckResult {
    fn safe() -> Self {
        Self {
            safe: true,
            reason: None,
            warning: None,
        }
    }

    fn deny(reason: impl Into<String>) -> Self {
        Self {
            safe: false,
            reason: Some(reason.into()),
            warning: None,
        }
    }

    fn warn(message: impl Into<String>) -> Self {
        Self {
            safe: true,
            reason: None,
            warning: Some(message.into()),
        }
    }
}

impl PowerShellTool {
    pub fn new() -> Self {
        Self::with_task_manager(Arc::new(TaskManager::new()))
    }

    pub fn with_task_manager(task_manager: Arc<TaskManager>) -> Self {
        Self {
            task_manager,
            executable_path: detect_powershell_executable(),
            dangerous_patterns: default_dangerous_patterns(),
            warning_patterns: default_warning_patterns(),
        }
    }

    #[cfg(test)]
    fn with_executable_path(
        task_manager: Arc<TaskManager>,
        executable_path: Option<PathBuf>,
    ) -> Self {
        Self {
            task_manager,
            executable_path,
            dangerous_patterns: default_dangerous_patterns(),
            warning_patterns: default_warning_patterns(),
        }
    }

    pub fn is_runtime_available() -> bool {
        detect_powershell_executable().is_some()
    }

    pub fn is_available(&self) -> bool {
        self.executable_path.is_some()
    }

    fn executable_path(&self) -> Result<&Path, ToolError> {
        self.executable_path.as_deref().ok_or_else(|| {
            ToolError::execution_failed(
                "PowerShell runtime unavailable: neither `pwsh` nor `powershell` was found in PATH.",
            )
        })
    }

    fn build_command(&self, command: &str, context: &ToolContext) -> Result<Command, ToolError> {
        let executable_path = self.executable_path()?;
        let mut cmd = Command::new(executable_path);
        cmd.args(["-NoProfile", "-NonInteractive", "-Command", command]);
        cmd.current_dir(&context.working_directory);
        cmd.env("ASTER_TERMINAL", "1");
        for (key, value) in &context.environment {
            cmd.env(key, value);
        }
        Ok(cmd)
    }

    fn truncate_output(&self, output: &str) -> String {
        if output.len() <= MAX_OUTPUT_LENGTH {
            return output.to_string();
        }

        let truncation_message = format!(
            "\n\n... [Output truncated. Showing first {} of {} bytes]",
            MAX_OUTPUT_LENGTH,
            output.len()
        );
        let keep_length = MAX_OUTPUT_LENGTH.saturating_sub(truncation_message.len());
        let mut safe_length = keep_length;
        while safe_length > 0 && !output.is_char_boundary(safe_length) {
            safe_length -= 1;
        }
        let truncated = output.get(..safe_length).unwrap_or(output);
        let last_newline = truncated.rfind('\n').unwrap_or(truncated.len());

        format!(
            "{}{}",
            output.get(..last_newline).unwrap_or(output),
            truncation_message
        )
    }

    fn format_output(&self, stdout: &str, stderr: &str, exit_code: i32) -> String {
        let mut output = String::new();

        if !stdout.is_empty() {
            output.push_str(stdout);
        }

        if !stderr.is_empty() {
            if !output.is_empty() && !output.ends_with('\n') {
                output.push('\n');
            }
            if !stdout.is_empty() {
                output.push_str("--- stderr ---\n");
            }
            output.push_str(stderr);
        }

        if exit_code != 0 && output.is_empty() {
            output = format!("Command exited with code {}", exit_code);
        }

        output
    }

    fn check_command_safety(&self, command: &str) -> SafetyCheckResult {
        let command_trimmed = command.trim();
        if command_trimmed.is_empty() {
            return SafetyCheckResult::deny("Command cannot be empty");
        }

        for pattern in &self.dangerous_patterns {
            if pattern.is_match(command_trimmed) {
                return SafetyCheckResult::deny(format!(
                    "Command contains dangerous PowerShell pattern: {}",
                    pattern.as_str()
                ));
            }
        }

        for pattern in &self.warning_patterns {
            if pattern.is_match(command_trimmed) {
                return SafetyCheckResult::warn(format!(
                    "Command matches warning pattern: {}",
                    pattern.as_str()
                ));
            }
        }

        SafetyCheckResult::safe()
    }

    async fn execute_foreground(
        &self,
        command: &str,
        timeout_ms: u64,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        if context.is_cancelled() {
            return Err(ToolError::Cancelled);
        }

        let effective_timeout_ms = timeout_ms.min(MAX_TIMEOUT_MS);
        if timeout_ms > MAX_TIMEOUT_MS {
            warn!(
                "Requested PowerShell timeout {}ms exceeds maximum, using {}ms",
                timeout_ms, MAX_TIMEOUT_MS
            );
        }
        let effective_timeout = Duration::from_millis(effective_timeout_ms);
        let mut cmd = self.build_command(command, context)?;

        debug!(
            "Executing PowerShell command with timeout {:?}: {}",
            effective_timeout, command
        );

        let result = tokio::time::timeout(effective_timeout, async {
            cmd.stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .stdin(Stdio::null())
                .kill_on_drop(true)
                .output()
                .await
        })
        .await;

        match result {
            Ok(Ok(output)) => {
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                let exit_code = output.status.code().unwrap_or(-1);
                let formatted =
                    self.truncate_output(&self.format_output(&stdout, &stderr, exit_code));

                if output.status.success() {
                    Ok(ToolResult::success(formatted)
                        .with_metadata("exit_code", json!(exit_code))
                        .with_metadata("stdout_length", json!(stdout.len()))
                        .with_metadata("stderr_length", json!(stderr.len())))
                } else {
                    Ok(ToolResult::error(formatted)
                        .with_metadata("exit_code", json!(exit_code))
                        .with_metadata("stdout_length", json!(stdout.len()))
                        .with_metadata("stderr_length", json!(stderr.len())))
                }
            }
            Ok(Err(error)) => Err(ToolError::execution_failed(format!(
                "Failed to execute PowerShell command: {}",
                error
            ))),
            Err(_) => Err(ToolError::timeout(effective_timeout)),
        }
    }

    async fn execute_background(
        &self,
        command: &str,
        description: Option<&str>,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        if context.is_cancelled() {
            return Err(ToolError::Cancelled);
        }

        let executable_path = self.executable_path()?.to_path_buf();
        let task_id = self
            .task_manager
            .start_with_shell(
                command,
                context,
                TaskShell::PowerShell {
                    executable_path: executable_path.clone(),
                },
            )
            .await?;
        let output_file = self.task_manager.get_output_file_path(&task_id).await;
        let output_file_text = output_file.as_ref().map(|path| path.display().to_string());

        let summary = description
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(command);
        let mut result = ToolResult::success(match output_file_text.as_deref() {
            Some(path) => format!(
                "PowerShell command running in background with ID: {task_id}\nSummary: {summary}\nOutput file: {path}"
            ),
            None => format!("PowerShell command running in background with ID: {task_id}"),
        })
        .with_metadata("task_id", json!(task_id))
        .with_metadata("background", json!(true))
        .with_metadata("shell", json!("powershell"))
        .with_metadata("summary", json!(summary))
        .with_metadata("executable", json!(executable_path.display().to_string()));

        if let Some(path) = output_file_text {
            result = result.with_metadata("output_file", json!(path));
        }

        Ok(result)
    }
}

impl Default for PowerShellTool {
    fn default() -> Self {
        Self::new()
    }
}

fn detect_powershell_executable() -> Option<PathBuf> {
    which::which("pwsh")
        .ok()
        .or_else(|| which::which("powershell").ok())
}

fn default_dangerous_patterns() -> Vec<Regex> {
    [
        r"(?i)\b(format-volume|clear-disk|diskpart|stop-computer|restart-computer)\b",
        r"(?i)\bremove-item\b.+\b(recurse|force)\b.+\b([a-z]:\\|/)\b",
    ]
    .iter()
    .filter_map(|pattern| Regex::new(pattern).ok())
    .collect()
}

fn default_warning_patterns() -> Vec<Regex> {
    [
        r"(?i)\b(remove-item|clear-content|stop-process|set-executionpolicy)\b",
        r"(?i)\b(invoke-expression|iex)\b",
        r"(?i)\bstart-process\b.+\b-verb\s+runas\b",
        r"(?i)\bgit\s+push\s+.*(--force|-f)\b",
    ]
    .iter()
    .filter_map(|pattern| Regex::new(pattern).ok())
    .collect()
}

fn detect_blocked_sleep_pattern(command: &str) -> Option<String> {
    let trimmed = command.trim();
    let first = trimmed.split([';', '|', '&', '\r', '\n']).next()?.trim();
    let captures = Regex::new(r"(?i)^(?:start-sleep|sleep)(?:\s+-s(?:econds)?)?\s+(\d+)\s*$")
        .ok()?
        .captures(first)?;
    let secs = captures.get(1)?.as_str().parse::<u64>().ok()?;
    if secs < 2 {
        return None;
    }

    let rest = trimmed
        .get(first.len()..)
        .unwrap_or("")
        .trim_start_matches(|ch: char| ch.is_whitespace() || ch == ';' || ch == '|' || ch == '&')
        .trim();

    if rest.is_empty() {
        Some(format!("standalone Start-Sleep {secs}"))
    } else {
        Some(format!("Start-Sleep {secs} followed by: {rest}"))
    }
}

fn dynamic_description() -> String {
    [
        POWERSHELL_TOOL_DESCRIPTION.to_string(),
        String::new(),
        "IMPORTANT: This tool is for terminal operations via PowerShell. Do not use it for file read/write/search operations when specialized tools already exist.".to_string(),
        String::new(),
        "Parameters:".to_string(),
        "- `command`: required PowerShell command string.".to_string(),
        format!(
            "- `timeout`: optional timeout in milliseconds. Default: {DEFAULT_TIMEOUT_MS}, max: {MAX_TIMEOUT_MS}."
        ),
        "- `description`: optional concise summary for background execution.".to_string(),
        "- `run_in_background`: optional boolean to run the command asynchronously.".to_string(),
        String::new(),
        "Prefer the dedicated Sleep tool over `Start-Sleep` when you intentionally need to wait.".to_string(),
    ]
    .join("\n")
}

#[async_trait]
impl Tool for PowerShellTool {
    fn name(&self) -> &str {
        POWERSHELL_TOOL_NAME
    }

    fn description(&self) -> &str {
        POWERSHELL_TOOL_DESCRIPTION
    }

    fn dynamic_description(&self) -> Option<String> {
        Some(dynamic_description())
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The PowerShell command to execute"
                },
                "timeout": {
                    "type": "integer",
                    "description": format!("Optional timeout in milliseconds (default: {}, max: {})", DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS),
                    "minimum": 1,
                    "maximum": MAX_TIMEOUT_MS
                },
                "description": {
                    "type": "string",
                    "description": "Clear, concise description of what this command does"
                },
                "run_in_background": {
                    "type": "boolean",
                    "description": "Run the command in the background"
                }
            },
            "required": ["command"]
        })
    }

    fn options(&self) -> ToolOptions {
        ToolOptions::new()
            .with_max_retries(0)
            .with_base_timeout(Duration::from_millis(DEFAULT_TIMEOUT_MS))
            .with_dynamic_timeout(false)
    }

    async fn check_permissions(
        &self,
        params: &Value,
        _context: &ToolContext,
    ) -> PermissionCheckResult {
        let input: PowerShellToolInput = match serde_json::from_value(params.clone()) {
            Ok(input) => input,
            Err(_) => return PermissionCheckResult::deny("Invalid PowerShell input"),
        };

        if detect_blocked_sleep_pattern(&input.command).is_some()
            && !input.run_in_background.unwrap_or(false)
        {
            return PermissionCheckResult::deny(
                "Blocked: long Start-Sleep commands should use the Sleep tool or run_in_background.",
            );
        }

        let safety_result = self.check_command_safety(&input.command);
        if !safety_result.safe {
            return PermissionCheckResult::deny(
                safety_result
                    .reason
                    .unwrap_or_else(|| "PowerShell command blocked by safety check".to_string()),
            );
        }

        if let Some(warning) = safety_result.warning {
            return PermissionCheckResult::ask(format!(
                "PowerShell command may be dangerous: {}. Do you want to proceed?",
                warning
            ));
        }

        PermissionCheckResult::allow()
    }

    async fn execute(&self, params: Value, context: &ToolContext) -> Result<ToolResult, ToolError> {
        let input: PowerShellToolInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("参数解析失败: {error}")))?;

        if input.command.trim().is_empty() {
            return Err(ToolError::invalid_params(
                "Missing required parameter: command",
            ));
        }

        if let Some(sleep_pattern) = detect_blocked_sleep_pattern(&input.command) {
            if !input.run_in_background.unwrap_or(false) {
                return Err(ToolError::invalid_params(format!(
                    "Blocked: {sleep_pattern}. Use the Sleep tool for intentional waiting, or set run_in_background to true if this command should keep running."
                )));
            }
        }

        let timeout_ms = input.timeout.unwrap_or(DEFAULT_TIMEOUT_MS);
        if input.run_in_background.unwrap_or(false) {
            self.execute_background(&input.command, input.description.as_deref(), context)
                .await
        } else {
            self.execute_foreground(&input.command, timeout_ms, context)
                .await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_powershell_tool_definition() {
        let tool = PowerShellTool::with_executable_path(Arc::new(TaskManager::new()), None);
        let definition = tool.get_definition();

        assert_eq!(definition.name, POWERSHELL_TOOL_NAME);
        assert!(definition.description.contains("run_in_background"));
        assert_eq!(
            definition
                .input_schema
                .get("required")
                .and_then(Value::as_array)
                .expect("required array"),
            &vec![Value::String("command".to_string())]
        );
    }

    #[test]
    fn test_detect_blocked_sleep_pattern() {
        assert_eq!(
            detect_blocked_sleep_pattern("Start-Sleep 5"),
            Some("standalone Start-Sleep 5".to_string())
        );
        assert_eq!(
            detect_blocked_sleep_pattern("sleep 4; Get-Process"),
            Some("Start-Sleep 4 followed by: Get-Process".to_string())
        );
        assert_eq!(
            detect_blocked_sleep_pattern("Start-Sleep -Milliseconds 500"),
            None
        );
        assert_eq!(detect_blocked_sleep_pattern("Start-Sleep 1"), None);
    }

    #[tokio::test]
    async fn test_powershell_tool_missing_runtime_returns_error() {
        let tool = PowerShellTool::with_executable_path(Arc::new(TaskManager::new()), None);

        let result = tool
            .execute(
                json!({
                    "command": "Write-Output 'hello'"
                }),
                &ToolContext::default(),
            )
            .await;

        assert!(matches!(result, Err(ToolError::ExecutionFailed(_))));
    }

    #[tokio::test]
    async fn test_powershell_tool_check_permissions_blocks_long_sleep() {
        let tool = PowerShellTool::with_executable_path(Arc::new(TaskManager::new()), None);

        let result = tool
            .check_permissions(
                &json!({
                    "command": "Start-Sleep 5"
                }),
                &ToolContext::default(),
            )
            .await;

        assert!(result.is_denied());
    }

    #[test]
    fn test_powershell_tool_options() {
        let tool = PowerShellTool::with_executable_path(Arc::new(TaskManager::new()), None);
        let options = tool.options();

        assert_eq!(options.max_retries, 0);
        assert_eq!(
            options.base_timeout,
            Duration::from_millis(DEFAULT_TIMEOUT_MS)
        );
        assert!(!options.enable_dynamic_timeout);
    }
}
