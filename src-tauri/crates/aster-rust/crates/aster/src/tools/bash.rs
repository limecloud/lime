//! Bash Tool Implementation
//!
//! This module implements the `BashTool` for executing shell commands with:
//! - Cross-platform support (Windows PowerShell/CMD, macOS, Linux)
//! - Safety checks for dangerous commands
//! - Warning pattern detection
//! - Background task execution
//! - Configurable timeout
//! - Output truncation
//!
//! Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9

use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tokio::process::Command;
use tracing::{debug, warn};

use super::base::{PermissionCheckResult, Tool};
use super::context::{ToolContext, ToolOptions, ToolResult};
use super::error::ToolError;
use super::task::TaskManager;

/// Maximum output length before truncation (128KB)
pub const MAX_OUTPUT_LENGTH: usize = 128 * 1024;

/// Default timeout for command execution (5 minutes)
pub const DEFAULT_TIMEOUT_SECS: u64 = 300;

/// Maximum timeout allowed (30 minutes)
pub const MAX_TIMEOUT_SECS: u64 = 1800;

/// Safety check result for command validation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SafetyCheckResult {
    /// Whether the command is safe to execute
    pub safe: bool,
    /// Reason for blocking (if not safe)
    pub reason: Option<String>,
    /// Warning message (if potentially dangerous but allowed)
    pub warning: Option<String>,
}

impl SafetyCheckResult {
    /// Create a safe result
    pub fn safe() -> Self {
        Self {
            safe: true,
            reason: None,
            warning: None,
        }
    }

    /// Create a safe result with a warning
    pub fn safe_with_warning(warning: impl Into<String>) -> Self {
        Self {
            safe: true,
            reason: None,
            warning: Some(warning.into()),
        }
    }

    /// Create an unsafe result with a reason
    pub fn unsafe_with_reason(reason: impl Into<String>) -> Self {
        Self {
            safe: false,
            reason: Some(reason.into()),
            warning: None,
        }
    }
}

/// Sandbox configuration for command execution
#[derive(Debug, Clone, Default)]
pub struct SandboxConfig {
    /// Whether sandbox is enabled
    pub enabled: bool,
    /// Allowed directories for file access
    pub allowed_directories: Vec<String>,
    /// Environment variables to set
    pub environment: std::collections::HashMap<String, String>,
}

/// Bash Tool for executing shell commands
///
/// Provides secure shell command execution with:
/// - Dangerous command blacklist
/// - Warning pattern detection
/// - Cross-platform support
/// - Timeout control
/// - Output truncation
///
/// Requirements: 3.1
#[derive(Debug)]
pub struct BashTool {
    /// Dangerous commands that are blocked
    dangerous_commands: Vec<String>,
    /// Warning patterns for potentially dangerous commands
    warning_patterns: Vec<Regex>,
    /// Task manager for background execution
    task_manager: Arc<TaskManager>,
    /// Sandbox configuration
    sandbox_config: Option<SandboxConfig>,
}

impl Default for BashTool {
    fn default() -> Self {
        Self::new()
    }
}

impl BashTool {
    /// Create a new BashTool with default settings
    pub fn new() -> Self {
        Self {
            dangerous_commands: Self::default_dangerous_commands(),
            warning_patterns: Self::default_warning_patterns(),
            task_manager: Arc::new(TaskManager::new()),
            sandbox_config: None,
        }
    }

    /// Create a BashTool with custom task manager
    pub fn with_task_manager(task_manager: Arc<TaskManager>) -> Self {
        Self {
            dangerous_commands: Self::default_dangerous_commands(),
            warning_patterns: Self::default_warning_patterns(),
            task_manager,
            sandbox_config: None,
        }
    }

    /// Set sandbox configuration
    pub fn with_sandbox(mut self, config: SandboxConfig) -> Self {
        self.sandbox_config = Some(config);
        self
    }

    /// Set custom dangerous commands
    pub fn with_dangerous_commands(mut self, commands: Vec<String>) -> Self {
        self.dangerous_commands = commands;
        self
    }

    /// Add additional dangerous commands
    pub fn add_dangerous_commands(&mut self, commands: Vec<String>) {
        self.dangerous_commands.extend(commands);
    }

