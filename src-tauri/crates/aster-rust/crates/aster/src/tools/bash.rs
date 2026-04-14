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

use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tokio::process::Command;
use tracing::{debug, warn};

use super::base::{PermissionCheckResult, Tool};
use super::command_semantics::interpret_bash_command_result;
use super::context::{ToolContext, ToolOptions, ToolResult};
use super::error::ToolError;
use super::path_guard::{
    evaluate_path_mutations, resolve_static_path_candidate, summarize_paths, summarize_raw_paths,
    PathGuardFinding, PathMutationCandidate, PathMutationKind,
};
use super::task::TaskManager;

/// Maximum output length before truncation (128KB)
pub const MAX_OUTPUT_LENGTH: usize = 128 * 1024;

/// Default timeout for command execution (5 minutes)
pub const DEFAULT_TIMEOUT_SECS: u64 = 300;

/// Maximum timeout allowed (30 minutes)
pub const MAX_TIMEOUT_SECS: u64 = 1800;

static SHELL_ENV_ASSIGN_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^[A-Za-z_]\w*=").expect("valid env assign regex"));
static BASH_WRITE_REDIRECTION_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r#"(?x)
        (?:^|[\s;(])
        (?:\d+|&)?(?:>>?|>\|)
        \s*
        (?P<target>'[^']*'|"[^"]*"|[^\s;&|()]+)
    "#,
    )
    .expect("valid bash write redirection regex")
});
static BASH_SED_IN_PLACE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\bsed\b[^\n;|&]*(?:\s--in-place(?:=\S+)?|\s-[A-Za-z]*i[A-Za-z]*)")
        .expect("valid sed in-place regex")
});

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

        if let Some(reason) = self.detect_high_risk_command_reason(command_trimmed) {
            return SafetyCheckResult::unsafe_with_reason(reason);
        }

        // Check against warning patterns
        let mut warnings = Vec::new();
        for pattern in &self.warning_patterns {
            if pattern.is_match(command_trimmed) {
                warnings.push(format!("Matches warning pattern: {}", pattern.as_str()));
            }
        }

        if let Some(warning) = self.detect_mutating_command_warning(command_trimmed) {
            warnings.push(warning);
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

    fn detect_high_risk_command_reason(&self, command: &str) -> Option<String> {
        for segment in split_shell_segments(command) {
            let words = extract_bash_command_words(segment);
            if words.is_empty() {
                continue;
            }

            if words[0] != "git" {
                continue;
            }

            let subcommand = words.get(1).map(String::as_str).unwrap_or("");
            match subcommand {
                "reset" if words.iter().any(|word| word == "--hard") => {
                    return Some(
                        "Blocked: `git reset --hard` is a destructive repository operation."
                            .to_string(),
                    );
                }
                "clean" if is_forced_git_clean(&words) => {
                    return Some(
                        "Blocked: forced `git clean` may permanently remove untracked files."
                            .to_string(),
                    );
                }
                "push" if words.iter().any(|word| word == "--force" || word == "-f") => {
                    return Some(
                        "Blocked: force-pushing git history requires explicit manual confirmation."
                            .to_string(),
                    );
                }
                _ => {}
            }
        }

        None
    }

    fn detect_mutating_command_warning(&self, command: &str) -> Option<String> {
        if has_bash_write_redirection(command) {
            return Some("Command writes to files via shell redirection".to_string());
        }

        for segment in split_shell_segments(command) {
            let words = extract_bash_command_words(segment);
            if words.is_empty() {
                continue;
            }

            let command_name = words[0].as_str();
            if command_name == "sed" && segment_has_sed_in_place(segment) {
                return Some("Command performs in-place edits via `sed -i`".to_string());
            }

            if command_name == "tee" && tee_writes_to_file(&words) {
                return Some("Command writes to files via `tee`".to_string());
            }

            if command_name == "dd"
                && words
                    .iter()
                    .any(|word| word.to_ascii_lowercase().starts_with("of="))
            {
                return Some("Command writes to files via `dd of=...`".to_string());
            }

            if is_mutating_shell_command(command_name) {
                return Some(format!("Command may modify files via `{command_name}`"));
            }

            if command_name == "git" {
                let subcommand = words.get(1).map(String::as_str).unwrap_or("");
                if is_mutating_git_subcommand(subcommand) {
                    return Some(format!(
                        "Command modifies repository state via `git {subcommand}`"
                    ));
                }
            }
        }

        None
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

fn split_shell_segments(command: &str) -> Vec<&str> {
    let mut segments = Vec::new();
    let mut start = 0usize;
    let mut in_single = false;
    let mut in_double = false;
    let mut chars = command.char_indices().peekable();

    while let Some((index, ch)) = chars.next() {
        match ch {
            '\'' if !in_double => in_single = !in_single,
            '"' if !in_single => in_double = !in_double,
            ';' | '\n' if !in_single && !in_double => {
                let segment = command[start..index].trim();
                if !segment.is_empty() {
                    segments.push(segment);
                }
                start = index + ch.len_utf8();
            }
            '&' if !in_single && !in_double => {
                if let Some((next_index, next_char)) = chars.peek().copied() {
                    if next_char == '&' {
                        let segment = command[start..index].trim();
                        if !segment.is_empty() {
                            segments.push(segment);
                        }
                        let _ = chars.next();
                        start = next_index + next_char.len_utf8();
                    }
                }
            }
            '|' if !in_single && !in_double => {
                let segment = command[start..index].trim();
                if !segment.is_empty() {
                    segments.push(segment);
                }
                if let Some((next_index, next_char)) = chars.peek().copied() {
                    if next_char == '|' {
                        let _ = chars.next();
                        start = next_index + next_char.len_utf8();
                    } else {
                        start = index + ch.len_utf8();
                    }
                } else {
                    start = index + ch.len_utf8();
                }
            }
            _ => {}
        }
    }

    let rest = command[start..].trim();
    if !rest.is_empty() {
        segments.push(rest);
    }

    segments
}

fn normalize_shell_word(word: &str) -> String {
    word.trim_matches(|ch| matches!(ch, '"' | '\'' | '`' | '(' | ')' | ','))
        .to_ascii_lowercase()
}

fn skip_shell_command_prefix(raw_words: &[String]) -> usize {
    let mut index = 0usize;
    while index < raw_words.len() {
        let normalized = normalize_shell_word(&raw_words[index]);
        if SHELL_ENV_ASSIGN_RE.is_match(&normalized) || is_shell_wrapper_command(&normalized) {
            index += 1;
            continue;
        }
        break;
    }
    index
}

fn extract_bash_command_words(segment: &str) -> Vec<String> {
    let raw_words = segment
        .split_whitespace()
        .map(normalize_shell_word)
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>();
    let start_index = skip_shell_command_prefix(&raw_words);

    raw_words.into_iter().skip(start_index).collect()
}

fn is_shell_wrapper_command(word: &str) -> bool {
    matches!(
        word,
        "sudo" | "env" | "command" | "builtin" | "nohup" | "nice" | "stdbuf" | "timeout" | "time"
    )
}

fn has_bash_write_redirection(command: &str) -> bool {
    BASH_WRITE_REDIRECTION_RE
        .captures_iter(command)
        .any(|captures| {
            let Some(target) = captures.name("target") else {
                return false;
            };
            !is_safe_shell_sink(target.as_str())
        })
}

fn is_safe_shell_sink(target: &str) -> bool {
    let normalized = normalize_shell_word(target);
    matches!(
        normalized.as_str(),
        "&1" | "&2" | "/dev/null" | "/dev/stdout" | "/dev/stderr" | "/dev/tty" | "nul"
    )
}

fn segment_has_sed_in_place(segment: &str) -> bool {
    BASH_SED_IN_PLACE_RE.is_match(segment)
}

fn tee_writes_to_file(words: &[String]) -> bool {
    words
        .iter()
        .skip(1)
        .filter(|word| !word.starts_with('-'))
        .any(|word| !is_safe_shell_sink(word))
}

fn is_mutating_shell_command(command_name: &str) -> bool {
    matches!(
        command_name,
        "rm" | "rmdir"
            | "mv"
            | "cp"
            | "install"
            | "mkdir"
            | "touch"
            | "chmod"
            | "chown"
            | "chgrp"
            | "ln"
            | "unlink"
            | "truncate"
    )
}

fn is_mutating_git_subcommand(subcommand: &str) -> bool {
    matches!(
        subcommand,
        "add"
            | "am"
            | "apply"
            | "branch"
            | "checkout"
            | "cherry-pick"
            | "clean"
            | "commit"
            | "merge"
            | "mv"
            | "pull"
            | "push"
            | "rebase"
            | "reset"
            | "restore"
            | "revert"
            | "rm"
            | "stash"
            | "switch"
            | "tag"
    )
}

fn is_forced_git_clean(words: &[String]) -> bool {
    let has_force = words
        .iter()
        .any(|word| word.starts_with('-') && word.contains('f'));
    let has_scope = words.iter().any(|word| {
        word.starts_with('-') && (word.contains('d') || word.contains('x') || word.contains('X'))
    });
    has_force && has_scope
}

fn validate_bash_command_paths(command: &str, cwd: &Path) -> Option<PermissionCheckResult> {
    let candidates = collect_bash_path_candidates(command);
    match evaluate_path_mutations(&candidates, cwd)? {
        PathGuardFinding::ProtectedPaths(paths) => Some(PermissionCheckResult::deny(format!(
            "Blocked: command targets protected path(s): {}",
            summarize_paths(&paths)
        ))),
        PathGuardFinding::OutsideWorkspace(paths) => Some(PermissionCheckResult::ask(format!(
            "Command modifies path(s) outside the current working directory: {}. Do you want to proceed?",
            summarize_paths(&paths)
        ))),
        PathGuardFinding::DynamicPaths(paths) => Some(PermissionCheckResult::ask(format!(
            "Command uses path expression(s) that cannot be validated safely: {}. Do you want to proceed?",
            summarize_raw_paths(&paths)
        ))),
    }
}

fn collect_bash_path_candidates(command: &str) -> Vec<PathMutationCandidate> {
    let mut candidates = BASH_WRITE_REDIRECTION_RE
        .captures_iter(command)
        .filter_map(|captures| captures.name("target"))
        .map(|target| PathMutationCandidate::new(target.as_str(), PathMutationKind::Write))
        .collect::<Vec<_>>();

    for segment in split_shell_segments(command) {
        let raw_words = tokenize_shell_words(segment);
        if raw_words.is_empty() {
            continue;
        }
        let normalized_words = normalize_command_words(&raw_words);
        let command_name = normalized_words[0].as_str();

        match command_name {
            "rm" | "rmdir" => {
                for target in extract_rm_targets(&raw_words) {
                    candidates.push(PathMutationCandidate::new(target, PathMutationKind::Remove));
                }
            }
            "tee" => {
                for target in extract_tee_targets(&raw_words) {
                    candidates.push(PathMutationCandidate::new(target, PathMutationKind::Write));
                }
            }
            "dd" => {
                for target in extract_dd_output_targets(&raw_words) {
                    candidates.push(PathMutationCandidate::new(target, PathMutationKind::Write));
                }
            }
            "sed" if segment_has_sed_in_place(segment) => {
                for target in extract_sed_in_place_targets(&raw_words) {
                    candidates.push(PathMutationCandidate::new(target, PathMutationKind::Write));
                }
            }
            _ => {}
        }
    }

    candidates
}

fn extract_bash_read_targets(raw_words: &[String], command_name: &str) -> Vec<String> {
    let start_index = skip_shell_command_prefix(raw_words);
    if raw_words.len() <= start_index + 1 {
        return Vec::new();
    }

    let mut positional_targets = Vec::new();
    let mut after_double_dash = false;

    for word in raw_words.iter().skip(start_index + 1) {
        if !after_double_dash && word == "--" {
            after_double_dash = true;
            continue;
        }

        let normalized = normalize_shell_word(word);
        if !after_double_dash && normalized.starts_with('-') {
            continue;
        }

        positional_targets.push(word.clone());
    }

    match command_name {
        "cat" | "bat" | "head" | "tail" | "wc" | "ls" | "dir" | "tree" => {
            positional_targets.into_iter().rev().take(1).collect()
        }
        "rg" | "grep" | "findstr" if positional_targets.len() >= 2 => {
            positional_targets.into_iter().rev().take(1).collect()
        }
        _ => Vec::new(),
    }
}

fn collect_bash_read_path_candidates(command: &str) -> Vec<String> {
    let mut candidates = Vec::new();

    for segment in split_shell_segments(command) {
        let raw_words = tokenize_shell_words(segment);
        if raw_words.is_empty() {
            continue;
        }

        let normalized_words = normalize_command_words(&raw_words);
        if normalized_words.is_empty() {
            continue;
        }

        let command_name = normalized_words[0].as_str();
        candidates.extend(extract_bash_read_targets(&raw_words, command_name));
    }

    candidates
}

fn is_known_read_only_bash_command(command_name: &str, words: &[String]) -> bool {
    match command_name {
        "cat" | "bat" | "head" | "tail" | "wc" | "ls" | "dir" | "tree" | "rg" | "grep"
        | "findstr" | "find" | "pwd" | "realpath" | "readlink" | "stat" | "file" | "du"
        | "which" | "cut" | "sort" | "uniq" | "tr" | "awk" | "jq" | "basename" | "dirname"
        | "test" | "[" => true,
        "sed" => true,
        "git" => matches!(
            words.get(1).map(String::as_str).unwrap_or(""),
            "status" | "diff" | "show" | "log" | "rev-parse" | "ls-files" | "grep" | "blame"
        ),
        _ => false,
    }
}

pub fn is_bash_command_concurrency_safe(command: &str) -> bool {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return false;
    }

    if has_bash_write_redirection(trimmed) {
        return false;
    }

    let mut saw_segment = false;
    for segment in split_shell_segments(trimmed) {
        let words = extract_bash_command_words(segment);
        if words.is_empty() {
            continue;
        }
        saw_segment = true;

        let command_name = words[0].as_str();
        if command_name == "sed" && segment_has_sed_in_place(segment) {
            return false;
        }
        if command_name == "tee" && tee_writes_to_file(&words) {
            return false;
        }
        if command_name == "dd"
            && words
                .iter()
                .any(|word| word.to_ascii_lowercase().starts_with("of="))
        {
            return false;
        }
        if is_mutating_shell_command(command_name) {
            return false;
        }
        if command_name == "git"
            && is_mutating_git_subcommand(words.get(1).map(String::as_str).unwrap_or(""))
        {
            return false;
        }
        if !is_known_read_only_bash_command(command_name, &words) {
            return false;
        }
    }

    saw_segment
}

fn build_missing_read_target_result(paths: &[std::path::PathBuf]) -> ToolResult {
    let path_values = paths
        .iter()
        .map(|path| path.display().to_string())
        .collect::<Vec<_>>();
    let message = if path_values.len() == 1 {
        format!(
            "路径不存在：{}。请先确认父目录，或先列目录再继续读取。",
            path_values[0]
        )
    } else {
        format!(
            "以下路径不存在：{}。请先确认父目录，或先列目录再继续读取。",
            path_values.join(", ")
        )
    };

    ToolResult::error(message)
        .with_metadata("preflight_check", serde_json::json!("missing_read_target"))
        .with_metadata("missing_paths", serde_json::json!(path_values))
}

pub fn preflight_bash_read_targets(command: &str, cwd: &Path) -> Option<ToolResult> {
    let mut missing_paths = Vec::new();

    for raw_path in collect_bash_read_path_candidates(command) {
        let Some(resolved_path) = resolve_static_path_candidate(&raw_path, cwd) else {
            continue;
        };
        if resolved_path.exists() || missing_paths.contains(&resolved_path) {
            continue;
        }
        missing_paths.push(resolved_path);
    }

    (!missing_paths.is_empty()).then(|| build_missing_read_target_result(&missing_paths))
}

fn tokenize_shell_words(segment: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut current = String::new();
    let mut in_single = false;
    let mut in_double = false;
    let mut escaped = false;

    for ch in segment.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }

        match ch {
            '\\' if !in_single => {
                escaped = true;
            }
            '\'' if !in_double => {
                in_single = !in_single;
            }
            '"' if !in_single => {
                in_double = !in_double;
            }
            ch if ch.is_whitespace() && !in_single && !in_double => {
                if !current.is_empty() {
                    words.push(std::mem::take(&mut current));
                }
            }
            _ => current.push(ch),
        }
    }

    if !current.is_empty() {
        words.push(current);
    }

    words
}

