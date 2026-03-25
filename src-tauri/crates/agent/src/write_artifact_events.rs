use crate::artifact_protocol::{
    extract_artifact_protocol_paths_from_metadata, extract_artifact_protocol_paths_from_value,
    normalize_artifact_protocol_path,
};
use crate::protocol::{AgentArtifactSignal, AgentEvent as RuntimeAgentEvent, AgentToolResult};
use regex::Regex;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::OnceLock;

const PREVIEW_TEXT_MAX_CHARS: usize = 480;
const LATEST_CHUNK_MAX_CHARS: usize = 240;
const WRITE_FILE_CLOSE_TAG: &str = "</write_file>";

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedWriteBlock {
    key: String,
    path: String,
    content: String,
    is_complete: bool,
}

#[derive(Debug, Clone)]
struct TrackedArtifactState {
    artifact_id: String,
    file_path: String,
    content: String,
    closed: bool,
}

#[derive(Debug, Clone)]
struct ToolEndArtifact {
    artifact_id: String,
    file_path: String,
    content: String,
}

#[derive(Debug, Default)]
pub struct WriteArtifactEventEmitter {
    scope_id: String,
    accumulated_text: String,
    next_artifact_seq: usize,
    inline_artifact_ids: HashMap<String, String>,
    tool_artifact_ids: HashMap<String, Vec<String>>,
    tracked_artifacts: HashMap<String, TrackedArtifactState>,
}

fn push_processed_event(
    target: &mut Vec<RuntimeAgentEvent>,
    emitter: &mut WriteArtifactEventEmitter,
    mut event: RuntimeAgentEvent,
) {
    target.extend(emitter.process_event(&mut event));
    target.push(event);
}

pub fn build_write_tool_artifact_events(
    scope_id: &str,
    tool_name: &str,
    tool_id: &str,
    file_path: &str,
    file_content: &str,
    result: AgentToolResult,
) -> Vec<RuntimeAgentEvent> {
    let arguments = serde_json::json!({
        "path": file_path,
        "content": file_content,
    })
    .to_string();
    let mut emitter = WriteArtifactEventEmitter::new(scope_id.to_string());
    let mut events = Vec::new();

    push_processed_event(
        &mut events,
        &mut emitter,
        RuntimeAgentEvent::ToolStart {
            tool_name: tool_name.to_string(),
            tool_id: tool_id.to_string(),
            arguments: Some(arguments),
        },
    );

    push_processed_event(
        &mut events,
        &mut emitter,
        RuntimeAgentEvent::ToolEnd {
            tool_id: tool_id.to_string(),
            result,
        },
    );

    events
}

impl WriteArtifactEventEmitter {
    pub fn new(scope_id: impl Into<String>) -> Self {
        Self {
            scope_id: scope_id.into(),
            ..Self::default()
        }
    }

    pub fn process_event(&mut self, event: &mut RuntimeAgentEvent) -> Vec<RuntimeAgentEvent> {
        match event {
            RuntimeAgentEvent::ToolStart {
                tool_name,
                tool_id,
                arguments,
            } => self.handle_tool_start(tool_name, tool_id, arguments.as_deref()),
            RuntimeAgentEvent::TextDelta { text } => self.handle_text_delta(text),
            RuntimeAgentEvent::ToolEnd { tool_id, result } => self.handle_tool_end(tool_id, result),
            _ => Vec::new(),
        }
    }

    fn handle_tool_start(
        &mut self,
        tool_name: &str,
        tool_id: &str,
        arguments: Option<&str>,
    ) -> Vec<RuntimeAgentEvent> {
        let Some(arguments_value) = parse_json_str(arguments) else {
            return Vec::new();
        };
        let patch_text = extract_candidate_patch_text(&arguments_value);
        if !is_write_like_tool(tool_name)
            && !patch_text
                .as_deref()
                .map(contains_patch_file_directive)
                .unwrap_or(false)
        {
            return Vec::new();
        }

        let paths = extract_candidate_paths(&arguments_value);
        if paths.is_empty() {
            return Vec::new();
        }

        let content = extract_candidate_content(&arguments_value).unwrap_or_default();
        let base_metadata = extract_embedded_metadata(&arguments_value);
        let mut events = Vec::new();

        for path in paths {
            let artifact_id = self.ensure_tool_artifact(tool_id, path.as_str(), content.as_str());
            let phase = if content.trim().is_empty() {
                "preparing"
            } else {
                "streaming"
            };
            let metadata = build_snapshot_metadata(
                base_metadata.as_ref(),
                "tool_start",
                phase,
                false,
                content.as_str(),
                None,
            );
            events.push(build_artifact_snapshot_event(
                artifact_id,
                path.as_str(),
                content.as_str(),
                metadata,
            ));
        }

        events
    }

