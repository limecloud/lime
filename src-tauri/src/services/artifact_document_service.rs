//! ArtifactDocument 持久化服务
//!
//! 负责在工作区内生成稳定路径、落盘 JSON 快照，并给前端 workbench
//! 提供可直接消费的 snapshot metadata。

use crate::services::artifact_document_validator::{
    validate_or_fallback_artifact_document, validate_or_repair_artifact_document_value,
    ArtifactDocumentValidationContext, ArtifactDocumentValidationOutcome,
    ARTIFACT_DOCUMENT_SCHEMA_VERSION,
};
use chrono::{DateTime, Utc};
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

const ARTIFACT_RELATIVE_ROOT: &str = ".lime/artifacts";
const ARTIFACT_VERSION_DIRECTORY: &str = "versions";
const MAX_EMBEDDED_VERSION_HISTORY: usize = 12;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PersistedArtifactDocument {
    pub artifact_id: String,
    pub current_version_id: String,
    pub current_version_no: usize,
    pub relative_path: String,
    pub absolute_path: PathBuf,
    pub serialized_document: String,
    pub snapshot_metadata: Map<String, Value>,
    pub title: String,
    pub kind: String,
    pub status: String,
    pub repaired: bool,
    pub fallback_used: bool,
    pub issues: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ArtifactDocumentPersistParams {
    pub workspace_root: PathBuf,
    pub workspace_id: Option<String>,
    pub thread_id: String,
    pub turn_id: String,
    pub request_metadata: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ArtifactVersionSummary {
    id: String,
    artifact_id: String,
    version_no: usize,
    summary: Option<String>,
    title: String,
    kind: String,
    status: String,
    created_by: String,
    created_at: String,
    snapshot_path: String,
}

impl ArtifactVersionSummary {
    fn to_value(&self) -> Value {
        let mut record = Map::new();
        record.insert("id".to_string(), Value::String(self.id.clone()));
        record.insert(
            "artifactId".to_string(),
            Value::String(self.artifact_id.clone()),
        );
        record.insert("versionNo".to_string(), Value::from(self.version_no as u64));
        record.insert("title".to_string(), Value::String(self.title.clone()));
        record.insert("kind".to_string(), Value::String(self.kind.clone()));
        record.insert("status".to_string(), Value::String(self.status.clone()));
        record.insert(
            "createdBy".to_string(),
            Value::String(self.created_by.clone()),
        );
        record.insert(
            "createdAt".to_string(),
            Value::String(self.created_at.clone()),
        );
        record.insert(
            "snapshotPath".to_string(),
            Value::String(self.snapshot_path.clone()),
        );
        if let Some(summary) = self.summary.as_ref() {
            record.insert("summary".to_string(), Value::String(summary.clone()));
        }
        Value::Object(record)
    }
}

pub fn should_attempt_artifact_document_autopersist(request_metadata: Option<&Value>) -> bool {
    let mode = extract_artifact_string(request_metadata, &["artifact_mode", "artifactMode"]);
    if matches!(mode.as_deref(), Some("none")) {
        return false;
    }

    let stage = extract_artifact_string(request_metadata, &["artifact_stage", "artifactStage"])
        .or(mode.clone())
        .unwrap_or_else(|| "stage2".to_string());

    !matches!(stage.as_str(), "stage1")
}

pub fn persist_artifact_document_from_text(
    raw_text: &str,
    params: &ArtifactDocumentPersistParams,
) -> Result<PersistedArtifactDocument, String> {
    let request_metadata = params.request_metadata.as_ref();
    let request_id = extract_artifact_string(
        request_metadata,
        &["artifact_request_id", "artifactRequestId"],
    );
    let artifact_id = request_id
        .as_ref()
        .map(|value| format!("artifact-document:{value}"))
        .unwrap_or_else(|| {
            format!(
                "artifact-document:{}:{}",
                normalize_slug(params.thread_id.as_str()),
                normalize_slug(params.turn_id.as_str())
            )
        });

    let validation_context = ArtifactDocumentValidationContext {
        artifact_id: artifact_id.clone(),
        workspace_id: params.workspace_id.clone(),
        thread_id: Some(params.thread_id.clone()),
        turn_id: Some(params.turn_id.clone()),
        title_hint: extract_artifact_string(request_metadata, &["title", "run_title", "runTitle"]),
        kind_hint: extract_artifact_string(request_metadata, &["artifact_kind", "artifactKind"]),
        theme: extract_theme(request_metadata),
        source_policy: extract_artifact_string(
            request_metadata,
            &["source_policy", "sourcePolicy"],
        ),
        request_id: request_id.clone(),
        target_block_id: extract_artifact_string(
            request_metadata,
            &["artifact_target_block_id", "artifactTargetBlockId"],
        ),
    };

    let mut operation_issues = Vec::new();
    let provisional_relative_path = request_id.as_deref().map(|request_id| {
        build_artifact_relative_path(
            Some(request_id),
            params.thread_id.as_str(),
            params.turn_id.as_str(),
            "artifact",
            "artifact",
        )
    });
    let existing_document = provisional_relative_path
        .as_deref()
        .and_then(|relative_path| {
            read_existing_artifact_document(&params.workspace_root, relative_path)
        });
    let mut outcome = if let Some(ops_value) =
        crate::services::artifact_ops_service::extract_artifact_ops_candidate(raw_text)
    {
        let applied = crate::services::artifact_ops_service::apply_artifact_ops_to_document(
            existing_document.as_ref(),
            &ops_value,
            &validation_context,
        );
        operation_issues = applied.issues;
        validate_or_repair_artifact_document_value(&applied.document, raw_text, &validation_context)
    } else {
        validate_or_fallback_artifact_document(raw_text, &validation_context)
    };
    if !operation_issues.is_empty() {
        outcome.repaired = true;
        outcome.issues.extend(operation_issues);
    }
    let relative_path = build_artifact_relative_path(
        request_id.as_deref(),
        params.thread_id.as_str(),
        params.turn_id.as_str(),
        outcome.kind.as_str(),
        outcome.title.as_str(),
    );
    let absolute_path = params
        .workspace_root
        .join(relative_path.replace('/', std::path::MAIN_SEPARATOR_STR));
    if let Some(parent) = absolute_path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建 Artifact 目录失败: {error}"))?;
    }

    let mut version_history = bootstrap_existing_latest_version_if_needed(
        &params.workspace_root,
        &absolute_path,
        relative_path.as_str(),
        artifact_id.as_str(),
    )?;
    let previous_version = version_history.first().cloned();
    let next_version_no = version_history
        .iter()
        .map(|version| version.version_no)
        .max()
        .unwrap_or(0)
        + 1;
    let current_version_path =
        build_version_snapshot_relative_path(relative_path.as_str(), next_version_no);
    let created_at = Utc::now().to_rfc3339();
    let current_version = build_version_summary_from_document(
        &outcome.document,
        artifact_id.as_str(),
        next_version_no,
        current_version_path.as_str(),
        created_at,
    );
    let version_diff = crate::services::artifact_diff_service::build_artifact_version_diff(
        existing_document.as_ref(),
        previous_version.as_ref().map(|version| version.id.as_str()),
        previous_version.as_ref().map(|version| version.version_no),
        &outcome.document,
        current_version.id.as_str(),
        current_version.version_no,
    );
    version_history.push(current_version.clone());
    version_history.sort_by(|left, right| right.version_no.cmp(&left.version_no));
    let embedded_version_history = version_history
        .iter()
        .take(MAX_EMBEDDED_VERSION_HISTORY)
        .cloned()
        .collect::<Vec<_>>();
    let source_links = derive_source_links_from_document(&outcome.document);
    let enriched_document = enrich_document_with_history(
        &outcome.document,
        &current_version,
        &embedded_version_history,
        &source_links,
        version_diff.as_ref(),
    );
    let serialized_document = serde_json::to_string_pretty(&enriched_document)
        .map_err(|error| format!("序列化 ArtifactDocument 失败: {error}"))?;
    fs::write(&absolute_path, serialized_document.as_bytes())
        .map_err(|error| format!("写入 ArtifactDocument 失败: {error}"))?;
    let current_version_absolute_path = params
        .workspace_root
        .join(current_version_path.replace('/', std::path::MAIN_SEPARATOR_STR));
    if let Some(parent) = current_version_absolute_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建 Artifact 版本目录失败: {error}"))?;
    }
    fs::write(
        &current_version_absolute_path,
        serialized_document.as_bytes(),
    )
    .map_err(|error| format!("写入 Artifact 版本快照失败: {error}"))?;

    let preview_text = outcome
        .document
        .get("summary")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToString::to_string)
        .or_else(|| Some(outcome.title.clone()));
    let snapshot_metadata = build_snapshot_metadata(
        &enriched_document,
        &outcome,
        relative_path.as_str(),
        request_id.as_deref(),
        preview_text.as_deref(),
        &current_version,
        &embedded_version_history,
        &source_links,
        version_diff.as_ref(),
    );

    Ok(PersistedArtifactDocument {
        artifact_id,
        current_version_id: current_version.id.clone(),
        current_version_no: current_version.version_no,
        relative_path,
        absolute_path,
        serialized_document,
        snapshot_metadata,
        title: outcome.title,
        kind: outcome.kind,
        status: outcome.status,
        repaired: outcome.repaired,
        fallback_used: outcome.fallback_used,
        issues: outcome.issues,
    })
}