fn normalize_command_words(raw_words: &[String]) -> Vec<String> {
    let words = raw_words
        .iter()
        .map(|word| normalize_shell_word(word))
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>();
    let start_index = skip_shell_command_prefix(raw_words);
    words.into_iter().skip(start_index).collect()
}

fn extract_rm_targets(raw_words: &[String]) -> Vec<String> {
    if raw_words.len() <= 1 {
        return Vec::new();
    }

    let mut targets = Vec::new();
    let mut after_double_dash = false;

    for word in raw_words.iter().skip(1) {
        if after_double_dash {
            targets.push(word.clone());
            continue;
        }
        if word == "--" {
            after_double_dash = true;
            continue;
        }
        if word.starts_with('-') {
            continue;
        }
        targets.push(word.clone());
    }

    targets
}

fn extract_tee_targets(raw_words: &[String]) -> Vec<String> {
    raw_words
        .iter()
        .skip(1)
        .filter(|word| word.as_str() != "--")
        .filter(|word| !word.starts_with('-'))
        .filter(|word| !is_safe_shell_sink(word))
        .cloned()
        .collect()
}

fn extract_dd_output_targets(raw_words: &[String]) -> Vec<String> {
    raw_words
        .iter()
        .skip(1)
        .filter_map(|word| word.strip_prefix("of=").map(ToOwned::to_owned))
        .collect()
}