    fn handle_text_delta(&mut self, text: &str) -> Vec<RuntimeAgentEvent> {
        if text.is_empty() {
            return Vec::new();
        }

        self.accumulated_text.push_str(text);
        let blocks = parse_write_file_blocks(&self.accumulated_text);
        let mut events = Vec::new();

        for block in blocks {
            let artifact_id =
                self.resolve_inline_artifact_id(block.key.as_str(), block.path.as_str());
            let previous = self.tracked_artifacts.get(&artifact_id).cloned();
            let changed = previous
                .as_ref()
                .map(|state| state.content != block.content || state.closed != block.is_complete)
                .unwrap_or(true);
            if !changed {
                continue;
            }

            self.tracked_artifacts.insert(
                artifact_id.clone(),
                TrackedArtifactState {
                    artifact_id: artifact_id.clone(),
                    file_path: block.path.clone(),
                    content: block.content.clone(),
                    closed: block.is_complete,
                },
            );

            let phase = if block.is_complete {
                "persisted"
            } else if block.content.trim().is_empty() {
                "preparing"
            } else {
                "streaming"
            };
            let metadata = build_snapshot_metadata(
                None,
                "message_content",
                phase,
                block.is_complete,
                block.content.as_str(),
                None,
            );
            events.push(build_artifact_snapshot_event(
                artifact_id,
                block.path.as_str(),
                block.content.as_str(),
                metadata,
            ));
        }

        events
    }

    fn handle_tool_end(
        &mut self,
        tool_id: &str,
        result: &mut AgentToolResult,
    ) -> Vec<RuntimeAgentEvent> {
        let artifacts = self.collect_tool_end_artifacts(tool_id, result.metadata.as_ref());
        if artifacts.is_empty() {
            return Vec::new();
        }

        annotate_tool_result_metadata(result, &artifacts);

        let mut events = Vec::new();
        for artifact in &artifacts {
            if let Some(state) = self.tracked_artifacts.get_mut(&artifact.artifact_id) {
                state.file_path = artifact.file_path.clone();
                state.content = artifact.content.clone();
                state.closed = true;
            } else {
                self.tracked_artifacts.insert(
                    artifact.artifact_id.clone(),
                    TrackedArtifactState {
                        artifact_id: artifact.artifact_id.clone(),
                        file_path: artifact.file_path.clone(),
                        content: artifact.content.clone(),
                        closed: true,
                    },
                );
            }

            if result.success {
                let metadata = build_snapshot_metadata(
                    result.metadata.as_ref(),
                    "tool_result",
                    "completed",
                    true,
                    artifact.content.as_str(),
                    result.error.as_deref(),
                );
                events.push(build_artifact_snapshot_event(
                    artifact.artifact_id.clone(),
                    artifact.file_path.as_str(),
                    artifact.content.as_str(),
                    metadata,
                ));
            }
        }

        events
    }

    fn resolve_inline_artifact_id(&mut self, block_key: &str, file_path: &str) -> String {
        if let Some(existing) = self.inline_artifact_ids.get(block_key) {
            return existing.clone();
        }

        let artifact_id = self
            .find_active_artifact_id_by_path(file_path)
            .unwrap_or_else(|| self.new_artifact_id(file_path));
        self.inline_artifact_ids
            .insert(block_key.to_string(), artifact_id.clone());
        artifact_id
    }

