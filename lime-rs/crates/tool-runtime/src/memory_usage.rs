//! Codex-compatible classification of shell reads from the memory workspace.
//!
//! The classification is observational metadata. It never grants access,
//! changes approval, or decides whether a command is safe to execute.

use agent_protocol::parse_command::ParsedCommand;
use serde_json::{Value, json};

/// Classify memory artifacts referenced by a shell command.
///
/// Unknown or partially parsed commands return an empty list, matching Codex's
/// fail-closed usage telemetry behavior.
pub fn usage_from_command(command: &str) -> Vec<Value> {
    let commands = crate::parse_command::parse_shell_script(command);
    if commands
        .iter()
        .any(|command| matches!(command, ParsedCommand::Unknown { .. }))
    {
        return Vec::new();
    }

    commands
        .into_iter()
        .filter_map(|command| match command {
            ParsedCommand::Read { path, .. } => usage_for_path(path.to_string_lossy().as_ref()),
            ParsedCommand::Search { path, .. } => path.as_deref().and_then(usage_for_path),
            ParsedCommand::ListFiles { .. } | ParsedCommand::Unknown { .. } => None,
        })
        .collect()
}

fn usage_for_path(path: &str) -> Option<Value> {
    let normalized = path.replace('\\', "/");
    let version = if normalized.contains("memories_v2/") {
        "v2"
    } else {
        "v1"
    };
    let normalized = normalized.replace("memories_v2/", "memories/");
    let relative = normalized
        .strip_prefix("memories/")
        .or_else(|| normalized.rsplit_once("/memories/").map(|(_, path)| path))
        .unwrap_or(&normalized);
    let kind = if relative == "MEMORY.md" {
        "memory_md"
    } else if relative == "memory_summary.md" {
        "memory_summary"
    } else if relative == "raw_memories.md" {
        "raw_memories"
    } else if relative.starts_with("rollout_summaries/") {
        "rollout_summaries"
    } else if relative.starts_with("skills/") {
        "skills"
    } else {
        return None;
    };
    Some(json!({
        "kind": kind,
        "version": version,
        "path": path,
    }))
}

#[cfg(test)]
mod tests {
    use super::usage_from_command;

    #[test]
    fn classifies_memory_reads() {
        let usage = usage_from_command(
            "cat /workspace/memories/MEMORY.md && sed -n '1,20p' /workspace/memories/rollout_summaries/thread.md",
        );
        assert_eq!(usage.len(), 2);
        assert_eq!(usage[0]["kind"], "memory_md");
        assert_eq!(usage[1]["kind"], "rollout_summaries");
    }

    #[test]
    fn unknown_commands_fail_closed() {
        assert!(usage_from_command("cat /workspace/memories/MEMORY.md | custom_reader").is_empty());
        assert!(usage_from_command("cat ~/memories/MEMORY.md").is_empty());
        assert!(usage_from_command("rg route /workspace/memories/rollout_summaries/").is_empty());
    }

    #[test]
    fn recognizes_v2_memory_paths() {
        let usage = usage_from_command("cat /workspace/memories_v2/memory_summary.md");
        assert_eq!(usage[0]["version"], "v2");
        assert_eq!(usage[0]["kind"], "memory_summary");
    }
}