fn extract_sed_in_place_targets(raw_words: &[String]) -> Vec<String> {
    if raw_words.len() <= 1 {
        return Vec::new();
    }

    let mut non_flag_words = Vec::new();
    let mut after_double_dash = false;

    for word in raw_words.iter().skip(1) {
        if after_double_dash {
            non_flag_words.push(word.clone());
            continue;
        }
        if word == "--" {
            after_double_dash = true;
            continue;
        }
        if word.starts_with('-') {
            continue;
        }
        non_flag_words.push(word.clone());
    }

    non_flag_words.into_iter().skip(1).collect()
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

                let interpretation =
                    interpret_bash_command_result(command, exit_code, &stdout, &stderr);

                // Combine and truncate output
                let combined_output = self.format_output_with_message(
                    &stdout,
                    &stderr,
                    exit_code,
                    interpretation.message.as_deref(),
                );
                let truncated_output = self.truncate_output(&combined_output);

                if interpretation.is_error {
                    Ok(ToolResult::error(truncated_output)
                        .with_metadata("exit_code", serde_json::json!(exit_code))
                        .with_metadata("stdout_length", serde_json::json!(stdout.len()))
                        .with_metadata("stderr_length", serde_json::json!(stderr.len())))
                } else {
                    let mut result = ToolResult::success(truncated_output)
                        .with_metadata("exit_code", serde_json::json!(exit_code))
                        .with_metadata("stdout_length", serde_json::json!(stdout.len()))
                        .with_metadata("stderr_length", serde_json::json!(stderr.len()));
                    if exit_code != 0 {
                        result = result.with_metadata("reported_success", serde_json::json!(true));
                    }
                    Ok(result)
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
        self.format_output_with_message(stdout, stderr, exit_code, None)
    }

    fn format_output_with_message(
        &self,
        stdout: &str,
        stderr: &str,
        exit_code: i32,
        fallback_message: Option<&str>,
    ) -> String {
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

        if output.is_empty() {
            if let Some(message) = fallback_message {
                output = message.to_string();
            } else if exit_code != 0 {
                output = format!("Command exited with code {}", exit_code);
            }
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

    fn dynamic_description(&self) -> Option<String> {
        Some(
            [
                self.description().to_string(),
                String::new(),
                "IMPORTANT: Prefer Read / Glob / Grep for file inspection before reaching for shell commands.".to_string(),
                "Do not guess file paths. If you are not sure whether a target exists, list or search the parent directory first.".to_string(),
            ]
            .join("\n"),
        )
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

        if !background {
            if let Some(preflight_result) =
                preflight_bash_read_targets(command, &context.working_directory)
            {
                return Ok(preflight_result);
            }
        }

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
        context: &ToolContext,
    ) -> PermissionCheckResult {
        // Extract command for safety check
        let command = match params.get("command").and_then(|v| v.as_str()) {
            Some(cmd) => cmd,
            None => return PermissionCheckResult::deny("Missing command parameter"),
        };

        // Perform safety check
        let safety_result = self.check_command_safety(command);

        if let Some(path_result) = validate_bash_command_paths(command, &context.working_directory)
        {
            return path_result;
        }

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
    fn test_tool_definition_mentions_path_guidance() {
        let tool = BashTool::new();
        let definition = tool.get_definition();
        assert!(definition.description.contains("Do not guess file paths"));
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
    async fn test_check_permissions_write_redirection_requires_confirmation() {
        let tool = BashTool::new();
        let context = create_test_context();
        let params = serde_json::json!({"command": "echo hello > note.txt"});

        let result = tool.check_permissions(&params, &context).await;
        assert!(result.requires_confirmation());
    }

    #[tokio::test]
    async fn test_check_permissions_write_outside_workspace_mentions_path_scope() {
        let tool = BashTool::new();
        let context = ToolContext::new(PathBuf::from("/tmp/project"));
        let params = serde_json::json!({"command": "echo hello > ../note.txt"});

        let result = tool.check_permissions(&params, &context).await;
        assert!(result.requires_confirmation());
        assert!(result
            .message
            .as_deref()
            .unwrap_or_default()
            .contains("outside the current working directory"));
    }

    #[tokio::test]
    async fn test_check_permissions_sed_in_place_requires_confirmation() {
        let tool = BashTool::new();
        let context = create_test_context();
        let params = serde_json::json!({"command": "sed -i 's/a/b/' file.txt"});

        let result = tool.check_permissions(&params, &context).await;
        assert!(result.requires_confirmation());
    }

    #[tokio::test]
    async fn test_check_permissions_git_reset_hard_is_denied() {
        let tool = BashTool::new();
        let context = create_test_context();
        let params = serde_json::json!({"command": "git reset --hard HEAD~1"});

        let result = tool.check_permissions(&params, &context).await;
        assert!(result.is_denied());
    }

    #[tokio::test]
    async fn test_check_permissions_relative_root_removal_is_denied() {
        let tool = BashTool::new();
        let context = ToolContext::new(PathBuf::from("/tmp/project"));
        let params = serde_json::json!({"command": "rm -rf ../../"});

        let result = tool.check_permissions(&params, &context).await;
        assert!(result.is_denied());
        assert!(result
            .message
            .as_deref()
            .unwrap_or_default()
            .contains("protected path"));
    }

    #[tokio::test]
    async fn test_check_permissions_dev_null_redirection_stays_allowed() {
        let tool = BashTool::new();
        let context = create_test_context();
        let params = serde_json::json!({"command": "grep foo file.txt >/dev/null"});

        let result = tool.check_permissions(&params, &context).await;
        assert!(result.is_allowed());
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

    #[tokio::test]
    async fn test_execute_preflights_missing_head_target() {
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let missing_path = temp_dir.path().join("missing.txt");
        let tool = BashTool::new();
        let context = ToolContext::new(temp_dir.path().to_path_buf());
        let params = serde_json::json!({
            "command": format!("head -20 {}", missing_path.display())
        });

        let result = tool.execute(params, &context).await.unwrap();
        assert!(result.is_error());
        assert!(result.message().unwrap_or_default().contains("路径不存在"));
        assert_eq!(
            result.metadata.get("preflight_check"),
            Some(&serde_json::json!("missing_read_target"))
        );
    }

    #[test]
    fn test_is_bash_command_concurrency_safe_for_read_only_pipeline() {
        assert!(is_bash_command_concurrency_safe(
            "rg \"Agent\" src | head -n 5"
        ));
    }

    #[test]
    fn test_is_bash_command_concurrency_safe_rejects_mutation() {
        assert!(!is_bash_command_concurrency_safe("mkdir tmp-output"));
        assert!(!is_bash_command_concurrency_safe("git checkout main"));
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

    #[test]
    fn test_format_output_empty_with_semantic_message() {
        let tool = BashTool::new();
        let result = tool.format_output_with_message("", "", 1, Some("No matches found"));
        assert_eq!(result, "No matches found");
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