    fn ensure_tool_artifact(&mut self, tool_id: &str, file_path: &str, content: &str) -> String {
        if let Some(existing) = self
            .tool_artifact_ids
            .get(tool_id)
            .and_then(|artifact_ids| {
                artifact_ids.iter().find_map(|artifact_id| {
                    self.tracked_artifacts.get(artifact_id).and_then(|state| {
                        if state.file_path == file_path {
                            Some(state.artifact_id.clone())
                        } else {
                            None
                        }
                    })
                })
            })
        {
            return existing;
        }

        let artifact_id = self
            .find_active_artifact_id_by_path(file_path)
            .unwrap_or_else(|| self.new_artifact_id(file_path));

        self.tool_artifact_ids
            .entry(tool_id.to_string())
            .or_default()
            .push(artifact_id.clone());
        self.tracked_artifacts.insert(
            artifact_id.clone(),
            TrackedArtifactState {
                artifact_id: artifact_id.clone(),
                file_path: file_path.to_string(),
                content: content.to_string(),
                closed: false,
            },
        );
        artifact_id
    }

    fn collect_tool_end_artifacts(
        &mut self,
        tool_id: &str,
        metadata: Option<&HashMap<String, Value>>,
    ) -> Vec<ToolEndArtifact> {
        let metadata_artifacts = extract_artifacts_from_metadata(metadata);
        let tracked_ids = self
            .tool_artifact_ids
            .get(tool_id)
            .cloned()
            .unwrap_or_default();
        let mut artifacts = Vec::new();

        for artifact_id in tracked_ids {
            let Some(state) = self.tracked_artifacts.get(&artifact_id).cloned() else {
                continue;
            };

            let metadata_match = metadata_artifacts
                .iter()
                .find(|artifact| artifact.file_path == state.file_path);
            artifacts.push(ToolEndArtifact {
                artifact_id: state.artifact_id.clone(),
                file_path: metadata_match
                    .map(|artifact| artifact.file_path.clone())
                    .unwrap_or_else(|| state.file_path.clone()),
                content: state.content,
            });
        }

        for metadata_artifact in metadata_artifacts {
            if artifacts
                .iter()
                .any(|artifact| artifact.file_path == metadata_artifact.file_path)
            {
                continue;
            }

            let artifact_id = metadata_artifact
                .artifact_id
                .clone()
                .or_else(|| {
                    self.find_known_artifact_id_by_path(metadata_artifact.file_path.as_str())
                })
                .unwrap_or_else(|| self.new_artifact_id(metadata_artifact.file_path.as_str()));
            let content = self
                .tracked_artifacts
                .get(&artifact_id)
                .map(|state| state.content.clone())
                .unwrap_or_default();
            artifacts.push(ToolEndArtifact {
                artifact_id,
                file_path: metadata_artifact.file_path,
                content,
            });
        }

        artifacts
    }

    fn find_active_artifact_id_by_path(&self, file_path: &str) -> Option<String> {
        self.tracked_artifacts.values().find_map(|state| {
            if state.file_path == file_path && !state.closed {
                Some(state.artifact_id.clone())
            } else {
                None
            }
        })
    }

    fn find_known_artifact_id_by_path(&self, file_path: &str) -> Option<String> {
        self.tracked_artifacts.values().find_map(|state| {
            if state.file_path == file_path {
                Some(state.artifact_id.clone())
            } else {
                None
            }
        })
    }

    fn new_artifact_id(&mut self, file_path: &str) -> String {
        self.next_artifact_seq += 1;
        format!(
            "artifact:{}:{}:{:08x}",
            self.scope_id,
            self.next_artifact_seq,
            stable_hash(file_path),
        )
    }
}

#[derive(Debug, Clone)]
struct MetadataArtifact {
    artifact_id: Option<String>,
    file_path: String,
}

fn build_artifact_snapshot_event(
    artifact_id: impl Into<String>,
    file_path: &str,
    content: &str,
    metadata: HashMap<String, Value>,
) -> RuntimeAgentEvent {
    RuntimeAgentEvent::ArtifactSnapshot {
        artifact: AgentArtifactSignal {
            artifact_id: artifact_id.into(),
            file_path: file_path.to_string(),
            content: Some(content.to_string()),
            metadata: if metadata.is_empty() {
                None
            } else {
                Some(metadata)
            },
        },
    }
}