fn build_snapshot_metadata(
    document: &Value,
    outcome: &ArtifactDocumentValidationOutcome,
    relative_path: &str,
    request_id: Option<&str>,
    preview_text: Option<&str>,
    current_version: &ArtifactVersionSummary,
    version_history: &[ArtifactVersionSummary],
    source_links: &[Map<String, Value>],
    version_diff: Option<&Map<String, Value>>,
) -> Map<String, Value> {
    let mut metadata = Map::new();
    metadata.insert(
        "artifactSchema".to_string(),
        Value::String(ARTIFACT_DOCUMENT_SCHEMA_VERSION.to_string()),
    );
    metadata.insert(
        "artifactType".to_string(),
        Value::String("artifact_document".to_string()),
    );
    metadata.insert(
        "artifactKind".to_string(),
        Value::String(outcome.kind.clone()),
    );
    metadata.insert(
        "artifactTitle".to_string(),
        Value::String(outcome.title.clone()),
    );
    metadata.insert(
        "artifactStatus".to_string(),
        Value::String(outcome.status.clone()),
    );
    metadata.insert(
        "artifactVersionNo".to_string(),
        Value::from(current_version.version_no as u64),
    );
    metadata.insert(
        "artifactVersionId".to_string(),
        Value::String(current_version.id.clone()),
    );
    metadata.insert(
        "artifact_path".to_string(),
        Value::String(relative_path.to_string()),
    );
    metadata.insert(
        "artifact_paths".to_string(),
        Value::Array(vec![Value::String(relative_path.to_string())]),
    );
    metadata.insert("path".to_string(), Value::String(relative_path.to_string()));
    metadata.insert("complete".to_string(), Value::Bool(true));
    metadata.insert("isPartial".to_string(), Value::Bool(false));
    metadata.insert(
        "lastUpdateSource".to_string(),
        Value::String("artifact_document_service".to_string()),
    );
    metadata.insert("artifactDocument".to_string(), document.clone());
    metadata.insert("artifactVersion".to_string(), current_version.to_value());
    metadata.insert(
        "artifactVersions".to_string(),
        Value::Array(
            version_history
                .iter()
                .map(ArtifactVersionSummary::to_value)
                .collect(),
        ),
    );
    metadata.insert(
        "artifactSourceLinks".to_string(),
        Value::Array(source_links.iter().cloned().map(Value::Object).collect()),
    );
    if let Some(version_diff) = version_diff.cloned() {
        metadata.insert(
            "artifactVersionDiff".to_string(),
            Value::Object(version_diff),
        );
    }
    metadata.insert(
        "artifactValidationRepaired".to_string(),
        Value::Bool(outcome.repaired),
    );
    metadata.insert(
        "artifactFallbackUsed".to_string(),
        Value::Bool(outcome.fallback_used),
    );
    if !outcome.issues.is_empty() {
        metadata.insert(
            "artifactValidationIssues".to_string(),
            Value::Array(
                outcome
                    .issues
                    .iter()
                    .map(|issue| Value::String(issue.clone()))
                    .collect(),
            ),
        );
    }
    if let Some(request_id) = request_id {
        metadata.insert(
            "artifactRequestId".to_string(),
            Value::String(request_id.to_string()),
        );
    }
    if let Some(preview_text) = preview_text.map(str::trim).filter(|text| !text.is_empty()) {
        metadata.insert(
            "previewText".to_string(),
            Value::String(truncate_text(preview_text, 240)),
        );
    }
    metadata
}

