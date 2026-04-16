//! Runtime file checkpoint 服务
//!
//! 基于当前 SessionDetail -> FileArtifact -> artifact sidecar 主链，
//! 提供文件快照摘要、详情与 diff 读取能力。

use crate::agent::SessionDetail;
use crate::commands::aster_agent_cmd::{
    AgentRuntimeFileCheckpointDetail, AgentRuntimeFileCheckpointDiffResult,
    AgentRuntimeFileCheckpointListResult, AgentRuntimeFileCheckpointSummary,
    AgentRuntimeFileCheckpointThreadSummary,
};
use lime_core::database::dao::agent_timeline::{AgentThreadItem, AgentThreadItemPayload};
use serde_json::{Map, Value};
use std::collections::HashSet;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone)]
struct RuntimeFileCheckpointRecord {
    summary: AgentRuntimeFileCheckpointSummary,
    content: Option<String>,
    metadata: Option<Value>,
}

pub fn build_thread_file_checkpoint_summary(
    detail: &SessionDetail,
) -> Option<AgentRuntimeFileCheckpointThreadSummary> {
    let checkpoints = collect_file_checkpoint_records(detail);
    if checkpoints.is_empty() {
        return None;
    }

    Some(AgentRuntimeFileCheckpointThreadSummary {
        count: checkpoints.len(),
        latest_checkpoint: checkpoints.first().map(|record| record.summary.clone()),
    })
}

pub fn list_file_checkpoints(detail: &SessionDetail) -> AgentRuntimeFileCheckpointListResult {
    let checkpoints = collect_file_checkpoint_records(detail)
        .into_iter()
        .map(|record| record.summary)
        .collect::<Vec<_>>();

    AgentRuntimeFileCheckpointListResult {
        session_id: detail.id.clone(),
        thread_id: detail.thread_id.clone(),
        checkpoint_count: checkpoints.len(),
        checkpoints,
    }
}

pub fn get_file_checkpoint(
    detail: &SessionDetail,
    workspace_root: &Path,
    checkpoint_id: &str,
) -> Result<AgentRuntimeFileCheckpointDetail, String> {
    let record = find_file_checkpoint_record(detail, checkpoint_id)?;
    let metadata = record.metadata.as_ref();
    let snapshot_path = extract_snapshot_path(metadata, record.summary.path.as_str())
        .unwrap_or_else(|| record.summary.path.clone());
    let checkpoint_document = read_json_relative(workspace_root, snapshot_path.as_str())
        .or_else(|| extract_artifact_document(metadata));
    let live_document =
        read_json_relative(workspace_root, record.summary.path.as_str()).or_else(|| {
            if snapshot_path == record.summary.path {
                checkpoint_document.clone()
            } else {
                None
            }
        });

    Ok(AgentRuntimeFileCheckpointDetail {
        session_id: detail.id.clone(),
        thread_id: detail.thread_id.clone(),
        checkpoint: record.summary.clone(),
        live_path: record.summary.path.clone(),
        snapshot_path,
        checkpoint_document,
        live_document,
        version_history: extract_version_history(metadata),
        validation_issues: extract_validation_issues(metadata),
        metadata: record.metadata.clone(),
        content: record.content.clone(),
    })
}

pub fn diff_file_checkpoint(
    detail: &SessionDetail,
    checkpoint_id: &str,
) -> Result<AgentRuntimeFileCheckpointDiffResult, String> {
    let record = find_file_checkpoint_record(detail, checkpoint_id)?;
    let metadata = record.metadata.as_ref();
    let current_version_id = record.summary.version_id.clone();
    let current_version_no = record.summary.version_no;

    Ok(AgentRuntimeFileCheckpointDiffResult {
        session_id: detail.id.clone(),
        thread_id: detail.thread_id.clone(),
        checkpoint: record.summary.clone(),
        current_version_id,
        previous_version_id: extract_previous_version_id(metadata, current_version_no),
        diff: extract_version_diff(metadata),
    })
}

fn find_file_checkpoint_record(
    detail: &SessionDetail,
    checkpoint_id: &str,
) -> Result<RuntimeFileCheckpointRecord, String> {
    let normalized_checkpoint_id = checkpoint_id.trim();
    if normalized_checkpoint_id.is_empty() {
        return Err("checkpoint_id 不能为空".to_string());
    }

    collect_file_checkpoint_records(detail)
        .into_iter()
        .find(|record| record.summary.checkpoint_id == normalized_checkpoint_id)
        .ok_or_else(|| format!("未找到文件快照: {normalized_checkpoint_id}"))
}