fn annotate_tool_result_metadata(result: &mut AgentToolResult, artifacts: &[ToolEndArtifact]) {
    let metadata = result.metadata.get_or_insert_with(HashMap::new);
    metadata.insert("artifact_streamed".to_string(), Value::Bool(true));

    if artifacts.len() == 1 {
        metadata.insert(
            "artifact_id".to_string(),
            Value::String(artifacts[0].artifact_id.clone()),
        );
        metadata.insert(
            "artifact_path".to_string(),
            Value::String(artifacts[0].file_path.clone()),
        );
        metadata
            .entry("path".to_string())
            .or_insert_with(|| Value::String(artifacts[0].file_path.clone()));
        metadata
            .entry("file_path".to_string())
            .or_insert_with(|| Value::String(artifacts[0].file_path.clone()));
    } else {
        metadata.insert(
            "artifact_ids".to_string(),
            Value::Array(
                artifacts
                    .iter()
                    .map(|artifact| Value::String(artifact.artifact_id.clone()))
                    .collect(),
            ),
        );
        metadata
            .entry("artifact_paths".to_string())
            .or_insert_with(|| {
                Value::Array(
                    artifacts
                        .iter()
                        .map(|artifact| Value::String(artifact.file_path.clone()))
                        .collect(),
                )
            });
    }
}

fn build_snapshot_metadata(
    base: Option<&HashMap<String, Value>>,
    source: &str,
    phase: &str,
    complete: bool,
    content: &str,
    error: Option<&str>,
) -> HashMap<String, Value> {
    let mut metadata = base.cloned().unwrap_or_default();
    metadata.insert("complete".to_string(), Value::Bool(complete));
    metadata.insert("writePhase".to_string(), Value::String(phase.to_string()));
    metadata.insert("isPartial".to_string(), Value::Bool(!complete));
    metadata.insert(
        "lastUpdateSource".to_string(),
        Value::String(source.to_string()),
    );

    if let Some(preview) = truncate_chars(content, PREVIEW_TEXT_MAX_CHARS) {
        metadata.insert("previewText".to_string(), Value::String(preview));
    }
    if let Some(chunk) = take_last_chars(content, LATEST_CHUNK_MAX_CHARS) {
        metadata.insert("latestChunk".to_string(), Value::String(chunk));
    }
    if let Some(message) = error.map(str::trim).filter(|value| !value.is_empty()) {
        metadata.insert("error".to_string(), Value::String(message.to_string()));
    }

    metadata
}

fn truncate_chars(value: &str, limit: usize) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    let collected = trimmed.chars().take(limit).collect::<String>();
    Some(collected)
}

fn take_last_chars(value: &str, limit: usize) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    let chars = trimmed.chars().collect::<Vec<_>>();
    let start = chars.len().saturating_sub(limit);
    Some(chars[start..].iter().collect())
}

fn stable_hash(input: &str) -> u32 {
    let mut hash: u32 = 0x811c9dc5;
    for byte in input.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(0x01000193);
    }
    hash
}

fn is_write_like_tool(tool_name: &str) -> bool {
    let normalized = tool_name
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .flat_map(|ch| ch.to_lowercase())
        .collect::<String>();
    normalized.contains("write")
        || normalized.contains("create")
        || normalized.contains("save")
        || normalized.contains("output")
        || normalized.contains("edit")
        || normalized.contains("patch")
        || normalized.contains("update")
        || normalized.contains("replace")
}

fn parse_json_str(raw: Option<&str>) -> Option<Value> {
    let text = raw?.trim();
    if text.is_empty() {
        return None;
    }
    serde_json::from_str::<Value>(text).ok()
}

fn extract_candidate_paths(value: &Value) -> Vec<String> {
    let mut paths = extract_artifact_protocol_paths_from_value(value);

    if paths.is_empty() {
        if let Some(patch_text) = extract_candidate_patch_text(value) {
            push_paths_from_patch_text(&mut paths, patch_text.as_str());
        }
    }

    paths
}

fn extract_candidate_content(value: &Value) -> Option<String> {
    let object = value.as_object()?;
    for key in ["content", "text", "contents", "body"] {
        let Some(candidate) = object.get(key).and_then(Value::as_str) else {
            continue;
        };
        return Some(candidate.to_string());
    }
    None
}

fn extract_candidate_patch_text(value: &Value) -> Option<String> {
    let object = value.as_object()?;
    for key in ["patch", "command", "cmd", "script"] {
        let Some(candidate) = object.get(key) else {
            continue;
        };
        if let Some(text) = value_to_text(candidate) {
            return Some(text);
        }
    }
    None
}

fn value_to_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.to_string()),
        Value::Array(items) => {
            let parts = items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>();
            if parts.is_empty() {
                None
            } else {
                Some(parts.join("\n"))
            }
        }
        _ => None,
    }
}