fn build_version_id(artifact_id: &str, version_no: usize) -> String {
    format!("{artifact_id}:v{version_no}")
}

fn extract_artifact_file_stem(relative_path: &str) -> String {
    let file_name = relative_path.rsplit('/').next().unwrap_or(relative_path);
    if let Some(stripped) = file_name.strip_suffix(".artifact.json") {
        return stripped.to_string();
    }
    if let Some((stem, _)) = file_name.rsplit_once('.') {
        return stem.to_string();
    }
    file_name.to_string()
}

fn build_version_directory_relative_path(relative_path: &str) -> String {
    let stem = extract_artifact_file_stem(relative_path);
    match relative_path.rsplit_once('/') {
        Some((parent, _)) if !parent.is_empty() => {
            format!("{parent}/{ARTIFACT_VERSION_DIRECTORY}/{stem}")
        }
        _ => format!("{ARTIFACT_VERSION_DIRECTORY}/{stem}"),
    }
}

fn build_version_snapshot_relative_path(relative_path: &str, version_no: usize) -> String {
    format!(
        "{}/v{:04}.artifact.json",
        build_version_directory_relative_path(relative_path),
        version_no
    )
}

fn build_version_summary_from_document(
    document: &Value,
    artifact_id: &str,
    version_no: usize,
    snapshot_path: &str,
    created_at: String,
) -> ArtifactVersionSummary {
    let record = document.as_object();
    let metadata = record
        .and_then(|record| record.get("metadata"))
        .and_then(Value::as_object);
    ArtifactVersionSummary {
        id: build_version_id(artifact_id, version_no),
        artifact_id: artifact_id.to_string(),
        version_no,
        summary: metadata
            .and_then(|metadata| metadata.get("versionSummary"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
            .or_else(|| {
                record
                    .and_then(|record| record.get("summary"))
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToString::to_string)
            }),
        title: record
            .and_then(|record| record.get("title"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("未命名交付物")
            .to_string(),
        kind: record
            .and_then(|record| record.get("kind"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("analysis")
            .to_string(),
        status: record
            .and_then(|record| record.get("status"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("ready")
            .to_string(),
        created_by: metadata
            .and_then(|metadata| metadata.get("generatedBy"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("agent")
            .to_string(),
        created_at,
        snapshot_path: snapshot_path.to_string(),
    }
}

fn parse_version_no_from_relative_path(relative_path: &str) -> Option<usize> {
    let file_name = relative_path.rsplit('/').next()?;
    let raw = file_name
        .strip_prefix('v')?
        .strip_suffix(".artifact.json")?;
    raw.parse::<usize>().ok()
}

fn list_version_history(
    workspace_root: &Path,
    relative_path: &str,
    artifact_id: &str,
) -> Result<Vec<ArtifactVersionSummary>, String> {
    let version_dir_relative = build_version_directory_relative_path(relative_path);
    let version_dir_absolute =
        workspace_root.join(version_dir_relative.replace('/', std::path::MAIN_SEPARATOR_STR));
    if !version_dir_absolute.exists() {
        return Ok(Vec::new());
    }

    let mut versions = Vec::new();
    let entries = fs::read_dir(&version_dir_absolute)
        .map_err(|error| format!("读取 Artifact 版本目录失败: {error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("读取 Artifact 版本项失败: {error}"))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let file_name = match path.file_name().and_then(|value| value.to_str()) {
            Some(value) => value,
            None => continue,
        };
        if !file_name.ends_with(".artifact.json") {
            continue;
        }

        let relative = format!("{version_dir_relative}/{file_name}");
        let version_no = match parse_version_no_from_relative_path(relative.as_str()) {
            Some(value) => value,
            None => continue,
        };
        let raw = fs::read_to_string(&path)
            .map_err(|error| format!("读取 Artifact 版本快照失败: {error}"))?;
        let created_at =
            resolve_created_at_for_path(&path).unwrap_or_else(|| Utc::now().to_rfc3339());
        let document = match serde_json::from_str::<Value>(raw.as_str()) {
            Ok(value) => value,
            Err(_) => continue,
        };
        versions.push(build_version_summary_from_document(
            &document,
            artifact_id,
            version_no,
            relative.as_str(),
            created_at,
        ));
    }

    versions.sort_by(|left, right| right.version_no.cmp(&left.version_no));
    Ok(versions)
}

fn read_existing_artifact_document(workspace_root: &Path, relative_path: &str) -> Option<Value> {
    let absolute_path =
        workspace_root.join(relative_path.replace('/', std::path::MAIN_SEPARATOR_STR));
    let raw = fs::read_to_string(absolute_path).ok()?;
    serde_json::from_str::<Value>(raw.as_str()).ok()
}

fn bootstrap_existing_latest_version_if_needed(
    workspace_root: &Path,
    absolute_path: &Path,
    relative_path: &str,
    artifact_id: &str,
) -> Result<Vec<ArtifactVersionSummary>, String> {
    let existing_versions = list_version_history(workspace_root, relative_path, artifact_id)?;
    if !existing_versions.is_empty() || !absolute_path.exists() {
        return Ok(existing_versions);
    }

    let raw = fs::read_to_string(absolute_path)
        .map_err(|error| format!("读取现有 Artifact 快照失败: {error}"))?;
    let document = match serde_json::from_str::<Value>(raw.as_str()) {
        Ok(value) => value,
        Err(_) => return Ok(existing_versions),
    };
    let version_path = build_version_snapshot_relative_path(relative_path, 1);
    let version_absolute_path =
        workspace_root.join(version_path.replace('/', std::path::MAIN_SEPARATOR_STR));
    if let Some(parent) = version_absolute_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建 Artifact 历史目录失败: {error}"))?;
    }
    fs::write(&version_absolute_path, raw.as_bytes())
        .map_err(|error| format!("迁移旧 Artifact 历史快照失败: {error}"))?;
    Ok(vec![build_version_summary_from_document(
        &document,
        artifact_id,
        1,
        version_path.as_str(),
        resolve_created_at_for_path(absolute_path).unwrap_or_else(|| Utc::now().to_rfc3339()),
    )])
}

fn resolve_created_at_for_path(path: &Path) -> Option<String> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    Some(DateTime::<Utc>::from(modified).to_rfc3339())
}

fn enrich_document_with_history(
    document: &Value,
    current_version: &ArtifactVersionSummary,
    version_history: &[ArtifactVersionSummary],
    source_links: &[Map<String, Value>],
    version_diff: Option<&Map<String, Value>>,
) -> Value {
    let Some(record) = document.as_object() else {
        return document.clone();
    };

    let mut next = record.clone();
    let mut metadata = next
        .get("metadata")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    metadata.insert(
        "currentVersionId".to_string(),
        Value::String(current_version.id.clone()),
    );
    metadata.insert(
        "currentVersionNo".to_string(),
        Value::from(current_version.version_no as u64),
    );
    metadata.insert(
        "versionHistory".to_string(),
        Value::Array(
            version_history
                .iter()
                .map(ArtifactVersionSummary::to_value)
                .collect(),
        ),
    );
    metadata.insert(
        "sourceLinks".to_string(),
        Value::Array(source_links.iter().cloned().map(Value::Object).collect()),
    );
    if let Some(version_diff) = version_diff.cloned() {
        metadata.insert(
            "currentVersionDiff".to_string(),
            Value::Object(version_diff),
        );
    }
    next.insert("metadata".to_string(), Value::Object(metadata));
    Value::Object(next)
}

fn infer_source_type(source: &Map<String, Value>) -> String {
    if let Some(kind) = source
        .get("kind")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return kind.to_string();
    }

    if let Some(url) = source
        .get("url")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if url.starts_with("http://") || url.starts_with("https://") {
            return "web".to_string();
        }
        if url.starts_with("file://") {
            return "file".to_string();
        }
    }

    "unknown".to_string()
}

fn derive_source_links_from_document(document: &Value) -> Vec<Map<String, Value>> {
    let Some(record) = document.as_object() else {
        return Vec::new();
    };
    let artifact_id = record
        .get("artifactId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("artifact-document");
    let Some(source_values) = record.get("sources").and_then(Value::as_array) else {
        return Vec::new();
    };
    let Some(block_values) = record.get("blocks").and_then(Value::as_array) else {
        return Vec::new();
    };

    let mut source_map = std::collections::HashMap::new();
    for source in source_values.iter().filter_map(Value::as_object) {
        if let Some(source_id) = source
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            source_map.insert(source_id.to_string(), source.clone());
        }
    }

    let mut links = Vec::new();
    for block in block_values.iter().filter_map(Value::as_object) {
        let Some(block_id) = block
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };

        let source_ids = block
            .get("sourceIds")
            .or_else(|| block.get("source_ids"))
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        for source_id in source_ids {
            let Some(source) = source_map.get(source_id) else {
                continue;
            };

            let mut link = Map::new();
            link.insert(
                "artifactId".to_string(),
                Value::String(artifact_id.to_string()),
            );
            link.insert("blockId".to_string(), Value::String(block_id.to_string()));
            link.insert("sourceId".to_string(), Value::String(source_id.to_string()));
            link.insert(
                "sourceType".to_string(),
                Value::String(infer_source_type(source)),
            );
            link.insert(
                "sourceRef".to_string(),
                Value::String(
                    source
                        .get("url")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .unwrap_or(source_id)
                        .to_string(),
                ),
            );
            if let Some(label) = source
                .get("title")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                link.insert("label".to_string(), Value::String(label.to_string()));
            }
            if let Some(locator) = source.get("locator") {
                link.insert("locator".to_string(), locator.clone());
            } else if let Some(url) = source
                .get("url")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                link.insert("locator".to_string(), Value::String(url.to_string()));
            }
            links.push(link);
        }
    }

    links
}

fn build_artifact_relative_path(
    request_id: Option<&str>,
    thread_id: &str,
    turn_id: &str,
    kind: &str,
    title: &str,
) -> String {
    let file_stem = request_id
        .map(normalize_slug)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            format!(
                "{}-{}-{}",
                normalize_slug(kind),
                normalize_slug(turn_id),
                normalize_slug(title),
            )
        });
    let thread_segment = normalize_slug(thread_id);
    format!(
        "{}/{}/{}.artifact.json",
        ARTIFACT_RELATIVE_ROOT, thread_segment, file_stem
    )
}