    /// Set custom warning patterns
    pub fn with_warning_patterns(mut self, patterns: Vec<Regex>) -> Self {
        self.warning_patterns = patterns;
        self
    }

    /// Get the task manager
    pub fn task_manager(&self) -> &Arc<TaskManager> {
        &self.task_manager
    }

    /// Default list of dangerous commands that should be blocked
    fn default_dangerous_commands() -> Vec<String> {
        vec![
            // Destructive file operations
            "rm -rf /".to_string(),
            "rm -rf /*".to_string(),
            "rm -rf ~".to_string(),
            "rm -rf ~/*".to_string(),
            "rm -rf .".to_string(),
            "rm -rf ..".to_string(),
            // Format/partition commands
            "mkfs".to_string(),
            "fdisk".to_string(),
            "dd if=/dev/zero".to_string(),
            "dd if=/dev/random".to_string(),
            // Fork bombs
            ":(){ :|:& };:".to_string(),
            // System shutdown/reboot
            "shutdown".to_string(),
            "reboot".to_string(),
            "halt".to_string(),
            "poweroff".to_string(),
            "init 0".to_string(),
            "init 6".to_string(),
            // Dangerous redirects
            "> /dev/sda".to_string(),
            "> /dev/hda".to_string(),
            // Network attacks
            "nc -l".to_string(),
            // Privilege escalation attempts
            "chmod 777 /".to_string(),
            "chown -R".to_string(),
        ]
    }

    /// Default warning patterns for potentially dangerous commands
    fn default_warning_patterns() -> Vec<Regex> {
        let patterns = [
            // Recursive delete
            r"rm\s+(-[a-zA-Z]*r[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*)+",
            // Sudo commands
            r"sudo\s+",
            // Curl/wget piped to shell
            r"(curl|wget)\s+.*\|\s*(bash|sh|zsh)",
            // Chmod with dangerous permissions
            r"chmod\s+[0-7]*7[0-7]*",
            // Kill all processes
            r"kill\s+-9\s+-1",
            r"killall",
            // Environment variable manipulation
            r"export\s+PATH=",
            r"export\s+LD_PRELOAD",
            // Git force push
            r"git\s+push\s+.*--force",
            r"git\s+push\s+-f",
            // Database drop
            r"DROP\s+DATABASE",
            r"DROP\s+TABLE",
            // Docker dangerous operations
            r"docker\s+rm\s+-f",
            r"docker\s+system\s+prune",
        ];

        patterns.iter().filter_map(|p| Regex::new(p).ok()).collect()
    }
}

// =============================================================================
// Safety Check Implementation (Requirements: 3.2, 3.3)
// =============================================================================

impl BashTool {
    /// Check if a command is safe to execute
    ///
    /// This method checks the command against:
    /// 1. Dangerous command blacklist (blocks execution)
    /// 2. Warning patterns (allows with warning)
    ///
    /// Requirements: 3.2, 3.3
    pub fn check_command_safety(&self, command: &str) -> SafetyCheckResult {
        let command_lower = command.to_lowercase();
        let command_trimmed = command.trim();

        // Check against dangerous command blacklist
        for dangerous in &self.dangerous_commands {
            let dangerous_lower = dangerous.to_lowercase();
            if command_lower.contains(&dangerous_lower) {
                return SafetyCheckResult::unsafe_with_reason(format!(
                    "Command contains dangerous pattern: '{}'",
                    dangerous
                ));
            }
        }

        // Check for fork bomb patterns
        if self.is_fork_bomb(command_trimmed) {
            return SafetyCheckResult::unsafe_with_reason("Command appears to be a fork bomb");
        }

        // Check for dangerous redirects to device files
        if self.has_dangerous_redirect(command_trimmed) {
            return SafetyCheckResult::unsafe_with_reason(
                "Command contains dangerous redirect to device file",
            );
        }

        // Check against warning patterns
        let mut warnings = Vec::new();
        for pattern in &self.warning_patterns {
            if pattern.is_match(command_trimmed) {
                warnings.push(format!("Matches warning pattern: {}", pattern.as_str()));
            }
        }

        if !warnings.is_empty() {
            return SafetyCheckResult::safe_with_warning(warnings.join("; "));
        }

        SafetyCheckResult::safe()
    }