fn collect_file_checkpoint_records(detail: &SessionDetail) -> Vec<RuntimeFileCheckpointRecord> {
    let mut seen = HashSet::new();
    let mut checkpoints = Vec::new();

    for item in detail.items.iter().rev() {
        let Some(record) = checkpoint_record_from_item(item) else {
            continue;
        };
        if seen.insert(record.summary.checkpoint_id.clone()) {
            checkpoints.push(record);
        }
    }

    checkpoints.sort_by(|left, right| {
        right
            .summary
            .updated_at
            .cmp(&left.summary.updated_at)
            .then_with(|| left.summary.path.cmp(&right.summary.path))
    });
    checkpoints
}

fn checkpoint_record_from_item(item: &AgentThreadItem) -> Option<RuntimeFileCheckpointRecord> {
    let AgentThreadItemPayload::FileArtifact {
        path,
        source,
        content,
        metadata,
    } = &item.payload
    else {
        return None;
    };

    let normalized_path = normalize_optional_text(path.clone())?;
    let normalized_source =
        normalize_optional_text(source.clone()).unwrap_or_else(|| "runtime".to_string());
    let metadata_ref = metadata.as_ref();
    let preview_text = extract_preview_text(metadata_ref, content.as_deref());
    let version_no = extract_version_no(metadata_ref);

    Some(RuntimeFileCheckpointRecord {
        summary: AgentRuntimeFileCheckpointSummary {
            checkpoint_id: item.id.clone(),
            turn_id: item.turn_id.clone(),
            path: normalized_path.clone(),
            source: normalized_source,
            updated_at: item.updated_at.clone(),
            version_no,
            version_id: extract_version_id(metadata_ref),
            request_id: extract_request_id(metadata_ref),
            title: extract_title(metadata_ref),
            kind: extract_kind(metadata_ref),
            status: extract_status(metadata_ref),
            preview_text,
            snapshot_path: extract_snapshot_path(metadata_ref, normalized_path.as_str()),
            validation_issue_count: extract_validation_issues(metadata_ref).len(),
        },
        content: content.clone(),
        metadata: metadata.clone(),
    })
}