fn contains_patch_file_directive(text: &str) -> bool {
    text.lines().any(|line| {
        let trimmed = line.trim();
        trimmed.starts_with("*** Add File:")
            || trimmed.starts_with("*** Update File:")
            || trimmed.starts_with("*** Delete File:")
            || trimmed.starts_with("*** Move to:")
    })
}

fn push_paths_from_patch_text(target: &mut Vec<String>, patch_text: &str) {
    for line in patch_text.lines() {
        let trimmed = line.trim();
        for prefix in [
            "*** Add File:",
            "*** Update File:",
            "*** Delete File:",
            "*** Move to:",
        ] {
            if let Some(path) = trimmed.strip_prefix(prefix) {
                if let Some(normalized) = normalize_artifact_protocol_path(path.trim()) {
                    if !target.iter().any(|item| item == &normalized) {
                        target.push(normalized);
                    }
                }
            }
        }
    }
}

fn extract_embedded_metadata(value: &Value) -> Option<HashMap<String, Value>> {
    let object = value.as_object()?;
    for key in ["metadata", "meta"] {
        let Some(candidate) = object.get(key).and_then(Value::as_object) else {
            continue;
        };
        return Some(
            candidate
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect(),
        );
    }
    None
}

fn push_compat_paths_from_value(target: &mut Vec<String>, value: &Value) {
    match value {
        Value::String(path) => {
            if let Some(normalized) = normalize_artifact_protocol_path(path) {
                if !target.iter().any(|item| item == &normalized) {
                    target.push(normalized);
                }
            }
        }
        Value::Array(values) => {
            for nested in values {
                push_compat_paths_from_value(target, nested);
            }
        }
        _ => {}
    }
}