fn extract_theme(request_metadata: Option<&Value>) -> Option<String> {
    extract_artifact_string(
        request_metadata,
        &["theme", "harness_theme", "harnessTheme"],
    )
}

fn extract_artifact_object(request_metadata: Option<&Value>) -> Option<&Map<String, Value>> {
    let metadata = request_metadata?;
    let object = metadata.as_object()?;
    if let Some(artifact) = object.get("artifact").and_then(Value::as_object) {
        return Some(artifact);
    }
    Some(object)
}

fn extract_artifact_string(request_metadata: Option<&Value>, keys: &[&str]) -> Option<String> {
    let artifact = extract_artifact_object(request_metadata)?;
    keys.iter()
        .filter_map(|key| artifact.get(*key))
        .find_map(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn normalize_slug(value: &str) -> String {
    let mut slug = String::new();
    let mut last_was_separator = false;
    for ch in value.trim().chars() {
        let normalized = if ch.is_ascii_alphanumeric() {
            Some(ch.to_ascii_lowercase())
        } else if ch == '-' || ch == '_' || ch.is_whitespace() || ch == '/' || ch == '\\' {
            Some('-')
        } else {
            None
        };

        match normalized {
            Some('-') => {
                if !last_was_separator && !slug.is_empty() {
                    slug.push('-');
                    last_was_separator = true;
                }
            }
            Some(ch) => {
                slug.push(ch);
                last_was_separator = false;
            }
            None => {}
        }
    }

    let trimmed = slug.trim_matches('-').to_string();
    if trimmed.is_empty() {
        format!("artifact-{:08x}", stable_hash(value))
    } else {
        trimmed
    }
}

fn stable_hash(input: &str) -> u32 {
    let mut hash: u32 = 0x811c9dc5;
    for byte in input.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(0x01000193);
    }
    hash
}

fn truncate_text(value: &str, max_chars: usize) -> String {
    value.trim().chars().take(max_chars).collect::<String>()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn build_params() -> ArtifactDocumentPersistParams {
        let workspace_root = tempdir().expect("tempdir").keep();
        ArtifactDocumentPersistParams {
            workspace_root,
            workspace_id: Some("workspace-1".to_string()),
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            request_metadata: Some(serde_json::json!({
                "artifact_mode": "draft",
                "artifact_stage": "stage2",
                "artifact_kind": "analysis",
                "source_policy": "required",
                "artifact_request_id": "artifact:analysis:demo",
                "theme": "knowledge"
            })),
        }
    }

    #[test]
    fn should_attempt_autopersist_should_skip_stage1_and_none() {
        assert!(!should_attempt_artifact_document_autopersist(Some(
            &serde_json::json!({
                "artifact_mode": "none"
            })
        )));
        assert!(!should_attempt_artifact_document_autopersist(Some(
            &serde_json::json!({
                "artifact_mode": "draft",
                "artifact_stage": "stage1"
            })
        )));
        assert!(should_attempt_artifact_document_autopersist(Some(
            &serde_json::json!({
                "artifact_mode": "draft",
                "artifact_stage": "stage2"
            })
        )));
    }

    #[test]
    fn persist_artifact_document_from_text_should_write_valid_document() {
        let params = build_params();
        let raw = serde_json::json!({
            "schemaVersion": ARTIFACT_DOCUMENT_SCHEMA_VERSION,
            "kind": "analysis",
            "title": "结构化结论",
            "status": "ready",
            "blocks": [
                { "type": "hero_summary", "summary": "摘要" }
            ],
            "sources": [
                { "title": "OpenAI", "url": "https://openai.com" }
            ],
            "metadata": {}
        })
        .to_string();

        let persisted =
            persist_artifact_document_from_text(&raw, &params).expect("persist should succeed");
        assert!(persisted.absolute_path.exists());
        assert!(persisted
            .relative_path
            .starts_with(".lime/artifacts/thread-1/"));
        assert!(persisted.relative_path.ends_with(".artifact.json"));
        assert_eq!(
            persisted
                .snapshot_metadata
                .get("artifactKind")
                .and_then(Value::as_str),
            Some("analysis")
        );
        assert_eq!(
            persisted
                .snapshot_metadata
                .get("artifact_paths")
                .and_then(Value::as_array)
                .and_then(|paths| paths.first())
                .and_then(Value::as_str),
            Some(persisted.relative_path.as_str())
        );
    }

    #[test]
    fn persist_artifact_document_from_text_should_fallback_when_json_invalid() {
        let params = build_params();
        let persisted = persist_artifact_document_from_text("普通文本输出", &params)
            .expect("fallback persist should succeed");
        assert_eq!(persisted.status, "failed");
        assert!(persisted.fallback_used);
        assert_eq!(
            persisted
                .snapshot_metadata
                .get("artifactFallbackUsed")
                .and_then(Value::as_bool),
            Some(true)
        );
    }

    #[test]
    fn persist_artifact_document_from_text_should_record_version_history_and_source_links() {
        let params = build_params();
        let first = serde_json::json!({
            "schemaVersion": ARTIFACT_DOCUMENT_SCHEMA_VERSION,
            "kind": "analysis",
            "title": "结构化结论",
            "status": "ready",
            "summary": "第一版摘要",
            "blocks": [
                { "id": "hero-1", "type": "hero_summary", "summary": "摘要", "sourceIds": ["source-1"] }
            ],
            "sources": [
                { "id": "source-1", "title": "OpenAI", "url": "https://openai.com" }
            ],
            "metadata": {}
        })
        .to_string();
        let second = serde_json::json!({
            "schemaVersion": ARTIFACT_DOCUMENT_SCHEMA_VERSION,
            "kind": "analysis",
            "title": "结构化结论",
            "status": "ready",
            "summary": "第二版摘要",
            "blocks": [
                { "id": "hero-1", "type": "hero_summary", "summary": "更新后的摘要", "sourceIds": ["source-1"] }
            ],
            "sources": [
                { "id": "source-1", "title": "OpenAI", "url": "https://openai.com" }
            ],
            "metadata": {}
        })
        .to_string();

        let persisted_first =
            persist_artifact_document_from_text(&first, &params).expect("first persist");
        assert_eq!(persisted_first.current_version_no, 1);

        let persisted_second =
            persist_artifact_document_from_text(&second, &params).expect("second persist");

        assert_eq!(persisted_second.current_version_no, 2);
        assert_eq!(
            persisted_second
                .snapshot_metadata
                .get("artifactVersion")
                .and_then(Value::as_object)
                .and_then(|record| record.get("versionNo"))
                .and_then(Value::as_u64),
            Some(2)
        );
        assert_eq!(
            persisted_second
                .snapshot_metadata
                .get("artifactVersions")
                .and_then(Value::as_array)
                .map(|items| items.len()),
            Some(2)
        );
        assert_eq!(
            persisted_second
                .snapshot_metadata
                .get("artifactSourceLinks")
                .and_then(Value::as_array)
                .map(|items| items.len()),
            Some(1)
        );
        assert_eq!(
            persisted_second
                .snapshot_metadata
                .get("artifactVersionDiff")
                .and_then(Value::as_object)
                .and_then(|record| record.get("updatedCount"))
                .and_then(Value::as_u64),
            Some(1)
        );
        assert!(persisted_second
            .serialized_document
            .contains("\"currentVersionNo\": 2"));
        assert!(persisted_second
            .serialized_document
            .contains("\"versionHistory\""));
        assert!(persisted_second
            .serialized_document
            .contains("\"sourceLinks\""));
        assert!(persisted_second
            .serialized_document
            .contains("\"currentVersionDiff\""));
    }

    #[test]
    fn persist_artifact_document_from_text_should_apply_artifact_ops_and_create_new_version() {
        let params = build_params();
        let first = serde_json::json!({
            "schemaVersion": ARTIFACT_DOCUMENT_SCHEMA_VERSION,
            "kind": "analysis",
            "title": "结构化结论",
            "status": "ready",
            "summary": "第一版摘要",
            "blocks": [
                { "id": "hero-1", "type": "hero_summary", "summary": "第一版摘要" },
                { "id": "body-1", "type": "rich_text", "markdown": "旧正文" }
            ],
            "sources": [],
            "metadata": {}
        })
        .to_string();
        let ops = serde_json::json!({
            "type": "artifact_ops",
            "artifactId": "artifact-document:artifact:analysis:demo",
            "ops": [
                {
                    "op": "artifact.upsert_block",
                    "block": {
                        "id": "body-1",
                        "type": "rich_text",
                        "markdown": "更新后的正文"
                    }
                },
                {
                    "op": "artifact.attach_source",
                    "blockId": "body-1",
                    "source": {
                        "id": "source-1",
                        "title": "OpenAI",
                        "url": "https://openai.com"
                    }
                },
                {
                    "op": "artifact.finalize_version",
                    "summary": "只改写了正文并补上来源"
                }
            ]
        })
        .to_string();

        let persisted_first =
            persist_artifact_document_from_text(&first, &params).expect("first persist");
        let persisted_second =
            persist_artifact_document_from_text(&ops, &params).expect("ops persist");

        assert_eq!(persisted_first.current_version_no, 1);
        assert_eq!(persisted_second.current_version_no, 2);
        assert!(persisted_second
            .serialized_document
            .contains("更新后的正文"));
        assert!(persisted_second
            .serialized_document
            .contains("\"sourceLinks\""));
        assert_eq!(
            persisted_second
                .snapshot_metadata
                .get("artifactSourceLinks")
                .and_then(Value::as_array)
                .map(|items| items.len()),
            Some(1)
        );
        assert_eq!(
            persisted_second
                .snapshot_metadata
                .get("artifactVersion")
                .and_then(Value::as_object)
                .and_then(|record| record.get("summary"))
                .and_then(Value::as_str),
            Some("只改写了正文并补上来源")
        );
        assert_eq!(
            persisted_second
                .snapshot_metadata
                .get("artifactVersionDiff")
                .and_then(Value::as_object)
                .and_then(|record| record.get("updatedCount"))
                .and_then(Value::as_u64),
            Some(1)
        );
    }

    #[test]
    fn persist_artifact_document_from_text_should_restrict_rewrite_to_target_block() {
        let mut params = build_params();
        params.request_metadata = Some(serde_json::json!({
            "artifact_mode": "rewrite",
            "artifact_stage": "rewrite",
            "artifact_kind": "analysis",
            "source_policy": "required",
            "artifact_request_id": "artifact:analysis:demo",
            "artifact_target_block_id": "body-1",
            "theme": "knowledge"
        }));

        let first = serde_json::json!({
            "schemaVersion": ARTIFACT_DOCUMENT_SCHEMA_VERSION,
            "kind": "analysis",
            "title": "结构化结论",
            "status": "ready",
            "summary": "第一版摘要",
            "blocks": [
                { "id": "hero-1", "type": "hero_summary", "summary": "第一版摘要" },
                { "id": "body-1", "type": "rich_text", "markdown": "旧正文 1" },
                { "id": "body-2", "type": "rich_text", "markdown": "旧正文 2" }
            ],
            "sources": [
                { "id": "source-1", "title": "OpenAI", "url": "https://openai.com" }
            ],
            "metadata": {}
        })
        .to_string();
        let ops = serde_json::json!({
            "type": "artifact_ops",
            "artifactId": "artifact-document:artifact:analysis:demo",
            "ops": [
                {
                    "op": "artifact.upsert_block",
                    "block": {
                        "id": "body-2",
                        "type": "rich_text",
                        "markdown": "不应被应用"
                    }
                },
                {
                    "op": "artifact.upsert_block",
                    "block": {
                        "id": "body-1",
                        "type": "rich_text",
                        "markdown": "仅目标 block 被改写"
                    }
                },
                {
                    "op": "artifact.finalize_version",
                    "summary": "只改写 body-1"
                }
            ]
        })
        .to_string();

        let persisted_first =
            persist_artifact_document_from_text(&first, &params).expect("first persist");
        let persisted_second =
            persist_artifact_document_from_text(&ops, &params).expect("ops persist");

        assert_eq!(persisted_first.current_version_no, 1);
        assert_eq!(persisted_second.current_version_no, 2);
        assert!(persisted_second
            .serialized_document
            .contains("仅目标 block 被改写"));
        assert!(persisted_second
            .serialized_document
            .contains("\"markdown\": \"旧正文 2\""));
        assert!(persisted_second
            .issues
            .iter()
            .any(|issue| issue.contains("非目标 block `body-2`")));
    }

    #[test]
    fn persist_artifact_document_from_text_should_accept_typed_rewrite_patch() {
        let mut params = build_params();
        params.request_metadata = Some(serde_json::json!({
            "artifact_mode": "rewrite",
            "artifact_stage": "rewrite",
            "artifact_kind": "analysis",
            "source_policy": "required",
            "artifact_request_id": "artifact:analysis:demo",
            "artifact_target_block_id": "body-1",
            "theme": "knowledge"
        }));

        let first = serde_json::json!({
            "schemaVersion": ARTIFACT_DOCUMENT_SCHEMA_VERSION,
            "kind": "analysis",
            "title": "结构化结论",
            "status": "ready",
            "summary": "第一版摘要",
            "blocks": [
                { "id": "hero-1", "type": "hero_summary", "summary": "第一版摘要" },
                { "id": "body-1", "type": "rich_text", "markdown": "旧正文 1" }
            ],
            "sources": [
                { "id": "source-1", "title": "OpenAI", "url": "https://openai.com" }
            ],
            "metadata": {}
        })
        .to_string();
        let rewrite_patch = serde_json::json!({
            "type": "artifact_rewrite_patch",
            "artifactId": "artifact-document:artifact:analysis:demo",
            "targetBlockId": "body-1",
            "block": {
                "id": "body-1",
                "type": "rich_text",
                "markdown": "typed patch 改写后的正文"
            },
            "source": {
                "id": "source-2",
                "title": "Anthropic",
                "url": "https://anthropic.com"
            },
            "summary": "通过 typed patch 改写正文"
        })
        .to_string();

        let persisted_first =
            persist_artifact_document_from_text(&first, &params).expect("first persist");
        let persisted_second =
            persist_artifact_document_from_text(&rewrite_patch, &params).expect("rewrite persist");

        assert_eq!(persisted_first.current_version_no, 1);
        assert_eq!(persisted_second.current_version_no, 2);
        assert!(persisted_second
            .serialized_document
            .contains("typed patch 改写后的正文"));
        assert!(persisted_second.serialized_document.contains("source-2"));
        assert!(persisted_second
            .snapshot_metadata
            .get("artifactVersion")
            .and_then(Value::as_object)
            .and_then(|record| record.get("summary"))
            .and_then(Value::as_str)
            .is_some_and(|summary| summary.contains("typed patch")));
    }
}