fn normalize_optional_text(value: String) -> Option<String> {
    let trimmed = value.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn metadata_object(metadata: Option<&Value>) -> Option<&Map<String, Value>> {
    metadata?.as_object()
}

fn metadata_string(metadata: Option<&Value>, key: &str) -> Option<String> {
    metadata_object(metadata)?
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn nested_metadata_string(metadata: Option<&Value>, parent_key: &str, key: &str) -> Option<String> {
    metadata_object(metadata)?
        .get(parent_key)
        .and_then(Value::as_object)?
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn metadata_u32(metadata: Option<&Value>, key: &str) -> Option<u32> {
    metadata_object(metadata)?
        .get(key)
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
}

fn nested_metadata_u32(metadata: Option<&Value>, parent_key: &str, key: &str) -> Option<u32> {
    metadata_object(metadata)?
        .get(parent_key)
        .and_then(Value::as_object)?
        .get(key)
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
}

fn extract_version_no(metadata: Option<&Value>) -> Option<u32> {
    metadata_u32(metadata, "artifactVersionNo")
        .or_else(|| nested_metadata_u32(metadata, "artifactVersion", "versionNo"))
}

fn extract_version_id(metadata: Option<&Value>) -> Option<String> {
    metadata_string(metadata, "artifactVersionId")
        .or_else(|| nested_metadata_string(metadata, "artifactVersion", "id"))
}

fn extract_request_id(metadata: Option<&Value>) -> Option<String> {
    metadata_string(metadata, "artifactRequestId")
}

fn extract_title(metadata: Option<&Value>) -> Option<String> {
    metadata_string(metadata, "artifactTitle")
        .or_else(|| nested_metadata_string(metadata, "artifactVersion", "title"))
        .or_else(|| nested_metadata_string(metadata, "artifactDocument", "title"))
}

fn extract_kind(metadata: Option<&Value>) -> Option<String> {
    metadata_string(metadata, "artifactKind")
        .or_else(|| nested_metadata_string(metadata, "artifactVersion", "kind"))
        .or_else(|| nested_metadata_string(metadata, "artifactDocument", "kind"))
}

fn extract_status(metadata: Option<&Value>) -> Option<String> {
    metadata_string(metadata, "artifactStatus")
        .or_else(|| nested_metadata_string(metadata, "artifactVersion", "status"))
        .or_else(|| nested_metadata_string(metadata, "artifactDocument", "status"))
}

fn extract_snapshot_path(metadata: Option<&Value>, fallback_path: &str) -> Option<String> {
    nested_metadata_string(metadata, "artifactVersion", "snapshotPath")
        .or_else(|| metadata_string(metadata, "artifact_path"))
        .or_else(|| normalize_optional_text(fallback_path.to_string()))
}

fn extract_preview_text(metadata: Option<&Value>, content: Option<&str>) -> Option<String> {
    metadata_string(metadata, "previewText")
        .or_else(|| nested_metadata_string(metadata, "artifactDocument", "summary"))
        .or_else(|| nested_metadata_string(metadata, "artifactDocument", "title"))
        .or_else(|| {
            content
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(truncate_text)
        })
}

fn truncate_text(value: &str) -> String {
    const MAX_PREVIEW_CHARS: usize = 240;
    let normalized = value
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let mut chars = normalized.chars();
    let prefix: String = chars.by_ref().take(MAX_PREVIEW_CHARS).collect();
    if chars.next().is_some() {
        format!("{prefix}...")
    } else {
        prefix
    }
}

fn extract_validation_issues(metadata: Option<&Value>) -> Vec<String> {
    metadata_object(metadata)
        .and_then(|record| record.get("artifactValidationIssues"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn extract_artifact_document(metadata: Option<&Value>) -> Option<Value> {
    metadata_object(metadata)?.get("artifactDocument").cloned()
}

fn extract_version_history(metadata: Option<&Value>) -> Vec<Value> {
    metadata_object(metadata)
        .and_then(|record| record.get("artifactVersions"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn extract_previous_version_id(
    metadata: Option<&Value>,
    current_version_no: Option<u32>,
) -> Option<String> {
    let current_version_no = current_version_no?;
    let previous_version_no = current_version_no.checked_sub(1)?;

    extract_version_history(metadata)
        .into_iter()
        .find_map(|value| {
            let record = value.as_object()?;
            let version_no = record.get("versionNo").and_then(Value::as_u64)?;
            if version_no != u64::from(previous_version_no) {
                return None;
            }
            record
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
}

fn extract_version_diff(metadata: Option<&Value>) -> Option<Value> {
    metadata_object(metadata)?
        .get("artifactVersionDiff")
        .cloned()
}

fn read_json_relative(workspace_root: &Path, relative_path: &str) -> Option<Value> {
    let normalized = relative_path.trim();
    if normalized.is_empty() {
        return None;
    }

    let path = workspace_root.join(normalized.replace('/', std::path::MAIN_SEPARATOR_STR));
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str::<Value>(&raw).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use lime_core::database::dao::agent_timeline::{AgentThreadItemStatus, AgentThreadTurn};
    use tempfile::tempdir;

    fn build_detail(item: AgentThreadItem) -> SessionDetail {
        SessionDetail {
            id: "session-1".to_string(),
            name: "测试会话".to_string(),
            created_at: 0,
            updated_at: 0,
            thread_id: "thread-1".to_string(),
            model: None,
            working_dir: None,
            workspace_id: Some("workspace-1".to_string()),
            messages: Vec::new(),
            execution_strategy: None,
            execution_runtime: None,
            turns: vec![AgentThreadTurn {
                id: "turn-1".to_string(),
                thread_id: "thread-1".to_string(),
                prompt_text: "生成 artifact".to_string(),
                status: lime_core::database::dao::agent_timeline::AgentThreadTurnStatus::Completed,
                started_at: "2026-04-15T00:00:00Z".to_string(),
                completed_at: Some("2026-04-15T00:00:01Z".to_string()),
                error_message: None,
                created_at: "2026-04-15T00:00:00Z".to_string(),
                updated_at: "2026-04-15T00:00:01Z".to_string(),
            }],
            items: vec![item],
            todo_items: Vec::new(),
            child_subagent_sessions: Vec::new(),
            subagent_parent_context: None,
        }
    }

    fn build_item(metadata: Option<Value>) -> AgentThreadItem {
        AgentThreadItem {
            id: "artifact-document:req-1".to_string(),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            sequence: 1,
            status: AgentThreadItemStatus::Completed,
            started_at: "2026-04-15T00:00:00Z".to_string(),
            completed_at: Some("2026-04-15T00:00:01Z".to_string()),
            updated_at: "2026-04-15T00:00:01Z".to_string(),
            payload: AgentThreadItemPayload::FileArtifact {
                path: ".lime/artifacts/thread-1/demo.artifact.json".to_string(),
                source: "artifact_document_service".to_string(),
                content: Some("# Demo".to_string()),
                metadata,
            },
        }
    }

    #[test]
    fn build_thread_summary_should_extract_latest_checkpoint_metadata() {
        let detail = build_detail(build_item(Some(serde_json::json!({
            "artifactVersionNo": 3,
            "artifactVersionId": "artifact-document:req-1:v3",
            "artifactRequestId": "req-1",
            "artifactTitle": "Demo",
            "artifactKind": "analysis",
            "artifactStatus": "ready",
            "previewText": "最新版本摘要",
            "artifactVersion": {
                "snapshotPath": ".lime/artifacts/thread-1/versions/demo/v0003.artifact.json"
            },
            "artifactValidationIssues": ["missing-source"]
        }))));

        let summary = build_thread_file_checkpoint_summary(&detail).expect("summary should exist");

        assert_eq!(summary.count, 1);
        let latest = summary.latest_checkpoint.expect("latest checkpoint");
        assert_eq!(latest.checkpoint_id, "artifact-document:req-1");
        assert_eq!(latest.version_no, Some(3));
        assert_eq!(
            latest.version_id.as_deref(),
            Some("artifact-document:req-1:v3")
        );
        assert_eq!(latest.request_id.as_deref(), Some("req-1"));
        assert_eq!(latest.preview_text.as_deref(), Some("最新版本摘要"));
        assert_eq!(latest.validation_issue_count, 1);
    }

    #[test]
    fn get_file_checkpoint_should_read_snapshot_and_live_documents() {
        let temp_dir = tempdir().expect("temp dir");
        let workspace_root = temp_dir.path();
        let live_path = workspace_root.join(".lime/artifacts/thread-1/demo.artifact.json");
        let snapshot_path =
            workspace_root.join(".lime/artifacts/thread-1/versions/demo/v0002.artifact.json");
        fs::create_dir_all(live_path.parent().expect("live parent")).expect("live dir");
        fs::create_dir_all(snapshot_path.parent().expect("snapshot parent")).expect("snapshot dir");
        fs::write(
            &live_path,
            serde_json::json!({
                "title": "当前版本",
                "summary": "current"
            })
            .to_string(),
        )
        .expect("write live");
        fs::write(
            &snapshot_path,
            serde_json::json!({
                "title": "版本 2",
                "summary": "snapshot"
            })
            .to_string(),
        )
        .expect("write snapshot");

        let detail = build_detail(build_item(Some(serde_json::json!({
            "artifactVersionNo": 2,
            "artifactVersionId": "artifact-document:req-1:v2",
            "artifactVersion": {
                "id": "artifact-document:req-1:v2",
                "versionNo": 2,
                "snapshotPath": ".lime/artifacts/thread-1/versions/demo/v0002.artifact.json"
            },
            "artifactVersions": [
                { "id": "artifact-document:req-1:v1", "versionNo": 1 },
                { "id": "artifact-document:req-1:v2", "versionNo": 2 }
            ],
            "artifactValidationIssues": ["warning-a"]
        }))));

        let detail_result = get_file_checkpoint(&detail, workspace_root, "artifact-document:req-1")
            .expect("detail");

        assert_eq!(
            detail_result.snapshot_path,
            ".lime/artifacts/thread-1/versions/demo/v0002.artifact.json"
        );
        assert_eq!(detail_result.version_history.len(), 2);
        assert_eq!(
            detail_result.validation_issues,
            vec!["warning-a".to_string()]
        );
        assert_eq!(
            detail_result
                .checkpoint_document
                .as_ref()
                .and_then(|value| value.get("title"))
                .and_then(Value::as_str),
            Some("版本 2")
        );
        assert_eq!(
            detail_result
                .live_document
                .as_ref()
                .and_then(|value| value.get("title"))
                .and_then(Value::as_str),
            Some("当前版本")
        );
    }

    #[test]
    fn diff_file_checkpoint_should_return_metadata_diff_and_previous_version() {
        let detail = build_detail(build_item(Some(serde_json::json!({
            "artifactVersionNo": 4,
            "artifactVersionId": "artifact-document:req-1:v4",
            "artifactVersions": [
                { "id": "artifact-document:req-1:v3", "versionNo": 3 },
                { "id": "artifact-document:req-1:v4", "versionNo": 4 }
            ],
            "artifactVersionDiff": {
                "summary": "更新结论段与证据链接"
            }
        }))));

        let diff =
            diff_file_checkpoint(&detail, "artifact-document:req-1").expect("diff should exist");

        assert_eq!(
            diff.previous_version_id.as_deref(),
            Some("artifact-document:req-1:v3")
        );
        assert_eq!(
            diff.diff
                .as_ref()
                .and_then(|value| value.get("summary"))
                .and_then(Value::as_str),
            Some("更新结论段与证据链接")
        );
    }
}
