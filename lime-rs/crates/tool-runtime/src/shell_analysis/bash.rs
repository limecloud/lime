use regex::Regex;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use crate::path_guard::{PathMutationCandidate, PathMutationKind, resolve_static_path_candidate};

use super::common::{
    detect_high_risk_git_command, is_mutating_git_subcommand, normalize_shell_word, split_segments,
    tokenize_words,
};

pub(super) fn is_command_concurrency_safe(command: &str) -> bool {
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
        if command_name == "sed" && bash_sed_in_place_re().is_match(segment) {
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
            && is_mutating_git_subcommand(words.get(1).map(String::as_str).unwrap_or_default())
        {
            return false;
        }
        if !is_known_read_only_bash_command(command_name, &words) {
            return false;
        }
    }

    saw_segment
}

pub(super) fn missing_read_targets(command: &str, cwd: &Path) -> Vec<PathBuf> {
    let mut missing_paths = Vec::new();
    for raw_path in collect_read_path_candidates(command) {
        let Some(resolved_path) = resolve_static_path_candidate(&raw_path, cwd) else {
            continue;
        };
        if resolved_path.exists() || missing_paths.contains(&resolved_path) {
            continue;
        }
        missing_paths.push(resolved_path);
    }
    missing_paths
}

pub(super) fn collect_invocation_path_candidates(
    raw_words: &[String],
) -> Vec<PathMutationCandidate> {
    let mut candidates = Vec::new();
    let words = normalize_bash_command_words(raw_words);
    let Some(command_name) = words.first().map(String::as_str) else {
        return candidates;
    };
    match command_name {
        "rm" | "rmdir" => {
            for target in extract_rm_targets(raw_words) {
                candidates.push(PathMutationCandidate::new(target, PathMutationKind::Remove));
            }
        }
        "tee" => {
            for target in extract_tee_targets(raw_words) {
                candidates.push(PathMutationCandidate::new(target, PathMutationKind::Write));
            }
        }
        "dd" => {
            for target in extract_dd_output_targets(raw_words) {
                candidates.push(PathMutationCandidate::new(target, PathMutationKind::Write));
            }
        }
        "sed" if sed_edits_in_place(raw_words) => {
            for target in extract_sed_in_place_targets(raw_words) {
                candidates.push(PathMutationCandidate::new(target, PathMutationKind::Write));
            }
        }
        _ => {}
    }
    candidates
}

pub(super) fn detect_high_risk_reason(command: &str) -> Option<String> {
    detect_high_risk_git_command(command, split_shell_segments, extract_bash_command_words)
}

pub(super) fn detect_mutating_invocation_warning(words: &[String]) -> Option<String> {
    let command_name = words.first().map(String::as_str)?;
    if command_name == "sed" && sed_edits_in_place(words) {
        return Some("Command performs in-place edits via `sed -i`".to_string());
    }
    if command_name == "tee" && tee_writes_to_file(words) {
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
        let subcommand = words.get(1).map(String::as_str).unwrap_or_default();
        if is_mutating_git_subcommand(subcommand) {
            return Some(format!(
                "Command modifies repository state via `git {subcommand}`"
            ));
        }
    }
    None
}

fn sed_edits_in_place(words: &[String]) -> bool {
    words
        .iter()
        .skip(1)
        .take_while(|word| word.as_str() != "--")
        .any(|word| {
            word == "--in-place"
                || word.starts_with("--in-place=")
                || (word.starts_with('-') && !word.starts_with("--") && word.contains('i'))
        })
}

fn collect_read_path_candidates(command: &str) -> Vec<String> {
    let mut candidates = Vec::new();

    for segment in split_shell_segments(command) {
        let raw_words = tokenize_bash_words(segment);
        if raw_words.is_empty() {
            continue;
        }

        let normalized_words = normalize_bash_command_words(&raw_words);
        let Some(command_name) = normalized_words.first().map(String::as_str) else {
            continue;
        };
        candidates.extend(extract_read_targets(&raw_words, command_name));
    }

    candidates
}

fn split_shell_segments(command: &str) -> Vec<&str> {
    split_segments(command)
}

fn tokenize_bash_words(segment: &str) -> Vec<String> {
    tokenize_words(segment, '\\')
}