    /// Check if command appears to be a fork bomb
    fn is_fork_bomb(&self, command: &str) -> bool {
        // Common fork bomb patterns
        let fork_bomb_patterns = [
            r":\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:", // :(){ :|:& };:
            r"\$\{:\|:\&\}",                             // ${:|:&}
            r"\.\/\s*\$0\s*&",                           // ./$0 &
        ];

        for pattern in fork_bomb_patterns {
            if let Ok(re) = Regex::new(pattern) {
                if re.is_match(command) {
                    return true;
                }
            }
        }

        false
    }

    /// Check for dangerous redirects to device files
    fn has_dangerous_redirect(&self, command: &str) -> bool {
        let dangerous_devices = [
            "/dev/sda",
            "/dev/sdb",
            "/dev/sdc",
            "/dev/hda",
            "/dev/hdb",
            "/dev/nvme",
            "/dev/mem",
            "/dev/kmem",
        ];

        for device in dangerous_devices {
            if command.contains(&format!("> {}", device))
                || command.contains(&format!(">{}", device))
                || command.contains(&format!(">> {}", device))
                || command.contains(&format!(">>{}", device))
            {
                return true;
            }
        }

        false
    }

    /// Check if a command is in the dangerous commands list
    pub fn is_dangerous_command(&self, command: &str) -> bool {
        !self.check_command_safety(command).safe
    }

    /// Check if a command triggers any warning patterns
    pub fn has_warning(&self, command: &str) -> bool {
        self.check_command_safety(command).warning.is_some()
    }
}

// =============================================================================
// Foreground Execution Implementation (Requirements: 3.1, 3.5)
// =============================================================================

impl BashTool {
    /// Execute a command in the foreground with timeout
    ///
    /// Supports cross-platform execution:
    /// - Windows: Uses PowerShell or CMD
    /// - macOS/Linux: Uses sh -c
    ///
    /// Requirements: 3.1, 3.5
    pub async fn execute_foreground(
        &self,
        command: &str,
        timeout: Duration,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        // Check for cancellation
        if context.is_cancelled() {
            return Err(ToolError::Cancelled);
        }

        // Enforce maximum timeout
        let effective_timeout = if timeout.as_secs() > MAX_TIMEOUT_SECS {
            warn!(
                "Requested timeout {:?} exceeds maximum, using {} seconds",
                timeout, MAX_TIMEOUT_SECS
            );
            Duration::from_secs(MAX_TIMEOUT_SECS)
        } else {
            timeout
        };

        debug!(
            "Executing command with timeout {:?}: {}",
            effective_timeout, command
        );

        // Build the command based on platform
        let mut cmd = self.build_platform_command(command, context);

        // Execute with timeout
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

                debug!(
                    "Command completed with exit code {}, stdout: {} bytes, stderr: {} bytes",
                    exit_code,
                    stdout.len(),
                    stderr.len()
                );

                // Combine and truncate output
                let combined_output = self.format_output(&stdout, &stderr, exit_code);
                let truncated_output = self.truncate_output(&combined_output);

                if output.status.success() {
                    Ok(ToolResult::success(truncated_output)
                        .with_metadata("exit_code", serde_json::json!(exit_code))
                        .with_metadata("stdout_length", serde_json::json!(stdout.len()))
                        .with_metadata("stderr_length", serde_json::json!(stderr.len())))
                } else {
                    Ok(ToolResult::error(truncated_output)
                        .with_metadata("exit_code", serde_json::json!(exit_code))
                        .with_metadata("stdout_length", serde_json::json!(stdout.len()))
                        .with_metadata("stderr_length", serde_json::json!(stderr.len())))
                }
            }
            Ok(Err(e)) => {
                warn!("Command execution failed: {}", e);
                Err(ToolError::execution_failed(format!(
                    "Failed to execute command: {}",
                    e
                )))
            }
            Err(_) => {
                warn!("Command timed out after {:?}", effective_timeout);
                Err(ToolError::timeout(effective_timeout))
            }
        }
    }

    /// Build a platform-specific command
    fn build_platform_command(&self, command: &str, context: &ToolContext) -> Command {
        let mut cmd = if cfg!(target_os = "windows") {
            // Try PowerShell first, fall back to CMD
            let mut cmd = Command::new("powershell");
            cmd.args(["-NoProfile", "-NonInteractive", "-Command", command]);
            cmd
        } else {
            // Unix-like systems (macOS, Linux)
            let mut cmd = Command::new("sh");
            cmd.args(["-c", command]);
            cmd
        };

        // Set working directory
        cmd.current_dir(&context.working_directory);

        // Set environment variables
        cmd.env("ASTER_TERMINAL", "1");
        for (key, value) in &context.environment {
            cmd.env(key, value);
        }

        // Apply sandbox environment if configured
        if let Some(ref sandbox) = self.sandbox_config {
            for (key, value) in &sandbox.environment {
                cmd.env(key, value);
            }
        }

        cmd
    }

    /// Format command output combining stdout and stderr
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
}