fn extract_artifacts_from_metadata(
    metadata: Option<&HashMap<String, Value>>,
) -> Vec<MetadataArtifact> {
    let Some(metadata) = metadata else {
        return Vec::new();
    };

    let mut paths = extract_artifact_protocol_paths_from_metadata(metadata);
    for key in ["article_path", "cover_meta_path", "publish_path"] {
        if let Some(value) = metadata.get(key) {
            push_compat_paths_from_value(&mut paths, value);
        }
    }

    if paths.is_empty() {
        return Vec::new();
    }

    let ids = metadata
        .get("artifact_ids")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let single_id = metadata
        .get("artifact_id")
        .or_else(|| metadata.get("artifactId"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    paths
        .into_iter()
        .enumerate()
        .map(|(index, file_path)| MetadataArtifact {
            artifact_id: ids.get(index).cloned().or_else(|| {
                if index == 0 {
                    single_id.clone()
                } else {
                    None
                }
            }),
            file_path,
        })
        .collect()
}

fn parse_write_file_blocks(text: &str) -> Vec<ParsedWriteBlock> {
    let regex = write_file_open_tag_regex();
    let lower = text.to_ascii_lowercase();
    let mut search_offset = 0usize;
    let mut order = 0usize;
    let mut blocks = Vec::new();

    while let Some(captures) = regex.captures(&text[search_offset..]) {
        let Some(full_match) = captures.get(0) else {
            break;
        };
        let Some(path_match) = captures.get(1) else {
            search_offset += full_match.end();
            continue;
        };

        let open_start = search_offset + full_match.start();
        let open_end = search_offset + full_match.end();
        let Some(path) = normalize_artifact_protocol_path(path_match.as_str()) else {
            search_offset = open_end;
            continue;
        };

        let remainder = &lower[open_end..];
        if let Some(close_offset) = remainder.find(WRITE_FILE_CLOSE_TAG) {
            let content_end = open_end + close_offset;
            blocks.push(ParsedWriteBlock {
                key: format!("{order}:{path}"),
                path: path.clone(),
                content: text[open_end..content_end].to_string(),
                is_complete: true,
            });
            search_offset = content_end + WRITE_FILE_CLOSE_TAG.len();
        } else {
            blocks.push(ParsedWriteBlock {
                key: format!("{order}:{path}"),
                path: path.clone(),
                content: text[open_end..].to_string(),
                is_complete: false,
            });
            break;
        }
        order += 1;
        if search_offset <= open_start {
            break;
        }
    }

    blocks
}

fn write_file_open_tag_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"(?is)<write_file\s+path\s*=\s*["']([^"']+)["']\s*>"#)
            .expect("write_file open tag regex should be valid")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_snapshot(
        event: &RuntimeAgentEvent,
        expected_path: &str,
        expected_content: &str,
        expected_complete: bool,
    ) -> String {
        match event {
            RuntimeAgentEvent::ArtifactSnapshot { artifact } => {
                assert_eq!(artifact.file_path, expected_path);
                assert_eq!(artifact.content.as_deref(), Some(expected_content));
                assert_eq!(
                    artifact
                        .metadata
                        .as_ref()
                        .and_then(|metadata| metadata.get("complete"))
                        .and_then(Value::as_bool),
                    Some(expected_complete)
                );
                artifact.artifact_id.clone()
            }
            _ => panic!("expected artifact snapshot"),
        }
    }

    #[test]
    fn tool_start_with_path_only_emits_preparing_snapshot() {
        let mut emitter = WriteArtifactEventEmitter::new("session-1");
        let mut event = RuntimeAgentEvent::ToolStart {
            tool_name: "write_file".to_string(),
            tool_id: "tool-1".to_string(),
            arguments: Some(r#"{"path":"drafts/demo.md"}"#.to_string()),
        };

        let extras = emitter.process_event(&mut event);
        assert_eq!(extras.len(), 1);
        let artifact_id = assert_snapshot(&extras[0], "drafts/demo.md", "", false);

        match &extras[0] {
            RuntimeAgentEvent::ArtifactSnapshot { artifact } => {
                assert_eq!(
                    artifact
                        .metadata
                        .as_ref()
                        .and_then(|metadata| metadata.get("writePhase"))
                        .and_then(Value::as_str),
                    Some("preparing")
                );
            }
            _ => panic!("expected artifact snapshot"),
        }
        assert!(artifact_id.starts_with("artifact:session-1:"));
    }

    #[test]
    fn tool_start_apply_patch_emits_preparing_snapshot_for_target_file() {
        let mut emitter = WriteArtifactEventEmitter::new("session-1");
        let mut event = RuntimeAgentEvent::ToolStart {
            tool_name: "apply_patch".to_string(),
            tool_id: "tool-patch-1".to_string(),
            arguments: Some(
                r#"{"patch":"*** Begin Patch\n*** Update File: drafts/demo.md\n@@\n-old\n+new\n*** End Patch\n"}"#
                    .to_string(),
            ),
        };

        let extras = emitter.process_event(&mut event);

        assert_eq!(extras.len(), 1);
        assert_snapshot(&extras[0], "drafts/demo.md", "", false);
    }

    #[test]
    fn shell_apply_patch_command_emits_preparing_snapshot_for_target_file() {
        let mut emitter = WriteArtifactEventEmitter::new("session-1");
        let mut event = RuntimeAgentEvent::ToolStart {
            tool_name: "bash".to_string(),
            tool_id: "tool-shell-patch-1".to_string(),
            arguments: Some(
                r#"{"command":"apply_patch <<'PATCH'\n*** Begin Patch\n*** Add File: notes/live.md\n+hello\n*** End Patch\nPATCH\n"}"#
                    .to_string(),
            ),
        };

        let extras = emitter.process_event(&mut event);

        assert_eq!(extras.len(), 1);
        assert_snapshot(&extras[0], "notes/live.md", "", false);
    }

    #[test]
    fn text_delta_write_file_stream_emits_incremental_snapshots() {
        let mut emitter = WriteArtifactEventEmitter::new("session-1");
        let mut first = RuntimeAgentEvent::TextDelta {
            text: "开始 <write_file path=\"notes/demo.md\">Hello".to_string(),
        };
        let mut second = RuntimeAgentEvent::TextDelta {
            text: " world</write_file> 完成".to_string(),
        };

        let first_extras = emitter.process_event(&mut first);
        let second_extras = emitter.process_event(&mut second);

        assert_eq!(first_extras.len(), 1);
        assert_eq!(second_extras.len(), 1);
        let first_id = assert_snapshot(&first_extras[0], "notes/demo.md", "Hello", false);
        let second_id = assert_snapshot(&second_extras[0], "notes/demo.md", "Hello world", true);
        assert_eq!(first_id, second_id);
    }

    #[test]
    fn tool_end_emits_completed_snapshot_and_backfills_metadata() {
        let mut emitter = WriteArtifactEventEmitter::new("session-1");
        let mut tool_start = RuntimeAgentEvent::ToolStart {
            tool_name: "write_file".to_string(),
            tool_id: "tool-1".to_string(),
            arguments: Some(r##"{"path":"drafts/demo.md","content":"# 标题"}"##.to_string()),
        };
        emitter.process_event(&mut tool_start);

        let mut tool_end = RuntimeAgentEvent::ToolEnd {
            tool_id: "tool-1".to_string(),
            result: AgentToolResult {
                success: true,
                output: "写入完成".to_string(),
                error: None,
                images: None,
                metadata: None,
            },
        };

        let extras = emitter.process_event(&mut tool_end);
        assert_eq!(extras.len(), 1);
        let artifact_id = assert_snapshot(&extras[0], "drafts/demo.md", "# 标题", true);

        match &tool_end {
            RuntimeAgentEvent::ToolEnd { result, .. } => {
                let metadata = result.metadata.as_ref().expect("tool_end metadata");
                assert_eq!(
                    metadata.get("artifact_id").and_then(Value::as_str),
                    Some(artifact_id.as_str())
                );
                assert_eq!(
                    metadata.get("path").and_then(Value::as_str),
                    Some("drafts/demo.md")
                );
                assert_eq!(
                    metadata.get("artifact_streamed").and_then(Value::as_bool),
                    Some(true)
                );
            }
            _ => panic!("expected tool_end"),
        }
    }

    #[test]
    fn tool_end_reads_nested_artifact_protocol_metadata_paths() {
        let mut emitter = WriteArtifactEventEmitter::new("session-1");
        let mut tool_end = RuntimeAgentEvent::ToolEnd {
            tool_id: "tool-2".to_string(),
            result: AgentToolResult {
                success: true,
                output: "写入完成".to_string(),
                error: None,
                images: None,
                metadata: Some(HashMap::from([
                    (
                        "artifact_id".to_string(),
                        Value::String("artifact-social-1".to_string()),
                    ),
                    (
                        "payload".to_string(),
                        serde_json::json!({
                            "artifact_paths": ["social-posts\\final.md"]
                        }),
                    ),
                ])),
            },
        };

        let extras = emitter.process_event(&mut tool_end);

        assert_eq!(extras.len(), 1);
        assert_snapshot(&extras[0], "social-posts/final.md", "", true);

        match &tool_end {
            RuntimeAgentEvent::ToolEnd { result, .. } => {
                let metadata = result.metadata.as_ref().expect("tool_end metadata");
                assert_eq!(
                    metadata.get("path").and_then(Value::as_str),
                    Some("social-posts/final.md")
                );
                assert_eq!(
                    metadata.get("artifact_id").and_then(Value::as_str),
                    Some("artifact-social-1")
                );
            }
            _ => panic!("expected tool_end"),
        }
    }

    #[test]
    fn build_write_tool_artifact_events_emits_protocol_order() {
        let events = build_write_tool_artifact_events(
            "session-1",
            "write_file",
            "tool-3",
            "drafts/demo.md",
            "# 标题",
            AgentToolResult {
                success: true,
                output: "写入完成".to_string(),
                error: None,
                images: None,
                metadata: None,
            },
        );

        assert_eq!(events.len(), 4);
        assert_snapshot(&events[0], "drafts/demo.md", "# 标题", false);

        match &events[1] {
            RuntimeAgentEvent::ToolStart {
                tool_name, tool_id, ..
            } => {
                assert_eq!(tool_name, "write_file");
                assert_eq!(tool_id, "tool-3");
            }
            _ => panic!("expected tool_start"),
        }

        assert_snapshot(&events[2], "drafts/demo.md", "# 标题", true);

        match &events[3] {
            RuntimeAgentEvent::ToolEnd { tool_id, result } => {
                assert_eq!(tool_id, "tool-3");
                let metadata = result.metadata.as_ref().expect("tool_end metadata");
                assert_eq!(
                    metadata.get("artifact_streamed").and_then(Value::as_bool),
                    Some(true)
                );
                assert_eq!(
                    metadata.get("file_path").and_then(Value::as_str),
                    Some("drafts/demo.md")
                );
            }
            _ => panic!("expected tool_end"),
        }
    }
}