fn normalize_bash_command_words(raw_words: &[String]) -> Vec<String> {
    let words = raw_words
        .iter()
        .map(|word| normalize_shell_word(word))
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>();
    let start_index = skip_shell_command_prefix(raw_words);
    words.into_iter().skip(start_index).collect()
}

fn extract_bash_command_words(segment: &str) -> Vec<String> {
    normalize_bash_command_words(&tokenize_bash_words(segment))
}

fn skip_shell_command_prefix(raw_words: &[String]) -> usize {
    let mut index = 0usize;
    while index < raw_words.len() {
        let normalized = normalize_shell_word(&raw_words[index]);
        if shell_env_assign_re().is_match(&normalized) || is_shell_wrapper_command(&normalized) {
            index += 1;
            continue;
        }
        break;
    }
    index
}

fn is_shell_wrapper_command(word: &str) -> bool {
    matches!(
        word,
        "sudo" | "env" | "command" | "builtin" | "nohup" | "nice" | "stdbuf" | "timeout" | "time"
    )
}

fn extract_read_targets(raw_words: &[String], command_name: &str) -> Vec<String> {
    let start_index = skip_shell_command_prefix(raw_words);
    if raw_words.len() <= start_index + 1 {
        return Vec::new();
    }

    let mut positional_targets = Vec::new();
    let mut after_double_dash = false;
    let mut skip_write_redirection_target = false;

    for word in raw_words.iter().skip(start_index + 1) {
        if skip_write_redirection_target {
            skip_write_redirection_target = false;
            continue;
        }
        if !after_double_dash && word == "--" {
            after_double_dash = true;
            continue;
        }

        let normalized = normalize_shell_word(word);
        if !after_double_dash {
            if let Some(has_inline_target) = bash_write_redirection_word(&normalized) {
                skip_write_redirection_target = !has_inline_target;
                continue;
            }
        }
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

fn is_known_read_only_bash_command(command_name: &str, words: &[String]) -> bool {
    match command_name {
        "cat" | "bat" | "head" | "tail" | "wc" | "ls" | "dir" | "tree" | "rg" | "grep"
        | "findstr" | "find" | "pwd" | "realpath" | "readlink" | "stat" | "file" | "du"
        | "which" | "cut" | "sort" | "uniq" | "tr" | "awk" | "jq" | "basename" | "dirname"
        | "test" | "[" => true,
        "sed" => true,
        "git" => matches!(
            words.get(1).map(String::as_str).unwrap_or_default(),
            "status" | "diff" | "show" | "log" | "rev-parse" | "ls-files" | "grep" | "blame"
        ),
        _ => false,
    }
}

fn is_safe_shell_sink(target: &str) -> bool {
    let normalized = normalize_shell_word(target);
    matches!(
        normalized.as_str(),
        "&1" | "&2" | "/dev/null" | "/dev/stdout" | "/dev/stderr" | "/dev/tty" | "nul"
    )
}

fn has_bash_write_redirection(command: &str) -> bool {
    bash_write_redirection_re()
        .captures_iter(command)
        .filter_map(|captures| captures.name("target"))
        .any(|target| !is_safe_shell_sink(target.as_str()))
}

fn bash_write_redirection_word(word: &str) -> Option<bool> {
    let captures = bash_write_redirection_word_re().captures(word)?;
    Some(
        captures
            .name("target")
            .is_some_and(|target| !target.as_str().is_empty()),
    )
}

fn bash_write_redirection_word_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"^(?:\d+|&)?(?:>\||>>?)(?P<target>.*)$")
            .expect("valid bash write redirection word regex")
    })
}

fn shell_env_assign_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^[A-Za-z_]\w*=").expect("valid env assign regex"))
}

fn bash_write_redirection_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r#"(?x)
            (?:^|[\s;(])
            (?:\d+|&)?(?:>>?|>\|)
            \s*
            (?P<target>'[^']*'|"[^"]*"|[^\s;&|()]+)
        "#,
        )
        .expect("valid bash write redirection regex")
    })
}

fn bash_sed_in_place_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)\bsed\b[^\n;|&]*(?:\s--in-place(?:=\S+)?|\s-[A-Za-z]*i[A-Za-z]*)")
            .expect("valid sed in-place regex")
    })
}