// =============================================================================
// Background Execution Implementation (Requirements: 3.4)
// =============================================================================

impl BashTool {
    /// Execute a command in the background
    ///
    /// Returns a task_id that can be used to query status and output.
    /// The actual task management is delegated to TaskManager.
    ///
    /// Requirements: 3.4
    pub async fn execute_background(
        &self,
        command: &str,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        // Check for cancellation
        if context.is_cancelled() {
            return Err(ToolError::Cancelled);
        }

        // Delegate to task manager
        let task_id = self.task_manager.start(command, context).await?;
        let output_file = self.task_manager.get_output_file_path(&task_id).await;
        let output_file_text = output_file.as_ref().map(|path| path.display().to_string());

        let mut result = ToolResult::success(match output_file_text.as_deref() {
            Some(path) => format!(
                "Background task started with ID: {task_id}\nOutput file: {path}\nPrefer using the read tool on the output file path for logs; keep TaskOutput only as a compatibility fallback."
            ),
            None => format!("Background task started with ID: {task_id}"),
        })
        .with_metadata("task_id", serde_json::json!(task_id))
        .with_metadata("background", serde_json::json!(true));

        if let Some(path) = output_file_text {
            result = result.with_metadata("output_file", serde_json::json!(path));
        }

        Ok(result)
    }
}

// =============================================================================
// Tool Trait Implementation (Requirements: 3.6, 3.7, 3.8)
// =============================================================================

#[async_trait]
impl Tool for BashTool {
    /// Returns the tool name
    fn name(&self) -> &str {
        "Bash"
    }

    /// Returns the tool description
    fn description(&self) -> &str {
        "Execute shell commands with safety checks and timeout control. \
         Supports both foreground and background execution. \
         Use 'background: true' parameter for long-running commands."
    }

    /// Returns the JSON Schema for input parameters
    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The shell command to execute"
                },
                "timeout": {
                    "type": "integer",
                    "description": "Timeout in seconds (default: 300, max: 1800)",
                    "default": 300,
                    "minimum": 1,
                    "maximum": 1800
                },
                "background": {
                    "type": "boolean",
                    "description": "Run command in background and return task_id",
                    "default": false
                }
            },
            "required": ["command"]
        })
    }

    /// Execute the bash command
    ///
    /// Requirements: 3.6, 3.7
    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        // Extract command parameter
        let command = params
            .get("command")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::invalid_params("Missing required parameter: command"))?;

        // Extract timeout parameter (default: 300 seconds)
        let timeout_secs = params
            .get("timeout")
            .and_then(|v| v.as_u64())
            .unwrap_or(DEFAULT_TIMEOUT_SECS);
        let timeout = Duration::from_secs(timeout_secs);

        // Extract background parameter (default: false)
        let background = params
            .get("background")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        // Execute based on mode
        if background {
            self.execute_background(command, context).await
        } else {
            self.execute_foreground(command, timeout, context).await
        }
    }

    /// Check permissions before execution
    ///
    /// Performs safety check and returns appropriate permission result.
    ///
    /// Requirements: 3.8
    async fn check_permissions(
        &self,
        params: &serde_json::Value,
        _context: &ToolContext,
    ) -> PermissionCheckResult {
        // Extract command for safety check
        let command = match params.get("command").and_then(|v| v.as_str()) {
            Some(cmd) => cmd,
            None => return PermissionCheckResult::deny("Missing command parameter"),
        };

        // Perform safety check
        let safety_result = self.check_command_safety(command);

        if !safety_result.safe {
            let reason = safety_result
                .reason
                .unwrap_or_else(|| "Command blocked by safety check".to_string());
            return PermissionCheckResult::deny(reason);
        }

        // If there's a warning, ask for confirmation
        if let Some(warning) = safety_result.warning {
            return PermissionCheckResult::ask(format!(
                "Command may be dangerous: {}. Do you want to proceed?",
                warning
            ));
        }

        PermissionCheckResult::allow()
    }

    /// Get tool options
    fn options(&self) -> ToolOptions {
        ToolOptions::new()
            .with_max_retries(0) // Don't retry shell commands by default
            .with_base_timeout(Duration::from_secs(DEFAULT_TIMEOUT_SECS))
            .with_dynamic_timeout(false)
    }
}

