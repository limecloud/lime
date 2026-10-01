//! Codex tool-mention scanning and skill resolution at the terminal product boundary.

use crate::mention_codec::{is_common_env_var, is_mention_name_char, parse_linked_tool_mention};
use app_server_protocol::protocol::v2::SkillMetadata;
use std::collections::{HashMap, HashSet};

pub(super) struct ToolMentions {
    names: HashSet<String>,
    linked_paths: HashMap<String, String>,
}

pub(super) fn collect_tool_mentions(
    text: &str,
    mention_paths: &HashMap<String, String>,
) -> ToolMentions {
    let bytes = text.as_bytes();
    let mut mentions = ToolMentions {
        names: HashSet::new(),
        linked_paths: HashMap::new(),
    };
    let mut index = 0;
    while index < bytes.len() {
        if let Some((name, path, end)) = parse_linked_tool_mention(text, index, '$') {
            if !is_common_env_var(name) {
                if is_skill_path(path) {
                    mentions.names.insert(name.to_string());
                }
                mentions
                    .linked_paths
                    .entry(name.to_string())
                    .or_insert_with(|| path.to_string());
            }
            index = end;
            continue;
        }
        if bytes[index] != b'$' {
            index += 1;
            continue;
        }
        let start = index + 1;
        if !bytes
            .get(start)
            .is_some_and(|byte| is_mention_name_char(*byte))
        {
            index += 1;
            continue;
        }
        let mut end = start + 1;
        while bytes
            .get(end)
            .is_some_and(|byte| is_mention_name_char(*byte))
        {
            end += 1;
        }
        let name = &text[start..end];
        if !is_common_env_var(name) {
            mentions.names.insert(name.to_string());
        }
        index = end;
    }
    for (name, path) in mention_paths {
        if mentions.names.contains(name) {
            mentions.linked_paths.insert(name.clone(), path.clone());
        }
    }
    mentions
}

pub(super) fn find_skill_mentions_with_tool_mentions(
    mentions: &ToolMentions,
    skills: &[SkillMetadata],
) -> Vec<SkillMetadata> {
    let linked_paths = mentions
        .linked_paths
        .values()
        .filter(|path| is_skill_path(path))
        .map(|path| path.strip_prefix("skill://").unwrap_or(path))
        .collect::<HashSet<_>>();
    let mut seen_names = HashSet::new();
    let mut seen_paths = HashSet::new();
    let mut found = Vec::new();
    for skill in skills.iter().filter(|skill| skill.enabled) {
        if linked_paths.contains(skill.path.to_string_lossy().as_ref())
            && seen_paths.insert(skill.path.clone())
        {
            seen_names.insert(skill.name.clone());
            found.push(skill.clone());
        }
    }
    for skill in skills.iter().filter(|skill| skill.enabled) {
        if !seen_paths.contains(&skill.path)
            && mentions.names.contains(&skill.name)
            && seen_names.insert(skill.name.clone())
        {
            seen_paths.insert(skill.path.clone());
            found.push(skill.clone());
        }
    }
    found
}

fn is_skill_path(path: &str) -> bool {
    !path.starts_with("app://") && !path.starts_with("mcp://") && !path.starts_with("plugin://")
}
