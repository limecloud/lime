//! PowerShell current surface tool
//!
//! 对齐当前工具面：
//! - PowerShell

use super::base::{PermissionCheckResult, Tool};
use super::command_semantics::interpret_powershell_command_result;
use super::context::{ToolContext, ToolOptions, ToolResult};
use super::error::ToolError;
use super::path_guard::{
    evaluate_path_mutations, resolve_static_path_candidate, summarize_paths, summarize_raw_paths,
    PathGuardFinding, PathMutationCandidate, PathMutationKind,
};
use super::task::{TaskManager, TaskShell};
use async_trait::async_trait;
use once_cell::sync::Lazy;
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

static POWERSHELL_WRITE_REDIRECTION_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r#"(?x)
        (?:^|[\s;(])
        (?:\d+)?(?:>>?|>\|)
        \s*
        (?P<target>'[^']*'|"[^"]*"|[^\s;&|()]+)
    "#,
    )
    .expect("valid powershell write redirection regex")
});
static POWERSHELL_SYMLINK_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r#"(?ix)
        \b(?:new-item|ni)\b
        [^\n;|&]*
        (?:-itemtype|-type|-it(?:emtype)?|-ty(?:pe)?)
        \s*(?::|=|\s)\s*
        ['"]?(symboliclink|junction|hardlink)
    "#,
    )
    .expect("valid powershell symlink regex")
});

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
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

    fn check_command_safety(&self, command: &str) -> SafetyCheckResult {
        let command_trimmed = command.trim();
        if command_trimmed.is_empty() {
            return SafetyCheckResult::deny("Command cannot be empty");
        }

        if let Some(reason) = detect_high_risk_powershell_reason(command_trimmed) {
            return SafetyCheckResult::deny(reason);
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

        if let Some(warning) = detect_mutating_powershell_warning(command_trimmed) {
            return SafetyCheckResult::warn(warning);
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
                let interpretation =
                    interpret_powershell_command_result(command, exit_code, &stdout, &stderr);
                let formatted = self.truncate_output(&self.format_output_with_message(
                    &stdout,
                    &stderr,
                    exit_code,
                    interpretation.message.as_deref(),
                ));

                if interpretation.is_error {
                    Ok(ToolResult::error(formatted)
                        .with_metadata("exit_code", json!(exit_code))
                        .with_metadata("stdout_length", json!(stdout.len()))
                        .with_metadata("stderr_length", json!(stderr.len())))
                } else {
                    let mut result = ToolResult::success(formatted)
                        .with_metadata("exit_code", json!(exit_code))
                        .with_metadata("stdout_length", json!(stdout.len()))
                        .with_metadata("stderr_length", json!(stderr.len()));
                    if exit_code != 0 {
                        result = result.with_metadata("reported_success", json!(true));
                    }
                    Ok(result)
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

fn split_powershell_segments(command: &str) -> Vec<&str> {
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

fn normalize_powershell_word(word: &str) -> String {
    word.trim_matches(|ch| matches!(ch, '"' | '\'' | '`' | '(' | ')' | ','))
        .to_ascii_lowercase()
}

fn resolve_powershell_alias(word: &str) -> &str {
    match word {
        "rm" | "del" | "erase" | "ri" => "remove-item",
        "mv" | "move" | "mi" => "move-item",
        "cp" | "copy" | "cpi" => "copy-item",
        "ren" | "rni" => "rename-item",
        "ni" | "mkdir" | "md" => "new-item",
        "sc" => "set-content",
        "ac" => "add-content",
        "tee" => "tee-object",
        "iwr" => "invoke-webrequest",
        "irm" => "invoke-restmethod",
        "cat" | "gc" | "type" => "get-content",
        "ls" | "dir" | "gci" => "get-childitem",
        "sls" => "select-string",
        "sl" | "cd" | "chdir" => "set-location",
        _ => word,
    }
}

fn extract_powershell_command_words(segment: &str) -> Vec<String> {
    let raw_words = segment
        .split_whitespace()
        .map(normalize_powershell_word)
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>();

    let mut index = 0usize;
    while index < raw_words.len() {
        let word = raw_words[index].as_str();
        if matches!(word, "&" | "." | "powershell" | "pwsh") {
            index += 1;
            continue;
        }
        break;
    }

    raw_words
        .into_iter()
        .skip(index)
        .map(|word| resolve_powershell_alias(&word).to_string())
        .collect()
}

fn is_safe_powershell_sink(target: &str) -> bool {
    let normalized = normalize_powershell_word(target);
    matches!(
        normalized.as_str(),
        "$null" | "nul" | "null:" | "[system.io.stream]::null" | "&1" | "&2"
    )
}

fn has_powershell_write_redirection(command: &str) -> bool {
    POWERSHELL_WRITE_REDIRECTION_RE
        .captures_iter(command)
        .any(|captures| {
            let Some(target) = captures.name("target") else {
                return false;
            };
            !is_safe_powershell_sink(target.as_str())
        })
}

fn is_mutating_powershell_cmdlet(name: &str) -> bool {
    matches!(
        name,
        "set-content"
            | "add-content"
            | "clear-content"
            | "remove-item"
            | "copy-item"
            | "move-item"
            | "rename-item"
            | "new-item"
            | "out-file"
            | "tee-object"
            | "export-csv"
            | "export-clixml"
            | "expand-archive"
    )
}

fn detect_high_risk_powershell_reason(command: &str) -> Option<String> {
    if POWERSHELL_SYMLINK_RE.is_match(command) {
        return Some(
            "Blocked: creating symbolic links or junctions is not allowed in PowerShell tool."
                .to_string(),
        );
    }

    for segment in split_powershell_segments(command) {
        let words = extract_powershell_command_words(segment);
        if words.is_empty() || words[0] != "git" {
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
            "clean" if is_forced_git_clean_words(&words) => {
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

fn detect_mutating_powershell_warning(command: &str) -> Option<String> {
    if has_powershell_write_redirection(command) {
        return Some("Command writes to files via PowerShell redirection".to_string());
    }

    for segment in split_powershell_segments(command) {
        let words = extract_powershell_command_words(segment);
        if words.is_empty() {
            continue;
        }

        let command_name = words[0].as_str();
        if matches!(command_name, "invoke-webrequest" | "invoke-restmethod")
            && words
                .iter()
                .any(|word| word == "-outfile" || word == "-literalpath" || word == "-path")
        {
            return Some(format!(
                "Command may persist downloaded content via `{command_name}`"
            ));
        }

        if is_mutating_powershell_cmdlet(command_name) {
            return Some(format!(
                "Command may modify files or project state via `{command_name}`"
            ));
        }

        if command_name == "git" {
            let subcommand = words.get(1).map(String::as_str).unwrap_or("");
            if matches!(
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
            ) {
                return Some(format!(
                    "Command modifies repository state via `git {subcommand}`"
                ));
            }
        }
    }

    None
}

fn is_forced_git_clean_words(words: &[String]) -> bool {
    let has_force = words
        .iter()
        .any(|word| word.starts_with('-') && word.contains('f'));
    let has_scope = words.iter().any(|word| {
        word.starts_with('-') && (word.contains('d') || word.contains('x') || word.contains('X'))
    });
    has_force && has_scope
}

fn validate_powershell_command_paths(command: &str, cwd: &Path) -> Option<PermissionCheckResult> {
    let candidates = collect_powershell_path_candidates(command);
    match evaluate_path_mutations(&candidates, cwd)? {
        PathGuardFinding::ProtectedPaths(paths) => Some(PermissionCheckResult::deny(format!(
            "Blocked: PowerShell command targets protected path(s): {}",
            summarize_paths(&paths)
        ))),
        PathGuardFinding::OutsideWorkspace(paths) => Some(PermissionCheckResult::ask(format!(
            "PowerShell command modifies path(s) outside the current working directory: {}. Do you want to proceed?",
            summarize_paths(&paths)
        ))),
        PathGuardFinding::DynamicPaths(paths) => Some(PermissionCheckResult::ask(format!(
            "PowerShell command uses path expression(s) that cannot be validated safely: {}. Do you want to proceed?",
            summarize_raw_paths(&paths)
        ))),
    }
}

fn collect_powershell_path_candidates(command: &str) -> Vec<PathMutationCandidate> {
    let mut candidates = POWERSHELL_WRITE_REDIRECTION_RE
        .captures_iter(command)
        .filter_map(|captures| captures.name("target"))
        .map(|target| PathMutationCandidate::new(target.as_str(), PathMutationKind::Write))
        .collect::<Vec<_>>();

    for segment in split_powershell_segments(command) {
        let raw_words = tokenize_powershell_words(segment);
        if raw_words.is_empty() {
            continue;
        }
        let normalized_words = normalize_powershell_words(&raw_words);
        let command_name = normalized_words[0].as_str();

        match command_name {
            "set-content" | "add-content" | "clear-content" | "remove-item" | "copy-item"
            | "move-item" | "rename-item" | "new-item" | "out-file" | "tee-object"
            | "export-csv" | "export-clixml" | "invoke-webrequest" | "invoke-restmethod" => {
                let kind = if command_name == "remove-item" {
                    PathMutationKind::Remove
                } else {
                    PathMutationKind::Write
                };
                for path in extract_powershell_write_targets(&raw_words, command_name) {
                    candidates.push(PathMutationCandidate::new(path, kind));
                }
            }
            _ => {}
        }
    }

    candidates
}

fn tokenize_powershell_words(segment: &str) -> Vec<String> {
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
            '`' if !in_single => {
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

fn normalize_powershell_words(raw_words: &[String]) -> Vec<String> {
    let mut normalized = raw_words
        .iter()
        .map(|word| resolve_powershell_alias(&normalize_powershell_word(word)).to_string())
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>();

    while let Some(word) = normalized.first() {
        if matches!(word.as_str(), "&" | "." | "powershell" | "pwsh") {
            normalized.remove(0);
            continue;
        }
        break;
    }

    normalized
}

fn extract_powershell_write_targets(raw_words: &[String], command_name: &str) -> Vec<String> {
    if raw_words.len() <= 1 {
        return Vec::new();
    }

    let mut named_targets = Vec::new();
    let mut positional_targets = Vec::new();
    let mut index = 1usize;
    let mut after_double_dash = false;
    let path_params = [
        "-path",
        "-literalpath",
        "-destination",
        "-filepath",
        "-outfile",
        "-pspath",
        "-lp",
    ];

    while index < raw_words.len() {
        let word = &raw_words[index];
        let normalized = normalize_powershell_word(word);

        if !after_double_dash && word == "--" {
            after_double_dash = true;
            index += 1;
            continue;
        }

        if !after_double_dash && normalized.starts_with('-') {
            if let Some((param, value)) = normalized.split_once(':') {
                if path_params.contains(&param) && !value.is_empty() {
                    named_targets.push(value.to_string());
                }
                index += 1;
                continue;
            }

            if path_params.contains(&normalized.as_str()) {
                if let Some(next) = raw_words.get(index + 1) {
                    named_targets.push(next.clone());
                    index += 2;
                    continue;
                }
            }

            index += 1;
            continue;
        }

        positional_targets.push(word.clone());
        index += 1;
    }

    if !named_targets.is_empty() {
        return named_targets;
    }

    match command_name {
        "set-content" | "add-content" | "clear-content" | "remove-item" | "rename-item"
        | "new-item" | "out-file" | "tee-object" | "export-csv" | "export-clixml" => {
            positional_targets.into_iter().take(1).collect()
        }
        "copy-item" | "move-item" => positional_targets.into_iter().skip(1).take(1).collect(),
        "invoke-webrequest" | "invoke-restmethod" => Vec::new(),
        _ => Vec::new(),
    }
}

fn extract_powershell_read_targets(raw_words: &[String], command_name: &str) -> Vec<String> {
    if raw_words.len() <= 1 {
        return Vec::new();
    }

    let mut named_targets = Vec::new();
    let mut positional_targets = Vec::new();
    let mut index = 1usize;
    let mut after_double_dash = false;
    let path_params = ["-path", "-literalpath", "-lp"];

    while index < raw_words.len() {
        let word = &raw_words[index];
        let normalized = normalize_powershell_word(word);

        if !after_double_dash && word == "--" {
            after_double_dash = true;
            index += 1;
            continue;
        }

        if !after_double_dash && normalized.starts_with('-') {
            if let Some((param, value)) = normalized.split_once(':') {
                if path_params.contains(&param) && !value.is_empty() {
                    named_targets.push(value.to_string());
                }
                index += 1;
                continue;
            }

            if path_params.contains(&normalized.as_str()) {
                if let Some(next) = raw_words.get(index + 1) {
                    named_targets.push(next.clone());
                    index += 2;
                    continue;
                }
            }

            index += 1;
            continue;
        }

        positional_targets.push(word.clone());
        index += 1;
    }

    if !named_targets.is_empty() {
        return named_targets;
    }

    match command_name {
        "get-content" | "get-childitem" => positional_targets.into_iter().rev().take(1).collect(),
        "select-string" if positional_targets.len() >= 2 => {
            positional_targets.into_iter().rev().take(1).collect()
        }
        _ => Vec::new(),
    }
}

fn collect_powershell_read_path_candidates(command: &str) -> Vec<String> {
    let mut candidates = Vec::new();

    for segment in split_powershell_segments(command) {
        let raw_words = tokenize_powershell_words(segment);
        if raw_words.is_empty() {
            continue;
        }

        let normalized_words = normalize_powershell_words(&raw_words);
        if normalized_words.is_empty() {
            continue;
        }

        let command_name = normalized_words[0].as_str();
        candidates.extend(extract_powershell_read_targets(&raw_words, command_name));
    }

    candidates
}

fn is_known_read_only_powershell_command(command_name: &str, words: &[String]) -> bool {
    match command_name {
        "get-content" | "get-childitem" | "select-string" | "get-item" | "resolve-path"
        | "split-path" | "test-path" | "measure-object" | "select-object" | "sort-object"
        | "where-object" | "format-table" | "format-list" => true,
        "git" => matches!(
            words.get(1).map(String::as_str).unwrap_or(""),
            "status" | "diff" | "show" | "log" | "rev-parse" | "ls-files" | "grep" | "blame"
        ),
        _ => false,
    }
}

pub fn is_powershell_command_concurrency_safe(command: &str) -> bool {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return false;
    }

    if has_powershell_write_redirection(trimmed) {
        return false;
    }

    let mut saw_segment = false;
    for segment in split_powershell_segments(trimmed) {
        let words = extract_powershell_command_words(segment);
        if words.is_empty() {
            continue;
        }
        saw_segment = true;

        let command_name = words[0].as_str();
        if is_mutating_powershell_cmdlet(command_name) {
            return false;
        }
        if command_name == "git"
            && matches!(
                words.get(1).map(String::as_str).unwrap_or(""),
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
        {
            return false;
        }
        if !is_known_read_only_powershell_command(command_name, &words) {
            return false;
        }
    }

    saw_segment
}

fn build_missing_read_target_result(paths: &[PathBuf]) -> ToolResult {
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
        .with_metadata("preflight_check", json!("missing_read_target"))
        .with_metadata("missing_paths", json!(path_values))
}

pub fn preflight_powershell_read_targets(command: &str, cwd: &Path) -> Option<ToolResult> {
    let mut missing_paths = Vec::new();

    for raw_path in collect_powershell_read_path_candidates(command) {
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
        "Do not guess file paths. If you are not sure whether a target exists, list or search the parent directory first.".to_string(),
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
        context: &ToolContext,
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

        if let Some(path_result) =
            validate_powershell_command_paths(&input.command, &context.working_directory)
        {
            return path_result;
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

        if !input.run_in_background.unwrap_or(false) {
            if let Some(preflight_result) =
                preflight_powershell_read_targets(&input.command, &context.working_directory)
            {
                return Ok(preflight_result);
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
        assert!(definition.description.contains("Do not guess file paths"));
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

    #[tokio::test]
    async fn test_powershell_tool_check_permissions_warns_set_content() {
        let tool = PowerShellTool::with_executable_path(Arc::new(TaskManager::new()), None);

        let result = tool
            .check_permissions(
                &json!({
                    "command": "Set-Content notes.txt 'hello'"
                }),
                &ToolContext::default(),
            )
            .await;

        assert!(result.requires_confirmation());
    }

    #[tokio::test]
    async fn test_powershell_tool_check_permissions_outside_workspace_mentions_path_scope() {
        let tool = PowerShellTool::with_executable_path(Arc::new(TaskManager::new()), None);

        let result = tool
            .check_permissions(
                &json!({
                    "command": "Set-Content ../notes.txt 'hello'"
                }),
                &ToolContext::new(PathBuf::from("/tmp/project")),
            )
            .await;

        assert!(result.requires_confirmation());
        assert!(result
            .message
            .as_deref()
            .unwrap_or_default()
            .contains("outside the current working directory"));
    }

    #[tokio::test]
    async fn test_powershell_tool_check_permissions_denies_git_reset_hard() {
        let tool = PowerShellTool::with_executable_path(Arc::new(TaskManager::new()), None);

        let result = tool
            .check_permissions(
                &json!({
                    "command": "git reset --hard HEAD~1"
                }),
                &ToolContext::default(),
            )
            .await;

        assert!(result.is_denied());
    }

    #[tokio::test]
    async fn test_powershell_tool_check_permissions_denies_relative_root_removal() {
        let tool = PowerShellTool::with_executable_path(Arc::new(TaskManager::new()), None);

        let result = tool
            .check_permissions(
                &json!({
                    "command": "Remove-Item ../../ -Recurse -Force"
                }),
                &ToolContext::new(PathBuf::from("/tmp/project")),
            )
            .await;

        assert!(result.is_denied());
        assert!(result
            .message
            .as_deref()
            .unwrap_or_default()
            .contains("protected path"));
    }

    #[tokio::test]
    async fn test_powershell_tool_check_permissions_denies_symlink_creation() {
        let tool = PowerShellTool::with_executable_path(Arc::new(TaskManager::new()), None);

        let result = tool
            .check_permissions(
                &json!({
                    "command": "New-Item -ItemType SymbolicLink -Path link -Target target"
                }),
                &ToolContext::default(),
            )
            .await;

        assert!(result.is_denied());
    }

    #[tokio::test]
    async fn test_powershell_tool_check_permissions_allows_null_redirection() {
        let tool = PowerShellTool::with_executable_path(Arc::new(TaskManager::new()), None);

        let result = tool
            .check_permissions(
                &json!({
                    "command": "Get-Content notes.txt > $null"
                }),
                &ToolContext::default(),
            )
            .await;

        assert!(result.is_allowed());
    }

    #[tokio::test]
    async fn test_powershell_tool_execute_preflights_missing_read_target() {
        use tempfile::tempdir;

        let temp_dir = tempdir().unwrap();
        let missing_path = temp_dir.path().join("missing.txt");
        let tool = PowerShellTool::with_executable_path(Arc::new(TaskManager::new()), None);

        let result = tool
            .execute(
                json!({
                    "command": format!("Get-Content {}", missing_path.display())
                }),
                &ToolContext::new(temp_dir.path().to_path_buf()),
            )
            .await
            .unwrap();

        assert!(result.is_error());
        assert!(result.message().unwrap_or_default().contains("路径不存在"));
        assert_eq!(
            result.metadata.get("preflight_check"),
            Some(&json!("missing_read_target"))
        );
    }

    #[test]
    fn test_is_powershell_command_concurrency_safe_for_read_only_pipeline() {
        assert!(is_powershell_command_concurrency_safe(
            "Get-ChildItem src | Select-Object -First 5"
        ));
    }

    #[test]
    fn test_is_powershell_command_concurrency_safe_rejects_mutation() {
        assert!(!is_powershell_command_concurrency_safe(
            "Set-Content notes.txt 'hello'"
        ));
        assert!(!is_powershell_command_concurrency_safe("git checkout main"));
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

    #[test]
    fn test_format_output_uses_semantic_message_when_empty() {
        let tool = PowerShellTool::with_executable_path(Arc::new(TaskManager::new()), None);
        let result = tool.format_output_with_message("", "", 1, Some("No matches found"));
        assert_eq!(result, "No matches found");
    }
}