// =============================================================================
// Output Truncation Implementation (Requirements: 3.9)
// =============================================================================

impl BashTool {
    /// Truncate output if it exceeds MAX_OUTPUT_LENGTH
    ///
    /// Adds a truncation indicator when output is truncated.
    ///
    /// Requirements: 3.9
    pub fn truncate_output(&self, output: &str) -> String {
        if output.len() <= MAX_OUTPUT_LENGTH {
            return output.to_string();
        }

        // Calculate how much to keep
        let truncation_message = format!(
            "\n\n... [Output truncated. Showing first {} of {} bytes]",
            MAX_OUTPUT_LENGTH,
            output.len()
        );
        let keep_length = MAX_OUTPUT_LENGTH - truncation_message.len();

        // Find a valid UTF-8 char boundary at or before keep_length
        let mut safe_length = keep_length;
        while safe_length > 0 && !output.is_char_boundary(safe_length) {
            safe_length -= 1;
        }

        // Try to truncate at a line boundary
        let truncated = output.get(..safe_length).unwrap_or(output);
        let last_newline = truncated.rfind('\n').unwrap_or(truncated.len());

        format!(
            "{}{}",
            output.get(..last_newline).unwrap_or(output),
            truncation_message
        )
    }

    /// Check if output would be truncated
    pub fn would_truncate(&self, output: &str) -> bool {
        output.len() > MAX_OUTPUT_LENGTH
    }
}

// =============================================================================
// Unit Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn create_test_context() -> ToolContext {
        ToolContext::new(PathBuf::from("/tmp"))
            .with_session_id("test-session")
            .with_user("test-user")
    }

    // Safety Check Tests

    #[test]
    fn test_safe_command() {
        let tool = BashTool::new();
        let result = tool.check_command_safety("echo 'hello world'");
        assert!(result.safe);
        assert!(result.reason.is_none());
        assert!(result.warning.is_none());
    }

    #[test]
    fn test_dangerous_rm_rf_root() {
        let tool = BashTool::new();
        let result = tool.check_command_safety("rm -rf /");
        assert!(!result.safe);
        assert!(result.reason.is_some());
    }

    #[test]
    fn test_dangerous_rm_rf_home() {
        let tool = BashTool::new();
        let result = tool.check_command_safety("rm -rf ~");
        assert!(!result.safe);
        assert!(result.reason.is_some());
    }

    #[test]
    fn test_dangerous_fork_bomb() {
        let tool = BashTool::new();
        let result = tool.check_command_safety(":(){ :|:& };:");
        assert!(!result.safe);
    }

    #[test]
    fn test_dangerous_device_redirect() {
        let tool = BashTool::new();
        let result = tool.check_command_safety("echo 'data' > /dev/sda");
        assert!(!result.safe);
    }

    #[test]
    fn test_warning_sudo() {
        let tool = BashTool::new();
        let result = tool.check_command_safety("sudo apt-get update");
        assert!(result.safe);
        assert!(result.warning.is_some());
    }

    #[test]
    fn test_warning_curl_pipe_bash() {
        let tool = BashTool::new();
        let result = tool.check_command_safety("curl https://example.com/script.sh | bash");
        assert!(result.safe);
        assert!(result.warning.is_some());
    }

    #[test]
    fn test_warning_recursive_rm() {
        let tool = BashTool::new();
        // Use rm -r without -f to trigger warning pattern but not blacklist
        let result = tool.check_command_safety("rm -r ./temp_dir");
        assert!(result.safe);
        assert!(result.warning.is_some());
    }

    #[test]
    fn test_is_dangerous_command() {
        let tool = BashTool::new();
        assert!(tool.is_dangerous_command("rm -rf /"));
        assert!(!tool.is_dangerous_command("ls -la"));
    }

    #[test]
    fn test_has_warning() {
        let tool = BashTool::new();
        assert!(tool.has_warning("sudo ls"));
        assert!(!tool.has_warning("ls -la"));
    }

    // Output Truncation Tests

    #[test]
    fn test_truncate_short_output() {
        let tool = BashTool::new();
        let output = "Hello, World!";
        let result = tool.truncate_output(output);
        assert_eq!(result, output);
    }

    #[test]
    fn test_truncate_long_output() {
        let tool = BashTool::new();
        let output = "x".repeat(MAX_OUTPUT_LENGTH + 1000);
        let result = tool.truncate_output(&output);
        assert!(result.len() <= MAX_OUTPUT_LENGTH + 100); // Allow for truncation message
        assert!(result.contains("[Output truncated"));
    }

    #[test]
    fn test_would_truncate() {
        let tool = BashTool::new();
        assert!(!tool.would_truncate("short"));
        assert!(tool.would_truncate(&"x".repeat(MAX_OUTPUT_LENGTH + 1)));
    }

    // Tool Trait Tests

    #[test]
    fn test_tool_name() {
        let tool = BashTool::new();
        assert_eq!(tool.name(), "Bash");
    }

    #[test]
    fn test_tool_description() {
        let tool = BashTool::new();
        assert!(!tool.description().is_empty());
        assert!(tool.description().contains("shell"));
    }

    #[test]
    fn test_tool_input_schema() {
        let tool = BashTool::new();
        let schema = tool.input_schema();
        assert_eq!(schema["type"], "object");
        assert!(schema["properties"]["command"].is_object());
        assert!(schema["properties"]["timeout"].is_object());
        assert!(schema["properties"]["background"].is_object());
    }

    #[test]
    fn test_tool_options() {
        let tool = BashTool::new();
        let options = tool.options();
        assert_eq!(options.max_retries, 0);
        assert_eq!(
            options.base_timeout,
            Duration::from_secs(DEFAULT_TIMEOUT_SECS)
        );
    }

    // Permission Check Tests

    #[tokio::test]
    async fn test_check_permissions_safe_command() {
        let tool = BashTool::new();
        let context = create_test_context();
        let params = serde_json::json!({"command": "echo 'hello'"});

        let result = tool.check_permissions(&params, &context).await;
        assert!(result.is_allowed());
    }

    #[tokio::test]
    async fn test_check_permissions_dangerous_command() {
        let tool = BashTool::new();
        let context = create_test_context();
        let params = serde_json::json!({"command": "rm -rf /"});

        let result = tool.check_permissions(&params, &context).await;
        assert!(result.is_denied());
    }

    #[tokio::test]
    async fn test_check_permissions_warning_command() {
        let tool = BashTool::new();
        let context = create_test_context();
        let params = serde_json::json!({"command": "sudo ls"});

        let result = tool.check_permissions(&params, &context).await;
        assert!(result.requires_confirmation());
    }

    #[tokio::test]
    async fn test_check_permissions_missing_command() {
        let tool = BashTool::new();
        let context = create_test_context();
        let params = serde_json::json!({});

        let result = tool.check_permissions(&params, &context).await;
        assert!(result.is_denied());
    }

    // Execution Tests

    #[tokio::test]
    async fn test_execute_simple_command() {
        let tool = BashTool::new();
        let context = create_test_context();
        let params = serde_json::json!({
            "command": "echo 'hello world'"
        });

        let result = tool.execute(params, &context).await;
        assert!(result.is_ok());
        let tool_result = result.unwrap();
        assert!(tool_result.is_success());
        assert!(tool_result.output.unwrap().contains("hello world"));
    }

    #[tokio::test]
    async fn test_execute_with_exit_code() {
        let tool = BashTool::new();
        let context = create_test_context();
        let params = serde_json::json!({
            "command": "exit 1"
        });

        let result = tool.execute(params, &context).await;
        assert!(result.is_ok());
        let tool_result = result.unwrap();
        assert!(tool_result.is_error());
        assert_eq!(
            tool_result.metadata.get("exit_code"),
            Some(&serde_json::json!(1))
        );
    }

    #[tokio::test]
    async fn test_execute_missing_command() {
        let tool = BashTool::new();
        let context = create_test_context();
        let params = serde_json::json!({});

        let result = tool.execute(params, &context).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::InvalidParams(_)));
    }

    #[tokio::test]
    async fn test_execute_with_timeout() {
        let tool = BashTool::new();
        let context = create_test_context();

        // Use a very short timeout
        let params = serde_json::json!({
            "command": if cfg!(target_os = "windows") { "timeout /t 5" } else { "sleep 5" },
            "timeout": 1
        });

        let result = tool.execute(params, &context).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::Timeout(_)));
    }

    #[tokio::test]
    async fn test_execute_background() {
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let task_manager =
            Arc::new(TaskManager::new().with_output_directory(temp_dir.path().to_path_buf()));
        let tool = BashTool::with_task_manager(task_manager.clone());
        let context = create_test_context();
        let params = serde_json::json!({
            "command": "echo 'hello'",
            "background": true
        });

        let result = tool.execute(params, &context).await;
        // Background execution is now implemented
        assert!(result.is_ok());
        let tool_result = result.unwrap();
        assert!(tool_result.is_success());
        assert!(tool_result.metadata.contains_key("task_id"));
        assert!(tool_result.metadata.contains_key("background"));
        assert!(tool_result.metadata.contains_key("output_file"));

        // Clean up
        let _ = task_manager.kill_all().await;
    }

    // Builder Tests

    #[test]
    fn test_builder_with_task_manager() {
        let task_manager = Arc::new(TaskManager::new());
        let tool = BashTool::with_task_manager(task_manager.clone());
        assert!(Arc::ptr_eq(&tool.task_manager, &task_manager));
    }

    #[test]
    fn test_builder_with_sandbox() {
        let sandbox = SandboxConfig {
            enabled: true,
            allowed_directories: vec!["/tmp".to_string()],
            environment: std::collections::HashMap::new(),
        };
        let tool = BashTool::new().with_sandbox(sandbox);
        assert!(tool.sandbox_config.is_some());
        assert!(tool.sandbox_config.unwrap().enabled);
    }

    #[test]
    fn test_builder_with_dangerous_commands() {
        let commands = vec!["custom_dangerous".to_string()];
        let tool = BashTool::new().with_dangerous_commands(commands);
        assert!(tool.is_dangerous_command("custom_dangerous"));
    }

    #[test]
    fn test_add_dangerous_commands() {
        let mut tool = BashTool::new();
        tool.add_dangerous_commands(vec!["new_dangerous".to_string()]);
        assert!(tool.is_dangerous_command("new_dangerous"));
    }

    // Format Output Tests

    #[test]
    fn test_format_output_stdout_only() {
        let tool = BashTool::new();
        let result = tool.format_output("stdout content", "", 0);
        assert_eq!(result, "stdout content");
    }

    #[test]
    fn test_format_output_stderr_only() {
        let tool = BashTool::new();
        let result = tool.format_output("", "stderr content", 1);
        assert_eq!(result, "stderr content");
    }

    #[test]
    fn test_format_output_both() {
        let tool = BashTool::new();
        let result = tool.format_output("stdout", "stderr", 0);
        assert!(result.contains("stdout"));
        assert!(result.contains("stderr"));
    }

    #[test]
    fn test_format_output_empty_with_error() {
        let tool = BashTool::new();
        let result = tool.format_output("", "", 1);
        assert!(result.contains("exited with code 1"));
    }

    // Safety Check Result Tests

    #[test]
    fn test_safety_check_result_safe() {
        let result = SafetyCheckResult::safe();
        assert!(result.safe);
        assert!(result.reason.is_none());
        assert!(result.warning.is_none());
    }

    #[test]
    fn test_safety_check_result_safe_with_warning() {
        let result = SafetyCheckResult::safe_with_warning("Be careful");
        assert!(result.safe);
        assert!(result.reason.is_none());
        assert_eq!(result.warning, Some("Be careful".to_string()));
    }

    #[test]
    fn test_safety_check_result_unsafe() {
        let result = SafetyCheckResult::unsafe_with_reason("Dangerous");
        assert!(!result.safe);
        assert_eq!(result.reason, Some("Dangerous".to_string()));
        assert!(result.warning.is_none());
    }
}
